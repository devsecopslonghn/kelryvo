import React, { useEffect, useRef, useState } from 'react';

export default function PlanRecord({ projectId, planId, token, request }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [savedTarget, setSavedTarget] = useState(null);
  const epoch = useRef(0), pending = useRef(false);
  useEffect(() => () => { epoch.current++; }, []);
  const download = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setSavedTarget(null);
    const current = epoch.current;
    try {
      const record = await request(`/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/record`, token);
      if (current !== epoch.current) return;
      const payload = typeof record?.record === 'string' ? JSON.parse(record.record) : null;
      const intent = payload?.retainedIntent;
      const target = intent?.target;
      const validFormat = record?.format === 1 && [1, 2].includes(intent?.format)
        || record?.format === 2 && [3,4].includes(intent?.format) && target && typeof target === 'object'
          && typeof target.exactOwner === 'string' && typeof target.migrationNamespace === 'string'
          && typeof target.bindingId === 'string' && typeof target.bindingRevision === 'string'
          && ['PROVISIONAL','OBSERVED','VERIFIED'].includes(target.identityState) && typeof target.routeAlias === 'string'
          && !Object.hasOwn(target, 'privatePrincipalRef') && !Object.hasOwn(target, 'credentialRef');
      if (!validFormat) throw new Error('RECORD_UNAVAILABLE');
      setSavedTarget(intent.format >= 3 ? {
        exactOwner: target.exactOwner,
        migrationNamespace: target.migrationNamespace,
        bindingId: target.bindingId,
        bindingRevision: target.bindingRevision,
        identityState: target.identityState,
        routeAlias: target.routeAlias,
      } : null);
      const blob = new Blob([JSON.stringify(record, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `kelryvo-plan-${planId}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (current === epoch.current) setError('Plan record unavailable. Refresh the workspace and try again.'); }
    finally { if (current === epoch.current) { pending.current = false; setBusy(false); } }
  };
  return <section aria-label="Download plan record" className="panel">
    <h3>Plan record</h3>
    <p>Download the saved intent and current decision, including any approval withdrawal. Includes migration and statement hashes; excludes SQL and credentials. This record does not prove execution.</p>
    <button type="button" className="secondary" disabled={busy} onClick={download}>{busy ? 'Preparing record…' : 'Download plan record'}</button>
    {savedTarget && <dl aria-label="Saved target in exported record" className="target-facts"><div><dt>Exact owner</dt><dd>{savedTarget.exactOwner}</dd></div><div><dt>Migration namespace</dt><dd>{savedTarget.migrationNamespace}</dd></div><div><dt>Target binding</dt><dd><code>{savedTarget.bindingId}</code> · revision {savedTarget.bindingRevision}</dd></div><div><dt>Identity state</dt><dd>{savedTarget.identityState}</dd></div><div><dt>Route</dt><dd>{savedTarget.routeAlias}</dd></div></dl>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
