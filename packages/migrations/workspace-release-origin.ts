/** Public authored-snapshot attribution, separate from a bound-repository import. */
export async function loadWorkspaceReleaseOrigins(sql: any, projectId: string) {
  const rows=await sql`SELECT release_id,draft_id,draft_revision::text,draft_sha256,draft_manifest_version,
    source_binding_generation::text,created_by,created_at FROM sf_sql_workspace_releases WHERE project_id=${projectId}`;
  return new Map(rows.map((row: any)=>[row.release_id,{
    sourceKind:'AUTHORED_SQL_WORKSPACE',draftId:row.draft_id,draftRevision:row.draft_revision,
    draftSha256:row.draft_sha256,draftManifestVersion:row.draft_manifest_version,sourceBindingGeneration:row.source_binding_generation,
    preparedBy:row.created_by,preparedAt:row.created_at,
  }]));
}

export async function loadWorkspaceReleaseOrigin(sql: any, projectId: string, releaseId: string) {
  const row=(await sql`SELECT draft_id,draft_revision::text,draft_sha256,draft_manifest_version,source_binding_generation::text,
    created_by,created_at FROM sf_sql_workspace_releases WHERE project_id=${projectId} AND release_id=${releaseId}`)[0];
  return row ? {sourceKind:'AUTHORED_SQL_WORKSPACE',draftId:row.draft_id,draftRevision:row.draft_revision,
    draftSha256:row.draft_sha256,draftManifestVersion:row.draft_manifest_version,sourceBindingGeneration:row.source_binding_generation,
    preparedBy:row.created_by,preparedAt:row.created_at} : {sourceKind:'GIT_IMPORT'};
}
