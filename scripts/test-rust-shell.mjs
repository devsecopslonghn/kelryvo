// Native shell controls against real sessions and project reads. Local display
// changes must preserve form DOM nodes and never acquire execution authority.
import assert from 'node:assert/strict';
import path from 'node:path';

export async function shellBrowser({page,api,sql,actor,token,reviewerToken,origin,directory}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private shell fixture required');
  const org='00000000-0000-4000-8000-000000000001',canary='native-shell-form-canary-đ😀';
  const create=async name=>{const response=await api.post('/api/projects',{data:{name}});assert.equal(response.status(),201,await response.text());const id=(await response.json()).project.id;await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${id},${actor},1000)`;return id;};
  const first=await create('Shell <script>window.shellCanary=true</script> Tiếng Việt 😀'),second=await create('Second native shell project');
  const snapshot=async()=>(await sql`SELECT (SELECT count(*) FROM sf_sql_drafts WHERE project_id IN (${first},${second}))::int drafts,(SELECT count(*) FROM sf_audit WHERE project_id IN (${first},${second}))::int audit,(SELECT count(*) FROM sf_execution_jobs WHERE project_id IN (${first},${second}))::int jobs`)[0];
  const before=await snapshot();
  const context=await page.context().browser().newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:800}}),p=await context.newPage(),errors=[],requests=[];
  p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(new URL(r.url()).pathname.startsWith('/api/'))requests.push([r.method(),new URL(r.url()).pathname]);});
  const idle=()=>p.locator('#root[aria-busy="false"]').waitFor();
  const theme=()=>p.getByRole('button',{name:'Toggle color theme',exact:true});
  const signIn=async access=>{await p.getByText('Use an operator access token',{exact:true}).click();await p.getByLabel('Access token',{exact:true}).fill(access);await p.getByRole('button',{name:'Continue',exact:true}).click();await p.getByRole('heading',{name:'Projects',exact:true}).waitFor();await idle();};
  const colors=()=>p.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,input:getComputedStyle(document.querySelector('input')).backgroundColor}));
  const closed=async()=>{assert.equal(await p.getByRole('button',{name:'Open navigation',exact:true}).getAttribute('aria-expanded'),'false');assert.equal(await p.locator('#workspace-sidebar').isVisible(),false);};
  try{
    await p.goto(origin);await idle();await p.locator('form[data-submit="login"]').getByLabel('Username',{exact:true}).fill('Unsaved login fixture');await p.locator('form[data-submit="login"]').getByLabel('Password',{exact:true}).fill(canary);
    await p.locator('#password').evaluate(el=>{window.shellFormElement=el;});const light=await colors(),initialRequests=requests.length;
    await theme().click();assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');assert.equal(await theme().getAttribute('aria-pressed'),'true');assert.notDeepEqual(await colors(),light);assert.equal(await p.locator('meta[name="theme-color"]').getAttribute('content'),'#0b1120');
    assert.equal(await p.locator('form[data-submit="login"]').getByLabel('Password',{exact:true}).inputValue(),canary);assert.equal(await p.evaluate(()=>window.shellFormElement===document.querySelector('#password')),true,'theme changes preserve the active password control');assert.equal(requests.length,initialRequests);
    await theme().click();assert.deepEqual(await colors(),light);assert.equal(await p.locator('form[data-submit="login"]').getByLabel('Username',{exact:true}).inputValue(),'Unsaved login fixture');
    await signIn(token);assert.equal(await p.getByLabel('Active project',{exact:true}).locator('script').count(),0);assert.equal(await p.evaluate(()=>window.shellCanary),undefined);
    await p.getByLabel('Active project',{exact:true}).selectOption(first);await idle();await p.getByRole('heading',{name:'Shell <script>window.shellCanary=true</script> Tiếng Việt 😀',exact:true}).waitFor();
    assert.equal(await p.getByLabel('Active project',{exact:true}).inputValue(),first);assert.equal(await p.getByRole('button',{name:'Overview',exact:true}).getAttribute('aria-current'),'page');
    await p.getByRole('button',{name:'SQL Workspace',exact:true}).click();await idle();await p.getByLabel('Draft name',{exact:true}).fill('Unsaved shell draft');await p.locator('#draft-sql').fill('-- Unsaved shell 😀\nCREATE TABLE shell_item(id NUMBER);');
    const unsaved=await p.locator('#draft-sql').inputValue();await p.locator('#draft-sql').evaluate(el=>{window.shellFormElement=el;});const beforeDisplay=requests.length;
    await theme().click();assert.equal(await p.locator('#draft-sql').inputValue(),unsaved);assert.equal(await p.evaluate(()=>window.shellFormElement===document.querySelector('#draft-sql')),true);assert.equal(requests.length,beforeDisplay,'display changes make no API calls');
    assert.equal(await p.getByRole('button',{name:'SQL Workspace',exact:true}).getAttribute('aria-current'),'page');
    for(const action of ['Refresh workspace','Sign out']){
      const count=requests.length;await p.getByRole('button',{name:action,exact:true}).click();await p.getByRole('alert').filter({hasText:'Save or discard unsaved edits before leaving this draft.'}).waitFor();assert.equal(await p.locator('#draft-sql').inputValue(),unsaved);assert.equal(requests.length,count,'unsaved guards run before refresh or logout requests');
    }
    const count=requests.length;await p.getByLabel('Active project',{exact:true}).selectOption(second);await idle();assert.equal(await p.getByLabel('Active project',{exact:true}).inputValue(),first);assert.equal(await p.locator('#draft-sql').inputValue(),unsaved);assert.equal(requests.length,count);
    await p.getByRole('button',{name:'Discard unsaved edits',exact:true}).click();await idle();await p.getByLabel('Active project',{exact:true}).selectOption(second);await idle();await p.getByRole('heading',{name:'Second native shell project',exact:true}).waitFor();assert.equal(await p.locator('#draft-sql').inputValue(),'');
    await p.getByRole('button',{name:'Account',exact:true}).click();await idle();assert.equal(await p.evaluate(()=>scrollY),0,'screen navigation restores the top of the page');assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');assert.equal(await p.getByRole('button',{name:'Account',exact:true}).getAttribute('aria-current'),'page');assert.equal(await p.getByLabel('Active project',{exact:true}).inputValue(),second);
    await p.getByRole('button',{name:'Refresh workspace',exact:true}).click();await idle();assert.equal(await p.getByLabel('Active project',{exact:true}).inputValue(),second);
    await p.screenshot({path:path.join(directory,'shell-desktop.png')});
    await p.setViewportSize({width:390,height:844});await closed();const open=p.getByRole('button',{name:'Open navigation',exact:true});assert.equal(await open.locator('svg path').count(),1,'navigation icon does not depend on font glyphs');
    await open.click();assert.equal(await open.getAttribute('aria-expanded'),'true');assert.equal(await p.locator('#workspace-sidebar').isVisible(),true);await p.keyboard.press('Escape');await closed();assert.equal(await open.evaluate(el=>document.activeElement===el),true);
    await open.click();await p.getByRole('button',{name:'Close navigation',exact:true}).click({position:{x:380,y:100}});await closed();
    const menuRequests=requests.length;await open.click();await p.keyboard.press('Escape');assert.equal(requests.length,menuRequests,'menu changes make no API calls');
    await open.click();await p.getByRole('button',{name:'Projects',exact:true}).click();await idle();await closed();
    await open.click();await p.getByLabel('Active project',{exact:true}).selectOption(first);await idle();await closed();assert.equal(await p.getByRole('heading',{name:'Shell <script>window.shellCanary=true</script> Tiếng Việt 😀',exact:true}).isVisible(),true);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile workspace fits its viewport');await p.screenshot({path:path.join(directory,'shell-mobile.png')});
    assert.deepEqual(await snapshot(),before,'display, switching and refresh do not persist drafts, review audit or jobs');
    await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${first} AND actor_id=${actor} AND revoked_at IS NULL`;
    await p.getByRole('button',{name:'Refresh workspace',exact:true}).click();await idle();await p.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();await open.click();assert.equal(await p.getByLabel('Active project',{exact:true}).locator(`option[value="${first}"]`).count(),0);await p.keyboard.press('Escape');
    // The same project denial can occur from the global Instances screen.
    await p.setViewportSize({width:1280,height:800});await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${first},${actor},1000)`;
    await p.getByRole('button',{name:'Projects',exact:true}).click();await idle();await p.getByRole('button',{name:'Instances',exact:true}).click();await idle();await p.getByLabel('Project',{exact:true}).selectOption(first);await p.getByRole('button',{name:'Manage instances',exact:true}).click();await idle();assert.equal(await p.getByLabel('Active project',{exact:true}).inputValue(),first);
    await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${first} AND actor_id=${actor} AND revoked_at IS NULL`;
    await p.getByRole('button',{name:'Refresh workspace',exact:true}).click();await idle();assert.equal(await p.getByLabel('Active project',{exact:true}).locator(`option[value="${first}"]`).count(),0);assert.equal(await p.locator('#draft-sql').count(),0);
    await p.getByRole('button',{name:'Sign out',exact:true}).click();await p.getByRole('button',{name:'Sign in',exact:true}).waitFor();assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');
    await signIn(reviewerToken);assert.equal(await p.getByLabel('Active project',{exact:true}).locator(`option[value="${second}"]`).count(),0,'assigned project cache never crosses account changes');
    assert.equal(await p.evaluate(canary=>[localStorage,sessionStorage].some(storage=>Object.keys(storage).some(key=>storage.getItem(key)?.includes(canary))),canary),false);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
}
