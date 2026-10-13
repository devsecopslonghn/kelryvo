import React, { useEffect, useRef, useState } from 'react';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const states = ['COMPLETED', 'PENDING', 'BLOCKED', 'UNVERIFIABLE'];
const labels = { COMPLETED: 'Completed in retained evidence', PENDING: 'Pending target verification',
  BLOCKED: 'Blocked', UNVERIFIABLE: 'Unverifiable' };
const decisions = { PENDING: 'Pending changes require target verification', NOOP_CANDIDATE: 'NOOP candidate · target verification required',
  BLOCKED: 'History comparison is blocked', UNVERIFIABLE: 'History comparison is unverifiable' };

export default function MigrationAnalysis({ projectId, planId, releaseId, intentDigest, token, request }) {
  const [result, setResult] = useState(null), [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0), flight = useRef(false);
  const load = async (after = 0) => {
    if (flight.current) return;
    flight.current = true;
    const n = ++sequence.current;
    setBusy(true); setError('');
    if (!after) { setResult(null); setRows([]); }
    try {
      const params = new URLSearchParams({ intentDigest, after: String(after) });
      if (after) params.set('analysisDigest', result.analysisDigest);
      const value = await request(`/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(planId)}/migration-analysis?${params}`, token);
      if (n !== sequence.current) return;
      if (value.format !== 1 || value.projectId !== projectId || value.planId !== planId || value.releaseId !== releaseId
          || value.intentDigest !== intentDigest || !hash(value.manifestDigest) || !hash(value.analysisDigest)
          || after && value.analysisDigest !== result.analysisDigest
          || value.executionAuthority !== false || value.oracleAcceptance !== 'NOT_RUN' || value.liveTargetState !== 'UNVERIFIED'
          || !Object.hasOwn(decisions, value.decision) || !Array.isArray(value.migrations) || !value.migrations.length || value.migrations.length > 128
          || value.migrations.some((m, i) => m.order !== i + 1 || typeof m.path !== 'string' || typeof m.version !== 'string'
            || !hash(m.sha256) || !states.includes(m.status) || typeof m.reason !== 'string' || !Array.isArray(m.evidence)
            || m.evidence.some(e => typeof e.jobId !== 'string' || typeof e.planId !== 'string'
              || !['UNIT_SYNTHETIC', 'TRUSTED_VALIDATED'].includes(e.scope)))
          || !Array.isArray(value.findings) || value.findings.some(f => typeof f.code !== 'string' || typeof f.message !== 'string'
            || !['PASS', 'BLOCKED', 'UNVERIFIED'].includes(f.status))
          || !Number.isSafeInteger(value.statementCount) || value.statementCount < 0 || value.statementCount > 4096
          || !Array.isArray(value.statements) || value.statements.length > 50
          || value.statements.length !== Math.min(50, value.statementCount - after)
          || value.statements.some((s, i) => s.ordinal !== after + i + 1 || typeof s.path !== 'string' || typeof s.sourceSql !== 'string'
            || !hash(s.sourceSha256) || !hash(s.executionSha256) || !states.includes(s.migrationStatus)
            || s.review && (typeof s.review.classification !== 'string' || !Array.isArray(s.review.findings)
              || s.review.findings.some(f => typeof f.code !== 'string' || typeof f.severity !== 'string' || typeof f.rationale !== 'string')))
          || value.nextOrdinal !== (after + value.statements.length < value.statementCount ? after + value.statements.length : null)) throw new Error('ANALYSIS_UNAVAILABLE');
      setResult(value); setRows(old => after ? [...old, ...value.statements] : value.statements);
    } catch {
      if (n === sequence.current) { setResult(null); setRows([]); setError('Migration analysis is unavailable or its evidence changed. Refresh the analysis before reviewing.'); }
    } finally {
      if (n === sequence.current) { flight.current = false; setBusy(false); }
    }
  };
  useEffect(() => { flight.current = false; void load(); return () => { sequence.current++; }; }, [projectId, planId, releaseId, intentDigest, token]);
  return <section className="panel migration-analysis" aria-label="Incremental migration preview" data-analysis-plan-id={planId}>
    <div className="panel-heading"><div><h3>Incremental migration preview</h3>
      <p>Compare this immutable release with retained execution evidence, in migration order.</p></div>
      <button type="button" className="secondary" onClick={() => void load()} disabled={busy}>Refresh analysis</button></div>
    {busy && <p role="status">Reading migration evidence…</p>}
    {error && <p className="banner error" role="alert">{error}</p>}
    {result && <>
      <p role="status"><strong>{decisions[result.decision]}</strong></p>
      <p className="banner warning">Retained metadata does not attest current database effects or live drift. Completed evidence may support a NOOP only after the worker independently verifies the exact target and its ledger. Pending rows do not authorize replay. Oracle acceptance: not run.</p>
      <dl className="target-facts"><div><dt>Release</dt><dd><code>{result.releaseId}</code></dd></div>
        <div><dt>Source manifest</dt><dd><code>{result.manifestDigest}</code></dd></div>
        <div><dt>Plan intent</dt><dd><code>{result.intentDigest}</code></dd></div>
        <div><dt>Analysis evidence</dt><dd><code>{result.analysisDigest}</code></dd></div>
        <div><dt>Target</dt><dd>{result.target ? <><code>{result.target.bindingId}</code> · revision {result.target.bindingRevision} · owner {result.target.exactOwner}</> : 'Legacy profile binding · exact target state unverified'}</dd></div></dl>
      <ul aria-label="Migration integrity findings">{result.findings.map((f, i) => <li key={`${f.code}:${i}`} data-status={f.status}><strong>{f.code}</strong> · {f.status}<p>{f.message}</p></li>)}</ul>
      <div className="file-table-wrap"><table><thead><tr><th>Order</th><th>Migration / version</th><th>Source SHA-256</th><th>History decision</th><th>Evidence and reason</th></tr></thead><tbody>
        {result.migrations.map(m => <tr key={m.order} data-migration-status={m.status}><td>{m.order}</td><td><code>{m.path}</code><p>Version {m.version} · {m.statementCount ?? 'Unbound'} statements</p></td>
          <td><code className="checksum">{m.sha256}</code></td><td><span className="status-pill neutral">{labels[m.status]}</span></td><td><p>{m.reason}</p>
            {m.evidence.map((e, i) => <p key={`${e.jobId}:${i}`}>Request <code>{e.jobId}</code> · plan <code>{e.planId}</code> · <strong>{e.scope}</strong></p>)}</td></tr>)}
      </tbody></table></div>
      <h4>Exact ordered source SQL</h4>
      <p>Statement ranges from the saved plan and verified release. Source delimiters are retained; execution digests bind the parser’s execution bytes. Object dependencies and privileges remain unverified. Changed source, target or execution scope requires a new plan and independent review. Use the readiness check for current permitted actions.</p>
      {rows.map(s => <article className="sql-preview" key={s.ordinal} data-statement-order={s.ordinal}><h4>{s.ordinal}. {s.path} · file statement {s.fileOrdinal}</h4>
        <p>{labels[s.migrationStatus]}{s.review?.classification ? ` · ${s.review.classification}` : ''}</p>
        <pre>{s.sourceSql}</pre><p>Execution SHA-256 <code className="checksum">{s.executionSha256}</code></p>
        {!!s.review?.findings?.length && <ul aria-label={`Statement ${s.ordinal} risks`}>{s.review.findings.map((f, i) => <li key={`${f.code}:${i}`}><strong>{f.severity} · {f.code}</strong> · {f.rationale}</li>)}</ul>}
      </article>)}
      {result.sqlAvailable === false && result.findings.some(f => f.code === 'IMMUTABLE_SOURCE_VERIFIED' && f.status === 'BLOCKED') ? <p className="banner error">Source integrity failed. Exact SQL is unavailable; inspect the retained evidence and prepare a fresh verified plan.</p>
        : result.statementCount === 0 && <p>Legacy file-only plan: prepare a fresh statement-bound plan for an exact ordered SQL preview.</p>}
      {result.nextOrdinal !== null && <button type="button" className="secondary" disabled={busy} onClick={() => void load(rows.length)}>Load more migration SQL</button>}
    </>}
  </section>;
}
