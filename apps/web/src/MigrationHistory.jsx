import React, { useEffect, useRef, useState } from 'react';
import ExecutionHistory from './ExecutionHistory.jsx';

export default function MigrationHistory({ projectId, detail, token, request, targets = [], onOpenPlan, onOpenRelease, formatTime = value => value }) {
  const [pageData, setPageData] = useState(null);
  const [nextOffset, setNextOffset] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [offset, setOffset] = useState(0);
  const [selectedJob, setSelectedJob] = useState(null);
  const contextEpoch = useRef(0);
  const detailSequence = useRef(0);

  useEffect(() => {
    setPageData(null);
    setNextOffset(null);
    setOffset(0);
    setSelectedJob(null);
  }, [projectId, detail]);

  useEffect(() => {
    contextEpoch.current += 1;detailSequence.current += 1;
    setSelectedJob(null);setPageData(null);setNextOffset(null);
    let active = true;
    const epoch = contextEpoch.current;
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (targetId !== 'ALL') params.set('targetId', targetId);
    if (status !== 'ALL') params.set('status', status);
    params.set('offset', String(offset));
    setLoading(true); setError('');
    request(`/api/projects/${encodeURIComponent(projectId)}/migration-history?${params}`, token).then(response => {
      if (!active || epoch !== contextEpoch.current) return;
      if (response.projectId !== projectId || !Array.isArray(response.items) || response.items.length > 25
          || !Number.isSafeInteger(response.total) || response.items.some(item => typeof item.id !== 'string' || typeof item.title !== 'string')) throw new Error('HISTORY_UNAVAILABLE');
      setPageData(response); setNextOffset(response.nextOffset);
    }).catch(failure => { if (active && epoch === contextEpoch.current) { setError(failure.message || 'HISTORY_UNAVAILABLE'); setPageData(null); } })
      .finally(() => { if (active && epoch === contextEpoch.current) setLoading(false); });
    return () => { active = false;contextEpoch.current += 1;detailSequence.current += 1; };
  }, [projectId, detail, token, query, targetId, status, offset, request]);

  const rows = pageData?.items || [];
  const openExecution = async (job,cursor=null) => {
    const epoch = contextEpoch.current,sequence=++detailSequence.current;
    setSelectedJob({ ...job, _loading: true });
    try {
      const response = await request(`/api/execution-jobs/${encodeURIComponent(job.id)}${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`, token);
      if (response.job?.id !== job.id || response.job?.planId !== job.planId || response.job?.projectId !== projectId || !Array.isArray(response.events) || response.events.length>100) throw new Error('HISTORY_UNAVAILABLE');
      if (epoch === contextEpoch.current && sequence===detailSequence.current) setSelectedJob({ ...response.job, events: cursor?[...(job.events || []),...response.events]:response.events,nextCursor:response.nextCursor,_loading:false });
    } catch (failure) { if (epoch === contextEpoch.current && sequence===detailSequence.current) {
      if(['NOT_FOUND','UNAUTHENTICATED'].includes(failure.message)){setSelectedJob(null);setPageData(null);setError('Project history access changed. Refresh the project.');}
      else setSelectedJob({ ...job, _error: failure.message || 'HISTORY_UNAVAILABLE', _loading: false });
    } }
  };
  const boundProfiles = new Set(targets.map(target => target.profileId).filter(Boolean));
  const targetOptions = [...targets, ...(detail?.profiles || []).filter(profile => !boundProfiles.has(profile.id))
    .map(profile => ({ id: profile.id, name: `${profile.name} profile` }))];

  return <section className="panel migration-history-explorer" aria-label="Consolidated migration history">
    <div className="panel-heading"><div><h2>Migration history</h2><p>Plans, approvals, execution requests and retained migration records for {detail?.project?.name || 'this project'}.</p></div><span className="count-pill">{pageData?.total ?? '…'} records</span></div>
    <div className="history-filters">
      <label>Search history<input aria-label="Search migration history" maxLength={120} value={query} onChange={event => { setQuery(event.target.value); setOffset(0); }} placeholder="Release, plan, request, actor…"/></label>
      <label>Target<select aria-label="Filter history by target" value={targetId} onChange={event => { setTargetId(event.target.value); setOffset(0); }}><option value="ALL">All targets</option>{targetOptions.map(target => <option key={target.id || target.bindingId} value={target.id || target.bindingId}>{target.name || target.displayLabel || target.retainedTarget?.exactOwner || target.exactOwner || target.target?.exactOwner || target.id || target.bindingId}</option>)}</select></label>
      <label>Status<select aria-label="Filter history by status" value={status} onChange={event => { setStatus(event.target.value); setOffset(0); }}><option value="ALL">All statuses</option>{['PENDING_APPROVAL','APPROVED','REJECTED','WITHDRAWN','REVOKED','NOT_EXECUTED','WAITING_VALIDATION','ADMITTED','HOLD','CANCELLED','NOOP','VERIFIED_SUCCESS','UNKNOWN','BLOCKED','INCOMPLETE'].map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="error-copy">History could not be refreshed: {error}</p>}
    {loading && <p role="status">Loading migration history…</p>}
    {!loading && !rows.length ? <div className="empty-state compact"><strong>{query || targetId !== 'ALL' || status !== 'ALL' ? 'No records match these filters' : 'No migration history yet'}</strong><span>{query || targetId !== 'ALL' || status !== 'ALL' ? 'Change the search or filters to see other project records.' : 'Plans and execution requests will appear here as they are recorded.'}</span></div> : <ol className="migration-history-timeline">{rows.map(row => <li key={row.id} className="migration-history-row">
      <div className="migration-history-main"><div><strong>{row.title}</strong><span className={`status-pill ${row.status === 'VERIFIED_SUCCESS' ? 'good' : 'neutral'}`}>{row.status.replaceAll('_', ' ')}</span></div><p>{row.detail}</p>{row.targetId && <small>Target: {targetOptions.find(target => (target.id || target.bindingId) === row.targetId)?.name || targetOptions.find(target => (target.id || target.bindingId) === row.targetId)?.exactOwner || row.targetId}</small>}<small>{row.actorName || row.actorId || 'System record'} · {row.at ? formatTime(row.at) : 'Time unavailable'}</small>{row.evidence && <details><summary>Audit evidence</summary><pre>{JSON.stringify(row.evidence, null, 2)}</pre></details>}
        {(row.kind === 'migration' || row.kind === 'plan' || row.kind === 'approval' || row.kind === 'request') && <p className="muted">{row.kind === 'migration' && 'Recorded candidate outcome; NOT_EXECUTED does not mean the database applied it.'}{row.kind === 'request' && row.status === 'HOLD' && ' HOLD requires reconciliation; the final database outcome may remain UNKNOWN.'}{row.kind === 'request' && row.status === 'WAITING_VALIDATION' && ' Request is queued; target acceptance remains UNKNOWN.'}</p>}
      </div>
      <div className="migration-history-actions">{row.planId && <button type="button" className="secondary" onClick={() => onOpenPlan?.(row.planId)}>Open plan</button>}{row.releaseId && <button type="button" className="secondary" onClick={() => onOpenRelease?.(row.releaseId)}>Open release</button>}{row.jobId && <button type="button" className="secondary" onClick={() => void openExecution({id: row.jobId, planId: row.planId})}>Request details</button>}</div>
    </li>)}</ol>}
    <div className="records-actions"><button type="button" className="secondary" disabled={offset === 0 || loading} onClick={() => setOffset(value => Math.max(0, value - 25))}>Newer records</button><span className="muted">Page {Math.floor(offset / 25) + 1}</span><button type="button" className="secondary" disabled={nextOffset === null || loading} onClick={() => setOffset(nextOffset)}>Older records</button></div>
    {selectedJob && <section className="panel" aria-label={`Execution request details ${selectedJob.id}`}><h3>Execution request timeline</h3><p>Request state is product metadata. It does not prove Oracle acceptance.</p>{selectedJob._loading && <p role="status">Loading request timeline…</p>}{selectedJob._error && <p role="alert">Request timeline unavailable: {selectedJob._error}</p>}{selectedJob.events && <ol>{selectedJob.events.map(event => <li key={event.id}><strong>{(event.to_state || 'UNKNOWN').replaceAll('_', ' ')}</strong> · {event.actor_id || 'System'} · {formatTime(event.created_at)}{event.reason && ` · ${event.reason}`}</li>)}</ol>}{selectedJob.nextCursor && <button type="button" className="secondary" disabled={selectedJob._loading} onClick={()=>void openExecution(selectedJob,selectedJob.nextCursor)}>More request events</button>}<ExecutionHistory key={`${projectId}:${selectedJob.id}:${token}`} job={selectedJob} projectId={projectId} token={token} request={request} formatTime={formatTime}/></section>}
  </section>;
}
