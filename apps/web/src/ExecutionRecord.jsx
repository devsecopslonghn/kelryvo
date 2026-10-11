import React, { useEffect, useRef, useState } from 'react';

export default function ExecutionRecord({ job, projectId, token, request }) {
  const epoch = useRef(0), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => () => { epoch.current++; }, []);
  const download = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    const current = epoch.current;
    try {
      const bundle = await request(`/api/execution-jobs/${encodeURIComponent(job.id)}/record`, token);
      if (current !== epoch.current) return;
      const record = JSON.parse(bundle.record);
      if (bundle.format !== 1 || bundle.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(bundle.sha256)
          || record.kind !== 'KELRYVO_EXECUTION_RECORD' || record.job?.id !== job.id
          || record.job.projectId !== projectId || record.job.planId !== job.planId
          || record.executionAuthority !== false || record.targetEffects !== 'NOT_ATTESTED') throw new Error('RECORD_UNAVAILABLE');
      const blob = new Blob([JSON.stringify(bundle, null, 2) + '\n'], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = `kelryvo-execution-${job.id}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (current === epoch.current) setError('Execution record unavailable. Refresh the workspace and try again.'); }
    finally { if (current === epoch.current) { pending.current = false; setBusy(false); } }
  };
  return <div>
    <button type="button" className="secondary" disabled={busy} onClick={download}>{busy ? 'Preparing execution record…' : 'Download execution record'}</button>
    <p className="muted">Includes the saved plan, approval and retained request, attempt and receipt records. Missing receipts leave target effects unknown. The checksum is not a signature; this file grants no execution authority.</p>
    {error && <p role="alert">{error}</p>}
  </div>;
}
