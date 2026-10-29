import dns from 'node:dns/promises';
import https from 'node:https';
import tls from 'node:tls';
import net from 'node:net';
import { isIP } from 'node:net';
import * as oidc from 'openid-client';
import { Client as LdapClient, escapeFilter } from 'ldapts';
import { InvalidCredentialsError } from 'ldapts';

const REQUEST_TIMEOUT_MS = 5_000;
const MAX_OIDC_RESPONSE_BYTES = 512 * 1024;
const MAX_LDAP_USERNAME_BYTES = 512;
const SAFE_ATTRIBUTE = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const SAFE_LDAP_DN = /^(?=.{1,2048}$)(?:[A-Za-z][A-Za-z0-9-]*=(?:\\.|[^,\\])+)(?:,(?:[A-Za-z][A-Za-z0-9-]*=(?:\\.|[^,\\])+))*$/;
const IMMUTABLE_LDAP_SUBJECT_ATTRIBUTES = new Set(['entryuuid', 'objectguid', 'nsuniqueid', 'ipauniqueid']);

function fail() {
  return new Error('IDENTITY_PROVIDER_UNAVAILABLE');
}

function safeUrl(value) {
  try { return new URL(value); } catch { throw fail(); }
}

function validOpaque(value, min = 16, max = 512) {
  return typeof value === 'string' && value.length >= min && value.length <= max
    && !/[\u0000-\u0020\u007f]/.test(value);
}

function validateRuntime(runtime) {
  if (!runtime || typeof runtime !== 'object' || !Array.isArray(runtime.routes)
      || !runtime.secrets || typeof runtime.secrets !== 'object') throw fail();
  let publicUrl;
  try { publicUrl = new URL(runtime.publicOrigin); } catch { throw fail(); }
  if (publicUrl.protocol !== 'https:' || publicUrl.username || publicUrl.password
      || publicUrl.search || publicUrl.hash) throw fail();
  for (const route of runtime.routes) {
    if (!route || typeof route.id !== 'string' || !['OIDC', 'LDAP'].includes(route.kind)
        || !Array.isArray(route.pinnedIPs) || route.pinnedIPs.length === 0
        || route.pinnedIPs.some(ip => !isIP(ip))) throw fail();
  }
  return publicUrl;
}

function routeFor(runtime, routeId, kind) {
  const route = runtime.routes.find(item => item.id === routeId && item.kind === kind);
  if (!route) throw fail();
  return route;
}

function secretFor(runtime, route, alias) {
  if (typeof alias !== 'string' || !route.secretRefs?.includes(alias)
      || typeof runtime.secrets[alias] !== 'string' || runtime.secrets[alias].length === 0) throw fail();
  return runtime.secrets[alias];
}

function ensurePins(route) {
  const pins = [...new Set(route.pinnedIPs)];
  if (!pins.length || pins.some(ip => !isIP(ip))) throw fail();
  return pins;
}

async function resolvePinned(hostname, route, resolve = dns.lookup) {
  const allow = new Set(ensurePins(route));
  let records;
  try { records = await resolve(hostname, { all: true, verbatim: true }); } catch { throw fail(); }
  if (!Array.isArray(records) || records.length === 0
      || records.some(record => !record || !allow.has(record.address))) throw fail();
  return records.map(record => ({ address: record.address, family: isIP(record.address) }));
}

function bufferRequestBody(body) {
  if (body == null) return undefined;
  if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof URLSearchParams) return Buffer.from(body.toString());
  throw fail();
}

