import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createTargetWorkflowFixture } from './helpers/target-workflow-fixture.mjs';
import { readExecutionRequest } from '../packages/execution/admission.ts';

test('target-bound plans retain immutable format-3 evidence and fail closed across stale or unauthorized workflow steps', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL,
  timeout: 180_000,
}, async () => {
  const f = await createTargetWorkflowFixture();
  try {
    const { actors, base, foreignBase, assignment, option, api, createBinding, makePlan, decide, setBindingToOption, db } = f;
    assert.equal((await f.app.inject({method:'GET',url:`${base}/target-bindings`})).statusCode,401);
    const unauthorizedBinding = await createBinding({}, actors[2]);
    assert.equal(unauthorizedBinding.statusCode, 404, 'non-members cannot create bindings');

    const bindingResponse = await createBinding();
    assert.equal(bindingResponse.statusCode, 201, bindingResponse.body);
    const binding = bindingResponse.json().binding;
    assert.equal(binding.bindingRevision, '1');
    const foreignBindings = await api('GET', `${foreignBase}/target-bindings`);
    assert.equal(foreignBindings.statusCode, 200, foreignBindings.body);
    assert.deepEqual(foreignBindings.json().bindings, [], 'binding lists stay scoped to their owning project');
    const crossProjectBinding = await api('GET', `${foreignBase}/target-bindings/${binding.bindingId}`);
    assert.equal(crossProjectBinding.statusCode, 404, 'a binding is invisible outside its owning project');
    const crossProjectPlan = await api('POST', `${foreignBase}/plans`, { intentVersion: 2, releaseId: f.release.id,
      assignmentId: assignment.id, expectedAssignmentRevision: '1', targetBindingId: binding.bindingId,
      expectedBindingRevision: '1' });
    assert.equal(crossProjectPlan.statusCode, 404, 'a binding from another project cannot authorize a plan');

    const planResponse = await makePlan(binding);
    assert.equal(planResponse.statusCode, 201, planResponse.body);
    const plan = planResponse.json().plan;
    assert.equal(plan.offlineIntent.format, 3);
    const target = plan.offlineIntent.target ?? plan.retainedTarget;
    assert.equal(target.bindingId, binding.bindingId);
    assert.equal(target.assignmentId, assignment.id);
    assert.equal(target.bindingRevision, '1');
    assert.equal(target.assignmentRevision, '1');
    assert.equal(target.identityState, 'PROVISIONAL');
    assert.equal(target.observationDigest, null);
    assert.equal(JSON.stringify(plan).includes(f.credentialRef), false, 'private principal reference never leaves the API');
    const stored = (await db.sql`SELECT offline_intent_envelope,offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0];
    const originalEnvelope = stored.offline_intent_envelope;
    const originalDigest = stored.offline_intent_digest;
    const roundTrip = await api('GET', `${base}`);
    assert.equal(roundTrip.statusCode, 200);
    const listed = roundTrip.json().plans.find((item) => item.id === plan.id);
    assert.equal(listed.offlineIntent.digest, plan.offlineIntent.digest);
    assert.equal((listed.offlineIntent.target ?? listed.retainedTarget).bindingRevision, '1');

    const selfPlan = await makePlan(binding, actors[1]);
    assert.equal(selfPlan.statusCode, 201, selfPlan.body);
    const selfApproval = await decide(selfPlan.json().plan, actors[1]);
    assert.equal(selfApproval.statusCode, 403);
    assert.equal(selfApproval.json().error, 'SELF_APPROVAL_DENIED');
    const staleExpected = await decide(plan, actors[1], { expectedIntentDigest: '0'.repeat(64) });
    assert.equal(staleExpected.statusCode, 409);
    assert.equal(staleExpected.json().error, 'FRESH_PLAN_REQUIRED');

    const tamperedTuple = JSON.parse(originalEnvelope);
    tamperedTuple[22][15] = `${tamperedTuple[22][15]} changed`;
    await db.sql`UPDATE sf_plans SET offline_intent_envelope=${JSON.stringify(tamperedTuple)} WHERE id=${plan.id}`;
    const integrityFailure = await decide(plan, actors[1]);
    assert.equal(integrityFailure.statusCode, 409);
    assert.equal(integrityFailure.json().error, 'PLAN_APPROVAL_INTEGRITY_FAILED');
    await db.sql`UPDATE sf_plans SET offline_intent_envelope=${originalEnvelope} WHERE id=${plan.id}`;
    assert.equal((await db.sql`SELECT offline_intent_digest FROM sf_plans WHERE id=${plan.id}`)[0].offline_intent_digest, originalDigest);

    const rejected = await decide(plan, actors[1], {decision:'REJECT',reason:'Retained target requires another release'});
    assert.equal(rejected.statusCode,200,rejected.body);
    assert.equal(rejected.json().plan.status,'REJECTED');
    assert.equal(rejected.json().plan.offlineIntent.digest,originalDigest);
    const bindingStalePlan = (await makePlan(binding)).json().plan;
    const nextBinding = await setBindingToOption({ bindingId: binding.bindingId, expectedBindingRevision: '1',
      targetOptionId: option.optionId, expectedTargetOptionRevision: option.optionRevision });
    assert.equal(nextBinding.statusCode, 201, nextBinding.body);
    const staleBindingDecision = await decide(bindingStalePlan, actors[1]);
    assert.equal(staleBindingDecision.statusCode, 409);
    assert.equal(staleBindingDecision.json().error, 'FRESH_PLAN_REQUIRED');

    const currentBinding = nextBinding.json().binding;
    const optionStalePlan = (await makePlan(currentBinding)).json().plan;
    const changedOption = await db.sql.begin((tx) => import('../packages/targets/index.ts').then(({ configureTargetOption }) =>
      configureTargetOption(tx, { ...f.optionDefinition(), optionId: option.optionId, expectedOptionRevision: option.optionRevision,
        routeAlias: 'Updated workflow route', reason: 'advance configured target option' })));
    assert.equal(changedOption.optionRevision, '2');
    const staleOptionDecision = await decide(optionStalePlan, actors[1]);
    assert.equal(staleOptionDecision.statusCode, 409);
    assert.equal(staleOptionDecision.json().error, 'FRESH_PLAN_REQUIRED');

    const updatedBindingResponse = await setBindingToOption({ bindingId: binding.bindingId, expectedBindingRevision: '2',
      targetOptionId: option.optionId, expectedTargetOptionRevision: changedOption.optionRevision });
    assert.equal(updatedBindingResponse.statusCode, 201, updatedBindingResponse.body);
    const sourceStalePlan = (await makePlan(updatedBindingResponse.json().binding)).json().plan;
    const sourceChange = await api('PUT', `${base}/source`, { repositoryId: f.repositories[1].id, folder: 'migrations' });
    assert.equal(sourceChange.statusCode, 200, sourceChange.body);
    const staleSourceDecision = await decide(sourceStalePlan, actors[1]);
    assert.equal(staleSourceDecision.statusCode, 409);
    assert.equal(staleSourceDecision.json().error, 'FRESH_PLAN_REQUIRED');

    const sourceRestore = await api('PUT', `${base}/source`, { repositoryId: f.repositories[0].id, folder: 'migrations' });
    assert.equal(sourceRestore.statusCode, 200, sourceRestore.body);
    await f.membership.grant(f.project.id, actors[2].id);
    await f.membership.deployGrant(f.project.id, actors[2].id);
    const freshBinding = await setBindingToOption({ bindingId: binding.bindingId, expectedBindingRevision: '3',
      targetOptionId: option.optionId, expectedTargetOptionRevision: changedOption.optionRevision });
    assert.equal(freshBinding.statusCode, 201, freshBinding.body);
    const requestPlan = (await makePlan(freshBinding.json().binding)).json().plan;
    const approved = await decide(requestPlan, actors[1]);
    assert.equal(approved.statusCode, 200, approved.body);
    const requestTarget = requestPlan.offlineIntent.target ?? requestPlan.retainedTarget;
    const request = { idempotencyKey: `target-workflow-${randomUUID()}`, reason: 'Request retained target validation',
      expectedIntentDigest: requestPlan.offlineIntent.digest,
      expectedAssignmentRevision: requestTarget.assignmentRevision,
      expectedBindingRevision: requestTarget.bindingRevision };
    const deployDenied=await api('POST',`/api/plans/${requestPlan.id}/execution`,request,actors[0]);
    assert.equal(deployDenied.statusCode,403);
    assert.equal(deployDenied.json().error,'DEPLOY_PERMISSION_REQUIRED');
    const requested = await api('POST', `/api/plans/${requestPlan.id}/execution`, request, actors[2]);
    assert.equal(requested.statusCode, 201, requested.body);
    const duplicate = await api('POST', `/api/plans/${requestPlan.id}/execution`, request, actors[2]);
    assert.equal(duplicate.statusCode, 200, duplicate.body);
    assert.equal(duplicate.json().job.id, requested.json().job.id);
    const conflict = await api('POST', `/api/plans/${requestPlan.id}/execution`, { ...request, reason: 'Changed idempotent reason' }, actors[2]);
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await db.sql.begin((tx) => readExecutionRequest(tx, requested.json().job.id)), null,
      'the worker admission API rejects format-3 provisional target plans');

    for (const url of [`${base}/plans/${requestPlan.id}/record`,`/api/execution-jobs/${requested.json().job.id}/record`]) {
      const record=await api('GET',url);
      assert.equal(record.statusCode,200,record.body);
      const bundle=record.json();assert.equal(bundle.format,2);
      assert.equal(createHash('sha256').update(bundle.record).digest('hex'),bundle.sha256);
      assert.doesNotMatch(bundle.record,/vault:\/\/|privatePrincipalRef|credentialRef/);
    }
    const advancedAfterApproval=await setBindingToOption({bindingId:binding.bindingId,expectedBindingRevision:'4',targetOptionId:option.optionId,expectedTargetOptionRevision:changedOption.optionRevision});
    assert.equal(advancedAfterApproval.statusCode,201,advancedAfterApproval.body);
    const staleRequest=await api('POST',`/api/plans/${requestPlan.id}/execution`,{...request,idempotencyKey:randomUUID()},actors[2]);
    assert.equal(staleRequest.statusCode,409);assert.equal(staleRequest.json().error,'FRESH_PLAN_REQUIRED');
    const cancelled=await api('POST',`/api/execution-jobs/${requested.json().job.id}/cancel`,{expectedRevision:0},actors[2]);
    assert.equal(cancelled.statusCode,200,cancelled.body);
    const auditBeforeRestart = await db.sql`SELECT action FROM sf_audit WHERE project_id=${f.project.id} ORDER BY created_at,id`;
    assert.ok(auditBeforeRestart.some((row) => row.action === 'PLAN_CREATED'));
    assert.ok(auditBeforeRestart.some((row) => row.action === 'PLAN_APPROVED'));
    assert.ok(auditBeforeRestart.some((row) => row.action === 'EXECUTION_REQUESTED'));
    await f.restart();
    const persisted = await f.api('GET', `/api/projects/${f.project.id}`);
    assert.equal(persisted.statusCode, 200);
    assert.ok(persisted.json().plans.some((item) => item.id === requestPlan.id && item.offlineIntent.format === 3));
    assert.ok(persisted.json().history.some((row) => row.planId === requestPlan.id));
    const auditAfterRestart = await db.sql`SELECT action FROM sf_audit WHERE project_id=${f.project.id} ORDER BY created_at,id`;
    assert.deepEqual(auditAfterRestart.map((row) => row.action), auditBeforeRestart.map((row) => row.action));
  } finally {
    await f.close();
  }
});


test('target binding commit rechecks a project grant revoked while catalog serialization is queued', {
  skip:!process.env.SCHEMAFORGE_TEST_DATABASE_URL,timeout:60000,
},async()=>{
  const f=await createTargetWorkflowFixture();let release, blocked, request;
  try {
    let entered;const held=new Promise(resolve=>{entered=resolve;});
    blocked=f.db.sql.begin(async tx=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${f.reference.schemaId},29))`;
      entered();await new Promise(resolve=>{release=resolve;});
    });
    await held;request=f.createBinding();
    let queued=false;
    for(let i=0;i<100;i++) {
      queued=Boolean((await f.db.sql`SELECT 1 FROM pg_locks WHERE NOT granted AND locktype='advisory'
        AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)[0]);
      if(queued)break;await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(queued,true,'target mutation waits outside global governance');
    await f.membership.revoke(f.project.id,f.actors[0].id);
    release();await blocked;
    const denied=await request;assert.equal(denied.statusCode,404,denied.body);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_target_bindings`)[0].n,0);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_audit WHERE action='TARGET_BINDING_CREATED'`)[0].n,0);
  } finally {release?.();await blocked;await request;await f.close();}
});
