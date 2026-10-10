import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:https';
import { readPrivateTls } from '../../scripts/local-tls.mjs';

export async function createTlsFixture() {
  const directory=await mkdtemp(join(tmpdir(),'sf-tls-'));
  const run=args=>{const result=spawnSync('/usr/bin/openssl',args,{cwd:directory,stdio:'pipe',timeout:15000});
    if(result.status!==0) throw new Error('TLS fixture creation failed');};
  try {
    await chmod(directory,0o700);
    run(['req','-x509','-newkey','rsa:2048','-nodes','-sha256','-days','1','-subj','/CN=SchemaForge disposable test CA','-addext','basicConstraints=critical,CA:TRUE','-keyout','ca.key','-out','ca.pem']);
    run(['req','-newkey','rsa:2048','-nodes','-sha256','-subj','/CN=localhost','-keyout','server.key','-out','server.csr']);
    await writeFile(join(directory,'extensions'),'subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n',{mode:0o600});
    run(['x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial','-days','1','-sha256','-extfile','extensions','-out','server.pem']);
    const certFile=join(directory,'server.pem'),keyFile=join(directory,'server.key');
    await chmod(certFile,0o600);await chmod(keyFile,0o600);
    const tls=await readPrivateTls(certFile,keyFile);
    const ca=await readFile(join(directory,'ca.pem'));
    const spki=createHash('sha256').update(new X509Certificate(tls.cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
    return {directory,certFile,keyFile,tls,ca,spki,close:()=>rm(directory,{recursive:true,force:true})};
  }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
export const tlsRequest=(base,ca,path='/api/session',options={})=>new Promise((resolve,reject)=>{
  const req=request(new URL(path,base),{ca,...options},response=>{
    let body='';response.on('data',chunk=>{body+=chunk;});response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body:body?JSON.parse(body):{},protocol:response.socket?.getProtocol?.()}));
  });req.once('error',reject);req.end(options.body);
});
