import React, { useEffect, useRef, useState } from 'react';

export function Account({ token, api, actor, onPasswordChanged, requiredChange = false }) {
  const [access, setAccess] = useState(null), [sessions, setSessions] = useState(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [passwords,setPasswords]=useState({currentPassword:'',newPassword:'',confirm:''});
  const epoch = useRef(0);
  const load = async () => {
    const current = ++epoch.current; setBusy(true); setError(''); setAccess(null); setSessions(null);
    try {
      const [a, s] = await Promise.all([api('/api/account/access', token), api('/api/account/sessions', token)]);
      if (current === epoch.current) { setAccess(a); setSessions(s); }
    } catch { if (current === epoch.current) setError('Account information unavailable. Refresh to retry.'); }
    finally { if (current === epoch.current) setBusy(false); }
  };
  useEffect(() => { if(!requiredChange) void load(); return () => { epoch.current += 1; }; }, [token,requiredChange]);
  const changePassword=async e=>{e.preventDefault();if(passwords.newPassword!==passwords.confirm){setError('The new passwords do not match.');return;}setBusy(true);setError('');try{const session=await api('/api/account/password',token,{method:'POST',body:JSON.stringify({currentPassword:passwords.currentPassword,newPassword:passwords.newPassword})});onPasswordChanged?.(session);setPasswords({currentPassword:'',newPassword:'',confirm:''});}catch{setError('Password change failed. Check your current password and the new password requirements.');}finally{setBusy(false);}};
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
  return <section aria-label="Account and access">
    <div className="page-heading"><div><p className="eyebrow">IDENTITY &amp; ACCESS</p><h1>{requiredChange?'Set your password':'Account & access'}</h1></div>{!requiredChange&&<button className="secondary" disabled={busy} onClick={() => void load()}>Refresh account</button>}</div>
    {requiredChange&&<p className="banner warning" role="status">Set a new password before opening the workspace.</p>}
    {error && <p role="alert" className="banner error">{error}</p>}
    {!requiredChange&&busy && <p role="status">Loading account information…</p>}
    <section className="panel"><h2>{requiredChange?'Choose a new password':'Change password'}</h2><form className="stack" onSubmit={changePassword}>
      {!requiredChange&&<><label htmlFor="current-password">Current password</label><input id="current-password" type="password" autoComplete="current-password" required value={passwords.currentPassword} onChange={e=>setPasswords({...passwords,currentPassword:e.target.value})}/></>}
      <label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={12} value={passwords.newPassword} onChange={e=>setPasswords({...passwords,newPassword:e.target.value})}/>
      <label htmlFor="confirm-password">Confirm new password</label><input id="confirm-password" type="password" autoComplete="new-password" required minLength={12} value={passwords.confirm} onChange={e=>setPasswords({...passwords,confirm:e.target.value})}/><button className="primary" disabled={busy}>{busy?'Updating…':'Update password'}</button></form></section>
    {!requiredChange&&access && <section className="panel"><h2>Your project access</h2><p>{access.actor.name} · {access.actor.role} · <code>{access.actor.id}</code></p><p className="muted">Project roles determine which actions you can take. Approvers cannot approve their own plans.</p>{access.accessMode === 'BOOTSTRAP_REQUIRED' && <p role="status" className="banner warning">Access bootstrap required. Ask a workspace administrator to grant project access.</p>}{!access.projects.length && <p>No assigned projects.</p>}{access.projects.map(project => <article key={project.id} className="schema-reference-card"><h3>{project.name}</h3><p><code>{project.id}</code></p><p>{project.archivedAt ? 'Archived · read only' : 'Project member'} · Review: {project.canReview ? 'available' : 'unavailable'} · Deployment requests: {project.canDeploy ? 'granted' : 'unavailable'}</p></article>)}{access.nextCursor && <button className="secondary" disabled={busy} onClick={() => void more('access')}>Load more access</button>}</section>}
    {!requiredChange&&sessions && <section className="panel"><h2>Active browser sessions</h2><p>Revoke another session to sign it out. Use Sign out for this session.</p>{!sessions.sessions.length && <p>No active browser sessions.</p>}{sessions.sessions.map(session => <article className="schema-reference-card" key={session.id}><h3>{session.current ? 'This browser session' : 'Other browser session'}</h3><p>Signed in {fmt(session.issuedAt)} · Idle deadline {fmt(session.idleExpiresAt)} · Absolute deadline {fmt(session.absoluteExpiresAt)}</p>{!session.current && <button className="secondary" disabled={busy} onClick={() => void revoke(session.id)} aria-label={`Revoke session ${session.id}`}>Revoke session</button>}</article>)}{sessions.nextCursor && <button className="secondary" disabled={busy} onClick={() => void more('sessions')}>Load more sessions</button>}</section>}
  </section>;
}
