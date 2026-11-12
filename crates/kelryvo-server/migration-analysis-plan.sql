SELECT to_jsonb(snapshot) FROM (
SELECT p.id,p.project_id,p.organization_id,p.release_id,p.profile_id,p.author_id,p.status,p.decision,
          p.offline_intent_digest,p.source_binding_generation::text AS source_binding_generation,p.history_status,p.execution,
          CASE WHEN octet_length(p.offline_intent_envelope)<=4194304 THEN p.offline_intent_envelope END AS envelope,
          CASE WHEN jsonb_typeof(p.items)='array' AND octet_length(p.items::text)<=4194304 THEN p.items END AS items,
          pr.archived_at,pr.source_repository_id,pr.source_folder,pr.source_binding_generation::text AS project_source_generation,
          r.id AS release_id,r.repository_id,r.commit_id,r.object_format,r.folder,r.manifest_digest,r.validation_status,r.parser_profile,
          CASE WHEN octet_length(r.files::text)<=125960192 THEN r.files END AS files
          FROM sf_plans p JOIN sf_projects pr ON pr.id=p.project_id AND pr.organization_id=p.organization_id
          JOIN sf_releases r ON r.id=p.release_id AND r.project_id=p.project_id AND r.organization_id=p.organization_id
          WHERE p.id=$1 AND p.project_id=$2 AND p.organization_id=$3
) snapshot
