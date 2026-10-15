import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash,randomUUID } from 'node:crypto';
import { createRestrictedOracleHost } from '../apps/worker/oracle-host.ts';
import { snapshotObservation,executionDigest } from '../packages/execution/admission.ts';
import { oracleHostFixture } from './helpers/oracle-host-fixture.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const migration=(version,sqls)=>({ path:`migrations/V${version}__change.sql`,version,sha256:hash(JSON.stringify(sqls)),
  statementManifestDigest:hash(JSON.stringify(sqls.map(hash))),statementDigests:sqls.map(hash) });
const v1=['-- café retained\nCREATE TABLE example (id NUMBER)','CREATE TABLE example_detail (id NUMBER)'];
const v2=['CREATE TABLE later (id NUMBER)','CREATE TABLE later_detail (id NUMBER)'];
const request=(files=[migration('1',v1)])=>({ jobId:randomUUID(),planId:randomUUID(),approvalReference:randomUUID(),intentDigest:hash('approved UNIT intent'),
  profile:{ engine:'oracle',username:'APP',service:'UNIT',host:'oracle.example.invalid',port:1521,credential_ref:'vault://unit/writer' },
  migrations:files,statementDigests:files.flatMap(m=>m.statementDigests) });
const run=async(host,input,texts)=>host.withTarget(input,async s=>{
  const observation=snapshotObservation(await s.observe(),'UNIT_SYNTHETIC',input.migrations);assert.ok(observation);
  assert.equal(await s.current(observation),true);
  assert.equal(await s.centralEvidenceComplete(),true);
  for (const [i,text] of texts.entries()) {
    assert.equal(await s.execute(Buffer.from(text)),'ACKNOWLEDGED');
    const receipt=await s.recordTargetReceipt({ jobId:input.jobId,generation:1,ordinal:i+1,statementDigest:hash(text),outcome:'ACKNOWLEDGED' });
    assert.match(receipt.receiptDigest,/^[a-f0-9]{64}$/);
    assert.equal(await s.current(observation),true);
  }
  assert.equal(await s.verifyPostconditions(),true);assert.equal(await s.centralEvidenceComplete(),true);
  return observation;
});

test('even approved bytes cannot dispatch unscopable SQL or synonym targets',async t=>{
  for(const sql of ['CREATE TABLE FOREIGN.t (id NUMBER)',
    "BEGIN EXECUTE IMMEDIATE 'CREATE TABLE APP.t (id NUMBER)'; END;",
    'CREATE TABLE t AS SELECT * FROM FOREIGN.s','INSERT INTO example VALUES (1)',
    'ALTER SESSION SET CURRENT_SCHEMA = FOREIGN','CREATE TRIGGER trg BEFORE INSERT ON t BEGIN NULL; END;']) {
    await t.test(sql,async()=>{
      const f=oracleHostFixture();const input=request([migration('1',[sql])]);
      await f.host().withTarget(input,async s=>{
        await s.observe();const before=await f.read();
        assert.equal(await s.execute(Buffer.from(sql)),'UNKNOWN');
        assert.deepEqual(await f.read(),before,'scope denial writes no target ledger events');
      });assert.equal(f.calls.length,0);assert.equal(f.claims.length,0);
    });
  }
  for(const existingTableType of ['SYNONYM','VIEW']) {
    const sql='ALTER TABLE example ADD label VARCHAR2(40)',f=oracleHostFixture({existingTableType});
    await f.host().withTarget(request([migration('1',[sql])]),async s=>{
      await s.observe();const before=await f.read();assert.equal(await s.execute(Buffer.from(sql)),'UNKNOWN');
      assert.deepEqual(await f.read(),before);
    });assert.equal(f.calls.length,0);
  }
});

