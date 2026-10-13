import React, { useEffect, useRef, useState } from 'react';

const kinds=['TARGET_LEDGER','TARGET_OBSERVATION','OPERATOR_REPORT'];
const errors={
  REVISION_CONFLICT:'This request changed. Use Refresh requests to load its current revision before submitting again.',
  EVIDENCE_DIGEST_CONFLICT:'This digest is already retained with different details. Review the existing reference before submitting new evidence.',
  DECISION_ALREADY_RECORDED:'Another review is already retained. Refresh evidence to read that decision.',
  INDEPENDENT_REVIEW_REQUIRED:'An approver independent from the submitter, requester and plan author must review this evidence.',
  APPROVER_REQUIRED:'An authorized project approver must review this evidence.',
  JOB_NOT_ON_HOLD:'This request is no longer on HOLD. Use Refresh requests to read its current state.',
  METADATA_RESTORE_HOLD:'Metadata recovery is on HOLD. Complete operator recovery before recording reconciliation evidence.',
  PROJECT_ARCHIVED:'This project is archived. Its reconciliation history remains available for review.',
  RECONCILIATION_LIMIT:'This request has reached its evidence reference limit. Review the retained references with the operator.',
  JOB_BINDING_UNAVAILABLE:'The retained plan and request references could not be verified. Keep HOLD and investigate the missing evidence.',
  NOT_FOUND:'Project access or this request changed. Refresh the workspace before continuing.',
  UNAUTHENTICATED:'Your session expired. Sign in again before continuing.',
};
const explain=(failure,fallback)=>errors[failure?.message]??fallback;

