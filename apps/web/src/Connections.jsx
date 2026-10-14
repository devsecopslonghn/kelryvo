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
    try { const outcome = await action(); if (n === epoch.current) { setBindingPick({}); if (success) success(outcome); await onChanged?.(); if (n === epoch.current) { setBusy(false); await load('', false, true); } } }
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
    const infra = (data?.infrastructure || []).find(row => row.containerId === item.containerId && row.routeId === item.routeId);
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
        {visibleConnections.map(item => <React.Fragment key={item.id}><ConnectionCard item={item} environmentName={item.environmentName || item.environment || (data.infrastructure || []).find(row => row.containerId === item.containerId && row.routeId === item.routeId)?.environmentName || (data.infrastructure || []).find(row => row.containerId === item.containerId && row.routeId === item.routeId)?.environment || 'From assigned container'} infrastructure={data.infrastructure || []} path={path} busy={busy} readOnly={readOnly || !data.canManage} histories={histories[item.id]} setHistories={setHistories} historyCursor={historyCursors[item.id]} onHistory={() => void history(item.id)} onMoreHistory={() => void history(item.id, historyCursors[item.id], true)} onRun={run} post={post} bindings={bindings} reasons={reasons} setReasons={setReasons} selectedObservation={selectedObservation} setSelectedObservation={setSelectedObservation} bindingPick={bindingPick} setBindingPick={setBindingPick} onBind={createBinding} onVerify={verify}/><button className="secondary" type="button" aria-expanded={selectedConfig === item.id} onClick={() => setSelectedConfig(selectedConfig === item.id ? '' : item.id)}>{selectedConfig === item.id ? 'Hide connection details' : 'Configure connection'}</button>{selectedConfig === item.id && <ConnectionConfiguration token={token} api={api} basePath={`${path}/${encodeURIComponent(item.id)}`} kind="discovery" connection={item} readOnly={readOnly || !data.canManage || !!item.retiredAt} onChanged={async () => { await load('', false, true); await onChanged?.(); }}/>}</React.Fragment>)}
        {cursor && <button type="button" className="secondary" disabled={busy} onClick={() => void load(cursor, true)}>Load more connections</button>}</>}
    </section>
  </section>;
}

