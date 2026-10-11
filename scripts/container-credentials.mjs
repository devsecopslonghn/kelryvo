import postgres from 'postgres';
import { containerDatabaseUrl, readContainerSecret } from '../packages/runtime/container-config.mjs';
import { rotateContainerActorCredential } from '../packages/database/container-credentials.ts';

try {
  const [action, identity, ...extra] = process.argv.slice(2);
  if (extra.length || action !== 'rotate' || !['developer', 'approver'].includes(identity)) throw new Error();
  const root = process.env.KELRYVO_SECRET_DIR ?? '/run/kelryvo/secrets';
  const token = (await readContainerSecret(root, `${identity}-token`)).toString('utf8').trim();
  const sql = postgres(await containerDatabaseUrl(root), { max: 1, connect_timeout: 5, onnotice: () => {} });
  let result;
  try { result = await rotateContainerActorCredential(sql, { identity, token }); }
  finally { await sql.end({ timeout: 5 }); }
  process.stdout.write(result === 'ROTATED' ? 'Credential rotated; previous authority retired and audited.\n'
    : 'Credential already active; expiry unchanged.\n');
} catch { process.stderr.write('Credential operation unavailable; inspect private desired Secret and metadata.\n'); process.exitCode = 1; }
