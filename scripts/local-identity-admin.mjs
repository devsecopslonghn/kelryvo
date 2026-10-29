import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { authorizeLocalMetadataUrl } from './local-operator-config.mjs';
import { operateIdentityAdmin } from '../packages/identity/store.ts';

export async function operateLocalIdentityAdmin({ configPath, databaseUrl, action, identity }) {
  if (!['developer', 'approver'].includes(identity) || !['grant', 'revoke'].includes(action)) throw new Error('Invalid identity operation');
  await authorizeLocalMetadataUrl(configPath, databaseUrl);
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try { await operateIdentityAdmin(sql, { action, actorId: `local-${identity}`, operatorUid: process.geteuid?.() ?? process.getuid() }); }
  finally { await sql.end({ timeout: 5 }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, identity, ...extra] = process.argv.slice(2);
    if (extra.length) throw new Error();
    await operateLocalIdentityAdmin({ configPath: process.env.SCHEMAFORGE_LOCAL_CONFIG ?? path.resolve('.cache/local-product/config.json'),
      databaseUrl: process.env.SCHEMAFORGE_LOCAL_DATABASE_URL, action, identity });
    process.stdout.write('Identity configuration capability updated. Application roles and project grants preserved.\n');
  } catch { process.stderr.write('Local identity operation unavailable. Use grant|revoke developer|approver.\n'); process.exitCode = 1; }
}
