INSERT INTO sf_target_option_revisions(
 option_id,revision,organization_id,project_id,assignment_id,schema_id,container_id,
 profile_id,profile_name,environment_id,profile_host,profile_port,profile_service,
 profile_username,profile_credential_ref,profile_revision,route_id,route_config_revision,
 route_alias,route_host,route_port,route_service,lineage_id,identity_state,
 observation_digest,observed_at,stream_id,stream_state,migration_namespace,policy_id,
 policy_revision,exact_owner,deployment_principal_id,principal_purpose,
 private_principal_ref,principal_alias,operator_os_uid,reason)
SELECT ($1->>'optionId')::uuid,$2,$3,p.project_id,($1->>'assignmentId')::uuid,
 s.id,s.container_id,p.id,p.name,p.environment_id,p.host,p.port,p.service,
 p.username,p.credential_ref,p.revision,r.id,($1->>'routeConfigRevision')::bigint,
 $1->>'routeAlias',r.host,r.port,r.service,$6,'PROVISIONAL',NULL,NULL,$5,'PROVISIONAL',
 $1->>'migrationNamespace',($1->>'policyId')::uuid,($1->>'policyRevision')::bigint,
 s.exact_owner,($1->>'deploymentPrincipalId')::uuid,'DEPLOY',
 $1->>'privatePrincipalRef',$1->>'principalAlias',$7,$1->>'reason'
FROM sf_profiles p JOIN sf_reference_services r ON r.id=($1->>'routeId')::uuid
 JOIN sf_reference_schemas s ON s.id=$4
WHERE p.id=($1->>'profileId')::uuid AND p.project_id=($1->>'projectId')::uuid
RETURNING to_jsonb(sf_target_option_revisions)
