import path from 'node:path';
import postgres from 'postgres';
import { initializeDatabase } from '../packages/database/index.ts';
import { authorizeLocalMetadataUrl } from './local-operator-config.mjs';

const ORG = '00000000-0000-4000-8000-000000000001';
const fail = () => new Error('Local membership operation failed; inspect private local state and retry.');
const uid = () => process.geteuid?.() ?? process.getuid();
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export async function applyLocalMembershipAction(sql, { action, projectId, actorId }) {
  if (['grant','revoke'].includes(action)) {
    await sql.begin(async tx => {
      await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR SHARE`;
      const project = (await tx`SELECT id FROM sf_projects WHERE id=${projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
      const actor = (await tx`SELECT id FROM sf_local_actors WHERE id=${actorId} AND organization_id=${ORG} AND role IN ('developer','approver') FOR UPDATE`)[0];
      if (!project || !actor) throw fail();
      if (action === 'grant') {
        const current = (await tx`SELECT id FROM sf_project_grants WHERE project_id=${projectId} AND actor_id=${actorId} AND revoked_at IS NULL FOR UPDATE`)[0];
        if (!current) {
          await tx`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${ORG},${projectId},${actorId},${uid()})`;
          await tx`INSERT INTO sf_project_operator_audit(organization_id,project_id,actor_id,action,operator_os_uid,facts) VALUES(${ORG},${projectId},${actorId},'GRANT',${uid()},'{}'::jsonb)`;
        }
      } else {
        const current = (await tx`SELECT id FROM sf_project_grants WHERE project_id=${projectId} AND actor_id=${actorId} AND revoked_at IS NULL FOR UPDATE`)[0];
        if (current) {
          await tx`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=${uid()} WHERE id=${current.id}`;
          await tx`INSERT INTO sf_project_operator_audit(organization_id,project_id,actor_id,action,operator_os_uid,facts) VALUES(${ORG},${projectId},${actorId},'REVOKE',${uid()},'{}'::jsonb)`;
        }
      }
    });
    return `${action} complete`;
  }
  if (action === 'activate') {
    await sql.begin(async tx => {
      // Share T20's credential lifecycle serialization point before acquiring
      // membership locks so seeding/rotation cannot race the usable-coverage check.
      await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
      const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG} FOR UPDATE`)[0]?.mode;
      if (mode !== 'BOOTSTRAP_REQUIRED') throw fail();
      await tx`SELECT id FROM sf_projects WHERE organization_id=${ORG} ORDER BY id FOR UPDATE`;
      await tx`SELECT id FROM sf_local_actors WHERE organization_id=${ORG} ORDER BY id FOR UPDATE`;
      await tx`SELECT id FROM sf_local_credentials WHERE actor_id IN (
        SELECT id FROM sf_local_actors WHERE organization_id=${ORG}) ORDER BY actor_id,token_sha256 FOR UPDATE`;
      const uncovered = await tx`SELECT p.id FROM sf_projects p WHERE p.organization_id=${ORG} AND NOT EXISTS (
        SELECT 1 FROM sf_project_grants g JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id
        JOIN sf_local_credentials c ON c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
        WHERE g.project_id=p.id AND g.organization_id=p.organization_id AND g.revoked_at IS NULL
          AND a.role IN ('developer','approver')) ORDER BY p.id`;
      if (uncovered.length) throw fail();
      const projectCount = Number((await tx`SELECT count(*)::int AS count FROM sf_projects WHERE organization_id=${ORG}`)[0].count);
      await tx`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=${uid()} WHERE organization_id=${ORG}`;
      await tx`INSERT INTO sf_project_operator_audit(organization_id,action,operator_os_uid,facts) VALUES(${ORG},'ACTIVATE',${uid()},${tx.json({ projectCount })})`;
    });
    return 'ENFORCED';
  }
  throw fail();
}

async function operate({ action, projectId, actorId, configPath, databaseUrl }) {
  if (!databaseUrl || !configPath) throw fail();
  await authorizeLocalMetadataUrl(configPath, databaseUrl);
  if (['grant','revoke'].includes(action) && (!uuid(projectId) || typeof actorId !== 'string' || actorId.trim().length < 1
      || actorId.length > 200 || /[\u0000-\u001f\u007f]/.test(actorId) || Buffer.from(actorId, 'utf8').toString('utf8') !== actorId)) throw fail();
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await initializeDatabase(sql);
    if (action === 'status') {
      const mode = (await sql`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG}`)[0]?.mode;
      const projects = await sql`SELECT p.id,p.name,p.archived_at,
          count(DISTINCT g.actor_id) FILTER (WHERE g.revoked_at IS NULL AND a.role IN ('developer','approver') AND c.actor_id IS NOT NULL)::int AS usable_grants
        FROM sf_projects p LEFT JOIN sf_project_grants g ON g.project_id=p.id AND g.organization_id=p.organization_id
        LEFT JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id
        LEFT JOIN sf_local_credentials c ON c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
        WHERE p.organization_id=${ORG} GROUP BY p.id ORDER BY p.created_at,p.id`;
      const actors = await sql`SELECT a.id,a.display_name AS name,a.role,
          array_agg(g.project_id ORDER BY g.project_id) FILTER (WHERE g.id IS NOT NULL AND g.revoked_at IS NULL) AS project_ids
        FROM sf_local_actors a LEFT JOIN sf_project_grants g ON g.actor_id=a.id AND g.organization_id=a.organization_id
        WHERE a.organization_id=${ORG} AND a.role IN ('developer','approver') GROUP BY a.id ORDER BY a.id`;
      process.stdout.write(`${JSON.stringify({ organizationId: ORG, mode,
        readyToActivate: mode === 'ENFORCED' || projects.every(project => project.usable_grants > 0), projects, actors }, null, 2)}\n`);
      return;
    }
    const output = await applyLocalMembershipAction(sql, { action, projectId, actorId });
    process.stdout.write(`${output}\n`);
    return;
  } finally { await sql.end({ timeout: 2 }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const [, , action, ...args] = process.argv;
  try {
    const expected = ['grant','revoke'].includes(action) ? 3 : 1;
    if (!['status','activate','grant','revoke'].includes(action) || args.length !== expected || args.some(value => !value)) throw fail();
    const [projectId, actorId, configPath] = ['grant','revoke'].includes(action) ? args : [undefined, undefined, args[0]];
    await operate({ action, projectId, actorId, configPath, databaseUrl: process.env.SCHEMAFORGE_LOCAL_DATABASE_URL });
  } catch { process.stderr.write('Local membership operation failed.\n'); process.exitCode = 1; }
}

export { operate as operateLocalMembership };
