import { setTimeout as delay } from 'node:timers/promises';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInstalledExecutionService } from './execution-service.mjs';
import { createInstalledExecutionWorkerFactory } from './installed-worker-factory.mjs';
import { createManagedOracle, validateManagedOracleConfig } from './managed-oracle.mjs';

const ROOT='/run/kelryvo/runtime/execution';
const reject=()=>new Error('Installed Oracle runtime unavailable');
export async function readManagedRuntimeFile(name,max=131072) {
  if(process.getuid?.()!==10002 || !/^[a-z][a-z0-9.-]{0,63}$/.test(name) || name.includes('..'))throw reject();
  const handle=await open(ROOT+'/'+name,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const s=await handle.stat();
    if(!s.isFile()||s.uid!==10002||s.nlink!==1||(s.mode&0o777)!==0o600||s.size<1||s.size>max)throw reject();
    const bytes=await handle.readFile();if(bytes.length>max)throw reject();return bytes;
  }finally{await handle.close();}
}
async function load() {
  const config=await validateManagedOracleConfig(JSON.parse((await readManagedRuntimeFile('installation.json')).toString()));
  const databaseUrl=(await readManagedRuntimeFile('database-url',16384)).toString().trim();
  const u=new URL(databaseUrl),m=config.metadataDatabase;
  if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!==m.host||Number(u.port||5432)!==m.port
    ||decodeURIComponent(u.pathname.slice(1))!==m.database||decodeURIComponent(u.username)!==m.user)throw reject();
  return {config,databaseUrl};
}
export async function createManagedExecutionWorker() {
  try {
    const {config,databaseUrl}=await load();
    const installedOracle=await createManagedOracle({config,readSecret:async name=>(await readManagedRuntimeFile(name,8192)).toString().replace(/[\r\n]+$/,'')});
    const create=createInstalledExecutionWorkerFactory({databaseUrl,installedOracle,leaseSeconds:config.leaseSeconds,
      expectedMetadataGenerationId:config.metadataGenerationId});
    return await create();
  }catch{throw reject();}
}
// Node timers overflow above 2^31-1 milliseconds. Re-arm long installations
// in bounded chunks; only the actual protected deadline aborts execution.
export function createOracleRuntimeExpiry(expiresAt) {
  const deadline=Date.parse(expiresAt);if(!Number.isFinite(deadline))throw reject();
  const stop=new AbortController();let timer;
  const arm=()=>{
    const remaining=deadline-Date.now();
    if(remaining<=0){stop.abort();return;}
    timer=setTimeout(arm,Math.min(remaining,2147483647));timer.unref();
  };
  arm();return {signal:stop.signal,close:()=>clearTimeout(timer)};
}
export async function createManagedExecutionService() {
  // Control-plane startup must not depend on a credential that the user has not
  // registered yet. The waiting state cannot dispatch or attest Oracle work.
  let service=null,closing=false,running=false;
  return Object.freeze({scope:'TRUSTED_VALIDATED',
    run:async signal=>{
      if(running)throw reject();running=true;
      while(!closing&&!signal?.aborted) {
        let loaded;
        try{loaded=await load();}catch{
          await delay(1000,undefined,{signal}).catch(()=>{});continue;
        }
        const {config,databaseUrl}=loaded;
        service=await createInstalledExecutionService({databaseUrl,scope:'TRUSTED_VALIDATED',connectionId:config.connectionId,
          pageSize:10,pollMs:config.pollMs,
          executionFactory:{factoryUrl:'file://'+ROOT+'/oracle-worker.mjs',workerId:config.workerId,
            limits:{operationMs:900000,termGraceMs:500,reapMs:5000,outputBytes:16384},
            env:{SCHEMAFORGE_JAVA_HOME:'/opt/kelryvo/.cache/antlr/temurin'}},
          recoveryFactory:{factoryUrl:new URL('./expiry-recovery-factory.mjs',import.meta.url).href,workerId:'installed-expiry-recovery'}});
        if(service.scope!=='TRUSTED_VALIDATED'||service.generationId!==config.metadataGenerationId){await service.close();throw reject();}
        const remaining=Date.parse(config.expiresAt)-Date.now();if(remaining<=0){await service.close();service=null;continue;}
        const expiry=createOracleRuntimeExpiry(config.expiresAt),combined=signal?AbortSignal.any([signal,expiry.signal]):expiry.signal;
        try{return await service.run(combined);}finally{expiry.close();}
      }
      return {status:'STOPPED',scope:'TRUSTED_VALIDATED',results:[]};
    },close:async()=>{closing=true;await service?.close();}});
}
