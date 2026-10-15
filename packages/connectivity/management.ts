import { instanceProfileCurrent } from './instance-current.ts';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { ORG } from '../targets/index.ts';
import { credentialAlias } from '../targets/public.mjs';
import { acceptedOracleObservation } from './evidence.mjs';

const uuid=(v:any)=>typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][0-9a-f]{3}-[a-f0-9]{12}$/i.test(v);
const revision=(v:any)=>typeof v==='string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v)<9223372036854775807n;
const safeText=(v:any,n=2000,empty=false)=>typeof v==='string' && v.length<=n && (empty || !!v.trim()) && !/[\u0000-\u001f\u007f-\u009f]/.test(v) && Buffer.from(v).toString()===v;
const fail=(productCode:string,statusCode=409)=>Object.assign(new Error(productCode),{productCode,statusCode});
export const validServiceKind=(v:any)=>['SERVICE_NAME','SID'].includes(v);
export const validDescription=(v:any)=>safeText(v,2000,true);
export function publicConnection(c:any,kind:string) {
  return {id:c.id,name:c.name,engine:c.engine,host:c.host,port:c.port,service:c.service,serviceKind:c.service_kind,
    username:c.username,environmentId:c.environment_id,environment:c.environment,containerId:c.container_id,routeId:c.route_id,
    transport:c.transport,description:c.description,revision:String(c.revision),enabled:c.enabled,purpose:kind,
    status:c.retired_at?'RETIRED':c.enabled?'ENABLED':'DISABLED',credentialAlias:credentialAlias(c.id),
    credentialConfigured:!!c.credential_ref,credentialMode:c.credential_mode??'LEGACY_SEPARATE',createdAt:c.created_at,retiredAt:c.retired_at,retirementReason:c.retirement_reason};
}

/** A changed-and-restored configuration must never revive earlier approvals. */
export async function profilePlanCurrent(tx:any,planId:string) {
  const r=(await tx`SELECT p.enabled,p.service_kind,p.retired_at,p.revision=s.revision AS current
    FROM sf_connection_plan_revisions s JOIN sf_profiles p ON p.id=s.profile_id WHERE s.plan_id=${planId}`)[0];
  const source=(await tx`SELECT profile_id FROM sf_instance_profile_sources WHERE profile_id=(SELECT profile_id FROM sf_connection_plan_revisions WHERE plan_id=${planId})`)[0];
  return (!source || await instanceProfileCurrent(tx,source.profile_id)) && !!(r?.current && r.enabled && !r.retired_at && r.service_kind==='SERVICE_NAME');
}

