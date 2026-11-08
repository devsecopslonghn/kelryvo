/** Installation-only append of independently reviewed, freshly witnessed complete
 * effects. HOLD jobs/attempts/events stay immutable and are never retried. The
 * existing immutable audit journal carries the resolution, so backup lineage and
 * historical archive formats do not change. No public route accepts native facts. */
import { randomUUID } from 'node:crypto';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { approvedHistoryContext } from './history-context.mjs';
import { prepareCompletionEvidence, completionCentralDigest, completionEvidenceDigest } from './completion-evidence.mjs';
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { expectedTargetBindingDigests } from './target-binding-digests.mjs';
import { oracleTargetLedgerId } from './oracle-target-ledger.mjs';
import { acquireTargetLocks } from '../targets/locks.ts';

const ORG='00000000-0000-4000-8000-000000000001';
const ACTION='EXECUTION_RECOVERED_APPLIED';
const uuid=(v:any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const reject=()=>new Error('Held execution completion unavailable');

export async function retainedHeldCompletion(tx:any,jobId:string) {
  if(!uuid(jobId))return null;
  const row=(await tx`SELECT proof.*,job.state,job.revision::text AS job_revision,
      job.organization_id AS job_organization_id,job.project_id AS job_project_id,job.plan_id AS job_plan_id,
      job.admission_scope AS job_scope,job.admission_statement_count AS job_admission_statement_count,
      job.intent_digest AS job_intent_digest,job.approval_reference AS job_approval_reference,
      plan.approval_reference AS plan_approval_reference,plan.offline_intent_digest AS plan_intent_digest,
      plan.profile_id AS plan_profile_id,plan.release_id AS plan_release_id,
      release.manifest_digest AS plan_manifest_digest,
      CASE WHEN octet_length(plan.offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN plan.offline_intent_envelope END AS envelope
    FROM sf_execution_jobs job JOIN sf_execution_admission_proofs proof ON proof.job_id=job.id
    JOIN sf_plans plan ON plan.id=job.plan_id AND plan.project_id=job.project_id
    JOIN sf_projects project ON project.id=job.project_id AND project.organization_id=job.organization_id
    JOIN sf_releases release ON release.id=plan.release_id AND release.project_id=plan.project_id
    WHERE job.id=${jobId} AND job.organization_id=${ORG} AND job.state='HOLD'
      AND project.archived_at IS NULL AND plan.status='APPROVED' AND plan.decision='APPROVE'
      AND NOT EXISTS(SELECT 1 FROM sf_plan_approval_revocations rv WHERE rv.plan_id=plan.id)`)[0];
  const context=approvedHistoryContext(row);
  if(!context||context.pendingStatementCount<1||context.pendingStatementCount>128)return null;
  const intent=verifyOfflinePlanIntent(row.envelope,row.intent_digest);
  if(!intent?.target||row.target_assignment_id!==intent.target.assignmentId)return null;
  const targetEvidence=await tx`SELECT e.identity,e.identity_digest,o.provenance,o.verification_acceptance,
      source.connection_id AS source_connection_id,c.credential_mode
    FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id
    LEFT JOIN sf_instance_profile_sources source ON source.profile_id=${row.profile_id}
    LEFT JOIN sf_database_connections c ON c.id=source.connection_id
    WHERE e.digest=${intent.target.observationDigest} AND e.organization_id=${row.organization_id}
      AND e.project_id=${row.project_id} AND e.assignment_id=${intent.target.assignmentId}
      AND e.assignment_revision::text=${intent.target.assignmentRevision} AND e.route_id=${intent.target.routeId}
      AND e.exact_owner=${intent.target.exactOwner} LIMIT 2`;
  if(targetEvidence.length!==1||targetEvidence[0].identity_digest!==row.target_identity_digest
      ||!expectedTargetBindingDigests(intent,targetEvidence[0]).includes(row.host_binding.targetBindingDigest)
      ||row.scope==='TRUSTED_VALIDATED'&&(targetEvidence[0].credential_mode!=='INSTANCE_MASTER'
        ||targetEvidence[0].provenance!=='ORACLE_READ_ONLY'||!targetEvidence[0].verification_acceptance))return null;

  const attempts=await tx`SELECT id,generation::text AS generation,state,(lease_until<=clock_timestamp()) AS expired FROM sf_execution_attempts
    WHERE job_id=${jobId} ORDER BY generation LIMIT 2`;
  if(attempts.length!==1||attempts[0].state!=='HOLD'||attempts[0].expired!==true)return null;
  const attempt=attempts[0];
  const receipts=await tx`SELECT job_id,attempt_id,generation::text AS generation,ordinal,statement_digest,receipt_digest,central_evidence_digest
    FROM sf_execution_receipts WHERE job_id=${jobId} AND attempt_id=${attempt.id} AND generation=${attempt.generation} ORDER BY ordinal LIMIT 129`;
  const events=await tx`SELECT attempt_id,phase,ordinal,statement_digest FROM sf_execution_attempt_events
    WHERE attempt_id=${attempt.id} ORDER BY revision LIMIT 517`;
  if(receipts.length!==context.pendingStatementCount||events.length>516)return null;
  return {row,attempt,receipts,events,context};
}

async function reviewedSubmission(tx:any,snapshot:any,id:string,evidenceDigest:string,lock=false) {
  if(!uuid(id))return null;
  const r=snapshot.row;
  const rows=await tx`SELECT s.id,d.id AS decision_id,d.reviewer_id,s.submitter_id
    FROM sf_execution_reconciliations s JOIN sf_execution_reconciliation_decisions d ON d.reconciliation_id=s.id
    JOIN sf_local_actors reviewer ON reviewer.id=d.reviewer_id AND reviewer.organization_id=s.organization_id AND reviewer.role='approver'
    JOIN sf_project_grants member ON member.project_id=s.project_id AND member.organization_id=s.organization_id
      AND member.actor_id=reviewer.id AND member.revoked_at IS NULL
    JOIN sf_project_grants submitter ON submitter.project_id=s.project_id AND submitter.organization_id=s.organization_id
      AND submitter.actor_id=s.submitter_id AND submitter.revoked_at IS NULL
    JOIN sf_plans plan ON plan.id=s.plan_id AND plan.project_id=s.project_id
    JOIN sf_execution_jobs job ON job.id=s.job_id
    WHERE s.id=${id} AND s.job_id=${r.job_id} AND s.organization_id=${ORG} AND s.project_id=${r.project_id}
      AND s.plan_id=${r.plan_id} AND s.job_revision::text=${r.job_revision}
      AND d.job_revision=s.job_revision AND s.approval_reference=${r.approval_reference}
      AND s.intent_digest=${r.intent_digest} AND s.admission_scope=${r.scope}
      AND s.target_identity_digest=${r.target_identity_digest} AND s.evidence_kind='TARGET_LEDGER'
      AND s.evidence_digest=${evidenceDigest} AND d.decision='EVIDENCE_REVIEWED'
      AND reviewer.id<>s.submitter_id AND reviewer.id<>job.requester_id AND reviewer.id<>plan.author_id
      LIMIT 2 ${tx.unsafe(lock?'FOR SHARE OF s,d,reviewer,member,submitter,plan,job':'')}`;
  return rows.length===1?rows[0]:null;
}

/** Central resolution is only a historical witness. Fresh installed target/ledger
 * verification remains mandatory before a later plan may skip or execute SQL. */
export async function readRecoveredCompletion(tx:any,jobId:string) {
  const snapshot=await retainedHeldCompletion(tx,jobId);if(!snapshot)return null;
  const rows=await tx`SELECT actor_id,CASE WHEN octet_length(facts::text)<=8192 THEN facts END AS facts
    FROM sf_audit WHERE organization_id=${ORG} AND project_id=${snapshot.row.project_id}
      AND resource_id=${jobId} AND action=${ACTION} ORDER BY created_at,id LIMIT 2`;
  if(rows.length!==1)return null;
  const {facts,actor_id}=rows[0],e=facts?.evidence;
  const intent=verifyOfflinePlanIntent(snapshot.row.envelope,snapshot.row.intent_digest);
  const targetId=intent?.target?oracleTargetLedgerId({targetKey:snapshot.row.host_binding.targetKey,targetIdentityDigest:snapshot.row.target_identity_digest,credentialMode:'INSTANCE_MASTER',streamId:intent.target.streamId}):null;
  if(!e||Object.keys(facts).sort().join(',')!=='decisionId,evidence,evidenceDigest,reconciliationId'
      ||e.format!==1||e.kind!=='KELRYVO_COMPLETE_HELD_EXECUTION'||e.jobId!==jobId
      ||e.scope!==snapshot.row.scope||e.jobRevision!==snapshot.row.job_revision
      ||e.projectId!==snapshot.row.project_id||e.planId!==snapshot.row.plan_id
      ||e.intentDigest!==snapshot.row.intent_digest||e.approvalReference!==snapshot.row.approval_reference
      ||e.attemptId!==snapshot.attempt.id||e.generation!==snapshot.attempt.generation
      ||e.targetKey!==snapshot.row.host_binding.targetKey||e.targetIdentityDigest!==snapshot.row.target_identity_digest
      ||e.streamId!==intent?.target?.streamId||e.exactOwner!==intent?.target?.exactOwner||e.targetId!==targetId
      ||e.statementCount!==snapshot.context.pendingStatementCount||!Number.isSafeInteger(e.ledgerSequence)||e.ledgerSequence<1
      ||!['ledgerChecksum','postconditionDigest','integrityDigest','receiptSetDigest','admissionProofDigest'].every(k=>/^[a-f0-9]{64}$/.test(e[k]??''))
      ||!/^[a-f0-9]{40}$/.test(e.sourceCommit??'')||!/^sha256:[a-f0-9]{64}$/.test(e.imageDigest??'')
      ||e.centralSnapshotDigest!==completionCentralDigest(snapshot)||facts.evidenceDigest!==completionEvidenceDigest(e)
      ||typeof actor_id!=='string'||!/^installed-recovery:[A-Za-z0-9._:-]{1,100}$/.test(actor_id))return null;
  const reviewed=await reviewedSubmission(tx,snapshot,facts.reconciliationId,facts.evidenceDigest);
  if(!reviewed||reviewed.decision_id!==facts.decisionId)return null;
  return {evidence:e,evidenceDigest:facts.evidenceDigest,reconciliationId:reviewed.id,decisionId:reviewed.decision_id};
}

/** Fixed installation closure only. withTarget must retain the native mutex through
 * accept(), attest identity/TLS/grants/object integrity/effects, and cleanly close
 * all its capabilities. Neither action can execute migration SQL or claim a job. */
export function createHeldCompletionOperator({sql,scope,workerId,artifact,withTarget,expectedMetadataGenerationId,allowUnitSynthetic=false}:any) {
  if(typeof sql!=='function'||typeof sql.begin!=='function'||typeof withTarget!=='function'||!uuid(expectedMetadataGenerationId)
      ||!['TRUSTED_VALIDATED','UNIT_SYNTHETIC'].includes(scope)
      ||(scope==='UNIT_SYNTHETIC')!==allowUnitSynthetic
      ||typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(workerId)
      ||!/^[a-f0-9]{40}$/.test(artifact?.sourceCommit??'')||!/^sha256:[a-f0-9]{64}$/.test(artifact?.imageDigest??''))throw reject();
  const fixedArtifact=Object.freeze({...artifact});let busy=false;
  const operate=async(jobId:string,reconciliationId?:string)=>{
    if(busy||!uuid(jobId)||reconciliationId!==undefined&&!uuid(reconciliationId))throw reject();busy=true;
    try{return await sql.begin(async(tx:any)=>{
      const identity=(await tx`SELECT plan_id FROM sf_execution_jobs WHERE id=${jobId} AND organization_id=${ORG}`)[0];
      if(!identity)throw reject();
      await acquireTargetLocks(tx,{planId:identity.plan_id});
      await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
      const generation=(await tx`SELECT g.id,g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g`)[0];
      if(generation?.state!=='ACTIVE'||generation.id!==expectedMetadataGenerationId)throw reject();
      await tx`SELECT id FROM sf_execution_jobs WHERE id=${jobId} FOR UPDATE`;
      const snapshot=await retainedHeldCompletion(tx,jobId);
      if(!snapshot||snapshot.row.scope!==scope)throw reject();
      // Fixed native verifier is called only once and must call accept once while
      // still holding its mutex. No asynchronous acceptance may outlive the call.
      let accepted=false,finished=false,result:any;
      await withTarget(Object.freeze({...snapshot,metadataGenerationId:generation.id}),async(native:any)=>{
        if(accepted||finished)throw reject();accepted=true;
        const prepared=await prepareCompletionEvidence({...snapshot,native,artifact:fixedArtifact});
        if(!prepared)throw reject();
        if(!reconciliationId){result={...prepared,status:'PREPARED',executionAuthority:false,retryEligible:false};return;}
        const reviewed=await reviewedSubmission(tx,snapshot,reconciliationId,prepared.evidenceDigest,true);
        if(!reviewed)throw reject();
        const prior=await readRecoveredCompletion(tx,jobId);
        if(prior){if(prior.evidenceDigest!==prepared.evidenceDigest||prior.reconciliationId!==reconciliationId)throw reject();result={...prior,status:'RECOVERED_APPLIED',repeated:true};return;}
        if((await tx`SELECT 1 FROM sf_audit WHERE organization_id=${ORG} AND resource_id=${jobId} AND action=${ACTION} LIMIT 1`)[0])throw reject();
        await tx`INSERT INTO sf_audit(id,organization_id,project_id,actor_id,action,resource_id,facts)
          VALUES(${randomUUID()},${ORG},${snapshot.row.project_id},${'installed-recovery:'+workerId},${ACTION},${jobId},
            ${tx.json({evidence:prepared.evidence,evidenceDigest:prepared.evidenceDigest,reconciliationId,decisionId:reviewed.decision_id})})`;
        result={...prepared,reconciliationId,decisionId:reviewed.decision_id,status:'RECOVERED_APPLIED',repeated:false};
      });
      finished=true;if(!accepted||!result)throw reject();
      return {...result,jobState:'HOLD',executionAuthority:false,retryEligible:false};
    });}catch{throw reject();}finally{busy=false;}
  };
  return Object.freeze({scope,preview:(jobId:string)=>operate(jobId),confirm:(jobId:string,reconciliationId:string)=>operate(jobId,reconciliationId)});
}
