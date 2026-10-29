import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, chown, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { publicRoutes, readIdentityRuntime, validateIdentityRuntime, validateProviderConfig } from '../packages/identity/runtime.mjs';

const runtimeFixture = () => ({
  format: 1,
  publicOrigin: 'https://app.example.test',
  key: 'a'.repeat(64),
  routes: [{ id: 'company-idp', kind: 'OIDC', origin: 'https://login.example.test',
    issuerPrefix: '/realms/company', pinnedIPs: ['192.0.2.10'], secretRefs: ['oidc-secret'],
    ca: 'PRIVATE_CA_MATERIAL' }],
  secrets: { 'oidc-secret': 'PRIVATE_CLIENT_SECRET' },
});

test('private identity runtime accepts a trusted OIDC route and enforces issuer path boundaries', () => {
  const runtime = runtimeFixture();
  assert.equal(validateIdentityRuntime(runtime), runtime);
  const config = { routeId: 'company-idp', issuer: 'https://login.example.test/realms/company',
    clientId: 'kelryvo', clientSecretRef: 'oidc-secret' };
  assert.equal(validateProviderConfig(runtime, 'OIDC', config), true);
  assert.equal(validateProviderConfig(runtime, 'OIDC', { ...config,
    issuer: 'https://login.example.test/realms/company/team' }), true);
  assert.equal(validateProviderConfig(runtime, 'OIDC', { ...config,
    issuer: 'https://login.example.test/realms/company-evil' }), false);
  assert.equal(validateProviderConfig(runtime, 'OIDC', { ...config,
    issuer: 'https://attacker.example.test/realms/company' }), false);
});

test('public trusted-route metadata never returns secret values, CA contents, or pinned addresses', () => {
  const runtime = runtimeFixture();
  const exposed = publicRoutes(runtime);
  assert.deepEqual(exposed, [{ id: 'company-idp', kind: 'OIDC', name: 'company-idp',
    issuerOrigin: 'https://login.example.test', issuerPrefix: '/realms/company',
    host: undefined, port: undefined, transport: undefined, secretRefs: ['oidc-secret'],
    baseDNs: undefined, bindDNs: undefined }]);
  const serialized = JSON.stringify(exposed);
  for (const secret of ['PRIVATE_CLIENT_SECRET', 'PRIVATE_CA_MATERIAL', '192.0.2.10'])
    assert.equal(serialized.includes(secret), false);
});

test('identity runtime loader requires a private regular file and valid bounded fields', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kelryvo-identity-runtime-'));
  const file = path.join(dir, 'identity-runtime.json');
  const outside = path.join(dir, 'outside.json');
  try {
    await writeFile(file, JSON.stringify(runtimeFixture()), { mode: 0o600 });
    assert.deepEqual(await readIdentityRuntime(file), runtimeFixture());

    await chmod(file, 0o644);
    await assert.rejects(readIdentityRuntime(file));
    await chmod(file, 0o600);

    await writeFile(file, JSON.stringify({ ...runtimeFixture(), format: 2 }));
    await assert.rejects(readIdentityRuntime(file), /Identity runtime configuration unavailable/);
    await writeFile(file, JSON.stringify({ ...runtimeFixture(), publicOrigin: 'http://app.example.test' }));
    await assert.rejects(readIdentityRuntime(file), /Identity runtime configuration unavailable/);
    await writeFile(file, JSON.stringify({ ...runtimeFixture(), routes: [{ ...runtimeFixture().routes[0], pinnedIPs: [] }] }));
    await assert.rejects(readIdentityRuntime(file), /Identity runtime configuration unavailable/);

    await writeFile(outside, JSON.stringify(runtimeFixture()), { mode: 0o600 });
    await rm(file);
    await symlink(outside, file);
    await assert.rejects(readIdentityRuntime(file));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('identity runtime loader rejects a file owned by another uid when ownership can be changed', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'kelryvo-identity-owner-'));
  const file = path.join(dir, 'identity-runtime.json');
  try {
    await writeFile(file, JSON.stringify(runtimeFixture()), { mode: 0o600 });
    try { await chown(file, 65534, 65534); }
    catch { t.skip('current test user cannot change file ownership'); return; }
    await assert.rejects(readIdentityRuntime(file), /Identity runtime configuration unavailable/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
