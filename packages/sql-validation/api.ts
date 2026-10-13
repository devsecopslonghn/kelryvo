import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { acquireTargetLocks } from '../targets/locks.ts';
import { loadBindingTarget, checkTargetCurrentness, ORG } from '../targets/index.ts';
import { preflightHistoricalRelease } from '../migrations/retained-release-preflight.mjs';
import { projectAccessMode, actorHasProjectGrant } from '../database/project-membership.ts';
import { buildValidation, loadValidation, readSchemaEvidence, validationCurrentness, validationFailure } from './results.ts';

const uuid=(v:any)=>typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const revision=(v:any)=>typeof v==='string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v)<=9223372036854775807n;
export function registerSqlValidation(app:any,{sql,authenticate}:any) {
  const readGuard=async(tx:any,req:any)=>{
    await guardMutationAuthority(tx,req);
    if(await projectAccessMode(tx)!=='ENFORCED' || !await actorHasProjectGrant(tx,req.actor.id,req.params.projectId))
      throw Object.assign(new Error('NOT_FOUND'),{productCode:'NOT_FOUND'});
  };
  const route=(method:string,path:string,fn:any)=>app[method](path,{preHandler:authenticate},async(req:any,reply:any)=>{
    reply.header('Cache-Control','no-store');
    try{return await fn(req,reply);}catch(e:any){
      const code=e.productCode;
      const status=e.statusCode || (code ? ({UNAUTHENTICATED:401,DEVELOPER_REQUIRED:403,NOT_FOUND:404,
        INVALID_REQUEST:400,PROJECT_ARCHIVED:409,METADATA_RESTORE_HOLD:409,TARGET_REVISION_CONFLICT:409,
        SOURCE_BINDING_MISMATCH:409,RELEASE_INTEGRITY_FAILED:409,RELEASE_NOT_VALID:409,
        VALIDATION_EVIDENCE_UNAVAILABLE:409,VALIDATION_PARSER_UNAVAILABLE:503,VALIDATION_TOO_LARGE:413,
      } as Record<string,number>)[code] || e.validationStatus || 409 : e.validationStatus || 500);
      if(code)return reply.code(status).send({error:code});
      if(e.validationStatus)return reply.code(e.validationStatus).send({error:'SQL_VALIDATION_UNAVAILABLE'});
      throw e;
    }
  });
  route('post','/api/projects/:projectId/releases/:releaseId/validations',async(req:any,reply:any)=>{
    const b=req.body,keys=['targetBindingId','expectedBindingRevision','expectedAssignmentRevision'];
    if(!uuid(req.params.projectId) || !uuid(req.params.releaseId) || !b || typeof b!=='object' || Array.isArray(b)
      || Object.keys(b).length!==keys.length || keys.some(k=>!Object.hasOwn(b,k)) || !uuid(b.targetBindingId)
      || !revision(b.expectedBindingRevision) || !revision(b.expectedAssignmentRevision))return reply.code(400).send({error:'INVALID_REQUEST'});
    const result=await sql.begin(async(tx:any)=>{
      await acquireTargetLocks(tx,{bindingId:b.targetBindingId});await guardMutationAuthority(tx,req,'developer');
      const project=(await tx`SELECT id,archived_at,source_repository_id,source_folder,source_binding_generation::text AS source_binding_generation
        FROM sf_projects WHERE id=${req.params.projectId} AND organization_id=${ORG} FOR SHARE`)[0];
      if(!project)throw Object.assign(new Error('NOT_FOUND'),{productCode:'NOT_FOUND'});
      if(project.archived_at)throw Object.assign(new Error('PROJECT_ARCHIVED'),{productCode:'PROJECT_ARCHIVED'});
      const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g`)[0];
      if(gate?.state!=='ACTIVE')throw validationFailure('METADATA_RESTORE_HOLD');
      const target=await loadBindingTarget(tx,project.id,b.targetBindingId);
      if(!target)throw Object.assign(new Error('NOT_FOUND'),{productCode:'NOT_FOUND'});
      if(target.bindingRevision!==b.expectedBindingRevision || target.assignmentRevision!==b.expectedAssignmentRevision)throw validationFailure('TARGET_REVISION_CONFLICT');
      const bounds=await preflightHistoricalRelease(tx,{id:req.params.releaseId,organizationId:ORG,projectId:project.id});
      if(!bounds.row)throw Object.assign(new Error('NOT_FOUND'),{productCode:'NOT_FOUND'});
      if(!bounds.valid)throw validationFailure('RELEASE_INTEGRITY_FAILED');
      const release=(await tx`SELECT id,repository_id,commit_id,object_format,folder,manifest_digest,parser_profile,validation_status,files
        FROM sf_releases WHERE id=${req.params.releaseId} AND project_id=${project.id} AND organization_id=${ORG}`)[0];
      if(release.repository_id!==project.source_repository_id || release.folder!==project.source_folder)throw validationFailure('SOURCE_BINDING_MISMATCH');
      const profile=(await tx`SELECT engine FROM sf_profiles WHERE id=${target.profileId} AND project_id=${project.id}`)[0];
      const metadata=await readSchemaEvidence(tx,project.id,target);
      const built=await buildValidation(release,project,{...target,engine:profile.engine},metadata);
      // Parsing may consume the remaining evidence/credential lifetime. Recheck before persistence.
      await guardMutationAuthority(tx,req,'developer');
      const currentness=await checkTargetCurrentness(tx,project.id,target,project.source_binding_generation);
      if(currentness.state!=='CURRENT')throw validationFailure('TARGET_REVISION_CONFLICT');
      const inserted=(await tx`INSERT INTO sf_sql_validations(organization_id,project_id,release_id,binding_id,digest,envelope,actor_id)
        VALUES(${ORG},${project.id},${release.id},${target.bindingId},${built.digest},${built.envelope},${req.actor.id})
        ON CONFLICT(organization_id,project_id,digest) DO NOTHING RETURNING id`)[0];
      const id=inserted?.id ?? (await tx`SELECT id FROM sf_sql_validations WHERE organization_id=${ORG} AND project_id=${project.id} AND digest=${built.digest}`)[0].id;
      if(inserted)await tx`INSERT INTO sf_audit(organization_id,project_id,actor_id,action,resource_id,facts)
        VALUES(${ORG},${project.id},${req.actor.id},'SQL_VALIDATED',${id},${tx.json({releaseId:release.id,bindingId:target.bindingId,validationDigest:built.digest,outcome:built.report.outcome})})`;
      return {...await loadValidation(tx,project.id,id),currentness,repeated:!inserted};
    });
    return reply.code(result.repeated?200:201).send({validation:result});
  });
  route('get','/api/projects/:projectId/validations/:validationId',async(req:any,reply:any)=>{
    if(!uuid(req.params.projectId) || !uuid(req.params.validationId) || Object.keys(req.query).length)return reply.code(404).send({error:'NOT_FOUND'});
    const result=await sql.begin(async(tx:any)=>{
      await readGuard(tx,req);
      const result=await loadValidation(tx,req.params.projectId,req.params.validationId);
      return result ? {...result,currentness:await validationCurrentness(tx,result)} : null;
    });
    return result ? {validation:result} : reply.code(404).send({error:'NOT_FOUND'});
  });
  route('get','/api/projects/:projectId/releases/:releaseId/validations',async(req:any,reply:any)=>{
    if(!uuid(req.params.projectId) || !uuid(req.params.releaseId) || Object.keys(req.query).some(k=>k!=='after')
      || req.query.after!==undefined && !uuid(req.query.after))return reply.code(400).send({error:'INVALID_REQUEST'});
    return sql.begin(async(tx:any)=>{
      await readGuard(tx,req);
      const rows=await tx`SELECT id,digest,actor_id AS "actorId",created_at AS "createdAt" FROM sf_sql_validations
        WHERE project_id=${req.params.projectId} AND release_id=${req.params.releaseId}
        AND (${req.query.after??null}::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM sf_sql_validations
          WHERE id=${req.query.after??null}::uuid AND project_id=${req.params.projectId} AND release_id=${req.params.releaseId}))
        ORDER BY created_at DESC,id DESC LIMIT 51`;
      return {validations:rows.slice(0,50),nextCursor:rows.length>50?rows[49].id:null};
    });
  });
}
