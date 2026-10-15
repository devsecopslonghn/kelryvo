import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { statementEnvelopeFixture } from './helpers/statement-envelope-fixture.mjs';
import { readExecutionRequest } from '../packages/execution/admission.ts';

test('approval policy is explicit, retained and enforced at API and worker checkpoints',{skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:120000},async()=>{
 const f=await statementEnvelopeFixture({firstStatementCount:1,includeSecond:false});
 try {
  const sql=f.db.sql;
  // An environment called DEV still requires independent review until an administrator configures otherwise.
  await sql`UPDATE sf_environments SET name='DEV' WHERE id=${f.profile.environmentId}`;
  const plan=await f.makePlan();
  let result=await f.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Self decision denied by default'},f.actors[0]);
  assert.equal(result.statusCode,403);
  await sql`UPDATE sf_environments SET approval_required=false,independent_approval=false WHERE id=(SELECT environment_id FROM sf_profiles WHERE id=${f.profile.id})`;
  result=await f.api('POST',`/api/plans/${plan.id}/decision`,{decision:'APPROVE',reason:'Explicit direct deployment authorization'},f.actors[0]);
  assert.equal(result.statusCode,200,result.body);assert.equal(result.json().plan.decidedBy,f.actors[0].id);
  assert.equal((await sql`SELECT sf_plan_approval_satisfied(${plan.id}) AS ok`)[0].ok,true);
  await assert.rejects(sql`UPDATE sf_plan_policy_decisions SET independent_approval=true WHERE plan_id=${plan.id}`);
  await f.membership.deployGrant(f.project.id,f.actors[0].id);
  const queued=await f.api('POST',`/api/plans/${plan.id}/execution`,{idempotencyKey:randomUUID(),reason:'Explicitly configured direct request'});
  assert.equal(queued.statusCode,201,queued.body);
  const job=queued.json().job.id;
  const candidate=()=>sql.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;return readExecutionRequest(tx,job);});
  assert.ok(await candidate(),'worker accepts explicitly configured direct plan authority');
  await sql`UPDATE sf_environments SET approval_required=true,independent_approval=true WHERE id=(SELECT environment_id FROM sf_profiles WHERE id=${f.profile.id})`;
  assert.equal((await sql`SELECT sf_plan_approval_satisfied(${plan.id}) AS ok`)[0].ok,false);
  assert.equal(await candidate(),null,'tightened policy invalidates queued self-authorized execution');
  // Existing independent approvals continue to work after policy tightening.
  const independent=await f.makePlan();
  assert.equal((await f.api('POST',`/api/plans/${independent.id}/decision`,{decision:'APPROVE',reason:'Independent retained review'},f.actors[1])).statusCode,200);
  assert.equal((await sql`SELECT sf_plan_approval_satisfied(${independent.id}) AS ok`)[0].ok,true);
 }finally{await f.close();}
});
