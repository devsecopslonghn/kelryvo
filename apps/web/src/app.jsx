import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

let browserSessionEpoch = 0;
const unauthorizedSubscribers = new Set();
const json = async (url, token, options = {}) => {
  const requestEpoch = browserSessionEpoch;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (response.status === 401 && token && requestEpoch === browserSessionEpoch)
    for (const subscriber of unauthorizedSubscribers) subscriber(requestEpoch);
  if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`);
  return body;
};

const errorCopy = {
  UNAUTHENTICATED: 'That token was not accepted. Check it and try again.',
  UNAUTHORIZED: 'That token was not accepted. Check it and try again.',
  FORBIDDEN: 'This role cannot make that change.',
  APPROVER_REQUIRED: 'Only an approver can record this decision.',
  SELF_APPROVAL_DENIED: 'A plan author cannot approve their own plan. Ask another approver to review it.',
  NOT_FOUND: 'That item is no longer available. Refresh the project.',
  CONFLICT: 'The item changed while you were working. Refresh and review it again.',
  DECISION_ALREADY_RECORDED: 'A decision has already been recorded for this plan. Refresh to see it.',
  PLAN_NOT_PENDING: 'Comments are closed because this plan has a decision. Refresh to see it.',
  COMMENT_EVIDENCE_UNAVAILABLE: 'A selected statement reference could not be verified against the retained source. Refresh the plan source or submit this comment without references.',
  INVALID_REQUEST: 'Some fields need attention. Check the values and try again.',
  INVALID_REFERENCE: 'The selected project, repository, or profile is no longer available.',
  INVALID_INPUT: 'Some fields need attention. Check the values and try again.',
  RELEASE_NOT_VALID: 'This release did not pass validation, so it cannot be planned.',
  RELEASE_INTEGRITY_FAILED: 'This stored release failed its integrity check. Import it again before preparing a plan.',
  STATEMENT_PREVIEW_UNAVAILABLE: 'Statement preview is unavailable for this retained file. Refresh the project and try again.',
  PLAN_APPROVAL_INTEGRITY_FAILED: 'Approval is unavailable because the retained release or plan items failed an integrity check.',
  FRESH_PLAN_REQUIRED: 'This plan’s retained source, binding or intent facts are unavailable or stale. Prepare a fresh plan from the current bound repository and folder before approval or attaching statement references.',
  SOURCE_BINDING_INVALID: 'The project source binding is unavailable or invalid. Ask a developer to review the binding before preparing a plan.',
  SOURCE_BINDING_GENERATION_INVALID: 'The project source generation is invalid. Ask a developer to review the source binding.',
  SOURCE_BINDING_GENERATION_EXHAUSTED: 'The project source generation reached its limit. A developer must review the source binding.',
  RELEASE_NOT_PLANNABLE: 'This release has no migration files with complete version and checksum data.',
  RELEASE_IMPORT_FAILED: 'The repository or commit could not be imported. Confirm the selected source and try again.',
  SOURCE_NOT_BOUND: 'Bind a repository and migration folder to this project before importing.',
  SOURCE_BINDING_MISMATCH: 'The requested source differs from the project binding. Save the source binding and try again.',
  REPOSITORY_UNAVAILABLE: 'The selected repository cannot be read right now.',
  PLAN_SOURCE_UNAVAILABLE: 'The linked source is unavailable or does not match this plan. Refresh the project and try again.',
  GIT_REF_LIMIT: 'This repository has too many refs to list safely. Contact an administrator.',
  GIT_REF_READ_FAILED: 'Repository refs could not be read. Try again later.',
  VALIDATION_UNAVAILABLE: 'The migration parser is unavailable. This release cannot be planned.',
  EXECUTION_UNAVAILABLE: 'Execution is unavailable. The plan remains NOT_EXECUTED.',
  PROJECT_ARCHIVED: 'This project is archived. It remains readable, but new work is disabled.',
  ORIGIN_REJECTED: 'This request did not come from the local application origin.',
  INTERNAL_ERROR: 'The server could not complete the request. Try again in a moment.',
};
const statementPreviewProfile = 'antlr-plsql-grammars-v4-7df52be94698550d219d299d04105c6bafadd9c3-antlr4-4.13.2';
const protocolWhitespace = bytes => bytes.every(byte => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d));
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
async function validateStatementPreview(preview, source, releaseId, filePath) {
  try {
    const file = source?.files?.find(item => item?.path === filePath);
    if (!preview || typeof preview !== 'object' || Array.isArray(preview)
        || preview.releaseId !== releaseId || preview.filePath !== filePath
        || preview.parserProfile !== statementPreviewProfile || source?.parserProfile !== statementPreviewProfile
        || preview.offline !== true || preview.executionAuthority !== false
        || !file || !/^[a-f0-9]{64}$/.test(file.sha256 || '') || preview.sourceSha256 !== file.sha256
        || !Array.isArray(preview.statements) || !Number.isSafeInteger(preview.statementCount)
        || preview.statementCount !== preview.statements.length
        || Number.isSafeInteger(file.statementCount) && file.statementCount !== preview.statementCount) return null;
    if (source.files.filter(item => item?.path === filePath).length !== 1
        || typeof file.content !== 'string' || !Number.isSafeInteger(file.bytes) || file.bytes < 0) return null;
    const raw = new TextEncoder().encode(file.content);
    if (raw.byteLength !== file.bytes || new TextDecoder('utf-8', { fatal: true }).decode(raw) !== file.content
        || await sha256Hex(raw) !== file.sha256) return null;
    let previousEnd = 0;
    const statements = [];
    for (const item of preview.statements) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
          || !Number.isSafeInteger(item.startByte) || !Number.isSafeInteger(item.endByte)
          || item.startByte < previousEnd || item.endByte <= item.startByte || item.endByte > raw.byteLength
          || !protocolWhitespace(raw.subarray(previousEnd, item.startByte))
          || !/^[a-f0-9]{64}$/.test(item.sourceSha256 || '')
          || !/^[a-f0-9]{64}$/.test(item.executionSha256 || '')
          || item.delimiterDisposition !== 'source_delimiter_in_range') return null;
      const bytes = raw.subarray(item.startByte, item.endByte);
      const sourceSql = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (sourceSql !== item.sourceSql || await sha256Hex(bytes) !== item.sourceSha256) return null;
      statements.push(item);
      previousEnd = item.endByte;
    }
    if (!protocolWhitespace(raw.subarray(previousEnd))) return null;
    return { ...preview, statements };
  } catch { return null; }
}
const explain = (error) => errorCopy[error.message] || 'The request could not be completed. Check the connection and try again.';
const fmt = (date) => date ? new Date(date).toLocaleString() : '—';
const pageTitles = { workspace: 'Projects', release: 'Release intake', review: 'Plan review', records: 'Audit & history' };
const decisionClass = (status) => ({ APPROVED: 'good', REJECTED: 'bad' }[status] || 'pending');
const planMarkerClass = (status) => ({ APPROVED: 'green', REJECTED: 'red' }[status] || '');
const retainedAuthorId = (plan) => typeof plan?.authorId === 'string' && plan.authorId.trim().length > 0
  ? plan.authorId : null;
const retainedPlanTime = (value) => {
  if (typeof value !== 'string') return null;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value ? value : null;
};
function validSavedEvidenceReference(ref, plan) {
  if (!ref || typeof ref !== 'object' || Array.isArray(ref) || !plan) return false;
  const keys = ['releaseId', 'filePath', 'startByte', 'endByte', 'sourceSha256', 'executionSha256', 'sourceFileSha256', 'parserProfile', 'intentDigest'];
  if (Object.keys(ref).length !== keys.length || keys.some(key => !Object.hasOwn(ref, key))
      || ref.releaseId !== plan.releaseId || typeof ref.filePath !== 'string'
      || ref.filePath.length < 1 || ref.filePath.length > 4096 || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(ref.filePath)
      || ref.filePath.split('/').some(part => part === '.' || part === '..')
      || !Number.isSafeInteger(ref.startByte) || ref.startByte < 0 || !Number.isSafeInteger(ref.endByte) || ref.endByte <= ref.startByte
      || typeof ref.sourceSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sourceSha256)
      || typeof ref.executionSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.executionSha256)
      || typeof ref.sourceFileSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sourceFileSha256)
      || typeof ref.intentDigest !== 'string' || !/^[a-f0-9]{64}$/.test(ref.intentDigest)
      || ref.parserProfile !== statementPreviewProfile || ref.intentDigest !== plan.offlineIntent?.digest) return false;
  return Array.isArray(plan.items) && plan.items.some(item => item?.path === ref.filePath && item.sha256 === ref.sourceFileSha256);
}
function savedEvidenceReferences(comment, plan) {
  const refs = comment?.evidenceRefs ?? [];
  return Array.isArray(refs) && refs.length <= 8 && refs.every(ref => validSavedEvidenceReference(ref, plan)) ? refs : null;
}
function PlanCommentRow({ comment, plan, fmt, reopenEvidence }) {
  const refs = savedEvidenceReferences(comment, plan);
  return <li className="comment-row" key={comment.id}>
    <div><strong>{comment.authorName}</strong><time dateTime={comment.createdAt}>{fmt(comment.createdAt)}</time></div>
    <p>{comment.body}</p>
    {refs === null ? <p className="banner error" role="status">Saved statement evidence is unavailable. Refresh the project to retrieve current retained facts.</p>
      : refs.map((ref, index) => <div className="comment-evidence" key={`${ref.filePath}-${ref.startByte}-${index}`}>
        <p><strong>Supplemental retained statement evidence</strong></p>
        <dl><div><dt>File</dt><dd><code>{ref.filePath}</code></dd></div><div><dt>Source bytes</dt><dd>{ref.startByte}–{ref.endByte}</dd></div>
          <div><dt>Source SHA-256</dt><dd><code>{ref.sourceSha256}</code></dd></div><div><dt>Normalized execution SHA-256</dt><dd><code>{ref.executionSha256}</code></dd></div>
          <div><dt>Retained source SHA-256</dt><dd><code>{ref.sourceFileSha256}</code></dd></div><div><dt>Parser profile</dt><dd><code>{ref.parserProfile}</code></dd></div>
          <div><dt>Retained intent SHA-256</dt><dd><code>{ref.intentDigest}</code></dd></div></dl>
        <button type="button" className="secondary" onClick={() => reopenEvidence(ref, plan.id)}>Reopen referenced statement</button>
      </div>)}
  </li>;
}
const validBindingGeneration = (value) => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
  && (value.length < 19 || value <= '9223372036854775807');
const importStatusClass = (status) => status === 'VALID' ? 'good' : 'warn';
function auditActorLabel(item, actor) {
  if (item.actorName) return item.actorName;
  if (item.actorId === actor.id) return actor.name || actor.id;
  if (item.actorId) return `Actor ${item.actorId.slice(0, 8)}`;
  return 'Unknown actor';
}
function auditDescription(item) {
  const denialCopy = {
    APPROVER_REQUIRED: 'Decision denied: an approver role is required.',
    SELF_APPROVAL_DENIED: 'Decision denied: plan authors cannot decide their own plans.',
    DECISION_ALREADY_RECORDED: 'Decision denied: the plan already has a terminal decision.',
  };
  if (item.action === 'PLAN_DECISION_DENIED' && item.facts?.denialReason) {
    return denialCopy[item.facts.denialReason] || 'A plan decision was denied.';
  }
  if (item.action === 'PLAN_COMMENT_ADDED') return 'A review comment was added to the plan.';
  return item.facts?.reason || item.summary || item.reason || 'Governance record';
}

function RetainedReleaseContent({ source, repositories, fmt, requestStatementPreview, statementPreview, planContext = '', selectEvidence, selectedEvidence = [] }) {
  return <>
    <section className="release-provenance" aria-label="Stored release provenance"><h3>Stored provenance</h3><dl>
      <div><dt>Release ID</dt><dd><code>{source.id || '—'}</code></dd></div>
      <div><dt>Immutable commit</dt><dd><code>{source.commit || '—'}</code></dd></div>
      <div><dt>Repository ID</dt><dd><code>{source.repositoryId || '—'}</code></dd></div>
      <div><dt>Registered repository</dt><dd>{repositories.find((item) => item.id === source.repositoryId)?.name || 'Unavailable'}</dd></div>
      <div><dt>Git object format</dt><dd>{source.objectFormat || '—'}</dd></div>
      <div><dt>Migration folder</dt><dd><code>{source.folder || '—'}</code></dd></div>
      <div><dt>Manifest digest</dt><dd><code>{source.manifestDigest || '—'}</code></dd></div>
      <div><dt>Parser profile</dt><dd><code>{source.parserProfile || '—'}</code></dd></div>
      <div><dt>Imported</dt><dd><time dateTime={source.createdAt || undefined}>{fmt(source.createdAt)}</time></dd></div>
    </dl></section>
    <div className="file-table-wrap"><table><thead><tr><th>Migration file</th><th>Version</th><th>Statements</th><th>Bytes</th><th>SHA-256</th><th>Validation</th></tr></thead><tbody>
      {(source.files || []).map((file) => <tr key={file.path}><td><code>{file.path}</code></td><td>{file.version || '—'}</td><td>{file.statementCount ?? '—'}</td><td>{file.bytes ?? '—'}</td><td><code className="checksum">{file.sha256 || '—'}</code></td><td><span className={`status-pill ${importStatusClass(file.validationStatus)}`}>{file.validationStatus || '—'}</span></td></tr>)}
    </tbody></table>{!source.files?.length && <div className="empty-inline">No migration files were returned for this release.</div>}</div>
    {(source.files || []).map((file) => <details className="sql-preview" key={`${file.path}-sql`} open={statementPreview?.releaseId === source.id && statementPreview?.filePath === file.path && statementPreview?.planId === planContext}><summary>Preview SQL · {file.path}</summary><pre>{file.content || 'Source content unavailable.'}</pre><button type="button" className="secondary statement-preview-action" onClick={() => requestStatementPreview(source.id, file.path)}>Preview parsed statements</button>{statementPreview?.releaseId === source.id && statementPreview?.filePath === file.path && statementPreview?.planId === planContext && <StatementPreviewResult result={statementPreview} onSelectEvidence={planContext ? selectEvidence : null} selectedEvidence={selectedEvidence}/>}</details>)}
  </>;
}

function StatementPreviewResult({ result, onSelectEvidence, selectedEvidence = [] }) {
  if (result.loading) return <p className="statement-preview-status" role="status">Parsing retained source offline…</p>;
  if (result.error) return <p className="banner error" role="alert">Statement preview is unavailable for this retained file. Refresh the project and try again.</p>;
  if (!result.preview) return null;
  const preview = result.preview;
  return <section className="statement-preview-result" aria-label="Offline statement preview" data-preview-release-id={preview.releaseId} data-preview-file-path={preview.filePath}>
    <p className="offline-note">Offline parser preview · no target connection or execution authority</p>
    <p>Parser profile <code>{preview.parserProfile}</code></p>
    <p>Statements recomputed from retained bytes: {preview.statementCount}</p>
    <p>Retained source SHA-256 <code>{preview.sourceSha256}</code></p>
    {preview.statements.map((statement, index) => <article className="statement-preview-item" key={`${statement.startByte}-${statement.endByte}`}>
      <h4>Statement {index + 1}</h4>
      <p>Source bytes {statement.startByte}–{statement.endByte} · delimiter disposition <code>{statement.delimiterDisposition}</code></p>
      <p>Source SHA-256 <code>{statement.sourceSha256}</code></p>
      <p>Normalized execution SHA-256 <code>{statement.executionSha256}</code></p>
      <pre>{statement.sourceSql}</pre>
      {onSelectEvidence && <button type="button" className="secondary statement-preview-action" onClick={() => onSelectEvidence({ filePath: preview.filePath,
        startByte: statement.startByte, endByte: statement.endByte, sourceSha256: statement.sourceSha256,
        executionSha256: statement.executionSha256 })}>{selectedEvidence.some(ref => ref.filePath === preview.filePath && ref.startByte === statement.startByte && ref.endByte === statement.endByte) ? 'Remove reference' : 'Attach to comment'}</button>}
    </article>)}
    {!preview.statements.length && <p className="muted">No statements were returned by the pinned parser.</p>}
  </section>;
}

function App() {
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState('');
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const [actor, setActor] = useState(null);
  const [repositories, setRepositories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [accessMode, setAccessMode] = useState('BOOTSTRAP_REQUIRED');
  const [projectId, setProjectId] = useState('');
  const [detail, setDetail] = useState(null);
  const projectLoaded = detail?.project?.id === projectId;
  const [release, setRelease] = useState(null);
  const [releaseComparison, setReleaseComparison] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [planSource, setPlanSource] = useState(null);
  const [planStatus, setPlanStatus] = useState('ALL');
  const [auditAction, setAuditAction] = useState('ALL');
  const [auditPage, setAuditPage] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditPageError, setAuditPageError] = useState('');
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const auditPageRef = useRef(null);
  const [tab, setTab] = useState('workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectForm, setProjectForm] = useState({ name: '', description: '' });
  const [environmentName, setEnvironmentName] = useState('');
  const [profileForm, setProfileForm] = useState({ name: '', environmentId: '', host: '', port: '1521', service: '', username: '', credentialRef: '' });
  const [releaseForm, setReleaseForm] = useState({ repositoryId: '', commit: 'HEAD', folder: 'migrations' });
  const [gitRefs, setGitRefs] = useState({ branches: [], tags: [] });
  const [gitRefsLoading, setGitRefsLoading] = useState(false);
  const [gitRefsError, setGitRefsError] = useState('');
  const [sourceForm, setSourceForm] = useState({ repositoryId: '', folder: 'migrations' });
  const [decisionReason, setDecisionReason] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [commentEvidence, setCommentEvidence] = useState([]);
  const [freshPlanRequired, setFreshPlanRequired] = useState(null);
  const [statementPreview, setStatementPreview] = useState(null);
  const [archiveReason, setArchiveReason] = useState('');
  const refreshSequence = useRef(0);
  const activeProjectId = useRef(projectId);
  const sessionEpoch = useRef(0);
  const previousAuditProjectId = useRef(projectId);
  const previousReleaseBinding = useRef({ projectId: '', repositoryId: '', folder: '' });
  const currentSourceContext = useRef(null);
  const planSourceSequence = useRef(0);
  const statementPreviewSequence = useRef(0);
  const releaseComparisonSequence = useRef(0);
  const auditSequence = useRef(0);
  const auditContextRef = useRef('');
  const activeSelectedPlanId = useRef('');
  const activeSelectedReleaseId = useRef('');
  const selectRelease = value => {
    activeSelectedReleaseId.current = value?.id || '';
    setRelease(value);
  };
  const compareReleases = async (baseReleaseId, candidateReleaseId) => {
    const sequence = ++releaseComparisonSequence.current;
    const selectedProject = projectId; const selectedToken = token; const selectedSession = sessionEpoch.current;
    const refreshAtStart = refreshSequence.current;
    setReleaseComparison({ loading: true, baseReleaseId, candidateReleaseId });
    try {
      const result = await json(`/api/projects/${encodeURIComponent(selectedProject)}/releases/compare`, selectedToken, {
        method: 'POST', body: JSON.stringify({ baseReleaseId, candidateReleaseId }),
      });
      if (sequence === releaseComparisonSequence.current && activeProjectId.current === selectedProject
          && tokenRef.current === selectedToken && sessionEpoch.current === selectedSession
          && refreshSequence.current === refreshAtStart)
        setReleaseComparison({ ...result.comparison, baseReleaseId, candidateReleaseId });
    } catch (failure) {
      if (sequence === releaseComparisonSequence.current && activeProjectId.current === selectedProject
          && tokenRef.current === selectedToken && sessionEpoch.current === selectedSession
          && refreshSequence.current === refreshAtStart) {
        if (failure?.message === 'NOT_FOUND') { setReleaseComparison(null); clearProjectState(); await refresh(selectedToken, selectedProject); }
        else setReleaseComparison({ error: 'RELEASE_COMPARISON_UNAVAILABLE', baseReleaseId, candidateReleaseId });
      }
    }
  };
  const invalidateReleaseComparison = () => {
    releaseComparisonSequence.current += 1;
    setReleaseComparison(null);
  };

  const rememberSourceContext = (selectedProjectId, project) => {
    const binding = project?.sourceBinding;
    const next = {
      projectId: selectedProjectId,
      signature: JSON.stringify([selectedProjectId, binding?.repositoryId || '', binding?.folder || '',
        binding?.generation ?? '', binding?.updatedAt || '']),
    };
    const previous = currentSourceContext.current;
    if (previous?.projectId === selectedProjectId && previous.signature !== next.signature) invalidateSourceEvidence();
    currentSourceContext.current = next;
  };

  const invalidateSourceEvidence = () => {
    statementPreviewSequence.current += 1;
    setStatementPreview(null);
    setCommentEvidence([]);
  };

  const clearProjectState = () => {
    releaseComparisonSequence.current += 1; setReleaseComparison(null);
    auditSequence.current += 1; auditContextRef.current = ''; auditPageRef.current = null; setAuditPage(null); setAuditPageError('');
    activeProjectId.current = '';
    activeSelectedPlanId.current = '';
    currentSourceContext.current = null;
    planSourceSequence.current += 1;
    statementPreviewSequence.current += 1; setStatementPreview(null);
    setProjectId(''); setDetail(null); selectRelease(null); setSelectedPlan('');
    setPlanSource(null); setFreshPlanRequired(null); setPlanStatus('ALL'); setAuditAction('ALL');
    setDecisionReason(''); setCommentBody(''); setCommentEvidence([]); setSourceForm({ repositoryId: '', folder: 'migrations' });
    setReleaseForm({ repositoryId: '', commit: 'HEAD', folder: 'migrations' });
    setEnvironmentName(''); setProfileForm({ name: '', environmentId: '', engine: 'oracle', host: 'oracle.example.invalid', port: '1521', service: 'DEV', username: 'APP', credentialRef: 'vault://local/app' });
    setArchiveReason(''); setGitRefs({ branches: [], tags: [] }); setGitRefsError(''); setGitRefsLoading(false);
  };

  useEffect(() => {
    const expire = (requestEpoch) => {
      if (requestEpoch !== browserSessionEpoch || !tokenRef.current) return;
      browserSessionEpoch += 1;
      auditSequence.current += 1; auditContextRef.current = ''; auditPageRef.current = null; setAuditPage(null); setAuditPageError('');
      sessionEpoch.current += 1; refreshSequence.current += 1; planSourceSequence.current += 1; invalidateReleaseComparison();
      statementPreviewSequence.current += 1; setStatementPreview(null);
      activeProjectId.current = ''; activeSelectedPlanId.current = '';
      currentSourceContext.current = null;
      setActor(null); setToken(''); setTokenInput(''); setProjects([]); setRepositories([]); setProjectId(''); setDetail(null);
      selectRelease(null); setSelectedPlan(''); setPlanSource(null); setFreshPlanRequired(null); setPlanStatus('ALL'); setAuditAction('ALL');
      setDecisionReason(''); setCommentBody(''); setCommentEvidence([]); setSourceForm({ repositoryId: '', folder: 'migrations' });
      setReleaseForm({ repositoryId: '', commit: 'HEAD', folder: 'migrations' }); setGitRefs({ branches: [], tags: [] });
      setGitRefsLoading(false); setGitRefsError(''); setBusy(false); setNotice('');
      setError('Your session expired. Sign in again.');
    };
    unauthorizedSubscribers.add(expire);
    return () => unauthorizedSubscribers.delete(expire);
  }, []);

  const selectPlan = (id) => {
    planSourceSequence.current += 1;
    statementPreviewSequence.current += 1; setStatementPreview(null);
    setPlanSource(null);
    setFreshPlanRequired(null);
    activeSelectedPlanId.current = id;
    setSelectedPlan(id);
    setCommentEvidence([]);
  };

  const selectProject = (nextId) => {
    releaseComparisonSequence.current += 1; setReleaseComparison(null);
    auditSequence.current += 1; auditContextRef.current = ''; auditPageRef.current = null; setAuditPage(null); setAuditPageError('');
    const alreadySelected = nextId === projectId;
    if (!alreadySelected) currentSourceContext.current = null;
    activeProjectId.current = nextId;
    planSourceSequence.current += 1;
    statementPreviewSequence.current += 1; setStatementPreview(null);
    setPlanSource(null);
    refreshSequence.current += 1;
    setProjectId(nextId);
    setDetail(null);
    selectRelease(null);
    activeSelectedPlanId.current = '';
    setSelectedPlan('');
    setFreshPlanRequired(null);
    setError('');
    setNotice('');
    setPlanStatus('ALL');
    setAuditAction('ALL');
    setDecisionReason('');
    setCommentBody('');
    setCommentEvidence([]);
    setSourceForm({ repositoryId: '', folder: 'migrations' });
    setReleaseForm({ repositoryId: '', commit: 'HEAD', folder: 'migrations' });
    if (alreadySelected && token) void refresh(token, nextId);
  };

  const refresh = useCallback(async (activeToken, selectedId = projectId) => {
    if (!activeToken) return;
    invalidateReleaseComparison();
    auditSequence.current += 1; auditContextRef.current = ''; auditPageRef.current = null; setAuditPage(null); setAuditPageError('');
    setAuditRefreshKey((value) => value + 1);
    const sequence = ++refreshSequence.current;
    setBusy(true); setError('');
    try {
      const [repoResult, projectResult] = await Promise.all([
        json('/api/repositories', activeToken), json('/api/projects', activeToken),
      ]);
      if (sequence !== refreshSequence.current) return;
      setRepositories(repoResult.repositories || []);
      setAccessMode(projectResult.accessMode || 'BOOTSTRAP_REQUIRED');
      const rows = projectResult.projects || [];
      setProjects(rows);
      const nextId = rows.some((item) => item.id === selectedId) ? selectedId : rows[0]?.id || '';
      if (nextId !== selectedId) clearProjectState();
      activeProjectId.current = nextId;
      setProjectId(nextId);
      if (nextId) {
        const result = await json(`/api/projects/${encodeURIComponent(nextId)}`, activeToken);
        if (sequence !== refreshSequence.current) return;
        rememberSourceContext(nextId, result.project);
        setDetail(result);
        return { selectedId: nextId, detail: result };
      }
      setDetail(null);
      return { selectedId: '', detail: null };
    } catch (e) { if (sequence === refreshSequence.current) {
      if (e?.message === 'NOT_FOUND') {
        clearProjectState();
      }
      setError(explain(e));
    } }
    finally { if (sequence === refreshSequence.current) setBusy(false); }
  }, [projectId]);

  const connect = async (event) => {
    event.preventDefault(); browserSessionEpoch += 1; setBusy(true); setError(''); setNotice('');
    try {
      const session = await json('/api/session', tokenInput.trim());
      const who = session.actor || session;
      if (!who?.role) throw new Error('UNAUTHORIZED');
      setToken(tokenInput.trim()); setActor(who); setTokenInput('');
      await refresh(tokenInput.trim(), projectId);
      setNotice(`Signed in as ${who.name || who.id || who.role}.`);
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (token && projectId) void refresh(token, projectId); }, [token, projectId]);

  const loadAuditPage = useCallback(async (append = false) => {
    if (!token || !projectLoaded || !projectId) return;
    const requestedProject = projectId;
    const requestedToken = token;
    const requestedSessionEpoch = sessionEpoch.current;
    const requestedAction = auditAction === 'ALL' ? null : auditAction;
    const context = `${requestedProject}\0${requestedAction || ''}\0${requestedToken}\0${sessionEpoch.current}\0${auditRefreshKey}`;
    const sequence = ++auditSequence.current;
    auditContextRef.current = context;
    const cursor = append && auditPageRef.current?.nextCursor ? auditPageRef.current.nextCursor : null;
    if (append && !cursor) return;
    setAuditLoading(true); setAuditPageError('');
    try {
      const params = new URLSearchParams();
      if (requestedAction) params.set('action', requestedAction);
      if (cursor) params.set('cursor', cursor);
      const page = await json(`/api/projects/${encodeURIComponent(requestedProject)}/audit${params.size ? `?${params}` : ''}`, requestedToken);
      if (sequence !== auditSequence.current || auditContextRef.current !== context
          || activeProjectId.current !== requestedProject || tokenRef.current !== requestedToken
          || sessionEpoch.current !== requestedSessionEpoch) return;
      const current = auditPageRef.current;
      const next = !append || !current ? page : { ...page,
        events: [...current.events, ...page.events.filter((event) => !current.events.some((old) => old.id === event.id))] };
      auditPageRef.current = next; setAuditPage(next);
    } catch (e) {
      if (sequence !== auditSequence.current || auditContextRef.current !== context) return;
      if (e?.message === 'NOT_FOUND' && activeProjectId.current === requestedProject
          && tokenRef.current === requestedToken && sessionEpoch.current === requestedSessionEpoch) {
        clearProjectState();
        await refresh(requestedToken, '');
      } else setAuditPageError(explain(e));
    } finally {
      if (sequence === auditSequence.current && auditContextRef.current === context) setAuditLoading(false);
    }
  }, [token, projectLoaded, projectId, auditAction, auditRefreshKey]);

  const changeAuditAction = (action) => {
    auditSequence.current += 1; auditContextRef.current = ''; auditPageRef.current = null;
    setAuditPage(null); setAuditPageError(''); setAuditAction(action);
  };
  const reloadAudit = () => {
    auditSequence.current += 1; auditContextRef.current = ''; auditPageRef.current = null;
    setAuditPage(null); setAuditPageError(''); setAuditRefreshKey((value) => value + 1);
  };

  useEffect(() => {
    if (projectLoaded && token) void loadAuditPage(false);
    else { auditSequence.current += 1; auditContextRef.current = ''; auditPageRef.current = null; setAuditPage(null); }
  }, [projectLoaded, projectId, token, auditAction, auditRefreshKey, loadAuditPage]);

  useEffect(() => {
    if (!projectId || detail?.project?.id !== projectId) return;
    const binding = detail.project.sourceBinding;
    setSourceForm({ repositoryId: binding?.repositoryId || '', folder: binding?.folder || 'migrations' });
  }, [projectId, detail?.project?.id, detail?.project?.sourceBinding?.repositoryId,
    detail?.project?.sourceBinding?.folder, detail?.project?.sourceBinding?.updatedAt]);

  const projectPlans = detail?.project?.id === projectId ? detail.plans || [] : [];
  const plans = useMemo(() => projectPlans.filter((item) => planStatus === 'ALL' || item.status === planStatus), [projectPlans, planStatus]);
  const plan = useMemo(() => plans.find((item) => item.id === selectedPlan) || plans[0] || null, [plans, selectedPlan]);
  activeSelectedPlanId.current = plan?.id || '';
  const actionSessionEpoch = sessionEpoch.current;
  useEffect(() => { setCommentBody(''); setCommentEvidence([]); setDecisionReason(''); }, [plan?.id]);
  const filterPlans = (status) => {
    planSourceSequence.current += 1;
    statementPreviewSequence.current += 1; setStatementPreview(null);
    setPlanSource(null);
    setPlanStatus(status);
    activeSelectedPlanId.current = '';
    setSelectedPlan('');
    setFreshPlanRequired(null);
    setCommentBody('');
    setCommentEvidence([]);
    setDecisionReason('');
  };
  const isApprover = /approv/i.test(actor?.role || '');
  const planAuthorId = retainedAuthorId(plan);
  const planCreatedAt = retainedPlanTime(plan?.createdAt);
  const authorFactsAvailable = Boolean(projectLoaded && planAuthorId);
  const isPlanAuthor = Boolean(authorFactsAvailable && actor?.id === planAuthorId);
  const canReviewPlan = Boolean(isApprover && authorFactsAvailable && !isPlanAuthor);
  const canArchive = actor?.role === 'developer';
  const canBindSource = actor?.role === 'developer';
  const selectedProject = projects.find((item) => item.id === projectId);
  const archivedAt = selectedProject?.archivedAt || detail?.project?.archivedAt || null;
  const isArchived = Boolean(archivedAt);
  const auditActions = auditPage?.actions || [];
  const filteredAudit = auditPage?.events || [];
  useEffect(() => {
    if (previousAuditProjectId.current !== projectId) {
      previousAuditProjectId.current = projectId;
      setAuditAction('ALL');
    }
  }, [projectId]);

  useEffect(() => {
    if (projectLoaded && auditPage && auditAction !== 'ALL' && !auditActions.includes(auditAction)) setAuditAction('ALL');
  }, [projectLoaded, auditAction, auditActions, auditPage]);
  const sourceBinding = projectLoaded ? detail.project.sourceBinding || null : null;
  const boundRepository = repositories.find((item) => item.id === sourceBinding?.repositoryId);
  const selectedNeedsFreshPlan = Boolean(plan?.status === 'PENDING_APPROVAL' && (freshPlanRequired?.projectId === projectId
    && freshPlanRequired?.planId === plan.id && freshPlanRequired?.sessionEpoch === actionSessionEpoch
    || !validBindingGeneration(plan.sourceBindingGeneration)
    || !validBindingGeneration(sourceBinding?.generation)
    || plan.sourceBindingGeneration !== sourceBinding?.generation
    || !(detail?.releases || []).some((release) => release.id === plan.releaseId
      && release.repositoryId === sourceBinding?.repositoryId && release.folder === sourceBinding?.folder)));
  const canPrepareNewPlan = Boolean(actor && projectLoaded && !isArchived && sourceBinding
    && boundRepository && (plan?.status === 'REJECTED'
      || (plan?.status === 'PENDING_APPROVAL' && selectedNeedsFreshPlan
        && validBindingGeneration(sourceBinding.generation))));
  const prepareNewPlan = () => {
    const requestedProject = projectId;
    const requestedPlan = plan?.id;
    const requestedToken = token;
    if (!canPrepareNewPlan || !requestedProject || !requestedPlan || !requestedToken
        || activeProjectId.current !== requestedProject
        || activeSelectedPlanId.current !== requestedPlan
        || detail?.project?.id !== requestedProject
        || !detail?.project?.sourceBinding?.repositoryId
        || !repositories.some((repository) => repository.id === detail.project.sourceBinding.repositoryId)
        || Boolean(detail.project.archivedAt)
        || sessionEpoch.current !== actionSessionEpoch) return;
    planSourceSequence.current += 1;
    statementPreviewSequence.current += 1; setStatementPreview(null);
    selectRelease(null);
    activeSelectedPlanId.current = '';
    setPlanSource(null);
    setPlanStatus('ALL');
    setSelectedPlan('');
    setDecisionReason('');
    setCommentBody('');
    setCommentEvidence([]);
    setReleaseForm({ repositoryId: '', commit: 'HEAD', folder: detail.project.sourceBinding.folder || 'migrations' });
    setTab('release');
    setError('');
    setFreshPlanRequired(null);
    setNotice(plan?.status === 'PENDING_APPROVAL'
      ? 'This plan’s retained source, binding or intent facts are unavailable or stale. Import the current bound commit and prepare a fresh plan; SQL edits are not required.'
      : 'Prepare a new plan from changed SQL: commit the changes, then import that commit as a new immutable release.');
  };
  useEffect(() => {
    const next = { projectId: projectLoaded ? projectId : '', repositoryId: sourceBinding?.repositoryId || '', folder: sourceBinding?.folder || '' };
    const previous = previousReleaseBinding.current;
    if (next.projectId && previous.projectId === next.projectId
        && (previous.repositoryId !== next.repositoryId || previous.folder !== next.folder)) {
      setReleaseForm((current) => ({ ...current, commit: 'HEAD' }));
    }
    previousReleaseBinding.current = next;
  }, [projectId, projectLoaded, sourceBinding?.repositoryId, sourceBinding?.folder]);
  useEffect(() => {
    let current = true;
    setGitRefs({ branches: [], tags: [] });
    setGitRefsError('');
    if (!token || !projectLoaded || !sourceBinding || detail?.project?.id !== projectId) {
      setGitRefsLoading(false);
      return () => { current = false; };
    }
    setGitRefsLoading(true);
    json(`/api/projects/${encodeURIComponent(projectId)}/git-refs`, token)
      .then((refs) => { if (current) setGitRefs({ branches: refs.branches || [], tags: refs.tags || [] }); })
      .catch((error) => {
        if (!current) return;
        if (error?.message === 'NOT_FOUND' && activeProjectId.current === projectId) {
          clearProjectState(); void refresh(token, projectId);
        } else setGitRefsError(error.message || 'GIT_REF_READ_FAILED');
      })
      .finally(() => { if (current) setGitRefsLoading(false); });
    return () => { current = false; };
  }, [token, projectId, projectLoaded, sourceBinding?.repositoryId, sourceBinding?.folder, refresh]);

  const mutate = async (action, success, onSuccess = () => {}, onError = () => {}, isCurrentOperation = () => true) => {
    if (accessMode === 'BOOTSTRAP_REQUIRED') { setError('MEMBERSHIP_BOOTSTRAP_REQUIRED'); return; }
    const epoch = sessionEpoch.current;
    const activeToken = token;
    const activeSelection = projectId;
    const isCurrentSession = () => sessionEpoch.current === epoch;
    setBusy(true); setError(''); setNotice('');
    try {
      const outcome = await action(isCurrentSession);
      if (!isCurrentSession() || !isCurrentOperation()) return;
      onSuccess(outcome);
      setNotice(success);
      await refresh(activeToken, outcome?.nextProjectId || activeSelection);
    } catch (e) {
      if (isCurrentSession() && isCurrentOperation()) {
        if (e?.message === 'NOT_FOUND') { clearProjectState(); await refresh(activeToken, activeSelection); }
        if (isCurrentSession() && isCurrentOperation()) { setError(explain(e)); onError(e); }
      }
    }
    finally { if (isCurrentSession()) setBusy(false); }
  };

  const createProject = (event) => {
    event.preventDefault();
    void mutate(async () => {
      const payload = { name: projectForm.name };
      if (projectForm.description.trim()) payload.description = projectForm.description.trim();
      const result = await json('/api/projects', token, { method: 'POST', body: JSON.stringify(payload) });
      return { receipt: result.project };
    }, 'Project created. Ask the local OS operator to grant access before opening it.', (outcome) => {
      setProjectForm({ name: '', description: '' });
    });
  };
  const createEnvironment = (event) => {
    event.preventDefault(); if (!projectId || detail?.project?.archivedAt) return;
    void mutate(async () => {
      await json(`/api/projects/${projectId}/environments`, token, { method: 'POST', body: JSON.stringify({ name: environmentName }) });
    }, 'Environment added.', () => setEnvironmentName(''));
  };
  const createProfile = (event) => {
    event.preventDefault(); if (!projectId || detail?.project?.archivedAt) return;
    void mutate(async () => {
      await json(`/api/projects/${projectId}/profiles`, token, { method: 'POST', body: JSON.stringify({ ...profileForm, port: Number(profileForm.port), engine: 'oracle' }) });
    }, 'Connection profile saved. Its credential remains a reference.', () => setProfileForm({ name: '', environmentId: '', host: '', port: '1521', service: '', username: '', credentialRef: '' }));
  };
  const saveSourceBinding = (event) => {
    event.preventDefault();
    if (!projectId || !canBindSource || isArchived || !sourceForm.repositoryId || !sourceForm.folder.trim()) return;
    const savingProjectId = projectId;
    const savingToken = token;
    void mutate(async (isCurrentSession) => {
      const result = await json(`/api/projects/${encodeURIComponent(savingProjectId)}/source`, savingToken, {
        method: 'PUT', body: JSON.stringify({ repositoryId: sourceForm.repositoryId, folder: sourceForm.folder.trim() }),
      });
      return isCurrentSession() ? result : null;
    }, 'Project source binding saved.', (result) => {
      if (result?.project?.id === savingProjectId) rememberSourceContext(savingProjectId, result.project);
    }, () => {}, () => activeProjectId.current === savingProjectId
      && projectId === savingProjectId && tokenRef.current === savingToken);
  };
  const importRelease = (event) => {
    event.preventDefault(); if (!projectId || !sourceBinding || isArchived) return;
    void mutate(async (isCurrentSession) => {
      const result = await json(`/api/projects/${encodeURIComponent(projectId)}/releases`, token, { method: 'POST', body: JSON.stringify({ repositoryId: sourceBinding.repositoryId, commit: releaseForm.commit, folder: sourceBinding.folder }) });
      if (!isCurrentSession()) return null;
      const imported = result.release || result;
      if (imported.id) {
        const full = await json(`/api/releases/${imported.id}`, token);
        if (!isCurrentSession()) return null;
        return { release: full.release || full };
      }
      return { release: imported };
    }, 'Repository release imported and validated.', (outcome) => {
      if (outcome?.release) selectRelease(outcome.release);
      setTab('release');
    });
  };
  const makePlan = (event) => {
    event.preventDefault(); if (!release?.id || detail?.project?.archivedAt) return;
    const profileId = event.currentTarget.elements.profileId.value;
    void mutate(async () => {
      const result = await json(`/api/projects/${projectId}/plans`, token, { method: 'POST', body: JSON.stringify({ releaseId: release.id, profileId }) });
      return result.plan || result;
    }, 'Offline candidate plan created. Execution was not performed.', (createdPlan) => {
      selectPlan(createdPlan.id);
      setTab('review');
    });
  };
  const decide = (decision) => {
    if (!plan || detail?.project?.archivedAt) return;
    const decisionProjectId = projectId;
    const decisionPlanId = plan.id;
    const decisionSessionEpoch = sessionEpoch.current;
    const isCurrentDecision = () => activeProjectId.current === decisionProjectId
      && activeSelectedPlanId.current === decisionPlanId && sessionEpoch.current === decisionSessionEpoch;
    void mutate(async () => {
      const result = await json(`/api/plans/${plan.id}/decision`, token, { method: 'POST', body: JSON.stringify({ decision, reason: decisionReason }) });
      return result.plan || result;
    }, `Plan ${decision === 'APPROVE' ? 'approved' : 'rejected'}. Execution remains NOT_EXECUTED.`, (decidedPlan) => {
      selectPlan(decidedPlan.id || plan.id);
      setDecisionReason('');
      setFreshPlanRequired(null);
    }, (error) => {
      if (decision === 'APPROVE' && error?.message === 'FRESH_PLAN_REQUIRED') {
        setFreshPlanRequired({ projectId: decisionProjectId, planId: decisionPlanId, sessionEpoch: decisionSessionEpoch });
      }
    }, isCurrentDecision);
  };

  const addComment = (event) => {
    event.preventDefault();
    if (!projectLoaded || !plan || isArchived || plan.status !== 'PENDING_APPROVAL' || !commentBody.trim() || busy) return;
    const commentProject = projectId;
    const commentPlan = plan.id;
    const commentSession = sessionEpoch.current;
    const commentToken = token;
    const isCurrentComment = () => activeProjectId.current === commentProject
      && activeSelectedPlanId.current === commentPlan && sessionEpoch.current === commentSession
      && tokenRef.current === commentToken;
    void mutate(async () => {
      await json(`/api/projects/${encodeURIComponent(commentProject)}/plans/${encodeURIComponent(commentPlan)}/comments`, commentToken, {
        method: 'POST', body: JSON.stringify({ body: commentBody, evidenceRefs: commentEvidence }),
      });
    }, 'Comment added.', () => { setCommentBody(''); setCommentEvidence([]); }, (failure) => {
      if (['FRESH_PLAN_REQUIRED', 'COMMENT_EVIDENCE_UNAVAILABLE'].includes(failure?.message) && commentEvidence.length) {
        setCommentEvidence([]);
        if (failure.message === 'FRESH_PLAN_REQUIRED') setFreshPlanRequired({ projectId: commentProject,
          planId: commentPlan, sessionEpoch: commentSession });
      }
    }, isCurrentComment);
  };

  const toggleCommentEvidence = (reference) => {
    setCommentEvidence(current => {
      const matches = item => item.filePath === reference.filePath && item.startByte === reference.startByte
        && item.endByte === reference.endByte && item.sourceSha256 === reference.sourceSha256
        && item.executionSha256 === reference.executionSha256;
      if (current.some(matches)) return current.filter(item => !matches(item));
      return current.length >= 8 ? current : [...current, reference];
    });
  };

  const archiveProject = (event) => {
    event.preventDefault();
    if (!projectId || !archiveReason.trim() || detail?.project?.archivedAt) return;
    void mutate(async () => {
      await json(`/api/projects/${encodeURIComponent(projectId)}/archive`, token, {
        method: 'POST', body: JSON.stringify({ reason: archiveReason.trim() }),
      });
    }, 'Project archived. Existing project details and history remain available.', () => setArchiveReason(''));
  };

  const inspectRelease = async (releaseId) => {
    statementPreviewSequence.current += 1; setStatementPreview(null);
    const sequence = refreshSequence.current;
    const inspectedProjectId = projectId;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await json(`/api/releases/${encodeURIComponent(releaseId)}`, token);
      if (sequence !== refreshSequence.current || activeProjectId.current !== inspectedProjectId) return;
      selectRelease(result.release || result);
      setNotice('Release files loaded for read-only inspection.');
    } catch (e) {
      if (sequence === refreshSequence.current && activeProjectId.current === inspectedProjectId) {
        if (e?.message === 'NOT_FOUND') { clearProjectState(); await refresh(token, inspectedProjectId); }
        else setError(explain(e));
      }
    }
    finally { if (sequence === refreshSequence.current && activeProjectId.current === inspectedProjectId) setBusy(false); }
  };

  const inspectPlanSource = async () => {
    if (!projectLoaded || !plan?.id || !plan.releaseId) {
      setPlanSource({ planId: plan?.id || '', error: 'PLAN_SOURCE_UNAVAILABLE' });
      return;
    }
    const sequence = ++planSourceSequence.current;
    statementPreviewSequence.current += 1; setStatementPreview(null);
    const inspectedProject = projectId;
    const inspectedPlan = plan.id;
    const inspectedReleaseId = plan.releaseId;
    const inspectedToken = token;
    const inspectedSession = sessionEpoch.current;
    const isCurrent = () => sequence === planSourceSequence.current
      && activeProjectId.current === inspectedProject
      && activeSelectedPlanId.current === inspectedPlan
      && sessionEpoch.current === inspectedSession;
    setPlanSource({ planId: inspectedPlan, loading: true });
    setError('');
    try {
      const result = await json(`/api/releases/${encodeURIComponent(inspectedReleaseId)}`, inspectedToken);
      if (!isCurrent()) return;
      const source = result.release || result;
      const summary = (detail.releases || []).find((item) => item.id === inspectedReleaseId);
      const sourceFiles = source.files;
      const planItems = plan.items;
      const filesAreWellFormed = Array.isArray(sourceFiles) && sourceFiles.length > 0
        && sourceFiles.every((file) => file && typeof file.path === 'string' && file.path.length > 0
          && typeof file.version === 'string' && typeof file.content === 'string'
          && Number.isSafeInteger(file.bytes) && file.bytes >= 0
          && Number.isSafeInteger(file.statementCount) && file.statementCount >= 0
          && typeof file.validationStatus === 'string' && /^[a-f0-9]{64}$/.test(file.sha256 || ''));
      const planItemsAreWellFormed = Array.isArray(planItems) && planItems.length > 0
        && planItems.every((item) => item && typeof item.path === 'string' && typeof item.version === 'string'
          && /^[a-f0-9]{64}$/.test(item.sha256 || ''));
      const metadataMatches = source.id === inspectedReleaseId && Boolean(summary)
        && ['repositoryId', 'commit', 'objectFormat', 'folder', 'manifestDigest', 'validationStatus', 'parserProfile']
          .every((field) => source[field] === summary[field])
        && Number.isFinite(Date.parse(source.createdAt)) && Number.isFinite(Date.parse(summary.createdAt))
        && new Date(source.createdAt).toISOString() === new Date(summary.createdAt).toISOString();
      const sourceItems = filesAreWellFormed ? sourceFiles.map((file) => ({ path: file.path, version: file.version, sha256: file.sha256 })) : [];
      const planFileFacts = planItemsAreWellFormed ? planItems.map((item) => ({ path: item.path, version: item.version, sha256: item.sha256 })) : [];
      if (!metadataMatches || !filesAreWellFormed || !planItemsAreWellFormed
          || JSON.stringify(sourceItems) !== JSON.stringify(planFileFacts)) {
        setPlanSource({ planId: inspectedPlan, error: 'PLAN_SOURCE_UNAVAILABLE' });
        return;
      }
      setPlanSource({ planId: inspectedPlan, source });
      return source;
    } catch (error) {
      if (isCurrent()) {
        if (error?.message === 'NOT_FOUND') {
          planSourceSequence.current += 1;
          const recoverySequence = planSourceSequence.current;
          selectRelease(null); setPlanSource(null);
          const recoveryIsCurrent = () => planSourceSequence.current === recoverySequence
            && activeProjectId.current === inspectedProject
            && activeSelectedPlanId.current === inspectedPlan
            && sessionEpoch.current === inspectedSession
            && tokenRef.current === inspectedToken;
          try {
            const current = await json(`/api/projects/${encodeURIComponent(inspectedProject)}`, inspectedToken);
            if (!recoveryIsCurrent()) return;
            if (current.project?.id !== inspectedProject || !current.plans?.some(item => item.id === inspectedPlan)) {
              throw new Error('NOT_FOUND');
            }
            rememberSourceContext(inspectedProject, current.project);
            setDetail(current);
            setPlanSource({ planId: inspectedPlan, error: 'PLAN_SOURCE_UNAVAILABLE' });
          } catch {
            if (!recoveryIsCurrent()) return;
            clearProjectState();
            await refresh(inspectedToken, inspectedProject);
          }
        }
        else setPlanSource({ planId: inspectedPlan, error: 'PLAN_SOURCE_UNAVAILABLE' });
      }
    }
  };

  const requestStatementPreview = async (releaseId, filePath, planContext = '', expectedReference = null, sourceOverride = null) => {
    const sequence = ++statementPreviewSequence.current;
    const inspectedProject = projectId;
    const inspectedPlan = planContext;
    const inspectedToken = token;
    const inspectedSession = sessionEpoch.current;
    const sourceSnapshot = inspectedPlan
      ? sourceOverride || (planSource?.planId === inspectedPlan ? planSource.source : null)
      : activeSelectedReleaseId.current === releaseId ? release : null;
    const isCurrent = () => sequence === statementPreviewSequence.current
      && activeProjectId.current === inspectedProject
      && sessionEpoch.current === inspectedSession
      && tokenRef.current === inspectedToken
      && (!inspectedPlan || activeSelectedPlanId.current === inspectedPlan
        && (sourceOverride ? sourceSnapshot?.id === releaseId
          : planSource?.planId === inspectedPlan && planSource?.source?.id === releaseId))
      && (inspectedPlan ? true : activeSelectedReleaseId.current === releaseId);
    setStatementPreview({ releaseId, filePath, planId: inspectedPlan, loading: true });
    try {
      const result = await json(`/api/releases/${encodeURIComponent(releaseId)}/statement-preview?path=${encodeURIComponent(filePath)}`, inspectedToken);
      if (!isCurrent()) return;
      const checked = await validateStatementPreview(result.preview, sourceSnapshot, releaseId, filePath);
      if (checked && expectedReference && (checked.sourceSha256 !== expectedReference.sourceFileSha256
          || checked.parserProfile !== expectedReference.parserProfile
          || !checked.statements.some(item => item.startByte === expectedReference.startByte
            && item.endByte === expectedReference.endByte && item.sourceSha256 === expectedReference.sourceSha256
            && item.executionSha256 === expectedReference.executionSha256))) {
        if (isCurrent()) setStatementPreview({ releaseId, filePath, planId: inspectedPlan, error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
        return;
      }
      if (isCurrent()) setStatementPreview(checked
        ? { releaseId, filePath, planId: inspectedPlan, preview: checked }
        : { releaseId, filePath, planId: inspectedPlan, error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
    } catch (error) {
      if (isCurrent()) {
        if (error?.message === 'NOT_FOUND') {
          const recoverySequence = ++statementPreviewSequence.current;
          selectRelease(null);
          if (inspectedPlan) setPlanSource(null);
          setStatementPreview(null);
          const recoveryIsCurrent = () => recoverySequence === statementPreviewSequence.current
            && activeProjectId.current === inspectedProject && sessionEpoch.current === inspectedSession
            && tokenRef.current === inspectedToken;
          try {
            const current = await json(`/api/projects/${encodeURIComponent(inspectedProject)}`, inspectedToken);
            if (!recoveryIsCurrent()) return;
            const projectStillAuthorized = current.project?.id === inspectedProject
              && (!inspectedPlan || current.plans?.some(item => item.id === inspectedPlan));
            if (!projectStillAuthorized) throw new Error('NOT_FOUND');
            rememberSourceContext(inspectedProject, current.project);
            setDetail(current);
            if (inspectedPlan) setPlanSource({ planId: inspectedPlan, error: 'PLAN_SOURCE_UNAVAILABLE' });
            else setStatementPreview({ releaseId, filePath, planId: '', error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
          } catch {
            if (!recoveryIsCurrent()) return;
            clearProjectState();
            await refresh(inspectedToken, inspectedProject);
          }
        } else setStatementPreview({ releaseId, filePath, planId: inspectedPlan, error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
      }
    }
  };

  const reopenCommentEvidence = async (reference, planId) => {
    const selectedProject = projectId;
    const selectedSession = sessionEpoch.current;
    const selectedToken = token;
    const selectedPlan = plan?.id === planId ? plan : null;
    const current = () => activeProjectId.current === selectedProject && activeSelectedPlanId.current === planId
      && sessionEpoch.current === selectedSession && tokenRef.current === selectedToken;
    if (!validSavedEvidenceReference(reference, selectedPlan)) {
      setStatementPreview({ releaseId: selectedPlan?.releaseId || '', filePath: reference?.filePath || '', planId, error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
      return;
    }
    let source = planSource?.planId === planId && planSource?.source?.id === reference.releaseId ? planSource.source : null;
    if (!source) source = await inspectPlanSource();
    if (!current()) return;
    if (!source || source.id !== reference.releaseId) {
      setStatementPreview({ releaseId: reference.releaseId, filePath: reference.filePath, planId, error: 'STATEMENT_PREVIEW_UNAVAILABLE' });
      return;
    }
    await requestStatementPreview(reference.releaseId, reference.filePath, planId, reference, source);
  };

  const model = { actor, accessMode, readOnlyBootstrap: accessMode === 'BOOTSTRAP_REQUIRED', projects, projectId, selectProject, setRelease: selectRelease, setSelectedPlan: selectPlan, setDecisionReason, projectForm, setProjectForm, busy, createProject, detail, environmentName, setEnvironmentName, createEnvironment, profileForm, setProfileForm, createProfile, releaseForm, setReleaseForm, repositories, importRelease, release, makePlan, plans, plan, planStatus, filterPlans, auditAction, setAuditAction: changeAuditAction, auditActions, filteredAudit, auditPage, auditLoading, auditPageError, loadOlderAudit: () => loadAuditPage(true), reloadAudit, isApprover, canReviewPlan, isPlanAuthor, authorFactsAvailable, planAuthorId, planCreatedAt, setTab, decisionReason, decide, fmt, canArchive, isArchived, archivedAt, archiveReason, setArchiveReason, archiveProject, inspectRelease, planSource, inspectPlanSource, statementPreview, requestStatementPreview, releaseComparison, compareReleases, invalidateReleaseComparison, reopenCommentEvidence, sourceForm, setSourceForm, sourceBinding, boundRepository, projectLoaded, canBindSource, saveSourceBinding, commentBody, setCommentBody, commentEvidence, toggleCommentEvidence, addComment, gitRefs, gitRefsLoading, gitRefsError, canPrepareNewPlan, prepareNewPlan, selectedNeedsFreshPlan };

  if (!actor) return <main className="login-shell">
    <div className="login-card">
      <a className="brand" href="#home" aria-label="SchemaForge home"><span className="brand-mark">S</span><span>Schema<span className="brand-light">Forge</span></span></a>
      <p className="eyebrow">DATABASE CHANGE GOVERNANCE</p>
      <h1>Make every change reviewable.</h1>
      <p className="muted">Sign in with a local access token to manage projects, review migration releases, and record decisions.</p>
      <form onSubmit={connect} className="stack login-form">
        <label htmlFor="access-token">Local access token</label>
        <input id="access-token" aria-label="Local access token" type="password" autoComplete="off" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} required />
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Continue'}</button>
      </form>
      {error && <p className="banner error" role="alert">{error}</p>}
      <p className="fine-print">Your token is kept in memory for this tab and is never saved in browser storage.</p>
    </div>
    <div className="login-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card"><span className="status-dot"/> Controlled change <strong>Plan → Review → Record</strong><small>Execution stays with an authorized runtime.</small></div><div className="art-caption">A clear record for every proposed database change.</div></div>
  </main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#workspace"><span className="brand-mark">S</span><span>Schema<span className="brand-light">Forge</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <button type="button" className={`nav-item ${tab === 'workspace' ? 'active' : ''}`} onClick={() => setTab('workspace')}><span>▦</span> Projects</button>
      <button type="button" className={`nav-item ${tab === 'release' ? 'active' : ''}`} onClick={() => setTab('release')}><span>◫</span> Releases</button>
      <button type="button" className={`nav-item ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}><span>◇</span> Plans &amp; review</button>
      <button type="button" className={`nav-item ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}><span>≡</span> Audit &amp; history</button>
    <div className="sidebar-bottom"><div className="user-avatar">{(actor.name || actor.role || 'U').slice(0, 1).toUpperCase()}</div><div className="user-meta"><strong>{actor.name || actor.id || 'Signed in'}</strong><small>{actor.role}</small></div><button type="button" className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => { browserSessionEpoch += 1; sessionEpoch.current += 1; refreshSequence.current += 1; planSourceSequence.current += 1; invalidateReleaseComparison(); statementPreviewSequence.current += 1; setStatementPreview(null); setPlanSource(null); setFreshPlanRequired(null); activeProjectId.current = ''; activeSelectedReleaseId.current = ''; currentSourceContext.current = null; setActor(null); setToken(''); setTokenInput(''); setDetail(null); setProjects([]); setRepositories([]); setProjectId(''); setRelease(null); setSelectedPlan(''); setPlanStatus('ALL'); setAuditAction('ALL'); setDecisionReason(''); setCommentBody(''); setCommentEvidence([]); setSourceForm({ repositoryId: '', folder: 'migrations' }); setReleaseForm({ repositoryId: '', commit: 'HEAD', folder: 'migrations' }); setBusy(false); setError(''); setNotice(''); }}>↗</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="crumb">Workspace</span><span className="crumb-sep">/</span><strong>{pageTitles[tab] || pageTitles.workspace}</strong></div><div className="topbar-right"><span className="role-pill">{actor.role}</span><button type="button" className="icon-button refresh" aria-label="Refresh workspace" onClick={() => { void refresh(token); }} disabled={busy}>↻</button></div></header>
      {(error || notice) && <div className={`banner ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || notice}<button type="button" className="banner-close" onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss message">×</button></div>}
      {accessMode === 'BOOTSTRAP_REQUIRED' && <div className="banner warning" role="status">Bootstrap required · project access is read-only until the local OS operator grants access and activates membership.</div>}
      <div className="content">
        {tab === 'workspace' && <WorkspaceScreen model={model} />}
        {tab === 'release' && <ReleaseScreen model={model} />}
        {tab === 'review' && <ReviewScreen model={model} />}
        {tab === 'records' && <RecordsScreen model={model} />}
      </div>
      <footer className="footer"><span>SchemaForge <span className="footer-sep">·</span> Governance workspace</span><span>Local time · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></footer>
    </main>
  </div>;
}

