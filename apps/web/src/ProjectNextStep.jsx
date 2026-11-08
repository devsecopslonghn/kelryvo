import React from 'react';

/** Navigation advice from retained project facts; never grants execution authority. */
export default function ProjectNextStep({ detail, actor, accessMode, recoveryState, onNavigate }) {
  const plans = detail.plans || [];
  const pending = plans.filter(plan => plan.status === 'PENDING_APPROVAL');
  const jobs = detail.executionJobs || [];
  const held = jobs.find(job => job.state === 'HOLD');
  const active = jobs.find(job => ['WAITING_VALIDATION', 'ADMITTED'].includes(job.state));
  const completed = job => ['VERIFIED_SUCCESS', 'NOOP'].includes(job.state);
  const approved = plans.find(plan => plan.status === 'APPROVED' && !jobs.some(job => job.planId === plan.id && completed(job)));
  let title, description, destination, action, planId, status;
  if (detail.project.archivedAt) {
    title = 'Inspect retained project history';
    description = 'This project is archived. Its releases, decisions and migration history remain readable.';
    destination = 'history'; action = 'Open migration history';
  } else if (accessMode !== 'ENFORCED') {
    title = 'Finish project access setup';
    description = 'Ask the local operator to activate project membership, then refresh the workspace.';
  } else if (recoveryState !== 'ACTIVE') {
    title = 'Confirm workspace recovery status';
    description = 'Changes are unavailable until the operator confirms active metadata and completes any required recovery reconciliation.';
    destination = 'history'; action = 'Inspect migration history';
  } else if (held) {
    title = 'Inspect held execution requests';
    description = 'An execution outcome needs reconciliation. Inspect its retained evidence before preparing further changes.';
    destination = 'review'; action = 'Inspect plans and execution';
    planId = held.planId;
  } else if (active) {
    title = 'Follow the existing execution request';
    description = 'A deployment request is waiting for validation or is admitted. Inspect its current state before requesting another deployment.';
    destination = 'review'; action = 'Inspect execution request'; planId = active.planId;
  } else if (actor?.role === 'approver') {
    title = pending.length ? 'Review pending plans' : 'Check the review inbox';
    description = pending.length ? 'Review retained SQL, target facts and findings. A plan requires an independent approver.'
      : 'No plans in this project are awaiting approval. The inbox includes pending plans from your accessible projects.';
    destination = pending.length ? 'review' : 'inbox'; action = pending.length ? 'Open pending plans' : 'Open review inbox';
    planId = pending[0]?.id; status = 'PENDING_APPROVAL';
  } else if (!(detail.targetBindings || []).length) {
    title = 'Configure a project target';
    description = 'Register or reuse an Oracle instance, discover its schemas, and assign them to this project. A database manager needs operator-provisioned credentials and a configured Oracle runtime.';
    destination = 'instances'; action = 'Connect an Oracle instance';
  } else if (pending.length) {
    title = 'Follow up on independent review';
    description = 'A plan is awaiting approval. Inspect its review record or ask an independent approver to review it.';
    destination = 'review'; action = 'Open pending plans';
    planId = pending[0].id; status = 'PENDING_APPROVAL';
  } else if (approved) {
    title = 'Inspect approved plan readiness';
    description = 'Approval is recorded. Review current target facts and execution blockers before requesting deployment.';
    destination = 'review'; action = 'Inspect approved plans';
    planId = approved.id; status = 'APPROVED';
  } else if (jobs.some(completed)) {
    title = 'Inspect the migration outcome';
    description = 'A completed request has retained execution evidence. Inspect migration history before preparing the next change.';
    destination = 'history'; action = 'Open migration history';
  } else if ((detail.releases || []).some(release => release.validationStatus === 'VALID')) {
    title = 'Prepare an immutable plan';
    description = 'A validated release is available. Select its target and prepare a plan for independent review.';
    destination = 'release'; action = 'Open releases and plans';
  } else {
    title = 'Prepare your SQL change';
    description = 'Save a SQL draft, review validation findings and prepare an immutable release before requesting approval.';
    destination = 'sql'; action = 'Open SQL Workspace';
  }
  return <section className="project-next-step" aria-label="Recommended next step">
    <h3>{title}</h3><p>{description}</p>
    {action && <button type="button" className="primary" onClick={() => onNavigate(destination, { planId, status })}>{action} →</button>}
  </section>;
}
