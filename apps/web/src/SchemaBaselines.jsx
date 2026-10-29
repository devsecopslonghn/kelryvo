import React, { useEffect, useRef, useState } from 'react';

const id = value => encodeURIComponent(value);
const pretty = value => JSON.stringify(value, null, 2);
const listOf = value => Array.isArray(value) ? value : [];
const facts = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.entries(value).map(([key, item]) => `${key}: ${typeof item === 'object' ? pretty(item) : String(item)}`).join(' · ')
  : typeof value === 'string' ? value : 'Not reported';
const errorText = error => error?.message === 'NOT_FOUND' || error?.message === 'UNAUTHENTICATED'
  ? 'Schema access changed. Refresh the project before continuing.'
  : error?.message === 'CONFLICT' ? 'The target changed while this action was running. Refresh the schema view.'
    : 'Schema evidence is unavailable. Refresh and try again.';

function SnapshotFacts({ snapshot }) {
  const coverage = snapshot?.coverage;
  return <><dl className="target-facts schema-snapshot-facts">
    <div><dt>Schema owner</dt><dd><code>{snapshot?.owner || snapshot?.schemaOwner || 'Unknown'}</code></dd></div>
    <div><dt>Observed</dt><dd>{snapshot?.observedAt || 'Time unavailable'}</dd></div>
    <div><dt>Database</dt><dd>{snapshot?.identity?.dbUniqueName || 'Unverified'}</dd></div>
    <div><dt>Container</dt><dd>{snapshot?.identity?.containerName || 'Unverified'}</dd></div>
    <div><dt>Observed service/version</dt><dd>{snapshot?.identity?.serviceName || 'Unknown'} · {snapshot?.identity?.version || 'Unknown'}</dd></div>
    <div><dt>Provenance</dt><dd>{snapshot?.provenance || 'Unspecified'}{snapshot?.liveAccepted === true ? ' · live accepted' : ' · live acceptance not established'}</dd></div>
    <div className="schema-coverage-fact"><dt>Coverage</dt><dd>{facts(coverage)}</dd></div>
  </dl><details className="technical-details schema-identifiers"><summary>Snapshot identity and revisions</summary><dl className="target-facts">
    <div><dt>Snapshot</dt><dd><code>{snapshot?.id || 'Unknown'}</code></dd></div>
    <div><dt>Database ID</dt><dd>{snapshot?.identity?.dbid || 'Unknown'}</dd></div>
    <div><dt>Container identity</dt><dd><code>{snapshot?.identity?.containerGuid || snapshot?.identity?.containerDbid || 'Unknown'}</code></dd></div>
    <div><dt>Migration stream</dt><dd><code>{snapshot?.streamId || 'Unknown'}</code></dd></div>
    {snapshot?.contentDigest && <div><dt>Content digest</dt><dd><code className="checksum">{snapshot.contentDigest}</code></dd></div>}
    {snapshot?.connectionRevision !== undefined && <div><dt>Connection revision</dt><dd>{snapshot.connectionRevision}</dd></div>}
    {snapshot?.bindingRevision !== undefined && <div><dt>Target binding revision</dt><dd>{snapshot.bindingRevision}</dd></div>}
    {snapshot?.assignmentRevision !== undefined && <div><dt>Assignment revision</dt><dd>{snapshot.assignmentRevision}</dd></div>}
  </dl></details></>;
}

function ObservationTime({ value }) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime())
    ? <time dateTime={value} title={value}>{date.toISOString().replace('T', ' · ').replace(/\.\d{3}Z$/, ' UTC')}</time>
    : <span>{value || 'Time unavailable'}</span>;
}

function RetainedValue({ value }) {
  return value === undefined ? '—' : <details className="schema-retained-value"><summary>View retained value</summary><pre className="schema-object-definition">{typeof value === 'string' ? value : pretty(value)}</pre></details>;
}