function WorkspaceScreen({ model }) {
  const { accessMode, projects, projectId, selectProject, projectForm, setProjectForm, busy, createProject, detail, environmentName, setEnvironmentName, createEnvironment, profileForm, setProfileForm, createProfile, isArchived, archivedAt, canArchive, archiveReason, setArchiveReason, archiveProject, fmt } = model;
  return <>
          <div className="page-heading"><div><p className="eyebrow">PRODUCT WORKSPACE</p><h1>Your projects</h1><p className="muted">Organize environments and connection references before preparing a migration review.</p></div><div className="heading-mark">01 <span> / 04</span></div></div>
          <div className="workspace-grid">
            <section className="panel project-panel"><div className="panel-heading"><div><h2>Project space</h2><p>Choose a project to see its delivery context.</p></div><span className="count-pill">{projects.length} total</span></div>
              {projects.length ? <div className="project-list">{projects.map((p) => <button type="button" key={p.id} className={`project-row ${projectId === p.id ? 'selected' : ''}`} onClick={() => selectProject(p.id)} disabled={busy}><span className="project-icon">{p.name.slice(0, 1).toUpperCase()}</span><span className="project-copy"><strong>{p.name}</strong><small>{p.description || 'No description provided'}</small></span>{p.archivedAt && <span className="status-pill neutral">ARCHIVED</span>}<span className="row-arrow">›</span></button>)}</div> : <div className="empty-state"><span className="empty-icon">＋</span><strong>{accessMode === 'ENFORCED' ? 'No assigned projects' : 'No projects yet'}</strong><span>{accessMode === 'ENFORCED' ? 'Ask the local OS operator for an explicit project grant.' : 'Create a project to start organizing database changes.'}</span></div>}
              <form className="inline-form project-create" onSubmit={createProject}><label className="sr-only" htmlFor="project-name">New project name</label><input id="project-name" placeholder="New project name" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} required disabled={accessMode === 'BOOTSTRAP_REQUIRED'}/><button type="submit" className="secondary" disabled={busy || accessMode === 'BOOTSTRAP_REQUIRED'}>Create project</button><label className="sr-only" htmlFor="project-description">Description (optional)</label><input id="project-description" className="wide-input" placeholder="Description (optional)" value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} disabled={accessMode === 'BOOTSTRAP_REQUIRED'}/></form>
            </section>
            <section className="panel context-panel"><div className="panel-heading"><div><h2>{detail?.project?.name || 'Project context'} {detail?.project?.archivedAt && <span className="status-pill neutral">ARCHIVED</span>}</h2><p>Configuration for the selected project.</p></div><span className="context-icon">⌘</span></div>
              {isArchived && <output className="archive-notice"><strong>Project archived</strong><span>Archived {fmt(archivedAt)}. New changes are disabled; existing releases, plans, and records remain readable.</span></output>}
              {!detail ? <div className="empty-state compact">Select or create a project to continue.</div> : <>
                <div className="section-title"><span>01</span><strong>Environments</strong></div>
                <div className="chip-list">{(detail.environments || []).map((env) => <span className="data-chip" key={env.id}><i/> {env.name}</span>)}{!detail.environments?.length && <span className="subtle">No environments configured</span>}</div>
                <form className="inline-form" inert={accessMode === 'BOOTSTRAP_REQUIRED'} onSubmit={createEnvironment}><label className="sr-only" htmlFor="environment-name">Environment name</label><input id="environment-name" placeholder="e.g. Development" value={environmentName} onChange={(e) => setEnvironmentName(e.target.value)} required disabled={busy || isArchived}/><button type="submit" className="text-button" disabled={busy || isArchived}>＋ Add</button></form>
                <div className="section-title section-spaced"><span>02</span><strong>Connection profiles</strong><small>{(detail.profiles || []).length} profiles</small></div>
                <div className="profile-list">{(detail.profiles || []).map((profile) => <div className="profile-row" key={profile.id}><span className="profile-icon">◎</span><span><strong>{profile.name}</strong><small>{profile.host}:{profile.port}/{profile.service} · {profile.username}</small></span><span className="ref-badge">ref only</span></div>)}{!detail.profiles?.length && <p className="subtle">No connection profiles yet.</p>}</div>
                <details className="form-disclosure"><summary>{isArchived ? 'Connection profile form unavailable' : 'Add Oracle profile'}</summary><form className="profile-form" inert={accessMode === 'BOOTSTRAP_REQUIRED'} onSubmit={createProfile}><fieldset className="profile-fields" disabled={busy || isArchived}><label>Name<input aria-label="Profile name" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} required/></label><label>Environment<select aria-label="Profile environment" value={profileForm.environmentId} onChange={(e) => setProfileForm({ ...profileForm, environmentId: e.target.value })} required><option value="">Choose environment</option>{(detail.environments || []).map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}</select></label><label>Host<input aria-label="Database host" value={profileForm.host} onChange={(e) => setProfileForm({ ...profileForm, host: e.target.value })} required/></label><label>Port<input aria-label="Database port" type="number" value={profileForm.port} onChange={(e) => setProfileForm({ ...profileForm, port: e.target.value })} required/></label><label>Service<input aria-label="Oracle service" value={profileForm.service} onChange={(e) => setProfileForm({ ...profileForm, service: e.target.value })} required/></label><label>Username<input aria-label="Database username" value={profileForm.username} onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })} required/></label><label className="full-width">Credential reference<input aria-label="Credential reference" placeholder="vault://team/reference" value={profileForm.credentialRef} onChange={(e) => setProfileForm({ ...profileForm, credentialRef: e.target.value })} required/><small>Enter a reference only. Password fields are never sent or stored here.</small></label></fieldset><button type="submit" className="primary" disabled={busy || isArchived}>Save profile</button></form></details>
                {canArchive && !isArchived && <form className="archive-form" inert={accessMode === 'BOOTSTRAP_REQUIRED'} onSubmit={archiveProject}><label htmlFor="archive-reason">Archive project</label><p>Archiving preserves records but prevents new environments, profiles, releases, plans, and decisions.</p><textarea id="archive-reason" aria-label="Archive reason" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Reason for archiving this project" required/><button type="submit" className="danger-button" disabled={busy || !archiveReason.trim()}>Archive project</button></form>}
              </>}
            </section>
          </div>

  </>;
}


