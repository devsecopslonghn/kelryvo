import { actorIdentity, identityError, projectRoles } from './core.ts';

/** Central capabilities for managed identities. Legacy operator grants keep their contracts. */
export async function authorizeIdentity(sql: any, req: any) {
  const actor = await actorIdentity(sql,req.actor);
  if(!actor)throw identityError('UNAUTHENTICATED',401);
  req.actor=actor;
  const path=req.url.split('?')[0], safe=['GET','HEAD','OPTIONS'].includes(req.method);
  if(actor.mustChangePassword && !['/api/session','/api/session/logout','/api/account/password'].includes(path))
    throw identityError('PASSWORD_CHANGE_REQUIRED',403);
  if(!actor.username)return;
  if(path==='/api/projects'&&!safe) {
    if(actor.workspaceRole!=='admin')throw identityError('FORBIDDEN',403);
    req.identityPermission='workspace';return;
  }
  const projectId=req.scopedProjectId;
  if(projectId) {
    const roles=await projectRoles(sql,actor.id,projectId);
    req.identityRoles=roles;
    if(!roles?.length)throw identityError('NOT_FOUND',404);
    const review=/\/(decision|reviewer|revoke-approval|approval-revocations)$/.test(path);
    const deploy=/\/(execution-requests|execution-jobs)(\/[^/]+\/cancel)?$/.test(path);
    const manage=/\/(source|archive|environments|profiles|database-instances|database-connections|target-bindings)(\/|$)/.test(path);
    const directReview=review && path.endsWith('/decision') && req.body?.decision==='APPROVE' && roles.includes('developer');
    const allowed=safe || directReview || roles.includes('owner') || (review?roles.includes('approver'):
      deploy?roles.includes('deployer'):manage?roles.includes('owner'):roles.includes('developer'));
    if(!allowed)throw identityError('FORBIDDEN',403);
    req.identityPermission=review?'review':deploy?'deploy':manage?'manage':'write';
    req.actor={...actor,role:review&&(roles.includes('approver')||roles.includes('owner'))?'approver':roles.includes('developer')||roles.includes('owner')?'developer':actor.role};
  } else if(path.startsWith('/api/workspace/') || path.startsWith('/api/instances')) {
    if(actor.workspaceRole!=='admin')throw identityError('FORBIDDEN',403);
    req.identityPermission='workspace';
  }
}

export async function guardIdentityAuthority(tx: any,req: any) {
  if(!req.actor?.username)return;
  const current=await actorIdentity(tx,req.actor);
  if(!current || current.mustChangePassword)throw identityError('UNAUTHENTICATED',401);
  if(req.identityPermission==='workspace' && current.workspaceRole!=='admin')throw identityError('FORBIDDEN',403);
  if(req.scopedProjectId) {
    const roles=await projectRoles(tx,current.id,req.scopedProjectId);
    const allowed=roles?.includes('owner') || (req.identityPermission==='review'?(roles?.includes('approver')||req.url.split('?')[0].endsWith('/decision')&&req.body?.decision==='APPROVE'&&roles?.includes('developer')):
      req.identityPermission==='deploy'?roles?.includes('deployer'):req.identityPermission==='manage'?false:roles?.includes('developer'));
    // Read-only module transactions also use the shared mutation guard.
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && !allowed)throw identityError('FORBIDDEN',403);
    if(!roles?.length)throw identityError('NOT_FOUND',404);
  }
}
