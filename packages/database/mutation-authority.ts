import { guardIdentityAuthority } from '../identity/authorization.ts';
import { guardBrowserMutation } from './browser-sessions.ts';
import { LOCAL_ORGANIZATION as ORG } from './local-credentials.ts';

/** Revalidate the authenticated identity and resolved project scope at the write
 * checkpoint, after slow parsing or other work outside the metadata transaction. */
export async function guardMutationAuthority(tx: any, req: any, requiredRole?: 'developer') {
  await tx`SELECT pg_advisory_xact_lock(1397112658, 2)`;
  await guardBrowserMutation(tx, req);
  await guardIdentityAuthority(tx,req);
  // Trusted identity/grant operators take the same advisory lock. Do not take
  // extra actor/grant row locks ahead of each route's plan/project lock order;
  // its later authority checks also retain existing denial/audit contracts.
  const credential = (await tx`SELECT c.id,a.role FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id
    WHERE c.token_sha256=${req.credentialDigest} AND c.actor_id=${req.actor.id}
      AND c.credential_kind=${req.browserSession ? 'BROWSER' : 'LOCAL'}
      AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
      AND NOT a.disabled AND a.organization_id=${ORG} AND a.role IN ('developer','approver')`)[0];
  if (!credential) throw Object.assign(new Error('UNAUTHENTICATED'), { productCode: 'UNAUTHENTICATED' });
  if (requiredRole && (req.actor.username ? req.actor.role : credential.role) !== requiredRole)
    throw Object.assign(new Error('DEVELOPER_REQUIRED'), { productCode: 'DEVELOPER_REQUIRED' });
  if (req.projectScopedMutation || req.scopedProjectId) {
    const mode = (await tx`SELECT mode FROM sf_project_access_mode WHERE organization_id=${ORG}`)[0];
    if (mode?.mode !== 'ENFORCED') throw Object.assign(new Error('MEMBERSHIP_BOOTSTRAP_REQUIRED'), { productCode: 'MEMBERSHIP_BOOTSTRAP_REQUIRED' });
  }
  // This value comes from the authenticated route's resolved project/release/plan,
  // never request JSON. Creation receipts intentionally have no implicit grant.
  if (req.scopedProjectId) {
    const grant = (await tx`SELECT id FROM sf_project_grants WHERE organization_id=${ORG}
      AND project_id=${req.scopedProjectId} AND actor_id=${req.actor.id} AND revoked_at IS NULL`)[0];
    if (!grant) throw Object.assign(new Error('NOT_FOUND'), { productCode: 'NOT_FOUND' });
  }
}
