import { createHash } from 'node:crypto';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { actorHasProjectGrant, projectAccessMode, LOCAL_ORGANIZATION as ORG } from '../database/project-membership.ts';
import { preflightRetainedRelease } from '../migrations/retained-release-preflight.mjs';
import { verifyRetainedRelease } from '../migrations/verify-retained-release.mjs';
import { verifyOfflinePlanIntent, MAX_PLAN_STATEMENTS } from '../migrations/offline-plan-intent.mjs';
import { compareRetainedReleases } from '../migrations/compare-retained-releases.mjs';
import { previewRetainedStatements } from '../migrations/statement-preview.mjs';

const uuid = (v: any) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fail = (code: string, statusCode = 409) => Object.assign(new Error(code), { productCode: code, statusCode });
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const digest = (v: any) => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const identity = (r: any) => ({ id: r.id, commit: r.commit_id, objectFormat: r.object_format,
  repositoryId: r.repository_id, folder: r.folder, parserProfile: r.parser_profile, manifestDigest: r.manifest_digest });

type StatementRef = { startByte: number; endByte: number; sourceSha256: string; executionSha256: string };
type StatementFact = { ordinal: number; change: string; base: StatementRef | null; candidate: StatementRef | null; ambiguity?: string };

/** Compare exact parsed statement source without treating ordinal shifts as edits. */
export function compareStatements(base: any[], candidate: any[]): StatementFact[] {
  const left = new Map<string, number[]>(), right = new Map<string, number[]>();
  const collect = (items: any[], into: Map<string, number[]>) => items.forEach((item, index) => {
    const positions = into.get(item.sourceSha256) || [];
    positions.push(index); into.set(item.sourceSha256, positions);
  });
  collect(base, left); collect(candidate, right);
  const matched = new Map<number, { candidate: number }>();
  const matchedRight = new Set<number>();
  const duplicateLeft = new Set<number>(), duplicateRight = new Set<number>();
  for (const [hash, a] of left) {
    const b = right.get(hash) || [];
    if (a.length === 1 && b.length === 1) {
      matched.set(a[0], { candidate: b[0] }); matchedRight.add(b[0]);
    } else if (a.length && b.length) {
      a.forEach(index => duplicateLeft.add(index)); b.forEach(index => duplicateRight.add(index));
    }
  }
  const exactPairs = [...matched.entries()]; // Collected in base source order.
  const moved = new Set<number>();
  let maxCandidate = -1;
  for (const [i, pair] of exactPairs) {
    if (pair.candidate < maxCandidate) moved.add(i);
    maxCandidate = Math.max(maxCandidate, pair.candidate);
  }
  let minCandidate = candidate.length;
  for (let i = exactPairs.length - 1; i >= 0; i--) {
    const [index, pair] = exactPairs[i];
    if (pair.candidate > minCandidate) moved.add(index);
    minCandidate = Math.min(minCandidate, pair.candidate);
  }
  const usedLeft = new Set(matched.keys());
  const unmatchedLeft = base.map((_, i) => i).filter(i => !usedLeft.has(i));
  const unmatchedRight = candidate.map((_, i) => i).filter(i => !matchedRight.has(i));
  const unmatchedLeftSet = new Set(unmatchedLeft);
  // Delimiter/trivia changes with the same exact execution text can be paired.
  // A sole delete/add with different text is still an unresolved replacement.
  const pairedEdits = unmatchedLeft.length === 1 && unmatchedRight.length === 1
    && base[unmatchedLeft[0]].executionSha256 === candidate[unmatchedRight[0]].executionSha256;
  const refs = (item: any): StatementRef => ({ startByte: item.startByte, endByte: item.endByte,
    sourceSha256: item.sourceSha256, executionSha256: item.executionSha256 });
  const facts: StatementFact[] = [];
  for (let i = 0; i < base.length; i++) {
    const pair = matched.get(i);
    if (pair) {
      const j = pair.candidate;
      facts.push({ ordinal: i + 1, change: moved.has(i) ? 'MOVED' : 'UNCHANGED', base: refs(base[i]), candidate: refs(candidate[j]) });
    } else if (pairedEdits && unmatchedLeft[0] === i) {
      const j = unmatchedRight[0]; matchedRight.add(j);
      facts.push({ ordinal: i + 1, change: 'CHANGED', base: refs(base[i]), candidate: refs(candidate[j]) });
    } else if (unmatchedLeftSet.has(i)) {
      const ambiguous = duplicateLeft.has(i) || unmatchedRight.length > 0;
      facts.push({ ordinal: i + 1, change: ambiguous ? 'AMBIGUOUS' : 'REMOVED',
        ...(ambiguous ? { ambiguity: duplicateLeft.has(i) ? 'DUPLICATE_SOURCE' : 'MULTIPLE_MODIFICATION_CANDIDATES' } : {}), base: refs(base[i]), candidate: null });
    }
  }
  for (const j of unmatchedRight) if (!matchedRight.has(j)) facts.push({ ordinal: j + 1,
    change: duplicateRight.has(j) || unmatchedLeft.length ? 'AMBIGUOUS' : 'ADDED',
    ...(duplicateRight.has(j) || unmatchedLeft.length ? { ambiguity: duplicateRight.has(j) ? 'DUPLICATE_SOURCE' : 'MULTIPLE_MODIFICATION_CANDIDATES' } : {}), base: null, candidate: refs(candidate[j]) });
  return facts;
}

