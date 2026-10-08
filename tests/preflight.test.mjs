import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { preflight } from '../experiments/db-devops-wp0/preflight.mjs';
import { kinds, profileFixture, relativeOffline, sha } from './helpers/preflight-fixture.mjs';

const repo=process.cwd();
const evidenceRoot=join(repo,'evidence/db-devops-wp0');

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
