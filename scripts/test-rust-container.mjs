// Native image contract. No publication, Oracle or remote mutation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
const [image,architecture,revision]=process.argv.slice(2);
assert(image&&['amd64','arm64'].includes(architecture)&&/^[a-f0-9]{40}$/.test(revision??''));
function run(args,success=true){
  const result=spawnSync('/usr/bin/docker',['--host','unix:///var/run/docker.sock',...args],{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024});
  assert(!result.error,`Docker command unavailable: ${result.error?.message??''}`);
  assert.equal(result.status===0,success,`Native image command failed: ${JSON.stringify(args)}; ${result.stderr??''}`);
  return result.stdout.trim();
}
const config=JSON.parse(run(['image','inspect',image]))[0];
assert.equal(config.Architecture,architecture);assert.equal(config.Os,'linux');
assert.equal(config.Config.User,'0:0');assert.deepEqual(config.Config.Entrypoint,['/opt/kelryvo/bin/kelryvo-runtime']);
assert.equal(config.Config.Labels['dev.kelryvo.implementation'],'rust');
assert.equal(config.Config.Labels['org.opencontainers.image.revision'],revision);
const security=['--network','none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges'];
let identity;
for(const binary of ['kelryvo','kelryvo-server','kelryvo-worker','kelryvo-operator','kelryvo-runtime']){
  const info=JSON.parse(run(['run','--rm',...security,'--entrypoint',`/opt/kelryvo/bin/${binary}`,image,'--build-info']));
  assert.equal(info.sourceSha,revision);assert.equal(info.profile,'release');assert.equal(info.implementation,'RUST');
  assert.equal(info.architecture,architecture==='amd64'?'x86_64':'aarch64');assert(/^[a-f0-9]{64}$/.test(info.sourceTreeDigest));
  identity??=info;assert.deepEqual(info,identity);
}
run(['run','--rm',...security,'--entrypoint','/opt/kelryvo/bin/kelryvo',image,'verify-dist','/opt/kelryvo']);
// Existence checks execute only the image's shell and test builtin. A host tool
// never assumes that Node/Python/JVM or a Rust build tool lives in this image.
run(['run','--rm',...security,'--entrypoint','/bin/sh',image,'-ec',
  'test -s /opt/licenses/os/runtime-inventory.json; test -s /opt/kelryvo/licenses/cargo-inventory.json; test -s /opt/kelryvo/dist/rust-web/app_bg.wasm; for tool in node nodejs npm java javac python3 cargo rustc wasm-bindgen; do if command -v "$tool"; then exit 1; fi; done']);
run(['run','--rm',...security,'--user','10001:10001','--entrypoint','/opt/kelryvo/bin/kelryvo-worker',image,'discovery-child'],false);
run(['run','--rm',...security,'--user','10001:10001','--entrypoint','/opt/kelryvo/bin/kelryvo-operator',image,'initialize'],false);
run(['run','--rm',...security,image],false); // Missing protected mounts cannot launch roles.
console.log('PASS: native image architecture, release source identity, exact bundle inventory, native prerequisites, unprivileged role guards and missing-secret rejection. TLS/PID1/Oracle qualification remains separate.');
