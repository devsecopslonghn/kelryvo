import React, { useEffect, useRef, useState } from 'react';
import { Connections } from './Connections.jsx';
import { CONNECTION_PATTERNS, ConnectionConfiguration } from './ConnectionConfiguration.jsx';
import { InstanceOnboarding } from './InstanceOnboarding.jsx';

export function Instances({ token, projectId, detail, api, actor, accessMode, metadataRecovery, onRefresh, onConfigure, onReferences, onMissing }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reasons, setReasons] = useState({});
  const [newProfile, setNewProfile] = useState({ name: '', description: '', environmentId: '', host: '', port: '1521', service: '', serviceKind: 'SERVICE_NAME', username: '', credentialRef: '', reason: '' });
  const [profileError, setProfileError] = useState(''), [selectedProfile, setSelectedProfile] = useState('');
  const [profileSearch, setProfileSearch] = useState(''), [profileEnvironment, setProfileEnvironment] = useState(''), [profileStatus, setProfileStatus] = useState(''), [retireConfirmed, setRetireConfirmed] = useState({});
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current += 1; }, [token, projectId]);
  const retire = async (event, profile) => {
    event.preventDefault(); const current = ++epoch.current; setBusy(true); setError('');
    try {
      await api(`/api/projects/${projectId}/profiles/${profile.id}/retire`, token,
        { method: 'POST', body: JSON.stringify({ reason: reasons[profile.id]?.trim() }) });
      if (current === epoch.current) await onRefresh();
    } catch (error) {
      if (current === epoch.current && error.message === 'NOT_FOUND') { onMissing(); return; }
      if (current === epoch.current) setError(error.message === 'PROFILE_EXECUTION_ACTIVE'
        ? 'This profile has an admitted execution request. Resolve it through the controlled recovery workflow before retirement.'
        : 'Profile retirement failed. Refresh the workspace to check current access and retry.');
    } finally { if (current === epoch.current) setBusy(false); }
  };
  const loaded = detail?.project?.id === projectId;
  const profiles = loaded ? detail.profiles || [] : [], environments = loaded ? detail.environments || [] : [];
  const statusOf = profile => profile.status || (profile.retiredAt ? 'RETIRED' : profile.enabled === false ? 'DISABLED' : 'ENABLED');
  const visibleProfiles = profiles.filter(profile => {
    const env = environments.find(item => item.id === profile.environmentId)?.name || '';
    const needle = profileSearch.trim().toLowerCase();
    return (!needle || [profile.name, profile.host, profile.service, profile.username, env].some(value => String(value || '').toLowerCase().includes(needle)))
      && (!profileEnvironment || env === profileEnvironment) && (!profileStatus || statusOf(profile) === profileStatus);
  });
  const canManage = loaded && actor?.role === 'developer' && accessMode === 'ENFORCED' && !detail.project.archivedAt;
  const createProfile = async event => {
    event.preventDefault(); setBusy(true); setProfileError('');
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/profiles`, token, { method: 'POST', body: JSON.stringify({ name: newProfile.name.trim(), description: newProfile.description.trim(), environmentId: newProfile.environmentId, host: newProfile.host.trim(), port: Number(newProfile.port), service: newProfile.service.trim(), serviceKind: newProfile.serviceKind, username: newProfile.username.trim(), credentialRef: newProfile.credentialRef.trim(), reason: newProfile.reason.trim(), engine: 'oracle', purpose: 'DEPLOY' }) });
      setNewProfile({ name: '', description: '', environmentId: '', host: '', port: '1521', service: '', serviceKind: 'SERVICE_NAME', username: '', credentialRef: '', reason: '' }); await onRefresh();
    } catch (e) { setProfileError(e.message === 'CONFLICT' ? 'The profile changed. Refresh the project and retry.' : `Profile could not be created (${e.message}).`); }
    finally { setBusy(false); }
  };
  return <section aria-label="Database instances and connections">
    <div className="page-heading"><div><p className="eyebrow">DATABASE MANAGEMENT</p><h1>Database instances &amp; connections</h1><p className="muted">{loaded ? detail.project.name : 'Choose a project to inspect its connections.'}</p></div></div>
    <InstanceOnboarding token={token} projectId={projectId} detail={detail} api={api} actor={actor} accessMode={accessMode}
      metadataRecovery={metadataRecovery} onRefresh={onRefresh} onMissing={onMissing}/>
    <details className="advanced-instance-tools"><summary>Advanced and legacy connection tools</summary>
    <section className="panel"><h2>Project connections</h2>
      <p>Deployment profiles retain configuration and credential aliases. Use the read-only connections below to inspect connectivity evidence.</p>
      <button type="button" className="secondary" disabled={busy} onClick={onConfigure}>Configure project connections</button>
      <button type="button" className="secondary" disabled={busy || !loaded} onClick={onReferences}>Inspect assigned instance references</button>
      {canManage && <details className="connection-form"><summary>Create deployment profile</summary><form className="connection-grid" onSubmit={createProfile}><fieldset disabled={busy}>
        <label>Name<input required maxLength="120" value={newProfile.name} onChange={e => setNewProfile({ ...newProfile, name: e.target.value })}/></label>
        <label>Environment<select required value={newProfile.environmentId} onChange={e => setNewProfile({ ...newProfile, environmentId: e.target.value })}><option value="">Choose environment</option>{environments.map(env => <option key={env.id} value={env.id}>{env.name}</option>)}</select></label>
        <label>Description<input maxLength="1000" value={newProfile.description} onChange={e => setNewProfile({ ...newProfile, description: e.target.value })}/></label>
        <label>Host<input required maxLength="253" pattern={CONNECTION_PATTERNS.host} value={newProfile.host} onChange={e => setNewProfile({ ...newProfile, host: e.target.value })}/></label>
        <label>Port<input required type="number" min="1" max="65535" value={newProfile.port} onChange={e => setNewProfile({ ...newProfile, port: e.target.value })}/></label>
        <label>Service identifier<input required maxLength="128" pattern={CONNECTION_PATTERNS.service} value={newProfile.service} onChange={e => setNewProfile({ ...newProfile, service: e.target.value })}/></label>
        <label>Identifier type<select value={newProfile.serviceKind} onChange={e => setNewProfile({ ...newProfile, serviceKind: e.target.value })}><option value="SERVICE_NAME">Oracle Service Name</option><option value="SID">Oracle SID</option></select></label>
        <label>Username<input required maxLength="128" pattern={CONNECTION_PATTERNS.username} value={newProfile.username} onChange={e => setNewProfile({ ...newProfile, username: e.target.value })}/></label>
        <label>Credential reference<input required maxLength="512" pattern={CONNECTION_PATTERNS.credentialRef} placeholder="vault://team/reference" value={newProfile.credentialRef} onChange={e => setNewProfile({ ...newProfile, credentialRef: e.target.value })}/><small>Reference only. Never enter a password.</small></label>
        <label className="wide">Reason<textarea required maxLength="2000" value={newProfile.reason} onChange={e => setNewProfile({ ...newProfile, reason: e.target.value })}/></label>
      </fieldset>{profileError && <p className="banner error wide" role="alert">{profileError}</p>}<button type="submit" className="primary" disabled={busy || !environments.length}>Create deployment profile</button></form></details>}
      {error && <p role="alert" className="banner error">{error}</p>}
      {!profiles.length && <p>No connection profiles. Add an environment and profile from Projects.</p>}
      {!!profiles.length && <section className="connection-list-tools" aria-label="Filter deployment profiles"><label>Search profiles<input type="search" value={profileSearch} onChange={e => setProfileSearch(e.target.value)} placeholder="Name, host, service, username"/></label><label>Environment<select value={profileEnvironment} onChange={e => setProfileEnvironment(e.target.value)}><option value="">All environments</option>{environments.map(env => <option key={env.id} value={env.name}>{env.name}</option>)}</select></label><label>Status<select value={profileStatus} onChange={e => setProfileStatus(e.target.value)}><option value="">All statuses</option>{[...new Set(profiles.map(statusOf))].map(status => <option key={status}>{status}</option>)}</select></label><span>{visibleProfiles.length} of {profiles.length}</span></section>}
      {profiles.length > 0 && !visibleProfiles.length && <p role="status">No profiles match these filters.</p>}
      {visibleProfiles.map(profile => <article className="schema-reference-card" key={profile.id} data-profile-id={profile.id}>
        <h3>{profile.name} <span className="status-pill neutral">{statusOf(profile)} · {profile.serviceKind || 'SERVICE_NAME'}</span></h3>
        <dl><div><dt>Environment</dt><dd>{environments.find(env => env.id === profile.environmentId)?.name || 'Unavailable'}</dd></div>
          <div><dt>Endpoint</dt><dd>{profile.host}:{profile.port}/{profile.service}</dd></div>
          <div><dt>Username</dt><dd>{profile.username}</dd></div><div><dt>Credential</dt><dd>{profile.credentialConfigured ? 'Reference configured · value hidden' : 'Reference status unavailable'}</dd></div>
          <div><dt>Profile ID</dt><dd><code>{profile.id}</code></dd></div></dl>
        <button type="button" className="secondary" aria-expanded={selectedProfile === profile.id} onClick={() => setSelectedProfile(selectedProfile === profile.id ? '' : profile.id)}>{selectedProfile === profile.id ? 'Hide configuration' : 'Configure and inspect'}</button>
        {selectedProfile === profile.id && <ConnectionConfiguration token={token} api={api} basePath={`/api/projects/${encodeURIComponent(projectId)}/profiles/${encodeURIComponent(profile.id)}`} kind="profile" connection={profile} readOnly={!canManage || !!profile.retiredAt} onChanged={onRefresh}/>}
        {profile.retiredAt ? <p>Retired {new Date(profile.retiredAt).toLocaleString()} by {profile.retiredBy}. {profile.retirementReason}</p>
          : actor?.role === 'developer' && accessMode === 'ENFORCED' && !detail.project.archivedAt && <form onSubmit={event => void retire(event, profile)}>
            <p>Retirement is permanent. Existing plans and history remain readable; new plans, approval and execution admission are blocked. Active profiles can be edited through configuration revisions.</p>
            <label className="retire-confirm"><input type="checkbox" checked={!!retireConfirmed[profile.id]} onChange={event => setRetireConfirmed(previous => ({ ...previous, [profile.id]: event.target.checked }))}/> I understand retirement is permanent</label>
            <label>Retirement reason<textarea aria-label={`Retirement reason for ${profile.name}`} value={reasons[profile.id] || ''} maxLength={2000} required disabled={busy}
              onChange={event => setReasons(previous => ({ ...previous, [profile.id]: event.target.value }))}/></label>
            <button type="submit" className="secondary" disabled={busy || !reasons[profile.id]?.trim() || !retireConfirmed[profile.id]}>Retire profile {profile.name}</button>
          </form>}
      </article>)}
    </section>
    {loaded && <Connections token={token} projectId={projectId} api={api} detail={detail} onChanged={onRefresh} readOnly={detail.project.archivedAt || accessMode !== 'ENFORCED' || metadataRecovery?.state && metadataRecovery.state !== 'ACTIVE'}/>}
    </details>
  </section>;
}
