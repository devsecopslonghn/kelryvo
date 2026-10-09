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
  SOURCE_NOT_BOUND: 'Bind a repository and migration folder to this project before importing.',
  SOURCE_BINDING_MISMATCH: 'The requested source differs from the project binding. Save the source binding and try again.',
  REPOSITORY_UNAVAILABLE: 'The selected repository cannot be read right now.',
  VALIDATION_UNAVAILABLE: 'The migration parser is unavailable. This release cannot be planned.',
  EXECUTION_UNAVAILABLE: 'Execution is unavailable. The plan remains NOT_EXECUTED.',
  PROJECT_ARCHIVED: 'This project is archived. It remains readable, but new work is disabled.',
  ORIGIN_REJECTED: 'This request did not come from the local application origin.',
  INTERNAL_ERROR: 'The server could not complete the request. Try again in a moment.',
};
const explain = (error) => errorCopy[error.message] || 'The request could not be completed. Check the connection and try again.';
const fmt = (date) => date ? new Date(date).toLocaleString() : '—';
const pageTitles = { workspace: 'Projects', release: 'Release intake', review: 'Plan review', records: 'Audit & history' };
const decisionClass = (status) => ({ APPROVED: 'good', REJECTED: 'bad' }[status] || 'pending');
const planMarkerClass = (status) => ({ APPROVED: 'green', REJECTED: 'red' }[status] || '');
const importStatusClass = (status) => status === 'VALID' ? 'good' : 'warn';
function auditActorLabel(item, actor) {
  if (item.actorName) return item.actorName;
  if (item.actorId === actor.id) return actor.name || actor.id;
  if (item.actorId) return `Actor ${item.actorId.slice(0, 8)}`;
  return 'Unknown actor';
}

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
  const [sourceForm, setSourceForm] = useState({ repositoryId: '', folder: 'migrations' });
  const [decisionReason, setDecisionReason] = useState('');
  const [archiveReason, setArchiveReason] = useState('');
  const refreshSequence = useRef(0);
  const activeProjectId = useRef(projectId);
  const sessionEpoch = useRef(0);

  const selectProject = (nextId) => {
    const alreadySelected = nextId === projectId;
    activeProjectId.current = nextId;
    refreshSequence.current += 1;
    setProjectId(nextId);
    setDetail(null);
    setRelease(null);
    setSelectedPlan('');
    setDecisionReason('');
    setSourceForm({ repositoryId: '', folder: 'migrations' });
    setReleaseForm({ repositoryId: '', commit: 'HEAD', folder: 'migrations' });
    if (alreadySelected && token) void refresh(token, nextId);
  };

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
      activeProjectId.current = nextId;
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

  useEffect(() => { if (token && projectId) void refresh(token, projectId); }, [token, projectId]);

  useEffect(() => {
    if (!projectId || detail?.project?.id !== projectId) return;
    const binding = detail.project.sourceBinding;
    setSourceForm({ repositoryId: binding?.repositoryId || '', folder: binding?.folder || 'migrations' });
  }, [projectId, detail?.project?.id, detail?.project?.sourceBinding?.repositoryId,
    detail?.project?.sourceBinding?.folder, detail?.project?.sourceBinding?.updatedAt]);

  const plans = detail?.plans || [];
  const plan = useMemo(() => plans.find((item) => item.id === selectedPlan) || plans[0] || null, [plans, selectedPlan]);
  const isApprover = /approv/i.test(actor?.role || '');
  const canArchive = actor?.role === 'developer';
  const canBindSource = actor?.role === 'developer';
  const selectedProject = projects.find((item) => item.id === projectId);
  const archivedAt = selectedProject?.archivedAt || detail?.project?.archivedAt || null;
  const isArchived = Boolean(archivedAt);
  const projectLoaded = detail?.project?.id === projectId;
  const sourceBinding = projectLoaded ? detail.project.sourceBinding || null : null;
  const boundRepository = repositories.find((item) => item.id === sourceBinding?.repositoryId);

  const mutate = async (action, success, onSuccess = () => {}) => {
    const epoch = sessionEpoch.current;
    const activeToken = token;
    const activeSelection = projectId;
    const isCurrentSession = () => sessionEpoch.current === epoch;
    setBusy(true); setError(''); setNotice('');
    try {
      const outcome = await action(isCurrentSession);
      if (!isCurrentSession()) return;
      onSuccess(outcome);
      setNotice(success);
      await refresh(activeToken, outcome?.nextProjectId || activeSelection);
    } catch (e) { if (isCurrentSession()) setError(explain(e)); }
    finally { if (isCurrentSession()) setBusy(false); }
  };

  const createProject = (event) => {
    event.preventDefault();
    void mutate(async () => {
      const payload = { name: projectForm.name };
      if (projectForm.description.trim()) payload.description = projectForm.description.trim();
      const result = await json('/api/projects', token, { method: 'POST', body: JSON.stringify(payload) });
      return { project: result.project, nextProjectId: result.project?.id };
    }, 'Project created.', (outcome) => {
      setProjectForm({ name: '', description: '' });
      if (outcome?.project?.id) selectProject(outcome.project.id);
    });
  };
  const createEnvironment = (event) => {
    event.preventDefault(); if (!projectId || detail?.project?.archivedAt) return;
    void mutate(async () => {
      await json(`/api/projects/${projectId}/environments`, token, { method: 'POST', body: JSON.stringify({ name: environmentName }) });
    }, 'Environment added.', () => setEnvironmentName(''));
  };
  const createProfile = (event) => {
    event.preventDefault(); if (!projectId || detail?.project?.archivedAt) return;
    void mutate(async () => {
      await json(`/api/projects/${projectId}/profiles`, token, { method: 'POST', body: JSON.stringify({ ...profileForm, port: Number(profileForm.port), engine: 'oracle' }) });
    }, 'Connection profile saved. Its credential remains a reference.', () => setProfileForm({ name: '', environmentId: '', host: '', port: '1521', service: '', username: '', credentialRef: '' }));
  };
  const saveSourceBinding = (event) => {
    event.preventDefault();
    if (!projectId || !canBindSource || isArchived || !sourceForm.repositoryId || !sourceForm.folder.trim()) return;
    void mutate(async () => {
      await json(`/api/projects/${encodeURIComponent(projectId)}/source`, token, {
        method: 'PUT', body: JSON.stringify({ repositoryId: sourceForm.repositoryId, folder: sourceForm.folder.trim() }),
      });
    }, 'Project source binding saved.');
  };
  const importRelease = (event) => {
    event.preventDefault(); if (!projectId || !sourceBinding || isArchived) return;
    void mutate(async (isCurrentSession) => {
      const result = await json(`/api/projects/${encodeURIComponent(projectId)}/releases`, token, { method: 'POST', body: JSON.stringify({ repositoryId: sourceBinding.repositoryId, commit: releaseForm.commit, folder: sourceBinding.folder }) });
      if (!isCurrentSession()) return null;
      const imported = result.release || result;
      if (imported.id) {
        const full = await json(`/api/releases/${imported.id}`, token);
        if (!isCurrentSession()) return null;
        return { release: full.release || full };
      }
      return { release: imported };
    }, 'Repository release imported and validated.', (outcome) => {
      if (outcome?.release) setRelease(outcome.release);
      setTab('release');
    });
  };
  const makePlan = (event) => {
    event.preventDefault(); if (!release?.id || detail?.project?.archivedAt) return;
    const profileId = event.currentTarget.elements.profileId.value;
    void mutate(async () => {
      const result = await json(`/api/projects/${projectId}/plans`, token, { method: 'POST', body: JSON.stringify({ releaseId: release.id, profileId }) });
      return result.plan || result;
    }, 'Offline candidate plan created. Execution was not performed.', (createdPlan) => {
      setSelectedPlan(createdPlan.id);
      setTab('review');
    });
  };
  const decide = (decision) => {
    if (!plan || detail?.project?.archivedAt) return;
    void mutate(async () => {
      const result = await json(`/api/plans/${plan.id}/decision`, token, { method: 'POST', body: JSON.stringify({ decision, reason: decisionReason }) });
      return result.plan || result;
    }, `Plan ${decision.toLowerCase()}d. Execution remains NOT_EXECUTED.`, (decidedPlan) => {
      setSelectedPlan(decidedPlan.id || plan.id);
      setDecisionReason('');
    });
  };

  const archiveProject = (event) => {
    event.preventDefault();
    if (!projectId || !archiveReason.trim() || detail?.project?.archivedAt) return;
    void mutate(async () => {
      await json(`/api/projects/${encodeURIComponent(projectId)}/archive`, token, {
        method: 'POST', body: JSON.stringify({ reason: archiveReason.trim() }),
      });
    }, 'Project archived. Existing project details and history remain available.', () => setArchiveReason(''));
  };

  const inspectRelease = async (releaseId) => {
    const sequence = refreshSequence.current;
    const inspectedProjectId = projectId;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await json(`/api/releases/${encodeURIComponent(releaseId)}`, token);
      if (sequence !== refreshSequence.current || activeProjectId.current !== inspectedProjectId) return;
      setRelease(result.release || result);
      setNotice('Release files loaded for read-only inspection.');
    } catch (e) { if (sequence === refreshSequence.current && activeProjectId.current === inspectedProjectId) setError(explain(e)); }
    finally { if (sequence === refreshSequence.current && activeProjectId.current === inspectedProjectId) setBusy(false); }
  };

  const model = { actor, projects, projectId, selectProject, setRelease, setSelectedPlan, setDecisionReason, projectForm, setProjectForm, busy, createProject, detail, environmentName, setEnvironmentName, createEnvironment, profileForm, setProfileForm, createProfile, releaseForm, setReleaseForm, repositories, importRelease, release, makePlan, plans, plan, isApprover, setTab, decisionReason, decide, fmt, canArchive, isArchived, archivedAt, archiveReason, setArchiveReason, archiveProject, inspectRelease, sourceForm, setSourceForm, sourceBinding, boundRepository, projectLoaded, canBindSource, saveSourceBinding };

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
      <button type="button" className={`nav-item ${tab === 'workspace' ? 'active' : ''}`} onClick={() => setTab('workspace')}><span>▦</span> Projects</button>
      <button type="button" className={`nav-item ${tab === 'release' ? 'active' : ''}`} onClick={() => setTab('release')}><span>◫</span> Releases</button>
      <button type="button" className={`nav-item ${tab === 'review' ? 'active' : ''}`} onClick={() => setTab('review')}><span>◇</span> Plans &amp; review</button>
      <button type="button" className={`nav-item ${tab === 'records' ? 'active' : ''}`} onClick={() => setTab('records')}><span>≡</span> Audit &amp; history</button>
      <div className="sidebar-bottom"><div className="user-avatar">{(actor.name || actor.role || 'U').slice(0, 1).toUpperCase()}</div><div className="user-meta"><strong>{actor.name || actor.id || 'Signed in'}</strong><small>{actor.role}</small></div><button type="button" className="icon-button" aria-label="Sign out" title="Sign out" onClick={() => { sessionEpoch.current += 1; refreshSequence.current += 1; activeProjectId.current = ''; setActor(null); setToken(''); setDetail(null); setProjects([]); setRepositories([]); setProjectId(''); setRelease(null); setSelectedPlan(''); setDecisionReason(''); setSourceForm({ repositoryId: '', folder: 'migrations' }); setReleaseForm({ repositoryId: '', commit: 'HEAD', folder: 'migrations' }); setBusy(false); setError(''); setNotice(''); }}>↗</button></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div><span className="crumb">Workspace</span><span className="crumb-sep">/</span><strong>{pageTitles[tab] || pageTitles.workspace}</strong></div><div className="topbar-right"><span className="role-pill">{actor.role}</span><button type="button" className="icon-button refresh" aria-label="Refresh workspace" onClick={() => { void refresh(token); }} disabled={busy}>↻</button></div></header>
      {(error || notice) && <div className={`banner ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{error || notice}<button type="button" className="banner-close" onClick={() => { setError(''); setNotice(''); }} aria-label="Dismiss message">×</button></div>}
      <div className="content">
        {tab === 'workspace' && <WorkspaceScreen model={model} />}
        {tab === 'release' && <ReleaseScreen model={model} />}
        {tab === 'review' && <ReviewScreen model={model} />}
        {tab === 'records' && <RecordsScreen model={model} />}
      </div>
      <footer className="footer"><span>SchemaForge <span className="footer-sep">·</span> Governance workspace</span><span>Local time · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></footer>
    </main>
  </div>;
}

function WorkspaceScreen({ model }) {
  const { projects, projectId, selectProject, projectForm, setProjectForm, busy, createProject, detail, environmentName, setEnvironmentName, createEnvironment, profileForm, setProfileForm, createProfile, isArchived, archivedAt, canArchive, archiveReason, setArchiveReason, archiveProject, fmt } = model;
  return <>
          <div className="page-heading"><div><p className="eyebrow">PRODUCT WORKSPACE</p><h1>Your projects</h1><p className="muted">Organize environments and connection references before preparing a migration review.</p></div><div className="heading-mark">01 <span> / 04</span></div></div>
          <div className="workspace-grid">
            <section className="panel project-panel"><div className="panel-heading"><div><h2>Project space</h2><p>Choose a project to see its delivery context.</p></div><span className="count-pill">{projects.length} total</span></div>
              {projects.length ? <div className="project-list">{projects.map((p) => <button type="button" key={p.id} className={`project-row ${projectId === p.id ? 'selected' : ''}`} onClick={() => selectProject(p.id)} disabled={busy}><span className="project-icon">{p.name.slice(0, 1).toUpperCase()}</span><span className="project-copy"><strong>{p.name}</strong><small>{p.description || 'No description provided'}</small></span>{p.archivedAt && <span className="status-pill neutral">ARCHIVED</span>}<span className="row-arrow">›</span></button>)}</div> : <div className="empty-state"><span className="empty-icon">＋</span><strong>No projects yet</strong><span>Create a project to start organizing database changes.</span></div>}
              <form className="inline-form project-create" onSubmit={createProject}><label className="sr-only" htmlFor="project-name">New project name</label><input id="project-name" placeholder="New project name" value={projectForm.name} onChange={(e) => setProjectForm({ ...projectForm, name: e.target.value })} required/><button type="submit" className="secondary" disabled={busy}>Create project</button><label className="sr-only" htmlFor="project-description">Project description</label><input id="project-description" className="wide-input" placeholder="Description (optional)" value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })}/></form>
            </section>
            <section className="panel context-panel"><div className="panel-heading"><div><h2>{detail?.project?.name || 'Project context'} {detail?.project?.archivedAt && <span className="status-pill neutral">ARCHIVED</span>}</h2><p>Configuration for the selected project.</p></div><span className="context-icon">⌘</span></div>
              {isArchived && <output className="archive-notice"><strong>Project archived</strong><span>Archived {fmt(archivedAt)}. New changes are disabled; existing releases, plans, and records remain readable.</span></output>}
              {!detail ? <div className="empty-state compact">Select or create a project to continue.</div> : <>
                <div className="section-title"><span>01</span><strong>Environments</strong></div>
                <div className="chip-list">{(detail.environments || []).map((env) => <span className="data-chip" key={env.id}><i/> {env.name}</span>)}{!detail.environments?.length && <span className="subtle">No environments configured</span>}</div>
                <form className="inline-form" onSubmit={createEnvironment}><label className="sr-only" htmlFor="environment-name">Environment name</label><input id="environment-name" placeholder="e.g. Development" value={environmentName} onChange={(e) => setEnvironmentName(e.target.value)} required disabled={busy || isArchived}/><button type="submit" className="text-button" disabled={busy || isArchived}>＋ Add</button></form>
                <div className="section-title section-spaced"><span>02</span><strong>Connection profiles</strong><small>{(detail.profiles || []).length} profiles</small></div>
                <div className="profile-list">{(detail.profiles || []).map((profile) => <div className="profile-row" key={profile.id}><span className="profile-icon">◎</span><span><strong>{profile.name}</strong><small>{profile.host}:{profile.port}/{profile.service} · {profile.username}</small></span><span className="ref-badge">ref only</span></div>)}{!detail.profiles?.length && <p className="subtle">No connection profiles yet.</p>}</div>
                <details className="form-disclosure"><summary>{isArchived ? 'Connection profile form unavailable' : 'Add Oracle profile'}</summary><form className="profile-form" onSubmit={createProfile}><fieldset className="profile-fields" disabled={busy || isArchived}><label>Name<input aria-label="Profile name" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} required/></label><label>Environment<select aria-label="Profile environment" value={profileForm.environmentId} onChange={(e) => setProfileForm({ ...profileForm, environmentId: e.target.value })} required><option value="">Choose environment</option>{(detail.environments || []).map((env) => <option key={env.id} value={env.id}>{env.name}</option>)}</select></label><label>Host<input aria-label="Database host" value={profileForm.host} onChange={(e) => setProfileForm({ ...profileForm, host: e.target.value })} required/></label><label>Port<input aria-label="Database port" type="number" value={profileForm.port} onChange={(e) => setProfileForm({ ...profileForm, port: e.target.value })} required/></label><label>Service<input aria-label="Oracle service" value={profileForm.service} onChange={(e) => setProfileForm({ ...profileForm, service: e.target.value })} required/></label><label>Username<input aria-label="Database username" value={profileForm.username} onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })} required/></label><label className="full-width">Credential reference<input aria-label="Credential reference" placeholder="vault://team/reference" value={profileForm.credentialRef} onChange={(e) => setProfileForm({ ...profileForm, credentialRef: e.target.value })} required/><small>Enter a reference only. Password fields are never sent or stored here.</small></label></fieldset><button type="submit" className="primary" disabled={busy || isArchived}>Save profile</button></form></details>
                {canArchive && !isArchived && <form className="archive-form" onSubmit={archiveProject}><label htmlFor="archive-reason">Archive project</label><p>Archiving preserves records but prevents new environments, profiles, releases, plans, and decisions.</p><textarea id="archive-reason" aria-label="Archive reason" value={archiveReason} onChange={(event) => setArchiveReason(event.target.value)} placeholder="Reason for archiving this project" required/><button type="submit" className="danger-button" disabled={busy || !archiveReason.trim()}>Archive project</button></form>}
              </>}
            </section>
          </div>

  </>;
}


function SourceBindingPanel({ model }) {
  const { projectId, projectLoaded, sourceBinding, boundRepository, sourceForm, setSourceForm,
    repositories, busy, canBindSource, isArchived, saveSourceBinding } = model;
  const validFolder = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(sourceForm.folder);
  const changed = sourceForm.repositoryId !== (sourceBinding?.repositoryId || '')
    || sourceForm.folder !== (sourceBinding?.folder || 'migrations');
  return <section className="panel source-binding-panel">
    <div className="panel-heading"><div><h2>Project source binding</h2><p>Choose a registered repository and migration folder. Local paths stay on the server.</p></div><span className="step-badge">SOURCE</span></div>
    {!projectLoaded && <p className="subtle" role="status">Loading the selected project source…</p>}
    {projectLoaded && sourceBinding && <p className="source-binding-current" aria-label="Current source binding"><strong>Bound source</strong><span>{boundRepository?.name || 'Registered repository unavailable'} · {sourceBinding.folder}</span></p>}
    {projectLoaded && !sourceBinding && <output className="source-binding-current"><strong>No source bound</strong><span>A developer must bind a repository and folder before release import.</span></output>}
    {projectLoaded && canBindSource && <form className="source-binding-form" onSubmit={saveSourceBinding}>
      <label>Registered repository<select aria-label="Source repository" value={sourceForm.repositoryId} onChange={(event) => setSourceForm({ ...sourceForm, repositoryId: event.target.value })} required disabled={busy || isArchived || !repositories.length}>
        <option value="">{repositories.length ? 'Choose registered repository' : 'No repositories registered'}</option>
        {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
      </select></label>
      <label>Migration folder<input aria-label="Source migration folder" value={sourceForm.folder} onChange={(event) => setSourceForm({ ...sourceForm, folder: event.target.value })} maxLength={200} pattern="[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*" title="Use slash-separated folder names with letters, numbers, underscores, or hyphens." required disabled={busy || isArchived}/><small>Use slash-separated folder names, for example <code>migrations</code>.</small></label>
      <div className="source-binding-actions"><button type="submit" className="secondary" disabled={busy || isArchived || !repositories.length || !sourceForm.repositoryId || !validFolder || !changed}>{busy ? 'Saving…' : sourceBinding ? 'Update source binding' : 'Save source binding'}</button>{isArchived && <span className="subtle">Archived projects cannot change their source.</span>}</div>
    </form>}
    {projectLoaded && !canBindSource && !sourceBinding && <p className="subtle">Ask a developer to bind a source for this project.</p>}
  </section>;
}

function ReleaseScreen({ model }) {
  const { projectId, selectProject, projects, releaseForm, setReleaseForm, repositories, busy, importRelease, release, detail, makePlan, isArchived, inspectRelease, fmt, sourceBinding, boundRepository, projectLoaded, sourceForm } = model;
  const bindingDraftMatches = Boolean(sourceBinding && boundRepository
    && sourceForm.repositoryId === sourceBinding.repositoryId && sourceForm.folder === sourceBinding.folder);
  return <>
          <div className="page-heading"><div><p className="eyebrow">MIGRATION INTAKE</p><h1>Import a release</h1><p className="muted">Select an allowlisted Git repository and an immutable commit to inspect migration files.</p></div><div className="heading-mark">02 <span> / 04</span></div></div>
          {isArchived && <output className="archive-notice"><strong>Archived project</strong><span>Existing release details can still be reviewed. Importing new releases is disabled.</span></output>}
          <SourceBindingPanel model={model} />
          <section className="panel saved-releases"><div className="panel-heading"><div><h2>Existing releases</h2><p>Open an imported release to review migration files and SQL.</p></div><span className="count-pill">{detail?.releases?.length || 0} releases</span></div>{detail?.releases?.length ? <div className="saved-release-list">{detail.releases.map((item) => <div className="saved-release-row" data-release-id={item.id} key={item.id}><span><strong>{item.commit?.slice(0, 12)} · {item.folder}</strong><small>Imported {fmt(item.createdAt)} · {item.validationStatus}</small></span><button type="button" className="secondary" onClick={() => { void inspectRelease(item.id); }} disabled={busy}>Inspect files</button></div>)}</div> : <p className="subtle">No releases imported for this project yet.</p>}</section>
          <section className="panel intake-panel"><div className="panel-heading"><div><h2>Repository source</h2><p>Repository paths stay on the server. The browser sends only the repository ID.</p></div><span className="step-badge">GIT</span></div>
            <form className="release-form" onSubmit={importRelease}><label>Project<select aria-label="Release project" value={projectId} onChange={(e) => selectProject(e.target.value)} required disabled={busy}><option value="">Choose project</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.archivedAt ? ' · ARCHIVED' : ''}</option>)}</select></label><label>Bound repository<output aria-label="Bound repository" className="bound-source-value">{projectLoaded ? boundRepository?.name || (sourceBinding ? 'Registered repository unavailable' : 'No source bound') : 'Loading project source…'}</output></label><label>Commit or ref<input aria-label="Git commit or ref" value={releaseForm.commit} onChange={(e) => setReleaseForm({ ...releaseForm, commit: e.target.value })} placeholder="40 character commit SHA" required disabled={busy || isArchived || !bindingDraftMatches}/><small>Use a commit SHA for a reproducible release.</small></label><label>Bound migration folder<output aria-label="Bound migration folder" className="bound-source-value">{projectLoaded ? sourceBinding?.folder || 'No source bound' : 'Loading project source…'}</output></label><div className="form-actions"><button type="submit" className="primary" disabled={busy || isArchived || !projects.length || !bindingDraftMatches}>{busy ? 'Importing…' : 'Import and validate'}</button><span className="subtle">{!sourceBinding ? 'Save a project source binding before importing.' : !bindingDraftMatches ? 'Save the changed source binding before importing.' : 'Release import uses the saved repository and folder.'} Files are parsed before a plan can be created.</span></div></form>
          </section>
          {release && <section className="panel release-result"><div className="panel-heading"><div><p className="eyebrow">IMPORTED RELEASE</p><h2>{release.commit?.slice(0, 12)} <span className="muted">· {release.folder}</span></h2></div><span className={`status-pill ${importStatusClass(release.validationStatus)}`}>{release.validationStatus}</span></div>{release.validationCode && <p className="banner warning">{release.validationCode}</p>}<div className="file-table-wrap"><table><thead><tr><th>Migration file</th><th>Version</th><th>Statements</th><th>Bytes</th><th>Validation</th></tr></thead><tbody>{(release.files || []).map((file) => <tr key={file.path}><td><code>{file.path}</code></td><td>{file.version || '—'}</td><td>{file.statementCount ?? '—'}</td><td>{file.bytes ?? '—'}</td><td><span className={`status-pill ${importStatusClass(file.validationStatus)}`}>{file.validationStatus}</span></td></tr>)}</tbody></table>{!release.files?.length && <div className="empty-inline">No migration files were returned for this release.</div>}</div>{(release.files || []).map((file) => <details className="sql-preview" key={`${file.path}-sql`}><summary>Preview SQL · {file.path}</summary><pre>{file.content || 'Source content unavailable.'}</pre></details>)}{(release.validationStatus === 'VALID') && <form className="plan-form" onSubmit={makePlan}><label>Target connection profile<select name="profileId" aria-label="Target connection profile" required disabled={busy || isArchived}><option value="">Choose profile</option>{(detail?.profiles || []).map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.host}/{profile.service}</option>)}</select></label><button type="submit" className="primary" disabled={busy || isArchived || !detail?.profiles?.length}>Prepare offline plan</button><span className="offline-note">This creates a review candidate. It does not connect to Oracle.</span></form>}</section>}

  </>;
}


function ReviewScreen({ model }) {
  const { plans, detail, plan, isApprover, setTab, setSelectedPlan, decisionReason, setDecisionReason, busy, decide, fmt, isArchived } = model;
  return <>
          <div className="page-heading"><div><p className="eyebrow">GOVERNANCE</p><h1>Plans &amp; review</h1><p className="muted">Review the exact migration candidate and record an independent decision.</p></div><div className="heading-mark">03 <span> / 04</span></div></div>
          <section className="notice-card"><span className="notice-icon">i</span><div><strong>{isArchived ? 'Archived project · read only' : 'Offline candidate only'}</strong><p>Target history has not been observed. Database execution is unavailable and remains <b>NOT_EXECUTED</b>. {isArchived && 'Review decisions are disabled for archived projects.'}</p></div><span className="scope-tag">{plan?.planningScope || 'OFFLINE_CANDIDATE'}</span></section>
          <section className="panel plan-panel"><div className="panel-heading"><div><h2>Candidate plans</h2><p>Plans preserve source checksums and explicit execution status.</p></div><span className="count-pill">{plans.length} plans</span></div>
            {!plans.length ? <div className="empty-state"><span className="empty-icon">◇</span><strong>No plans to review</strong><span>Import a valid release and prepare an offline candidate plan first.</span><button type="button" className="text-button" onClick={() => setTab('release')}>Go to release intake →</button></div> : <>
              <div className="plan-selector">{plans.map((item) => { const sourceRelease = (detail.releases || []).find((candidate) => candidate.id === item.releaseId); return <button type="button" key={item.id} onClick={() => setSelectedPlan(item.id)} className={`plan-option ${(plan?.id === item.id) ? 'selected' : ''}`}><span className={`status-dot ${planMarkerClass(item.status)}`}/><span><strong>{sourceRelease?.commit?.slice(0, 12) || `Plan ${item.id.slice(0, 8)}`}</strong><small>{fmt(item.createdAt || item.created_at)}</small></span><span className={`status-pill ${decisionClass(item.status)}`}>{item.status?.replaceAll('_', ' ')}</span></button>; })}</div>
              {plan && <><div className="plan-summary"><div><span className="data-label">PLAN ID</span><code>{plan.id}</code></div><div><span className="data-label">DECISION</span><span className={`status-pill ${decisionClass(plan.status)}`}>{plan.status?.replaceAll('_', ' ')}</span></div><div><span className="data-label">TARGET HISTORY</span><strong>{plan.historyStatus || 'NOT_OBSERVED'}</strong></div><div><span className="data-label">EXECUTION</span><strong className="not-executed">{plan.execution || 'NOT_EXECUTED'}</strong></div></div><div className="file-table-wrap"><table><thead><tr><th>Migration</th><th>Version</th><th>SHA-256</th><th>State</th></tr></thead><tbody>{(plan.items || []).map((item) => <tr key={item.path}><td><code>{item.path}</code></td><td>{item.version || '—'}</td><td><code className="checksum">{item.sha256}</code></td><td><span className="status-pill neutral">{item.status || 'NOT_EXECUTED'}</span></td></tr>)}</tbody></table></div>
                {isApprover && plan.status === 'PENDING_APPROVAL' && <div className="decision-box"><label htmlFor="decision-reason">Decision reason</label><textarea id="decision-reason" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} placeholder="Record why this candidate is approved or rejected" required disabled={isArchived}/><div><button type="button" className="danger-button" onClick={() => decide('REJECT')} disabled={busy || isArchived || !decisionReason.trim()}>Reject plan</button><button type="button" className="primary" onClick={() => decide('APPROVE')} disabled={busy || isArchived || !decisionReason.trim()}>Approve plan</button></div><small>Approval records governance only. It does not authorize or perform execution in this product.</small></div>}
                {!isApprover && plan.status === 'PENDING_APPROVAL' && <p className="banner warning">Awaiting an approver. Your current role can prepare plans but cannot decide them.</p>}
              </>}
            </>}
          </section>

  </>;
}


function RecordsScreen({ model }) {
  const { detail, actor, fmt, isArchived } = model;
  return <>
          <div className="page-heading"><div><p className="eyebrow">TRACEABILITY</p><h1>Audit &amp; history {isArchived && <span className="status-pill neutral">ARCHIVED</span>}</h1><p className="muted">See governance events alongside the recorded migration outcomes.</p></div><div className="heading-mark">04 <span> / 04</span></div></div>
          <div className="records-grid"><section className="panel"><div className="panel-heading"><div><h2>Audit events</h2><p>Actions recorded for this project.</p></div><span className="count-pill">{detail?.audit?.length || 0} events</span></div><div className="timeline">{(detail?.audit || []).map((item) => <div className="timeline-row" key={item.id}><span className="timeline-dot"/><div><strong>{item.action || item.event || 'Project event'}</strong><p>{item.facts?.reason || item.summary || item.reason || 'Governance record'}</p><small>{auditActorLabel(item, actor)} · {fmt(item.createdAt || item.created_at)}</small></div></div>)}{!detail?.audit?.length && <div className="empty-state compact"><strong>No audit events yet</strong><span>Project changes and review decisions will appear here.</span></div>}</div></section><section className="panel"><div className="panel-heading"><div><h2>Migration history</h2><p>Recorded migration states; these are not evidence of database application.</p></div><span className="count-pill">{detail?.history?.length || 0} records</span></div><div className="history-list">{(detail?.history || []).map((item) => <div className="history-row" key={item.id}><div><strong>{item.path || item.version || 'Migration event'}</strong><small>{fmt(item.executedAt || item.createdAt)}</small></div><span className={`status-pill ${item.status === 'SUCCEEDED' ? 'good' : 'neutral'}`}>{item.status || 'NOT_OBSERVED'}</span></div>)}{!detail?.history?.length && <div className="empty-state compact"><strong>No migration records yet</strong><span>Candidate plans add NOT_EXECUTED records; they do not imply database application.</span></div>}</div></section></div>
          <p className="history-footnote"><span className="status-dot"/> Unknown target history stays unknown until a trusted runtime observes it.</p>

  </>;
}

createRoot(document.getElementById('root')).render(<App />);
