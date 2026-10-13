import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {chromium} from 'playwright';
import {createDiscoveryFixture} from './helpers/discovery-fixture.mjs';
import {createTlsFixture, tlsRequest} from './helpers/product-tls-fixture.mjs';
import {configureTargetOption} from '../packages/targets/index.ts';

// Real HTTPS API, parser, Git and PostgreSQL; only Oracle observations are fixtures.
// No target credentials, Oracle connections, DDL dispatch or infrastructure changes.
test('HTTPS browser completes registration through discovery, SQL review, independent approval, readiness, request and durable audit', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 240000,
}, async () => {
  const cert = await createTlsFixture();
  let f, browser;
  const output = '.cache/phase6-acceptance';
  try {
    f = await createDiscoveryFixture({tls: cert.tls});
    await mkdir(output, {recursive: true});
    browser = await chromium.launch({args: [`--ignore-certificate-errors-spki-list=${cert.spki}`]});
    const page = await browser.newPage({viewport: {width: 1440, height: 1100}}), errors = [];
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    const screenshot = name => page.screenshot({path: `${output}/${name}.png`, fullPage: true});
    const signIn = async actor => {
      await page.goto(f.currentUrl());
      await page.getByLabel('Local access token').fill(actor.token);
      await page.getByRole('button', {name: 'Continue', exact: true}).click();
      await page.getByLabel('Sign out').waitFor();
      await page.getByRole('button', {name: /Projects/}).click();
      await page.locator('.project-row').filter({hasText: f.project.name}).click();
      await page.waitForFunction(() => document.querySelector('button[aria-label="Refresh workspace"]')?.disabled === false);
    };
    const logout = async () => {
      await page.getByLabel('Sign out').click();
      await page.getByLabel('Local access token').waitFor();
    };
    for (const path of ['/api/livez', '/api/readyz']) assert.equal((await tlsRequest(f.currentUrl(), cert.ca, path)).status, 200);
    await signIn(f.actors[0]);
    const cookie = (await page.context().cookies()).find(c => c.name === '__Host-schemaforge');
    assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Strict');
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.equal(await page.evaluate(async () => (await fetch('/api/session/logout', {method: 'POST'})).status), 403);

    await page.getByRole('button', {name: /Database instances/}).click();
    const discovery = page.getByRole('region', {name: 'Database connection discovery'});
    const instance = discovery.locator('details').filter({hasText: 'Register a database instance'});
    await instance.getByLabel('Instance name').fill('Phase 6 disposable reference');
    await instance.getByLabel('Container name').fill('FIXTURE_PDB');
    await instance.getByLabel('Host', {exact: true}).fill('phase6.example.invalid');
    await instance.getByLabel('Port', {exact: true}).fill('1521');
    await instance.getByLabel('Service', {exact: true}).fill('TARGETSVC');
    await instance.getByLabel('Transport').fill('TCPS');
    await instance.getByLabel('Owner/schema').fill('APP');
    await instance.getByLabel('Reason', {exact: true}).fill('Register an isolated manual reference for local acceptance');
    const registered = page.waitForResponse(r => r.url().endsWith('/database-instances') && r.request().method() === 'POST');
    await instance.getByRole('button', {name: 'Register instance', exact: true}).click();
    const registration = await registered;
    assert.equal(registration.status(), 201, await registration.text());
    const reference = (await registration.json()).instance;
    const assignment = (await f.db.sql`SELECT id FROM sf_reference_assignments WHERE schema_id=${reference.schemaId} AND project_id=${f.project.id} AND closed_at IS NULL`)[0];
    assert.ok(assignment);
    // The trusted OS operator configures the allowed purpose/route; the UI cannot grant itself this authority.
    const profileResponse = await f.api('POST', `${f.base}/profiles`, {
      name: 'Phase 6 deployment reference', environmentId: f.environment.id, engine: 'oracle',
      host: 'phase6.example.invalid', port: 1521, service: 'TARGETSVC', username: 'APP', credentialRef: f.credentialRef,
    });
    assert.equal(profileResponse.statusCode, 201);
    const option = await f.db.sql.begin(tx => configureTargetOption(tx, {
      ...f.optionDefinition(), assignmentId: assignment.id, routeId: reference.serviceId, profileId: profileResponse.json().profile.id,
      lineageId: randomUUID(),
    }));
    await screenshot('01-register-target');
    await page.getByRole('button', {name: /Project targets/}).click();
    await page.getByLabel('Assigned schema').selectOption(assignment.id);
    await page.getByLabel('Target option').selectOption(option.optionId);
    await page.getByLabel('Target environment').selectOption(f.environment.id);
    await page.getByLabel('Binding reason').fill('Retain the explicitly configured acceptance route');
    await page.getByRole('button', {name: 'Create binding revision', exact: true}).click();
    await page.getByRole('status').filter({hasText: 'Binding revision retained'}).waitFor();
    const binding = (await f.api('GET', `${f.base}/target-bindings`)).json().bindings.find(b => b.assignmentId === assignment.id);
    assert.ok(binding);

    await page.getByRole('button', {name: /Database instances/}).click();
    const connectionForm = discovery.locator('details').filter({hasText: 'Register a project connection'});
    await connectionForm.getByLabel('Assigned infrastructure').selectOption(assignment.id);
    await connectionForm.getByLabel('Connection name').fill('Phase 6 read-only discovery');
    await connectionForm.getByLabel('Username', {exact: true}).fill('DISCOVERY');
    await connectionForm.getByLabel('Credential reference').fill('secret://local/phase6-discovery');
    await connectionForm.getByLabel('Reason', {exact: true}).fill('Register a reference-only discovery account');
    await connectionForm.getByRole('button', {name: 'Register connection', exact: true}).click();
    const card = discovery.locator('.connection-card').filter({hasText: 'Phase 6 read-only discovery'});
    await card.waitFor();
    await card.getByLabel('Evidence reason').fill('Discover isolated synthetic identity');
    await card.getByRole('button', {name: 'Discover schemas', exact: true}).click();
    await card.locator('.observation-result').filter({hasText: 'DISCOVER · OBSERVED'}).waitFor();
    assert.match(await card.innerText(), /KELYRVO_FIXTURE/);
    assert.doesNotMatch(await card.innerText(), /FOREIGN_PRIVATE|fixture-private-password|secret:\/\//);
    await card.getByLabel('Project target binding').selectOption(binding.bindingId);
    await card.getByLabel('Observed schema owner').selectOption('APP');
    await card.getByLabel('Reason', {exact: true}).fill('Record fixture observation without live verification');
    await card.getByRole('button', {name: 'Verify target', exact: true}).click();
    await discovery.getByRole('alert').filter({hasText: 'accepted live evidence'}).waitFor();
    await card.getByRole('button', {name: 'Record observed target', exact: true}).click();
    await discovery.getByRole('status').filter({hasText: 'Observed target recorded'}).waitFor();
    await screenshot('02-discover-target');

    await page.getByRole('button', {name: /Releases/}).click();
    await page.locator(`.saved-release-row[data-release-id="${f.release.id}"]`).getByRole('button', {name: 'Inspect files', exact: true}).click();
    const validation = page.getByRole('region', {name: 'Validate SQL against target'});
    await validation.getByLabel('Validation target').selectOption(binding.bindingId);
    await validation.getByRole('button', {name: 'Validate against target', exact: true}).click();
    await validation.getByText('CREATE_TABLE', {exact: true}).waitFor();
    await validation.getByText('UNVERIFIED', {exact: true}).waitFor();
    await screenshot('03-validate-sql');
    await validation.getByRole('button', {name: 'Create immutable plan', exact: true}).click();
    const planId = await page.locator('.plan-option.selected').getAttribute('data-plan-id');
    const plan = (await f.api('GET', f.base)).json().plans.find(p => p.id === planId);
    assert.equal(plan.offlineIntent.format, 4);
    assert.equal(await page.getByRole('button', {name: 'Approve plan', exact: true}).count(), 0);
    await screenshot('04-create-plan');
    await logout();
    await signIn(f.actors[1]);
    await page.getByRole('button', {name: /Plans & review/}).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    await page.getByLabel('Decision reason').fill('Independent review of exact SQL, target and unverified Oracle semantics');
    await page.getByRole('button', {name: 'Approve plan', exact: true}).click();
    await page.getByRole('region', {name: 'Decision record'}).waitFor();
    await screenshot('05-independent-approval');
    await logout();
    await signIn(f.actors[0]);
    await page.getByRole('button', {name: /Plans & review/}).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    const readiness = page.getByRole('region', {name: 'Live execution readiness'});
    await readiness.getByRole('button', {name: 'Refresh readiness', exact: true}).click();
    const denied = (await f.api('GET', `/api/plans/${planId}/execution-readiness`)).json();
    assert.equal(denied.requestEligible, false);
    assert.ok(denied.checks.some(c => c.code === 'DEPLOY_AUTHORIZATION' && c.status === 'BLOCKED'));
    await f.membership.deployGrant(f.project.id, f.actors[0].id);
    await page.getByRole('button', {name: 'Refresh workspace', exact: true}).click();
    await readiness.getByRole('button', {name: 'Refresh readiness', exact: true}).click();
    await readiness.getByText('Governance checks allow a deployment request to be queued.', {exact: true}).waitFor();
    assert.match(await readiness.innerText(), /Oracle acceptance: not run/);
    await screenshot('06-execution-readiness');
    await page.getByLabel('Request reason').fill('Phase 6 durable request without Oracle authority');
    const requesting = page.waitForResponse(r => r.url().endsWith(`/plans/${planId}/execution`) && r.request().method() === 'POST');
    await page.getByRole('button', {name: 'Request deployment', exact: true}).click();
    const request = await requesting;
    assert.equal(request.status(), 201);
    const {job} = await request.json();
    assert.equal(job.state, 'WAITING_VALIDATION');
    assert.equal((await f.db.sql`SELECT admission_scope FROM sf_execution_jobs WHERE id=${job.id}`)[0].admission_scope, 'PRODUCT_REQUEST');
    await page.locator('.execution-job').filter({hasText: job.id}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Request deployment', exact: true}).isDisabled(), true);
    await screenshot('07-execution-request');
    await logout();
    await page.goto('about:blank');
    await f.restart();
    await signIn(f.actors[0]);
    await page.getByRole('button', {name: /Plans & review/}).click();
    await page.locator(`.plan-option[data-plan-id="${planId}"]`).click();
    const row = page.locator('.execution-job').filter({hasText: job.id});
    await row.getByRole('button', {name: 'View execution history', exact: true}).click();
    await row.getByText('WAITING VALIDATION', {exact: true}).first().waitFor();
    const downloading = page.waitForEvent('download');
    await row.getByRole('button', {name: 'Download execution record', exact: true}).click();
    const bundle = JSON.parse(await readFile(await (await downloading).path(), 'utf8'));
    assert.equal(createHash('sha256').update(bundle.record).digest('hex'), bundle.sha256);
    assert.doesNotMatch(bundle.record, /secret:\/\/|vault:\/\/|fixture-private-password/);
    await screenshot('08-history-after-restart');
    await page.getByRole('button', {name: /Audit & history/}).click();
    for (const action of ['EXECUTION_REQUESTED', 'PLAN_APPROVED', 'PLAN_CREATED', 'DATABASE_DISCOVERED', 'INSTANCE_REGISTERED']) {
      await page.locator('.timeline-row').filter({hasText: action}).first().waitFor();
    }
    await screenshot('09-audit-after-restart');
    await page.setViewportSize({width: 390, height: 844});
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await screenshot('10-audit-mobile');
    const retained = (await f.api('GET', `/api/execution-jobs/${job.id}`)).json().job;
    assert.equal(retained.state, 'WAITING_VALIDATION');
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_execution_attempts WHERE job_id=${job.id}`)[0].n, 0);
    await f.membership.revoke(f.project.id, f.actors[0].id);
    assert.equal((await f.api('GET', `/api/execution-jobs/${job.id}`)).statusCode, 404);
    assert.deepEqual(errors, []);
    await writeFile(`${output}/workflow-result.json`, JSON.stringify({
      scope: 'LOCAL_HTTPS_POSTGRESQL', status: 'PASS',
      journey: ['REGISTER_TARGET', 'DISCOVER', 'VALIDATE_SQL', 'CREATE_PLAN', 'INDEPENDENT_APPROVAL', 'READINESS', 'REQUEST', 'HISTORY_AUDIT'],
      discovery: 'FIXTURE', oracleAcceptance: 'NOT_RUN', execution: 'NOT_EXECUTED',
      secureSession: 'PASS', csrfDenial: 'PASS', deployPermission: 'PASS', revokedReadDenial: 'PASS',
      restartPersistence: 'PASS', executionRecordChecksum: 'PASS', screenshots: 10,
    }, null, 2) + '\n');
  } finally {
    await browser?.close();
    await f?.close();
    await cert.close();
  }
});