async function retained(tx: any, projectId: string, id: string) {
  if (!(await preflightRetainedRelease(tx, { id, projectId, organizationId: ORG })).valid) throw fail('COMPARISON_UNAVAILABLE');
  const r = (await tx`SELECT id,repository_id,commit_id,object_format,folder,parser_profile,manifest_digest,validation_status,files
    FROM sf_releases WHERE id=${id} AND project_id=${projectId} AND organization_id=${ORG}`)[0];
  if (!verifyRetainedRelease(r)) throw fail('COMPARISON_UNAVAILABLE');
  return r;
}

async function planSource(tx: any, projectId: string, planId: string) {
  const p = (await tx`SELECT id,project_id,organization_id,release_id,profile_id,author_id,status,
    CASE WHEN octet_length(offline_intent_envelope)<=1048576 THEN offline_intent_envelope END AS envelope,
    offline_intent_digest AS digest FROM sf_plans WHERE id=${planId} AND project_id=${projectId} AND organization_id=${ORG} FOR SHARE`)[0];
  if (!p) throw fail('NOT_FOUND', 404);
  const candidate = await retained(tx, projectId, p.release_id);
  const intent = verifyOfflinePlanIntent(p.envelope, p.digest, { organizationId: ORG, projectId,
    requesterId: p.author_id, releaseId: p.release_id, profileId: p.profile_id, commit: candidate.commit_id,
    objectFormat: candidate.object_format, folder: candidate.folder, parserProfile: candidate.parser_profile,
    manifestDigest: candidate.manifest_digest, items: candidate.files.map((f: any) => ({ path: f.path, version: f.version, sha256: f.sha256 })) });
  if (!intent) throw fail('FRESH_PLAN_REQUIRED');
  return { p, candidate, intent };
}

/** Resolve immutable audit evidence and reverify both retained source snapshots. */
export async function readPlanComparison(tx: any, projectId: string, planId: string, comparisonId: string) {
  const row = (await tx`SELECT id,actor_id,created_at,
    CASE WHEN octet_length(facts::text)<=1048576 THEN facts END AS facts FROM sf_audit
    WHERE id=${comparisonId} AND project_id=${projectId} AND organization_id=${ORG}
      AND resource_id=${planId} AND action='PLAN_SOURCE_COMPARED'`)[0];
  if (!row) throw fail('COMPARISON_STALE');
  const { p, candidate, intent } = await planSource(tx, projectId, planId);
  const e = row.facts?.evidence;
  if (!e || e.planId !== p.id || e.intentDigest !== intent.digest || !uuid(e.base?.id)
      || digest(e) !== row.facts.digest || digest(e.candidate) !== digest(identity(candidate))) throw fail('COMPARISON_STALE');
  const base = await retained(tx, projectId, e.base.id);
  if (digest(e.base) !== digest(identity(base))) throw fail('COMPARISON_STALE');
  return { id: row.id, digest: row.facts.digest, evidence: e, createdBy: row.actor_id, createdAt: row.created_at,
    facts: compareRetainedReleases(base, candidate), offline: true, executionAuthority: false };
}

