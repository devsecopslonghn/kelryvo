import test from 'node:test';
import assert from 'node:assert/strict';
import { REVIEW_PROFILE, reviewSqlStatements } from '../packages/sql-validation/review.mjs';

const review = (sourceSql, exactOwner = 'APP', engine = 'oracle') => reviewSqlStatements([{ ordinal: 1, path: 'V1.sql', sourceSql }], exactOwner, engine)[0];

test('recognizes basic statements and preserves exact quoted owner boundaries', () => {
  const cross = review('SELECT * FROM "App".orders');
  assert.equal(cross.classification, 'SELECT');
  assert.equal(cross.schemaCheck, 'MISMATCH');
  assert.deepEqual(cross.references, [{ owner: 'App', name: 'ORDERS', role: 'READ' }]);
  assert.equal(cross.findings[0].severity, 'BLOCKING');
  const local = review('CREATE TABLE orders (id NUMBER)');
  assert.equal(local.classification, 'CREATE_TABLE');
  assert.equal(local.schemaCheck, 'MATCH');
  assert.deepEqual(local.references, [{ owner: 'APP', name: 'ORDERS', role: 'TARGET' }]);
  assert.equal('sourceSql' in local, false);
});

test('comments, ordinary literals, and Oracle q quotes cannot inject references', () => {
  const result = review(`SELECT 'FROM EVIL.SECRET', q'[ JOIN BAD.T ]' FROM good -- JOIN COMMENT.T\n /* FROM HIDDEN.X */`);
  assert.equal(result.schemaCheck, 'MATCH');
  assert.deepEqual(result.references, [{ owner: 'APP', name: 'GOOD', role: 'READ' }]);
});

test('reviews comma sources, nested sources, and blocks database links', () => {
  const comma = review('SELECT * FROM APP.ONE, APP.TWO');
  assert.equal(comma.schemaCheck, 'MATCH');
  assert.deepEqual(comma.references.map(({ owner, name }) => [owner, name]), [['APP', 'ONE'], ['APP', 'TWO']]);
  const crossComma = review('SELECT * FROM APP.ONE, EVIL.SECRET');
  assert.equal(crossComma.schemaCheck, 'MISMATCH');
  assert.ok(crossComma.findings.some((finding) => finding.code === 'CROSS_SCHEMA_REFERENCE' && finding.severity === 'BLOCKING'));
  const nested = review('SELECT * FROM APP.ONE, (SELECT * FROM EVIL.SECRET) S');
  assert.equal(nested.schemaCheck, 'MISMATCH');
  assert.ok(nested.references.some((ref) => ref.name === 'SECRET'));
  const remote = review('SELECT * FROM APP.ORDERS@REMOTE_LINK');
  assert.equal(remote.schemaCheck, 'UNVERIFIED');
  assert.ok(remote.findings.some((finding) => finding.code === 'DATABASE_LINK_REFERENCE' && finding.severity === 'BLOCKING'));
  const atLiteral = review("SELECT '@' FROM APP.T");
  assert.equal(atLiteral.schemaCheck, 'MATCH');
  assert.ok(!atLiteral.findings.some((finding) => finding.code === 'DATABASE_LINK_REFERENCE'));
});

test('keyword lookalikes in quoted identifiers do not affect parsing or restrictions', () => {
  const query = review('SELECT "FROM", "WHERE" FROM APP.T');
  assert.equal(query.schemaCheck, 'MATCH');
  const update = review('UPDATE APP.T SET C = (SELECT C FROM APP.X WHERE C=1)');
  assert.ok(update.findings.some((finding) => finding.code === 'UNRESTRICTED_DML' && finding.severity === 'HIGH'));
  assert.equal(update.schemaCheck, 'MATCH');
});

