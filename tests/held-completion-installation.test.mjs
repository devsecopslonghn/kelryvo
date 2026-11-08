import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {runInstalledHeldCompletion} from '../apps/worker/held-completion-main.mjs';

test('held-completion CLI loads protected code, projects bounded output and rejects UNIT authority',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'kelryvo-completion-installation-'));
 try{
  await chmod(root,0o700);const jobId=randomUUID(),reconciliationId=randomUUID(),file=path.join(root,'held-completion.mjs');
  await writeFile(file,`export async function createHeldCompletionOperator(){return {scope:'TRUSTED_VALIDATED',preview:async()=>({status:'PREPARED',jobState:'HOLD',retryEligible:false,executionAuthority:false,evidenceDigest:'${'a'.repeat(64)}',privateDiagnostic:'must-not-leak'}),confirm:async()=>({status:'RECOVERED_APPLIED',jobState:'HOLD',retryEligible:false,executionAuthority:false,evidenceDigest:'${'a'.repeat(64)}',repeated:true}),close:async()=>{}}}\n`,{mode:0o600});
  const preview=await runInstalledHeldCompletion({action:'preview',jobId},file);assert.equal(preview.status,'PREPARED');assert.doesNotMatch(JSON.stringify(preview),/privateDiagnostic|must-not-leak/);
  assert.equal((await runInstalledHeldCompletion({action:'confirm',jobId,reconciliationId},file)).repeated,true);
  await assert.rejects(runInstalledHeldCompletion({action:'preview',jobId,reconciliationId},file),/unavailable/);
  await chmod(file,0o644);await assert.rejects(runInstalledHeldCompletion({action:'preview',jobId},file),/unavailable/);await chmod(file,0o600);
  const alias=path.join(root,'alias.mjs');await symlink(file,alias);await assert.rejects(runInstalledHeldCompletion({action:'preview',jobId},alias),/unavailable/);
  const unit=path.join(root,'unit.mjs');await writeFile(unit,"export async function createHeldCompletionOperator(){return {scope:'UNIT_SYNTHETIC',close:async()=>{}}}\n",{mode:0o600});
  await assert.rejects(runInstalledHeldCompletion({action:'preview',jobId},unit),/unavailable/);
 }finally{await rm(root,{recursive:true,force:true});}
});
