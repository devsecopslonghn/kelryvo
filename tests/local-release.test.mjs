import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildLocalRelease, verifyLocalRelease, selectedReleasePath } from '../scripts/local-release.mjs';

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
    const unpack=path.join(temp,'unpack');await mkdir(unpack);
    execFileSync('/usr/bin/tar',['-xzf',path.join(temp,'a',a.archive),'-C',unpack]);
    const manifest=await verifyLocalRelease(unpack);
    assert.equal(manifest.oracleRuntime,'UNVALIDATED');assert.equal(manifest.bundledExternalBinaries,false);
    assert.equal(manifest.files.some(f=>/\.cache|node_modules|docs\/inputs|evidence\/|\.git\//.test(f.path)),false);
    assert.match(await readFile(path.join(unpack,'LICENSE'),'utf8'),/PolyForm Shield/);
    assert.ok(manifest.notices.includes('experiments/db-devops-wp0/antlr-helper/notices/NOTICE.txt'));
    const pkg=JSON.parse(await readFile(path.join(unpack,'package.json')));
    assert.equal(pkg.private,true);assert.ok(pkg.scripts['release:acceptance']);assert.equal(pkg.scripts.check,undefined);
    assert.equal(selectedReleasePath('docs/inputs/db-research/private.md'),false);
    await assert.rejects(buildLocalRelease({ repositoryRoot:repo,outputDirectory:path.join(temp,'a') }),/EEXIST/);
    const source=path.join(unpack,'apps/api/server.ts'),before=await readFile(source);
    await writeFile(source,Buffer.concat([before,Buffer.from('// corruption\n')]));await assert.rejects(verifyLocalRelease(unpack),/verification failed/);
    await writeFile(source,before);
    await symlink('/tmp',path.join(unpack,'packages/unlisted-link'));await assert.rejects(verifyLocalRelease(unpack),/Unsafe/);
    await rm(path.join(unpack,'packages/unlisted-link'));
    await verifyLocalRelease(unpack);
    await symlink('../.cache/private-token',path.join(repo,'apps/forbidden-link'));
    execFileSync('/usr/bin/git',['-C',repo,'add','apps/forbidden-link']);
    execFileSync('/usr/bin/git',['-C',repo,'-c','user.name=Release fixture','-c','user.email=fixture@example.invalid',
      '-c','core.hooksPath=/dev/null','-c','commit.gpgSign=false','commit','-m','UNIT forbidden symlink'],{ stdio:'ignore' });
    await assert.rejects(buildLocalRelease({ repositoryRoot:repo,outputDirectory:path.join(temp,'unsafe') }),/Unsafe release/);
  } finally { await rm(temp,{ recursive:true,force:true }); }
});
