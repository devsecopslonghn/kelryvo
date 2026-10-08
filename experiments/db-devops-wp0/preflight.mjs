#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const OFFLINE_ROOT=resolve(ROOT,'experiments/db-devops-wp0/offline-inputs');
const EVIDENCE_ROOT=resolve(ROOT,'evidence/db-devops-wp0');
const SOURCE=fileURLToPath(import.meta.url);
const HASH=/^[a-f0-9]{64}$/;
const VERSION={oracle19:/^19\.(?:[0-9]+\.){2,}[0-9]+$/,oracle21:/^21\.(?:[0-9]+\.){2,}[0-9]+$/};
const CREDENTIAL_ROLES=['discovery','ownerA','ownerB','observer','bootstrap'];
const FIXTURE_KEYS=['A','B','C'];
const ARTIFACT_KINDS=['node-runtime','npm-toolchain','oracle-driver','sql-parser','postgresql-image','fixture-bundle'];
const ACTIONS=['connect','discover-dictionary','execute-owner-ddl','observe-fixtures','bootstrap-allowlisted-fixtures','use-dbms-lock','fault-proxy','stop-fixture-session','teardown-allowlisted-fixtures'];
const NEGATIVE_PROBE_ACTIONS=['connect','observe-fixtures'];
const REQUIRED=[
 'schemaVersion','oracle.19c.exactVersion','oracle.19c.route.service','oracle.19c.route.containerId','oracle.19c.route.pdb','oracle.19c.route.environment','oracle.19c.route.endpoint','oracle.19c.tcps.caSha256','oracle.19c.tcps.serverIdentity',
 'oracle.21c.exactVersion','oracle.21c.route.service','oracle.21c.route.containerId','oracle.21c.route.pdb','oracle.21c.route.environment','oracle.21c.route.endpoint','oracle.21c.tcps.caSha256','oracle.21c.tcps.serverIdentity',
 'authorization.disposable','authorization.labOwner','authorization.targets','authorization.negativeProbeTargets','authorization.schemaFootprint','authorization.actions',
 'entitlement.oracle19.attested','entitlement.oracle19.evidenceRef','entitlement.oracle21.attested','entitlement.oracle21.evidenceRef','entitlement.labPermission.attested','entitlement.labPermission.evidenceRef',
 ...['A','B'].flatMap(k=>['owner','prefix','project'].map(f=>`fixtures.schemas.${k}.${f}`)),
 ...['A','B','C'].flatMap(k=>['19c','21c'].flatMap(v=>['service','containerId','pdb','environment'].map(f=>`fixtures.schemas.${k}.targets.${v}.${f}`))),
 ...['C'].flatMap(k=>['owner','prefix','project'].map(f=>`fixtures.schemas.${k}.${f}`)),
 ...CREDENTIAL_ROLES.map(role=>`credentials.${role}.ref`),
 'grants.discovery','grants.ownerA','grants.ownerB','grants.observer','grants.bootstrap','grants.dbmsLock.authorized','grants.dbmsLock.scope',
 'faults.proxy.authorized','faults.proxy.owner','faults.proxy.actions','faults.sessionStop.authorized','faults.sessionStop.owner','faults.sessionStop.actions',
 'postgresql.metadataFixture.image','postgresql.metadataFixture.version','postgresql.metadataFixture.path','postgresql.metadataFixture.sha256','postgresql.metadataFixture.offline',
 'aliases','artifacts','harness.sha256','build.sha256','fixtures.sha256','toolchain.node','toolchain.npm','teardown.owner','teardown.authorized','teardown.actions','teardown.schemaKeys'
];
const pathValue=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
const has=(object,path)=>pathValue(object,path)!==undefined;
const nonempty=value=>typeof value==='string'&&value.trim().length>0&&!/[\r\n\0]/.test(value);
const sha=value=>typeof value==='string'&&HASH.test(value);

function inspectObject(value, allowedKeys, path, errors, {required=true}={}) {
 if (value===undefined) { if (required) errors.push(`malformed ${path}`); return false; }
 if (!value || typeof value!=='object' || Array.isArray(value)) { errors.push(`malformed ${path}`); return false; }
 for (const key of Object.keys(value)) if (!allowedKeys.includes(key)) errors.push(`unknown field in ${path}`);
 return true;
}

