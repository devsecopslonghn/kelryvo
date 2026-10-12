import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
const target = {
  bindingId: '10000000-0000-4000-8000-000000000001', bindingRevision: '1',
  assignmentId: '10000000-0000-4000-8000-000000000002', assignmentRevision: '3',
  targetOptionId: '10000000-0000-4000-8000-000000000003', targetOptionRevision: '2',
  lineageId: '10000000-0000-4000-8000-000000000004', identityState: 'PROVISIONAL', observationDigest: null,
  streamId: '10000000-0000-4000-8000-000000000005', streamState: 'PROVISIONAL', migrationNamespace: 'APP_MIGRATIONS',
  exactOwner: 'APP', routeId: '10000000-0000-4000-8000-000000000006', routeConfigRevision: '1', routeAlias: 'local-db',
  policyId: '10000000-0000-4000-8000-000000000007', policyRevision: '4',
  deploymentPrincipalId: '10000000-0000-4000-8000-000000000008', principalPurpose: 'DEPLOY',
  privatePrincipalRef: 'vault://local/deploy', principalAlias: 'local-deploy',
  createdAt: '2026-10-12T05:00:00.000Z', sourceBindingGeneration: '5',
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

test('format 2 binds the complete ordered statement identities and keeps format 1 exact', () => {
  const statements = [{ ordinal: 1, path: base.items[0].path, fileOrdinal: 1, startByte: 0, endByte: 10,
    sourceSha256: 'd'.repeat(64), executionSha256: 'e'.repeat(64) },
    { ordinal: 2, path: base.items[0].path, fileOrdinal: 2, startByte: 11, endByte: 30,
      sourceSha256: 'f'.repeat(64), executionSha256: '1'.repeat(64) }];
  const encoded = encodeOfflinePlanIntent({ ...base, statements });
  assert.ok(encoded);
  assert.equal(encoded.digest, 'ab45c401a6640929088872742d2761a4c59e255bc91e85cdf9af477ed14a51db',
    'format 2 retains its original canonical bytes');
  assert.match(encoded.envelope, /^\[2,/);
  assert.equal(JSON.parse(encoded.envelope).length, 22);
  assert.deepEqual(verifyOfflinePlanIntent(encoded.envelope, encoded.digest).statements, statements);
  assert.equal(verifyOfflinePlanIntent(encoded.envelope, encoded.digest).format, 2);
  assert.notEqual(encoded.digest, encodeOfflinePlanIntent(base).digest);
  assert.notEqual(encodeOfflinePlanIntent({ ...base, statements: statements.map(s => ({ ...s, executionSha256: '2'.repeat(64) })) }).digest, encoded.digest);
  for (const mutate of [
    s => s.reverse(), s => { s[1].ordinal = 3; }, s => { s[1].fileOrdinal = 1; },
    s => { s[1].startByte = 9; }, s => { s[1].endByte = 2 ** 21 + 1; },
    s => { s[0].path = 'migrations/V2__other.sql'; }, s => { s[0].executionSha256 = 'bad'; },
  ]) {
    const broken = structuredClone(statements); mutate(broken);
    assert.equal(encodeOfflinePlanIntent({ ...base, statements: broken }), null);
  }
  assert.equal(encodeOfflinePlanIntent({ ...base, statements: [] }), null);
  assert.equal(encodeOfflinePlanIntent({ ...base, statements: Array(4097).fill(statements[0]) }), null);
  const second = { path: 'migrations/V2__second.sql', version: '2', sha256: 'a'.repeat(64) };
  assert.equal(encodeOfflinePlanIntent({ ...base, items: [...base.items, second], statements }), null, 'no file may be omitted');
  const complete = [...statements, { ...statements[0], ordinal: 3, path: second.path }];
  assert.ok(encodeOfflinePlanIntent({ ...base, items: [...base.items, second], statements: complete }));
  const row = JSON.parse(encoded.envelope); row[21][0].push('unbound extra');
  const extra = JSON.stringify(row), digest = createHash('sha256').update(extra).digest('hex');
  assert.equal(verifyOfflinePlanIntent(extra, digest), null, 'unknown positional facts cannot escape the digest protocol');
});

test('format 3 appends the immutable target tuple and round-trips its named facts', () => {
  const statements = [{ ordinal: 1, path: base.items[0].path, fileOrdinal: 1, startByte: 0, endByte: 10,
    sourceSha256: 'd'.repeat(64), executionSha256: 'e'.repeat(64) }];
  const encoded = encodeOfflinePlanIntent({ ...base, statements, target });
  assert.ok(encoded);
  assert.equal(encoded.digest, '2978b72bcc71446247241bbcbf47ad7df6b2668ee1bdf8c8b9b053066b974c62');
  const row = JSON.parse(encoded.envelope);
  assert.equal(row[0], 3);
  assert.equal(row.length, 23);
  assert.deepEqual(row[21], [[1, base.items[0].path, 1, 0, 10, 'd'.repeat(64), 'e'.repeat(64)]]);
  assert.deepEqual(row[22], Object.values(target));
  const verified = verifyOfflinePlanIntent(encoded.envelope, encoded.digest);
  assert.equal(verified.format, 3);
  assert.deepEqual(verified.target, target);
  assert.deepEqual(verified.statements, statements);
  const separatePrincipal = encodeOfflinePlanIntent({ ...base, username: 'DEPLOYER', statements, target });
  assert.ok(separatePrincipal, 'the deployment connection user is independent of the SQL schema owner');
  const wrongCase = encodeOfflinePlanIntent({ ...base, statements, target: { ...target, exactOwner: 'app' } });
  assert.ok(wrongCase);
  assert.equal(verifyOfflinePlanIntent(wrongCase.envelope, wrongCase.digest, { target }), null,
    'case-sensitive owner substitution conflicts with the expected target facts');
  for (const owner of ['Mixed Owner', '客户 Owner', '"App Schema"']) {
    const literalOwner = encodeOfflinePlanIntent({ ...base, statements, target: { ...target, exactOwner: owner } });
    assert.ok(literalOwner, `literal catalog owner ${owner} is retained`);
    assert.equal(verifyOfflinePlanIntent(literalOwner.envelope, literalOwner.digest, {
      target: { ...target, exactOwner: owner },
    }).target.exactOwner, owner);
  }
  assert.equal(verifyOfflinePlanIntent(encoded.envelope, '0'.repeat(64)), null);
});

test('format 3 rejects malformed target tuples, out-of-range revisions and tampering', () => {
  const statements = [{ ordinal: 1, path: base.items[0].path, fileOrdinal: 1, startByte: 0, endByte: 10,
    sourceSha256: 'd'.repeat(64), executionSha256: 'e'.repeat(64) }];
  const invalidTargets = [
    { ...target, bindingRevision: '01' },
    { ...target, assignmentRevision: '9223372036854775808' },
    { ...target, sourceBindingGeneration: '-1' },
    { ...target, bindingId: 'not-a-uuid' },
    { ...target, exactOwner: 'APP\ud800' },
    { ...target, exactOwner: '界'.repeat(43) },
    { ...target, exactOwner: ' ' },
    { ...target, routeAlias: 'r'.repeat(201) },
    { ...target, identityState: 'UNKNOWN' },
    { ...target, identityState: 'CONFLICT' },
    { ...target, observationDigest: 'a'.repeat(64) },
    { ...target, streamState: 'UNKNOWN' },
    { ...target, principalPurpose: 'READ' },
    { ...target, privatePrincipalRef: `vault://${'x'.repeat(510)}` },
    { ...target, createdAt: '2026-10-12T05:00:00+00:00' },
    { ...target, createdAt: '2026-02-30T05:00:00.000Z' },
    { ...target, unexpected: 'field' },
  ];
  for (const badTarget of invalidTargets) assert.equal(encodeOfflinePlanIntent({ ...base, statements, target: badTarget }), null);
  assert.equal(encodeOfflinePlanIntent({ ...base, target }), null, 'format 3 requires format-2 statement facts');
  const encoded = encodeOfflinePlanIntent({ ...base, statements, target });
  const broken = JSON.parse(encoded.envelope);
  broken[22][1] = '01';
  const tampered = JSON.stringify(broken);
  const recomputedDigest = createHash('sha256').update(tampered).digest('hex');
  assert.equal(verifyOfflinePlanIntent(tampered, recomputedDigest), null, 'invalid noncanonical tuple rejected even with matching digest');
  const oversized = JSON.stringify([...JSON.parse(encoded.envelope), 'x'.repeat(1024 * 1024)]);
  assert.equal(verifyOfflinePlanIntent(oversized, createHash('sha256').update(oversized).digest('hex')), null);
});
