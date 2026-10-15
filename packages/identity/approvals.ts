export async function environmentPolicy(tx: any, profileId: string) {
  return (await tx`SELECT e.id,e.review_policy_revision::text AS revision,e.approval_stage AS stage,
    CASE WHEN e.approval_stage='UNCLASSIFIED' THEN true ELSE e.approval_required END AS "approvalRequired",
    CASE WHEN e.approval_stage='UNCLASSIFIED' THEN true ELSE e.independent_approval END AS "independentApproval"
    FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id WHERE p.id=${profileId}`)[0]
    ?? {approvalRequired:true,independentApproval:true};
}
export const reviewPolicyTuple=(p: any)=>({revision:p.revision,stage:p.stage,approvalRequired:p.approvalRequired,independentApproval:p.independentApproval});
export async function planPolicyCurrent(tx: any,planId: string) {
  return !!(await tx`SELECT sf_plan_review_policy_current(${planId}::uuid) AS allowed`)[0]?.allowed;
}
export async function planPolicyIntentMatches(tx: any,planId: string,digest: string) {
  return !(await tx`SELECT 1 FROM sf_plan_review_policies WHERE plan_id=${planId} AND intent_digest IS DISTINCT FROM ${digest}`)[0];
}
export async function planReviewPolicy(tx: any,planId: string) {
  const row=(await tx`SELECT s.environment_id AS id,s.revision::text,s.stage,
    s.approval_required AS "approvalRequired",s.independent_approval AS "independentApproval"
    FROM sf_plan_review_policies s WHERE s.plan_id=${planId}`)[0];
  return row ?? {id:(await tx`SELECT environment_id FROM sf_profiles WHERE id=(SELECT profile_id FROM sf_plans WHERE id=${planId})`)[0]?.environment_id,
    revision:null,stage:'UNCLASSIFIED',approvalRequired:true,independentApproval:true,legacy:true};
}
export async function approvalSatisfied(tx: any, planId: string) {
  return !!(await tx`SELECT sf_plan_approval_satisfied(${planId}::uuid) AS allowed`)[0]?.allowed;
}
