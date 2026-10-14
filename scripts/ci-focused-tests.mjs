import { execFileSync, spawnSync } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { PRODUCT_API_FILES } from './product-test-suites.mjs';

// Small real PostgreSQL suites guard each trust/data boundary. Common API,
// database, dependency and test-harness changes select every boundary.
export const FOCUSED_SUITES = Object.freeze({
  security: ['product-mutation-authority', 'product-secure-sessions', 'product-membership', 'product-credential-lifecycle'],
  integrity: ['product-database', 'product-release-integrity', 'product-schema-backup'],
  governance: ['product-approval-integrity', 'product-approval-revocation', 'product-protected-source-binding', 'product-plan-record'],
  execution: ['product-execution-readiness', 'product-execution-reconciliation', 'product-worker-supervision'],
  schema: ['product-schema-baselines', 'product-database-discovery'],
  connectivity: ['product-connection-management', 'product-target-bindings'],
  sql: ['product-sql-workspace', 'product-sql-validation', 'product-statement-preview'],
});
const suiteFiles = suite => FOCUSED_SUITES[suite].map(name => `tests/${name}.test.mjs`);
const parserFile = 'tests/antlr.integration.mjs';
const allFiles = new Set([...PRODUCT_API_FILES, parserFile]);

export function selectFocusedTests(paths) {
  const selected = new Map();
  const add = suite => selected.set(suite, new Set(suiteFiles(suite)));
  const all = () => Object.keys(FOCUSED_SUITES).forEach(add);
  for (const path of paths) {
    if (PRODUCT_API_FILES.includes(path)) {
      if (!selected.has('changed-tests')) selected.set('changed-tests', new Set());
      selected.get('changed-tests').add(path);
    } else if (/^(apps\/api\/|packages\/database\/|tests\/helpers\/|scripts\/(local-|test-product|product-test)|package(-lock)?\.json$|\.github\/workflows\/product\.yml$)/.test(path)) {
      all();
      if (path === 'packages/database/index.ts') selected.set('backup', new Set(['tests/product-backup-restore.test.mjs']));
    } else if (/^(apps\/worker\/|packages\/execution\/)/.test(path)) {
      add('execution'); add('governance'); add('integrity');
    } else if (/^packages\/(governance|migrations)\//.test(path)) {
      add('governance'); add('integrity'); add('sql');
    } else if (/^packages\/schema-baselines\//.test(path)) {
      add('schema'); add('integrity');
    } else if (/^packages\/(connectivity|targets)\//.test(path)) {
      add('connectivity'); add('schema'); add('execution');
    } else if (/^packages\/(sql-workspace|sql-validation)\//.test(path)) {
      add('sql'); add('integrity');
    } else if (/^packages\/(backup|audit)\//.test(path)) {
      add('integrity'); add('governance');
      if (path.startsWith('packages/backup/')) selected.set('backup', new Set(['tests/product-backup-restore.test.mjs']));
    } else if (/^(packages\/|scripts\/ci-focused-tests\.mjs$)/.test(path)) {
      all(); // New/unclassified shared production modules fail conservatively.
    }
    if (/^(experiments\/db-devops-wp0\/(antlr-helper\/|parser)|scripts\/(antlr-|parser-)|docs\/dependencies\/(antlr-parser-lock|third-party-notices)\.json$|tests\/antlr\.integration\.mjs$)/.test(path)) {
      selected.set('parser', new Set([parserFile])); add('sql'); add('governance');
    }
  }
  const seen = new Set();
  const include = [];
  for (const [suite, files] of selected) {
    const unique = [...files].filter(file => !seen.has(file));
    unique.forEach(file => seen.add(file));
    if (unique.length) include.push({ suite, files: unique });
  }
  return { needed: include.length > 0, include: include.length ? include : [{ suite: 'none', files: [] }] };
}

export async function runFocusedTests(files, env = process.env) {
  if (!Array.isArray(files) || !files.length || files.some(file => !allFiles.has(file) || !existsSync(file))) throw new Error('Invalid focused test selection');
  if (!env.SCHEMAFORGE_TEST_DATABASE_URL || env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS !== '1'
      || !existsSync('experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar')
      || !existsSync('dist/web/index.html') || !existsSync('dist/web/app.js')) throw new Error('Focused tests require PostgreSQL, the built parser and web bundle');
  const { prepareDemoRepository } = await import('./local-resources.mjs');
  const demo = await prepareDemoRepository();
  console.log(`Focused tests: ${files.join(', ')}`);
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], {
    stdio: 'inherit', env: { ...env, SCHEMAFORGE_DEMO_REPOSITORY_PATH: demo },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === '--run') {
      process.exitCode = await runFocusedTests(JSON.parse(process.env.CI_TEST_FILES));
    } else {
      const base = process.env.CI_BASE_SHA;
      let selection;
      if (!/^[a-f0-9]{40}$/.test(base ?? '') || /^0+$/.test(base)) {
        selection = selectFocusedTests(['apps/api/index.ts', 'tests/antlr.integration.mjs']);
      } else {
        // Compare the entire PR/master push range; never silently skip after a
        // missing base or failed diff. No credentials or PR text reach a shell.
        execFileSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', base], { stdio: 'inherit' });
        const paths = execFileSync('git', ['diff', '--name-only', '-z', base, 'HEAD'], { encoding: 'utf8' }).split('\0').filter(Boolean);
        selection = selectFocusedTests(paths);
      }
      console.log(JSON.stringify(selection));
      if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `needed=${selection.needed}\nmatrix=${JSON.stringify({ include: selection.include })}\n`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
