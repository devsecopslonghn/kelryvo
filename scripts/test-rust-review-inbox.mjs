// Cross-project inbox on the private native HTTPS/WASM fixture. Synthetic
// pending rows exercise pagination; navigation also opens the real native plan.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const rows=page=>page.locator('.review-inbox-row');
const idle=page=>page.locator('#root[aria-busy="false"]').waitFor();
const scope=async(page,value)=>{await page.getByLabel('Show',{exact:true}).selectOption(value);await idle(page);};
const inbox=async page=>{await page.getByRole('button',{name:'Review inbox',exact:true}).click();await page.getByRole('heading',{name:'Review inbox',exact:true}).waitFor();await idle(page);};
const allRows=async page=>{
  while(await page.getByRole('button',{name:'Load older pending plans',exact:true}).count()){
    await page.getByRole('button',{name:'Load older pending plans',exact:true}).click();await idle(page);
  }
};
const ids=async page=>(await rows(page).evaluateAll(nodes=>nodes.map(n=>n.dataset.planId))).sort();

export async function reviewInboxAuthorBrowser({page,api,sql,actor,reviewer,project,plan}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private review inbox fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const canary='Inbox project <script>window.inboxCanary=true</script> Tiếng Việt 😀';
  const created=await api.post('/api/projects',{data:{name:canary}});assert.equal(created.status(),201,await created.text());
  const otherProject=(await created.json()).project.id;
  for(const member of [actor,reviewer])await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${otherProject},${member},1000)`;
  const environment=randomUUID(),profile=randomUUID(),release=randomUUID(),other=`inbox-other-${randomUUID()}`;
  await sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${other},${org},'approver','Inbox requester <script>window.inboxRequesterCanary=true</script>')`;
  await sql`INSERT INTO sf_environments(id,project_id,organization_id,name) VALUES(${environment},${otherProject},${org},'Private inbox fixture')`;
  await sql`INSERT INTO sf_profiles(id,project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) SELECT ${profile},${otherProject},organization_id,${environment},name,engine,host,port,service,username,credential_ref FROM sf_profiles WHERE id=${plan.profile_id}`;
  await sql`INSERT INTO sf_releases(id,project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,files) SELECT ${release},${otherProject},organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,files FROM sf_releases WHERE id=${plan.release_id}`;
  const fixture=[];
  for(let i=0;i<29;i++){
    const id=randomUUID(),author=i%3===0?actor:i%3===1?reviewer:other,assigned=i%3===2?other:null;
    await sql`INSERT INTO sf_plans(id,organization_id,project_id,release_id,profile_id,author_id,reviewer_id,items,created_at) VALUES(${id},${org},${otherProject},${release},${profile},${author},${assigned},'[]'::jsonb,${new Date(Date.now()-60000-i*1000)})`;
    fixture.push({id,author,assigned});
  }
  const before=(await sql`SELECT status,reviewer_id,reviewer_revision,approval_reference FROM sf_plans WHERE id=${plan.id}`)[0];
  const auditBefore=(await sql`SELECT count(*)::int n FROM sf_audit WHERE project_id IN (${project},${otherProject})`)[0].n;
  await inbox(page);assert.equal(await rows(page).count(),25);
  await allRows(page);assert.deepEqual(await ids(page),[plan.id,...fixture.map(r=>r.id)].sort());
  assert.match(await page.getByRole('region',{name:'Pending review inbox',exact:true}).innerText(),/Requested by Native browser developer/);
  assert.equal(await rows(page).locator('script').count(),0);assert.equal(await page.evaluate(()=>window.inboxCanary||window.inboxRequesterCanary),undefined);
  await scope(page,'MINE');await allRows(page);assert.deepEqual(await ids(page),[plan.id,...fixture.filter(r=>r.author===actor).map(r=>r.id)].sort());
  await scope(page,'ELIGIBLE');assert.equal(await rows(page).count(),0,'developers have no independent approval role');
  await scope(page,'ALL');
  await page.locator(`.review-inbox-row[data-plan-id="${plan.id}"]`).getByRole('button',{name:'Open pending plan',exact:true}).click();
  await page.getByRole('status').filter({hasText:`Opened pending plan ${plan.id} from review inbox.`}).waitFor();
  await page.getByRole('heading',{name:`Plan ${plan.id}`,exact:true}).waitFor();
  await inbox(page);
  const stale=fixture[0].id;await sql`UPDATE sf_plans SET status='REJECTED' WHERE id=${stale}`;
  await page.locator(`.review-inbox-row[data-plan-id="${stale}"]`).getByRole('button',{name:'Open pending plan',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'That pending plan is no longer available.'}).waitFor();
  assert.equal(await rows(page).count(),0,'a terminal plan cannot open from a cached pending row');
  await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();await idle(page);assert.equal(await rows(page).count(),25);
  await page.route('**/api/review-inbox?scope=ALL&cursor=*',r=>r.fulfill({status:503,contentType:'application/json',body:'{"error":"INBOX_UNAVAILABLE"}'}));
  await page.getByRole('button',{name:'Load older pending plans',exact:true}).click();await page.getByRole('alert').filter({hasText:'INBOX UNAVAILABLE'}).waitFor();
  assert.equal(await rows(page).count(),0,'a failed page clears retained inbox rows');
  await page.unroute('**/api/review-inbox?scope=ALL&cursor=*');
  await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();await idle(page);
  await page.locator(`.review-inbox-row[data-plan-id="${plan.id}"]`).getByRole('button',{name:'Open pending plan',exact:true}).click();
  await page.getByRole('heading',{name:`Plan ${plan.id}`,exact:true}).waitFor();await idle(page);
  assert.deepEqual((await sql`SELECT status,reviewer_id,reviewer_revision,approval_reference FROM sf_plans WHERE id=${plan.id}`)[0],before);
  assert.equal((await sql`SELECT count(*)::int n FROM sf_audit WHERE project_id IN (${project},${otherProject})`)[0].n,auditBefore,'read-only inbox navigation never assigns or approves');
  assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${otherProject}`)[0].n,0);
  return {otherProject,fixture:fixture.filter(r=>r.id!==stale),planId:plan.id,project};
}

export async function reviewInboxReviewerBrowser({page,sql,reviewer,fixture}){
  await inbox(page);assert.equal(await rows(page).count(),25);
  await scope(page,'MINE');await allRows(page);assert.deepEqual(await ids(page),fixture.fixture.filter(r=>r.author===reviewer).map(r=>r.id).sort());
  await scope(page,'ELIGIBLE');await allRows(page);
  const expected=[fixture.planId,...fixture.fixture.filter(r=>r.author!==reviewer&&(!r.assigned||r.assigned===reviewer)).map(r=>r.id)].sort();
  assert.deepEqual(await ids(page),expected);assert.match(await rows(page).first().innerText(),/Eligible for your review/);
  await page.locator(`.review-inbox-row[data-plan-id="${fixture.planId}"]`).getByRole('button',{name:'Open pending plan',exact:true}).click();
  await page.getByRole('heading',{name:`Plan ${fixture.planId}`,exact:true}).waitFor();await idle(page);
  await inbox(page);
  // A fresh next page must also invalidate rows retained before membership loss.
  await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${fixture.otherProject} AND actor_id=${reviewer} AND revoked_at IS NULL`;
  await page.getByRole('button',{name:'Load older pending plans',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Project access changed.'}).waitFor();assert.equal(await rows(page).count(),0);
  await page.getByRole('button',{name:'Refresh inbox',exact:true}).click();await idle(page);
  assert.deepEqual(await ids(page),[fixture.planId]);assert.equal(await page.locator(`.review-inbox-row[data-project-id="${fixture.otherProject}"]`).count(),0);
  await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
