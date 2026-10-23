import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { openIsolatedProductDatabase } from './helpers/product-db.mjs';
import { seedLocalActors, authenticateLocalToken, tokenDigest } from '../packages/database/local-credentials.ts';
import { initializeDatabase } from '../packages/database/index.ts';
import { recoverRestoredContainerActorCredential, rotateContainerActorCredential } from '../packages/database/container-credentials.ts';

const enabled = !!process.env.SCHEMAFORGE_TEST_DATABASE_URL;
const fresh = () => randomBytes(32).toString('hex');
async function fixture() {
  const db = await openIsolatedProductDatabase();
  const actors = ['developer', 'approver'].map(role => ({ id: `kelryvo-${role}`, name: `Kelryvo ${role}`, role, token: fresh() }));
  await seedLocalActors(db.sql, actors);
  return { db, actors };
}

test('pod operator rotation retires local/browser authority, retains immutable revocation audit and bounds new expiry', { skip: !enabled }, async () => {
  const { db, actors } = await fixture();
  try {
    const parent = (await db.sql`SELECT id FROM sf_local_credentials WHERE actor_id=${actors[0].id}`)[0];
    const browser = fresh();
    await db.sql`WITH issued AS (SELECT clock_timestamp() AS ts)
      INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at)
      SELECT ${actors[0].id},${tokenDigest(browser)},ts,ts+interval '30 minutes','BROWSER',${parent.id},ts+interval '8 hours' FROM issued`;
    const replacement = fresh();
    assert.equal(await rotateContainerActorCredential(db.sql, { identity: 'developer', token: replacement }), 'ROTATED');
    assert.equal(await authenticateLocalToken(db.sql, actors[0].token), null);
    assert.equal((await authenticateLocalToken(db.sql, replacement)).id, actors[0].id);
    assert.ok((await authenticateLocalToken(db.sql, actors[1].token)), 'other fixed role remains live');
    const row = (await db.sql`SELECT issued_at,expires_at,extract(epoch FROM expires_at-issued_at)::int AS seconds
      FROM sf_local_credentials WHERE token_sha256=${tokenDigest(replacement)}`)[0];
    assert.equal(row.seconds, 86400);
    const retired = (await db.sql`SELECT revoked_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(browser)}`)[0];
    assert.ok(retired.revoked_at);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_metadata_credentials_revoked WHERE credential_id=${parent.id}`)[0].n, 1);
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_metadata_operator_audit WHERE action='CREDENTIAL_REVOKE' AND credential_id=${parent.id}`)[0].n, 1);
    await assert.rejects(db.sql`DELETE FROM sf_metadata_operator_audit WHERE credential_id=${parent.id}`);
    assert.equal(await rotateContainerActorCredential(db.sql, { identity: 'developer', token: replacement }), 'ALREADY_ACTIVE');
    const after = (await db.sql`SELECT issued_at,expires_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(replacement)}`)[0];
    assert.deepEqual(after, { issued_at: row.issued_at, expires_at: row.expires_at });
    await seedLocalActors(db.sql, actors);
    assert.equal(await authenticateLocalToken(db.sql, actors[0].token), null, 'startup never resurrects the old configured token');
  } finally { await db.close(); }
});

test('pod credential rotation refuses expired, revoked, duplicate-role and malformed desired tokens', { skip: !enabled }, async () => {
  const { db, actors } = await fixture();
  try {
    const invoke = token => rotateContainerActorCredential(db.sql, { identity: 'developer', token });
    await assert.rejects(invoke(actors[1].token), /^Error: Container credential operation unavailable$/);
    await assert.rejects(invoke('invalid'), /^Error: Container credential operation unavailable$/);
    await assert.rejects(rotateContainerActorCredential(db.sql, { identity: 'admin', token: fresh() }));
    await db.sql`WITH issued AS (SELECT clock_timestamp() AS ts)
      UPDATE sf_local_credentials SET issued_at=issued.ts-interval '25 hours',expires_at=issued.ts-interval '1 hour'
      FROM issued WHERE actor_id=${actors[0].id}`;
    await assert.rejects(invoke(actors[0].token));
    const replacement = fresh();
    assert.equal(await invoke(replacement), 'ROTATED', 'fresh credential may replace an expired credential');
    await assert.rejects(invoke(actors[0].token), 'retired original token cannot be restored');
    assert.equal((await authenticateLocalToken(db.sql, actors[1].token)).role, 'approver');
  } finally { await db.close(); }
});

test('metadata HOLD rejects credential changes without retiring existing authority or adding rows', { skip: !enabled }, async () => {
  const { db, actors } = await fixture();
  try {
    const generation = randomUUID();
    await db.sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${generation},'RESTORE_HOLD',${'a'.repeat(64)},0)`;
    await db.sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
    await assert.rejects(rotateContainerActorCredential(db.sql, { identity: 'developer', token: fresh() }));
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_local_credentials`)[0].n, 2);
    assert.ok(await authenticateLocalToken(db.sql, actors[0].token));
    assert.equal((await db.sql`SELECT count(*)::int AS n FROM sf_metadata_operator_audit WHERE action='CREDENTIAL_REVOKE'`)[0].n, 0);
  } finally { await db.close(); }
});

