SELECT CASE WHEN octet_length(snapshot::text)<=8388608 THEN snapshot END FROM (
 SELECT jsonb_build_object('id',id,'projectId',project_id,'organizationId',organization_id,
  'releaseId',release_id,'profileId',profile_id,'authorId',author_id,'status',status,'decision',decision,
  'decisionReason',decision_reason,'decidedBy',decided_by,'decidedByName',decided_by_name,
  'createdAt',created_at,'decidedAt',decided_at,'approvalReference',approval_reference,
  'sourceBindingGeneration',source_binding_generation::text,'items',items,
  'envelope',offline_intent_envelope,'digest',offline_intent_digest) AS snapshot
 FROM sf_plans WHERE id=$1 AND project_id=$2 AND organization_id=$3
) p
