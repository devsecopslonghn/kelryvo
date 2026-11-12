import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadOCIPlatform} from '../scripts/load-oci-platform.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=name=>readFile(path.join(root,name),'utf8');

test('native checkout and workflows have no retired application or missing script dependency',async()=>{
  const pkg=JSON.parse(await read('package.json'));
  assert.equal(Object.keys(pkg.dependencies??{}).length,0);
  assert(Object.values(pkg.devDependencies).length>0);
  assert(Object.keys(pkg.scripts).every(name=>!name.startsWith('reference:')));
  const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(name=>name&&existsSync(path.join(root,name)));
  assert.deepEqual(paths.filter(name=>/^(apps|packages|experiments)\//.test(name)),[]);
  const sources=paths.filter(name=>name.startsWith('scripts/')||name.startsWith('.github/workflows/'));
  for(const name of sources){
    const source=await read(name);
    assert(!/from\s+['"][^'"]*(?:packages\/|apps\/)/.test(source),`${name}: retired import`);
    for(const match of source.matchAll(/npm run ([a-z][a-z0-9:-]*)/g))assert(pkg.scripts[match[1]],`${name}: missing npm command ${match[1]}`);
    for(const match of source.matchAll(/(?:node|python3|bash) (scripts\/[a-zA-Z0-9_.-]+)/g))assert(existsSync(path.join(root,match[1])),`${name}: missing ${match[1]}`);
  }
});

test('frozen migration contract inventory matches its captured bytes',async()=>{
  const directory='tests/fixtures/contracts';
  const provenance=JSON.parse(await read(`${directory}/provenance.json`));
  const names=(await readdir(path.join(root,directory))).filter(name=>name.endsWith('.json')&&name!=='provenance.json').sort();
  assert.deepEqual(Object.keys(provenance.sha256).sort(),names);
  for(const name of names){
    const bytes=await readFile(path.join(root,directory,name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),provenance.sha256[name],name);
    JSON.parse(bytes);
  }
  assert.equal(JSON.parse(await read(`${directory}/routes.json`)).length,169);
  assert.equal(JSON.parse(await read(`${directory}/core.json`)).length,1228);
});

test('an unverified OCI archive cannot reach the image loader',()=>{
  const operations=[];
  assert.throws(()=>loadOCIPlatform('/nonexistent-kelryvo-fixture.tar','a'.repeat(40),'amd64',{run:args=>operations.push(args)}));
  assert.deepEqual(operations,[]);
});
