import { spawn } from 'node:child_process';
import { verifyLocalRelease } from './local-release.mjs';

try {
  await verifyLocalRelease();
  const url=new URL(process.env.SCHEMAFORGE_TEST_DATABASE_URL ?? '');
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['127.0.0.1','localhost','[::1]'].includes(url.hostname)
      || !url.pathname || url.pathname==='/') throw new Error('Disposable local metadata database required');
  // Tests create/drop only their UUID-named databases. No installed local
  // instance, Oracle host or application writer credentials are used.
  const child=spawn(process.execPath,['--test','--test-concurrency=1',
    'tests/product-mvp-workflow.test.mjs','tests/product-mvp-workflow-browser.integration.mjs',
    'tests/product-secure-sessions-browser.integration.mjs','tests/product-release-acceptance.integration.mjs'],
  { stdio:'inherit',env:{ ...process.env,SCHEMAFORGE_REQUIRE_PRODUCT_TESTS:'1' } });
  child.once('error',()=>{process.exitCode=1;});
  child.once('exit',code=>{process.exitCode=code??1;});
} catch { console.error('Release acceptance requires a verified bundle, disposable loopback PostgreSQL, prepared parser/web and Chromium.');process.exitCode=1; }
