// Publication derivative: uses the caller-approved route; exact executed source remains in private evidence.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createPrivateOracleProvider} from 'file:///opt/kelryvo/apps/worker/oracle-provider.mjs';
import {createRestrictedOracleHost} from 'file:///opt/kelryvo/apps/worker/oracle-host.ts';
const input=JSON.parse(fs.readFileSync(0,'utf8'));
process.setgid(10002);process.setuid(10002);
assert.equal(fs.readFileSync('/proc/self/status','utf8').match(/^CapEff:\s+([a-f0-9]+)/mi)?.[1],'0000000000000000');
const {installedOracle}=await import('file:///run/kelryvo/runtime/execution/oracle-authority.mjs');
const driver=createRequire('/opt/kelryvo/package.json')('oracledb');
const original=input.request;const results=[];let stage='initialization';
async function negative(name,change,route){
 stage=name;const r=structuredClone(original);change(r);
 const base=await installedOracle();let resolutions=0,binds=0,nativeSelects=0,mutationAttempts=0,callbackEntered=false;const observed=[];
 const installed={...base,
  async resolvePrivateOptions(){resolutions++;const options=await base.resolvePrivateOptions();if(!route)return options;return {...options,[route]:{...options[route],connectString:options[route].connectString.replace(/\/kp_lost_ack4$/i,'/kp_lost_ack3'),password:input.mismatchPasswords[route]}};},
  async bindTarget(req,p,w,l,n){binds++;
   for(const [role,c] of [['writer',w],['ledgerOwner',l]]){
    const actual=c.execute.bind(c);c.execute=async(sql,...args)=>{
     if(!/^\s*SELECT\b/i.test(sql)){mutationAttempts++;throw Error('ALL_MUTATIONS_FORBIDDEN');}
     nativeSelects++;const value=await actual(sql,...args);
     if(/RAWTOHEX\(GUID\)/i.test(sql)){const row=value.rows?.[0];if(row)observed.push({role,containerName:row.CONTAINER_NAME??row.container_name,containerGuid:row.CONTAINER_GUID??row.container_guid});}
     return value;
    };
   }
   return base.bindTarget(req,p,w,l,n);
  }};
 const host=createRestrictedOracleHost(createPrivateOracleProvider(installed));let accepted=false;
 try{await host.withTarget(r,async session=>{callbackEntered=true;const o=await session.observe();accepted=o!==null;return false;});}catch{}
 assert.equal(accepted,false);assert.equal(mutationAttempts,0);
 if(route){assert.equal(binds,1);assert.ok(nativeSelects>=4);assert.ok(observed.some(o=>o.role===route&&o.containerName==='KP_LOST_ACK3'));}
 else{assert.equal(resolutions,0);assert.equal(binds,0);assert.equal(nativeSelects,0);}
 results.push({name,status:'DENIED',resolutions,binds,nativeSelects,nativeApplicationDdlCalls:0,mutationAttempts,callbackEntered,observed});
}
try{
 await negative('expected_identity_digest_mismatch',r=>{r.executionTarget.expectedIdentityDigest='0'.repeat(64);});
 await negative('unassigned_schema_owner',r=>{r.executionTarget.exactOwner='UNASSIGNED_OWNER';});
 await negative('approved_statement_bytes_mismatch',r=>{r.statementDigests[0]='0'.repeat(64);r.migrations[0].statementDigests[0]='0'.repeat(64);});
 await negative('request_service_mismatch',r=>{r.profile.service='kp_lost_ack3';});
 await negative('actual_writer_pdb_identity_mismatch',()=>{},'writer');
 await negative('actual_ledger_pdb_identity_mismatch',()=>{},'ledgerOwner');
 const roles={};
 for(const [role,user,password] of [['writer','KP_MASTER',input.passwords.writer],['ledgerOwner','KP_LEDGER',input.passwords.ledgerOwner],['observer','KP_OBSERVER',input.passwords.observer]]){
  stage='native purpose '+role;const c=await driver.getConnection({user,password,connectString:'//'+original.profile.host+':'+original.profile.port+'/'+original.profile.service,connectTimeout:5});c.callTimeout=8000;
  try{
   const identity=await c.execute("SELECT SYS_CONTEXT('USERENV','CON_NAME') AS C,SYS_CONTEXT('USERENV','SESSION_USER') AS U FROM SYS.DUAL",[],{outFormat:driver.OUT_FORMAT_OBJECT});assert.equal(identity.rows[0].C,'KP_LOST_ACK4');assert.equal(identity.rows[0].U,user);
   const query=role==='ledgerOwner'?'SELECT COUNT(*) AS N FROM KP_FAULT_B.KELRYVO_LOST_ACK_T':'SELECT COUNT(*) AS N FROM KP_LEDGER.SF_TARGET_LEDGER_EVENTS';
   let denied=null;
   try{const value=await c.execute(query,[],{outFormat:driver.OUT_FORMAT_OBJECT});if(role==='observer'){assert.equal(value.rows[0].N,3);}else throw Error('UNEXPECTED_NATIVE_PRIVILEGE');}
   catch(e){if(role==='observer')throw e;assert.ok([942,1031].includes(e.errorNum));denied=e.errorNum;}
   roles[role]={sessionIdentityVerified:true,protectedReadDenied:role==='writer',applicationReadDenied:role==='ledgerOwner',observedLedgerEvents:role==='observer'?3:undefined,oracleErrorNumber:denied};
  }finally{await c.close();}
 }
 console.log(JSON.stringify({status:'PASS',scope:'INSTALLED_NO_ADMISSION_NEGATIVES_AND_REAL_SELECT_PURPOSE_PROBES',uid:process.getuid(),capabilities:0,applicationDdlCalls:0,heldRequestReplayed:false,cases:results,purposeChecks:roles,fullGovernedOA01OA02:false}));
}catch(e){console.log(JSON.stringify({status:'FAIL',stage,code:e.code??'NEGATIVE_ASSERTION',oracleErrorNumber:e.errorNum??null}));process.exitCode=1;}
