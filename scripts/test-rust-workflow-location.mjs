// Retained workflow URLs against native scoped reads. Navigation must not
// create revisions, approvals, audits or jobs, even when identities are forged.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';

export async function workflowLocationBrowser({page,api,sql,actor,token,origin}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private workflow URL fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const json=async(response,status)=>{assert.equal(response.status(),status,await response.text());return response.json();};
  const create=async name=>{
    const id=(await json(await api.post('/api/projects',{data:{name}}),201)).project.id;
    await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${id},${actor},1000)`;
    return id;
  };
  const project=await create('Native workflow URL fixture'),foreign=await create('Other workflow URL fixture');
  await json(await api.post(`/api/projects/${project}/environments`,{data:{name:'Workflow development'}}),201);
  execFileSync(process.execPath,['scripts/seed-rust-fixture.mjs','target'],{env:{...process.env,KELRYVO_RUST_TEST_PROJECT_ID:project},stdio:['ignore','pipe','pipe']});
  await sql`UPDATE sf_projects SET source_repository_id='native-browser',source_folder='migrations',source_updated_at=clock_timestamp() WHERE id=${project}`;
  const binding=(await json(await api.get(`/api/projects/${project}/target-bindings`),200)).bindings[0],target=binding.bindingId;
  const text='-- Workflow Tiếng Việt 😀 <script>window.workflowCanary=true</script>\nCREATE TABLE workflow_item(id NUMBER);\n';
  const draft=(await json(await api.post(`/api/projects/${project}/sql-drafts`,{data:{name:'Saved URL draft',targetBindingId:target,sql:text}}),201)).draft;
  const release=(await json(await api.post(`/api/projects/${project}/sql-drafts/${draft.id}/prepare-release`,{data:{expectedRevision:draft.revision,targetBindingId:target,expectedBindingRevision:binding.bindingRevision,expectedAssignmentRevision:binding.assignmentRevision}}),201)).release;
  const validation=(await json(await api.post(`/api/projects/${project}/releases/${release.id}/validations`,{data:{targetBindingId:target,expectedBindingRevision:binding.bindingRevision,expectedAssignmentRevision:binding.assignmentRevision}}),201)).validation;
  const plan=(await json(await api.post(`/api/projects/${project}/plans`,{data:{intentVersion:3,releaseId:release.id,assignmentId:binding.assignmentId,expectedAssignmentRevision:binding.assignmentRevision,targetBindingId:target,expectedBindingRevision:binding.bindingRevision,validationId:validation.id,expectedValidationDigest:validation.digest}}),201)).plan;
  const snapshot=async()=>({
    drafts:await sql`SELECT id,current_revision FROM sf_sql_drafts WHERE project_id IN (${project},${foreign}) ORDER BY id`,
    plans:await sql`SELECT id,status,approval_reference,reviewer_revision FROM sf_plans WHERE project_id IN (${project},${foreign}) ORDER BY id`,
    counts:(await sql`SELECT (SELECT count(*) FROM sf_audit WHERE project_id IN (${project},${foreign}))::int audit,(SELECT count(*) FROM sf_execution_jobs WHERE project_id IN (${project},${foreign}))::int jobs,(SELECT count(*) FROM sf_schema_snapshots WHERE project_id IN (${project},${foreign}))::int snapshots`)[0],
  });
  const before=await snapshot(),errors=[];
  const readerContext=await page.context().browser().newContext({ignoreHTTPSErrors:true});
  const reader=await readerContext.newPage();reader.on('pageerror',e=>errors.push(e.message));
  await reader.goto(origin);await reader.getByText('Use an operator access token',{exact:true}).click();await reader.getByLabel('Access token',{exact:true}).fill(token);await reader.getByRole('button',{name:'Continue',exact:true}).click();await reader.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  const idle=p=>p.locator('#root[aria-busy="false"]').waitFor();
  const location=p=>new URLSearchParams(new URL(p.url()).hash.slice(1));
  const navigate=async url=>{await reader.goto('about:blank');await reader.goto(url);};
  const open=async(fragment,heading)=>{await navigate(`${origin}/#${fragment}`);await reader.getByRole('heading',{name:heading,exact:true}).waitFor();await idle(reader);};
  try{
    await open(`page=sql&project=${project.toUpperCase()}&draft=${draft.id.toUpperCase()}&target=${target.toUpperCase()}`,'SQL Workspace');
    assert.equal(await reader.getByLabel('Draft name',{exact:true}).inputValue(),draft.name);
    assert.equal(await reader.locator('#draft-sql').inputValue(),text);assert.equal(await reader.getByLabel('Database target',{exact:true}).inputValue(),target);
    assert.deepEqual(Object.fromEntries(location(reader)),{page:'sql',project,target,draft:draft.id});
    await reader.reload();await reader.getByText('Saved revision 1',{exact:true}).waitFor();await idle(reader);assert.equal(await reader.locator('#draft-sql').inputValue(),text);
    await reader.getByRole('button',{name:'Account',exact:true}).click();await reader.getByRole('heading',{name:'Account',exact:true}).waitFor();await idle(reader);assert.equal(location(reader).get('page'),'account');assert.equal(location(reader).has('draft'),false);
    await reader.reload();await reader.getByRole('heading',{name:'Account',exact:true}).waitFor();
    await open(`page=release&project=${project}&release=${release.id}`,'Migration releases');
    const retained=reader.getByRole('region',{name:'Retained release details',exact:true});await retained.waitFor();assert.match(await retained.innerText(),new RegExp(release.id));
    assert.equal(location(reader).get('release'),release.id);
    await open(`page=review&project=${project}&plan=${plan.id}`,'Plans');await reader.locator(`#plan-${plan.id}`).waitFor();assert.equal(location(reader).get('plan'),plan.id);
    assert.match(await reader.locator(`#plan-${plan.id}`).innerText(),/PENDING_APPROVAL/);
    // Hide the first inventory page to exercise a retained target beyond it.
    await reader.route(`**/api/projects/${project}/target-bindings`,r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({bindings:[],nextCursor:'private-page-fixture'})}));
    await open(`page=schema&project=${project}&target=${target}`,'Schema baselines & drift');assert.equal(await reader.getByLabel('Schema target',{exact:true}).inputValue(),target);
    await open(`page=sql&project=${project}&draft=${draft.id}`,'SQL Workspace');assert.equal(await reader.getByLabel('Database target',{exact:true}).inputValue(),target);
    await reader.unroute(`**/api/projects/${project}/target-bindings`);
    await open(`page=targets&project=${project}&target=${target}`,'Target bindings');await reader.getByRole('button',{name:'Open SQL Workspace for this target',exact:true}).waitFor();assert.equal(location(reader).get('target'),target);
    await open(`page=history&project=${project}&target=${target}&plan=${plan.id}`,'Migration history');assert.equal(await reader.getByLabel('Filter history by target',{exact:true}).inputValue(),target);assert.equal(location(reader).get('plan'),plan.id);
    await open(`page=history&project=${project}&target=${binding.profileId}`,'Migration history');assert.equal(await reader.getByLabel('Filter history by target',{exact:true}).inputValue(),binding.profileId);
    // Old history query keys must not pull a later navigation back into history.
    await navigate(`${origin}/?historyProject=${project}&historyTarget=${target}`);await reader.getByRole('heading',{name:'Migration history',exact:true}).waitFor();await idle(reader);
    assert.equal(new URL(reader.url()).searchParams.has('historyProject'),false);assert.equal(location(reader).get('target'),target);
    await reader.getByRole('button',{name:'Schema baselines',exact:true}).click();await idle(reader);await reader.reload();await reader.getByRole('heading',{name:'Schema baselines & drift',exact:true}).waitFor();
    await open(`page=instances&project=${project}`,'Instances');await reader.getByRole('heading',{name:'Register an instance',exact:true}).waitFor();assert.equal(await reader.getByLabel('Project',{exact:true}).inputValue(),project);
    await open(`page=references&project=${project}`,'Schema references');
    await open('page=sql&project=malformed&draft=%3Cscript%3E','Projects');assert.equal(location(reader).has('project'),false);assert.equal(location(reader).has('draft'),false);
    await navigate(`${origin}/#page=sql&project=${foreign}&draft=${draft.id}`);await reader.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();assert.equal(await reader.locator('#draft-sql').count(),0);
    await navigate(`${origin}/#page=schema&project=${foreign}&target=${target}`);await reader.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();assert.equal(await reader.getByLabel('Schema target',{exact:true}).count(),0);
    const hold=randomUUID(),generation=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
    await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'a'.repeat(64)},1000)`;
    try{await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;await open(`page=schema&project=${project}&target=${target}`,'Schema baselines & drift');assert.equal(await reader.getByRole('button',{name:'Observe schema',exact:true}).count(),0);}finally{await sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;}
    assert.equal(await reader.evaluate(()=>window.workflowCanary),undefined);
    assert.doesNotMatch(reader.url(),new RegExp(token));assert.equal(await reader.locator('main script').count(),0);
    assert.deepEqual(await snapshot(),before,'workflow restoration only reads retained governance and schema state');
    await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${project} AND actor_id=${actor} AND revoked_at IS NULL`;
    await navigate(`${origin}/#page=sql&project=${project}&draft=${draft.id}`);await reader.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();assert.equal(await reader.locator('#draft-sql').count(),0);
    assert.deepEqual(errors,[]);
  }finally{await readerContext.close();}
  // A signed-out link must survive login without granting access from its IDs.
  const loginContext=await page.context().browser().newContext({ignoreHTTPSErrors:true}),login=await loginContext.newPage();
  try{
    await login.goto(`${origin}/#page=references&project=${foreign}`);await login.getByText('Use an operator access token',{exact:true}).click();await login.getByLabel('Access token',{exact:true}).fill(token);await login.getByRole('button',{name:'Continue',exact:true}).click();await login.getByRole('heading',{name:'Schema references',exact:true}).waitFor();await idle(login);assert.equal(location(login).get('project'),foreign);
    await login.getByRole('button',{name:'Sign out',exact:true}).click();await login.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(location(login).get('page'),'workspace');assert.equal(location(login).has('project'),false);
  }finally{await loginContext.close();}
}
