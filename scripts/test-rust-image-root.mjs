// Exact exported-image contract in disposable mount/PID/network namespaces.
// Optional BuildKit QEMU stays in the test copy; no host binfmt registration.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmod,copyFile,lstat,mkdir,mkdtemp,readFile,realpath,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cache=path.join(repository,'.cache');
const hostArchitecture={x64:'x86_64',arm64:'aarch64'}[process.arch];
const cli=process.env.KELRYVO_RUST_CLI??path.join(repository,'target/debug/kelryvo');
assert(path.isAbsolute(cli),'Explicit host verification tool must be absolute');
const identityAt=root=>path.join(root,'opt/kelryvo/source-identity.json');
async function identity(root){
  const value=JSON.parse(await readFile(identityAt(root),'utf8'));
  assert.equal(value.format,2);assert.equal(value.implementation,'RUST');
  assert(['x86_64','aarch64'].includes(value.architecture));
  assert.equal(value.profile,'release');assert(/^[a-f0-9]{64}$/.test(value.sourceTreeDigest));
  return value;
}
function host(command,args){
  return execFileSync(command,args,{env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',TZ:'UTC'},encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
}
async function namespace(root,mode){
  assert.equal(process.getuid(),0);assert.equal(process.pid,1);
  assert.equal(root,await realpath(root));
  assert.equal(path.dirname(path.dirname(root)),cache);
  assert(path.basename(path.dirname(root)).startsWith('rust-image-contract.'));
  assert.equal(path.basename(root),'root');assert(['native','emulated'].includes(mode));
  const expected=await identity(root);
  host('/usr/bin/mount',['--make-rprivate','/']);
  host('/usr/bin/chown',['-Rh','0:0',root]);
  host('/usr/bin/mount',['--bind',root,root]);
  host('/usr/bin/mount',['--bind','/dev/null',path.join(root,'dev/null')]);
  host('/usr/bin/mount',['-t','proc','proc',path.join(root,'proc')]);
  host('/usr/bin/mount',['-o','remount,bind,ro',root]);
  const emulator=mode==='emulated'?['/dev/.buildkit_qemu_emulator']:[];
  function run(binary,args=[],{uid=0,caps='-all',success=true,error}={}){
    const privilege=uid===0?['--bounding-set='+caps,'--no-new-privs']:['--no-new-privs'];
    const options=uid===0?[]:[`--userspec=${uid}:${uid}`,`--groups=${uid}`];
    const result=spawnSync('/usr/sbin/chroot',[...options,root,...emulator,'/usr/bin/setpriv',...privilege,binary,...args],{
      env:{PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC'},encoding:'utf8',input:'',timeout:120000,maxBuffer:2*1024*1024,
    });
    assert.ifError(result.error);
    assert.equal(result.signal,null,`${binary}: unexpected signal ${result.signal}`);
    assert.equal(result.status,success?0:1,`${binary}: ${result.stderr}`);
    if(error)assert(result.stderr.includes(error),`${binary}: intended role refusal missing: ${result.stderr}`);
    return result.stdout.trim();
  }
  const architecture=run('/bin/uname',['-m']);assert.equal(architecture,expected.architecture);
  run('/bin/sh',['-ec',
    'test "$(id -u)" = 0; grep -Eq "^CapEff:[[:space:]]+0000000000000000$" /proc/self/status; grep -Eq "^CapBnd:[[:space:]]+0000000000000000$" /proc/self/status; grep -Eq "^NoNewPrivs:[[:space:]]+1$" /proc/self/status']);
  let common;
  for(const name of ['kelryvo','kelryvo-server','kelryvo-worker','kelryvo-operator','kelryvo-runtime']){
    const info=JSON.parse(run(`/opt/kelryvo/bin/${name}`,['--build-info']));
    assert.equal(info.implementation,'RUST');assert.equal(info.os,'linux');
    for(const field of ['sourceSha','sourceTreeDigest','profile','architecture'])assert.equal(info[field],expected[field],name);
    common??=info;assert.deepEqual(info,common);
  }
  run('/opt/kelryvo/bin/kelryvo',['verify-dist','/opt/kelryvo']);
  run('/bin/sh',['-ec',
    'test -s /opt/licenses/os/runtime-inventory.json; test -s /opt/kelryvo/licenses/cargo-inventory.json; test -s /opt/kelryvo/dist/rust-web/app_bg.wasm; for tool in node nodejs npm java javac python3 cargo rustc wasm-bindgen; do if command -v "$tool"; then exit 1; fi; done']);
  for(const uid of [10001,10002]){
    assert.equal(run('/usr/bin/id',['-u'],{uid}),String(uid));
    run('/opt/kelryvo/bin/kelryvo-operator',['initialize'],{uid,success:false,error:'Operator action unavailable.'});
  }
  run('/opt/kelryvo/bin/kelryvo-worker',['discovery-child'],{uid:10001,success:false,error:'Worker unavailable'});
  run('/opt/kelryvo/bin/kelryvo-runtime',[],{caps:'-all,+chown,+kill,+setuid,+setgid',success:false,error:'Kelryvo runtime unavailable.'});
  console.log(JSON.stringify({architecture,emulated:mode==='emulated',releaseBinaries:5,sourceTreeDigest:expected.sourceTreeDigest,sourceSha:expected.sourceSha,qualification:'NOT_RUN'}));
}
async function main(){
  const args=process.argv.slice(2);
  if(args[0]==='--namespace'){
    assert.equal(args.length,3);await namespace(args[1],args[2]);return;
  }
  assert(args.length===1||args.length===2,'Usage: node scripts/test-rust-image-root.mjs ABSOLUTE_IMAGE_ROOT [ABSOLUTE_BUILDKIT_QEMU]');
  const [imageRoot,qemu]=args;
  assert(path.isAbsolute(imageRoot));assert.equal(imageRoot,await realpath(imageRoot));
  assert.equal(path.dirname(path.dirname(imageRoot)),cache);
  assert(path.basename(path.dirname(imageRoot)).startsWith('buildkit-overlay.'));
  const expected=await identity(imageRoot);
  assert.equal(Boolean(qemu),expected.architecture!==hostArchitecture,'Use an explicit emulator only for a foreign image architecture');
  if(qemu){assert(path.isAbsolute(qemu));const stat=await lstat(qemu);assert(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o111)!==0);}
  host(cli,['verify-dist',path.join(imageRoot,'opt/kelryvo')]);
  const fixture=await mkdtemp(path.join(cache,'rust-image-contract.'));
  const root=path.join(fixture,'root');await mkdir(root,{mode:0o755});
  host('/usr/bin/cp',['-a','--reflink=auto',`${imageRoot}/.`,root]);await chmod(root,0o755);
  for(const name of ['dev','proc']){try{await mkdir(path.join(root,name));}catch(error){if(error.code!=='EEXIST')throw error;}}
  await writeFile(path.join(root,'dev/null'),'');
  if(qemu){await copyFile(qemu,path.join(root,'dev/.buildkit_qemu_emulator'));await chmod(path.join(root,'dev/.buildkit_qemu_emulator'),0o555);}
  const mode=qemu?'emulated':'native';
  const output=host('/usr/bin/sudo',['-n','/usr/bin/unshare','--mount','--pid','--net','--fork','--mount-proc','--kill-child=SIGKILL',
    '/usr/bin/env','-i','PATH=/usr/sbin:/usr/bin:/sbin:/bin','LANG=C','TZ=UTC',process.execPath,fileURLToPath(import.meta.url),'--namespace',root,mode]);
  const report=JSON.parse(output);assert.equal(report.architecture,expected.architecture);assert.equal(report.emulated,Boolean(qemu));
  host(cli,['verify-dist',path.join(imageRoot,'opt/kelryvo')]);
  await writeFile(path.join(fixture,'result.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log(`PASS: ${mode} ${report.architecture} exported-image identity, read-only root, empty network namespace, capability drop, role UID refusals, bundle inventory and missing protected mounts. This does not qualify Docker Engine, TLS/PID1 supervision or Oracle.`);
}
try{await main();}catch(error){console.error(error.message);process.exitCode=1;}
