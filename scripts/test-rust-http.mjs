// Raw HTTP parsing parity against the selected native API binary. The caller
// supplies an empty disposable PostgreSQL fixture; no product schema is created.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import postgres from 'postgres';
import {setTimeout as delay} from 'node:timers/promises';

const root=path.resolve('.'),url=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
assert(url?.startsWith('postgresql:///kelryvo_rust_test?host='),'Private PostgreSQL fixture required');
const parsed=new URL(url),socket=parsed.searchParams.get('host');
assert.equal([...parsed.searchParams].length,1);
assert(socket.startsWith(path.join(root,'.cache/rust-tests.'))&&socket.endsWith('/socket'));
const distribution=process.env.KELRYVO_RUST_DISTRIBUTION;
if(distribution)assert(path.isAbsolute(distribution));
const serverBinary=process.env.KELRYVO_RUST_HTTP_SERVER_BINARY??(distribution?path.join(distribution,'bin/kelryvo-server'):path.join(root,'target/debug/kelryvo-server'));
if(process.env.KELRYVO_RUST_HTTP_SERVER_BINARY)assert.equal(serverBinary,path.join(root,'target/debug/kelryvo-server'),'Only the current local debug server may override packaged code');
const webDirectory=distribution?path.join(distribution,'dist/rust-web'):path.join(root,'dist/rust-web');
const verify=()=>{if(distribution)execFileSync(path.join(distribution,'bin/kelryvo'),['verify-dist',distribution],{stdio:'pipe'});};
verify();
const protectedRoutes=process.env.KELRYVO_RUST_HTTP_PROTECTED==='1';
const routing=process.env.KELRYVO_RUST_HTTP_ROUTING==='1';
assert(!(routing&&protectedRoutes),'Select one HTTP contract matrix');
const cases=JSON.parse(await readFile(`tests/fixtures/contracts/${routing?'routing':protectedRoutes?'http-protected':'http'}.json`,'utf8'));
assert.equal(cases.length,routing?39:protectedRoutes?96:6);
const sql=postgres({host:socket,database:'kelryvo_rust_test',max:1,onnotice:()=>{}});
const relations=async()=>(await sql`SELECT count(*)::int total FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`)[0].total;
const directory=await mkdtemp(path.join(root,'.cache/rust-http-'));
let server,serverExit;
const request=(port,method,route,body,contentType)=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:route,method,timeout:3000,
    headers:{connection:'close',...(contentType?{'content-type':contentType,'content-length':Buffer.byteLength(body)}:{})}},res=>{
    let data='';res.on('data',chunk=>{data+=chunk;if(data.length>16384)req.destroy(new Error('Unbounded HTTP response'));});
    res.on('end',()=>{try{resolve({status:res.statusCode,body:routing&&!data?null:JSON.parse(data),quotaLimit:res.headers['x-ratelimit-limit']??null});}catch(error){reject(error);}});
    res.on('error',reject);
  });
  req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('HTTP fixture timeout')));req.end(body);
});
try{
  assert.equal(await relations(),0,'Use a fresh fixture, never product metadata');
  const secrets=path.join(directory,'secrets');await mkdir(secrets,{mode:0o700});
  await writeFile(path.join(secrets,'database-url'),url,{mode:0o600});
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  server=spawn(serverBinary,[],{env:{PATH:process.env.PATH,LANG:'C.UTF-8',TZ:'UTC',KELRYVO_SECRET_DIR:secrets,
    KELRYVO_BIND_HOST:'127.0.0.1',KELRYVO_PORT:String(port),KELRYVO_WEB_DIRECTORY:webDirectory},stdio:['ignore','ignore','pipe']});
  // Lifecycle output contains only fixed startup/shutdown codes; keep it bounded.
  let lifecycle='';server.stderr.on('data',chunk=>{lifecycle=(lifecycle+chunk).slice(-4096);});
  serverExit=once(server,'exit');
  let live=false;
  for(let attempt=0;attempt<100;attempt++){
    assert.equal(server.exitCode,null,`Native API exited: ${lifecycle}`);
    try{if((await request(port,'GET','/api/livez')).status===200){live=true;break;}}catch{}
    await delay(50);
  }
  assert(live,'Native HTTP listener unavailable');
  for(const item of cases){
    const payload=item.invalidUtf8Repeat?Buffer.concat([Buffer.from(item.body),Buffer.alloc(item.invalidUtf8Repeat,255),Buffer.from(item.suffix??'')]):item.body.repeat(item.repeat??1)+(item.suffix??'');
    const response=await request(port,item.method??'POST',item.path??'/api/auth/setup',payload,item.contentType);
    assert.equal(response.status,item.status,item.name);
    assert.deepEqual(response.body,item.response,item.name);
    if(routing)assert.equal(response.quotaLimit,item.quotaLimit,item.name);
  }
  assert.equal(await relations(),0,'Parse rejections cannot create metadata or authority');
}finally{
  try{
    if(server){
      if(server.exitCode===null)server.kill('SIGTERM');
      let timer;
      try{
        const [code]=await Promise.race([serverExit,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Native HTTP shutdown timed out')),10000);})]);
        assert.equal(code,0,'Native API shutdown');
      }finally{
        clearTimeout(timer);
        if(server.exitCode===null){server.kill('SIGKILL');await serverExit;}
      }
    }
  }finally{await sql.end({timeout:2});await rm(directory,{recursive:true,force:true});}
}
verify();
const identity=distribution?JSON.parse(await readFile(path.join(distribution,'source-identity.json'),'utf8')):null;
const binaryIdentity=JSON.parse(execFileSync(serverBinary,['--build-info'],{encoding:'utf8',maxBuffer:16384}));
console.log(JSON.stringify({status:'PASS',scope:routing?'NATIVE_BINARY_HTTP_ROUTING_AND_PARSE_REFUSALS':'NATIVE_BINARY_HTTP_PARSE_REJECTIONS',cases:cases.length,
  sourceTreeDigest:binaryIdentity.sourceTreeDigest??null,artifact:binaryIdentity,
  webSourceTreeDigest:identity?.sourceTreeDigest??null,emptyMetadataPreserved:true,apiExitCode:0,
  applicationFixtureCleanup:true,postgresFixture:'CALLER_OWNED',oracle:false}));
