import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { fixtureIdentity } from './helpers/discovery-fixture.mjs';
import { createDiscoveryFixture } from './helpers/discovery-fixture.mjs';
import { resolveManagedOracleCredential } from '../packages/connectivity/credential-vault.mjs';
import { instanceProfileCurrent } from '../packages/connectivity/instance-current.ts';
import { inventory } from '../packages/backup/index.mjs';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { initializeDatabase } from '../packages/database/index.ts';

test('encrypted instance credentials enforce grants, scoped resolution, rotation, stale targets and revocation', {
  skip: !process.env.KELRYVO_TEST_DATABASE_URL, timeout: 120000,
}, async () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const f = await createDiscoveryFixture({ oracleVaultPublicKey: keys.publicKey });
  const body = { name: 'Encrypted instance', containerName: 'PDB', kind: 'PDB', environment: 'DEV',
    host: 'encrypted.example.invalid', port: 1521, service: 'TARGETSVC', transport: 'TCPS',
    username: 'ADMIN', password: 'encrypted-fixture-password-v1', reason: 'Register encrypted credential' };
  try {
    let r = await f.api('POST', `${f.base}/database-instances/master`, body, f.actors[1]);
    assert.equal(r.statusCode, 403, r.body);
    r = await f.api('POST', `${f.base}/database-instances/master`, { ...body, credentialRef: 'secret://not-both' });
    assert.equal(r.statusCode, 400);
    r = await f.api('POST', `${f.base}/database-instances/master`, { ...body, password: undefined,
      credentialRef: 'vault://kelryvo/00000000-0000-4000-8000-000000000001' });
    assert.equal(r.statusCode, 400, 'client cannot select another managed vault record');
    r = await f.api('POST', `${f.base}/database-instances/master`, body);
    assert.equal(r.statusCode, 201, r.body);
    assert.doesNotMatch(r.body, /encrypted-fixture-password|wrappedKey|ciphertext|vault:\/\/kelryvo/);
    const c = r.json().connection, path = `${f.connections}/${c.id}`;
    assert.equal(c.credentialStorage, 'ENCRYPTED');
    const current = async () => {
      const row = (await f.db.sql`SELECT * FROM sf_database_connections WHERE id=${c.id}`)[0];
      return { ...row, credentialRef: row.credential_ref, organizationId: row.organization_id };
    };
    const original = await current();
    assert.equal(await resolveManagedOracleCredential(f.db.sql, original, keys.privateKey), body.password);
    await assert.rejects(resolveManagedOracleCredential(f.db.sql, { ...original, host: 'other.invalid' }, keys.privateKey));
    assert.ok(!JSON.stringify(await f.db.sql`SELECT * FROM sf_oracle_credentials`).includes(body.password));
    const schema = await inventory(f.db.sql);
    assert.equal(schema.signature, 'd252a0313bfc9e76718234a3009d1dc922fedb669c4c104f41a2b6facbd62c04');
    assert.ok(schema.tables.includes('sf_oracle_credentials'));
    const o = (await f.api('POST', `${path}/discover`, { reason: 'Discover assigned owner' })).json().observation;
    const assignment = { observationId: o.id, expectedConnectionRevision: '1', owners: ['APP'],
      environmentId: f.environment.id, reason: 'Require scoped runtime for managed credential' };
    assert.equal((await f.api('POST', `${path}/assign-schemas`, assignment)).json().error, 'INSTANCE_RUNTIME_REQUIRED');
    const descriptor = { sqlProfile: 'ORACLE26_NUMBER_VARCHAR2_BYTE_V1', format: 1, connectionId: c.id, connectionRevision: '1',
      metadataGenerationId: (await f.db.sql`SELECT generation_id FROM sf_metadata_current`)[0].generation_id,
      sourceSha: 'f'.repeat(40), imageDigest: 'sha256:' + 'e'.repeat(64), installationDigest: 'd'.repeat(64),
      identity: fixtureIdentity, writerUsername: 'SCOPED_WRITER', writerCredentialRef: `secret://kelryvo-runtime/${c.id}/writer`,
      schemaOwners: ['APP'], protectedOwners: ['CR7ALLGOALS_APP'], operatorOsUid: 0,
      expiresAt: new Date(Date.now() + 3600000).toISOString() };
    await f.db.sql`INSERT INTO sf_database_connection_audit(organization_id,connection_id,action,facts)
      VALUES(${original.organizationId},${c.id},'INSTANCE_RUNTIME_INSTALLED',${f.db.sql.json(descriptor)})`;
    assert.equal((await f.api('POST', `${path}/assign-schemas`, { ...assignment, owners: ['CR7ALLGOALS_APP'] })).json().error,
      'SCHEMA_OUTSIDE_INSTALLED_SCOPE');

    r = await f.api('POST', `${path}/assign-schemas`, { observationId: o.id, expectedConnectionRevision: '1',
      owners: ['APP'], environmentId: f.environment.id, reason: 'Bind one schema' });
    assert.equal(r.statusCode, 201, r.body);
    const p = r.json().bindings[0].profileId;
    assert.equal(await instanceProfileCurrent(f.db.sql, p), true);
    const profile = (await f.db.sql`SELECT username,credential_ref FROM sf_profiles WHERE id=${p}`)[0];
    assert.equal(profile.username, 'SCOPED_WRITER');
    assert.equal(profile.credential_ref, descriptor.writerCredentialRef);
    assert.notEqual(profile.username, original.username, 'ADMIN is never the migration principal');
    const rotation = { action: 'ROTATE', expectedRevision: '1', password: 'encrypted-fixture-password-v2', reason: 'Rotate in app' };
    r = await f.api('POST', `${f.foreignBase}/database-connections/${c.id}/credentials`, rotation);
    assert.equal(r.statusCode, 404, r.body);
    r = await f.api('POST', `${path}/credentials`, { ...rotation, expectedRevision: '2' });
    assert.equal(r.statusCode, 409);
    r = await f.api('POST', `${path}/credentials`, rotation);
    assert.equal(r.statusCode, 200, r.body);
    assert.doesNotMatch(r.body, /encrypted-fixture-password|wrappedKey|ciphertext/);
    assert.equal(r.json().connection.revision, '2');
    assert.equal(await instanceProfileCurrent(f.db.sql, p), false);
    await assert.rejects(resolveManagedOracleCredential(f.db.sql, original, keys.privateKey));
    assert.equal(await resolveManagedOracleCredential(f.db.sql, await current(), keys.privateKey), rotation.password);
    const oldBinding = (await f.db.sql`SELECT b.id,r.stream_id FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision WHERE r.profile_id=${p}`)[0];
    await f.db.sql`INSERT INTO sf_database_connection_audit(organization_id,connection_id,action,facts)
      VALUES(${original.organizationId},${c.id},'INSTANCE_RUNTIME_INSTALLED',${f.db.sql.json({...descriptor,connectionRevision:'2'})})`;
    const refreshedObservation=(await f.api('POST', `${path}/discover`, {reason:'Rediscover after credential rotation'})).json().observation;
    r=await f.api('POST', `${path}/assign-schemas`, {...assignment,observationId:refreshedObservation.id,expectedConnectionRevision:'2'});
    assert.equal(r.statusCode,201,r.body);
    const refreshed=r.json().bindings[0];
    assert.equal(refreshed.bindingId,oldBinding.id);
    assert.equal(refreshed.streamId,oldBinding.stream_id,'credential refresh preserves migration history');
    assert.equal(await instanceProfileCurrent(f.db.sql,refreshed.profileId),true);
    r = await f.api('POST', `${path}/credentials`, { action: 'REVOKE', expectedRevision: '2', reason: 'Revoke saved credential' });
    assert.equal(r.statusCode, 200, r.body);
    assert.equal(r.json().connection.enabled, false);
    await assert.rejects(resolveManagedOracleCredential(f.db.sql, await current(), keys.privateKey));
    await assert.rejects(f.db.sql`UPDATE sf_oracle_credentials SET username='OTHER' WHERE connection_id=${c.id}`, /immutable/);
    const audit = await f.db.sql`SELECT action,facts FROM sf_audit WHERE resource_id=${c.id}`;
    for (const action of ['INSTANCE_CREDENTIAL_STORED', 'INSTANCE_CREDENTIAL_ROTATED', 'INSTANCE_CREDENTIAL_REVOKED']) {
      assert.ok(audit.some(row => row.action === action));
    }
    assert.doesNotMatch(JSON.stringify(audit), /encrypted-fixture-password|wrappedKey|ciphertext/);
  } finally { await f.close(); }
});

