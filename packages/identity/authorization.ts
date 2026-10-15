import { actorIdentity, identityError, projectRoles } from './core.ts';

const uuid=(v: any)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);

/** Resolve target scope from persisted resources, again under the write lock at mutation checkpoints. */
export async function resolveIdentityEnvironment(sql: any,req: any): Promise<string|null> {
  const path=req.url.split('?')[0],project=req.scopedProjectId;
  if(!project)return null;
  if(path.startsWith('/api/execution-jobs/'))return (await sql`SELECT profile.environment_id FROM sf_execution_jobs j
    JOIN sf_plans p ON p.id=j.plan_id JOIN sf_profiles profile ON profile.id=p.profile_id WHERE j.id=${req.params.id} AND j.project_id=${project}`)[0]?.environment_id??null;
  const planId=req.params?.planId??(path.startsWith('/api/plans/')||path.includes('/plans/')&&req.params?.projectId?req.params.id:null);
  if(uuid(planId))return (await sql`SELECT profile.environment_id FROM sf_plans p JOIN sf_profiles profile ON profile.id=p.profile_id
    WHERE p.id=${planId} AND p.project_id=${project}`)[0]?.environment_id??null;
  const profileId=path.includes('/profiles/')?req.params?.connectionId:req.body?.profileId;
  if(uuid(profileId))return (await sql`SELECT environment_id FROM sf_profiles WHERE id=${profileId} AND project_id=${project}`)[0]?.environment_id??null;
  const bindingId=req.params?.bindingId??req.body?.targetBindingId;
  if(uuid(bindingId))return (await sql`SELECT environment_id FROM sf_target_bindings WHERE id=${bindingId} AND project_id=${project}`)[0]?.environment_id??null;
  if(path.endsWith('/profiles')&&uuid(req.body?.environmentId))return (await sql`SELECT id FROM sf_environments WHERE id=${req.body.environmentId} AND project_id=${project}`)[0]?.id??null;
  return null;
}

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
    req.scopeEnvironmentId=await resolveIdentityEnvironment(sql,req);
    const roles=await projectRoles(sql,actor.id,projectId,req.scopeEnvironmentId);
    req.identityRoles=roles;
    if(!roles?.length)throw identityError('NOT_FOUND',404);
    const review=/\/(decision|reviewer|revoke-approval|approval-revocation|approval-revocations)$/.test(path);
    const deploy=path.endsWith('/reconciliations') || /\/(execution|execution-requests|execution-jobs)(\/[^/]+\/cancel)?$/.test(path);
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
    req.scopeEnvironmentId=await resolveIdentityEnvironment(tx,req);
    const roles=await projectRoles(tx,current.id,req.scopedProjectId,req.scopeEnvironmentId);
    const allowed=roles?.includes('owner') || (req.identityPermission==='review'?(roles?.includes('approver')||req.url.split('?')[0].endsWith('/decision')&&req.body?.decision==='APPROVE'&&roles?.includes('developer')):
      req.identityPermission==='deploy'?roles?.includes('deployer'):req.identityPermission==='manage'?false:roles?.includes('developer'));
    // Read-only module transactions also use the shared mutation guard.
    if(!['GET','HEAD','OPTIONS'].includes(req.method) && !allowed)throw identityError('FORBIDDEN',403);
    if(!roles?.length)throw identityError('NOT_FOUND',404);
    if(req.identityPermission==='manage'&&req.body?.environmentId && req.body.environmentId!==req.scopeEnvironmentId){
      if(!uuid(req.body.environmentId))throw identityError('INVALID_REQUEST');
      const destination=await projectRoles(tx,current.id,req.scopedProjectId,req.body.environmentId);
      if(!destination?.includes('owner'))throw identityError('FORBIDDEN',403);
    }
  }
}