test('target-bound host verifies the deployment login and exact schema owner independently',async()=>{
  const assignment=randomUUID();
  const f=oracleHostFixture({assignment,attest:(witness,_request,writer)=>{
    writer.identity.SESSION_USER='DEPLOYER';
    writer.identity.SCHEMA_NAME='APP';
    return witness;
  }});
  const input=request();input.profile.username='DEPLOYER';
  input.executionTarget={assignmentId:assignment,expectedIdentityDigest:f.binding.targetIdentityDigest,exactOwner:'APP'};
  await run(f.host(),input,v1);assert.deepEqual(f.calls,v1);
  const wrong=oracleHostFixture({assignment,attest:(witness,_request,writer)=>{
    writer.identity.SESSION_USER='DEPLOYER';writer.identity.SCHEMA_NAME='APP';return witness;
  }});
  const wrongInput=request();wrongInput.profile.username='DEPLOYER';
  wrongInput.executionTarget={assignmentId:assignment,expectedIdentityDigest:wrong.binding.targetIdentityDigest,exactOwner:'OTHER_SCHEMA'};
  await wrong.host().withTarget(wrongInput,s=>assert.rejects(s.observe(),/unavailable/));
  assert.equal(wrong.calls.length,0);
});

test('configured Oracle service spelling may differ in case while observed identity remains exact',async()=>{
  const f=oracleHostFixture(),input=request();input.profile.service='unit';
  await run(f.host(),input,v1);assert.deepEqual(f.calls,v1);
  const other=oracleHostFixture(),wrong=request();wrong.profile.service='OTHER';
  await other.host().withTarget(wrong,s=>assert.rejects(s.observe(),/unavailable/));
  assert.equal(other.calls.length,0);
});

test('non-finite target facts are declined before invoking the installed provider',async()=>{
  for(const value of [NaN,Infinity,-Infinity]){
    const f=oracleHostFixture(),input=request();
    input.executionTarget={assignmentId:randomUUID(),expectedIdentityDigest:f.binding.targetIdentityDigest,
      exactOwner:'APP',bindingRevision:value};
    await f.host().withTarget(input,s=>assert.rejects(s.observe(),/unavailable/));
    assert.equal(f.providers.length,0);assert.equal(f.calls.length,0);
  }
});

test('master stream adoption cannot reset retained legacy history even when the schema is reported empty',async()=>{
  const assignment=randomUUID(),f=oracleHostFixture({assignment});
  await run(f.host(),request(),v1);
  const before=await f.read(),input=request();
  input.executionTarget={assignmentId:assignment,expectedIdentityDigest:f.binding.targetIdentityDigest,exactOwner:'APP',
    credentialMode:'INSTANCE_MASTER',streamId:randomUUID()};
  await f.host().withTarget(input,s=>assert.rejects(s.observe(),/unavailable/));
  assert.deepEqual(await f.read(),before);assert.deepEqual(f.calls,v1);
});

test('protected host records exact approved bytes and only later pending files across sessions and reassignment',async()=>{
  const f=oracleHostFixture(),first=request(),h=f.host();
  assert.equal((await run(h,first,v1)).historyState,'EMPTY');
  const prior=await f.read();assert.equal(prior.ledgerState,'COMPLETE');
  assert.equal(prior.appliedMigrations[0].approvalReference,first.approvalReference);
  f.setAssignment(randomUUID());
  const second=request([migration('1',v1),migration('2',v2)]);
  const observation=await run(h,second,v2);assert.equal(observation.historyState,'APPLIED_PREFIX');
  assert.equal(observation.appliedStatementCount,2);assert.deepEqual(f.calls,[...v1,...v2]);
  assert.deepEqual(f.claims.map(s=>s.fullOrdinal),[1,2,3,4]);assert.deepEqual(f.claims.map(s=>s.ordinal),[1,2,1,2]);
  assert.equal((await f.read()).appliedMigrations[0].approvalReference,first.approvalReference);
  const before=f.owner.commits;
  assert.equal((await run(h,request(second.migrations),[])).historyState,'EXACT_APPLIED');
  assert.equal(f.owner.commits,before,'NOOP performs no target ledger writes');assert.equal(f.calls.length,4);
  assert.equal(f.writers.length,3);assert.ok(f.writers.every(w=>w.closed && !w.lock));
});

