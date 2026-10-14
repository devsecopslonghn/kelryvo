import React, { useEffect, useState } from 'react';

// Always resolve the retained digest, never the connection's latest observation.
export function TargetIdentityEvidence({ projectId, digest, token, request }) {
  const [result,setResult]=useState(null);
  useEffect(()=>{
    let active=true;
    setResult(null);
    if(digest)request(`/api/projects/${encodeURIComponent(projectId)}/target-identity-evidence/${encodeURIComponent(digest)}`,token)
      .then(value=>{if(active)setResult({projectId,digest,token,evidence:value.evidence});})
      .catch(()=>{if(active)setResult({projectId,digest,token,error:true});});
    return ()=>{active=false;};
  },[projectId,digest,token]);
  if(!digest)return null;
  const scoped=result?.projectId===projectId && result?.digest===digest && result?.token===token ? result : null;
  const evidence=scoped?.evidence;
  return <section aria-label="Retained Oracle identity evidence" aria-busy={!scoped}>
    <h4>Retained Oracle identity evidence</h4>
    {!scoped ? <p role="status">Loading retained identity…</p> : scoped.error || !evidence ? <p role="alert">Identity evidence is unavailable for your current access. Refresh the project before continuing.</p> : <>
      <p>{evidence.identityState} · {evidence.provenance} · exact owner <code>{evidence.owner}</code></p>
      <p>Observed {evidence.observedAt} · expires {evidence.expiresAt}. These are the original observation facts; current target readiness is shown separately.</p>
      <dl className="target-facts">{Object.entries(evidence.identity || {}).map(([name,value])=><div key={name}><dt>{name}</dt><dd><code>{String(value??'Not applicable')}</code></dd></div>)}</dl>
      <p>Identity digest: <code>{evidence.identityDigest}</code> · connection revision {evidence.connectionRevision || 'Unavailable'}</p>
      <p>{evidence.liveVerificationAccepted ? `Accepted read-only evidence: ${evidence.verificationAcceptance.evidenceDigest}.` : 'This observation has no accepted live verification for this owner.'} Identity evidence does not authorize migration execution.</p>
      {!!evidence.limitations?.length && <p>Observation limitations: {evidence.limitations.join(', ')}</p>}
    </>}
  </section>;
}
