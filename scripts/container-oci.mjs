import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleOCIArchives, verifyOCIArchive } from './oci-archive-verification.mjs';

async function main(args) {
  const [action, directory, sha] = args;
  if (action === 'assemble') {
    const result = await assembleOCIArchives(directory, sha);
    console.log(`Verified and assembled app and worker OCI indexes in ${resolve(directory)}`);
    return result;
  }
  if (action === 'verify') {
    const root = resolve(directory);
    for (const image of ['app', 'worker']) verifyOCIArchive(resolve(root, `kelryvo-${image}.tar`), sha, image);
    console.log('Verified app and worker OCI indexes for linux/amd64 and linux/arm64');
    return;
  }
  throw new Error('Usage: node scripts/container-oci.mjs assemble|verify <directory> <source-sha>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