export function registerSourceComparison(app: any, { sql, authenticate, statementParser }: any) {
  const route = (method: string, path: string, fn: any) => app[method](path, { preHandler: authenticate }, async (req: any, reply: any) => {
    reply.header('Cache-Control', 'no-store');
    if (!uuid(req.params.projectId) || !uuid(req.params.id)) return reply.code(404).send({ error: 'NOT_FOUND' });
    try {
      const result = await sql.begin(async (tx: any) => {
        await guardMutationAuthority(tx, req);
        if (await projectAccessMode(tx) !== 'ENFORCED' || !await actorHasProjectGrant(tx, req.actor.id, req.params.projectId)) throw fail('NOT_FOUND', 404);
        return fn(tx, req);
      });
      return reply.code(method === 'post' ? 201 : 200).send(result);
    } catch (e: any) { return reply.code(e.statusCode || 409).send({ error: e.productCode || 'COMPARISON_UNAVAILABLE' }); }
  });
  route('post', '/api/projects/:projectId/plans/:id/comparisons', async (tx: any, req: any) => {
    const b = req.body;
    if (!b || Object.keys(b).sort().join(',') !== 'baseReleaseId,expectedIntentDigest' || !uuid(b.baseReleaseId)
        || !/^[a-f0-9]{64}$/.test(b.expectedIntentDigest)) throw fail('INVALID_REQUEST', 400);
    const { p, candidate, intent } = await planSource(tx, req.params.projectId, req.params.id);
    if (b.expectedIntentDigest !== intent.digest) throw fail('COMPARISON_STALE');
    const project = (await tx`SELECT archived_at FROM sf_projects WHERE id=${p.project_id} AND organization_id=${ORG} FOR SHARE`)[0];
    const gate = (await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
    if (gate?.state !== 'ACTIVE') throw fail('METADATA_RESTORE_HOLD');
    if (project?.archived_at || p.status !== 'PENDING_APPROVAL') throw fail('PLAN_NOT_PENDING');
    const base = await retained(tx, p.project_id, b.baseReleaseId.toLowerCase());
    if (base.repository_id !== candidate.repository_id || base.folder !== candidate.folder || base.parser_profile !== candidate.parser_profile) throw fail('NOT_FOUND', 404);
    const facts = compareRetainedReleases(base, candidate);
    const files = [];
    let baseStatementCount = 0, candidateStatementCount = 0, evidenceBytes = 0;
    for (const fact of facts) {
      let statements: any = null;
      if (fact.change !== 'UNCHANGED') {
        const left: any = fact.base ? await previewRetainedStatements(base, fact.base.path, statementParser) : { ok: true, statements: [] };
        const right: any = fact.candidate ? await previewRetainedStatements(candidate, fact.candidate.path, statementParser) : { ok: true, statements: [] };
        baseStatementCount += left.statements?.length || 0;
        candidateStatementCount += right.statements?.length || 0;
        if (baseStatementCount > MAX_PLAN_STATEMENTS || candidateStatementCount > MAX_PLAN_STATEMENTS) throw fail('COMPARISON_UNAVAILABLE');
        if (left.ok && right.ok) {
          statements = compareStatements(left.statements || [], right.statements || []);
        }
      }
      const file = { version: fact.version, change: fact.change, basePath: fact.base?.path ?? null, candidatePath: fact.candidate?.path ?? null, statements };
      evidenceBytes += Buffer.byteLength(JSON.stringify(file));
      if (evidenceBytes > 900000) throw fail('COMPARISON_UNAVAILABLE');
      files.push(file);
    }
    const evidence = { format: 2, planId: p.id, intentDigest: intent.digest, base: identity(base), candidate: identity(candidate), alignment: 'VERSION_AND_STATEMENT_SOURCE', files };
    if (Buffer.byteLength(JSON.stringify(evidence)) > 900000) throw fail('COMPARISON_UNAVAILABLE');
    const sha = digest(evidence);
    await guardMutationAuthority(tx, req);
    const row = (await tx`INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts)
      VALUES(${p.project_id},${ORG},${req.actor.id},'PLAN_SOURCE_COMPARED',${p.id},${tx.json({ digest: sha, evidence })}) RETURNING id,created_at`)[0];
    return { comparison: { id: row.id, digest: sha, evidence, facts, createdBy: req.actor.id, createdAt: row.created_at, offline: true, executionAuthority: false } };
  });
  route('get', '/api/projects/:projectId/plans/:id/comparisons', async (tx: any, req: any) => {
    if (Object.keys(req.query).length) throw fail('INVALID_REQUEST', 400);
    await planSource(tx, req.params.projectId, req.params.id);
    const rows = await tx`SELECT id,created_at AS "createdAt",actor_id AS "createdBy",facts->>'digest' AS digest,
      facts->'evidence'->'base'->>'id' AS "baseReleaseId" FROM sf_audit WHERE project_id=${req.params.projectId}
      AND organization_id=${ORG} AND resource_id=${req.params.id} AND action='PLAN_SOURCE_COMPARED' ORDER BY created_at DESC,id DESC LIMIT 50`;
    return { comparisons: rows };
  });
  route('get', '/api/projects/:projectId/plans/:id/comparisons/:comparisonId', async (tx: any, req: any) => {
    if (!uuid(req.params.comparisonId) || Object.keys(req.query).length) throw fail('INVALID_REQUEST', 400);
    return { comparison: await readPlanComparison(tx, req.params.projectId, req.params.id, req.params.comparisonId) };
  });
}