test('write-purpose permit is checked before opening a target; UNIT requires explicit install option',async t=>{
  assert.throws(()=>createRestrictedOracleHost(oracleHostFixture().installed),/unavailable/);
  for (const [name,change] of Object.entries({ readOnly:p=>({ ...p,action:'CONNECT_AND_READ_IDENTITY' }),
    expired:p=>({ ...p,expiresAt:Date.now()-1 }),otherJob:p=>({ ...p,jobId:randomUUID() }),
    otherProfile:p=>({ ...p,profileDigest:hash('other') }),scope:p=>({ ...p,scope:'TRUSTED_VALIDATED' }),extra:p=>({ ...p,arbitrary:true }) })) {
    await t.test(name,async()=>{
      const f=oracleHostFixture({ permit:change });
      assert.equal(await f.host().withTarget(request(),async s=>{ await assert.rejects(s.observe(),/unavailable/);return 'HOLD'; }),'HOLD');
      assert.equal(f.providers.length,0);assert.equal(f.calls.length,0);
    });
  }
});

test('absent and empty ledger do not prove empty target; corrupt, partial and divergent histories never dispatch',async t=>{
  await t.test('uninitialized nonempty target',async()=>{
    const f=oracleHostFixture({ emptyTarget:false });
    await f.host().withTarget(request(),s=>assert.rejects(s.observe(),/unavailable/));assert.equal(f.owner.commits,0);assert.equal(f.calls.length,0);
  });
  await t.test('altered V1 identity',async()=>{
    const f=oracleHostFixture();await run(f.host(),request(),v1);
    const divergent=request([migration('1',['DROP TABLE example']),migration('2',v2)]);
    await f.host().withTarget(divergent,s=>assert.rejects(s.observe(),/unavailable/));assert.deepEqual(f.calls,v1);
  });
  await t.test('unresolved tail',async()=>{
    const f=oracleHostFixture(),r=request();
    await f.host().withTarget(r,async s=>{await s.observe();assert.equal(await s.execute(Buffer.from(v1[0])),'ACKNOWLEDGED');});
    assert.equal((await f.read()).ledgerState,'IN_FLIGHT');
    await f.host().withTarget(request(),s=>assert.rejects(s.observe(),/unavailable/));assert.equal(f.calls.length,1);
  });
  await t.test('corrupt chain',async()=>{
    const f=oracleHostFixture();await run(f.host(),request(),v1);f.owner.heads.get(f.id).checksum=hash('corrupt');
    await f.host().withTarget(request(),s=>assert.rejects(s.observe(),/unavailable/));assert.equal(f.calls.length,2);
  });
});

test('lost execute, writer commit and ledger commit acknowledgments poison capability without retry',async t=>{
  for (const failure of ['lostWriterExecute','lostWriterCommit','ledgerPlan','ledgerStarted','ledgerReceipt']) {
    await t.test(failure,async()=>{
      const f=oracleHostFixture({ [failure]:true }),r=request();
      if (failure==='ledgerPlan') f.owner.failPlannedOrdinal=2;
      if (failure==='ledgerStarted') f.owner.failEventType='STATEMENT_STARTED';
      await f.host().withTarget(r,async s=>{
        await s.observe();
        const outcome=await s.execute(Buffer.from(v1[0]));
        if (failure==='ledgerReceipt') {
          assert.equal(outcome,'ACKNOWLEDGED');f.owner.failCommit='after';
          assert.equal(await s.recordTargetReceipt({ jobId:r.jobId,generation:1,ordinal:1,statementDigest:hash(v1[0]),outcome:'ACKNOWLEDGED' }),null);
        } else assert.equal(outcome,'UNKNOWN');
        assert.equal(await s.execute(Buffer.from(v1[0])),'UNKNOWN');assert.equal(await s.verifyPostconditions(),false);
      });
      assert.equal(f.calls.length,['ledgerPlan','ledgerStarted'].includes(failure) ? 0 : 1);
      assert.ok((await f.read()).ledgerState!=='COMPLETE');
    });
  }
});

