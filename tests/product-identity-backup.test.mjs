import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { createPrivateBackup, restorePrivateBackup, inventory } from '../packages/backup/index.mjs';
import { initializeDatabase } from '../packages/database/index.ts';
import { seedLocalActors, tokenDigest } from '../packages/database/local-credentials.ts';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL && process.env.SCHEMAFORGE_REQUIRE_PRODUCT_TESTS === '1';

test('identity-provider backup retains mappings and audit while restore revokes all credentials under RESTORE_HOLD',
  { skip: !enabled, timeout: 180_000 }, async () => {
    const source = await openIsolatedProductDatabase();
    const root = await mkdtemp(join(process.cwd(), '.cache', 'identity-backup-'));
    let restoredSql, restoredName;
    const actors = ['developer', 'approver'].map(role => ({
      id: `identity-backup-${role}`, name: `Identity ${role}`, role, token: randomBytes(32).toString('hex'),
    }));
    try {
      await chmod(root, 0o700);
      const databasePassword = randomBytes(32).toString('hex');
      const configPath = join(root, 'operator-config.json');
      await writeFile(configPath, `${JSON.stringify({ databasePassword, developerToken: actors[0].token, approverToken: actors[1].token })}\n`, { mode: 0o600 });
      const privateUrl = new URL(source.databaseUrl); privateUrl.password = databasePassword;
      const databaseUrl = privateUrl.toString();
      await seedLocalActors(source.sql, actors);

      const actor = actors[0], mappedActor = actors[1];
      const actorCredentials = await source.sql`SELECT id,credential_kind FROM sf_local_credentials
        WHERE token_sha256=${tokenDigest(actor.token)} AND actor_id=${actor.id}`;
      const mappedCredentials = await source.sql`SELECT id FROM sf_local_credentials
        WHERE token_sha256=${tokenDigest(mappedActor.token)} AND actor_id=${mappedActor.id}`;
      assert.equal(actorCredentials.length, 1); assert.equal(mappedCredentials.length, 1);
      const generation = (await source.sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
      const providerId = randomUUID(), mappingId = randomUUID();
      const config = { routeId: 'route-oidc-test', issuer: 'https://id.example.invalid', clientId: 'kelryvo-test', clientSecretRef: 'secret://identity/oidc-client' };
      await source.sql`INSERT INTO sf_identity_admin_grants(actor_id,grant_os_uid) VALUES(${actor.id},${process.getuid?.() ?? 0})`;
      await source.sql`INSERT INTO sf_identity_providers(id,name,kind,enabled,revision,config,created_by,updated_by)
        VALUES(${providerId},'Backup test OIDC','OIDC',true,1,${source.sql.json(config)},${actor.id},${actor.id})`;
      await source.sql`INSERT INTO sf_identity_provider_revisions(provider_id,revision,name,kind,enabled,config,actor_id,reason)
        VALUES(${providerId},1,'Backup test OIDC','OIDC',true,${source.sql.json(config)},${actor.id},'exercise identity backup')`;
      await source.sql`INSERT INTO sf_external_identities(id,provider_id,subject,actor_id,anchor_credential_id,created_by)
        VALUES(${mappingId},${providerId},'oidc-subject-backup-test',${mappedActor.id},${mappedCredentials[0].id},${actor.id})`;
      await source.sql`INSERT INTO sf_identity_audit(actor_id,action,provider_id,facts,operator_os_uid)
        VALUES(${actor.id},'PROVIDER_CONFIGURED',${providerId},${source.sql.json({ revision: 1, secretMaterialIncluded: false })},${process.getuid?.() ?? 0})`;

      const externalRootDigest = tokenDigest(randomBytes(32).toString('hex'));
      const externalRoot = (await source.sql`WITH issued AS (SELECT clock_timestamp() AS ts)
        INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind)
        SELECT ${mappedActor.id},${externalRootDigest},ts,ts+interval '24 hours','EXTERNAL' FROM issued RETURNING id`)[0];
      await source.sql`INSERT INTO sf_external_session_roots(credential_id,actor_id,provider_id,provider_revision,mapping_id,generation_id)
        VALUES(${externalRoot.id},${mappedActor.id},${providerId},1,${mappingId},${generation})`;
      const browser = (await source.sql`WITH issued AS (SELECT clock_timestamp() AS ts)
        INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at)
        SELECT ${mappedActor.id},${tokenDigest(randomBytes(32).toString('hex'))},ts,ts+interval '30 minutes','BROWSER',
          ${externalRoot.id},ts+interval '8 hours' FROM issued RETURNING id`)[0];
      const attemptState = 'd'.repeat(64);
      await source.sql`INSERT INTO sf_oidc_attempts(state_sha256,provider_id,provider_revision,generation_id,expires_at)
        VALUES(${attemptState},${providerId},1,${generation},clock_timestamp()+interval '2 minutes')`;

      const before = {
        grants: await source.sql`SELECT actor_id,grant_os_uid,revoked_at,revoke_os_uid FROM sf_identity_admin_grants ORDER BY actor_id`,
        providers: await source.sql`SELECT id,name,kind,enabled,revision,config,created_by,updated_by FROM sf_identity_providers ORDER BY id`,
        revisions: await source.sql`SELECT provider_id,revision,name,kind,enabled,config,actor_id,reason FROM sf_identity_provider_revisions ORDER BY provider_id,revision`,
        mappings: await source.sql`SELECT id,provider_id,subject,actor_id,anchor_credential_id,created_by,revoked_at,revoked_by FROM sf_external_identities ORDER BY id`,
        roots: await source.sql`SELECT credential_id,actor_id,provider_id,provider_revision,mapping_id,generation_id FROM sf_external_session_roots ORDER BY credential_id`,
        audit: await source.sql`SELECT actor_id,action,provider_id,facts,operator_os_uid FROM sf_identity_audit ORDER BY id`,
        attempts: await source.sql`SELECT state_sha256,provider_id,provider_revision,generation_id,consumed_at FROM sf_oidc_attempts ORDER BY state_sha256`,
        actors: await source.sql`SELECT id,role,display_name FROM sf_local_actors ORDER BY id`,
      };
      assert.equal(before.providers[0].config.clientSecretRef, 'secret://identity/oidc-client');
      assert.equal(JSON.stringify(before.providers).includes('private-client-secret'), false);
      const backupDirectory = join(root, 'backup'), witnessPath = join(root, 'witness.json');
      const backup = await createPrivateBackup({ configPath, databaseUrl, destination: backupDirectory, witnessPath });
      assert.match(backup.archiveSha256, /^[a-f0-9]{64}$/);
      const manifest = JSON.parse(await readFile(join(backupDirectory, 'manifest.json'), 'utf8'));
      assert.equal(manifest.schema.signature, 'b05328c7871f15422bf50592bc1a19d28dc962159f18ce50634666a3f31f8c70');
      for (const table of ['sf_identity_admin_grants', 'sf_identity_providers', 'sf_identity_provider_revisions',
        'sf_external_identities', 'sf_external_session_roots', 'sf_identity_audit', 'sf_oidc_attempts']) assert.ok(manifest.schema.tables.includes(table));
      assert.equal((await lstat(backupDirectory)).mode & 0o777, 0o700);
      assert.equal((await lstat(join(backupDirectory, 'metadata.pgdump'))).mode & 0o777, 0o600);
      assert.equal((await lstat(witnessPath)).mode & 0o777, 0o600);

      const restored = await restorePrivateBackup({ configPath, databaseUrl, backupDirectory, witnessPath });
      restoredName = restored.databaseName; restoredSql = postgres(restored.databaseUrl, { max: 3, onnotice: () => {} });
      const schema = await inventory(restoredSql);
      assert.equal(schema.signature, manifest.schema.signature);
      assert.deepEqual(await restoredSql`SELECT actor_id,grant_os_uid,revoked_at,revoke_os_uid FROM sf_identity_admin_grants ORDER BY actor_id`, before.grants);
      assert.deepEqual(await restoredSql`SELECT id,name,kind,enabled,revision,config,created_by,updated_by FROM sf_identity_providers ORDER BY id`, before.providers);
      assert.deepEqual(await restoredSql`SELECT provider_id,revision,name,kind,enabled,config,actor_id,reason FROM sf_identity_provider_revisions ORDER BY provider_id,revision`, before.revisions);
      assert.deepEqual(await restoredSql`SELECT id,provider_id,subject,actor_id,anchor_credential_id,created_by,revoked_at,revoked_by FROM sf_external_identities ORDER BY id`, before.mappings);
      assert.deepEqual(await restoredSql`SELECT credential_id,actor_id,provider_id,provider_revision,mapping_id,generation_id FROM sf_external_session_roots ORDER BY credential_id`, before.roots);
      assert.deepEqual(await restoredSql`SELECT actor_id,action,provider_id,facts,operator_os_uid FROM sf_identity_audit ORDER BY id`, before.audit);
      assert.deepEqual(await restoredSql`SELECT state_sha256,provider_id,provider_revision,generation_id,consumed_at FROM sf_oidc_attempts ORDER BY state_sha256`, before.attempts);
      assert.deepEqual(await restoredSql`SELECT id,role,display_name FROM sf_local_actors ORDER BY id`, before.actors);
      const credentials = await restoredSql`SELECT id,credential_kind,revoked_at FROM sf_local_credentials ORDER BY id`;
      assert.deepEqual(credentials.map(row => row.credential_kind).sort(), ['BROWSER', 'EXTERNAL', 'LOCAL', 'LOCAL'].sort());
      assert.ok(credentials.every(row => row.revoked_at), 'restore revokes local, external-root, and browser credentials');
      assert.equal(credentials.find(row => row.id === externalRoot.id).credential_kind, 'EXTERNAL');
      assert.equal(credentials.find(row => row.id === browser.id).credential_kind, 'BROWSER');
      const current = (await restoredSql`SELECT g.id,g.state,g.predecessor_id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
      assert.equal(current.state, 'RESTORE_HOLD'); assert.equal(current.predecessor_id, generation);
      assert.equal((await restoredSql`SELECT state FROM sf_metadata_generations WHERE id=${generation}`)[0].state, 'ACTIVE');
      assert.notEqual(current.id, generation);
    } finally {
      await restoredSql?.end({ timeout: 2 }); await source.close();
      if (restoredName) {
        const admin = postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
        try { await admin.unsafe(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`); }
        finally { await admin.end({ timeout: 2 }); }
      }
      await rm(root, { recursive: true, force: true });
    }
  });

