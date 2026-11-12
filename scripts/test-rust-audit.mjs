// Private retained audit fixtures through actual native HTTPS/WASM. Tied
// microsecond timestamps exercise cursor ordering beyond the recent-100 view.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function auditBrowser({page,api,sql,actor}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private audit fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const created=await api.post('/api/projects',{data:{name:'Native paged audit browser'}});assert.equal(created.status(),201,await created.text());
  const project=(await created.json()).project.id;
  await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${actor},1000)`;
  const [environment]=await sql`INSERT INTO sf_environments(organization_id,project_id,name) VALUES(${org},${project},'Private audit fixture') RETURNING id`;
  const [profile]=await sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) VALUES(${project},${org},${environment.id},'Private audit profile','oracle','audit.example.invalid',1521,'PDB','APP','secret://audit/private-pointer') RETURNING id`;
  const [release]=await sql`INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,files) VALUES(${project},${org},'fixture',${'a'.repeat(40)},'sha1','migrations',${'b'.repeat(64)},'VALID','[]'::jsonb) RETURNING id`;
  const [plan]=await sql`INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,items) VALUES(${project},${org},${release.id},${profile.id},${actor},'[]'::jsonb) RETURNING id`;
  await sql`INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status) VALUES(${project},${plan.id},'1','migrations/V1__audit_retained.sql',${'c'.repeat(64)},'NOT_EXECUTED')`;
  const reason='Historical audit Tiếng Việt 😀 <script>window.auditCanary=true</script>';
  for(let i=0;i<123;i++){
    const timestamp=`2025-03-01T00:00:${String(Math.floor(i/3)).padStart(2,'0')}.123456Z`;
    await sql`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,facts,created_at) VALUES(${project},${org},${actor},${i<3?'LEGACY_ONLY':'PAGE_EVENT'},${sql.json({reason,ordinal:i,credentialRef:'secret://audit/private-pointer'})},${timestamp}::timestamptz)`;
  }
  const expected=await sql`SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') timestamp FROM sf_audit WHERE project_id=${project} ORDER BY created_at DESC,id DESC`;
  const detail=await api.get(`/api/projects/${project}`);assert.equal(detail.status(),200);
  assert.equal((await detail.json()).audit.length,100,'recent project detail is not the complete audit history');
  const stable=async()=>({
    audit:await sql`SELECT id,actor_id,action,facts,created_at FROM sf_audit WHERE project_id=${project} ORDER BY id`,
    history:await sql`SELECT * FROM sf_history WHERE project_id=${project} ORDER BY id`,
    plan:await sql`SELECT status,execution,approval_reference FROM sf_plans WHERE id=${plan.id}`,
    jobs:(await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,
  });
  const before=await stable();
  const idle=()=>page.locator('#root[aria-busy="false"]').waitFor();
  const events=()=>page.locator('.audit-event');
  const ids=()=>events().evaluateAll(nodes=>nodes.map(n=>n.dataset.auditId));
  const select=async action=>{await page.getByLabel('Audit action',{exact:true}).selectOption(action);await idle();};
  const requests=[];const watcher=request=>{const u=new URL(request.url());if(u.pathname===`/api/projects/${project}/audit`)requests.push(u);};
  page.on('request',watcher);
  try{
    await page.getByRole('button',{name:'Projects',exact:true}).click();
    await page.getByRole('article').filter({has:page.getByRole('heading',{name:'Native paged audit browser',exact:true})}).getByRole('button',{name:'Open project',exact:true}).click();
    await page.getByRole('button',{name:'Audit',exact:true}).click();await page.getByRole('heading',{name:'Audit trail',exact:true}).waitFor();await idle();
    assert.equal(await events().count(),50);
    assert.ok(await page.getByLabel('Audit action',{exact:true}).locator('option[value="LEGACY_ONLY"]').count(),'actions include events older than the recent-100 project detail');
    while(await page.getByRole('button',{name:'Load older audit events',exact:true}).count()){
      await page.getByRole('button',{name:'Load older audit events',exact:true}).click();await idle();
    }
    assert.deepEqual(await ids(),expected.map(r=>r.id));
    for(const row of expected.slice(-3))assert.equal(await page.locator(`.audit-event[data-audit-id="${row.id}"] time`).innerText(),row.timestamp);
    assert.equal(await events().locator('script').count(),0);assert.equal(await page.evaluate(()=>window.auditCanary),undefined);
    assert.doesNotMatch(await page.getByRole('region',{name:'Project audit trail',exact:true}).innerText(),/private-pointer|credentialRef/);
    assert.match(await page.getByRole('region',{name:'Retained migration records',exact:true}).innerText(),/V1__audit_retained.sql.*NOT_EXECUTED/s);
    await select('LEGACY_ONLY');assert.equal(await events().count(),3);assert.equal(await page.getByRole('button',{name:'Load older audit events',exact:true}).count(),0);
    assert.equal(requests.at(-1).searchParams.has('cursor'),false,'changing the action never reuses a cursor from another filter');
    await select('ALL');assert.equal(await events().count(),50);
    await page.route(`**/api/projects/${project}/audit?cursor=*`,r=>r.fulfill({status:400,contentType:'application/json',body:'{"error":"INVALID_AUDIT_CURSOR"}'}));
    await page.getByRole('button',{name:'Load older audit events',exact:true}).click();await page.getByRole('alert').filter({hasText:'INVALID AUDIT CURSOR'}).waitFor();
    assert.equal(await events().count(),0,'a failed continuation clears retained audit rows');
    await page.unroute(`**/api/projects/${project}/audit?cursor=*`);
    await page.getByRole('button',{name:'Refresh audit',exact:true}).click();await idle();assert.equal(await events().count(),50);
    assert.deepEqual(await stable(),before,'audit browsing and failed cursor reads never mutate retained records or jobs');
    const archived=await api.post(`/api/projects/${project}/archive`,{data:{reason:'Archive the disposable audit fixture'}});assert.equal(archived.status(),200);
    await page.getByRole('button',{name:'Audit',exact:true}).click();await idle();assert.match(await page.locator('main').innerText(),/Archived project · read only/);
    const original=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
    const hold=randomUUID();await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'e'.repeat(64)},1000)`;
    try{
      await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
      await select('LEGACY_ONLY');assert.equal(await events().count(),3,'archived audit remains readable during recovery HOLD');
      await page.getByRole('button',{name:'Refresh audit',exact:true}).click();await idle();assert.equal(await events().count(),3);assert.equal(await page.getByLabel('Audit action',{exact:true}).inputValue(),'LEGACY_ONLY');
    }finally{await sql`UPDATE sf_metadata_current SET generation_id=${original} WHERE singleton`;}
    await select('ALL');assert.equal(await events().count(),50);
    await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${project} AND actor_id=${actor} AND revoked_at IS NULL`;
    await page.getByRole('button',{name:'Load older audit events',exact:true}).click();await page.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();
    assert.equal(await events().count(),0);assert.equal(await page.locator('.retained-migration-record').count(),0,'membership loss clears all project audit/history caches');
    assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,0);
    await page.getByRole('button',{name:'Back to projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  }finally{page.off('request',watcher);}
}
