import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const excluded = new Set(['.git', 'node_modules', '.cache', 'coverage', 'dist', 'target', 'evidence']);

export async function ownedFiles(directory = root) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
    if (relative(root, path) === 'docs/inputs/db-research') continue;
    if (entry.isDirectory()) files.push(...await ownedFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort();
}

export async function checkSource() {
  const errors = [];
  let count = 0;
  for (const path of await ownedFiles()) {
    if (!/\.(mjs|json|md|toml|yml)$/.test(path)) continue;
    count += 1;
    const source = await readFile(path, 'utf8');
    const name = relative(root, path);
    if (!source.endsWith('\n')) errors.push(`${name}: missing final newline`);
    if (source.includes('\r')) errors.push(`${name}: use LF line endings`);
    if (source.split('\n').some(line => /[\t ]+$/.test(line))) {
      errors.push(`${name}: trailing whitespace`);
    }
    if (path.endsWith('.json')) {
      try { JSON.parse(source); } catch { errors.push(`${name}: invalid JSON`); }
    }
    if (path.endsWith('.mjs')) {
      const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (check.status !== 0) errors.push(`${name}: JavaScript syntax check failed`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return count;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(`Source checks passed for ${await checkSource()} authored files.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
