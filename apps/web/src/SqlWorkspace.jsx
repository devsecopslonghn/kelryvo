import SchemaDrift from './SchemaDrift.jsx';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { classifyWorkspaceError, validateDraft, reconcileDraftConflict } from '../../../packages/sql-workspace/contracts.mjs';
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
export function SqlWorkspace({ token, projectId, projectName, bindings = [], request, onReleasePrepared, onNavigatePlan, onOpenRelease,
  onDraftSelected, onBindingSelected, onPlan, onDirtyChange, sourceCorrection = null, initialBindingId = '', initialDraftId = '', sourceBindingGeneration = '', readOnly = false }) {
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
  const [showDrift, setShowDrift] = useState(false);
  const [baseRevision, setBaseRevision] = useState('');
  const [candidateRevision, setCandidateRevision] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false), [latestDraft, setLatestDraft] = useState(null);
  const [conflictChoices,setConflictChoices]=useState({}),[excludedFiles,setExcludedFiles]=useState([]);
  const [removedFile,setRemovedFile]=useState(null);
  const [correctionContext,setCorrectionContext]=useState(null);
  const correctionAttempt=useRef(null);
  const editor = useRef(null);
  const dirty = useRef(false);
  const fileSelection = useRef(null);
  const selectedDraft = useRef(null);
  const epoch = useRef(0);
  const base = `/api/projects/${encodeURIComponent(projectId)}/sql-drafts`;
  const current = useCallback((n) => n === epoch.current, []);
  const reportError = error => {
    setError(classifyWorkspaceError(error));
    if (['DRAFT_REVISION_CONFLICT','REVISION_CONFLICT'].includes(error.message)) { setConflict(true); setLatestDraft(null); }
    if (['NOT_FOUND','UNAUTHENTICATED','FORBIDDEN','MEMBERSHIP_BOOTSTRAP_REQUIRED'].includes(error.message)) {
      selectedDraft.current=null;setDrafts([]);setNextCursor(null);setDraft(null);setDraftId('');setSql('');setName('Untitled SQL draft');
      setFiles([]);setFileIndex(0);setUseFiles(false);setTargetBindingId('');setAnalysis(null);setValidation(null);setPreparedRelease(null);setComparison(null);
      setConflict(false);setLatestDraft(null);
      setRemovedFile(null);
      onDraftSelected?.('');onBindingSelected?.('');
    }
  };

  const adoptDraft = selected => {
    setCorrectionContext(null);
    const selectedFiles = editableFiles(selected);
    const selectedIndex = selected.id === selectedDraft.current ? Math.max(0, selectedFiles.findIndex(file => file.id === fileSelection.current)) : 0;
    setDraft(selected);setDraftId(selected.id);setName(selected.name);setSql(selectedFiles[selectedIndex].sql);
    selectedDraft.current=selected.id;setFiles(selectedFiles);setFileIndex(selectedIndex);fileSelection.current=selectedFiles[selectedIndex].id;
    setUseFiles(selected.manifestVersion === 2 || selectedFiles.length>1);setTargetBindingId(selected.targetBindingId || '');
    setPreparedRelease(selected.preparedRelease || null);setAnalysis(null);setValidation(null);setComparison(null);
    setConflict(false);setLatestDraft(null);
    setRemovedFile(null);
    onDraftSelected?.(selected.id);onBindingSelected?.(selected.targetBindingId);
    const revisions=selected.revisions || [];
    setBaseRevision(revisions.length>1?String(revisions[1].revision):String(selected.revision));setCandidateRevision(String(selected.revision));
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
      if (!validateDraft(selected) || selected.id!==id || selected.projectId!==projectId) throw new Error('INVALID_DRAFT_RESPONSE');
      adoptDraft(selected);
      setDrafts(rows=>rows.some(row=>row.id===selected.id)?rows:[selected,...rows]);
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  useEffect(() => {
    setDrafts([]); setDraft(null); setDraftId(''); setAnalysis(null); setValidation(null); setError('');
    void loadDrafts();
    return () => { epoch.current++; };
  }, [loadDrafts]);

  useEffect(()=>{
    if(!sourceCorrection || loading || correctionAttempt.current===sourceCorrection)return;
    correctionAttempt.current=sourceCorrection;
    if(dirty.current){setNotice('Save or discard unsaved edits before opening the originating draft.');return;}
    const n=++epoch.current;
    setBusy(true);setError('');setNotice('');setCorrectionContext(null);
    const open=async()=>{
      try{
        const {origin}=await request(`/api/projects/${encodeURIComponent(projectId)}/releases/${encodeURIComponent(sourceCorrection.releaseId)}/draft-origin`,token);
        if(!current(n))return;
        if(origin?.projectId!==projectId || origin.releaseId!==sourceCorrection.releaseId || !Array.isArray(origin.files)
          || origin.files.length>128 || !origin.draftId || !origin.draftRevision)throw new Error('INVALID_DRAFT_RESPONSE');
        const {draft:selected}=await request(`${base}/${encodeURIComponent(origin.draftId)}`,token);
        if(!current(n))return;
        if(!validateDraft(selected) || selected.id!==origin.draftId || selected.projectId!==projectId)throw new Error('INVALID_DRAFT_RESPONSE');
        adoptDraft(selected);
        setDrafts(rows=>rows.some(row=>row.id===selected.id)?rows:[selected,...rows]);
        const oldFile=origin.files.find(file=>file.releasePath===sourceCorrection.path);
        const index=oldFile?(selected.files || []).findIndex(file=>file.id===oldFile.draftFileId):-1;
        const file=index>=0?selected.files[index]:null;
        const state=!oldFile?'DRAFT':!file?'REMOVED':file.sha256!==oldFile.sha256?'CHANGED':file.path!==oldFile.draftPath?'RENAMED':'UNCHANGED';
        setCorrectionContext({...origin,path:sourceCorrection.path,currentPath:file?.path,state});
        if(file){
          setFileIndex(index);fileSelection.current=file.id;setSql(file.sql);
          const statement=sourceCorrection.statement,bytes=new TextEncoder().encode(file.sql),decoder=new TextDecoder();
          requestAnimationFrame(()=>{
            if(!current(n))return;
            editor.current?.focus();
            if(['UNCHANGED','RENAMED'].includes(state) && statement?.path===oldFile.releasePath
              && Number.isSafeInteger(statement.startByte) && Number.isSafeInteger(statement.endByte)
              && statement.startByte>=0 && statement.endByte>=statement.startByte && statement.endByte<=bytes.length)
              editor.current?.setSelectionRange(decoder.decode(bytes.subarray(0,statement.startByte)).length,decoder.decode(bytes.subarray(0,statement.endByte)).length);
            else editor.current?.setSelectionRange(0,0);
          });
        }else requestAnimationFrame(()=>{if(current(n))editor.current?.setSelectionRange(0,0);});
        setNotice(`Opened originating draft at current revision ${selected.revision}. No changes have been saved.`);
      }catch(error){if(current(n))reportError(error);}
      finally{if(current(n))setBusy(false);}
    };
    void open();
  },[sourceCorrection,loading]);

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
      if (!validateDraft(created) || created.projectId!==projectId) throw new Error('INVALID_DRAFT_RESPONSE');
      if (current(n)) { await loadDrafts(created.id); setNotice('SQL draft created.'); }
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const saveDraft = async () => {
    if (!draft || readOnly || busy || loading || conflict || !hasUnsavedEdits) return;
    const n = ++epoch.current; setBusy(true); setError(''); setNotice(''); setAnalysis(null); setValidation(null); setComparison(null); setPreparedRelease(null);
    try {
      const result = await request(`${base}/${encodeURIComponent(draft.id)}`, token, { method: 'PUT',
        body: JSON.stringify({ expectedRevision: draft.revision, name, targetBindingId, ...(useFiles ? {files} : {sql}) }) });
      const saved = result.draft || result;
      if (!validateDraft(saved) || saved.id!==draft.id || saved.projectId!==projectId) throw new Error('INVALID_DRAFT_RESPONSE');
      if (current(n)) {
        adoptDraft(saved);setDrafts(rows => [saved, ...rows.filter(item => item.id !== saved.id)]);
        setNotice(`Saved revision ${saved.revision}.`);
      }
    } catch (e) { if (current(n)) reportError(e); }
    finally { if (current(n)) setBusy(false); }
  };

  const inspectConflict = async () => {
    if (!draft || busy || loading) return;
    const n=++epoch.current;setBusy(true);setError('');
    try {
      const result=await request(`${base}/${encodeURIComponent(draft.id)}`,token);
      if (!current(n)) return;
      const latest=result.draft || result;
      if (!validateDraft(latest) || latest.id!==draft.id || latest.projectId!==projectId) throw new Error('INVALID_DRAFT_RESPONSE');
      setLatestDraft(latest);setConflictChoices({});setExcludedFiles([]);
    } catch(e) {if(current(n))reportError(e);}
    finally {if(current(n))setBusy(false);}
  };

  const resolveConflict = keepEdits => {
    if (!latestDraft || busy || loading || readOnly) return;
    if (keepEdits) {
      if(!reconciliation?.ready || !bindings.some(b=>targetIdOf(b)===reconciliation.targetBindingId))return;
      const merged=reconciliation.files;
      const index=Math.max(0,merged.findIndex(file=>file.id===fileSelection.current));
      setFiles(merged);setFileIndex(index);fileSelection.current=merged[index].id;setSql(merged[index].sql);
      setName(reconciliation.name);setTargetBindingId(reconciliation.targetBindingId);onBindingSelected?.(reconciliation.targetBindingId);
      setDraft(latestDraft);setAnalysis(null);setValidation(null);setComparison(null);setPreparedRelease(null);
      setUseFiles(true);setRemovedFile(null);setCorrectionContext(null);
      setBaseRevision(String(latestDraft.revision));setCandidateRevision(String(latestDraft.revision));
      setConflict(false);setLatestDraft(null);
      setNotice(`Reconciled files staged over revision ${latestDraft.revision}. Save explicitly; no changes have been sent.`);
    } else {adoptDraft(latestDraft);setNotice(`Loaded saved revision ${latestDraft.revision}. Local edits discarded.`);}
    setDrafts(rows=>rows.map(row=>row.id===latestDraft.id?latestDraft:row));setError('');
  };

  const preview = async () => {
    if (!draft || !selectedTarget || readOnly || loading || hasUnsavedEdits || conflict) return;
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
    if (!draft || !selectedTarget || readOnly || loading || hasUnsavedEdits || conflict) return;
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
    if (!draft || !selectedTarget || readOnly || loading || hasUnsavedEdits || conflict) return;
    const n = ++epoch.current; setBusy(true); setError(''); setNotice(''); setValidation(null);
    try {
      const result = await request(`${base}/${encodeURIComponent(draft.id)}/prepare-release`, token, { method: 'POST', body: JSON.stringify({
        expectedRevision: draft.revision, targetBindingId, expectedBindingRevision: selectedTarget.bindingRevision,
        expectedAssignmentRevision: selectedTarget.assignmentRevision,
      }) });
      if (current(n)) {
        const release = result.release || result;
        setPreparedRelease(release);
        setDraft(saved=>({...saved,preparedRelease:release}));
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
    if (!preparedRelease || !planEligible || readOnly || busy || loading || hasUnsavedEdits || conflict) return;
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
  const report=validation?.report;
  const planEligible=!!validation?.id && validation.currentness?.state==='CURRENT' && report?.policy?.decision==='INDEPENDENT_REVIEW_REQUIRED'
    && report.policy.executionAuthority===false && report.releaseId===preparedRelease?.id && report.manifestDigest===preparedRelease?.manifestDigest
    && report.target?.bindingId===targetBindingId && report.target.bindingRevision===(target?.bindingRevision || selectedTarget?.bindingRevision)
    && report.target.assignmentRevision===(target?.assignmentRevision || selectedTarget?.assignmentRevision)
    && (!sourceBindingGeneration || report.sourceBindingGeneration===sourceBindingGeneration);
  const stage=conflict?'Revision conflict':hasUnsavedEdits?'Unsaved changes':preparedRelease?(planEligible?'Release validated · ready for a plan':'Release needs validation'):validation?`Validation · ${report?.outcome || 'complete'}`:draft?'Draft saved':'Start a draft';
  const nextAction=readOnly?'Read-only: changes are disabled for this project or role.':conflict?'Inspect the latest revision and choose how to reconcile your edits.':hasUnsavedEdits?'Save your edits before review or validation.':!selectedTarget?'Choose an authorized database target.':!draft?'Create a draft to start editing SQL.':preparedRelease?(planEligible?'Create an immutable plan for independent review.':'Validate this release against the current target before creating a plan.'):'Review and validate the saved revision, then prepare an immutable release.';
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
    setRemovedFile(null);
    setNotice('Unsaved edits discarded. Saved revision restored.');setError('');
  };
  const removeFile = () => {
    if(files.length<2 || busy || loading || readOnly)return;
    setRemovedFile({file:files[fileIndex],index:fileIndex});
    const remaining=files.filter((_,index)=>index!==fileIndex);
    const index=Math.min(fileIndex,remaining.length-1);
    setFiles(remaining);setFileIndex(index);fileSelection.current=remaining[index].id;setSql(remaining[index].sql);
    setUseFiles(true);setAnalysis(null);setValidation(null);setPreparedRelease(null);
  };
  const undoRemoveFile = () => {
    if(!removedFile || files.length>=128 || busy || loading || readOnly)return;
    const restored=[...files],index=Math.min(removedFile.index,files.length);
    restored.splice(index,0,removedFile.file);
    setFiles(restored);setFileIndex(index);fileSelection.current=removedFile.file.id;setSql(removedFile.file.sql);
    setRemovedFile(null);setUseFiles(true);setAnalysis(null);setValidation(null);setPreparedRelease(null);
  };
  const openFinding = (path, ordinal) => {
    const index=files.findIndex(file=>file.path===path || file.path===path.split('/').at(-1));
    if(index<0)return;
    setFileIndex(index);fileSelection.current=files[index].id;setSql(files[index].sql);
    const statement=validation?.report?.statements.find(s=>s.path===path && s.ordinal===ordinal)
      || analysis?.statements?.find(s=>s.path===path && s.ordinal===ordinal);
    const bytes=new TextEncoder().encode(files[index].sql), decoder=new TextDecoder();
    requestAnimationFrame(()=>{
      editor.current?.focus();
      if(Number.isSafeInteger(statement?.startByte) && Number.isSafeInteger(statement?.endByte) && statement.startByte>=0 && statement.endByte>=statement.startByte && statement.endByte<=bytes.length)
        editor.current?.setSelectionRange(decoder.decode(bytes.subarray(0,statement.startByte)).length,decoder.decode(bytes.subarray(0,statement.endByte)).length);
    });
    setNotice(`Opened ${path}${statement?` · statement ${statement.fileOrdinal ?? statement.ordinal}`:''}. This finding refers to saved revision ${draft.revision}.`);
  };
  const revisions = draft?.revisions || [];
  const reconciliation=conflict && draft && latestDraft?reconcileDraftConflict(
    {name:draft.name,targetBindingId:draft.targetBindingId,files:editableFiles(draft)},
    {name,targetBindingId,files},
    {name:latestDraft.name,targetBindingId:latestDraft.targetBindingId,files:editableFiles(latestDraft)},conflictChoices,excludedFiles):null;
  const primaryAction = hasUnsavedEdits ? 'save' : preparedRelease ? 'plan' : 'release';
  return <section className="panel sql-workspace" aria-label="SQL workspace" aria-busy={busy || loading}>
    <div className="panel-heading"><div><p className="eyebrow">PROJECT SQL</p><h2>SQL workspace</h2>{projectName && <p>{projectName}</p>}</div><button type="button" className="secondary" onClick={() => void loadDrafts(draftId)} disabled={busy || loading || hasUnsavedEdits}>Refresh drafts</button></div>
    <p className="sql-workspace-intro">Edit and validate SQL, then prepare an immutable release for independent review.</p>
    {error && <p className="banner error" role="alert">{error}</p>}{notice && <p className="banner success" role="status">{notice}</p>}
    {loading && <p role="status">Loading project drafts…</p>}
    {correctionContext && <section className="banner warning" aria-label="Authored release correction"><div><strong>Correct an authored release</strong><p>Release <code>{correctionContext.releaseId}</code> retains draft revision {correctionContext.draftRevision}. You are viewing current editable revision {draft?.revision}. The retained release, findings and approvals remain unchanged. Save explicitly, prepare a new release, validate again and obtain fresh approval.</p>
      {!correctionContext.sourceBindingCurrent && <p>The project source binding changed since this release. New releases use the current binding.</p>}
      {correctionContext.state==='CHANGED' && <p>This file has changed since the release. Historical statement positions were not selected; review the current SQL before editing.</p>}
      {correctionContext.state==='REMOVED' && <p>The referenced file is absent from the current draft. No file was restored or historical statement selected.</p>}
      {correctionContext.state==='RENAMED' && <p>The same file is now named {correctionContext.currentPath}; its SQL still matches the retained source.</p>}
      {readOnly && <p>Your access or project state allows inspection only.</p>}
    </div></section>}
    <section className="sql-workspace-stage" aria-label="Database change stage" data-stage={conflict?'conflict':hasUnsavedEdits?'unsaved':planEligible?'plan-ready':preparedRelease?'release-prepared':validation?'validated':draft?'saved':'empty'}>
      <div><h3>{stage}</h3><p>{nextAction}</p></div>
      {(draft || preparedRelease) && <details className="sql-workspace-identifiers"><summary>Draft and release details</summary>
        {draft && <p>Draft <code>{draft.id}</code> · saved revision {draft.revision}{hasUnsavedEdits ? ' · unsaved edits' : ''}</p>}
        {preparedRelease && <><p>Immutable release <code>{preparedRelease.id}</code> · based on draft revision {preparedRelease.draftRevision}. This release remains unchanged by later draft edits.</p>{onOpenRelease && <button type="button" className="text-button" onClick={()=>onOpenRelease(preparedRelease.id)}>Inspect immutable release →</button>}</>}
      </details>}
    </section>
    {conflict && <section aria-label="Resolve draft revision conflict"><h3>Resolve draft revision conflict</h3><p>Your local edits are preserved. Inspect the latest saved revision before choosing what to keep.</p><button type="button" className="secondary" disabled={busy || loading} onClick={()=>void inspectConflict()}>Inspect latest saved revision</button>{latestDraft && <><div className="comparison-sides"><section><h4>Your local edits · based on revision {draft.revision}</h4><p>{name} · target <code>{targetBindingId}</code></p><pre>{files.map(f=>`${f.path}\n${f.sql}`).join('\n\n')}</pre></section><section><h4>Latest saved revision {latestDraft.revision}</h4><p>{latestDraft.name} · target <code>{latestDraft.targetBindingId}</code></p><pre>{editableFiles(latestDraft).map(f=>`${f.path}\n${f.sql}`).join('\n\n')}</pre></section></div><section className="draft-reconciliation" aria-label="Reconcile concurrent draft changes"><h4>Reconcile saved and local changes</h4><p>Non-overlapping file changes are combined by file identity. Overlapping edits, renames or removals require a choice; SQL text is never merged. Applying stages the result in your editor. Only an explicit save creates a new immutable revision.</p>
              {reconciliation?.conflicts.map(item=><div key={item.key}><label>Resolve {item.label}<select aria-label={`Resolve ${item.label}`} value={conflictChoices[item.key] || ''} disabled={busy || loading || readOnly} onChange={event=>setConflictChoices(previous=>({...previous,[item.key]:event.target.value}))}><option value="">Choose explicitly</option><option value="local">Use my version{item.local===null?' (remove file)':''}</option><option value="remote">Use latest saved version{item.remote===null?' (remove file)':''}</option></select></label><details><summary>Compare conflicting values · {item.label}</summary><div className="comparison-sides"><section><h5>My version</h5><pre>{typeof item.local==='object'?item.local?`${item.local.path}\n${item.local.sql}`:'File removed':String(item.local)}</pre></section><section><h5>Latest saved version</h5><pre>{typeof item.remote==='object'?item.remote?`${item.remote.path}\n${item.remote.sql}`:'File removed':String(item.remote)}</pre></section></div></details></div>)}
              <h5>Staged file manifest</h5><p>Uncheck a file only if you intend to exclude it from the next saved revision. All prior revisions remain retained.</p><ul>{reconciliation?.candidates.map(file=><li key={file.id}><label><input type="checkbox" aria-label={`Include ${file.path} ${file.id}`} checked={!excludedFiles.includes(file.id)} disabled={busy || loading || readOnly} onChange={event=>setExcludedFiles(ids=>event.target.checked?ids.filter(id=>id!==file.id):[...ids,file.id])}/>{file.path} · <code>{file.id}</code></label></li>)}</ul>
              {!!reconciliation?.issues.length && <ul role="alert">{reconciliation.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
              {reconciliation?.targetBindingId && !bindings.some(b=>targetIdOf(b)===reconciliation.targetBindingId) && <p role="alert">The reconciled target is unavailable. Choose an authorized target before saving.</p>}
              <div className="form-actions"><button type="button" className="secondary" disabled={busy || loading || readOnly} onClick={()=>resolveConflict(false)}>Discard local edits and load latest revision</button><button type="button" className="primary" disabled={busy || loading || readOnly || !reconciliation?.ready || !bindings.some(b=>targetIdOf(b)===reconciliation.targetBindingId)} onClick={()=>resolveConflict(true)}>Apply reconciliation to editor</button></div>
            </section></>}</section>}
    <div className="sql-workspace-layout">
      <aside className="sql-workspace-drafts" aria-label="Saved SQL drafts"><h3>Saved drafts</h3><button type="button" className="secondary" onClick={() => void createDraft()} disabled={busy || loading || readOnly || !selectedTarget || hasUnsavedEdits}>New draft</button>
        {!drafts.length && !loading && <p>No saved SQL drafts yet.</p>}
        <ul>{drafts.map(item => <li key={item.id}><button type="button" className={item.id === draftId ? 'draft-option selected' : 'draft-option'} onClick={() => void openDraft(item.id)} disabled={busy || loading || hasUnsavedEdits} aria-current={item.id === draftId ? 'page' : undefined}>{item.name} · r{item.revision}</button></li>)}</ul>{nextCursor && <button type="button" className="secondary" disabled={busy || loading} onClick={()=>void loadOlderDrafts()}>Older SQL drafts</button>}
      </aside>
      <div className="sql-workspace-editor">
        <label>Draft name<input aria-label="SQL draft name" value={name} maxLength={200} onChange={event => { setName(event.target.value); setAnalysis(null); setValidation(null); setPreparedRelease(null); }} disabled={busy || loading || readOnly || !draft}/></label>
        <label>Database target<select aria-label="SQL workspace target" value={targetBindingId} onChange={event => { setTargetBindingId(event.target.value); onBindingSelected?.(event.target.value); setAnalysis(null); setValidation(null); setPreparedRelease(null); }} disabled={busy || loading || readOnly}><option value="">Choose authorized project target</option>{bindings.map(binding => { const t = targetOf(binding); const id = targetIdOf(binding); return <option key={id} value={id}>{t?.exactOwner || t?.owner || 'Target'} · {t?.environmentName || t?.environmentId || 'Environment'} · revision {t?.bindingRevision || binding.revision || 'unknown'}</option>; })}</select></label>
        {draft && <section className="release-files" aria-label="Release SQL files"><h3>Release files</h3><p>Files are ordered by migration version.</p><div className="form-actions"><label>SQL file<select aria-label="SQL file" value={fileIndex} onChange={event=>{const i=Number(event.target.value);setFileIndex(i);fileSelection.current=files[i].id;setSql(files[i].sql);}} disabled={busy || loading}>{files.map((file,i)=><option key={file.id || i} value={i}>{file.path}{JSON.stringify(file)!==JSON.stringify(editableFiles(draft).find(saved=>saved.id===file.id)) ? ' · Unsaved' : ''}</option>)}</select></label><button type="button" className="secondary" disabled={busy || loading || readOnly || files.length>=128} onClick={()=>{const max=files.reduce((n,f)=>{const m=/^V([0-9]+)/.exec(f.path);return m && BigInt(m[1])>n?BigInt(m[1]):n;},0n);const next={id:crypto.randomUUID(),path:`V${max+1n}__migration.sql`,sql:''};setFiles([...files,next]);setFileIndex(files.length);fileSelection.current=next.id;setSql('');setUseFiles(true);setAnalysis(null);setValidation(null);setPreparedRelease(null);}}>Add SQL file</button><button type="button" className="secondary" disabled={busy || loading || readOnly || files.length<2} onClick={removeFile}>Remove SQL file</button></div><label>Migration filename<input aria-label="Migration filename" value={files[fileIndex]?.path || ''} disabled={busy || loading || readOnly} onChange={event=>{setFiles(rows=>rows.map((f,i)=>i===fileIndex?{...f,path:event.target.value}:f));setUseFiles(true);setAnalysis(null);setValidation(null);setPreparedRelease(null);}}/></label></section>}
        {removedFile && <p role="status">Removed {removedFile.file.path}. <button type="button" className="text-button" onClick={undoRemoveFile} disabled={busy || loading || readOnly || files.length>=128}>Undo file removal</button></p>}
        <label>SQL editor<textarea ref={editor} aria-label="SQL editor" spellCheck="false" autoCapitalize="off" autoCorrect="off" value={sql} onChange={event => { setSql(event.target.value); setFiles(rows=>rows.map((f,i)=>i===fileIndex?{...f,sql:event.target.value}:f)); setAnalysis(null); setValidation(null); setPreparedRelease(null); }} disabled={busy || loading || readOnly || !draft} rows={18} /></label>
        <p className="offline-note">{draft && <>Active file: <strong>{files[fileIndex]?.path}</strong> · </>}Offline review only; SQL is not executed and Oracle semantics remain unverified.</p>
        <div className="form-actions sql-workspace-actions" aria-label="SQL draft actions">{hasUnsavedEdits && <button type="button" className="secondary" onClick={discardEdits} disabled={busy || loading}>Discard unsaved edits</button>}<button type="button" className={primaryAction === 'save' ? 'primary' : 'secondary'} onClick={() => void saveDraft()} disabled={busy || loading || readOnly || !draft || !name.trim() || !selectedTarget || conflict || !hasUnsavedEdits}>Save draft</button>
          <button type="button" className="secondary" onClick={() => void preview()} disabled={busy || loading || readOnly || !draft || !selectedTarget || hasUnsavedEdits || conflict}>Review syntax</button>
          <button type="button" className="secondary" onClick={() => void validate()} disabled={busy || loading || readOnly || !draft || !selectedTarget || hasUnsavedEdits || conflict}>Validate against target</button>
          <button type="button" className={primaryAction === 'release' ? 'primary' : 'secondary'} onClick={() => void prepareRelease()} disabled={busy || loading || readOnly || !draft || !selectedTarget || hasUnsavedEdits || conflict}>Prepare immutable release</button>
          {preparedRelease && <button type="button" className={primaryAction === 'plan' ? 'primary' : 'secondary'} onClick={() => void createPlan()} disabled={busy || loading || readOnly || !planEligible || hasUnsavedEdits || conflict}>Create immutable plan</button>}
          {onNavigatePlan && <button type="button" className="text-button" onClick={() => onNavigatePlan()}>Open migration planning →</button>}</div>
        {!bindings.length && <p className="banner warning">No authorized project target is available. Configure a project target before validation or release preparation.</p>}
        {analysis && <section className="sql-workspace-analysis" aria-label="SQL syntax review"><h3>Offline syntax review</h3><p>Parser profile <code>{analysis.parserProfile || analysis.profile || 'Pinned Oracle parser'}</code> · Syntax {analysis.syntax || analysis.status || (analysis.ok ? 'PARSED' : 'UNAVAILABLE')}</p><p>Statement count {analysis.statementCount ?? analysis.statements?.length ?? 0}. Classification is a bounded statement review; Oracle semantics remain unverified.</p>
          {!!analysis.findings?.length && <ul aria-label="Syntax findings">{analysis.findings.map((finding, index) => <li key={index}><strong>{finding.severity} · {finding.code}</strong><p>{finding.rationale || finding.message}</p>{finding.path && <button type="button" className="text-button" onClick={()=>openFinding(finding.path,finding.ordinal)}>Open SQL source · {finding.path}</button>}</li>)}</ul>}
          {!!analysis.statements?.length && <div className="file-table-wrap"><table><thead><tr><th>Statement</th><th>Classification</th><th>Byte range</th></tr></thead><tbody>{analysis.statements.map((statement, index) => <tr key={`${statement.ordinal || index}`}><td><button type="button" className="text-button" onClick={()=>openFinding(statement.path || files[0]?.path,statement.ordinal)}>{statement.path || files[0]?.path} · {statement.fileOrdinal || statement.ordinal || index + 1}</button></td><td>{statement.classification || statement.kind || 'UNCLASSIFIED'}</td><td>{statement.startByte ?? '—'}–{statement.endByte ?? '—'}</td></tr>)}</tbody></table></div>}
        </section>}
        {validation && <section className="sql-workspace-validation" aria-label="SQL target validation"><h3>Target validation and risk findings</h3><ValidationFindings validation={validation} onOpenSource={openFinding}/></section>}
        {!!revisions.length && <details className="sql-workspace-revisions"><summary>Compare saved revisions</summary><section aria-label="Draft revision comparison"><div className="form-actions"><label>Base revision<select aria-label="Base draft revision" value={baseRevision} disabled={busy || loading} onChange={event => {setBaseRevision(event.target.value);setComparison(null);}}>{revisions.map(revision => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}</select></label><label>Candidate revision<select aria-label="Candidate draft revision" value={candidateRevision} disabled={busy || loading} onChange={event => {setCandidateRevision(event.target.value);setComparison(null);}}>{revisions.map(revision => <option key={revision.revision} value={revision.revision}>Revision {revision.revision}</option>)}</select></label><button type="button" className="secondary" onClick={() => void compare()} disabled={busy || loading || !baseRevision || !candidateRevision}>Compare</button></div>
          {comparison && <div className="revision-comparison"><p>Revision {comparison.baseRevision ?? baseRevision} → {comparison.candidateRevision ?? candidateRevision}</p>{comparison.changed === false ? <p>No SQL changes.</p> : <div className="comparison-sides"><section><h4>Base</h4><pre>{comparison.baseFiles ? comparison.baseFiles.map(f=>`${f.path}\n${f.sql}`).join('\n\n') : comparison.baseSql ?? comparison.base?.sql ?? ''}</pre></section><section><h4>Candidate</h4><pre>{comparison.candidateFiles ? comparison.candidateFiles.map(f=>`${f.path}\n${f.sql}`).join('\n\n') : comparison.candidateSql ?? comparison.candidate?.sql ?? ''}</pre></section></div>}</div>}
        </section></details>}
      </div>
    </div>
    {targetBindingId && <details className="sql-workspace-drift" onToggle={event=>setShowDrift(event.currentTarget.open)}>
      <summary>Schema drift and retained target evidence <span className="muted">Not a live-state or execution check</span></summary>
      {showDrift && <SchemaDrift token={token} projectId={projectId} bindingId={targetBindingId} request={request}/>}
    </details>}
  </section>;
}

export default SqlWorkspace;
