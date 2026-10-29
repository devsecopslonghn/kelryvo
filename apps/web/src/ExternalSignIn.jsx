import React, { useEffect, useState } from 'react';

/** Optional configured identity providers. Local password sign-in remains the primary path. */
export default function ExternalSignIn({ api, onSignedIn, busy, setBusy }) {
  const [providers, setProviders] = useState([]), [selected, setSelected] = useState(null);
  const [username, setUsername] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    api('/api/auth/methods', '').then(result => {
      if (current) setProviders(Array.isArray(result.providers) ? result.providers.filter(p =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && ['OIDC', 'LDAP'].includes(p.kind)) : []);
    }).catch(() => { if (current) setProviders([]); });
    return () => { current = false; };
  }, [api]);

  const start = async provider => {
    setBusy(true); setError('');
    try {
      if (provider.kind === 'OIDC') {
        const result = await api(`/api/auth/oidc/${encodeURIComponent(provider.id)}/start`, '', { method: 'POST', credentials: 'same-origin', body: '{}' });
        const destination = new URL(result.authorizationUrl);
        if (destination.protocol !== 'https:') throw new Error('PROVIDER_UNAVAILABLE');
        window.location.assign(destination.href);
        return;
      }
      setSelected(provider);
    } catch { setError('That sign-in provider is unavailable. Local password sign-in remains available.'); }
    finally { setBusy(false); }
  };
  const submitLdap = async event => {
    event.preventDefault(); if (!selected) return;
    setBusy(true); setError('');
    try {
      const session = await api(`/api/auth/ldap/${encodeURIComponent(selected.id)}/session`, '', {
        method: 'POST', credentials: 'same-origin', body: JSON.stringify({ username: username.trim(), password }),
      });
      setPassword(''); setUsername(''); await onSignedIn(session);
    } catch { setPassword(''); setError('Username or password was not accepted, or this provider is unavailable.'); }
    finally { setBusy(false); }
  };
  if (!providers.length) return null;
  return <section className="login-providers" aria-label="Other sign-in methods">
    <h2>Organization sign-in</h2>
    <div className="login-provider-options">
    {providers.filter(p => p.kind === 'OIDC').map(provider => <button key={provider.id} className="secondary" type="button"
      disabled={busy} onClick={() => void start(provider)}>Continue with {provider.name}</button>)}
    {providers.filter(p => p.kind === 'LDAP').map(provider => <div key={provider.id}>
      {!selected || selected.id !== provider.id ? <button className="secondary" type="button" disabled={busy}
        onClick={() => { setError(''); setSelected(provider); }}>Sign in with {provider.name}</button> :
        <form className="stack login-form login-directory" onSubmit={submitLdap}>
          <h3>{provider.name}</h3>
          <label htmlFor="identity-ldap-username">Username</label>
          <input id="identity-ldap-username" autoComplete="username" value={username} maxLength={256}
            onChange={e => setUsername(e.target.value)} disabled={busy} required />
          <label htmlFor="identity-ldap-password">Password</label>
          <input id="identity-ldap-password" type="password" autoComplete="current-password" value={password} maxLength={512}
            onChange={e => setPassword(e.target.value)} disabled={busy} required />
          <button className="secondary" type="submit" disabled={busy}>Sign in</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => { setSelected(null); setPassword(''); }}>Cancel</button>
        </form>}
    </div>)}
    </div>
    {error && <p className="banner error" role="alert">{error}</p>}
  </section>;
}
