import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { sealOracleCredential, openOracleCredential, validOraclePassword } from '../packages/connectivity/credential-vault.mjs';

const pair = () => generateKeyPairSync('rsa', { modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const keys = pair();
const context = () => ({ organizationId: randomUUID(), connectionId: randomUUID(), credentialId: randomUUID(),
  username: 'MIGRATION_MASTER', purpose: 'INSTANCE_MASTER', endpointDigest: 'e'.repeat(64) });

test('vault seals with only a public key and authenticates the complete credential scope', () => {
  const c = context(), password = 'vault-canary-with-spaces & unicode-đ';
  const sealed = sealOracleCredential(password, c, keys.publicKey);
  assert.equal(openOracleCredential(sealed, c, keys.privateKey), password);
  assert.ok(!JSON.stringify(sealed).includes(password));
  assert.notDeepEqual(sealed, sealOracleCredential(password, c, keys.publicKey));
  for (const field of ['organizationId', 'connectionId', 'credentialId']) {
    assert.throws(() => openOracleCredential(sealed, { ...c, [field]: randomUUID() }, keys.privateKey));
  }
  for (const change of [{ username: 'OTHER' }, { purpose: 'DEPLOY' }, { endpointDigest: 'f'.repeat(64) }]) {
    assert.throws(() => openOracleCredential(sealed, { ...c, ...change }, keys.privateKey));
  }
  assert.throws(() => openOracleCredential(sealed, c, keys.publicKey));
  assert.throws(() => openOracleCredential(sealed, c, pair().privateKey));
});

test('vault rejects tampering, weak keys, malformed encoding and password control characters', () => {
  const c = context(), sealed = sealOracleCredential('fixture-canary', c, keys.publicKey);
  for (const field of ['wrappedKey', 'nonce', 'tag', 'ciphertext']) {
    const bytes = Buffer.from(sealed[field], 'base64'); bytes[0] ^= 1;
    assert.throws(() => openOracleCredential({ ...sealed, [field]: bytes.toString('base64') }, c, keys.privateKey));
    assert.throws(() => openOracleCredential({ ...sealed, [field]: 'not-base64!' }, c, keys.privateKey));
  }
  assert.throws(() => openOracleCredential({ ...sealed, keyId: '0'.repeat(64) }, c, keys.privateKey));
  assert.throws(() => openOracleCredential({ ...sealed, extra: true }, c, keys.privateKey));
  const weak = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  assert.throws(() => sealOracleCredential('fixture', c, weak.publicKey));
  assert.throws(() => sealOracleCredential('fixture', c, keys.privateKey));
  for (const value of ['', 'a\nb', 'a\rb', 'a\0b', 'x'.repeat(4097), '\ud800']) {
    assert.equal(validOraclePassword(value), false);
    assert.throws(() => sealOracleCredential(value, c, keys.publicKey));
  }
});
