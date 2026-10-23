import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createManagedPostgresBackup, restoreManagedPostgresBackup } from '../packages/backup/index.mjs';
import { PG_IMAGE } from './local-resources.mjs';

const FORMAT='kelryvo-managed-postgresql-operator-v1';
const CONTEXT='k8s-admin-public', NAMESPACE='kelryvo';
const STATEFUL_SET='kelryvo-postgresql', SERVICE='kelryvo-postgresql', POD='kelryvo-postgresql-0';
const PVC='kelryvo-postgresql-data', SECRET='kelryvo-postgresql';
const DATABASE='kelryvo', APP_USER='kelryvo', ADMIN_USER='postgres', SERVER_VERSION=170010;
const fail=()=>new Error('Managed PostgreSQL backup operator failed; inspect private operator state.');
const sha=value=>createHash('sha256').update(value).digest('hex');
const uidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pinnedImageDigest=PG_IMAGE.split('@')[1];
const CONFIG_KEYS=['apiServer','clusterCaSha256','clusterContext','format','image','imageId','namespace','pod','podUid',
  'pv','pvUid','pvc','pvcUid','secret','secretUid','serverVersionNum','service','serviceUid','statefulSet','statefulSetUid'];

function privatePath(file) {
  if(typeof file!=='string'||!path.isAbsolute(file))throw fail();
  return path.resolve(file);
}

export async function readManagedBackupAttestation(file) {
  const resolved=privatePath(file);let cursor=path.parse(resolved).root;
  for(const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)){
    cursor=path.join(cursor,part);try{if((await lstat(cursor)).isSymbolicLink())throw fail();}catch(error){if(error.code!=='ENOENT')throw fail();}
  }
  const dir=await lstat(path.dirname(resolved));
  if(!dir.isDirectory()||dir.uid!==(process.geteuid?.()??process.getuid())||(dir.mode&0o777)!==0o700)throw fail();
  const handle=await open(resolved,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const st=await handle.stat();
    if(!st.isFile()||st.uid!==(process.geteuid?.()??process.getuid())||st.nlink!==1||st.size>16_384||(st.mode&0o777)!==0o600)throw fail();
    const config=JSON.parse(await handle.readFile('utf8'));validateConfig(config);return config;
  }catch{throw fail();}finally{await handle.close();}
}

function validateConfig(c) {
  if(!c||Array.isArray(c)||Object.keys(c).sort().join(',')!==CONFIG_KEYS.slice().sort().join(',')
    ||c.format!==FORMAT||c.clusterContext!==CONTEXT||c.namespace!==NAMESPACE||c.statefulSet!==STATEFUL_SET
    ||c.service!==SERVICE||c.pod!==POD||c.pvc!==PVC||typeof c.pv!=='string'||!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(c.pv)||c.secret!==SECRET
    ||c.image!==PG_IMAGE||c.serverVersionNum!==SERVER_VERSION
    ||!/^https:\/\//.test(c.apiServer)||!/^([a-f0-9]{64})$/.test(c.clusterCaSha256)
    ||typeof c.imageId!=='string'||c.imageId.length>512||!c.imageId.includes(`@${pinnedImageDigest}`)
    ||['statefulSetUid','serviceUid','podUid','pvcUid','pvUid','secretUid'].some(key=>!uidPattern.test(c[key]??'')))throw fail();
  return c;
}

function run(program,args,{timeout=15_000,maxBuffer=4*1024*1024}={}) {
  const result=spawnSync(program,args,{encoding:'utf8',timeout,maxBuffer,windowsHide:true});
  if(result.error||result.status!==0)throw fail();
  return result.stdout??'';
}

async function kjson(args,command=run) {
  const raw=await command('kubectl',['--context',CONTEXT,'--request-timeout=10s',...args]);
  try{return JSON.parse(raw);}catch{throw fail();}
}