function CoverageSummary({ coverage }) {
  const entries = coverage && typeof coverage === 'object' && !Array.isArray(coverage) ? Object.entries(coverage) : [];
  if (!entries.length || entries.some(([, status]) => typeof status !== 'string')) return facts(coverage);
  const groups = new Map();
  for (const [type, status] of entries) groups.set(status, [...(groups.get(status) || []), type]);
  return [...groups].map(([status, types]) => `${status}: ${types.join(', ')}`).join(' · ');
}

function Objects({ objects }) {
  const [query, setQuery] = useState(''), [type, setType] = useState('ALL');
  const objectType = object => object.type || object.objectType || 'Unknown';
  const objectName = object => object.name || object.objectName || 'Unnamed';
  const needle = query.trim().toLowerCase();
  const types = [...new Set(objects.map(objectType))].sort();
  const visible = objects.filter(object => (type === 'ALL' || objectType(object) === type)
    && `${object.owner || 'Unknown'}.${objectName(object)}`.toLowerCase().includes(needle));
  if (!objects.length) return <p>No objects were reported in this snapshot. Check its coverage before treating this as an empty schema.</p>;
  return <>
    <div className="history-filters">
      <label>Search retained objects<input aria-label="Search retained objects" maxLength={256} value={query} onChange={event => setQuery(event.target.value)} placeholder="Owner or object name…"/></label>
      <label>Object type<select aria-label="Filter retained objects by type" value={type} onChange={event => setType(event.target.value)}><option value="ALL">All types</option>{types.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
      <button className="secondary" type="button" disabled={!query && type === 'ALL'} onClick={() => {setQuery('');setType('ALL');}}>Clear object filters</button>
    </div>
    <p role="status">Showing {visible.length} of {objects.length} retained objects.</p>
    {!visible.length ? <p>No retained objects match these filters. This filtered view does not establish schema absence.</p>
      : <div className="file-table-wrap"><table><thead><tr><th>Type</th><th>Owner</th><th>Name</th><th>Details</th></tr></thead><tbody>{visible.map((object, index) => <tr key={`${objectType(object)}:${object.owner}:${objectName(object)}:${index}`}>
        <td>{objectType(object)}</td><td><code>{object.owner || 'Unknown'}</code></td><td><code>{objectName(object)}</code></td>
        <td>{object.definition ? <details><summary>Definition and metadata</summary>{object.checksum && <p>Object SHA-256 <code className="checksum">{object.checksum}</code></p>}<pre className="schema-object-definition" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof object.definition === 'string' ? object.definition : pretty(object.definition)}</pre></details>
          : <pre className="schema-object-definition" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{pretty(Object.fromEntries(Object.entries(object).filter(([key]) => !['owner','name','type','objectType','objectName'].includes(key))))}</pre>}</td>
      </tr>)}</tbody></table></div>}
  </>;
}

