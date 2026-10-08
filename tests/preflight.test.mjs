import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { preflight } from '../experiments/db-devops-wp0/preflight.mjs';

const repo=process.cwd();
const offlineRoot=join(repo,'experiments/db-devops-wp0/offline-inputs');
const evidenceRoot=join(repo,'evidence/db-devops-wp0');
const kinds=['node-runtime','npm-toolchain','oracle-driver','sql-parser','postgresql-image','fixture-bundle'];
const actions=['connect','discover-dictionary','execute-owner-ddl','observe-fixtures','bootstrap-allowlisted-fixtures','use-dbms-lock','fault-proxy','stop-fixture-session','teardown-allowlisted-fixtures'];
const NEGATIVE_PROBE_ACTIONS=['connect','observe-fixtures'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

async function profileFixture() {
 await mkdir(offlineRoot,{recursive:true});
 const dir=await mkdtemp(join(offlineRoot,'preflight-test-'));
 const paths=[];
 const artifact=async(name,bytes)=>{const path=join(dir,name);await writeFile(path,bytes);paths.push(path);return {path:relativeOffline(path),sha256:sha(bytes)};};
 const noticeBytes=Buffer.from('synthetic fixture notice marker; no rights assertion');
 const notice=await artifact('NOTICE-fixture.txt',noticeBytes);
 const artifacts=[];
 for(const kind of kinds){const content=Buffer.from(`synthetic ${kind} input`);const data=await artifact(`${kind}.bin`,content);artifacts.push({kind,path:data.path,sha256:data.sha256,version:'1.0.0',sourceRef:`source://synthetic/${kind}`,noticePath:notice.path,noticeSha256:notice.sha256,maintenanceRef:`attestation://synthetic/${kind}`});}
 const pgBytes=Buffer.from('synthetic offline postgres image marker');
 const pg=await artifact('postgres.fixture',pgBytes);
 const route19={service:'svc19',containerId:'cdb19',pdb:'pdb19',environment:'DEV',endpoint:'tcps://oracle19.example.invalid:2484/svc19'};
 const route21={service:'svc21',containerId:'cdb21',pdb:'pdb21',environment:'DEV',endpoint:'tcps://oracle21.example.invalid:2484/svc21'};
 const schemas={};
 for(const [key,owner,prefix,project,pdb19,pdb21,service19,service21] of [['A','APP_A','WP0A_','project-a','pdb19','pdb21','svc19','svc21'],['B','APP_B','WP0B_','project-b','pdb19','pdb21','svc19','svc21'],['C','APP_C','WP0C_','cross-pdb-negative','other19','other21','negative19','negative21']]) schemas[key]={owner,prefix,project,targets:{'19c':{service:service19,containerId:'cdb19',pdb:pdb19,environment:'DEV'},'21c':{service:service21,containerId:'cdb21',pdb:pdb21,environment:'DEV'}}};
 const footprint=[];
 for(const version of ['19c','21c'])for(const key of ['A','B','C']){const f=schemas[key],t=f.targets[version];footprint.push({version,owner:f.owner,prefix:f.prefix,project:f.project,...t});}
 const profile={
  schemaVersion:'1.0.0',
  oracle:{'19c':{exactVersion:'19.22.0.0.0',route:route19,tcps:{caSha256:'a'.repeat(64),serverIdentity:'oracle19.example.invalid'}},'21c':{exactVersion:'21.3.0.0.0',route:route21,tcps:{caSha256:'b'.repeat(64),serverIdentity:'oracle21.example.invalid'}}},
  authorization:{disposable:true,labOwner:'lab-owner',targets:[{version:'19c',service:'svc19',containerId:'cdb19',pdb:'pdb19'},{version:'21c',service:'svc21',containerId:'cdb21',pdb:'pdb21'}],negativeProbeTargets:[{version:'19c',service:'negative19',endpoint:'tcps://oracle19.example.invalid:2484/negative19',serverIdentity:'oracle19.example.invalid',caSha256:'a'.repeat(64),containerId:'cdb19',pdb:'other19',actions:NEGATIVE_PROBE_ACTIONS},{version:'21c',service:'negative21',endpoint:'tcps://oracle21.example.invalid:2484/negative21',serverIdentity:'oracle21.example.invalid',caSha256:'b'.repeat(64),containerId:'cdb21',pdb:'other21',actions:NEGATIVE_PROBE_ACTIONS}],schemaFootprint:footprint,actions},
  entitlement:{oracle19:{attested:true,evidenceRef:'attestation://lab/oracle19'},oracle21:{attested:true,evidenceRef:'attestation://lab/oracle21'},labPermission:{attested:true,evidenceRef:'attestation://lab/disposable'}},
  fixtures:{sha256:'c'.repeat(64),schemas},
  credentials:{discovery:{ref:'vault://lab/discovery'},ownerA:{ref:'vault://lab/owner-a'},ownerB:{ref:'vault://lab/owner-b'},observer:{ref:'vault://lab/observer'},bootstrap:{ref:'vault://lab/bootstrap'}},
  grants:{discovery:['dictionary-read'],ownerA:['own-schema-ddl'],ownerB:['own-schema-ddl'],observer:['fixture-observe'],bootstrap:['allowlisted-fixture-ddl'],dbmsLock:{authorized:true,scope:'fixture mutex only'}},
  faults:{proxy:{authorized:true,owner:'lab-owner',actions:['fault-proxy']},sessionStop:{authorized:true,owner:'lab-owner',actions:['stop-fixture-session']}},
  postgresql:{metadataFixture:{image:'postgres fixture',version:'16.4',path:pg.path,sha256:pg.sha256,offline:true}},
  aliases:[{name:'alias-one',version:'19c',service:'alias-one',endpoint:'tcps://alias-one.example.invalid:2484/alias-one',serverIdentity:'alias-one.example.invalid',caSha256:'a'.repeat(64),expectedContainerId:'cdb19',expectedPdb:'pdb19'},{name:'alias-two',version:'19c',service:'alias-two',endpoint:'tcps://alias-two.example.invalid:2484/alias-two',serverIdentity:'alias-two.example.invalid',caSha256:'a'.repeat(64),expectedContainerId:'cdb19',expectedPdb:'pdb19'},{name:'alias-three',version:'21c',service:'alias-three',endpoint:'tcps://alias-three.example.invalid:2484/alias-three',serverIdentity:'alias-three.example.invalid',caSha256:'b'.repeat(64),expectedContainerId:'cdb21',expectedPdb:'pdb21'},{name:'alias-four',version:'21c',service:'alias-four',endpoint:'tcps://alias-four.example.invalid:2484/alias-four',serverIdentity:'alias-four.example.invalid',caSha256:'b'.repeat(64),expectedContainerId:'cdb21',expectedPdb:'pdb21'}],
  artifacts,harness:{sha256:'d'.repeat(64)},build:{sha256:'e'.repeat(64)},toolchain:{node:process.version,npm:'10.9.3'},
  teardown:{owner:'lab-owner',authorized:true,actions:['teardown-allowlisted-fixtures'],schemaKeys:['A','B']}
 };
 return {profile,dir,paths,cleanup:()=>rm(dir,{recursive:true,force:true})};
}
function relativeOffline(path){return path.slice(offlineRoot.length+1).split(requireSeparator()).join('/');}
function requireSeparator(){return process.platform==='win32'?'\\':'/';}

test('empty manifest reports exact missing prerequisites as BLOCKED',async()=>{
 const r=await preflight({});
 assert.equal(r.preflight.status,'BLOCKED');assert.equal(r.preflight.logic,'PASS');assert.equal(r.preflight.runtime,'BLOCKED');
 assert.match(r.integrity.measured.profileSha256,/^[a-f0-9]{64}$/);
 assert.ok(r.blockers.includes('missing oracle.19c.exactVersion'));assert.ok(r.blockers.includes('missing authorization.disposable'));
});

test('example manifest is rejected and receives no profile hash',async()=>{
 const example=JSON.parse(await readFile(new URL('../experiments/db-devops-wp0/lab-profile.example.json',import.meta.url)));
 const r=await preflight(example);assert.equal(r.preflight.status,'REJECTED');assert.equal(r.integrity.measured.profileSha256,null);
});

test('complete synthetic manifest validates local fixture bytes without runtime authority',async()=>{
 const f=await profileFixture();try{const r=await preflight(f.profile);assert.equal(r.preflight.status,'PREFLIGHT_VALID',JSON.stringify(r.blockers));assert.equal(r.preflight.logic,'PASS');assert.equal(r.preflight.runtime,'BLOCKED');assert.match(r.integrity.measured.profileSha256,/^[a-f0-9]{64}$/);assert.equal(r.integrity.declared.harnessSha256,'d'.repeat(64));assert.equal(r.integrity.measured.offlineArtifacts.length,kinds.length);assert.equal(r.integrity.measured.offlineArtifacts[0].contentSha256,r.integrity.declared.offlineArtifacts[0].sha256);}finally{await f.cleanup();}
});

test('malformed nested values, exact versions, duplicate refs, scope and authorization reject or block safely',async()=>{
 const f=await profileFixture();try{
  for(const bad of [null,'metadata',false,[]]){const p=structuredClone(f.profile);p.postgresql.metadataFixture=bad;assert.equal((await preflight(p)).preflight.status,'REJECTED');}
  const invalidVersion=structuredClone(f.profile);invalidVersion.oracle['19c'].exactVersion='19.x';assert.equal((await preflight(invalidVersion)).preflight.status,'REJECTED');
  const sameRef=structuredClone(f.profile);sameRef.credentials.ownerA.ref=sameRef.credentials.ownerB.ref;assert.equal((await preflight(sameRef)).preflight.status,'BLOCKED');
  const unauthorized=structuredClone(f.profile);unauthorized.authorization.disposable=false;unauthorized.faults.proxy.authorized=false;assert.equal((await preflight(unauthorized)).preflight.status,'BLOCKED');
  const badAction=structuredClone(f.profile);badAction.authorization.actions=['connect'];assert.equal((await preflight(badAction)).preflight.status,'BLOCKED');
  const owners=structuredClone(f.profile);owners.fixtures.schemas.B.owner=owners.fixtures.schemas.A.owner;assert.equal((await preflight(owners)).preflight.status,'BLOCKED');
  const fault=structuredClone(f.profile);fault.faults.sessionStop.actions=['observe-fixtures'];assert.equal((await preflight(fault)).preflight.status,'BLOCKED');
  const mismatch=structuredClone(f.profile);mismatch.authorization.schemaFootprint.pop();assert.equal((await preflight(mismatch)).preflight.status,'BLOCKED');
  const writerCanTargetC=structuredClone(f.profile);writerCanTargetC.authorization.targets.push({version:'19c',service:'negative19',containerId:'cdb19',pdb:'other19'});assert.equal((await preflight(writerCanTargetC)).preflight.status,'BLOCKED');
  const probeCanWrite=structuredClone(f.profile);probeCanWrite.authorization.negativeProbeTargets[0].actions=['connect','execute-owner-ddl'];assert.equal((await preflight(probeCanWrite)).preflight.status,'REJECTED');
  const prod=structuredClone(f.profile);prod.oracle['19c'].route.environment='PROD';assert.equal((await preflight(prod)).preflight.status,'REJECTED');
 }finally{await f.cleanup();}
});

test('unknown secret fields and TCPS userinfo are rejected without echoing canaries',async()=>{
 const f=await profileFixture();try{
  const p=structuredClone(f.profile);p.apiKey='CANARY-SECRET-992';p.oracle['19c'].route.endpoint='tcps://user:CANARY-SECRET-992@oracle.example.invalid/svc';
  const out=JSON.stringify(await preflight(p));assert.match(out,/REJECTED/);assert.doesNotMatch(out,/CANARY-SECRET-992|apiKey/);
 }finally{await f.cleanup();}
});

test('malformed declared hashes, versions and nested unknown fields never leak canaries',async()=>{
 const f=await profileFixture();try{
  const mutations=[p=>p.harness.sha256='CANARY-HARNESS',p=>p.build.sha256='CANARY-BUILD',p=>p.fixtures.sha256='CANARY-FIXTURE',p=>p.oracle['19c'].exactVersion={apiKey:'CANARY-VERSION'},p=>p.toolchain.node='CANARY-TOOLCHAIN',p=>p.credentials.discovery.apiKey='CANARY-NESTED'];
  for(const mutate of mutations){const p=structuredClone(f.profile);mutate(p);const result=await preflight(p);const out=JSON.stringify(result);assert.match(out,/REJECTED/);assert.equal(result.integrity.measured.profileSha256,null);assert.doesNotMatch(out,/CANARY|apiKey/);}
  const aliasService=structuredClone(f.profile);aliasService.aliases[0].service='other-service';assert.equal((await preflight(aliasService)).preflight.status,'REJECTED');
  const aliasTarget=structuredClone(f.profile);aliasTarget.aliases[0].expectedPdb='other19';assert.equal((await preflight(aliasTarget)).preflight.status,'BLOCKED');
  const routeService=structuredClone(f.profile);routeService.oracle['19c'].route.service='other-service';assert.equal((await preflight(routeService)).preflight.status,'REJECTED');
 }finally{await f.cleanup();}
});

test('artifact digest, symlink and protected-path checks stay within approved offline directory',async()=>{
 const f=await profileFixture();let externalDir;try{
  const tampered=structuredClone(f.profile);tampered.artifacts[0].sha256='0'.repeat(64);assert.equal((await preflight(tampered)).preflight.status,'REJECTED');
  await mkdir(evidenceRoot,{recursive:true});externalDir=await mkdtemp(join(evidenceRoot,'symlink-target-'));const external=join(externalDir,'target.bin');const bytes=Buffer.from('outside approved offline inputs');await writeFile(external,bytes);
  const link=join(f.dir,'escape.bin');await symlink(external,link);const escaped=structuredClone(f.profile);escaped.artifacts[0].path=relativeOffline(link);escaped.artifacts[0].sha256=sha(bytes);assert.equal((await preflight(escaped)).preflight.status,'REJECTED');
  const env=structuredClone(f.profile);env.artifacts[0].path='.env';assert.equal((await preflight(env)).preflight.status,'REJECTED');
 }finally{await f.cleanup();if(externalDir)await rm(externalDir,{recursive:true,force:true});}
});

test('CLI rejects missing/duplicate arguments, sanitizes errors, and appends two reports without overwrite',async()=>{
 const f=await profileFixture();await mkdir(evidenceRoot,{recursive:true});const runDir=await mkdtemp(join(evidenceRoot,'preflight-test-'));let occupied,externalDir,linkPath;
 try{
  const profilePath=join(f.dir,'profile.json');await writeFile(profilePath,JSON.stringify(f.profile));
  const cli=resolve('experiments/db-devops-wp0/preflight.mjs');
  const missing=spawnSync(process.execPath,[cli,'--profile'],{encoding:'utf8'});assert.equal(missing.status,2);assert.equal((missing.stdout+missing.stderr).includes(f.dir),false);
  const duplicate=spawnSync(process.execPath,[cli,'--profile',profilePath,'--profile',profilePath],{encoding:'utf8'});assert.equal(duplicate.status,2);
  const first=spawnSync(process.execPath,[cli,'--profile',profilePath,'--output',runDir],{encoding:'utf8'});assert.equal(first.status,0,first.stderr);
  const prior=await readdir(runDir);assert.equal(prior.length,1);const saved=await readFile(join(runDir,prior[0]));
  const second=spawnSync(process.execPath,[cli,'--profile',profilePath,'--output',runDir],{encoding:'utf8'});assert.equal(second.status,0,second.stderr);
  const after=await readdir(runDir);assert.equal(after.length,2);assert.deepEqual(await readFile(join(runDir,prior[0])),saved);
  const broken=join(f.dir,'broken-profile.json');await writeFile(broken,'{"apiKey":"CANARY-SECRET-992"');
  const malformed=spawnSync(process.execPath,[cli,'--profile',broken],{encoding:'utf8'});assert.equal(malformed.status,2);assert.doesNotMatch(malformed.stdout+malformed.stderr,/CANARY-SECRET-992|broken-profile/);
  const malformedReport=JSON.parse(malformed.stdout);assert.equal(malformedReport.integrity.measured.profileSha256,null);
  occupied=join(evidenceRoot,`preflight-output-is-file-${process.pid}`);await writeFile(occupied,'preserve this file');
  const refused=spawnSync(process.execPath,[cli,'--profile',profilePath,'--output',occupied],{encoding:'utf8'});assert.equal(refused.status,2);assert.equal(await readFile(occupied,'utf8'),'preserve this file');
  externalDir=await mkdtemp(join(evidenceRoot,'external-output-target-'));linkPath=join(runDir,'output-link');await symlink(externalDir,linkPath);
  const blockedOutput=spawnSync(process.execPath,[cli,'--profile',profilePath,'--output',join(linkPath,'should-not-exist')],{encoding:'utf8'});assert.equal(blockedOutput.status,2);assert.deepEqual(await readdir(externalDir),[]);
 }finally{await f.cleanup();await rm(runDir,{recursive:true,force:true});if(occupied)await rm(occupied,{force:true});if(linkPath)await rm(linkPath,{force:true});if(externalDir)await rm(externalDir,{recursive:true,force:true});}
});
