import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import oracledb from 'oracledb';
import { createOracleTargetMutex } from '../packages/execution/oracle-target-mutex.mjs';

const owner = 'SF_EXECUTION';
const target = 'canonical.host:1521/service/APP_SCHEMA';
const lockName = `SF_SCHEMAFORGE_TARGET_${createHash('sha256').update(target).digest('hex')}`;

class FakeWriterConnection {
  constructor() {
    this.callTimeout = 5000;
    this.calls = [];
    this.owned = false;
    this.packageState = null;
    this.requestResult = 0;
    this.convertResult = 0;
    this.releaseResult = 0;
    this.outBindOverride = undefined;
    this.failOperation = null;
    this.afterOperation = null;
    this.blockOperation = null;
    this.block = null;
    this.commits = 0;
  }

  async execute(sql, binds, options) {
    const operation = sql.match(/SF_TARGET_MUTEX\.(ACQUIRE_LOCK|CURRENT_LOCK|RELEASE_LOCK)/)?.[1];
    this.calls.push({ sql, binds: structuredClone(binds), options, operation });
    assert.ok(operation, 'only the fixed cover package may be called');
    if (this.blockOperation === operation && this.block) await this.block;
    assert.equal(options.autoCommit, false);
    assert.deepEqual(Object.keys(binds).sort(), ['lockName', 'nonce', 'result']);
    assert.equal(binds.lockName.dir, oracledb.BIND_IN);
    assert.equal(binds.lockName.type, oracledb.STRING);
    assert.equal(binds.nonce.dir, oracledb.BIND_IN);
    assert.equal(binds.nonce.type, oracledb.STRING);
    assert.equal(binds.result.dir, oracledb.BIND_OUT);
    assert.equal(binds.result.type, oracledb.NUMBER);

    let status;
    const sentKey = binds.lockName.val, sentNonce = binds.nonce.val;
    if (operation === 'ACQUIRE_LOCK') {
      status = this.requestResult;
      if (status === 0) {
        this.owned = true;
        this.packageState = { lockName: sentKey, nonce: sentNonce };
      }
    } else if (operation === 'CURRENT_LOCK') {
      if (!this.packageState) status = 4;
      else if (sentKey !== this.packageState.lockName || sentNonce !== this.packageState.nonce) status = 3;
      else status = this.convertResult;
    } else {
      if (!this.packageState) status = 4;
      else if (sentKey !== this.packageState.lockName || sentNonce !== this.packageState.nonce) status = 3;
      else {
        status = this.releaseResult;
        this.packageState = null;
        if (status === 0) this.owned = false;
      }
    }

    if (this.failOperation === operation) {
      this.failOperation = null;
      throw new Error('simulated lost response');
    }
    if (this.afterOperation === operation) {
      this.afterOperation = null;
      if (operation === 'ACQUIRE_LOCK') this.packageState = null;
      throw new Error('simulated package-state reset with lost response');
    }
    return { outBinds: { result: this.outBindOverride ?? status } };
  }

  async commit() {
    this.commits++;
    // DBMS_LOCK.REQUEST uses release_on_commit FALSE, so a writer DDL commit does not drop it.
  }
}

const makeMutex = connection => createOracleTargetMutex(connection, { owner });

test('acquires a stable targetKey lock and checks the same handle after writer commit', async () => {
  const connection = new FakeWriterConnection();
  const mutex = makeMutex(connection);
  const capability = await mutex.acquire(target);
  assert.ok(capability);
  assert.deepEqual(Object.keys(capability).sort(), ['current', 'release']);
  assert.equal(await capability.current(), true);
  await connection.commit();
  assert.equal(await capability.current(), true);
  assert.equal(connection.owned, true);
  assert.equal(connection.commits, 1);
  assert.equal(connection.calls[0].binds.lockName.val, lockName);
  assert.equal(connection.calls[0].binds.lockName.val.startsWith('ORA$'), false);
  assert.equal(connection.calls[0].binds.nonce.val.length, 64);
  assert.equal(await capability.release(), true);
  assert.equal(connection.owned, false);
  assert.equal(await capability.current(), false);
  assert.equal(await capability.release(), false);
  assert.equal(connection.calls.filter(call => call.operation === 'RELEASE_LOCK').length, 1);
});

test('contention and REQUEST=4 both fail closed without adopting or retrying', async t => {
  for (const status of [1, 4]) await t.test(`REQUEST returns ${status}`, async () => {
    const connection = new FakeWriterConnection();
    connection.requestResult = status;
    if (status === 4) connection.owned = true; // session owns a lock after package state reset
    const mutex = makeMutex(connection);
    assert.equal(await mutex.acquire(target), null);
    const calls = connection.calls.length;
    assert.equal(await mutex.acquire(target), null);
    assert.equal(connection.calls.length, calls);
    assert.equal(connection.calls.filter(call => call.operation === 'ACQUIRE_LOCK').length, 1);
    assert.equal(connection.calls.some(call => call.operation === 'CURRENT_LOCK' || call.operation === 'RELEASE_LOCK'), false);
    assert.equal(connection.owned, status === 4);
  });
});

