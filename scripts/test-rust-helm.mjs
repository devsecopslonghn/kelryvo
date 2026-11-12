// Prepare and validate the native chart patch in a new private Git fixture.
// The supplied checkout is read only; no kubectl, publication or cluster access.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmod,lstat,mkdtemp,readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const root=path.resolve('.'),args=process.argv.slice(2);
assert(args.length===1&&path.isAbsolute(args[0]),'Usage: node scripts/test-rust-helm.mjs ABSOLUTE_COMPANION_CHECKOUT');
const chart=await realpath(args[0]);
const env={PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'};
const git=(cwd,...args)=>execFileSync('/usr/bin/git',['--no-optional-locks','-c','core.hooksPath=/dev/null','-c','core.fsmonitor=false',...args],{cwd,env,maxBuffer:16*1024*1024,timeout:30000});
const head=git(chart,'rev-parse','HEAD').toString().trim();
assert.equal(git(chart,'status','--porcelain').length,0,'Companion checkout must be clean for an exact candidate');
const patch=await readFile('deploy/native-oracle-helm.patch');
const base=patch.toString().match(/^Base-commit: ([a-f0-9]{40})$/m)?.[1];
assert.equal(head,base,'Patch base must match the inspected companion revision');
const tree=git(chart,'ls-tree','-rz','--full-tree',head).toString().split('\0').filter(Boolean);
assert(tree.length>0&&tree.length<512);
for(const entry of tree){
  const [metadata,name]=entry.split('\t'),[mode,type]=metadata.split(' ');
  assert(['100644','100755'].includes(mode)&&type==='blob');
  assert(name&&!name.startsWith('/')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p!=='.git'));
}
const candidate=await mkdtemp(path.join(root,'.cache/native-helm-checked.'));
execFileSync('/usr/bin/tar',['-xf','-','--no-same-owner','--no-same-permissions','-C',candidate],{input:git(chart,'archive','--format=tar',head),env,timeout:30000});
for(const entry of tree){
  const [metadata,name]=entry.split('\t'),[mode,,oid]=metadata.split(' '),file=path.join(candidate,name),info=await lstat(file);
  assert(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);
  const bytes=await readFile(file);
  assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'),oid,'Archived source must equal its pinned Git blob: '+name);
  await chmod(file,mode==='100755'?0o755:0o644);
}
git(candidate,'init','--initial-branch=candidate');
// Use stdin explicitly; neither Git config nor command substitution selects a patch.
execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','apply','--check','-'],{cwd:candidate,env,input:patch,timeout:30000});
execFileSync('/usr/bin/git',['-c','core.hooksPath=/dev/null','apply','-'],{cwd:candidate,env,input:patch,timeout:30000});
git(candidate,'add','--','.');
execFileSync('/usr/bin/python3',['scripts/check-chart.py'],{cwd:candidate,env,stdio:'inherit',timeout:120000});
assert.equal(git(chart,'rev-parse','HEAD').toString().trim(),head);
assert.equal(git(chart,'status','--porcelain').length,0,'Companion source must remain unchanged');
console.log('PASS: native Helm candidate, retained chart checks and native init/controller/prerequisite contracts; companion source unchanged. No cluster access or Oracle qualification.');
console.log('Private candidate: '+candidate);
