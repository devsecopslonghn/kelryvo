SELECT to_jsonb(snapshot) FROM (
SELECT proof.job_id,proof.organization_id,proof.project_id,proof.plan_id,proof.scope,
            proof.approval_reference,proof.intent_digest,proof.source_manifest_digest,proof.profile_id,proof.target_identity_digest,
            proof.host_binding,proof.history_snapshot_digest,proof.mutex_authority_digest,proof.validity_digest,proof.central_evidence_digest,
            job.organization_id AS job_organization_id,job.project_id AS job_project_id,job.plan_id AS job_plan_id,
            job.state,job.admission_scope AS job_scope,job.admission_statement_count AS job_admission_statement_count,
            job.intent_digest AS job_intent_digest,job.approval_reference AS job_approval_reference,
            plan.approval_reference AS plan_approval_reference,plan.offline_intent_digest AS plan_intent_digest,
            plan.release_id AS plan_release_id,plan.profile_id AS plan_profile_id,release.manifest_digest AS plan_manifest_digest,
            CASE WHEN octet_length(plan.offline_intent_envelope)<=4194304 THEN plan.offline_intent_envelope END AS envelope
            FROM sf_execution_admission_proofs proof JOIN sf_execution_jobs job ON job.id=proof.job_id
            JOIN sf_plans plan ON plan.id=proof.plan_id AND plan.project_id=proof.project_id
            JOIN sf_releases release ON release.id=plan.release_id AND release.project_id=plan.project_id
            WHERE proof.organization_id=$1 AND proof.host_binding->>'streamId'=$2
            ORDER BY proof.created_at DESC,proof.job_id DESC LIMIT 201
) snapshot
