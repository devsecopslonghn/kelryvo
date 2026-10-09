import { access } from 'node:fs/promises';
import path from 'node:path';
import { localConfiguration, localDatabaseUrl, startLocalPostgres, prepareDemoRepository } from './local-resources.mjs';
import { LocalRepositoryError, parseLocalRepositoryArguments, resolveLocalRepositories } from './local-repositories.mjs';

try {
  const requestedRepositories = parseLocalRepositoryArguments(process.argv.slice(2));
  const configuredRepositories = await resolveLocalRepositories(requestedRepositories);
  if (!process.env.SCHEMAFORGE_JAVA_HOME) {
    try { await access('.cache/licenses/runtime/temurin/bin/java');
      process.env.SCHEMAFORGE_JAVA_HOME = path.resolve('.cache/licenses/runtime/temurin'); }
    catch { process.env.SCHEMAFORGE_JAVA_HOME = path.resolve('.cache/antlr/temurin'); }
  }
  const config = await localConfiguration();
  await startLocalPostgres(config);
  const repository = await prepareDemoRepository();
  const { startProduct } = await import('../apps/api/server.ts');
  const app = await startProduct({ databaseUrl: localDatabaseUrl(config), actors: [
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
