import { ORG } from '../targets/index.ts';
import { compareSchemas } from './contracts.mjs';
export function publicSnapshot(r:any, includeSchema=true) {
  return {id:r.id,projectId:r.project_id,bindingId:r.binding_id,bindingRevision:String(r.binding_revision),
    assignmentRevision:String(r.assignment_revision),streamId:r.stream_id,routeId:r.route_id,
    connectionId:r.connection_id,connectionRevision:String(r.connection_revision),owner:r.owner,
    identity:r.identity,identityDigest:r.identity_digest,contentDigest:r.content_digest,provenance:r.provenance,
    liveAccepted:r.live_accepted,observedAt:r.observed_at,reason:r.reason,actorId:r.actor_id,
    coverage:r.schema.coverage,limitations:r.schema.limitations,objectCount:r.schema.objects.length,
    ...(includeSchema?{schema:r.schema}:{})};
}
export async function retainPlanSchema(tx:any,plan:any,target:any) {
  if(!target)return;
  const snapshot=(await tx`SELECT id,content_digest FROM sf_schema_snapshots WHERE project_id=${plan.project_id}
    AND binding_id=${target.bindingId} AND binding_revision=${target.bindingRevision}::bigint
    ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
  await tx`INSERT INTO sf_plan_schema_evidence(plan_id,organization_id,project_id,binding_id,target_created_at,snapshot_id,snapshot_digest)
    VALUES(${plan.id},${ORG},${plan.project_id},${target.bindingId},${target.createdAt},${snapshot?.id??null},${snapshot?.content_digest??null})`;
}
// All newer observations are considered: a later restoration must never revive old approval authority.
export async function schemaPlanChanged(tx:any,projectId:string,target:any) {
  if(typeof target.createdAt!=='string')return false;
  const evidence=(await tx`SELECT e.snapshot_id,e.snapshot_digest,s.observed_at,s.identity_digest FROM sf_plan_schema_evidence e
    LEFT JOIN sf_schema_snapshots s ON s.id=e.snapshot_id WHERE e.project_id=${projectId}
    AND e.binding_id=${target.bindingId} AND e.target_created_at=${target.createdAt} LIMIT 1`)[0];
  if(!evidence)return false; // Existing plans retain their original compatibility contract.
  return !!(await tx`SELECT 1 FROM sf_schema_snapshots s WHERE s.project_id=${projectId} AND s.binding_id=${target.bindingId}
    AND s.binding_revision=${target.bindingRevision}::bigint
    AND ((${evidence.snapshot_id??null}::uuid IS NULL AND s.observed_at>${target.createdAt}::timestamptz)
      OR (${evidence.snapshot_id??null}::uuid IS NOT NULL AND (s.observed_at,s.id)>(SELECT observed_at,id FROM sf_schema_snapshots WHERE id=${evidence.snapshot_id??null}::uuid)))
    AND (s.content_digest IS DISTINCT FROM ${evidence.snapshot_digest??null} OR s.identity_digest IS DISTINCT FROM ${evidence.identity_digest??null}
      OR EXISTS(SELECT 1 FROM jsonb_each_text(s.schema->'coverage') c WHERE c.value<>'COMPLETE')) LIMIT 1`)[0];
}
export async function schemaDriftContext(tx:any,projectId:string,bindingId:string,planId?:string) {
  const latest=(await tx`SELECT * FROM sf_schema_snapshots WHERE project_id=${projectId} AND binding_id=${bindingId}
    ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
  const baseline=(await tx`SELECT b.id AS baseline_id,b.name AS baseline_name,s.* FROM sf_schema_baselines b
    JOIN sf_schema_snapshots s ON s.id=b.snapshot_id WHERE b.project_id=${projectId} AND s.binding_id=${bindingId}
    ORDER BY b.created_at DESC,b.id DESC LIMIT 1`)[0];
  const retained=planId?(await tx`SELECT e.snapshot_id,e.snapshot_digest,s.* FROM sf_plan_schema_evidence e LEFT JOIN sf_schema_snapshots s ON s.id=e.snapshot_id WHERE e.plan_id=${planId} AND e.project_id=${projectId}`)[0]:null;
  return {latest:latest?publicSnapshot(latest,false):null,baseline:baseline?{id:baseline.baseline_id,name:baseline.baseline_name,snapshotId:baseline.id}:null,
    comparison:latest&&baseline?compareSchemas(publicSnapshot(baseline),publicSnapshot(latest)):null,
    retainedSnapshot:retained?.id?{...publicSnapshot(retained,false),digest:retained.snapshot_digest}:null,executionAuthority:false};
}