async function guardedOidcFetch(route, approvedOrigin, fetchUrl, init = {}, deps = {}) {
  const url = safeUrl(fetchUrl);
  if (url.protocol !== 'https:' || url.origin !== approvedOrigin || url.username || url.password
      || url.hash || ![undefined, 'manual'].includes(init.redirect)) throw fail();
  const host = url.hostname.toLowerCase();
  if (route.host && host !== String(route.host).toLowerCase()) throw fail();
  const records = await resolvePinned(host, route, deps.lookup || dns.lookup);
  const pins = ensurePins(route);
  const chosen = records.find(record => pins.includes(record.address));
  if (!chosen) throw fail();
  let body = bufferRequestBody(init.body);
  let redirectChanged = false;
  if (body && deps.fixedRedirectUri && url.href === deps.tokenEndpointHref) {
    const form = new URLSearchParams(body.toString('utf8'));
    if (form.get('grant_type') === 'authorization_code') {
      form.set('redirect_uri', deps.fixedRedirectUri);
      body = Buffer.from(form.toString());
      redirectChanged = true;
    }
  }
  const headers = new Headers(init.headers || {});
  for (const name of ['host', 'connection', 'proxy-authorization']) headers.delete(name);
  if (redirectChanged) {
    headers.delete('content-length');
    headers.delete('transfer-encoding');
  }
  const requestOptions = {
    protocol: 'https:', hostname: host, port: url.port ? Number(url.port) : 443,
    path: `${url.pathname}${url.search}`, method: init.method || (body ? 'POST' : 'GET'),
    headers: Object.fromEntries(headers.entries()), servername: host, agent: false,
    rejectUnauthorized: true, ...(route.ca ? { ca: route.ca } : {}),
    lookup: (_hostname, options, callback) => {
      if (options?.all) callback(null, [{ address: chosen.address, family: chosen.family }]);
      else callback(null, chosen.address, chosen.family);
    },
  };
  const request = (deps.httpsRequest || https.request)(requestOptions);
  return await new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => request.destroy(new Error('timeout')), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    const abort = () => request.destroy(new Error('aborted'));
    const finishReject = () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        init.signal?.removeEventListener('abort', abort);
        reject(fail());
      }
    };
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener('abort', abort, { once: true });
    request.once('error', finishReject);
    request.once('response', response => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume(); finishReject(); return;
      }
      const chunks = []; let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_OIDC_RESPONSE_BYTES) request.destroy(new Error('response too large'));
        else chunks.push(chunk);
      });
      response.once('error', finishReject);
      response.once('end', () => {
        if (settled || size > MAX_OIDC_RESPONSE_BYTES) return;
        const status = response.statusCode || 502;
        try {
          const result = new Response(status === 204 || status === 205 || status === 304 ? null : Buffer.concat(chunks), {
            status, statusText: response.statusMessage, headers: response.headers,
          });
          settled = true;
          clearTimeout(timer);
          init.signal?.removeEventListener('abort', abort);
          resolve(result);
        } catch { finishReject(); }
      });
    });
    if (body) request.write(body);
    request.end();
  });
}

function checkOidcProvider(runtime, route, provider) {
  if (!provider || typeof provider !== 'object' || typeof provider.issuer !== 'string'
      || typeof provider.clientId !== 'string' || !provider.clientId.trim() || provider.clientId.length > 512) throw fail();
  const issuer = safeUrl(provider.issuer);
  const routeOrigin = route.origin || (route.host ? `https://${route.host}${route.port && route.port !== 443 ? `:${route.port}` : ''}` : '');
  const allowed = safeUrl(routeOrigin);
  const prefix = route.issuerPrefix || '/';
  if (issuer.protocol !== 'https:' || issuer.origin !== allowed.origin || issuer.username || issuer.password
      || issuer.search || issuer.hash || allowed.protocol !== 'https:' || allowed.pathname !== '/' || allowed.search || allowed.hash
      || !prefix.startsWith('/') || prefix.includes('?') || prefix.includes('#')) throw fail();
  const prefixPath = prefix === '/' ? '/' : prefix.replace(/\/+$/, '');
  if (prefixPath !== '/' && issuer.pathname !== prefixPath && !issuer.pathname.startsWith(`${prefixPath}/`)) throw fail();
  const clientSecret = secretFor(runtime, route, provider.clientSecretRef);
  return { issuer, clientSecret, origin: allowed.origin };
}

async function discoverOidc(runtime, route, provider, deps, fixedRedirectUri) {
  const checked = checkOidcProvider(runtime, route, provider);
  const requestDeps = { ...deps };
  if (fixedRedirectUri) requestDeps.fixedRedirectUri = fixedRedirectUri;
  const fetcher = (url, init) => guardedOidcFetch(route, checked.origin, url, init,
    { ...requestDeps, tokenEndpointPath: requestDeps.tokenEndpointPath });
  const config = await (deps.oidc || oidc).discovery(checked.issuer, provider.clientId, checked.clientSecret,
    (deps.oidc || oidc).ClientSecretBasic(checked.clientSecret), {
      [(deps.oidc || oidc).customFetch]: fetcher,
      timeout: REQUEST_TIMEOUT_MS / 1000,
    });
  // openid-client validates OIDC token claims during the code grant, but
  // signature validation is opt-in. Keep it enabled so ID tokens cannot be
  // accepted from a party that can only reach the token endpoint.
  const library = deps.oidc || oidc;
  if (typeof library.enableNonRepudiationChecks !== 'function') throw fail();
  library.enableNonRepudiationChecks(config);
  const metadata = config.serverMetadata();
  if (metadata.issuer !== checked.issuer.href && metadata.issuer !== provider.issuer) throw fail();
  for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri', 'userinfo_endpoint', 'end_session_endpoint']) {
    const endpoint = metadata[key];
    if (endpoint == null) continue;
    const parsed = safeUrl(endpoint);
    if (parsed.protocol !== 'https:' || parsed.origin !== checked.origin || parsed.username || parsed.password || parsed.hash) throw fail();
  }
  if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) throw fail();
  requestDeps.tokenEndpointHref = new URL(metadata.token_endpoint).href;
  return { config, ...checked };
}