function SourceBindingPanel({ model }) {
  const { projectLoaded, sourceBinding, boundRepository, sourceForm, setSourceForm,
    repositories, busy, canBindSource, isArchived, readOnlyBootstrap, saveSourceBinding } = model;
  const validFolder = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(sourceForm.folder);
  const changed = sourceForm.repositoryId !== (sourceBinding?.repositoryId || '')
    || sourceForm.folder !== (sourceBinding?.folder || 'migrations');
  return <section className="panel source-binding-panel">
    <div className="panel-heading"><div><h2>Project source binding</h2><p>Choose a registered repository and migration folder. Local paths stay on the server.</p></div><span className="step-badge">SOURCE</span></div>
    {!projectLoaded && <output className="subtle">Loading the selected project source…</output>}
    {projectLoaded && sourceBinding && <p className="source-binding-current" aria-label="Current source binding"><strong>Bound source</strong><span>{boundRepository?.name || 'Registered repository unavailable'} · {sourceBinding.folder}</span></p>}
    {projectLoaded && !sourceBinding && <output className="source-binding-current"><strong>No source bound</strong><span>A developer must bind a repository and folder before release import.</span></output>}
    {projectLoaded && canBindSource && <form inert={readOnlyBootstrap} className="source-binding-form" onSubmit={saveSourceBinding}>
      <label>Registered repository<select aria-label="Source repository" value={sourceForm.repositoryId} onChange={(event) => setSourceForm({ ...sourceForm, repositoryId: event.target.value })} required disabled={busy || isArchived || !repositories.length}>
        <option value="">{repositories.length ? 'Choose registered repository' : 'No repositories registered'}</option>
        {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
      </select></label>
      <label>Migration folder<input aria-label="Source migration folder" value={sourceForm.folder} onChange={(event) => setSourceForm({ ...sourceForm, folder: event.target.value })} maxLength={200} pattern="[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*" title="Use slash-separated folder names with letters, numbers, underscores, or hyphens." required disabled={busy || isArchived}/><small>Use slash-separated folder names, for example <code>migrations</code>.</small></label>
      <div className="source-binding-actions"><button type="submit" className="secondary" disabled={busy || isArchived || !repositories.length || !sourceForm.repositoryId || !validFolder || !changed}>{sourceBindingButtonLabel(busy, sourceBinding)}</button>{isArchived && <span className="subtle">Archived projects cannot change their source.</span>}</div>
    </form>}
    {projectLoaded && !canBindSource && !sourceBinding && <p className="subtle">Ask a developer to bind a source for this project.</p>}
  </section>;
}

function sourceBindingButtonLabel(busy, sourceBinding) {
  if (busy) return 'Saving…';
  if (sourceBinding) return 'Update source binding';
  return 'Save source binding';
}

function ReleaseScreen({ model }) {
  const { readOnlyBootstrap, projectId, selectProject, projects, repositories, releaseForm, setReleaseForm, busy, importRelease, release, detail, makePlan, isArchived, inspectRelease, fmt, sourceBinding, boundRepository, projectLoaded, sourceForm, gitRefs, gitRefsLoading, gitRefsError, statementPreview, requestStatementPreview, releaseComparison, compareReleases, invalidateReleaseComparison } = model;
  const [baseReleaseId, setBaseReleaseId] = useState('');
  const [candidateReleaseId, setCandidateReleaseId] = useState('');
  useEffect(() => { setBaseReleaseId(''); setCandidateReleaseId(''); }, [projectId]);
  const bindingDraftMatches = Boolean(sourceBinding && boundRepository
    && sourceForm.repositoryId === sourceBinding.repositoryId && sourceForm.folder === sourceBinding.folder);
  const scopedRelease = projectLoaded && release
    && (detail?.releases || []).some((item) => item.id === release.id) ? release : null;
  let boundRepositoryLabel = 'Loading project source…';
  if (projectLoaded && boundRepository) boundRepositoryLabel = boundRepository.name;
  else if (projectLoaded && sourceBinding) boundRepositoryLabel = 'Registered repository unavailable';
  else if (projectLoaded) boundRepositoryLabel = 'No source bound';
  let importHint = 'Save a project source binding before importing.';
  if (sourceBinding && !bindingDraftMatches) importHint = 'Save the changed source binding before importing.';
  else if (sourceBinding) importHint = 'Release import uses the saved repository and folder.';
  return <>
          <div className="page-heading"><div><p className="eyebrow">MIGRATION INTAKE</p><h1>Import a release</h1><p className="muted">Select an allowlisted Git repository and an immutable commit to inspect migration files.</p></div><div className="heading-mark">02 <span> / 04</span></div></div>
          {isArchived && <output className="archive-notice"><strong>Archived project</strong><span>Existing release details can still be reviewed. Importing new releases is disabled.</span></output>}
          <SourceBindingPanel model={model} />
          <section className="panel saved-releases"><div className="panel-heading"><div><h2>Existing releases</h2><p>Open an imported release to review migration files and SQL.</p></div><span className="count-pill">{detail?.releases?.length || 0} releases</span></div>{detail?.releases?.length ? <div className="saved-release-list">{detail.releases.map((item) => <div className="saved-release-row" data-release-id={item.id} key={item.id}><span><strong>{item.commit?.slice(0, 12)} · {item.folder}</strong><small>Imported {fmt(item.createdAt)} · {item.validationStatus}</small></span><button type="button" className="secondary" onClick={() => { void inspectRelease(item.id); }} disabled={busy}>Inspect files</button></div>)}</div> : <p className="subtle">No releases imported for this project yet.</p>}</section>
          <section className="panel release-comparison" aria-label="Compare retained releases"><div className="panel-heading"><div><h2>Compare retained releases</h2><p>Read-only source comparison. This does not show deployment or database state.</p></div><span className="step-badge">SOURCE ONLY</span></div><div className="release-form"><label>Base release<select aria-label="Base release" value={baseReleaseId} onChange={(event) => { invalidateReleaseComparison(); setBaseReleaseId(event.target.value); }} disabled={busy || !projectLoaded}><option value="">Choose base release</option>{(detail?.releases || []).map((item) => <option key={item.id} value={item.id}>{item.commit?.slice(0, 12)} · {item.folder} · {item.validationStatus}</option>)}</select></label><label>Candidate release<select aria-label="Candidate release" value={candidateReleaseId} onChange={(event) => { invalidateReleaseComparison(); setCandidateReleaseId(event.target.value); }} disabled={busy || !projectLoaded}><option value="">Choose candidate release</option>{(detail?.releases || []).map((item) => <option key={item.id} value={item.id}>{item.commit?.slice(0, 12)} · {item.folder} · {item.validationStatus}</option>)}</select></label><button type="button" className="primary" disabled={busy || !baseReleaseId || !candidateReleaseId || !projectLoaded} onClick={() => void compareReleases(baseReleaseId, candidateReleaseId)}>Compare source</button></div>{releaseComparison?.loading && releaseComparison.baseReleaseId === baseReleaseId && releaseComparison.candidateReleaseId === candidateReleaseId && <p role="status">Comparing retained source…</p>}{releaseComparison?.error && releaseComparison.baseReleaseId === baseReleaseId && releaseComparison.candidateReleaseId === candidateReleaseId && <p className="banner error" role="alert">Comparison is unavailable. Refresh the project and retry.</p>}{releaseComparison?.facts && releaseComparison.baseReleaseId === baseReleaseId && releaseComparison.candidateReleaseId === candidateReleaseId && <><dl className="release-provenance"><div><dt>Base commit / manifest</dt><dd><code>{releaseComparison.base.id}</code><br/><code>{releaseComparison.base.commit}</code><br/><code>{releaseComparison.base.manifestDigest}</code><br/>Repository {releaseComparison.base.repositoryId} · {releaseComparison.base.folder} · {releaseComparison.base.parserProfile}</dd></div><div><dt>Candidate commit / manifest</dt><dd><code>{releaseComparison.candidate.id}</code><br/><code>{releaseComparison.candidate.commit}</code><br/><code>{releaseComparison.candidate.manifestDigest}</code><br/>Repository {releaseComparison.candidate.repositoryId} · {releaseComparison.candidate.folder} · {releaseComparison.candidate.parserProfile}</dd></div></dl><div className="comparison-facts">{releaseComparison.facts.map((fact) => <details className="comparison-fact" key={fact.version}><summary><strong>{fact.version}</strong> · {fact.change} · {fact.base?.path || '—'} → {fact.candidate?.path || '—'}</summary><div className="comparison-sides">{fact.base && <section><h3>Base · {fact.base.path}</h3><p>SHA256 {fact.base.sha256} · {fact.base.bytes} bytes</p><pre>{fact.base.content}</pre></section>}{fact.candidate && <section><h3>Candidate · {fact.candidate.path}</h3><p>SHA256 {fact.candidate.sha256} · {fact.candidate.bytes} bytes</p><pre>{fact.candidate.content}</pre></section>}</div></details>)}{!releaseComparison.facts.length && <p>No migration files were present.</p>}</div></>}</section>
          <section className="panel intake-panel"><div className="panel-heading"><div><h2>Repository source</h2><p>Repository paths stay on the server. The browser sends only the repository ID.</p></div><span className="step-badge">GIT</span></div>
            <form className="release-form" inert={readOnlyBootstrap} onSubmit={importRelease}><label>Project<select aria-label="Release project" value={projectId} onChange={(e) => selectProject(e.target.value)} required disabled={busy}><option value="">Choose project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archivedAt ? ' · ARCHIVED' : ''}</option>)}</select></label><label>Bound repository<output aria-label="Bound repository" className="bound-source-value">{boundRepositoryLabel}</output></label><label>Branch or tag<select aria-label="Git branch or tag" value={releaseForm.commit.startsWith('refs/') ? releaseForm.commit : ''} onChange={(e) => setReleaseForm({ ...releaseForm, commit: e.target.value || 'HEAD' })} disabled={busy || isArchived || !bindingDraftMatches || gitRefsLoading || !!gitRefsError}><option value="">Use HEAD or enter a ref below</option><optgroup label="Branches">{gitRefs.branches.map((item) => <option key={item.ref} value={item.ref}>Branch · {item.name}</option>)}</optgroup><optgroup label="Tags">{gitRefs.tags.map((item) => <option key={item.ref} value={item.ref}>Tag · {item.name}</option>)}</optgroup></select><small>{gitRefsLoading ? 'Loading refs from the saved project repository…' : gitRefsError ? explain(new Error(gitRefsError)) : 'Choose a local branch or commit-resolving tag, or keep using HEAD/manual commit.'}</small></label><label>Commit or ref<input aria-label="Git commit or ref" value={releaseForm.commit} onChange={(e) => setReleaseForm({ ...releaseForm, commit: e.target.value })} placeholder="40 character commit SHA" required disabled={busy || isArchived || !bindingDraftMatches}/><small>Selected refs are resolved to a full immutable commit during import.</small></label><label>Bound migration folder<output aria-label="Bound migration folder" className="bound-source-value">{projectLoaded ? sourceBinding?.folder || 'No source bound' : 'Loading project source…'}</output></label><div className="form-actions"><button type="submit" className="primary" disabled={busy || isArchived || !projects.length || !bindingDraftMatches}>{busy ? 'Importing…' : 'Import and validate'}</button><span className="subtle">{importHint} Files are parsed before a plan can be created.</span></div></form>
          </section>
          {projectLoaded && <p className="intake-guidance">Import a commit from the current bound repository and folder to prepare a fresh plan. If the SQL changed, commit those edits first; a source-binding refresh alone does not require SQL edits. Existing releases and plans remain unchanged.</p>}
          {!scopedRelease && statementPreview?.error && !statementPreview.planId && <p className="banner error" role="alert">Statement preview is unavailable for this retained file. Refresh the project and try again.</p>}
          {scopedRelease && <section className="panel release-result" data-inspected-release-id={scopedRelease.id}><div className="panel-heading"><div><p className="eyebrow">IMPORTED RELEASE</p><h2>{scopedRelease.commit?.slice(0, 12)} <span className="muted">· {scopedRelease.folder}</span></h2></div><span className={`status-pill ${importStatusClass(scopedRelease.validationStatus)}`}>{scopedRelease.validationStatus}</span></div>{scopedRelease.validationCode && <p className="banner warning">{scopedRelease.validationCode}</p>}<RetainedReleaseContent source={scopedRelease} repositories={repositories} fmt={fmt} requestStatementPreview={requestStatementPreview} statementPreview={statementPreview}/>{(scopedRelease.validationStatus === 'VALID') && <form className="plan-form" inert={readOnlyBootstrap} onSubmit={makePlan}><label>Target connection profile<select name="profileId" aria-label="Target connection profile" required disabled={busy || isArchived}><option value="">Choose profile</option>{(detail?.profiles || []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.host}/{profile.service}</option>)}</select></label><button type="submit" className="primary" disabled={busy || isArchived || !detail?.profiles?.length}>Prepare offline plan</button><span className="offline-note">This creates a review candidate. It does not connect to Oracle.</span></form>}</section>}

  </>;
}


