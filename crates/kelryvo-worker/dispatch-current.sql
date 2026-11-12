SELECT jsonb_build_object('generation',a.generation,'central_evidence_digest',proof.central_evidence_digest)
FROM sf_execution_jobs j JOIN sf_execution_admission_proofs proof ON proof.job_id=j.id
JOIN sf_execution_attempts a ON a.job_id=j.id
JOIN sf_metadata_current mc ON mc.singleton AND mc.generation_id=$6
JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE'
WHERE j.id=$1 AND j.organization_id=$2 AND j.plan_id=$3 AND j.intent_digest=$4
 AND j.approval_reference=$5 AND j.state='ADMITTED' AND j.admission_scope='TRUSTED_VALIDATED'
 AND proof.scope='TRUSTED_VALIDATED' AND proof.target_assignment_id=$7
 AND proof.target_identity_digest=$8 AND proof.host_binding->>'streamId'=$9
 AND proof.host_binding->>'workerId'=$10
 AND a.state='CLAIMED' AND a.lease_owner=$10 AND a.lease_until>clock_timestamp()
 AND (SELECT count(*) FROM sf_execution_attempt_events e WHERE e.attempt_id=a.id
   AND e.phase='STARTED' AND e.ordinal=$11 AND e.statement_digest=$12)=1
 AND NOT EXISTS(SELECT 1 FROM sf_execution_attempt_events e WHERE e.attempt_id=a.id
   AND e.phase='ACKNOWLEDGED' AND e.ordinal=$11 AND e.statement_digest=$12)
FOR SHARE OF a