export async function connectionReadiness(tx:any,c:any,kind:string,projectId?:string) {
  const metadata=kind==='DISCOVERY'
    ? !!(await tx`SELECT 1 FROM sf_reference_services r JOIN sf_reference_containers t ON t.id=r.container_id
        WHERE r.id=${c.route_id} AND t.id=${c.container_id} AND t.kind IN ('PDB','NON_CDB')`)[0]
    : !!(await tx`SELECT 1 FROM sf_target_options o JOIN sf_target_option_revisions r ON r.option_id=o.id AND r.revision=o.current_revision
        WHERE r.profile_id=${c.id} AND r.profile_revision=${c.revision} AND o.enabled`)[0];
  const checks=[{code:'CONFIGURATION_COMPLETE',passed:!!(c.name && c.host && c.port>0 && c.port<=65535 && c.service && c.username)},
    {code:'CREDENTIAL_REFERENCE_PRESENT',passed:/^(vault|secret):\/\/[A-Za-z0-9._/-]{1,500}$/.test(c.credential_ref??'')},{code:'ENGINE_SUPPORTED',passed:c.engine==='oracle'},
    {code:'TOPOLOGY_SUPPORTED',passed:c.service_kind==='SERVICE_NAME'},{code:'TARGET_METADATA_PRESENT',passed:metadata},
    {code:'REVISION_CURRENT',passed:BigInt(c.revision)>0n},{code:'LIFECYCLE_ELIGIBLE',passed:c.enabled && !c.retired_at}];
  const stored=(await tx`SELECT state FROM sf_connection_preflights WHERE kind=${kind} AND resource_id=${c.id} AND revision=${c.revision}
    ORDER BY created_at DESC,id DESC LIMIT 1`)[0];
  const observed=kind==='DISCOVERY' && (await tx`SELECT status,provenance,observed_at,limitations,expires_at>clock_timestamp() AS fresh FROM sf_database_observations
    WHERE connection_id=${c.id} AND connection_revision=${c.revision} ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
  const discovery=kind==='DISCOVERY' && (await tx`SELECT identity,schemas,verification_acceptance,limitations,provenance,expires_at>clock_timestamp() AS fresh
    FROM sf_database_observations WHERE connection_id=${c.id} AND connection_revision=${c.revision} AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
  const assigned=kind==='DISCOVERY' && projectId ? await tx`SELECT s.exact_owner FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id
    WHERE s.container_id=${c.container_id} AND a.project_id=${projectId} AND a.closed_at IS NULL` : [];
  const identityAccepted=discovery?.provenance==='ORACLE_READ_ONLY' && discovery.limitations.every((code:string)=>code==='SCHEMA_VISIBILITY_LIMITED')
    && assigned.some((r:any)=>acceptedOracleObservation(discovery.identity,discovery.verification_acceptance,r.exact_owner)
      && discovery.schemas.some((s:any)=>s.owner===r.exact_owner && s.accessible===true));
  const eligible=checks.every(check=>check.passed);
  const connected=eligible && observed?.fresh && observed.provenance==='ORACLE_READ_ONLY' && ['CONNECTED','OBSERVED','PARTIAL'].includes(observed.status);
  const verified=connected && discovery?.fresh && identityAccepted;
  const failed=observed?.fresh && ['UNREACHABLE','UNAUTHORIZED','MISCONFIGURED','TIMEOUT'].includes(observed.status);
  return {state:verified?'CONNECTED_VERIFIED':!eligible || failed?'FAILED':connected?'CONNECTED':observed && !['CONNECTED','OBSERVED','PARTIAL'].includes(observed.status)?'UNVERIFIED':stored?.state==='PREFLIGHT_PASSED'?'PREFLIGHT_PASSED':'CONFIGURED',
    configurationValid:eligible,connectivityStatus:observed ? observed.fresh ? observed.status : 'STALE' : 'NOT_RUN',lastCheckedAt:observed?.observed_at??null,
    identityState:!discovery?'NOT_OBSERVED':discovery.limitations.includes('IDENTITY_MISMATCH')?'CONFLICT':!eligible || !discovery.fresh?'STALE':!discovery.identity?'UNKNOWN':identityAccepted?'VERIFIED':'OBSERVED',
    checks,limitations:[...(observed?.limitations??[]),...(metadata?[]:['TARGET_METADATA_REQUIRES_OPERATOR_CONFIGURATION']),
      ...(c.service_kind==='SID'?['SID_RUNTIME_UNSUPPORTED']:[]),'PREFLIGHT_DOES_NOT_CONNECT_TO_ORACLE',
      ...(verified?[]:['ORACLE_ACCESS_UNVERIFIED','CREDENTIAL_REFERENCE_REQUIRES_TRUSTED_OPERATOR'])]};
}

export function registerConnectionManagement(app:any,{sql,authenticate}:any) {
  for (const [segment,kind,table] of [['profiles','DEPLOY','sf_profiles'],['database-connections','DISCOVERY','sf_database_connections']]) {
    const base=`/api/projects/:projectId/${segment}/:connectionId`;
    const guard=async(tx:any,req:any,manage=false)=>{
      if(!uuid(req.params.projectId) || !uuid(req.params.connectionId))throw fail('NOT_FOUND',404);
      // Same catalog -> governance lock ordering as target admission/operators.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;
      await guardMutationAuthority(tx,req,manage?'developer':undefined);
      const mode=(await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG}`)[0];
      if(mode?.mode!=='ENFORCED')throw fail('MEMBERSHIP_BOOTSTRAP_REQUIRED');
      if(!(await tx`SELECT 1 FROM sf_project_grants WHERE project_id=${req.params.projectId} AND organization_id=${ORG} AND actor_id=${req.actor.id} AND revoked_at IS NULL`)[0])throw fail('NOT_FOUND',404);
      const project=(await tx`SELECT name,archived_at FROM sf_projects WHERE id=${req.params.projectId} AND organization_id=${ORG} FOR UPDATE`)[0];
      if(!project)throw fail('NOT_FOUND',404);
      const workspaceGrant=kind==='DEPLOY' || !!(await tx`SELECT 1 FROM sf_workspace_database_grants WHERE organization_id=${ORG} AND actor_id=${req.actor.id} AND revoked_at IS NULL`)[0];
      const canManage=req.actor.role==='developer' && workspaceGrant && !project.archived_at;
      if(manage){
        if(!workspaceGrant)throw fail('DATABASE_MANAGEMENT_REQUIRED',403);
        if(project.archived_at)throw fail('PROJECT_ARCHIVED');
        const metadata=(await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
        if(metadata?.state!=='ACTIVE')throw fail('METADATA_RESTORE_HOLD');
      }
      const c=kind==='DEPLOY'
        ? (await tx`SELECT * FROM sf_profiles WHERE id=${req.params.connectionId} AND project_id=${req.params.projectId} AND organization_id=${ORG} FOR UPDATE`)[0]
        : (await tx`SELECT c.* FROM sf_database_connections c JOIN sf_database_connection_projects p ON p.connection_id=c.id
            WHERE c.id=${req.params.connectionId} AND c.organization_id=${ORG} AND p.project_id=${req.params.projectId}
            AND (c.credential_mode='INSTANCE_MASTER' AND ${workspaceGrant} OR EXISTS(SELECT 1 FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id
              WHERE s.container_id=c.container_id AND a.project_id=p.project_id AND a.closed_at IS NULL)) FOR UPDATE OF c`)[0];
      if(!c)throw fail('NOT_FOUND',404);
      if(manage && kind==='DEPLOY' && (await tx`SELECT 1 FROM sf_instance_profile_sources WHERE profile_id=${c.id}`)[0])throw fail('INSTANCE_PROFILE_MANAGED');
      if(kind==='DISCOVERY')c.environment=(await tx`SELECT environment FROM sf_reference_containers WHERE id=${c.container_id}`)[0]?.environment;
      return {c,canManage,project};
    };
    const audit=async(tx:any,req:any,c:any,action:string,facts:any)=>{
      await tx`INSERT INTO sf_audit(organization_id,project_id,actor_id,action,resource_id,facts)
        VALUES(${ORG},${req.params.projectId},${req.actor.id},${action},${c.id},${tx.json({...facts,reason:req.body.reason,revision:String(c.revision),purpose:kind})})`;
      if(kind==='DISCOVERY')await tx`INSERT INTO sf_database_connection_audit(organization_id,project_id,connection_id,actor_id,action,facts)
        VALUES(${ORG},${req.params.projectId},${c.id},${req.actor.id},${action},${tx.json({...facts,reason:req.body.reason,revision:String(c.revision)})})`;
    };
    const route=(method:string,url:string,fn:any)=>app[method](url,{preHandler:authenticate},async(req:any,reply:any)=>{
      reply.header('Cache-Control','no-store');
      try{return await sql.begin((tx:any)=>fn(tx,req));}catch(e:any){
        if(e.productCode)return reply.code(e.statusCode ?? (e.productCode==='UNAUTHENTICATED'?401:e.productCode==='DEVELOPER_REQUIRED'?403:409)).send({error:e.productCode});
        if(['23503','23505'].includes(e.code))return reply.code(409).send({error:'CONNECTION_REFERENCE_CONFLICT'});
        throw e;
      }
    });
    route('get',base,async(tx:any,req:any)=>{
      if(Object.keys(req.query).length)throw fail('INVALID_REQUEST',400);
      const {c,canManage,project}=await guard(tx,req);
      const rows=await tx`SELECT configuration,created_at FROM sf_connection_revisions WHERE kind=${kind} AND resource_id=${c.id} ORDER BY revision DESC LIMIT 100`;
      const schemas=kind==='DISCOVERY'
        ? await tx`SELECT s.exact_owner AS owner,a.id AS "assignmentId" FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id
            WHERE s.container_id=${c.container_id} AND a.project_id=${req.params.projectId} AND a.closed_at IS NULL`
        : await tx`SELECT DISTINCT r.exact_owner AS owner,r.assignment_id AS "assignmentId" FROM sf_target_option_revisions r WHERE r.profile_id=${c.id} AND r.project_id=${req.params.projectId}`;
      const environments=kind==='DEPLOY'
        ? await tx`SELECT id,name FROM sf_environments WHERE project_id=${req.params.projectId}`
        : await tx`SELECT id,environment AS name FROM sf_reference_containers WHERE id=${c.container_id}`;
      return {connection:publicConnection(c,kind),revisions:rows.map((r:any)=>({...publicConnection(r.configuration,kind),createdAt:r.created_at})),
        readiness:await connectionReadiness(tx,c,kind,req.params.projectId),canManage,related:{projects:[{id:req.params.projectId,name:project.name}],schemas,environments}};
    });
    for(const operation of ['configuration','lifecycle','preflight']) route('post',`${base}/${operation}`,async(tx:any,req:any)=>{
      const b=req.body;
      const keys=operation==='configuration'?['expectedRevision','name','description','environmentId','host','port','service','serviceKind','username','credentialRef','reason']
        : operation==='lifecycle'?['expectedRevision','action','reason']:['expectedRevision','reason'];
      if(!b || typeof b!=='object' || Array.isArray(b) || Object.keys(b).some(k=>!keys.includes(k)) || !revision(b.expectedRevision) || !safeText(b.reason))throw fail('INVALID_REQUEST',400);
      const {c}=await guard(tx,req,true);
      if(String(c.revision)!==b.expectedRevision)throw fail('CONNECTION_REVISION_CONFLICT');
      if(operation==='preflight'){
        const readiness=await connectionReadiness(tx,c,kind,req.params.projectId),passed=readiness.checks.every(check=>check.passed);
        await tx`INSERT INTO sf_connection_preflights(kind,resource_id,revision,state,checks,actor_id,reason)
          VALUES(${kind},${c.id},${c.revision},${passed?'PREFLIGHT_PASSED':'FAILED'},${tx.json(readiness.checks)},${req.actor.id},${b.reason.trim()})`;
        await audit(tx,req,c,'CONNECTION_PREFLIGHT_CHECKED',{state:passed?'PREFLIGHT_PASSED':'FAILED'});
        return {connection:publicConnection(c,kind),readiness:{...readiness,state:passed?'PREFLIGHT_PASSED':'FAILED'}};
      }
      if(c.retired_at)throw fail('CONNECTION_RETIRED');
      const active=kind==='DEPLOY'
        ? (await tx`SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id WHERE p.profile_id=${c.id}
            AND (j.state='ADMITTED' OR j.state='HOLD' AND ${b.action!=='RETIRE'}) LIMIT 1`)[0]
        : (await tx`SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id JOIN sf_target_option_revisions r ON r.profile_id=p.profile_id
            JOIN sf_target_identity_evidence e ON e.digest=r.observation_digest WHERE e.connection_id=${c.id}
            AND (j.state='ADMITTED' OR j.state='HOLD' AND ${b.action!=='RETIRE'}) LIMIT 1`)[0];
      if(active)throw fail('CONNECTION_EXECUTION_ACTIVE');
      let updated,action;
      if(operation==='configuration'){
        if(!safeText(b.name,kind==='DEPLOY'?200:120) || !validDescription(b.description) || !validServiceKind(b.serviceKind)
          || typeof b.host!=='string' || b.host.length>253 || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/.test(b.host)
          || !Number.isInteger(b.port) || b.port<1 || b.port>65535 || !/^[A-Za-z0-9_$#.-]{1,128}$/.test(b.service??'')
          || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(b.username??'')
          || b.credentialRef!==null && !/^(vault|secret):\/\/[A-Za-z0-9._/-]{1,500}$/.test(b.credentialRef??'')
          || kind==='DEPLOY' && !uuid(b.environmentId) || kind==='DISCOVERY' && b.environmentId!==undefined)throw fail('INVALID_REQUEST',400);
        if(kind==='DEPLOY'){
          if(!(await tx`SELECT 1 FROM sf_environments WHERE id=${b.environmentId} AND project_id=${req.params.projectId}`)[0])throw fail('NOT_FOUND',404);
          updated=(await tx`UPDATE sf_profiles SET name=${b.name.trim()},description=${b.description},environment_id=${b.environmentId},
            host=${b.host.toLowerCase()},port=${b.port},service=${b.service},service_kind=${b.serviceKind},username=${b.username},credential_ref=${b.credentialRef??c.credential_ref}
            WHERE id=${c.id} RETURNING *`)[0];
        } else {
          const existing=(await tx`SELECT * FROM sf_reference_services WHERE organization_id=${ORG} AND host=${b.host.toLowerCase()} AND port=${b.port} AND service=${b.service} AND transport=${c.transport}`)[0];
          if(existing && existing.container_id!==c.container_id)throw fail('CONNECTION_REFERENCE_CONFLICT');
          const route=existing || (await tx`INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport)
            VALUES(${ORG},${c.container_id},${b.host.toLowerCase()},${b.port},${b.service},${c.transport}) RETURNING *`)[0];
          updated=(await tx`UPDATE sf_database_connections SET name=${b.name.trim()},description=${b.description},route_id=${route.id},
            host=${route.host},port=${route.port},service=${route.service},service_kind=${b.serviceKind},username=${b.username},credential_ref=${b.credentialRef??c.credential_ref},revision=revision+1
            WHERE id=${c.id} RETURNING *`)[0];
        }
        action='CONNECTION_CONFIGURATION_UPDATED';
      } else {
        if(!['ENABLE','DISABLE','RETIRE'].includes(b.action))throw fail('INVALID_REQUEST',400);
        if(b.action!=='RETIRE' && c.enabled===(b.action==='ENABLE'))throw fail('CONNECTION_STATUS_UNCHANGED');
        const fields:any={enabled:b.action==='ENABLE',revision:(BigInt(c.revision)+1n).toString()};
        if(b.action==='RETIRE'){fields.retired_at=new Date();fields.retirement_reason=b.reason.trim();if(kind==='DEPLOY')fields.retired_by=req.actor.id;}
        updated=(await tx`UPDATE ${tx(table)} SET ${tx(fields)} WHERE id=${c.id} RETURNING *`)[0];
        action=b.action==='RETIRE'?'CONNECTION_RETIRED':b.action==='ENABLE'?'CONNECTION_ENABLED':'CONNECTION_DISABLED';
      }
      // The retained option profile_revision remains unchanged. Only a fresh operator
      // option/binding revision can become eligible after this mutation.
      if(kind==='DISCOVERY')updated.environment=c.environment;
      await audit(tx,req,updated,action,{previousRevision:String(c.revision)});
      return {connection:publicConnection(updated,kind)};
    });
  }
}