test('trusted operator recovers only a witnessed restore credential and keeps RESTORE_HOLD', { skip: !enabled }, async () => {
  const baseUrl=process.env.SCHEMAFORGE_TEST_DATABASE_URL, name=`sf_product_restore_${randomUUID().replaceAll('-','')}`;
  const admin=postgres(baseUrl,{max:1,onnotice:()=>{}});let sql;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);
    const url=new URL(baseUrl);url.pathname=`/${name}`;sql=postgres(url.toString(),{max:3,onnotice:()=>{}});await initializeDatabase(sql);
    const actors=['developer','approver'].map(role=>({id:`kelryvo-${role}`,name:`Kelryvo ${role}`,role,token:fresh()}));
    await seedLocalActors(sql,actors);
    const predecessor=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
    const generation=randomUUID(),witness=randomUUID(),ownerUid=0;
    await sql.begin(async tx=>{
      await tx`INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,witness_id,operator_os_uid)
        VALUES(${generation},${predecessor},'RESTORE_HOLD',${'b'.repeat(64)},${witness},${ownerUid})`;
      await tx`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
      await tx`INSERT INTO sf_metadata_operator_audit(id,action,generation_id,witness_id,operator_os_uid)
        VALUES(${randomUUID()},'RESTORE_HOLD',${generation},${witness},${ownerUid})`;
      await tx`INSERT INTO sf_metadata_restore_owners(id,operator_os_uid) VALUES(${randomUUID()},${ownerUid})`;
    });
    const replacement=fresh(),original=Object.getOwnPropertyDescriptor(process,'geteuid');
    Object.defineProperty(process,'geteuid',{configurable:true,value:()=>0});
    try {
      assert.equal(await recoverRestoredContainerActorCredential(sql,{identity:'developer',token:replacement}),'RECOVERED');
      const expiry=(await sql`SELECT expires_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(replacement)}`)[0].expires_at;
      assert.equal(await recoverRestoredContainerActorCredential(sql,{identity:'developer',token:replacement}),'ALREADY_ACTIVE');
      assert.deepEqual((await sql`SELECT expires_at FROM sf_local_credentials WHERE token_sha256=${tokenDigest(replacement)}`)[0],{expires_at:expiry});
      assert.equal(await authenticateLocalToken(sql,actors[0].token),null,'old restored credential remains revoked');
      assert.equal((await authenticateLocalToken(sql,replacement)).id,'kelryvo-developer');
      assert.equal((await sql`SELECT g.state,g.predecessor_id,g.witness_id FROM sf_metadata_current c
        JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0].state,'RESTORE_HOLD');
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_metadata_operator_audit WHERE action='RESTORE_HOLD' AND generation_id=${generation}`)[0].n,1);
      assert.equal((await sql`SELECT count(*)::int AS n FROM sf_metadata_operator_audit WHERE action='CREDENTIAL_REVOKE' AND generation_id=${generation}`)[0].n,1);
      await sql`DELETE FROM sf_local_credentials WHERE token_sha256=${tokenDigest(actors[0].token)}`;
      await assert.rejects(recoverRestoredContainerActorCredential(sql,{identity:'developer',token:actors[0].token}),
        /Container credential operation unavailable/);
      await assert.rejects(sql`UPDATE sf_metadata_generations SET state='ACTIVE' WHERE id=${generation}`,/immutable/);
    } finally { if(original)Object.defineProperty(process,'geteuid',original);else delete process.geteuid; }
    await assert.rejects(rotateContainerActorCredential(sql,{identity:'approver',token:fresh()}));
  } finally {
    if(sql)await sql.end({timeout:2});
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end({timeout:2});
  }
});

test('restore credential recovery rejects missing or mismatched owner marker', { skip: !enabled }, async () => {
  const baseUrl=process.env.SCHEMAFORGE_TEST_DATABASE_URL,name=`sf_product_restore_${randomUUID().replaceAll('-','')}`;
  const admin=postgres(baseUrl,{max:1,onnotice:()=>{}});let sql;
  try {
    await admin.unsafe(`CREATE DATABASE "${name}"`);const url=new URL(baseUrl);url.pathname=`/${name}`;
    sql=postgres(url.toString(),{max:2,onnotice:()=>{}});await initializeDatabase(sql);
    const actor={id:'kelryvo-developer',name:'Kelryvo developer',role:'developer',token:fresh()};await seedLocalActors(sql,[actor]);
    const predecessor=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id;
    const generation=randomUUID(),witness=randomUUID();
    await sql.begin(async tx=>{
      await tx`INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,witness_id,operator_os_uid)
        VALUES(${generation},${predecessor},'RESTORE_HOLD',${'c'.repeat(64)},${witness},0)`;
      await tx`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;
      await tx`INSERT INTO sf_metadata_operator_audit(id,action,generation_id,witness_id,operator_os_uid)
        VALUES(${randomUUID()},'RESTORE_HOLD',${generation},${witness},0)`;
      await tx`INSERT INTO sf_metadata_restore_owners(id,operator_os_uid) VALUES(${randomUUID()},${process.getuid()})`;
    });
    const original=Object.getOwnPropertyDescriptor(process,'geteuid');Object.defineProperty(process,'geteuid',{configurable:true,value:()=>0});
    try { await assert.rejects(recoverRestoredContainerActorCredential(sql,{identity:'developer',token:fresh()})); }
    finally { if(original)Object.defineProperty(process,'geteuid',original);else delete process.geteuid; }
    assert.ok(await authenticateLocalToken(sql,actor.token),'failed recovery makes no credential changes');
    assert.equal((await sql`SELECT count(*)::int AS n FROM sf_local_credentials`)[0].n,1);
  } finally {
    if(sql)await sql.end({timeout:2});await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end({timeout:2});
  }
});