function ConnectionCard({ item, environmentName, infrastructure, path, busy, readOnly, histories, setHistories, historyCursor, onHistory, onMoreHistory, onRun, post, bindings, reasons, setReasons, selectedObservation, setSelectedObservation, bindingPick, setBindingPick, onBind, onVerify }) {
  const [reason, setReason] = useState(''), [confirmRetire, setConfirmRetire] = useState(false); const latest = item.latestObservation;
  const observe = type => onRun(() => post(`${path}/${encodeURIComponent(item.id)}/${type}`, { reason: reason.trim() }), outcome => { setReason(''); const observed = outcome?.observation; if (observed?.id) { setHistories(prev => ({ ...prev, [item.id]: [observed, ...(prev[item.id] || []).filter(row => row.id !== observed.id)] })); setSelectedObservation(prev => ({ ...prev, [item.id]: observed.id })); } });
  const retire = () => onRun(() => post(`${path}/${encodeURIComponent(item.id)}/retire`, { reason: reason.trim() }));
  const observations = latest ? [latest, ...(histories || []).filter(row => row.id !== latest.id)] : histories || [];
  const requestedObservationId = selectedObservation[item.id];
  const observationId = observations.some(row => row.id === requestedObservationId) ? requestedObservationId : latest?.id || '';
  const selected = observations.find(row => row.id === observationId) || latest;
  const lifecycleStatus = item.status || (item.retiredAt ? 'RETIRED' : item.enabled === false ? 'DISABLED' : 'ENABLED');
  const lifecycleDisabled = lifecycleStatus === 'DISABLED' || lifecycleStatus === 'RETIRED';
  const pickedBinding = bindings.find(binding => binding.bindingId === bindingPick[item.id]);
  const pickedOwner = bindingPick[`${item.id}:owner`] || selected?.schemas?.find(row => row.accessible === true)?.owner || '';
  const matchingInfrastructure = infrastructure.filter(row => row.containerId === item.containerId && row.routeId === item.routeId);
  const matchingAssignmentIds = new Set(matchingInfrastructure.map(row => row.assignmentId));
  const eligibleBindings = bindings.filter(binding => {
    const bindingAssignment = binding.assignmentId || binding.retainedTarget?.assignmentId;
    const bindingRoute = binding.routeId || binding.retainedTarget?.routeId;
    const owner = binding.exactOwner || binding.owner || binding.retainedTarget?.exactOwner;
    return matchingAssignmentIds.has(bindingAssignment) && bindingRoute === item.routeId && owner === pickedOwner
      && matchingInfrastructure.some(row => row.assignmentId === bindingAssignment && row.routeId === bindingRoute && row.owner === owner);
  });
  const selectedSchema = selected?.schemas?.find(row => row.owner === pickedOwner);
  const currentObservation = !!selected?.identityDigest && selected.currentness === 'CURRENT' && selected.identityState === 'OBSERVED';
  const readiness = item.readiness || {};
  const configurationStatus = readiness.configurationValid === true ? 'VALID' : readiness.configurationValid === false ? 'NEEDS ATTENTION' : 'UNKNOWN';
  const connectivityStatus = readiness.connectivityStatus || 'NOT_RUN';
  const identityStatus = readiness.identityState || latest?.identityState || 'NOT_OBSERVED';
  const canRecord = !readOnly && !lifecycleDisabled && !!pickedBinding && eligibleBindings.some(binding => binding.bindingId === pickedBinding.bindingId)
    && selectedSchema?.accessible === true && currentObservation && !!reasons[pickedBinding?.bindingId]?.trim();
  const whyCannotVerify = observationExplanation(selected);
  return <article className="connection-card"><header><div><h3>{item.name} <span className="status-pill neutral">{lifecycleStatus}</span> <span className={`status-pill ${readiness.configurationValid === true ? 'good' : 'warn'}`}>CONFIG {configurationStatus}</span> <span className={`status-pill ${['CONNECTED','OBSERVED','PARTIAL'].includes(connectivityStatus) ? 'good' : 'warn'}`}>CONNECTION {connectivityStatus}</span> <span className={`status-pill ${identityStatus === 'VERIFIED' ? 'good' : 'warn'}`}>IDENTITY {identityStatus}</span></h3><p>{item.engine} · {item.host}:{item.port}/{item.service} · {item.transport || 'TCP'} · Environment: {environmentName} · DISCOVERY</p></div><code>{item.id}</code></header>
    <p className="offline-note">Configuration validity, live connectivity, and database identity are separate checks. A successful connection test does not verify the target identity. {readiness.lastCheckedAt ? `Last checked ${readiness.lastCheckedAt}.` : 'No connection check has been recorded.'}</p>
    <dl className="connection-facts"><div><dt>Username</dt><dd>{item.username}</dd></div><div><dt>Credential alias</dt><dd><code>{item.credentialAlias}</code></dd></div><div><dt>Exact identity</dt><dd>{latest?.identity ? <><code>{latest.identity.dbUniqueName || 'database unavailable'} · {latest.identity.containerName || 'container unavailable'} · {latest.identity.serviceName || 'service unavailable'}</code><br/><small>Digest: <code>{latest.identityDigest || 'Unavailable'}</code></small></> : 'No identity observed'}</dd></div><div><dt>Identity currentness</dt><dd>{latest?.currentness || 'UNKNOWN'}</dd></div></dl>
    <div className="evidence-actions"><label>Evidence reason<textarea value={reason} onChange={e => setReason(e.target.value)} required maxLength={2000}/></label><div><button className="secondary" disabled={busy || readOnly || lifecycleDisabled || !reason.trim()} onClick={() => observe('test')}>Test connection</button><button className="secondary" disabled={busy || readOnly || lifecycleDisabled || !reason.trim()} onClick={() => observe('discover')}>Discover schemas</button><button className="secondary" disabled={busy} onClick={onHistory}>Load observation history</button>{lifecycleStatus !== 'RETIRED' && <><label className="retire-confirm"><input type="checkbox" checked={confirmRetire} onChange={e => setConfirmRetire(e.target.checked)}/> I understand retirement is permanent</label><button className="danger-button" disabled={busy || readOnly || !reason.trim() || !confirmRetire} onClick={retire}>Retire connection</button></>}</div></div>
    {latest && <Observation observation={latest} selected={selected} historical={selected?.id !== latest.id}/>}
    {!!histories && <section className="observation-history"><h4>Observation history</h4>{!observations.length && <p>No observations recorded.</p>}{observations.map(row => <label className="observation-choice" key={row.id}><input type="radio" name={`observation-${item.id}`} checked={observationId === row.id} onChange={() => setSelectedObservation(prev => ({ ...prev, [item.id]: row.id }))}/><span><strong>{row.operation} · {row.status} · {row.identityState}</strong><br/><small>{row.observedAt} · {row.currentness} · {row.id}</small></span></label>)}{historyCursor && <button type="button" className="secondary" disabled={busy} onClick={onMoreHistory}>Load more observations</button>}</section>}
    {selected && <section className="target-observation"><h4>Record an observed target</h4><p>Choose a current identity observation, the exact accessible schema owner, and a binding for this connection’s assigned container and route.</p><label>Observation<select value={observationId} onChange={e => setSelectedObservation(prev => ({ ...prev, [item.id]: e.target.value }))}>{observations.map(row => <option key={row.id} value={row.id}>{row.operation} · {row.status} · {row.observedAt} · {row.identityDigest || 'no identity digest'}{row.id === latest?.id ? ' · latest' : ' · historical'}</option>)}</select></label>
      <label>Project target binding<select value={bindingPick[item.id] || ''} onChange={e => setBindingPick(prev => ({ ...prev, [item.id]: e.target.value }))}><option value="">Choose matching binding</option>{eligibleBindings.map(binding => <option key={binding.bindingId} value={binding.bindingId}>{binding.exactOwner || binding.owner || binding.retainedTarget?.exactOwner} · {binding.environmentName || binding.environmentId || binding.env?.name || 'environment'} · revision {binding.bindingRevision || binding.revision || '?'}</option>)}</select></label>
      <label>Observed schema owner<select value={bindingPick[`${item.id}:owner`] || selected?.schemas?.find(row => row.accessible === true)?.owner || ''} onChange={e => setBindingPick(prev => ({ ...prev, [`${item.id}:owner`]: e.target.value }))} required><option value="">Choose discovered schema</option>{(selected?.schemas || []).map(row => <option key={row.owner} value={row.owner}>{row.owner} · {row.accessible === true ? 'accessible' : row.accessible === false ? 'inaccessible' : 'visibility unknown'}</option>)}</select></label>
      <label>Reason<textarea required value={reasons[bindingPick[item.id]] || ''} onChange={e => setReasons(prev => ({ ...prev, [bindingPick[item.id]]: e.target.value }))}/></label><div><button className="primary" disabled={busy || !canRecord} onClick={() => onBind(pickedBinding, item.id, observationId, pickedOwner)}>Record observed target</button><button className="secondary" disabled={busy || readOnly || lifecycleDisabled || !pickedBinding || !pickedOwner || !selected?.identityDigest || !reasons[pickedBinding?.bindingId]?.trim()} onClick={() => onVerify(pickedBinding, item.id, observationId, pickedOwner)}>Verify target</button></div>
      {!canRecord && <p className="banner warning" role="status">{!selected?.identityDigest ? whyCannotVerify : selected?.currentness !== 'CURRENT' ? `This observation is ${selected?.currentness || 'unknown'} and cannot be recorded as a current target.` : !pickedOwner ? 'Choose an exact schema owner reported by this observation.' : selectedSchema?.accessible !== true ? 'The selected owner is inaccessible or its accessibility is unknown.' : !eligibleBindings.length ? 'No target binding matches this connection assignment, route, and exact owner.' : !reasons[pickedBinding?.bindingId]?.trim() ? 'Enter a reason to record this target.' : 'This target cannot be recorded with the current access or connection state.'}</p>}
      <small>Verification requires accepted live Oracle evidence. The Verify target action remains available to report why other evidence is not accepted.</small>
      </section>}
  </article>;
}

