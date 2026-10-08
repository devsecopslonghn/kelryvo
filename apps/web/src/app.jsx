import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

const json = async (url, token, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP_${response.status}`);
  return body;
};

const errorCopy = {
  UNAUTHENTICATED: 'That token was not accepted. Check it and try again.',
  UNAUTHORIZED: 'That token was not accepted. Check it and try again.',
  FORBIDDEN: 'This role cannot make that change.',
  APPROVER_REQUIRED: 'Only an approver can record this decision.',
  SELF_APPROVAL_DENIED: 'A plan author cannot approve their own plan. Ask another approver to review it.',
  NOT_FOUND: 'That item is no longer available. Refresh the project.',
  CONFLICT: 'The item changed while you were working. Refresh and review it again.',
  DECISION_ALREADY_RECORDED: 'A decision has already been recorded for this plan. Refresh to see it.',
  INVALID_REQUEST: 'Some fields need attention. Check the values and try again.',
  INVALID_REFERENCE: 'The selected project, repository, or profile is no longer available.',
  INVALID_INPUT: 'Some fields need attention. Check the values and try again.',
  RELEASE_NOT_VALID: 'This release did not pass validation, so it cannot be planned.',
  RELEASE_NOT_PLANNABLE: 'This release has no migration files with complete version and checksum data.',
  RELEASE_IMPORT_FAILED: 'The repository or commit could not be imported. Confirm the selected source and try again.',
  REPOSITORY_UNAVAILABLE: 'The selected repository cannot be read right now.',
  VALIDATION_UNAVAILABLE: 'The migration parser is unavailable. This release cannot be planned.',
  EXECUTION_UNAVAILABLE: 'Execution is unavailable. The plan remains NOT_EXECUTED.',
  ORIGIN_REJECTED: 'This request did not come from the local application origin.',
  INTERNAL_ERROR: 'The server could not complete the request. Try again in a moment.',
};
const explain = (error) => errorCopy[error.message] || 'The request could not be completed. Check the connection and try again.';
const fmt = (date) => date ? new Date(date).toLocaleString() : '—';

function App() {
  const [tokenInput, setTokenInput] = useState('');
  const [token, setToken] = useState('');
  const [actor, setActor] = useState(null);
  const [repositories, setRepositories] = useState([]);
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [detail, setDetail] = useState(null);
  const [release, setRelease] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState('');
  const [tab, setTab] = useState('workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectForm, setProjectForm] = useState({ name: '', description: '' });
  const [environmentName, setEnvironmentName] = useState('');
  const [profileForm, setProfileForm] = useState({ name: '', environmentId: '', host: '', port: '1521', service: '', username: '', credentialRef: '' });
  const [releaseForm, setReleaseForm] = useState({ repositoryId: '', commit: 'HEAD', folder: 'migrations' });
  const [decisionReason, setDecisionReason] = useState('');
  const refreshSequence = useRef(0);

  const refresh = useCallback(async (activeToken, selectedId = projectId) => {
    if (!activeToken) return;
    const sequence = ++refreshSequence.current;
    setBusy(true); setError('');
    try {
      const [repoResult, projectResult] = await Promise.all([
        json('/api/repositories', activeToken), json('/api/projects', activeToken),
      ]);
      if (sequence !== refreshSequence.current) return;
      setRepositories(repoResult.repositories || []);
      const rows = projectResult.projects || [];
      setProjects(rows);
      const nextId = rows.some((item) => item.id === selectedId) ? selectedId : rows[0]?.id || '';
      setProjectId(nextId);
      if (nextId) {
        const result = await json(`/api/projects/${encodeURIComponent(nextId)}`, activeToken);
        if (sequence !== refreshSequence.current) return;
        setDetail(result);
      } else setDetail(null);
    } catch (e) { if (sequence === refreshSequence.current) setError(explain(e)); }
    finally { if (sequence === refreshSequence.current) setBusy(false); }
  }, [projectId]);

  const connect = async (event) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const session = await json('/api/session', tokenInput.trim());
      const who = session.actor || session;
      if (!who?.role) throw new Error('UNAUTHORIZED');
      setToken(tokenInput.trim()); setActor(who); setTokenInput('');
      await refresh(tokenInput.trim(), projectId);
      setNotice(`Signed in as ${who.name || who.id || who.role}.`);
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (token && projectId) refresh(token, projectId); }, [token, projectId]);

  const plans = detail?.plans || [];
  const plan = useMemo(() => plans.find((item) => item.id === selectedPlan) || plans[0] || null, [plans, selectedPlan]);
  const isApprover = /approv/i.test(actor?.role || '');

  const mutate = async (action, success) => {
    setBusy(true); setError(''); setNotice('');
    try { const nextId = await action(); setNotice(success); await refresh(token, nextId || projectId); }
    catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  };

  const createProject = (event) => {
    event.preventDefault();
    mutate(async () => {
      const payload = { name: projectForm.name };
      if (projectForm.description.trim()) payload.description = projectForm.description.trim();
      const result = await json('/api/projects', token, { method: 'POST', body: JSON.stringify(payload) });
      setProjectForm({ name: '', description: '' });
      if (result.project?.id) { setProjectId(result.project.id); setRelease(null); setSelectedPlan(''); return result.project.id; }
    }, 'Project created.');
  };
  const createEnvironment = (event) => {
    event.preventDefault(); if (!projectId) return;
    mutate(async () => {
      await json(`/api/projects/${projectId}/environments`, token, { method: 'POST', body: JSON.stringify({ name: environmentName }) });
      setEnvironmentName('');
    }, 'Environment added.');
  };
  const createProfile = (event) => {
    event.preventDefault(); if (!projectId) return;
    mutate(async () => {
      await json(`/api/projects/${projectId}/profiles`, token, { method: 'POST', body: JSON.stringify({ ...profileForm, port: Number(profileForm.port), engine: 'oracle' }) });
      setProfileForm({ name: '', environmentId: '', host: '', port: '1521', service: '', username: '', credentialRef: '' });
    }, 'Connection profile saved. Its credential remains a reference.');
  };
  const importRelease = (event) => {
    event.preventDefault(); if (!projectId) return;
    mutate(async () => {
      const result = await json(`/api/projects/${projectId}/releases`, token, { method: 'POST', body: JSON.stringify(releaseForm) });
      const imported = result.release || result;
      setRelease(imported);
      if (imported.id) {
        const full = await json(`/api/releases/${imported.id}`, token);
        setRelease(full.release || full);
      }
      setTab('release');
    }, 'Repository release imported and validated.');
  };
  const makePlan = (event) => {
    event.preventDefault(); if (!release?.id) return;
    const profileId = event.currentTarget.elements.profileId.value;
    mutate(async () => {
      const result = await json(`/api/projects/${projectId}/plans`, token, { method: 'POST', body: JSON.stringify({ releaseId: release.id, profileId }) });
      setSelectedPlan((result.plan || result).id);
      setTab('review');
    }, 'Offline candidate plan created. Execution was not performed.');
  };
  const decide = (decision) => {
    if (!plan) return;
    mutate(async () => {
      const result = await json(`/api/plans/${plan.id}/decision`, token, { method: 'POST', body: JSON.stringify({ decision, reason: decisionReason }) });
      setSelectedPlan((result.plan || result).id || plan.id); setDecisionReason('');
    }, `Plan ${decision.toLowerCase()}d. Execution remains NOT_EXECUTED.`);
  };

  if (!actor) return <main className="login-shell">
    <div className="login-card">
      <a className="brand" href="#home" aria-label="SchemaForge home"><span className="brand-mark">S</span><span>Schema<span className="brand-light">Forge</span></span></a>
      <p className="eyebrow">DATABASE CHANGE GOVERNANCE</p>
      <h1>Make every change reviewable.</h1>
      <p className="muted">Sign in with a local access token to manage projects, review migration releases, and record decisions.</p>
      <form onSubmit={connect} className="stack login-form">
        <label htmlFor="access-token">Local access token</label>
        <input id="access-token" aria-label="Local access token" type="password" autoComplete="off" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} required />
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Continue'}</button>
      </form>
      {error && <p className="banner error" role="alert">{error}</p>}
      <p className="fine-print">Your token is kept in memory for this tab and is never saved in browser storage.</p>
    </div>
    <div className="login-art"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="art-card"><span className="status-dot"/> Controlled change <strong>Plan → Review → Record</strong><small>Execution stays with an authorized runtime.</small></div><div className="art-caption">A clear record for every proposed database change.</div></div>
  </main>;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#workspace"><span className="brand-mark">S</span><span>Schema<span className="brand-light">Forge</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <button className={`nav-item ${tab === 'workspace' ? 'active' : ''}`} onClick={() => setTab('workspace')}><span>▦</span> Projects</button>
      <button className={`nav-item ${tab === 'release' ? 'active' : ''}`} onClick={() => setTab('release')}><span>◫</span> Releases</button>
      <button className={`nav-item ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}><span>◇</span> Plans &amp; review</button>
      <button className={`nav-item ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}><span>≡</span> Audit &amp; history</button>
      <div className="sidebar-bottom"><div className="user-avatar">{(actor.name || actor.role || 'U').slice(0, 1).toUpperCase()}</div><div className="user-meta"><strong>{actor.name || actor.id || 'Signed in'}</strong><small>{actor.role}</small></div><button className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => { refreshSequence.current += 1; setActor(null); setToken(''); setDetail(null); setProjects([]); setRepositories([]); setRelease(null); setSelectedPlan(''); setDecisionReason(''); setError(''); setNotice(''); }}>↗</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="crumb">Workspace</span><span className="crumb-sep">/</span><strong>{tab === 'workspace' ? 'Projects' : tab === 'release' ? 'Release intake' : tab === 'review' ? 'Plan review' : 'Audit & history'}</strong></div><div className="topbar-right"><span className="role-pill">{actor.role}</span><button className="icon-button refresh" aria-label="Refresh workspace" onClick={() => refresh(token)} disabled={busy}>↻</button></div></header>
      {(error || notice) && <div className={`banner ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || notice}<button className="banner-close" onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss message">×</button></div>}
      <div className="content">
        {tab === 'workspace' && <>
          <div className="page-heading"><div><p className="eyebrow">PRODUCT WORKSPACE</p><h1>Your projects</h1><p className="muted">Organize environments and connection references before preparing a migration review.</p></div><div className="heading-mark">01 <span> / 04</span></div></div>
          <div className="workspace-grid">
            <section className="panel project-panel"><div className="panel-heading"><div><h2>Project space</h2><p>Choose a project to see its delivery context.</p></div><span className="count-pill">{projects.length} total</span></div>
              {projects.length ? <div className="project-list">{projects.map((p) => <button key={p.id} className={`project-row ${projectId === p.id ? 'selected' : ''}`} onClick={() => { setProjectId(p.id); setRelease(null); setSelectedPlan(''); setDecisionReason(''); }}><span className="project-icon">{p.name.slice(0, 1).toUpperCase()}</span><span className="project-copy"><strong>{p.name}</strong><small>{p.description || 'No description provided'}</small></span><span className="row-arrow">›</span></button>)}</div> : <div className="empty-state"><span className="empty-icon">＋</span><strong>No projects yet</strong><span>Create a project to start organizing database changes.</span></div>}
              <form className="inline-form project-create" onSubmit={createProject}><label className="sr-only" htmlFor="project-name">New project name</label><input id="project-name" placeholder="New project name" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} required/><button className="secondary" disabled={busy}>Create project</button><label className="sr-only" htmlFor="project-description">Project description</label><input id="project-description" className="wide-input" placeholder="Description (optional)" value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}/></form>
            </section>
            <section className="panel context-panel"><div className="panel-heading"><div><h2>{detail?.project?.name || 'Project context'}</h2><p>Configuration for the selected project.</p></div><span className="context-icon">⌘</span></div>
              {!detail ? <div className="empty-state compact">Select or create a project to continue.</div> : <>
                <div className="section-title"><span>01</span><strong>Environments</strong></div>
                <div className="chip-list">{(detail.environments || []).map((env) => <span className="data-chip" key={env.id}><i/> {env.name}</span>)}{!detail.environments?.length && <span className="subtle">No environments configured</span>}</div>
                <form className="inline-form" onSubmit={createEnvironment}><label className="sr-only" htmlFor="environment-name">Environment name</label><input id="environment-name" placeholder="e.g. Development" value={environmentName} onChange={(e) => setEnvironmentName(e.target.value)} required/><button className="text-button" disabled={busy}>＋ Add</button></form>
                <div className="section-title section-spaced"><span>02</span><strong>Connection profiles</strong><small>{(detail.profiles || []).length} profiles</small></div>
                <div className="profile-list">{(detail.profiles || []).map((profile) => <div className="profile-row" key={profile.id}><span className="profile-icon">◎</span><span><strong>{profile.name}</strong><small>{profile.host}:{profile.port}/{profile.service} · {profile.username}</small></span><span className="ref-badge">ref only</span></div>)}{!detail.profiles?.length && <p className="subtle">No connection profiles yet.</p>}</div>
                <details className="form-disclosure"><summary>Add Oracle profile</summary><form className="profile-form" onSubmit={createProfile}><label>Name<input aria-label="Profile name" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} required/></label><label>Environment<select aria-label="Profile environment" value={profileForm.environmentId} onChange={(e) => setProfileForm({ ...profileForm, environmentId: e.target.value })} required><option value="">Choose environment</option>{(detail.environments || []).map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}</select></label><label>Host<input aria-label="Database host" value={profileForm.host} onChange={(e) => setProfileForm({ ...profileForm, host: e.target.value })} required/></label><label>Port<input aria-label="Database port" type="number" value={profileForm.port} onChange={(e) => setProfileForm({ ...profileForm, port: e.target.value })} required/></label><label>Service<input aria-label="Oracle service" value={profileForm.service} onChange={(e) => setProfileForm({ ...profileForm, service: e.target.value })} required/></label><label>Username<input aria-label="Database username" value={profileForm.username} onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })} required/></label><label className="full-width">Credential reference<input aria-label="Credential reference" placeholder="vault://team/reference" value={profileForm.credentialRef} onChange={(e) => setProfileForm({ ...profileForm, credentialRef: e.target.value })} required/><small>Enter a reference only. Password fields are never sent or stored here.</small></label><button className="primary" disabled={busy}>Save profile</button></form></details>
              </>}
            </section>
          </div>
        </>}

        {tab === 'release' && <>
          <div className="page-heading"><div><p className="eyebrow">MIGRATION INTAKE</p><h1>Import a release</h1><p className="muted">Select an allowlisted Git repository and an immutable commit to inspect migration files.</p></div><div className="heading-mark">02 <span> / 04</span></div></div>
          <section className="panel intake-panel"><div className="panel-heading"><div><h2>Repository source</h2><p>Repository paths stay on the server. The browser sends only the repository ID.</p></div><span className="step-badge">GIT</span></div>
            <form className="release-form" onSubmit={importRelease}><label>Project<select aria-label="Release project" value={projectId} onChange={(e) => { setProjectId(e.target.value); setRelease(null); setSelectedPlan(''); setDecisionReason(''); }} required><option value="">Choose project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>Allowlisted repository<select aria-label="Repository" value={releaseForm.repositoryId} onChange={(e) => setReleaseForm({ ...releaseForm, repositoryId: e.target.value })} required><option value="">Choose repository</option>{repositories.map((repo) => <option key={repo.id} value={repo.id}>{repo.name}</option>)}</select></label><label>Commit or ref<input aria-label="Git commit or ref" value={releaseForm.commit} onChange={(e) => setReleaseForm({ ...releaseForm, commit: e.target.value })} placeholder="40 character commit SHA" required/><small>Use a commit SHA for a reproducible release.</small></label><label>Migration folder<input aria-label="Migration folder" value={releaseForm.folder} onChange={(e) => setReleaseForm({ ...releaseForm, folder: e.target.value })} required/><small>Example: db/migrations</small></label><div className="form-actions"><button className="primary" disabled={busy || !projects.length || !repositories.length}>{busy ? 'Importing…' : 'Import and validate'}</button><span className="subtle">Files are parsed before a plan can be created.</span></div></form>
          </section>
          {release && <section className="panel release-result"><div className="panel-heading"><div><p className="eyebrow">IMPORTED RELEASE</p><h2>{release.commit?.slice(0, 12)} <span className="muted">· {release.folder}</span></h2></div><span className={`status-pill ${release.validationStatus === 'VALID' ? 'good' : 'warn'}`}>{release.validationStatus}</span></div>{release.validationCode && <p className="banner warning">{release.validationCode}</p>}<div className="file-table-wrap"><table><thead><tr><th>Migration file</th><th>Version</th><th>Statements</th><th>Bytes</th><th>Validation</th></tr></thead><tbody>{(release.files || []).map((file) => <tr key={file.path}><td><code>{file.path}</code></td><td>{file.version || '—'}</td><td>{file.statementCount ?? '—'}</td><td>{file.bytes ?? '—'}</td><td><span className={`status-pill ${file.validationStatus === 'VALID' ? 'good' : 'warn'}`}>{file.validationStatus}</span></td></tr>)}</tbody></table>{!release.files?.length && <div className="empty-inline">No migration files were returned for this release.</div>}</div>{(release.files || []).map((file) => <details className="sql-preview" key={`${file.path}-sql`}><summary>Preview SQL · {file.path}</summary><pre>{file.content || 'Source content unavailable.'}</pre></details>)}{(release.validationStatus === 'VALID') && <form className="plan-form" onSubmit={makePlan}><label>Target connection profile<select name="profileId" aria-label="Target connection profile" required><option value="">Choose profile</option>{(detail?.profiles || []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.host}/{profile.service}</option>)}</select></label><button className="primary" disabled={busy || !detail?.profiles?.length}>Prepare offline plan</button><span className="offline-note">This creates a review candidate. It does not connect to Oracle.</span></form>}</section>}
        </>}

        {tab === 'review' && <>
          <div className="page-heading"><div><p className="eyebrow">GOVERNANCE</p><h1>Plans &amp; review</h1><p className="muted">Review the exact migration candidate and record an independent decision.</p></div><div className="heading-mark">03 <span> / 04</span></div></div>
          <section className="notice-card"><span className="notice-icon">i</span><div><strong>Offline candidate only</strong><p>Target history has not been observed. Database execution is unavailable and remains <b>NOT_EXECUTED</b>.</p></div><span className="scope-tag">{plan?.planningScope || 'OFFLINE_CANDIDATE'}</span></section>
          <section className="panel plan-panel"><div className="panel-heading"><div><h2>Candidate plans</h2><p>Plans preserve source checksums and explicit execution status.</p></div><span className="count-pill">{plans.length} plans</span></div>
            {!plans.length ? <div className="empty-state"><span className="empty-icon">◇</span><strong>No plans to review</strong><span>Import a valid release and prepare an offline candidate plan first.</span><button className="text-button" onClick={() => setTab('release')}>Go to release intake →</button></div> : <>
              <div className="plan-selector">{plans.map((item) => { const sourceRelease = (detail.releases || []).find((candidate) => candidate.id === item.releaseId); return <button key={item.id} onClick={() => setSelectedPlan(item.id)} className={`plan-option ${(plan?.id === item.id) ? 'selected' : ''}`}><span className={`status-dot ${item.status === 'APPROVED' ? 'green' : item.status === 'REJECTED' ? 'red' : ''}`}/><span><strong>{sourceRelease?.commit?.slice(0, 12) || `Plan ${item.id.slice(0, 8)}`}</strong><small>{fmt(item.createdAt || item.created_at)}</small></span><span className={`status-pill ${item.status === 'APPROVED' ? 'good' : item.status === 'REJECTED' ? 'bad' : 'pending'}`}>{item.status?.replaceAll('_', ' ')}</span></button>; })}</div>
              {plan && <><div className="plan-summary"><div><span className="data-label">PLAN ID</span><code>{plan.id}</code></div><div><span className="data-label">DECISION</span><span className={`status-pill ${plan.status === 'APPROVED' ? 'good' : plan.status === 'REJECTED' ? 'bad' : 'pending'}`}>{plan.status?.replaceAll('_', ' ')}</span></div><div><span className="data-label">TARGET HISTORY</span><strong>{plan.historyStatus || 'NOT_OBSERVED'}</strong></div><div><span className="data-label">EXECUTION</span><strong className="not-executed">{plan.execution || 'NOT_EXECUTED'}</strong></div></div><div className="file-table-wrap"><table><thead><tr><th>Migration</th><th>Version</th><th>SHA-256</th><th>State</th></tr></thead><tbody>{(plan.items || []).map((item) => <tr key={item.path}><td><code>{item.path}</code></td><td>{item.version || '—'}</td><td><code className="checksum">{item.sha256}</code></td><td><span className="status-pill neutral">{item.status || 'NOT_EXECUTED'}</span></td></tr>)}</tbody></table></div>
                {isApprover && plan.status === 'PENDING_APPROVAL' && <div className="decision-box"><label htmlFor="decision-reason">Decision reason</label><textarea id="decision-reason" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} placeholder="Record why this candidate is approved or rejected" required/><div><button className="danger-button" onClick={() => decide('REJECT')} disabled={busy || !decisionReason.trim()}>Reject plan</button><button className="primary" onClick={() => decide('APPROVE')} disabled={busy || !decisionReason.trim()}>Approve plan</button></div><small>Approval records governance only. It does not authorize or perform execution in this product.</small></div>}
                {!isApprover && plan.status === 'PENDING_APPROVAL' && <p className="banner warning">Awaiting an approver. Your current role can prepare plans but cannot decide them.</p>}
              </>}
            </>}
          </section>
        </>}

        {tab === 'records' && <>
          <div className="page-heading"><div><p className="eyebrow">TRACEABILITY</p><h1>Audit &amp; history</h1><p className="muted">See governance events alongside the recorded migration outcomes.</p></div><div className="heading-mark">04 <span> / 04</span></div></div>
          <div className="records-grid"><section className="panel"><div className="panel-heading"><div><h2>Audit events</h2><p>Actions recorded for this project.</p></div><span className="count-pill">{detail?.audit?.length || 0} events</span></div><div className="timeline">{(detail?.audit || []).map((item) => <div className="timeline-row" key={item.id}><span className="timeline-dot"/><div><strong>{item.action || item.event || 'Project event'}</strong><p>{item.facts?.reason || item.summary || item.reason || 'Governance record'}</p><small>{item.actorName || (item.actorId === actor.id ? actor.name || actor.id : item.actorId ? `Actor ${item.actorId.slice(0, 8)}` : 'Unknown actor')} · {fmt(item.createdAt || item.created_at)}</small></div></div>)}{!detail?.audit?.length && <div className="empty-state compact"><strong>No audit events yet</strong><span>Project changes and review decisions will appear here.</span></div>}</div></section><section className="panel"><div className="panel-heading"><div><h2>Migration history</h2><p>Recorded migration states; these are not evidence of database application.</p></div><span className="count-pill">{detail?.history?.length || 0} records</span></div><div className="history-list">{(detail?.history || []).map((item) => <div className="history-row" key={item.id}><div><strong>{item.path || item.version || 'Migration event'}</strong><small>{fmt(item.executedAt || item.createdAt)}</small></div><span className={`status-pill ${item.status === 'SUCCEEDED' ? 'good' : 'neutral'}`}>{item.status || 'NOT_OBSERVED'}</span></div>)}{!detail?.history?.length && <div className="empty-state compact"><strong>No migration records yet</strong><span>Candidate plans add NOT_EXECUTED records; they do not imply database application.</span></div>}</div></section></div>
          <p className="history-footnote"><span className="status-dot"/> Unknown target history stays unknown until a trusted runtime observes it.</p>
        </>}
      </div>
      <footer className="footer"><span>SchemaForge <span className="footer-sep">·</span> Governance workspace</span><span>Local time · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
