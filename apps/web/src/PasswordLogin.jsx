import React, { useState } from 'react';

export default function PasswordLogin({ api, onSignedIn, busy, setBusy }) {
  const [setup, setSetup] = useState(false), [username, setUsername] = useState('');
  const [password, setPassword] = useState(''), [confirm, setConfirm] = useState(''), [proof, setProof] = useState('');
  const [error, setError] = useState(''), [created, setCreated] = useState(false);
  const submit = async event => {
    event.preventDefault(); setError('');
    if (setup && password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    try {
      const name = username.trim().toLowerCase();
      if (setup) {
        await api('/api/auth/setup', proof.trim(), { method: 'POST', body: JSON.stringify({ username: name, password }), credentials: 'omit' });
        setCreated(true); setSetup(false); setProof(''); setConfirm('');
      }
      const session = await api('/api/session', '', {
        method: 'POST', body: JSON.stringify({ username: name, password }), credentials: 'same-origin',
      });
      setPassword(''); await onSignedIn(session);
    } catch (e) {
      const message = {
        INVALID_PASSWORD_SETUP: 'Use a username of 3–64 lowercase letters, digits, dots, underscores or hyphens, starting with a letter, and a password of 15–128 characters.',
        PASSWORD_SETUP_UNAVAILABLE: 'Setup is unavailable for this account or username. Sign in if already set up, or ask the operator to reset access.',
        AUTH_UNAVAILABLE: 'Password sign-in is unavailable during recovery or until the operator restores access.',
        AUTH_BUSY: 'Sign-in is busy. Wait a moment and try again.',
        HTTPS_REQUIRED: 'Password sign-in requires HTTPS.',
        UNAUTHENTICATED: setup ? 'The setup token was not accepted. Ask the operator for a current token.' : 'Username or password was not accepted.',
        HTTP_429: 'Too many sign-in attempts. Wait a minute and try again.',
        RATE_LIMITED: 'Too many sign-in attempts. Wait a minute and try again.',
      }[e.message];
      setError(message || 'Sign-in could not be completed. Check your details and try again.');
      setPassword(''); setConfirm(''); setProof('');
    } finally { setBusy(false); }
  };
  return <section aria-label={setup ? 'First account setup' : 'Password sign in'}>
    <h2 className={setup ? '' : 'sr-only'}>{setup ? 'Set up your local account' : 'Sign in'}</h2>
    {created && <p role="status">Your account is set up. Sign in with your username and password.</p>}
    {setup && <p className="muted">Use the setup token supplied by your operator. Your existing role and project access are preserved. Set up the developer and approver separately.</p>}
    <form className="stack login-form" onSubmit={submit}>
      <label htmlFor="login-username">Username</label>
      <input id="login-username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={64}
        value={username} onChange={e => setUsername(e.target.value)} disabled={busy} required />
      <label htmlFor="login-password">{setup ? 'New password' : 'Password'}</label>
      <input id="login-password" type="password" autoComplete={setup ? 'new-password' : 'current-password'}
        minLength={setup ? 15 : undefined} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={busy} required />
      {setup && <>
        <p className="fine-print">Use a unique passphrase of 15–128 characters. Spaces are allowed.</p>
        <label htmlFor="login-confirm">Confirm password</label>
        <input id="login-confirm" type="password" autoComplete="new-password" maxLength={128}
          value={confirm} onChange={e => setConfirm(e.target.value)} disabled={busy} required />
        <label htmlFor="setup-token">Setup token</label>
        <input id="setup-token" type="password" autoComplete="off" maxLength={4096}
          value={proof} onChange={e => setProof(e.target.value)} disabled={busy} required />
      </>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : setup ? 'Create local login' : 'Sign in'}</button>
    </form>
    {error && <p className="banner error" role="alert">{error}</p>}
    <button className="text-button login-setup" type="button" disabled={busy} onClick={() => {
      setSetup(!setup); setError(''); setCreated(false); setPassword(''); setConfirm(''); setProof('');
    }}>{setup ? 'Back to sign in' : 'First time here? Set up your account'}</button>
    {!setup && <p className="fine-print">Forgot your password? Ask your operator to reset your local account.</p>}
  </section>;
}
