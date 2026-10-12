import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { declareReference, assignReference } from '../packages/catalog-reference/index.mjs';
import { initializeTargetSchema, configureTargetOption, createTargetBinding, listTargetOptions,
  listTargetBindings, getTargetBinding, loadBindingTarget, checkTargetCurrentness } from '../packages/targets/index.ts';

const declaration = { databaseKey: 'target-db', databaseLabel: 'Target DB', containerKey: 'target-pdb',
  containerName: 'Target PDB', containerKind: 'PDB', environment: 'PROD', host: 'target.example.invalid',
  port: 1521, service: 'TargetSvc', transport: 'TCPS', owner: 'APP_OWNER' };

test('target options and bindings enforce CAS and project scope, preserve private facts, currentness and stream lineage',
  { skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 30000 }, async () => {
    const db = await openIsolatedProductDatabase();
    try {
      await initializeTargetSchema(db.sql);
      const ref = await declareReference(db.sql, declaration);
      const projectRows = await db.sql`INSERT INTO sf_projects(organization_id,name)
        VALUES('00000000-0000-4000-8000-000000000001','Target A'),
              ('00000000-0000-4000-8000-000000000001','Target B') RETURNING id,name`;
      const projectA = projectRows.find(row => row.name === 'Target A');
      const projectB = projectRows.find(row => row.name === 'Target B');
      await db.sql`INSERT INTO sf_local_actors(id,organization_id,role,display_name)
        VALUES('target-test-actor','00000000-0000-4000-8000-000000000001','developer','Target test actor')`;
      const envA = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name)
        VALUES(${projectA.id},'00000000-0000-4000-8000-000000000001','Production') RETURNING id`)[0];
      const envB = (await db.sql`INSERT INTO sf_environments(project_id,organization_id,name)
        VALUES(${projectB.id},'00000000-0000-4000-8000-000000000001','Production') RETURNING id`)[0];
      const privateRef = 'local-vault://target/deploy-ref';
      const profileA = (await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${projectA.id},'00000000-0000-4000-8000-000000000001',${envA.id},'A production','oracle','target.example.invalid',1521,'TargetSvc','APP_OWNER',${privateRef}) RETURNING id`)[0];
      await db.sql`INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref)
        VALUES(${projectB.id},'00000000-0000-4000-8000-000000000001',${envB.id},'B production','oracle','target.example.invalid',1521,'TargetSvc','APP_OWNER',${privateRef})`;
      await assignReference(db.sql, { schemaId: ref.schemaId, projectId: projectA.id, expectedRevision: '0', reason: 'assign target schema' });
      let activeAssignment = (await db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${ref.schemaId} AND closed_at IS NULL`)[0];
      const optionInput = (projectId, environmentId, profileId, assignmentId, lineageId=randomUUID(), expectedOptionRevision='0') => ({
        expectedOptionRevision, projectId, assignmentId, environmentId, profileId, routeId: ref.serviceId,
        routeConfigRevision: '1', routeAlias: 'Production route', migrationNamespace: 'schemaforge',
        policyId: randomUUID(), policyRevision: '1', exactOwner: 'APP_OWNER', deploymentPrincipalId: randomUUID(),
        principalPurpose: 'DEPLOY', principalUsername: 'APP_OWNER', privatePrincipalRef: privateRef,
        principalAlias: 'Production deploy principal', reason: 'register offline target option',
        lineageId,
      });
      const incompatibleRef = await declareReference(db.sql, { ...declaration, containerKey: 'other-target-pdb',
        containerName: 'Other PDB', host: 'other-target.example.invalid', service: 'OtherSvc' });
      await db.sql`UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=now(),activated_by_os_uid=1
        WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
      await assert.rejects(db.sql.begin(tx => configureTargetOption(tx, {
        ...optionInput(projectA.id, envA.id, profileA.id, activeAssignment.id), principalPurpose: 'DISCOVERY',
      })), e => e.productCode === 'TARGET_OPTION_INELIGIBLE');
      await assert.rejects(db.sql.begin(tx => configureTargetOption(tx, {
        ...optionInput(projectA.id, envA.id, profileA.id, activeAssignment.id), exactOwner: 'app_owner',
      })), e => e.productCode === 'TARGET_OPTION_INELIGIBLE');
      await assert.rejects(db.sql.begin(tx => configureTargetOption(tx, {
        ...optionInput(projectA.id, envA.id, profileA.id, activeAssignment.id), routeId: incompatibleRef.serviceId,
      })), e => e.productCode === 'TARGET_OPTION_INELIGIBLE');
      await assert.rejects(db.sql.begin(tx => configureTargetOption(tx, {
        ...optionInput(projectA.id, envA.id, profileA.id, activeAssignment.id), identityState: 'OBSERVED',
        observationDigest: 'a'.repeat(64), observedAt: new Date().toISOString(),
      })), e => e.productCode === 'TARGET_OPTION_INELIGIBLE');
      const optionA = await db.sql.begin(tx => configureTargetOption(tx,
        optionInput(projectA.id, envA.id, profileA.id, activeAssignment.id)));
      assert.equal(optionA.enabled, true);
      assert.equal(Object.hasOwn(optionA, 'privatePrincipalRef'), false);
      const bindingA = await db.sql.begin(tx => createTargetBinding(tx, {
        projectId: projectA.id, assignmentId: activeAssignment.id, expectedAssignmentRevision: '1',
        environmentId: envA.id, targetOptionId: optionA.optionId, expectedTargetOptionRevision: '1',
        expectedBindingRevision: '0', reason: 'bind production target', actorId: 'target-test-actor',
      }));
      assert.equal(bindingA.binding.bindingRevision, '1');
      assert.equal(bindingA.currentness.state, 'CURRENT');

      const loaded = await db.sql.begin(tx => loadBindingTarget(tx, projectA.id, bindingA.binding.bindingId));
      assert.equal(loaded.privatePrincipalRef, privateRef);
      assert.equal(loaded.profile.credentialRef, privateRef);
      assert.equal(loaded.exactOwner, 'APP_OWNER');
      const wrongCase = await db.sql.begin(tx => checkTargetCurrentness(tx, projectA.id,
        { ...loaded, exactOwner: 'app_owner' }));
      assert.equal(wrongCase.state, 'UNKNOWN');
      assert.ok(wrongCase.reasons.includes('INTEGRITY_UNAVAILABLE'));
      const safeOptions = await listTargetOptions(db.sql, projectA.id, activeAssignment.id);
      assert.equal(safeOptions.options.length, 1);
      assert.equal(JSON.stringify(safeOptions).includes(privateRef), false);
      assert.equal((await listTargetBindings(db.sql, projectA.id)).bindings.length, 1);
      await assert.rejects(getTargetBinding(db.sql, projectB.id, bindingA.binding.bindingId), e => e.productCode === 'NOT_FOUND');
      await assert.rejects(listTargetOptions(db.sql, projectB.id, activeAssignment.id), e => e.productCode === 'NOT_FOUND');

      const races = await Promise.allSettled([1, 2].map(() => db.sql.begin(tx => createTargetBinding(tx, {
        projectId: projectA.id, assignmentId: activeAssignment.id, expectedAssignmentRevision: '1',
        environmentId: envA.id, targetOptionId: optionA.optionId, expectedTargetOptionRevision: '1',
        bindingId: bindingA.binding.bindingId, expectedBindingRevision: '1', reason: 'replace target binding', actorId: 'target-test-actor',
      }))));
      assert.equal(races.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(races.filter(r => r.status === 'rejected').length, 1);
      assert.equal(races.find(r => r.status === 'rejected').reason.productCode, 'TARGET_REVISION_CONFLICT');
      const newest = await getTargetBinding(db.sql, projectA.id, bindingA.binding.bindingId);
      assert.equal(newest.binding.bindingRevision, '2');
      assert.equal(newest.revisions.length, 2);
      assert.equal(newest.binding.actorId, 'target-test-actor');
      assert.equal(newest.binding.reason, 'replace target binding');
      assert.equal(JSON.stringify(newest).includes(privateRef), false);

      await db.sql`UPDATE sf_profiles SET host='changed.example.invalid' WHERE id=${profileA.id}`;
      const changedProfile = await db.sql.begin(tx => checkTargetCurrentness(tx, projectA.id, loaded));
      assert.equal(changedProfile.state, 'STALE');
      assert.ok(changedProfile.reasons.includes('PROFILE_CHANGED'));
      await db.sql`UPDATE sf_profiles SET host='target.example.invalid' WHERE id=${profileA.id}`;

      await db.sql`UPDATE sf_projects SET source_binding_generation=2 WHERE id=${projectA.id}`;
      const staleSource = await db.sql.begin(tx => checkTargetCurrentness(tx, projectA.id, loaded, '999'));
      assert.equal(staleSource.state, 'STALE');
      assert.ok(staleSource.reasons.includes('SOURCE_CHANGED'));

      await assignReference(db.sql, { schemaId: ref.schemaId, projectId: projectB.id,
        expectedRevision: '1', reason: 'transfer target schema' });
      const transferredCurrentness = await db.sql.begin(tx => checkTargetCurrentness(tx, projectA.id, loaded));
      assert.equal(transferredCurrentness.state, 'STALE');
      assert.ok(transferredCurrentness.reasons.includes('ASSIGNMENT_CLOSED'));
      activeAssignment = (await db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${ref.schemaId} AND closed_at IS NULL`)[0];
      const profileB = (await db.sql`SELECT id FROM sf_profiles WHERE project_id=${projectB.id}`)[0];
      const optionB = await db.sql.begin(tx => configureTargetOption(tx,
        optionInput(projectB.id, envB.id, profileB.id, activeAssignment.id, optionA.lineageId)));
      const latestStream = (await db.sql`SELECT stream_id,lineage_id FROM sf_target_option_revisions WHERE option_id=${optionB.optionId}`)[0];
      assert.equal(latestStream.stream_id, optionA.streamId);
      assert.equal(latestStream.lineage_id, optionA.lineageId);
    } finally {
      await db.close();
    }
  });
