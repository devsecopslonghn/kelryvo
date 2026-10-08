import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ownedFiles } from './check-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha256 = data => createHash('sha256').update(data).digest('hex');
const startedAt = new Date().toISOString();
const runId = `${startedAt.replaceAll(/[-:.]/g, '')}-${randomUUID().slice(0, 8)}`;
const runPath = join(root, 'evidence/foundation', runId);
await mkdir(runPath, { recursive: true, mode: 0o700 });

const sources = [];
for (const file of await ownedFiles()) {
  const bytes = await readFile(file);
  sources.push({ path: relative(root, file), sha256: sha256(bytes), bytes: bytes.length });
}

// Fixed offline command; caller-supplied shell text is never executed.
const check = spawnSync('npm', ['run', 'check'], {
  cwd: root,
  encoding: 'utf8',
  timeout: 120000,
  maxBuffer: 8 * 1024 * 1024,
});
const log = `${check.stdout ?? ''}${check.stderr ?? ''}`;
await writeFile(join(runPath, 'checks.log'), log, { flag: 'wx', mode: 0o600 });
const manifest = {
  schema_version: 1,
  id: `SF-CHECK-${runId}`,
  kind: 'STATIC',
  started_at: startedAt,
  finished_at: new Date().toISOString(),
  node: process.version,
  scope: 'Local foundation and offline WP0 harness checks only',
  command: 'npm run check',
  exit_code: check.status,
  outcome: check.status === 0 ? 'PASS' : 'FAIL',
  log: { path: relative(root, join(runPath, 'checks.log')), sha256: sha256(log) },
  sources,
  limitations: [
    'No Oracle connection, dependency-license closure, model turn, remote CI or deployment was performed.',
    'Source validation is not a deployable product build; synthetic validator tests do not certify Oracle behavior.',
    'Tracking state may advance after this snapshot; immutable run files must not be rewritten.',
  ],
};
await writeFile(join(runPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: 'wx', mode: 0o600,
});
console.log(JSON.stringify({
  outcome: manifest.outcome,
  manifest: relative(root, join(runPath, 'manifest.json')),
  exit_code: check.status,
}, null, 2));
if (check.status !== 0) {
  console.error(log.slice(-4000));
  process.exitCode = 1;
}