export default function SchemaBaselines({ token, projectId, bindings = [], request, readOnly = false, onWorkspace, onPlans, onHistory, onMissing, hasMoreTargets, onLoadTargets, initialBindingId, onBindingSelected }) {
  const [connectionRows, setConnectionRows] = useState([]), [bindingId, setBindingId] = useState('');
  const [state, setState] = useState(null), [selectedId, setSelectedId] = useState(''), [selected, setSelected] = useState(null);
  const [connectionId, setConnectionId] = useState(''), [reason, setReason] = useState(''), [baselineName, setBaselineName] = useState(''), [baselineReason, setBaselineReason] = useState('');
  const [expectedId, setExpectedId] = useState(''), [observedId, setObservedId] = useState(''), [comparison, setComparison] = useState(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [nextCursor, setNextCursor] = useState('');
  const epoch = useRef(0), detailSequence = useRef(0), activeSnapshotId = useRef('');
  const base = `/api/projects/${id(projectId)}`;
  const targetSchema = `${base}/target-bindings/${id(bindingId)}/schema`;
  const report = failure => {
    if (['NOT_FOUND', 'UNAUTHENTICATED'].includes(failure?.message)) { epoch.current++; setState(null); setSelected(null); setComparison(null); setConnectionRows([]); onMissing?.(); }
    setError(errorText(failure));
  };
  const load = async (append = false) => {
    if (!bindingId) return;
    const current = ++epoch.current; setLoading(true); setError(''); setNotice('');
    if (!append) { setState(null); setSelected(null); setSelectedId(''); setComparison(null); setNextCursor(''); }
    try {
      const query = append && nextCursor ? `?after=${encodeURIComponent(nextCursor)}` : '';
      const result = await request(`${targetSchema}${query}`, token);
      if (current !== epoch.current) return;
      if (!result || result.binding?.bindingId && result.binding.bindingId !== bindingId) throw new Error('SCHEMA_UNAVAILABLE');
      setState(previous => append ? { ...result, snapshots: [...listOf(previous?.snapshots), ...listOf(result.snapshots)] } : result);
      setNextCursor(result.nextCursor || '');
      if (!append) {
        const first = listOf(result.baselines)[0];
        setExpectedId(first?.snapshotId || '');
      }
      return current;
    } catch (failure) { if (current === epoch.current) report(failure); }
    finally { if (current === epoch.current) setLoading(false); }
  };
  const loadBaselines = async () => {
    if(!state?.baselineNextCursor)return;
    const current=++epoch.current;setLoading(true);setError('');
    try {
      const result=await request(`${targetSchema}?baselineAfter=${id(state.baselineNextCursor)}`,token);
      if(current!==epoch.current)return;
      setState(previous=>({...previous,baselines:[...listOf(previous?.baselines),...listOf(result.baselines)],baselineNextCursor:result.baselineNextCursor,baselinesTruncated:result.baselinesTruncated}));
    } catch(failure) {if(current===epoch.current)report(failure);}
    finally {if(current===epoch.current)setLoading(false);}
  };
  const loadSnapshot = async snapshotId => {
    const current = epoch.current, sequence = ++detailSequence.current;
    activeSnapshotId.current = snapshotId;
    setSelectedId(snapshotId); setSelected(null); setError(''); setComparison(null);
    try {
      const result = await request(`${base}/schema-snapshots/${id(snapshotId)}`, token);
      if (current !== epoch.current || sequence !== detailSequence.current || activeSnapshotId.current !== snapshotId) return;
      const snapshot = result.snapshot;
      if (!result.snapshot || result.snapshot.id !== snapshotId || !Array.isArray(result.snapshot.schema?.objects)) throw new Error('SCHEMA_UNAVAILABLE');
      setSelected({ ...result.snapshot, objects: result.snapshot.schema.objects });
      setObservedId(snapshotId);
    } catch (failure) { if (current === epoch.current) report(failure); }
  };
  useEffect(() => {
    epoch.current++; detailSequence.current++; activeSnapshotId.current = ''; setState(null); setSelected(null); setSelectedId(''); setComparison(null); setConnectionRows([]); setBindingId(bindings.find(b=>b.bindingId===initialBindingId)?.bindingId || bindings[0]?.bindingId || '');
    setError(''); setNotice(''); setNextCursor('');
    return () => { epoch.current++; detailSequence.current++; };
  }, [token, projectId]);
  useEffect(() => {
    let active = true;
    if (!projectId) return undefined;
    request(`/api/projects/${id(projectId)}/database-connections`, token).then(result => {
      if (active) setConnectionRows(listOf(result.connections).filter(row => !row.retiredAt && row.enabled !== false));
    }).catch(failure => { if (active) { setConnectionRows([]); if (failure?.message === 'NOT_FOUND') onMissing?.(); } });
    return () => { active = false; };
  }, [token, projectId, request]);
  useEffect(() => {
    epoch.current++; detailSequence.current++; activeSnapshotId.current = '';
    setState(null); setSelected(null); setSelectedId(''); setComparison(null); setNextCursor('');
    if (bindingId) void load();
  }, [token, projectId, bindingId]);
  useEffect(() => { if (selectedId) void loadSnapshot(selectedId); }, [selectedId]);
  const observe = async event => {
    event.preventDefault(); if (!state?.canManage || readOnly || !connectionId || !reason.trim()) return;
    setBusy(true); setError(''); setNotice(''); const current = epoch.current;
    try {
      const value = await request(`${targetSchema}/observe`, token, { method: 'POST', body: JSON.stringify({ connectionId, expectedBindingRevision: String(state.binding?.bindingRevision || ''), expectedAssignmentRevision: String(state.binding?.assignmentRevision || ''), reason: reason.trim() }) });
      if (current !== epoch.current) return;
      if (!value.snapshot?.id) throw new Error('SCHEMA_UNAVAILABLE');
      setReason(''); setNotice('Schema observation retained as an immutable snapshot. Its provenance and completeness are shown with the record.');
      const loaded=await load(); if(loaded===epoch.current)setSelectedId(value.snapshot.id);
    } catch (failure) { if (current === epoch.current) report(failure); }
    finally { setBusy(false); }
  };
  const capture = async event => {
    event.preventDefault(); if (!selected?.id || !baselineName.trim() || !baselineReason.trim() || readOnly || !state?.canManage) return;
    setBusy(true); setError(''); setNotice(''); const current = epoch.current;
    try {
      await request(`${base}/schema-baselines`, token, { method: 'POST', body: JSON.stringify({ snapshotId: selected.id, name: baselineName.trim(), reason: baselineReason.trim() }) });
      if (current !== epoch.current) return;
      setBaselineName(''); setBaselineReason(''); setNotice('Immutable baseline captured from the selected snapshot.'); await load();
    } catch (failure) { if (current === epoch.current) report(failure); }
    finally { setBusy(false); }
  };
  const compare = async event => {
    event.preventDefault(); if (!expectedId || !observedId) return;
    const current = epoch.current; setBusy(true); setError(''); setComparison(null);
    try {
      const result = await request(`${base}/schema-comparison?expected=${encodeURIComponent(expectedId)}&observed=${encodeURIComponent(observedId)}`, token);
      if (current !== epoch.current) return;
      if (!result.comparison || !Array.isArray(result.comparison.changes) || !Array.isArray(result.comparison.limitations)) throw new Error('SCHEMA_UNAVAILABLE');
      setComparison(result);
    } catch (failure) { if (current === epoch.current) report(failure); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  const snapshots = listOf(state?.snapshots), baselines = listOf(state?.baselines);
  return <section className="schema-baselines panel" aria-label="Schema baselines and drift">
    <div className="panel-heading"><div><p className="eyebrow">DATABASE EVIDENCE</p><h2>Schema baselines &amp; drift</h2><p>Read authorized schema metadata, retain immutable snapshots, and compare them with a baseline.</p></div><button className="secondary" type="button" onClick={() => void load()} disabled={!bindingId || loading}>Refresh schema</button></div>
    <label>Project target<select aria-label="Schema target" value={bindingId} onChange={event => {setBindingId(event.target.value);onBindingSelected?.(event.target.value);}}><option value="">Choose a target</option>{bindings.map(binding => <option key={binding.bindingId} value={binding.bindingId}>{binding.exactOwner || binding.owner || 'Owner unavailable'} · {binding.displayLabel || binding.bindingId}</option>)}</select></label>
    {hasMoreTargets && <button type="button" className="secondary" onClick={onLoadTargets}>Load more schema targets</button>}
    {error && <p className="banner error" role="alert">{error}</p>}{notice && <p className="banner success" role="status">{notice}</p>}
    {loading && <p role="status">Loading retained schema evidence…</p>}
    {!bindings.length && <div className="empty-state compact"><strong>No project targets are available</strong><span>Bind an authorized schema owner before collecting observations.</span></div>}
    {state && <>
      <dl className="target-facts"><div><dt>Target owner</dt><dd><code>{state.binding?.exactOwner || state.binding?.owner || 'Unknown'}</code></dd></div><div><dt>Target binding</dt><dd><code>{state.binding?.bindingId || bindingId}</code> · revision {state.binding?.bindingRevision || state.binding?.revision || 'Unknown'}</dd></div><div><dt>Currentness</dt><dd>{state.currentness?.state || 'Unknown'}{state.currentness?.reasons?.length ? ` · ${state.currentness.reasons.join(', ')}` : ''}</dd></div></dl>
      {state.drift && <section className="banner warning" aria-label="Latest schema drift summary"><strong>Latest drift · {state.drift.comparison?.state || 'UNVERIFIED'}</strong><p>{state.drift.comparison?.summary ? <>Added: {state.drift.comparison.summary.added} · removed: {state.drift.comparison.summary.removed} · modified: {state.drift.comparison.summary.modified} · unverified: {state.drift.comparison.summary.unverified}</> : 'No comparison is available.'}</p></section>}
      {state.canManage && !readOnly && <details className="schema-action-disclosure"><summary>Collect a schema observation</summary><form className="connection-grid" onSubmit={observe}><fieldset disabled={busy || loading}>
        <label>Authorized connection<select required value={connectionId} onChange={event => setConnectionId(event.target.value)}><option value="">Choose a connection</option>{connectionRows.filter(row=>row.routeId===state.binding?.routeId).map(row => <option key={row.id} value={row.id}>{row.name} · {row.engine || 'unknown engine'}</option>)}</select></label>
        <label className="wide">Observation reason<textarea required maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} /></label>
      </fieldset><button className="primary" type="submit" disabled={busy || loading || !connectionId || !reason.trim()}>Observe schema</button></form></details>}
      {state.canManage === false && <p className="banner warning" role="status">Schema observations and baseline capture are unavailable for your current access. Retained evidence remains readable.</p>}
      <div className="schema-evidence-history">
        <section className="schema-section" aria-label="Retained schema snapshots"><h3>Schema snapshots</h3>
          {!snapshots.length && <p>No schema snapshots are available yet. Capture an observation to create the first snapshot.</p>}
          {!!snapshots.length && <ul className="schema-snapshot-list">{snapshots.map(snapshot => <li key={snapshot.id} data-selected={selectedId === snapshot.id || undefined}>
            <button className="text-button schema-record-link" type="button" aria-label={snapshot.id} aria-current={selectedId === snapshot.id ? 'true' : undefined} onClick={() => setSelectedId(snapshot.id)}><ObservationTime value={snapshot.observedAt}/><code>{snapshot.id}</code></button>
            <p className="schema-record-state">{snapshot.provenance || 'Provenance unspecified'} · {snapshot.liveAccepted === true ? 'live accepted' : 'live acceptance not established'}</p>
            <p className="schema-record-coverage"><strong>Coverage</strong> <CoverageSummary coverage={snapshot.coverage}/></p>
          </li>)}</ul>}
          {nextCursor && <button className="secondary" type="button" disabled={loading} onClick={() => void load(true)}>Load more snapshots</button>}
        </section>
        <section className="schema-section" aria-label="Immutable baseline history"><h3>Baseline history</h3>
          {!baselines.length && <p>No immutable baselines have been captured for this target.</p>}
          {!!baselines.length && <ul className="schema-baseline-list">{baselines.map(row => <li key={row.id || row.snapshotId}>
            <label className="schema-baseline-choice"><input type="radio" name="expected-schema" checked={expectedId === row.snapshotId} onChange={() => setExpectedId(row.snapshotId)}/><span>{row.name}</span></label>
            <p className="schema-record-state"><ObservationTime value={row.createdAt || row.capturedAt}/> · {row.provenance || 'Provenance unspecified'}</p>
            <p className="schema-record-coverage"><strong>Coverage</strong> <CoverageSummary coverage={row.coverage}/></p>
            <button type="button" className="text-button schema-baseline-reference" onClick={()=>setSelectedId(row.snapshotId)}>{row.snapshotId}</button>
          </li>)}</ul>}
          {state.baselineNextCursor && <button className="secondary" type="button" disabled={loading} onClick={()=>void loadBaselines()}>Load more baselines</button>}
        </section>
      </div>
      {selected && <section className="schema-section schema-snapshot-detail" aria-label="Schema snapshot detail"><div className="panel-heading"><div><h3>Snapshot detail</h3><p>Definitions reflect the retained observation; incomplete visibility can leave objects unknown.</p></div><button className="secondary" type="button" onClick={() => {setSelectedId('');setSelected(null);detailSequence.current++;}}>Close detail</button></div><SnapshotFacts key={selected.id} snapshot={selected}/><Objects key={selected.id} objects={listOf(selected.objects)}/>
        {state.canManage && !readOnly && <details key={selected.id} className="schema-action-disclosure"><summary>Save this snapshot as a baseline</summary><form className="connection-grid" onSubmit={capture}><fieldset disabled={busy}><label>Baseline name<input required maxLength={120} value={baselineName} onChange={event => setBaselineName(event.target.value)}/></label><label className="wide">Capture reason<textarea required maxLength={2000} value={baselineReason} onChange={event => setBaselineReason(event.target.value)}/></label></fieldset><button className="primary" type="submit" disabled={busy || !baselineName.trim() || !baselineReason.trim()}>Capture immutable baseline</button></form></details>}
      </section>}
      <section className="schema-section" aria-label="Compare schema snapshots"><h3>Compare snapshots</h3><form className="connection-grid schema-compare-form" onSubmit={compare}><label>Expected reference<select required value={expectedId} onChange={event => setExpectedId(event.target.value)}><option value="">Choose reference</option>{baselines.map(row => <option key={row.id} value={row.snapshotId}>Baseline · {row.name} · {row.createdAt || row.capturedAt || 'unknown capture time'} · {row.snapshotId}</option>)}{snapshots.map(row=><option key={`snapshot:${row.id}`} value={row.id}>Snapshot · {row.observedAt || 'unknown observation time'} · {row.id}</option>)}</select></label><label>Observed snapshot<select required value={observedId} onChange={event => setObservedId(event.target.value)}><option value="">Choose snapshot</option>{snapshots.map(row => <option key={row.id} value={row.id}>{row.id} · {row.observedAt || 'unknown time'}</option>)}</select></label><button className="primary" type="submit" disabled={busy || !expectedId || !observedId}>Compare</button></form>
        {comparison && <><p role="status"><strong>{comparison.comparison.state || 'UNVERIFIED'}</strong> · {facts(comparison.comparison.summary)}</p><p>Expected <code>{comparison.expected?.id || expectedId}</code> · {comparison.expected?.provenance} · observed <code>{comparison.observed?.id || observedId}</code> · {comparison.observed?.provenance}. Fixture comparisons do not verify live drift.</p>{comparison.comparison.limitations.length > 0 && <div className="banner warning"><strong>Comparison limitations</strong><ul>{comparison.comparison.limitations.map((item, index) => <li key={index}>{typeof item === 'string' ? item : item.message || pretty(item)}</li>)}</ul></div>}<div className="file-table-wrap"><table><thead><tr><th>Change</th><th>Object</th><th>Property</th><th>Before</th><th>After</th></tr></thead><tbody>{comparison.comparison.changes.map((change, index) => { const before = change.before ?? change.details?.before; const after = change.after ?? change.details?.after; return <tr key={`${change.kind}:${change.owner}:${change.name}:${index}`}><td>{change.kind}</td><td><code>{change.owner}.{change.name}</code></td><td>{(change.details || []).join(', ') || '—'}</td><td><RetainedValue value={before}/></td><td><RetainedValue value={after}/></td></tr>;})}</tbody></table></div>{!comparison.comparison.changes.length && <p>No verified structural changes were reported. Review the limitations and coverage before interpreting this as no drift.</p>}</>}
      </section>
      <div className="records-actions">{onWorkspace && <button className="secondary" type="button" onClick={() => onWorkspace(bindingId)}>Open SQL Workspace for target</button>}{onPlans && <button className="secondary" type="button" onClick={() => onPlans(bindingId)}>Open migration plans for target</button>}{onHistory && <button className="secondary" type="button" onClick={() => onHistory(bindingId)}>Open migration history</button>}</div>
    </>}
  </section>;
}
