import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile('package-lock.json');
const lock = JSON.parse(bytes);
const registry = JSON.parse(await readFile('docs/dependencies/product-closure.json'));
const grants = new Set(['MIT', 'ISC', 'BSD-3-Clause', 'Apache-2.0', 'Unlicense', '(Apache-2.0 OR UPL-1.0)']);
if (registry.package_lock_sha256 !== hash(bytes) || registry.unknown_required_grants !== 0
    || registry.notice_sha256 !== hash(await readFile(registry.notice_path))) {
  throw new Error('Product dependency lock/notices changed; update exact grant evidence.');
}
const recorded = new Map(registry.packages.map(p => [p.path, p]));
for (const [path, item] of Object.entries(lock.packages)) {
  if (!path) continue;
  const entry = recorded.get(path);
  if (!entry || entry.version !== item.version || entry.integrity !== item.integrity || !grants.has(entry.license)) {
    throw new Error('Unreviewed product dependency.');
  }
}
console.log(`Product license closure: ${recorded.size} pinned packages, zero unknown required grants.`);