export default function ExecutionReconciliation({job,projectId,token,request,isDeployer=false,isApprover=false,actorId,planAuthorId,isCurrent=()=>true}){
  const epoch=useRef(0),pending=useRef(false);
  const currentCheck=useRef(isCurrent);currentCheck.current=isCurrent;
  const [rows,setRows]=useState([]),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [evidenceDigest,setEvidenceDigest]=useState(''),[evidenceKind,setEvidenceKind]=useState(kinds[0]),[reason,setReason]=useState('');
  const [decisionReasons,setDecisionReasons]=useState({});
  const current=(generation=epoch.current)=>generation===epoch.current&&currentCheck.current();
  const refresh=async(generation)=>{
    setLoading(true);
    try{
    const result=await request(`/api/execution-jobs/${encodeURIComponent(job.id)}/reconciliations`,token);
    if(!current(generation))return;
    if(result.jobId!==job.id||result.projectId!==projectId||result.retryEligible!==false||result.executionAuthority!==false
      ||!Array.isArray(result.reconciliations)||result.reconciliations.length>20)throw new Error('RECONCILIATION_UNAVAILABLE');
    setRows(result.reconciliations);
    }finally{if(current(generation))setLoading(false);}
  };
  useEffect(()=>{
    const generation=++epoch.current;let active=true;
    setRows([]);setError('');setBusy(false);pending.current=false;
    if(isCurrent())refresh(generation).catch(failure=>{if(active&&current(generation))setError(explain(failure,'Reconciliation history unavailable. Refresh evidence and try again.'));});
    return()=>{active=false;epoch.current++;};
  },[job?.id,projectId,token]);
  const submit=async()=>{
    if(pending.current||loading||!job||!current())return;
    pending.current=true;setBusy(true);setError('');const generation=epoch.current;let retained=false;
    try{
      const result=await request(`/api/execution-jobs/${encodeURIComponent(job.id)}/reconciliations`,token,{method:'POST',body:JSON.stringify({
        expectedRevision:Number(job.revision),evidenceDigest,evidenceKind,reason})});
      if(!current(generation))return;
      if(result.reconciliation?.jobId!==job.id||result.reconciliation.executionAuthority!==false||result.reconciliation.retryEligible!==false)throw new Error('RECONCILIATION_UNAVAILABLE');
      retained=true;
      setEvidenceDigest('');setReason('');await refresh(generation);
    }catch(failure){if(current(generation))setError(retained?`Evidence reference retained. ${explain(failure,'History could not be refreshed. Use Refresh evidence to read the retained record.')}`:explain(failure,'Could not confirm this evidence reference. Check the job state and revision.'));}
    finally{if(current(generation)){pending.current=false;setBusy(false);}}
  };
  const decide=async(row,decision)=>{
    if(pending.current||loading||!current())return;
    pending.current=true;setBusy(true);setError('');const generation=epoch.current;let retained=false;
    try{
      const result=await request(`/api/execution-jobs/${encodeURIComponent(job.id)}/reconciliations/${encodeURIComponent(row.id)}/decision`,token,{method:'POST',body:JSON.stringify({
        expectedRevision:Number(job.revision),decision,reason:decisionReasons[row.id]??''})});
      if(!current(generation))return;
      if(result.reconciliation?.id!==row.id||result.reconciliation.jobId!==job.id||result.executionAuthority!==false||result.retryEligible!==false)throw new Error('RECONCILIATION_UNAVAILABLE');
      retained=true;
      setDecisionReasons(value=>({...value,[row.id]:''}));await refresh(generation);
    }catch(failure){if(current(generation))setError(retained?`Independent review retained. ${explain(failure,'History could not be refreshed. Use Refresh evidence to read the retained decision.')}`:explain(failure,'Could not confirm the independent review. Refresh evidence and try again.'));}
    finally{if(current(generation)){pending.current=false;setBusy(false);}}
  };
  const reload=async()=>{
    if(pending.current||loading||!current())return;
    pending.current=true;setBusy(true);setError('');const generation=epoch.current;
    try{await refresh(generation);}
    catch(failure){if(current(generation))setError(explain(failure,'Reconciliation history unavailable. Refresh evidence and try again.'));}
    finally{if(current(generation)){pending.current=false;setBusy(false);}}
  };
  if(!job||job.state!=='HOLD'||!current())return null;
  return <section aria-label="Execution HOLD reconciliation" className="execution-reconciliation">
    <h3>Execution is on HOLD</h3>
    <p className="muted">Retain references to external evidence for independent review. This form accepts a SHA-256 digest only; do not paste SQL, credentials, or evidence files. Review never verifies Oracle effects, enables retry, or authorizes replay.</p>
    <button type="button" className="secondary" disabled={busy||loading} onClick={reload}>Refresh evidence</button>
    {loading&&<p role="status">Loading reconciliation evidence…</p>}
    {!loading&&!error&&!rows.length&&<p className="muted">No reconciliation evidence references retained yet. HOLD remains until target effects can be established independently.</p>}
    {isDeployer&&<div>
      <label>Evidence kind<select value={evidenceKind} onChange={e=>setEvidenceKind(e.target.value)}>{kinds.map(kind=><option key={kind}>{kind}</option>)}</select></label>
      <label>Evidence SHA-256 digest<input value={evidenceDigest} onChange={e=>setEvidenceDigest(e.target.value)} maxLength={64} autoComplete="off" /></label>
      <label>Reason<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} /></label>
      <button type="button" className="secondary" disabled={busy||loading||!/^[a-f0-9]{64}$/.test(evidenceDigest)||!reason.trim()} onClick={submit}>Retain evidence reference</button>
    </div>}
    {rows.map(row=><article key={row.id} className="execution-reconciliation-row">
      <p>{row.evidenceKind} · SHA-256 {row.evidenceDigest}</p><p>{row.reason}</p>
      <p className="muted">Submitted by {row.submitterId} · {new Date(row.createdAt).toLocaleString()} · Target identity {row.targetIdentityDigest??'not available'}</p>
      {row.decision?<p>Independent review: {row.decision.decision} by {row.decision.reviewerId}. HOLD remains; target effects are not attested.</p>
        :isApprover&&actorId&&planAuthorId&&![row.submitterId,job.requesterId,planAuthorId].includes(actorId)?<div><label>Review reason<textarea value={decisionReasons[row.id]??''} maxLength={1000} onChange={e=>setDecisionReasons(v=>({...v,[row.id]:e.target.value}))}/></label>
          <button type="button" className="secondary" disabled={busy||loading||!(decisionReasons[row.id]??'').trim()} onClick={()=>decide(row,'RETAIN_HOLD')}>Retain HOLD</button>
          <button type="button" className="secondary" disabled={busy||loading||!(decisionReasons[row.id]??'').trim()} onClick={()=>decide(row,'EVIDENCE_REVIEWED')}>Record evidence reviewed</button></div>
          :<p className="muted">Review requires an approver independent from the evidence submitter, requester and plan author.</p>}
    </article>)}
    {error&&<p role="alert">{error}</p>}
  </section>;
}
