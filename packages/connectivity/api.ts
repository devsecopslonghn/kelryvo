import { randomUUID } from 'node:crypto';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { acquireTargetLocks } from '../targets/locks.ts';
import { configureTargetOption, createTargetBinding, getTargetBinding, ORG } from '../targets/index.ts';
import { declareReference, assignReference } from '../catalog-reference/index.mjs';
import { normalizeObservation, evidenceDigest, acceptedOracleObservation } from './evidence.mjs';
import { credentialAlias } from '../targets/public.mjs';
import { publicConnection, connectionReadiness, validDescription, validServiceKind } from './management.ts';

const uuid=(v:any)=>typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v:any,n=2000)=>typeof v==='string' && v.trim().length>0 && v.length<=n && !/[\u0000-\u001f\u007f]/.test(v) && Buffer.from(v).toString()===v;
const revision=(v:any)=>typeof v==='string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v)<=9223372036854775807n;
const fail=(code:string,status=409)=>Object.assign(new Error(code),{productCode:code,connectivityStatus:status});
const body=(b:any,keys:string[])=>b && typeof b==='object' && !Array.isArray(b) && Object.keys(b).length===keys.length && keys.every(k=>Object.hasOwn(b,k));
const caps=[{engine:'oracle',supported:true},{engine:'postgresql',supported:false},{engine:'mysql',supported:false}];

