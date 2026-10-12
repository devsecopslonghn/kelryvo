import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { startProduct } from '../../apps/api/server.ts';
import { openIsolatedProductDatabase } from './product-db.mjs';
import { createMembershipOperatorFixture } from './product-membership-fixture.mjs';
import { declareReference, assignReference } from '../../packages/catalog-reference/index.mjs';
import { configureTargetOption } from '../../packages/targets/index.ts';

const ORG = '00000000-0000-4000-8000-000000000001';

/** Real PostgreSQL, a temporary local Git repository, the installed parser, and scoped product actors. */
export async function createTargetWorkflowFixture({fileCount=1,discoveryRuntime,discoveryTimeoutMs}={}) {
  const repo = await mkdtemp(path.join(tmpdir(), 'sf-target-workflow-'));
  let db, app, membership;
  const actors = [
    { id: `target-developer-${randomUUID()}`, name: 'Target workflow developer', role: 'developer', token: randomBytes(32).toString('hex') },
    { id: `target-approver-${randomUUID()}`, name: 'Target workflow approver', role: 'approver', token: randomBytes(32).toString('hex') },
    { id: `target-deployer-${randomUUID()}`, name: 'Target workflow deployer', role: 'developer', token: randomBytes(32).toString('hex') },
  ];
  const git = (...args) => execFileSync('/usr/bin/git', ['-C', repo, ...args], { stdio: 'ignore' });
  const close = async () => {
    await app?.close();
    await membership?.close();
    await db?.close();
    await rm(repo, { recursive: true, force: true });
  };
  try {
    git('init'); git('config', 'user.name', 'Kelryvo target workflow fixture'); git('config', 'user.email', 'fixture@example.invalid');
    await mkdir(path.join(repo, 'migrations'));
    await writeFile(path.join(repo, 'migrations', 'V1__target.sql'), '-- retained local source\nCREATE TABLE target_workflow (id NUMBER);\n');
    for(let i=2;i<=fileCount;i++) await writeFile(path.join(repo,'migrations',`V${i}__target.sql`),`CREATE TABLE target_workflow_${i} (id NUMBER);\n`);
    git('add', 'migrations'); git('commit', '-m', 'Target workflow fixture release');

    db = await openIsolatedProductDatabase();
    const repositories = [
      { id: 'target-workflow-repo', name: 'Target workflow repository', path: repo },
      { id: 'target-workflow-repo-alt', name: 'Target workflow repository alias', path: repo },
    ];
    app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories, port: 0, discoveryRuntime, discoveryTimeoutMs });
    membership = await createMembershipOperatorFixture(db.databaseUrl);
    await membership.activateEmptyFixture(app);
    const api = async (method, route, body, actor = actors[0]) => app.inject({ method, url: route,
      ...(body === undefined ? {} : { payload: body }), headers: { authorization: `Bearer ${actor.token}` } });
    const { project } = await membership.createProjectWithExplicitMembers({
      create: () => api('POST', '/api/projects', { name: 'Target workflow project' }),
      read: (id) => api('GET', `/api/projects/${id}`), memberIds: actors.slice(0, 2).map((actor) => actor.id),
    });
    const base = `/api/projects/${project.id}`;
    const environment = (await api('POST', `${base}/environments`, { name: 'Local' })).json().environment;
    const credentialRef = 'vault://local/target-workflow';
    const profile = (await api('POST', `${base}/profiles`, { name: 'Target workflow profile', environmentId: environment.id,
      engine: 'oracle', host: 'target-workflow.example.invalid', port: 1521, service: 'TARGETSVC', username: 'APP', credentialRef })).json().profile;
    await api('PUT', `${base}/source`, { repositoryId: repositories[0].id, folder: 'migrations' });
    const imported = await api('POST', `${base}/releases`, { repositoryId: repositories[0].id, commit: 'HEAD', folder: 'migrations' });
    if (imported.statusCode !== 201 || imported.json().release.validationStatus !== 'VALID') throw new Error(`Target workflow fixture parser or release unavailable: ${imported.statusCode} ${imported.body}`);
    const release = imported.json().release;

    const reference = await declareReference(db.sql, { databaseKey: 'target-workflow-db', databaseLabel: 'Target workflow database',
      containerKey: 'target-workflow-pdb', containerName: 'Target workflow PDB', containerKind: 'PDB', environment: 'DEV',
      host: 'target-workflow.example.invalid', port: 1521, service: 'TARGETSVC', transport: 'TCPS', owner: 'APP' });
    await assignReference(db.sql, { schemaId: reference.schemaId, projectId: project.id, expectedRevision: '0', reason: 'assign workflow schema' });
    const assignment = (await db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND project_id=${project.id} AND closed_at IS NULL`)[0];
    if (!assignment) throw new Error('Target workflow fixture assignment unavailable');
    const lineageId = randomUUID();
    const optionDefinition = () => ({ expectedOptionRevision: '0', projectId: project.id, assignmentId: assignment.id,
      environmentId: environment.id, profileId: profile.id, routeId: reference.serviceId, routeConfigRevision: '1',
      routeAlias: 'Target workflow route', migrationNamespace: 'KELYRVO_WORKFLOW', policyId: randomUUID(), policyRevision: '1',
      exactOwner: 'APP', deploymentPrincipalId: randomUUID(), principalPurpose: 'DEPLOY', principalUsername: 'APP',
      privatePrincipalRef: credentialRef, principalAlias: 'Workflow deployment principal', lineageId,
      reason: 'configure offline target option' });
    const option = await db.sql.begin((tx) => configureTargetOption(tx, optionDefinition()));

    const foreign = await membership.createProjectWithExplicitMembers({
      create: () => api('POST', '/api/projects', { name: `Foreign target project ${randomUUID()}` }),
      read: (id) => api('GET', `/api/projects/${id}`), memberIds: actors.slice(0, 2).map((actor) => actor.id),
    });
    const foreignBase = `/api/projects/${foreign.project.id}`;

    const createBinding = async ({ bindingId, expectedBindingRevision = '0', targetOptionId = option.optionId,
      expectedTargetOptionRevision = option.optionRevision } = {}, actor = actors[0]) => {
      const response = await api('POST', `${base}/target-bindings`, {
        assignmentId: assignment.id, expectedAssignmentRevision: '1', environmentId: environment.id,
        targetOptionId, expectedTargetOptionRevision, ...(bindingId ? { bindingId } : {}), expectedBindingRevision,
        reason: 'bind assigned schema for offline review',
      }, actor);
      return response;
    };
    const makePlan = async (binding, actor = actors[0]) => api('POST', `${base}/plans`, {
      intentVersion: 2, releaseId: release.id, assignmentId: assignment.id,
      expectedAssignmentRevision: binding.assignmentRevision, targetBindingId: binding.bindingId,
      expectedBindingRevision: binding.bindingRevision,
    }, actor);
    const decide = async (plan, actor = actors[1], extra = {}) => api('POST', `/api/plans/${plan.id}/decision`, {
      decision: 'APPROVE', reason: 'Independent target workflow review',
      expectedIntentDigest: plan.offlineIntent.digest,
      expectedAssignmentRevision: plan.retainedTarget.assignmentRevision,
      expectedBindingRevision: plan.retainedTarget.bindingRevision,
      ...extra,
    }, actor);
    const setBindingToOption = async ({ bindingId, expectedBindingRevision, targetOptionId, expectedTargetOptionRevision }, actor = actors[0]) => {
      const response = await api('POST', `${base}/target-bindings`, { assignmentId: assignment.id, expectedAssignmentRevision: '1',
        environmentId: environment.id, targetOptionId, expectedTargetOptionRevision, bindingId, expectedBindingRevision,
        reason: 'advance binding to the current option revision' }, actor);
      return response;
    };
    const currentUrl = () => `http://127.0.0.1:${app.server.address().port}`;
    const restart = async () => {
      await app.close();
      await db.reopen();
      app = await startProduct({ databaseUrl: db.databaseUrl, actors, repositories: [], port: 0, discoveryRuntime, discoveryTimeoutMs });
    };
    return { db, get app() { return app; }, membership, actors, project, base, environment, profile, credentialRef,
      repositories, repo, git, reference, assignment, option, lineageId, optionDefinition, release, foreignProject: foreign.project, foreignBase,
      api, createBinding, makePlan, decide, setBindingToOption, currentUrl, restart, close };
  } catch (error) {
    await close();
    throw error;
  }
}
