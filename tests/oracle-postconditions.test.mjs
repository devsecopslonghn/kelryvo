import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileOraclePostconditions } from '../packages/execution/oracle-postconditions.mjs';
import { assessOracleSchemaScope, describeOracleSchemaScope } from '../packages/execution/schema-scope.mjs';

const materialize = files => {
  const statements = [];
  const migrations = files.map((sql, i) => ({ version: String(i + 1), statementDigests: sql.map(text => {
    const bytes = Buffer.from(text), digest = createHash('sha256').update(bytes).digest('hex');
    statements.push({ bytes, digest }); return digest;
  }) }));
  return { migrations, statements };
};
test('postconditions derive each version from unchanged parser-delimited execution bytes', () => {
  const create = 'CREATE TABLE ITEM (ID NUMBER NOT NULL, AMOUNT NUMBER(9,2) DEFAULT -1.25)';
  const m = materialize([[create], ["ALTER TABLE ITEM ADD (CODE VARCHAR2(64 BYTE) DEFAULT 'it''s')",
    'CREATE UNIQUE INDEX ITEM_CODE_I ON ITEM(CODE)']]);
  const result = compileOraclePostconditions(m, 'APP');
  assert.ok(result);
  assert.equal(result.byVersion['1'][0].columns.length, 2);
  assert.equal(result.byVersion['2'][0].columns.length, 3);
  assert.deepEqual(result.final[0].indexes, [{ name: 'ITEM_CODE_I', uniqueness: 'UNIQUE', columns: ['CODE'] }]);
  assert.deepEqual(result.final[0].columns[2], { name: 'CODE', dataType: 'VARCHAR2', nullable: 'Y',
    dataPrecision: null, dataScale: null, defaultExpression: "'it''s'", dataLength: 64, charLength: 64, charUsed: 'B' });
  const described = describeOracleSchemaScope(create, 'APP');
  const { description, ...scoped } = described;
  assert.deepEqual(scoped, assessOracleSchemaScope(create, 'APP'));
});

test('unsupported scope, unqualified projections and digest changes decline without writer SQL', () => {
  for (const sql of ['CREATE TABLE OTHER.ITEM(ID NUMBER)', 'CREATE TABLE ITEM AS SELECT 1 FROM SYS.DUAL',
    'CREATE TABLE ITEM(ID DATE)', 'CREATE TABLE ITEM(ID VARCHAR2(8 CHAR))', 'CREATE TABLE "Item"(ID NUMBER)',
    'CREATE TABLE ITEM(ID NUMBER(0))', 'ALTER TABLE ITEM ADD ID NUMBER', 'CREATE INDEX I ON ITEM(ID)']) {
    assert.equal(compileOraclePostconditions(materialize([[sql]]), 'APP'), null, sql);
  }
  const m = materialize([['CREATE TABLE ITEM(ID NUMBER)']]);
  m.statements[0].bytes = Buffer.from('CREATE TABLE OTHER(ID NUMBER)');
  assert.equal(compileOraclePostconditions(m, 'APP'), null);
});
