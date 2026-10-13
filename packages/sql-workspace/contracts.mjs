export const SQL_DRAFT_MAX_BYTES = 1_048_576;

export function draftPath(projectId, draftId) {
  if (!isUuid(projectId) || (draftId !== undefined && !isUuid(draftId))) throw new TypeError('Invalid SQL draft identity');
  return `/api/projects/${encodeURIComponent(projectId)}/sql-drafts${draftId ? `/${encodeURIComponent(draftId)}` : ''}`;
}

export function validateDraft(draft) {
  if (!draft || !isUuid(draft.id) || typeof draft.name !== 'string' || !draft.name.trim()
      || typeof draft.sql !== 'string' || new TextEncoder().encode(draft.sql).length > SQL_DRAFT_MAX_BYTES
      || !revision(draft.revision)) return false;
  return true;
}

export function compareRevisionContent(base, candidate) {
  if (!validateDraftRevision(base) || !validateDraftRevision(candidate)) throw new TypeError('Invalid SQL draft revision');
  return { baseRevision: base.revision, candidateRevision: candidate.revision,
    changed: base.sql !== candidate.sql, baseSql: base.sql, candidateSql: candidate.sql };
}

export function classifyWorkspaceError(error) {
  const code = typeof error?.message === 'string' ? error.message : '';
  if (code === 'DRAFT_REVISION_CONFLICT' || code === 'REVISION_CONFLICT') return 'This draft changed elsewhere. Reload it before saving.';
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN') return 'This draft is unavailable in the selected project.';
  if (code === 'RELEASE_INTEGRITY_FAILED') return 'The retained release failed its integrity check. Ask an operator to review its stored source evidence before retrying.';
  if (code === 'INVALID_REQUEST') return 'The draft could not be saved. Check its name and SQL size.';
  if (code === 'TARGET_REVISION_CONFLICT' || code === 'SOURCE_BINDING_MISMATCH') return 'Project or target evidence changed. Refresh the project before continuing.';
  return `SQL workspace request failed (${code || 'UNAVAILABLE'}). Refresh and retry.`;
}

const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validateDraftRevision = value => value && revision(value.revision) && typeof value.sql === 'string';
const revision = value => typeof value === 'string' ? /^[1-9][0-9]{0,18}$/.test(value) : Number.isSafeInteger(value) && value > 0;
