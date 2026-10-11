import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, copyFile, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildLocalRelease, verifyLocalRelease } from '../scripts/local-release.mjs';

const run=(program,args,cwd)=>new Promise((resolve,reject)=>{
  const child=spawn(program,args,{ cwd,env:process.env,stdio:['ignore','pipe','pipe'] });let output='';
  const capture=chunk=>{output+=chunk.toString();if(output.length>2*1024*1024){child.kill();reject(new Error('Installation output limit'));}};
  child.stdout.on('data',capture);child.stderr.on('data',capture);child.once('error',reject);
  child.once('close',async code=>{
    if (code===0) return resolve(output);
    try {
      const diagnostic=path.join(await mkdtemp(path.join(tmpdir(),'sf-release-failure-')),'installation.log');
      await writeFile(diagnostic,output,{ mode:0o600 });
      reject(new Error(`Installation command failed: ${program} ${args.join(' ')} (exit ${code}); private log: ${diagnostic}`));
    } catch (error) { reject(error); }
  });
});

test('frozen source archive installs pinned dependencies and passes local end-to-end acceptance', { timeout:600_000 },async()=>{
  assert.ok(process.env.SCHEMAFORGE_TEST_DATABASE_URL,'explicit disposable metadata PostgreSQL required');
  const temp=await mkdtemp(path.join(tmpdir(),'sf-release-install-'));
  try {
    const built=await buildLocalRelease({ outputDirectory:path.join(temp,'artifact') });
    const install=path.join(temp,'install');await mkdir(install);
    await run('/usr/bin/tar',['-xzf',path.join(temp,'artifact',built.archive),'-C',install]);
    await verifyLocalRelease(install);
    await run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],install);
    await run('npm',['run','dependencies:product'],install);
    const pins=JSON.parse(await readFile('docs/dependencies/antlr-parser-lock.json'));
    // Preparation was already performed by the outer acceptance environment.
    // Copy only exact public parser inputs; the external pinned JDK/Chromium are
    // reused in this job. None is bundled or taken from private product state.
    for (const artifact of pins.artifacts) {
      const target=path.join(install,artifact.path);await mkdir(path.dirname(target),{ recursive:true });
      await copyFile(artifact.path,target);
    }
    await run('npm',['run','parser:antlr:build'],install);
    await run('npm',['run','build'],install);
    await run('npm',['run','release:verify'],install);
    const output=await run('npm',['run','release:acceptance'],install);
    const counts=Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(key=>[key,Number(output.match(new RegExp(`# ${key} (\\d+)\\s*$`,'m'))?.[1])]));
    assert.ok(counts.tests>=4);assert.equal(counts.pass,counts.tests);assert.equal(counts.fail,0);assert.equal(counts.skipped,0);assert.equal(counts.cancelled,0);
    console.log(`Source bundle ${built.sourceCommit}: ${counts.pass} local workflow tests passed; Oracle UNVALIDATED.`);
  } finally { await rm(temp,{ recursive:true,force:true }); }
});
