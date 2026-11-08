/** Evidence preparation only. This module cannot mutate jobs, release HOLD, acquire
 * execution authority or dispatch SQL. Installed recovery must separately hold the
 * native mutex, verify target integrity/effects and obtain independent review. */
import { createHash } from 'node:crypto';
import { approvedHistoryContext } from './history-context.mjs';
import { approvedMigrationIdentities } from './pending-migrations.mjs';
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { createOracleTargetLedger, oracleTargetLedgerId, oracleTargetLedgerSql } from './oracle-target-ledger.mjs';
import { oracleIdentityDigest } from '../connectivity/evidence.mjs';
import { physicalOracleTargetKey } from '../connectivity/instance-identity.mjs';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{' + Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',') + '}':JSON.stringify(v);
export const completionEvidenceDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const migrationIdentity=m=>[m.path,m.version,m.sha256,m.statementManifestDigest,m.statementDigests];
const normalize=row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key.toLowerCase(),value]));
const GATES=['identity','tls','grants','protectedObjects','exclusiveMutex','noOtherWriters','postconditions'];

/** Stable retained facts checked again whenever a recovery record is consumed. */
export function completionCentralDigest({row,attempt,receipts,events}) {
  return completionEvidenceDigest([row.job_id,String(row.job_revision),row.plan_id,row.intent_digest,row.approval_reference,
    row.target_identity_digest,row.history_snapshot_digest,row.mutex_authority_digest,row.validity_digest,
    row.central_evidence_digest,row.host_binding,attempt.id,String(attempt.generation),attempt.state,
    receipts.map(r=>[r.job_id,r.attempt_id,String(r.generation),Number(r.ordinal),r.statement_digest,r.receipt_digest,r.central_evidence_digest]),
    events.map(e=>[e.attempt_id,e.phase,e.ordinal??null,e.statement_digest??null])]);
}

/** Deliberately narrow: complete instance-schema jobs with 1..128 pending
 * statements and all original central ACK/receipt preimages. Partial files,
 * missing ACKs, legacy/unbound jobs and arbitrary operator reports remain HOLD.
 * Input comes from fixed installed readers, never a public API evidence body. */