test('password-auth schema signature remains exactly restorable without identity-auth tables',
  { skip: !enabled, timeout: 180_000 }, async () => {
    const source = await openIsolatedProductDatabase({ initialize: sql => initializeDatabase(sql, { initializeIdentityAuth: false }) });
    const root = await mkdtemp(join(process.cwd(), '.cache', 'identity-backup-password-history-'));
    let restoredSql, restoredName;
    const actors = ['developer', 'approver'].map(role => ({
      id: `identity-history-${role}`, name: `Identity history ${role}`, role, token: randomBytes(32).toString('hex'),
    }));
    try {
      await chmod(root, 0o700);
      const databasePassword = randomBytes(32).toString('hex'), configPath = join(root, 'operator-config.json');
      await writeFile(configPath, `${JSON.stringify({ databasePassword, developerToken: actors[0].token, approverToken: actors[1].token })}\n`, { mode: 0o600 });
      const database = new URL(source.databaseUrl); database.password = databasePassword;
      const databaseUrl = database.toString(); await seedLocalActors(source.sql, actors);
      const historical = await inventory(source.sql);
      assert.equal(historical.signature, '518bd10fec0b910f10f98ce2a5c0ab7963c0001b74f817dde9c8aae36000907a');
      assert.equal(historical.tables.includes('sf_identity_providers'), false);
      const backupDirectory = join(root, 'backup'), witnessPath = join(root, 'witness.json');
      await createPrivateBackup({ configPath, databaseUrl, destination: backupDirectory, witnessPath });
      const manifest = JSON.parse(await readFile(join(backupDirectory, 'manifest.json'), 'utf8'));
      assert.equal(manifest.schema.signature, historical.signature);
      const restored = await restorePrivateBackup({ configPath, databaseUrl, backupDirectory, witnessPath });
      restoredName = restored.databaseName; restoredSql = postgres(restored.databaseUrl, { max: 2, onnotice: () => {} });
      const restoredSchema = await inventory(restoredSql);
      assert.deepEqual(restoredSchema, historical);
      assert.equal(restoredSchema.tables.some(name => name.startsWith('sf_identity_') || name.startsWith('sf_external_') || name === 'sf_oidc_attempts'), false);
      assert.equal((await restoredSql`SELECT state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state, 'RESTORE_HOLD');
    } finally {
      await restoredSql?.end({ timeout: 2 }); await source.close();
      if (restoredName) {
        const admin = postgres(process.env.SCHEMAFORGE_TEST_DATABASE_URL, { max: 1, onnotice: () => {} });
        try { await admin.unsafe(`DROP DATABASE IF EXISTS "${restoredName}" WITH (FORCE)`); }
        finally { await admin.end({ timeout: 2 }); }
      }
      await rm(root, { recursive: true, force: true });
    }
  });