function Observation({ observation, selected, historical }) {
  const shown = selected || observation;
  return <section className="observation-result"><h4>{historical ? 'Selected historical observation' : 'Latest retained observation'}</h4><p><strong>{shown.operation} · {shown.status} · {shown.identityState || 'IDENTITY UNKNOWN'}</strong> <span className="status-pill neutral">{shown.currentness || 'UNKNOWN'}</span></p>
    {observationExplanation(shown) && <p className="banner warning" role="status">{observationExplanation(shown)}</p>}
    {shown.identity ? <dl className="connection-facts">{Object.entries(shown.identity).map(([key, value]) => <div key={key}><dt>{key}</dt><dd><code>{String(value ?? 'Unavailable')}</code></dd></div>)}{shown.identityDigest && <div><dt>Identity digest</dt><dd><code>{shown.identityDigest}</code></dd></div>}</dl> : <p>Database identity was not verified by this observation.</p>}
    {shown.schemas?.length > 0 && <div><h5>Discovered schemas</h5><ul>{shown.schemas.map(schema => <li key={`${schema.owner}-${schema.accessible}`}><code>{schema.owner}</code> · {schema.accessible === true ? 'accessible' : schema.accessible === false ? 'inaccessible' : 'visibility unknown'}</li>)}</ul></div>}
    {shown.provenance && <p>Provenance: {typeof shown.provenance === 'string' ? shown.provenance : JSON.stringify(shown.provenance)}</p>}{shown.limitations?.length > 0 && <p>Limitations: {shown.limitations.map(limitationText).join('; ')}</p>}<small>Observed {shown.observedAt || 'time unavailable'} · expires {shown.expiresAt || 'not specified'} · evidence {shown.id}</small>
  </section>;
}