test('unavailable public encryption key rolls back instance registration without retaining plaintext', {
  skip: !process.env.KELRYVO_TEST_DATABASE_URL, timeout: 30000,
}, async () => {
  const f = await createDiscoveryFixture({ oracleVaultPublicKey: 'invalid-installed-public-key' });
  try {
    const before = await f.db.sql`SELECT id FROM sf_database_connections ORDER BY id`;
    const r = await f.api('POST', `${f.base}/database-instances/master`, {
      name: 'Unavailable vault', containerName: 'PDB', kind: 'PDB', environment: 'DEV',
      host: 'unavailable.example.invalid', port: 1521, service: 'TARGETSVC', transport: 'TCPS',
      username: 'MIGRATION_MASTER', password: 'rollback-fixture-password', reason: 'Refuse unavailable vault',
    });
    assert.equal(r.statusCode, 503, r.body);
    assert.doesNotMatch(r.body, /rollback-fixture-password|invalid-installed-public-key/);
    assert.deepEqual(await f.db.sql`SELECT id FROM sf_database_connections ORDER BY id`, before);
    assert.equal((await f.db.sql`SELECT count(*)::int AS n FROM sf_oracle_credentials`)[0].n, 0);
  } finally { await f.close(); }
});

test('additive vault upgrade preserves existing project and metadata generation', {
  skip: !process.env.KELRYVO_TEST_DATABASE_URL, timeout: 30000,
}, async () => {
  const db = await openIsolatedProductDatabase({ initialize: sql => initializeDatabase(sql, { initializeOracleVault: false }) });
  try {
    const project = (await db.sql`INSERT INTO sf_projects(organization_id,name)
      VALUES('00000000-0000-4000-8000-000000000001','Retained pre-vault project') RETURNING *`)[0];
    const before = await db.sql`SELECT * FROM sf_metadata_current`;
    await initializeDatabase(db.sql);
    const schema = await inventory(db.sql);
    assert.equal(schema.signature, 'd252a0313bfc9e76718234a3009d1dc922fedb669c4c104f41a2b6facbd62c04');
    assert.deepEqual((await db.sql`SELECT * FROM sf_projects WHERE id=${project.id}`)[0], project);
    assert.deepEqual((await db.sql`SELECT * FROM sf_metadata_current`)[0], before[0]);
    assert.ok(schema.tables.includes('sf_oracle_credentials'));
  } finally { await db.close(); }
});
