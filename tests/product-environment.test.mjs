import assert from 'node:assert/strict';
import test from 'node:test';
import { productEnvironment, productEnvironmentKeys } from '../packages/runtime/environment.mjs';
import { createExecutionWorkerStarter, createSupervisedExecutionWorker } from '../apps/worker/supervisor.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

test('canonical product configuration overrides legacy aliases without mutating input', () => {
  const input = Object.freeze({ SCHEMAFORGE_JAVA_HOME: '/legacy', KELRYVO_JAVA_HOME: '/current',
    SCHEMAFORGE_LOCAL_DATABASE_URL: 'legacy-fixture', KELYRVO_DISCOVERY_MANIFEST: '/manifest',
    KELYRVO_DISCOVERY_SECRET_DIRECTORY: '/private', UNRELATED: 'retained' });
  assert.deepEqual(productEnvironment(input), { KELRYVO_JAVA_HOME: '/current',
    KELRYVO_LOCAL_DATABASE_URL: 'legacy-fixture', KELRYVO_DISCOVERY_MANIFEST: '/manifest',
    KELRYVO_DISCOVERY_SECRET_DIRECTORY: '/private', UNRELATED: 'retained' });
  assert.equal(input.SCHEMAFORGE_JAVA_HOME, '/legacy');
  const compatible = productEnvironment(input, { includeLegacy: true });
  assert.equal(compatible.SCHEMAFORGE_JAVA_HOME, '/current');
  assert.deepEqual(productEnvironment(compatible), productEnvironment(input));
});

test('worker aliases never admit unknown keys or invalid legacy unit scopes', () => {
  const factoryUrl = new URL('./helpers/product-environment-factory.mjs', import.meta.url).href;
  assert.deepEqual(productEnvironmentKeys(['PATH', 'KELRYVO_DATABASE_URL']),
    ['PATH', 'KELRYVO_DATABASE_URL', 'SCHEMAFORGE_DATABASE_URL']);
  for (const env of [{ SCHEMAFORGE_NODE_OPTIONS: '--import=untrusted' },
    { KELRYVO_NODE_OPTIONS: '--import=untrusted' }, { NODE_OPTIONS: '--import=untrusted' }]) {
    assert.throws(() => createExecutionWorkerStarter({ factoryUrl, env }), /privileged_worker_binding_rejected/);
  }
  assert.throws(() => createExecutionWorkerStarter({ factoryUrl, env: { SCHEMAFORGE_UNIT_SCOPE: 'TRUSTED_VALIDATED' } }),
    /privileged_worker_scope_rejected/);
});

test('fixed worker children receive compatible canonical and legacy installation configuration', async () => {
  for (const prefix of ['KELRYVO', 'SCHEMAFORGE']) {
    const env = { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC',
      [`${prefix}_DATABASE_URL`]: 'postgres://fixture.invalid/no-connection',
      [`${prefix}_UNIT_SCOPE`]: 'UNIT_SYNTHETIC',
      [`${prefix}_METADATA_GENERATION_ID`]: 'd63e34ed-34e3-4252-a1ca-3777192baf04' };
    const worker = createSupervisedExecutionWorker({ scope: 'UNIT_SYNTHETIC', workerId: 'environment-fixture',
      allowUnitSynthetic: true, startWorker: createExecutionWorkerStarter({
        factoryUrl: new URL('./helpers/product-environment-factory.mjs', import.meta.url).href, env }) });
    const result = await worker.runWaitingRequest('0d5b4fd8-dad6-4b76-98f7-0b46969d372c');
    assert.equal(result.workerResult, 'ADMISSION_DECLINED');
    assert.equal(result.terminalReceipt, true);
    assert.equal(result.childTermination, 'REAPED');
    await worker.drain();
  }
});

test('offline parser accepts canonical and legacy Java configuration', {
  skip: !existsSync('experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar')
    || !existsSync('.cache/antlr/antlr4-runtime-4.13.2.jar'),
}, async () => {
  for (const prefix of ['KELRYVO', 'SCHEMAFORGE']) {
    const env = { PATH: process.env.PATH, [`${prefix}_JAVA_HOME`]: `${process.cwd()}/missing-java-fixture` };
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { runAntlrCandidate } from './experiments/db-devops-wp0/antlr-envelope.mjs';
      const result = await runAntlrCandidate(Buffer.from('CREATE TABLE fixture (id NUMBER);'));
      process.stdout.write(JSON.stringify(result));
    `], { env, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).code, 'helper_launch_failed');
  }
});