function validateShape(p) {
 const errors=[];
 if (!p || typeof p!=='object' || Array.isArray(p)) return ['profile must be an object'];
 if (p.schemaVersion!==undefined&&p.schemaVersion!=='1.0.0') errors.push('unsupported schemaVersion');
 if (p.example===true) errors.push('example profile cannot be used as runtime authority');
 const top=['schemaVersion','oracle','authorization','entitlement','fixtures','credentials','grants','faults','postgresql','aliases','artifacts','harness','build','toolchain','teardown'];
 inspectObject(p,top,'profile',errors);
 const check=(obj,path,keys)=>obj===undefined?false:inspectObject(obj,keys,path,errors);
 check(p.oracle,'oracle',['19c','21c']);
 for (const v of ['19c','21c']) {
  const section=p.oracle?.[v];
  if (check(section,`oracle.${v}`,['exactVersion','route','tcps'])) {
   const route=section.route;
   if (check(route,`oracle.${v}.route`,['service','containerId','pdb','environment','endpoint'])) {
    for (const key of ['service','containerId','pdb','endpoint']) if (route[key]!==undefined&&!nonempty(route[key])) errors.push(`malformed oracle.${v}.route.${key}`);
    validateEndpoint(route.endpoint,`oracle.${v}.route.endpoint`,errors);
    validateServiceEndpoint(route.endpoint,route.service,section.tcps?.serverIdentity,`oracle.${v}.route`,errors);
    if (route.environment!==undefined&&route.environment!=='DEV') errors.push(`oracle.${v} route must be a disposable DEV target`);
   }
   const tcps=section.tcps;
   if (check(tcps,`oracle.${v}.tcps`,['caSha256','serverIdentity'])) {
    if (tcps.caSha256!==undefined&&!sha(tcps.caSha256)) errors.push(`malformed oracle.${v}.tcps.caSha256`);
    if (tcps.serverIdentity!==undefined&&!nonempty(tcps.serverIdentity)) errors.push(`malformed oracle.${v}.tcps.serverIdentity`);
   }
   if (section.exactVersion!==undefined&&!VERSION[v==='19c'?'oracle19':'oracle21'].test(section.exactVersion)) errors.push(`malformed oracle.${v}.exactVersion`);
  }
 }
 check(p.authorization,'authorization',['disposable','labOwner','targets','negativeProbeTargets','schemaFootprint','actions']);
 if (p.authorization?.disposable!==undefined&&typeof p.authorization.disposable!=='boolean') errors.push('malformed authorization.disposable');
 if (p.authorization?.labOwner!==undefined&&!nonempty(p.authorization.labOwner)) errors.push('malformed authorization.labOwner');
 if (p.authorization?.targets!==undefined&&(!Array.isArray(p.authorization.targets)||p.authorization.targets.some(t=>!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>!['version','service','containerId','pdb'].includes(k))||['version','service','containerId','pdb'].some(k=>!nonempty(t[k]))||!['19c','21c'].includes(t.version)))) errors.push('malformed authorization.targets');
 if (p.authorization?.negativeProbeTargets!==undefined&&(!Array.isArray(p.authorization.negativeProbeTargets)||p.authorization.negativeProbeTargets.some(t=>!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>!['version','service','endpoint','serverIdentity','caSha256','containerId','pdb','actions'].includes(k))||['version','service','endpoint','serverIdentity','containerId','pdb'].some(k=>!nonempty(t[k]))||!['19c','21c'].includes(t.version)||!sha(t.caSha256)||!Array.isArray(t.actions)||t.actions.length!==NEGATIVE_PROBE_ACTIONS.length||NEGATIVE_PROBE_ACTIONS.some(a=>!t.actions.includes(a))||t.actions.some(a=>!NEGATIVE_PROBE_ACTIONS.includes(a))))) errors.push('malformed read-only negative probe targets');
 for(const probe of Array.isArray(p.authorization?.negativeProbeTargets)?p.authorization.negativeProbeTargets:[]){validateEndpoint(probe.endpoint,'negative probe endpoint',errors);validateServiceEndpoint(probe.endpoint,probe.service,probe.serverIdentity,'negative probe endpoint',errors);}
 if (p.authorization?.schemaFootprint!==undefined&&(!Array.isArray(p.authorization.schemaFootprint)||p.authorization.schemaFootprint.some(s=>!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['version','owner','prefix','project','service','containerId','pdb','environment'].includes(k))||['version','owner','prefix','project','service','containerId','pdb','environment'].some(k=>!nonempty(s[k]))||!['19c','21c'].includes(s.version)))) errors.push('malformed authorization.schemaFootprint');
 if (p.authorization?.actions!==undefined&&!Array.isArray(p.authorization.actions)) errors.push('malformed authorization.actions');
 check(p.entitlement,'entitlement',['oracle19','oracle21','labPermission']);
 for (const key of ['oracle19','oracle21','labPermission']) {
  const e=p.entitlement?.[key];
  if (check(e,`entitlement.${key}`,['attested','evidenceRef'])) {
   if (e.attested!==undefined&&typeof e.attested!=='boolean') errors.push(`malformed entitlement.${key}.attested`);
   if (e.evidenceRef!==undefined&&!/^attestation:\/\/[a-zA-Z0-9._/-]+$/.test(e.evidenceRef)) errors.push(`malformed entitlement.${key}.evidenceRef`);
  }
 }
 check(p.fixtures,'fixtures',['schemas','sha256']);
 if (p.fixtures?.sha256!==undefined&&!sha(p.fixtures.sha256)) errors.push('malformed fixtures.sha256');
 check(p.fixtures?.schemas,'fixtures.schemas',FIXTURE_KEYS);
 for (const key of FIXTURE_KEYS) {
  const f=p.fixtures?.schemas?.[key];
  const keys=['owner','prefix','project','targets'];
  if (check(f,`fixtures.schemas.${key}`,keys)) {
   for (const k of ['owner','prefix','project']) if (f[k]!==undefined&&!nonempty(f[k])) errors.push(`malformed fixtures.schemas.${key}.${k}`);
   check(f.targets,`fixtures.schemas.${key}.targets`,['19c','21c']);
   for (const version of ['19c','21c']) {
    const target=f.targets?.[version];
  if (check(target,`fixtures.schemas.${key}.targets.${version}`,['service','containerId','pdb','environment'])) for (const field of ['service','containerId','pdb','environment']) if (target[field]!==undefined&&!nonempty(target[field])) errors.push(`malformed fixtures.schemas.${key}.targets.${version}.${field}`);
   }
  }
 }
 check(p.credentials,'credentials',CREDENTIAL_ROLES);
 for (const role of CREDENTIAL_ROLES) {
  const c=p.credentials?.[role];
  if (check(c,`credentials.${role}`,['ref'])&&c.ref!==undefined&&!/^(vault|secret|env|file):\/\/[a-zA-Z0-9._/-]+$/.test(c.ref)) errors.push(`malformed opaque reference: credentials.${role}.ref`);
 }
 check(p.grants,'grants',['discovery','ownerA','ownerB','observer','bootstrap','dbmsLock']);
 for (const role of ['discovery','ownerA','ownerB','observer','bootstrap']) {
  const list=p.grants?.[role];
  if (list!==undefined&&(!Array.isArray(list)||!list.length||list.some(x=>!nonempty(x)))) errors.push(`malformed or empty grants.${role}`);
  if (Array.isArray(list)&&list.some(g=>/(?:password|secret|token|apikey|user:.*@|\bany\b|\ball\b|sysdba|dba|grant option)/i.test(g))) errors.push(`unsafe grant record rejected: ${role}`);
 }
 check(p.grants?.dbmsLock,'grants.dbmsLock',['authorized','scope']);
 if (p.grants?.dbmsLock?.authorized!==undefined&&typeof p.grants.dbmsLock.authorized!=='boolean') errors.push('malformed grants.dbmsLock.authorized');
 if (p.grants?.dbmsLock?.scope!==undefined&&!nonempty(p.grants.dbmsLock.scope)) errors.push('malformed grants.dbmsLock.scope');
 check(p.faults,'faults',['proxy','sessionStop']);
 for (const key of ['proxy','sessionStop']) {
  const f=p.faults?.[key];
  if (check(f,`faults.${key}`,['authorized','owner','actions'])) {
   if (f.authorized!==undefined&&typeof f.authorized!=='boolean') errors.push(`malformed faults.${key}.authorized`);
   if (f.owner!==undefined&&!nonempty(f.owner)) errors.push(`malformed faults.${key}.owner`);
   if (f.actions!==undefined&&(!Array.isArray(f.actions)||!f.actions.length||f.actions.some(a=>!ACTIONS.includes(a)))) errors.push(`malformed faults.${key}.actions`);
  }
 }
 check(p.postgresql,'postgresql',['metadataFixture']);
 const pg=p.postgresql?.metadataFixture;
 if (check(pg,'postgresql.metadataFixture',['image','version','path','sha256','offline'])) {
  for (const key of ['image','version','path']) if (pg[key]!==undefined&&!nonempty(pg[key])) errors.push(`malformed postgresql.metadataFixture.${key}`);
  if (pg.sha256!==undefined&&!sha(pg.sha256)) errors.push('malformed postgresql.metadataFixture.sha256');
  if (pg.offline!==undefined&&typeof pg.offline!=='boolean') errors.push('malformed postgresql.metadataFixture.offline');
 }
 if (p.aliases!==undefined&&(!Array.isArray(p.aliases)||p.aliases.length<4||p.aliases.some(a=>!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['name','version','service','endpoint','serverIdentity','caSha256','expectedContainerId','expectedPdb'].includes(k))||['name','version','service','endpoint','serverIdentity','expectedContainerId','expectedPdb'].some(k=>!nonempty(a[k]))||!['19c','21c'].includes(a.version)||!sha(a.caSha256)))) errors.push('malformed aliases');
 for(const alias of Array.isArray(p.aliases)?p.aliases:[]) { validateEndpoint(alias?.endpoint,'aliases endpoint',errors); validateServiceEndpoint(alias?.endpoint,alias?.service,alias?.serverIdentity,'alias endpoint',errors); }
 if (p.artifacts!==undefined&&(!Array.isArray(p.artifacts)||p.artifacts.some(a=>!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['kind','path','sha256','version','sourceRef','noticePath','noticeSha256','maintenanceRef'].includes(k))||!ARTIFACT_KINDS.includes(a.kind)||!nonempty(a.path)||!sha(a.sha256)||!nonempty(a.noticePath)||!sha(a.noticeSha256)||!/^v?[0-9]+\.[0-9]+\.[0-9]+$/.test(a.version||'')||!/^source:\/\/[A-Za-z0-9._/-]+$/.test(a.sourceRef||'')||!/^attestation:\/\/[A-Za-z0-9._/-]+$/.test(a.maintenanceRef||'')))) errors.push('malformed offline artifact records');
 for (const [key,obj,keys] of [['harness',p.harness,['sha256']],['build',p.build,['sha256']],['toolchain',p.toolchain,['node','npm']],['teardown',p.teardown,['owner','authorized','actions','schemaKeys']]]) check(obj,key,keys);
 for (const key of ['harness','build']) if (p[key]?.sha256!==undefined&&!sha(p[key].sha256)) errors.push(`malformed ${key}.sha256`);
 for (const key of ['node','npm']) if (p.toolchain?.[key]!==undefined&&!/^(?:v)?[0-9]+\.[0-9]+\.[0-9]+$/.test(p.toolchain[key])) errors.push(`malformed toolchain.${key}`);
 if (p.teardown?.owner!==undefined&&!nonempty(p.teardown.owner)) errors.push('malformed teardown.owner');
 if (p.teardown?.authorized!==undefined&&typeof p.teardown.authorized!=='boolean') errors.push('malformed teardown.authorized');
 if (p.teardown?.actions!==undefined&&(!Array.isArray(p.teardown.actions)||!p.teardown.actions.length||p.teardown.actions.some(a=>a!=='teardown-allowlisted-fixtures'))) errors.push('malformed teardown.actions');
 if (p.teardown?.schemaKeys!==undefined&&(!Array.isArray(p.teardown.schemaKeys)||p.teardown.schemaKeys.length!==2||p.teardown.schemaKeys.some(k=>!['A','B'].includes(k))||!['A','B'].every(k=>p.teardown.schemaKeys.includes(k)))) errors.push('malformed teardown.schemaKeys');
 return [...new Set(errors)];
}

