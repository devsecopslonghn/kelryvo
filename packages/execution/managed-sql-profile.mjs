import { materializeApprovedStatements } from './statements.mjs';
import { compileOraclePostconditions } from './oracle-postconditions.mjs';
import { instanceDeploymentPrincipal } from '../connectivity/instance-runtime.mjs';

/** Read-only eligibility check. Unsupported installed projections are rejected
 * before creating a job; they must not become avoidable no-SQL HOLD requests. */
export async function checkManagedPlanSqlProfile(tx,{organizationId,projectId,authorId,profileId,envelope,intentDigest,release}) {
  const c=(await tx`SELECT c.* FROM sf_instance_profile_sources s JOIN sf_database_connections c ON c.id=s.connection_id
    WHERE s.profile_id=${profileId} AND c.organization_id=${organizationId}`)[0];
  if(!c?.credential_ref?.startsWith('vault://kelryvo/'))return {applicable:false,supported:true};
  const principal=await instanceDeploymentPrincipal(tx,c);
  if(!principal?.runtime)return {applicable:true,supported:false};
  const materialized=await materializeApprovedStatements(release,envelope,intentDigest,{organizationId,projectId,requesterId:authorId,profileId});
  const intent=materialized?.intent;
  const supported=!!intent?.target && intent.username===principal.username
    && principal.runtime.schemaOwners.includes(intent.target.exactOwner)
    && !principal.runtime.protectedOwners.includes(intent.target.exactOwner)
    && !!compileOraclePostconditions(materialized,intent.target.exactOwner);
  return {applicable:true,supported};
}
