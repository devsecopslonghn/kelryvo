import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { loadContainerConfig, readContainerSecret } from '../packages/runtime/container-config.mjs';

test('projected Secret files support external metadata, fixed distinct roles and mandatory TLS', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-config-'));
  try {
    const data = path.join(root, '..revision'); await mkdir(data, { mode: 0o700 });
    await symlink('..revision', path.join(root, '..data'));
    const values = { 'database-url': `postgres://product:${randomBytes(32).toString('hex')}@postgresql.namespace.svc/product`,
      'developer-token': randomBytes(32).toString('hex'), 'approver-token': randomBytes(32).toString('hex') };
    for (const [name, value] of Object.entries(values)) await writeFile(path.join(data, name), value, { mode: 0o400 });
    execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=localhost', '-keyout', path.join(data, 'tls.key'), '-out', path.join(data, 'tls.crt')], { stdio: 'ignore' });
    for (const name of [...Object.keys(values), 'tls.crt', 'tls.key']) await symlink(`..data/${name}`, path.join(root, name));
    const config = await loadContainerConfig({ KELRYVO_SECRET_DIR: root, KELRYVO_BIND_HOST: '::', KELRYVO_PORT: '9443' });
    assert.equal(config.databaseUrl, values['database-url']); assert.equal(config.host, '::'); assert.equal(config.port, 9443);
    assert.equal(config.identityRuntime, undefined, 'identity providers remain optional for local account deployments');
    assert.deepEqual(config.actors.map(({ id, role }) => ({ id, role })), [
      { id: 'kelryvo-developer', role: 'developer' }, { id: 'kelryvo-approver', role: 'approver' }]);
    const identityRuntime = { format: 1, publicOrigin: 'https://app.example.test', key: 'a'.repeat(64),
      routes: [{ id: 'company-idp', kind: 'OIDC', origin: 'https://login.example.test', issuerPrefix: '/realms/company',
        pinnedIPs: ['192.0.2.10'], secretRefs: ['oidc-secret'] }], secrets: { 'oidc-secret': 'private-client-secret' } };
    const identityFile = path.join(root, 'identity-runtime.json');
    await writeFile(identityFile, JSON.stringify(identityRuntime), { mode: 0o600 });
    const withIdentity = await loadContainerConfig({ KELRYVO_SECRET_DIR: root });
    assert.deepEqual(withIdentity.identityRuntime, identityRuntime);
    await chmod(identityFile, 0o644);
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root }), /^Error: Container configuration unavailable$/);
    await chmod(identityFile, 0o600);
    await writeFile(identityFile, JSON.stringify({ ...identityRuntime, format: 2 }));
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root }), /^Error: Container configuration unavailable$/);
    const externalIdentityFile = path.join(root, 'external-identity.json');
    await writeFile(externalIdentityFile, JSON.stringify(identityRuntime), { mode: 0o600 });
    await rm(identityFile);
    await symlink(externalIdentityFile, identityFile);
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root }), /^Error: Container configuration unavailable$/);
    await rm(identityFile);
    await chmod(path.join(data, 'approver-token'), 0o600);
    await writeFile(path.join(data, 'approver-token'), values['developer-token']);
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root }), /^Error: Container configuration unavailable$/);
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root, KELRYVO_PORT: '65536' }));
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root, KELRYVO_BIND_HOST: 'private.example.invalid' }));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Secret loader rejects escape, writable and oversized files with fixed errors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-secret-'));
  try {
    const mount = path.join(root, 'mount'); await mkdir(mount, { mode: 0o700 });
    const privateValue = randomBytes(32).toString('hex');
    await writeFile(path.join(root, 'outside'), privateValue, { mode: 0o400 });
    await symlink('../outside', path.join(mount, 'database-url'));
    await assert.rejects(readContainerSecret(mount, 'database-url'), /^Error: Container configuration unavailable$/);
    await writeFile(path.join(mount, 'token'), privateValue, { mode: 0o660 });
    await chmod(path.join(mount, 'token'), 0o660);
    await assert.rejects(readContainerSecret(mount, 'token'), /^Error: Container configuration unavailable$/);
    await chmod(path.join(mount, 'token'), 0o400);
    await assert.rejects(readContainerSecret(mount, 'token', 8), /^Error: Container configuration unavailable$/);
    await assert.rejects(readContainerSecret(mount, '../outside'), /^Error: Container configuration unavailable$/);
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: mount }), /^Error: Container configuration unavailable$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
