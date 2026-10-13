import React, { useCallback, useEffect, useRef, useState } from 'react';
import { classifyWorkspaceError, validateDraft } from '../../../packages/sql-workspace/contracts.mjs';
import { ValidationFindings } from './SchemaValidation.jsx';

const editableFiles = draft => (draft?.files || [{id:draft?.id,path:'V1__workspace.sql',sql:draft?.sql || ''}]).map(({id,path,sql}) => ({...(id ? {id} : {}),path,sql}));

function targetOf(binding) {
  return binding?.retainedTarget || binding?.target || binding;
}

function targetIdOf(binding) {
  const target = targetOf(binding);
  return target?.bindingId || binding?.bindingId || binding?.id || '';
}

/** Project-scoped SQL draft editor. Parsing and target review are supplied by the authorized API. */
export function SqlWorkspace({ token, projectId, projectName, bindings = [], request, onReleasePrepared, onNavigatePlan,
  onDraftSelected, onBindingSelected, onPlan, onDirtyChange, initialBindingId = '', initialDraftId = '', readOnly = false }) {
  const [drafts, setDrafts] = useState([]);
  const [nextCursor,setNextCursor]=useState(null);
  const initialDraft=useRef(initialDraftId);
  const [draftId, setDraftId] = useState('');
  const [draft, setDraft] = useState(null);
  const [name, setName] = useState('Untitled SQL draft');
  const [sql, setSql] = useState('');
  const [files,setFiles]=useState([]), [fileIndex,setFileIndex]=useState(0), [useFiles,setUseFiles]=useState(false);
  const [targetBindingId, setTargetBindingId] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [validation, setValidation] = useState(null);
  const [preparedRelease, setPreparedRelease] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [baseRevision, setBaseRevision] = useState('');
  const [candidateRevision, setCandidateRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = useRef(false);
  const fileSelection = useRef(null);
  const selectedDraft = useRef(null);
  const epoch = useRef(0);
  const base = `/api/projects/${encodeURIComponent(projectId)}/sql-drafts`;
  const current = useCallback((n) => n === epoch.current, []);
  const reportError = error => {
    setError(classifyWorkspaceError(error));
    if (['NOT_FOUND','UNAUTHENTICATED','FORBIDDEN','MEMBERSHIP_BOOTSTRAP_REQUIRED'].includes(error.message)) {
      selectedDraft.current=null;setDrafts([]);setNextCursor(null);setDraft(null);setDraftId('');setSql('');setName('Untitled SQL draft');
      setFiles([]);setFileIndex(0);setUseFiles(false);setTargetBindingId('');setAnalysis(null);setValidation(null);setPreparedRelease(null);setComparison(null);
      onDraftSelected?.('');onBindingSelected?.('');
    }
  };

  const loadDrafts = useCallback(async (selectId = '') => {
    if (dirty.current) { setNotice('Save or discard unsaved edits before refreshing drafts.'); return; }
    const n = ++epoch.current;
    setLoading(true); setError('');
    try {
      const result = await request(base, token);
      if (!current(n)) return;
      const rows = Array.isArray(result.drafts) ? result.drafts : [];
      setDrafts(rows);setNextCursor(result.nextCursor || null);
      const selectedId=selectId || initialDraft.current || rows[0]?.id;
      if (selectedId) await openDraft(selectedId,n);
      else { setDraftId(''); setDraft(null); setName('Untitled SQL draft'); setSql(''); setAnalysis(null); setValidation(null); setPreparedRelease(null); }
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) {setLoading(false);setBusy(false);} }
  }, [base, current, request, token]);

  const openDraft = async (id, parentEpoch) => {
    if (dirty.current) { setNotice('Save or discard unsaved edits before opening another draft.'); return; }
    const n = parentEpoch ?? ++epoch.current;
    setBusy(true); setError(''); setNotice(''); setAnalysis(null); setValidation(null); setComparison(null);
    try {
      const result = await request(`${base}/${encodeURIComponent(id)}`, token);
      if (!current(n)) return;
      const selected = result.draft || result;
      if (!validateDraft(selected)) throw new Error('INVALID_REQUEST');
      const selectedFiles = editableFiles(selected);
      const selectedIndex = selected.id === selectedDraft.current ? Math.max(0, selectedFiles.findIndex(file => file.id === fileSelection.current)) : 0;
      setDraft(selected); setDraftId(selected.id); setName(selected.name); setSql(selectedFiles[selectedIndex].sql);
      selectedDraft.current=selected.id;setFiles(selectedFiles);setFileIndex(selectedIndex);fileSelection.current=selectedFiles[selectedIndex].id;
      setUseFiles(selected.manifestVersion === 2 || selectedFiles.length>1);
      setDrafts(rows=>rows.some(row=>row.id===selected.id)?rows:[selected,...rows]);
      setTargetBindingId(selected.targetBindingId || '');
      setPreparedRelease(selected.preparedRelease || null);
      onDraftSelected?.(selected.id);onBindingSelected?.(selected.targetBindingId);
      const revisions = selected.revisions || [];
      setBaseRevision(revisions.length > 1 ? String(revisions[1].revision) : String(selected.revision));
      setCandidateRevision(String(selected.revision));
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  useEffect(() => {
    setDrafts([]); setDraft(null); setDraftId(''); setAnalysis(null); setValidation(null); setError('');
    void loadDrafts();
    return () => { epoch.current++; };
  }, [loadDrafts]);

  useEffect(() => { if (!dirty.current && initialBindingId && bindings.some(binding => targetIdOf(binding) === initialBindingId)) setTargetBindingId(initialBindingId); }, [initialBindingId, bindings]);

  const loadOlderDrafts=async()=>{
    if(!nextCursor || busy || loading)return;
    const n=epoch.current;setBusy(true);setError('');
    try {
      const result=await request(`${base}?after=${encodeURIComponent(nextCursor)}`,token);
      if(!current(n))return;
      setDrafts(rows=>[...rows,...result.drafts.filter(row=>!rows.some(previous=>previous.id===row.id))]);
      setNextCursor(result.nextCursor || null);
    }catch(error){if(current(n))reportError(error);}
    finally{if(current(n))setBusy(false);}
  };
  const createDraft = async () => {
    if (dirty.current) { setNotice('Save or discard unsaved edits before creating another draft.'); return; }
    const n = ++epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(base, token, { method: 'POST', body: JSON.stringify({ name: 'Untitled SQL draft', targetBindingId, sql: '' }) });
      const created = result.draft || result;
      if (current(n)) { await loadDrafts(created.id); setNotice('SQL draft created.'); }
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const saveDraft = async () => {
    if (!draft || readOnly) return;
    const n = ++epoch.current; setBusy(true); setError(''); setNotice(''); setAnalysis(null); setValidation(null); setComparison(null); setPreparedRelease(null);
    try {
      const result = await request(`${base}/${encodeURIComponent(draft.id)}`, token, { method: 'PUT',
        body: JSON.stringify({ expectedRevision: draft.revision, name, targetBindingId, ...(useFiles ? {files} : {sql}) }) });
      const saved = result.draft || result;
      if (!validateDraft(saved)) throw new Error('INVALID_REQUEST');
      if (current(n)) {
        const savedFiles = editableFiles(saved);
        const selectedIndex = Math.max(0, savedFiles.findIndex(file => file.id === fileSelection.current));
        setDraft(saved); setFiles(savedFiles); setFileIndex(selectedIndex); setSql(savedFiles[selectedIndex].sql);
        fileSelection.current = savedFiles[selectedIndex].id; setDrafts(rows => [saved, ...rows.filter(item => item.id !== saved.id)]);
        setCandidateRevision(String(saved.revision)); setNotice(`Saved revision ${saved.revision}.`);
      }
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const preview = async () => {
    if (!draft || !selectedTarget || readOnly || loading || hasUnsavedEdits) return;
    const n = ++epoch.current; setBusy(true); setError(''); setNotice(''); setAnalysis(null); setValidation(null);
    try {
      const result = await request(`${base}/${encodeURIComponent(draft.id)}/preview`, token, { method: 'POST', body: JSON.stringify({
        expectedRevision: draft.revision, targetBindingId, expectedBindingRevision: selectedTarget.bindingRevision,
        expectedAssignmentRevision: selectedTarget.assignmentRevision,
      }) });
      if (current(n)) { setAnalysis(result.preview || result.analysis || result); setNotice('Offline syntax and statement review complete. Oracle semantics remain unverified.'); }
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const validate = async () => {
    if (!draft || !selectedTarget || readOnly || loading || hasUnsavedEdits) return;
    const n = ++epoch.current; setBusy(true); setError(''); setNotice(''); setValidation(null);
    try {
      const result = preparedRelease?.id
        ? await request(`/api/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(preparedRelease.id)}/validations`, token, { method: 'POST', body: JSON.stringify({
          targetBindingId, expectedBindingRevision: target?.bindingRevision || selectedTarget.bindingRevision,
          expectedAssignmentRevision: target?.assignmentRevision || selectedTarget.assignmentRevision,
        }) })
        : await request(`${base}/${encodeURIComponent(draft.id)}/validate`, token, { method: 'POST', body: JSON.stringify({
          expectedRevision: draft.revision, targetBindingId, expectedBindingRevision: target?.bindingRevision || selectedTarget.bindingRevision,
          expectedAssignmentRevision: target?.assignmentRevision || selectedTarget.assignmentRevision,
        }) });
      if (current(n)) setValidation(result.validation || result);
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const compare = async () => {
    if (!draft || !baseRevision || !candidateRevision) return;
    const n = ++epoch.current; setBusy(true); setError(''); setComparison(null);
    try {
      const result = await request(`${base}/${encodeURIComponent(draft.id)}/revisions/compare?base=${encodeURIComponent(baseRevision)}&candidate=${encodeURIComponent(candidateRevision)}`, token);
      if (current(n)) setComparison(result.comparison || result);
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const prepareRelease = async () => {
    if (!draft || !selectedTarget || readOnly || loading || hasUnsavedEdits) return;
    const n = ++epoch.current; setBusy(true); setError(''); setNotice('');
    try {
      const result = await request(`${base}/${encodeURIComponent(draft.id)}/prepare-release`, token, { method: 'POST', body: JSON.stringify({
        expectedRevision: draft.revision, targetBindingId, expectedBindingRevision: selectedTarget.bindingRevision,
        expectedAssignmentRevision: selectedTarget.assignmentRevision,
      }) });
      if (current(n)) {
        const release = result.release || result;
        setPreparedRelease(release);
        setNotice('Immutable authored SQL release prepared.');
        await onReleasePrepared?.(release);
        const checked = await request(`/api/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(release.id)}/validations`, token, { method: 'POST', body: JSON.stringify({
          targetBindingId, expectedBindingRevision: selectedTarget.bindingRevision,
          expectedAssignmentRevision: selectedTarget.assignmentRevision,
        }) });
        if (current(n)) setValidation(checked.validation || checked);
      }
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const createPlan = async () => {
    if (!preparedRelease || !validation || readOnly) return;
    const n = ++epoch.current; setBusy(true); setError('');
    const evidence = validation.report?.target;
    try {
      const result = await request(`/api/projects/${encodeURIComponent(projectId)}/plans`, token, { method: 'POST', body: JSON.stringify({ intentVersion: 3,
        releaseId: preparedRelease.id, assignmentId: evidence.assignmentId,
        expectedAssignmentRevision: evidence.assignmentRevision, targetBindingId: evidence.bindingId,
        expectedBindingRevision: evidence.bindingRevision, validationId: validation.id,
        expectedValidationDigest: validation.digest,
      }) });
      if (current(n)) await onPlan?.(result.plan);
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const selectedTarget = bindings.find(binding => targetIdOf(binding) === targetBindingId);
  const target = targetOf(selectedTarget);
  const hasUnsavedEdits=!!draft && (JSON.stringify(files)!==JSON.stringify(editableFiles(draft)) || name!==draft.name || targetBindingId!==draft.targetBindingId);
  dirty.current = hasUnsavedEdits;
  useEffect(() => { onDirtyChange?.(hasUnsavedEdits); }, [hasUnsavedEdits, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    if (!hasUnsavedEdits) return;
    const protectEdits = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectEdits);
    return () => window.removeEventListener('beforeunload', protectEdits);
  }, [hasUnsavedEdits]);
  const discardEdits = () => {
    if (!draft) return;
    const savedFiles = editableFiles(draft);
    const selectedIndex = Math.max(0, savedFiles.findIndex(file => file.id === fileSelection.current));
    setName(draft.name);setTargetBindingId(draft.targetBindingId || '');onBindingSelected?.(draft.targetBindingId || '');
    setFiles(savedFiles);setFileIndex(selectedIndex);setSql(savedFiles[selectedIndex].sql);
    fileSelection.current = savedFiles[selectedIndex].id;
    setUseFiles(draft.manifestVersion === 2 || savedFiles.length > 1);
    setAnalysis(null);setValidation(null);setComparison(null);setPreparedRelease(draft.preparedRelease || null);
    setNotice('Unsaved edits discarded. Saved revision restored.');setError('');
  };
  const revisions = draft?.revisions || [];
  return <section className="panel sql-workspace" aria-label="SQL workspace" aria-busy={busy || loading}>
    <div className="panel-heading"><div><p className="eyebrow">PROJECT SQL</p><h2>SQL workspace</h2>{projectName && <p>{projectName}</p>}</div><button type="button" className="secondary" onClick={() => void loadDrafts(draftId)} disabled={busy || loading || hasUnsavedEdits}>Refresh drafts</button></div>
    <p>Draft SQL, review offline parsing and target evidence, then prepare an immutable authored release. SQL is never executed here.</p>
    {error && <p className="banner error" role="alert">{error}</p>}{notice && <p className="banner success" role="status">{notice}</p>}
    {loading && <p role="status">Loading project drafts…</p>}
    <div className="sql-workspace-layout">
      <aside aria-label="Saved SQL drafts"><h3>Saved drafts</h3><button type="button" className="secondary" onClick={() => void createDraft()} disabled={busy || loading || readOnly || !selectedTarget || hasUnsavedEdits}>New draft</button>
        {!drafts.length && !loading && <p>No saved SQL drafts yet.</p>}
        <ul>{drafts.map(item => <li key={item.id}><button type="button" className={item.id === draftId ? 'draft-option selected' : 'draft-option'} onClick={() => void openDraft(item.id)} disabled={busy || loading || hasUnsavedEdits} aria-current={item.id === draftId ? 'page' : undefined}>{item.name} · r{item.revision}</button></li>)}</ul>{nextCursor && <button type="button" className="secondary" disabled={busy || loading} onClick={()=>void loadOlderDrafts()}>Older SQL drafts</button>}
      </aside>
      <div className="sql-workspace-editor">
        <label>Draft name<input aria-label="SQL draft name" value={name} maxLength={200} onChange={event => { setName(event.target.value); setAnalysis(null); setValidation(null); setPreparedRelease(null); }} disabled={busy || loading || readOnly || !draft}/></label>
        <label>Database target<select aria-label="SQL workspace target" value={targetBindingId} onChange={event => { setTargetBindingId(event.target.value); onBindingSelected?.(event.target.value); setAnalysis(null); setValidation(null); setPreparedRelease(null); }} disabled={busy || loading || readOnly}><option value="">Choose authorized project target</option>{bindings.map(binding => { const t = targetOf(binding); const id = targetIdOf(binding); return <option key={id} value={id}>{t?.exactOwner || t?.owner || 'Target'} · {t?.environmentName || t?.environmentId || 'Environment'} · revision {t?.bindingRevision || binding.revision || 'unknown'}</option>; })}</select></label>
        {draft && <section className="release-files" aria-label="Release SQL files"><h3>Release files</h3><p>Execution order follows migration versions. Saving retains a new immutable manifest revision.</p><div className="form-actions"><label>SQL file<select aria-label="SQL file" value={fileIndex} onChange={event=>{const i=Number(event.target.value);setFileIndex(i);fileSelection.current=files[i].id;setSql(files[i].sql);}} disabled={busy || loading}>{files.map((file,i)=><option key={file.id || i} value={i}>{file.path}</option>)}</select></label><button type="button" className="secondary" disabled={busy || loading || readOnly || files.length>=128} onClick={()=>{const max=files.reduce((n,f)=>{const m=/^V([0-9]+)/.exec(f.path);return m && BigInt(m[1])>n?BigInt(m[1]):n;},0n);const next={id:crypto.randomUUID(),path:`V${max+1n}__migration.sql`,sql:''};setFiles([...files,next]);setFileIndex(files.length);fileSelection.current=next.id;setSql('');setUseFiles(true);setAnalysis(null);setValidation(null);setPreparedRelease(null);}}>Add SQL file</button><button type="button" className="secondary" disabled={busy || loading || readOnly || files.length<2} onClick={()=>{const remaining=files.filter((_,i)=>i!==fileIndex);setFiles(remaining);setFileIndex(0);fileSelection.current=remaining[0].id;setSql(remaining[0].sql);setUseFiles(true);setAnalysis(null);setValidation(null);setPreparedRelease(null);}}>Remove SQL file</button></div><label>Migration filename<input aria-label="Migration filename" value={files[fileIndex]?.path || ''} disabled={busy || loading || readOnly} onChange={event=>{setFiles(rows=>rows.map((f,i)=>i===fileIndex?{...f,path:event.target.value}:f));setUseFiles(true);setAnalysis(null);setValidation(null);setPreparedRelease(null);}}/></label></section>}
        <label>SQL editor<textarea aria-label="SQL editor" spellCheck="false" autoCapitalize="off" autoCorrect="off" value={sql} onChange={event => { setSql(event.target.value); setFiles(rows=>rows.map((f,i)=>i===fileIndex?{...f,sql:event.target.value}:f)); setAnalysis(null); setValidation(null); setPreparedRelease(null); }} disabled={busy || loading || readOnly || !draft} rows={18} /></label>
        <p className="offline-note">Revision {draft?.revision ?? 'not saved'}{draft && hasUnsavedEdits ? ' · Unsaved edits' : ''} · Offline parser results do not establish Oracle semantic validity.</p>
        <div className="form-actions">{hasUnsavedEdits && <button type="button" className="secondary" onClick={discardEdits} disabled={busy || loading}>Discard unsaved edits</button>}<button type="button" className="primary" onClick={() => void saveDraft()} disabled={busy || loading || readOnly || !draft || !name.trim() || !selectedTarget}>Save draft</button>
          <button type="button" className="secondary" onClick={() => void preview()} disabled={busy || loading || readOnly || !draft || !targetBindingId || hasUnsavedEdits}>Review syntax</button>
          <button type="button" className="secondary" onClick={() => void validate()} disabled={busy || loading || readOnly || !draft || !targetBindingId || hasUnsavedEdits}>Validate against target</button>
          <button type="button" className="primary" onClick={() => void prepareRelease()} disabled={busy || loading || readOnly || !draft || !targetBindingId || hasUnsavedEdits}>Prepare immutable release</button>
          {preparedRelease && <button type="button" className="primary" onClick={() => void createPlan()} disabled={busy || loading || readOnly || !validation?.id || validation.currentness?.state !== 'CURRENT' || validation.report?.policy?.decision === 'BLOCKED'}>Create immutable plan</button>}
          {onNavigatePlan && <button type="button" className="text-button" onClick={() => onNavigatePlan()}>Open migration planning →</button>}</div>
        {!bindings.length && <p className="banner warning">No authorized project target is available. Configure a project target before validation or release preparation.</p>}
        {analysis && <section className="sql-workspace-analysis" aria-label="SQL syntax review"><h3>Offline syntax review</h3><p>Parser profile <code>{analysis.parserProfile || analysis.profile || 'Pinned Oracle parser'}</code> · Syntax {analysis.syntax || analysis.status || (analysis.ok ? 'PARSED' : 'UNAVAILABLE')}</p><p>Statement count {analysis.statementCount ?? analysis.statements?.length ?? 0}. Classification is a bounded statement review; Oracle semantics remain unverified.</p>
          {!!analysis.findings?.length && <ul aria-label="Syntax findings">{analysis.findings.map((finding, index) => <li key={index}><strong>{finding.severity} · {finding.code}</strong><p>{finding.rationale || finding.message}</p></li>)}</ul>}
          {!!analysis.statements?.length && <div className="file-table-wrap"><table><thead><tr><th>Statement</th><th>Classification</th><th>Byte range</th></tr></thead><tbody>{analysis.statements.map((statement, index) => <tr key={`${statement.ordinal || index}`}><td>{statement.path || files[0]?.path} · {statement.ordinal || index + 1}</td><td>{statement.classification || statement.kind || 'UNCLASSIFIED'}</td><td>{statement.startByte ?? '—'}–{statement.endByte ?? '—'}</td></tr>)}</tbody></table></div>}
        </section>}
        {validation && <section className="sql-workspace-validation" aria-label="SQL target validation"><h3>Target validation and risk findings</h3><ValidationFindings validation={validation}/></section>}
        {!!revisions.length && <section aria-label="Draft revision comparison"><h3>Compare saved revisions</h3><div className="form-actions"><label>Base revision<select aria-label="Base draft revision" value={baseRevision} onChange={event => setBaseRevision(event.target.value)}>{revisions.map(revision => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}</select></label><label>Candidate revision<select aria-label="Candidate draft revision" value={candidateRevision} onChange={event => setCandidateRevision(event.target.value)}>{revisions.map(revision => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}</select></label><button type="button" className="secondary" onClick={() => void compare()} disabled={busy || loading || !baseRevision || !candidateRevision}>Compare</button></div>
          {comparison && <div className="revision-comparison"><p>Revision {comparison.baseRevision ?? baseRevision} → {comparison.candidateRevision ?? candidateRevision}</p>{comparison.changed === false ? <p>No SQL changes.</p> : <div className="comparison-sides"><section><h4>Base</h4><pre>{comparison.baseFiles ? comparison.baseFiles.map(f=>`${f.path}\n${f.sql}`).join('\n\n') : comparison.baseSql ?? comparison.base?.sql ?? ''}</pre></section><section><h4>Candidate</h4><pre>{comparison.candidateFiles ? comparison.candidateFiles.map(f=>`${f.path}\n${f.sql}`).join('\n\n') : comparison.candidateSql ?? comparison.candidate?.sql ?? ''}</pre></section></div>}</div>}
        </section>}
      </div>
    </div>
  </section>;
}

export default SqlWorkspace;
