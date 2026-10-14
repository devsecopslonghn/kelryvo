export const SQL_DRAFT_MAX_BYTES = 1_048_576;

export function migrationFileVersion(path) {
  if(typeof path!=='string' || path.length>200)return null;
  const match=typeof path==='string' && /^V(\d+(?:[._]\d+)*)__[A-Za-z0-9_-]+\.sql$/.exec(path);
  if(!match)return null;
  const parts=match[1].split(/[._]/).map(part=>BigInt(part).toString());
  while(parts.length>1 && parts.at(-1)==='0')parts.pop();
  return parts.join('.');
}

export function compareMigrationFiles(a,b) {
  const av=(migrationFileVersion(a.path) || '0').split('.').map(BigInt),bv=(migrationFileVersion(b.path) || '0').split('.').map(BigInt);
  for(let i=0;i<Math.max(av.length,bv.length);i++){const x=av[i]??0n,y=bv[i]??0n;if(x!==y)return x<y?-1:1;}
  return a.path.localeCompare(b.path);
}

/** Reconcile whole files and metadata; never merge SQL text or persist choices. */
export function reconcileDraftConflict(base,local,remote,choices={},excludedIds=[]) {
  const conflicts=[],files=[];
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const pick=(key,label,b,l,r)=>{
    if(same(l,r))return l;
    if(same(l,b))return r;
    if(same(r,b))return l;
    conflicts.push({key,label,base:b,local:l,remote:r});
    return choices[key]==='local'?l:choices[key]==='remote'?r:undefined;
  };
  const map=rows=>new Map(rows.map(({id,path,sql})=>[id,{id,path,sql}]));
  const b=map(base.files),l=map(local.files),r=map(remote.files);
  for(const id of new Set([...b.keys(),...l.keys(),...r.keys()])){
    const file=pick(`file:${id}`,l.get(id)?.path || r.get(id)?.path || b.get(id)?.path,b.get(id)??null,l.get(id)??null,r.get(id)??null);
    if(file)files.push(file);
  }
  const name=pick('name','Draft name',base.name,local.name,remote.name);
  const targetBindingId=pick('target','Database target',base.targetBindingId,local.targetBindingId,remote.targetBindingId);
  const selected=files.filter(file=>!excludedIds.includes(file.id));
  const issues=[],versions=new Map(),paths=new Map();
  let bytes=0;
  for(const file of selected){
    const version=migrationFileVersion(file.path);
    if(!version || file.path.length>200)issues.push(`Invalid migration filename: ${file.path}`);
    if(paths.has(file.path))issues.push(`Duplicate migration filename: ${file.path}`);
    if(version && versions.has(version))issues.push(`Duplicate migration version: ${version}`);
    paths.set(file.path,file.id);if(version)versions.set(version,file.id);
    bytes+=new TextEncoder().encode(file.sql).length;
  }
  if(!selected.length || selected.length>128)issues.push('A draft must contain 1–128 files.');
  if(bytes>SQL_DRAFT_MAX_BYTES)issues.push('Combined SQL exceeds the 1 MiB draft limit.');
  if(name!==undefined && (typeof name!=='string' || !name.trim() || name.length>200 || /[\u0000-\u001f\u007f]/.test(name)))issues.push('Enter a valid draft name.');
  if(targetBindingId!==undefined && !isUuid(targetBindingId))issues.push('Choose an authorized database target.');
  selected.sort(compareMigrationFiles);
  const unresolved=conflicts.filter(c=>!['local','remote'].includes(choices[c.key]));
  return {name,targetBindingId,files:selected,candidates:files,conflicts,issues,ready:!unresolved.length && !issues.length};
}

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
    const ids = new Set(), paths = new Set(), versions = new Set();
    let bytes = 0;
    for (const file of draft.files) {
      if (!file || !isUuid(file.id) || typeof file.path !== 'string' || file.path.length > 200
          || !migrationFileVersion(file.path)
          || typeof file.sql !== 'string' || ids.has(file.id) || paths.has(file.path) || versions.has(migrationFileVersion(file.path))) return false;
      ids.add(file.id); paths.add(file.path);versions.add(migrationFileVersion(file.path));
      bytes += new TextEncoder().encode(file.sql).length;
      if (bytes > SQL_DRAFT_MAX_BYTES) return false;
    }
    if (draft.sql !== draft.files[0].sql) return false;
  } else if (draft.manifestVersion === 2) return false;
  if (draft.preparedRelease !== undefined && draft.preparedRelease !== null) {
    const release = draft.preparedRelease;
    if (!release || typeof release !== 'object' || Array.isArray(release)
        || !isUuid(release.id) || release.sourceKind !== 'AUTHORED_SQL_WORKSPACE'
        || release.draftId !== draft.id || release.draftRevision !== String(draft.revision)
        || !HASH.test(draft.sha256 ?? '') || release.draftSha256 !== draft.sha256
        || !HASH.test(release.manifestDigest ?? '')
        || ![1, 2].includes(draft.manifestVersion) || release.manifestVersion !== draft.manifestVersion) return false;
  }
  return true;
}

export function compareRevisionContent(base, candidate) {
  if (!validateDraftRevision(base) || !validateDraftRevision(candidate)) throw new TypeError('Invalid SQL draft revision');
  return { baseRevision: base.revision, candidateRevision: candidate.revision,
    changed: base.sql !== candidate.sql, baseSql: base.sql, candidateSql: candidate.sql };
}

export function classifyWorkspaceError(error) {
  const code = typeof error?.message === 'string' ? error.message : '';
  if (code === 'DRAFT_REVISION_CONFLICT' || code === 'REVISION_CONFLICT') return 'This draft changed elsewhere. Inspect the latest saved revision and reconcile your edits before saving.';
  if (code === 'NOT_FOUND' || code === 'FORBIDDEN') return 'This draft is unavailable in the selected project.';
  if (code === 'RELEASE_INTEGRITY_FAILED') return 'The retained release failed its integrity check. Ask an operator to review its stored source evidence before retrying.';
  if (code === 'INVALID_REQUEST') return 'Check the draft name, migration filenames, unique versions and total SQL size, then retry.';
  if (code === 'INVALID_DRAFT_RESPONSE') return 'The saved draft response is incomplete. Refresh to reload its files; the current editor has been preserved.';
  if (code === 'TARGET_REVISION_CONFLICT' || code === 'SOURCE_BINDING_MISMATCH') return 'Project or target evidence changed. Refresh the project before continuing.';
  return `SQL workspace request failed (${code || 'UNAVAILABLE'}). Refresh and retry.`;
}

const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const HASH = /^[a-f0-9]{64}$/;
const validateDraftRevision = value => value && revision(value.revision) && typeof value.sql === 'string';
const revision = value => typeof value === 'string' ? /^[1-9][0-9]{0,18}$/.test(value) : Number.isSafeInteger(value) && value > 0;
