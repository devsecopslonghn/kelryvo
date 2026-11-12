// Exercise the selected actual native server with real IPv6/IPv4 peers in the
// private namespace. The caller supplies one empty PostgreSQL fixture for all
// scenarios; this runner never creates product metadata or authority.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,writeFile,rm,readFile,chmod} from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import postgres from 'postgres';
assert.equal(process.env.KELRYVO_RUST_QUOTA_NETWORK,'PRIVATE');assert.notEqual(process.getuid(),0);
assert.deepEqual(Object.keys(os.networkInterfaces()),['lo']);
const root=process.cwd(),database=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
assert(database?.startsWith('postgresql:///kelryvo_rust_test?host='+path.join(root,'.cache/rust-tests.')));
const distribution=process.env.KELRYVO_RUST_DISTRIBUTION,binary=distribution?path.join(distribution,'bin/kelryvo-server'):path.join(root,'target/debug/kelryvo-server');
const web=process.env.KELRYVO_RUST_WEB_DIRECTORY??(distribution?path.join(distribution,'dist/rust-web'):path.join(root,'dist/rust-web'));
assert(path.isAbsolute(web));
const verify=()=>{if(distribution)execFileSync(path.join(distribution,'bin/kelryvo'),['verify-dist',distribution],{stdio:'pipe'});};
verify();
const scenarios=JSON.parse(await readFile('tests/fixtures/contracts/quota.json','utf8'));
const sql=postgres({host:new URL(database).searchParams.get('host'),database:'kelryvo_rust_test',max:1,onnotice:()=>{}});
const relations=async()=>(await sql`SELECT count(*)::int n FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public'`)[0].n;
const directory=await mkdtemp(path.join(root,'.cache/rust-quota-')),differences=[];
let server,exited,lifecycle,certificate;
const request=step=>new Promise((resolve,reject)=>{
 const ipv4=step.ip.includes('.'),host=ipv4?(step.ip.startsWith('::')?'::ffff:127.0.0.1':'127.0.0.1'):'::1';
 const req=https.request({host,ca:certificate,servername:'localhost',port:4317,method:step.method,path:step.path,localAddress:step.ip,timeout:3000,
  headers:{connection:'close',...step.headers,...(step.contentType?{'content-type':step.contentType,'content-length':Buffer.byteLength(step.body)}:{})}},response=>{
   let bytes=0;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>16384)req.destroy(new Error('Unbounded quota fixture response'));});
   response.on('end',()=>resolve({status:response.statusCode,headers:response.headers}));response.on('error',reject);
  });
 req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Quota fixture timeout')));req.end(step.body);
});
async function stop(){
 if(!server)return;
 if(server.exitCode===null)server.kill('SIGTERM');
 let timer;
 try{const [code]=await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Quota fixture API shutdown timeout')),10000);})]);assert.equal(code,0,lifecycle);}
 finally{clearTimeout(timer);if(server.exitCode===null){server.kill('SIGKILL');await exited;}server=null;}
}
function compare(actual,expected,label){
 const projection=Object.fromEntries(['x-ratelimit-limit','x-ratelimit-remaining'].filter(k=>actual.headers[k]!==undefined).map(k=>[k,actual.headers[k]]));
 const expectedProjection=Object.fromEntries(Object.entries(expected.quota).filter(([k])=>k==='x-ratelimit-limit'||k==='x-ratelimit-remaining'));
 if(JSON.stringify(projection)!==JSON.stringify(expectedProjection)||(actual.status===429)!==(expected.status===429))differences.push({label,expected:{status:expected.status,quota:expectedProjection},actual:{status:actual.status,quota:projection}});
 for(const key of ['x-ratelimit-reset','retry-after']){
  const value=actual.headers[key],wanted=expected.quota[key];
  if((value===undefined)!==(wanted===undefined)||value!==undefined&&(!/^\d+$/.test(value)||Number(value)<1||Number(value)>60))differences.push({label,header:key,expectedPresent:wanted!==undefined,actual:value??null});
 }
}
try{
 assert.equal(await relations(),0);
 const secrets=path.join(directory,'secrets');await mkdir(secrets,{mode:0o700});await writeFile(path.join(secrets,'database-url'),database,{mode:0o600});
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1','-keyout',path.join(secrets,'tls.key'),'-out',path.join(secrets,'tls.crt')],{stdio:'ignore'});
 await chmod(path.join(secrets,'tls.key'),0o600);await chmod(path.join(secrets,'tls.crt'),0o600);certificate=await readFile(path.join(secrets,'tls.crt'));
 for(const scenario of scenarios){
  server=spawn(binary,[],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',TZ:'UTC',KELRYVO_SECRET_DIR:secrets,KELRYVO_WEB_DIRECTORY:web,KELRYVO_BIND_HOST:'::',KELRYVO_PORT:'4317'},stdio:['ignore','ignore','pipe']});
  lifecycle='';server.stderr.on('data',chunk=>{lifecycle=(lifecycle+chunk).slice(-4096);});exited=once(server,'exit');let live=false;
  for(let n=0;n<100;n++){assert.equal(server.exitCode,null,lifecycle);try{if((await request({method:'GET',path:'/api/livez',ip:'::1'})).status===200){live=true;break;}}catch{}await delay(25);}assert(live);
  for(const [index,step] of scenario.steps.entries()){
   for(let n=0;n<step.repeat;n++){
    const response=await request(step);
    if(n===0)compare(response,step.first,scenario.name+':'+index+':first');
    if(n===step.repeat-1)compare(response,step.last,scenario.name+':'+index+':last');
   }
  }
  await stop();
 }
 assert.equal(await relations(),0,'Quota checks cannot provision metadata');
}finally{try{await stop();}finally{await sql.end({timeout:2});await rm(directory,{recursive:true,force:true});}}
verify();
const artifact=JSON.parse(execFileSync(binary,['--build-info'],{encoding:'utf8'}));
const result={status:differences.length?'FAIL':'PASS',artifact,webDirectory:web,scope:'ACTUAL_NATIVE_BINARY_PEERS_VS_RETAINED_QUOTAS',scenarios:scenarios.length,differences,emptyMetadataPreserved:true,applicationFixtureCleanup:true};
const output=process.env.KELRYVO_RUST_QUOTA_RESULT_FILE;if(output){assert(path.resolve(output).startsWith(path.join(root,'.cache/')));await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});}
console.log(JSON.stringify(result));assert.equal(differences.length,0,'Native quota behavior differs from the retained registered HTTP contract');