function checkedCallback(value, publicUrl) {
  const callback = safeUrl(value);
  if (callback.protocol !== 'https:' || callback.origin !== publicUrl.origin || callback.username || callback.password
      || callback.hash) throw fail();
  return callback;
}

function checkedRedirectUri(value, publicUrl) {
  const redirect = checkedCallback(value, publicUrl);
  if (redirect.search || redirect.pathname === '/') throw fail();
  return redirect;
}

function checkedLdapProvider(runtime, route, provider) {
  const validHost = typeof route.host === 'string' && route.host.length <= 253
    && /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/.test(route.host);
  if (!provider || typeof provider !== 'object' || route.transport !== 'LDAPS' || route.port !== 636
      || !validHost || net.isIP(route.host) || !SAFE_ATTRIBUTE.test(provider.loginAttribute || '')
      || !SAFE_ATTRIBUTE.test(provider.subjectAttribute || '') || provider.subjectAttribute.toLowerCase() === provider.loginAttribute.toLowerCase()
      || !IMMUTABLE_LDAP_SUBJECT_ATTRIBUTES.has(provider.subjectAttribute.toLowerCase())
      || !SAFE_LDAP_DN.test(provider.baseDN || '') || !route.baseDNs?.includes(provider.baseDN)
      || !SAFE_LDAP_DN.test(provider.bindDN || '') || !route.bindDNs?.includes(provider.bindDN)) throw fail();
  const bindPassword = secretFor(runtime, route, provider.bindSecretRef);
  const pins = ensurePins(route);
  return { bindPassword, pins };
}

function ldapClient(route, pins, deps) {
  const host = String(route.host).toLowerCase();
  const ip = pins[0];
  const tlsOptions = {
    ...(route.ca ? { ca: route.ca } : {}),
    minVersion: 'TLSv1.2', rejectUnauthorized: true, servername: host,
    checkServerIdentity: (_name, cert) => tls.checkServerIdentity(host, cert),
  };
  const createSecureConnection = (port, requestedHost, options) => {
    if (port !== 636 || String(requestedHost).toLowerCase() !== host) throw fail();
    return tls.connect({ ...options, ...tlsOptions, host: ip, port: 636, servername: host, rejectUnauthorized: true });
  };
  const Client = deps.LdapClient || LdapClient;
  return new Client({ url: `ldaps://${host}:636`, timeout: REQUEST_TIMEOUT_MS,
    connectTimeout: REQUEST_TIMEOUT_MS, strictDN: true, autoRebind: false,
    tlsOptions, createSecureConnection });
}

function attributeValue(entry, attribute) {
  const key = Object.keys(entry || {}).find(name => name.toLowerCase() === attribute.toLowerCase());
  if (!key) return null;
  const value = entry[key];
  const first = Array.isArray(value) ? value[0] : value;
  if (typeof first === 'string' && first.length > 0 && first.length <= 1024) return first;
  if (Buffer.isBuffer(first) && first.length > 0 && first.length <= 1024) return first.toString('base64url');
  return null;
}

async function ldapSearch(runtime, route, provider, username, deps, { authenticate = false } = {}) {
  const { bindPassword, pins } = checkedLdapProvider(runtime, route, provider);
  if (typeof username !== 'string' || !username || Buffer.byteLength(username, 'utf8') > MAX_LDAP_USERNAME_BYTES
      || /[\u0000-\u001f\u007f]/.test(username)) return null;
  const client = ldapClient(route, pins, deps);
  let entry;
  try {
    await client.bind(provider.bindDN, bindPassword);
    const result = await client.search(provider.baseDN, {
      scope: 'sub', filter: escapeFilter`(${provider.loginAttribute}=${username})`,
      attributes: [...new Set([provider.subjectAttribute, 'displayName'])], sizeLimit: 2, timeLimit: 5,
    });
    if (result.searchEntries.length !== 1) return null;
    entry = result.searchEntries[0];
    const subject = attributeValue(entry, provider.subjectAttribute);
    if (!subject) return null;
    const dn = typeof entry.dn === 'string' ? entry.dn : entry.dn?.toString?.();
    if (authenticate) {
      // Always validate the user password on a fresh TLS connection. Never rebind
      // the service-account search connection as an end-user.
      if (!deps.userPassword || typeof dn !== 'string' || !dn || dn.length > 2048 || /[\u0000-\u001f\u007f]/.test(dn)) throw fail();
      const userClient = ldapClient(route, pins, deps);
      try { await userClient.bind(dn, deps.userPassword); }
      finally { try { await userClient.unbind(); } catch {} }
    }
    return { subject, displayName: attributeValue(entry, 'displayName') };
  } catch (error) {
    if (authenticate && error instanceof InvalidCredentialsError) return null;
    throw fail();
  } finally {
    try { await client.unbind(); } catch {}
  }
}

