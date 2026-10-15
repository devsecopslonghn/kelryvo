import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, chmod, rm, unlink } from 'node:fs/promises';
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
    assert.deepEqual(config.actors.map(({ id, role }) => ({ id, role })), [
      { id: 'kelryvo-developer', role: 'developer' }, { id: 'kelryvo-approver', role: 'approver' }]);
    await chmod(path.join(data, 'approver-token'), 0o600);
    await writeFile(path.join(data, 'approver-token'), values['developer-token']);
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root }), /^Error: Container configuration unavailable$/);
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root, KELRYVO_PORT: '65536' }));
    await assert.rejects(loadContainerConfig({ KELRYVO_SECRET_DIR: root, KELRYVO_BIND_HOST: 'private.example.invalid' }));
    await unlink(path.join(root,'developer-token'));await unlink(path.join(root,'approver-token'));
    const fresh=await loadContainerConfig({KELRYVO_SECRET_DIR:root});
    assert.deepEqual(fresh.actors,[]);assert.equal(fresh.identity.bootstrapPasswordFile,'/var/lib/kelryvo/identity/bootstrap-admin.json');
    assert.equal(fresh.identity.secretDirectory,'/run/kelryvo/identity-secrets');
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
