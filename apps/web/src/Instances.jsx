import React, { useEffect, useRef, useState } from 'react';

export function Instances({ token, projectId, detail, api, actor, accessMode, onRefresh, onConfigure, onReferences, onMissing }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reasons, setReasons] = useState({});
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
  return <section aria-label="Database instances and connections">
    <div className="page-heading"><div><p className="eyebrow">DATABASE MANAGEMENT</p><h1>Database instances &amp; connections</h1><p className="muted">{loaded ? detail.project.name : 'Choose a project to inspect its connections.'}</p></div></div>
    <section className="panel"><h2>Project connections</h2>
      <p>Oracle profiles contain configuration and credential references. Connectivity is unverified; this screen does not connect to a database.</p>
      <button type="button" className="secondary" disabled={busy} onClick={onConfigure}>Configure project connections</button>
      <button type="button" className="secondary" disabled={busy || !loaded} onClick={onReferences}>Inspect assigned instance references</button>
      {error && <p role="alert" className="banner error">{error}</p>}
      {!profiles.length && <p>No connection profiles. Add an environment and profile from Projects.</p>}
      {profiles.map(profile => <article className="schema-reference-card" key={profile.id} data-profile-id={profile.id}>
        <h3>{profile.name} <span className="status-pill neutral">{profile.retiredAt ? 'RETIRED' : 'CONFIGURED · UNVERIFIED'}</span></h3>
        <dl><div><dt>Environment</dt><dd>{environments.find(env => env.id === profile.environmentId)?.name || 'Unavailable'}</dd></div>
          <div><dt>Endpoint</dt><dd>{profile.host}:{profile.port}/{profile.service}</dd></div>
          <div><dt>Username</dt><dd>{profile.username}</dd></div><div><dt>Credential alias</dt><dd><code>{profile.credentialAlias}</code></dd></div>
          <div><dt>Profile ID</dt><dd><code>{profile.id}</code></dd></div></dl>
        {profile.retiredAt ? <p>Retired {new Date(profile.retiredAt).toLocaleString()} by {profile.retiredBy}. {profile.retirementReason}</p>
          : actor?.role === 'developer' && accessMode === 'ENFORCED' && !detail.project.archivedAt && <form onSubmit={event => void retire(event, profile)}>
            <p>Retirement is permanent. Existing plans and history remain readable; new plans, approval and execution admission are blocked. Create a replacement profile to change configuration.</p>
            <label>Retirement reason<textarea aria-label={`Retirement reason for ${profile.name}`} value={reasons[profile.id] || ''} maxLength={2000} required disabled={busy}
              onChange={event => setReasons(previous => ({ ...previous, [profile.id]: event.target.value }))}/></label>
            <button type="submit" className="secondary" disabled={busy || !reasons[profile.id]?.trim()}>Retire profile {profile.name}</button>
          </form>}
      </article>)}
    </section>
    <section className="panel"><h2>Database instance catalog</h2><p>The trusted operator declares database, container and service identities and assigns schema references to projects. Assigned references appear in Schema references, grouped by environment and service. Manual declarations remain provisional until separately verified.</p></section>
  </section>;
}
