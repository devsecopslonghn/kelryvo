import { Client } from 'ldapts';
import * as oidc from 'openid-client';
import { readContainerSecret } from '../runtime/container-config.mjs';

const invalid = () => Object.assign(new Error('Invalid identity provider configuration'), { productCode: 'INVALID_REQUEST' });
const secretPattern = /^secret:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
const groupValues = (value: unknown): string[] => {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return values.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 1024).slice(0, 256);
};
const text = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const validDn = (v: unknown): v is string => text(v, 2048) && !/[\u0000]/.test(v);
const httpsUrl = (value: unknown, allowLdap = false): URL | null => {
  if (!text(value, 2048)) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash || url.search) return null;
    if (url.protocol === 'https:' || (allowLdap && ['ldap:', 'ldaps:'].includes(url.protocol))) return url;
  } catch { /* normalized below */ }
  return null;
};
const mappingList = (value: unknown) => {
  if (!Array.isArray(value) || value.length > 128) throw invalid();
  const seen = new Set<string>();
  return value.map((row: any) => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !text(row.externalGroup, 1024)
        || !text(row.groupId, 128) || seen.has(row.externalGroup)) throw invalid();
    seen.add(row.externalGroup);
    return { externalGroup: row.externalGroup, groupId: row.groupId };
  });
};

export function validateProvider(type: string, config: any, secretRef: string) {
  if (!secretPattern.test(secretRef) || !config || typeof config !== 'object' || Array.isArray(config)) throw invalid();
  const provisioning = config.provisioning;
  const defaultRole = config.defaultRole;
  if (!['DISABLED', 'AUTO'].includes(provisioning) || !['developer', 'approver'].includes(defaultRole)) throw invalid();
  const groupMappings = mappingList(config.groupMappings ?? []);
  if (type === 'LDAP') {
    const url = httpsUrl(config.url, true);
    const startTLS = config.startTLS === true;
    if (!url || !['ldap:', 'ldaps:'].includes(url.protocol) || !['', '/'].includes(url.pathname) || (url.protocol === 'ldap:' && !startTLS) || (url.protocol === 'ldaps:' && startTLS)
        || !validDn(config.bindDN) || !validDn(config.baseDN) || !text(config.userFilter, 1024)
        || (config.userFilter.match(/\{\{username\}\}/g) ?? []).length !== 1) throw invalid();
    const usernameAttribute = config.usernameAttribute ?? 'uid';
    const groupAttribute = config.groupAttribute ?? 'memberOf';
    if (![usernameAttribute, groupAttribute].every(v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(v))) throw invalid();
    return { type, url: url.href, startTLS, bindDN: config.bindDN, baseDN: config.baseDN,
      userFilter: config.userFilter, usernameAttribute, groupAttribute, provisioning, defaultRole,
      groupMappings, secretRef };
  }
  if (type === 'OIDC') {
    const issuer = httpsUrl(config.issuer), redirectUri = httpsUrl(config.redirectUri);
    const groupsClaim = config.groupsClaim ?? 'groups';
    if (!issuer || !redirectUri || !/^\/api\/auth\/oidc\/[A-Za-z0-9_-]{1,64}\/callback$/.test(redirectUri.pathname)
        || !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(groupsClaim) || !text(config.clientId, 256)) throw invalid();
    return { type, issuer: issuer.href.replace(/\/$/, ''), clientId: config.clientId,
      redirectUri: redirectUri.href, groupsClaim, provisioning, defaultRole, groupMappings, secretRef };
  }
  throw invalid();
}

export async function loadProviderSecret(provider: any, root: string) {
  if (!provider || !secretPattern.test(provider.secretRef) || !text(root, 4096)) throw invalid();
  const name = provider.secretRef.slice('secret://'.length);
  if (!/^[a-z0-9.-]+$/.test(name)) throw invalid();
  try { return (await readContainerSecret(root, name, 16 * 1024)).toString('utf8').trim(); }
  catch { throw invalid(); }
}

