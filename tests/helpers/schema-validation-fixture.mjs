import {writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createDiscoveryFixture} from './discovery-fixture.mjs';
export async function createValidationFixture(options={}) {
  const f=await createDiscoveryFixture(options);
  try{
    const binding=(await f.createBinding()).json().binding;
    const observation=(await f.api('POST',`${f.connections}/${f.connection.id}/discover`,{reason:'Observe schema visibility for SQL review'})).json().observation;
    const response=await f.api('POST',`${f.base}/target-bindings/${binding.bindingId}/observe`,{connectionId:f.connection.id,observationId:observation.id,
      expectedIdentityDigest:observation.identityDigest,expectedBindingRevision:'1',expectedAssignmentRevision:'1',owner:'APP',reason:'Retain observed target for SQL planning'});
    if(response.statusCode!==201)throw new Error(response.body);
    const result={...f,get app(){return f.app;},binding:response.json().binding,observation};
    result.validate=(actor=f.actors[0],extra={})=>f.api('POST',`${f.base}/releases/${result.release.id}/validations`,{
      targetBindingId:result.binding.bindingId,expectedBindingRevision:result.binding.bindingRevision,expectedAssignmentRevision:result.binding.assignmentRevision,...extra},actor);
    result.makeSchemaPlan=(validation,actor=f.actors[0],extra={})=>f.api('POST',`${f.base}/plans`,{intentVersion:3,releaseId:result.release.id,
      assignmentId:result.binding.assignmentId,expectedAssignmentRevision:result.binding.assignmentRevision,targetBindingId:result.binding.bindingId,
      expectedBindingRevision:result.binding.bindingRevision,validationId:validation.id,expectedValidationDigest:validation.digest,...extra},actor);
    result.importSql=async source=>{await writeFile(path.join(f.repo,'migrations','V1__target.sql'),source);f.git('add','migrations');f.git('commit','-m','SQL validation fixture');
      const r=await f.api('POST',`${f.base}/releases`,{repositoryId:f.repositories[0].id,commit:'HEAD',folder:'migrations'});
      if(r.statusCode!==201)throw new Error(r.body);result.release=r.json().release;return result.release;};
    return result;
  }catch(e){await f.close();throw e;}
}