function contextFacts(command=run) {
  const read=field=>command('kubectl',['config','view','--raw','--minify','--context',CONTEXT,
    '--request-timeout=10s','-o',`jsonpath={.clusters[0].cluster.${field}}`]).trim();
  const server=read('server'),caData=read('certificate-authority-data'),caPath=read('certificate-authority');
  const insecure=read('insecure-skip-tls-verify');
  let endpoint,caBytes;
  try{endpoint=new URL(server);}catch{throw fail();}
  if(endpoint.protocol!=='https:'||!endpoint.hostname||endpoint.username||endpoint.password||endpoint.search||endpoint.hash
    ||(endpoint.pathname!==''&&endpoint.pathname!=='/')||caPath!==''||(insecure!==''&&insecure!=='false')
    ||typeof caData!=='string'||caData.length===0||caData.length%4!==0
    ||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(caData))throw fail();
  try{caBytes=Buffer.from(caData,'base64');}catch{throw fail();}
  if(caBytes.length===0||caBytes.toString('base64')!==caData)throw fail();
  return {apiServer:endpoint.origin,clusterCaSha256:sha(caBytes)};
}

export async function createManagedBackupAttestation(output,{command=run}={}) {
  try{
    const resolved=privatePath(output),directory=await lstat(path.dirname(resolved));
    if(!directory.isDirectory()||directory.uid!==(process.geteuid?.()??process.getuid())||(directory.mode&0o777)!==0o700)throw fail();
    let cursor=path.parse(resolved).root;
    for(const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)){
      cursor=path.join(cursor,part);try{if((await lstat(cursor)).isSymbolicLink())throw fail();}catch(error){if(error.code!=='ENOENT')throw fail();}
    }
    if(command('kubectl',['config','current-context']).trim()!==CONTEXT)throw fail();
    const context=contextFacts(command);
    const ns=['-n',NAMESPACE];
    const [sts,svc,pod,pvc,secretUid]=await Promise.all([
      kjson([...ns,'get','statefulset',STATEFUL_SET,'-o','json'],command),
      kjson([...ns,'get','service',SERVICE,'-o','json'],command),
      kjson([...ns,'get','pod',POD,'-o','json'],command),
      kjson([...ns,'get','pvc',PVC,'-o','json'],command),
      command('kubectl',['--context',CONTEXT,'--request-timeout=10s',...ns,'get','secret',SECRET,'-o','jsonpath={.metadata.uid}']),
    ]);
    const pv=pvc.spec?.volumeName;
    if(!pv)throw fail();
    const volume=await kjson(['get','pv',pv,'-o','json'],command);
    const imageId=(pod.status?.containerStatuses??[]).find(row=>row.name==='postgresql')?.imageID;
    const config={format:FORMAT,clusterContext:CONTEXT,apiServer:context.apiServer,clusterCaSha256:context.clusterCaSha256,
      namespace:NAMESPACE,statefulSet:STATEFUL_SET,statefulSetUid:sts.metadata?.uid,service:SERVICE,serviceUid:svc.metadata?.uid,
      pod:POD,podUid:pod.metadata?.uid,pvc:PVC,pvcUid:pvc.metadata?.uid,pv,pvUid:volume.metadata?.uid,
      secret:SECRET,secretUid:secretUid.trim(),image:PG_IMAGE,imageId,serverVersionNum:SERVER_VERSION};
    validateConfig(config);await verifyManagedPostgresTarget(config,{command});
    const handle=await open(resolved,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(`${JSON.stringify(config,null,2)}\n`);await handle.sync();}finally{await handle.close();}
    const parent=await open(path.dirname(resolved),constants.O_RDONLY);try{await parent.sync();}finally{await parent.close();}
    return {output:resolved,namespace:NAMESPACE,statefulSet:STATEFUL_SET,service:SERVICE,pod:POD,pvc:PVC,pv,
      statefulSetUid:config.statefulSetUid,serviceUid:config.serviceUid,podUid:config.podUid,pvcUid:config.pvcUid,
      pvUid:config.pvUid,secretUid:config.secretUid,imageId:config.imageId};
  }catch{throw fail();}
}