function semanticErrors(p) {
 const errors=[];
 const d=p.authorization;
 if (p.toolchain.node!==process.version) errors.push('declared Node version differs from measured runtime version');
 if (d.disposable!==true) errors.push('disposable lab authorization is absent');
 for (const k of ['oracle19','oracle21','labPermission']) if (p.entitlement[k].attested!==true) errors.push(`required entitlement attestation absent: ${k}`);
 const targetKey=t=>`${t.version}|${t.service}|${t.containerId}|${t.pdb}`;
 if (!d.targets.length||d.targets.some(t=>!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).some(k=>!['version','service','containerId','pdb'].includes(k)))) errors.push('authorized targets are malformed');
 else for (const version of ['19c','21c']) {
  const route=p.oracle[version].route;
  if (!d.targets.some(t=>targetKey(t)===targetKey({version,service:route.service,containerId:route.containerId,pdb:route.pdb}))) errors.push(`authorized target missing for ${version}`);
 }
 if (d.actions.length!==ACTIONS.length||ACTIONS.some(a=>!d.actions.includes(a))||d.actions.some(a=>!ACTIONS.includes(a))) errors.push('authorization action allowlist is incomplete or contains unknown actions');
 const schemas=p.fixtures.schemas;
 if (new Set(FIXTURE_KEYS.map(k=>schemas[k].owner)).size!==3) errors.push('fixture schema owners must be distinct');
 if (p.teardown.owner!==d.labOwner) errors.push('teardown authority owner differs from lab owner');
 if (schemas.A.project===schemas.B.project) errors.push('A and B project labels must differ');
 for (const version of ['19c','21c']) {
  const sameVersionAliases=p.aliases.filter(a=>a.version===version),route=p.oracle[version].route;
  if (sameVersionAliases.length<2) errors.push(`two aliases are required for ${version}`);
  if(new Set(sameVersionAliases.map(a=>a.name)).size!==sameVersionAliases.length||new Set(sameVersionAliases.map(a=>a.endpoint)).size!==sameVersionAliases.length) errors.push(`alias records must identify separate routes for ${version}`);
  for(const alias of sameVersionAliases) if(alias.expectedContainerId!==route.containerId||alias.expectedPdb!==route.pdb||alias.caSha256!==p.oracle[version].tcps.caSha256||alias.serverIdentity!==new URL(alias.endpoint).hostname) errors.push(`alias target or TCPS identity differs for ${version}`);
 }
 for (const version of ['19c','21c']) {
  const route=p.oracle[version].route;
  if (new URL(route.endpoint).hostname.toLowerCase()!==p.oracle[version].tcps.serverIdentity.toLowerCase()) errors.push(`TCPS identity does not match ${version} route endpoint`);
  for (const k of ['A','B']) {
   const target=schemas[k].targets[version];
   if (target.containerId!==route.containerId||target.pdb!==route.pdb||target.service!==route.service||target.environment!=='DEV') errors.push(`fixture ${k} must share the authorized ${version} DEV container`);
  }
  const negative=schemas.C.targets[version];
  if (negative.environment!=='DEV'||negative.pdb===route.pdb||negative.containerId!==route.containerId||negative.service===route.service) errors.push(`fixture C must name a distinct ${version} cross-PDB scope`);
 }
 const expectedTargets=[];
 for (const version of ['19c','21c']) {const target=schemas.A.targets[version];expectedTargets.push(`${version}|${target.service}|${target.containerId}|${target.pdb}`);}
 const actualTargets=d.targets.map(t=>`${t.version}|${t.service}|${t.containerId}|${t.pdb}`);
 if(expectedTargets.length!==actualTargets.length||expectedTargets.some(t=>!actualTargets.includes(t)))errors.push('write target allowlist must contain only the A/B main routes');
 const expectedNegative=[];
 for(const version of ['19c','21c']){const t=schemas.C.targets[version];expectedNegative.push(`${version}|${t.service}|${t.containerId}|${t.pdb}`);}
 const actualNegative=d.negativeProbeTargets.map(t=>`${t.version}|${t.service}|${t.containerId}|${t.pdb}`);
 if(expectedNegative.length!==actualNegative.length||expectedNegative.some(t=>!actualNegative.includes(t)))errors.push('read-only negative-probe target scope differs from schema C');
 for(const probe of d.negativeProbeTargets){const version=probe.version;const tcps=p.oracle[version].tcps;if(probe.caSha256!==tcps.caSha256||probe.serverIdentity!==new URL(probe.endpoint).hostname)errors.push(`negative probe TCPS identity differs for ${version}`);}
 const expectedFootprint=[];
 for (const version of ['19c','21c']) for (const key of FIXTURE_KEYS) {
  const fixture=schemas[key],target=fixture.targets[version];
  expectedFootprint.push(`${version}|${fixture.owner}|${fixture.prefix}|${fixture.project}|${target.service}|${target.containerId}|${target.pdb}|${target.environment}`);
 }
 const suppliedFootprint=d.schemaFootprint.map(f=>`${f.version}|${f.owner}|${f.prefix}|${f.project}|${f.service}|${f.containerId}|${f.pdb}|${f.environment}`);
 if (expectedFootprint.length!==suppliedFootprint.length||expectedFootprint.some(item=>!suppliedFootprint.includes(item))) errors.push('authorized schema fixture footprint differs from A/B/C manifest');
 const refs=CREDENTIAL_ROLES.map(r=>p.credentials[r].ref);
 if (new Set(refs).size!==refs.length) errors.push('credential references must be distinct by role');
 for (const k of ['discovery','ownerA','ownerB','observer','bootstrap']) {
  if (!p.grants[k].length) errors.push(`grant profile missing: ${k}`);
 }
 if (p.grants.dbmsLock.authorized!==true) errors.push('narrow DBMS_LOCK authority is absent');
 if (p.faults.proxy.authorized!==true||!p.faults.proxy.owner||!p.faults.proxy.actions.includes('fault-proxy')) errors.push('authorized proxy capability record is incomplete');
 if (p.faults.sessionStop.authorized!==true||!p.faults.sessionStop.owner||!p.faults.sessionStop.actions.includes('stop-fixture-session')) errors.push('authorized session-stop capability record is incomplete');
 if (p.postgresql.metadataFixture.offline!==true) errors.push('PostgreSQL metadata fixture must be explicitly offline');
 if (!p.teardown.authorized||!p.teardown.owner||!p.teardown.actions.includes('teardown-allowlisted-fixtures')||p.teardown.schemaKeys.includes('C')) errors.push('teardown authority must be restricted to allowlisted A/B fixtures');
 const kinds=new Set(p.artifacts.map(a=>a.kind));
 for (const kind of ARTIFACT_KINDS) if (!kinds.has(kind)) errors.push(`offline artifact category missing: ${kind}`);
 return [...new Set(errors)];
}

