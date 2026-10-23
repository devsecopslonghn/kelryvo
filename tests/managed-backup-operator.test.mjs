import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PG_IMAGE } from '../scripts/local-resources.mjs';
import { createManagedPostgresBackup, managedBackupTargetsCompatible } from '../packages/backup/index.mjs';
import { createManagedBackupAttestation, readManagedBackupAttestation, startManagedPostgresPortForward,
  verifyManagedPostgresTarget } from '../scripts/managed-backup-operator.mjs';

const uid=()=>randomUUID();
const secret='a'.repeat(64),admin='b'.repeat(64);
function fixture() {
  const statefulSetUid=uid(),serviceUid=uid(),podUid=uid(),pvcUid=uid(),pvUid=uid(),secretUid=uid();
  const ca=Buffer.from('managed-pg-test-ca').toString('base64'),apiServer='https://kubernetes.example.test:6443';
  const imageId=`docker-pullable://docker.io/library/postgres@${PG_IMAGE.split('@')[1]}`;
  const config={format:'kelryvo-managed-postgresql-operator-v1',clusterContext:'k8s-admin-public',apiServer,
    clusterCaSha256:createHash('sha256').update(Buffer.from(ca,'base64')).digest('hex'),namespace:'kelryvo',statefulSet:'kelryvo-postgresql',statefulSetUid,
    service:'kelryvo-postgresql',serviceUid,pod:'kelryvo-postgresql-0',podUid,pvc:'kelryvo-postgresql-data',pvcUid,
    pv:`pvc-${pvcUid}`,pvUid,secret:'kelryvo-postgresql',secretUid,image:PG_IMAGE,imageId,serverVersionNum:170010};
  const resources={
    'statefulset/kelryvo-postgresql':{metadata:{uid:statefulSetUid},spec:{replicas:1,serviceName:'kelryvo-postgresql',selector:{matchLabels:{'app.kubernetes.io/component':'postgresql','app.kubernetes.io/instance':'kelryvo'}},template:{spec:{containers:[{name:'postgresql',image:PG_IMAGE}]}}},status:{readyReplicas:1}},
    'service/kelryvo-postgresql':{metadata:{uid:serviceUid},spec:{type:'ClusterIP',selector:{'app.kubernetes.io/component':'postgresql','app.kubernetes.io/instance':'kelryvo'},ports:[{port:5432,targetPort:'postgresql',protocol:'TCP'}]}},
    'pod/kelryvo-postgresql-0':{metadata:{uid:podUid,namespace:'kelryvo',ownerReferences:[{kind:'StatefulSet',name:'kelryvo-postgresql',uid:statefulSetUid}]},spec:{containers:[{name:'postgresql',image:PG_IMAGE,ports:[{name:'postgresql',containerPort:5432,protocol:'TCP'}]}],volumes:[{name:'data',persistentVolumeClaim:{claimName:'kelryvo-postgresql-data'}},{name:'secrets',secret:{secretName:'kelryvo-postgresql'}}]},status:{phase:'Running',podIP:'10.0.0.8',containerStatuses:[{name:'postgresql',image:PG_IMAGE,imageID:imageId,ready:true}]}},
    [`pv/${config.pv}`]:{metadata:{uid:pvUid},spec:{persistentVolumeReclaimPolicy:'Retain',claimRef:{namespace:'kelryvo',name:'kelryvo-postgresql-data',uid:pvcUid}}},
    'pvc/kelryvo-postgresql-data':{metadata:{uid:pvcUid},spec:{volumeName:config.pv},status:{phase:'Bound'}},
    'secret/kelryvo-postgresql':{metadata:{uid:secretUid},type:'Opaque',data:{'app-password':Buffer.from(secret).toString('base64'),'admin-password':Buffer.from(admin).toString('base64')}},
    'endpoints/kelryvo-postgresql':{subsets:[{addresses:[{ip:'10.0.0.8',targetRef:{uid:podUid}}],ports:[{port:5432,protocol:'TCP'}]}]},
  };
  const clusterConfig={server:apiServer,caData:ca,caPath:'',insecure:''};
  function command(program,args) {
    assert.equal(program,'kubectl');
    if(args.includes('config')&&args.includes('current-context'))return 'k8s-admin-public';
    if(args.includes('config')&&args.includes('view')){
      assert.ok(args.includes('--raw'));assert.ok(args.includes('--minify'));assert.ok(args.includes('k8s-admin-public'));
      const format=args.find(value=>value.startsWith('jsonpath='));
      assert.ok(format,'only cluster JSONPath fields are read');
      const field=format.slice('jsonpath={.clusters[0].cluster.'.length,-1);
      return ({server:clusterConfig.server,'certificate-authority-data':clusterConfig.caData,
        'certificate-authority':clusterConfig.caPath,'insecure-skip-tls-verify':clusterConfig.insecure})[field]??'';
    }
    const at=args.indexOf('get');const kind=args[at+1],name=args[at+2];
    if(kind==='secret'&&args.at(-1)==='jsonpath={.metadata.uid}')return secretUid;
    const value=resources[`${kind}/${name}`];if(!value)throw new Error('unexpected fake kubectl query');
    return JSON.stringify(value);
  }
  return {config,resources,command,clusterConfig,secretUid,podUid,statefulSetUid};
}
test('managed operator attestation pins the live Kubernetes objects and secret only on backup entry',async()=>{
  const f=fixture(),root=await mkdtemp(path.join(tmpdir(),'kelryvo-managed-pg-'));
  try{
    await chmod(root,0o700);
    const output=path.join(root,'attestation.json');
    const result=await createManagedBackupAttestation(output,{command:f.command});
    const stat=await lstat(output);assert.equal(stat.mode&0o777,0o600);
    assert.equal(result.podUid,f.podUid);assert.equal(result.statefulSetUid,f.statefulSetUid);
    const config=await readManagedBackupAttestation(output);assert.equal(config.pv,f.config.pv);
    const live=await verifyManagedPostgresTarget(config,{command:f.command,includeCredentials:true});
    assert.equal(live.appPassword,secret);assert.equal(live.adminPassword,admin);
    assert.equal(live.managedTarget.database,'kelryvo');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('managed operator rejects changed endpoint, Pod identity, image, PVC and namespace before backup',async()=>{
  const f=fixture();
  await verifyManagedPostgresTarget(f.config,{command:f.command});
  for(const [key,change] of [
    ['service/kelryvo-postgresql',x=>x.metadata.uid=uid()],
    ['service/kelryvo-postgresql',x=>x.spec.ports[0].targetPort='unreviewed-name'],
    ['pod/kelryvo-postgresql-0',x=>x.metadata.uid=uid()],
    ['pod/kelryvo-postgresql-0',x=>x.spec.containers[0].ports[0].containerPort=5433],
    ['pod/kelryvo-postgresql-0',x=>x.spec.containers[0].ports[0].protocol='UDP'],
    ['pod/kelryvo-postgresql-0',x=>x.status.containerStatuses[0].imageID='docker://sha256:'+ 'd'.repeat(64)],
    ['pvc/kelryvo-postgresql-data',x=>x.status.phase='Pending'],
    ['endpoints/kelryvo-postgresql',x=>x.subsets[0].addresses[0].targetRef.uid=uid()],
    ['pv/'+f.config.pv,x=>x.spec.persistentVolumeReclaimPolicy='Delete'],
  ]){
    const original=structuredClone(f.resources[key]);change(f.resources[key]);
    await assert.rejects(()=>verifyManagedPostgresTarget(f.config,{command:f.command}));
    f.resources[key]=original;
  }
  await assert.rejects(()=>verifyManagedPostgresTarget({...f.config,namespace:'other'},{command:f.command}));
  const extraKey=structuredClone(f.resources['secret/kelryvo-postgresql']);
  f.resources['secret/kelryvo-postgresql'].data.extra=Buffer.from('unused').toString('base64');
  await assert.rejects(()=>verifyManagedPostgresTarget(f.config,{command:f.command,includeCredentials:true}));
  f.resources['secret/kelryvo-postgresql']=extraKey;
});

test('managed operator rejects redacted, invalid, replaced or insecure cluster CA configuration',async()=>{
  const f=fixture();
  for(const [key,value] of [
    ['caData','DATA+OMITTED'],
    ['caData','%%%=='],
    ['caData',Buffer.from('replacement-cluster-ca').toString('base64')],
    ['insecure','true'],
    ['caPath','/etc/kubernetes/ca.crt'],
    ['server','https://user:pass@kubernetes.example.test:6443'],
    ['server','https://kubernetes.example.test:6443?token=redacted'],
  ]){
    const original=f.clusterConfig[key];f.clusterConfig[key]=value;
    await assert.rejects(()=>verifyManagedPostgresTarget(f.config,{command:f.command}));
    f.clusterConfig[key]=original;
  }
});

test('managed attestation rejects unsafe permissions, extra authority fields and secrets in config',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'kelryvo-managed-config-'));
  try{
    await chmod(root,0o700);const file=path.join(root,'operator.json');const f=fixture();
    await writeFile(file,JSON.stringify({...f.config,databasePassword:secret}),{mode:0o600});
    await assert.rejects(()=>readManagedBackupAttestation(file));
    await writeFile(file,JSON.stringify(f.config),{mode:0o600});await chmod(file,0o644);
    await assert.rejects(()=>readManagedBackupAttestation(file));
  }finally{await rm(root,{recursive:true,force:true});}
});

