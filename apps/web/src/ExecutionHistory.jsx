import React, { useEffect, useRef, useState } from 'react';

export default function ExecutionHistory({ job, projectId, token, request, formatTime }) {
  const active = useRef(true);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = async (cursor = null) => {
    setBusy(true); setError('');
    try {
      const result = await request(`/api/execution-jobs/${encodeURIComponent(job.id)}/attempts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, token);
      if (!active.current) return;
      if (result.jobId !== job.id || result.projectId !== projectId || result.planId !== job.planId
          || result.executionAuthority !== false || !Array.isArray(result.attempts) || result.attempts.length > 50)
        throw new Error('HISTORY_UNAVAILABLE');
      setPage(previous => ({ ...result, attempts: cursor ? [...previous.attempts, ...result.attempts] : result.attempts }));
    } catch (failure) { if (active.current) setError(failure.message); }
    finally { if (active.current) setBusy(false); }
  };
  return <section aria-label={`Execution history for job ${job.id}`}>
    <button type="button" className="secondary" onClick={() => void load()} disabled={busy}>View execution history</button>
    {error && <p role="alert">History unavailable: {error}</p>}
    {page && <>
      <p className="muted">These retained records provide no execution authority. Runtime acceptance is separate.</p>
      {page.evidenceScope === 'UNIT_SYNTHETIC'
        ? <p className="banner warning">Synthetic test evidence — no Oracle execution validation.</p>
        : <p className="muted">Evidence scope: {page.evidenceScope}</p>}
      {!page.attempts.length && <p>No retained attempt records.</p>}
      <ol aria-label={`Attempts for job ${job.id}`}>{page.attempts.map(attempt => <li key={attempt.id}>
        <strong>{attempt.state.replaceAll('_',' ')}</strong> · generation {attempt.generation} · {formatTime(attempt.createdAt)}
        <button type="button" className="secondary" onClick={() => setSelected(attempt)}>Inspect attempt {attempt.generation}</button>
      </li>)}</ol>
      {page.nextCursor && <button type="button" className="secondary" onClick={() => void load(page.nextCursor)} disabled={busy}>Older attempts</button>}
      {selected && <AttemptHistory key={selected.id} job={job} projectId={projectId} attempt={selected} token={token} request={request} formatTime={formatTime}/>}
    </>}
  </section>;
}

function AttemptHistory({ job, projectId, attempt, token, request, formatTime }) {
  const active = useRef(true);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (kind = null, cursor = null) => {
    setBusy(true); setError('');
    try {
      const query = kind ? `?${kind}Cursor=${encodeURIComponent(cursor)}` : '';
      const result = await request(`/api/execution-jobs/${encodeURIComponent(job.id)}/attempts/${encodeURIComponent(attempt.id)}${query}`, token);
      if (!active.current) return;
      if (result.jobId !== job.id || result.projectId !== projectId || result.planId !== job.planId || result.attempt?.id !== attempt.id
          || result.executionAuthority !== false || !Array.isArray(result.events) || !Array.isArray(result.receipts)
          || result.events.length > 50 || result.receipts.length > 50
          || !result.approvedPlanContext || typeof result.approvedPlanContext.available !== 'boolean') throw new Error('HISTORY_UNAVAILABLE');
      setPage(previous => kind === 'events' ? { ...previous, events: [...previous.events, ...result.events], nextEventsCursor: result.nextEventsCursor }
        : kind === 'receipts' ? { ...previous, receipts: [...previous.receipts, ...result.receipts], nextReceiptsCursor: result.nextReceiptsCursor } : result);
    } catch (failure) { if (active.current) setError(failure.message); }
    finally { if (active.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, []);
  return <section aria-label={`Attempt ${attempt.generation} details`}>
    {error && <p role="alert">Attempt history unavailable: {error}</p>}
    {page && <>
      <p>Recorded claim deadline: {formatTime(page.attempt.claimExpiresAt)}. This timestamp does not prove a current lease.</p>
      {page.approvedPlanContext.available
        ? <p className="muted" aria-label="Approved plan context">Approved plan context: {page.approvedPlanContext.totalApprovedMigrations} migrations and {page.approvedPlanContext.totalApprovedStatements} statements; {page.approvedPlanContext.appliedMigrationCount} migrations / {page.approvedPlanContext.appliedStatementCount} statements precede this attempt, with {page.approvedPlanContext.pendingMigrationCount} migrations / {page.approvedPlanContext.pendingStatementCount} statements in its approved pending work. This is provenance context only and does not prove SQL was applied.</p>
        : <p className="muted" aria-label="Approved plan context unavailable">Approved migration context unavailable for this retained history.</p>}
      <h4>Statement events</h4>
      <ol aria-label="Statement events">{page.events.map(event => <li key={event.id}>
        <strong>{event.phase.replaceAll('_',' ')}</strong> · revision {event.revision}
        {event.ordinal !== null && <> · statement {event.ordinal}</>}
        {event.ordinal !== null && <ApprovedContext context={event.approvedContext} />}
        {event.reasonCode && <> · {event.reasonCode}</>} · {formatTime(event.createdAt)}
        {event.statementDigest && <code>{event.statementDigest}</code>}
      </li>)}</ol>
      {page.nextEventsCursor && <button type="button" className="secondary" disabled={busy} onClick={() => void load('events',page.nextEventsCursor)}>More statement events</button>}
      <h4>Statement receipts</h4>
      {!page.receipts.length && <p>No retained receipts. Missing receipts do not prove whether a statement was applied.</p>}
      <ol aria-label="Statement receipts">{page.receipts.map(receipt => <li key={receipt.id}>
        Statement {receipt.ordinal} · {formatTime(receipt.createdAt)}
        <ApprovedContext context={receipt.approvedContext} />
        <dl><dt>Statement digest</dt><dd><code>{receipt.statementDigest}</code></dd>
          <dt>Receipt digest</dt><dd><code>{receipt.receiptDigest}</code></dd>
          <dt>Central evidence digest</dt><dd><code>{receipt.centralEvidenceDigest}</code></dd></dl>
      </li>)}</ol>
      {page.nextReceiptsCursor && <button type="button" className="secondary" disabled={busy} onClick={() => void load('receipts',page.nextReceiptsCursor)}>More statement receipts</button>}
    </>}
  </section>;
}

function ApprovedContext({ context }) {
  if (!context) return <> · approved migration context unavailable</>;
  return <> · approved {context.approvedPath} (version {context.approvedVersion}),
    migration {context.approvedFileOrdinal} of {context.totalApprovedMigrations},
    file statement {context.approvedFileStatementOrdinal}, full approved statement {context.approvedStatementOrdinal} of {context.totalApprovedStatements}</>;
}