function validateEndpoint(value,label,errors) {
 if (value===undefined) return;
 try { const u=new URL(value); if (u.protocol!=='tcps:'||u.username||u.password||u.search||u.hash) errors.push(`malformed ${label}`); }
 catch { errors.push(`malformed ${label}`); }
}
function validateServiceEndpoint(endpoint,service,identity,label,errors) {
 if(!nonempty(endpoint)||!nonempty(service)||!nonempty(identity))return;
 try { const u=new URL(endpoint); if(u.pathname!==`/${service}`||u.hostname.toLowerCase()!==identity.toLowerCase())errors.push(`malformed ${label} service or server identity`); }
 catch { errors.push(`malformed ${label} service or server identity`); }
}

async function confinedBytes(relativePath, expectedDigest, label, index, errors) {
 if (typeof relativePath!=='string'||!relativePath||isAbsolute(relativePath)||relativePath.split(/[\\/]/).includes('..')||relativePath.split(/[\\/]/).some(part=>part==='.git'||/^\.env(?:\.|$)/i.test(part)||/\.(?:pem|key|p12|pfx)$/i.test(part))) { errors.push(`artifact ${index} path rejected`); return null; }
 const full=resolve(OFFLINE_ROOT,relativePath);
 const rel=relative(OFFLINE_ROOT,full);
 if (!rel||rel==='.'||rel.startsWith(`..${sep}`)||isAbsolute(rel)) { errors.push(`artifact ${index} path rejected`); return null; }
 try {
  const offlineRootStat=await lstat(OFFLINE_ROOT);
  if (!offlineRootStat.isDirectory()||offlineRootStat.isSymbolicLink()) { errors.push('offline input root rejected'); return null; }
  let cursor=OFFLINE_ROOT;
  for (const part of rel.split(sep)) {
   cursor=resolve(cursor,part);
   const st=await lstat(cursor);
   if (st.isSymbolicLink()) { errors.push(`artifact ${index} symlink rejected`); return null; }
  }
  const st=await lstat(full);
  if (!st.isFile()) { errors.push(`artifact ${index} is not a regular file`); return null; }
  const real=await realpath(full);
  if (!real.startsWith(`${OFFLINE_ROOT}${sep}`)) { errors.push(`artifact ${index} path escapes offline input directory`); return null; }
  const bytes=await readFile(full);
  const actual=createHash('sha256').update(bytes).digest('hex');
  if (actual!==expectedDigest) errors.push(`artifact ${index} ${label} digest mismatch`);
  return actual;
 } catch { errors.push(`artifact ${index} ${label} unavailable`); return null; }
}

