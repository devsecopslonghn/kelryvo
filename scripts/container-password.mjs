import postgres from 'postgres';
import { containerDatabaseUrl } from '../packages/runtime/container-config.mjs';
import { operatePassword } from '../packages/database/password-auth.ts';

try {
  const [action, identity, ...extra] = process.argv.slice(2);
  if (process.geteuid?.() !== 0 || extra.length || !['reset','disable'].includes(action)
    || !['developer','approver'].includes(identity)) throw new Error();
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > 2048) throw new Error();
  }
  const body = action === 'reset' ? JSON.parse(input) : {};
  if (action === 'reset' && Object.keys(body).sort().join(',') !== 'password,username' || action === 'disable' && input.trim()) throw new Error();
  const sql = postgres(await containerDatabaseUrl(process.env.KELRYVO_SECRET_DIR ?? '/run/kelryvo/secrets'),
    { max: 1, connect_timeout: 5, onnotice: () => {} });
  try { await operatePassword(sql, { action, actorId: `kelryvo-${identity}`, ...body, operatorUid: process.geteuid() }); }
  finally { await sql.end({ timeout: 5 }); }
  process.stdout.write('Password account updated; prior browser sessions revoked. Roles and project grants preserved.\n');
} catch {
  process.stderr.write('Password operation unavailable. Use reset|disable developer|approver; reset reads private JSON {username,password} from stdin.\n');
  process.exitCode = 1;
}
