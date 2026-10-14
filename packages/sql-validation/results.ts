import { createHash } from 'node:crypto';
import { previewRetainedStatements } from '../migrations/statement-preview.mjs';
import { verifyRetainedRelease } from '../migrations/verify-retained-release.mjs';
import { MAX_PLAN_STATEMENTS } from '../migrations/offline-plan-intent.mjs';
import { REVIEW_PROFILE, reviewSqlStatements } from './review.mjs';
import { catalogContext } from './catalog-context.mjs';
import { publicTarget } from '../targets/public.mjs';
import { loadBindingTarget, checkTargetCurrentness } from '../targets/index.ts';

export const MAX_VALIDATION_BYTES = 2 * 1024 * 1024;
export const VALIDATION_PROFILE = 'kelryvo-schema-review-v1';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const validationFailure = (code: string) => Object.assign(new Error(code), {productCode:code,validationStatus:409});

/** Owner visibility and immutable schema observations are distinct evidence scopes. */
export async function readSchemaEvidence(tx: any, projectId: string, target: any) {
  let metadata:any={observationId:null,evidenceDigest:null,identityDigest:null,provenance:'MANUAL_REFERENCE',
    observedAt:null,expiresAt:null,owner:target.exactOwner,accessible:null,completeness:'NOT_OBSERVED',objects:'NOT_OBSERVED'};
  if(target.observationDigest) {
    const e = (await tx`SELECT e.digest,e.identity_digest,e.observation_id,e.exact_owner,o.provenance,o.observed_at,o.expires_at,
      o.schemas FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id
      WHERE e.digest=${target.observationDigest} AND e.project_id=${projectId}`)[0];
    if (!e || e.exact_owner !== target.exactOwner) throw validationFailure('VALIDATION_EVIDENCE_UNAVAILABLE');
    metadata={observationId:e.observation_id,evidenceDigest:e.digest,identityDigest:e.identity_digest,provenance:e.provenance,
      observedAt:new Date(e.observed_at).toISOString(),expiresAt:new Date(e.expires_at).toISOString(),
      owner:e.exact_owner,accessible:e.schemas.find((s:any)=>s.owner===e.exact_owner)?.accessible ?? null,
      completeness:'OWNER_VISIBILITY_ONLY',objects:'NOT_OBSERVED'};
  }
  const s=(await tx`SELECT id,content_digest,identity_digest,provenance,observed_at,live_accepted,schema->'coverage' AS coverage,
    schema->'limitations' AS limitations,jsonb_array_length(schema->'objects') AS object_count,
    (SELECT jsonb_agg(jsonb_build_object('owner',o->>'owner','name',o->>'name','type',o->>'type','checksum',o->>'checksum') ORDER BY o->>'type',o->>'name')
      FROM jsonb_array_elements(schema->'objects') o) AS objects
    FROM sf_schema_snapshots WHERE project_id=${projectId} AND binding_id=${target.bindingId}
    AND binding_revision=${target.bindingRevision}::bigint AND owner=${target.exactOwner} ORDER BY observed_at DESC,id DESC LIMIT 1`)[0];
  return {...metadata,schemaSnapshot:s?{id:s.id,contentDigest:s.content_digest,identityDigest:s.identity_digest,
    provenance:s.provenance,observedAt:new Date(s.observed_at).toISOString(),liveAccepted:s.live_accepted,
    coverage:s.coverage,limitations:s.limitations,objectCount:s.object_count,objects:s.objects??[]}:null};
}

