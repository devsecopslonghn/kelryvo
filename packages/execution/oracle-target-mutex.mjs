import { createHash, randomBytes } from 'node:crypto';
import oracledb from 'oracledb';

const OWNER = /^[A-Z][A-Z0-9_]{0,29}$/;
const TARGET_KEY = /^[A-Za-z0-9._:/-]{1,512}$/;
const LOCK_PREFIX = 'SF_SCHEMAFORGE_TARGET_';
const TIMEOUT_MIN = 1;
const TIMEOUT_MAX = 30_000;

const plsqlFor = (owner, operation) => `BEGIN ${owner}.SF_TARGET_MUTEX.${operation}(:lockName, :nonce, :result); END;`;
const SQL = Object.freeze({
  acquire: owner => plsqlFor(owner, 'ACQUIRE_LOCK'),
  current: owner => plsqlFor(owner, 'CURRENT_LOCK'),
  release: owner => plsqlFor(owner, 'RELEASE_LOCK'),
});

const lockNameFor = targetKey => `${LOCK_PREFIX}${createHash('sha256').update(targetKey, 'utf8').digest('hex')}`;

function callBinds(lockName, nonce) {
  return {
    lockName: { val: lockName, dir: oracledb.BIND_IN, type: oracledb.STRING, maxSize: 128 },
    nonce: { val: nonce, dir: oracledb.BIND_IN, type: oracledb.STRING, maxSize: 64 },
    result: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
  };
}

/** Wrap a caller-owned dedicated writer connection. No connection or credentials are resolved here.
 * The same physical session must remain open across acquire, application DDL, and release.
 */
export function createOracleTargetMutex(writerConnection, { owner } = {}) {
  if (!writerConnection || typeof writerConnection.execute !== 'function'
      || !OWNER.test(owner ?? '') || !Number.isInteger(writerConnection.callTimeout)
      || writerConnection.callTimeout < TIMEOUT_MIN || writerConnection.callTimeout > TIMEOUT_MAX) {
    throw new TypeError('Bounded Oracle writer connection and uppercase owner required');
  }

  let attempted = false;
  let poisoned = false;
  let busy = false;

  const boundedConnection = () => Number.isInteger(writerConnection.callTimeout)
    && writerConnection.callTimeout >= TIMEOUT_MIN && writerConnection.callTimeout <= TIMEOUT_MAX;

  async function invoke(operation, lockName, nonce, allowPoisoned = false) {
    if (busy || poisoned && !allowPoisoned || !boundedConnection()) {
      poisoned = true;
      return null;
    }
    busy = true;
    try {
      const result = await writerConnection.execute(SQL[operation](owner), callBinds(lockName, nonce), { autoCommit: false });
      const status = result?.outBinds?.result;
      if (Number.isInteger(status) && status>=0 && status<=5) return status;
      poisoned=true;return null;
    } catch {
      poisoned = true;
      return null;
    } finally {
      busy = false;
    }
  }

  async function cleanupAfterUncertainAcquire(lockName, nonce) {
    // Best effort, once, on the exact same session. Never reconnect or reacquire.
    if (busy || !boundedConnection()) return;
    busy = true;
    try {
      await writerConnection.execute(SQL.release(owner), callBinds(lockName, nonce), { autoCommit: false });
    } catch { /* The session may be gone; the lock ends with that session. */ }
    finally { busy = false; }
  }

  async function acquire(canonicalTargetKey) {
    if (attempted || poisoned || !TARGET_KEY.test(canonicalTargetKey ?? '') || !boundedConnection()) return null;
    attempted = true;
    const lockName = lockNameFor(canonicalTargetKey);
    const nonce = randomBytes(32).toString('hex');
    const status = await invoke('acquire', lockName, nonce);
    if (status === 0) {
      let state = 'ACTIVE';
      let releaseAttempted = false;
      let capabilityBusy = false;

      const current = async () => {
        if (state !== 'ACTIVE') return false;
        if (capabilityBusy) { state = 'LOST'; return false; }
        capabilityBusy = true;
        try {
          const checked = await invoke('current', lockName, nonce);
          if (state !== 'ACTIVE' || checked !== 0) { state = 'LOST'; return false; }
          return true;
        } catch {
          state = 'LOST'; return false;
        } finally { capabilityBusy = false; }
      };

      const release = async () => {
        if (releaseAttempted || state === 'RELEASED') return false;
        if (capabilityBusy) { state = 'LOST'; return false; }
        releaseAttempted = true;
        state = 'RELEASED';
        capabilityBusy = true;
        try { return await invoke('release', lockName, nonce, true) === 0; }
        finally { capabilityBusy = false; }
      };

      return Object.freeze({ current, release });
    }

    // Return code 4 means this session already owns the lock. Its state is not ours to adopt.
    // Any missing/invalid OUT bind is ambiguous, so attempt one same-session cleanup with our nonce.
    if (status === null) {
      poisoned = true;
      await cleanupAfterUncertainAcquire(lockName, nonce);
    }
    return null;
  }

  return Object.freeze({ acquire });
}
