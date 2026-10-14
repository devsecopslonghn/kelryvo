import SchemaDrift from './SchemaDrift.jsx';
import React, { useEffect, useRef, useState } from 'react';

export function ValidationFindings({ validation, onOpenSource }) {
  const r=validation.report;
  const findings=[...r.findings,...r.statements.flatMap(s=>s.findings.map(f=>({...f,path:s.path,ordinal:s.ordinal,fileOrdinal:s.fileOrdinal})))];
  return <div className="validation-findings">
    <p role="status"><strong>{r.outcome}</strong> · Policy: {r.policy.decision.replaceAll('_',' ')} · Evidence: {validation.currentness?.state || 'UNKNOWN'}</p>
    <p>Syntax: {r.syntax}. Object existence and Oracle semantics remain unverified. This result grants no database execution authority.</p>
    <dl className="target-facts"><div><dt>Validation digest</dt><dd><code>{validation.digest}</code></dd></div><div><dt>Target owner</dt><dd>{r.target.exactOwner}</dd></div><div><dt>Binding revision</dt><dd>{r.target.bindingRevision}</dd></div><div><dt>Metadata completeness</dt><dd>{r.metadata.completeness==='OWNER_VISIBILITY_ONLY'?'Schema owner visibility only':'Not observed'}</dd></div><div><dt>Observation</dt><dd><code>{r.metadata.observationId || 'Not observed'}</code></dd></div><div><dt>Metadata expiry</dt><dd>{r.metadata.expiresAt || 'Not observed'}</dd></div><div><dt>Provenance</dt><dd>{r.metadata.provenance}</dd></div><div><dt>Engine capability</dt><dd>{r.capabilities.engine} · {r.capabilities.syntax==='PINNED_ANTLR_ORACLE'?'Oracle syntax parsing':'Unsupported'}</dd></div></dl>
    {r.metadata.schemaSnapshot && <p>Retained schema snapshot <code>{r.metadata.schemaSnapshot.id}</code> · {r.metadata.schemaSnapshot.objectCount} objects · {r.metadata.schemaSnapshot.provenance}. Coverage: {Object.entries(r.metadata.schemaSnapshot.coverage).map(([type,status])=>`${type}: ${status}`).join(' · ')}. Structural observations do not establish Oracle semantic validity.</p>}
    {validation.currentness?.state!=='CURRENT' && <p className="banner warning">Validation evidence is stale or unavailable. Refresh the target, validate again and create a fresh plan. {(validation.currentness?.reasons || []).join(', ')}</p>}
    <ul aria-label="Validation findings">{findings.map((f,index)=><li key={index}><strong>{f.severity} · {f.code}</strong>{f.path && <small> · {f.path} · statement {f.fileOrdinal ?? f.ordinal}</small>}<p>{f.rationale}</p>{f.path && onOpenSource && <button type="button" className="text-button" onClick={()=>onOpenSource(f.path,f.ordinal,r.statements.find(s=>s.path===f.path && s.ordinal===f.ordinal))}>Open SQL source · {f.path} · statement {f.fileOrdinal ?? f.ordinal}</button>}</li>)}</ul>
    {r.statements.length>0 && <div className="file-table-wrap"><table><thead><tr><th>SQL file</th><th>Statement</th><th>Classification</th><th>Schema references</th><th>Object existence</th></tr></thead><tbody>{r.statements.map(s=><tr key={s.ordinal}><td>{s.path}</td><td>{s.fileOrdinal}</td><td>{s.classification}</td><td>{s.schemaCheck}<br/>{s.references.map(x=>`${x.owner}.${x.name}`).join(', ')}</td><td>{s.objectCheck}</td></tr>)}</tbody></table></div>}
  </div>;
}

function errorMessage(e) {
  if(['FRESH_VALIDATION_REQUIRED','TARGET_REVISION_CONFLICT','SOURCE_BINDING_MISMATCH'].includes(e.message))return 'The source or target evidence changed. Refresh the project and validate again.';
  if(e.message==='VALIDATION_PARSER_UNAVAILABLE')return 'SQL parsing is unavailable. Refresh and retry validation.';
  if(e.message==='METADATA_RESTORE_HOLD')return 'Validation is blocked by metadata recovery HOLD.';
  return `Validation could not be completed (${e.message || 'UNAVAILABLE'}). Refresh to check your access and evidence.`;
}

