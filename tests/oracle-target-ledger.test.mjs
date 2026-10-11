import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createOracleTargetLedger, oracleTargetLedgerId, oracleTargetLedgerSql as SQL } from '../packages/execution/oracle-target-ledger.mjs';
import { FakeConnection } from './helpers/oracle-ledger-fixture.mjs';
import { selectPendingMigrations } from '../packages/execution/pending-migrations.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const hash = value => digest(JSON.stringify(value));
const id = digest('UNIT canonical target');
const migration = (version='1',suffix=version) => ({ path:`migrations/V${version}__change.sql`,version,
  approvalReference:randomUUID(),sha256:digest(`source:${suffix}`),statementManifestDigest:digest(`manifest:${suffix}`),
  intentDigest:digest(`intent:${suffix}`),statementDigests:[digest(`s1:${suffix}`),digest(`s2:${suffix}`)] });

const applyFile=async (ledger,file,ordinal,targetId=id) => {
  assert.equal(await ledger.startFile(targetId,file),'ACKNOWLEDGED');
  for (let i=0;i<file.statementDigests.length;i++) {
    assert.equal(await ledger.startStatement(targetId,ordinal,i+1,file.statementDigests[i]),'ACKNOWLEDGED');
    assert.equal(await ledger.acknowledgeStatement(targetId,ordinal,i+1,file.statementDigests[i]),'ACKNOWLEDGED');
  }
  assert.equal(await ledger.completeFile(targetId,ordinal),'ACKNOWLEDGED');
};
// Re-signing is deliberate: a checksum alone must not accept an invalid state trace.
const resign=(connection,targetId=id) => {
  const fields=['event_type','file_ordinal','statement_ordinal','path','migration_version','source_digest',
    'manifest_digest','approval_reference','intent_digest','planned_count','planned_digest','statement_digest','receipt_digest'];
  let previous='0'.repeat(64);
  const rows=connection.events.get(targetId);
  rows.forEach((row,i) => { row.sequence_no=i+1;row.previous_checksum=previous;
    row.checksum=hash([targetId,i+1,previous,fields.map(c => row[c])]);previous=row.checksum; });
  connection.heads.set(targetId,{ sequence_no:rows.length,checksum:previous });
};

test('atomic complete file plans retain original approvals and produce a compatible pending suffix',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),v1=migration(),v2=migration('2');
  assert.equal((await ledger.read(id)).ledgerState,'UNINITIALIZED');
  await applyFile(ledger,v1,1);
  const applied=await ledger.read(id);
  assert.equal(applied.ledgerState,'COMPLETE');
  const observation={ historyFormat:1,historyState:'APPLIED_PREFIX',appliedMigrations:applied.appliedMigrations,pendingStatementDigests:v2.statementDigests };
  const pending=selectPendingMigrations([v1,v2],observation);
  assert.equal(pending.appliedStatementCount,2);
  assert.deepEqual(pending.pendingStatementDigests,v2.statementDigests);
  await applyFile(ledger,v2,2);
  const result=await ledger.read(id);
  assert.deepEqual(result.appliedMigrations,[v1,v2].map(f => ({ ...f,outcome:'APPLIED' })));
  assert.equal(result.startedFiles.length,0);
  assert.ok(Object.isFrozen(result.appliedMigrations[0].statementDigests));
  assert.ok(connection.calls.every(c => c.options.autoCommit===false && c.options.outFormat===4002 && c.options.maxRows===12545));
  assert.ok(connection.calls.every(c => !c.sql.includes(v1.path) && !c.sql.includes(v2.approvalReference)));
});

test('all planned identities commit once and an interrupted plan commits none',async () => {
  const good=new FakeConnection(),ledger=createOracleTargetLedger(good),file=migration();
  assert.equal(await ledger.startFile(id,file),'ACKNOWLEDGED');
  assert.equal(good.commits,1);
  assert.equal(good.events.get(id).length,3);
  const bad=new FakeConnection();bad.failPlannedOrdinal=2;
  const failed=createOracleTargetLedger(bad);
  assert.equal(await failed.startFile(id,file),'UNKNOWN');
  assert.equal(bad.commits,0);assert.equal(bad.events.size,0);assert.equal(bad.heads.size,0);
  assert.equal(await failed.read(id),null);
  assert.equal((await createOracleTargetLedger(bad).read(id)).ledgerState,'UNINITIALIZED');
});

