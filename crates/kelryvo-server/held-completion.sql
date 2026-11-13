SELECT jsonb_build_object(
 'job_id',proof.job_id,'organization_id',proof.organization_id,'project_id',proof.project_id,'plan_id',proof.plan_id,
 'scope',proof.scope,'approval_reference',proof.approval_reference,'intent_digest',proof.intent_digest,
 'source_manifest_digest',proof.source_manifest_digest,'profile_id',proof.profile_id,
 'target_assignment_id',proof.target_assignment_id,'target_identity_digest',proof.target_identity_digest,
 'history_snapshot_digest',proof.history_snapshot_digest,'mutex_authority_digest',proof.mutex_authority_digest,
 'validity_digest',proof.validity_digest,'central_evidence_digest',proof.central_evidence_digest,'host_binding',proof.host_binding,
 'state',job.state,'job_revision',job.revision::text,
 'job_organization_id',job.organization_id,'job_project_id',job.project_id,'job_plan_id',job.plan_id,
 'job_scope',job.admission_scope,'job_admission_statement_count',job.admission_statement_count,
 'job_intent_digest',job.intent_digest,'job_approval_reference',job.approval_reference,
 'plan_approval_reference',plan.approval_reference,'plan_intent_digest',plan.offline_intent_digest,
 'plan_profile_id',plan.profile_id,'plan_release_id',plan.release_id,'plan_manifest_digest',release.manifest_digest,
 'envelope',CASE WHEN octet_length(plan.offline_intent_envelope)<=4194304 THEN plan.offline_intent_envelope END
)
FROM sf_execution_jobs job JOIN sf_execution_admission_proofs proof ON proof.job_id=job.id
JOIN sf_plans plan ON plan.id=job.plan_id AND plan.project_id=job.project_id
JOIN sf_projects project ON project.id=job.project_id AND project.organization_id=job.organization_id
JOIN sf_releases release ON release.id=plan.release_id AND release.project_id=plan.project_id
WHERE job.id=$1 AND job.organization_id=$2 AND job.state='HOLD'
AND project.archived_at IS NULL AND plan.status='APPROVED' AND plan.decision='APPROVE'
AND NOT EXISTS(SELECT 1 FROM sf_plan_approval_revocations rv WHERE rv.plan_id=plan.id)
