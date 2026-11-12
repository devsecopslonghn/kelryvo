// Native lifecycle UI on a disposable private metadata project. No customer
// project is archived and no Oracle operation is performed.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function projectLifecycleBrowser({page,api,sql,actor}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private project lifecycle fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const created=await api.post('/api/projects',{data:{name:'Native project lifecycle browser'}});assert.equal(created.status(),201,await created.text());
  const project=(await created.json()).project.id;
  await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${actor},1000)`;
  const environment=await api.post(`/api/projects/${project}/environments`,{data:{name:'Lifecycle development'}});assert.equal(environment.status(),201);
  const environmentId=(await environment.json()).environment.id;
  const profileCreated=await api.post(`/api/projects/${project}/profiles`,{data:{name:'Lifecycle profile',environmentId,engine:'oracle',host:'lifecycle.example.invalid',port:1521,service:'PDB',username:'APP',credentialRef:'secret://native/lifecycle-pointer',reason:'Native UI lifecycle fixture'}});
  assert.equal(profileCreated.status(),201,await profileCreated.text());const profile=(await profileCreated.json()).profile.id;
  const [initial]=await sql`SELECT configuration FROM sf_connection_revisions WHERE resource_id=${profile} AND revision=1`;
  assert(initial);
  const idle=()=>page.locator('#root[aria-busy="false"]').waitFor();
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Native project lifecycle browser',exact:true})}).getByRole('button',{name:'Open project',exact:true}).click();
  await page.getByRole('heading',{name:'Native project lifecycle browser',exact:true}).waitFor();await idle();
  assert.equal(await page.getByRole('button',{name:'Archive project',exact:true}).isEnabled(),true);
  await page.getByLabel('Environment name',{exact:true}).fill('Lifecycle UI environment');
  await page.getByRole('button',{name:'Add environment',exact:true}).click();await idle();assert.equal((await sql`SELECT count(*)::int n FROM sf_environments WHERE project_id=${project}`)[0].n,2);
  const original=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
  const hold=randomUUID();await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'f'.repeat(64)},1000)`;
  try{
    await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
    await page.getByRole('button',{name:'Overview',exact:true}).click();await idle();
    assert.equal(await page.getByRole('button',{name:'Archive project',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Add environment',exact:true}).isDisabled(),true);
    assert.equal((await sql`SELECT archived_at FROM sf_projects WHERE id=${project}`)[0].archived_at,null);
    const advice=page.getByRole('region',{name:'Recommended next step',exact:true});await advice.getByRole('heading',{name:'Confirm workspace recovery status',exact:true}).waitFor();
    await advice.getByRole('button',{name:'Inspect migration history',exact:true}).click();await page.getByRole('heading',{name:'Migration history',exact:true}).waitFor();await idle();
  }finally{await sql`UPDATE sf_metadata_current SET generation_id=${original} WHERE singleton`;}
  await page.getByRole('button',{name:'Configuration',exact:true}).click();await idle();
  await page.getByRole('button',{name:'Connection details',exact:true}).click();await page.getByRole('region',{name:'Connection configuration',exact:true}).waitFor();
  const panel=()=>page.getByRole('region',{name:'Connection configuration',exact:true});
  await page.getByLabel('Connection management reason',{exact:true}).fill('Retire the disposable lifecycle profile');
  await panel().getByRole('button',{name:'Retire connection',exact:true}).click();await page.getByRole('alert').filter({hasText:'Confirm permanent retirement first.'}).waitFor();
  assert.equal((await sql`SELECT retired_at FROM sf_profiles WHERE id=${profile}`)[0].retired_at,null);
  // The retained confirmation rerenders the form; submit an explicit reason again.
  await page.getByLabel('Connection management reason',{exact:true}).fill('Retire the disposable lifecycle profile');
  await page.getByLabel('I understand retirement is permanent',{exact:true}).check();
  await panel().getByRole('button',{name:'Retire connection',exact:true}).click();await page.getByRole('status').filter({hasText:'Connection metadata saved.'}).waitFor();
  assert.match(await panel().innerText(),/Revision 2 · RETIRED/);
  const [retired]=await sql`SELECT retired_by,retirement_reason,retired_at FROM sf_profiles WHERE id=${profile}`;
  assert.equal(retired.retired_by,actor);assert.equal(retired.retirement_reason,'Retire the disposable lifecycle profile');assert(retired.retired_at);
  assert.deepEqual((await sql`SELECT configuration FROM sf_connection_revisions WHERE resource_id=${profile} AND revision=1`)[0],initial,'retirement preserves the immutable first profile revision');
  await page.getByRole('button',{name:'Overview',exact:true}).click();await idle();
  const reason='Archive lifecycle Tiếng Việt 😀 </textarea><script>window.archiveCanary=true</script>';
  await page.getByLabel('Archive reason',{exact:true}).fill(reason);
  await page.route(`**/api/projects/${project}/archive`,r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"ARCHIVE_UNAVAILABLE"}'}));
  await page.getByRole('button',{name:'Archive project',exact:true}).click();await page.getByRole('alert').filter({hasText:'ARCHIVE UNAVAILABLE'}).waitFor();
  assert.equal(await page.getByLabel('Archive reason',{exact:true}).inputValue(),reason,'failed archive retains the reason without replay');
  assert.equal(await page.evaluate(()=>window.archiveCanary),undefined);assert.equal((await sql`SELECT archived_at FROM sf_projects WHERE id=${project}`)[0].archived_at,null);
  await page.unroute(`**/api/projects/${project}/archive`);
  await page.getByRole('button',{name:'Archive project',exact:true}).click();await page.getByRole('status').filter({hasText:'Project archived. Existing project details and history remain available.'}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Archive project',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Add environment',exact:true}).isDisabled(),true);
  assert.match(await page.locator('main').innerText(),/Archived project · read only/);
  const advice=page.getByRole('region',{name:'Recommended next step',exact:true});await advice.getByRole('heading',{name:'Inspect retained project history',exact:true}).waitFor();
  await advice.getByRole('button',{name:'Open migration history',exact:true}).click();await page.getByRole('heading',{name:'Migration history',exact:true}).waitFor();await idle();
  const audit=await sql`SELECT actor_id,facts FROM sf_audit WHERE project_id=${project} AND action='PROJECT_ARCHIVED'`;
  assert.deepEqual(audit.map(r=>({actor:r.actor_id,reason:r.facts.reason})),[{actor,reason}]);
  assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,0);
  await page.getByRole('button',{name:'Configuration',exact:true}).click();await idle();
  assert.equal(await page.getByRole('button',{name:'Save source binding',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Create deployment profile',exact:true}).count(),0);
  assert.match(await page.getByRole('region',{name:'Project configuration',exact:true}).innerText(),/Lifecycle profile[\s\S]*Retired/);
  await page.route(`**/api/projects/${project}`,r=>r.fulfill({status:404,contentType:'application/json',body:'{"error":"NOT_FOUND"}'}));
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();
  assert.equal(await page.getByLabel('Environment name',{exact:true}).count(),0,'denied project reads clear cached lifecycle/configuration controls');
  await page.unroute(`**/api/projects/${project}`);
  await page.getByRole('button',{name:'Back to projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
