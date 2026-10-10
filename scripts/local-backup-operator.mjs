import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { createPrivateBackup, restorePrivateBackup } from '../packages/backup/index.mjs';
import { localDirectory } from './local-resources.mjs';
import { readPrivateLocalConfig } from './local-operator-config.mjs';
import { operateLocalCredential } from './local-credential-operator.mjs';

const fail = () => new Error('Local backup operator failed; inspect private local state and retry.');
const defaults = { config: path.join(localDirectory,'config.json'), databaseName: 'schemaforge', port: '55432', user:'schemaforge', destination: null, witness: null, backup: null };
function parse(args) {
  const [action,...rest]=args, values={...defaults}, seen=new Set();
  for(let i=0;i<rest.length;i++) {
    const key=rest[i], value=rest[++i];
    if(!['--config','--database-name','--port','--user','--destination','--witness','--backup'].includes(key) || !value || value.startsWith('--')) throw fail();
    const field={ '--config':'config','--database-name':'databaseName','--port':'port','--user':'user','--destination':'destination','--witness':'witness','--backup':'backup' }[key];
    if(seen.has(field)) throw fail();
    seen.add(field); values[field]=value;
  }
  if(!['backup','restore','start'].includes(action)) throw fail();
  if(action==='start' && rest.length) throw fail();
  return {action,...values};
}
async function durablePrivate(file, object) {
  const dir=path.dirname(file); const ds=await lstat(dir);
  if(!ds.isDirectory() || ds.uid!==(process.geteuid?.()??process.getuid()) || (ds.mode&0o777)!==0o700) throw fail();
  const handle=await open(file,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try { await handle.chmod(0o600); await handle.writeFile(`${JSON.stringify(object,null,2)}\n`); await handle.sync(); }
  finally { await handle.close(); }
  const parent=await open(dir,constants.O_RDONLY);try {await parent.sync();} finally {await parent.close();}
}
async function readDescriptor(file) {
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=await handle.stat();
    if(!st.isFile() || st.uid!==(process.geteuid?.()??process.getuid()) || st.nlink!==1 || st.size>2048 || (st.mode&0o777)!==0o600) throw fail();
    const value=JSON.parse(await handle.readFile('utf8'));
    if(Object.keys(value).sort().join(',')!=='databaseName,format' || value.format!=='schemaforge-restored-instance-v1'
       || !/^sf_product_restore_[a-f0-9]{32}$/.test(value.databaseName)) throw fail();
    return value;
  } catch { throw fail(); } finally { await handle.close(); }
}
export async function runLocalBackupOperator(options) {
  if(!['backup','restore','start'].includes(options.action)) throw fail();
  if(options.action==='start') {
    await readDescriptor(path.join(localDirectory,'restored-instance.json'));
    const child=spawn(process.execPath,['scripts/local-dev.mjs','--restored'],{cwd:process.cwd(),stdio:'inherit',env:process.env});
    return await new Promise((resolve,reject)=>{ child.once('error',reject); child.once('exit',(code)=>code===0?resolve():reject(fail())); });
  }
  const config=await readPrivateLocalConfig(options.config);
  if(!/^(?:5432|[1-9][0-9]{1,4})$/.test(options.port) || Number(options.port)>65535
    || !['schemaforge','postgres'].includes(options.user)
    || !(options.databaseName==='schemaforge' || options.databaseName==='schemaforge_tests'
      || /^sf_product_test_[a-f0-9]{32}$/.test(options.databaseName)
      || /^sf_product_restore_[a-f0-9]{32}$/.test(options.databaseName))) throw fail();
  const database=new URL(`postgres://${options.user}@127.0.0.1:${options.port}/${options.databaseName}`);
  database.password=config.databasePassword;
  if(options.action==='backup') {
    if(!options.destination || !options.witness || options.backup) throw fail();
    return createPrivateBackup({configPath:options.config,databaseUrl:database.toString(),destination:options.destination,witnessPath:options.witness});
  }
  if(path.resolve(options.config)!==path.resolve(defaults.config) || options.databaseName!=='schemaforge'
    || options.port!=='55432' || options.user!=='schemaforge' || !options.backup || !options.witness || options.destination) throw fail();
  const descriptor=path.join(localDirectory,'restored-instance.json');
  try {await lstat(descriptor);throw fail();} catch(error) {if(error.code!=='ENOENT') throw fail();}
  const restored=await restorePrivateBackup({configPath:options.config,databaseUrl:database.toString(),backupDirectory:options.backup,witnessPath:options.witness});
  for(const identity of ['developer','approver']) await operateLocalCredential({configPath:options.config,databaseUrl:restored.databaseUrl,identity,action:'rotate'});
  await durablePrivate(descriptor,{format:'schemaforge-restored-instance-v1',databaseName:restored.databaseName});
  return {databaseName:restored.databaseName,hold:true,credentialsRotated:true,previousConfigGeneration:!!config};
}

if (process.argv[1] && path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const options=parse(process.argv.slice(2));
    const result=await runLocalBackupOperator(options);
    if(options.action==='backup') process.stdout.write(`Private backup complete. Witness ${result.witnessId}; archive SHA-256 ${result.archiveSha256}.\n`);
    if(options.action==='restore') process.stdout.write(`Private metadata restored into ${result.databaseName}; RESTORE_HOLD active. Fresh local credentials are in the private operator config. Start with npm run local:backup-restore -- start.\n`);
  } catch { process.stderr.write('Local backup operator failed.\n'); process.exitCode=1; }
}
