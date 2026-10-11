import React, { useEffect, useRef, useState } from 'react';

export default function PlanRecord({ projectId, planId, token, request }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0), pending = useRef(false);
  useEffect(() => () => { epoch.current++; }, []);
  const download = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const current = epoch.current;
    try {
      const record = await request(`/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/record`, token);
      if (current !== epoch.current) return;
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
    {error && <p role="alert">{error}</p>}
  </section>;
}