function singleEndpoint(endpoints,podUid,podIP) {
  const items=(endpoints?.subsets??[]).flatMap(s=>(s.addresses??[]).map(address=>({address,ports:s.ports??[]})));
  return items.length===1&&items[0].address.targetRef?.uid===podUid&&items[0].address.ip===podIP
    &&items[0].ports.length===1&&items[0].ports[0].port===5432&&items[0].ports[0].protocol==='TCP';
}

function validPostgresServiceTargetPort(service,pod) {
  const ports=service.spec?.ports??[];
  if(ports.length!==1||ports[0].port!==5432||ports[0].protocol!=='TCP')return false;
  if(ports[0].targetPort===5432)return true;
  if(ports[0].targetPort!=='postgresql')return false;
  const containers=(pod.spec?.containers??[]).filter(c=>c.name==='postgresql');
  if(containers.length!==1)return false;
  const matches=(containers[0].ports??[]).filter(port=>port.name==='postgresql'&&port.containerPort===5432&&port.protocol==='TCP');
  return matches.length===1;
}

export async function verifyManagedPostgresTarget(config,{command=run,includeCredentials=false}={}) {
  try{
    validateConfig(config);
    if(command('kubectl',['config','current-context']).trim()!==CONTEXT)throw fail();
    const facts=contextFacts(command);
    if(facts.apiServer!==config.apiServer||facts.clusterCaSha256!==config.clusterCaSha256)throw fail();
    const ns=['-n',NAMESPACE];
    const [sts,svc,pod,pvc,pv,secretUid,endpoints]=await Promise.all([
      kjson([...ns,'get','statefulset',STATEFUL_SET,'-o','json'],command),
      kjson([...ns,'get','service',SERVICE,'-o','json'],command),
      kjson([...ns,'get','pod',POD,'-o','json'],command),
      kjson([...ns,'get','pvc',PVC,'-o','json'],command),
      kjson(['get','pv',config.pv,'-o','json'],command),
      command('kubectl',['--context',CONTEXT,'--request-timeout=10s',...ns,'get','secret',SECRET,'-o','jsonpath={.metadata.uid}']),
      kjson([...ns,'get','endpoints',SERVICE,'-o','json'],command),
    ]);
    const secret=includeCredentials?await kjson([...ns,'get','secret',SECRET,'-o','json'],command):null;
    const container=(pod.spec?.containers??[]).find(c=>c.name==='postgresql');
    const status=(pod.status?.containerStatuses??[]).find(c=>c.name==='postgresql');
    const owner=(pod.metadata?.ownerReferences??[]).find(ref=>ref.kind==='StatefulSet'&&ref.name===STATEFUL_SET);
    const pgData=(pod.spec?.volumes??[]).find(v=>v.name==='data')?.persistentVolumeClaim?.claimName;
    const pvcVolume=pvc.spec?.volumeName;
    const secretRefs=(pod.spec?.volumes??[]).filter(v=>v.secret?.secretName===SECRET);
    const appPassword=secret?.data?.['app-password'],adminPassword=secret?.data?.['admin-password'];
    const selector=svc.spec?.selector??{};
    const pvRetain=pv.spec?.persistentVolumeReclaimPolicy==='Retain';
    if(sts.metadata?.uid!==config.statefulSetUid||sts.spec?.replicas!==1||sts.status?.readyReplicas!==1
      ||sts.spec?.serviceName!==SERVICE||sts.spec?.selector?.matchLabels?.['app.kubernetes.io/component']!=='postgresql'
      ||sts.spec?.selector?.matchLabels?.['app.kubernetes.io/instance']!=='kelryvo'
      ||sts.spec?.template?.spec?.containers?.find(c=>c.name==='postgresql')?.image!==PG_IMAGE
      ||svc.metadata?.uid!==config.serviceUid||svc.spec?.type!=='ClusterIP'
      ||!validPostgresServiceTargetPort(svc,pod)
      ||selector['app.kubernetes.io/component']!=='postgresql'||selector['app.kubernetes.io/instance']!=='kelryvo'
      ||pod.metadata?.uid!==config.podUid||pod.metadata?.namespace!==NAMESPACE||pod.status?.phase!=='Running'
      ||owner?.uid!==config.statefulSetUid||container?.image!==PG_IMAGE
      ||status?.imageID!==config.imageId||!status.imageID.includes(`@${pinnedImageDigest}`)||status?.ready!==true||!pod.status?.podIP
      ||pgData!==PVC||pvc.metadata?.uid!==config.pvcUid||pvc.status?.phase!=='Bound'||pvcVolume!==config.pv
      ||pv.metadata?.uid!==config.pvUid||pvRetain!==true||secretUid.trim()!==config.secretUid
      ||secretRefs.length!==1
      ||includeCredentials&&(secret?.metadata?.uid!==config.secretUid||secret.type!=='Opaque'
        ||JSON.stringify(Object.keys(secret.data??{}).sort())!==JSON.stringify(['admin-password','app-password'])
        ||!/^([a-f0-9]{64})$/.test(Buffer.from(appPassword??'','base64').toString())
        ||!/^([a-f0-9]{64})$/.test(Buffer.from(adminPassword??'','base64').toString()))
      ||!singleEndpoint(endpoints,config.podUid,pod.status.podIP))throw fail();
    const pvClaim=pv.spec?.claimRef;
    if(pvClaim?.namespace!==NAMESPACE||pvClaim?.name!==PVC||pvClaim?.uid!==config.pvcUid)throw fail();
    return {config,...(includeCredentials?{appPassword:Buffer.from(appPassword,'base64').toString(),adminPassword:Buffer.from(adminPassword,'base64').toString()}:{}),
      managedTarget:{format:'kelryvo-managed-postgresql-v1',context:CONTEXT,apiServer:facts.apiServer,clusterCaSha256:facts.clusterCaSha256,database:DATABASE,
        namespace:NAMESPACE,statefulSetUid:config.statefulSetUid,serviceUid:config.serviceUid,podUid:config.podUid,
        pvcUid:config.pvcUid,pv:config.pv,pvUid:config.pvUid,secretUid:config.secretUid,image:PG_IMAGE,imageId:config.imageId,serverVersionNum:SERVER_VERSION}};
  }catch{throw fail();}
}

