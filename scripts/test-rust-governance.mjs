// Run the retained HTTPS governance smoke against the actual native artifact in
// the private runtime namespace. Host Node stays outside the production image.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import {smokeGovernance} from './kelryvo-smoke.mjs';

const root=process.argv[2];
const cache=path.resolve('.cache');
assert(root&&path.isAbsolute(root)&&path.basename(root)==='root');
assert.equal(path.dirname(path.dirname(root)),cache);
assert(path.basename(path.dirname(root)).startsWith('rust-runtime-'));
assert.equal(process.getuid(),0);
const secrets=path.join(root,'run/kelryvo/secrets');
const tokens={};
for(const role of ['developer','approver'])tokens[role]=(await readFile(path.join(secrets,`${role}-token`),'utf8')).trim();
const command=(binary,args)=>execFileSync('/usr/sbin/chroot',[root,binary,...args],{
  env:{PATH:'/usr/bin:/bin',LANG:'C',TZ:'UTC'},encoding:'utf8',timeout:30000,maxBuffer:1024*1024,
  stdio:['ignore','pipe','pipe'],
});
let stage='configuration';
try{
  const result=await smokeGovernance({origin:'https://127.0.0.1:8443',ca:await readFile(path.join(secrets,'tls.crt')),tokens,
    repositoryId:'local-1',onStep:value=>{stage=value;},
    operator:async(...args)=>command('/opt/kelryvo/bin/kelryvo-operator',args),
    rotate:async(role,token)=>{
      assert(['developer','approver'].includes(role));assert(/^[a-f0-9]{64}$/.test(token));
      const file=path.join(secrets,`${role}-token`);
      await chmod(file,0o600);await writeFile(file,token,{mode:0o600});
      command('/usr/bin/setpriv',['--bounding-set=-all,+chown,+kill,+setuid,+setgid','--no-new-privs',
        '/opt/kelryvo/bin/kelryvo-runtime','--prepare']);
      for(const status of ['ROTATED','ALREADY_ACTIVE']){
        const output=JSON.parse(command('/opt/kelryvo/bin/kelryvo-operator',['credential-rotate',role]));
        assert.equal(output.status,status);assert.equal(output.expiryExtended,false);
      }
    },
  });
  await result.verify();
  console.log('PASS: native artifact HTTPS governance, CSRF, Git/parser, independent approval, explicit grants, durable cancellation, session revocation and idempotent credential rotation. Oracle NOT_RUN.');
}catch{
  console.error(`Native artifact governance failed during ${stage}; private command/response bodies omitted.`);
  process.exitCode=1;
}
