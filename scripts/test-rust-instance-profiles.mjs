// Disposable native profile inventory. Retained public projection is compared
// independently; no worker, credential resolution or Oracle operation runs.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function instanceProfilesBrowser({page,api,sql,actor,reviewer,reviewerToken,origin}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private profile fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const created=await api.post('/api/projects',{data:{name:'Native instance profiles browser'}});assert.equal(created.status(),201,await created.text());const project=(await created.json()).project.id;
  for(const member of [actor,reviewer])await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${member},1000)`;
  const environments=[];for(const name of ['Development profiles','Production profiles']){const r=await api.post(`/api/projects/${project}/environments`,{data:{name}});assert.equal(r.status(),201);environments.push((await r.json()).environment.id);}
  const canary='Native profile Tiếng Việt 😀 <script>window.profileCanary=true</script>';
  const profiles=[];for(let i=0;i<3;i++){
    const r=await api.post(`/api/projects/${project}/profiles`,{data:{name:i===0?canary:`Native profile ${i}`,environmentId:environments[i===2?1:0],engine:'oracle',host:'profile.example.invalid',port:1521,service:i===1?'LEGACY':'PDB',serviceKind:i===1?'SID':'SERVICE_NAME',username:i===2?'OTHER_APP':'APP',credentialRef:'secret://native/profile-private-pointer',reason:'Private native profile inventory'}});
    assert.equal(r.status(),201,await r.text());profiles.push((await r.json()).profile.id);
  }
  assert.equal((await api.post(`/api/projects/${project}/profiles/${profiles[1]}/lifecycle`,{data:{expectedRevision:'1',action:'DISABLE',reason:'Private disabled profile'}})).status(),200);
  assert.equal((await api.post(`/api/projects/${project}/profiles/${profiles[2]}/retire`,{data:{reason:'Private retired profile'}})).status(),204);
  const checkProjection=async()=>{
    const r=await api.get(`/api/projects/${project}`);assert.equal(r.status(),200);const data=await r.json();
    const raw=await sql`SELECT * FROM sf_profiles WHERE project_id=${project} ORDER BY created_at,id`;
    assert.deepEqual(data.profiles.map(p=>[p.id,p.name,p.host,p.username]),raw.map(p=>[p.id,p.name,p.host,p.username]));
    assert.doesNotMatch(JSON.stringify(data.profiles),/profile-private-pointer|credential_ref|credentialRef|password/);
    return data;
  };
  await checkProjection();
  const idle=p=>p.locator('#root[aria-busy="false"]').waitFor();
  const open=async p=>{await p.getByRole('button',{name:'Instances',exact:true}).click();await p.locator('#instance-project').selectOption(project);await p.getByRole('button',{name:'Manage instances',exact:true}).click();await p.getByRole('region',{name:'Instance deployment profiles',exact:true}).waitFor();await idle(p);};
  const card=(p,id)=>p.locator(`.instance-profile[data-profile-id="${id}"]`);
  const visible=p=>p.locator('.instance-profile:not([hidden])');
  const filter=async(p,name,id)=>{await p.getByLabel(name,{exact:true}).selectOption(id);};
  await open(page);assert.equal(await visible(page).count(),3);
  assert.match(await card(page,profiles[0]).innerText(),/ENABLED · SERVICE_NAME · Revision 1/);assert.match(await card(page,profiles[1]).innerText(),/DISABLED · SID · Revision 2/);
  assert.equal(await card(page,profiles[0]).locator('script').count(),0);assert.equal(await page.evaluate(()=>window.profileCanary),undefined);
  assert.doesNotMatch(await page.getByRole('region',{name:'Instance deployment profiles',exact:true}).innerText(),/profile-private-pointer/);
  await page.getByLabel('Search profiles',{exact:true}).fill('other_app');assert.equal(await visible(page).count(),1);assert.equal(await card(page,profiles[2]).isVisible(),true);
  await page.getByLabel('Search profiles',{exact:true}).fill('');await filter(page,'Profile environment filter',environments[0]);await filter(page,'Profile status filter','DISABLED');assert.equal(await visible(page).count(),1);
  await page.getByRole('button',{name:'Refresh deployment profiles',exact:true}).click();await idle(page);assert.equal(await page.getByLabel('Profile status filter',{exact:true}).inputValue(),'DISABLED');assert.equal(await visible(page).count(),1);
  await filter(page,'Profile status filter','RETIRED');assert.equal(await visible(page).count(),0);await page.getByText('No profiles match these filters.',{exact:true}).waitFor();
  await filter(page,'Profile environment filter','');await filter(page,'Profile status filter','');
  await page.getByText('Add deployment profile',{exact:true}).click();
  for(const [key,value]of Object.entries({name:'Created from Instances',host:'created-profile.example.invalid',service:'PDB',username:'APP',credential:'secret://native/profile-private-pointer',reason:'Create from native instance inventory'}))await page.locator(`#new-profile-${key}`).fill(value);
  await page.locator('#new-profile-environment').selectOption(environments[1]);
  await page.getByRole('button',{name:'Create deployment profile',exact:true}).click();await page.getByRole('status').filter({hasText:'Deployment profile created.'}).waitFor();
  assert.equal(await page.locator('#instance-project').inputValue(),project,'creation stays in the selected instance project');assert.equal(await visible(page).count(),4);
  const [newProfile]=await sql`SELECT id FROM sf_profiles WHERE project_id=${project} AND name='Created from Instances'`;
  await card(page,profiles[0]).getByRole('button',{name:'Configure and inspect',exact:true}).click();
  const panel=p=>p.getByRole('region',{name:'Connection configuration',exact:true});await panel(page).waitFor();assert.match(await panel(page).innerText(),/Revision 1 · ENABLED/);
  assert.equal((await api.post(`/api/projects/${project}/profiles/${profiles[0]}/lifecycle`,{data:{expectedRevision:'1',action:'DISABLE',reason:'Concurrent native revision'}})).status(),200);
  await page.getByLabel('Connection management reason',{exact:true}).fill('Do not silently replay a stale revision');await panel(page).getByRole('button',{name:'Disable connection',exact:true}).click();await page.getByRole('alert').filter({hasText:'CONNECTION REVISION CONFLICT'}).waitFor();
  assert.equal((await sql`SELECT revision::text revision FROM sf_profiles WHERE id=${profiles[0]}`)[0].revision,'2');
  await card(page,profiles[1]).getByLabel('Profile retirement reason',{exact:true}).fill('Explicit profile retirement');
  await card(page,profiles[1]).getByRole('button',{name:'Retire deployment profile',exact:true}).click();await page.getByRole('alert').filter({hasText:'Confirm permanent profile retirement first.'}).waitFor();
  assert.equal((await sql`SELECT retired_at FROM sf_profiles WHERE id=${profiles[1]}`)[0].retired_at,null);assert.equal(await card(page,profiles[1]).getByLabel('Profile retirement reason',{exact:true}).inputValue(),'Explicit profile retirement');
  await card(page,profiles[1]).getByLabel('I understand profile retirement is permanent',{exact:true}).check();
  await card(page,profiles[1]).getByRole('button',{name:'Retire deployment profile',exact:true}).click();await page.getByRole('status').filter({hasText:'Deployment profile retired.'}).waitFor();
  assert.match(await card(page,profiles[1]).innerText(),/RETIRED · SID · Revision 3/);assert.equal(await card(page,profiles[1]).getByRole('button',{name:'Retire deployment profile',exact:true}).count(),0);
  const audits=await sql`SELECT actor_id FROM sf_audit WHERE project_id=${project} AND resource_id=${profiles[1]} AND action='PROFILE_RETIRED'`;assert.deepEqual(audits.map(r=>r.actor_id),[actor]);
  await checkProjection();
  const generation=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id,hold=randomUUID();
  await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'d'.repeat(64)},1000)`;
  try{
    await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
    await page.getByRole('button',{name:'Refresh deployment profiles',exact:true}).click();await idle(page);assert.equal(await visible(page).count(),4);
    assert.equal(await page.getByRole('button',{name:'Retire deployment profile',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'Create deployment profile',exact:true}).count(),0);
    await card(page,newProfile.id).getByRole('button',{name:'Configure and inspect',exact:true}).click();await panel(page).waitFor();assert.equal(await panel(page).getByRole('button',{name:'Disable connection',exact:true}).count(),0,'HOLD retains profile details without writable controls');
  }finally{await sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;}
  const reviewerContext=await page.context().browser().newContext({ignoreHTTPSErrors:true});const reviewerPage=await reviewerContext.newPage();
  try{
    await reviewerPage.goto(origin);await reviewerPage.getByText('Use an operator access token',{exact:true}).click();await reviewerPage.getByLabel('Access token',{exact:true}).fill(reviewerToken);await reviewerPage.getByRole('button',{name:'Continue',exact:true}).click();await reviewerPage.getByRole('heading',{name:'Projects',exact:true}).waitFor();
    await open(reviewerPage);assert.equal(await visible(reviewerPage).count(),4);assert.equal(await reviewerPage.getByRole('button',{name:'Retire deployment profile',exact:true}).count(),0);
    await card(reviewerPage,profiles[0]).getByRole('button',{name:'Configure and inspect',exact:true}).click();await panel(reviewerPage).waitFor();assert.equal(await panel(reviewerPage).getByRole('button',{name:'Enable connection',exact:true}).count(),0);
  }finally{await reviewerContext.close();}
  const archived=await api.post(`/api/projects/${project}/archive`,{data:{reason:'Archive private profile inventory'}});assert.equal(archived.status(),200);
  await page.getByRole('button',{name:'Refresh deployment profiles',exact:true}).click();await idle(page);assert.equal(await visible(page).count(),4);assert.equal(await page.getByRole('button',{name:'Retire deployment profile',exact:true}).count(),0);
  await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${project} AND actor_id=${actor} AND revoked_at IS NULL`;
  await page.getByRole('button',{name:'Refresh deployment profiles',exact:true}).click();await page.getByRole('alert').filter({hasText:'NOT FOUND'}).waitFor();assert.equal(await page.locator('.instance-profile').count(),0);assert.equal(await panel(page).count(),0,'lost project access clears the profile and configuration caches');
  assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,0);
  await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
