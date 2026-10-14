import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLocalRelease, verifyLocalRelease, selectedReleasePath } from '../scripts/local-release.mjs';
import { releaseTestDiagnostics } from './helpers/release-diagnostics.mjs';

test('release failure diagnostics expose only bounded fixed test metadata',()=>{
  const secret='PRIVATE_INSTALLATION_OUTPUT_FIXTURE';
  const output=`npm fixture\n${secret}\nnot ok 1 - HTTPS browser resumes secure sessions and retains review workflow through logout, expiry and witnessed restore\n  ---\n  duration_ms: 30000.123\n  failureType: 'testCodeFailure'\n  error: '${secret}'\n  code: 'ERR_ASSERTION'\n  actual: '${secret}'\n  ...\nnot ok 2 - ${secret}\n  duration_ms: 12\n  code: 'ERR_ASSERTION'\nok 3 - installed source bundle connects approved Git request to controlled UNIT history and restart\n  duration_ms: 10\n  failureType: '${secret}'\n  code: '${secret}'\n`;
  assert.deepEqual(releaseTestDiagnostics(output),[
    { test:'secure-session-workflow',result:'FAIL',durationMs:30000.123,failureType:'testCodeFailure',code:'ERR_ASSERTION' },
    { test:'controlled-unit-workflow',result:'PASS',durationMs:10 },
  ]);
  assert.equal(JSON.stringify(releaseTestDiagnostics(output)).includes(secret),false);
  assert.deepEqual(releaseTestDiagnostics(`not ok 1 - HTTPS browser resumes secure sessions and retains review workflow through logout, expiry and witnessed restore\u001b[31m\n  duration_ms: 1`),[]);
  const repeated=Array.from({ length:100 },()=>output).join('\n');
  assert.equal(releaseTestDiagnostics(repeated).length,5);
});

test('local source bundle is reproducible, excludes private/research inputs, preserves notices and rejects corruption',async()=>{
  const temp=await mkdtemp(path.join(tmpdir(),'sf-release-unit-'));
  try {
    const repo=path.join(temp,'repo');
    execFileSync('/usr/bin/git',['clone','--no-hardlinks','--quiet',process.cwd(),repo]);
    await mkdir(path.join(repo,'.cache'),{ recursive:true });await writeFile(path.join(repo,'.cache/private-token'),'UNTRACKED_PRIVATE_FIXTURE');
    await writeFile(path.join(repo,'LICENSE'),'DIRTY_LICENSE_MUST_NOT_BE_BUNDLED');
    const a=await buildLocalRelease({ repositoryRoot:repo,outputDirectory:path.join(temp,'a') });
    const b=await buildLocalRelease({ repositoryRoot:repo,outputDirectory:path.join(temp,'b') });
    assert.equal(a.sha256,b.sha256);assert.equal(a.manifestSha256,b.manifestSha256);
    const foreign=path.join(temp,'foreign');execFileSync('/usr/bin/git',['clone','--no-hardlinks','--quiet',repo,foreign]);
    await writeFile(path.join(foreign,'docs/development/local-release.md'),'FOREIGN_REPOSITORY_FIXTURE\n');
    execFileSync('/usr/bin/git',['-C',foreign,'add','docs/development/local-release.md']);
    execFileSync('/usr/bin/git',['-C',foreign,'-c','user.name=Release fixture','-c','user.email=fixture@example.invalid',
      '-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','commit','-m','UNIT foreign repository'],{ stdio:'ignore' });
    const override={ GIT_DIR:path.join(foreign,'.git'),GIT_WORK_TREE:foreign,GIT_INDEX_FILE:path.join(foreign,'.git/index'),
      GIT_OBJECT_DIRECTORY:path.join(foreign,'.git/objects'),GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.worktree',
      GIT_CONFIG_VALUE_0:foreign,TAR_OPTIONS:'--exclude=*',GZIP:'-1' };
    const prior=Object.fromEntries(Object.keys(override).map(k=>[k,process.env[k]]));
    try {
      Object.assign(process.env,override);
      const isolated=await buildLocalRelease({ repositoryRoot:repo,outputDirectory:path.join(temp,'isolated') });
      assert.equal(isolated.sourceCommit,a.sourceCommit);assert.equal(isolated.sha256,a.sha256);
    } finally { for(const [k,v] of Object.entries(prior)) { if(v===undefined) delete process.env[k];else process.env[k]=v; } }
    const unpack=path.join(temp,'unpack');await mkdir(unpack);
    execFileSync('/usr/bin/tar',['-xzf',path.join(temp,'a',a.archive),'-C',unpack]);
    const manifest=await verifyLocalRelease(unpack);
    assert.equal(manifest.oracleRuntime,'UNVALIDATED');assert.equal(manifest.bundledExternalBinaries,false);
    assert.equal(manifest.files.some(f=>/\.cache|node_modules|docs\/inputs|evidence\/|\.git\//.test(f.path)),false);
    assert.match(await readFile(path.join(unpack,'LICENSE'),'utf8'),/PolyForm Shield/);
    assert.ok(manifest.notices.includes('experiments/db-devops-wp0/antlr-helper/notices/NOTICE.txt'));
    const pkg=JSON.parse(await readFile(path.join(unpack,'package.json')));
    assert.equal(pkg.private,true);assert.ok(pkg.scripts['release:acceptance']);assert.equal(pkg.scripts.check,undefined);
    assert.equal(selectedReleasePath('tests/product-phase7-workflow-browser.integration.mjs'),true);
    assert.equal(selectedReleasePath('tests/product-phase6-workflow-browser.integration.mjs'),true);
    assert.equal(selectedReleasePath('docs/inputs/db-research/private.md'),false);
    await assert.rejects(buildLocalRelease({ repositoryRoot:repo,outputDirectory:path.join(temp,'a') }),/EEXIST/);
    const source=path.join(unpack,'apps/api/server.ts'),before=await readFile(source);
    await writeFile(source,Buffer.concat([before,Buffer.from('// corruption\n')]));await assert.rejects(verifyLocalRelease(unpack),/verification failed/);
    await writeFile(source,before);
    await symlink('/tmp',path.join(unpack,'packages/unlisted-link'));await assert.rejects(verifyLocalRelease(unpack),/Unsafe/);
    await rm(path.join(unpack,'packages/unlisted-link'));
    await verifyLocalRelease(unpack);
    const target=path.join(unpack,'experiments/db-devops-wp0/antlr-helper/target');
    await mkdir(target);await writeFile(path.join(target,'schemaforge-antlr-parser.jar'),'UNPINNED_HELPER_FIXTURE');
    await assert.rejects(verifyLocalRelease(unpack),/Prepared parser digest mismatch/);
    await rm(target,{ recursive:true });
    await symlink('/tmp',target);await assert.rejects(verifyLocalRelease(unpack),/Unsafe prepared parser/);
    await rm(target);await verifyLocalRelease(unpack);
    await symlink('../.cache/private-token',path.join(repo,'apps/forbidden-link'));
    execFileSync('/usr/bin/git',['-C',repo,'add','apps/forbidden-link']);
    execFileSync('/usr/bin/git',['-C',repo,'-c','user.name=Release fixture','-c','user.email=fixture@example.invalid',
      '-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','commit','-m','UNIT forbidden symlink'],{ stdio:'ignore' });
    await assert.rejects(buildLocalRelease({ repositoryRoot:repo,outputDirectory:path.join(temp,'unsafe') }),/Unsafe release/);
  } finally { await rm(temp,{ recursive:true,force:true }); }
});
