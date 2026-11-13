WITH priors AS (
 SELECT DISTINCT ON (proof.intent_digest)
  proof.*, job.state,
  job.organization_id AS job_organization_id,job.project_id AS job_project_id,job.plan_id AS job_plan_id,
  job.admission_scope AS job_scope,job.admission_statement_count AS job_admission_statement_count,
  job.intent_digest AS job_intent_digest,job.approval_reference AS job_approval_reference,
  plan.approval_reference AS plan_approval_reference,plan.offline_intent_digest AS plan_intent_digest,
  plan.profile_id AS plan_profile_id,plan.release_id AS plan_release_id,release.manifest_digest AS plan_manifest_digest,
  plan.offline_intent_envelope AS raw_envelope
 FROM sf_execution_admission_proofs proof JOIN sf_execution_jobs job ON job.id=proof.job_id
 JOIN sf_plans plan ON plan.id=proof.plan_id
 JOIN sf_releases release ON release.id=plan.release_id
 WHERE proof.organization_id=$1
  AND (($2::text IS NOT NULL AND proof.host_binding->>'streamId'=$2)
    OR ($2::text IS NULL AND proof.host_binding->>'targetKey'=$3))
  AND (job.state='VERIFIED_SUCCESS' OR job.state='HOLD' AND EXISTS(
    SELECT 1 FROM sf_audit a WHERE a.resource_id=job.id AND a.organization_id=job.organization_id
      AND a.action='EXECUTION_RECOVERED_APPLIED'))
 ORDER BY proof.intent_digest,proof.created_at DESC LIMIT 129
)
SELECT (to_jsonb(priors)-'raw_envelope'-'host_binding') || jsonb_build_object(
 'envelope',CASE WHEN octet_length(raw_envelope)<=4194304
   AND sum(coalesce(octet_length(raw_envelope),0)) OVER()<=8388608 THEN raw_envelope END,
 'host_binding',CASE WHEN octet_length(host_binding::text)<=1048576 THEN host_binding END
) FROM priors
