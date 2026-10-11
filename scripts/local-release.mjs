import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, lstat, chmod, readdir, rm, link } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestName = 'release-manifest.json';
const scripts = new Set(['antlr-build','antlr-prepare','build-web','check-source','local-backup-operator',
  'local-credential-operator','local-dev','local-inventory-operator','local-membership-operator',
  'local-operator-config','local-prepare','local-repositories','local-resources','local-tls',
  'product-dependencies','release-acceptance','local-release']);
const tests = new Set(['product-mvp-workflow.test.mjs','product-mvp-workflow-browser.integration.mjs',
  'product-secure-sessions-browser.integration.mjs','product-release-acceptance.integration.mjs']);
const fixed = new Set(['LICENSE','NOTICE','.nvmrc','package.json','package-lock.json','tsconfig.json',
  'docs/development/local-product.md','docs/development/local-release.md','docs/product/license-and-naming.md',
  'docs/architecture/boundaries.md']);
export function selectedReleasePath(name) {
  return fixed.has(name) || /^(apps|packages)\//.test(name) || name.startsWith('docs/dependencies/')
    || name.startsWith('experiments/db-devops-wp0/antlr-helper/')
    || /^experiments\/db-devops-wp0\/(antlr-envelope|parser-envelope|parser-release)\.mjs$/.test(name)
    || name.startsWith('tests/helpers/') || tests.has(name.replace(/^tests\//,''))
    || /^scripts\/([^/]+)\.mjs$/.test(name) && scripts.has(name.slice(8,-4));
}
const safePath = name => typeof name === 'string' && /^[A-Za-z0-9._/-]{1,240}$/.test(name)
  && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..')
  && !name.split('/').some(part => ['.git','.cache','node_modules','dist','target','wallet'].includes(part))
  && !/(^|\/)\.env($|\.)|\.(pem|key|p12|pfx)$/i.test(name);
function run(program, args, cwd, input) {
  const r=spawnSync(program,args,{ cwd,input,encoding:null,timeout:60_000,maxBuffer:32*1024*1024,
    env:{ ...process.env, PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC',GIT_CONFIG_NOSYSTEM:'1' } });
  if (r.error || r.status !== 0) throw new Error('Release tool failed');
  return r.stdout;
}
async function plainParents(directory) {
  let cursor=path.parse(directory).root;
  for (const part of directory.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor=path.join(cursor,part); const stat=await lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Release path must contain regular directories');
  }
}
export async function buildLocalRelease({ repositoryRoot=root, outputDirectory, commit='HEAD' }) {
  if (!outputDirectory || !/^(HEAD|[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid release arguments');
  const source=path.resolve(repositoryRoot), output=path.resolve(outputDirectory);
  await plainParents(path.dirname(output));
  const revision=run('/usr/bin/git',['rev-parse','--verify',`${commit}^{commit}`],source).toString().trim();
  const objectFormat=run('/usr/bin/git',['rev-parse','--show-object-format'],source).toString().trim();
  if (!/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(revision) || !['sha1','sha256'].includes(objectFormat)) throw new Error('Invalid source revision');
  const entries=run('/usr/bin/git',['ls-tree','-rz','--full-tree',revision],source).toString().split('\0').filter(Boolean)
    .map(line=>{const [metadata,name]=line.split('\t');const [mode,type,oid]=metadata.split(' ');return { name,mode,type,oid };})
    .filter(entry=>selectedReleasePath(entry.name));
  if (!entries.length || entries.some(e=>!safePath(e.name) || e.type!=='blob' || !['100644','100755'].includes(e.mode))) throw new Error('Unsafe release source entry');
  await mkdir(output,{ mode:0o700 }); // Exclusive: preserve existing installations and artifacts.
  const stage=await mkdtemp(path.join(output,'.build-'));
  try {
    const tree=path.join(stage,'source');await mkdir(tree,{ mode:0o700 });
    const archive=run('/usr/bin/git',['-c','core.attributesFile=/dev/null','archive','--format=tar',revision,'--',...entries.map(e=>e.name)],source);
    run('/usr/bin/tar',['-xf','-','--no-same-owner','--no-same-permissions','-C',tree],source,archive);
    for (const e of entries) {
      const p=path.join(tree,e.name);const stat=await lstat(p);if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe archived entry');
      const bytes=await readFile(p);const blob=createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (blob!==e.oid) throw new Error('Git archive differs from committed source');
      await chmod(p,0o644);
    }
    for (const name of fixed) await readFile(path.join(tree,name));
    const pkg=JSON.parse(await readFile(path.join(tree,'package.json')));
    await mkdir(path.join(tree,'release'));
    await writeFile(path.join(tree,'release/source-package.json'),await readFile(path.join(tree,'package.json')),{ mode:0o644 });
    const names=['build:web','typecheck','local:prepare','local:credentials','local:backup-restore','local:membership','dev',
      'parser:antlr:prepare','parser:antlr:build','dependencies:product'];
    pkg.scripts=Object.fromEntries(names.map(name=>{if (!pkg.scripts[name]) throw new Error('Missing operating command');return [name,pkg.scripts[name]];}));
    pkg.scripts.build='npm run typecheck && npm run build:web';
    pkg.scripts['release:verify']='node scripts/local-release.mjs verify';
    pkg.scripts['release:acceptance']='node scripts/release-acceptance.mjs';
    await writeFile(path.join(tree,'package.json'),JSON.stringify(pkg,null,2)+'\n',{ mode:0o644 });
    await writeFile(path.join(tree,'README.md'),await readFile(path.join(tree,'docs/development/local-release.md')),{ mode:0o644 });
    const files=await inventory(tree);
    const lock=JSON.parse(await readFile(path.join(tree,'docs/dependencies/antlr-parser-lock.json')));
    const manifest={ format:'schemaforge-local-source-v1',sourceCommit:revision,objectFormat,
      scope:'LOCAL_SOURCE_INSTALLATION_CANDIDATE',oracleRuntime:'UNVALIDATED',
      bundledExternalBinaries:false,packageScriptsProjected:true,
      notices:['LICENSE','NOTICE','docs/dependencies/product-NOTICES.txt',...lock.notices.map(n=>n.path)],files };
    await writeFile(path.join(tree,manifestName),JSON.stringify(manifest,null,2)+'\n',{ mode:0o644 });
    await verifyLocalRelease(tree);
    const filename=`schemaforge-local-${revision.slice(0,12)}.tar.gz`,temporary=path.join(stage,filename);
    run('/usr/bin/tar',['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','--format=ustar','-czf',temporary,'-C',tree,'.'],source);
    const archiveBytes=await readFile(temporary);await chmod(temporary,0o600);await link(temporary,path.join(output,filename));
    const result={ format:'schemaforge-local-source-checksum-v1',sourceCommit:revision,archive:filename,
      sha256:sha(archiveBytes),bytes:archiveBytes.length,manifestSha256:sha(await readFile(path.join(tree,manifestName))),
      files:files.length,scope:manifest.scope,oracleRuntime:manifest.oracleRuntime };
    await writeFile(path.join(output,'checksums.json'),JSON.stringify(result,null,2)+'\n',{ flag:'wx',mode:0o600 });
    return result;
  } finally { await rm(stage,{ recursive:true,force:true }); }
}
async function inventory(directory, prefix='') {
  const files=[];
  for (const name of (await readdir(path.join(directory,prefix))).sort()) {
    const relative=prefix ? `${prefix}/${name}` : name;
    if (!prefix && ['node_modules','.cache','dist',manifestName].includes(name)) continue;
    if (!safePath(relative)) throw new Error('Unsafe installation entry');
    const p=path.join(directory,relative),stat=await lstat(p);
    if (stat.isDirectory()) files.push(...await inventory(directory,relative));
    else if (stat.isFile() && stat.nlink===1) files.push({ path:relative,bytes:stat.size,sha256:sha(await readFile(p)) });
    else throw new Error('Unsafe installation entry');
  }
  return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
export async function verifyLocalRelease(directory=root) {
  await plainParents(path.resolve(directory));
  const file=path.join(directory,manifestName),stat=await lstat(file);
  if (!stat.isFile() || stat.nlink!==1 || stat.size>1024*1024) throw new Error('Invalid release manifest');
  const manifest=JSON.parse(await readFile(file));
  if (manifest.format!=='schemaforge-local-source-v1' || !/^[a-f0-9]{40}$|^[a-f0-9]{64}$/.test(manifest.sourceCommit)
      || manifest.scope!=='LOCAL_SOURCE_INSTALLATION_CANDIDATE' || manifest.oracleRuntime!=='UNVALIDATED'
      || manifest.bundledExternalBinaries!==false || manifest.packageScriptsProjected!==true
      || !Array.isArray(manifest.files) || manifest.files.length>2048
      || JSON.stringify(await inventory(directory))!==JSON.stringify(manifest.files)) throw new Error('Release source verification failed');
  for (const name of ['LICENSE','NOTICE','package-lock.json',...manifest.notices]) {
    if (!manifest.files.some(f=>f.path===name)) throw new Error('Required release notice missing');
  }
  const closure=JSON.parse(await readFile(path.join(directory,'docs/dependencies/product-closure.json')));
  if (closure.notice_path!=='docs/dependencies/product-NOTICES.txt' || closure.unknown_required_grants!==0 || closure.package_lock_sha256!==sha(await readFile(path.join(directory,'package-lock.json')))
      || closure.notice_sha256!==sha(await readFile(path.join(directory,closure.notice_path)))) throw new Error('Release license closure mismatch');
  const parser=JSON.parse(await readFile(path.join(directory,'docs/dependencies/antlr-parser-lock.json')));
  for (const item of [...parser.grammar_files,...parser.notices]) {
    if (!safePath(item.path) || !manifest.files.some(f=>f.path===item.path)
        || sha(await readFile(path.join(directory,item.path)))!==item.sha256) throw new Error('Parser source/notice mismatch');
  }
  return manifest;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const { values,positionals }=parseArgs({ options:{ output:{ type:'string' },commit:{ type:'string' } },allowPositionals:true,strict:true });
    if (positionals.length!==1 || !['build','verify'].includes(positionals[0])) throw new Error('Usage: local-release.mjs build --output NEW_DIRECTORY | verify');
    if (positionals[0]==='verify') { if (Object.keys(values).length) throw new Error('Invalid verification options');await verifyLocalRelease(root);console.log('Local source bundle verified; Oracle runtime remains unvalidated.'); }
    else console.log(JSON.stringify(await buildLocalRelease({ outputDirectory:values.output,commit:values.commit }),null,2));
  } catch { console.error('Local release failed: check committed source, notices and a new regular output directory.');process.exitCode=1; }
}
