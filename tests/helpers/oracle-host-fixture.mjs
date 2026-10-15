import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FakeConnection } from './oracle-ledger-fixture.mjs';
import { createRestrictedOracleHost, oracleExecutionProfileDigest, oracleHostIdentitySql } from '../../apps/worker/oracle-host.ts';
import { executionDigest } from '../../packages/execution/admission.ts';
import { createOracleTargetLedger, oracleTargetLedgerId } from '../../packages/execution/oracle-target-ledger.mjs';

// Fake Oracle transport only. Committed ledger transactions are real adapter calls;
// writer SQL effects, physical identity/grants and runtime lock semantics are synthetic.
export function oracleHostFixture(options={}) {
  const owner=new FakeConnection();owner.callTimeout=1000;owner.oracleServerVersionString='19.26.0.0.0';
  const calls=[],claims=[],writers=[];
  let assignment=options.assignment ?? randomUUID(),beforeDispatch=options.beforeDispatch,afterExecute=options.afterExecute;
  const targetKey=options.targetKey ?? `unit:oracle-host:${randomUUID()}`;
  const physical=executionDigest(['UNIT physical identity',targetKey]);
  const binding={ targetKey,targetIdentityDigest:physical },id=oracleTargetLedgerId(binding);
  const serviceName=options.service ?? 'UNIT';
  const expected={ databaseUniqueName:'UNIT_DB',containerName:'UNIT_PDB',containerId:'3',serviceName,serverVersionString:'19.26.0.0.0' };
  const identity=(principal,sessionId) => ({ SESSION_USER:principal,CURRENT_SCHEMA:principal,
    SCHEMA_NAME:principal,DATABASE_NAME:'UNIT_DB',CONTAINER_NAME:'UNIT_PDB',CONTAINER_ID:'3',SERVICE_NAME:serviceName,SESSION_ID:sessionId,PROXY_USER:null });
  const ownerExecute=owner.execute.bind(owner);
  owner.execute=async(sql,binds,configuration) => sql===oracleHostIdentitySql
    ? { rows:[identity('SF_OWNER','999')] } : ownerExecute(sql,binds,configuration);
  const providers=[];
  const installed={ workerId:'unit-oracle-host',scope:'UNIT_SYNTHETIC',authorize:async request => {
    const permit={ scope:'UNIT_SYNTHETIC',action:'EXECUTE_APPROVED_MIGRATIONS',workerId:'unit-oracle-host',jobId:request.jobId,
      planId:request.planId,intentDigest:request.intentDigest,approvalReference:request.approvalReference,
      profileDigest:oracleExecutionProfileDigest(request.profile),statementDigestsDigest:executionDigest(request.statementDigests),
      dispatchPermitDigest:executionDigest(['UNIT write permit',request.jobId]),expiresAt:Date.now()+60000 };
    return options.permit ? options.permit(permit,request) : permit;
  },withTarget:async(request,permit,run) => {
    providers.push(request.jobId);
    const writer={ callTimeout:1000,oracleServerVersionString:'19.26.0.0.0',identity:identity('APP',String(writers.length+1)),
      lock:null,closed:false,lockCalls:[],rollback:async()=>{},commit:async()=>{
        if (options.lostWriterCommit) throw new Error('UNIT lost writer commit ACK');
      },execute:async(sql,binds,configuration)=>{
        assert.equal(writer.closed,false,'provider retains physical writer until worker settles');
        if (sql===oracleHostIdentitySql) return { rows:[structuredClone(writer.identity)] };
        if(sql.startsWith('ALTER SESSION SET CURRENT_SCHEMA = ')) { writer.identity.SCHEMA_NAME=sql.slice(sql.indexOf('=')+1).trim().slice(1,-1).replaceAll('""','"');return {}; }
        if(sql.startsWith('SELECT OBJECT_TYPE FROM SYS.ALL_OBJECTS')) return {rows:options.existingTable===false?[]:[{OBJECT_TYPE:options.existingTableType??'TABLE'}]};
        if (sql.startsWith('BEGIN SF_OWNER.SF_TARGET_MUTEX.')) {
          writer.lockCalls.push(sql);
          assert.equal(configuration.autoCommit,false);
          const key=binds.lockName.val,nonce=binds.nonce.val;
          if (sql.includes('.ACQUIRE_LOCK(')) {
            if (options.contention) return { outBinds:{ result:1 } };
            if (writer.lock) return { outBinds:{ result:3 } };
            writer.lock={ key,nonce };return { outBinds:{ result:0 } };
          }
          if (!writer.lock || writer.lock.key!==key || writer.lock.nonce!==nonce) return { outBinds:{ result:4 } };
          if (sql.includes('.RELEASE_LOCK(')) {
            writer.lock=null;if (options.releaseFailure) throw new Error('UNIT release ACK lost');
          }
          return { outBinds:{ result:0 } };
        }
        assert.ok(writer.lock,'writer SQL requires same-session mutex');
        const state=await createOracleTargetLedger(owner).read(id);
        assert.equal(state.ledgerState,'IN_FLIGHT');assert.equal(state.startedFiles.at(-1).statementStates.at(-1),'STARTED');
        if (beforeDispatch) await beforeDispatch(sql,request,writer,state);
        calls.push(sql);
        if (afterExecute) await afterExecute(sql,request,writer,state);
        if (options.lostWriterExecute) throw new Error('UNIT execute ACK lost after effect');
        return {};
      } };
    writers.push(writer);
    const attest=()=>({ scope:'UNIT_SYNTHETIC',targetAssignmentId:assignment,targetKey,targetIdentityDigest:physical,
      validityDigest:executionDigest('UNIT validity'),centralEvidenceDigest:executionDigest('UNIT central'),
      hostWitnessDigest:executionDigest('UNIT host'),mutexAuthorityDigest:executionDigest('UNIT mutex'),dispatchPermitDigest:permit.dispatchPermitDigest,expected });
    const target={ writer,ledgerOwner:owner,ledgerOwnerName:'SF_OWNER',attest:async()=>options.attest ? options.attest(attest(),request,writer) : attest(),
      verifyEmptyTarget:async()=>options.emptyTarget!==false,claimDispatch:async(_request,_permit,statement)=>{
        claims.push(structuredClone(statement));
        return options.claim ? options.claim(statement,request,writer) : { jobId:request.jobId,ordinal:statement.ordinal,digest:statement.digest,dispatchId:randomUUID() };
      },verifyPostconditions:async()=>options.postconditions!==false,centralEvidenceComplete:async(_request,progress)=>{
        if (options.central) return options.central(progress);
        return true;
      } };
    try { return await run(target); } finally { assert.equal(writer.lock,null,'host releases before provider retires writer');writer.closed=true; }
  } };
  const host=()=>createRestrictedOracleHost(installed,{ allowUnitSynthetic:true });
  return { owner,calls,claims,writers,providers,installed,host,id,binding,
    setAssignment:value=>{ assignment=value; },setBeforeDispatch:fn=>{ beforeDispatch=fn; },setAfterExecute:fn=>{ afterExecute=fn; },
    read:()=>createOracleTargetLedger(owner).read(id) };
}