test('package reset or CONVERT=4 marks capability lost and never requests again', async () => {
  const connection = new FakeWriterConnection(), mutex = makeMutex(connection);
  const capability = await mutex.acquire(target);
  connection.packageState = null; // DBMS_LOCK remains owned but definer-rights package globals reset
  assert.equal(await capability.current(), false);
  assert.equal(await capability.current(), false);
  assert.equal(connection.calls.filter(call => call.operation === 'ACQUIRE_LOCK').length, 1);
  assert.equal(connection.calls.filter(call => call.operation === 'CURRENT_LOCK').length, 1);
  assert.equal(await capability.release(), false); // cleanup attempted once; no old handle is adoptable
  assert.equal(connection.calls.filter(call => call.operation === 'RELEASE_LOCK').length, 1);
  assert.equal(connection.owned, true); // lock remains until this writer session ends

  const second = new FakeWriterConnection(), other = makeMutex(second);
  const lost = await other.acquire(target);
  second.convertResult = 4;
  assert.equal(await lost.current(), false);
  assert.equal(await lost.current(), false);
  assert.equal(second.calls.filter(call => call.operation === 'ACQUIRE_LOCK').length, 1);
  assert.equal(await lost.release(), true); // package can still release its retained handle once
});

test('foreign nonce is rejected by the cover package and nonce is absent from the public capability', async () => {
  const connection = new FakeWriterConnection(), mutex = makeMutex(connection);
  const capability = await mutex.acquire(target);
  assert.deepEqual(Object.keys(capability).sort(), ['current', 'release']);
  const legitimate = connection.calls[0].binds;
  const foreign = structuredClone(legitimate);
  foreign.nonce.val = 'f'.repeat(64);
  foreign.lockName.type = oracledb.STRING;
  foreign.nonce.type = oracledb.STRING;
  foreign.result.type = oracledb.NUMBER;
  const reply = await connection.execute(connection.calls[0].sql.replace('ACQUIRE_LOCK', 'CURRENT_LOCK'), foreign, { autoCommit: false });
  assert.equal(reply.outBinds.result, 3);
  assert.equal(await capability.current(), true);
  assert.equal(await capability.release(), true);
});

test('invalid OUT values, driver errors, and lost acquire acknowledgments retire the factory', async t => {
  const invalid = new FakeWriterConnection();
  invalid.outBindOverride = '0';
  const invalidFactory = makeMutex(invalid);
  assert.equal(await invalidFactory.acquire(target), null);
  assert.equal(invalid.calls.filter(call => call.operation === 'RELEASE_LOCK').length, 1);
  const invalidCount = invalid.calls.length;
  assert.equal(await invalidFactory.acquire(target), null);
  assert.equal(invalid.calls.length, invalidCount);

  const failed = new FakeWriterConnection();
  failed.failOperation = 'ACQUIRE_LOCK';
  const failedFactory = makeMutex(failed);
  assert.equal(await failedFactory.acquire(target), null);
  assert.equal(failed.calls.filter(call => call.operation === 'RELEASE_LOCK').length, 1);
  assert.equal(failed.owned, false);

  const lost = new FakeWriterConnection();
  lost.afterOperation = 'ACQUIRE_LOCK';
  const lostFactory = makeMutex(lost);
  assert.equal(await lostFactory.acquire(target), null);
  assert.equal(lost.calls.filter(call => call.operation === 'RELEASE_LOCK').length, 1);
  assert.equal(lost.owned, true); // package reset loses its handle; no unsafe REQUEST recovery
});

test('lost current and release acknowledgments do not retry; release is one-shot cleanup', async () => {
  const connection = new FakeWriterConnection(), mutex = makeMutex(connection);
  const capability = await mutex.acquire(target);
  connection.failOperation = 'CURRENT_LOCK';
  assert.equal(await capability.current(), false);
  assert.equal(await capability.current(), false);
  assert.equal(connection.calls.filter(call => call.operation === 'ACQUIRE_LOCK').length, 1);
  connection.failOperation = 'RELEASE_LOCK';
  assert.equal(await capability.release(), false);
  assert.equal(await capability.release(), false);
  assert.equal(connection.calls.filter(call => call.operation === 'RELEASE_LOCK').length, 1);
});

test('overlapping capability calls fail closed without concurrent SQL', async () => {
  const connection = new FakeWriterConnection(), mutex = makeMutex(connection);
  const capability = await mutex.acquire(target);
  let unblock;
  connection.blockOperation = 'CURRENT_LOCK';
  connection.block = new Promise(resolve => { unblock = resolve; });
  const current = capability.current();
  await new Promise(resolve => setImmediate(resolve));
  const calls = connection.calls.length;
  assert.equal(await capability.release(), false);
  assert.equal(connection.calls.length, calls);
  unblock();
  assert.equal(await current, false);
  assert.equal(await capability.release(), true);
  assert.equal(connection.calls.filter(call => call.operation === 'ACQUIRE_LOCK').length, 1);
});

test('owner, caller timeout, and target key are bounded before any SQL', async t => {
  for (const invalid of [
    { owner: 'sf_execution', timeout: 5000, key: target },
    { owner: 'SF_EXECUTION;DROP TABLE X', timeout: 5000, key: target },
    { owner: 'A'.repeat(31), timeout: 5000, key: target },
    { owner, timeout: 0, key: target }, { owner, timeout: 30_001, key: target },
    { owner, timeout: 5000, key: "x' OR 1=1 --" },
  ]) await t.test(JSON.stringify(invalid), async () => {
    const connection = new FakeWriterConnection();
    connection.callTimeout = invalid.timeout;
    if (invalid.owner !== owner) assert.throws(() => createOracleTargetMutex(connection, { owner: invalid.owner }));
    else if (invalid.timeout < 1 || invalid.timeout > 30_000) assert.throws(() => makeMutex(connection));
    else {
      const mutex = makeMutex(connection);
      assert.equal(await mutex.acquire(invalid.key), null);
    }
    assert.equal(connection.calls.length, 0);
  });

  const changing = new FakeWriterConnection(), mutex = makeMutex(changing);
  const capability = await mutex.acquire(target);
  changing.callTimeout = 0;
  assert.equal(await capability.current(), false);
  assert.equal(changing.calls.length, 1);
});
