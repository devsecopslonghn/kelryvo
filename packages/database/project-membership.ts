export const LOCAL_ORGANIZATION = '00000000-0000-4000-8000-000000000001';

export async function projectAccessMode(sql: any): Promise<string> {
  const row = (await sql`SELECT mode FROM sf_project_access_mode WHERE organization_id=${LOCAL_ORGANIZATION}`)[0];
  return row?.mode ?? 'BOOTSTRAP_REQUIRED';
}

export async function actorHasProjectGrant(sql: any, actorId: string, projectId: string): Promise<boolean> {
  return !!(await sql`SELECT 1 FROM sf_project_grants g
    JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id
    JOIN sf_local_credentials c ON c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at > clock_timestamp()
    WHERE g.organization_id=${LOCAL_ORGANIZATION} AND g.project_id=${projectId} AND g.actor_id=${actorId}
      AND g.revoked_at IS NULL AND a.role IN ('developer','approver') LIMIT 1`)[0];
}