test('managed port-forward targets the pinned Pod on loopback only and terminates cleanly',async()=>{
  const f=fixture(),argsSeen=[];
  class Child extends EventEmitter{
    constructor(){super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.exitCode=null;this.signalCode=null;}
    kill(signal){this.signalCode=signal;this.exitCode=0;this.emit('exit',0,signal);return true;}
  }
  let child;
  const forward=await startManagedPostgresPortForward(f.config,{command:f.command,spawnProcess:(program,args)=>{
    argsSeen.push(program,args);child=new Child();setTimeout(()=>child.stderr.write('Forwarding from 127.0.0.1:41731 -> 5432\n'),5);return child;
  }});
  assert.equal(forward.port,41731);assert.equal(argsSeen[0],'kubectl');
  assert.ok(argsSeen[1].includes('--request-timeout=0'));
  assert.ok(argsSeen[1].includes('pod/kelryvo-postgresql-0'));assert.ok(argsSeen[1].includes('--address'));
  assert.ok(argsSeen[1].includes('127.0.0.1'));assert.ok(argsSeen[1].includes(':5432'));
  await forward.stop();assert.equal(child.signalCode,'SIGTERM');
});

test('managed backup package API rejects an unbound target before opening any connection',async()=>{
  await assert.rejects(()=>createManagedPostgresBackup({port:5432,appPassword:secret,destination:'/tmp/unused',
    witnessPath:'/tmp/unused-witness',managedTarget:{format:'untrusted'},assertTarget:async()=>{}}),
    /Local backup or restore failed/);
});