test('STARTED is in flight and cannot be replayed, acknowledged out of order or completed early',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),file=migration();
  await ledger.startFile(id,file);
  assert.equal(await ledger.acknowledgeStatement(id,1,1,file.statementDigests[0]),'UNKNOWN');
  assert.equal(await ledger.startStatement(id,1,1,file.statementDigests[0]),'ACKNOWLEDGED');
  const observed=await ledger.read(id);
  assert.equal(observed.ledgerState,'IN_FLIGHT');assert.deepEqual(observed.startedFiles[0].statementStates,['STARTED']);
  assert.equal(observed.appliedMigrations.length,0);
  assert.equal(await ledger.startStatement(id,1,1,file.statementDigests[0]),'UNKNOWN');
  assert.equal(await ledger.startStatement(id,1,2,file.statementDigests[1]),'UNKNOWN');
  assert.equal(await ledger.startFile(id,migration('2')),'UNKNOWN');
  assert.equal(await ledger.completeFile(id,1),'UNKNOWN');
  assert.equal(await ledger.acknowledgeStatement(id,1,1,file.statementDigests[0]),'ACKNOWLEDGED');
  assert.equal(await ledger.completeFile(id,1),'UNKNOWN');
  assert.equal(await ledger.startStatement(id,1,2,digest('changed statement')),'UNKNOWN');
  assert.equal((await ledger.read(id)).ledgerState,'IN_FLIGHT');
});

test('a shortened plan with a consistent head stays in flight and cannot dispatch or complete',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),file=migration();
  await ledger.startFile(id,file);connection.events.get(id).pop();resign(connection);
  const current=await ledger.read(id);
  assert.equal(current.ledgerState,'IN_FLIGHT');assert.equal(current.startedFiles[0].expectedStatementCount,2);
  const commits=connection.commits;
  assert.equal(await ledger.startStatement(id,1,1,file.statementDigests[0]),'UNKNOWN');
  assert.equal(await ledger.completeFile(id,1),'UNKNOWN');assert.equal(connection.commits,commits);
});

test('missing, reordered, corrupt and structurally invalid signed histories are untrusted',async t => {
  for (const mode of ['missing','reordered','corrupt','head mismatch','after applied','identity mutation','wrong planned digest','duplicate version']) {
    await t.test(mode,async () => {
      const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),file=migration();
      await applyFile(ledger,file,1);
      const rows=connection.events.get(id);
      if (mode==='missing') rows.shift();
      if (mode==='reordered') [rows[2],rows[3]]=[rows[3],rows[2]];
      if (mode==='corrupt') rows[0].source_digest=digest('edited source');
      if (mode==='head mismatch') connection.heads.get(id).checksum=digest('wrong head');
      if (mode==='after applied') { rows.push(structuredClone(rows.at(-1)));resign(connection); }
      if (mode==='identity mutation') { rows[3].approval_reference=randomUUID();resign(connection); }
      if (mode==='wrong planned digest') { rows[0].planned_digest=digest('wrong list');resign(connection); }
      if (mode==='duplicate version') { await applyFile(ledger,migration('2'),2);connection.events.get(id)[8].migration_version='1';resign(connection); }
      assert.equal((await ledger.read(id)).ledgerState,'UNTRUSTED');
    });
  }
});

test('lost commit acknowledgement before or after publication poisons all operations without retry',async t => {
  for (const outcome of ['before','after']) await t.test(outcome,async () => {
    const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),file=migration();
    await ledger.startFile(id,file);await ledger.startStatement(id,1,1,file.statementDigests[0]);
    connection.failCommit=outcome;
    assert.equal(await ledger.acknowledgeStatement(id,1,1,file.statementDigests[0]),'UNKNOWN');
    const calls=connection.calls.length;
    assert.equal(await ledger.read(id),null);
    assert.equal(await ledger.acknowledgeStatement(id,1,1,file.statementDigests[0]),'UNKNOWN');
    assert.equal(connection.calls.length,calls);
    connection.failCommit=null;
    const recovered=await createOracleTargetLedger(connection).read(id);
    assert.equal(recovered.ledgerState,'IN_FLIGHT');
    assert.deepEqual(recovered.startedFiles[0].statementStates,[outcome==='before' ? 'STARTED' : 'ACKNOWLEDGED']);
  });
});

test('driver errors and failed conditional head updates poison and roll back without applied history',async t => {
  for (const mode of ['driver','conditional head']) await t.test(mode,async () => {
    const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection);
    if (mode==='driver') connection.failSql=SQL.lock;else connection.zeroHead=true;
    assert.equal(await ledger.startFile(id,migration()),'UNKNOWN');
    const calls=connection.calls.length;assert.equal(await ledger.read(id),null);assert.equal(connection.calls.length,calls);
    assert.equal(connection.events.size,0);
  });
});