export function registerConnectivity(app:any,{sql,authenticate,runtime,timeoutMs=10000}:any) {
  const deadline=Math.max(25,Math.min(10000,timeoutMs)), running=new Set<string>();
  const base='/api/projects/:projectId';
  const guard=async(tx:any,req:any,manage=false)=>{
    if(!uuid(req.params.projectId)) throw fail('NOT_FOUND',404);
    await guardMutationAuthority(tx,req,manage?'developer':undefined);
    const mode=(await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG}`)[0];
    if(mode?.mode!=='ENFORCED') throw fail('MEMBERSHIP_BOOTSTRAP_REQUIRED');
    const grant=(await tx`SELECT 1 FROM sf_project_grants WHERE organization_id=${ORG} AND project_id=${req.params.projectId} AND actor_id=${req.actor.id} AND revoked_at IS NULL`)[0];
    if(!grant) throw fail('NOT_FOUND',404);
    const project=(await tx`SELECT archived_at FROM sf_projects WHERE id=${req.params.projectId} AND organization_id=${ORG}`)[0];
    const canManage=!!(await tx`SELECT 1 FROM sf_workspace_database_grants WHERE organization_id=${ORG} AND actor_id=${req.actor.id} AND revoked_at IS NULL`)[0] && req.actor.role==='developer';
    if(manage){
      if(!canManage) throw fail('DATABASE_MANAGEMENT_REQUIRED',403);
      if(!project || project.archived_at) throw fail('PROJECT_ARCHIVED');
      const gate=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
      if(gate?.state!=='ACTIVE') throw fail('METADATA_RESTORE_HOLD');
    }
    return canManage && !project?.archived_at;
  };
  const audited=async(tx:any,req:any,action:string,connectionId:any,facts:any)=>{
    await tx`INSERT INTO sf_database_connection_audit(organization_id,project_id,connection_id,actor_id,action,facts)
      VALUES(${ORG},${req.params.projectId},${connectionId},${req.actor.id},${action},${tx.json(facts)})`;
    await tx`INSERT INTO sf_audit(organization_id,project_id,actor_id,action,resource_id,facts)
      VALUES(${ORG},${req.params.projectId},${req.actor.id},${action},${connectionId ?? req.params.projectId},${tx.json(facts)})`;
  };
  const connection=async(tx:any,req:any)=>{
    if(!uuid(req.params.connectionId)) throw fail('NOT_FOUND',404);
    const c=(await tx`SELECT c.* FROM sf_database_connections c JOIN sf_database_connection_projects p ON p.connection_id=c.id AND p.organization_id=c.organization_id
      WHERE c.id=${req.params.connectionId} AND c.organization_id=${ORG} AND p.project_id=${req.params.projectId}
      AND EXISTS(SELECT 1 FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id
        WHERE a.project_id=p.project_id AND a.closed_at IS NULL AND s.container_id=c.container_id)`)[0];
    if(!c) throw fail('NOT_FOUND',404);return c;
  };
  const observation=async(tx:any,o:any,projectId:string)=>{
    if(!o)return null;
    const owners=await tx`SELECT s.exact_owner FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id
      JOIN sf_database_connections c ON c.container_id=s.container_id WHERE c.id=${o.connection_id} AND a.project_id=${projectId} AND a.closed_at IS NULL`;
    const allowed=new Set(owners.map((r:any)=>r.exact_owner));
    const latest=(await tx`SELECT id,identity_digest,status FROM sf_database_observations WHERE connection_id=${o.connection_id} AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
    const config=(await tx`SELECT revision,enabled,retired_at FROM sf_database_connections WHERE id=${o.connection_id}`)[0];
    const expired=Number(new Date(o.expires_at))<=Date.now() || String(config?.revision)!==String(o.connection_revision) || !config?.enabled || !!config?.retired_at;
    const superseded=o.operation==='DISCOVER' && latest?.id!==o.id;
    const accepted=(await tx`SELECT identity_digest FROM sf_target_identity_evidence WHERE connection_id=${o.connection_id} AND project_id=${projectId} ORDER BY created_at DESC,digest DESC LIMIT 1`)[0];
    const conflict=!!(o.limitations?.includes('IDENTITY_MISMATCH') || o.identity_digest && (latest?.identity_digest && latest.identity_digest!==o.identity_digest || accepted?.identity_digest && accepted.identity_digest!==o.identity_digest));
    const unavailable=!!(o.identity_digest && latest && !latest.identity_digest);
    return {id:o.id,operation:o.operation,status:o.status,identity:o.identity,identityDigest:o.identity_digest,
      identityState:conflict?'CONFLICT':expired || superseded?'STALE':o.identity_digest?'OBSERVED':'UNKNOWN',
      schemas:(o.schemas ?? []).filter((s:any)=>allowed.has(s.owner)),limitations:o.limitations,provenance:o.provenance,
      verificationAcceptance:o.verification_acceptance?{...o.verification_acceptance,...(Array.isArray(o.verification_acceptance.schemaOwners)?{schemaOwners:o.verification_acceptance.schemaOwners.filter((owner:string)=>allowed.has(owner))}:{})}:null,
      observedAt:o.observed_at,expiresAt:o.expires_at,currentness:conflict?'CONFLICT':expired || superseded?'STALE':unavailable?'UNKNOWN':o.identity_digest?'CURRENT':'UNKNOWN'};
  };
  const projectConnection=async(tx:any,c:any,projectId:string)=>{
    const latest=(await tx`SELECT * FROM sf_database_observations WHERE connection_id=${c.id} ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
    const container=(await tx`SELECT environment FROM sf_reference_containers WHERE id=${c.container_id}`)[0];
    return {...publicConnection({...c,environment:container?.environment},'DISCOVERY'),readiness:await connectionReadiness(tx,c,'DISCOVERY',projectId),id:c.id,name:c.name,engine:c.engine,containerId:c.container_id,host:c.host,port:c.port,service:c.service,
      transport:c.transport,username:c.username,credentialAlias:credentialAlias(c.id),retiredAt:c.retired_at,
      latestObservation:await observation(tx,latest,projectId)};
  };
  const route=(method:string,path:string,fn:any)=>app[method](path,{preHandler:authenticate},async(req:any,reply:any)=>{
    reply.header('Cache-Control','no-store');
    try{return await fn(req,reply);}catch(e:any){
      if(e.connectivityStatus)return reply.code(e.connectivityStatus).send({error:e.productCode});
      if(['ROUTE_CONTAINER_CONFLICT','IMMUTABLE_FACT_CONFLICT','CONTAINER_KIND_CONFLICT'].includes(e.code))return reply.code(409).send({error:'INSTANCE_REFERENCE_CONFLICT'});
      throw e;
    }
  });
  route('get',`${base}/database-connections`,async(req:any)=>sql.begin(async(tx:any)=>{
    const canManage=await guard(tx,req);
    if(Object.keys(req.query).some(k=>!['after','search','engine','environment','status'].includes(k)) || req.query.after!==undefined && !uuid(req.query.after)
      || req.query.search!==undefined && (typeof req.query.search!=='string' || req.query.search.length>120)
      || req.query.engine!==undefined && !caps.some(c=>c.engine===req.query.engine)
      || req.query.environment!==undefined && !['DEV','SIT','UAT','PROD'].includes(req.query.environment)
      || req.query.status!==undefined && !['ENABLED','DISABLED','RETIRED'].includes(req.query.status))throw fail('INVALID_REQUEST',400);
    const rows=await tx`SELECT c.* FROM sf_database_connections c JOIN sf_database_connection_projects p ON p.connection_id=c.id
      JOIN sf_reference_containers t ON t.id=c.container_id
      WHERE c.organization_id=${ORG} AND p.project_id=${req.params.projectId} AND (${req.query.after??null}::uuid IS NULL OR c.id>${req.query.after??null}::uuid)
      AND (${req.query.search??null}::text IS NULL OR position(lower(${req.query.search??''}) in lower(c.name))>0)
      AND (${req.query.engine??null}::text IS NULL OR c.engine=${req.query.engine??null})
      AND (${req.query.environment??null}::text IS NULL OR t.environment=${req.query.environment??null})
      AND (${req.query.status??null}::text IS NULL OR CASE WHEN c.retired_at IS NOT NULL THEN 'RETIRED' WHEN c.enabled THEN 'ENABLED' ELSE 'DISABLED' END=${req.query.status??null})
      AND EXISTS(SELECT 1 FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id WHERE s.container_id=c.container_id AND a.project_id=p.project_id AND a.closed_at IS NULL)
      ORDER BY c.id LIMIT 51`;
    const refs=await tx`SELECT a.id AS "assignmentId",s.exact_owner AS owner,c.id AS "containerId",c.name AS "containerName",r.id AS "routeId",r.host,r.port,r.service,r.transport
      FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id JOIN sf_reference_containers c ON c.id=s.container_id
      JOIN sf_reference_services r ON r.container_id=c.id WHERE a.organization_id=${ORG} AND a.project_id=${req.params.projectId} AND a.closed_at IS NULL ORDER BY a.id,r.id LIMIT 501`;
    return {connections:await Promise.all(rows.slice(0,50).map((c:any)=>projectConnection(tx,c,req.params.projectId))),
      nextCursor:rows.length>50?rows[49].id:null,canManage,infrastructure:refs.slice(0,500),infrastructureTruncated:refs.length>500,engineCapabilities:caps};
  }));
  route('get',`${base}/target-identity-evidence/:digest`,async(req:any)=>sql.begin(async(tx:any)=>{
    await guard(tx,req);
    if(!/^[a-f0-9]{64}$/.test(req.params.digest) || Object.keys(req.query).length)throw fail('NOT_FOUND',404);
    const e=(await tx`SELECT e.digest,e.identity,e.identity_digest AS "identityDigest",e.identity_state AS "identityState",e.exact_owner AS owner,
      e.observation_id AS "observationId",e.reason,e.actor_id AS "actorId",e.created_at AS "createdAt",o.provenance,o.limitations,o.verification_acceptance AS "verificationAcceptance",
      o.connection_revision::text AS "connectionRevision",o.observed_at AS "observedAt",o.expires_at AS "expiresAt"
      FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id WHERE e.digest=${req.params.digest} AND e.project_id=${req.params.projectId}`)[0];
    if(!e)throw fail('NOT_FOUND',404);
    e.liveVerificationAccepted=e.provenance==='ORACLE_READ_ONLY' && acceptedOracleObservation(e.identity,e.verificationAcceptance,e.owner)
      && e.limitations.every((code:string)=>code==='SCHEMA_VISIBILITY_LIMITED');
    if(Array.isArray(e.verificationAcceptance?.schemaOwners))e.verificationAcceptance={...e.verificationAcceptance,schemaOwners:e.verificationAcceptance.schemaOwners.filter((owner:string)=>owner===e.owner)};
    return {evidence:e};
  }));
  route('post',`${base}/database-instances`,async(req:any,reply:any)=>{
    const b=req.body;if(!body(b,['name','containerName','kind','environment','host','port','service','transport','owner','reason']) || !text(b.reason))throw fail('INVALID_REQUEST',400);
    const result=await sql.begin(async(tx:any)=>{
      await guard(tx,req,true);
      const wrapper={begin:(fn:any)=>fn(tx)};
      const key=randomUUID();
      let ref;try {ref=await declareReference(wrapper,{databaseKey:`api-${key}`,databaseLabel:b.name,containerKey:`api-${key}`,containerName:b.containerName,
        containerKind:b.kind,environment:b.environment,host:b.host,port:b.port,service:b.service,transport:b.transport,owner:b.owner});}
      catch(e:any){if(e.code==='INVALID_DECLARATION')throw fail('INVALID_REQUEST',400);throw e;}
      await assignReference(wrapper,{schemaId:ref.schemaId,projectId:req.params.projectId,expectedRevision:'0',reason:b.reason.slice(0,500)});
      await audited(tx,req,'INSTANCE_REGISTERED',null,{schemaId:ref.schemaId,containerId:ref.containerId,provenance:'MANUAL_REFERENCE'});
      return {instance:ref};
    });return reply.code(201).send(result);
  });
  route('post',`${base}/database-connections`,async(req:any,reply:any)=>{
    const b=req.body;
    const required=['assignmentId','routeId','name','engine','username','credentialRef','reason'];
    if(!b || typeof b!=='object' || Array.isArray(b) || required.some(k=>!Object.hasOwn(b,k)) || Object.keys(b).some(k=>![...required,'description','serviceKind','purpose'].includes(k))
      || b.description!==undefined && !validDescription(b.description) || b.serviceKind!==undefined && !validServiceKind(b.serviceKind)
      || b.purpose!==undefined && b.purpose!=='DISCOVERY' || !uuid(b.assignmentId) || !uuid(b.routeId)
      || !text(b.name,120) || !caps.some(c=>c.engine===b.engine) || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(b.username??'')
      || !/^(vault|secret):\/\/[A-Za-z0-9._/-]{1,500}$/.test(b.credentialRef??'') || !text(b.reason))throw fail('INVALID_REQUEST',400);
    const result=await sql.begin(async(tx:any)=>{
      await acquireTargetLocks(tx,{assignmentId:b.assignmentId});await guard(tx,req,true);
      const r=(await tx`SELECT r.* FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id
        JOIN sf_reference_services r ON r.container_id=s.container_id WHERE a.id=${b.assignmentId} AND a.project_id=${req.params.projectId}
        AND a.organization_id=${ORG} AND a.closed_at IS NULL AND r.id=${b.routeId}`)[0];
      if(!r)throw fail('NOT_FOUND',404);
      const c=(await tx`INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason,description,service_kind)
        VALUES(${ORG},${r.container_id},${r.id},${b.name.trim()},${b.engine},${r.host},${r.port},${r.service},${r.transport},${b.username},${b.credentialRef},${req.actor.id},${b.reason.trim()},${b.description??''},${b.serviceKind??'SERVICE_NAME'}) RETURNING *`)[0];
      await tx`INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES(${c.id},${ORG},${req.params.projectId})`;
      await audited(tx,req,'CONNECTION_REGISTERED',c.id,{engine:c.engine,containerId:c.container_id});
      return {connection:await projectConnection(tx,c,req.params.projectId)};
    });return reply.code(201).send(result);
  });
  route('post',`${base}/database-connections/:connectionId/retire`,async(req:any)=>{
    if(!body(req.body,['reason']) || !text(req.body.reason))throw fail('INVALID_REQUEST',400);
    return sql.begin(async(tx:any)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;
      await guard(tx,req,true);const c=await connection(tx,req);
      if(c.retired_at)throw fail('CONNECTION_RETIRED');
      if((await tx`SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id JOIN sf_target_option_revisions r ON r.profile_id=p.profile_id
        JOIN sf_target_identity_evidence e ON e.digest=r.observation_digest WHERE e.connection_id=${c.id} AND j.state='ADMITTED' LIMIT 1`)[0])throw fail('CONNECTION_EXECUTION_ACTIVE');
      await tx`UPDATE sf_database_connections SET retired_at=clock_timestamp(),retirement_reason=${req.body.reason.trim()} WHERE id=${c.id}`;
      await audited(tx,req,'CONNECTION_RETIRED',c.id,{});return {retired:true};
    });
  });
  route('get',`${base}/database-connections/:connectionId/observations`,async(req:any)=>sql.begin(async(tx:any)=>{
    await guard(tx,req);const c=await connection(tx,req);
    if(Object.keys(req.query).some(k=>k!=='after') || req.query.after!==undefined && !uuid(req.query.after))throw fail('INVALID_REQUEST',400);
    const rows=await tx`SELECT * FROM sf_database_observations WHERE connection_id=${c.id}
      AND (${req.query.after??null}::uuid IS NULL OR id<${req.query.after??null}::uuid) ORDER BY id DESC LIMIT 51`;
    return {observations:await Promise.all(rows.slice(0,50).map((o:any)=>observation(tx,o,req.params.projectId))),nextCursor:rows.length>50?rows[49].id:null};
  }));
  for(const [suffix,operation] of [['test','TEST'],['discover','DISCOVER']])route('post',`${base}/database-connections/:connectionId/${suffix}`,async(req:any,reply:any)=>{
    if(!body(req.body,['reason']) || !text(req.body.reason))throw fail('INVALID_REQUEST',400);
    const c=await sql.begin(async(tx:any)=>{await guard(tx,req,true);const c=await connection(tx,req);if(c.retired_at)throw fail('CONNECTION_RETIRED');if(!c.enabled || c.service_kind!=='SERVICE_NAME')throw fail('CONNECTION_INELIGIBLE');return c;});
    if(running.has(c.id) || running.size>=2)throw fail('DISCOVERY_BUSY',429);
    let raw:any;
    if(c.engine!=='oracle')raw={status:'UNAVAILABLE',provenance:'UNAVAILABLE',limitations:['ENGINE_UNSUPPORTED']};
    else if(!runtime)raw={status:'UNAVAILABLE',provenance:'UNAVAILABLE',limitations:['RUNTIME_UNAVAILABLE']};
    else {
      running.add(c.id);const controller=new AbortController();let timer:any;
      const work=Promise.resolve().then(()=>runtime.run({id:c.id,engine:c.engine,host:c.host,port:c.port,service:c.service,transport:c.transport,username:c.username,credentialRef:c.credential_ref},operation,{signal:controller.signal}));
      work.then(()=>running.delete(c.id),()=>running.delete(c.id));
      try{raw=await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'TIMEOUT',provenance:'UNAVAILABLE'});},deadline);})]);}
      catch{raw={status:'UNAVAILABLE',provenance:'UNAVAILABLE'};}finally{clearTimeout(timer);}
    }
    const normalized=normalizeObservation(raw,operation);
    const result=await sql.begin(async(tx:any)=>{
      await guard(tx,req,true);const current=await connection(tx,req);if(current.retired_at)throw fail('CONNECTION_RETIRED');
      if(String(current.revision)!==String(c.revision) || !current.enabled)throw fail('CONNECTION_REVISION_CONFLICT');
      const container=(await tx`SELECT kind FROM sf_reference_containers WHERE id=${c.container_id}`)[0];
      if(normalized.identity && (normalized.identity.cdb ? container?.kind!=='PDB' : container?.kind!=='NON_CDB')){
        normalized.status='PARTIAL';normalized.limitations.push('IDENTITY_MISMATCH');normalized.verificationAcceptance=null;
      }
      const o=(await tx`INSERT INTO sf_database_observations(organization_id,connection_id,operation,status,identity,identity_digest,schemas,limitations,provenance,verification_acceptance,actor_id,connection_revision)
        VALUES(${ORG},${c.id},${operation},${normalized.status},${normalized.identity?tx.json(normalized.identity):null},${normalized.identityDigest},${tx.json(normalized.schemas)},${tx.json(normalized.limitations)},${normalized.provenance},${normalized.verificationAcceptance?tx.json(normalized.verificationAcceptance):null},${req.actor.id},${c.revision}) RETURNING *`)[0];
      await audited(tx,req,operation==='TEST'?'CONNECTIVITY_TESTED':'DATABASE_DISCOVERED',c.id,{observationId:o.id,status:o.status,identityDigest:o.identity_digest});
      return {observation:await observation(tx,o,req.params.projectId)};
    });return reply.code(201).send(result);
  });
  for(const [suffix,state] of [['observe','OBSERVED'],['verify','VERIFIED']])route('post',`${base}/target-bindings/:bindingId/${suffix}`,async(req:any,reply:any)=>{
    const b=req.body;
    if(!body(b,['connectionId','observationId','expectedIdentityDigest','expectedBindingRevision','expectedAssignmentRevision','owner','reason'])
      || !uuid(req.params.bindingId) || !uuid(b.connectionId) || !uuid(b.observationId) || !/^[a-f0-9]{64}$/.test(b.expectedIdentityDigest??'')
      || !revision(b.expectedBindingRevision) || !revision(b.expectedAssignmentRevision) || !text(b.owner,128) || !text(b.reason))throw fail('INVALID_REQUEST',400);
    const result=await sql.begin(async(tx:any)=>{
      await acquireTargetLocks(tx,{bindingId:req.params.bindingId});await guard(tx,req,true);
      const c=await connection(tx,{...req,params:{...req.params,connectionId:b.connectionId}});
      const detail=await getTargetBinding(tx,req.params.projectId,req.params.bindingId),binding=detail?.binding;
      if(!binding || binding.bindingRevision!==b.expectedBindingRevision || binding.assignmentRevision!==b.expectedAssignmentRevision)throw fail('TARGET_REVISION_CONFLICT');
      if(detail.currentness.state!=='CURRENT' && !detail.currentness.reasons.every((r:string)=>['OBSERVATION_STALE','OBSERVATION_UNAVAILABLE','OBSERVATION_SUPERSEDED','LIVE_VERIFICATION_UNACCEPTED'].includes(r)))throw fail('TARGET_REVISION_CONFLICT');
      const o=(await tx`SELECT *,expires_at>clock_timestamp() AS fresh FROM sf_database_observations WHERE id=${b.observationId} AND connection_id=${c.id} AND organization_id=${ORG}`)[0];
      if(!o)throw fail('NOT_FOUND',404);
      if(!o.fresh || c.retired_at || !c.enabled || String(c.revision)!==String(o.connection_revision))throw fail('DISCOVERY_STALE');
      if(!o.identity_digest || o.identity_digest!==b.expectedIdentityDigest || !['OBSERVED','PARTIAL'].includes(o.status) || o.limitations.includes('IDENTITY_MISMATCH'))throw fail('IDENTITY_MISMATCH');
      const latest=(await tx`SELECT id FROM sf_database_observations WHERE connection_id=${c.id} AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
      if(latest?.id!==o.id)throw fail('DISCOVERY_CONFLICT');
      if(binding.exactOwner!==b.owner || binding.routeId!==c.route_id)throw fail('IDENTITY_MISMATCH');
      const schema=o.schemas.find((s:any)=>s.owner===b.owner);
      if(!schema || schema.accessible!==true)throw fail('SCHEMA_ACCESS_UNVERIFIED');
      if(state==='VERIFIED' && (o.provenance!=='ORACLE_READ_ONLY' || !acceptedOracleObservation(o.identity,o.verification_acceptance,b.owner)
        || o.limitations.some((code:string)=>code!=='SCHEMA_VISIBILITY_LIMITED')))throw fail('LIVE_VERIFICATION_UNACCEPTED');
      const previous=(await tx`SELECT e.identity_digest FROM sf_target_binding_revisions br JOIN sf_target_identity_evidence e ON e.digest=br.observation_digest
        WHERE br.binding_id=${binding.bindingId} ORDER BY br.revision DESC LIMIT 1`)[0];
      if(previous && previous.identity_digest!==o.identity_digest)throw fail('IDENTITY_CONFLICT');
      const evidence={organizationId:ORG,projectId:req.params.projectId,connectionId:c.id,observationId:o.id,assignmentId:binding.assignmentId,
        assignmentRevision:binding.assignmentRevision,identityDigest:o.identity_digest,identity:o.identity,owner:b.owner,state,actorId:req.actor.id,reason:b.reason.trim()};
      const digest=evidenceDigest(evidence);
      const option=(await tx`SELECT * FROM sf_target_option_revisions WHERE option_id=${binding.targetOptionId} AND revision=${binding.targetOptionRevision}::bigint`)[0];
      await tx`INSERT INTO sf_target_identity_evidence(digest,organization_id,project_id,connection_id,observation_id,assignment_id,schema_id,assignment_revision,route_id,identity_digest,identity,exact_owner,identity_state,actor_id,reason)
        VALUES(${digest},${ORG},${req.params.projectId},${c.id},${o.id},${binding.assignmentId},${option.schema_id},${binding.assignmentRevision}::bigint,${c.route_id},${o.identity_digest},${tx.json(o.identity)},${b.owner},${state},${req.actor.id},${b.reason.trim()})`;
      const configured=await configureTargetOption(tx,{optionId:binding.targetOptionId,expectedOptionRevision:binding.targetOptionRevision,
        projectId:req.params.projectId,assignmentId:binding.assignmentId,environmentId:binding.environmentId,profileId:binding.profileId,
        routeId:binding.routeId,routeConfigRevision:binding.routeConfigRevision,routeAlias:binding.routeAlias,lineageId:binding.lineageId,
        migrationNamespace:binding.migrationNamespace,policyId:binding.policyId,policyRevision:binding.policyRevision,exactOwner:b.owner,
        deploymentPrincipalId:binding.deploymentPrincipalId,principalPurpose:'DEPLOY',principalUsername:option.profile_username,
        privatePrincipalRef:option.private_principal_ref,principalAlias:binding.principalAlias,reason:b.reason.trim(),
        identityState:state,observationDigest:digest,observedAt:new Date(o.observed_at).toISOString()});
      const revised=await createTargetBinding(tx,{projectId:req.params.projectId,assignmentId:binding.assignmentId,
        expectedAssignmentRevision:binding.assignmentRevision,environmentId:binding.environmentId,targetOptionId:binding.targetOptionId,
        expectedTargetOptionRevision:configured.optionRevision,bindingId:binding.bindingId,expectedBindingRevision:binding.bindingRevision,
        reason:b.reason.trim(),actorId:req.actor.id});
      await audited(tx,req,state==='VERIFIED'?'TARGET_VERIFIED':'TARGET_OBSERVED',c.id,{bindingId:binding.bindingId,bindingRevision:revised.binding.bindingRevision,evidenceDigest:digest});
      return {...revised,evidence:{...evidence,digest}};
    });return reply.code(201).send(result);
  });
}
