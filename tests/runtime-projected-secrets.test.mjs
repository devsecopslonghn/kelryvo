import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, readFile, rm, chown, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publishOracleRuntime } from '../scripts/oracle-runtime-operator.mjs';
import { initializeOracleWitness } from '../scripts/oracle-runtime-controller.mjs';
import { prepareRuntime } from '../apps/runtime/bootstrap.mjs';

const rootOnly = { skip: process.getuid?.() !== 0 };
const names = ['database-url','developer-token','approver-token','tls.crt','tls.key'];
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'kelryvo-projected-source-'));
  const source = path.join(directory, 'source'), runtime = path.join(directory, 'runtime');
  await mkdir(source, { mode: 0o700 }); await mkdir(path.join(source, '..2026-test'), { mode: 0o700 });
  await symlink('..2026-test', path.join(source, '..data'));
  for (const name of names) {
    await writeFile(path.join(source, '..2026-test', name), 'FIXTURE_' + name, { mode: 0o400 });
    await symlink('..data/' + name, path.join(source, name));
  }
  return { directory, source, runtime, env: { KELRYVO_SECRET_DIR: source } };
}
test('root bootstrap stages Kubernetes projected Secret files inside the trusted source', rootOnly, async () => {
  const f = await fixture();
  try {
    await prepareRuntime({ env: f.env, runtimeRoot: f.runtime, apiOnly: true });
    assert.equal(await readFile(path.join(f.runtime, 'api/secrets/database-url'), 'utf8'), 'FIXTURE_database-url');
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
test('root bootstrap refuses projected Secret symlinks outside the source mount', rootOnly, async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.directory, 'outside'), 'OUTSIDE_FIXTURE', { mode: 0o400 });
    await rm(path.join(f.source, 'database-url')); await symlink('../outside', path.join(f.source, 'database-url'));
    await assert.rejects(prepareRuntime({ env: f.env, runtimeRoot: f.runtime, apiOnly: true }));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('root publisher replaces only protected runtime inputs and retains the durable witness',rootOnly,async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'kelryvo-publish-'));
  const source=path.join(directory,'source'),destination=path.join(directory,'runtime'),witness=path.join(directory,'witness');
  try {
    await mkdir(source,{mode:0o700});await mkdir(destination,{mode:0o700});await chown(destination,10002,10002);
    await initializeOracleWitness(witness);
    await writeFile(path.join(witness,'retained'),'PRESERVED');
    await initializeOracleWitness(witness);
    const names=['writer-password','ledger-password','observer-password','database-url','execution-service.mjs','oracle-worker.mjs','discovery-manifest.json','installation.json'];
    for(const name of names)await writeFile(path.join(source,name),'FIRST_'+name,{mode:0o400});
    await publishOracleRuntime(source,destination);
    for(const name of names){const s=await stat(path.join(destination,name));assert.equal(s.uid,10002);assert.equal(s.mode&0o777,0o600);}
    assert.equal(await readFile(path.join(destination,'installation.json'),'utf8'),'FIRST_installation.json');
    assert.equal(await readFile(path.join(witness,'retained'),'utf8'),'PRESERVED');
    await assert.rejects(readFile(path.join(destination,'oracle-vault-private.pem')),/ENOENT/);
    await assert.rejects(publishOracleRuntime(source,source));
  }finally{await rm(directory,{recursive:true,force:true});}
});