function ReviewScreen({ model }) {
  const { readOnlyBootstrap, plans, detail, plan, planStatus, filterPlans, isApprover, canReviewPlan, isPlanAuthor, authorFactsAvailable, planAuthorId, planCreatedAt, setTab, setSelectedPlan, decisionReason, setDecisionReason, busy, decide, fmt, isArchived, commentBody, setCommentBody, commentEvidence, toggleCommentEvidence, addComment, planSource, inspectPlanSource, repositories, projectLoaded, canPrepareNewPlan, prepareNewPlan, selectedNeedsFreshPlan, requestStatementPreview, reopenCommentEvidence, statementPreview } = model;
  const scopedProfiles = projectLoaded && Array.isArray(detail?.profiles) ? detail.profiles : [];
  const scopedEnvironments = projectLoaded && Array.isArray(detail?.environments) ? detail.environments : [];
  const targetProfile = typeof plan?.profileId === 'string'
    ? scopedProfiles.find((item) => item && typeof item === 'object' && item.id === plan.profileId) : null;
  const targetEnvironment = typeof targetProfile?.environmentId === 'string'
    ? scopedEnvironments.find((item) => item && typeof item === 'object' && item.id === targetProfile.environmentId) : null;
  const targetAvailable = Boolean(targetProfile && targetEnvironment
    && ['id', 'name', 'engine', 'host', 'service', 'username'].every((field) => typeof targetProfile[field] === 'string')
    && Number.isSafeInteger(targetProfile.port)
    && typeof targetProfile.environmentId === 'string'
    && typeof targetEnvironment.id === 'string' && typeof targetEnvironment.name === 'string');
  const intent = plan?.offlineIntent;
  const retainedIntentAvailable = Boolean(intent && intent.format === 1
    && typeof intent.digest === 'string' && /^[a-f0-9]{64}$/.test(intent.digest)
    && intent.profileId === plan.profileId && typeof intent.profileName === 'string'
    && typeof intent.environmentId === 'string' && typeof intent.environmentName === 'string'
    && typeof intent.engine === 'string' && typeof intent.host === 'string'
    && Number.isSafeInteger(intent.port) && typeof intent.service === 'string'
    && typeof intent.username === 'string');
  return <>
          <div className="page-heading"><div><p className="eyebrow">GOVERNANCE</p><h1>Plans &amp; review</h1><p className="muted">Review the exact migration candidate and record an independent decision.</p></div><div className="heading-mark">03 <span> / 04</span></div></div>
          <section className="notice-card"><span className="notice-icon">i</span><div><strong>{isArchived ? 'Archived project · read only' : 'Offline candidate only'}</strong><p>Target history has not been observed. Database execution is unavailable and remains <b>NOT_EXECUTED</b>. {isArchived && 'Review decisions are disabled for archived projects.'}</p></div><span className="scope-tag">{plan?.planningScope || 'OFFLINE_CANDIDATE'}</span></section>
          <section className="panel plan-panel"><div className="panel-heading"><div><h2>Candidate plans</h2><p>Plans preserve source checksums and explicit execution status.</p></div><span className="count-pill">{plans.length} plans</span></div>
            <label>Plan status<select aria-label="Plan status" value={planStatus} onChange={(event) => filterPlans(event.target.value)} disabled={busy}><option value="ALL">All</option><option value="PENDING_APPROVAL">Pending approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option></select></label>
            {!plans.length ? <div className="empty-state"><span className="empty-icon">◇</span><strong>{planStatus === 'ALL' ? 'No plans to review' : 'No plans match this status'}</strong>{planStatus === 'ALL' ? <><span>Import a valid release and prepare an offline candidate plan first.</span><button type="button" className="text-button" onClick={() => setTab('release')}>Go to release intake →</button></> : <span>Choose another status or All to see other plans.</span>}</div> : <>
              <div className="plan-selector">{plans.map((item) => { const sourceRelease = (detail.releases || []).find((candidate) => candidate.id === item.releaseId); return <button type="button" data-plan-id={item.id} key={item.id} onClick={() => setSelectedPlan(item.id)} className={`plan-option ${(plan?.id === item.id) ? 'selected' : ''}`}><span className={`status-dot ${planMarkerClass(item.status)}`} /><span><strong>{sourceRelease?.commit?.slice(0, 12) || `Plan ${item.id.slice(0, 8)}`}</strong><small>{fmt(item.createdAt || item.created_at)}</small></span><span className={`status-pill ${decisionClass(item.status)}`}>{item.status?.replaceAll('_', ' ')}</span></button>; })}</div>
              {plan && <><div className="plan-summary"><div><span className="data-label">PLAN ID</span><code>{plan.id}</code></div><div><span className="data-label">DECISION</span><span className={`status-pill ${decisionClass(plan.status)}`}>{plan.status?.replaceAll('_', ' ')}</span></div><div><span className="data-label">TARGET HISTORY</span><strong>{plan.historyStatus || 'NOT_OBSERVED'}</strong></div><div><span className="data-label">EXECUTION</span><strong className="not-executed">{plan.execution || 'NOT_EXECUTED'}</strong></div></div>
                <section className="panel requester-facts" aria-label="Plan requester"><div className="panel-heading"><div><h3>Plan requester</h3><p>Retained plan author and server creation time.</p></div></div><dl>
                  <div><dt>Author ID</dt><dd>{authorFactsAvailable ? <code>{planAuthorId}</code> : <span>Unavailable</span>}</dd></div>
                  <div><dt>Created</dt><dd>{planCreatedAt ? <time dateTime={planCreatedAt}>{fmt(planCreatedAt)}</time> : <span>Unavailable</span>}</dd></div>
                </dl></section>
                <section className="panel retained-intent" aria-label="Retained offline intent" data-intent-plan-id={plan.id}>
                  <div className="panel-heading"><div><h3>Retained offline intent</h3><p>Captured when this plan was created · offline configuration, not current settings or runtime-observed identity.</p></div></div>
                  {!retainedIntentAvailable
                    ? <p className="banner error">Retained offline intent is unavailable for this plan.</p>
                    : <dl className="target-facts"><div><dt>Intent SHA-256</dt><dd><code>{plan.offlineIntent.digest}</code></dd></div><div><dt>Profile ID</dt><dd><code>{plan.offlineIntent.profileId}</code></dd></div><div><dt>Profile name</dt><dd>{plan.offlineIntent.profileName}</dd></div><div><dt>Environment ID</dt><dd><code>{plan.offlineIntent.environmentId}</code></dd></div><div><dt>Environment name</dt><dd>{plan.offlineIntent.environmentName}</dd></div><div><dt>Engine</dt><dd>{plan.offlineIntent.engine}</dd></div><div><dt>Host</dt><dd>{plan.offlineIntent.host}</dd></div><div><dt>Port</dt><dd>{plan.offlineIntent.port}</dd></div><div><dt>Service</dt><dd>{plan.offlineIntent.service}</dd></div><div><dt>Username</dt><dd>{plan.offlineIntent.username}</dd></div></dl>}
                </section>
                <section className="panel configured-target" aria-label="Configured target" data-plan-target-id={plan.id}>
                  <div className="panel-heading"><div><h3>Configured target</h3><p>Current configured metadata · not a plan snapshot or runtime observed identity.</p></div></div>
                  {!targetAvailable ? <><dl className="target-facts"><div><dt>Profile ID</dt><dd><code>{typeof plan.profileId === 'string' ? plan.profileId : '—'}</code></dd></div><div><dt>Environment ID</dt><dd><code>{typeof targetProfile?.environmentId === 'string' ? targetProfile.environmentId : '—'}</code></dd></div></dl><p className="banner error">Configured profile or environment is unavailable for this plan.</p></>
                    : <dl className="target-facts"><div><dt>Profile ID</dt><dd><code>{targetProfile.id}</code></dd></div><div><dt>Profile name</dt><dd>{targetProfile.name}</dd></div><div><dt>Environment ID</dt><dd><code>{targetEnvironment.id}</code></dd></div><div><dt>Environment name</dt><dd>{targetEnvironment.name}</dd></div><div><dt>Engine</dt><dd>{targetProfile.engine}</dd></div><div><dt>Host</dt><dd>{targetProfile.host}</dd></div><div><dt>Port</dt><dd>{targetProfile.port}</dd></div><div><dt>Service</dt><dd>{targetProfile.service}</dd></div><div><dt>Username</dt><dd>{targetProfile.username}</dd></div></dl>}
                </section>
                <div className="file-table-wrap"><table><thead><tr><th>Migration</th><th>Version</th><th>SHA-256</th><th>State</th></tr></thead><tbody>{(plan.items || []).map((item) => <tr key={item.path}><td><code>{item.path}</code></td><td>{item.version || '—'}</td><td><code className="checksum">{item.sha256}</code></td><td><span className="status-pill neutral">{item.status || 'NOT_EXECUTED'}</span></td></tr>)}</tbody></table></div>
                <section className="panel plan-source-panel" aria-label="Plan source inspection" data-plan-source-id={planSource?.planId === plan.id ? plan.id : ''}>
                  <div className="panel-heading"><div><h3>Retained source</h3><p>Inspect the retained files linked to this plan. This is a read only view.</p></div><button type="button" className="secondary" onClick={() => { void inspectPlanSource(); }} disabled={!plan.releaseId || planSource?.loading}>{planSource?.loading ? 'Loading source…' : 'Inspect source'}</button></div>
                  {!plan.releaseId && <p className="banner error">The linked source is unavailable or does not match this plan. Refresh the project and try again.</p>}
                  {planSource?.planId === plan.id && planSource.error && <p className="banner error">The linked source is unavailable or does not match this plan. Refresh the project and try again.</p>}
                  {planSource?.planId === plan.id && planSource.source && <div className="release-result plan-source-result" data-inspected-release-id={planSource.source.id}>
                    <RetainedReleaseContent source={planSource.source} repositories={repositories} fmt={fmt} statementPreview={statementPreview} planContext={plan.id} selectEvidence={plan.status === 'PENDING_APPROVAL' && !isArchived ? toggleCommentEvidence : null} selectedEvidence={commentEvidence} requestStatementPreview={(releaseId, filePath) => requestStatementPreview(releaseId, filePath, plan.id)}/>
                  </div>}
                </section>
                {['APPROVED', 'REJECTED'].includes(plan.status) && <section className="decision-record" aria-label="Decision record"><h3>Decision record</h3><p><strong>{plan.decidedByName || plan.decidedBy}</strong>{plan.decidedByName && <code>{plan.decidedBy}</code>}</p><time dateTime={plan.decidedAt}>{fmt(plan.decidedAt)}</time><p className="decision-record-reason">{plan.decisionReason}</p>{plan.status === 'REJECTED' && canPrepareNewPlan && <div className="prepare-new-plan"><p>Changed SQL must be committed and imported as a new immutable release. The rejected plan and its review record remain unchanged.</p><button type="button" className="primary" onClick={prepareNewPlan} disabled={busy || readOnlyBootstrap}>Prepare new plan</button></div>}{plan.status === 'REJECTED' && !isArchived && projectLoaded && !model.sourceBinding && <p className="banner warning">Bind a repository and migration folder before preparing a new plan.</p>}</section>}
                <section className="panel source-generation" aria-label="Protected source generation"><h3>Protected source configuration</h3><p>Current project binding generation: <code>{validBindingGeneration(detail.project.sourceBinding?.generation) ? detail.project.sourceBinding.generation : 'Unavailable'}</code></p><p>Captured by this plan: <code>{validBindingGeneration(plan.sourceBindingGeneration) ? plan.sourceBindingGeneration : 'Unavailable'}</code></p></section>
                {plan.status === 'PENDING_APPROVAL' && selectedNeedsFreshPlan && <div className="prepare-new-plan" role="region" aria-label="Fresh plan required"><p className="banner warning">This pending plan’s retained source, binding or intent facts are missing, stale or unverifiable. Prepare a fresh plan from the current protected repository and migration folder before approval or attaching statement references. You can import the current bound commit without editing SQL; the original plan and review history remain unchanged.</p>{canPrepareNewPlan && <button type="button" className="primary" onClick={prepareNewPlan} disabled={busy || readOnlyBootstrap}>Prepare fresh plan</button>}</div>}
                {isApprover && plan.status === 'PENDING_APPROVAL' && <div className="decision-box" inert={readOnlyBootstrap}><label htmlFor="decision-reason">Decision reason</label><textarea id="decision-reason" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} placeholder="Record why this candidate is approved or rejected" required disabled={isArchived}/><div><button type="button" className="danger-button" onClick={() => decide('REJECT')} disabled={busy || isArchived || !canReviewPlan || !decisionReason.trim()}>Reject plan</button><button type="button" className="primary" onClick={() => decide('APPROVE')} disabled={busy || isArchived || !canReviewPlan || selectedNeedsFreshPlan || !decisionReason.trim()}>Approve plan</button></div>
                  {isPlanAuthor ? <p className="banner warning">You authored this plan. Another approver must review it independently.</p> : !authorFactsAvailable ? <p className="banner warning">Requester information is unavailable. Refresh the project to retrieve retained plan facts.</p> : null}
                  <small>Approval records governance only. It does not authorize or perform execution in this product.</small></div>}
                {!isApprover && plan.status === 'PENDING_APPROVAL' && <p className="banner warning">Awaiting an approver. Your current role can prepare plans but cannot decide them.</p>}
                <section className="comments-section" aria-label="Plan comments">
                  <h3>Review comments</h3>
                  <ol className="comment-timeline">{(detail.comments || []).filter((comment) => comment.planId === plan.id).map((comment) => <PlanCommentRow key={comment.id} comment={comment} plan={plan} fmt={fmt} reopenEvidence={reopenCommentEvidence}/>)}</ol>
                  {!(detail.comments || []).some((comment) => comment.planId === plan.id) && <p className="muted">No comments yet.</p>}
                  {!isArchived && plan.status === 'PENDING_APPROVAL' ? <form className="comment-form" inert={readOnlyBootstrap} onSubmit={addComment}><label htmlFor="plan-comment">Comment</label><textarea id="plan-comment" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} maxLength={4000} placeholder="Add a plain-text review comment" required disabled={busy}/><div><small>Plain text · up to 4,000 characters</small><button type="submit" className="primary" disabled={busy || !commentBody.trim()}>Add comment</button></div>{commentEvidence.length > 0 && <p className="muted">{commentEvidence.length} statement reference{commentEvidence.length === 1 ? '' : 's'} selected. They will be verified against the retained source on submission.</p>}</form> : <p className="muted">Comments are read only {isArchived ? 'because this project is archived.' : 'after a plan decision.'}</p>}
                </section>
              </>}
            </>}
          </section>

  </>;
}


