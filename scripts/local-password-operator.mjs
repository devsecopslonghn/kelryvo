import path from 'node:path';
import { pathToFileURL } from 'node:url';
import postgres from 'postgres';
import { authorizeLocalMetadataUrl } from './local-operator-config.mjs';
import { operatePassword } from '../packages/database/password-auth.ts';

export async function operateLocalPassword({ configPath, databaseUrl, action, identity, username, password }) {
  if (!['developer','approver'].includes(identity) || !['reset','disable'].includes(action)) throw new Error('Invalid password operation');
  await authorizeLocalMetadataUrl(configPath,databaseUrl);
  const sql=postgres(databaseUrl,{max:1,connect_timeout:5,onnotice:()=>{}});
  try { await operatePassword(sql,{action,actorId:`local-${identity}`,username,password,operatorUid:process.geteuid?.()??process.getuid()}); }
  finally { await sql.end({timeout:5}); }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [action,identity,...extra]=process.argv.slice(2);if(extra.length)throw new Error();
    let input='';for await (const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>2048)throw new Error();}
    const body=action==='reset'?JSON.parse(input):{};
    if(action==='reset'&&Object.keys(body).sort().join(',')!=='password,username'||action==='disable'&&input.trim())throw new Error();
    await operateLocalPassword({configPath:process.env.SCHEMAFORGE_LOCAL_CONFIG??path.resolve('.cache/local-product/config.json'),
      databaseUrl:process.env.SCHEMAFORGE_LOCAL_DATABASE_URL,action,identity,...body});
    process.stdout.write('Password account updated; prior browser sessions revoked. Roles and project grants preserved.\n');
  } catch { process.stderr.write('Local password operation unavailable. Use reset|disable developer|approver; reset reads private JSON {username,password} from stdin.\n');process.exitCode=1; }
}
