// Actual native HTTPS/WASM form flow. Operator facts are private fixtures only;
// no Oracle observation, connection, verification or execution is performed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

export async function targetBindingBrowser({page,api,sql,actor,reviewer,token,reviewerToken,origin}){
  const url=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
  if(!url?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private native cluster required');
  const created=await api.post('/api/projects',{data:{name:'Native target binding browser'}});
  assert.equal(created.status(),201,await created.text());const project=(await created.json()).project.id;
  const org='00000000-0000-4000-8000-000000000001';
  for(const actorId of [actor,reviewer])await sql`INSERT INTO sf_project_grants(id,organization_id,project_id,actor_id,grant_os_uid) VALUES(${randomUUID()},${org},${project},${actorId},1000)`;
  const environment=await api.post(`/api/projects/${project}/environments`,{data:{name:'Target Development'}});
  assert.equal(environment.status(),201,await environment.text());
  const input=JSON.parse(execFileSync(process.execPath,['scripts/seed-rust-fixture.mjs','option'],{env:{...process.env,KELRYVO_RUST_TEST_PROJECT_ID:project},encoding:'utf8',stdio:['ignore','pipe','pipe']}));
  assert.equal((await api.post(`/api/projects/${project}/environments`,{data:{name:'Other target environment'}})).status(),201);
  const open=async()=>{
    await page.getByRole('button',{name:'Projects',exact:true}).click();
    await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Native target binding browser',exact:true})}).getByRole('button',{name:'Open project',exact:true}).click();
    await page.getByRole('button',{name:'Targets',exact:true}).click();
    await page.getByRole('region',{name:'Project targets',exact:true}).waitFor();
    await page.locator('#root[aria-busy="false"]').waitFor();
  };
  const choose=async binding=>{
    await page.getByLabel('Assigned schema',{exact:true}).selectOption(input.assignmentId);
    await page.locator('#root[aria-busy="false"]').waitFor();
    await page.getByLabel('Target option',{exact:true}).selectOption(input.targetOptionId);
    assert.equal(await page.getByLabel('Target environment',{exact:true}).inputValue(),'','environment requires an explicit selection');
    assert.equal(await page.getByLabel('Target environment',{exact:true}).locator('option').count(),2,'only the option environment is eligible');
    await page.getByLabel('Target environment',{exact:true}).selectOption(input.environmentId);
    if(binding)await page.getByLabel('Binding to revise',{exact:true}).selectOption(binding);
  };
  const detail=()=>page.getByRole('region',{name:'Binding detail',exact:true});
  const save=()=>page.getByRole('button',{name:'Create binding revision',exact:true}).click();
  const saved=()=>page.getByRole('status').filter({hasText:'Binding revision retained.'}).waitFor();
  const facts=async()=>({
    heads:await sql`SELECT id,current_revision::text revision FROM sf_target_bindings WHERE project_id=${project}`,
    revisions:await sql`SELECT to_jsonb(r) facts FROM sf_target_binding_revisions r WHERE project_id=${project} ORDER BY revision`,
    audit:await sql`SELECT actor_id,facts FROM sf_audit WHERE project_id=${project} AND action='TARGET_BINDING_CREATED' ORDER BY created_at,id`,
    jobs:await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`,
  });
  await open();
  await page.getByLabel('Binding reason',{exact:true}).fill('Reason survives dependent choices');
  await choose();assert.equal(await page.getByLabel('Binding reason',{exact:true}).inputValue(),'Reason survives dependent choices');
  const reason='Native binding Tiếng Việt 😀 </textarea><script>window.targetBindingCanary=true</script>';
  await page.getByLabel('Binding reason',{exact:true}).fill(reason);await save();await saved();
  let state=await facts();assert.equal(state.heads.length,1);assert.equal(state.heads[0].revision,'1');
  const binding=state.heads[0].id,initial=state.revisions[0].facts;
  assert.equal(state.audit.length,1);assert.equal(state.audit[0].actor_id,actor);assert.equal(state.audit[0].facts.reason,reason);
  assert.equal(await page.getByLabel('Binding to revise',{exact:true}).inputValue(),binding);
  assert.equal(await page.getByLabel('Binding reason',{exact:true}).inputValue(),'');
  assert.match(await detail().innerText(),/Currentness:/);assert.equal(await detail().locator('script').count(),0);
  assert.equal(await page.evaluate(()=>window.targetBindingCanary),undefined);
  assert.doesNotMatch(await page.locator('body').innerText(),/secret:\/\/native\/fixture|privatePrincipalRef|credentialRef/);
  await page.getByRole('button',{name:'Inspect binding',exact:true}).click();
  await detail().getByText('Binding revision history (latest 50)',{exact:true}).waitFor();
  assert.match(await detail().innerText(),new RegExp(reason.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const external=await api.post(`/api/projects/${project}/target-bindings`,{data:{...input,bindingId:binding,expectedBindingRevision:'1',reason:'Concurrent independent revision'}});
  assert.equal(external.status(),201,await external.text());
  await page.getByLabel('Binding reason',{exact:true}).fill('Explicit retry after reviewing conflict');
  await save();await page.getByRole('alert').filter({hasText:'The target revision changed.'}).waitFor();
  state=await facts();assert.equal(state.heads[0].revision,'2');assert.equal(state.revisions.length,2);assert.equal(state.audit.length,2);
  assert.equal(await page.getByLabel('Binding reason',{exact:true}).inputValue(),'Explicit retry after reviewing conflict');
  await page.getByRole('button',{name:'Refresh targets',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Target facts refreshed.'}).waitFor();
  await choose(binding);assert.equal((await facts()).heads[0].revision,'2','refresh never submits a mutation');
  await save();await saved();state=await facts();assert.equal(state.heads[0].revision,'3');assert.equal(state.audit.length,3);
  assert.deepEqual(state.revisions[0].facts,initial,'the first binding revision remains immutable');
  await page.getByRole('button',{name:'Inspect binding',exact:true}).click();
  await detail().getByText('Binding revision history (latest 50)',{exact:true}).waitFor();
  assert.equal(await detail().locator('li').count(),3);
  await detail().getByRole('button',{name:'Open SQL Workspace for this target',exact:true}).click();
  assert.equal(await page.getByLabel('Database target',{exact:true}).inputValue(),binding);
  // Returning to targets requires explicit discard of the preselected unsaved draft.
  await page.getByRole('button',{name:'Discard unsaved edits',exact:true}).click();
  await page.getByRole('button',{name:'Targets',exact:true}).click();
  await page.locator('#root[aria-busy="false"]').waitFor();
  const signIn=async selectedToken=>{
    await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await page.getByText('Use an operator access token',{exact:true}).click();
    await page.getByLabel('Access token',{exact:true}).fill(selectedToken);
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  };
  await signIn(reviewerToken);await open();
  assert.equal(await page.getByRole('button',{name:'Create binding revision',exact:true}).isDisabled(),true,'reviewers cannot mutate target bindings');
  await page.getByRole('button',{name:'Inspect binding',exact:true}).click();await detail().waitFor();
  await signIn(token);await open();
  const original=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
  const hold=randomUUID();
  await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'d'.repeat(64)},1000)`;
  try{
    await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
    await page.getByRole('button',{name:'Refresh targets',exact:true}).click();await page.getByRole('status').filter({hasText:'Target facts refreshed.'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Create binding revision',exact:true}).isDisabled(),true,'RESTORE_HOLD keeps the form read-only');
    await page.getByRole('button',{name:'Inspect binding',exact:true}).click();await detail().waitFor();
  }finally{await sql`UPDATE sf_metadata_current SET generation_id=${original} WHERE singleton`;}
  await page.getByRole('button',{name:'Refresh targets',exact:true}).click();await page.getByRole('status').filter({hasText:'Target facts refreshed.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Create binding revision',exact:true}).isDisabled(),false);
  assert.equal((await api.post(`/api/projects/${project}/archive`,{data:{reason:'Finish isolated binding UI fixture'}})).status(),200);
  await page.getByRole('button',{name:'Refresh targets',exact:true}).click();await page.getByRole('status').filter({hasText:'Target facts refreshed.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Create binding revision',exact:true}).isDisabled(),true,'archived projects remain readable without binding writes');
  state=await facts();assert.equal(state.audit.length,3);assert.equal(state.jobs[0].n,0);
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