async function validateArtifacts(p) {
 const errors=[];
 const measured=[];
 for (const [i,a] of p.artifacts.entries()) {
  measured.push({kind:a.kind,contentSha256:await confinedBytes(a.path,a.sha256,'content',i+1,errors),noticeSha256:await confinedBytes(a.noticePath,a.noticeSha256,'NOTICE',i+1,errors)});
 }
 const postgresImageSha256=await confinedBytes(p.postgresql.metadataFixture.path,p.postgresql.metadataFixture.sha256,'PostgreSQL image',0,errors);
 return {errors,measured:{offlineArtifacts:measured,postgresImageSha256}};
}

async function assertNoSymlinkComponents(target) {
 const rootStat=await lstat(ROOT);
 if (!rootStat.isDirectory()||rootStat.isSymbolicLink()) throw new Error('invalid workspace root');
 const rel=relative(ROOT,target);
 if (!rel||rel==='.'||rel.startsWith(`..${sep}`)||isAbsolute(rel)) throw new Error('path outside workspace');
 let cursor=ROOT;
 for(const part of rel.split(sep)) {
  cursor=resolve(cursor,part);
  let stat;
  try { stat=await lstat(cursor); } catch(error) { if(error?.code==='ENOENT') return; throw error; }
  if(stat.isSymbolicLink()||!stat.isDirectory()) throw new Error('symlink or non-directory path');
 }
}

