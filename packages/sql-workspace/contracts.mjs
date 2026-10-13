export const SQL_DRAFT_MAX_BYTES = 1_048_576;

export function draftPath(projectId, draftId) {
  if (!isUuid(projectId) || (draftId !== undefined && !isUuid(draftId))) throw new TypeError('Invalid SQL draft identity');
  return `/api/projects/${encodeURIComponent(projectId)}/sql-drafts${draftId ? `/${encodeURIComponent(draftId)}` : ''}`;
}

export function validateDraft(draft) {
  if (!draft || !isUuid(draft.id) || typeof draft.name !== 'string' || !draft.name.trim()
      || typeof draft.sql !== 'string' || new TextEncoder().encode(draft.sql).length > SQL_DRAFT_MAX_BYTES
      || !revision(draft.revision)) return false;
  if (draft.manifestVersion !== undefined && ![1, 2].includes(draft.manifestVersion)) return false;
  if (draft.files !== undefined) {
    if (!Array.isArray(draft.files) || draft.files.length < 1 || draft.files.length > 128) return false;
    const ids = new Set(), paths = new Set();
    let bytes = 0;
    for (const file of draft.files) {
      if (!file || !isUuid(file.id) || typeof file.path !== 'string' || file.path.length > 200
          || !/^V\d+(?:[._]\d+)*__[A-Za-z0-9_-]+\.sql$/.test(file.path)
          || typeof file.sql !== 'string' || ids.has(file.id) || paths.has(file.path)) return false;
      ids.add(file.id); paths.add(file.path);
      bytes += new TextEncoder().encode(file.sql).length;
      if (bytes > SQL_DRAFT_MAX_BYTES) return false;
    }
    if (draft.sql !== draft.files[0].sql) return false;
  } else if (draft.manifestVersion === 2) return false;
  return true;
}

export function compareRevisionContent(base, candidate) {
  if (!validateDraftRevision(base) || !validateDraftRevision(candidate)) throw new TypeError('Invalid SQL draft revision');
  return { baseRevision: base.revision, candidateRevision: candidate.revision,
    changed: base.sql !== candidate.sql, baseSql: base.sql, candidateSql: candidate.sql };
}

export function classifyWorkspaceError(error) {
  const code = typeof error?.message === 'string' ? error.message : '';
  if (code === 'DRAFT_REVISION_CONFLICT' || code === 'REVISION_CONFLICT') return 'This draft changed elsewhere. Copy or discard unsaved edits, then refresh.';
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN') return 'This draft is unavailable in the selected project.';
  if (code === 'RELEASE_INTEGRITY_FAILED') return 'The retained release failed its integrity check. Ask an operator to review its stored source evidence before retrying.';
  if (code === 'INVALID_REQUEST') return 'Check the draft name, migration filenames, unique versions and total SQL size, then retry.';
  if (code === 'INVALID_DRAFT_RESPONSE') return 'The saved draft response is incomplete. Refresh to reload its files; the current editor has been preserved.';
  if (code === 'TARGET_REVISION_CONFLICT' || code === 'SOURCE_BINDING_MISMATCH') return 'Project or target evidence changed. Refresh the project before continuing.';
  return `SQL workspace request failed (${code || 'UNAVAILABLE'}). Refresh and retry.`;
}

const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const validateDraftRevision = value => value && revision(value.revision) && typeof value.sql === 'string';
const revision = value => typeof value === 'string' ? /^[1-9][0-9]{0,18}$/.test(value) : Number.isSafeInteger(value) && value > 0;
