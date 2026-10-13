import { createTargetWorkflowFixture } from './target-workflow-fixture.mjs';
import { applyLocalMembershipAction } from '../../scripts/local-membership-operator.mjs';
export const fixtureIdentity={engine:'oracle',dbid:'1234567',dbUniqueName:'KELYRVO_FIXTURE',resetlogsChange:'987654',
  cdb:true,containerId:'3',containerGuid:'0123456789ABCDEF0123456789ABCDEF',containerDbid:'7654321',
  containerName:'FIXTURE_PDB',serviceName:'TARGETSVC',version:'23.0.0'};
export async function createDiscoveryFixture(options={}) {
  let mode='OBSERVED',identity=fixtureIdentity,hook;
  const runtime={liveVerificationAccepted:false,async run(_c,operation,{signal}) {
    if(hook)await hook();
    if(mode==='THROW')throw new Error('fixture-private-password vault://local/hidden');
    if(mode==='HANG')return new Promise(resolve=>signal.addEventListener('abort',()=>resolve({status:'TIMEOUT',provenance:'FIXTURE'}),{once:true}));
    if(operation==='TEST')return {status:mode==='OBSERVED'?'CONNECTED':mode,provenance:'FIXTURE'};
    return {status:mode,identity:mode==='PARTIAL'?null:identity,schemas:[{owner:'APP',accessible:true},{owner:'FOREIGN_PRIVATE',accessible:true}],
      limitations:mode==='PARTIAL'?['INSUFFICIENT_METADATA_PRIVILEGES']:[],provenance:'FIXTURE',password:'fixture-private-password'};
  }};
  const f=await createTargetWorkflowFixture({...options,discoveryRuntime:runtime,discoveryTimeoutMs:50});
  await applyLocalMembershipAction(f.db.sql,{action:'database-grant',actorId:f.actors[0].id});
  const connections=`${f.base}/database-connections`;
  const definition={assignmentId:f.assignment.id,routeId:f.reference.serviceId,name:'Read-only fixture connection',engine:'oracle',username:'APP',credentialRef:'secret://local/discovery',reason:'Register scoped discovery fixture'};
  const response=await f.api('POST',connections,definition);
  if(response.statusCode!==201){await f.close();throw new Error(`fixture connection failed ${response.statusCode}: ${response.body}`);}
  return {...f,get app(){return f.app;},connections,definition,connection:response.json().connection,runtime,
    mode:value=>{mode=value;},identity:value=>{identity=value;},hook:value=>{hook=value;}};
}
