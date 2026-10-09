import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeOfflinePlanIntent, verifyOfflinePlanIntent } from '../packages/migrations/offline-plan-intent.mjs';

const base = {
  organizationId: '00000000-0000-4000-8000-000000000001', projectId: '00000000-0000-4000-8000-000000000002',
  requesterId: 'developer-a', releaseId: '00000000-0000-4000-8000-000000000003', commit: 'a'.repeat(40), objectFormat: 'sha1',
  folder: 'migrations', parserProfile: 'antlr-pinned-v1', manifestDigest: 'b'.repeat(64),
  profileId: '00000000-0000-4000-8000-000000000004', profileName: 'Development',
  environmentId: '00000000-0000-4000-8000-000000000005', environmentName: 'Local', engine: 'oracle', host: 'db.example.invalid',
  port: 1521, service: 'FREEPDB1', username: 'APP', credentialRef: 'vault://local/app',
  items: [{ path: 'migrations/V1__first.sql', version: '1', sha256: 'c'.repeat(64) }],
};

test('format 1 is stable, binds ordered content and validates bounded facts', () => {
  const encoded = encodeOfflinePlanIntent(base);
  assert.ok(encoded);
  assert.equal(encoded.digest, 'ef96dba1977b14ff65efa9aed33f083b8152c8a2d30bbc7cd8a5aae9cb6c7b30');
  assert.equal(encoded.envelope, '[1,"00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002","developer-a","00000000-0000-4000-8000-000000000003","aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","sha1","migrations","antlr-pinned-v1","bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","00000000-0000-4000-8000-000000000004","Development","00000000-0000-4000-8000-000000000005","Local","oracle","db.example.invalid",1521,"FREEPDB1","APP","vault://local/app",[["migrations/V1__first.sql","1","cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"]]]');
  assert.equal(encodeOfflinePlanIntent({ ...base }).envelope, encoded.envelope);
  assert.equal(encodeOfflinePlanIntent(Object.fromEntries(Object.entries(base).reverse())).digest, encoded.digest,
    'input object property order does not affect the fixed positional serialization');
  assert.match(encoded.envelope, /^\[1,/);
  assert.equal(verifyOfflinePlanIntent(encoded.envelope, encoded.digest).items[0].path, base.items[0].path);
  assert.equal(verifyOfflinePlanIntent(encoded.envelope, '0'.repeat(64)), null);
  assert.equal(verifyOfflinePlanIntent(encoded.envelope, encoded.digest, { organizationId: base.projectId }), null);
  assert.equal(verifyOfflinePlanIntent(encoded.envelope, encoded.digest, { projectId: base.organizationId }), null);
  assert.notEqual(encodeOfflinePlanIntent({ ...base, host: 'other.example.invalid' }).digest, encoded.digest);
  assert.notEqual(encodeOfflinePlanIntent({ ...base, items: [{ ...base.items[0], sha256: 'd'.repeat(64) }] }).digest, encoded.digest);
  const second = { path: 'migrations/V2__second.sql', version: '2', sha256: 'd'.repeat(64) };
  assert.notEqual(encodeOfflinePlanIntent({ ...base, items: [...base.items, second] }).digest,
    encodeOfflinePlanIntent({ ...base, items: [second, ...base.items] }).digest, 'item order is part of the digest');
  const quotedPath = 'migrations/naïve "name".sql';
  const quotedEnvelope = encodeOfflinePlanIntent({ ...base, items: [{ ...base.items[0], path: quotedPath } ] }).envelope;
  assert.ok(quotedEnvelope.includes('\\"name\\"'));
  assert.equal(JSON.parse(quotedEnvelope)[20][0][0], quotedPath, 'UTF-8 text and JSON quote escaping are retained');
  assert.equal(encodeOfflinePlanIntent({ ...base, credentialRef: 'plaintext-secret' }), null);
  assert.equal(encodeOfflinePlanIntent({ ...base, port: 65536 }), null);
  assert.equal(encodeOfflinePlanIntent({ ...base, items: [{ ...base.items[0], path: `migrations/${'x'.repeat(900_000)}.sql` }] }), null);
  assert.equal(encodeOfflinePlanIntent({ ...base, items: [{ ...base.items[0], path: 'bad\npath' }] }), null);
  assert.equal(verifyOfflinePlanIntent(`${encoded.envelope} `, encoded.digest), null);
});