const digest=value=>createHash('sha256').update(value).digest('hex');
async function measuredIntegrity(rawProfile,profile,allowProfileHash) {
 let profileSha256=null,profileDigestSource=null;
 try {
  if(allowProfileHash&&rawProfile!==undefined&&rawProfile!==null){profileSha256=digest(rawProfile);profileDigestSource='raw-input-bytes';}
  else if(allowProfileHash&&profile!==undefined){profileSha256=digest(JSON.stringify(profile));profileDigestSource='canonical-json-object';}
 } catch { profileSha256=null;profileDigestSource=null; }
 return {
  measured:{profileSha256,profileDigestSource,preflightSourceSha256:digest(await readFile(SOURCE)),nodeVersion:process.version}
 };
}
function safeDeclarations(p) {
 return {declared:{harnessSha256:p.harness.sha256,buildSha256:p.build.sha256,fixtureSha256:p.fixtures.sha256,oracleVersions:{oracle19:p.oracle['19c'].exactVersion,oracle21:p.oracle['21c'].exactVersion},offlineArtifacts:p.artifacts.map(a=>({kind:a.kind,version:a.version,sha256:a.sha256,noticeSha256:a.noticeSha256})),postgresImageSha256:p.postgresql.metadataFixture.sha256,toolchain:{node:p.toolchain.node,npm:p.toolchain.npm}}};
}
function report(status,blockers,checks=[],integrity={}) {
 return {schemaVersion:'1.0.0',taskId:'WP0-T01',generatedAt:new Date().toISOString(),preflight:{status,logic:status==='REJECTED'?'FAIL':'PASS',runtime:'BLOCKED',runtimeClaims:false},integrity,blockers:[...new Set(blockers)],checks,notice:'Offline input validation only. No Oracle, network, or credential resolution was performed. A valid profile is not a dependency/license audit or runtime acceptance.'};
}

