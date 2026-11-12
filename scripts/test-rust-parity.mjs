// Exact frozen request/response vectors from the retired implementation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const root=path.resolve('.');
const expand=v=>Array.isArray(v)?v.map(expand):v&&typeof v==='object'?('$repeat' in v?v.$repeat.repeat(v.count):Object.fromEntries(Object.entries(v).map(([k,x])=>[k,expand(x)]))):v;
const cases=expand(JSON.parse(readFileSync(new URL('../tests/fixtures/contracts/core.json',import.meta.url),'utf8')));
const distribution=process.env.KELRYVO_RUST_DISTRIBUTION;
if(distribution)assert(path.isAbsolute(distribution));
const cli=distribution?path.join(distribution,'bin/kelryvo'):path.join(root,'target/debug/kelryvo');
const verify=()=>{
  if(!distribution)return;
  const checked=spawnSync(cli,['verify-dist',distribution],{encoding:'utf8',timeout:30_000,maxBuffer:2*1024*1024});
  assert.ifError(checked.error);assert.equal(checked.status,0,checked.stderr);
};
verify();
const result = spawnSync(cli, ['core'], { cwd: root, input: cases.map(c => c.serialized??JSON.stringify(c.request)).join('\n') + '\n', encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30_000 });
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
const lines = result.stdout.trim().split('\n');
assert.equal(lines.length, cases.length);
for (const [i, item] of cases.entries()) assert.deepEqual(JSON.parse(lines[i]), item.expected, `native/frozen-contract mismatch: ${i} ${item.request.op}`);
console.log(`PASS: ${cases.length} native/frozen-contract comparisons`);
verify();
if(distribution){
  const probe=spawnSync(cli,['--build-info'],{encoding:'utf8',timeout:30_000,maxBuffer:16384});
  assert.ifError(probe.error);assert.equal(probe.status,0,probe.stderr);
  console.log(JSON.stringify({status:'PASS',scope:'EXACT_RELEASE_CLI_FROZEN_KERNEL_CONTRACTS',cases:cases.length,
    artifact:JSON.parse(probe.stdout),bundleIntegrityBeforeAndAfter:true,database:false,oracle:false}));
}
