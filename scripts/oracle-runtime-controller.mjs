/** Fixed-policy operator process. It has no HTTP listener and never receives
 * migration SQL. ADMIN credentials stay in this process, not the API/worker. */
import { open, lstat, mkdir, readFile, rename, chmod, chown, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import postgres from 'postgres';
import { prepareOracleRuntime,publishOracleRuntime,readOracleOperatorFile } from './oracle-runtime-operator.mjs';
import { normalizeOracleInstallationPolicy } from '../packages/connectivity/oracle-installation-policy.mjs';

const ORG='00000000-0000-4000-8000-000000000001';
const ROOT='/run/kelryvo/runtime/execution';
const reject=()=>new Error('Oracle operator controller unavailable');
async function durable(file,value) {
  const temporary=file+'.'+randomUUID(),h=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}
  await rename(temporary,file);const parent=await open(path.dirname(file),constants.O_RDONLY);
  try{await parent.sync();}finally{await parent.close();}
}
export async function initializeOracleWitness(directory) {
  if(process.getuid?.()!==0||!path.isAbsolute(directory))throw reject();
  try{await mkdir(directory,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=await lstat(directory);
  if(!s.isDirectory()||s.isSymbolicLink())throw reject();
  if(s.uid===10002&&(s.mode&0o777)===0o700)return;
  if(s.uid!==0||(await readdir(directory)).length)throw reject();
  await chmod(directory,0o700);await chown(directory,10002,10002);
}
export async function watchOracleRuntime({stateDirectory,databaseUrlFile,vaultKeyFile,policyFile,imageDigest,witnessDirectory,signal}) {
  if(process.platform!=='linux'||process.arch!=='x64'||process.getuid?.()!==0||!path.isAbsolute(stateDirectory)||!/^sha256:[a-f0-9]{64}$/.test(imageDigest??''))throw reject();
  const root=await lstat(stateDirectory);
  if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==0||(root.mode&0o077))throw reject();
  const policy=normalizeOracleInstallationPolicy(JSON.parse((await readOracleOperatorFile(policyFile)).toString()));
  const source=JSON.parse(await readFile(new URL('../source-identity.json',import.meta.url),'utf8'));
  if(!/^[a-f0-9]{40}$/.test(source.sourceSha??''))throw reject();
  const databaseUrl=(await readOracleOperatorFile(databaseUrlFile,16384)).toString().trim();
  const sql=postgres(databaseUrl,{max:1,onnotice:()=>{},connect_timeout:5}),stateFile=path.join(stateDirectory,'controller.json');
  let state={format:1},lastStatus;
  try{state=JSON.parse((await readOracleOperatorFile(stateFile)).toString());if(state.format!==1)throw reject();}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const status=value=>{if(value!==lastStatus){lastStatus=value;process.stdout.write(JSON.stringify({status:value})+'\n');}};
  try {
    while(!signal?.aborted) {
      try {
        let runtime;try{runtime=await lstat(ROOT);}catch{}
        if(!runtime?.isDirectory()||runtime.isSymbolicLink()||runtime.uid!==10002||(runtime.mode&0o777)!==0o700){status('WAITING_FOR_APP_BOOTSTRAP');await delay(1000,undefined,{signal});continue;}
        if(Date.parse(policy.expiresAt)<=Date.now()){status('OPERATOR_POLICY_EXPIRED');break;}
        if(!(await sql`SELECT to_regclass('public.sf_oracle_credentials') AS name`)[0]?.name){status('WAITING_FOR_METADATA');await delay(1000,undefined,{signal});continue;}
        const generation=(await sql`SELECT g.id,g.state FROM sf_metadata_current mc JOIN sf_metadata_generations g ON g.id=mc.generation_id WHERE mc.singleton`)[0];
        if(generation?.state!=='ACTIVE'){status('WAITING_FOR_METADATA_RECOVERY');await delay(1000,undefined,{signal});continue;}
        const rows=await sql`SELECT * FROM sf_database_connections WHERE organization_id=${ORG} AND credential_mode='INSTANCE_MASTER'
          AND enabled AND retired_at IS NULL AND host=${policy.route.host} AND port=${policy.route.port}
          AND service=${policy.route.service} AND transport='TCPS' ORDER BY created_at,id LIMIT 2`;
        if(rows.length!==1){status(rows.length?'INSTANCE_POLICY_CONFLICT':'WAITING_FOR_INSTANCE');await delay(1000,undefined,{signal});continue;}
        const c=rows[0],revision=String(c.revision),attemptKey=[c.id,revision,generation.id,source.sourceSha].join(':');
        if(state.current&&state.current.connectionId!==c.id){status('INSTANCE_REPLACEMENT_REQUIRES_OPERATOR_REVIEW');await delay(1000,undefined,{signal});continue;}
        if(state.current?.attemptKey===attemptKey) {
          let published=false;
          try{const cfg=JSON.parse(await readFile(path.join(ROOT,'installation.json'),'utf8'));published=cfg.installationDigest===state.current.installationDigest;}catch{}
          if(!published)await publishOracleRuntime(state.current.directory);
          status('READY');
        }else if(state.pending?.attemptKey===attemptKey) {
          // A process exit or unknown setup result never triggers another DDL attempt.
          // If the whole operation is recorded PREPARED, publishing its exact files
          // is a filesystem repair and does not replay Oracle setup or migrations.
          let journal;try{journal=JSON.parse((await readOracleOperatorFile(path.join(state.pending.directory,'journal.json'))).toString());}catch{}
          if(journal?.status==='PREPARED') {
            const cfg=JSON.parse((await readOracleOperatorFile(path.join(state.pending.directory,'installation.json'))).toString());
            state.current={...state.pending,installationDigest:cfg.installationDigest};delete state.pending;
            await durable(stateFile,state);await publishOracleRuntime(state.current.directory);status('READY');
          }else status('SETUP_STOPPED_REQUIRES_REVIEW');
        }else{
          const directory=path.join(stateDirectory,'instance-'+c.id+'-'+revision+'-'+randomUUID().slice(0,8));
          state.pending={attemptKey,connectionId:c.id,connectionRevision:revision,directory};await durable(stateFile,state);
          await sql`INSERT INTO sf_database_connection_audit(organization_id,connection_id,action,facts)
            VALUES(${ORG},${c.id},'INSTANCE_RUNTIME_SETUP_STARTED',${sql.json({connectionRevision:revision,sourceSha:source.sourceSha,operatorOsUid:0})})`;
          status('PREPARING');
          try {
            const result=await prepareOracleRuntime({directory,connectionId:c.id,databaseUrlFile,vaultKeyFile,policyFile,imageDigest,
              previousDirectory:state.current?.directory,witnessDirectory,activateRuntime:true,signal});
            state.current={...state.pending,installationDigest:result.installationDigest};delete state.pending;
            await durable(stateFile,state);status('READY');
          }catch{
            await sql`INSERT INTO sf_database_connection_audit(organization_id,connection_id,action,facts)
              VALUES(${ORG},${c.id},'INSTANCE_RUNTIME_SETUP_FAILED',${sql.json({connectionRevision:revision,sourceSha:source.sourceSha,operatorOsUid:0,reason:'INSPECT_PRIVATE_OPERATOR_JOURNAL'})})`;
            status('SETUP_STOPPED_REQUIRES_REVIEW');
          }
        }
      }catch(e){if(signal?.aborted)break;status('WAITING_FOR_OPERATOR_DEPENDENCIES');}
      await delay(1000,undefined,{signal}).catch(()=>{});
    }
  }finally{await sql.end();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,...args]=process.argv.slice(2),allowed=['state-directory','database-url-file','vault-key-file','policy','image-digest','witness-directory'];
    const options={};for(let i=0;i<args.length;i+=2){const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||!allowed.includes(key)||!args[i+1]||Object.hasOwn(options,key))throw reject();options[key]=args[i+1];}
    if(action==='init-witness')await initializeOracleWitness(options['witness-directory']);
    else if(action==='watch'&&allowed.every(k=>options[k])){
      const stop=new AbortController();process.on('SIGTERM',()=>stop.abort());process.on('SIGINT',()=>stop.abort());
      await watchOracleRuntime({stateDirectory:options['state-directory'],databaseUrlFile:options['database-url-file'],vaultKeyFile:options['vault-key-file'],
        policyFile:options.policy,imageDigest:options['image-digest'],witnessDirectory:options['witness-directory'],signal:stop.signal});
    }else throw reject();
  }catch{process.stderr.write('Oracle operator controller unavailable; inspect private installation state.\n');process.exitCode=1;}
}
