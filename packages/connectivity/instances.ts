import { isOracleApplicationOwner } from '../execution/schema-scope.mjs';
import { randomUUID } from 'node:crypto';
import { validateReferenceDeclaration, assignReference } from '../catalog-reference/index.mjs';
import { configureTargetOption, createTargetBinding, ORG } from '../targets/index.ts';
import { publicConnection } from './management.ts';
import { instanceIdentityCurrent } from './instance-identity.mjs';
import { oracleCredentialEndpointDigest, readOracleVaultPublicKey, sealOracleCredential, validOraclePassword } from './credential-vault.mjs';
import { instanceDeploymentPrincipal } from './instance-runtime.mjs';

const uuid=(v:any)=>typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v:any,n=2000)=>typeof v==='string' && !!v.trim() && v.length<=n && !/[\u0000-\u001f\u007f]/.test(v);
const fail=(code:string,status=409)=>Object.assign(new Error(code),{productCode:code,connectivityStatus:status});
const protectedOwner=(s:string)=>!isOracleApplicationOwner(s);

/** Instance onboarding reuses the workspace catalog, revisioned connections and
 * schema target bindings. Profiles are derived snapshots, never another secret.
 */
export function registerInstances({sql,route,guard,connection,audited,projectConnection,oracleVaultPublicKey}:any) {
  const base='/api/projects/:projectId';
  const installedPublicKey=async()=>{
    try{return oracleVaultPublicKey ?? await readOracleVaultPublicKey();}
    catch{throw fail('ORACLE_CREDENTIAL_VAULT_UNAVAILABLE',503);}
  };
  const seal=async(tx:any,c:any,password:string,actorId:string,id=randomUUID())=>{
    const context={organizationId:ORG,connectionId:c.id,credentialId:id,username:c.username,purpose:'INSTANCE_MASTER',endpointDigest:oracleCredentialEndpointDigest(c)};
    const envelope=sealOracleCredential(password,context,await installedPublicKey());
    await tx`INSERT INTO sf_oracle_credentials(id,organization_id,connection_id,username,purpose,key_id,envelope,endpoint_digest,actor_id)
      VALUES(${id},${ORG},${c.id},${c.username},'INSTANCE_MASTER',${envelope.keyId},${tx.json(envelope)},${context.endpointDigest},${actorId})`;
    return {id,ref:`vault://kelryvo/${id}`,keyId:envelope.keyId};
  };
  route('get',`${base}/database-instances/master`,async(req:any)=>sql.begin(async(tx:any)=>{
    await guard(tx,req,true);
    if(Object.keys(req.query).length)throw fail('INVALID_REQUEST',400);
    const rows=await tx`SELECT * FROM sf_database_connections WHERE organization_id=${ORG} AND credential_mode='INSTANCE_MASTER'
      AND retired_at IS NULL ORDER BY name,id LIMIT 101`;
    const credentialEntryAvailable=await installedPublicKey().then(()=>true,()=>false);
    return {instances:rows.slice(0,100).map((c:any)=>publicConnection(c,'DISCOVERY')),truncated:rows.length>100,credentialEntryAvailable};
  }));
  route('post',`${base}/database-instances/attach`,async(req:any)=>{
    const b=req.body;
    if(!b || Object.keys(b).sort().join(',')!=='connectionId,reason' || !uuid(b.connectionId) || !text(b.reason))throw fail('INVALID_REQUEST',400);
    return sql.begin(async(tx:any)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;await guard(tx,req,true);
      const c=(await tx`SELECT * FROM sf_database_connections WHERE id=${b.connectionId} AND organization_id=${ORG}
        AND credential_mode='INSTANCE_MASTER' AND retired_at IS NULL FOR UPDATE`)[0];
      if(!c)throw fail('NOT_FOUND',404);
      await tx`INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES(${c.id},${ORG},${req.params.projectId}) ON CONFLICT DO NOTHING`;
      await audited(tx,req,'INSTANCE_ATTACHED',c.id,{reason:b.reason.trim()});
      return {connection:await projectConnection(tx,c,req.params.projectId,true)};
    });
  });
  route('post',`${base}/database-instances/master`,async(req:any,reply:any)=>{
    const b=req.body,managed=Object.hasOwn(b??{},'password');
    const keys=['name','containerName','kind','environment','host','port','service','transport','username',managed?'password':'credentialRef','reason'];
    if(!b || Object.keys(b).length!==keys.length || keys.some(k=>!Object.hasOwn(b,k)) || !text(b.reason)
      || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(b.username??'') || protectedOwner(b.username)
      || (managed?!validOraclePassword(b.password):!/^(vault|secret):\/\/[A-Za-z0-9._/-]{1,500}$/.test(b.credentialRef??'')
        || b.credentialRef.startsWith('vault://kelryvo/')))throw fail('INVALID_REQUEST',400);
    const key=randomUUID();let d:any;
    try {d=validateReferenceDeclaration({databaseKey:key,databaseLabel:b.name,containerKey:key,containerName:b.containerName,
      containerKind:b.kind,environment:b.environment,host:b.host,port:b.port,service:b.service,transport:b.transport,owner:'UNASSIGNED'});}
    catch {throw fail('INVALID_REQUEST',400);}
    const result=await sql.begin(async(tx:any)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;await guard(tx,req,true);
      let r=(await tx`SELECT r.*,c.kind FROM sf_reference_services r JOIN sf_reference_containers c ON c.id=r.container_id
        WHERE r.organization_id=${ORG} AND r.host=${d.host} AND r.port=${d.port} AND r.service=${d.service} AND r.transport=${d.transport} FOR UPDATE OF r`)[0];
      if(r && r.kind!==d.containerKind)throw fail('INSTANCE_REFERENCE_CONFLICT');
      if(!r){
        const db=(await tx`INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES(${ORG},${key},${d.databaseLabel}) RETURNING id`)[0];
        const c=(await tx`INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment)
          VALUES(${ORG},${db.id},${key},${d.containerName},${d.containerKind},${d.environment}) RETURNING id`)[0];
        r=(await tx`INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport)
          VALUES(${ORG},${c.id},${d.host},${d.port},${d.service},${d.transport}) RETURNING *`)[0];
      }
      if((await tx`SELECT 1 FROM sf_database_connections WHERE organization_id=${ORG} AND container_id=${r.container_id}
        AND credential_mode='INSTANCE_MASTER' AND retired_at IS NULL`)[0])throw fail('INSTANCE_MASTER_ALREADY_CONFIGURED');
      const credentialId=randomUUID();
      const c=(await tx`INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,
        username,credential_ref,actor_id,reason,credential_mode) VALUES(${ORG},${r.container_id},${r.id},${b.name.trim()},'oracle',${r.host},${r.port},${r.service},${r.transport},
        ${b.username},${managed?`vault://kelryvo/${credentialId}`:b.credentialRef},${req.actor.id},${b.reason.trim()},'INSTANCE_MASTER') RETURNING *`)[0];
      if(managed){
        const stored=await seal(tx,c,b.password,req.actor.id,credentialId);
        await audited(tx,req,'INSTANCE_CREDENTIAL_STORED',c.id,{credentialId,keyId:stored.keyId});
      }
      await tx`INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES(${c.id},${ORG},${req.params.projectId})`;
      await audited(tx,req,'INSTANCE_MASTER_REGISTERED',c.id,{containerId:c.container_id,revision:String(c.revision)});
      return {connection:await projectConnection(tx,c,req.params.projectId,true)};
    });return reply.code(201).send(result);
  });

  route('post',`${base}/database-connections/:connectionId/credentials`,async(req:any)=>{
    const b=req.body,rotate=b?.action==='ROTATE',keys=rotate?['action','expectedRevision','password','reason']:['action','expectedRevision','reason'];
    if(!b || Object.keys(b).sort().join(',')!==keys.sort().join(',') || !['ROTATE','REVOKE'].includes(b.action)
      || !/^[1-9][0-9]{0,18}$/.test(b.expectedRevision??'') || !text(b.reason,500) || rotate&&!validOraclePassword(b.password))throw fail('INVALID_REQUEST',400);
    return sql.begin(async(tx:any)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;await guard(tx,req,true);
      await connection(tx,req);
      const c=(await tx`SELECT * FROM sf_database_connections WHERE id=${req.params.connectionId} AND organization_id=${ORG} FOR UPDATE`)[0];
      if(c.credential_mode!=='INSTANCE_MASTER' || c.retired_at || String(c.revision)!==b.expectedRevision)throw fail('CONNECTION_REVISION_CONFLICT');
      if((await tx`SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id
        JOIN sf_instance_profile_sources s ON s.profile_id=p.profile_id WHERE s.connection_id=${c.id}
        AND j.state IN ('ADMITTED','HOLD') LIMIT 1`)[0])throw fail('CONNECTION_EXECUTION_ACTIVE');
      const old=(await tx`SELECT id FROM sf_oracle_credentials WHERE connection_id=${c.id} AND organization_id=${ORG}
        AND ${c.credential_ref}='vault://kelryvo/'||id::text FOR UPDATE`)[0];
      if(!rotate&&!old)throw fail('MANAGED_CREDENTIAL_REQUIRED');
      if(old)await tx`INSERT INTO sf_oracle_credential_revocations(credential_id,organization_id,actor_id,reason)
        VALUES(${old.id},${ORG},${req.actor.id},${b.reason.trim()}) ON CONFLICT DO NOTHING`;
      const replacement=rotate?await seal(tx,c,b.password,req.actor.id):null;
      const updated=(await tx`UPDATE sf_database_connections SET credential_ref=${replacement?.ref??c.credential_ref},
        enabled=${rotate?c.enabled:false},revision=revision+1 WHERE id=${c.id} RETURNING *`)[0];
      await audited(tx,req,rotate?'INSTANCE_CREDENTIAL_ROTATED':'INSTANCE_CREDENTIAL_REVOKED',c.id,
        {previousRevision:String(c.revision),revision:String(updated.revision),credentialId:replacement?.id??old.id,reason:b.reason.trim()});
      return {connection:await projectConnection(tx,updated,req.params.projectId,true)};
    });
  });

  route('post',`${base}/database-connections/:connectionId/assign-schemas`,async(req:any,reply:any)=>{
    const b=req.body,keys=['observationId','expectedConnectionRevision','owners','environmentId','reason'];
    if(!b || Object.keys(b).length!==keys.length || keys.some(k=>!Object.hasOwn(b,k)) || !uuid(b.observationId) || !uuid(b.environmentId)
      || !/^[1-9][0-9]{0,18}$/.test(b.expectedConnectionRevision??'') || !text(b.reason,500)
      || !Array.isArray(b.owners) || !b.owners.length || b.owners.length>50 || new Set(b.owners).size!==b.owners.length
      || b.owners.some((o:any)=>!text(o,128) || protectedOwner(o)))throw fail('INVALID_REQUEST',400);
    const result=await sql.begin(async(tx:any)=>{
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG},31))`;await guard(tx,req,true);
      const c=await connection(tx,req);
      if(c.credential_mode!=='INSTANCE_MASTER' || c.retired_at || !c.enabled || c.service_kind!=='SERVICE_NAME'
        || String(c.revision)!==b.expectedConnectionRevision)throw fail('CONNECTION_REVISION_CONFLICT');
      const deployment=await instanceDeploymentPrincipal(tx,c);
      if(!deployment)throw fail('INSTANCE_RUNTIME_REQUIRED');
      if(deployment.runtime && b.owners.some((owner:string)=>!deployment.runtime.schemaOwners.includes(owner)
        || deployment.runtime.protectedOwners.includes(owner)))throw fail('SCHEMA_OUTSIDE_INSTALLED_SCOPE');
      const env=(await tx`SELECT * FROM sf_environments WHERE id=${b.environmentId} AND project_id=${req.params.projectId}`)[0];
      if(!env)throw fail('NOT_FOUND',404);
      const o=(await tx`SELECT *,expires_at>clock_timestamp() AS fresh FROM sf_database_observations WHERE id=${b.observationId} AND connection_id=${c.id} AND operation='DISCOVER'`)[0];
      const latest=(await tx`SELECT id FROM sf_database_observations WHERE connection_id=${c.id} AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
      if(!o?.fresh || o.id!==latest?.id || String(o.connection_revision)!==String(c.revision))throw fail('DISCOVERY_STALE');
      if(!o.identity || !await instanceIdentityCurrent(tx,c.container_id,o.identity))throw fail('INSTANCE_PHYSICAL_IDENTITY_CONFLICT');
      if(!o.identity_digest || o.limitations.includes('IDENTITY_MISMATCH') || b.owners.some((owner:string)=>!o.schemas.some((s:any)=>s.owner===owner && s.accessible===true)))throw fail('SCHEMA_ACCESS_UNVERIFIED');
      let profile=(await tx`SELECT p.* FROM sf_instance_profile_sources s JOIN sf_profiles p ON p.id=s.profile_id
        WHERE s.connection_id=${c.id} AND s.connection_revision=${c.revision} AND p.project_id=${req.params.projectId}
        AND p.environment_id=${env.id} AND p.retired_at IS NULL AND p.enabled ORDER BY p.created_at DESC LIMIT 1`)[0];
      if(!profile){
        profile=(await tx`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
          VALUES(${req.params.projectId},${ORG},${env.id},${c.name},'oracle',${c.host},${c.port},${c.service},${deployment.username},${deployment.credentialRef}) RETURNING *`)[0];
        await tx`INSERT INTO sf_instance_profile_sources(profile_id,connection_id,connection_revision) VALUES(${profile.id},${c.id},${c.revision})`;
      }
      const bindings=[];
      for(const owner of b.owners){
        let s=(await tx`SELECT * FROM sf_reference_schemas WHERE organization_id=${ORG} AND container_id=${c.container_id} AND exact_owner=${owner} AND generation=1 FOR UPDATE`)[0];
        if(!s)s=(await tx`INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) VALUES(${ORG},${c.container_id},${owner}) RETURNING *`)[0];
        const previous=(await tx`SELECT * FROM sf_reference_assignments WHERE schema_id=${s.id} AND closed_at IS NULL`)[0];
        if(previous && previous.project_id!==req.params.projectId)throw fail('SCHEMA_ALREADY_ASSIGNED');
        if(!previous)await assignReference({begin:(fn:any)=>fn(tx)},{schemaId:s.id,projectId:req.params.projectId,expectedRevision:String(s.revision),reason:b.reason});
        const a=(await tx`SELECT a.id,s.revision::text AS revision FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id WHERE a.schema_id=${s.id} AND a.closed_at IS NULL`)[0];
        const lineage=(await tx`SELECT id FROM sf_target_lineages WHERE container_id=${c.container_id}`)[0];
        const existing=(await tx`SELECT b.id,b.current_revision FROM sf_target_bindings b WHERE b.assignment_id=${a.id} AND b.environment_id=${env.id}`)[0];
        const option=await configureTargetOption(tx,{expectedOptionRevision:'0',projectId:req.params.projectId,assignmentId:a.id,environmentId:env.id,profileId:profile.id,
          routeId:c.route_id,routeConfigRevision:'1',routeAlias:c.name,lineageId:lineage?.id??randomUUID(),migrationNamespace:'KELRYVO',policyId:c.id,policyRevision:'1',
          exactOwner:owner,deploymentPrincipalId:c.id,principalPurpose:'DEPLOY',principalUsername:deployment.username,privatePrincipalRef:deployment.credentialRef,principalAlias:'Instance migration principal',reason:b.reason});
        const binding=await createTargetBinding(tx,{projectId:req.params.projectId,assignmentId:a.id,expectedAssignmentRevision:a.revision,environmentId:env.id,
          targetOptionId:option.optionId,expectedTargetOptionRevision:option.optionRevision,...(existing?{bindingId:existing.id}:{}),expectedBindingRevision:String(existing?.current_revision??'0'),reason:b.reason,actorId:req.actor.id});
        bindings.push(binding.binding);
      }
      await audited(tx,req,'INSTANCE_SCHEMAS_ASSIGNED',c.id,{owners:b.owners,environmentId:env.id,revision:String(c.revision)});
      return {bindings};
    });return reply.code(201).send(result);
  });
}
