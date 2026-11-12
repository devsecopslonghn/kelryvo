// Actual HTTP/HTTPS transport and public-auth refusal order. One caller-owned
// empty PostgreSQL fixture; no actor, credential, session or schema is created.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import postgres from 'postgres';
import {setTimeout as delay} from 'node:timers/promises';

const root=path.resolve('.'),url=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
assert(url?.startsWith('postgresql:///kelryvo_rust_test?host='));
const socket=new URL(url).searchParams.get('host');
assert(socket.startsWith(path.join(root,'.cache/rust-tests.'))&&socket.endsWith('/socket'));
const distribution=process.env.KELRYVO_RUST_DISTRIBUTION;
if(distribution)assert(path.isAbsolute(distribution));
const binary=process.env.KELRYVO_RUST_HTTP_SERVER_BINARY??(distribution?path.join(distribution,'bin/kelryvo-server'):path.join(root,'target/debug/kelryvo-server'));
if(process.env.KELRYVO_RUST_HTTP_SERVER_BINARY)assert.equal(binary,path.join(root,'target/debug/kelryvo-server'));
const web=distribution?path.join(distribution,'dist/rust-web'):process.env.KELRYVO_RUST_WEB_DIRECTORY??path.join(root,'dist/rust-web');
const verify=()=>{if(distribution)execFileSync(path.join(distribution,'bin/kelryvo'),['verify-dist',distribution],{stdio:'pipe'});};
verify();
const cases=JSON.parse(await readFile('tests/fixtures/contracts/login-shape.json','utf8'));
assert.equal(cases.length,46);
const sql=postgres({host:socket,database:'kelryvo_rust_test',max:1,onnotice:()=>{}});
const relations=async()=>(await sql`SELECT count(*)::int total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`)[0].total;
const directory=await mkdtemp(path.join(root,'.cache/rust-public-auth-'));
let server,exit;
const completed=[];
try{
  assert.equal(await relations(),0,'Use only an empty disposable fixture');
  for(const tls of [false,true]){
    const secrets=path.join(directory,tls?'tls':'plain');await mkdir(secrets,{mode:0o700});
    await writeFile(path.join(secrets,'database-url'),url,{mode:0o600});
    let ca;
    if(tls){
      execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
        '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',path.join(secrets,'tls.key'),'-out',path.join(secrets,'tls.crt')],{stdio:'ignore'});
      for(const name of ['tls.key','tls.crt'])await chmod(path.join(secrets,name),0o600);
      ca=await readFile(path.join(secrets,'tls.crt'));
    }
    const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
    const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
    const origin=`https://127.0.0.1:${port}`;
    server=spawn(binary,[],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',TZ:'UTC',KELRYVO_SECRET_DIR:secrets,
      KELRYVO_BIND_HOST:'127.0.0.1',KELRYVO_PORT:String(port),KELRYVO_WEB_DIRECTORY:web},stdio:['ignore','ignore','pipe']});
    let lifecycle='';server.stderr.on('data',chunk=>{lifecycle=(lifecycle+chunk).slice(-4096);});
    exit=once(server,'exit');
    function request(route,body,contentType,headers={},localAddress='127.0.0.1'){
      return new Promise((resolve,reject)=>{
        const bytes=body===undefined?undefined:Buffer.from(body);
        const req=(tls?https:http).request({host:'127.0.0.1',port,path:route,method:route==='/api/livez'?'GET':'POST',
          localAddress,ca,timeout:5000,headers:{connection:'close',origin,...headers,
            ...(contentType?{'content-type':contentType}:{}),...(bytes?{'content-length':bytes.length}:{})}},res=>{
          let data='';res.on('data',chunk=>{data+=chunk;if(data.length>16384)req.destroy(new Error('Response bound'));});
          res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(data),headers:res.headers});}catch(error){reject(error);}});
          res.on('error',reject);
        });
        req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Request timeout')));req.end(bytes);
      });
    }
    let live=false;
    for(let n=0;n<100;n++){
      assert.equal(server.exitCode,null,`API exited: ${lifecycle}`);
      try{if((await request('/api/livez')).status===200){live=true;break;}}catch{}
      await delay(50);
    }
    assert(live,'Listener unavailable');
    let client=2;
    for(const item of cases.filter(item=>item.tls===tls)){
      const body=Object.hasOwn(item,'wirePayload')?item.wirePayload:Object.hasOwn(item,'body')?JSON.stringify(item.body):undefined;
      const contentType=item.contentType??(Object.hasOwn(item,'body')?'application/json':undefined);
      // Each reference case has a fresh limiter. Real distinct loopback peers
      // preserve that isolation without trusting forwarded headers or disabling
      // any production quota. No network configuration is changed.
      const response=await request(item.path,body,contentType,item.origin?{origin:item.origin}:{},`127.0.0.${client++}`);
      assert.deepEqual({status:response.status,body:response.body,quotaLimit:response.headers['x-ratelimit-limit']??null},
        {status:item.status,body:item.response,quotaLimit:item.quotaLimit},item.name);
      assert.equal(response.headers['set-cookie'],undefined,'A refusal cannot issue a session');
      completed.push(item.name);
    }
    server.kill('SIGTERM');
    let timer;
    try{const [code]=await Promise.race([exit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Shutdown timeout')),10000);})]);assert.equal(code,0);}
    finally{clearTimeout(timer);if(server.exitCode===null){server.kill('SIGKILL');await exit;}}
    server=null;
    assert.equal(await relations(),0,'Public auth refusals cannot initialize metadata');
  }
  assert.equal(completed.length,cases.length);
}finally{
  if(server?.exitCode===null){server.kill('SIGTERM');await exit;}
  await sql.end({timeout:2});await rm(directory,{recursive:true,force:true});
}
verify();
const artifact=JSON.parse(execFileSync(binary,['--build-info'],{encoding:'utf8',maxBuffer:16384}));
console.log(JSON.stringify({status:'PASS',scope:'ACTUAL_HTTP_HTTPS_PUBLIC_AUTH_TRANSPORT_SHAPE_AND_QUOTA_REFUSALS',cases:completed.length,
  artifact,webSourceTreeDigest:distribution?JSON.parse(await readFile(path.join(distribution,'source-identity.json'),'utf8')).sourceTreeDigest:null,
  emptyMetadataPreserved:true,credentialsSupplied:false,sessionsIssued:0,apiShutdowns:[0,0],privateApplicationFixtureRemoved:true,oracle:false}));
