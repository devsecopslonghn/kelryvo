import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { oracleHostFixture } from './helpers/oracle-host-fixture.mjs';
import { declareReference,assignReference } from '../packages/catalog-reference/index.mjs';
import { createExecutionWorker } from '../apps/worker/run-request.ts';
import { readExecutionRequest,materializeExecutionRequest } from '../packages/execution/admission.ts';

test('protected Oracle host adapter integrates real Git approval, pending-only worker and durable central history',{
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:300000,
},async t=>{
  const f=await statementEnvelopeFixture({ firstStatementCount:2,firstFile:'V1__first.sql',includeSecond:false });
  let sql=f.db.sql;
  try {
    await f.membership.deployGrant(f.project.id,f.actors[0].id);
    const ref=await declareReference(sql,{ databaseKey:'host-unit',databaseLabel:'UNIT only',containerKey:'unit-pdb',
      containerName:'UNIT PDB',containerKind:'PDB',environment:'DEV',host:f.profile.host,port:f.profile.port,service:f.profile.service,
      transport:'TCP',owner:f.profile.username });
    await assignReference(sql,{ schemaId:ref.schemaId,projectId:f.project.id,expectedRevision:'0',reason:'UNIT host assignment' });
    const assignment=async()=>(await sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${ref.schemaId} AND closed_at IS NULL`)[0].id;
    const approve=async plan=>assert.equal((await f.api('POST',`/api/plans/${plan.id}/decision`,{
      decision:'APPROVE',reason:'Review exact Git statements' },f.actors[1])).statusCode,200);
    const request=async plan=>{
      const r=await f.api('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:randomUUID(),reason:'Protected UNIT host acceptance' });
      assert.equal(r.statusCode,201,r.body);return r.json().job.id;
    };
    const host=async options=>{
      const h=oracleHostFixture({ service:f.profile.service,assignment:await assignment(),...options });
      h.setBeforeDispatch(async(_text,r,_writer,raw)=>{
        assert.equal(raw.startedFiles.at(-1).statementStates.at(-1),'STARTED','protected target STARTED before writer');
        const event=(await sql`SELECT e.phase FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id
          WHERE a.job_id=${r.jobId} ORDER BY e.revision DESC LIMIT 1`)[0];
        assert.equal(event.phase,'STARTED','central STARTED committed before writer');
      });
      return { ...h,worker:createExecutionWorker(sql,h.host(),{ allowUnitSynthetic:true }) };
    };
    const state=async id=>(await sql`SELECT state FROM sf_execution_jobs WHERE id=${id}`)[0].state;
    const attempts=async id=>(await sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${id}`)[0].n;
    const v1=await f.makePlan();await approve(v1);
    const originalApproval=(await sql`SELECT approval_reference FROM sf_plans WHERE id=${v1.id}`)[0].approval_reference;
    const first=await request(v1),h=await host();
    await t.test('V1 completes with ordered target and central receipts',async()=>{
      assert.equal(await h.worker.runWaitingRequest(first),'VERIFIED_SUCCESS');assert.equal(h.calls.length,2);
      const ledger=await h.read();assert.equal(ledger.ledgerState,'COMPLETE');assert.equal(ledger.appliedMigrations.length,1);
      assert.equal(ledger.appliedMigrations[0].approvalReference,originalApproval);
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_receipts WHERE job_id=${first}`)[0].n,2);
    });
    await writeFile(path.join(f.repo,'migrations/V2__next.sql'),'CREATE TABLE pending_host (id NUMBER);\nCREATE TABLE pending_host_index (id NUMBER);\n');
    f.git('add','migrations');f.git('commit','-m','Append V2 for protected host');
    const imported=await f.api('POST',`${f.base}/releases`,{ repositoryId:'statement-repo',commit:'HEAD',folder:'migrations' });
    assert.equal(imported.statusCode,201,imported.body);
    const v2=await f.makePlan(imported.json().release.id);await approve(v2);
    const second=await request(v2);
    const approved=await materializeExecutionRequest(await sql.begin(tx=>readExecutionRequest(tx,second)));
    await t.test('V2 executes its suffix; restart and catalog reassignment preserve V1',async()=>{
      assert.equal(await h.worker.runWaitingRequest(second),'VERIFIED_SUCCESS');assert.equal(h.calls.length,4);
      assert.deepEqual(h.calls,approved.statements.map(s=>Buffer.from(s.bytes).toString('utf8')));
      const applied=await h.read();assert.equal(applied.appliedMigrations.length,2);
      assert.equal(applied.appliedMigrations[0].approvalReference,originalApproval);
      const proof=(await sql`SELECT host_binding FROM sf_execution_admission_proofs WHERE job_id=${second}`)[0].host_binding;
      assert.equal(proof.appliedStatementCount,2);assert.equal(proof.statementCount,2);
      await assignReference(sql,{ schemaId:ref.schemaId,projectId:null,expectedRevision:'1',reason:'Release UNIT assignment' });
      await assignReference(sql,{ schemaId:ref.schemaId,projectId:f.project.id,expectedRevision:'2',reason:'Reassign same physical UNIT target' });
      h.setAssignment(await assignment());await f.restart();sql=f.db.sql;
      const noop=await request(v2);
      assert.equal(await createExecutionWorker(sql,h.host(),{ allowUnitSynthetic:true }).runWaitingRequest(noop),'NOOP');
      assert.equal(h.calls.length,4);assert.equal((await sql`SELECT scope FROM sf_execution_admission_proofs WHERE job_id=${noop}`)[0].scope,'UNIT_SYNTHETIC');
    });
    const duplicate=async()=>{
      const id=randomUUID();
      await sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
        request_credential_id,idempotency_key,payload_digest,reason,state,readiness)
        SELECT ${id},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,request_credential_id,
          ${randomUUID()},payload_digest,reason,'WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE' FROM sf_execution_jobs WHERE id=${second}`;
      await sql`INSERT INTO sf_execution_job_events(id,job_id,revision,to_state,actor_id,facts)
        VALUES(${randomUUID()},${id},0,'WAITING_VALIDATION',${f.actors[0].id},'{"scope":"UNIT_HOST_REQUEST_FIXTURE"}'::jsonb)`;
      return id;
    };
    await t.test('missing target adoption and wrong write purpose HOLD before any attempt',async()=>{
      for (const options of [{ emptyTarget:false },{ permit:p=>({ ...p,action:'CONNECT_AND_READ_IDENTITY' }) }]) {
        const id=await duplicate(),denied=await host(options);
        assert.equal(await denied.worker.runWaitingRequest(id),'HOLD');assert.equal(await state(id),'HOLD');
        assert.equal(await attempts(id),0);assert.equal(denied.calls.length,0);assert.equal(denied.owner.commits,0);
      }
    });
    await t.test('unknown writer result holds and an unresolved target file is never replayed',async()=>{
      const id=await duplicate(),unknown=await host({ lostWriterExecute:true });
      assert.equal(await unknown.worker.runWaitingRequest(id),'HOLD');assert.equal(unknown.calls.length,1);
      assert.equal((await unknown.read()).ledgerState,'IN_FLIGHT');assert.equal(await attempts(id),1);
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_execution_receipts WHERE job_id=${id}`)[0].n,0);
      const fresh=await duplicate();
      assert.equal(await createExecutionWorker(sql,unknown.host(),{ allowUnitSynthetic:true }).runWaitingRequest(fresh),'HOLD');
      assert.equal(unknown.calls.length,1);assert.equal(await attempts(fresh),0);
      assert.equal(await unknown.worker.runWaitingRequest(id),'ADMISSION_DECLINED');
    });
    await t.test('target rewind is vetoed by retained central completion before a new attempt',async()=>{
      h.owner.heads.clear();h.owner.events.clear();
      const id=await duplicate();
      assert.equal(await createExecutionWorker(sql,h.host(),{ allowUnitSynthetic:true }).runWaitingRequest(id),'HOLD');
      assert.equal(h.calls.length,4);assert.equal(await attempts(id),0);
    });
  } finally { await f.close(); }
});
