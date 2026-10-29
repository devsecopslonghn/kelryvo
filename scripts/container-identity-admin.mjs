import postgres from 'postgres';
import { containerDatabaseUrl } from '../packages/runtime/container-config.mjs';
import { operateIdentityAdmin } from '../packages/identity/store.ts';

try {
  const [action, identity, ...extra] = process.argv.slice(2);
  if (process.geteuid?.() !== 0 || extra.length || !['grant', 'revoke'].includes(action)
      || !['developer', 'approver'].includes(identity)) throw new Error();
  const sql = postgres(await containerDatabaseUrl(process.env.KELRYVO_SECRET_DIR ?? '/run/kelryvo/secrets'),
    { max: 1, connect_timeout: 5, onnotice: () => {} });
  try { await operateIdentityAdmin(sql, { action, actorId: `kelryvo-${identity}`, operatorUid: process.geteuid() }); }
  finally { await sql.end({ timeout: 5 }); }
  process.stdout.write('Identity configuration capability updated. Application roles and project grants preserved.\n');
} catch {
  process.stderr.write('Identity operation unavailable. Use grant|revoke developer|approver as the trusted container operator.\n');
  process.exitCode = 1;
}
