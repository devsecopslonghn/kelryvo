import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { PG_IMAGE } from './local-resources.mjs';

const run = args => {
  const result = spawnSync(args[0], args.slice(1), { stdio: 'inherit', env: process.env });
  if (result.status !== 0) throw new Error('Local preparation failed.');
};
try {
  try { await access('.cache/licenses/runtime/temurin/bin/java');
    process.env.SCHEMAFORGE_JAVA_HOME ??= path.resolve('.cache/licenses/runtime/temurin'); }
  catch {
    try { await access('.cache/antlr/temurin/bin/java'); }
    catch { run(['npm', 'run', 'parser:antlr:prepare']); }
    process.env.SCHEMAFORGE_JAVA_HOME ??= path.resolve('.cache/antlr/temurin');
  }
  run(['npm', 'run', 'parser:antlr:build']);
  run(['docker', 'pull', PG_IMAGE]);
  console.log('Local PostgreSQL image and pinned ANTLR parser are ready.');
} catch {
  console.error('Preparation failed. Existing parser destinations are preserved; see the command output.');
  process.exitCode = 1;
}
