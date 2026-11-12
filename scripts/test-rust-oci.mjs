// Native local OCI verification/assembly, checked against frozen delivery
// fixtures. Tiny synthetic layers are not runnable images or qualification.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,symlink,stat} from 'node:fs/promises';
import path from 'node:path';
const cli=path.resolve('target/debug/kelryvo');
const sha='a'.repeat(40), source='https://github.com/devsecopslonghn/kelryvo';
const digest=bytes=>`sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const root=await mkdtemp(path.resolve('.cache/rust-oci-'));
function native(args,ok=true,env={}){
  const r=spawnSync(cli,['oci',...args],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024,env:{PATH:'/usr/bin:/bin',LANG:'C',...env}});
  assert(!r.error,r.error?.message);assert.equal(r.status===0,ok,`${args[0]}: ${r.stderr}`);
  return ok?JSON.parse(r.stdout):r.stderr;
}
async function fixture(name,{role=false,revision=false,size=false,corrupt=false,duplicate=false,platform=false,hidden=false,link=false,timestamp='one'}={}){
  const directory=path.join(root,name);await mkdir(directory,{mode:0o700});
  for(const arch of ['amd64','arm64']){
    const layout=path.join(directory,arch);const blobs=path.join(layout,'blobs/sha256');await mkdir(blobs,{recursive:true,mode:0o700});
    const write=async value=>{const b=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));const hash=digest(b);await writeFile(path.join(blobs,hash.slice(7)),b);return {digest:hash,size:b.length};};
    const config=await write({architecture:arch,os:'linux',config:{User:role?'10001:10001':'0:0',Entrypoint:['/opt/kelryvo/bin/kelryvo-runtime'],Labels:{'org.opencontainers.image.revision':revision?'b'.repeat(40):sha,'org.opencontainers.image.source':source,'dev.kelryvo.implementation':'rust'}}});
    const layer=await write(Buffer.from('fixture layer; never a runnable image'));
    if(corrupt)await writeFile(path.join(blobs,layer.digest.slice(7)),'corrupt fixture layer');
    const manifest=await write({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',config:{mediaType:'application/vnd.oci.image.config.v1+json',...config},layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar',...layer,size:layer.size+(size?1:0)}]});
    await writeFile(path.join(layout,'oci-layout'),JSON.stringify({imageLayoutVersion:'1.0.0'}));
    await writeFile(path.join(layout,'index.json'),JSON.stringify({schemaVersion:2,manifests:[{mediaType:'application/vnd.oci.image.manifest.v1+json',...manifest,...(platform?{platform:{os:'linux',architecture:arch==='amd64'?'arm64':'amd64'}}:{}),annotations:{'org.opencontainers.image.created':timestamp}}]}));
    const members=['oci-layout','index.json','blobs'];if(duplicate)members.push('index.json');
    if(link){await symlink(path.join(directory,'outside'),path.join(layout,'untrusted-link'));members.push('untrusted-link');}
    const archive=path.join(directory,`app-${arch}.tar`);
    execFileSync('/usr/bin/tar',['-C',layout,'-cf',archive,...members]);
    if(hidden)await writeFile(archive,Buffer.concat([await readFile(archive),Buffer.from('hidden appended content')]));
  }
  return directory;
}
const captured=JSON.parse(await readFile('tests/fixtures/contracts/oci.json','utf8'));
const fresh=await fixture('native');
for(const arch of ['amd64','arm64']){
  const archive=path.join(fresh,`app-${arch}.tar`);
  assert.deepEqual(native(['verify-platform',archive,sha,arch]),captured.platforms[arch]);
  const inspected=native(['inspect',archive]);assert.equal(inspected.blobs,3);assert.equal(inspected.qualification,'NOT_RUN');assert.equal(inspected.sourceAndRoleVerified,false);
}
const expected=captured.index;
const assembled=native(['assemble',fresh,sha],true,{TAR_OPTIONS:'--remove-files',GZIP:'--invalid'});
assert.deepEqual(assembled,expected);
const output=path.join(fresh,'kelryvo-app.tar'),before=await readFile(output);
assert.deepEqual(native(['verify',output,sha]),expected);
assert.equal((await stat(output)).mode&0o777,0o600);
native(['assemble',fresh,sha],false);assert.deepEqual(await readFile(output),before,'existing artifacts survive repeat assembly');
const retry=await fixture('re-export',{timestamp:'different exporter timestamp'});
assert.deepEqual(native(['assemble',retry,sha]),expected);
assert.deepEqual(await readFile(path.join(retry,'kelryvo-app.tar')),before,'entire assembled archive is deterministic');
const skopeo=spawnSync('/usr/bin/skopeo',['--version']);
if(skopeo.status===0){
  execFileSync('/usr/bin/skopeo',['copy','--all','--preserve-digests',`oci-archive:${output}`,`oci:${path.join(root,'skopeo-copy')}:verified`],{stdio:'ignore'});
  const bytes=execFileSync('/usr/bin/skopeo',['inspect','--raw',`oci:${path.join(root,'skopeo-copy')}:verified`]);
  assert.equal(digest(bytes.toString().trim()),expected.digest);
}
for(const [name,options] of Object.entries({role:{role:true},revision:{revision:true},size:{size:true},corrupt:{corrupt:true},platform:{platform:true}})){
  const bad=await fixture(name,options),archive=path.join(bad,'app-amd64.tar');
  native(['verify-platform',archive,sha,'amd64'],false);native(['assemble',bad,sha],false);
}
for(const [name,options] of Object.entries({duplicate:{duplicate:true},hidden:{hidden:true},link:{link:true}})){
  const bad=await fixture(name,options);native(['inspect',path.join(bad,'app-amd64.tar')],false);
}
await symlink(path.join(fresh,'app-amd64.tar'),path.join(root,'linked.tar'));
native(['verify-platform',path.join(root,'linked.tar'),sha,'amd64'],false);
native(['verify',output,'local-unpublished'],false);
assert.deepEqual(await readFile(output),before);
console.log('PASS: native OCI CLI matches frozen source/role/platform/blob contracts and index digests; deterministic two-platform assembly, skopeo copy, private exclusive output, malformed/duplicate/linked/trailing-data rejection and no external command environment authority. Synthetic layers do not qualify a release.');
