// Actual native project creation never grants membership. Receipt UUIDs remain
// available across navigation only in the current signed-in browser session.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function projectAccessBrowser({page,api,sql,actor}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private project access fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const idle=()=>page.locator('#root[aria-busy="false"]').waitFor();
  const receipts=()=>page.getByRole('region',{name:'Project access handoff',exact:true});
  const name='Native receipt <script>window.projectReceiptCanary=true</script> Tiếng Việt 😀';
  const create=async projectName=>{
    await page.locator('#project-name').fill(projectName);await page.locator('#project-description').fill('Scoped creation receipt');
    await page.getByRole('button',{name:'Create project',exact:true}).click();await idle();
    const receipt=receipts().last(),id=await receipt.getAttribute('data-project-id');assert.match(id,/^[a-f0-9-]{36}$/);
    assert.match(await receipt.innerText(),new RegExp(`kelryvo-operator pilot grant .*--project ${id}`));
    assert.equal((await sql`SELECT count(*)::int n FROM sf_project_grants WHERE project_id=${id} AND actor_id=${actor} AND revoked_at IS NULL`)[0].n,0);
    assert.equal((await api.get(`/api/projects/${id}`)).status(),404,'creator has no implicit project membership');
    assert.equal(await page.locator(`#project-card-${id}`).count(),0,'a receipt is not an assigned project card');
    return id;
  };
  await page.getByRole('button',{name:'Projects',exact:true}).click();await idle();
  const first=await create(name),second=await create('Native second receipt');assert.notEqual(first,second);assert.equal(await receipts().count(),2);
  assert.equal(await receipts().locator('script').count(),0);assert.equal(await page.evaluate(()=>window.projectReceiptCanary),undefined);
  assert.equal(await page.evaluate(id=>[localStorage,sessionStorage].some(storage=>Object.keys(storage).some(key=>storage.getItem(key)?.includes(id))),first),false);
  await page.getByRole('button',{name:'Account',exact:true}).click();await page.getByRole('heading',{name:'Account',exact:true}).waitFor();
  await page.getByRole('button',{name:'Projects',exact:true}).click();await idle();assert.equal(await receipts().count(),2,'navigation retains both handoff UUIDs');
  const original=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
  const hold=randomUUID();await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'d'.repeat(64)},1000)`;
  try{
    await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;
    await page.getByRole('button',{name:'Refresh projects',exact:true}).click();await idle();
    assert.equal(await page.getByRole('button',{name:'Create project',exact:true}).isDisabled(),true);assert.equal(await receipts().count(),2);
  }finally{await sql`UPDATE sf_metadata_current SET generation_id=${original} WHERE singleton`;}
  await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${first},${actor},1000)`;
  await page.getByRole('button',{name:'Refresh projects',exact:true}).click();await idle();
  assert.equal(await page.getByRole('button',{name:'Create project',exact:true}).isEnabled(),true);assert.equal(await receipts().count(),2);
  await page.getByLabel('Search projects',{exact:true}).fill('receipt <SCRIPT>');
  assert.equal(await page.locator('.project-card:not([hidden])').count(),1);assert.equal(await page.locator(`#project-card-${first}`).isVisible(),true);
  await page.getByRole('button',{name:'Refresh projects',exact:true}).click();await idle();assert.equal(await page.getByLabel('Search projects',{exact:true}).inputValue(),'receipt <SCRIPT>');
  await page.getByLabel('Search projects',{exact:true}).fill('absent project search fixture');await page.getByText('No projects match your search.',{exact:true}).waitFor();assert.equal(await page.locator('.project-card:not([hidden])').count(),0);
  await page.getByLabel('Search projects',{exact:true}).fill('');
  await page.setViewportSize({width:390,height:844});
  const mobileLayout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,boxes:[...document.querySelectorAll('.app-shell,aside,main,fieldset,.project-receipt,.project-card:not([hidden])')].map(n=>({tag:n.tagName,class:n.className,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right}))}));
  assert.ok(mobileLayout.scroll<=mobileLayout.width,`receipt names and operator command fit a mobile viewport: ${JSON.stringify(mobileLayout)}`);
  await page.setViewportSize({width:1280,height:720});
  await page.locator(`#project-card-${first}`).getByRole('button',{name:'Open project',exact:true}).click();await idle();
  const advice=page.getByRole('region',{name:'Recommended next step',exact:true});await advice.getByRole('heading',{name:'Configure a project target',exact:true}).waitFor();
  await advice.getByRole('button',{name:'Connect an Oracle instance',exact:true}).click();await idle();assert.equal(await page.locator('#instance-project').inputValue(),first,'instance navigation retains the current project');
  assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id IN (${first},${second})`)[0].n,0);
  for(const id of [first,second])assert.equal((await sql`SELECT count(*)::int n FROM sf_audit WHERE project_id=${id} AND action='PROJECT_CREATED' AND actor_id=${actor}`)[0].n,1);
  await page.getByRole('button',{name:'Projects',exact:true}).click();await idle();assert.equal(await receipts().count(),2);
}
