import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownedFiles } from './check-source.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = process.argv[2];
if (!['--check', '--write'].includes(mode)) {
  console.error('Usage: node scripts/format-json.mjs --check|--write');
  process.exitCode = 2;
} else {
  const mismatches = [];
  for (const path of await ownedFiles()) {
    if (!path.endsWith('.json')) continue;
    const source = await readFile(path, 'utf8');
    const formatted = `${JSON.stringify(JSON.parse(source), null, 2)}\n`;
    if (source !== formatted) {
      if (mode === '--write') await writeFile(resolve(path), formatted);
      else mismatches.push(relative(root, path));
    }
  }
  if (mismatches.length) {
    console.error(`JSON formatting differs: ${mismatches.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log('Authored JSON formatting passed; imported inputs and evidence excluded.');
  }
}
