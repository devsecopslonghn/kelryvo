import React, { useEffect, useRef, useState } from 'react';

const statementSql = (content, ref) => ref ? new TextDecoder().decode(new TextEncoder().encode(content || '').slice(ref.startByte, ref.endByte)) : '';

export default function PlanSourceComparison({ projectId, plan, releases, token, request, readOnly, onSelect, requestedComparison, onSelectEvidence, selectedEvidence = [] }) {
  const [baseline, setBaseline] = useState(''), [comparison, setComparison] = useState(null);
  const [saved, setSaved] = useState([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0);
  const base = `/api/projects/${encodeURIComponent(projectId)}/plans/${encodeURIComponent(plan.id)}/comparisons`;
  useEffect(() => {
    const n = ++sequence.current;
    setComparison(null); setBaseline(''); setError(''); setSaved([]); onSelect(null);
    request(base, token).then(r => { if (n === sequence.current) setSaved(r.comparisons || []); })
      .catch(e => { if (n === sequence.current) setError(e.message); });
    return () => { sequence.current++; };
  }, [base, token, request]);
  const load = async (id) => {
    const n = ++sequence.current;
    setBusy(true); setError(''); setComparison(null); onSelect(null);
    try {
      const r = id ? await request(`${base}/${encodeURIComponent(id)}`, token)
        : await request(base, token, { method: 'POST', body: JSON.stringify({ baseReleaseId: baseline, expectedIntentDigest: plan.offlineIntent.digest }) });
      if (n !== sequence.current) return;
      if (r.comparison?.evidence?.planId !== plan.id || r.comparison.evidence.intentDigest !== plan.offlineIntent.digest
          || r.comparison.evidence.candidate.id !== plan.releaseId) throw new Error('COMPARISON_STALE');
      setComparison(r.comparison); onSelect({ planId: plan.id, projectId, id: r.comparison.id, digest: r.comparison.digest });
      if (!id) setSaved(rows => [{ id: r.comparison.id, baseReleaseId: baseline }, ...rows]);
    } catch (e) { if (n === sequence.current) setError(e.message || 'COMPARISON_UNAVAILABLE'); }
    finally { if (n === sequence.current) setBusy(false); }
  };
  useEffect(()=>{ if(requestedComparison?.planId===plan.id) void load(requestedComparison.id); },[requestedComparison]);
  return <section id={`plan-comparison-${plan.id}`} className="panel plan-source-comparison" aria-label="Plan source comparison">
    <h3>Compare plan source</h3><p>Choose the retained baseline for this exact immutable candidate. Statements match by exact source within each migration version. Moved means relative statement order changed; ambiguous matches need manual review. This is a source review.</p>
    <div className="form-actions"><label>Review baseline<select aria-label="Review baseline" value={baseline} disabled={busy || readOnly || plan.status !== 'PENDING_APPROVAL'} onChange={e => { sequence.current++; setBusy(false); setBaseline(e.target.value); setComparison(null); onSelect(null); }}>{(releases || []).filter(r => r.validationStatus === 'VALID').map(r => <option key={r.id} value={r.id}>{r.commit?.slice(0, 12)} · {r.folder}</option>)}<option value="">Choose baseline release</option></select></label>
      <button type="button" className="secondary" disabled={busy || readOnly || !baseline || plan.status !== 'PENDING_APPROVAL'} onClick={() => void load()}>Compare immutable candidate</button></div>
    {!!saved.length && <label>Retained comparison<select aria-label="Retained comparison" value={comparison?.id || ''} disabled={busy} onChange={e => { if (e.target.value) void load(e.target.value); }}><option value="">Choose retained evidence</option>{saved.map(r => <option key={r.id} value={r.id}>{r.id} · baseline {r.baseReleaseId}</option>)}</select></label>}
    {busy && <p role="status">Loading source comparison…</p>}{error && <p role="alert">Comparison unavailable: {error}</p>}
    {comparison && <><p>Evidence <code>{comparison.id}</code> · SHA256 <code>{comparison.digest}</code></p><p>Plan digest <code>{comparison.evidence.intentDigest}</code></p>
      <dl><dt>Baseline manifest</dt><dd><code>{comparison.evidence.base.manifestDigest}</code></dd><dt>Candidate manifest</dt><dd><code>{comparison.evidence.candidate.manifestDigest}</code></dd></dl>
      {!comparison.facts.some(f => f.change !== 'UNCHANGED') && <p>No source changes between these retained releases.</p>}
      <nav aria-label="Changed files">{comparison.facts.filter(f => f.change !== 'UNCHANGED').map(f => <a key={f.version} href={`#plan-diff-${plan.id}-${f.version}`}>V{f.version} · {f.change} </a>)}</nav>
      {comparison.facts.map(f => { const evidence = comparison.evidence.files.find(e => e.version === f.version); return <details key={f.version} id={`plan-diff-${plan.id}-${f.version}`} open={f.change !== 'UNCHANGED'}><summary>V{f.version} · {f.change} · {f.candidate?.path || f.base?.path}</summary>
        <div className="comparison-sides"><section><h4>Baseline</h4><pre>{f.base?.content || 'File absent'}</pre></section><section><h4>Candidate</h4><pre>{f.candidate?.content || 'File absent'}</pre></section></div>
        {evidence?.statements ? evidence.statements.filter(s => s.change !== 'UNCHANGED').map((s, index) => {
          const reference = s.candidate && {filePath: evidence.candidatePath, ...s.candidate};
          const selected = reference && selectedEvidence.some(ref => ref.filePath === reference.filePath && ref.startByte === reference.startByte && ref.endByte === reference.endByte && ref.sourceSha256 === reference.sourceSha256);
          return <details key={`${s.base?.startByte ?? 'absent'}:${s.candidate?.startByte ?? 'absent'}:${index}`}><summary>Statement {s.ordinal} · {s.change}{s.change === 'MOVED' ? ' (relative order changed)' : ''}</summary>
            {s.ambiguity && <p role="status">Ambiguous match: {s.ambiguity === 'DUPLICATE_SOURCE' ? 'Repeated identical statements have no unique match.' : 'Different SQL could represent edits, additions or removals; no reliable pairing was found.'} Review the exact source on each side.</p>}
            <div className="comparison-sides"><section><h4>Baseline statement</h4><pre>{s.base ? statementSql(f.base?.content, s.base) : 'No matched baseline statement'}</pre>{s.base && <small>Bytes {s.base.startByte}–{s.base.endByte}</small>}</section><section><h4>Candidate statement</h4><pre>{s.candidate ? statementSql(f.candidate?.content, s.candidate) : 'No matched candidate statement'}</pre>{s.candidate && <small>Bytes {s.candidate.startByte}–{s.candidate.endByte}</small>}</section></div>
            {reference && onSelectEvidence && plan.status === 'PENDING_APPROVAL' && !readOnly && <button type="button" className="secondary" aria-pressed={!!selected} disabled={!selected && selectedEvidence.length >= 8} onClick={() => onSelectEvidence(reference)}>{selected ? 'Remove candidate statement reference' : 'Attach candidate statement to comment'}</button>}
          </details>;
        }) : f.change !== 'UNCHANGED' && <p>Reliable statement ranges unavailable; review complete file source.</p>}
      </details>; })}<p className="muted">This evidence will be attached to comments and decisions submitted while selected.</p></>}
  </section>;
}
