import React, { useEffect, useRef, useState } from 'react';

export function Account({ token, api }) {
  const [access, setAccess] = useState(null), [sessions, setSessions] = useState(null);
  const [login, setLogin] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState(''), [newPassword, setNewPassword] = useState(''), [confirmPassword, setConfirmPassword] = useState('');
  const epoch = useRef(0);
  const load = async () => {
    const current = ++epoch.current; setBusy(true); setError(''); setAccess(null); setSessions(null);
    try {
      const [a, s, l] = await Promise.all([api('/api/account/access', token), api('/api/account/sessions', token), api('/api/account/login', token)]);
      if (current === epoch.current) { setAccess(a); setSessions(s); setLogin(l); }
    } catch { if (current === epoch.current) setError('Account information unavailable. Refresh to retry.'); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  useEffect(() => { void load(); return () => { epoch.current += 1; }; }, [token]);
  const more = async (kind) => {
    const current = ++epoch.current, previous = kind === 'access' ? access : sessions;
    setBusy(true); setError('');
    try {
      const result = await api(`/api/account/${kind}?after=${encodeURIComponent(previous.nextCursor)}`, token);
      if (current === epoch.current) {
        if (kind === 'access') setAccess({ ...result, projects: [...previous.projects, ...result.projects] });
        else setSessions({ ...result, sessions: [...previous.sessions, ...result.sessions] });
      }
    } catch { if (current === epoch.current) { setAccess(null); setSessions(null); setError('Account information unavailable. Refresh to retry.'); } }
    finally { if (current === epoch.current) setBusy(false); }
  };
  const revoke = async (id) => {
    const current = ++epoch.current; setBusy(true); setError('');
    try {
      await api(`/api/account/sessions/${id}/revoke`, token, { method: 'POST' });
      if (current === epoch.current) await load();
    } catch { if (current === epoch.current) { setAccess(null); setSessions(null); setError('Session revocation failed. Refresh and retry.'); } }
    finally { if (current === epoch.current) setBusy(false); }
  };
  const fmt = (value) => new Date(value).toLocaleString();
  const changePassword = async event => {
    event.preventDefault(); setError('');
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await api('/api/account/password', token, { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword(''); window.location.assign('/');
    } catch { setError('Password change failed. Check your current password or ask your operator to reset access.'); }
    finally { setBusy(false); }
  };
  return <section aria-label="Account and access">
    <div className="page-heading"><div><p className="eyebrow">IDENTITY &amp; ACCESS</p><h1>Account &amp; access</h1><p className="muted">Review your sign-in, project grants, and active browser sessions.</p></div><button className="secondary" disabled={busy} onClick={() => void load()}>Refresh account</button></div>
    {error && <p role="alert" className="banner error">{error}</p>}
    {busy && <p role="status">Loading account information…</p>}
    {(login || access || sessions) && <section className="identity-summary-grid" aria-label="Account summary">
      {login && <article className="identity-summary-card"><p className="eyebrow">LOCAL SIGN-IN</p><h2>{login.configured ? login.username : 'Not set up'}</h2><p className="muted">{login.configured ? (login.disabled ? 'Disabled · contact your operator' : 'Username and password') : 'Use the operator-issued setup token to create a password.'}</p></article>}
      {access && <article className="identity-summary-card"><p className="eyebrow">PROJECT ACCESS</p><h2>{access.projects.length} {access.projects.length === 1 ? 'project' : 'projects'}</h2><p className="muted">{access.actor.name} · {access.actor.role}</p></article>}
      {sessions && <article className="identity-summary-card"><p className="eyebrow">BROWSER SESSIONS</p><h2>{sessions.sessions.length}{sessions.nextCursor ? '+' : ''} active</h2><p className="muted">Sessions expire after 30 minutes idle or at their absolute deadline.</p></article>}
    </section>}
    {access?.accessMode === 'BOOTSTRAP_REQUIRED' && <p role="status" className="banner warning">Access bootstrap required. The operator must activate membership and grant project access.</p>}
    {token.startsWith('session:') && login?.configured && !login.disabled && <section className="panel"><h2>Change password</h2>
      <p>Changing your local password signs out all browser sessions. Your role and project grants stay the same. A local password must already be set up.</p>
      <form className="stack" onSubmit={changePassword}>
        <label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" maxLength={128} required disabled={busy} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
        <label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required disabled={busy} value={newPassword} onChange={e => setNewPassword(e.target.value)} />
        <label htmlFor="confirm-new-password">Confirm new password</label><input id="confirm-new-password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required disabled={busy} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
        <button className="primary" type="submit" disabled={busy}>Change password and sign out</button>
      </form></section>}
    {access && <details className="identity-detail-list identity-detail"><summary>Your project access</summary><section className="panel"><h2>Project access details</h2><p>{access.actor.name} · {access.actor.role} · <code>{access.actor.id}</code></p>
      <p className="muted">The trusted operator provisions identities, rotates access tokens and explicitly grants or revokes project and deployment access. Contact your operator with your actor ID and project ID. Approvers cannot approve their own plans.</p>
      {!access.projects.length && <p>No assigned projects.</p>}
      {access.projects.map(project => <article key={project.id} className="schema-reference-card"><h3>{project.name}</h3><p><code>{project.id}</code></p><p>{project.archivedAt ? 'Archived · read only' : 'Project member'} · Independent review: {project.canReview ? 'role permits review' : 'unavailable'} · Deployment requests: {project.canDeploy ? 'granted' : 'unavailable'}</p></article>)}
      {access.nextCursor && <button className="secondary" disabled={busy} onClick={() => void more('access')}>Load more access</button>}
    </section></details>}
    {sessions && <details className="identity-detail-list identity-detail"><summary>Active browser sessions</summary><section className="panel"><h2>Session details</h2><p>Revoke another session to sign it out. Use Sign out for this session. Sessions expire after 30 minutes idle or at their absolute deadline.</p>
      {!sessions.sessions.length && <p>No active browser sessions. HTTP development uses a token kept in this tab’s memory.</p>}
      {sessions.sessions.map(session => <article className="schema-reference-card" key={session.id}><h3>{session.current ? 'This browser session' : 'Other browser session'}</h3><p>Signed in {fmt(session.issuedAt)} · Idle deadline {fmt(session.idleExpiresAt)} · Absolute deadline {fmt(session.absoluteExpiresAt)}</p>
        {!session.current && <button className="secondary" disabled={busy} onClick={() => void revoke(session.id)} aria-label={`Revoke session ${session.id}`}>Revoke session</button>}</article>)}
      {sessions.nextCursor && <button className="secondary" disabled={busy} onClick={() => void more('sessions')}>Load more sessions</button>}
    </section></details>}
  </section>;
}
