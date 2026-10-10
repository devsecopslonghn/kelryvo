import { constants } from 'node:fs';
import { access, open } from 'node:fs/promises';
import path from 'node:path';
import { localConfiguration, localDatabaseUrl, startLocalPostgres, prepareDemoRepository } from './local-resources.mjs';
import { LocalRepositoryError, parseLocalRepositoryArguments, resolveLocalRepositories } from './local-repositories.mjs';
import { localDirectory } from './local-resources.mjs';
import { authorizeLocalMetadataUrl } from './local-operator-config.mjs';

try {
  const args=process.argv.slice(2); const restored=args.includes('--restored');
  if(args.filter(value=>value==='--restored').length>(restored?1:0) || restored && args.length!==1) throw new Error('invalid startup options');
  const requestedRepositories = parseLocalRepositoryArguments(restored ? [] : args);
  const configuredRepositories = await resolveLocalRepositories(requestedRepositories);
  if (!process.env.SCHEMAFORGE_JAVA_HOME) {
    try { await access('.cache/licenses/runtime/temurin/bin/java');
      process.env.SCHEMAFORGE_JAVA_HOME = path.resolve('.cache/licenses/runtime/temurin'); }
    catch { process.env.SCHEMAFORGE_JAVA_HOME = path.resolve('.cache/antlr/temurin'); }
  }
  const config = await localConfiguration();
  await startLocalPostgres(config);
  let databaseUrl=localDatabaseUrl(config);
  if(restored) {
    const descriptorPath=path.join(localDirectory,'restored-instance.json');
    const handle=await open(descriptorPath,constants.O_RDONLY|constants.O_NOFOLLOW);
    let instance;
    try {
      const stat=await handle.stat();
      if(!stat.isFile() || stat.uid!==(process.geteuid?.()??process.getuid()) || stat.nlink!==1 || stat.size>2048 || (stat.mode&0o777)!==0o600) throw new Error('invalid descriptor');
      instance=JSON.parse(await handle.readFile('utf8'));
    } finally { await handle.close(); }
    if(Object.keys(instance??{}).sort().join(',')!=='databaseName,format' || instance.format!=='schemaforge-restored-instance-v1'
      || !/^sf_product_restore_[a-f0-9]{32}$/.test(instance.databaseName)) throw new Error('invalid descriptor');
    const target=new URL(localDatabaseUrl(config)); target.pathname=`/${instance.databaseName}`; databaseUrl=target.toString();
    await authorizeLocalMetadataUrl(path.join(localDirectory,'config.json'),databaseUrl);
  }
  const repository = await prepareDemoRepository();
  const { startProduct } = await import('../apps/api/server.ts');
  const app = await startProduct({ databaseUrl, actors: [
    { id: 'local-developer', name: 'Local developer', role: 'developer', token: config.developerToken },
    { id: 'local-approver', name: 'Local approver', role: 'approver', token: config.approverToken },
  ], repositories: [
    { id: 'demo', name: 'Local migration demo', path: repository },
    ...configuredRepositories,
  ] });
  console.log('SchemaForge: http://127.0.0.1:4317');
  console.log('Local bearer tokens: .cache/local-product/config.json (private local file).');
  console.log('Target execution: NOT_EXECUTED; Oracle validation: BLOCKED.');
  const close = async () => { await app.close(); process.exitCode = 0; };
  process.once('SIGINT', close); process.once('SIGTERM', close);
} catch (error) {
  if (error instanceof LocalRepositoryError) {
    console.error('SchemaForge startup failed: invalid repository options. Use --repository PATH for an existing local Git working tree.');
    process.exitCode = 1;
  } else {
  console.error('SchemaForge startup failed. Check Docker, port 55432/4317 and run npm run local:prepare.');
  process.exitCode = 1;
  }
}
