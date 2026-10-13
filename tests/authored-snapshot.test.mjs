import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PROFILE } from '../experiments/db-devops-wp0/antlr-envelope.mjs';
import { AuthoredSnapshotError, prepareAuthoredSnapshot } from '../packages/migrations/authored-snapshot.mjs';
import { verifyRetainedRelease } from '../packages/migrations/verify-retained-release.mjs';

const snapshots = async draftId => (await readdir(tmpdir())).filter(name => name.startsWith(`kelryvo-authored-snapshot-${draftId}-`)).sort();
const digest = value => createHash('sha256').update(value).digest('hex');

test('authored snapshots use exact SQL bytes, fixed synthetic Git metadata, importer manifests, and cleanup', async () => {
  const draftId = randomUUID();
  const before = await snapshots(draftId);
  const sql = 'CREATE TABLE authored_snapshot (id NUMBER, label VARCHAR2(40));\n';
  const parsedInputs = [];
  const parse = async raw => {
    parsedInputs.push(Buffer.from(raw));
    return { ok: true, profile: PROFILE, kind: 'PARSE', statementCount: 1 };
  };
  const input = { folder: 'migrations/release', sql, draftId, revision: 7, parse };
  const first = await prepareAuthoredSnapshot(input);
  const second = await prepareAuthoredSnapshot(input);
  const filePath = 'migrations/release/V1__workspace.sql';
  const sqlDigest = digest(Buffer.from(sql, 'utf8'));
  assert.equal(first.draftId, draftId);
  assert.equal(first.draftRevision, 7);
  assert.equal(first.validationStatus, 'VALID');
  assert.equal(first.validationCode, 'PARSED_OFFLINE');
  assert.equal(first.commit, second.commit, 'fixed Git identity and dates make the same draft revision reproducible');
  assert.equal(first.folder, 'migrations/release');
  assert.equal(first.files.length, 1);
  assert.deepEqual(first.files[0], {
    path: filePath, version: '1', sha256: sqlDigest, bytes: Buffer.byteLength(sql), content: sql,
    statementCount: 1, validationStatus: 'VALID',
  });
  const manifest = { format: 1, commit: first.commit, objectFormat: first.objectFormat, folder: first.folder,
    parserProfile: first.parserProfile, files: [{ path: filePath, version: '1', sha256: sqlDigest, bytes: Buffer.byteLength(sql) }] };
  assert.equal(first.manifestDigest, digest(JSON.stringify(manifest)));
  assert.equal(parsedInputs.length, 2);
  assert.deepEqual(parsedInputs[0], Buffer.from(sql));
  assert.deepEqual(parsedInputs[1], Buffer.from(sql));
  assert.deepEqual(await snapshots(draftId), before, 'the isolated Git directories are removed after successful imports');
});

test('authored snapshot rejects malformed identity, folder, revision, and UTF-8 or oversized SQL before Git work', async () => {
  const draftId=randomUUID(),before=await snapshots(draftId);
  const valid = { folder: 'migrations', sql: 'CREATE TABLE t (id NUMBER);', draftId, revision: 1 };
  const invalid = [
    [{ ...valid, folder: '../migrations' }, 'INVALID_MIGRATION_FOLDER'],
    [{ ...valid, draftId: 'not-a-uuid' }, 'INVALID_DRAFT_REVISION'],
    [{ ...valid, revision: 0 }, 'INVALID_DRAFT_REVISION'],
    [{ ...valid, revision: Number.MAX_SAFE_INTEGER + 1 }, 'INVALID_DRAFT_REVISION'],
    [{ ...valid, sql: '' }, 'AUTHORED_SQL_SIZE_LIMIT'],
    [{ ...valid, sql: 'x'.repeat(1_048_577) }, 'AUTHORED_SQL_SIZE_LIMIT'],
    [{ ...valid, sql: '\ud800' }, 'INVALID_AUTHORED_SQL_UTF8'],
  ];
  for (const [input, code] of invalid) {
    await assert.rejects(prepareAuthoredSnapshot(input), error => error instanceof AuthoredSnapshotError && error.code === code);
  }
  assert.deepEqual(await snapshots(draftId), before, 'invalid inputs do not leave temporary repositories');
});

test('parser rejection is reported by the existing release importer and still cleans the snapshot', async () => {
  const draftId=randomUUID(),before=await snapshots(draftId);
  const result = await prepareAuthoredSnapshot({ folder: 'migrations', sql: 'not valid SQL', draftId, revision: 1,
    parse: async () => ({ ok: false, profile: PROFILE, kind: 'PARSE', code: 'fixture_rejected' }) });
  assert.equal(result.validationStatus, 'INVALID');
  assert.equal(result.validationCode, 'fixture_rejected');
  assert.deepEqual(await snapshots(draftId), before);
});

test('multi-file authored snapshots bind stable identity and publish in version order regardless of input order', async () => {
  const draftId=randomUUID(), firstId=randomUUID(), secondId=randomUUID();
  const snapshot=await prepareAuthoredSnapshot({folder:'migrations/release',draftId,revision:4,files:[
    {id:secondId,path:'V2__add_index.sql',sql:'CREATE INDEX authored_ix ON authored_table(id);\n'},
    {id:firstId,path:'V1__create_table.sql',sql:'CREATE TABLE authored_table (id NUMBER);\n'},
  ],parse:async()=>({ok:true,profile:PROFILE,kind:'PARSE',statementCount:1})});
  assert.equal(snapshot.manifestVersion,2);
  assert.deepEqual(snapshot.files.map(file=>({id:file.draftFileId,path:file.path,order:file.order,version:file.version})),[
    {id:firstId,path:'migrations/release/V1__create_table.sql',order:0,version:'1'},
    {id:secondId,path:'migrations/release/V2__add_index.sql',order:1,version:'2'},
  ]);
  const again=await prepareAuthoredSnapshot({folder:'migrations/release',draftId,revision:4,files:[
    {id:firstId,path:'V1__create_table.sql',sql:'CREATE TABLE authored_table (id NUMBER);\n'},
    {id:secondId,path:'V2__add_index.sql',sql:'CREATE INDEX authored_ix ON authored_table(id);\n'},
  ],parse:async()=>({ok:true,profile:PROFILE,kind:'PARSE',statementCount:1})});
  assert.equal(snapshot.commit,again.commit);
  assert.equal(snapshot.manifestDigest,again.manifestDigest);
  assert.equal(verifyRetainedRelease({commit_id:snapshot.commit,object_format:snapshot.objectFormat,folder:snapshot.folder,
    parser_profile:snapshot.parserProfile,manifest_digest:snapshot.manifestDigest,
    files:snapshot.files.map(file=>({...file,validationStatus:'VALID'}))}),true,'format-2 identity manifest verifies from retained immutable files');
});