export function createIdentityAdapters(runtime, testDependencies = {}) {
  const publicUrl = validateRuntime(runtime);
  const deps = { ...testDependencies };
  return Object.freeze({
    async oidcAuthorization(provider, { state, nonce, verifier, callbackUrl } = {}) {
      if (!validOpaque(state) || !validOpaque(nonce) || !validOpaque(verifier, 43, 128)) throw fail();
      const redirectUri = checkedRedirectUri(callbackUrl, publicUrl);
      const route = routeFor(runtime, provider?.routeId, 'OIDC');
      const { config } = await discoverOidc(runtime, route, provider, deps);
      const library = deps.oidc || oidc;
      const challenge = await library.calculatePKCECodeChallenge(verifier);
      const authorizationUrl = library.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri.href, response_type: 'code', scope: 'openid profile email',
        code_challenge: challenge, code_challenge_method: 'S256', state, nonce,
      });
      const parsed = safeUrl(authorizationUrl);
      if (parsed.protocol !== 'https:' || parsed.origin !== new URL(config.serverMetadata().authorization_endpoint).origin) throw fail();
      return parsed.href;
    },

    async oidcCallback(provider, callbackUrl, { state, nonce, verifier, redirectUri } = {}) {
      if (!validOpaque(state) || !validOpaque(nonce) || !validOpaque(verifier, 43, 128)) throw fail();
      const exactRedirect = checkedRedirectUri(redirectUri, publicUrl);
      const callback = checkedCallback(callbackUrl, publicUrl);
      if (callback.pathname !== exactRedirect.pathname || callback.origin !== exactRedirect.origin
          || callback.searchParams.getAll('state').length !== 1 || callback.searchParams.getAll('code').length !== 1
          || callback.searchParams.has('error') || callback.searchParams.get('state') !== state) throw fail();
      const route = routeFor(runtime, provider?.routeId, 'OIDC');
      const { config } = await discoverOidc(runtime, route, provider, deps, exactRedirect.href);
      const library = deps.oidc || oidc;
      const tokens = await library.authorizationCodeGrant(config, callback, {
        pkceCodeVerifier: verifier, expectedState: state, expectedNonce: nonce,
      });
      const claims = tokens.claims();
      if (!claims || typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 1024
          || claims.iss !== provider.issuer || callback.searchParams.get('state') !== state) throw fail();
      // Ensure the exact, fixed callback URI used to start login is the one sent
      // to the token endpoint, independent of callback query parameters.
      const configMetadata = config.serverMetadata();
      if (!configMetadata.token_endpoint || exactRedirect.origin !== publicUrl.origin) throw fail();
      return { subject: claims.sub };
    },

    async test(provider) {
      try {
        if (provider?.kind === 'OIDC') {
          const route = routeFor(runtime, provider.routeId, 'OIDC');
          await discoverOidc(runtime, route, provider, deps);
          return { status: 'OK', code: 'PROVIDER_REACHABLE' };
        }
        if (provider?.kind === 'LDAP') {
          const route = routeFor(runtime, provider.routeId, 'LDAP');
          const { bindPassword, pins } = checkedLdapProvider(runtime, route, provider);
          const client = ldapClient(route, pins, deps);
          try {
            await client.bind(provider.bindDN, bindPassword);
          const result = await client.search(provider.baseDN, { scope: 'base', filter: '(objectClass=*)', attributes: ['1.1'], sizeLimit: 1, timeLimit: 5 });
            return result.searchEntries.length === 1
              ? { status: 'OK', code: 'PROVIDER_REACHABLE' }
              : { status: 'UNAVAILABLE', code: 'IDENTITY_PROVIDER_UNAVAILABLE' };
          } finally { try { await client.unbind(); } catch {} }
        }
        throw fail();
      } catch { return { status: 'UNAVAILABLE', code: 'IDENTITY_PROVIDER_UNAVAILABLE' }; }
    },

    async ldapAuthenticate(provider, { username, password } = {}) {
      if (typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 4096
          || /[\u0000]/.test(password)) return null;
      const route = routeFor(runtime, provider?.routeId, 'LDAP');
      return ldapSearch(runtime, route, provider, username, { ...deps, userPassword: password }, { authenticate: true });
    },

    async ldapLookup(provider, { username } = {}) {
      const route = routeFor(runtime, provider?.routeId, 'LDAP');
      return ldapSearch(runtime, route, provider, username, deps);
    },
  });
}