function RecordsScreen({ model }) {
  const { detail, actor, fmt, isArchived, auditAction, setAuditAction, auditActions, filteredAudit, busy, projectLoaded, auditPage, auditLoading, auditPageError, loadOlderAudit, reloadAudit } = model;
  return <>
          <div className="page-heading"><div><p className="eyebrow">TRACEABILITY</p><h1>Audit &amp; history {isArchived && <span className="status-pill neutral">ARCHIVED</span>}</h1><p className="muted">See governance events alongside the recorded migration outcomes.</p></div><div className="heading-mark">04 <span> / 04</span></div></div>
          <div className="records-grid"><section className="panel"><div className="panel-heading"><div><h2>Audit events</h2><p>Actions recorded for this project.</p></div><span className="count-pill">{filteredAudit.length}{auditPage?.hasMore ? '+' : ''} events loaded</span></div><label>Audit action<select aria-label="Audit action" value={auditAction} onChange={(event) => setAuditAction(event.target.value)} disabled={busy || !projectLoaded}><option value="ALL">All actions</option>{auditActions.map((action) => <option key={action} value={action}>{action}</option>)}</select></label><div className="timeline">{filteredAudit.map((item) => <div className="timeline-row" data-audit-id={item.id} key={item.id}><span className="timeline-dot"/><div><strong>{item.action || item.event || 'Project event'}</strong><p>{auditDescription(item)}</p><small>{auditActorLabel(item, actor)} · {fmt(item.createdAt || item.created_at)}</small></div></div>)}{!filteredAudit.length && !auditLoading && <div className="empty-state compact"><strong>{auditAction === 'ALL' ? 'No audit events yet' : 'No audit events match this action'}</strong><span>{auditAction === 'ALL' ? 'Project changes and review decisions will appear here.' : 'Choose another action or All actions to see other events.'}</span></div>}</div>{auditPageError && <p role="alert" className="error-copy">{auditPageError}</p>}<div className="records-actions"><button type="button" className="secondary" disabled={!projectLoaded} onClick={reloadAudit}>Refresh audit</button>{auditPage?.hasMore && <button type="button" className="secondary" disabled={auditLoading || busy} onClick={loadOlderAudit}>{auditLoading ? 'Loading…' : 'Load older'}</button>}</div></section><section className="panel"><div className="panel-heading"><div><h2>Migration history</h2><p>Recorded migration states; these are not evidence of database application.</p></div><span className="count-pill">{detail?.history?.length || 0} records</span></div><div className="history-list">{(detail?.history || []).map((item) => <div className="history-row" key={item.id}><div><strong>{item.path || item.version || 'Migration event'}</strong><small>{fmt(item.executedAt || item.createdAt)}</small></div><span className={`status-pill ${item.status === 'SUCCEEDED' ? 'good' : 'neutral'}`}>{item.status || 'NOT_OBSERVED'}</span></div>)}{!detail?.history?.length && <div className="empty-state compact"><strong>No migration records yet</strong><span>Candidate plans add NOT_EXECUTED records; they do not imply database application.</span></div>}</div></section></div>
          <p className="history-footnote"><span className="status-dot"/> Unknown target history stays unknown until a trusted runtime observes it.</p>

  </>;
}

createRoot(document.getElementById('root')).render(<App />);
