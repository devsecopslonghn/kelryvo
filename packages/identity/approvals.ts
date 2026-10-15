export async function environmentPolicy(tx: any, profileId: string) {
  return (await tx`SELECT e.id,e.approval_required AS "approvalRequired",e.independent_approval AS "independentApproval"
    FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id WHERE p.id=${profileId}`)[0]
    ?? {approvalRequired:true,independentApproval:true};
}
export async function approvalSatisfied(tx: any, planId: string) {
  return !!(await tx`SELECT sf_plan_approval_satisfied(${planId}::uuid) AS allowed`)[0]?.allowed;
}
