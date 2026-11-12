// Account browser flow on the caller's private native PostgreSQL/TLS fixture.
// Synthetic rows exercise pagination; the revoked remote session is real.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {request} from 'playwright';
export async function accountBrowser({page,api,sql,actor,origin}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private account fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const canary='Account access <script>window.accountCanary=true</script> Tiếng Việt 😀';
  const projects=[];
  for(let i=0;i<52;i++){
    const id=randomUUID();projects.push(id);
    await sql`INSERT INTO sf_projects(id,organization_id,name,archived_at) VALUES(${id},${org},${i===0?canary:`Account page project ${i}`},${i===1?new Date():null})`;
    await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${id},${actor},1000)`;
  }
  await sql`INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${projects[0]},${actor},1000)`;
  const foreign=randomUUID();await sql`INSERT INTO sf_projects(id,organization_id,name) VALUES(${foreign},${org},'Unassigned account project must stay hidden')`;
  const [anchor]=await sql`SELECT id FROM sf_local_credentials WHERE actor_id=${actor} AND credential_kind='LOCAL' AND revoked_at IS NULL`;
  for(let i=0;i<52;i++){
    const digest=createHash('sha256').update(`account-pagination-private-${actor}-${i}`).digest('hex');
    await sql`INSERT INTO sf_local_credentials(id,actor_id,token_sha256,credential_kind,parent_credential_id,issued_at,expires_at,absolute_expires_at) VALUES(${randomUUID()},${actor},${digest},'BROWSER',${anchor.id},clock_timestamp(),clock_timestamp()+interval '20 minutes',clock_timestamp()+interval '1 hour')`;
  }
  const login=await api.post('/api/session');assert.equal(login.status(),200,await login.text());
  const cookie=login.headers()['set-cookie'].split(';')[0];
  const token=cookie.slice(cookie.indexOf('=')+1);
  const digest=createHash('sha256').update(token).digest('hex');
  const [remoteSession]=await sql`SELECT id FROM sf_local_credentials WHERE token_sha256=${digest}`;
  assert(remoteSession);
  const remote=await request.newContext({baseURL:origin,ignoreHTTPSErrors:true,extraHTTPHeaders:{cookie}});
  try{
    assert.equal((await remote.get('/api/session')).status(),200);
    await page.getByRole('button',{name:'Account',exact:true}).click();
    await page.getByRole('heading',{name:'Account',exact:true}).waitFor();
    await page.locator('#root[aria-busy="false"]').waitFor();
    const access=()=>page.getByRole('region',{name:'Project access details',exact:true});
    const sessions=()=>page.getByRole('region',{name:'Active browser sessions',exact:true});
    assert.equal(await access().locator('.account-project').count(),50);
    assert.equal(await sessions().locator('.account-session').count(),50);
    assert.match(await page.getByRole('region',{name:'Account summary',exact:true}).innerText(),/Not set up/);
    assert.equal(await page.getByRole('heading',{name:'Change password',exact:true}).count(),0,'password changes require a configured enabled local password');
    while(await page.getByRole('button',{name:'Load more access',exact:true}).count()){
      await page.getByRole('button',{name:'Load more access',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
    }
    const expected=await sql`SELECT p.id FROM sf_projects p JOIN sf_project_grants g ON g.project_id=p.id AND g.organization_id=p.organization_id AND g.actor_id=${actor} AND g.revoked_at IS NULL WHERE p.organization_id=${org}`;
    assert.equal(await access().locator('.account-project').count(),expected.length);
    assert.equal(await access().locator(`[data-project-id="${foreign}"]`).count(),0);
    assert.match(await access().locator(`[data-project-id="${projects[0]}"]`).innerText(),/Deployment requests: granted/);
    assert.match(await access().locator(`[data-project-id="${projects[1]}"]`).innerText(),/Archived; read only/);
    assert.equal(await access().locator('script').count(),0);assert.equal(await page.evaluate(()=>window.accountCanary),undefined);
    while(await page.getByRole('button',{name:'Load more sessions',exact:true}).count()){
      await page.getByRole('button',{name:'Load more sessions',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
    }
    const current=sessions().getByRole('article').filter({has:page.getByRole('heading',{name:'This browser session',exact:true})});
    assert.equal(await current.count(),1);assert.equal(await current.getByRole('button',{name:'Revoke session',exact:true}).count(),0);
    assert.doesNotMatch(await page.locator('body').innerText(),/token_sha256|parent_credential_id|password_hash/);
    const before=(await sql`SELECT count(*)::int n FROM sf_account_audit WHERE actor_id=${actor} AND action='SESSION_REVOKED'`)[0].n;
    const original=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
    const hold=randomUUID();await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'e'.repeat(64)},1000)`;
    try{
      await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
      await sessions().locator(`[data-session-id="${remoteSession.id}"]`).getByRole('button',{name:'Revoke session',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Other browser session revoked.'}).waitFor();
      assert.equal((await remote.get('/api/session')).status(),401,'revoked browser credentials lose authority immediately');
      assert.equal((await sql`SELECT count(*)::int n FROM sf_account_audit WHERE actor_id=${actor} AND action='SESSION_REVOKED'`)[0].n,before+1);
      await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
      assert.equal(await page.getByRole('heading',{name:'Account',exact:true}).count(),1,'current session remains signed in under HOLD');
    }finally{await sql`UPDATE sf_metadata_current SET generation_id=${original} WHERE singleton`;}
    await page.route('**/api/account/access?**',route=>route.fulfill({status:404,contentType:'application/json',body:'{"error":"NOT_FOUND"}'}));
    await page.getByRole('button',{name:'Load more access',exact:true}).click();await page.getByRole('alert').filter({hasText:'NOT FOUND'}).waitFor();
    assert.equal(await page.locator('.account-project').count(),0);assert.equal(await page.locator('.account-session').count(),0,'denied reads clear cached account data');
    await page.unroute('**/api/account/access?**');
    await page.getByRole('button',{name:'Refresh account',exact:true}).click();await page.getByRole('region',{name:'Account summary',exact:true}).waitFor();
    await page.getByRole('button',{name:'Projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
  }finally{await remote.dispose();}
}
