// Node packages are test tools only; native runtime inventories are verified by
// kelryvo verify-dist and the OCI gates.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const bytes=await readFile('package-lock.json'),lock=JSON.parse(bytes);
const grants=JSON.parse(await readFile('docs/dependencies/test-tools-closure.json','utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'),grants.packageLockSha256);
const manifest=[];
for(const [name,pkg] of Object.entries(lock.packages)){
  if(!name)continue;
  assert(pkg.dev,'Application runtime must not depend on Node packages');
  const grant=grants.packages.find(p=>p.path===name);
  assert(grant&&grant.version===pkg.version&&grant.integrity===pkg.integrity,'Test package grant must match the exact lock');
  let installed;
  try{installed=JSON.parse(await readFile(`${name}/package.json`,'utf8'));}catch(error){if(pkg.optional&&error.code==='ENOENT')continue;throw error;}
  assert.equal(installed.version,pkg.version);assert.equal(installed.license,grant.license);
  manifest.push({path:name,version:pkg.version,integrity:pkg.integrity,license:grant.license});
}
console.log(process.argv.includes('--manifest')?JSON.stringify(manifest,null,2):`PASS: ${manifest.length} installed test packages match locked versions and reviewed grants; no Node runtime dependencies`);
