import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createDiscoveryFixture } from './helpers/discovery-fixture.mjs';

test('browser onboards one master Oracle credential across multiple project schemas without claiming fixture evidence is live', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 180000,
}, async () => {
  const f = await createDiscoveryFixture();
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    const openProject = async (project = f.project) => {
      await page.goto(f.currentUrl());
      if (await page.getByLabel('Local access token').count()) {
        await page.getByLabel('Local access token').fill(f.actors[0].token);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
      }
      await page.getByLabel('Sign out').waitFor();
      await page.getByRole('button', { name: /Projects/ }).click();
      await page.locator('.project-row').filter({ hasText: project.name }).click();
      await page.getByRole('button', { name: /Database instances/ }).click();
    };

    await openProject();
    const onboarding = page.getByRole('region', { name: 'Oracle instance onboarding' });
    const form = onboarding.locator('details').filter({ hasText: 'Register an Oracle instance with one master credential' });
    assert.equal(await form.getByLabel('Owner/schema').count(), 0, 'master registration has no schema/owner field');
    assert.equal(await form.getByLabel(/password/i).count(), 0, 'master registration never accepts a password');
    const privateRef = 'secret://acceptance/private-master-reference';
    const privatePassword = 'acceptance-password-must-never-be-retained';
    await form.getByLabel('Instance name').fill('Browser master instance');
    await form.getByLabel('Container name').fill('Browser master PDB');
    await form.getByLabel('Host', { exact: true }).fill('master-browser.example.invalid');
    await form.getByLabel('Port', { exact: true }).fill('1521');
    await form.getByLabel('Service name').fill('MASTER_BROWSER');
    await form.getByLabel('Master username').fill('APP');
    await form.getByLabel('Master credential reference').fill(privateRef);
    await form.getByLabel('Reason', { exact: true }).fill('Register one master credential for discovery');

    let createRequest;
    const created = page.waitForResponse(response => response.url().endsWith('/database-instances/master') && response.request().method() === 'POST');
    page.on('request', request => {
      if (request.url().endsWith('/database-instances/master') && request.method() === 'POST') createRequest = request;
    });
    await form.getByRole('button', { name: 'Register instance', exact: true }).click();
    const createdResponse = await created;
    assert.equal(createdResponse.status(), 201, await createdResponse.text());
    assert.equal(createRequest.postDataJSON().credentialRef, privateRef);
    assert.equal('owner' in createRequest.postDataJSON(), false);
    assert.equal('schema' in createRequest.postDataJSON(), false);
    const createdPayload = await createdResponse.json();
    assert.equal(createdPayload.connection.credentialMode, 'INSTANCE_MASTER');
    assert.equal(JSON.stringify(createdPayload).includes(privateRef), false, 'master credential reference is not echoed');
    assert.equal(JSON.stringify(createdPayload).includes(privatePassword), false);

    await onboarding.getByLabel('Project environment').selectOption(f.environment.id);
    await onboarding.getByLabel('Reason for discovery or assignment').fill('Discover schemas through the single instance master');
    const discovered = page.waitForResponse(response => response.url().endsWith(`/database-connections/${createdPayload.connection.id}/discover`) && response.request().method() === 'POST');
    await onboarding.getByRole('button', { name: 'Discover schemas', exact: true }).click();
    const discoveryResponse = await discovered;
    assert.equal(discoveryResponse.status(), 201, await discoveryResponse.text());
    const discoveryPayload = await discoveryResponse.json();
    assert.deepEqual(discoveryPayload.observation.schemas.map(schema => schema.owner).sort(), ['APP', 'FOREIGN_PRIVATE']);
    assert.equal(JSON.stringify(discoveryPayload).includes(privateRef), false);
    assert.equal(JSON.stringify(discoveryPayload).includes(privatePassword), false);

    const discoveredSchemas = onboarding.getByRole('region', { name: 'Discovered schemas' });
    await discoveredSchemas.locator('li').filter({ hasText: /^APP/ }).getByRole('checkbox').check();
    await discoveredSchemas.locator('li').filter({ hasText: /^FOREIGN_PRIVATE/ }).getByRole('checkbox').check();
    const assigned = page.waitForResponse(response => response.url().endsWith(`/database-connections/${createdPayload.connection.id}/assign-schemas`) && response.request().method() === 'POST');
    await discoveredSchemas.getByRole('button', { name: 'Assign 2 selected schemas', exact: true }).click();
    const assignmentResponse = await assigned;
    assert.equal(assignmentResponse.status(), 201, await assignmentResponse.text());
    const assignmentPayload = await assignmentResponse.json();
    assert.deepEqual(assignmentPayload.bindings.map(binding => binding.exactOwner).sort(), ['APP', 'FOREIGN_PRIVATE']);
    assert.equal(new Set(assignmentPayload.bindings.map(binding => binding.bindingId)).size, 2, 'each owner receives a separate target binding');

    const bindingCards = onboarding.locator('.instance-bindings [data-binding-id]');
    await bindingCards.filter({ hasText: 'APP' }).waitFor();
    await bindingCards.filter({ hasText: 'FOREIGN_PRIVATE' }).waitFor();
    assert.equal(await bindingCards.count(), 2);
    assert.equal(await onboarding.getByText('PROVISIONAL', { exact: true }).count(), 2);
    await bindingCards.filter({ hasText: 'APP' }).getByRole('button', { name: 'Verify APP', exact: true }).click();
    await onboarding.getByRole('alert').filter({ hasText: 'LIVE_VERIFICATION_UNACCEPTED' }).waitFor();
    await bindingCards.filter({ hasText: 'APP' }).getByText('PROVISIONAL', { exact: true }).waitFor();
    assert.equal(await bindingCards.filter({ hasText: 'APP' }).getByRole('button', { name: 'Verify APP', exact: true }).count(), 1);

    const shared = await f.db.sql`
      SELECT COUNT(DISTINCT source.profile_id)::int AS profiles, COUNT(DISTINCT source.connection_id)::int AS master_connections,
        COUNT(DISTINCT assignment.id)::int AS assignments, COUNT(DISTINCT binding.id)::int AS bindings,
        array_agg(DISTINCT schema.exact_owner ORDER BY schema.exact_owner) AS owners
      FROM sf_instance_profile_sources source
      JOIN sf_target_binding_revisions revision ON revision.profile_id=source.profile_id
      JOIN sf_target_bindings binding ON binding.id=revision.binding_id AND binding.current_revision=revision.revision
      JOIN sf_reference_assignments assignment ON assignment.id=binding.assignment_id
      JOIN sf_reference_schemas schema ON schema.id=assignment.schema_id
      WHERE source.connection_id=${createdPayload.connection.id} AND assignment.project_id=${f.project.id}
        AND schema.container_id=${createdPayload.connection.containerId}`;
    assert.equal(shared[0].profiles, 1, 'both schema targets derive from one instance profile');
    assert.equal(shared[0].master_connections, 1);
    assert.equal(shared[0].assignments, 2);
    assert.equal(shared[0].bindings, 2);
    assert.deepEqual(shared[0].owners, ['APP', 'FOREIGN_PRIVATE']);

    const otherProject = await f.api('GET', `${f.foreignBase}/database-connections`);
    assert.equal(otherProject.statusCode, 200);
    assert.equal(otherProject.json().connections.some(connection => connection.id === createdPayload.connection.id), false,
      'the master instance is not exposed outside its project scope');

    assert.equal(await onboarding.getByText(privateRef, { exact: true }).count(), 0);
    assert.equal(await onboarding.getByText(privatePassword, { exact: true }).count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth + 1)
        .slice(-8).map(element => ({ tag: element.tagName, className: element.className, width: element.getBoundingClientRect().width })))));

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await openProject();
    const retained = page.getByRole('region', { name: 'Oracle instance onboarding' });
    await retained.locator('.instance-bindings [data-binding-id]').filter({ hasText: 'APP' }).waitFor();
    await retained.locator('.instance-bindings [data-binding-id]').filter({ hasText: 'FOREIGN_PRIVATE' }).waitFor();
    assert.equal(await retained.locator('.instance-bindings [data-binding-id]').count(), 2);
    assert.equal(await retained.getByText('PROVISIONAL', { exact: true }).count(), 2);

    await page.getByRole('button', { name: /Projects/ }).click();
    await page.locator('.project-row').filter({ hasText: f.foreignProject.name }).click();
    await page.getByRole('button', { name: /Database instances/ }).click();
    const reuseOnboarding = page.getByRole('region', { name: 'Oracle instance onboarding' });
    const reuse = reuseOnboarding.locator('details').filter({ hasText: 'Use an existing workspace master credential' });
    await reuse.locator('summary').click();
    await reuse.getByLabel('Workspace Oracle instance').selectOption(createdPayload.connection.id);
    await reuse.getByLabel('Reason', { exact: true }).fill('Reuse the registered master without moving schema assignments');
    const attached = page.waitForResponse(response => response.url().endsWith('/database-instances/attach') && response.request().method() === 'POST');
    await reuse.getByRole('button', { name: 'Attach instance', exact: true }).click();
    const attachResponse = await attached;
    assert.equal(attachResponse.status(), 200, await attachResponse.text());
    const attachPayload = await attachResponse.json();
    assert.equal(attachPayload.connection.id, createdPayload.connection.id);
    assert.equal(JSON.stringify(attachPayload).includes(privateRef), false);
    assert.equal(await reuse.getByLabel('Master credential reference').count(), 0, 'reuse requires no credential re-entry');
    const foreignAssignments = await f.db.sql`
      SELECT COUNT(*)::int AS count FROM sf_reference_assignments assignment
      JOIN sf_reference_schemas schema ON schema.id=assignment.schema_id
      WHERE assignment.project_id=${f.foreignProject.id} AND schema.container_id=${createdPayload.connection.containerId}
        AND assignment.closed_at IS NULL`;
    assert.equal(foreignAssignments[0].count, 0, 'attaching the master does not transfer project schema assignments');
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await f.close();
  }
});
