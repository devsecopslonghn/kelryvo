// Display filters against actual native plans at pending/approved/revoked stages.
import assert from 'node:assert/strict';

export async function planListBrowser({page,sql,actor,project,previewPlan}){
  const snapshot=()=>sql`SELECT id,status,reviewer_id,reviewer_revision,approval_reference FROM sf_plans WHERE project_id=${project} ORDER BY id`;
  const before=await snapshot(),audit=(await sql`SELECT count(*)::int n FROM sf_audit WHERE project_id=${project}`)[0].n;
  const idle=()=>page.locator('#root[aria-busy="false"]').waitFor();
  const change=async status=>{await page.getByLabel('Plan status',{exact:true}).selectOption(status);await idle();};
  await change('ALL');
  if(previewPlan){
    await page.locator(`#plan-${previewPlan}`).getByRole('button',{name:'Review SQL',exact:true}).click();await page.locator(`#plan-${previewPlan}`).getByRole('heading',{name:/Retained SQL:/}).waitFor();
  }
  for(const status of ['PENDING_APPROVAL','ASSIGNED_TO_ME','APPROVED','REJECTED','REVOKED','ALL']){
    await change(status);
    const expected=before.filter(r=>status==='ALL'||(status==='ASSIGNED_TO_ME'?r.status==='PENDING_APPROVAL'&&r.reviewer_id===actor:r.status===status)).map(r=>`plan-${r.id}`).sort();
    assert.deepEqual((await page.locator('.review-plan').evaluateAll(nodes=>nodes.map(n=>n.id))).sort(),expected);
    if(!expected.length)await page.getByText('No plans match this status. Choose another status or All.',{exact:true}).waitFor();
  }
  if(previewPlan)assert.equal(await page.locator(`#plan-${previewPlan}`).getByRole('heading',{name:/Retained SQL:/}).count(),0,'changing display filters clears previous SQL previews');
  await change('PENDING_APPROVAL');await page.getByRole('button',{name:'Refresh plans',exact:true}).click();await idle();assert.equal(await page.getByLabel('Plan status',{exact:true}).inputValue(),'PENDING_APPROVAL');
  await change('ALL');
  assert.deepEqual(await snapshot(),before,'display filters never change plan state or reviewer assignment');
  assert.equal((await sql`SELECT count(*)::int n FROM sf_audit WHERE project_id=${project}`)[0].n,audit);
}