test('mutex, physical session, authority and unexpected ledger changes veto another dispatch',async t=>{
  for (const failure of ['mutex','session','authority','history','timeout']) {
    await t.test(failure,async()=>{
      let revoke=false;
      const f=oracleHostFixture({ attest:(w)=>revoke ? { ...w,validityDigest:hash('revoked') } : w }),r=request();
      await f.host().withTarget(r,async s=>{
        const o=await s.observe();
        if (failure==='mutex') f.writers[0].lock=null;
        if (failure==='session') f.writers[0].identity.SESSION_ID='2';
        if (failure==='authority') revoke=true;
        if (failure==='history') f.owner.heads.set(f.id,{ sequence_no:0,checksum:hash('wrong') });
        if (failure==='timeout') f.writers[0].callTimeout=0;
        assert.equal(await s.current(o),false);assert.equal(await s.execute(Buffer.from(v1[0])),'UNKNOWN');
      }).catch(e=>assert.match(e.message,/unavailable|host releases/));
      assert.equal(f.calls.length,0);
    });
  }
});

test('continuity lost during acknowledged writer SQL leaves STARTED unresolved and never acknowledges or retries',async t=>{
  for (const failure of ['mutex','session','authority']) {
    await t.test(failure,async()=>{
      let revoke=false;
      const f=oracleHostFixture({ attest:w=>revoke ? { ...w,validityDigest:hash('lost authority') } : w,
        afterExecute:async(_text,_request,writer)=>{
          if (failure==='mutex') writer.lock=null;
          if (failure==='session') writer.identity.SESSION_ID='77';
          if (failure==='authority') revoke=true;
        } }),r=request();
      const h=f.host();
      await h.withTarget(r,async s=>{
        await s.observe();assert.equal(await s.execute(Buffer.from(v1[0])),'UNKNOWN');
        assert.equal(await s.recordTargetReceipt({ jobId:r.jobId,generation:1,ordinal:1,statementDigest:hash(v1[0]),outcome:'ACKNOWLEDGED' }),null);
        assert.equal(await s.execute(Buffer.from(v1[0])),'UNKNOWN');
      }).catch(e=>assert.match(e.message,/unavailable/));
      const raw=await f.read();assert.equal(raw.ledgerState,'IN_FLIGHT');assert.deepEqual(raw.startedFiles[0].statementStates,['STARTED']);
      assert.equal(f.calls.length,1);
    });
  }
});

test('receipt order, generation, duplicate dispatch identities and extra SQL fail closed',async t=>{
  for (const failure of ['wrongBytes','wrongReceipt','generation','duplicateDispatch','extra']) {
    await t.test(failure,async()=>{
      const dispatchId=randomUUID();
      const f=oracleHostFixture({ claim:failure==='duplicateDispatch' ? (s,r)=>({ ...s,jobId:r.jobId,dispatchId }) : undefined }),r=request();
      await f.host().withTarget(r,async s=>{
        await s.observe();
        if (failure==='wrongBytes') {assert.equal(await s.execute(Buffer.from('DROP TABLE unauthorized')),'UNKNOWN');return;}
        assert.equal(await s.execute(Buffer.from(v1[0])),'ACKNOWLEDGED');
        const receipt={ jobId:r.jobId,generation:1,ordinal:1,statementDigest:hash(v1[0]),outcome:'ACKNOWLEDGED' };
        if (failure==='wrongReceipt') {assert.equal(await s.recordTargetReceipt({ ...receipt,ordinal:2 }),null);return;}
        assert.ok(await s.recordTargetReceipt(receipt));
        const result=await s.execute(Buffer.from(v1[1]));
        if (failure==='duplicateDispatch') { assert.equal(result,'UNKNOWN');return; }
        assert.equal(result,'ACKNOWLEDGED');
        const second={ ...receipt,ordinal:2,statementDigest:hash(v1[1]),generation:failure==='generation' ? 2 : 1 };
        if (failure==='generation') {assert.equal(await s.recordTargetReceipt(second),null);return;}
        assert.ok(await s.recordTargetReceipt(second));assert.equal(await s.execute(Buffer.from(v1[0])),'UNKNOWN');
      });
      assert.equal(f.calls.length,failure==='wrongBytes' ? 0 : ['wrongReceipt','duplicateDispatch'].includes(failure) ? 1 : 2);
    });
  }
});

