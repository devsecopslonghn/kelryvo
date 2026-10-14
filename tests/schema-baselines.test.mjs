import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSchema, compareSchemas } from '../packages/schema-baselines/contracts.mjs';

const coverage={TABLE:'COMPLETE',VIEW:'COMPLETE',SEQUENCE:'COMPLETE',INDEX:'COMPLETE',DEPENDENCY:'COMPLETE'};
const snapshot=(owner,objects,cv=coverage,identityDigest='a'.repeat(64))=>({owner,identityDigest,schema:normalizeSchema({owner,objects,coverage:cv},owner)});

test('normalizes exact owner and names, sorts objects, and gives stable checksums',()=>{
  const one=normalizeSchema({objects:[{owner:'MiXeD',type:'TABLE',name:'tName',definition:{b:2,a:1}}],coverage},'MiXeD');
  const two=normalizeSchema({objects:[{owner:'MiXeD',type:'TABLE',name:'tName',definition:{a:1,b:2}}],coverage},'MiXeD');
  assert.equal(one.contentDigest,two.contentDigest);assert.equal(one.objects[0].name,'tName');assert.equal(one.objects[0].checksum.length,64);
});

test('compares additions, modifications, and removals under complete coverage',()=>{
  const a=snapshot('APP',[{owner:'APP',type:'TABLE',name:'T',definition:{columns:[{name:'ID',nullable:false}]}}]);
  const b=snapshot('APP',[{owner:'APP',type:'TABLE',name:'T',definition:{columns:[{name:'ID',nullable:true}]}},{owner:'APP',type:'VIEW',name:'V',definition:{text:'select 1'}}]);
  const diff=compareSchemas(a,b);assert.equal(diff.state,'DRIFT');assert.deepEqual(diff.changes.map(c=>c.kind),['MODIFIED','ADDED']);
});

test('incomplete coverage never claims missing objects removed or no drift',()=>{
  const a=snapshot('APP',[{owner:'APP',type:'TABLE',name:'T',definition:{}}]);
  const b=snapshot('APP',[],{...coverage,TABLE:'PARTIAL'});
  const diff=compareSchemas(a,b);assert.equal(diff.state,'UNVERIFIED');assert.equal(diff.changes[0].kind,'UNVERIFIED');
});

test('identity or exact owner mismatch is incomparable',()=>{
  const a=snapshot('APP',[]);assert.equal(compareSchemas(a,snapshot('APP',[],coverage,'b'.repeat(64))).state,'INCOMPARABLE');
  assert.equal(compareSchemas(a,snapshot('app',[],coverage)).state,'INCOMPARABLE');
});

test('normalization bounds object count and per-snapshot serialized definitions',()=>{
  const objects=Array.from({length:1001},(_,i)=>({owner:'APP',type:'TABLE',name:`T${i}`,definition:{}}));
  const capped=normalizeSchema({objects,coverage},'APP');assert.equal(capped.objects.length,1000);assert.ok(capped.limitations.includes('OBJECT_LIMIT_EXCEEDED'));
  const large=normalizeSchema({objects:[{owner:'APP',type:'VIEW',name:'V',definition:{text:Array(17).fill('x'.repeat(65000))}}],coverage},'APP');
  assert.equal(large.objects.length,0);assert.ok(large.limitations.includes('BYTE_LIMIT_EXCEEDED'));
});

test('invalid, duplicate, and oversized identities downgrade potentially affected coverage',()=>{
  const duplicate=[{owner:'APP',type:'TABLE',name:'T',definition:{}},{owner:'APP',type:'TABLE',name:'T',definition:{}}];
  const dup=normalizeSchema({objects:duplicate,coverage},'APP');assert.equal(dup.coverage.TABLE,'PARTIAL');assert.ok(dup.limitations.includes('DUPLICATE_OBJECT'));
  const malformed=normalizeSchema({objects:[{owner:'APP',type:'VIEW',name:'V'.repeat(129),definition:{}}],coverage,limitations:['private error detail']},'APP');
  assert.equal(malformed.coverage.TABLE,'PARTIAL');assert.ok(malformed.limitations.includes('INVALID_OBJECT'));assert.ok(malformed.limitations.includes('INVALID_LIMITATION'));
  assert.ok(!JSON.stringify(malformed).includes('private error detail'));
});

test('missing identity digests cannot be compared and semantic details identify changed paths',()=>{
  const a=snapshot('APP',[{owner:'APP',type:'TABLE',name:'T',definition:{columns:[{name:'ID',nullable:false}],constraints:[]}}]);
  const b=snapshot('APP',[{owner:'APP',type:'TABLE',name:'T',definition:{columns:[{name:'ID',nullable:true}],constraints:[]}}]);
  const change=compareSchemas(a,b);assert.equal(change.state,'DRIFT');assert.ok(change.changes[0].details.includes('$.columns[0].nullable'));
  assert.equal(compareSchemas({...a,identityDigest:null},a).state,'INCOMPARABLE');
});

test('objects visible only in an incomplete expected scope are unverified additions',()=>{
  const a=snapshot('APP',[],{...coverage,VIEW:'UNAVAILABLE'});
  const b=snapshot('APP',[{owner:'APP',type:'VIEW',name:'V',definition:{text:'select 1'}}]);
  const diff=compareSchemas(a,b);assert.equal(diff.state,'UNVERIFIED');assert.equal(diff.changes[0].kind,'UNVERIFIED');
});

test('dependency identities retain long exact source/reference tuples without collisions',()=>{
  const name=JSON.stringify(['LongSourceName'.repeat(4),'VIEW','OTHER','LongReferenceName'.repeat(4),'TABLE','HARD']);
  const value=normalizeSchema({coverage,objects:[{owner:'APP',type:'DEPENDENCY',name,definition:{name:'LongSource',referenced_name:'LongReference'}}]},'APP');
  assert.equal(value.objects.length,1);assert.equal(value.coverage.DEPENDENCY,'COMPLETE');assert.equal(value.objects[0].name,name);
});

test('hashing normalized wrappers does not reject valid bounded nested definitions',()=>{
  let definition='leaf';for(let i=0;i<16;i++)definition={child:definition};
  const value=normalizeSchema({coverage,objects:[{owner:'APP',type:'TABLE',name:'Nested',definition}]},'APP');
  assert.equal(value.objects.length,1);assert.match(value.contentDigest,/^[a-f0-9]{64}$/);
});

test('malformed object inventories or unknown diagnostics cannot establish complete absence',()=>{
  const malformed=normalizeSchema({coverage,objects:'unavailable'},'APP');assert.equal(malformed.coverage.TABLE,'PARTIAL');
  const unknown=normalizeSchema({coverage,objects:[],limitations:['UNRECOGNIZED_VISIBILITY_FAILURE']},'APP');
  assert.equal(compareSchemas(snapshot('APP',[]),{owner:'APP',identityDigest:'a'.repeat(64),schema:unknown}).state,'UNVERIFIED');
});
