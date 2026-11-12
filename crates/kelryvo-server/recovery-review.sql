SELECT jsonb_build_object('id',s.id,'decision_id',d.id)
FROM sf_execution_reconciliations s JOIN sf_execution_reconciliation_decisions d ON d.reconciliation_id=s.id
JOIN sf_local_actors reviewer ON reviewer.id=d.reviewer_id AND reviewer.organization_id=s.organization_id AND reviewer.role='approver'
JOIN sf_project_grants member ON member.project_id=s.project_id AND member.organization_id=s.organization_id
 AND member.actor_id=reviewer.id AND member.revoked_at IS NULL
JOIN sf_project_grants submitter ON submitter.project_id=s.project_id AND submitter.organization_id=s.organization_id
 AND submitter.actor_id=s.submitter_id AND submitter.revoked_at IS NULL
JOIN sf_plans plan ON plan.id=s.plan_id AND plan.project_id=s.project_id
JOIN sf_execution_jobs job ON job.id=s.job_id
WHERE s.id=$1 AND s.job_id=$2 AND s.organization_id=$3 AND s.project_id=$4
AND s.plan_id=$5 AND s.job_revision::text=$6 AND d.job_revision=s.job_revision
AND s.approval_reference=$7 AND s.intent_digest=$8 AND s.admission_scope=$9
AND s.target_identity_digest=$10 AND s.evidence_kind='TARGET_LEDGER'
AND s.evidence_digest=$11 AND d.decision='EVIDENCE_REVIEWED'
AND reviewer.id<>s.submitter_id AND reviewer.id<>job.requester_id AND reviewer.id<>plan.author_id LIMIT 2
