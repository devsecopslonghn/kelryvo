import React, { useEffect, useRef, useState } from 'react';
import ExecutionHistory from './ExecutionHistory.jsx';

// This browser deliberately owns a single project-global page. It never merges
// older rows into the live queue, whose refresh remains an independent view.
export default function ExecutionRequestsHistory({ projectId, planId, token, request, formatTime, isCurrent, onAccessLost }) {
  const active = useRef(true);
  const sequence = useRef(0);
  const flight = useRef(false);
  const [opened, setOpened] = useState(false);
  const [page, setPage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [events, setEvents] = useState({});
  const [eventBusy, setEventBusy] = useState('');

  const scopedRequest = async (path, requestToken) => {
    if (!active.current || !isCurrent()) throw new Error('HISTORY_CONTEXT_CHANGED');
    try {
      const result = await request(path, requestToken);
      if (!active.current || !isCurrent()) throw new Error('HISTORY_CONTEXT_CHANGED');
      return result;
    } catch (failure) {
      if (failure?.message === 'NOT_FOUND' && active.current && isCurrent()) onAccessLost();
      throw failure;
    }
  };

  useEffect(() => { active.current = true; return () => { active.current = false; sequence.current += 1; }; }, []);

  const load = async (cursor = null) => {
    if (flight.current || !active.current || !isCurrent()) return;
    flight.current = true;
    const requestSequence = ++sequence.current;
    setBusy(true); setError('');
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const result = await scopedRequest(`/api/projects/${encodeURIComponent(projectId)}/execution-jobs${query}`, token);
      if (!active.current || sequence.current !== requestSequence || !isCurrent()) return;
      if (!Array.isArray(result.jobs) || result.jobs.length > 50
          || result.jobs.some(job => job.projectId !== projectId)) throw new Error('HISTORY_UNAVAILABLE');
      setPage({ jobs: result.jobs.filter(job => job.planId === planId), nextCursor: result.nextCursor || null,
        cursor, pageNumber: cursor ? (page?.pageNumber || 1) + 1 : 1 });
      setEvents({});
      setOpened(true);
    } catch (failure) {
      if (!active.current || sequence.current !== requestSequence || !isCurrent()) return;
      if (failure?.message !== 'NOT_FOUND') setError(failure?.message || 'HISTORY_UNAVAILABLE');
    } finally {
      flight.current = false;
      if (active.current && sequence.current === requestSequence && isCurrent()) setBusy(false);
    }
  };

  const loadEvents = async (job, cursor = null) => {
    if (flight.current || !active.current || !isCurrent()) return;
    flight.current = true;
    const requestSequence = ++sequence.current;
    setEventBusy(job.id); setError('');
    try {
      const result = await scopedRequest(`/api/execution-jobs/${encodeURIComponent(job.id)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, token);
      if (!active.current || sequence.current !== requestSequence || !isCurrent()) return;
      const prior = events[job.id]?.job;
      if (result.job?.id !== job.id || result.job?.projectId !== projectId || result.job?.planId !== planId
          || Number(result.job.revision) < Math.max(Number(prior?.revision ?? -1), Number(job.revision)) || !Array.isArray(result.events) || result.events.length > 100)
        throw new Error('HISTORY_UNAVAILABLE');
      setEvents(current => ({ ...current, [job.id]: { job: result.job, events: result.events, nextCursor: result.nextCursor || null } }));
    } catch (failure) {
      if (!active.current || sequence.current !== requestSequence || !isCurrent()) return;
      if (failure?.message !== 'NOT_FOUND') setError(failure?.message || 'HISTORY_UNAVAILABLE');
    } finally {
      flight.current = false;
      if (active.current && sequence.current === requestSequence && isCurrent()) setEventBusy('');
    }
  };

  return <section className="panel" aria-label="Older deployment request history">
    <h3>Request history</h3>
    <p className="muted">Pages follow the project’s newest-first request order. Each page contains up to 50 project requests; only requests for this plan are shown. History pages are retained snapshots. Job events refresh their summary and show up to 100 events per page. Records do not grant execution authority or prove target effects.</p>
    {!opened && <button type="button" className="secondary" onClick={() => void load()} disabled={busy}>Browse request history</button>}
    {opened && <>
      <p aria-live="polite">Project request page {page?.pageNumber || 1}{page?.cursor ? ' · older requests' : ' · latest requests'}</p>
      <div className="button-row">
        <button type="button" className="secondary" onClick={() => void load()} disabled={busy || Boolean(eventBusy) || !page?.cursor}>Latest requests</button>
        {page?.nextCursor && <button type="button" className="secondary" onClick={() => void load(page.nextCursor)} disabled={busy || Boolean(eventBusy)}>Older requests</button>}
      </div>
      {!page?.jobs.length && <p className="muted">No requests for this plan on this project page. Continue to older requests to search the retained history.</p>}
      {(page?.jobs || []).map(job => {
        const retained = events[job.id];
        const summary = retained?.job || job;
        return <article className="execution-job" key={job.id}>
          <strong>{summary.state.replaceAll('_', ' ')}</strong> · revision {summary.revision} · readiness: {summary.readiness.status.replaceAll('_', ' ')}
          <p>{job.reason}</p><code>{job.id}</code>
          <button type="button" className="secondary" onClick={() => void loadEvents(job)} disabled={busy || Boolean(eventBusy)}>{retained ? 'Refresh job events' : 'View job events'}</button>
          {eventBusy === job.id && <p className="muted">Loading retained events…</p>}
          {retained && <>
            <ol aria-label={`Events for job ${job.id}`}>{retained.events.map(event => <li key={event.id}>
              <strong>{event.to_state.replaceAll('_', ' ')}</strong> · {formatTime(event.created_at)}{event.reason ? ` · ${event.reason}` : ''}
            </li>)}</ol>
            {retained.nextCursor && <button type="button" className="secondary" onClick={() => void loadEvents(retained.job, retained.nextCursor)} disabled={busy || Boolean(eventBusy)}>More job events</button>}
            <ExecutionHistory key={`${projectId}:${planId}:${job.id}:${retained.job.revision}:${token}`} job={retained.job} projectId={projectId} token={token} request={scopedRequest} formatTime={formatTime}/>
          </>}
        </article>;
      })}
    </>}
    {busy && <p className="muted" role="status">Loading request history…</p>}
    {error && <p className="banner error" role="alert">History unavailable: {error}</p>}
  </section>;
}
