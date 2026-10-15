import { isOracleApplicationOwner } from '../../../packages/execution/schema-scope.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { CONNECTION_PATTERNS } from './ConnectionConfiguration.jsx';

const emptyInstance = { name: '', containerName: '', kind: 'PDB', environment: 'DEV', host: '', port: '1521', service: '', transport: 'TCP', username: '', credentialRef: '', reason: '' };
const protectedSchema = owner => !isOracleApplicationOwner(owner);
const explanations = {
  DATABASE_MANAGEMENT_REQUIRED: 'Instance onboarding requires the workspace database management grant.',
  INSTANCE_MASTER_ALREADY_CONFIGURED: 'This Oracle container already has a master credential. Select the existing instance below.',
  INSTANCE_PHYSICAL_IDENTITY_CONFLICT: 'This physical Oracle database is already registered through another route, or this instance now resolves to a different database. Use the original instance and review its retained identity.',
  INSTANCE_REFERENCE_CONFLICT: 'This endpoint is already registered with a different container identity. Check the host, port, service and container kind.',
  SCHEMA_ALREADY_ASSIGNED: 'At least one selected schema is already assigned to another project. Remove it or ask the workspace owner to transfer it.',
  CONNECTION_REVISION_CONFLICT: 'The instance configuration changed. Refresh the instance list and discover schemas again.',
  DISCOVERY_STALE: 'This discovery has expired or the instance configuration changed. Discover schemas again.',
  DISCOVERY_CONFLICT: 'A newer discovery replaced this result. Discover schemas again before assigning owners.',
  SCHEMA_ACCESS_UNVERIFIED: 'One or more selected schemas were not confirmed accessible in the current discovery.',
  TARGET_REVISION_CONFLICT: 'A schema assignment or binding changed. Refresh the project and retry verification.',
  IDENTITY_MISMATCH: 'The observed database identity or exact schema owner does not match this binding.',
  LIVE_VERIFICATION_UNACCEPTED: 'The observation is not accepted live Oracle evidence. Review its status and limitations below.',
  TARGET_OPTION_INELIGIBLE: 'The target option is no longer eligible. Refresh the project and prepare a current binding.',
  IDENTITY_CONFLICT: 'The live identity differs from previously retained identity evidence. The binding remains blocked.',
  METADATA_RESTORE_HOLD: 'Metadata recovery is in progress. Onboarding changes are paused.',
  PROJECT_ARCHIVED: 'Archived projects are read only.',
  UNAUTHENTICATED: 'Your session expired. Sign in again to continue.',
  NOT_FOUND: 'The selected project or instance is no longer available. Refresh the workspace.',
  INVALID_REQUEST: 'Some fields are invalid or incomplete. Check the highlighted values and try again.',
  CONNECTION_INELIGIBLE: 'This connection is disabled or does not use a supported Oracle service name.',
  DISCOVERY_BUSY: 'Another discovery is running. Wait for it to finish and retry.',
};
const explain = error => `${explanations[error?.message] || 'Request failed. Refresh the workspace and check the current evidence.'} [${error?.message || 'UNKNOWN'}]`;