export function SchemaValidation({token,projectId,release,bindings,request,onPlan,readOnly,onOpenSource}) {
  const [bindingId,setBindingId]=useState(''),[validation,setValidation]=useState(null),[history,setHistory]=useState([]),[cursor,setCursor]=useState(null);
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const epoch=useRef(0),base=`/api/projects/${encodeURIComponent(projectId)}`;
  const showError=e=>{setError(errorMessage(e));if(['NOT_FOUND','UNAUTHENTICATED'].includes(e.message)){epoch.current++;setValidation(null);setHistory([]);setCursor(null);setBusy(false);setLoading(false);}};
  const load=async(after=null)=>{const n=epoch.current;try{
    const r=await request(`${base}/releases/${release.id}/validations${after?`?after=${after}`:''}`,token);
    if(n===epoch.current){setHistory(old=>after?[...old,...r.validations]:r.validations);setCursor(r.nextCursor);}
  }catch(e){if(n===epoch.current)showError(e);}finally{if(n===epoch.current)setLoading(false);}};
  useEffect(()=>{epoch.current++;setBindingId('');setValidation(null);setHistory([]);setError('');setLoading(true);setBusy(false);void load();return()=>{epoch.current++;};},[token,projectId,release.id]);
  const inspect=async id=>{const n=epoch.current;setBusy(true);setError('');try{const r=await request(`${base}/validations/${id}`,token);if(n===epoch.current)setValidation(r.validation);}catch(e){if(n===epoch.current)showError(e);}finally{if(n===epoch.current)setBusy(false);}};
  const validate=async()=>{
    const b=bindings.find(b=>b.bindingId===bindingId);if(!b)return;
    const n=epoch.current;setBusy(true);setError('');setValidation(null);
    try{const r=await request(`${base}/releases/${release.id}/validations`,token,{method:'POST',body:JSON.stringify({targetBindingId:b.bindingId,expectedBindingRevision:b.bindingRevision,expectedAssignmentRevision:b.assignmentRevision})});
      if(n===epoch.current){setValidation(r.validation);await load();}
    }catch(e){if(n===epoch.current)showError(e);}finally{if(n===epoch.current)setBusy(false);}
  };
  const plan=async()=>{const n=epoch.current;setBusy(true);setError('');const t=validation.report.target;
    try{const r=await request(`${base}/plans`,token,{method:'POST',body:JSON.stringify({intentVersion:3,releaseId:release.id,assignmentId:t.assignmentId,
      expectedAssignmentRevision:t.assignmentRevision,targetBindingId:t.bindingId,expectedBindingRevision:t.bindingRevision,
      validationId:validation.id,expectedValidationDigest:validation.digest})});if(n===epoch.current)await onPlan(r.plan);
    }catch(e){if(n===epoch.current)showError(e);}finally{if(n===epoch.current)setBusy(false);}};
  return <section className="panel schema-validation" aria-label="Validate SQL against target" aria-busy={busy || loading}><h3>Validate SQL against target</h3><p>Review the retained SQL against the exact target and available discovery evidence before creating an immutable plan.</p>
    {loading && <p role="status">Loading retained validations…</p>}{error && <p className="banner error" role="alert">{error}</p>}
    <label>Validation target<select aria-label="Validation target" value={bindingId} onChange={e=>{setBindingId(e.target.value);setValidation(null);}} disabled={busy || readOnly}><option value="">Choose target binding</option>{bindings.map(b=><option key={b.bindingId} value={b.bindingId}>{b.exactOwner} · revision {b.bindingRevision} · {b.identityState}</option>)}</select></label>
    {!bindings.length && <p>No assigned target binding is available. Configure a project target first.</p>}
    <button type="button" className="primary" disabled={busy || readOnly || !bindingId} onClick={validate}>{busy?'Working…':'Validate against target'}</button>
    {history.length>0 && <div className="validation-history"><h4>Retained validation results</h4>{history.map(v=><button type="button" className="secondary" key={v.id} disabled={busy} onClick={()=>void inspect(v.id)}>Inspect validation {v.digest.slice(0,12)} · {new Date(v.createdAt).toLocaleString()}</button>)}{cursor && <button type="button" className="secondary" onClick={()=>void load(cursor)} disabled={busy}>Load more validations</button>}</div>}
    {bindingId && <SchemaDrift token={token} projectId={projectId} bindingId={bindingId} request={request}/>}
    {validation && <><ValidationFindings validation={validation} onOpenSource={onOpenSource}/><button type="button" className="primary" disabled={busy || readOnly || validation.currentness?.state!=='CURRENT' || validation.report.policy.decision==='BLOCKED'} onClick={plan}>Create immutable plan</button></>}
  </section>;
}

export function RetainedValidation({token,projectId,reference,request,currentness,onOpenSource}) {
  const [validation,setValidation]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{let active=true;setValidation(null);setError('');setLoading(true);
    request(`/api/projects/${projectId}/validations/${reference.id}`,token).then(r=>{if(active){if(r.validation.digest!==reference.digest)throw new Error('VALIDATION_EVIDENCE_UNAVAILABLE');setValidation(r.validation);}})
      .catch(e=>{if(active)setError(errorMessage(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};},[token,projectId,reference.id,reference.digest]);
  return <section className="panel" aria-label="Retained SQL validation"><h3>Retained SQL validation</h3>{loading && <p role="status">Loading validation evidence…</p>}{error && <p className="banner error" role="alert">{error}</p>}{validation && <ValidationFindings validation={{...validation,currentness:currentness || validation.currentness}} onOpenSource={onOpenSource}/>}</section>;
}
