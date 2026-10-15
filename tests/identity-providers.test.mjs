import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProvider, ldapIdentity, testProvider, oidcStart, oidcFinish } from '../packages/identity/providers.ts';

const ldap = { url: 'ldaps://directory.example.test:636', bindDN: 'cn=service,dc=example,dc=test',
  baseDN: 'ou=people,dc=example,dc=test', userFilter: '(uid={{username}})', provisioning: 'DISABLED',
  defaultRole: 'developer', groupMappings: [] };
const oidc = { issuer: 'https://id.example.test/realms/kelryvo', clientId: 'kelryvo',
  redirectUri: 'https://app.example.test/api/auth/oidc/main/callback', provisioning: 'AUTO',
  defaultRole: 'developer', groupMappings: [] };

test('LDAP provider config accepts secure transport and normalizes bounded defaults', () => {
  const result = validateProvider('LDAP', ldap, 'secret://ldap-bind');
  assert.equal(result.usernameAttribute, 'uid');
  assert.equal(result.groupAttribute, 'memberOf');
  assert.equal(result.startTLS, false);
  assert.equal(result.secretRef, 'secret://ldap-bind');
});

test('LDAP rejects plaintext, ambiguous filters, invalid group mapping and secret paths', () => {
  for (const [config, secret] of [
    [{ ...ldap, url: 'ldap://directory.example.test' }, 'secret://ldap-bind'],
    [{ ...ldap, userFilter: '(uid=*)' }, 'secret://ldap-bind'],
    [{ ...ldap, userFilter: '(uid={{username}})(cn={{username}})' }, 'secret://ldap-bind'],
    [{ ...ldap, groupMappings: [{ externalGroup: 'ops', groupId: 'a' }, { externalGroup: 'ops', groupId: 'b' }] }, 'secret://ldap-bind'],
    [ldap, 'secret://../outside'],
  ]) assert.throws(() => validateProvider('LDAP', config, secret), error => error.productCode === 'INVALID_REQUEST');
});

test('LDAP StartTLS is accepted only as an explicit secure transport', () => {
  assert.equal(validateProvider('LDAP', { ...ldap, url: 'ldap://directory.example.test', startTLS: true }, 'secret://ldap-bind').startTLS, true);
});

test('OIDC provider config requires HTTPS issuer and exact callback path', () => {
  const result = validateProvider('OIDC', oidc, 'secret://oidc-client');
  assert.equal(result.groupsClaim, 'groups');
  assert.equal(result.issuer, oidc.issuer);
  assert.throws(() => validateProvider('OIDC', { ...oidc, issuer: 'http://id.example.test' }, 'secret://oidc-client'),
    error => error.productCode === 'INVALID_REQUEST');
  assert.throws(() => validateProvider('OIDC', { ...oidc, redirectUri: 'https://app.example.test/callback' }, 'secret://oidc-client'),
    error => error.productCode === 'INVALID_REQUEST');
});

test('network provider failures are generic and do not expose supplied secrets', async () => {
  const secret = 'must-not-leak-this-secret';
  const result = await testProvider(validateProvider('OIDC', oidc, 'secret://oidc-client'), secret);
  assert.deepEqual(result, { ok: false, error: 'PROVIDER_UNAVAILABLE' });
  await assert.rejects(ldapIdentity(validateProvider('LDAP', ldap, 'secret://ldap-bind'), secret, '', 'alice'),
    error => error.productCode === 'INVALID_REQUEST' && !error.message.includes(secret));
  await assert.rejects(oidcStart(validateProvider('OIDC', oidc, 'secret://oidc-client'), secret),
    error => !error.message.includes(secret));
  await assert.rejects(oidcFinish(validateProvider('OIDC', oidc, 'secret://oidc-client'), secret,
    'https://app.example.test/api/auth/oidc/main/callback?error=denied', { verifier: 'x', nonce: 'x', state: 'x' }),
  error => error.productCode === 'UNAUTHENTICATED' && !error.message.includes(secret));
});
