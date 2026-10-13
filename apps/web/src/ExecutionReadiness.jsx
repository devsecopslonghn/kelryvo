import React, { useEffect, useRef, useState } from 'react';

const labels = {
  METADATA_ACTIVE: 'Metadata service is active',
  IMMUTABLE_INTENT_VERIFIED: 'Saved plan intent is intact',
  STATEMENT_BOUND_PLAN: 'Plan binds its ordered SQL statement sequence',
  INDEPENDENT_APPROVAL_CURRENT: 'Independent approval is current',
  PROTECTED_SOURCE_CURRENT: 'Protected migration source is current',
  PROFILE_CURRENT: 'Configured target profile matches the plan',
  TARGET_CONFIGURATION_CURRENT: 'Target configuration matches the plan',
  SCHEMA_VALIDATION_CURRENT: 'Schema validation evidence is current',
  DEPLOY_AUTHORIZATION: 'You have deployment authorization',
  NO_ACTIVE_OR_HELD_REQUEST: 'No active or held request blocks another request',
  TARGET_HISTORY_AVAILABLE: 'Target migration history has not been checked',
  TRUSTED_WORKER_ADMISSION: 'Trusted worker admission has not been checked',
  CANONICAL_TARGET_MUTEX: 'Target concurrency lock has not been checked',
  DISPATCH_PERMIT: 'Execution permit has not been checked',
  ORACLE_RUNTIME_ACCEPTANCE: 'Oracle runtime acceptance has not been run',
};
const retryReasons = {
  NO_ACTIVE_OR_HELD_REQUEST: 'An existing queued, admitted, or held request must be resolved before another request can be queued.',
  INDEPENDENT_APPROVAL_CURRENT: 'This plan needs a current independent approval. A withdrawn approval cannot be reused.',
  PROTECTED_SOURCE_CURRENT: 'The protected source changed or cannot be verified. Prepare and approve a fresh plan.',
  PROFILE_CURRENT: 'The target profile changed or is retired. Prepare and approve a fresh plan.',
  TARGET_CONFIGURATION_CURRENT: 'The target binding is stale or unavailable. Review current target configuration and prepare a fresh plan.',
  SCHEMA_VALIDATION_CURRENT: 'Validation evidence is blocked or stale. Validate the current source and target before requesting again.',
  METADATA_ACTIVE: 'Metadata recovery is active. Requests remain blocked until the local operator restores an active metadata generation.',
  DEPLOY_AUTHORIZATION: 'A local OS operator must grant this project deployment permission.',
};
const human = value => String(value ?? '').replaceAll('_', ' ').toLowerCase();

export default function ExecutionReadiness({ planId, projectId, token, request, isCurrent = () => true }) {
  const mounted = useRef(true), sequence = useRef(0), flight = useRef(false);
  const contextRef = useRef(''); contextRef.current = `${projectId}:${planId}:${token}`;
  const [result, setResult] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; sequence.current++; }; }, []);
  useEffect(() => {
    sequence.current++; flight.current = false; setResult(null); setError(''); setBusy(false);
  }, [planId, projectId, token]);

  const refresh = async () => {
    if (flight.current || !mounted.current || !isCurrent()) return;
    flight.current = true;
    const currentSequence = ++sequence.current;
    const context = contextRef.current;
    const current = () => mounted.current && sequence.current === currentSequence
      && context === contextRef.current && isCurrent();
    setBusy(true); setError('');
    try {
      const value = await request(`/api/plans/${encodeURIComponent(planId)}/execution-readiness`, token);
      if (!current()) return;
      if (!Array.isArray(value.checks) || typeof value.requestEligible !== 'boolean'
          || value.executionAuthority !== false || value.oracleAcceptance !== 'NOT_RUN' || value.executable !== false
          || !Array.isArray(value.activeJobs) || value.checks.some(row => !row || typeof row.code !== 'string'
            || !['PASS', 'BLOCKED', 'UNVERIFIED'].includes(row.status))) throw new Error('READINESS_UNAVAILABLE');
      setResult(value);
    } catch (failure) {
      if (current()) setError(failure?.message || 'READINESS_UNAVAILABLE');
    } finally {
      flight.current = false;
      if (current()) setBusy(false);
    }
  };

  const blocked = result?.checks.filter(row => row.status === 'BLOCKED') ?? [];
  return <section className="panel execution-readiness-live" aria-label="Live execution readiness" data-project-id={projectId} data-plan-id={planId}>
    <div className="panel-heading"><div><h3>Live readiness check</h3>
      <p>Checks current governance metadata without connecting to the target database.</p></div>
      <button type="button" className="secondary" onClick={() => void refresh()} disabled={busy}>{busy ? 'Checking…' : 'Refresh readiness'}</button>
    </div>
    {busy && <p role="status">Checking current plan and authorization facts…</p>}
    {error && <p className="banner error" role="alert">Readiness is unavailable. Refresh the plan and try again.</p>}
    {!result && !busy && !error && <p className="muted">Refresh to check current readiness.</p>}
    {result && <>
      <p role="status">{result.requestEligible
        ? 'Governance checks allow a deployment request to be queued.'
        : 'A deployment request is blocked by current governance facts.'}</p>
      <ul aria-label="Execution readiness checks">
        {result.checks.map(row => <li key={row.code} data-status={row.status}>
          <strong>{labels[row.code] || human(row.code)}:</strong> {human(row.status)}
          {row.status === 'BLOCKED' && retryReasons[row.code] && <p>{retryReasons[row.code]}</p>}
        </li>)}
      </ul>
      {result.activeJobs.length > 0 && (result.checks.find(row => row.code === 'NO_ACTIVE_OR_HELD_REQUEST')?.status === 'BLOCKED'
        ? <p className="banner warning">Requests in {result.activeJobs.map(human).join(', ')} state block another request. Inspect retained events and evidence before retrying. HOLD is not cleared by this check.</p>
        : <p className="banner warning">A request in {result.activeJobs.map(human).join(', ')} state already exists. Review its events before retrying; this legacy plan remains eligible to queue another request. HOLD is not cleared by this check.</p>)}
      <p className="banner warning">Oracle acceptance: not run. Target history, trusted worker admission, target locking, and the execution permit remain unverified. Queue eligibility does not mean the plan can execute.</p>
    </>}
  </section>;
}