export async function buildValidation(release: any, project: any, target: any, metadata: any) {
  // Status remains the retained parser verdict; this copy verifies only the source manifest/bytes.
  if (!verifyRetainedRelease({...release,files:release.files.map((f:any)=>({...f,validationStatus:'VALID'}))})) throw validationFailure('RELEASE_INTEGRITY_FAILED');
  const statements: any[] = [], identities: any[] = [];
  let ordinal = 0;
  if (release.validation_status === 'VALID') {
    for (const file of release.files) {
      const preview: any = await previewRetainedStatements(release,file.path);
      if (!preview.ok) throw validationFailure('VALIDATION_PARSER_UNAVAILABLE');
      for (const [index,s] of preview.statements.entries()) {
        if (++ordinal>MAX_PLAN_STATEMENTS) throw validationFailure('VALIDATION_TOO_LARGE');
        statements.push({ordinal,path:file.path,sourceSql:s.sourceSql});
        identities.push({ordinal,path:file.path,fileOrdinal:index+1,startByte:s.startByte,endByte:s.endByte,
          sourceSha256:s.sourceSha256,executionSha256:s.executionSha256});
      }
    }
  }
  const review=catalogContext(reviewSqlStatements(statements,target.exactOwner,target.engine),target.exactOwner,metadata.schemaSnapshot,metadata.identityDigest);
  // Retain only referenced object summaries, not the entire catalog or object definitions.
  if(metadata.schemaSnapshot) {
    const {objects,...snapshot}=metadata.schemaSnapshot;
    metadata={...metadata,schemaSnapshot:snapshot};
  }
  const findings: any[] = [];
  if (release.validation_status !== 'VALID') findings.push({code:'SYNTAX_NOT_VALID',severity:'BLOCKING',rationale:'The retained parser result does not establish valid Oracle syntax.'});
  if (metadata.accessible !== true) findings.push({code:'SCHEMA_VISIBILITY_UNVERIFIED',severity:'UNKNOWN',rationale:'The target schema has no current observed visibility evidence.'});
  findings.push(metadata.schemaSnapshot ? {code:'SCHEMA_STRUCTURE_OBSERVED',severity:'UNKNOWN',rationale:`Immutable schema snapshot ${metadata.schemaSnapshot.id} provides structural context (${metadata.schemaSnapshot.provenance}). Visibility and collection consistency limitations remain; Oracle compilation and privileges are unverified.`} : {code:'OBJECT_METADATA_UNAVAILABLE',severity:'UNKNOWN',rationale:'No object snapshot is retained. Existing objects, columns, constraints and privileges were not observed.'});
  const blocking=findings.some(f=>f.severity==='BLOCKING') || review.some((s:any)=>s.findings.some((f:any)=>f.severity==='BLOCKING'));
  const targetFacts=publicTarget(target);
  // Explicit selection avoids timestamps/currentness that would make identical input nondeterministic.
  const report={format:1,profile:VALIDATION_PROFILE,reviewProfile:REVIEW_PROFILE,projectId:project.id,releaseId:release.id,
    sourceBindingGeneration:project.source_binding_generation,manifestDigest:release.manifest_digest,parserProfile:release.parser_profile,
    target:{bindingId:targetFacts.bindingId,bindingRevision:targetFacts.bindingRevision,assignmentId:targetFacts.assignmentId,
      assignmentRevision:targetFacts.assignmentRevision,profileId:targetFacts.profileId,environmentId:targetFacts.environmentId,
      exactOwner:targetFacts.exactOwner,identityState:targetFacts.identityState,observationDigest:targetFacts.observationDigest,
      policyId:targetFacts.policyId,policyRevision:targetFacts.policyRevision},metadata,
    capabilities:{engine:target.engine,syntax:target.engine==='oracle'?'PINNED_ANTLR_ORACLE':'UNSUPPORTED',
      schema:'OWNER_VISIBILITY_AND_BOUNDED_REFERENCE_REVIEW',objects:'UNVERIFIED',semantics:'UNVERIFIED'},
    syntax:release.validation_status==='VALID'?'VALID':'INVALID_OR_UNAVAILABLE',
    outcome:blocking?'BLOCKED':'UNVERIFIED',policy:{id:target.policyId,revision:target.policyRevision,
      decision:blocking?'BLOCKED':'INDEPENDENT_REVIEW_REQUIRED',executionAuthority:false},
    findings,statements:review.map((s:any,index:number)=>({...identities[index],...s}))};
  const envelope=JSON.stringify(report);
  if(Buffer.byteLength(envelope)>MAX_VALIDATION_BYTES)throw validationFailure('VALIDATION_TOO_LARGE');
  return {envelope,digest:hash(envelope),report};
}

export function verifyValidation(envelope: any,digest: any,expected: any={}) {
  try {
    if(typeof envelope!=='string' || Buffer.byteLength(envelope)>MAX_VALIDATION_BYTES || !/^[a-f0-9]{64}$/.test(digest??'') || hash(envelope)!==digest)return null;
    const report=JSON.parse(envelope);
    if(report.format!==1 || report.profile!==VALIDATION_PROFILE || JSON.stringify(report.reviewProfile)!==JSON.stringify(REVIEW_PROFILE)
      || !['BLOCKED','UNVERIFIED'].includes(report.outcome) || !Array.isArray(report.statements)
      || report.statements.length>MAX_PLAN_STATEMENTS || report.policy?.executionAuthority!==false
      || Object.entries(expected).some(([key,value])=>JSON.stringify(report[key])!==JSON.stringify(value)))return null;
    return report;
  }catch{return null;}
}

