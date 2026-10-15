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

test('allows inline and composite named keys with exact quoted identities', () => {
  yes('CREATE TABLE widget (id NUMBER PRIMARY KEY, name VARCHAR2(100))');
  const result=yes('CREATE TABLE APP.orders (id NUMBER CONSTRAINT orders_nn NOT NULL, "Code" VARCHAR2(40) UNIQUE, tenant NUMBER, CONSTRAINT orders_pk PRIMARY KEY (tenant,id))');
  assert.deepEqual(result.constraints,[
    {type:'NOT_NULL',name:'ORDERS_NN',columns:['ID']},
    {type:'UNIQUE',name:null,columns:['Code']},
    {type:'PRIMARY_KEY',name:'ORDERS_PK',columns:['TENANT','ID']},
  ]);
  yes('CREATE TABLE orders (CONSTRAINT orders_pk PRIMARY KEY (id), id NUMBER, code VARCHAR2(10), UNIQUE (code,id))');
  yes('ALTER TABLE APP.orders ADD CONSTRAINT orders_pk PRIMARY KEY (id,tenant)');
  yes('ALTER TABLE "APP"."Table" ADD UNIQUE ("Code")');
  yes('ALTER TABLE orders ADD (code VARCHAR2(20) CONSTRAINT orders_uq UNIQUE, active NUMBER NOT NULL)');
  assert.deepEqual(yes('ALTER TABLE orders ADD CONSTRAINT orders_pk PRIMARY KEY (id)').existingTable,{owner:'APP',name:'ORDERS'});
});

test('allows bounded pure CHECK predicates without executable expressions', () => {
  for(const sql of [
    'CREATE TABLE orders (id NUMBER CHECK (id >= 0), amount NUMBER CONSTRAINT amount_ck CHECK (amount BETWEEN -100.5 AND 999))',
    "CREATE TABLE orders (state VARCHAR2(20) CHECK (state IN ('OPEN','CLOSED','it''s data; @link')))",
    'CREATE TABLE orders (lo NUMBER, hi NUMBER, CONSTRAINT range_ck CHECK (lo < hi AND NOT (lo < 0 OR hi IS NULL)))',
    'ALTER TABLE orders ADD CHECK (state NOT IN (1,2) OR value IS NOT NULL)',
    'ALTER TABLE orders ADD CONSTRAINT amount_ck CHECK (amount NOT BETWEEN 1 AND 2 AND amount != 5 AND amount <> 9)',
    'CREATE TABLE orders ("select" NUMBER CHECK ("select" = 1), "CURRENT_DATE" NUMBER CHECK ("CURRENT_DATE" = 2))',
    'CREATE TABLE orders (id NUMBER CHECK (1=1))',
  ])yes(sql);
  assert.deepEqual(yes('ALTER TABLE orders ADD CONSTRAINT "valid range" CHECK (lo <= hi)').constraints,
    [{type:'CHECK',name:'valid range',columns:['LO','HI']}]);
});

test('rejects constraint scope escapes, executable expressions and custom state/index clauses', () => {
  for(const sql of [
    'CREATE TABLE orders (id NUMBER REFERENCES FOREIGN.t(id))',
    'CREATE TABLE orders (id NUMBER, FOREIGN KEY (id) REFERENCES APP.t(id))',
    'ALTER TABLE FOREIGN.orders ADD PRIMARY KEY (id)',
    'ALTER TABLE orders ADD CONSTRAINT FOREIGN.pk PRIMARY KEY (id)',
    'ALTER TABLE orders ADD CONSTRAINT pk PRIMARY KEY (id) USING INDEX FOREIGN.idx',
    'ALTER TABLE orders ADD PRIMARY KEY (id) USING INDEX (CREATE INDEX FOREIGN.idx ON APP.orders(id))',
    'ALTER TABLE orders ADD UNIQUE (id) DISABLE',
    'ALTER TABLE orders ADD CHECK (id > 0) ENABLE NOVALIDATE',
    'ALTER TABLE orders ADD PRIMARY KEY (id) DEFERRABLE INITIALLY DEFERRED',
    'ALTER TABLE orders ADD CHECK (FOREIGN.fn(id) = 1)',
    'ALTER TABLE orders ADD CHECK (local_fn(id) = 1)',
    'ALTER TABLE orders ADD CHECK (id IN (SELECT id FROM FOREIGN.t))',
    'ALTER TABLE orders ADD CHECK (APP.orders.id > 0)',
    'ALTER TABLE orders ADD CHECK (id > sequence_name.NEXTVAL)',
    'ALTER TABLE orders ADD CHECK (id > value@remote)',
    'ALTER TABLE orders ADD CHECK (id + 1 > 0)',
    'ALTER TABLE orders ADD CHECK (-id > 0)',
    "ALTER TABLE orders ADD CHECK (SYS_CONTEXT('USERENV','SESSION_USER') = 'APP')",
    'ALTER TABLE orders ADD CHECK (id > SYSDATE)',
    'ALTER TABLE orders ADD CHECK (id > DBTIMEZONE)',
    'ALTER TABLE orders ADD CHECK (id > CURRVAL)',
    'ALTER TABLE orders ADD PRIMARY KEY (id); DROP TABLE FOREIGN.t',
    'ALTER TABLE orders ADD CHECK (id > 0) OR 1=1',
  ])no(sql);
});

test('rejects malformed constraints, duplicate keys and unknown or case-confused create columns', () => {
  for(const sql of [
    'CREATE TABLE orders (id NUMBER, PRIMARY KEY ())',
    'CREATE TABLE orders (id NUMBER, PRIMARY KEY (id,id))',
    'CREATE TABLE orders (id NUMBER PRIMARY KEY, code NUMBER PRIMARY KEY)',
    'CREATE TABLE orders (id NUMBER CONSTRAINT same UNIQUE, code NUMBER CONSTRAINT SAME UNIQUE)',
    'CREATE TABLE orders (id NUMBER, PRIMARY KEY (missing))',
    'CREATE TABLE orders ("Id" NUMBER, UNIQUE (id))',
    'CREATE TABLE orders (id NUMBER CHECK (other > 1), other NUMBER)',
    'CREATE TABLE orders (id NUMBER, CHECK (missing > 1))',
    'CREATE TABLE orders (id NUMBER CONSTRAINT missing_kind)',
    'CREATE TABLE orders (id NUMBER CHECK (id >))',
    'CREATE TABLE orders (id NUMBER CHECK (id IN ()))',
    'CREATE TABLE orders (id NUMBER CHECK (id NOT = 1))',
    'CREATE TABLE orders (id NUMBER CHECK (id ! 1))',
    'CREATE TABLE orders (id NUMBER CHECK (id BETWEEN 1 OR 2))',
    'CREATE TABLE orders (id NUMBER CHECK (id = 1),)',
    'ALTER TABLE orders ADD (PRIMARY KEY (id))',
    'ALTER TABLE orders ADD CONSTRAINT pk PRIMARY KEY (id) /* unclosed',
    `ALTER TABLE orders ADD PRIMARY KEY (${Array.from({length:33},(_,i)=>`c${i}`).join(',')})`,
    `ALTER TABLE orders ADD CHECK (${'('.repeat(34)}id>0${')'.repeat(34)})`,
    `ALTER TABLE orders ADD CHECK (${'NOT '.repeat(34)}id>0)`,
  ])no(sql);
  const n='a'.repeat(128);yes(`CREATE TABLE orders ("${n}" NUMBER PRIMARY KEY)`);
  no(`CREATE TABLE orders ("${n}a" NUMBER PRIMARY KEY)`);
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