const ldapEscape = (value: string) => value.replace(/[\\*()\u0000]/g, char => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`);
const ldapClient = (config: any) => new Client({ url: config.url, timeout: 5000, connectTimeout: 5000,
  tlsOptions: { rejectUnauthorized: true, minVersion: 'TLSv1.2' } });
const closeLdap = async (client: any) => { try { await client.unbind(); } catch { /* connection may not have bound */ } };
const entryAttribute = (entry: any, key: string) => {
  const item = Object.keys(entry).find(name => name.toLowerCase() === key.toLowerCase());
  const value = item ? entry[item] : undefined;
  return Array.isArray(value) && value.length === 1 ? value[0] : value;
};
const stringAttribute = (value: any) => Buffer.isBuffer(value) ? value.toString('utf8') : value;

export async function ldapIdentity(config: any, secret: string, password: string, username: string) {
  if (config?.type !== 'LDAP' || !text(secret, 4096) || typeof password !== 'string' || password.length === 0
      || password.length > 4096 || !text(username, 256)) throw invalid();
  let client: any;
  try {
    client = ldapClient(config);
    if (config.startTLS) await client.startTLS({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    await client.bind(config.bindDN, secret);
    const filter = config.userFilter.replace('{{username}}', ldapEscape(username));
    const result = await client.search(config.baseDN, { scope: 'sub', filter, sizeLimit: 2, timeLimit: 5,
      attributes: ['entryUUID', 'objectGUID', 'distinguishedName', config.usernameAttribute, 'displayName', 'cn', config.groupAttribute] });
    if (result.searchEntries?.length !== 1) throw invalid();
    const entry = result.searchEntries[0];
    const dn = stringAttribute(entryAttribute(entry, 'dn') ?? entryAttribute(entry, 'distinguishedName'));
    if (!text(dn, 2048)) throw invalid();
    await client.bind(dn, password);
    const subjectRaw = entryAttribute(entry, 'entryUUID') ?? entryAttribute(entry, 'objectGUID');
    const subject = Buffer.isBuffer(subjectRaw) ? subjectRaw.toString('hex') : subjectRaw;
    const canonicalUsername = stringAttribute(entryAttribute(entry, config.usernameAttribute));
    const name = stringAttribute(entryAttribute(entry, 'displayName') ?? entryAttribute(entry, 'cn') ?? canonicalUsername);
    if (!text(subject, 512) || !text(canonicalUsername, 256) || !text(name, 256)) throw invalid();
    return { subject: `ldap:${subject}`, username: canonicalUsername, name,
      groups: groupValues(entryAttribute(entry, config.groupAttribute)).map(stringAttribute).filter((item: unknown): item is string => typeof item === 'string') };
  } catch { throw Object.assign(new Error('Identity provider authentication failed'), { productCode: 'UNAUTHENTICATED' }); }
  finally { if (client) await closeLdap(client); }
}

const oidcConfiguration = async (provider: any, secret: string) => {
  if (provider?.type !== 'OIDC' || !text(secret, 4096)) throw invalid();
  const issuer = new URL(provider.issuer);
  return oidc.discovery(issuer, provider.clientId, secret, oidc.ClientSecretBasic(secret), { timeout: 5 });
};

export async function testProvider(provider: any, secret: string) {
  try {
    if (provider?.type === 'LDAP') {
      const client = ldapClient(provider);
      try {
        if (provider.startTLS) await client.startTLS({ rejectUnauthorized: true, minVersion: 'TLSv1.2' });
        await client.bind(provider.bindDN, secret);
        await client.search(provider.baseDN, { scope: 'base', filter: '(objectClass=*)', sizeLimit: 1, timeLimit: 5, attributes: ['1.1'] });
      } finally { await closeLdap(client); }
    } else if (provider?.type === 'OIDC') await oidcConfiguration(provider, secret);
    else throw invalid();
    return { ok: true };
  } catch { return { ok: false, error: 'PROVIDER_UNAVAILABLE' }; }
}

export async function oidcStart(provider: any, secret: string) {
  const configuration = await oidcConfiguration(provider, secret);
  const verifier = oidc.randomPKCECodeVerifier();
  const nonce = oidc.randomNonce();
  const state = oidc.randomState();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const url = oidc.buildAuthorizationUrl(configuration, { redirect_uri: provider.redirectUri,
    scope: 'openid profile', code_challenge: challenge, code_challenge_method: 'S256', nonce, state });
  return { url: url.href, verifier, nonce, state };
}

export async function oidcFinish(provider: any, secret: string, currentUrl: string, expected: { verifier: string; nonce: string; state: string }) {
  try {
    const configuration = await oidcConfiguration(provider, secret);
    const tokens = await oidc.authorizationCodeGrant(configuration, new URL(currentUrl), {
      pkceCodeVerifier: expected.verifier, expectedNonce: expected.nonce,
      expectedState: expected.state, idTokenExpected: true,
    }, { redirect_uri: provider.redirectUri });
    const claims: any = tokens.claims();
    if (!claims || claims.iss !== provider.issuer || !text(claims.sub, 512)) throw invalid();
    const username = claims.preferred_username ?? claims.name;
    const name = claims.name ?? username;
    if (!text(username, 256) || !text(name, 256)) throw invalid();
    return { subject: `oidc:${claims.iss}:${claims.sub}`, username, name, groups: groupValues(claims[provider.groupsClaim]) };
  } catch { throw Object.assign(new Error('Identity provider authentication failed'), { productCode: 'UNAUTHENTICATED' }); }
}
