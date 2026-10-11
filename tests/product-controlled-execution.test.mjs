import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';
import { createExecutionWorker } from '../apps/worker/run-request.ts';
import { createExecutionJobStore } from '../packages/execution/postgres-jobs.ts';
import { applyLocalMembershipAction } from '../scripts/local-membership-operator.mjs';
import { acquireExecutionTarget, readExecutionRequest, materializeExecutionRequest } from '../packages/execution/admission.ts';

const hash = value => createHash('sha256').update(value).digest('hex');
const scope = 'UNIT_SYNTHETIC';
// Only disposable PostgreSQL/Git and synthetic host ports. No Oracle driver,
// target SQL effects, credential resolution or runtime acceptance.
test('approved Git request reaches controlled worker/history; uncertainty and revoked authority never replay', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 600_000,
}, async t => {
  const f = await statementEnvelopeFixture({ firstStatementCount:3 });
  const sql = f.db.sql;
  const digest = hash('UNIT_CONTROLLED_EXECUTION');
  try {
    const plan = await f.makePlan();
    assert.equal((await f.api('POST',`/api/plans/${plan.id}/decision`,{ decision:'APPROVE',reason:'Review complete retained sequence' },f.actors[1])).statusCode,200);
    await f.membership.deployGrant(f.project.id,f.actors[0].id);
    const declaration={ databaseKey:'unit-worker',databaseLabel:'UNIT database',containerKey:'unit-pdb',
      containerName:'UNIT PDB',containerKind:'PDB',environment:'DEV',host:f.profile.host,port:f.profile.port,
      service:f.profile.service,transport:'TCP',owner:f.profile.username };
    const reference = await declareReference(sql,declaration);
    await assignReference(sql,{ schemaId:reference.schemaId,projectId:f.project.id,expectedRevision:'0',reason:'Explicit UNIT target assignment' });
    let assignment = (await sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    let originalRequest;
    const request = async (freshApi = false) => {
      // Exercise the real Git/approval/request path once; negative worker cases
      // clone that verified metadata in this disposable UNIT database. Re-running
      // the pinned parser at the unchanged API request boundary adds no coverage.
      if (originalRequest && !freshApi) {
        const id=randomUUID();
        await sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,
          requester_id,request_credential_id,idempotency_key,payload_digest,reason,state,readiness)
          SELECT ${id},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
            request_credential_id,${randomUUID()},payload_digest,reason,'WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE'
          FROM sf_execution_jobs WHERE id=${originalRequest}`;
        await sql`INSERT INTO sf_execution_job_events(id,job_id,revision,to_state,actor_id,facts)
          VALUES(${randomUUID()},${id},0,'WAITING_VALIDATION',${f.actors[0].id},'{"scope":"UNIT_REQUEST_FIXTURE"}'::jsonb)`;
        return id;
      }
      const r = await f.api('POST',`/api/plans/${plan.id}/execution`,{ idempotencyKey:randomUUID(),reason:'Controlled UNIT host acceptance' });
      assert.equal(r.statusCode,201,r.body); assert.equal(r.json().job.state,'WAITING_VALIDATION');
      originalRequest=r.json().job.id;
      return originalRequest;
    };
    const jobState = async id => (await sql`SELECT state FROM sf_execution_jobs WHERE id=${id}`)[0].state;
    const counts = async id => (await sql`SELECT
      (SELECT count(*)::int FROM sf_execution_admission_proofs WHERE job_id=${id}) AS proofs,
      (SELECT count(*)::int FROM sf_execution_attempts WHERE job_id=${id}) AS attempts,
      (SELECT count(*)::int FROM sf_execution_receipts WHERE job_id=${id}) AS receipts`)[0];
    const host = (options = {}) => {
      const calls = []; let afterEffect;
      // Each host is an independent disposable synthetic target. Repeated
      // operations on the same host retain its canonical key.
      const targetKey = `unit:target:${randomUUID()}`;
      const capability = { workerId:'unit-controlled-worker',scope,withTarget:async (input,run) => {
        await options.beforeObservation?.(input);
        const observation = { scope,targetAssignmentId:assignment,targetKey,historyState:options.historyState ?? 'EMPTY',
          historyFormat:1, appliedMigrations:options.historyState === 'EXACT_APPLIED' ? input.migrations.map(row=>({ ...row,
            outcome:'APPLIED',approvalReference:input.approvalReference,intentDigest:input.intentDigest })) : [],
          pendingStatementDigests:options.historyState === 'EXACT_APPLIED' ? [] : input.statementDigests,
          targetIdentityDigest:digest,historySnapshotDigest:digest,mutexAuthorityDigest:digest,validityDigest:digest,
          centralEvidenceDigest:digest,dispatchPermitDigest:digest,hostWitnessDigest:digest,...options.observation };
        const result = await run({ scope,observe:async()=>observation,
          current:async () => options.current ? options.current(calls.length) : true,
          execute:async bytes => {
            const ordinal=calls.length+1;
            const committed=(await sql`SELECT j.state,a.state AS attempt_state,e.phase,e.ordinal
              FROM sf_execution_jobs j JOIN sf_execution_attempts a ON a.job_id=j.id
              JOIN sf_execution_attempt_events e ON e.attempt_id=a.id WHERE j.id=${input.jobId}
              ORDER BY e.revision DESC LIMIT 1`)[0];
            assert.deepEqual(committed,{ state:'ADMITTED',attempt_state:'CLAIMED',phase:'STARTED',ordinal });
            assert.equal((await counts(input.jobId)).proofs,1,'proof durable before dispatch');
            calls.push(Buffer.from(bytes)); await options.duringExecute?.(ordinal,input); afterEffect = options.afterExecute?.(calls.length,input);
            return options.outcome ?? 'ACKNOWLEDGED';
          },
          recordTargetReceipt:async receipt => { await afterEffect; return options.receiptGap ? null : ({ receiptDigest:hash(JSON.stringify(receipt)),centralEvidenceDigest:digest }); },
          verifyPostconditions:async()=> options.postconditions ?? true,
          centralEvidenceComplete:async()=> options.centralEvidence ?? true,
        });
        if (options.escape) throw new Error('UNIT host shutdown');
        return result;
      } };
      return { capability,calls,worker:createExecutionWorker(sql,capability,{ allowUnitSynthetic:true,...options.workerOptions }) };
    };
    await t.test('explicit host boundary and complete immutable statement sequence',async()=>{
      assert.throws(()=>createExecutionWorker(sql,{ workerId:'unit',scope,withTarget(){} }),/unavailable/);
      assert.throws(()=>host({ workerOptions:{ leaseSeconds:0 } }),/unavailable/);
      const id=await request(); const h=host();
      const candidate=await sql.begin(tx=>readExecutionRequest(tx,id));
      const expected=await materializeExecutionRequest(candidate); assert.equal(expected.statements.length,5);
      assert.equal(await h.worker.runWaitingRequest(id),'VERIFIED_SUCCESS');
      assert.deepEqual(h.calls,expected.statements.map(s=>Buffer.from(s.bytes)));
      assert.deepEqual(h.calls.map(bytes=>bytes.toString('utf8').trim()),[
        '-- café retained bytes\nCREATE TABLE envelope_0 (id NUMBER)',
        'CREATE TABLE envelope_1 (id NUMBER)','CREATE TABLE envelope_2 (id NUMBER)',
        'CREATE TABLE second_envelope (id NUMBER)','CREATE TABLE last_envelope (id NUMBER)',
      ],'actual dispatch preserves reviewed Unicode/comment/order and removes only parser-recognized delimiters');
      assert.equal(await jobState(id),'VERIFIED_SUCCESS'); assert.deepEqual(await counts(id),{ proofs:1,attempts:1,receipts:5 });
      const proof=(await sql`SELECT * FROM sf_execution_admission_proofs WHERE job_id=${id}`)[0];
      assert.equal(proof.scope,scope); assert.equal(proof.authorized_credential_id,candidate.job.request_credential_id);
      assert.equal(proof.host_binding.metadataGenerationId,candidate.generationId);
      assert.equal(proof.host_binding.statementManifestDigest,expected.statementManifestDigest);
      await assert.rejects(sql`UPDATE sf_execution_admission_proofs SET host_binding='{}'::jsonb WHERE job_id=${id}`,/immutable/);
      const history=await f.api('GET',`/api/execution-jobs/${id}/attempts`);
      assert.equal(history.statusCode,200); assert.equal(history.json().evidenceScope,scope);
      assert.equal(history.json().executionAuthority,false); assert.equal(history.json().attempts[0].state,'VERIFIED_SUCCESS');
      assert.equal(history.body.includes('vault://'),false); assert.equal(history.body.includes('lease_token'),false);
      assert.equal(await h.worker.runWaitingRequest(id),'ADMISSION_DECLINED'); assert.equal(h.calls.length,5);
      assert.equal(await h.worker.recoverExpired(id),'NOT_RECOVERED');
      assert.equal((await sql`SELECT execution,history_status,planning_scope FROM sf_plans WHERE id=${plan.id}`)[0].planning_scope,'OFFLINE_CANDIDATE');
    });
    await t.test('exact applied history is a witnessed NOOP; partial/malformed history is held',async()=>{
      const id=await request(),h=host({ historyState:'EXACT_APPLIED' });
      assert.equal(await h.worker.runWaitingRequest(id),'NOOP'); assert.equal(h.calls.length,0);
      assert.deepEqual(await counts(id),{ proofs:1,attempts:1,receipts:0 });
      for (const options of [{ historyState:'EXACT_APPLIED',postconditions:false },{ historyState:'EXACT_APPLIED',centralEvidence:false },
        { observation:{ historyState:'PARTIAL' } },{ observation:{ pendingStatementDigests:[digest] } },
        { observation:{ scope:'TRUSTED_VALIDATED' } },{ observation:{ targetAssignmentId:randomUUID() } },{ current:()=>false }]) {
        const id=await request(),h=host(options);
        const expected = options.observation?.targetAssignmentId ? 'ADMISSION_DECLINED' : 'HOLD';
        assert.equal(await h.worker.runWaitingRequest(id),expected);
        assert.equal(h.calls.length,0); assert.equal(await jobState(id),expected === 'HOLD' ? 'HOLD' : 'WAITING_VALIDATION');
        assert.deepEqual(await counts(id),{ proofs:0,attempts:0,receipts:0 });
      }
    });
    await t.test('unknown result, missing receipt, permit loss and invalid postconditions stop with HOLD',async()=>{
      for (const [options,expectedCalls] of [[{ outcome:'UNKNOWN' },1],[{ receiptGap:true },1],
        [{ current:n=>n===0 },1],[{ postconditions:false },5],[{ centralEvidence:false },0]]) {
        const id=await request(),h=host(options);
        assert.equal(await h.worker.runWaitingRequest(id),'HOLD'); assert.equal(h.calls.length,expectedCalls);
        assert.equal(await jobState(id),'HOLD'); assert.equal((await counts(id)).attempts,options.centralEvidence===false ? 0 : 1);
        assert.equal(await h.worker.runWaitingRequest(id),'ADMISSION_DECLINED'); assert.equal(h.calls.length,expectedCalls);
      }
    });
    await t.test('grant/source/assignment mutation before admission leaves no proof; revocation after an effect stops',async()=>{
      const id=await request(),h=host({ beforeObservation:()=>f.membership.deployRevoke(f.project.id,f.actors[0].id) });
      assert.equal(await h.worker.runWaitingRequest(id),'ADMISSION_DECLINED'); assert.deepEqual(await counts(id),{ proofs:0,attempts:0,receipts:0 });
      await f.membership.deployGrant(f.project.id,f.actors[0].id);
      const source=(await sql`SELECT source_binding_generation FROM sf_projects WHERE id=${f.project.id}`)[0].source_binding_generation;
      const changed=await request(),changedHost=host({ beforeObservation:()=>sql`UPDATE sf_projects SET source_binding_generation=source_binding_generation+1 WHERE id=${f.project.id}` });
      assert.equal(await changedHost.worker.runWaitingRequest(changed),'ADMISSION_DECLINED'); assert.equal(changedHost.calls.length,0);
      assert.deepEqual(await counts(changed),{ proofs:0,attempts:0,receipts:0 });
      await sql`UPDATE sf_projects SET source_binding_generation=${source} WHERE id=${f.project.id}`;
      const revoked=await request(),revokedHost=host({ afterExecute:()=>f.membership.deployRevoke(f.project.id,f.actors[0].id) });
      assert.equal(await revokedHost.worker.runWaitingRequest(revoked),'HOLD'); assert.equal(revokedHost.calls.length,1);
      assert.equal(await jobState(revoked),'HOLD'); await f.membership.deployGrant(f.project.id,f.actors[0].id);
      const moved=await request(),moving=host({ beforeObservation:()=>assignReference(sql,{ schemaId:reference.schemaId,projectId:null,expectedRevision:'1',reason:'UNIT assignment withdrawn' }) });
      assert.equal(await moving.worker.runWaitingRequest(moved),'ADMISSION_DECLINED'); assert.equal(moving.calls.length,0);
      await assignReference(sql,{ schemaId:reference.schemaId,projectId:f.project.id,expectedRevision:'2',reason:'UNIT restore explicit assignment' });
      assignment=(await sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND closed_at IS NULL`)[0].id;
    });
    await t.test('schema contention does not hold global governance and assignment/API work completes',async()=>{
      const id=await request(),h=host(); let release,locked;
      const ready=new Promise(resolve=>{ locked=resolve; });
      const blocker=sql.begin(async tx=>{
        await acquireExecutionTarget(tx,assignment); locked(); await new Promise(resolve=>{ release=resolve; });
      });
      await ready;
      let work;
      try {
        work=h.worker.runWaitingRequest(id);
        let waiting=false;
        for(let i=0;i<100;i++) {
          waiting=Boolean((await sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)[0]);
          if(waiting) break; await delay(25);
        }
        assert.equal(waiting,true,'worker reached target lock contention');
        const free=await sql.begin(async tx=>(await tx`SELECT pg_try_advisory_xact_lock(1397112658,2) AS free`)[0].free);
        assert.equal(free,true,'worker must wait on schema before global');
        await f.membership.deployRevoke(f.project.id,f.actors[0].id);
        release(); await blocker;
        assert.equal(await work,'ADMISSION_DECLINED'); assert.equal(h.calls.length,0);
        await f.membership.deployGrant(f.project.id,f.actors[0].id);
      } finally { release?.(); await blocker; if(work) await work; }
    });
    await t.test('concurrent declaration service/schema locks serialize before execution and governance',async()=>{
      const id=await request(),h=host(); let enter,release;
      const entered=new Promise(resolve=>{ enter=resolve; });
      const wrappedSql=new Proxy(sql,{ get(target,key) {
        if(key!=='begin') return Reflect.get(target,key);
        return callback=>target.begin(tx=>callback(new Proxy(tx,{ apply(fn,thisArg,args) {
          const query=Reflect.apply(fn,thisArg,args);
          if(Array.isArray(args[0]) && args[0].join('').includes('FROM sf_reference_services') && args[0].join('').includes('FOR UPDATE'))
            return query.then(async rows=>{ enter(); await new Promise(resolve=>{ release=resolve; }); return rows; });
          return query;
        } })));
      } });
      const declaring=declareReference(wrappedSql,declaration); await entered;
      const work=h.worker.runWaitingRequest(id);
      try {
        let waiting=false;
        for(let i=0;i<200;i++) {
          waiting=Boolean((await sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)[0]);
          if(waiting) break; await delay(25);
        }
        assert.equal(waiting,true,'execution waits for declaration before schema/service rows');
        const free=await sql.begin(async tx=>(await tx`SELECT pg_try_advisory_xact_lock(1397112658,2) AS free`)[0].free);
        assert.equal(free,true,'catalog contention never holds governance');
      } finally { release?.(); await declaring; }
      assert.equal(await work,'VERIFIED_SUCCESS'); assert.equal(h.calls.length,5);
    });
    await t.test('revocation waits for the guarded target call and prevents the next statement',async()=>{
      const id=await request(); let enter,release;
      const entered=new Promise(resolve=>{ enter=resolve; });
      const h=host({ duringExecute:async ordinal=>{ if(ordinal===1) { enter(); await new Promise(resolve=>{ release=resolve; }); } } });
      const work=h.worker.runWaitingRequest(id); await entered;
      // Invoke the real mutation on the already initialized fixture: CLI startup
      // DDL also blocks, but this test specifically checks the governance lock.
      const revoke=applyLocalMembershipAction(sql,{ action:'deploy-revoke',projectId:f.project.id,actorId:f.actors[0].id });
      try {
        let waiting=false;
        for(let i=0;i<100;i++) {
          waiting=Boolean((await sql`SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)[0]);
          if(waiting) break; await delay(25);
        }
        assert.equal(waiting,true,'revocation is serialized against an in-flight target call');
        assert.equal((await sql`SELECT revoked_at IS NULL AS active FROM sf_project_deploy_grants WHERE project_id=${f.project.id} AND actor_id=${f.actors[0].id} ORDER BY granted_at DESC LIMIT 1`)[0].active,true);
      } finally { release?.(); await revoke; await work; await f.membership.deployGrant(f.project.id,f.actors[0].id); }
      assert.equal(await work,'HOLD'); assert.equal(h.calls.length,1);
    });
    await t.test('lost admission COMMIT acknowledgement recovers expiry to HOLD without target calls or another claim',async()=>{
      const id=await request(),h=host();
      const ambiguousSql=new Proxy(sql,{ get(target,key) {
        if(key!=='begin') return Reflect.get(target,key);
        return async callback=>{ const result=await target.begin(callback); if(result?.attemptId) throw new Error('UNIT lost COMMIT acknowledgement'); return result; };
      } });
      const worker=createExecutionWorker(ambiguousSql,h.capability,{ allowUnitSynthetic:true,leaseSeconds:1 });
      assert.equal(await worker.runWaitingRequest(id),'HOLD_PERSISTENCE_PENDING');
      assert.equal(await jobState(id),'ADMITTED'); assert.equal(h.calls.length,0); assert.deepEqual(await counts(id),{ proofs:1,attempts:1,receipts:0 });
      await delay(1100);
      assert.equal(await worker.recoverExpired(id),'HOLD'); assert.equal(await worker.recoverExpired(id),'NOT_RECOVERED');
      assert.equal(await worker.runWaitingRequest(id),'ADMISSION_DECLINED'); assert.equal(h.calls.length,0);
      assert.equal((await counts(id)).attempts,1);
      assert.equal(await createExecutionJobStore(sql,'unit-controlled-worker').claim(id),null);
    });
    await t.test('legacy requests are read-only and browser child authority includes its parent lifecycle',async()=>{
      const original=await request();
      const clone=async credentialId=>{
        const id=randomUUID();
        await sql`INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,
          request_credential_id,idempotency_key,payload_digest,reason,state,readiness)
          SELECT ${id},organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,${credentialId},
          ${randomUUID()},payload_digest,'UNIT credential lifecycle fixture','WAITING_VALIDATION',readiness
          FROM sf_execution_jobs WHERE id=${original}`;
        return id;
      };
      const legacy=await clone(null),legacyHost=host();
      assert.equal(await legacyHost.worker.runWaitingRequest(legacy),'ADMISSION_DECLINED');
      assert.equal((await f.api('GET',`/api/execution-jobs/${legacy}`)).statusCode,200);
      const parent=(await sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at)
        VALUES(${f.actors[0].id},${hash(randomUUID())},now(),now()+interval '24 hours') RETURNING id`)[0].id;
      const child=(await sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at)
        VALUES(${f.actors[0].id},${hash(randomUUID())},now(),now()+interval '30 minutes',
          'BROWSER',${parent},now()+interval '1 hour') RETURNING id`)[0].id;
      const browser=await clone(child),browserHost=host({ afterExecute:()=>sql`UPDATE sf_local_credentials SET issued_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE id=${parent}` });
      assert.equal(await browserHost.worker.runWaitingRequest(browser),'HOLD'); assert.equal(browserHost.calls.length,1);
      const expired=await clone(child),expiredHost=host();
      assert.equal(await expiredHost.worker.runWaitingRequest(expired),'ADMISSION_DECLINED'); assert.equal(expiredHost.calls.length,0);
      assert.deepEqual(await counts(expired),{ proofs:0,attempts:0,receipts:0 });
    });
    await t.test('credential revocation after possible effect preserves receipts and halts later dispatch',async()=>{
      const id=await request(),h=host({ afterExecute:()=>sql`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${f.actors[0].id}` });
      assert.equal(await h.worker.runWaitingRequest(id),'HOLD'); assert.equal(h.calls.length,1);
      assert.equal((await counts(id)).receipts,1); assert.equal(await jobState(id),'HOLD');
      assert.equal(await h.worker.runWaitingRequest(id),'ADMISSION_DECLINED');
      assert.equal((await f.api('GET',`/api/execution-jobs/${id}/attempts`)).statusCode,401);
    });
    await t.test('restore generation stops dispatch and preserves unresolved metadata until recovery',async()=>{
      const credential=(await sql`SELECT id FROM sf_local_credentials WHERE actor_id=${f.actors[0].id} AND credential_kind='LOCAL' ORDER BY issued_at LIMIT 1`)[0].id;
      // Retained history remains revoked: make a fresh credential explicitly for this UNIT fixture.
      const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-',''); f.actors[0].token=token;
      await sql`INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at)
        VALUES(${f.actors[0].id},${hash(token)},now(),now()+interval '24 hours')`;
      const id=await request(true),generation=randomUUID();
      const h=host({ afterExecute:async()=>{
        await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${generation},'RESTORE_HOLD',${digest},0)`;
        await sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
      } });
      assert.equal(await h.worker.runWaitingRequest(id),'HOLD_PERSISTENCE_PENDING'); assert.equal(h.calls.length,1);
      assert.equal(await jobState(id),'ADMITTED'); assert.equal(await h.worker.recoverExpired(id),'NOT_RECOVERED');
      assert.equal(await h.worker.runWaitingRequest(id),'ADMISSION_DECLINED');
      assert.equal((await f.api('GET',`/api/execution-jobs/${id}/attempts`)).statusCode,200);
      assert.equal((await sql`SELECT revoked_at IS NOT NULL AS revoked FROM sf_local_credentials WHERE id=${credential}`)[0].revoked,true);
    });
  } finally { await f.close(); }
});