export async function loadValidation(tx: any,projectId: string,id: string,digest?: string) {
  const row=(await tx`SELECT id,digest,actor_id,created_at,CASE WHEN octet_length(envelope)<=${MAX_VALIDATION_BYTES} THEN envelope END AS envelope
    FROM sf_sql_validations WHERE id=${id} AND project_id=${projectId}`)[0];
  if(!row || digest && row.digest!==digest)return null;
  const report=verifyValidation(row.envelope,row.digest,{projectId});
  return report ? {id:row.id,digest:row.digest,actorId:row.actor_id,createdAt:row.created_at,report} : null;
}

export async function validationForIntent(tx:any,intent:any) {
  if(!intent.validation)return null;
  const result=await loadValidation(tx,intent.projectId,intent.validation.id,intent.validation.digest);
  const r=result?.report;
  if(!r || r.releaseId!==intent.releaseId || r.manifestDigest!==intent.manifestDigest
    || r.parserProfile!==intent.parserProfile || r.capabilities.engine!==intent.engine
    || r.target.profileId!==intent.profileId || r.target.environmentId!==intent.environmentId
    || r.target.bindingId!==intent.target?.bindingId || r.target.bindingRevision!==intent.target?.bindingRevision
    || r.target.assignmentId!==intent.target?.assignmentId || r.target.assignmentRevision!==intent.target?.assignmentRevision
    || r.target.observationDigest!==intent.target?.observationDigest || r.target.exactOwner!==intent.target?.exactOwner
    || r.target.policyId!==intent.target?.policyId || r.target.policyRevision!==intent.target?.policyRevision
    || r.metadata.evidenceDigest!==intent.target?.observationDigest
    || r.sourceBindingGeneration!==intent.target?.sourceBindingGeneration || r.policy.decision==='BLOCKED')throw validationFailure('VALIDATION_EVIDENCE_UNAVAILABLE');
  const identities=r.statements.map(({ordinal,path,fileOrdinal,startByte,endByte,sourceSha256,executionSha256}:any)=>({ordinal,path,fileOrdinal,startByte,endByte,sourceSha256,executionSha256}));
  if(JSON.stringify(identities)!==JSON.stringify(intent.statements))throw validationFailure('VALIDATION_EVIDENCE_UNAVAILABLE');
  return result;
}

export async function validationCurrentness(tx:any,result:any) {
  const r=result.report,target=await loadBindingTarget(tx,r.projectId,r.target.bindingId);
  if(!target)return {state:'UNKNOWN',reasons:['TARGET_UNAVAILABLE']};
  if(target.bindingRevision!==r.target.bindingRevision)return {state:'STALE',reasons:['BINDING_SUPERSEDED']};
  if(target.sourceBindingGeneration!==r.sourceBindingGeneration)return {state:'STALE',reasons:['SOURCE_CHANGED']};
  if(Object.hasOwn(r.metadata,'schemaSnapshot')) {
    const snapshot=r.metadata.schemaSnapshot;
    const changed=(await tx`SELECT 1 FROM sf_schema_snapshots s WHERE s.project_id=${r.projectId} AND s.binding_id=${r.target.bindingId}
      AND s.binding_revision=${r.target.bindingRevision}::bigint
      AND ((${snapshot?.id??null}::uuid IS NULL AND s.observed_at>${result.createdAt}::timestamptz)
        OR (${snapshot?.id??null}::uuid IS NOT NULL AND (s.observed_at,s.id)>(SELECT observed_at,id FROM sf_schema_snapshots WHERE id=${snapshot?.id??null}::uuid)))
      AND (s.content_digest IS DISTINCT FROM ${snapshot?.contentDigest??null} OR s.identity_digest IS DISTINCT FROM ${snapshot?.identityDigest??null}) LIMIT 1`)[0];
    if(changed)return {state:'STALE',reasons:['SCHEMA_OBSERVATION_CHANGED']};
  }
  return checkTargetCurrentness(tx,r.projectId,target,r.sourceBindingGeneration);
}
