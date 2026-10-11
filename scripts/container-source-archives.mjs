import { readFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const registry = JSON.parse(await readFile('docs/dependencies/container-runtime.json'));
await mkdir('.cache/container-sources', { recursive: true });
for (const { name, url, sha256 } of registry.source_archives) {
  if (!/^temurin-(?:build-)?source$/.test(name) || !/^https:\/\/codeload.github.com\/adoptium\/[a-z0-9-]+\/tar.gz\/[a-f0-9]{40}$/.test(url)
      || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid container source pin');
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error('Container source download unavailable');
  const hash = createHash('sha256'); let size = 0;
  await pipeline(response.body, new Transform({ transform(chunk, _encoding, done) {
    size += chunk.length;
    if (size > 256 * 1024 * 1024) return done(new Error('Container source limit'));
    hash.update(chunk); done(null, chunk);
  } }), createWriteStream(`.cache/container-sources/${name}.tar.gz`, { flags: 'wx' }));
  if (hash.digest('hex') !== sha256) throw new Error('Container source hash mismatch');
}
console.log('Matching pinned Temurin source archives prepared.');
