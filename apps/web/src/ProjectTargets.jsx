import React, { useEffect, useRef, useState } from 'react';

export function ProjectTargets({token, projectId, detail, actor, request, readOnly, onSaved, onPrepare, onMissing}) {
  const [references,setReferences] = useState([]), [bindings,setBindings] = useState([]), [options,setOptions] = useState([]);
  const [next,setNext] = useState(null), [referenceNext,setReferenceNext] = useState(null), [optionNext,setOptionNext] = useState(null);
  const [form,setForm] = useState({assignmentId:'',optionId:'',environmentId:'',bindingId:'',reason:''});
  const [busy,setBusy] = useState(false), [loading,setLoading] = useState(true), [error,setError] = useState(''), [notice,setNotice] = useState(''), [inspected,setInspected] = useState(null);
  const epoch = useRef(0), optionEpoch = useRef(0);
  const report = e => { setError(e.message === 'TARGET_REVISION_CONFLICT' ? 'The target revision changed. Refresh the target facts, review your choices, and submit explicitly again.' : e.message === 'TARGET_OPTION_INELIGIBLE' ? 'The option is no longer eligible. Ask the local operator to review its configuration.' : `Target action failed: ${e.message}. Refresh and try again.`); if (['NOT_FOUND','UNAUTHENTICATED'].includes(e.message)) {setReferences([]);setBindings([]);setOptions([]);setInspected(null);onMissing();} };
  const load = async () => {const n = ++epoch.current; setLoading(true);setError('');
    try {const [refs,targets] = await Promise.all([request(`/api/projects/${projectId}/schema-references`,token),request(`/api/projects/${projectId}/target-bindings`,token)]);if(n !== epoch.current)return;
      setReferences(refs.references);setReferenceNext(refs.nextCursor);setBindings(targets.bindings);setNext(targets.nextCursor);
      if(form.assignmentId) {const revision=++optionEpoch.current;const configured=await request(`/api/projects/${projectId}/target-options?assignmentId=${form.assignmentId}`,token);if(n===epoch.current && revision===optionEpoch.current){setOptions(configured.options);setOptionNext(configured.nextCursor);}}
    } catch(e) {if(n === epoch.current)report(e);} finally {if(n === epoch.current)setLoading(false);}
  };
  useEffect(() => {void load();return () => {epoch.current++;optionEpoch.current++;};},[token,projectId]);
  useEffect(() => {const n = ++optionEpoch.current;setOptions([]);setOptionNext(null);if(!form.assignmentId)return;
    request(`/api/projects/${projectId}/target-options?assignmentId=${form.assignmentId}`,token).then(result => {if(n === optionEpoch.current){setOptions(result.options);setOptionNext(result.nextCursor);}}).catch(e => {if(n === optionEpoch.current)report(e);});
  },[form.assignmentId,token,projectId]);
  const page = async (kind) => {const n = epoch.current;setBusy(true);try {
    const cursor = kind === 'bindings' ? next : referenceNext;
    const result = await request(`/api/projects/${projectId}/${kind === 'bindings' ? 'target-bindings' : 'schema-references'}?after=${cursor}`,token);
    if(n !== epoch.current)return;
    if(kind === 'bindings'){setBindings(old => [...old,...result.bindings]);setNext(result.nextCursor);}else{setReferences(old => [...old,...result.references]);setReferenceNext(result.nextCursor);}
  }catch(e){if(n === epoch.current)report(e);}finally{if(n === epoch.current)setBusy(false);}};
  const inspect = async binding => {const n=epoch.current;setBusy(true);setError('');try {const result=await request(`/api/projects/${projectId}/target-bindings/${binding.bindingId}`,token);if(n===epoch.current)setInspected(result);}catch(e){if(n===epoch.current)report(e);}finally{if(n===epoch.current)setBusy(false);}};
  const submit = async event => {event.preventDefault();if(busy || readOnly)return;const n=epoch.current;setBusy(true);setError('');setNotice('');
    const ref=references.find(r=>r.assignmentId===form.assignmentId), option=options.find(o=>o.optionId===form.optionId), binding=bindings.find(b=>b.bindingId===form.bindingId);
    if(!ref || !option){setError('Choose a current assigned schema and configured target option.');setBusy(false);return;}
    try {const result=await request(`/api/projects/${projectId}/target-bindings`,token,{method:'POST',body:JSON.stringify({assignmentId:ref.assignmentId,expectedAssignmentRevision:ref.assignmentRevision,environmentId:form.environmentId,targetOptionId:option.optionId,expectedTargetOptionRevision:option.optionRevision,...(binding ? {bindingId:binding.bindingId} : {}),expectedBindingRevision:binding?.bindingRevision || '0',reason:form.reason.trim()})});
      if(n !== epoch.current)return;setInspected(result);setNotice(`Binding revision retained. Identity: ${result.binding.identityState}. Execution remains unavailable.`);setForm(old=>({...old,reason:'',bindingId:result.binding.bindingId}));await onSaved();await load();
    }catch(e){if(n===epoch.current)report(e);}finally{setBusy(false);}
  };
  const selectedOption=options.find(o=>o.optionId===form.optionId);
  return <section aria-busy={loading || busy} className="project-targets"><div className="page-heading"><div><p className="eyebrow">PROJECT GOVERNANCE</p><h1>Project targets</h1><p>Explicit schema assignments and environment bindings for {detail.project.name}.</p></div><button type="button" className="secondary" onClick={()=>void load()} disabled={busy || loading}>Refresh targets</button></div>
    <section className="notice-card"><div><strong>Manual and observed references · execution unavailable</strong><p>Manual identity remains provisional. Retained observations and verification evidence record identity separately from deployment authority. A binding never authorizes Oracle execution.</p></div></section>
    {loading && <p role="status">Loading assigned targets…</p>}{error && <p role="alert" className="banner error">{error}</p>}{notice && <p role="status" className="banner success">{notice}</p>}
    {!loading && !references.length && !error && <p>No schemas assigned. The trusted local OS operator must assign a schema and configure its target option.</p>}
    {referenceNext && <button type="button" className="secondary" disabled={busy} onClick={()=>void page('references')}>Load more assigned schemas</button>}
    <section className="panel"><h2>Target bindings</h2>{!bindings.length && !loading && !error && <p>No bindings yet. Select an assigned schema, an operator-configured option, and an explicit environment.</p>}
      <div className="file-table-wrap"><table><thead><tr><th>Owner</th><th>Environment</th><th>Route</th><th>Revision</th><th>Identity</th><th>Details</th></tr></thead><tbody>{bindings.map(b=><tr key={b.bindingId}><td>{b.exactOwner}</td><td>{b.environmentName}</td><td>{b.routeAlias}</td><td>{b.bindingRevision}</td><td>{b.identityState} · {b.observedAt ? new Date(b.observedAt).toLocaleString() : 'Not observed'}</td><td><button type="button" className="text-button" onClick={()=>void inspect(b)} disabled={busy}>Inspect binding</button></td></tr>)}</tbody></table></div>{next && <button type="button" className="secondary" onClick={()=>void page('bindings')} disabled={busy}>Load more bindings</button>}
    </section>
    <section className="panel"><h2>Create binding revision</h2>{actor.role !== 'developer' && <p>Only developers can create binding revisions. You can inspect the retained target evidence.</p>}{readOnly && <p>Binding changes are unavailable while this project or workspace is read-only.</p>}
      <form onSubmit={submit}><fieldset className="profile-fields" disabled={busy || loading || readOnly || actor.role !== 'developer'}>
        <label>Assigned schema<select aria-label="Assigned schema" required value={form.assignmentId} onChange={e=>{setInspected(null);setForm({...form,assignmentId:e.target.value,optionId:'',environmentId:'',bindingId:''});}}><option value="">Choose an assignment</option>{references.map(r=><option key={r.assignmentId} value={r.assignmentId}>{r.owner} · {r.container.name} · revision {r.assignmentRevision}</option>)}</select></label>
        <label>Target option<select aria-label="Target option" required value={form.optionId} onChange={e=>setForm({...form,optionId:e.target.value,environmentId:''})}><option value="">Choose a configured option</option>{options.filter(o=>o.enabled).map(o=><option key={o.optionId} value={o.optionId}>{o.routeAlias} · {o.principalAlias} · revision {o.optionRevision}</option>)}</select></label>
        <label>Target environment<select aria-label="Target environment" required value={form.environmentId} onChange={e=>setForm({...form,environmentId:e.target.value,bindingId:''})}><option value="">Choose an explicit environment</option>{detail.environments.filter(e=>e.id===selectedOption?.environmentId).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
        <label>Binding to revise<select aria-label="Binding to revise" value={form.bindingId} onChange={e=>setForm({...form,bindingId:e.target.value})}><option value="">Create first revision</option>{bindings.filter(b=>b.assignmentId===form.assignmentId && b.environmentId===form.environmentId).map(b=><option key={b.bindingId} value={b.bindingId}>{b.bindingId} · revision {b.bindingRevision}</option>)}</select></label>
        <label>Binding reason<textarea aria-label="Binding reason" required maxLength={2000} value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/></label>
      </fieldset><button type="submit" className="primary" disabled={busy || loading || readOnly || actor.role !== 'developer' || !form.assignmentId || !form.optionId || !form.environmentId || !form.reason.trim()}>Create binding revision</button></form>
      {form.assignmentId && !options.length && <p>No configured options. Ask the trusted local operator to configure an offline target option matching the profile, route, deployment principal and exact owner policy.</p>}
      {optionNext && <button type="button" className="secondary" disabled={busy} onClick={async()=>{const n=optionEpoch.current;try{const result=await request(`/api/projects/${projectId}/target-options?assignmentId=${form.assignmentId}&after=${optionNext}`,token);if(n===optionEpoch.current){setOptions(old=>[...old,...result.options]);setOptionNext(result.nextCursor);}}catch(e){if(n===optionEpoch.current)report(e);}}}>Load more options</button>}
    </section>
    {inspected && <section className="panel" aria-label="Binding detail"><h2>Retained binding</h2><dl className="target-facts">{Object.entries(inspected.binding).map(([key,value])=><div key={key}><dt>{key}</dt><dd><code>{String(value ?? 'Not observed')}</code></dd></div>)}</dl>{inspected.currentness && <p role="status">Currentness: {inspected.currentness.state} {inspected.currentness.reasons.join(', ')}</p>}{inspected.revisions && <p>{inspected.revisions.length} retained revisions shown (latest 50).</p>}<button type="button" className="primary" onClick={onPrepare}>Go to releases and prepare plan</button></section>}
  </section>;
}
