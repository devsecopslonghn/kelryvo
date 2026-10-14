import { acquireTargetLocks } from '../targets/locks.ts';
import { getTargetBinding, ORG } from '../targets/index.ts';
import { normalizeObservation, acceptedOracleObservation } from '../connectivity/evidence.mjs';
import { normalizeSchema, compareSchemas } from './contracts.mjs';
import { publicSnapshot, schemaDriftContext } from './store.ts';

const uuid=(v:any)=>typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const text=(v:any,max=2000)=>typeof v==='string' && v.trim().length>0 && v.length<=max && !/[\u0000-\u001f\u007f]/.test(v);
const fail=(code:string,status=409)=>Object.assign(new Error(code),{productCode:code,connectivityStatus:status});
const exact=(b:any,keys:string[])=>b && typeof b==='object' && !Array.isArray(b) && Object.keys(b).length===keys.length && keys.every(k=>Object.hasOwn(b,k));
export function registerSchemaBaselines({sql,route,guard,connection,audited,runtime,running,deadline}:any) {
  const base='/api/projects/:projectId';
  const snapshot=async(tx:any,req:any,id:string)=>{
    if(!uuid(id))throw fail('NOT_FOUND',404);
    const s=(await tx`SELECT * FROM sf_schema_snapshots WHERE id=${id} AND project_id=${req.params.projectId} AND organization_id=${ORG}`)[0];
    if(!s)throw fail('NOT_FOUND',404);return s;
  };
  const binding=async(tx:any,req:any,id:string)=>{
    if(!uuid(id))throw fail('NOT_FOUND',404);
    const detail=await getTargetBinding(tx,req.params.projectId,id);
    if(!detail)throw fail('NOT_FOUND',404);return detail;
  };
  const targetPath=`${base}/target-bindings/:bindingId/schema`;
  route('get',targetPath,async(req:any)=>sql.begin(async(tx:any)=>{
    const canManage=await guard(tx,req);const detail=await binding(tx,req,req.params.bindingId);
    if(Object.keys(req.query).some(k=>!['after','baselineAfter'].includes(k)) || req.query.after!==undefined && !uuid(req.query.after) || req.query.baselineAfter!==undefined && !uuid(req.query.baselineAfter))throw fail('INVALID_REQUEST',400);
    let cursor:any=null;if(req.query.after)cursor=await snapshot(tx,req,req.query.after);
    if(cursor && cursor.binding_id!==req.params.bindingId)throw fail('INVALID_REQUEST',400);
    const rows=await tx`SELECT * FROM sf_schema_snapshots WHERE project_id=${req.params.projectId} AND binding_id=${req.params.bindingId}
      AND (${cursor?.id??null}::uuid IS NULL OR (observed_at,id)<(SELECT observed_at,id FROM sf_schema_snapshots WHERE id=${cursor?.id??null}::uuid))
      ORDER BY observed_at DESC,id DESC LIMIT 51`;
    const baselineCursor=req.query.baselineAfter?(await tx`SELECT b.created_at,b.id FROM sf_schema_baselines b JOIN sf_schema_snapshots s ON s.id=b.snapshot_id
      WHERE b.id=${req.query.baselineAfter} AND b.project_id=${req.params.projectId} AND s.binding_id=${req.params.bindingId}`)[0]:null;
    if(req.query.baselineAfter && !baselineCursor)throw fail('INVALID_REQUEST',400);
    const baselines=await tx`SELECT b.id,b.name,b.reason,b.snapshot_id AS "snapshotId",b.created_at AS "createdAt",s.content_digest AS "contentDigest",s.provenance,s.schema->'coverage' AS coverage
      FROM sf_schema_baselines b JOIN sf_schema_snapshots s ON s.id=b.snapshot_id WHERE b.project_id=${req.params.projectId} AND s.binding_id=${req.params.bindingId}
      AND (${baselineCursor?.id??null}::uuid IS NULL OR (b.created_at,b.id)<(SELECT created_at,id FROM sf_schema_baselines WHERE id=${baselineCursor?.id??null}::uuid))
      ORDER BY b.created_at DESC,b.id DESC LIMIT 101`;
    return {binding:detail.binding,currentness:detail.currentness,canManage,snapshots:rows.slice(0,50).map((r:any)=>publicSnapshot(r,false)),
      nextCursor:rows.length>50?rows[49].id:null,baselines:baselines.slice(0,100),baselinesTruncated:baselines.length>100,baselineNextCursor:baselines.length>100?baselines[99].id:null,
      drift:await schemaDriftContext(tx,req.params.projectId,req.params.bindingId)};
  }));
  route('get',`${base}/schema-snapshots/:snapshotId`,async(req:any)=>sql.begin(async(tx:any)=>{
    await guard(tx,req);if(Object.keys(req.query).length)throw fail('INVALID_REQUEST',400);
    return {snapshot:publicSnapshot(await snapshot(tx,req,req.params.snapshotId))};
  }));
  route('get',`${base}/schema-comparison`,async(req:any)=>sql.begin(async(tx:any)=>{
    await guard(tx,req);if(Object.keys(req.query).sort().join(',')!=='expected,observed')throw fail('INVALID_REQUEST',400);
    const expected=await snapshot(tx,req,req.query.expected),observed=await snapshot(tx,req,req.query.observed);
    if(expected.stream_id!==observed.stream_id || expected.route_id!==observed.route_id)throw fail('SCHEMA_TARGET_MISMATCH');
    return {expected:publicSnapshot(expected,false),observed:publicSnapshot(observed,false),comparison:compareSchemas(publicSnapshot(expected),publicSnapshot(observed)),executionAuthority:false};
  }));
  route('post',`${base}/schema-baselines`,async(req:any,reply:any)=>{
    const b=req.body;if(!exact(b,['snapshotId','name','reason']) || !uuid(b.snapshotId) || !text(b.name,120) || !text(b.reason))throw fail('INVALID_REQUEST',400);
    const result=await sql.begin(async(tx:any)=>{
      await guard(tx,req,true);const s=await snapshot(tx,req,b.snapshotId);
      const baseline=(await tx`INSERT INTO sf_schema_baselines(organization_id,project_id,snapshot_id,name,reason,actor_id)
        VALUES(${ORG},${req.params.projectId},${s.id},${b.name.trim()},${b.reason.trim()},${req.actor.id})
        RETURNING id,name,snapshot_id AS "snapshotId",created_at AS "createdAt"`)[0];
      await audited(tx,req,'SCHEMA_BASELINE_CAPTURED',s.connection_id,{baselineId:baseline.id,snapshotId:s.id,contentDigest:s.content_digest});
      return {baseline};
    });return reply.code(201).send(result);
  });
  route('post',`${targetPath}/observe`,async(req:any,reply:any)=>{
    const b=req.body;
    if(!exact(b,['connectionId','expectedBindingRevision','expectedAssignmentRevision','reason']) || !uuid(b.connectionId)
      || !/^[1-9][0-9]{0,18}$/.test(b.expectedBindingRevision??'') || !/^[1-9][0-9]{0,18}$/.test(b.expectedAssignmentRevision??'') || !text(b.reason))throw fail('INVALID_REQUEST',400);
    const inspect=async(tx:any)=>{
      await acquireTargetLocks(tx,{bindingId:req.params.bindingId});await guard(tx,req,true);
      const detail=await binding(tx,req,req.params.bindingId),t=detail.binding;
      if(t.bindingRevision!==b.expectedBindingRevision || t.assignmentRevision!==b.expectedAssignmentRevision)throw fail('TARGET_REVISION_CONFLICT');
      const c=await connection(tx,{...req,params:{...req.params,connectionId:b.connectionId}});
      if(c.route_id!==t.routeId)throw fail('SCHEMA_TARGET_MISMATCH');
      if(c.retired_at || !c.enabled || c.service_kind!=='SERVICE_NAME')throw fail('CONNECTION_INELIGIBLE');
      // Schema refresh may diagnose stale Oracle evidence, but never bypass configuration/assignment changes.
      if(detail.currentness.state!=='CURRENT' && !detail.currentness.reasons.every((r:string)=>r.startsWith('OBSERVATION_') || r==='LIVE_VERIFICATION_UNACCEPTED'))throw fail('TARGET_REVISION_CONFLICT');
      return {c,t};
    };
    if(!uuid(req.params.bindingId))throw fail('NOT_FOUND',404);
    const {c,t}=await sql.begin(inspect);
    if(running.has(c.id) || running.size>=2)throw fail('DISCOVERY_BUSY',429);
    let raw:any={status:'UNAVAILABLE',provenance:'UNAVAILABLE',limitations:['RUNTIME_UNAVAILABLE']};
    if(runtime && c.engine==='oracle'){
      running.add(c.id);const controller=new AbortController();let timer:any;
      const work=Promise.resolve().then(()=>runtime.run({id:c.id,engine:c.engine,host:c.host,port:c.port,service:c.service,transport:c.transport,username:c.username,credentialRef:c.credential_ref},'SCHEMA',{signal:controller.signal,owner:t.exactOwner}));
      work.then(()=>running.delete(c.id),()=>running.delete(c.id));
      try{raw=await Promise.race([work,new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({status:'TIMEOUT',provenance:'UNAVAILABLE'});},deadline);})]);}
      catch{raw={status:'UNAVAILABLE',provenance:'UNAVAILABLE'};}finally{clearTimeout(timer);}
    }
    const observation=normalizeObservation(raw,'DISCOVER');
    // An unavailable identity or wrong endpoint cannot establish object absence.
    let metadata=raw?.schema;
    if(!observation.identity || observation.provenance==='UNAVAILABLE' || observation.limitations.includes('IDENTITY_MISMATCH'))metadata=null;
    const schema=normalizeSchema(metadata,t.exactOwner);
    if(!metadata)schema.limitations=[...new Set([...schema.limitations,'IDENTITY_INCOMPLETE'])];
    // Recompute after appending diagnostics so the digest covers exactly the retained payload.
    const normalized=normalizeSchema(schema,t.exactOwner);
    const result=await sql.begin(async(tx:any)=>{
      const current=await inspect(tx);
      if(String(current.c.revision)!==String(c.revision))throw fail('CONNECTION_REVISION_CONFLICT');
      const s=(await tx`INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,
        connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,verification_acceptance,actor_id,reason)
        VALUES(${ORG},${req.params.projectId},${t.bindingId},${t.bindingRevision}::bigint,${t.assignmentRevision}::bigint,${t.streamId},${t.routeId},${c.id},${c.revision},${t.exactOwner},
        ${observation.identity?tx.json(observation.identity):null},${observation.identityDigest},${tx.json(normalized)},${normalized.contentDigest},${observation.provenance},
        ${observation.provenance==='ORACLE_READ_ONLY' && acceptedOracleObservation(observation.identity,observation.verificationAcceptance,t.exactOwner)},
        ${observation.verificationAcceptance?tx.json(observation.verificationAcceptance):null},${req.actor.id},${b.reason.trim()}) RETURNING *`)[0];
      await audited(tx,req,'SCHEMA_OBSERVED',c.id,{snapshotId:s.id,bindingId:t.bindingId,bindingRevision:t.bindingRevision,contentDigest:s.content_digest,provenance:s.provenance});
      return {snapshot:publicSnapshot(s)};
    });return reply.code(201).send(result);
  });
  route('get',`${base}/plans/:planId/schema-drift`,async(req:any)=>sql.begin(async(tx:any)=>{
    await guard(tx,req);if(!uuid(req.params.planId) || Object.keys(req.query).length)throw fail('NOT_FOUND',404);
    const p=(await tx`SELECT offline_intent_envelope FROM sf_plans WHERE id=${req.params.planId} AND project_id=${req.params.projectId}`)[0];
    if(!p)throw fail('NOT_FOUND',404);
    const e=(await tx`SELECT binding_id FROM sf_plan_schema_evidence WHERE plan_id=${req.params.planId}`)[0];
    return e?await schemaDriftContext(tx,req.params.projectId,e.binding_id,req.params.planId):{latest:null,baseline:null,comparison:null,retainedSnapshot:null,executionAuthority:false};
  }));
}
