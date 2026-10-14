import React, { useEffect, useMemo, useRef, useState } from 'react';

const empty = { name: '', description: '', environmentId: '', host: '', port: '', service: '', serviceKind: 'SERVICE_NAME', username: '', credentialRef: '', reason: '' };
export const CONNECTION_PATTERNS = Object.freeze({
  host: '(?:[A-Za-z0-9](?:[A-Za-z0-9.\\-]*[A-Za-z0-9])?|\\[[0-9A-Fa-f:]+\\])',
  service: '[A-Za-z0-9_$#.\\-]{1,128}',
  username: '[A-Za-z][A-Za-z0-9_$#]{0,127}',
  credentialRef: '(?:vault|secret)://[A-Za-z0-9._\\/\\-]{1,500}',
});

/** Shared revisioned configuration and readiness panel for deployment profiles and discovery routes. */
export function ConnectionConfiguration({ token, api, basePath, kind = 'profile', connection, onChanged, readOnly = false }) {
  const [detailState, setDetailState] = useState(null), [form, setForm] = useState(empty), [editing, setEditing] = useState(false);
  const [reason, setReason] = useState(''), [confirmRetire, setConfirmRetire] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [accessDenied, setAccessDenied] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const requestId = useRef(0);
  const scope = useMemo(() => ({}), [basePath, token]);
  const detail = detailState?.scope === scope ? detailState.value : null;
  const load = async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      setError(''); const result = await api(basePath, token); if (id !== requestId.current) return; setDetailState({ scope, value: result }); setAccessDenied(false);
      const c = result.connection || connection;
      setForm({ ...empty, name: c?.name || '', description: c?.description || '', environmentId: c?.environmentId || '', host: c?.host || '', port: String(c?.port || ''), service: c?.service || '', serviceKind: c?.serviceKind || 'SERVICE_NAME', username: c?.username || '', credentialRef: '' });
    } catch (e) { if (id === requestId.current) { setDetailState(null); setAccessDenied(['NOT_FOUND','UNAUTHENTICATED','FORBIDDEN','DATABASE_MANAGEMENT_REQUIRED'].includes(e?.message)); setError(messageFor(e)); } }
    finally { if (id === requestId.current) setLoading(false); }
  };
  useEffect(() => { requestId.current++; setDetailState(null); setAccessDenied(false); setLoading(true); setError(''); setNotice(''); setEditing(false); setReason(''); void load(); return () => { requestId.current++; }; }, [basePath, token]);
  const currentDetail = detail?.connection?.id === connection?.id ? detail : null;
  const c = currentDetail?.connection || { name: 'Connection details', purpose: kind === 'profile' ? 'DEPLOY' : 'DISCOVERY' };
  const readiness = currentDetail?.readiness || c.readiness || { state: c.readinessState || 'UNVERIFIED', checks: [], limitations: ['Readiness evidence is unavailable.'] };
  const post = async (suffix, body) => api(`${basePath}/${suffix}`, token, { method: 'POST', body: JSON.stringify(body) });
  const mutate = async (action, success, onSuccess) => {
    setBusy(true); setError(''); setNotice('');
    const id = requestId.current;
    try { const result = await action(); if (id !== requestId.current) return; if (result?.connection) setDetailState(previous => previous?.scope === scope ? { scope, value: { ...previous.value, connection: result.connection } } : previous); setNotice(success); onSuccess?.(); setBusy(false); await onChanged?.(); if (id === requestId.current) await load(); }
    catch (e) { if (id === requestId.current) setError(messageFor(e)); }
    finally { if (id === requestId.current) setBusy(false); }
  };
  const save = event => {
    event.preventDefault();
    void mutate(async () => {
      try { return await post('configuration', { expectedRevision: String(c.revision || '0'), name: form.name.trim(), description: form.description.trim(), ...(kind === 'profile' ? { environmentId: form.environmentId } : {}), host: form.host.trim(), port: Number(form.port), service: form.service.trim(), serviceKind: form.serviceKind, username: form.username.trim(), credentialRef: form.credentialRef.trim() || null, reason: form.reason.trim() }); }
      finally { setForm(previous => ({ ...previous, credentialRef: '' })); }
    }, 'Configuration revision saved. Existing plans retain their original target facts.', () => { setEditing(false); setForm(previous => ({ ...previous, reason: '' })); });
  };
  const lifecycle = action => void mutate(() => post('lifecycle', { expectedRevision: String(c.revision || '0'), action, reason: reason.trim() }), `${action === 'RETIRE' ? 'Connection retired.' : `Connection ${action.toLowerCase()}d.`} Historical evidence remains readable.`);
  const preflight = () => void mutate(() => post('preflight', { expectedRevision: String(c.revision || '0'), reason: reason.trim() }), 'Offline readiness preflight recorded. This does not verify a live database connection.');
  const startEdit = () => { setForm({ ...empty, name: c.name || '', description: c.description || '', environmentId: c.environmentId || '', host: c.host || '', port: String(c.port || ''), service: c.service || '', serviceKind: c.serviceKind || 'SERVICE_NAME', username: c.username || '', credentialRef: '' }); setEditing(true); };
  const envName = c.environment || relatedName(currentDetail?.related?.environments, c.environmentId, '—');
  if (accessDenied) return <section className="connection-config" aria-label="Connection details unavailable"><p className="banner warning" role="alert">Connection details are unavailable for your current access.</p></section>;
  if (!currentDetail) return <section className="connection-config" aria-label="Connection details" aria-busy={loading}><p className={error ? 'banner error' : ''} role={error ? 'alert' : 'status'}>{error || 'Loading connection details…'}</p></section>;
  return <section className="connection-config" aria-label={`${c.name || 'Connection'} configuration`}>
    {error && <p className="banner error" role="alert">{error}</p>}{notice && <p className="banner success" role="status">{notice}</p>}
    <div className="connection-config-heading"><div><h3>{c.name || 'Connection details'}</h3><p>{kind === 'profile' ? 'Deployment profile' : 'Discovery connection'} · revision {c.revision || '—'} · {c.purpose || (kind === 'profile' ? 'DEPLOY' : 'DISCOVERY')}</p></div><div><span className="status-pill neutral">{c.status || (c.enabled === false ? 'DISABLED' : c.retiredAt ? 'RETIRED' : 'ENABLED')}</span> <span className={`status-pill ${readiness.state === 'FAILED' ? 'bad' : readiness.state === 'CONNECTED_VERIFIED' ? 'good' : 'warn'}`}>{readiness.state}</span> <button type="button" className="text-button" disabled={busy} onClick={() => void load()}>Refresh details</button></div></div>
    <div className="connection-config-columns"><section><h4>Configuration</h4>{editing ? <form className="connection-config-form" onSubmit={save}>
      <label>Name<input required maxLength={kind === 'profile' ? 200 : 120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
      <label>Description<input maxLength="1000" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}/></label>
      {kind === 'profile' && <label>Environment<select required value={form.environmentId} onChange={e => setForm({ ...form, environmentId: e.target.value })}><option value="">Choose environment</option>{(currentDetail?.related?.environments || []).map(env => <option key={env.id} value={env.id}>{env.name}</option>)}</select></label>}
      <label>Host<input required maxLength="253" pattern={CONNECTION_PATTERNS.host} value={form.host} onChange={e => setForm({ ...form, host: e.target.value })}/></label>
      <label>Port<input required type="number" min="1" max="65535" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })}/></label>
      <label>Service identifier<input required maxLength="128" pattern={CONNECTION_PATTERNS.service} value={form.service} onChange={e => setForm({ ...form, service: e.target.value })}/></label>
      <label>Identifier type<select value={form.serviceKind} onChange={e => setForm({ ...form, serviceKind: e.target.value })}><option value="SERVICE_NAME">Oracle Service Name</option><option value="SID">Oracle SID</option></select></label>
      <label>Username<input required maxLength="128" pattern={CONNECTION_PATTERNS.username} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}/></label>
      <label>Credential reference<input maxLength="512" pattern={CONNECTION_PATTERNS.credentialRef} placeholder="Leave blank to keep current reference" value={form.credentialRef} onChange={e => setForm({ ...form, credentialRef: e.target.value })}/><small>Reference only. Passwords cannot be entered here. Blank keeps the existing reference.</small></label>
      <label className="config-wide">Reason<textarea required maxLength="2000" value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}/></label>
      <div className="config-wide"><button className="primary" disabled={busy}>Save new revision</button><button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
    </form> : <><dl className="connection-facts"><div><dt>Endpoint</dt><dd><code>{c.host}:{c.port}/{c.service}</code> · {c.serviceKind || 'SERVICE_NAME'}</dd></div><div><dt>Username</dt><dd>{c.username || '—'}</dd></div><div><dt>Environment</dt><dd>{envName}{kind === 'discovery' ? ' · inherited from container' : ''}</dd></div><div><dt>Description</dt><dd>{c.description || '—'}</dd></div><div><dt>Credential</dt><dd>{c.credentialConfigured ? 'Reference configured' : 'Reference required'} · value hidden</dd></div><div><dt>Lifecycle</dt><dd>{c.status || (c.enabled === false ? 'DISABLED' : 'ENABLED')}</dd></div></dl>
      {!readOnly && currentDetail?.canManage === true && <button type="button" className="secondary" disabled={busy || c.status === 'RETIRED' || !!c.retiredAt} onClick={startEdit}>Edit configuration</button>}</>}</section>
      <section><h4>Readiness</h4><p>Preflight checks configuration only; no database connection is attempted. {readiness.state === 'CONNECTED_VERIFIED' ? 'Live verification evidence was returned by the service.' : 'This status does not establish live database access.'}</p>{(c.serviceKind === 'SID' || form.serviceKind === 'SID') && <p className="banner warning" role="status">Oracle SID is stored as a distinct target type. Offline preflight may mark SID topology FAILED or unsupported; a configured SID is not a verified connection.</p>}<ul className="readiness-checks">{(readiness.checks || []).map((check, i) => <li key={`${check.code}-${i}`}><span className={check.passed ? 'check-pass' : 'check-fail'} aria-label={check.passed ? 'passed' : 'not passed'}>{check.passed ? '✓' : '•'}</span> {check.code.replaceAll('_', ' ')} — {check.passed ? 'passed' : 'needs attention'}</li>)}</ul>{readiness.limitations?.length > 0 && <ul className="config-limitations">{readiness.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul>}
        <label>Reason<textarea required maxLength="2000" value={reason} disabled={busy} onChange={e => setReason(e.target.value)}/></label><div className="config-actions"><button className="secondary" disabled={busy || readOnly || currentDetail?.canManage !== true || !reason.trim() || c.status === 'RETIRED'} onClick={preflight}>Run offline preflight</button>{!readOnly && currentDetail?.canManage === true && c.status !== 'RETIRED' && <><button className="secondary" disabled={busy || !reason.trim()} onClick={() => lifecycle(c.enabled === false ? 'ENABLE' : 'DISABLE')}>{c.enabled === false ? 'Enable' : 'Disable'}</button><label className="retire-confirm"><input type="checkbox" checked={confirmRetire} onChange={e => setConfirmRetire(e.target.checked)}/> I understand retirement is permanent</label><button className="danger-button" disabled={busy || !reason.trim() || !confirmRetire} onClick={() => lifecycle('RETIRE')}>Retire</button></>}</div></section></div>
    <section className="config-related"><h4>Related records</h4><p><strong>Projects:</strong> {(currentDetail?.related?.projects || []).map(x => x.name).join(', ') || 'None listed'}</p><p><strong>Environments:</strong> {(currentDetail?.related?.environments || []).map(x => x.name).join(', ') || 'None listed'}</p><p><strong>Schemas:</strong> {(currentDetail?.related?.schemas || []).map(x => `${x.owner}${x.assignmentId ? ` · ${x.assignmentId}` : ''}`).join(', ') || 'None listed'}</p></section>
    <details className="config-revisions"><summary>Revision history</summary>{!currentDetail?.revisions?.length ? <p>No earlier configuration revisions returned.</p> : <ol>{currentDetail.revisions.map((revision, i) => <li key={revision.revision || i}><strong>Revision {revision.revision}</strong> · {revision.name} · {revision.host}:{revision.port}/{revision.service} · {revision.createdAt || 'date unavailable'}<p>{revision.description || ''}</p></li>)}</ol>}</details>
  </section>;
}

function relatedName(items, id, fallback) { return items?.find(item => item.id === id)?.name || fallback; }
function messageFor(e) { const code = e?.message || 'UNKNOWN'; if (/STALE|CONFLICT|REVISION/i.test(code)) return 'This connection changed since you opened it. Reload the details before retrying.'; if (/FORBIDDEN|DENIED|ACCESS/i.test(code)) return 'You do not have permission to manage this connection.'; return `Connection details could not be updated (${code}). Refresh and check access.`; }
