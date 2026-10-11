import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pins = JSON.parse(await readFile('docs/dependencies/third-party-notices.json'));
const jdk = pins.runtimes.find(item => item.name === 'Eclipse Temurin JDK');
for (const item of jdk.legal_files) {
  if (hash(await readFile(`.cache/antlr/temurin/legal/${item.path}`)) !== item.sha256) throw new Error('JDK legal hash mismatch');
}
const packages = [];
const rows = execFileSync('/usr/bin/dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n'], { encoding: 'utf8' }).trim().split('\n');
for (const row of rows) {
  const [name, version, source, sourceVersion] = row.split('\t');
  const notice = `/usr/share/doc/${name.replace(/:.*$/, '')}/copyright`;
  const bytes = await readFile(notice);
  if (!bytes.length) throw new Error('Missing Debian notice');
  packages.push({ name, version, source, sourceVersion, notice, sha256: hash(bytes), sourceAccess: 'https://snapshot.debian.org/package/' });
}
await writeFile('/opt/licenses/runtime-inventory.json', JSON.stringify({ packages, jdkLegalFilesVerified: jdk.legal_files.length,
  nodeNoticeSha256: hash(await readFile('/opt/licenses/node-LICENSE')), sourceArchivePins: JSON.parse(await readFile('docs/dependencies/container-runtime.json')).source_archives }, null, 2) + '\n');
console.log(`Runtime notices present for ${packages.length} Debian packages and ${jdk.legal_files.length} JDK files.`);