test('managed backup restore compatibility survives Pod replacement and Secret rotation only',()=>{
  const f=fixture(),target={format:'kelryvo-managed-postgresql-v1',context:'k8s-admin-public',apiServer:f.config.apiServer,
    clusterCaSha256:f.config.clusterCaSha256,database:'kelryvo',namespace:'kelryvo',statefulSetUid:f.config.statefulSetUid,
    serviceUid:f.config.serviceUid,podUid:f.config.podUid,pvcUid:f.config.pvcUid,pv:f.config.pv,pvUid:f.config.pvUid,
    secretUid:f.config.secretUid,image:PG_IMAGE,imageId:f.config.imageId,serverVersionNum:170010};
  assert.equal(managedBackupTargetsCompatible(target,{...target,podUid:uid(),secretUid:uid()}),true);
  assert.equal(managedBackupTargetsCompatible(target,{...target,pvUid:uid()}),false);
  assert.equal(managedBackupTargetsCompatible(target,{...target,apiServer:'https://other.example.test'}),false);
});

test('managed tunnel reports uncertainty if its own child cannot be reaped',async()=>{
  const f=fixture();
  class StuckChild extends EventEmitter{
    constructor(){super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.pid=123;this.exitCode=null;this.signalCode=null;this.kills=[];}
    kill(signal){this.kills.push(signal);return true;}
    unref(){this.unreferenced=true;}
  }
  let child;
  const forward=await startManagedPostgresPortForward(f.config,{command:f.command,stopTimeoutMs:5,spawnProcess:()=>{
    child=new StuckChild();setTimeout(()=>child.stderr.write('Forwarding from 127.0.0.1:41731 -> 5432\n'),1);return child;
  }});
  const rejected=()=>assert.rejects(forward.stop(),error=>error.code==='KELRYVO_BACKUP_TUNNEL_CLEANUP_UNCERTAIN');
  await rejected();await rejected();assert.deepEqual(child.kills,['SIGTERM','SIGKILL']);assert.equal(child.unreferenced,true);
});

test('managed tunnel handles a missing executable without an unhandled error',async()=>{
  const f=fixture();
  class MissingChild extends EventEmitter{
    constructor(){super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.exitCode=null;this.signalCode=null;}
  }
  await assert.rejects(startManagedPostgresPortForward(f.config,{command:f.command,stopTimeoutMs:5,spawnProcess:()=>{
    const child=new MissingChild();queueMicrotask(()=>child.emit('error',new Error('fixture spawn unavailable')));return child;
  }}),/Managed PostgreSQL backup operator failed/);
});