function observationExplanation(observation) {
  if (!observation) return 'No observation is available, so the database target identity cannot be verified.';
  const status = observation.status;
  const details = (observation.limitations || []).map(limitationText);
  if (status === 'TIMEOUT') return `The connection attempt timed out before identity could be verified.${details.length ? ` ${details.join('; ')}` : ''}`;
  if (status === 'UNAUTHORIZED') return `The database rejected or could not authorize the discovery request; identity cannot be verified.${details.length ? ` ${details.join('; ')}` : ''}`;
  if (status === 'UNREACHABLE') return `The configured database endpoint could not be reached; identity cannot be verified.${details.length ? ` ${details.join('; ')}` : ''}`;
  if (status === 'MISCONFIGURED') return `The connection configuration is invalid for this attempt; identity cannot be verified.${details.length ? ` ${details.join('; ')}` : ''}`;
  if (status === 'UNAVAILABLE') return `Discovery did not produce usable evidence; the reason is unknown or the runtime is unavailable.${details.length ? ` ${details.join('; ')}` : ''}`;
  if ((observation.limitations || []).includes('IDENTITY_MISMATCH') || observation.identityState === 'CONFLICT') return 'The observed database or container identity does not match the expected target identity.';
  if (!observation.identityDigest) return `The database identity is incomplete, so this target cannot be verified.${details.length ? ` ${details.join('; ')}` : ''}`;
  if (observation.provenance === 'FIXTURE' || details.includes('Fixture evidence cannot verify live identity.')) return 'This observation came from fixture evidence. It can exercise the workflow, but cannot verify a live database target.';
  if (observation.currentness !== 'CURRENT') return `This evidence is ${observation.currentness || 'unknown'} and cannot establish a current target identity.`;
  if (!observation.verificationAcceptance?.schemaOwners?.length) return 'Live target acceptance has not been recorded for the assigned schema. Ask the trusted operator to supply accepted read-only identity and schema-scope evidence before verification.';
  if (details.length) return `Identity was observed with limitations: ${details.join('; ')}`;
  return '';
}

function limitationText(code) {
  const labels = {
    INSUFFICIENT_METADATA_PRIVILEGES: 'Database metadata permissions are insufficient.', SCHEMA_VISIBILITY_LIMITED: 'Schema visibility is incomplete.',
    INVENTORY_TRUNCATED: 'The schema inventory was truncated.', IDENTITY_INCOMPLETE: 'Required database identity fields were unavailable.',
    LIVE_VERIFICATION_UNACCEPTED: 'Fixture or unaccepted evidence cannot verify a live identity.', ENGINE_UNSUPPORTED: 'This database engine is unsupported.',
    RUNTIME_UNAVAILABLE: 'The discovery runtime is unavailable.', ENDPOINT_NOT_AUTHORIZED: 'The endpoint is not authorized.',
    SECRET_UNAVAILABLE: 'The configured credential reference could not be resolved.', ROOT_CONTAINER_UNSUPPORTED: 'Root-container discovery is unsupported.',
    INVALID_ENGINE_EVIDENCE: 'The discovery adapter returned invalid evidence.'
  };
  return labels[code] || String(code).replaceAll('_', ' ').toLowerCase();
}

function messageFor(error) {
  const code = error?.message || 'UNKNOWN';
  if (/TIMEOUT|timed.?out/i.test(code)) return 'The request timed out. Refresh the workspace before retrying.';
  if (/DENIED|FORBIDDEN|ACCESS/i.test(code)) return 'Access was denied. Confirm project access and try again.';
  if (/STALE|CONFLICT|REVISION/i.test(code)) return 'The retained evidence or target changed. Refresh connections and targets before retrying.';
  if (code === 'LIVE_VERIFICATION_UNACCEPTED') return 'Verification requires accepted live evidence. This observation does not satisfy that requirement.';
  return `The request could not be completed (${code}). Refresh the workspace to check current evidence and access.`;
}