export async function startManagedPostgresPortForward(config,{spawnProcess=spawn,command=run,timeoutMs=20_000,stopTimeoutMs=3_000}={}) {
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||!Number.isSafeInteger(stopTimeoutMs)||stopTimeoutMs<1)throw fail();
  // A forwarding stream outlives individual bounded API reads. Its parent owns
  // both its startup deadline and confirmed shutdown; no request deadline cuts a dump short.
  const child=spawnProcess('kubectl',['--context',CONTEXT,'--request-timeout=0','-n',NAMESPACE,'port-forward','--address','127.0.0.1',`pod/${POD}`,':5432'],
    {stdio:['ignore','pipe','pipe'],windowsHide:true});
  let captured='',port=null,ended=false,startError=false,closing;
  child.once('exit',()=>{ended=true;});
  child.on('error',()=>{startError=true;if(!child.pid)ended=true;});
  const alive=()=>!ended&&child.exitCode===null&&child.signalCode===null;
  const onData=chunk=>{
    captured=(captured+chunk.toString('utf8')).slice(-8192);
    const match=captured.match(/Forwarding from 127\.0\.0\.1:([0-9]+) -> 5432/);
    if(match)port=Number(match[1]);
  };
  child.stdout.on('data',onData);child.stderr.on('data',onData);
  const waitExit=ms=>new Promise(resolve=>{
    if(!alive()){resolve();return;}
    const finish=()=>{clearTimeout(timer);child.off('exit',finish);resolve();};
    const timer=setTimeout(finish,ms);child.once('exit',finish);
  });
  const stop=()=>closing??=(async()=>{
    if(alive())try{child.kill('SIGTERM');}catch{}
    await waitExit(stopTimeoutMs);
    if(alive()){
      try{child.kill('SIGKILL');}catch{}
      await waitExit(stopTimeoutMs);
    }
    if(alive()){
      child.unref?.();child.stdout.destroy();child.stderr.destroy();
      throw Object.assign(fail(),{code:'KELRYVO_BACKUP_TUNNEL_CLEANUP_UNCERTAIN'});
    }
  })();
  const started=Date.now();
  while(!port&&Date.now()-started<timeoutMs){
    if(startError||!alive()){await stop();throw fail();}
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!port||startError){await stop();throw fail();}
  try{await verifyManagedPostgresTarget(config,{command});}catch{await stop();throw fail();}
  return {port,stop};
}

