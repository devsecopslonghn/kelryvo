import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogContext } from '../packages/sql-validation/catalog-context.mjs';
import { reviewSqlStatements } from '../packages/sql-validation/review.mjs';

test('catalog reference context preserves exact quoted names, visibility limits and blocked owner scope',()=>{
  const statements=reviewSqlStatements([{sourceSql:'SELECT * FROM "Orders", orders, EVIL."Orders";',ordinal:1,path:'V1.sql'}],'APP');
  const snapshot={id:'snapshot',objects:[
    {owner:'APP',name:'Orders',type:'TABLE',checksum:'table',definition:{private:'must not be retained'}},
    {owner:'APP',name:'Orders',type:'INDEX',checksum:'index'},
    {owner:'EVIL',name:'Orders',type:'TABLE',checksum:'foreign'},
    {owner:'APP',name:'ORDERS',type:'DEPENDENCY',checksum:'dependency'},
  ],coverage:{TABLE:'PARTIAL'},limitations:['MULTI_QUERY_CONSISTENCY_UNGUARANTEED']};
  const [result]=catalogContext(statements,'APP',snapshot);
  assert.equal(result.objectCheck,'UNKNOWN');
  assert.ok(result.findings.some(f=>f.code==='CROSS_SCHEMA_REFERENCE' && f.severity==='BLOCKING'));
  assert.deepEqual(result.catalogReferences.map(r=>r.state),['OBSERVED','UNKNOWN','OUT_OF_SCOPE']);
  assert.deepEqual(result.catalogReferences[0].matches,[{type:'TABLE',checksum:'table'},{type:'INDEX',checksum:'index'}]);
  assert.equal(result.catalogReferences[0].snapshotId,'snapshot');
  assert.doesNotMatch(JSON.stringify(result),/foreign|dependency|must not be retained/);
  assert.equal(statements[0].catalogReferences,undefined);
});

test('a snapshot with a different observed target identity cannot supply reference matches',()=>{
  const statements=reviewSqlStatements([{sourceSql:'ALTER TABLE orders ADD value NUMBER;',ordinal:1}],'APP');
  const [result]=catalogContext(statements,'APP',{id:'wrong-target',identityDigest:'wrong',objects:[
    {owner:'APP',name:'ORDERS',type:'TABLE',checksum:'wrong-object'},
  ]},'expected');
  assert.equal(result.catalogReferences[0].state,'IDENTITY_MISMATCH');
  assert.deepEqual(result.catalogReferences[0].matches,[]);
  assert.equal(result.objectCheck,'UNKNOWN');
});

test('database links cannot inherit a local object observation even with the same exact name',()=>{
  const statements=reviewSqlStatements([{sourceSql:'SELECT * FROM APP.ORDERS@REMOTE, APP.LOCAL_TABLE;',ordinal:1}],'APP');
  const [result]=catalogContext(statements,'APP',{id:'local',objects:[
    {owner:'APP',name:'ORDERS',type:'TABLE',checksum:'local-orders'},
    {owner:'APP',name:'LOCAL_TABLE',type:'TABLE',checksum:'local-table'},
  ]});
  assert.ok(result.findings.some(f=>f.code==='DATABASE_LINK_REFERENCE' && f.severity==='BLOCKING'));
  assert.ok(result.catalogReferences.every(r=>r.state==='LINK_SCOPE_UNVERIFIED' && r.matches.length===0));
});

test('missing snapshots and objects never infer absence even with complete coverage or create targets',()=>{
  const statements=reviewSqlStatements([{sourceSql:'CREATE TABLE future_table (id NUMBER);',ordinal:1}],'APP');
  for(const snapshot of [null,{id:'empty',objects:[],coverage:{TABLE:'COMPLETE'}}]) {
    const [result]=catalogContext(statements,'APP',snapshot);
    assert.equal(result.catalogReferences[0].state,'UNKNOWN');
    assert.deepEqual(result.catalogReferences[0].matches,[]);
    assert.equal(result.objectCheck,'UNKNOWN');
  }
});
