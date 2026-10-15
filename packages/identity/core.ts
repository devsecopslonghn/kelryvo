import { randomBytes, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import { hash, verify, Algorithm } from '@node-rs/argon2';
import { LOCAL_ORGANIZATION as ORG, tokenDigest } from '../database/local-credentials.ts';
import { cookieValue, csrf, sessionCookie } from '../database/browser-sessions.ts';

export const identityError = (code: string, statusCode = 400) => Object.assign(new Error(code), {productCode:code,statusCode});
export const validUsername = (v: any) => typeof v === 'string' && /^[a-z0-9][a-z0-9._@-]{0,127}$/.test(v);
export const validPassword = (v: any) => typeof v === 'string' && v.length >= 15 && Buffer.byteLength(v) <= 1024 && !v.includes('\0');
export const passwordHash = (password: string) => hash(password, {algorithm:Algorithm.Argon2id,memoryCost:65536,timeCost:3,parallelism:1});
export const passwordMatches = async (digest: string, password: string) => {
  try { return await verify(digest,password); } catch { return false; }
};
export const auditIdentity = (tx: any, actor: string | null, action: string, subject: string | null = null, facts: any = {}) =>
  tx`INSERT INTO sf_identity_audit(actor_id,action,subject_id,facts) VALUES(${actor},${action},${subject},${tx.json(facts)})`;
export const lockIdentity = (tx: any) => tx`SELECT pg_advisory_xact_lock(1397112658,2)`;
export async function actorIdentity(sql: any, actor: any) {
  const row = (await sql`SELECT u.username,u.workspace_role,u.must_change_password,a.disabled
    FROM sf_local_actors a LEFT JOIN sf_identity_users u ON u.actor_id=a.id WHERE a.id=${actor.id}`)[0];
  if (!row || row.disabled) return null;
  return {...actor, username:row.username ?? undefined, workspaceRole:row.workspace_role ?? 'member', mustChangePassword:!!row.must_change_password};
}

/** Credentials never enter logs, stdout, environment variables or API responses. */
export async function privatePasswordFile(filename: string, create = true) {
  if (!isAbsolute(filename)) throw identityError('PRIVATE_PASSWORD_FILE_REQUIRED');
  await mkdir(dirname(filename), {recursive:true,mode:0o700});
  let file, created = false;
  try { file = await open(filename,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600); created = true; }
  catch (error: any) { if (error.code !== 'EEXIST' || !create) throw error; file = await open(filename,constants.O_RDONLY|constants.O_NOFOLLOW); }
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== (process.geteuid?.() ?? process.getuid?.() ?? 0) || (stat.mode & 0o777) !== 0o600 || stat.size > 4096)
      throw identityError('PRIVATE_PASSWORD_FILE_REQUIRED');
    if (created) {
      const password = randomBytes(32).toString('base64url');
      await file.writeFile(JSON.stringify({username:'admin',password})+'\n'); await file.sync();
      return password;
    }
    const saved = JSON.parse(await file.readFile('utf8'));
    if (saved.username !== 'admin' || !validPassword(saved.password)) throw identityError('PRIVATE_PASSWORD_FILE_REQUIRED');
    return saved.password;
  } finally { await file.close(); }
}

export async function bootstrapAdministrator(sql: any, passwordFile: string) {
  await sql.begin(async (tx: any) => {
    await lockIdentity(tx);
    if ((await tx`SELECT 1 FROM sf_identity_users WHERE workspace_role='admin' LIMIT 1`)[0]) return;
    if ((await tx`SELECT 1 FROM sf_identity_users WHERE username='admin'`)[0]) throw identityError('ADMIN_RECOVERY_REQUIRED');
    const password = await privatePasswordFile(passwordFile);
    const id = `user:${randomUUID()}`;
    await tx`INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES(${id},${ORG},'developer','Administrator')`;
    await tx`INSERT INTO sf_identity_users(actor_id,username,workspace_role,password_hash,must_change_password)
      VALUES(${id},'admin','admin',${await passwordHash(password)},true)`;
    await tx`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=${(process.geteuid?.() ?? process.getuid?.() ?? 0)}
      WHERE organization_id=${ORG} AND mode='BOOTSTRAP_REQUIRED'`;
    await auditIdentity(tx,null,'ADMIN_BOOTSTRAPPED',id);
  });
}

