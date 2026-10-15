import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createIdentityProviderLab, runTrustedNode } from './helpers/identity-disposable-provider.mjs';

const enabled = process.env.KELRYVO_IDENTITY_INTEGRATION === '1';
const adapterUrl = new URL('../packages/identity/providers.ts', import.meta.url).href;

test('LDAP and OIDC providers complete real disposable authentication flows', { skip: !enabled, timeout: 300_000 }, async t => {
  const lab = await createIdentityProviderLab();
  t.after(() => lab.cleanup());

  const ldapConfig = { type: 'LDAP', url: `ldaps://localhost:${lab.ldapPort}`, bindDN: `cn=admin,${lab.ldapBase}`,
    baseDN: `ou=people,${lab.ldapBase}`, userFilter: '(uid={{username}})', usernameAttribute: 'uid',
    groupAttribute: 'memberOf', provisioning: 'DISABLED', defaultRole: 'developer', groupMappings: [] };
  const ldap = runTrustedNode(lab.cert, `
    import { ldapIdentity, testProvider } from ${JSON.stringify(adapterUrl)};
    const provider = ${JSON.stringify(ldapConfig)};
    const status = await testProvider(provider, 'integration-only-secret');
    const identity = await ldapIdentity(provider, 'integration-only-secret', 'alice-integration-password', 'alice');
    let wrongPassword = false, escapedFilter = false;
    try { await ldapIdentity(provider, 'integration-only-secret', 'wrong-password', 'alice'); } catch (error) { wrongPassword = error.productCode === 'UNAUTHENTICATED'; }
    try { await ldapIdentity(provider, 'integration-only-secret', 'alice-integration-password', 'alice*'); } catch (error) { escapedFilter = error.productCode === 'UNAUTHENTICATED'; }
    console.log(JSON.stringify({ status, identity, wrongPassword, escapedFilter }));
  `);
  assert.deepEqual(ldap.status, { ok: true });
  assert.equal(ldap.identity.username, 'alice');
  assert.equal(ldap.identity.name, 'Alice Example');
  assert.match(ldap.identity.subject, /^ldap:/);
  assert.deepEqual(ldap.identity.groups, [`cn=release-approvers,ou=groups,${lab.ldapBase}`]);
  assert.equal(ldap.wrongPassword, true);
  assert.equal(ldap.escapedFilter, true, 'escaped wildcard input cannot broaden LDAP search');
  await lab.addAmbiguousLdapEntry();
  const ambiguous = runTrustedNode(lab.cert, `
    import { ldapIdentity } from ${JSON.stringify(adapterUrl)};
    try { await ldapIdentity(${JSON.stringify(ldapConfig)}, 'integration-only-secret', 'alice-integration-password', 'alice'); console.log(JSON.stringify({ rejected: false })); }
    catch (error) { console.log(JSON.stringify({ rejected: error.productCode === 'UNAUTHENTICATED' })); }
  `);
  assert.equal(ambiguous.rejected, true, 'multiple exact user search results are rejected');

  const oidcConfig = { type: 'OIDC', issuer: lab.issuer, clientId: 'kelryvo-integration',
    redirectUri: lab.callback, groupsClaim: 'groups', provisioning: 'AUTO', defaultRole: 'developer', groupMappings: [] };
  const started = runTrustedNode(lab.cert, `
    import { oidcStart, testProvider } from ${JSON.stringify(adapterUrl)};
    const provider = ${JSON.stringify(oidcConfig)};
    const status = await testProvider(provider, 'oidc-integration-only-secret');
    const flow = await oidcStart(provider, 'oidc-integration-only-secret');
    console.log(JSON.stringify({ status, flow }));
  `);
  assert.deepEqual(started.status, { ok: true });

  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const authorize = async () => {
    const flow = started.flow;
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    let callbackUrl;
    await page.route(`${lab.callback}**`, async route => {
      callbackUrl = route.request().url();
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Callback received</title>' });
    });
    await page.goto(flow.url, { waitUntil: 'domcontentloaded' });
    await page.locator('#username').fill('oidc-alice');
    await page.locator('#password').fill('oidc-alice-integration-password');
    await Promise.all([page.waitForURL(url => url.href.startsWith(lab.callback), { timeout: 30_000 }), page.locator('#kc-login').click()]);
    await context.close();
    assert.ok(callbackUrl, 'browser completed provider authorization and received callback');
    return { callbackUrl, flow };
  };
  const first = await authorize();
  const finish = (callbackUrl, flow) => runTrustedNode(lab.cert, `
    import { oidcFinish } from ${JSON.stringify(adapterUrl)};
    const provider = ${JSON.stringify(oidcConfig)};
    const identity = await oidcFinish(provider, 'oidc-integration-only-secret', ${JSON.stringify(callbackUrl)}, ${JSON.stringify(flow)});
    console.log(JSON.stringify(identity));
  `);
  const identity = finish(first.callbackUrl, first.flow);
  assert.equal(identity.username, 'oidc-alice');
  assert.equal(identity.name, 'Alice OIDC');
  assert.ok(identity.subject.startsWith('oidc:' + lab.issuer + ':'));
  assert.ok(identity.groups.some(group => group.endsWith('release-approvers')));

  const stateCase = await authorize();
  const rejectedState = runTrustedNode(lab.cert, `
    import { oidcFinish } from ${JSON.stringify(adapterUrl)};
    try { await oidcFinish(${JSON.stringify(oidcConfig)}, 'oidc-integration-only-secret', ${JSON.stringify(stateCase.callbackUrl)}, { ...${JSON.stringify(stateCase.flow)}, state: 'wrong-state' }); console.log(JSON.stringify({ rejected: false })); }
    catch (error) { console.log(JSON.stringify({ rejected: error.productCode === 'UNAUTHENTICATED', message: error.message })); }
  `);
  assert.equal(rejectedState.rejected, true);
  assert.doesNotMatch(rejectedState.message, /secret|token|client/i);

  const nonceCase = await authorize();
  const rejectedNonce = runTrustedNode(lab.cert, `
    import { oidcFinish } from ${JSON.stringify(adapterUrl)};
    try { await oidcFinish(${JSON.stringify(oidcConfig)}, 'oidc-integration-only-secret', ${JSON.stringify(nonceCase.callbackUrl)}, { ...${JSON.stringify(nonceCase.flow)}, nonce: 'wrong-nonce' }); console.log(JSON.stringify({ rejected: false })); }
    catch (error) { console.log(JSON.stringify({ rejected: error.productCode === 'UNAUTHENTICATED', message: error.message })); }
  `);
  assert.equal(rejectedNonce.rejected, true);
  assert.doesNotMatch(rejectedNonce.message, /secret|token|client/i);
});
