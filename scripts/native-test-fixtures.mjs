// Test-only adapters. The native CLI supplies synthetic data; frozen contracts
// independently verify the core operations in test-rust-parity.mjs.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
export function core(request){
  const distribution=process.env.KELRYVO_RUST_DISTRIBUTION;
  const cli=distribution?path.join(distribution,'bin/kelryvo'):path.resolve('target/debug/kelryvo');
  return JSON.parse(execFileSync(cli,['core'],{input:JSON.stringify(request)+'\n',encoding:'utf8',maxBuffer:32*1024*1024,timeout:30000}));
}
export const normalizeObservation=(observation,operation)=>core({op:'normalizeObservation',observation,operation});
export const evidenceDigest=identity=>core({op:'oracleIdentityDigest',identity});
export const normalizeSchema=(raw,owner)=>core({op:'normalizeSchema',raw,owner});
export const compareSchemas=(expected,observed)=>core({op:'compareSchemas',expected,observed});
export const encodeOfflinePlanIntent=facts=>core({op:'encodeOfflinePlanIntent',facts});
export const verifyOfflinePlanIntent=(envelope,digest,expected)=>core({op:'verifyOfflinePlanIntent',envelope,digest,expected});
export const verifyValidation=(envelope,digest,expected)=>core({op:'verifyValidation',envelope,digest,expected});
let operatorRoot;
async function inventory(action,input){
  const url=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
  assert(url?.startsWith('postgresql:///kelryvo_rust_test?host='));
  if(!operatorRoot){operatorRoot=await mkdtemp(path.resolve('.cache/rust-inventory-fixture-'));await writeFile(path.join(operatorRoot,'database-url'),url,{mode:0o600});}
  const distribution=process.env.KELRYVO_RUST_DISTRIBUTION;
  const operator=distribution?path.join(distribution,'bin/kelryvo-operator'):path.resolve('target/debug/kelryvo-operator');
  return JSON.parse(execFileSync(operator,['inventory',action],{input:JSON.stringify(input),encoding:'utf8',env:{PATH:process.env.PATH,KELRYVO_SECRET_DIR:operatorRoot},timeout:30000}));
}
export const declareReference=(_sql,input)=>inventory('declare',input);
export const assignReference=(_sql,input)=>inventory('assign',input);
// Independent wire-level crypto check for ciphertext created through the API.
export const oracleCredentialEndpointDigest=c=>createHash('sha256').update(JSON.stringify([c.host,c.port,c.service,c.transport])).digest('hex');
export function openOracleCredential(envelope,context,privatePem){
  const fields=['organizationId','connectionId','credentialId','username','purpose','endpointDigest'];
  const aad=Buffer.from(JSON.stringify(fields.map(k=>[k,context[k]])));
  const key=privateDecrypt({key:privatePem,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:aad},Buffer.from(envelope.wrappedKey,'base64'));
  try{const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.nonce,'base64'));cipher.setAAD(aad);cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()]).toString('utf8');}
  finally{key.fill(0);}
}
