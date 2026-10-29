import React, { useEffect, useState } from 'react';

const blank = { name: '', kind: 'OIDC', routeId: '', issuer: '', clientId: '', clientSecretRef: '', baseDN: '', loginAttribute: 'uid', bindDN: '', bindSecretRef: '', enabled: false, reason: '' };
const failure = error => {
  const code = error?.message;
  if (/REVISION|CONFLICT|STALE/i.test(code || '')) return 'Provider settings changed. Refresh before editing again.';
  if (/FORBIDDEN|UNAUTHORIZED|IDENTITY_ADMIN_REQUIRED/i.test(code || '')) return 'Identity provider details are unavailable for your current access.';
  return 'Identity provider request failed. Refresh and check the configuration.';
};

export default function IdentityProviders({ token, api }) {
  const [canManage, setCanManage] = useState(null), [data, setData] = useState(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [form, setForm] = useState(blank), [editing, setEditing] = useState(null), [creating, setCreating] = useState(false), [selected, setSelected] = useState(null);
  const [mappingReload, setMappingReload] = useState(0);
  const [mappings, setMappings] = useState([]), [mappingForm, setMappingForm] = useState({ subject: '', actorId: '', reason: '' });
  const [lookup, setLookup] = useState({ username: '', subject: '', displayName: '' });
  const load = async () => {
    setBusy(true); setError('');
    try {
      const access = await api('/api/identity/access', token); setCanManage(access.canManage === true);
      if (access.canManage !== true) { setData(null); return; }
      const result = await api('/api/identity/providers', token); setData(result);
      if (selected && !result.providers?.some(item => item.id === selected)) setSelected(null);
    } catch (e) { setCanManage(null); setData(null); setError(failure(e)); }
    finally { setBusy(false); }
  };
  useEffect(() => { setCanManage(null); setData(null); setSelected(null); setError(''); void load(); }, [token]);
  useEffect(() => {
    if (!selected || !canManage) { setMappings([]); return; }
    let current = true;
    api(`/api/identity/providers/${encodeURIComponent(selected)}/mappings`, token)
      .then(result => { if (current) setMappings(Array.isArray(result.mappings) ? result.mappings : []); })
      .catch(e => { if (current) { setMappings([]); setError(failure(e)); } });
    return () => { current = false; };
  }, [selected, token, canManage, mappingReload]);

  const saveProvider = async event => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const config = form.kind === 'OIDC'
      ? { routeId: form.routeId, issuer: form.issuer.trim(), clientId: form.clientId.trim(), clientSecretRef: form.clientSecretRef }
      : { routeId: form.routeId, baseDN: form.baseDN.trim(), loginAttribute: form.loginAttribute, subjectAttribute: 'entryUUID', bindDN: form.bindDN.trim(), bindSecretRef: form.bindSecretRef };
    const body = { name: form.name.trim(), kind: form.kind, enabled: form.enabled, config, reason: form.reason.trim() };
    try {
      let savedId;
      if (editing) await api(`/api/identity/providers/${encodeURIComponent(editing.id)}`, token, { method: 'PATCH', body: JSON.stringify({ expectedRevision: String(editing.revision), name: body.name, enabled: body.enabled, config, reason: body.reason }) });
      else { const result = await api('/api/identity/providers', token, { method: 'POST', body: JSON.stringify(body) }); savedId = result.provider?.id; }
      setForm(blank); setEditing(null); setCreating(false); if (savedId) setSelected(savedId); setNotice('Provider configuration saved.'); await load();
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  };
  const edit = provider => {
    const route = provider.config || {};
    setSelected(provider.id); setMappings([]);
    setMappingReload(value => value + 1);
    setCreating(false); setEditing(provider); setForm({ ...blank, name: provider.name, kind: provider.kind, enabled: provider.enabled,
      routeId: route.routeId || '', issuer: route.issuer || '', clientId: route.clientId || '', clientSecretRef: route.clientSecretRef || '',
      baseDN: route.baseDN || '', loginAttribute: route.loginAttribute || 'uid', bindDN: route.bindDN || '', bindSecretRef: route.bindSecretRef || '' });
  };
  const addProvider = () => { setEditing(null); setCreating(true); setForm(blank); setError(''); setNotice(''); };
  const cancelProviderEdit = () => { setEditing(null); setCreating(false); setForm(blank); };
  const runTest = async provider => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await api(`/api/identity/providers/${encodeURIComponent(provider.id)}/test`, token,
      { method: 'POST', body: JSON.stringify({ expectedRevision: String(provider.revision) }) });
      setNotice(result.status === 'PASS' ? 'Provider connection test passed.' : `Provider test failed (${result.code || 'UNKNOWN'}).`);
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  };
  const doLookup = async provider => {
    setBusy(true); setError('');
    try { const result = await api(`/api/identity/providers/${encodeURIComponent(provider.id)}/lookup`, token,
      { method: 'POST', body: JSON.stringify({ username: lookup.username.trim(), expectedRevision: String(provider.revision) }) });
      setLookup(previous => ({ ...previous, subject: result.subject, displayName: result.displayName || '' }));
      setMappingForm(previous => ({ ...previous, subject: result.subject }));
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  };
  const addMapping = async event => {
    event.preventDefault(); if (!selected) return;
    const provider = data?.providers?.find(item => item.id === selected); if (!provider) return;
    setBusy(true); setError(''); setNotice('');
    try { await api(`/api/identity/providers/${encodeURIComponent(selected)}/mappings`, token, { method: 'POST',
      body: JSON.stringify({ expectedProviderRevision: String(provider.revision), subject: mappingForm.subject.trim(), actorId: mappingForm.actorId, reason: mappingForm.reason.trim() }) });
      setMappingForm({ subject: '', actorId: '', reason: '' }); setLookup({ username: '', subject: '', displayName: '' });
      setNotice('Existing actor mapping added. No role or project access was changed.'); await load();
      const result = await api(`/api/identity/providers/${encodeURIComponent(selected)}/mappings`, token); setMappings(result.mappings || []);
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  };
  const revokeMapping = async mapping => {
    const reason = window.prompt('Reason for revoking this external identity mapping'); if (!reason?.trim()) return;
    setBusy(true); setError('');
    try { await api(`/api/identity/providers/${encodeURIComponent(selected)}/mappings/${encodeURIComponent(mapping.id)}/revoke`, token,
      { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      const result = await api(`/api/identity/providers/${encodeURIComponent(selected)}/mappings`, token); setMappings(result.mappings || []); setNotice('Mapping revoked.');
    } catch (e) { setError(failure(e)); }
    finally { setBusy(false); }
  };
  const routes = data?.routes || [], actors = data?.actors || [];
  const eligibleRoutes = routes.filter(route => route.kind === form.kind);
  const chosenRoute = eligibleRoutes.find(route => route.id === form.routeId);
  if (canManage === false) return <section aria-label="Identity providers"><div className="page-heading"><div><p className="eyebrow">IDENTITY &amp; ACCESS</p><h1>Identity providers</h1></div></div>
    <p className="banner warning" role="status">Identity provider administration is available only to actors granted the identity-admin capability by the trusted operator.</p></section>;
  if (canManage === null || !data) return <section aria-label="Identity providers" aria-busy="true"><p role={error ? 'alert' : 'status'}>{error || 'Loading identity provider settings…'}</p><button className="secondary" disabled={busy} onClick={() => void load()}>Refresh</button></section>;
  return <section aria-label="Identity providers">
    <div className="page-heading"><div><p className="eyebrow">IDENTITY &amp; ACCESS</p><h1>Identity providers</h1><p className="muted">Optional organization sign-in. Local username and password remain available.</p></div>
      <div className="identity-provider-actions"><button className="primary" disabled={busy || creating || !!editing} onClick={addProvider}>Add identity provider</button><button className="secondary" disabled={busy} onClick={() => void load()}>Refresh providers</button></div></div>
    {error && <p className="banner error" role="alert">{error}</p>}{notice && <p className="banner success" role="status">{notice}</p>}
    <p className="identity-safety-note">External sign-in links a provider subject to an existing actor. It never creates accounts, adds roles, or grants project access.</p>
    <section className="panel"><div className="panel-heading"><div><h2>Configured providers</h2><p>{data.providers?.length ? `${data.providers.length} configured · local sign-in remains available` : 'No optional sign-in providers are set up yet.'}</p></div></div>
      {!data.providers?.length && <p>To add LDAP or OIDC sign-in, configure an operator-managed route, add an existing-actor mapping, then enable the provider.</p>}
      <div className="identity-provider-list">{(data.providers || []).map(provider => <article className="schema-reference-card identity-provider-card" key={provider.id}>
        <h3>{provider.name} <span className="status-pill neutral">{provider.kind}</span> <span className={`status-pill ${provider.enabled ? 'good' : 'warn'}`}>{provider.enabled ? 'ENABLED' : 'DISABLED'}</span></h3>
        <p>Revision {provider.revision} · {routeSummary(routes.find(route => route.id === provider.config?.routeId))}</p>
        <div className="config-actions"><button className="secondary" disabled={busy} aria-expanded={selected === provider.id} onClick={() => { setSelected(selected === provider.id ? null : provider.id); setMappingForm({ subject: '', actorId: '', reason: '' }); }}>Mappings</button>
          <button className="secondary" disabled={busy || !!editing} aria-expanded={editing?.id === provider.id} onClick={() => edit(provider)}>Configure</button>
          <button className="secondary" disabled={busy} onClick={() => void runTest(provider)}>Test configuration</button></div>
      </article>)}</div>
    </section>
    {selected && <section className="panel identity-mapping-panel"><div className="panel-heading"><div><h2>External identity mappings</h2><p>Each subject maps to an existing actor. Roles and grants remain operator-managed.</p></div><button className="text-button" onClick={() => setSelected(null)}>Close mappings</button></div>
      {mappings.map(mapping => <article className="schema-reference-card" key={mapping.id}><h3>{mapping.actorName} <span className="status-pill neutral">{mapping.role}</span></h3>
        <p>Subject <code>{mapping.subject}</code> · Actor <code>{mapping.actorId}</code> {mapping.revokedAt ? '· REVOKED' : ''}</p>
        {!mapping.revokedAt && <button className="secondary" disabled={busy} onClick={() => void revokeMapping(mapping)}>Revoke mapping</button>}
      </article>)}
      {data.providers.find(item => item.id === selected)?.kind === 'LDAP' && <div className="panel"><h3>Find LDAP subject</h3>
        <label>Directory username<input maxLength={256} value={lookup.username} onChange={e => setLookup({ ...lookup, username: e.target.value })}/></label>
        <button className="secondary" disabled={busy || !lookup.username.trim()} onClick={() => void doLookup(data.providers.find(item => item.id === selected))}>Look up subject</button>
        {lookup.displayName && <p>Directory entry: {lookup.displayName}</p>}</div>}
      <form className="connection-config-form" onSubmit={addMapping}><h3>Add mapping to existing actor</h3>
        <label>External subject<input required maxLength={2048} value={mappingForm.subject} onChange={e => setMappingForm({ ...mappingForm, subject: e.target.value })}/></label>
        <label>Existing actor<select required value={mappingForm.actorId} onChange={e => setMappingForm({ ...mappingForm, actorId: e.target.value })}><option value="">Select actor</option>{actors.map(actor => <option key={actor.id} value={actor.id}>{actor.name} · {actor.role} · {actor.id}</option>)}</select></label>
        <label className="config-wide">Reason<textarea required maxLength={2000} value={mappingForm.reason} onChange={e => setMappingForm({ ...mappingForm, reason: e.target.value })}/></label>
        <button className="primary" disabled={busy || !mappingForm.subject.trim() || !mappingForm.actorId || !mappingForm.reason.trim()}>Add mapping</button>
      </form>
    </section>}
    {(creating || editing) && <section className="panel identity-provider-editor"><div className="panel-heading"><div><h2>{editing ? `Configure ${editing.name}` : 'Add identity provider'}</h2><p>Start disabled, map an existing actor, then enable sign-in after the mapping is verified.</p></div><button type="button" className="text-button" onClick={cancelProviderEdit}>Close</button></div>
      <form className="connection-config-form" onSubmit={saveProvider}>
        <label>Provider name<input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>
        <label>Provider type<select disabled={!!editing} value={form.kind} onChange={e => { const kind = e.target.value; setForm({ ...blank, name: form.name, kind, routeId: '', reason: form.reason }); }}><option value="OIDC">OIDC</option><option value="LDAP">LDAP</option></select></label>
        <label>Configured route<select required disabled={!!editing} value={form.routeId} onChange={e => setForm({ ...form, routeId: e.target.value })}><option value="">Choose {form.kind} route</option>{eligibleRoutes.map(route => <option key={route.id} value={route.id}>{route.name} · {routeSummary(route)}</option>)}</select></label>
        {chosenRoute && <p className="config-wide muted">Route endpoint: {routeSummary(chosenRoute)}. Endpoint is supplied by the trusted operator.</p>}
        {form.kind === 'OIDC' ? <>
          <label>Issuer URL<input required disabled={!!editing} type="url" maxLength={2048} value={form.issuer} onChange={e => setForm({ ...form, issuer: e.target.value })}/></label>
          <label>Client ID<input required maxLength={512} value={form.clientId} onChange={e => setForm({ ...form, clientId: e.target.value })}/></label>
          <label>Client secret reference<select required value={form.clientSecretRef} onChange={e => setForm({ ...form, clientSecretRef: e.target.value })}><option value="">Choose secret reference</option>{(chosenRoute?.secretRefs || []).map(ref => <option key={ref} value={ref}>{ref}</option>)}</select></label>
        </> : <>
          <label>Base DN<input required maxLength={2048} value={form.baseDN} onChange={e => setForm({ ...form, baseDN: e.target.value })}/></label>
          <label>Login attribute<select value={form.loginAttribute} onChange={e => setForm({ ...form, loginAttribute: e.target.value })}><option value="uid">uid</option><option value="sAMAccountName">sAMAccountName</option><option value="userPrincipalName">userPrincipalName</option></select></label>
          <label>Bind DN<input required maxLength={2048} value={form.bindDN} onChange={e => setForm({ ...form, bindDN: e.target.value })}/></label>
          <label>Bind secret reference<select required value={form.bindSecretRef} onChange={e => setForm({ ...form, bindSecretRef: e.target.value })}><option value="">Choose secret reference</option>{(chosenRoute?.secretRefs || []).map(ref => <option key={ref} value={ref}>{ref}</option>)}</select></label>
          <p className="config-wide muted">Subject attribute is fixed to entryUUID. No directory groups are converted to Kelryvo roles.</p>
        </>}
        <label className="inline-form"><input type="checkbox" checked={form.enabled} disabled={!editing || !mappings.some(mapping => !mapping.revokedAt)} onChange={e => setForm({ ...form, enabled: e.target.checked })}/> Enable provider for sign-in</label>
        {(!editing || !mappings.some(mapping => !mapping.revokedAt)) && <p className="config-wide muted">Create the provider disabled, add a mapping to an existing local actor, then edit it to enable sign-in.</p>}
        <label className="config-wide">Reason<textarea required maxLength={2000} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })}/></label>
        <div className="config-wide"><button className="primary" disabled={busy || !form.routeId || !form.reason.trim()}>Save provider revision</button>
          <button className="secondary" type="button" disabled={busy} onClick={cancelProviderEdit}>Cancel</button></div>
      </form>
      <p className="fine-print">Secrets are selected by reference and are never shown or entered here. Configure route endpoints and secret references through the trusted operator.</p>
    </section>}
  </section>;
}

function routeSummary(route) {
  if (!route) return 'route unavailable';
  if (route.kind === 'OIDC') return route.issuerOrigin || route.issuerPrefix || route.name;
  return `${route.host || route.name}${route.port ? `:${route.port}` : ''} · ${route.transport || 'LDAP TLS'}`;
}
