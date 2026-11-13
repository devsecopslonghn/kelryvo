SELECT jsonb_build_object(
 'job_organization_id',job.organization_id,'job_project_id',job.project_id,'job_plan_id',job.plan_id,
 'job_scope',job.admission_scope,'job_admission_statement_count',job.admission_statement_count,
 'job_approval_reference',job.approval_reference,'job_intent_digest',job.intent_digest,
 'organization_id',proof.organization_id,'project_id',proof.project_id,'plan_id',proof.plan_id,
 'scope',proof.scope,'approval_reference',proof.approval_reference,'intent_digest',proof.intent_digest,
 'source_manifest_digest',proof.source_manifest_digest,'profile_id',proof.profile_id,'host_binding',CASE WHEN octet_length(proof.host_binding::text)<=4194304 THEN proof.host_binding END,
 'plan_profile_id',plan.profile_id,'plan_approval_reference',plan.approval_reference,
 'plan_intent_digest',plan.offline_intent_digest,'plan_release_id',plan.release_id,'plan_manifest_digest',release.manifest_digest,
 'envelope',CASE WHEN octet_length(plan.offline_intent_envelope)<=4194304 THEN plan.offline_intent_envelope END
)
FROM sf_execution_jobs job JOIN sf_execution_admission_proofs proof ON proof.job_id=job.id
JOIN sf_plans plan ON plan.id=job.plan_id AND plan.project_id=job.project_id
JOIN sf_releases release ON release.id=plan.release_id AND release.project_id=plan.project_id
WHERE job.id=$1 AND job.organization_id=$2 AND proof.organization_id=job.organization_id
 AND proof.project_id=job.project_id AND proof.plan_id=job.plan_id LIMIT 1