export async function revokeActorSessions(tx: any, actorId: string) {
  await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=${actorId} AND revoked_at IS NULL`;
}

/** Password and provider sessions share the established parent/child expiry and revocation chain.
 * The unexposed parent is deliberately ineligible for bearer authentication. */
export async function issueIdentitySession(tx: any, req: any, actor: any, method: string, providerId: string | null = null) {
  const parentToken = randomBytes(32).toString('hex'), token = randomBytes(32).toString('hex');
  const old = cookieValue(req);
  if (old) await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp()
    WHERE token_sha256=${tokenDigest(old)} AND credential_kind='BROWSER' AND revoked_at IS NULL`;
  const parent = (await tx`WITH issued AS (SELECT clock_timestamp() ts)
    INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,auth_method,identity_provider_id)
    SELECT ${actor.id},${tokenDigest(parentToken)},ts,ts+interval '24 hours',${method},${providerId} FROM issued RETURNING id`)[0];
  const child = (await tx`WITH issued AS (SELECT clock_timestamp() ts)
    INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,absolute_expires_at,credential_kind,parent_credential_id,auth_method,identity_provider_id)
    SELECT ${actor.id},${tokenDigest(token)},ts,ts+interval '30 minutes',ts+interval '8 hours','BROWSER',${parent.id},${method},${providerId}
    FROM issued RETURNING absolute_expires_at`)[0];
  await auditIdentity(tx,actor.id,'LOGIN_SUCCEEDED',actor.id,{method,providerId});
  return {cookie:sessionCookie(token),data:{actor,csrfToken:csrf(token),absoluteExpiresAt:child.absolute_expires_at,idleTimeoutSeconds:1800}};
}

/** Existing operator-owned grants are retained; only identity-managed projections are replaced.
 * All callers hold the governance lock, shared with API/worker authority checkpoints. */
export async function synchronizeAccess(tx: any) {
  await tx`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=0 WHERE identity_managed AND revoked_at IS NULL`;
  await tx`UPDATE sf_project_deploy_grants SET revoked_at=clock_timestamp(),revoke_os_uid=0 WHERE identity_managed AND revoked_at IS NULL`;
  await tx.unsafe(`
    WITH effective AS (
      SELECT DISTINCT a.project_id,u.actor_id FROM sf_identity_assignments a JOIN sf_identity_users u
      ON (a.subject_type='USER' AND a.subject_id=u.actor_id) OR (a.subject_type='GROUP' AND EXISTS(
        SELECT 1 FROM sf_identity_group_members m WHERE m.group_id::text=a.subject_id AND m.actor_id=u.actor_id))
    ) INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid,identity_managed)
      SELECT p.organization_id,e.project_id,e.actor_id,0,true FROM effective e JOIN sf_projects p ON p.id=e.project_id
      ON CONFLICT(project_id,actor_id) WHERE revoked_at IS NULL DO NOTHING;
    WITH effective AS (
      SELECT DISTINCT a.project_id,u.actor_id FROM sf_identity_assignments a JOIN sf_identity_users u
      ON (a.subject_type='USER' AND a.subject_id=u.actor_id) OR (a.subject_type='GROUP' AND EXISTS(
        SELECT 1 FROM sf_identity_group_members m WHERE m.group_id::text=a.subject_id AND m.actor_id=u.actor_id))
      WHERE a.role IN ('deployer','owner')
    ) INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid,identity_managed)
      SELECT p.organization_id,e.project_id,e.actor_id,0,true FROM effective e JOIN sf_projects p ON p.id=e.project_id
      ON CONFLICT(project_id,actor_id) WHERE revoked_at IS NULL DO NOTHING;
  `);
}

export async function projectRoles(sql: any, actorId: string, projectId: string): Promise<string[] | null> {
  if (!(await sql`SELECT 1 FROM sf_identity_users WHERE actor_id=${actorId}`)[0]) return null;
  return (await sql`SELECT DISTINCT a.role FROM sf_identity_assignments a WHERE a.project_id=${projectId}
    AND ((a.subject_type='USER' AND a.subject_id=${actorId}) OR (a.subject_type='GROUP' AND EXISTS(
      SELECT 1 FROM sf_identity_group_members m WHERE m.actor_id=${actorId} AND m.group_id::text=a.subject_id)))`).map((r: any)=>r.role);
}
