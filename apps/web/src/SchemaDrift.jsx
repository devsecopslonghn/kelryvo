import React, { useEffect, useRef, useState } from 'react';

const encode = value => encodeURIComponent(value);
const printable = value => JSON.stringify(value, null, 2);
const coverageText = value => value && typeof value === 'object'
  ? Object.entries(value).map(([key, item]) => `${key}: ${typeof item === 'object' ? printable(item) : String(item)}`).join(' · ')
  : typeof value === 'string' ? value : 'Not reported';

export default function SchemaDrift({ token, projectId, planId, bindingId, request, onOpenSchema }) {
  const [value, setValue] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const epoch = useRef(0);
  const load = async () => {
    const current = ++epoch.current; setBusy(true); setError(''); setValue(null);
    try {
      const response = await request(planId ? `/api/projects/${encode(projectId)}/plans/${encode(planId)}/schema-drift` : `/api/projects/${encode(projectId)}/target-bindings/${encode(bindingId)}/schema`, token);
      const result=planId?response:response.drift;
      if (current !== epoch.current) return;
      if (!result || result.executionAuthority !== false) throw new Error('DRIFT_UNAVAILABLE');
      setValue(result);
    } catch (failure) {
      if (current === epoch.current) setError(['NOT_FOUND', 'UNAUTHENTICATED'].includes(failure?.message)
        ? 'Schema drift evidence is no longer available for this plan. Refresh the project.'
        : 'Schema drift evidence could not be loaded. Refresh the plan before reviewing.');
    } finally { if (current === epoch.current) setBusy(false); }
  };
  useEffect(() => { setValue(null); setError(''); void load(); return () => { epoch.current++; }; }, [token, projectId, planId, bindingId, request]);
  const comparison = value?.comparison || {};
  const changes = Array.isArray(comparison.changes) ? comparison.changes : [];
  const limitations = Array.isArray(comparison.limitations) ? comparison.limitations : [];
  const summary = comparison.summary || {};
  return <section className="panel schema-drift-summary" aria-label={planId?"Schema drift for plan":"Schema drift for planning target"} data-schema-drift-plan-id={planId}>
    <div className="panel-heading"><div><h3>Schema drift context</h3><p>Retained schema evidence for the selected target and migration stream.</p></div><button className="secondary" type="button" onClick={() => void load()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh drift'}</button></div>
    {busy && <p role="status">Loading schema drift evidence…</p>}{error && <p className="banner warning" role="alert">{error}</p>}
    {value && <>
      <p role="status"><strong>{planId ? (comparison.state || 'UNVERIFIED') : `Schema comparison · ${comparison.state || 'UNVERIFIED'}`}</strong> · {comparison.summary ? `${summary.added} added · ${summary.removed} removed · ${summary.modified} modified · ${summary.unverified} unverified` : 'No comparison is available.'}</p>
      <p>Added: {summary.added ?? '—'} · removed: {summary.removed ?? '—'} · modified: {summary.modified ?? '—'} · unverified: {summary.unverified ?? '—'}</p>
      <p className="muted">Latest observation evidence is shown with its provenance. It does not grant execution authority or establish current live database state.</p>
      <dl className="target-facts">
        {planId && <div><dt>Plan</dt><dd><code>{planId}</code></dd></div>}
        <div><dt>Target binding</dt><dd><code>{value.latest?.bindingId || value.retainedSnapshot?.bindingId || 'Unavailable'}</code></dd></div>
        <div><dt>Target revision</dt><dd>{value.latest?.bindingRevision || value.retainedSnapshot?.bindingRevision || 'Unavailable'}</dd></div>
        <div><dt>Baseline</dt><dd><code>{value.baseline?.snapshotId || 'Unavailable'}</code> · {value.baseline?.name || 'Unnamed baseline'}</dd></div>
        <div><dt>Retained observation</dt><dd><code>{value.retainedSnapshot?.id || 'Unavailable'}</code> · {value.retainedSnapshot?.observedAt || 'time unavailable'}</dd></div>
        <div><dt>Provenance</dt><dd>{value.latest?.provenance || 'Unspecified'} · {value.latest?.liveAccepted === true ? 'live accepted' : 'live acceptance not established'}</dd></div>
        <div><dt>Coverage</dt><dd>{coverageText(value.latest?.coverage)}</dd></div>
        <div><dt>Execution authority</dt><dd>{String(value.executionAuthority)}</dd></div>
      </dl>
      {limitations.length > 0 && <div className="banner warning"><strong>Comparison limitations</strong><ul>{limitations.map((item, index) => <li key={index}>{typeof item === 'string' ? item : item.message || printable(item)}</li>)}</ul></div>}
      {!!changes.length && <div className="file-table-wrap"><table><thead><tr><th>Change</th><th>Object</th><th>Details</th></tr></thead><tbody>{changes.map((change, index) => <tr key={`${change.kind || change.type}:${change.object?.owner || change.owner}:${change.object?.name || change.name}:${index}`}><td>{change.kind || change.type || 'UNKNOWN'}</td><td><code>{change.object?.owner || change.owner || 'Unknown'}.{change.object?.name || change.name || 'Unknown'}</code></td><td><pre className="schema-object-definition" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{printable(change.details || change.diff || change)}</pre></td></tr>)}</tbody></table></div>}
      {!changes.length && <p>No object-level changes are available. Check comparison state and coverage before reading this as no drift.</p>}
      {onOpenSchema && <button className="secondary" type="button" onClick={onOpenSchema}>Open schema baselines and details</button>}
    </>}
  </section>;
}
