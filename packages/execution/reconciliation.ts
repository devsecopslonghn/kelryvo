import { randomUUID } from 'node:crypto';
import { LOCAL_ORGANIZATION as ORG, projectAccessMode } from '../database/project-membership.ts';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { acquireTargetLocks } from '../targets/locks.ts';
import { verifyOfflinePlanIntent } from '../migrations/offline-plan-intent.mjs';
import { MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';

const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const revision=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
const reason=(v:unknown)=>typeof v==='string'&&v.trim().length>0&&Buffer.byteLength(v,'utf8')<=1000
  &&Buffer.from(v,'utf8').toString('utf8')===v&&!/[\u0000-\u001f\u007f]/.test(v);
const responseError=(code:string,status=409)=>Object.assign(new Error(code),{productCode:code,statusCode:status});
const MAX_SUBMISSIONS_PER_JOB=20;

function boundPlanIntent(plan:any,projectId:string){
  if(!plan)return null;
  return verifyOfflinePlanIntent(plan.intent_envelope,plan.intent_digest,{organizationId:ORG,projectId,
    requesterId:plan.author_id,releaseId:plan.release_id,profileId:plan.profile_id});
}

export async function initializeExecutionReconciliation(sql:any){
  const install=async(tx:any)=>tx.unsafe(`
    CREATE TABLE IF NOT EXISTS sf_execution_reconciliations (
      id uuid PRIMARY KEY, job_id uuid NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL, plan_id uuid NOT NULL,
      approval_reference uuid NOT NULL, intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
      job_revision bigint NOT NULL CHECK(job_revision>=0), admission_scope text NOT NULL CHECK(admission_scope IN ('PRODUCT_REQUEST','TRUSTED_VALIDATED','UNIT_SYNTHETIC')),
      target_identity_digest text CHECK(target_identity_digest IS NULL OR target_identity_digest ~ '^[a-f0-9]{64}$'),
      submitter_id text NOT NULL, evidence_kind text NOT NULL CHECK(evidence_kind IN ('TARGET_LEDGER','TARGET_OBSERVATION','OPERATOR_REPORT')),
      evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'), reason text NOT NULL CHECK(octet_length(reason)<=1000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(job_id,evidence_digest), UNIQUE(id,job_id,organization_id,project_id),
      FOREIGN KEY(job_id,organization_id,project_id) REFERENCES sf_execution_jobs(id,organization_id,project_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id),
      FOREIGN KEY(submitter_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE INDEX IF NOT EXISTS sf_execution_reconciliations_job ON sf_execution_reconciliations(job_id,created_at,id);
    CREATE TABLE IF NOT EXISTS sf_execution_reconciliation_decisions (
      id uuid PRIMARY KEY, reconciliation_id uuid NOT NULL, job_id uuid NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL,
      reviewer_id text NOT NULL, job_revision bigint NOT NULL CHECK(job_revision>=0), decision text NOT NULL CHECK(decision IN ('RETAIN_HOLD','EVIDENCE_REVIEWED')),
      reason text NOT NULL CHECK(octet_length(reason)<=1000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(reconciliation_id),
      FOREIGN KEY(reconciliation_id,job_id,organization_id,project_id) REFERENCES sf_execution_reconciliations(id,job_id,organization_id,project_id),
      FOREIGN KEY(reviewer_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE OR REPLACE FUNCTION sf_reject_execution_reconciliation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'execution reconciliation evidence is immutable'; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_reconciliations_immutable') THEN
      CREATE TRIGGER sf_execution_reconciliations_immutable BEFORE UPDATE OR DELETE ON sf_execution_reconciliations
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_reconciliation_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_reconciliation_decisions_immutable') THEN
      CREATE TRIGGER sf_execution_reconciliation_decisions_immutable BEFORE UPDATE OR DELETE ON sf_execution_reconciliation_decisions
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_reconciliation_mutation(); END IF; END $$;
  `);
  if(typeof sql.begin==='function')await sql.begin(install);else await install(sql);
}

const publicSubmission=(r:any)=>({id:r.id,jobId:r.job_id,planId:r.plan_id,jobRevision:String(r.job_revision),admissionScope:r.admission_scope,
  targetIdentityDigest:r.target_identity_digest,submitterId:r.submitter_id,evidenceKind:r.evidence_kind,evidenceDigest:r.evidence_digest,
  reason:r.reason,createdAt:r.created_at,decision:r.decision?{id:r.decision_id,reviewerId:r.reviewer_id,jobRevision:String(r.decision_revision),
    decision:r.decision,reason:r.decision_reason,createdAt:r.decision_created_at}:null,
  retryEligible:false,executionAuthority:false});

export function registerExecutionReconciliation(app:any,{sql,authenticate}:any){
  const route=(method:string,path:string,fn:any)=>app[method](path,{preHandler:authenticate},async(req:any,reply:any)=>{
    reply.header('Cache-Control','no-store');try{return await fn(req,reply);}catch(e:any){
      const mappedStatus:Record<string,number>={NOT_FOUND:404,UNAUTHENTICATED:401,DEVELOPER_REQUIRED:403,MEMBERSHIP_BOOTSTRAP_REQUIRED:409};
      const status=e.statusCode??mappedStatus[e.productCode]??0;
      if(status)return reply.code(status).send({error:e.productCode??'RECONCILIATION_UNAVAILABLE'});throw e;
    }
  });
  route('post','/api/execution-jobs/:id/reconciliations',async(req:any,reply:any)=>{
    const b=req.body;
    if(!uuid(req.params.id)||!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).sort().join(',')!=='evidenceDigest,evidenceKind,expectedRevision,reason'
      ||!digest(b.evidenceDigest)||!['TARGET_LEDGER','TARGET_OBSERVATION','OPERATOR_REPORT'].includes(b.evidenceKind)||!revision(b.expectedRevision)||!reason(b.reason))
      return reply.code(400).send({error:'INVALID_REQUEST'});
    const result=await sql.begin(async(tx:any)=>{
      const identity=(await tx`SELECT project_id,plan_id FROM sf_execution_jobs WHERE id=${req.params.id} AND organization_id=${ORG}`)[0];
      if(!identity)return null;
      req.scopedProjectId=identity.project_id;
      await acquireTargetLocks(tx,{planId:identity.plan_id});
      await guardMutationAuthority(tx,req);
      if(await projectAccessMode(tx)!=='ENFORCED')throw responseError('MEMBERSHIP_BOOTSTRAP_REQUIRED');
      const plan=(await tx`SELECT id,project_id,author_id,release_id,profile_id,offline_intent_digest AS intent_digest,approval_reference,
        CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN offline_intent_envelope END AS intent_envelope FROM sf_plans
        WHERE id=${identity.plan_id} AND project_id=${identity.project_id} FOR SHARE`)[0];
      const project=(await tx`SELECT id,archived_at FROM sf_projects WHERE id=${identity.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
      const job=(await tx`SELECT id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,state,revision,admission_scope
        FROM sf_execution_jobs WHERE id=${req.params.id} AND project_id=${identity.project_id} AND plan_id=${identity.plan_id} AND organization_id=${ORG} FOR UPDATE`)[0];
      if(!job||!project||!plan)return null;
      const member=(await tx`SELECT id FROM sf_project_grants WHERE organization_id=${ORG} AND project_id=${job.project_id}
        AND actor_id=${req.actor.id} AND revoked_at IS NULL FOR SHARE`)[0];
      const deployer=(await tx`SELECT id FROM sf_project_deploy_grants WHERE organization_id=${ORG} AND project_id=${job.project_id}
        AND actor_id=${req.actor.id} AND revoked_at IS NULL FOR SHARE`)[0];
      if(!member||!deployer)throw responseError('NOT_FOUND',404);
      const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g`)[0];
      if(gate?.state!=='ACTIVE')throw responseError('METADATA_RESTORE_HOLD');
      if(project.archived_at)throw responseError('PROJECT_ARCHIVED');
      if(job.state!=='HOLD')throw responseError('JOB_NOT_ON_HOLD');
      if(String(job.revision)!==String(b.expectedRevision))throw responseError('REVISION_CONFLICT');
      const intent=boundPlanIntent(plan,job.project_id);
      if(!intent||intent.digest!==job.intent_digest||job.intent_digest!==plan.intent_digest||job.approval_reference!==plan.approval_reference)
        throw responseError('JOB_BINDING_UNAVAILABLE');
      const prior=(await tx`SELECT * FROM sf_execution_reconciliations WHERE job_id=${job.id} AND evidence_digest=${b.evidenceDigest}`)[0];
      if(prior){
        if(prior.organization_id!==job.organization_id||prior.project_id!==job.project_id||prior.plan_id!==job.plan_id
          ||prior.approval_reference!==job.approval_reference||prior.intent_digest!==job.intent_digest
          ||String(prior.job_revision)!==String(job.revision)||prior.submitter_id!==req.actor.id||prior.evidence_kind!==b.evidenceKind||prior.reason!==b.reason.trim())
          throw responseError('EVIDENCE_DIGEST_CONFLICT');
        return {submission:prior,repeated:true};
      }
      const count=(await tx`SELECT count(*)::int AS n FROM sf_execution_reconciliations WHERE job_id=${job.id}`)[0].n;
      if(count>=MAX_SUBMISSIONS_PER_JOB)throw responseError('RECONCILIATION_LIMIT');
      const proof=(await tx`SELECT organization_id,project_id,plan_id,approval_reference,intent_digest,scope,target_identity_digest
        FROM sf_execution_admission_proofs WHERE job_id=${job.id}`)[0];
      if(job.admission_scope!=='PRODUCT_REQUEST'&&!proof)throw responseError('JOB_BINDING_UNAVAILABLE');
      if(proof&&(proof.organization_id!==job.organization_id||proof.project_id!==job.project_id||proof.plan_id!==job.plan_id
        ||proof.approval_reference!==job.approval_reference||proof.intent_digest!==job.intent_digest||proof.scope!==job.admission_scope
        ||!digest(proof.target_identity_digest)))throw responseError('JOB_BINDING_UNAVAILABLE');
      const id=randomUUID();
      const submission=(await tx`INSERT INTO sf_execution_reconciliations(id,job_id,organization_id,project_id,plan_id,approval_reference,intent_digest,
        job_revision,admission_scope,target_identity_digest,submitter_id,evidence_kind,evidence_digest,reason)
        VALUES(${id},${job.id},${job.organization_id},${job.project_id},${job.plan_id},${job.approval_reference},${job.intent_digest},
          ${job.revision},${job.admission_scope},${proof?.target_identity_digest??null},${req.actor.id},${b.evidenceKind},${b.evidenceDigest},${b.reason.trim()}) RETURNING *`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${job.project_id},${ORG},${req.actor.id},'EXECUTION_RECONCILIATION_SUBMITTED',${id},${tx.json({jobId:job.id,planId:job.plan_id,
          evidenceDigest:b.evidenceDigest,evidenceKind:b.evidenceKind,jobRevision:String(job.revision),retryEligible:false,executionAuthority:false})})`;
      return {submission,repeated:false};
    });
    if(!result)return reply.code(404).send({error:'NOT_FOUND'});
    return reply.code(result.repeated?200:201).send({reconciliation:publicSubmission(result.submission)});
  });

  route('get','/api/execution-jobs/:id/reconciliations',async(req:any,reply:any)=>{
    if(!uuid(req.params.id)||Object.keys(req.query).length)return reply.code(404).send({error:'NOT_FOUND'});
    const result=await sql.begin('isolation level repeatable read read only',async(tx:any)=>{
      if(await projectAccessMode(tx)!=='ENFORCED')return null;
      const job=(await tx`SELECT j.id,j.project_id FROM sf_execution_jobs j JOIN sf_project_grants g ON g.project_id=j.project_id AND g.organization_id=j.organization_id
        AND g.actor_id=${req.actor.id} AND g.revoked_at IS NULL JOIN sf_local_credentials c ON c.actor_id=g.actor_id AND c.token_sha256=${req.credentialDigest}
        AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE j.id=${req.params.id} AND j.organization_id=${ORG}`)[0];
      if(!job)return null;
      const reconciliations=await tx`SELECT s.*,d.id AS decision_id,d.reviewer_id,d.job_revision AS decision_revision,d.decision,d.reason AS decision_reason,d.created_at AS decision_created_at
        FROM sf_execution_reconciliations s LEFT JOIN sf_execution_reconciliation_decisions d ON d.reconciliation_id=s.id
        WHERE s.job_id=${job.id} ORDER BY s.created_at,s.id LIMIT ${MAX_SUBMISSIONS_PER_JOB}`;
      return {jobId:job.id,projectId:job.project_id,reconciliations};
    });
    return result===null?reply.code(404).send({error:'NOT_FOUND'}):{jobId:result.jobId,projectId:result.projectId,
      reconciliations:result.reconciliations.map(publicSubmission),retryEligible:false,executionAuthority:false};
  });

  route('post','/api/execution-jobs/:id/reconciliations/:reconciliationId/decision',async(req:any,reply:any)=>{
    const b=req.body;
    if(!uuid(req.params.id)||!uuid(req.params.reconciliationId)||!b||typeof b!=='object'||Array.isArray(b)
      ||Object.keys(b).sort().join(',')!=='decision,expectedRevision,reason'||!['RETAIN_HOLD','EVIDENCE_REVIEWED'].includes(b.decision)
      ||!revision(b.expectedRevision)||!reason(b.reason))return reply.code(400).send({error:'INVALID_REQUEST'});
    const result=await sql.begin(async(tx:any)=>{
      const identity=(await tx`SELECT job.project_id,job.plan_id FROM sf_execution_reconciliations s JOIN sf_execution_jobs job ON job.id=s.job_id
        WHERE s.id=${req.params.reconciliationId} AND s.job_id=${req.params.id} AND s.organization_id=${ORG}`)[0];
      if(!identity)return null;
      req.scopedProjectId=identity.project_id;
      await acquireTargetLocks(tx,{planId:identity.plan_id});
      await guardMutationAuthority(tx,req);
      const plan=(await tx`SELECT id,author_id,release_id,profile_id,offline_intent_digest AS intent_digest,
        approval_reference,CASE WHEN octet_length(offline_intent_envelope)<=${MAX_STDOUT_BYTES} THEN offline_intent_envelope END AS intent_envelope
        FROM sf_plans WHERE id=${identity.plan_id} AND project_id=${identity.project_id} FOR SHARE`)[0];
      const project=(await tx`SELECT id,archived_at FROM sf_projects WHERE id=${identity.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
      const job=(await tx`SELECT id,organization_id,project_id,plan_id,state,revision,requester_id,approval_reference,intent_digest FROM sf_execution_jobs
        WHERE id=${req.params.id} AND project_id=${identity.project_id} AND plan_id=${identity.plan_id} AND organization_id=${ORG} FOR UPDATE`)[0];
      const row=(await tx`SELECT * FROM sf_execution_reconciliations WHERE id=${req.params.reconciliationId} AND job_id=${req.params.id}
        AND organization_id=${ORG} AND project_id=${identity.project_id} FOR UPDATE`)[0];
      if(!row||!job||!project||!plan)return null;
      const intent=boundPlanIntent(plan,job.project_id);
      if(!intent||intent.digest!==row.intent_digest||job.intent_digest!==row.intent_digest||job.approval_reference!==row.approval_reference
        ||plan.approval_reference!==row.approval_reference)throw responseError('JOB_BINDING_UNAVAILABLE');
      const actor=(await tx`SELECT role FROM sf_local_actors WHERE id=${req.actor.id} AND organization_id=${ORG}`)[0];
      const membership=(await tx`SELECT id FROM sf_project_grants WHERE organization_id=${ORG} AND project_id=${identity.project_id}
        AND actor_id=${req.actor.id} AND revoked_at IS NULL FOR SHARE`)[0];
      if(!membership)return null;
      const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g`)[0];
      if(gate?.state!=='ACTIVE')throw responseError('METADATA_RESTORE_HOLD');
      if(actor?.role!=='approver')throw responseError('APPROVER_REQUIRED',403);
      if(project.archived_at)throw responseError('PROJECT_ARCHIVED');
      if(job.state!=='HOLD')throw responseError('JOB_NOT_ON_HOLD');
      if(String(job.revision)!==String(b.expectedRevision))throw responseError('REVISION_CONFLICT');
      if(req.actor.id===row.submitter_id||req.actor.id===job.requester_id||req.actor.id===plan.author_id)throw responseError('INDEPENDENT_REVIEW_REQUIRED',403);
      if((await tx`SELECT 1 FROM sf_execution_reconciliation_decisions WHERE reconciliation_id=${row.id}`)[0])throw responseError('DECISION_ALREADY_RECORDED');
      const decision=(await tx`INSERT INTO sf_execution_reconciliation_decisions(id,reconciliation_id,job_id,organization_id,project_id,reviewer_id,
        job_revision,decision,reason) VALUES(${randomUUID()},${row.id},${row.job_id},${row.organization_id},${row.project_id},${req.actor.id},
        ${job.revision},${b.decision},${b.reason.trim()}) RETURNING *`)[0];
      await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
        VALUES(${row.project_id},${ORG},${req.actor.id},'EXECUTION_RECONCILIATION_REVIEWED',${row.id},${tx.json({jobId:row.job_id,
          reconciliationId:row.id,decision:b.decision,evidenceDigest:row.evidence_digest,jobRevision:String(job.revision),
          retryEligible:false,executionAuthority:false,targetEffects:'NOT_ATTESTED'})})`;
      return {row,decision};
    });
    if(!result)return reply.code(404).send({error:'NOT_FOUND'});
    return {reconciliation:publicSubmission({...result.row,decision_id:result.decision.id,reviewer_id:result.decision.reviewer_id,
      decision_revision:result.decision.job_revision,decision:result.decision.decision,decision_reason:result.decision.reason,
      decision_created_at:result.decision.created_at}),retryEligible:false,executionAuthority:false};
  });
}
