import { createDiscoveryFixture, fixtureIdentity } from './discovery-fixture.mjs';
export const completeCoverage=Object.fromEntries(['TABLE','VIEW','SEQUENCE','INDEX','DEPENDENCY'].map(t=>[t,'COMPLETE']));
export const object=(name='Orders',type='TABLE',definition={columns:[{name:'Id',type:'NUMBER',nullable:false}],constraints:[]})=>({owner:'APP',type,name,definition});
export async function createSchemaFixture(options={}) {
  const f=await createDiscoveryFixture({discoveryTimeoutMs:1000,...options});
  let schema={owner:'APP',objects:[object()],coverage:completeCoverage,limitations:[]},identity=fixtureIdentity,mode='OBSERVED',hook,delayMs=0;
  const oldRun=f.runtime.run;
  f.runtime.run=async(c,operation,opts)=>{
    if(operation!=='SCHEMA')return oldRun(c,operation,opts);
    if(hook)await hook();
    if(mode==='HANG')return new Promise(resolve=>opts.signal.addEventListener('abort',()=>resolve({status:'TIMEOUT',provenance:'FIXTURE'}),{once:true}));
    if(mode==='THROW')throw new Error('secret://private-fixture-password');
    if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));
    return {status:mode,identity,schemas:[{owner:'APP',accessible:true}],schema,provenance:'FIXTURE'};
  };
  const b=(await f.createBinding()).json().binding;
  const observe=(extra={})=>f.api('POST',`${f.base}/target-bindings/${b.bindingId}/schema/observe`,{
    connectionId:f.connection.id,expectedBindingRevision:b.bindingRevision,expectedAssignmentRevision:b.assignmentRevision,reason:'Observe controlled schema fixture',...extra});
  const baseline=s=>f.api('POST',`${f.base}/schema-baselines`,{snapshotId:s.id,name:'Expected schema',reason:'Retain immutable controlled baseline'});
  const compare=(expected,observed)=>f.api('GET',`${f.base}/schema-comparison?expected=${expected.id}&observed=${observed.id}`);
  return {...f,get app(){return f.app;},binding:b,observe,baseline,compare,setSchema:v=>{schema=v;},setIdentity:v=>{identity=v;},setMode:v=>{mode=v;},setHook:v=>{hook=v;},setDelay:v=>{delayMs=v;}};
}
