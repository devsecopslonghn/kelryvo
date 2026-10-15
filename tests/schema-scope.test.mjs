import test from 'node:test';
import assert from 'node:assert/strict';
import { assessOracleSchemaScope } from '../packages/execution/schema-scope.mjs';

const yes = sql => {
  const result = assessOracleSchemaScope(sql, 'APP');
  assert.equal(result.eligible, true, sql);
  assert.equal(result.code, 'SCHEMA_SQL_ALLOWED');
  return result;
};
const no = sql => assert.equal(assessOracleSchemaScope(sql, 'APP').eligible, false, sql);

test('allows only bounded local table, scalar add-column, and index DDL', () => {
  yes('CREATE TABLE orders (id NUMBER NOT NULL, label VARCHAR2(40 CHAR), created DATE DEFAULT NULL)');
  yes('CREATE TABLE APP.orders (id NUMBER(10, 0), amount NUMBER(9,2) DEFAULT -1.25, note CHAR(8 BYTE))');
  yes('ALTER TABLE orders ADD (label VARCHAR2(40), changed_at TIMESTAMP(6) NOT NULL)');
  yes('ALTER TABLE APP.orders ADD active NUMBER DEFAULT 1');
  yes('CREATE UNIQUE INDEX APP.orders_by_id ON APP.orders (id, label)');
  yes('CREATE INDEX "APP"."IX" ON "APP"."Table" ("MixedCase")');
});

test('returns exact physical target and existing-table identities for worker metadata checks', () => {
  assert.deepEqual(yes('CREATE TABLE orders (id NUMBER)').target,
    { owner: 'APP', name: 'ORDERS', objectType: 'TABLE', operation: 'CREATE' });
  const alter = yes('ALTER TABLE APP.orders ADD label VARCHAR2(40)');
  assert.deepEqual(alter.target, { owner: 'APP', name: 'ORDERS', objectType: 'TABLE', operation: 'ALTER' });
  assert.deepEqual(alter.existingTable, { owner: 'APP', name: 'ORDERS' });
  const index = yes('CREATE INDEX ix ON orders (id)');
  assert.deepEqual(index.target, { owner: 'APP', name: 'IX', objectType: 'INDEX', operation: 'CREATE' });
  assert.deepEqual(index.existingTable, { owner: 'APP', name: 'ORDERS' });
  assert.equal(Object.hasOwn(index.existingTable, 'synonym'), false,
    'worker must query exact-owner ALL_OBJECTS for object_type TABLE and never resolve a synonym');
  const synonymName = yes('CREATE INDEX local_ix ON app_local_synonym (id)');
  assert.deepEqual(synonymName.existingTable, { owner: 'APP', name: 'APP_LOCAL_SYNONYM' },
    'the worker checks this exact owner/name for OBJECT_TYPE=TABLE; it must not follow any synonym target');
  no('CREATE INDEX local_ix ON EVIL.app_local_synonym (id)');
});

test('rejects foreign owners, case-confused quoted owners, and database links', () => {
  no('CREATE TABLE EVIL.orders (id NUMBER)');
  no('ALTER TABLE EVIL.orders ADD x NUMBER');
  no('CREATE INDEX APP.ix ON EVIL.orders (id)');
  no('CREATE TABLE "App".orders (id NUMBER)');
  no('CREATE TABLE APP.orders@remote (id NUMBER)');
  no('CREATE INDEX ix ON orders@remote (id)');
});

test('rejects dynamic, procedural, administrative, and unsupported DDL', () => {
  for (const sql of [
    "BEGIN EXECUTE IMMEDIATE 'CREATE TABLE APP.x (id NUMBER)'; END;",
    'DECLARE x NUMBER; BEGIN NULL; END;',
    'CREATE OR REPLACE TRIGGER APP.trg BEFORE INSERT ON APP.t BEGIN NULL; END;',
    'CREATE SYNONYM APP.x FOR EVIL.t',
    'CREATE TABLE APP.x AS SELECT * FROM APP.y',
    'CREATE TABLE APP.x (id NUMBER DEFAULT SYS_CONTEXT(\'USERENV\',\'CURRENT_SCHEMA\'))',
    'GRANT DBA TO APP',
    'ALTER SESSION SET CURRENT_SCHEMA = EVIL',
    'CREATE SEQUENCE APP.s',
    'CREATE UNIQUE TABLE APP.x (id NUMBER)',
  ]) no(sql);
});

test('rejects SQL lexical ambiguity, malformed grammar, and statement chaining', () => {
  for (const sql of [
    'CREATE TABLE APP.x (id NUMBER); DROP TABLE APP.y',
    'CREATE TABLE APP.x (id NUMBER /* unterminated)',
    'CREATE TABLE APP.x (id NUMBER,)',
    'CREATE TABLE APP.x (id NUMBER(2,))',
    'CREATE TABLE APP.x (id NUMBER DEFAULT 1 + 2)',
    'CREATE TABLE APP.x (id NUMBER, id NUMBER)',
    'CREATE TABLE APP.x (id BLOB)',
  ]) no(sql);
  yes('-- leading comment with CREATE TABLE EVIL.fake (id NUMBER)\nCREATE /* keyword is not changed */ TABLE APP.x (id NUMBER) -- tail ; ALTER TABLE EVIL.x ADD y NUMBER');
  yes('CREATE TABLE APP.x (id VARCHAR2(20) DEFAULT \'/* literal -- stays data; */\') /* tail comment */');
  no('CREATE TABLE APP.x (id NUMBER /* unterminated)');
  no("'CREATE' TABLE APP.x (id NUMBER)");
  no('CREATE "TABLE" APP.x (id NUMBER)');
  no('CREATE TABLE APP.x ("id" NUMBER DEFAULT "NULL")');
  assert.equal(assessOracleSchemaScope('CREATE TABLE x (id NUMBER)', '').code, 'SCHEMA_OWNER_INVALID');
});

test('rejects protected, common, empty, and malformed schema owners', () => {
  for (const owner of ['SYS', 'system', 'AUDSYS', 'C##APPLICATION', 'ORA$BASE', '', 'APP\n', '\ud800']) {
    assert.equal(assessOracleSchemaScope('CREATE TABLE x (id NUMBER)', owner).code, 'SCHEMA_OWNER_INVALID', owner);
  }
});
