import { acquireTargetLocks } from './locks.ts';
import { guardMutationAuthority } from '../database/mutation-authority.ts';
import { actorHasProjectGrant, projectAccessMode } from '../database/project-membership.ts';
import { listTargetOptions, listTargetBindings, getTargetBinding, createTargetBinding } from './index.ts';
const ORG = '00000000-0000-4000-8000-000000000001';
const uuid = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const revision = (v: unknown) => typeof v === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(v) && BigInt(v) <= 9223372036854775807n;
export function registerTargets(app: any, {sql, authenticate}: any) {
  const read = async (req: any, fn: any, empty: any) => sql.begin(async (tx: any) => {
    if (await projectAccessMode(tx) !== 'ENFORCED') return empty;
    if (req.params.bindingId) await acquireTargetLocks(tx, {bindingId:req.params.bindingId});
    await guardMutationAuthority(tx, req);
    if (!await actorHasProjectGrant(tx, req.actor.id, req.params.id)) throw Object.assign(new Error('NOT_FOUND'), {productCode:'NOT_FOUND'});
    return fn(tx);
  });
  app.get('/api/projects/:id/target-options', {preHandler:authenticate}, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || Object.keys(req.query).some(k => !['assignmentId','after'].includes(k)) || !uuid(req.query.assignmentId) || req.query.after !== undefined && !uuid(req.query.after)) return reply.code(400).send({error:'INVALID_REQUEST'});
    return read(req, (tx: any) => listTargetOptions(tx, req.params.id, req.query.assignmentId, req.query.after), {options:[],nextCursor:null});
  });
  app.get('/api/projects/:id/target-bindings', {preHandler:authenticate}, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || Object.keys(req.query).some(k => k !== 'after') || req.query.after !== undefined && !uuid(req.query.after)) return reply.code(400).send({error:'INVALID_REQUEST'});
    return read(req, (tx: any) => listTargetBindings(tx, req.params.id, req.query.after), {bindings:[],nextCursor:null});
  });
  app.get('/api/projects/:id/target-bindings/:bindingId', {preHandler:authenticate}, async (req: any, reply: any) => {
    if (!uuid(req.params.id) || !uuid(req.params.bindingId) || Object.keys(req.query).length) return reply.code(404).send({error:'NOT_FOUND'});
    const result = await read(req, (tx: any) => getTargetBinding(tx, req.params.id, req.params.bindingId), null);
    return result || reply.code(404).send({error:'NOT_FOUND'});
  });
  app.post('/api/projects/:id/target-bindings', {preHandler:authenticate}, async (req: any, reply: any) => {
    const b = req.body, keys = ['assignmentId','expectedAssignmentRevision','environmentId','targetOptionId','expectedTargetOptionRevision','bindingId','expectedBindingRevision','reason'];
    if (!uuid(req.params.id) || !b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !keys.includes(k))
        || !['assignmentId','environmentId','targetOptionId'].every(k => uuid(b[k])) || b.bindingId !== undefined && !uuid(b.bindingId)
        || !['expectedAssignmentRevision','expectedTargetOptionRevision','expectedBindingRevision'].every(k => revision(b[k]))
        || typeof b.reason !== 'string' || !b.reason.trim() || b.reason.length > 2000 || /[\u0000-\u001f\u007f]/.test(b.reason) || Buffer.from(b.reason).toString() !== b.reason) return reply.code(400).send({error:'INVALID_REQUEST'});
    const result = await sql.begin(async (tx: any) => {
      await acquireTargetLocks(tx, {assignmentId:b.assignmentId});
      await guardMutationAuthority(tx, req, 'developer');
      const gate = (await tx`SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF g`)[0];
      if (gate?.state !== 'ACTIVE') throw Object.assign(new Error('METADATA_RESTORE_HOLD'), {productCode:'METADATA_RESTORE_HOLD'});
      return createTargetBinding(tx, {...b, projectId:req.params.id, actorId:req.actor.id});
    });
    return reply.code(201).send(result);
  });
}