function parse(args) {
  const [action,...rest]=args,values={},seen=new Set();
  if(action==='attest'){
    if(rest.length!==2||rest[0]!=='--output'||!path.isAbsolute(rest[1]))throw fail();
    return {action,output:rest[1]};
  }
  if(!['backup','restore'].includes(action))throw fail();
  for(let i=0;i<rest.length;i++){
    const key=rest[i],value=rest[++i];
    if(!['--config','--destination','--witness','--backup'].includes(key)||!value||value.startsWith('--'))throw fail();
    const name=key.slice(2);if(seen.has(name))throw fail();seen.add(name);values[name]=value;
  }
  const required=action==='backup'?['config','destination','witness']:['config','backup','witness'];
  if(Object.keys(values).sort().join(',')!==required.slice().sort().join(','))throw fail();
  return {action,...values};
}

export async function runManagedBackupOperator(options,{command=run,startForward=startManagedPostgresPortForward}={}) {
  if(!options||!['backup','restore'].includes(options.action))throw fail();
  const config=await readManagedBackupAttestation(options.config);
  const live=await verifyManagedPostgresTarget(config,{command,includeCredentials:true});
  const forward=await startForward(config,{command});
  try{
    await verifyManagedPostgresTarget(config,{command});
    if(options.action==='backup')return await createManagedPostgresBackup({port:forward.port,appPassword:live.appPassword,
      destination:options.destination,witnessPath:options.witness,managedTarget:live.managedTarget,
      assertTarget:async()=>{await verifyManagedPostgresTarget(config,{command});}});
    const result=await restoreManagedPostgresBackup({port:forward.port,appPassword:live.appPassword,adminPassword:live.adminPassword,
      backupDirectory:options.backup,witnessPath:options.witness,managedTarget:live.managedTarget,
      assertTarget:async()=>{await verifyManagedPostgresTarget(config,{command});}});
    return {databaseName:result.databaseName,hold:true};
  }finally{await forward.stop();}
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
  try{
    const options=parse(process.argv.slice(2));
    if(options.action==='attest'){
      const result=await createManagedBackupAttestation(options.output);
      process.stdout.write(`Private managed PostgreSQL attestation created for ${result.namespace}/${result.statefulSet}, Pod ${result.pod}, PVC ${result.pvc}; exact resource UIDs and image digest are pinned.\n`);
      process.exitCode=0;
    }else{
    const result=await runManagedBackupOperator(options);
    if(options.action==='backup')process.stdout.write(`Managed PostgreSQL backup complete. Witness ${result.witnessId}; archive SHA-256 ${result.archiveSha256}.\n`);
    else process.stdout.write(`Metadata restored into ${result.databaseName}; RESTORE_HOLD active. The live application database and PVC were not changed.\n`);
    }
  }catch(error){
    const phase=typeof error?.code==='string'&&/^KELRYVO_BACKUP_[A-Z0-9_]+$/.test(error.code)?` (${error.code})`:'';
    process.stderr.write(`Managed PostgreSQL backup operator failed${phase}.\n`);process.exitCode=1;
  }
}
