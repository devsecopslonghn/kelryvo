import { randomBytes } from 'node:crypto';
import { LOCAL_ORGANIZATION as ORG, tokenDigest } from '../database/local-credentials.ts';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
export const identityError=(code:string)=>Object.assign(new Error(code),{productCode:code});
export async function activeIdentityMetadata(tx:any){const row=(await tx`SELECT g.id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE' FOR SHARE OF c,g`)[0];if(!row)throw identityError('AUTH_UNAVAILABLE');return row.id;}
export async function canManageIdentity(sql:any,actorId:string){return !!(await sql`SELECT 1 FROM sf_identity_admin_grants g JOIN sf_local_actors a ON a.id=g.actor_id WHERE g.actor_id=${actorId} AND g.revoked_at IS NULL AND a.organization_id=${ORG}`)[0];}
export async function guardIdentityAdmin(tx:any,req:any){await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;await guardMutationAuthority(tx,req);await activeIdentityMetadata(tx);if(!await canManageIdentity(tx,req.actor.id))throw identityError('IDENTITY_ADMIN_REQUIRED');}
export async function operateIdentityAdmin(sql:any,{action,actorId,operatorUid}:any){
  if(!['grant','revoke'].includes(action)||typeof actorId!=='string'||!Number.isInteger(operatorUid)||operatorUid<0)throw identityError('AUTH_UNAVAILABLE');
  await sql.begin(async(tx:any)=>{await tx`SELECT pg_advisory_xact_lock(1397112658,2)`;await activeIdentityMetadata(tx);
    if(!(await tx`SELECT 1 FROM sf_local_actors WHERE id=${actorId} AND organization_id=${ORG} AND role IN ('developer','approver')`)[0])throw identityError('AUTH_UNAVAILABLE');
    const prior=(await tx`SELECT id FROM sf_identity_admin_grants WHERE actor_id=${actorId} AND revoked_at IS NULL`)[0];
    if(action==='grant'&&!prior)await tx`INSERT INTO sf_identity_admin_grants(actor_id,grant_os_uid) VALUES(${actorId},${operatorUid})`;
    if(action==='revoke'&&prior)await tx`UPDATE sf_identity_admin_grants SET revoked_at=clock_timestamp(),revoke_os_uid=${operatorUid} WHERE id=${prior.id}`;
    if(action==='grant'&&!prior||action==='revoke'&&prior)await tx`INSERT INTO sf_identity_audit(actor_id,action,operator_os_uid) VALUES(${actorId},${action==='grant'?'ADMIN_GRANTED':'ADMIN_REVOKED'},${operatorUid})`;
  });
}
export async function revokeExternalSessions(tx:any,providerId:string,mappingId:string|null=null){
  const roots=await tx`SELECT credential_id FROM sf_external_session_roots WHERE provider_id=${providerId} AND (${mappingId}::uuid IS NULL OR mapping_id=${mappingId})`;
  if(!roots.length)return;
  const ids=roots.map((r:any)=>r.credential_id);
  await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND (id=ANY(${ids}) OR parent_credential_id=ANY(${ids}))`;
}
export async function issueExternalParent(tx:any,provider:any,subject:string){
  const generation=await activeIdentityMetadata(tx);
  const current=(await tx`SELECT p.id FROM sf_identity_providers p WHERE p.id=${provider.id} AND p.revision=${provider.revision} AND p.enabled`)[0];if(!current)return null;
  const m=(await tx`SELECT m.id,m.actor_id,a.display_name AS name,a.role FROM sf_external_identities m JOIN sf_local_actors a ON a.id=m.actor_id
    JOIN sf_local_credentials c ON c.id=m.anchor_credential_id AND c.actor_id=m.actor_id AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL
    WHERE m.provider_id=${provider.id} AND m.subject=${subject} AND m.revoked_at IS NULL AND a.organization_id=${ORG} AND a.role IN ('developer','approver')`)[0];if(!m)return null;
  const root=(await tx`WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind)
    SELECT ${m.actor_id},${tokenDigest(randomBytes(32).toString('hex'))},ts,ts+interval '24 hours','EXTERNAL' FROM issued RETURNING id,expires_at`)[0];
  await tx`INSERT INTO sf_external_session_roots(credential_id,actor_id,provider_id,provider_revision,mapping_id,generation_id) VALUES(${root.id},${m.actor_id},${provider.id},${provider.revision},${m.id},${generation})`;
  return {...root,actor_id:m.actor_id,name:m.name,role:m.role};
}
