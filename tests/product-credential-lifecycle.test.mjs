import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../apps/api/index.ts';
import { operateLocalCredential, recoverLocalCredentialOperation } from '../scripts/local-credential-operator.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
const sha = token => createHash('sha256').update(token).digest('hex');

test('local credentials persist and recover real interrupted operator processes', {
  skip: !process.env.SCHEMAFORGE_TEST_DATABASE_URL, timeout: 60_000,
}, async () => {
  const db = await openIsolatedProductDatabase();
  const developerToken = randomBytes(32).toString('hex');
  const approverToken = randomBytes(32).toString('hex');
  let actors = [
    { id: 'local-developer', name: 'Local developer', role: 'developer', token: developerToken },
    { id: 'local-approver', name: 'Local approver', role: 'approver', token: approverToken },
  ];
  let app = createApp({ sql: db.sql, actors, repositories: [] });
  const req = (token, url = '/api/session') => app.inject({ url, headers: { authorization: 'Bearer ' + token } });
  let directory;
  try {
    assert.equal((await req(developerToken)).statusCode, 200);
    let rows = await db.sql.unsafe('SELECT a.id,a.display_name,a.role,c.token_sha256,c.issued_at,c.expires_at,c.revoked_at FROM sf_local_actors a JOIN sf_local_credentials c ON c.actor_id=a.id ORDER BY a.id');
    assert.equal(rows.length, 2);
    const initial = rows.find(row => row.id === 'local-developer');
    assert.ok(initial.token_sha256 === sha(developerToken), 'the persisted server digest matches the trusted bearer token');
    assert.equal(initial.expires_at - initial.issued_at, 24 * 60 * 60 * 1000);
    assert.equal(JSON.stringify(rows).includes(developerToken), false);

    const foreignToken = randomBytes(32).toString('hex');
    const foreignOrg = '00000000-0000-4000-8000-000000000099';
    await db.sql.unsafe('INSERT INTO sf_organizations(id,name) VALUES($1,$2)', [foreignOrg, 'Foreign fixture']);
    await db.sql.unsafe('INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,$2,$3,$4)', ['foreign-fixture', foreignOrg, 'developer', 'Foreign fixture']);
    await db.sql.unsafe("WITH issued AS (SELECT clock_timestamp() AS ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued", ['foreign-fixture', sha(foreignToken)]);
    assert.equal((await req(foreignToken, '/api/projects')).statusCode, 401);
    assert.throws(() => createApp({ sql: db.sql, actors: [{ ...actors[0], organizationId: foreignOrg }], repositories: [] }), /Invalid local actor configuration/);
    const mismatch = createApp({ sql: db.sql, actors: [{ ...actors[0], role: 'approver' }], repositories: [] });
    await assert.rejects(mismatch.ready(), /conflicts with persisted identity/);
    await mismatch.close();

    directory = await mkdtemp(path.join(os.tmpdir(), 'sf-product-credentials-'));
    await chmod(directory, 0o700);
    const configPath = path.join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify({ databasePassword: randomBytes(32).toString('hex'), developerToken, approverToken }) + '\n', { mode: 0o600 });
    const operationResult = await operateLocalCredential({ configPath, databaseUrl: db.databaseUrl, identity: 'developer', action: 'rotate' });
    assert.deepEqual(operationResult, { action: 'rotate', identity: 'developer', configUpdated: true });
    let privateConfig = JSON.parse(await readFile(configPath, 'utf8'));
    let activeToken = privateConfig.developerToken;
    assert.equal((await lstat(configPath)).mode & 0o777, 0o600);
    assert.equal((await lstat(directory)).mode & 0o777, 0o700);

    const operatorUrl = new URL('../scripts/local-credential-operator.mjs', import.meta.url).href;
    const interrupt = (phase, action = 'rotate') => {
      const code = 'import { operateLocalCredential } from ' + JSON.stringify(operatorUrl)
        + '; await operateLocalCredential({configPath:' + JSON.stringify(configPath)
        + ',databaseUrl:process.env.SCHEMAFORGE_TEST_DATABASE_URL,identity:"developer",action:' + JSON.stringify(action) + ',interruptAt:' + JSON.stringify(phase) + '});';
      const child = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
        env: { ...process.env, SCHEMAFORGE_TEST_DATABASE_URL: db.databaseUrl }, encoding: 'utf8', timeout: 15_000, maxBuffer: 16_384,
      });
      assert.equal(child.error, undefined);
      assert.equal(child.signal, 'SIGKILL');
      assert.equal(child.stdout, '');
      assert.equal(child.stderr, '');
    };
    const journalPath = configPath + '.lifecycle-journal';
    const stagePath = configPath + '.lifecycle-staged';
    interrupt('after-stage-before-journal', 'revoke');
    await recoverLocalCredentialOperation({ configPath, databaseUrl: db.databaseUrl });
    privateConfig = JSON.parse(await readFile(configPath, 'utf8'));
    assert.ok(sha(privateConfig.developerToken) === sha(activeToken), 'orphan-stage recovery preserves the configured bearer');
    assert.equal((await req(activeToken)).statusCode, 200);
    await assert.rejects(readFile(stagePath));

    interrupt('after-stage-before-journal');
    const rowsBeforeOrphanRecovery = await db.sql.unsafe("SELECT token_sha256 FROM sf_local_credentials WHERE actor_id='local-developer'");
    await recoverLocalCredentialOperation({ configPath, databaseUrl: db.databaseUrl });
    privateConfig = JSON.parse(await readFile(configPath, 'utf8'));
    assert.ok(sha(privateConfig.developerToken) === sha(activeToken), 'pre-commit recovery preserves the configured bearer');
    assert.equal((await db.sql.unsafe("SELECT token_sha256 FROM sf_local_credentials WHERE actor_id='local-developer'")).length, rowsBeforeOrphanRecovery.length);
    await assert.rejects(readFile(stagePath));

    interrupt('before-db-commit');
    await recoverLocalCredentialOperation({ configPath, databaseUrl: db.databaseUrl });
    privateConfig = JSON.parse(await readFile(configPath, 'utf8'));
    assert.ok(sha(privateConfig.developerToken) === sha(activeToken), 'pre-commit recovery preserves the configured bearer');
    await assert.rejects(readFile(journalPath));
    await assert.rejects(readFile(stagePath));

    interrupt('after-db-commit');
    const committedJournal = JSON.parse(await readFile(journalPath, 'utf8'));
    await db.sql.unsafe("WITH old AS (SELECT clock_timestamp() AS ts) UPDATE sf_local_credentials SET issued_at=old.ts-interval '25 hours',expires_at=old.ts-interval '1 hour' FROM old WHERE token_sha256=$1", [sha(committedJournal.newToken)]);
    await recoverLocalCredentialOperation({ configPath, databaseUrl: db.databaseUrl });
    privateConfig = JSON.parse(await readFile(configPath, 'utf8'));
    assert.deepEqual((await req(privateConfig.developerToken)).json(), { error: 'UNAUTHENTICATED' });
    activeToken = privateConfig.developerToken;
    await assert.rejects(readFile(journalPath));
    await assert.rejects(readFile(stagePath));
    await operateLocalCredential({ configPath, databaseUrl: db.databaseUrl, identity: 'developer', action: 'rotate' });
    privateConfig = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal((await req(privateConfig.developerToken)).statusCode, 200);
    activeToken = privateConfig.developerToken;

    interrupt('after-config-rename');
    await recoverLocalCredentialOperation({ configPath, databaseUrl: db.databaseUrl });
    privateConfig = JSON.parse(await readFile(configPath, 'utf8'));
    activeToken = privateConfig.developerToken;
    await assert.rejects(readFile(journalPath));

    assert.equal((await req(developerToken)).statusCode, 401);
    assert.equal((await req(activeToken)).statusCode, 200);
    assert.equal((await req(approverToken)).statusCode, 200);
    await app.close();
    actors = [{ ...actors[0], name: 'Renamed developer' }, actors[1]];
    await db.reopen();
    app = createApp({ sql: db.sql, actors, repositories: [] });
    assert.equal((await req(developerToken)).statusCode, 401);
    assert.equal((await req(activeToken)).statusCode, 200);
    await db.sql.unsafe("WITH old AS (SELECT now() AS ts) UPDATE sf_local_credentials SET issued_at=old.ts-interval '25 hours',expires_at=old.ts-interval '1 hour' FROM old WHERE token_sha256=$1", [sha(activeToken)]);
    assert.deepEqual((await req(activeToken)).json(), { error: 'UNAUTHENTICATED' });

    const concurrent = await Promise.allSettled([
      operateLocalCredential({ configPath, databaseUrl: db.databaseUrl, identity: 'developer', action: 'rotate' }),
      operateLocalCredential({ configPath, databaseUrl: db.databaseUrl, identity: 'developer', action: 'rotate' }),
    ]);
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
    const active = await db.sql.unsafe("SELECT token_sha256 FROM sf_local_credentials WHERE actor_id='local-developer' AND revoked_at IS NULL");
    assert.equal(active.length, 1);
    const overlappingRecovery = await Promise.allSettled([
      recoverLocalCredentialOperation({ configPath, databaseUrl: db.databaseUrl }),
      operateLocalCredential({ configPath, databaseUrl: db.databaseUrl, identity: 'developer', action: 'rotate' }),
    ]);
    assert.ok(overlappingRecovery.some(result => result.status === 'fulfilled'));
    const afterOverlap = await db.sql.unsafe("SELECT token_sha256 FROM sf_local_credentials WHERE actor_id='local-developer' AND revoked_at IS NULL");
    assert.equal(afterOverlap.length, 1);
    const tokenBeforeRevoke = JSON.parse(await readFile(configPath, 'utf8')).developerToken;
    assert.deepEqual(await operateLocalCredential({ configPath, databaseUrl: db.databaseUrl, identity: 'developer', action: 'revoke' }),
      { action: 'revoke', identity: 'developer', configUpdated: true });
    assert.ok(sha(JSON.parse(await readFile(configPath, 'utf8')).developerToken) === sha(tokenBeforeRevoke), 'revoke retains the private configuration value');
    assert.equal((await req(tokenBeforeRevoke)).statusCode, 401);

    const configBeforeInvalidCli = await readFile(configPath);
    const dbBeforeInvalidCli = await db.sql.unsafe("SELECT token_sha256,revoked_at,issued_at,expires_at FROM sf_local_credentials WHERE actor_id='local-developer' ORDER BY token_sha256");
    const cliPath = new URL('../scripts/local-credential-operator.mjs', import.meta.url).pathname;
    const invalidCli = spawnSync(process.execPath, [cliPath, 'rotate', 'developer', configPath, '--dry-run'], {
      env: { ...process.env, SCHEMAFORGE_LOCAL_DATABASE_URL: db.databaseUrl }, encoding: 'utf8', timeout: 15_000, maxBuffer: 16_384,
    });
    assert.equal(invalidCli.error, undefined);
    assert.equal(invalidCli.status, 1);
    assert.equal(invalidCli.stdout, '');
    assert.equal(invalidCli.stderr, 'Local credential operation failed.\n');
    assert.ok((await readFile(configPath)).equals(configBeforeInvalidCli), 'invalid CLI arguments leave private config unchanged');
    const dbAfterInvalidCli = await db.sql.unsafe("SELECT token_sha256,revoked_at,issued_at,expires_at FROM sf_local_credentials WHERE actor_id='local-developer' ORDER BY token_sha256");
    assert.ok(JSON.stringify(dbAfterInvalidCli) === JSON.stringify(dbBeforeInvalidCli), 'invalid CLI arguments leave credential records unchanged');
    const linked = path.join(directory, 'linked.json');
    await symlink(configPath, linked);
    await assert.rejects(operateLocalCredential({ configPath: linked, databaseUrl: db.databaseUrl, identity: 'developer' }));
  } finally {
    await app.close().catch(() => {});
    await db.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