export function InstanceOnboarding({ token, projectId, detail, api, actor, accessMode, metadataRecovery, onRefresh, onMissing }) {
  const [instanceForm, setInstanceForm] = useState(emptyInstance);
  const [rawData, setRawData] = useState(null), [dataScope, setDataScope] = useState('');
  const [workspaceMasters, setWorkspaceMasters] = useState([]), [reusableId, setReusableId] = useState(''), [attachReason, setAttachReason] = useState('');
  const [bindings, setBindings] = useState([]), [connectionCursor, setConnectionCursor] = useState(''), [bindingCursor, setBindingCursor] = useState('');
  const [selectedId, setSelectedId] = useState(''), [observation, setObservation] = useState(null), [owners, setOwners] = useState([]);
  const [environmentId, setEnvironmentId] = useState(''), [reason, setReason] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const preferredConnection = useRef(null);
  const preferredBindings = useRef([]);
  const scope = `${token}:${projectId}`;
  const loaded = detail?.project?.id === projectId && !!projectId;
  const environments = loaded ? detail.environments || [] : [];
  const selected = (rawData?.connections || []).find(connection => connection.id === selectedId) || null;
  const alreadyBound = owner => bindings.some(binding => binding.routeId === selected?.routeId && binding.exactOwner === owner
    && binding.environmentId === environmentId);
  const currentObservation = observation?.operation === 'DISCOVER' ? observation
    : selected?.latestObservation?.operation === 'DISCOVER' ? selected.latestObservation : null;
  const schemas = currentObservation?.schemas || [];
  const selectedSchemas = schemas.filter(schema => owners.includes(schema.owner) && schema.accessible === true && !alreadyBound(schema.owner));
  const manageable = loaded && rawData?.canManage === true && actor?.role === 'developer' && accessMode === 'ENFORCED'
    && !detail.project.archivedAt && metadataRecovery?.state === 'ACTIVE';
  const inScope = generation => epoch.current === generation && scope === `${token}:${projectId}`;
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/database-connections`;
  const request = (url, body) => api(url, token, { method: 'POST', body: JSON.stringify(body) });

  const loadWorkspaceMasters = async generation => {
    try {
      const result = await api(`/api/projects/${encodeURIComponent(projectId)}/database-instances/master`, token);
      if (inScope(generation)) setWorkspaceMasters(result.instances || []);
    } catch {
      if (inScope(generation)) setWorkspaceMasters([]);
    }
  };

  const load = async (generation, after = '', append = false) => {
    try {
      const connections = await api(`${endpoint}${after ? `?after=${encodeURIComponent(after)}` : ''}`, token);
      if (!inScope(generation)) return;
      const rows = [...(connections.connections || [])];
      const preferred = preferredConnection.current;
      if (preferred && !rows.some(row => row.id === preferred.id)) rows.push(preferred);
      const mergedRows = append
        ? [...(rawData?.connections || []), ...rows.filter(row => !(rawData?.connections || []).some(current => current.id === row.id))]
        : rows;
      setRawData({ ...connections, connections: mergedRows });
      setDataScope(scope);
      setConnectionCursor(connections.nextCursor || '');
      if (connections.canManage === true) void loadWorkspaceMasters(generation);
      else setWorkspaceMasters([]);
      if (preferred && mergedRows.some(row => row.id === preferred.id)) preferredConnection.current = null;
      setSelectedId(previous => preferred && mergedRows.some(row => row.id === preferred.id) ? preferred.id
        : mergedRows.some(row => row.id === previous) ? previous : mergedRows.find(row => row.credentialMode === 'INSTANCE_MASTER')?.id || '');
    } catch (e) {
      if (!inScope(generation)) return;
      if (['NOT_FOUND', 'UNAUTHENTICATED'].includes(e.message)) onMissing?.();
      setError(explain(e));
    }
  };

  useEffect(() => {
    const generation = ++epoch.current;
    setRawData(null); setDataScope(''); setBindings([]); setConnectionCursor(''); setBindingCursor('');
    setWorkspaceMasters([]); setReusableId(''); setAttachReason('');
    setSelectedId(''); setObservation(null); setOwners([]); setEnvironmentId(''); setError(''); setNotice(''); setBusy(false);
    preferredConnection.current = null; preferredBindings.current = [];
    if (projectId) { void load(generation); void loadBindings(generation); }
    return () => { if (epoch.current === generation) epoch.current++; };
  }, [token, projectId]);

  const loadBindings = async (generation, after = '', append = false) => {
    try {
      const targets = await api(`/api/projects/${encodeURIComponent(projectId)}/target-bindings${after ? `?after=${encodeURIComponent(after)}` : ''}`, token);
      if (!inScope(generation)) return;
      setBindings(previous => append ? [...previous, ...(targets.bindings || []).filter(row => !previous.some(item => item.bindingId === row.bindingId))]
        : targets.bindings || []);
      setBindingCursor(targets.nextCursor || '');
    } catch (e) {
      if (inScope(generation)) setError(explain(e));
    }
  };

  const reload = async generation => {
    setConnectionCursor(''); setBindingCursor('');
    try {
      const connections = await api(endpoint, token);
      if (!inScope(generation)) return;
      const targets = await api(`/api/projects/${encodeURIComponent(projectId)}/target-bindings`, token);
      if (!inScope(generation)) return;
      setRawData(connections); setDataScope(scope);
      setConnectionCursor(connections.nextCursor || ''); setBindingCursor(targets.nextCursor || '');
      const rows = [...(connections.connections || [])];
      const preferred = preferredConnection.current;
      if (preferred && !rows.some(row => row.id === preferred.id)) rows.push(preferred);
      setRawData({ ...connections, connections: rows });
      if (connections.canManage === true) void loadWorkspaceMasters(generation);
      else setWorkspaceMasters([]);
      const allBindings = [...(targets.bindings || [])];
      for (const binding of preferredBindings.current) if (!allBindings.some(row => row.bindingId === binding.bindingId)) allBindings.push(binding);
      setBindings(allBindings);
      setSelectedId(previous => preferred && rows.some(row => row.id === preferred.id) ? preferred.id
        : rows.some(row => row.id === previous) ? previous : rows.find(row => row.credentialMode === 'INSTANCE_MASTER')?.id || '');
      if (preferred && rows.some(row => row.id === preferred.id)) preferredConnection.current = null;
      if (preferredBindings.current.every(binding => allBindings.some(row => row.bindingId === binding.bindingId))) preferredBindings.current = [];
      setObservation(null); setOwners([]);
    } catch (e) {
      if (inScope(generation)) {
        if (['NOT_FOUND', 'UNAUTHENTICATED'].includes(e.message)) onMissing?.();
        setError(explain(e));
      }
    }
  };

  const run = async (action, success) => {
    const generation = epoch.current;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await action();
      if (!inScope(generation)) return;
      if (success) success(result);
      await onRefresh?.();
      if (!inScope(generation)) return;
      await reload(generation);
    } catch (e) {
      if (!inScope(generation)) return;
      if (['NOT_FOUND', 'UNAUTHENTICATED'].includes(e.message)) onMissing?.();
      setError(explain(e));
    } finally { if (inScope(generation)) setBusy(false); }
  };

  const createMaster = event => {
    event.preventDefault();
    void run(() => request(`/api/projects/${encodeURIComponent(projectId)}/database-instances/master`, {
      ...instanceForm, port: Number(instanceForm.port), name: instanceForm.name.trim(), containerName: instanceForm.containerName.trim(),
      host: instanceForm.host.trim(), service: instanceForm.service.trim(), username: instanceForm.username.trim(),
      credentialRef: instanceForm.credentialRef.trim(), reason: instanceForm.reason.trim(),
    }), result => {
      setInstanceForm(emptyInstance); preferredConnection.current = result?.connection || null;
      setSelectedId(result?.connection?.id || '');
      setNotice('Instance connection configured. Discover schemas to test access and continue.');
    });
  };

  const attachedMasters = workspaceMasters.filter(master => !rawData?.connections?.some(connection => connection.id === master.id));
  const attachMaster = event => {
    event.preventDefault();
    if (!reusableId) return;
    void run(() => request(`/api/projects/${encodeURIComponent(projectId)}/database-instances/attach`, {
      connectionId: reusableId, reason: attachReason.trim(),
    }), result => {
      preferredConnection.current = result?.connection || null;
      setSelectedId(result?.connection?.id || reusableId);
      setReusableId(''); setAttachReason('');
      setNotice('Existing workspace master attached to this project. It does not transfer any schema assignments.');
    });
  };

  const discover = () => {
    if (!selected) return;
    void run(() => request(`${endpoint}/${encodeURIComponent(selected.id)}/discover`, { reason: reason.trim() }), result => {
      const discovered = result?.observation;
      setObservation(discovered || null); setOwners([]);
      setNotice(discovered?.identityDigest
        ? `Discovery recorded (${discovered.status || 'status unavailable'}). Schema assignments will remain provisional until each binding passes live identity verification.`
        : `Discovery recorded without a usable identity digest (${discovered?.status || 'status unavailable'}). Schemas cannot be assigned from this observation.`);
    });
  };

  const assign = () => {
    if (!selected || !currentObservation || !environmentId || !selectedSchemas.length) return;
    void run(() => request(`${endpoint}/${encodeURIComponent(selected.id)}/assign-schemas`, {
      observationId: currentObservation.id, expectedConnectionRevision: String(selected.revision),
      owners: selectedSchemas.map(schema => schema.owner), environmentId, reason: reason.trim(),
    }), result => {
      const fresh = result?.bindings || [];
      preferredBindings.current = fresh;
      setBindings(previous => [...previous.filter(binding => !fresh.some(row => row.bindingId === binding.bindingId)), ...fresh]);
      setNotice(`${fresh.length} schema assignment${fresh.length === 1 ? '' : 's'} created. They are provisional; verify each one below.`);
    });
  };

  const verify = binding => {
    if (!selected || !currentObservation?.identityDigest || !binding) return;
    void run(() => request(`/api/projects/${encodeURIComponent(projectId)}/target-bindings/${encodeURIComponent(binding.bindingId)}/verify`, {
      connectionId: selected.id, observationId: currentObservation.id, expectedIdentityDigest: currentObservation.identityDigest,
      expectedBindingRevision: String(binding.bindingRevision), expectedAssignmentRevision: String(binding.assignmentRevision),
      owner: binding.exactOwner, reason: reason.trim(),
    }), result => {
      if (result?.binding) preferredBindings.current = [result.binding];
      const accepted = result?.evidence?.state === 'VERIFIED' && result?.binding?.identityState === 'VERIFIED';
      setNotice(accepted ? `${binding.exactOwner} passed live identity verification.`
        : `${binding.exactOwner} verification returned without accepted VERIFIED evidence. The binding must remain unverified.`);
    });
  };

  const masterConnections = (dataScope === scope ? rawData?.connections || [] : []).filter(item => item.credentialMode === 'INSTANCE_MASTER');
  const relevantBindings = bindings.filter(binding => selected && binding.routeId === selected.routeId
    && (binding.exactOwner || binding.owner));
  const observationUsable = !!currentObservation?.id && !!currentObservation.identityDigest
    && currentObservation.currentness === 'CURRENT' && currentObservation.identityState === 'OBSERVED';

  if (!loaded) return <section className="panel instance-onboarding" aria-label="Oracle instance onboarding"><h2>Connect an Oracle instance</h2><p>Select a project to manage database instances and assigned schemas.</p></section>;

  return <section className="panel instance-onboarding" aria-label="Oracle instance onboarding">
    <div className="panel-heading"><div><p className="eyebrow">ORACLE INSTANCE</p><h2>Connect, discover, and assign schemas</h2><p>One master credential reference serves discovery and authorized schema onboarding. Discovery checks connectivity; passwords are never entered or returned here.</p></div>
      <button type="button" className="secondary" disabled={busy} onClick={() => void reload(epoch.current)}>Refresh</button></div>
    {metadataRecovery?.state && metadataRecovery.state !== 'ACTIVE' && <p className="banner warning" role="status">Metadata recovery is {metadataRecovery.state}. Instance changes are disabled.</p>}
    {dataScope === scope && rawData?.canManage === false && <p className="banner warning" role="status">Instance onboarding is unavailable for your current access. Existing connection evidence remains readable.</p>}
    {error && <p className="banner error" role="alert">{error}</p>}
    {notice && <p className="banner success" role="status">{notice}</p>}
    {!rawData && !error && <p role="status">Loading Oracle instances…</p>}
    {manageable && <details className="connection-form" open={!masterConnections.length}>
      <summary>Register an Oracle instance with one master credential</summary>
      <form className="connection-grid" onSubmit={createMaster}><fieldset disabled={busy}>
        <label>Instance name<input required maxLength="120" value={instanceForm.name} onChange={e => setInstanceForm({ ...instanceForm, name: e.target.value })}/></label>
        <label>Container name<input required maxLength="128" value={instanceForm.containerName} onChange={e => setInstanceForm({ ...instanceForm, containerName: e.target.value })}/></label>
        <label>Container kind<select value={instanceForm.kind} onChange={e => setInstanceForm({ ...instanceForm, kind: e.target.value })}><option value="PDB">Pluggable database</option><option value="NON_CDB">Non-CDB</option></select></label>
        <label>Instance environment<select value={instanceForm.environment} onChange={e => setInstanceForm({ ...instanceForm, environment: e.target.value })}>{['DEV', 'SIT', 'UAT', 'PROD'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Host<input required maxLength="253" pattern={CONNECTION_PATTERNS.host} value={instanceForm.host} onChange={e => setInstanceForm({ ...instanceForm, host: e.target.value })}/></label>
        <label>Port<input required type="number" min="1" max="65535" value={instanceForm.port} onChange={e => setInstanceForm({ ...instanceForm, port: e.target.value })}/></label>
        <label>Service name<input required maxLength="128" pattern={CONNECTION_PATTERNS.service} value={instanceForm.service} onChange={e => setInstanceForm({ ...instanceForm, service: e.target.value })}/></label>
        <label>Transport<select value={instanceForm.transport} onChange={e => setInstanceForm({ ...instanceForm, transport: e.target.value })}><option value="TCP">TCP</option><option value="TCPS">TCPS</option></select></label>
        <label>Master username<input required maxLength="128" pattern={CONNECTION_PATTERNS.username} value={instanceForm.username} onChange={e => setInstanceForm({ ...instanceForm, username: e.target.value })}/></label>
        <label>Master credential reference<input required maxLength="512" pattern={CONNECTION_PATTERNS.credentialRef} placeholder="vault://team/oracle-master" value={instanceForm.credentialRef} onChange={e => setInstanceForm({ ...instanceForm, credentialRef: e.target.value })}/><small>Reference only. Never enter a password.</small></label>
        <label className="wide">Reason<textarea required maxLength="500" value={instanceForm.reason} onChange={e => setInstanceForm({ ...instanceForm, reason: e.target.value })}/></label>
      </fieldset><button type="submit" className="primary" disabled={busy || !manageable}>Register instance</button></form>
    </details>}

    {manageable && attachedMasters.length > 0 && <details className="connection-form">
      <summary>Use an existing workspace master credential</summary>
      <p>Attach a registered Oracle instance to this project. Its credential reference stays private, and schema assignments remain project specific.</p>
      <form className="connection-grid" onSubmit={attachMaster}><fieldset disabled={busy}>
        <label>Workspace Oracle instance<select required value={reusableId} onChange={event => setReusableId(event.target.value)}>
          <option value="">Choose an existing instance</option>{attachedMasters.map(master => <option key={master.id} value={master.id}>{master.name} · {master.host}:{master.port}/{master.service} · {master.username}</option>)}
        </select></label>
        <label className="wide">Reason<textarea required maxLength="500" value={attachReason} onChange={event => setAttachReason(event.target.value)}/></label>
      </fieldset><button type="submit" className="primary" disabled={busy || !manageable || !reusableId || !attachReason.trim()}>Attach instance</button></form>
    </details>}

    {masterConnections.length > 0 && <>
      <section className="connection-grid" aria-label="Discover and assign instance schemas">
        <label>Oracle instance<select value={selectedId} onChange={e => { setSelectedId(e.target.value); setObservation(null); setOwners([]); }} disabled={busy}>
          <option value="">Choose an instance</option>{masterConnections.map(item => <option key={item.id} value={item.id}>{item.name} · {item.host}:{item.port}/{item.service}</option>)}
        </select></label>
        <label>Project environment<select value={environmentId} onChange={e => setEnvironmentId(e.target.value)} disabled={busy}><option value="">Choose project environment</option>{environments.map(env => <option key={env.id} value={env.id}>{env.name}</option>)}</select></label>
      </section>
      {selected && <article className="schema-reference-card" data-instance-id={selected.id}>
        <h3>{selected.name} <span className="status-pill neutral">INSTANCE MASTER</span></h3>
        <dl><div><dt>Endpoint</dt><dd>{selected.host}:{selected.port}/{selected.service} · {selected.transport}</dd></div>
          <div><dt>Username</dt><dd>{selected.username}</dd></div><div><dt>Credential</dt><dd>{selected.credentialConfigured ? 'Master reference configured · value hidden' : 'Reference status unavailable'}</dd></div>
          <div><dt>Credential mode</dt><dd>{selected.credentialMode}</dd></div></dl>
        <label>Reason for discovery or assignment<textarea required maxLength="500" value={reason} onChange={e => setReason(e.target.value)} disabled={busy}/></label>
        <button type="button" className="secondary" disabled={busy || !manageable || !reason.trim()} onClick={discover}>Discover schemas</button>
        {currentObservation && <section className="target-observation" aria-label="Discovered schemas">
          <h3>Discovery · {currentObservation.status || 'UNKNOWN'} · {currentObservation.currentness || 'UNKNOWN'}</h3>
          <p>Identity: {currentObservation.identityState || 'UNKNOWN'} · Provenance: {currentObservation.provenance || 'unavailable'}
            {currentObservation.identityDigest ? <> · Digest <code>{currentObservation.identityDigest}</code></> : null}</p>
          {!currentObservation.identityDigest && <p className="banner warning" role="status">No usable database identity digest was retained. Assignments are unavailable.</p>}
          {!!currentObservation.limitations?.length && <p className="banner warning" role="status">Discovery limitations: {currentObservation.limitations.join(', ')}</p>}
          <ul className="instance-schema-list">{schemas.map(schema => <li key={schema.owner}>
            <label><input type="checkbox" checked={owners.includes(schema.owner)} disabled={busy || !manageable || !observationUsable || schema.accessible !== true || protectedSchema(schema.owner) || alreadyBound(schema.owner)}
              onChange={e => setOwners(previous => e.target.checked ? [...previous, schema.owner] : previous.filter(owner => owner !== schema.owner))}/>
              <span><strong>{schema.owner}</strong> · {schema.accessible === true ? 'accessible' : schema.accessible === false ? 'inaccessible' : 'visibility unknown'}{protectedSchema(schema.owner) ? ' · protected system schema' : ''}{alreadyBound(schema.owner) ? ' · already bound in this environment' : ''}</span>
            </label></li>)}</ul>
          <p>Schema assignment creates a provisional target binding. Each binding needs a separate accepted live identity verification before it can be used for governed migration.</p>
          <button type="button" className="primary" disabled={busy || !manageable || !observationUsable || !environmentId || !selectedSchemas.length || !reason.trim()}
            onClick={assign}>Assign {selectedSchemas.length || ''} selected schema{selectedSchemas.length === 1 ? '' : 's'}</button>
        </section>}
      </article>}
      {relevantBindings.length > 0 && <section className="instance-bindings" aria-label="Assigned schema bindings">
        <h3>Verify assigned schemas</h3>
        <p>Verification uses the current discovery observation. A successful schema assignment alone does not confirm live target identity.</p>
        {relevantBindings.map(binding => <article className="schema-reference-card" key={binding.bindingId} data-binding-id={binding.bindingId}>
          <h4>{binding.exactOwner} <span className={`status-pill ${binding.identityState === 'VERIFIED' ? 'good' : 'warn'}`}>{binding.identityState || 'PROVISIONAL'}</span></h4>
          <p>Environment: {binding.environmentName || environments.find(env => env.id === binding.environmentId)?.name || 'Unknown'} · Binding revision {binding.bindingRevision} · Assignment revision {binding.assignmentRevision}</p>
          {binding.identityState === 'VERIFIED' && <p role="status">Live identity verification is retained for this binding.</p>}
          {binding.identityState !== 'VERIFIED' && <button type="button" className="secondary" disabled={busy || !manageable || !selected || !currentObservation?.identityDigest || !reason.trim()}
            onClick={() => verify(binding)}>Verify {binding.exactOwner}</button>}
        </article>)}
      </section>}
      {connectionCursor && <button type="button" className="secondary" disabled={busy} onClick={() => void load(epoch.current, connectionCursor, true)}>Load more instances</button>}
      {bindingCursor && <button type="button" className="secondary" disabled={busy} onClick={() => void loadBindings(epoch.current, bindingCursor, true)}>Load more schema bindings</button>}
    </>}
    {rawData?.connections?.some(item => item.credentialMode !== 'INSTANCE_MASTER') && <p className="offline-note">Legacy separate-credential connections remain available under Advanced and legacy connection tools.</p>}
  </section>;
}