test('caller mutation cannot change the captured request or statement bytes',async()=>{
  const f=oracleHostFixture(),r=request();
  const initial=f.installed.authorize;
  f.installed.authorize=async captured=>{
    r.migrations[0].statementDigests[0]=hash('forged');r.profile.username='OTHER';return initial(captured);
  };
  await f.host().withTarget(r,async s=>{
    const o=await s.observe();const bytes=Buffer.from(v1[0]),promise=s.execute(bytes);bytes.fill(0);
    assert.equal(await promise,'ACKNOWLEDGED');assert.equal(f.calls[0],v1[0]);assert.equal(await s.current(o),true);
  });
});

test('callback escape, overlap and release uncertainty retire host and drain an in-flight writer before cleanup',async t=>{
  await t.test('detached writer is drained',async()=>{
    let unblock,started;const entered=new Promise(r=>{started=r;}),blocked=new Promise(r=>{unblock=r;});
    const f=oracleHostFixture({ afterExecute:async()=>{started();await blocked;} }),h=f.host(),r=request();
    let pending;
    const task=h.withTarget(r,async s=>{await s.observe();pending=s.execute(Buffer.from(v1[0]));await entered;return 'EARLY';});
    await entered;assert.equal(f.writers[0].closed,false);assert.ok(f.writers[0].lock);unblock();
    await assert.rejects(task,/unavailable/);assert.equal(await pending,'UNKNOWN');assert.equal(f.writers[0].closed,true);
    await h.withTarget(request(),s=>assert.rejects(s.observe(),/unavailable/));assert.equal(f.providers.length,1);
  });
  await t.test('lost release',async()=>{
    const f=oracleHostFixture({ releaseFailure:true }),h=f.host();
    await assert.rejects(run(h,request(),v1),/unavailable/);
    await h.withTarget(request(),s=>assert.rejects(s.observe(),/unavailable/));assert.equal(f.providers.length,1);
  });
  await t.test('overlapping operation poisons the first call',async()=>{
    const f=oracleHostFixture();await f.host().withTarget(request(),async s=>{
      const o=await s.observe();const p=s.current(o);assert.equal(await s.current(o),false);assert.equal(await p,false);
      assert.equal(await s.execute(Buffer.from(v1[0])),'UNKNOWN');
    });assert.equal(f.calls.length,0);
  });
  await t.test('provider substitution and callback replay retire the host',async()=>{
    for (const mode of ['substitute','repeat','throw']) {
      const f=oracleHostFixture(),original=f.installed.withTarget;
      f.installed.withTarget=(r,p,callback)=>original(r,p,async target=>{
        const result=await callback(target);
        if (mode==='repeat') return callback(target);
        if (mode==='throw') throw new Error('UNIT provider ended ambiguously');
        return { substituted:result };
      });
      const h=f.host();let count=0;
      await assert.rejects(h.withTarget(request(),async s=>{count++;await s.observe();return 'OBSERVED';}),/unavailable/);
      assert.equal(count,1);assert.equal(f.calls.length,0);
      await h.withTarget(request(),s=>assert.rejects(s.observe(),/unavailable/));assert.equal(f.providers.length,1);
    }
  });
  await t.test('escaped capabilities are ended after target callback',async()=>{
    const f=oracleHostFixture();let escaped,observation;
    await f.host().withTarget(request(),async s=>{escaped=s;observation=await s.observe();});
    assert.equal(await escaped.current(observation),false);assert.equal(await escaped.execute(Buffer.from(v1[0])),'UNKNOWN');
    await assert.rejects(escaped.observe(),/unavailable/);assert.equal(f.calls.length,0);
  });
});
