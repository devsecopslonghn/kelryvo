import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProtectedInstallationModule } from './execution-service-main.mjs';

const FACTORY='/run/kelryvo/runtime/execution/held-completion.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const reject=()=>new Error('Installed held completion unavailable');

/** Trusted OS/container operator only. The public CLI always loads one fixed
 * protected installation module; request data cannot select code or credentials. */
export async function runInstalledHeldCompletion({action,jobId,reconciliationId},factoryFile=FACTORY){
 let operator;
 try{
  if(!['preview','confirm'].includes(action)||!uuid(jobId)
    ||(action==='confirm'?!uuid(reconciliationId):reconciliationId!==undefined))throw reject();
  const module=await loadProtectedInstallationModule(factoryFile);
  if(typeof module.createHeldCompletionOperator!=='function')throw reject();
  operator=await module.createHeldCompletionOperator();
  if(operator?.scope!=='TRUSTED_VALIDATED'||!['preview','confirm','close'].every(k=>typeof operator[k]==='function'))throw reject();
  const result=action==='preview'?await operator.preview(jobId):await operator.confirm(jobId,reconciliationId);
  if(result?.status!==(action==='preview'?'PREPARED':'RECOVERED_APPLIED')||result.jobState!=='HOLD'
    ||result.executionAuthority!==false||result.retryEligible!==false||!/^[a-f0-9]{64}$/.test(result.evidenceDigest??''))throw reject();
  // Installation diagnostics and raw native facts never enter operator stdout.
  return {jobId,status:result.status,evidenceDigest:result.evidenceDigest,jobState:'HOLD',
    retryEligible:false,executionAuthority:false,...(action==='confirm'?{repeated:result.repeated===true}:{})};
 }catch{throw reject();}
 finally{if(typeof operator?.close==='function')try{await operator.close();}catch{throw reject();}}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [action,jobId,reconciliationId,...extra]=process.argv.slice(2);
  if(process.getuid?.()!==10002||extra.length)throw reject();
  const result=await runInstalledHeldCompletion({action,jobId,reconciliationId});
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch{process.stderr.write('Installed held completion unavailable; retain HOLD and inspect private installation.\n');process.exitCode=1;}
}
