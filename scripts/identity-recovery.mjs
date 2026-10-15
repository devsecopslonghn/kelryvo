import postgres from 'postgres';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { containerDatabaseUrl } from '../packages/runtime/container-config.mjs';
import { auditIdentity, identityError, lockIdentity, passwordHash, privatePasswordFile, revokeActorSessions } from '../packages/identity/core.ts';

/** Trusted metadata/OS operator recovery; no recovery tokens or public HTTP endpoint. */
export async function recoverAdministrator(sql, {passwordFile,reason}) {
  if(typeof reason!=='string'||reason.trim().length<10||reason.length>500)throw identityError('RECOVERY_REASON_REQUIRED');
  await sql.begin(async tx=>{
    await lockIdentity(tx);
    const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
    if(gate?.state!=='ACTIVE')throw identityError('METADATA_RESTORE_HOLD');
    const user=(await tx`SELECT u.actor_id FROM sf_identity_users u WHERE username='admin' AND workspace_role='admin'`)[0];
    if(!user)throw identityError('ADMIN_RECOVERY_REQUIRED');
    const password=await privatePasswordFile(passwordFile,false);
    await tx`UPDATE sf_identity_users SET password_hash=${await passwordHash(password)},must_change_password=true,version=version+1 WHERE actor_id=${user.actor_id}`;
    await tx`UPDATE sf_local_actors SET disabled=false WHERE id=${user.actor_id}`;
    await revokeActorSessions(tx,user.actor_id);
    await auditIdentity(tx,null,'ADMIN_RECOVERED',user.actor_id,{reason:reason.trim(),operatorOsUid:process.geteuid?.()??process.getuid()});
  });
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  let sql;
  try{
    const [passwordFile,reason,...extra]=process.argv.slice(2);if(extra.length)throw new Error();
    sql=postgres(await containerDatabaseUrl(process.env.KELRYVO_SECRET_DIR??'/run/kelryvo/secrets'),{max:1,onnotice:()=>{}});
    await recoverAdministrator(sql,{passwordFile,reason});
    process.stdout.write('Administrator recovered. Retrieve the new private password file through the authorized operator channel.\n');
  }catch{process.stderr.write('Administrator recovery unavailable. Check metadata, reason and a new absolute private output path.\n');process.exitCode=1;}
  finally{await sql?.end({timeout:5});}
}
