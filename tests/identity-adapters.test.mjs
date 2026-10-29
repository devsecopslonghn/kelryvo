import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer as createHttpsServer } from 'node:https';
import { generateKeyPairSync, sign as signBytes } from 'node:crypto';
import { InvalidCredentialsError } from 'ldapts';
import { createIdentityAdapters } from '../packages/identity/adapters.mjs';
import { createTlsFixture } from './helpers/product-tls-fixture.mjs';

const oidcSymbol = Symbol('customFetch');
const issuer = 'https://idp.example.test/tenant';
const redirectUri = 'https://app.example.test/api/auth/oidc/callback';
const pinned = '192.0.2.10';
const metadata = {
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`,
};

function fixture({ dnsRecords = [{ address: pinned, family: 4 }], httpStatus = 200, ldapEntries } = {}) {
  const calls = { requests: [], ldap: [] };
  const runtime = {
    publicOrigin: 'https://app.example.test',
    routes: [
      { id: 'idp', kind: 'OIDC', origin: 'https://idp.example.test', issuerPrefix: '/tenant', host: 'idp.example.test', pinnedIPs: [pinned], secretRefs: ['oidc-secret'] },
      { id: 'directory', kind: 'LDAP', transport: 'LDAPS', host: 'ldap.example.test', port: 636,
        pinnedIPs: [pinned], baseDNs: ['ou=people,dc=example,dc=test'], bindDNs: ['cn=svc,ou=people,dc=example,dc=test'], secretRefs: ['ldap-secret'] },
    ],
    secrets: { 'oidc-secret': 'private-oidc-secret', 'ldap-secret': 'private-ldap-secret' },
  };
  const fakeOidc = {
    customFetch: oidcSymbol,
    ClientSecretBasic: secret => ({ secret }),
    async discovery(url, clientId, clientSecret, auth, options) {
      calls.discovery = { url, clientId, clientSecret, auth };
      const response = await options[oidcSymbol](new URL(`${issuer}/.well-known/openid-configuration`));
      const discovered = await response.json();
      assert.deepEqual(discovered, metadata);
      return { serverMetadata: () => metadata, [oidcSymbol]: options[oidcSymbol] };
    },
    enableNonRepudiationChecks() {},
    async calculatePKCECodeChallenge(verifier) { calls.verifier = verifier; return 'challenge-S256'; },
    buildAuthorizationUrl(_config, params) {
      calls.authorization = params;
      const url = new URL(metadata.authorization_endpoint);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      return url;
    },
    async authorizationCodeGrant(config, url, checks) {
      calls.checks = checks;
      const response = await config[oidcSymbol](metadata.token_endpoint, {
        method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: 'code' }),
      });
      assert.equal(response.status, 200);
      return { claims: () => ({ iss: issuer, sub: 'immutable-subject-42' }) };
    },
  };
  const httpsRequest = options => {
    calls.requests.push(options);
    const req = new EventEmitter();
    req.write = chunk => { calls.lastBody = Buffer.concat([calls.lastBody || Buffer.alloc(0), Buffer.from(chunk)]); };
    req.end = () => queueMicrotask(() => {
      const response = new EventEmitter();
      response.statusCode = httpStatus;
      response.statusMessage = httpStatus === 200 ? 'OK' : 'Found';
      response.headers = httpStatus === 200 ? { 'content-type': 'application/json' } : { location: 'http://127.0.0.1/private' };
      response.resume = () => {};
      req.emit('response', response);
      if (httpStatus === 200) response.emit('data', Buffer.from(JSON.stringify(metadata)));
      response.emit('end');
    });
    req.destroy = () => queueMicrotask(() => req.emit('error', new Error('destroyed')));
    return req;
  };
  class FakeLdapClient {
    constructor(options) { this.options = options; calls.ldap.push({ options, events: [] }); this.call = calls.ldap.at(-1); }
    async bind(dn, password) {
      this.call.events.push(['bind', dn, password]);
      if (dn === 'cn=person,ou=people,dc=example,dc=test' && password === 'bad') throw new InvalidCredentialsError('invalid');
    }
    async search(base, options) {
      this.call.events.push(['search', base, options]);
      return { searchEntries: ldapEntries ?? [{ dn: 'cn=person,ou=people,dc=example,dc=test', entryUUID: 'person-guid-1', displayName: 'Person' }] };
    }
    async unbind() { this.call.events.push(['unbind']); }
  }
  const deps = {
    oidc: fakeOidc,
    lookup: async () => dnsRecords,
    httpsRequest,
    LdapClient: FakeLdapClient,
  };
  const adapters = createIdentityAdapters(runtime, deps);
  const oidcProvider = { routeId: 'idp', issuer, clientId: 'web-client', clientSecretRef: 'oidc-secret' };
  const ldapProvider = { routeId: 'directory', baseDN: 'ou=people,dc=example,dc=test',
    loginAttribute: 'uid', subjectAttribute: 'entryUUID', bindDN: 'cn=svc,ou=people,dc=example,dc=test', bindSecretRef: 'ldap-secret' };
  return { adapters, calls, oidcProvider, ldapProvider };
}

test('OIDC authorization uses PKCE S256, state, nonce, fixed callback and the pinned HTTPS route', async () => {
  const f = fixture();
  const result = await f.adapters.oidcAuthorization(f.oidcProvider, {
    state: 'state-value-with-sufficient-entropy', nonce: 'nonce-value-with-sufficient-entropy',
    verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~', callbackUrl: redirectUri,
  });
  const url = new URL(result);
  assert.equal(url.origin, 'https://idp.example.test');
  assert.equal(url.searchParams.get('state'), 'state-value-with-sufficient-entropy');
  assert.equal(url.searchParams.get('nonce'), 'nonce-value-with-sufficient-entropy');
  assert.equal(url.searchParams.get('code_challenge'), 'challenge-S256');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(f.calls.discovery.clientSecret, 'private-oidc-secret');
  assert.equal(f.calls.requests[0].hostname, 'idp.example.test');
  assert.equal(f.calls.requests[0].servername, 'idp.example.test');
});

test('OIDC callback requires state, nonce and PKCE and sends the fixed redirect URI to token endpoint', async () => {
  const f = fixture();
  const result = await f.adapters.oidcCallback(f.oidcProvider,
    `${redirectUri}?code=opaque&state=expected-state-value-123456789`, {
      state: 'expected-state-value-123456789', nonce: 'expected-nonce-value-123456789',
      verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~', redirectUri,
    });
  assert.deepEqual(result, { subject: 'immutable-subject-42' });
  assert.deepEqual(f.calls.checks, {
    pkceCodeVerifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
    expectedState: 'expected-state-value-123456789', expectedNonce: 'expected-nonce-value-123456789',
  });
  assert.equal(new URLSearchParams(f.calls.lastBody.toString()).get('redirect_uri'), redirectUri);
});

test('real openid-client uses pinned verified HTTPS for discovery, token exchange and JWKS validation', async () => {
  const tlsFixture = await createTlsFixture();
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'unit-test-key', use: 'sig', alg: 'RS256' };
  let origin;
  let tokenBody = '';
  const paths = [];
  const server = createHttpsServer(tlsFixture.tls, (request, response) => {
    paths.push(request.url);
    const url = new URL(request.url, origin);
    response.setHeader('content-type', 'application/json');
    if (url.pathname === '/tenant/.well-known/openid-configuration') {
      response.end(JSON.stringify({
        issuer: origin + '/tenant', authorization_endpoint: origin + '/tenant/authorize',
        token_endpoint: origin + '/tenant/token', jwks_uri: origin + '/tenant/jwks',
        response_types_supported: ['code'], subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'], grant_types_supported: ['authorization_code'],
      }));
      return;
    }
    if (url.pathname === '/tenant/jwks') {
      response.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    if (url.pathname === '/tenant/token') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { tokenBody += chunk; body += chunk; });
      request.on('end', () => {
        const code = new URLSearchParams(body).get('code');
        const now = Math.floor(Date.now() / 1000);
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'unit-test-key' })).toString('base64url');
        const payload = Buffer.from(JSON.stringify({ iss: code === 'bad-issuer' ? origin + '/other' : origin + '/tenant',
          sub: 'real-oidc-subject', aud: code === 'bad-audience' ? 'other-client' : 'web-client',
          iat: now, exp: now + 300, nonce: code === 'bad-nonce' ? 'incorrect-nonce-value-123456789' : 'real-nonce-value-123456789' })).toString('base64url');
        const signingInput = `${header}.${payload}`;
        const signatureBytes = signBytes('RSA-SHA256', Buffer.from(signingInput), privateKey);
        if (code === 'bad-signature') signatureBytes[0] ^= 1;
        const signature = signatureBytes.toString('base64url');
        response.end(JSON.stringify({ access_token: 'opaque-access-token', token_type: 'Bearer', expires_in: 300,
          id_token: `${signingInput}.${signature}` }));
      });
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not_found' }));
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const port = server.address().port;
    origin = `https://localhost:${port}`;
    const runtime = {
      publicOrigin: 'https://app.example.test',
      routes: [{ id: 'real-idp', kind: 'OIDC', origin, issuerPrefix: '/tenant', host: 'localhost',
        pinnedIPs: ['127.0.0.1'], ca: tlsFixture.ca, secretRefs: ['real-secret'] }],
      secrets: { 'real-secret': 'private-client-secret' },
    };
    const adapters = createIdentityAdapters(runtime, { lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
    const provider = { routeId: 'real-idp', issuer: `${origin}/tenant`, clientId: 'web-client', clientSecretRef: 'real-secret' };
    const auth = await adapters.oidcAuthorization(provider, {
      state: 'real-state-value-123456789', nonce: 'real-nonce-value-123456789',
      verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~',
      callbackUrl: redirectUri,
    });
    assert.equal(new URL(auth).searchParams.get('code_challenge_method'), 'S256');
    const result = await adapters.oidcCallback(provider,
      `${redirectUri}?code=fixture-code&state=real-state-value-123456789`, {
        state: 'real-state-value-123456789', nonce: 'real-nonce-value-123456789',
        verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~', redirectUri,
      });
    assert.deepEqual(result, { subject: 'real-oidc-subject' });
    assert.deepEqual(paths.filter(path => ['/tenant/.well-known/openid-configuration', '/tenant/token', '/tenant/jwks'].includes(path)),
      ['/tenant/.well-known/openid-configuration', '/tenant/.well-known/openid-configuration', '/tenant/token', '/tenant/jwks']);
    assert.equal(new URLSearchParams(tokenBody).get('redirect_uri'), redirectUri);
    for (const code of ['bad-signature', 'bad-nonce', 'bad-issuer', 'bad-audience']) {
      await assert.rejects(adapters.oidcCallback(provider,
        `${redirectUri}?code=${code}&state=real-state-value-123456789`, {
          state: 'real-state-value-123456789', nonce: 'real-nonce-value-123456789',
          verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~', redirectUri,
        }), `OIDC token must reject ${code}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    await tlsFixture.close();
  }
});

test('OIDC fails closed on DNS pin mismatch, redirects, out-of-prefix issuer and wrong callback', async () => {
  const wrongDns = fixture({ dnsRecords: [{ address: '127.0.0.1', family: 4 }] });
  assert.deepEqual(await wrongDns.adapters.test({ kind: 'OIDC', ...wrongDns.oidcProvider }),
    { status: 'UNAVAILABLE', code: 'IDENTITY_PROVIDER_UNAVAILABLE' });
  assert.equal(wrongDns.calls.requests.length, 0);
  const redirect = fixture({ httpStatus: 302 });
  assert.deepEqual(await redirect.adapters.test({ kind: 'OIDC', ...redirect.oidcProvider }),
    { status: 'UNAVAILABLE', code: 'IDENTITY_PROVIDER_UNAVAILABLE' });
  const outside = fixture();
  await assert.rejects(outside.adapters.oidcAuthorization({ ...outside.oidcProvider, issuer: 'https://idp.example.test/other' }, {
    state: 'state-value-with-sufficient-entropy', nonce: 'nonce-value-with-sufficient-entropy',
    verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~', callbackUrl: redirectUri,
  }), /IDENTITY_PROVIDER_UNAVAILABLE/);
  await assert.rejects(outside.adapters.oidcCallback(outside.oidcProvider, 'https://evil.example.test/callback?code=x&state=s', {
    state: 'state-value-with-sufficient-entropy', nonce: 'nonce-value-with-sufficient-entropy',
    verifier: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~', redirectUri,
  }), /IDENTITY_PROVIDER_UNAVAILABLE/);
});

test('LDAP escapes untrusted usernames, uses pinned verified LDAPS and validates password on a separate bind', async () => {
  const f = fixture();
  const identity = await f.adapters.ldapAuthenticate(f.ldapProvider, { username: 'x*)(uid=*)', password: 'user-password' });
  assert.deepEqual(identity, { subject: 'person-guid-1', displayName: 'Person' });
  assert.equal(f.calls.ldap.length, 2, 'service search and user authentication use independent clients');
  const [service, user] = f.calls.ldap;
  assert.equal(service.options.url, 'ldaps://ldap.example.test:636');
  assert.equal(service.options.timeout, 5000);
  assert.equal(service.options.tlsOptions.rejectUnauthorized, true);
  assert.equal(service.options.tlsOptions.servername, 'ldap.example.test');
  assert.equal(service.events.find(e => e[0] === 'bind')[2], 'private-ldap-secret');
  assert.match(service.events.find(e => e[0] === 'search')[2].filter, /\\2a\\29\\28uid=\\2a\\29/);
  assert.equal(user.events.find(e => e[0] === 'bind')[1], 'cn=person,ou=people,dc=example,dc=test');
  assert.equal(user.events.find(e => e[0] === 'bind')[2], 'user-password');
  assert.ok(service.events.some(e => e[0] === 'unbind'));
  assert.ok(user.events.some(e => e[0] === 'unbind'));
});

test('LDAP rejects ambiguous, absent and invalid identities without accepting a password', async () => {
  const duplicate = fixture({ ldapEntries: [
    { dn: 'cn=one,ou=people,dc=example,dc=test', entryUUID: 'one' },
    { dn: 'cn=two,ou=people,dc=example,dc=test', entryUUID: 'two' },
  ] });
  assert.equal(await duplicate.adapters.ldapAuthenticate(duplicate.ldapProvider, { username: 'person', password: 'secret' }), null);
  assert.equal(duplicate.calls.ldap.length, 1, 'ambiguous search must not bind as any user');
  const missing = fixture({ ldapEntries: [{ dn: 'cn=person,ou=people,dc=example,dc=test', displayName: 'Person' }] });
  assert.equal(await missing.adapters.ldapLookup(missing.ldapProvider, { username: 'person' }), null);
  const rejected = fixture();
  assert.equal(await rejected.adapters.ldapAuthenticate(rejected.ldapProvider, { username: 'person', password: 'bad' }), null);
});

test('provider routes, subject attributes and secret references are exact allowlisted values', async () => {
  const f = fixture();
  assert.deepEqual(await f.adapters.test({ kind: 'OIDC', ...f.oidcProvider, routeId: 'other' }),
    { status: 'UNAVAILABLE', code: 'IDENTITY_PROVIDER_UNAVAILABLE' });
  assert.deepEqual(await f.adapters.test({ kind: 'LDAP', ...f.ldapProvider, bindSecretRef: 'wrong-secret' }),
    { status: 'UNAVAILABLE', code: 'IDENTITY_PROVIDER_UNAVAILABLE' });
  await assert.rejects(f.adapters.ldapLookup({ ...f.ldapProvider, baseDN: 'dc=attacker,dc=invalid' }, { username: 'person' }), /IDENTITY_PROVIDER_UNAVAILABLE/);
});