test('index base table is checked and ambiguous or source-less forms remain unverified', () => {
  const index = review('CREATE INDEX APP.I ON EVIL.T (C)');
  assert.equal(index.schemaCheck, 'MISMATCH');
  assert.ok(index.references.some((ref) => ref.name === 'T' && ref.owner === 'EVIL'));
  assert.equal(review('SELECT 1').schemaCheck, 'UNVERIFIED');
  assert.equal(review('WITH X AS (SELECT * FROM APP.T) SELECT * FROM X').schemaCheck, 'UNVERIFIED');
});

test('qualified function and package calls remain unverified dependencies', () => {
  for (const sql of ['SELECT EVIL.FUNC() FROM APP.T', 'SELECT EVIL.PKG.FUNC() FROM APP.T']) {
    const result = review(sql);
    assert.equal(result.schemaCheck, 'UNVERIFIED');
    assert.ok(result.findings.some((finding) => finding.code === 'QUALIFIED_CALL_UNVERIFIED' && finding.severity === 'UNKNOWN'));
  }
});

test('DELETE target is read immediately after DELETE with optional FROM', () => {
  for (const prefix of ['DELETE EVIL.T', 'DELETE FROM EVIL.T']) {
    const result = review(`${prefix} WHERE EXISTS (SELECT 1 FROM APP.X)`);
    assert.equal(result.schemaCheck, 'MISMATCH');
    assert.ok(result.references.some((ref) => ref.name === 'T' && ref.owner === 'EVIL' && ref.role === 'WRITE'));
    assert.ok(result.references.some((ref) => ref.name === 'X' && ref.owner === 'APP' && ref.role === 'READ'));
  }
});

test('callable collection table factors do not become fictitious tables', () => {
  const result = review('SELECT * FROM TABLE(EVIL.COLLECTION_VAR) C');
  assert.equal(result.schemaCheck, 'UNVERIFIED');
  assert.equal(result.references.length, 0);
  assert.ok(result.findings.some((finding) => finding.code === 'REFERENCE_UNVERIFIED' && finding.severity === 'UNKNOWN'));
});

test('reports destructive DDL and unrestricted writes', () => {
  assert.ok(review('DROP TABLE users').findings.some((finding) => finding.code === 'DESTRUCTIVE_DDL' && finding.severity === 'HIGH'));
  assert.ok(review('UPDATE users SET active = 0').findings.some((finding) => finding.code === 'UNRESTRICTED_DML' && finding.severity === 'HIGH'));
  assert.ok(review('DELETE FROM users').findings.some((finding) => finding.code === 'UNRESTRICTED_DML' && finding.severity === 'HIGH'));
});

test('unsupported procedural, dynamic, administrative, and non-Oracle inputs fail closed', () => {
  const procedural = review("BEGIN EXECUTE IMMEDIATE 'DROP TABLE x'; END;");
  assert.equal(procedural.schemaCheck, 'UNVERIFIED');
  assert.ok(procedural.findings.some((finding) => finding.severity === 'UNKNOWN'));
  assert.equal(review('GRANT DBA TO someone').findings[0].severity, 'BLOCKING');
  assert.equal(review('SELECT 1 FROM t', 'APP', 'postgres').findings[0].code, 'UNSUPPORTED_ENGINE');
});

test('bounds huge inputs and token streams', () => {
  const tooLong = review(' '.repeat(REVIEW_PROFILE.maxSourceChars + 1));
  assert.equal(tooLong.schemaCheck, 'UNVERIFIED');
  assert.ok(tooLong.findings.some((finding) => finding.code === 'REVIEW_LIMIT'));
  const manyTokens = review(`SELECT ${'x,'.repeat(REVIEW_PROFILE.maxTokens + 1)} x FROM t`);
  assert.equal(manyTokens.schemaCheck, 'UNVERIFIED');
  assert.ok(manyTokens.findings.some((finding) => finding.code === 'TOKENIZATION_UNVERIFIED'));
  assert.throws(() => reviewSqlStatements(Array.from({ length: REVIEW_PROFILE.maxBatchStatements + 1 }, () => ({})), 'APP'), RangeError);
});