test('one private connection rejects overlapping operations and snapshots caller identities before awaits',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),file=migration(),original=structuredClone(file);
  let release;connection.blockSql=SQL.lock;connection.block=new Promise(resolve => { release=resolve; });
  const first=ledger.startFile(id,file);await new Promise(resolve => setImmediate(resolve));
  file.path='migrations/V99__changed.sql';file.statementDigests[0]=digest('mutated caller');
  const calls=connection.calls.length;
  assert.equal(await ledger.read(id),null);assert.equal(await ledger.startFile(id,migration('2')),'UNKNOWN');assert.equal(connection.calls.length,calls);
  release();assert.equal(await first,'ACKNOWLEDGED');
  const observed=await ledger.read(id);
  assert.equal(observed.startedFiles[0].path,original.path);assert.deepEqual(observed.startedFiles[0].statementDigests,original.statementDigests);
});

test('numeric versions accept V2 then V10 and reject replay, duplicates and lower versions',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection);
  await applyFile(ledger,migration('2'),1);await applyFile(ledger,migration('10'),2);
  assert.equal(await ledger.startFile(id,migration('2','replay')),'UNKNOWN');
  assert.equal(await ledger.startFile(id,migration('10','duplicate')),'UNKNOWN');
  assert.equal(await ledger.startFile(id,migration('3','lower')),'UNKNOWN');
  assert.equal((await ledger.read(id)).appliedMigrations.length,2);
});

test('malformed identities and oversized input are rejected; oversized history is never truncated into trust',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection);
  for (const invalid of [{ approvalReference:'caller string' },{ version:'01' },{ path:'../escape.sql' },{ statementDigests:Array(4097).fill(digest('s')) }])
    assert.equal(await ledger.startFile(id,{ ...migration(),...invalid }),'UNKNOWN');
  assert.equal(connection.calls.length,0);
  connection.events.set(id,Array(12545).fill({}));connection.heads.set(id,{ sequence_no:12545,checksum:digest('overflow') });
  assert.equal((await ledger.read(id)).ledgerState,'UNTRUSTED');
  assert.match(SQL.read,/FETCH FIRST 12545 ROWS ONLY/);
});

test('aggregate statement bound retains a valid full ledger and rejects another file without committing',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection),file=migration();
  file.statementDigests=Array.from({ length:4096 },(_,i) => digest(`UNIT statement ${i}`));
  assert.equal(await ledger.startFile(id,file),'ACKNOWLEDGED');
  const rows=connection.events.get(id),template=structuredClone(rows[1]),receipts=[];
  for (let i=0;i<4096;i++) {
    const statementDigest=file.statementDigests[i],receiptDigest=hash([id,file.approvalReference,file.intentDigest,1,i+1,statementDigest]);
    rows.push({ ...template,event_type:'STATEMENT_STARTED',statement_ordinal:i+1,statement_digest:statementDigest });
    rows.push({ ...template,event_type:'STATEMENT_ACKNOWLEDGED',statement_ordinal:i+1,statement_digest:statementDigest,receipt_digest:receiptDigest });
    receipts.push(receiptDigest);
  }
  rows.push({ ...template,event_type:'FILE_APPLIED',statement_ordinal:null,statement_digest:null,receipt_digest:hash(receipts) });
  resign(connection);
  assert.equal((await ledger.read(id)).ledgerState,'COMPLETE');
  const commits=connection.commits;
  assert.equal(await ledger.startFile(id,migration('2')),'UNKNOWN');
  assert.equal(connection.commits,commits);
  assert.equal((await ledger.read(id)).appliedMigrations[0].statementDigests.length,4096);
});

test('128 applied files remain readable and the 129th holds without changing history',async () => {
  const connection=new FakeConnection(),ledger=createOracleTargetLedger(connection);
  for (let i=1;i<=128;i++) {
    const file=migration(String(i));file.statementDigests=file.statementDigests.slice(0,1);
    await applyFile(ledger,file,i);
  }
  assert.equal((await ledger.read(id)).appliedMigrations.length,128);
  const commits=connection.commits;
  assert.equal(await ledger.startFile(id,migration('129')),'UNKNOWN');
  assert.equal(connection.commits,commits);
});

test('physical-target ledger partition survives assignment changes and separates keys and identities',() => {
  const binding={ targetAssignmentId:randomUUID(),targetKey:'db/container/owner',targetIdentityDigest:digest('physical identity') };
  assert.equal(oracleTargetLedgerId(binding),oracleTargetLedgerId({ ...binding,targetAssignmentId:randomUUID() }));
  assert.notEqual(oracleTargetLedgerId(binding),oracleTargetLedgerId({ ...binding,targetKey:'another/container/owner' }));
  assert.notEqual(oracleTargetLedgerId(binding),oracleTargetLedgerId({ ...binding,targetIdentityDigest:digest('changed physical identity') }));
  assert.equal(oracleTargetLedgerId({ ...binding,targetKey:"x' OR 1=1 --" }),null);
});
