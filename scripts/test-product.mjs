import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { partitionProductFiles } from './product-test-shards.mjs';
import { parseProductTestOptions, literalTestNamePattern } from './product-test-suites.mjs';

function parseShard(value) {
  if (!value) return undefined;
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(value)) throw new TypeError('Invalid test shard');
  const [index, total] = value.split('/').map(Number);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index > total) throw new TypeError('Invalid test shard');
  return { index, total };
}

export async function runProductTests(argv = process.argv.slice(2), env = process.env) {
  let shard;
  let options;
  let files;
  try {
    shard = parseShard(env.SCHEMAFORGE_TEST_SHARD);
    options = parseProductTestOptions(argv, { shard: env.SCHEMAFORGE_TEST_SHARD });
    files = shard
      ? partitionProductFiles(options.files, shard.total)[shard.index - 1]
      : options.files;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.list) {
    process.stdout.write(`${options.files.join('\n')}\n`);
    return 0;
  }
  const suite = options.browser ? 'Browser' : 'API';
  const runnerOptions = `${options.browser ? '--browser ' : ''}--file <product-test-file>${options.name === undefined ? '' : ' --name <pattern>'}`;
  process.stderr.write(`${suite} product tests: ${files.length} file${files.length === 1 ? '' : 's'}${shard ? ` (shard ${shard.index}/${shard.total})` : ''}. Debug one file: node scripts/test-product.mjs ${runnerOptions}\n`);

  let url = env.SCHEMAFORGE_TEST_DATABASE_URL;
  let demoRepositoryPath = env.SCHEMAFORGE_DEMO_REPOSITORY_PATH;
  let resources;
  if (!url) {
    const [resourceModule, postgresModule] = await Promise.all([
      import('./local-resources.mjs'), import('postgres'),
    ]);
    resources = resourceModule;
    const postgres = postgresModule.default;
    const config = await resources.localConfiguration();
    await resources.startLocalPostgres(config);
    const admin = postgres(resources.localDatabaseUrl(config), { max: 1, onnotice: () => {} });
    try {
      const present = await admin`SELECT 1 FROM pg_database WHERE datname='schemaforge_tests'`;
      if (!present.length) await admin.unsafe('CREATE DATABASE schemaforge_tests');
    } finally { await admin.end({ timeout: 2 }); }
    url = resources.localDatabaseUrl(config).replace(/\/schemaforge$/, '/schemaforge_tests');
    demoRepositoryPath = await resources.prepareDemoRepository();
  }
  if (!demoRepositoryPath) {
    resources ??= await import('./local-resources.mjs');
    demoRepositoryPath = await resources.prepareDemoRepository();
  }

  const args = ['--test', '--test-concurrency=1'];
  if (options.name !== undefined) args.push(`--test-name-pattern=${literalTestNamePattern(options.name)}`);
  args.push(...files);
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: {
    ...env, SCHEMAFORGE_TEST_DATABASE_URL: url, SCHEMAFORGE_DEMO_REPOSITORY_PATH: demoRepositoryPath,
    SCHEMAFORGE_REQUIRE_PRODUCT_TESTS: '1',
  } });
  return await new Promise(resolve => child.once('exit', code => resolve(code ?? 1)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProductTests();
}
