// Navigation advice through actual native project/plan/job read APIs. It must
// never create a request, review decision, admission or Oracle effect.
import assert from 'node:assert/strict';

export async function projectNextStepBrowser({page,sql,project,title,button,tab,planId,status}){
  const snapshot=async()=>({
    jobs:await sql`SELECT id,state,revision FROM sf_execution_jobs WHERE project_id=${project} ORDER BY id`,
    plans:await sql`SELECT id,status,approval_reference,reviewer_id,reviewer_revision FROM sf_plans WHERE project_id=${project} ORDER BY id`,
    audit:(await sql`SELECT count(*)::int n FROM sf_audit WHERE project_id=${project}`)[0].n,
  });
  const before=await snapshot();
  await page.getByRole('button',{name:'Overview',exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
  const advice=page.getByRole('region',{name:'Recommended next step',exact:true});await advice.getByRole('heading',{name:title,exact:true}).waitFor();
  await advice.getByRole('button',{name:button,exact:true}).click();await page.locator('#root[aria-busy="false"]').waitFor();
  await page.getByRole('heading',{name:tab,exact:true}).waitFor();
  if(status)assert.equal(await page.getByLabel('Plan status',{exact:true}).inputValue(),status);
  if(planId)await page.getByRole('heading',{name:`Plan ${planId}`,exact:true}).waitFor();
  assert.deepEqual(await snapshot(),before,'recommendations and navigation only read governance state');
}