export async function prepareCompletionEvidence({row,attempt,receipts,events,native,artifact}={}) {
  try {
    // Detach installed-reader snapshots before asynchronous chain validation.
    const serialized=JSON.stringify({row,attempt,receipts,events,native,artifact});
    if(Buffer.byteLength(serialized)>4*1024*1024)return null;
    ({row,attempt,receipts,events,native,artifact}=JSON.parse(serialized));
    const context=approvedHistoryContext(row);
    const intent=verifyOfflinePlanIntent(row?.envelope,row?.intent_digest);
    if(!context||!intent?.target||!UUID.test(row.job_id??'')||row.state!=='HOLD'
        ||!['TRUSTED_VALIDATED','UNIT_SYNTHETIC'].includes(row.scope)
        ||!Number.isSafeInteger(Number(row.job_revision))||Number(row.job_revision)<1
        ||!['target_identity_digest','central_evidence_digest','history_snapshot_digest','mutex_authority_digest','validity_digest'].every(k=>HASH.test(row[k]??''))
        ||context.pendingStatementCount<1||context.pendingStatementCount>128
        ||!attempt||!UUID.test(attempt.id??'')||attempt.state!=='HOLD'
        ||!Number.isSafeInteger(Number(attempt.generation))||Number(attempt.generation)<1
        ||!Array.isArray(receipts)||receipts.length!==context.pendingStatementCount
        ||!Array.isArray(events)||events.length>4*128+4
        ||!native||!GATES.every(key=>native.gates?.[key]===true)
        ||!HASH.test(native.postconditionDigest??'')||!HASH.test(native.integrityDigest??'')
        ||!/^[a-f0-9]{40}$/.test(artifact?.sourceCommit??'')||!/^sha256:[a-f0-9]{64}$/.test(artifact?.imageDigest??''))return null;
    const targetKey=physicalOracleTargetKey(native.identity);
    if(!targetKey||oracleIdentityDigest(native.identity)!==row.target_identity_digest
        ||targetKey!==row.host_binding.targetKey||native.exactOwner!==intent.target.exactOwner
        ||native.streamId!==intent.target.streamId)return null;
    const targetId=oracleTargetLedgerId({targetKey,targetIdentityDigest:row.target_identity_digest,
      credentialMode:'INSTANCE_MASTER',streamId:intent.target.streamId});
    if(native.targetId!==targetId||!Array.isArray(native.headRows)||native.headRows.length!==1
        ||!Array.isArray(native.ledgerRows)||native.ledgerRows.length>3*128+256
        ||!Array.isArray(native.dispatchPreimages)||native.dispatchPreimages.length!==receipts.length)return null;
    // Reuse the actual production chain/grammar/receipt verifier, with a closed
    // SELECT-only snapshot adapter. No caller-supplied COMPLETE flag is trusted.
    const reader=createOracleTargetLedger({
      async execute(sql,binds){
        if(binds.targetId!==targetId)throw Error('Unexpected ledger partition');
        if(sql===oracleTargetLedgerSql.head)return {rows:native.headRows};
        if(sql===oracleTargetLedgerSql.read)return {rows:native.ledgerRows};
        throw Error('Read-only ledger snapshot');
      },async commit(){throw Error('Read-only ledger snapshot');},async rollback(){},
    });
    const ledger=await reader.read(targetId);
    const migrations=approvedMigrationIdentities(intent);
    if(ledger?.ledgerState!=='COMPLETE'||ledger.appliedMigrations.length!==migrations.length
        ||ledger.appliedMigrations.some((m,i)=>!equal(migrationIdentity(m),migrationIdentity(migrations[i]))))return null;
    for(const m of ledger.appliedMigrations.slice(context.appliedMigrationCount))
      if(m.approvalReference!==row.approval_reference||m.intentDigest!==row.intent_digest)return null;
    const started=events.filter(e=>e.phase==='STARTED'),acks=events.filter(e=>e.phase==='ACKNOWLEDGED');
    if(started.length!==receipts.length||acks.length!==receipts.length||events[0]?.phase!=='CLAIMED'
        ||events.at(-1)?.phase!=='HOLD'||events.filter(e=>e.phase==='HOLD').length!==1
        ||events.some(e=>e.attempt_id!==attempt.id))return null;
    const expectedPhases=['CLAIMED',...receipts.flatMap(()=>['STARTED','ACKNOWLEDGED'])];
    const phases=events.map(e=>e.phase);
    if(!equal(phases,[...expectedPhases,'HOLD'])&&!equal(phases,[...expectedPhases,'VALIDITY_VERIFIED','HOLD']))return null;
    const ledgerRows=native.ledgerRows.map(normalize),dispatchIds=new Set(),receiptFacts=[];
    for(let i=0;i<receipts.length;i++){
      const r=receipts[i],expected=context.pendingStatementDigests[i],p=native.dispatchPreimages[i];
      if(r.job_id!==row.job_id||r.attempt_id!==attempt.id||Number(r.generation)!==Number(attempt.generation)
          ||Number(r.ordinal)!==i+1||r.statement_digest!==expected||r.central_evidence_digest!==row.central_evidence_digest
          ||!HASH.test(r.receipt_digest??'')||!UUID.test(p?.dispatchId??'')||dispatchIds.has(p.dispatchId)
          ||p.jobId!==row.job_id||p.planId!==row.plan_id||Number(p.generation)!==Number(attempt.generation)
          ||p.ordinal!==i+1||p.digest!==expected||p.targetId!==targetId
          ||Number(started[i]?.ordinal)!==i+1||started[i].statement_digest!==expected
          ||Number(acks[i]?.ordinal)!==i+1||acks[i].statement_digest!==expected)return null;
      const full=context.statements[context.appliedStatementCount+i];
      const fileOrdinal=intent.items.findIndex(item=>item.path===full.path)+1;
      const nativeAcks=ledgerRows.filter(e=>e.event_type==='STATEMENT_ACKNOWLEDGED'
        &&e.file_ordinal===fileOrdinal&&e.statement_ordinal===full.fileOrdinal&&e.statement_digest===expected);
      if(nativeAcks.length!==1)return null;
      let checkpoint=nativeAcks[0];
      if(full.fileOrdinal===migrations[fileOrdinal-1].statementDigests.length){
        const applied=ledgerRows.filter(e=>e.event_type==='FILE_APPLIED'&&e.file_ordinal===fileOrdinal);
        if(applied.length!==1||applied[0].sequence_no!==checkpoint.sequence_no+1)return null;
        checkpoint=applied[0];
      }
      const receipt={jobId:row.job_id,generation:Number(attempt.generation),ordinal:i+1,statementDigest:expected,outcome:'ACKNOWLEDGED'};
      if(digest([receipt,p.dispatchId,targetId,checkpoint.sequence_no,checkpoint.checksum])!==r.receipt_digest)return null;
      dispatchIds.add(p.dispatchId);
      receiptFacts.push([i+1,expected,r.receipt_digest,r.central_evidence_digest,p.dispatchId,checkpoint.sequence_no,checkpoint.checksum]);
    }
    const evidence={format:1,kind:'KELRYVO_COMPLETE_HELD_EXECUTION',scope:row.scope,jobId:row.job_id,
      jobRevision:String(row.job_revision),projectId:row.project_id,planId:row.plan_id,
      approvalReference:row.approval_reference,intentDigest:row.intent_digest,attemptId:attempt.id,
      generation:String(attempt.generation),targetKey,targetIdentityDigest:row.target_identity_digest,
      streamId:intent.target.streamId,exactOwner:intent.target.exactOwner,targetId,
      admissionProofDigest:digest([row.history_snapshot_digest,row.mutex_authority_digest,row.validity_digest,row.central_evidence_digest,row.host_binding]),
      statementCount:receipts.length,receiptSetDigest:digest(receiptFacts),
      centralSnapshotDigest:completionCentralDigest({row,attempt,receipts,events}),
      ledgerSequence:ledger.sequence,ledgerChecksum:ledger.checksum,
      postconditionDigest:native.postconditionDigest,integrityDigest:native.integrityDigest,
      sourceCommit:artifact.sourceCommit,imageDigest:artifact.imageDigest};
    if(Buffer.byteLength(JSON.stringify(evidence))>8192)return null;
    return Object.freeze({evidence:Object.freeze(evidence),evidenceDigest:completionEvidenceDigest(evidence)});
  }catch{return null;}
}
