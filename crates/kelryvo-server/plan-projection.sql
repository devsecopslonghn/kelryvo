SELECT jsonb_build_object(
  'id',p.id,'organization_id',p.organization_id,'project_id',p.project_id,
  'release_id',p.release_id,'profile_id',p.profile_id,'author_id',p.author_id,
  'reviewer_id',p.reviewer_id,'reviewer_name',a.display_name,'reviewer_revision',p.reviewer_revision::text,
  'status',p.status,'decision',p.decision,'decision_reason',p.decision_reason,
  'decided_by',p.decided_by,'decided_by_name',p.decided_by_name,
  'created_at',p.created_at,'decided_at',p.decided_at,'approval_reference',p.approval_reference,
  'items',CASE WHEN jsonb_typeof(p.items)='array' THEN CASE WHEN jsonb_array_length(p.items) BETWEEN 1 AND 128
    AND octet_length(p.items::text)<=4194304 THEN p.items END END,
  'execution',p.execution,'history_status',p.history_status,'planning_scope',p.planning_scope,
  'offline_intent_envelope',CASE WHEN octet_length(p.offline_intent_envelope)<=4194304 THEN p.offline_intent_envelope END,
  'offline_intent_digest',CASE WHEN length(p.offline_intent_digest)=64 THEN p.offline_intent_digest END,
  'source_binding_generation',p.source_binding_generation::text,
  'revocation',(SELECT jsonb_build_object('id',r.id,'approvalReference',r.approval_reference,'actorId',r.actor_id,
    'actorName',r.actor_name,'reason',r.reason,'createdAt',r.created_at)
    FROM sf_plan_approval_revocations r WHERE r.plan_id=p.id AND r.organization_id=p.organization_id)
) FROM sf_plans p LEFT JOIN sf_local_actors a ON a.id=p.reviewer_id AND a.organization_id=p.organization_id
