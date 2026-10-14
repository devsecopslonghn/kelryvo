import React, { useEffect, useRef, useState } from 'react';
import { CONNECTION_PATTERNS, ConnectionConfiguration } from './ConnectionConfiguration.jsx';

const blankInstance = { name: '', containerName: '', kind: 'PDB', environment: 'DEV', host: '', port: '', service: '', transport: 'TCP', owner: '', reason: '' };
const blankConnection = { assignmentId: '', routeId: '', name: '', description: '', engine: 'oracle', serviceKind: 'SERVICE_NAME', username: '', credentialRef: '', reason: '' };

export function Connections({ token, projectId, api, detail, onChanged, readOnly = false }) {
  const [rawData, setData] = useState(null), [dataScope, setDataScope] = useState({ projectId: '', token: '' }), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [instance, setInstance] = useState(blankInstance), [connection, setConnection] = useState(blankConnection), [reasons, setReasons] = useState({});
  const [histories, setHistories] = useState({}), [historyCursors, setHistoryCursors] = useState({}), [selectedObservation, setSelectedObservation] = useState({}), [bindingPick, setBindingPick] = useState({}), [cursor, setCursor] = useState(''), [targetCursor, setTargetCursor] = useState(''), [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''), [engineFilter, setEngineFilter] = useState(''), [environmentFilter, setEnvironmentFilter] = useState(''), [statusFilter, setStatusFilter] = useState(''), [selectedConfig, setSelectedConfig] = useState('');
  const epoch = useRef(0), filtersInitialized = useRef(false);
  const report = e => { setError(messageFor(e)); if(['NOT_FOUND','UNAUTHENTICATED'].includes(e.message)){epoch.current++;setBusy(false);setData(null);setHistories({});setSelectedObservation({});setBindingPick({});} };
  const path = `/api/projects/${encodeURIComponent(projectId)}/database-connections`;
  const load = async (after = '', append = false, includeTargets = false) => {
    const n = ++epoch.current; setError('');
    try {
      const params = new URLSearchParams();
      if (after) params.set('after', after);
      if (search.trim()) params.set('search', search.trim());
      if (engineFilter) params.set('engine', engineFilter);
      if (environmentFilter) params.set('environment', environmentFilter);
      if (statusFilter) params.set('status', statusFilter);
      const query = params.toString();
      const connectionResult = await api(`${path}${query ? `?${query}` : ''}`, token);
      const targets = includeTargets ? await api(`/api/projects/${encodeURIComponent(projectId)}/target-bindings`, token) : null;
      if (n === epoch.current) { setData(prev => ({ ...connectionResult, connections: append ? [...(prev?.connections || []), ...(connectionResult.connections || [])] : connectionResult.connections || [], targetBindings: targets ? targets.bindings || targets.targetBindings || [] : prev?.targetBindings || [] })); setDataScope({ projectId, token }); setCursor(connectionResult.nextCursor || ''); if (targets) setTargetCursor(targets.nextCursor || ''); }
    }
    catch (e) { if (n === epoch.current) { report(e); } }
  };
  useEffect(() => { setData(null); setDataScope({ projectId: '', token: '' }); setHistories({}); setHistoryCursors({}); setSelectedObservation({}); setBindingPick({}); setTargetCursor(''); filtersInitialized.current = false; return () => { epoch.current += 1; }; }, [projectId, token]);
  useEffect(() => {
    if (!projectId) return undefined;
    if (!filtersInitialized.current) { filtersInitialized.current = true; void load('', false, true); return undefined; }
    const timer = setTimeout(() => void load('', false, false), 180);
    return () => clearTimeout(timer);
  }, [projectId, token, search, engineFilter, environmentFilter, statusFilter]);
  const data = dataScope.projectId === projectId && dataScope.token === token ? rawData : null;
  const run = async (action, success) => {
    const n = epoch.current; setBusy(true); setError(''); setNotice('');
    try { const outcome = await action(); if (n === epoch.current) { setSelectedObservation({}); setBindingPick({}); if (success) success(outcome); await onChanged?.(); if (n === epoch.current) { setBusy(false); await load('', false, true); } } }
    catch (e) { if (n === epoch.current) { report(e); } }
    finally { if (n === epoch.current) setBusy(false); }
  };
  const post = (url, body) => api(url, token, { method: 'POST', body: JSON.stringify(body) });
  const addConnection = event => { event.preventDefault(); void run(() => post(path, { ...connection, purpose: 'DISCOVERY', name: connection.name.trim(), description: connection.description.trim(), username: connection.username.trim(), credentialRef: connection.credentialRef.trim(), reason: connection.reason.trim() }), () => setConnection(blankConnection)); };
  const addInstance = event => { event.preventDefault(); void run(() => post(`/api/projects/${encodeURIComponent(projectId)}/database-instances`, { ...instance, name: instance.name.trim(), port: Number(instance.port), reason: instance.reason.trim() }), () => setInstance(blankInstance)); };
  const history = async (id, after = '', append = false) => { const n = epoch.current; try { const result = await api(`${path}/${encodeURIComponent(id)}/observations${after ? `?after=${encodeURIComponent(after)}` : ''}`, token); if (n === epoch.current) { setHistories(prev => ({ ...prev, [id]: append ? [...(prev[id] || []), ...(result.observations || [])] : result.observations || [] })); setHistoryCursors(prev => ({ ...prev, [id]: result.nextCursor || '' })); } } catch (e) { if (n === epoch.current) report(e); } };
  const loadTargets = async (after = '') => { const n = epoch.current; try { const result = await api(`/api/projects/${encodeURIComponent(projectId)}/target-bindings${after ? `?after=${encodeURIComponent(after)}` : ''}`, token); if (n === epoch.current) { setData(prev => ({ ...prev, targetBindings: [...(prev?.targetBindings || []), ...(result.bindings || result.targetBindings || [])] })); setTargetCursor(result.nextCursor || ''); } } catch (e) { if (n === epoch.current) report(e); } };
  const createBinding = (binding, connectionId, observationId, owner) => {
    const selected = data?.connections?.find(item => item.id === connectionId), observation = (histories[selected?.id] || []).find(item => item.id === observationId) || selected?.latestObservation;
    if (!observation || !binding || !observation.identityDigest) { setError('Choose an observation with an exact identity digest before recording a target.'); return; }
    const assignment = data?.infrastructure?.find(item => item.assignmentId === binding.assignmentId);
    void run(() => post(`/api/projects/${encodeURIComponent(projectId)}/target-bindings/${encodeURIComponent(binding.bindingId)}/observe`, { connectionId, observationId, expectedIdentityDigest: observation.identityDigest, expectedBindingRevision: String(binding.bindingRevision || binding.revision || '0'), expectedAssignmentRevision: String(assignment?.revision || binding.assignmentRevision || '0'), owner: owner || observation.identity?.owner || binding.owner || '', reason: (reasons[binding.bindingId] || '').trim() }), () => { setReasons(prev => ({ ...prev, [binding.bindingId]: '' })); setNotice('Observed target recorded. This records observation evidence and does not verify live identity.'); });
  };
  const verify = (binding, connectionId, observationId, owner) => {
    const item = data?.connections?.find(row => row.id === connectionId), observation = (histories[item?.id] || []).find(row => row.id === observationId) || item?.latestObservation;
    if (!observation) { setError('Choose an observation before verifying the target.'); return; }
    void run(() => post(`/api/projects/${encodeURIComponent(projectId)}/target-bindings/${encodeURIComponent(binding.bindingId)}/verify`, { connectionId, observationId, expectedIdentityDigest: observation.identityDigest, expectedBindingRevision: String(binding.bindingRevision || binding.revision || '0'), expectedAssignmentRevision: String(binding.assignmentRevision || '0'), owner: owner || observation.identity?.owner || binding.owner || '', reason: (reasons[binding.bindingId] || '').trim() }));
  };
  const bindings = data?.targetBindings || (detail?.project?.id === projectId ? detail.targetBindings || [] : []);
  const connections = data?.connections || [];
  const visibleConnections = connections.filter(item => {
    const infra = (data?.infrastructure || []).find(row => row.assignmentId === item.assignmentId);
    const env = item.environmentName || item.environment || infra?.environmentName || infra?.environment || '';
    const status = item.status || (item.retiredAt ? 'RETIRED' : item.enabled === false ? 'DISABLED' : 'ENABLED');
    const needle = search.trim().toLowerCase();
    return (!needle || String(item.name || '').toLowerCase().includes(needle))
      && (!engineFilter || item.engine === engineFilter) && (!environmentFilter || env === environmentFilter) && (!statusFilter || status === statusFilter);
  });
  const environments = ['DEV', 'SIT', 'UAT', 'PROD'];
  const statuses = ['ENABLED', 'DISABLED', 'RETIRED'];
  const engines = data?.engineCapabilities?.map(item => item.engine) || [...new Set(connections.map(item => item.engine).filter(Boolean))];
  const hasFilters = !!(search.trim() || engineFilter || environmentFilter || statusFilter);
  return <section className="connections-workspace" aria-label="Database connection discovery">
    <section className="panel"><div className="panel-heading"><div><h2>Database connectivity and discovery</h2><p>Credentials are references only. Test and discovery requests record evidence; they do not execute migrations or change database objects.</p></div><button type="button" className="secondary" disabled={busy} onClick={() => void load('', false, true)}>Refresh</button></div>
      {readOnly && <p className="banner warning" role="status">This workspace is read only. You can inspect retained connections and evidence.</p>}
      {error && <p role="alert" className="banner error">{error}</p>}
      {data && data.canManage === false && !readOnly && <p className="banner warning" role="status">Connection administration is unavailable for your current access. Existing evidence remains readable.</p>}
      {!data && !error && <p role="status">Loading database connections…</p>}
      {notice && <p className="banner success" role="status">{notice}</p>}
      {data && <>
        {!!data.infrastructureTruncated && <p className="banner warning" role="status">Authorized infrastructure choices are truncated. Refine access or reload before selecting an unlisted assignment.</p>}
        <details className="connection-form" open={!!data.canManage && !readOnly}><summary>Register a database instance</summary><form className="connection-grid" onSubmit={addInstance}><fieldset disabled={busy || readOnly || !data.canManage}>
          <label>Instance name<input value={instance.name} onChange={e => setInstance({ ...instance, name: e.target.value })} required/></label><label>Container name<input value={instance.containerName} onChange={e => setInstance({ ...instance, containerName: e.target.value })} required/></label>
          <label>Kind<select value={instance.kind} onChange={e => setInstance({ ...instance, kind: e.target.value })}><option>PDB</option><option>NON_CDB</option></select></label><label>Environment<select value={instance.environment} onChange={e => setInstance({ ...instance, environment: e.target.value })}>{['DEV','SIT','UAT','PROD'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>Host<input value={instance.host} onChange={e => setInstance({ ...instance, host: e.target.value })} required/></label><label>Port<input type="number" min="1" max="65535" value={instance.port} onChange={e => setInstance({ ...instance, port: e.target.value })} required/></label><label>Service<input value={instance.service} onChange={e => setInstance({ ...instance, service: e.target.value })} required/></label><label>Transport<input value={instance.transport} onChange={e => setInstance({ ...instance, transport: e.target.value })} required/></label>
          <label>Owner/schema<input value={instance.owner} onChange={e => setInstance({ ...instance, owner: e.target.value })} required/></label><label className="wide">Reason<textarea value={instance.reason} onChange={e => setInstance({ ...instance, reason: e.target.value })} required/></label></fieldset><button className="primary" type="submit" disabled={busy || readOnly || !data.canManage}>Register instance</button></form></details>
        <details className="connection-form" open={!!data.canManage && !readOnly}><summary>Register a project connection</summary><form className="connection-grid" onSubmit={addConnection}><fieldset disabled={busy || readOnly || !data.canManage}>
          <label>Assigned infrastructure<select value={connection.assignmentId} onChange={e => { const row = data.infrastructure?.find(x => x.assignmentId === e.target.value); setConnection({ ...connection, assignmentId: e.target.value, routeId: row?.routeId || '' }); }} required><option value="">Choose an authorized assignment</option>{[...new Map((data.infrastructure || []).map(row=>[row.assignmentId,row])).values()].map(row => <option key={row.assignmentId} value={row.assignmentId}>{row.owner} · {row.containerName}</option>)}</select></label><label>Route<select value={connection.routeId} onChange={e => setConnection({ ...connection, routeId: e.target.value })} required><option value="">Choose assigned route</option>{(data.infrastructure || []).filter(row => row.assignmentId === connection.assignmentId).map(row => <option key={row.routeId} value={row.routeId}>{row.host}:{row.port}/{row.service} · {row.transport}</option>)}</select></label>
          <label>Connection name<input maxLength="120" value={connection.name} onChange={e => setConnection({ ...connection, name: e.target.value })} required/></label><label>Description<input maxLength="1000" value={connection.description} onChange={e => setConnection({ ...connection, description: e.target.value })}/></label><label>Engine<select value={connection.engine} onChange={e => setConnection({ ...connection, engine: e.target.value })}>{(data.engineCapabilities || []).map(item => <option key={item.engine} value={item.engine}>{item.engine}{item.supported ? '' : ' · unsupported'}</option>)}</select></label><label>Service identifier type<select value={connection.serviceKind} onChange={e => setConnection({ ...connection, serviceKind: e.target.value })}><option value="SERVICE_NAME">Oracle Service Name</option><option value="SID">Oracle SID</option></select><small>Stored explicitly; SID may be unsupported by offline preflight.</small></label>
          {data.engineCapabilities?.find(item => item.engine === connection.engine)?.supported === false && <p className="banner warning wide">This engine is currently unsupported. The connection can be registered as a reference, but test and discovery may return unavailable evidence.</p>}
          <label>Username<input maxLength="128" pattern={CONNECTION_PATTERNS.username} value={connection.username} onChange={e => setConnection({ ...connection, username: e.target.value })} required/></label><label>Credential reference<input maxLength="512" pattern={CONNECTION_PATTERNS.credentialRef} value={connection.credentialRef} placeholder="vault://team/reference" onChange={e => setConnection({ ...connection, credentialRef: e.target.value })} required/><small>Reference only; never enter a password.</small></label><label className="wide">Reason<textarea value={connection.reason} onChange={e => setConnection({ ...connection, reason: e.target.value })} required/></label>
        </fieldset><button className="primary" type="submit" disabled={busy || readOnly || !data.canManage}>Register connection</button></form></details>
        <section className="connection-list-tools" aria-label="Filter database connections"><label>Search connections<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Connection name"/></label><label>Engine<select value={engineFilter} onChange={e => setEngineFilter(e.target.value)}><option value="">All engines</option>{engines.map(engine => <option key={engine}>{engine}</option>)}</select></label><label>Environment<select value={environmentFilter} onChange={e => setEnvironmentFilter(e.target.value)}><option value="">All environments</option>{environments.map(env => <option key={env}>{env}</option>)}</select></label><label>Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="">All statuses</option>{statuses.map(status => <option key={status}>{status}</option>)}</select></label><span>{connections.length} matches</span></section>
        {!connections.length && <p role="status">{hasFilters ? 'No connections match these filters.' : 'No registered database connections for this project.'}</p>}
        {targetCursor && <button type="button" className="secondary" disabled={busy} onClick={() => void loadTargets(targetCursor)}>Load more target bindings</button>}
        {visibleConnections.map(item => <React.Fragment key={item.id}><ConnectionCard item={item} environmentName={item.environmentName || item.environment || (data.infrastructure || []).find(row => row.assignmentId === item.assignmentId)?.environmentName || (data.infrastructure || []).find(row => row.assignmentId === item.assignmentId)?.environment || 'From assigned container'} path={path} busy={busy} readOnly={readOnly || !data.canManage} histories={histories[item.id]} setHistories={setHistories} historyCursor={historyCursors[item.id]} onHistory={() => void history(item.id)} onMoreHistory={() => void history(item.id, historyCursors[item.id], true)} onRun={run} post={post} bindings={bindings} reasons={reasons} setReasons={setReasons} selectedObservation={selectedObservation} setSelectedObservation={setSelectedObservation} bindingPick={bindingPick} setBindingPick={setBindingPick} onBind={createBinding} onVerify={verify}/><button className="secondary" type="button" aria-expanded={selectedConfig === item.id} onClick={() => setSelectedConfig(selectedConfig === item.id ? '' : item.id)}>{selectedConfig === item.id ? 'Hide connection details' : 'Configure connection'}</button>{selectedConfig === item.id && <ConnectionConfiguration token={token} api={api} basePath={`${path}/${encodeURIComponent(item.id)}`} kind="discovery" connection={item} readOnly={readOnly || !data.canManage || !!item.retiredAt} onChanged={async () => { await load('', false, true); await onChanged?.(); }}/>}</React.Fragment>)}
        {cursor && <button type="button" className="secondary" disabled={busy} onClick={() => void load(cursor, true)}>Load more connections</button>}</>}
    </section>
  </section>;
}

function ConnectionCard({ item, environmentName, path, busy, readOnly, histories, setHistories, historyCursor, onHistory, onMoreHistory, onRun, post, bindings, reasons, setReasons, selectedObservation, setSelectedObservation, bindingPick, setBindingPick, onBind, onVerify }) {
  const [reason, setReason] = useState(''), [confirmRetire, setConfirmRetire] = useState(false); const latest = item.latestObservation;
  const observe = type => onRun(() => post(`${path}/${encodeURIComponent(item.id)}/${type}`, { reason: reason.trim() }), outcome => { setReason(''); const observed = outcome?.observation; if (observed?.id) { setHistories(prev => ({ ...prev, [item.id]: [observed, ...(prev[item.id] || []).filter(row => row.id !== observed.id)] })); setSelectedObservation(prev => ({ ...prev, [item.id]: observed.id })); } });
  const retire = () => onRun(() => post(`${path}/${encodeURIComponent(item.id)}/retire`, { reason: reason.trim() }));
  const observations = histories || (latest ? [latest] : []);
  const observationId = selectedObservation[item.id] || latest?.id || '';
  const selected = observations.find(row => row.id === observationId) || latest;
  const lifecycleStatus = item.status || (item.retiredAt ? 'RETIRED' : item.enabled === false ? 'DISABLED' : 'ENABLED');
  const readinessStatus = item.readiness?.state || item.readinessState || 'UNVERIFIED';
  const lifecycleDisabled = lifecycleStatus === 'DISABLED' || lifecycleStatus === 'RETIRED';
  return <article className="connection-card"><header><div><h3>{item.name} <span className="status-pill neutral">{lifecycleStatus}</span> <span className={`status-pill ${readinessStatus === 'CONNECTED_VERIFIED' ? 'good' : 'warn'}`}>{readinessStatus}</span></h3><p>{item.engine} · {item.host}:{item.port}/{item.service} · {item.transport || 'TCP'} · Environment: {environmentName} · DISCOVERY</p></div><code>{item.id}</code></header>
    <dl className="connection-facts"><div><dt>Username</dt><dd>{item.username}</dd></div><div><dt>Credential alias</dt><dd><code>{item.credentialAlias}</code></dd></div><div><dt>Exact identity</dt><dd>{latest?.identity ? <><code>{latest.identity.dbUniqueName || 'database unavailable'} · {latest.identity.container || latest.identity.containerName || 'container unavailable'} · {latest.identity.serviceName || 'service unavailable'}</code><br/><small>Digest: <code>{latest.identityDigest || 'Unavailable'}</code></small></> : 'No identity observed'}</dd></div><div><dt>Currentness</dt><dd>{latest?.currentness || 'UNKNOWN'}</dd></div></dl>
    <div className="evidence-actions"><label>Evidence reason<textarea value={reason} onChange={e => setReason(e.target.value)} required maxLength={2000}/></label><div><button className="secondary" disabled={busy || readOnly || lifecycleDisabled || !reason.trim()} onClick={() => observe('test')}>Test connection</button><button className="secondary" disabled={busy || readOnly || lifecycleDisabled || !reason.trim()} onClick={() => observe('discover')}>Discover schemas</button><button className="secondary" disabled={busy} onClick={onHistory}>Load observation history</button>{lifecycleStatus !== 'RETIRED' && <><label className="retire-confirm"><input type="checkbox" checked={confirmRetire} onChange={e => setConfirmRetire(e.target.checked)}/> I understand retirement is permanent</label><button className="danger-button" disabled={busy || readOnly || !reason.trim() || !confirmRetire} onClick={retire}>Retire connection</button></>}</div></div>
    {latest && <Observation observation={latest}/>}
    {!!histories && <section className="observation-history"><h4>Observation history</h4>{!histories.length && <p>No observations recorded.</p>}{histories.map(row => <label className="observation-choice" key={row.id}><input type="radio" name={`observation-${item.id}`} checked={observationId === row.id} onChange={() => setSelectedObservation(prev => ({ ...prev, [item.id]: row.id }))}/><span><strong>{row.operation} · {row.status} · {row.identityState}</strong><br/><small>{row.observedAt} · {row.currentness} · {row.id}</small></span></label>)}{historyCursor && <button type="button" className="secondary" disabled={busy} onClick={onMoreHistory}>Load more observations</button>}</section>}
    {selected && <section className="target-observation"><h4>Record an observed target</h4><p>Choose a retained project binding and observation. Recording binds the observed identity with revision checks.</p><label>Observation<select value={observationId} onChange={e => setSelectedObservation(prev => ({ ...prev, [item.id]: e.target.value }))}>{observations.map(row => <option key={row.id} value={row.id}>{row.operation} · {row.status} · {row.observedAt} · {row.identityDigest || 'no identity digest'}</option>)}</select></label>
      <label>Project target binding<select value={bindingPick[item.id] || ''} onChange={e => setBindingPick(prev => ({ ...prev, [item.id]: e.target.value }))}><option value="">Choose binding</option>{bindings.map(binding => <option key={binding.bindingId} value={binding.bindingId}>{binding.owner || binding.exactOwner || 'owner'} · {binding.environmentName || binding.environmentId || 'environment'} · revision {binding.bindingRevision || binding.revision || '?'}</option>)}</select></label>
      <label>Observed schema owner<select value={bindingPick[`${item.id}:owner`] || selected?.schemas?.find(row => row.accessible === true)?.owner || ''} onChange={e => setBindingPick(prev => ({ ...prev, [`${item.id}:owner`]: e.target.value }))} required><option value="">Choose discovered schema</option>{(selected?.schemas || []).map(row => <option key={row.owner} value={row.owner}>{row.owner} · {row.accessible === true ? 'accessible' : row.accessible === false ? 'inaccessible' : 'visibility unknown'}</option>)}</select></label>
      <label>Reason<textarea required value={reasons[bindingPick[item.id]] || ''} onChange={e => setReasons(prev => ({ ...prev, [bindingPick[item.id]]: e.target.value }))}/></label><div><button className="primary" disabled={busy || readOnly || lifecycleDisabled || !bindingPick[item.id] || !reasons[bindingPick[item.id]]?.trim()} onClick={() => onBind(bindings.find(b => b.bindingId === bindingPick[item.id]), item.id, observationId, bindingPick[`${item.id}:owner`] || selected?.schemas?.find(row => row.accessible === true)?.owner)}>Record observed target</button><button className="secondary" disabled={busy || readOnly || lifecycleDisabled || !bindingPick[item.id] || !reasons[bindingPick[item.id]]?.trim()} onClick={() => onVerify(bindings.find(b => b.bindingId === bindingPick[item.id]), item.id, observationId, bindingPick[`${item.id}:owner`] || selected?.schemas?.find(row => row.accessible === true)?.owner)}>Verify target</button></div><small>Verification is governed by retained live evidence. Fixture evidence is not accepted.</small>
      </section>}
  </article>;
}

function Observation({ observation }) {
  return <section className="observation-result"><h4>Latest retained observation</h4><p><strong>{observation.operation} · {observation.status} · {observation.identityState}</strong> <span className="status-pill neutral">{observation.currentness || 'UNKNOWN'}</span></p>
    {observation.identity && <dl className="connection-facts">{Object.entries(observation.identity).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{String(value ?? 'Unavailable')}</code></dd></div>)}{observation.identityDigest && <div><dt>Identity digest</dt><dd><code>{observation.identityDigest}</code></dd></div>}</dl>}
    {observation.schemas?.length > 0 && <div><h5>Discovered schemas</h5><ul>{observation.schemas.map(schema => <li key={`${schema.owner}-${schema.accessible}`}><code>{schema.owner}</code> · {schema.accessible === true ? 'accessible' : schema.accessible === false ? 'inaccessible' : 'visibility unknown'}</li>)}</ul></div>}
    {observation.provenance && <p>Provenance: {typeof observation.provenance === 'string' ? observation.provenance : JSON.stringify(observation.provenance)}</p>}{observation.limitations?.length > 0 && <p>Limitations: {observation.limitations.join('; ')}</p>}<small>Observed {observation.observedAt || 'time unavailable'} · expires {observation.expiresAt || 'not specified'} · evidence {observation.id}</small>
  </section>;
}

function messageFor(error) {
  const code = error?.message || 'UNKNOWN';
  if (/TIMEOUT|timed.?out/i.test(code)) return 'The request timed out. Refresh the workspace before retrying.';
  if (/DENIED|FORBIDDEN|ACCESS/i.test(code)) return 'Access was denied. Confirm project access and try again.';
  if (/STALE|CONFLICT|REVISION/i.test(code)) return 'The retained evidence or target changed. Refresh connections and targets before retrying.';
  if (code === 'LIVE_VERIFICATION_UNACCEPTED') return 'Verification requires accepted live evidence. This observation does not satisfy that requirement.';
  return `The request could not be completed (${code}). Refresh the workspace to check current evidence and access.`;
}
