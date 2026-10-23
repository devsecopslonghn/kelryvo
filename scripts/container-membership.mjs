import postgres from 'postgres';
import { containerDatabaseUrl } from '../packages/runtime/container-config.mjs';
import { applyLocalMembershipAction } from './local-membership-operator.mjs';

// Trusted pod/OS operator only; there is no HTTP route or automatic startup grant.
try {
  const [action, projectId, actorId, ...extra] = process.argv.slice(2);
  const databaseAction = ['database-grant', 'database-revoke'].includes(action);
  if (extra.length || !['activate', 'grant', 'revoke', 'deploy-grant', 'deploy-revoke', 'database-grant', 'database-revoke'].includes(action)
      || (action === 'activate' ? projectId || actorId
        : databaseAction ? projectId !== 'kelryvo-developer' || actorId
        : !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(projectId ?? '')
          || !['kelryvo-developer', 'kelryvo-approver'].includes(actorId))) throw new Error();
  const sql = postgres(await containerDatabaseUrl(process.env.KELRYVO_SECRET_DIR ?? '/run/kelryvo/secrets'),
    { max: 1, connect_timeout: 5, onnotice: () => {} });
  try { await applyLocalMembershipAction(sql, databaseAction ? { action, actorId: projectId } : { action, projectId, actorId }); }
  finally { await sql.end({ timeout: 5 }); }
  process.stdout.write('Membership operation complete; retained operator audit recorded.\n');
} catch { process.stderr.write('Membership operation unavailable; inspect private metadata.\n'); process.exitCode = 1; }