export async function preflight(profile,rawProfile) {
 const malformed=validateShape(profile);
 const integrity=await measuredIntegrity(rawProfile,profile,malformed.length===0);
 if (malformed.length) return report('REJECTED',malformed,[],integrity);
 const missing=REQUIRED.filter(path=>!has(profile,path)).map(path=>`missing ${path}`);
 if (missing.length) return report('BLOCKED',missing,[],integrity);
 Object.assign(integrity,safeDeclarations(profile));
 const semantic=semanticErrors(profile);
 if (semantic.length) return report('BLOCKED',semantic,[],integrity);
 const artifactResult=await validateArtifacts(profile);
 if (artifactResult.errors.length) return report('REJECTED',artifactResult.errors,[],{...integrity,measured:{...integrity.measured,...artifactResult.measured}});
 integrity.measured={...integrity.measured,...artifactResult.measured};
 return report('PREFLIGHT_VALID',[],REQUIRED.map(name=>({name,status:'PRESENT'})),integrity);
}

async function main(argv) {
 let profilePath,outputDir;
 for (let i=0;i<argv.length;i++) {
  const option=argv[i];
  if (option==='--profile'||option==='--output') {
   const value=argv[++i];
   if (!value||value.startsWith('--')) throw new Error('invalid option value');
   if (option==='--profile') { if (profilePath) throw new Error('duplicate option'); profilePath=value; }
   else { if (outputDir) throw new Error('duplicate option'); outputDir=value; }
  } else throw new Error('unknown option');
 }
 let profile={},raw;
 if (profilePath) {
  try { raw=await readFile(resolve(profilePath)); profile=JSON.parse(raw.toString('utf8')); }
  catch { const integrity=await measuredIntegrity(raw,undefined,false); const r=report('REJECTED',['profile file is unreadable or invalid JSON'],[],integrity); process.stdout.write(`${JSON.stringify(r,null,2)}\n`); process.exitCode=2; return; }
 }
 const result=await preflight(profile,raw);
 process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
 if (outputDir) {
  try {
   const dir=resolve(outputDir); const rel=relative(EVIDENCE_ROOT,dir);
   if (!rel||rel==='.'||rel.startsWith(`..${sep}`)||isAbsolute(rel)) throw new Error('invalid output directory');
   await assertNoSymlinkComponents(EVIDENCE_ROOT);
   await assertNoSymlinkComponents(dir);
   await mkdir(EVIDENCE_ROOT,{recursive:true});
   await mkdir(dir,{recursive:true});
   await assertNoSymlinkComponents(dir);
   const rootStat=await lstat(EVIDENCE_ROOT);
   if (!rootStat.isDirectory()||rootStat.isSymbolicLink()) throw new Error('invalid evidence root');
   let cursor=EVIDENCE_ROOT;
   for(const part of rel.split(sep)){cursor=resolve(cursor,part);const st=await lstat(cursor);if(st.isSymbolicLink()||!st.isDirectory())throw new Error('invalid report directory');}
   const [realRoot,realDir]=await Promise.all([realpath(EVIDENCE_ROOT),realpath(dir)]);
   if(!realDir.startsWith(`${realRoot}${sep}`))throw new Error('invalid report location');
   const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
   const fh=await open(resolve(dir,`${stamp}-${randomUUID()}.json`),'wx',0o600);
   try { await fh.writeFile(`${JSON.stringify(result,null,2)}\n`); } finally { await fh.close(); }
  } catch { process.stderr.write('Could not append report; output path unavailable or report already exists.\n'); process.exitCode=2; return; }
 }
 process.exitCode=result.preflight.status==='PREFLIGHT_VALID'?0:result.preflight.status==='BLOCKED'?1:2;
}
if (process.argv[1]&&resolve(process.argv[1])===SOURCE) main(process.argv.slice(2)).catch(()=>{process.stderr.write('Preflight rejected input or command.\n');process.exitCode=2;});
