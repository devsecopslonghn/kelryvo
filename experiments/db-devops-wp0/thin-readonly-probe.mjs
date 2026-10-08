import { createHash, X509Certificate } from 'node:crypto';
import oracledb from 'oracledb';
import { createSecureContext } from 'node:tls';

const DRIVER_VERSION = '7.0.1';
const REQUEST_KEYS = ['runId', 'caseId', 'oracleVersion', 'role', 'intentSha256'];
const ROLES = new Set(['discovery', 'ownerA', 'ownerB', 'observer']);
const CASES = new Set(['WP0-01-01', 'WP0-01-02']);
const HASH = /^[a-f0-9]{64}$/;
const NAME = /^[A-Z][A-Z0-9_$#]{0,29}$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CERT_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
const CERT_ONLY = /^(?:\s*-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----\s*)+$/;
const WALLET_BLOCK = /^\s*-----BEGIN (CERTIFICATE|PRIVATE KEY|ENCRYPTED PRIVATE KEY)-----[\s\S]*?-----END \1-----/;
const IDENTITY_SQL = "SELECT SYS_CONTEXT('USERENV', 'SESSION_USER'), SYS_CONTEXT('USERENV', 'SERVICE_NAME'), SYS_CONTEXT('USERENV', 'CON_NAME'), SYS_CONTEXT('USERENV', 'CON_ID'), SYS_CONTEXT('USERENV', 'DB_UNIQUE_NAME') FROM SYS.DUAL";

const RESULT = Object.freeze({
  requestRejected: 'REQUEST_REJECTED',
  authorityRejected: 'AUTHORITY_REJECTED',
  authorityChanged: 'AUTHORITY_CHANGED',
  trustRejected: 'TRUST_REJECTED',
  credentialRejected: 'CREDENTIAL_REJECTED',
  connectRejected: 'CONNECT_REJECTED',
  driverRejected: 'DRIVER_REJECTED',
  readFailed: 'HOLD',
  identityMismatch: 'IDENTITY_MISMATCH',
  cleanupRequired: 'HOLD',
  rejected: 'REJECTED',
  matched: 'READ_ONLY_IDENTITY_MATCHED',
  workerEnvironmentRejected: 'WORKER_ENVIRONMENT_REJECTED',
});

function isRecord(value) {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  } catch {
    return false;
  }
}

function exactKeys(value, keys) {
  try {
    if (!isRecord(value)) return false;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return false;
    return keys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor && Object.hasOwn(descriptor, 'value');
    });
  } catch {
    return false;
  }
}

function boundedText(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\r\n\0]/.test(value);
}

function immutableRequest(input) {
  if (!exactKeys(input, REQUEST_KEYS)) return null;
  if (!boundedText(input.runId, 96) || !/^[A-Za-z0-9._:-]+$/.test(input.runId)) return null;
  if (!CASES.has(input.caseId) || !['19c', '21c'].includes(input.oracleVersion)) return null;
  if (!ROLES.has(input.role) || typeof input.intentSha256 !== 'string' || !HASH.test(input.intentSha256)) return null;
  return Object.freeze({
    runId: input.runId,
    caseId: input.caseId,
    oracleVersion: input.oracleVersion,
    role: input.role,
    intentSha256: input.intentSha256,
  });
}

function validHost(host) {
  if (!boundedText(host, 253) || host !== host.toLowerCase() || host.endsWith('.')) return false;
  return host.split('.').length >= 2 && host.split('.').every((label) => DNS_LABEL.test(label));
}

function grantRoute(value) {
  if (!exactKeys(value, ['host', 'port', 'serviceName'])) return null;
  if (!validHost(value.host) || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
      || typeof value.serviceName !== 'string' || !NAME.test(value.serviceName)) return null;
  return Object.freeze({ host: value.host, port: value.port, serviceName: value.serviceName });
}

function grantExpected(value) {
  if (!exactKeys(value, ['dbUniqueName', 'serviceName', 'pdb', 'conId', 'serverVersionString'])) return null;
  if (![value.dbUniqueName, value.serviceName, value.pdb].every((part) => typeof part === 'string' && NAME.test(part))
      || typeof value.serverVersionString !== 'string' || !validVersionString(value.serverVersionString)
      || !Number.isInteger(value.conId) || value.conId < 1 || value.conId > 65535) return null;
  return Object.freeze({
    dbUniqueName: value.dbUniqueName,
    serviceName: value.serviceName,
    pdb: value.pdb,
    conId: value.conId,
    serverVersionString: value.serverVersionString,
  });
}

function timeouts(value) {
  if (!exactKeys(value, ['connectSeconds', 'transportSeconds', 'callMilliseconds'])) return null;
  if (!Number.isInteger(value.connectSeconds) || value.connectSeconds < 1 || value.connectSeconds > 30
      || !Number.isInteger(value.transportSeconds) || value.transportSeconds < 1 || value.transportSeconds > 30
      || !Number.isInteger(value.callMilliseconds) || value.callMilliseconds < 1 || value.callMilliseconds > 30000) return null;
  return Object.freeze({
    connectSeconds: value.connectSeconds,
    transportSeconds: value.transportSeconds,
    callMilliseconds: value.callMilliseconds,
  });
}

function validGrantHeader(value, request, now) {
  const keys = ['request', 'permitId', 'expiresAt', 'profileSha256', 'buildSha256', 'fixtureSha256', 'action', 'disposable', 'route', 'trust', 'credential', 'expected', 'timeouts'];
  if (!exactKeys(value, keys) || !exactKeys(value.request, REQUEST_KEYS)) return null;
  if (!REQUEST_KEYS.every((key) => value.request[key] === request[key])) return null;
  if (!boundedText(value.permitId, 96) || !/^[A-Za-z0-9._:-]+$/.test(value.permitId)) return null;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt <= now || value.expiresAt - now > 900000) return null;
  if (![value.profileSha256, value.buildSha256, value.fixtureSha256].every((hash) => typeof hash === 'string' && HASH.test(hash))) return null;
  if (value.action !== 'CONNECT_AND_READ_IDENTITY' || value.disposable !== true) return null;
  return true;
}

function normalizeGrantRouteTarget(value, request) {
  const route = grantRoute(value.route);
  const expected = grantExpected(value.expected);
  const bounds = timeouts(value.timeouts);
  if (!route || !expected || !bounds || expected.serviceName !== route.serviceName
      || !validObservedVersion(expected.serverVersionString, expected.serverVersionString, request.oracleVersion)) return null;
  return Object.freeze({ route, expected, timeouts: bounds });
}

function validGrantTrust(value) {
  if (!exactKeys(value.trust, ['sha256', 'walletSha256'])
      || typeof value.trust.sha256 !== 'string' || !HASH.test(value.trust.sha256)
      || typeof value.trust.walletSha256 !== 'string' || !HASH.test(value.trust.walletSha256)) return null;
  return true;
}

function validGrantCredential(value) {
  if (!exactKeys(value.credential, ['reference', 'revision', 'principal'])) return null;
  if (!boundedText(value.credential.reference, 160) || !/^(vault|secret|env|file):\/\/[A-Za-z0-9._/-]+$/.test(value.credential.reference)) return null;
  if (!boundedText(value.credential.revision, 128) || !/^[A-Za-z0-9._:-]+$/.test(value.credential.revision)) return null;
  if (typeof value.credential.principal !== 'string' || !NAME.test(value.credential.principal)) return null;
  return true;
}

function normalizeGrant(value, request, now) {
  if (!validGrantHeader(value, request, now)) return null;
  const routeTarget = normalizeGrantRouteTarget(value, request);
  if (!routeTarget || !validGrantTrust(value) || !validGrantCredential(value)) return null;

  return Object.freeze({
    request,
    permitId: value.permitId,
    expiresAt: value.expiresAt,
    profileSha256: value.profileSha256,
    buildSha256: value.buildSha256,
    fixtureSha256: value.fixtureSha256,
    action: value.action,
    disposable: true,
    route: routeTarget.route,
    trust: Object.freeze({ sha256: value.trust.sha256, walletSha256: value.trust.walletSha256 }),
    credential: Object.freeze({
      reference: value.credential.reference,
      revision: value.credential.revision,
      principal: value.credential.principal,
    }),
    expected: routeTarget.expected,
    timeouts: routeTarget.timeouts,
  });
}

function sameGrant(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validDispatchReceipt(receipt, grant) {
  try {
    return exactKeys(receipt, ['permitId', 'intentSha256', 'dispatchId'])
      && receipt.permitId === grant.permitId
      && receipt.intentSha256 === grant.request.intentSha256
      && boundedText(receipt.dispatchId, 96)
      && /^[A-Za-z0-9._:-]+$/.test(receipt.dispatchId);
  } catch {
    return false;
  }
}

function validDriver(driver) {
  try {
    return driver !== null && (typeof driver === 'object' || typeof driver === 'function')
      && driver.versionString === DRIVER_VERSION && driver.thin === true
      && typeof driver.getConnection === 'function' && Number.isInteger(driver.OUT_FORMAT_ARRAY);
  } catch {
    return false;
  }
}

function hashMatches(text, expected, maximum) {
  if (typeof text !== 'string' || !text || Buffer.byteLength(text, 'utf8') > maximum) return false;
  return createHash('sha256').update(text, 'utf8').digest('hex') === expected;
}

function certificateRecords(pem) {
  try {
    const blocks = pem.match(CERT_BLOCK) ?? [];
    return blocks.map((block) => new X509Certificate(block));
  } catch {
    return [];
  }
}

function pemBlocks(pem) {
  const blocks = [];
  let remaining = pem;
  while (remaining.trim()) {
    const match = WALLET_BLOCK.exec(remaining);
    if (!match) return null;
    blocks.push(Object.freeze({ type: match[1], text: match[0].trim() }));
    remaining = remaining.slice(match[0].length);
  }
  return blocks;
}

function sameFingerprints(left, right) {
  const normalize = (records) => records.map((certificate) => certificate.fingerprint256.replaceAll(':', '').toUpperCase()).sort(compareFingerprints);
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function compareFingerprints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function walletHasSupportedKey(walletPem, caPem, password) {
  if (typeof password !== 'string' || password.length > 4096 || password.includes('\0')) return false;
  const blocks = pemBlocks(walletPem);
  if (!blocks) return false;
  const keyBlocks = blocks.filter(({ type }) => type === 'PRIVATE KEY' || type === 'ENCRYPTED PRIVATE KEY');
  const certBlocks = blocks.filter(({ type }) => type === 'CERTIFICATE');
  if (keyBlocks.length !== 1 || certBlocks.length === 0
      || blocks.length !== keyBlocks.length + certBlocks.length) return false;

  const walletCerts = certificateRecords(certBlocks.map(({ text }) => text).join('\n'));
  const caCerts = certificateRecords(caPem);
  if (walletCerts.length !== certBlocks.length || caCerts.length === 0) return false;
  const walletCas = walletCerts.filter((certificate) => certificate.ca);
  const clientCerts = walletCerts.filter((certificate) => !certificate.ca);
  if (!walletCas.length || !clientCerts.length || !sameFingerprints(walletCas, caCerts)) return false;

  try {
    createSecureContext({
      cert: walletPem,
      key: walletPem,
      ca: walletPem,
      ...(password ? { passphrase: password } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

function snapshotTrust(result, grant) {
  try {
    if (!exactKeys(result, ['pem', 'caPem', 'walletPassword'])) return null;
    const { pem, caPem, walletPassword } = result;
    if (typeof caPem !== 'string' || !CERT_ONLY.test(caPem)
        || !hashMatches(caPem, grant.trust.sha256, 65536)
        || typeof pem !== 'string' || !hashMatches(pem, grant.trust.walletSha256, 131072)) return null;
    const caCerts = certificateRecords(caPem);
    if (caCerts.length === 0 || caCerts.some((certificate) => !certificate.ca)
        || !walletHasSupportedKey(pem, caPem, walletPassword)) return null;
    return Object.freeze({ pem, walletPassword });
  } catch {
    return null;
  }
}

function snapshotCredential(result, grant) {
  try {
    if (!exactKeys(result, ['reference', 'revision', 'principal', 'password'])) return null;
    if (result.reference !== grant.credential.reference
        || result.revision !== grant.credential.revision
        || result.principal !== grant.credential.principal
        || !boundedText(result.password, 4096)) return null;
    return Object.freeze({
      reference: result.reference,
      revision: result.revision,
      principal: result.principal,
      password: result.password,
    });
  } catch {
    return null;
  }
}

function validVersionString(value) {
  if (!boundedText(value, 64)) return false;
  return /^(\d{1,2})\.(?:\d{1,2}\.){2,5}\d{1,3}(?:[._-][A-Za-z0-9.-]{1,20})?$/.test(value);
}

function validObservedVersion(value, expected, oracleVersion) {
  if (!validVersionString(value) || value !== expected) return false;
  return value.startsWith(oracleVersion === '19c' ? '19.' : '21.');
}

function identityMatches(row, grant) {
  if (!Array.isArray(row) || row.length !== 5) return false;
  const [principal, serviceName, pdb, conId, dbUniqueName] = row;
  return principal === grant.credential.principal
    && serviceName === grant.expected.serviceName
    && pdb === grant.expected.pdb
    && conId === String(grant.expected.conId)
    && dbUniqueName === grant.expected.dbUniqueName;
}

function result(status, counts, extra = {}) {
  return Object.freeze({
    status,
    taskStatus: 'BLOCKED',
    runtime: 'BLOCKED',
    runtimeClaims: false,
    acceptance: 'NOT_EVALUATED',
    connectionCalls: counts.connectionCalls,
    readOnlyCalls: counts.readOnlyCalls,
    migrationCalls: 0,
    ...extra,
  });
}

function rejected(reason, counts, extra = {}) {
  return result(RESULT.rejected, counts, { ...extra, reason });
}

async function closeQuietly(connection) {
  try {
    await connection.close();
    return true;
  } catch {
    return false;
  }
}

function safeWorkerEnvironment() {
  return !process.env.ORA_DEBUG_JDWP && process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0';
}

async function admitRequest(admit, request, now) {
  try {
    return normalizeGrant(await admit(request), request, now());
  } catch {
    return null;
  }
}

async function resolveInputs(grant, resolveTrust, resolveCredentials) {
  let trustResult;
  try {
    trustResult = await resolveTrust(grant);
  } catch {
    return { reason: RESULT.trustRejected };
  }
  const trust = snapshotTrust(trustResult, grant);
  if (!trust) return { reason: RESULT.trustRejected };

  let credentialResult;
  try {
    credentialResult = await resolveCredentials(grant);
  } catch {
    return { reason: RESULT.credentialRejected };
  }
  const credential = snapshotCredential(credentialResult, grant);
  if (!credential) return { reason: RESULT.credentialRejected };
  return Object.freeze({ trust, credential });
}

async function authorityStillCurrent(admit, request, grant, now) {
  const current = await admitRequest(admit, request, now);
  return current !== null && sameGrant(grant, current);
}

async function consumePermit(claimDispatch, grant) {
  try {
    const receipt = await claimDispatch(grant);
    return validDispatchReceipt(receipt, grant);
  } catch {
    return false;
  }
}

function grantNotExpired(grant, now) {
  try {
    const currentTime = now();
    return Number.isSafeInteger(currentTime) && grant.expiresAt > currentTime;
  } catch {
    return false;
  }
}

async function openConnection(driver, grant, credential, trustMaterial, counts) {
  const connectString = `tcps://${grant.route.host}:${grant.route.port}/${grant.route.serviceName}`;
  counts.connectionCalls += 1;
  try {
    const connection = await driver.getConnection({
      user: credential.principal,
      password: credential.password,
      connectString,
      retryCount: 0,
      connectTimeout: grant.timeouts.connectSeconds,
      transportConnectTimeout: grant.timeouts.transportSeconds,
      sslServerDNMatch: true,
      sslAllowWeakDNMatch: false,
      walletContent: trustMaterial.pem,
      externalAuth: false,
      ...(trustMaterial.walletPassword ? { walletPassword: trustMaterial.walletPassword } : {}),
    });
    return { connection };
  } catch {
    return { connection: null, rejected: true };
  }
}

async function closeConnectionResult(connection, counts, status, details = {}) {
  if (await closeQuietly(connection)) return result(status, counts, details);
  return result(RESULT.cleanupRequired, counts, {
    driverVersion: DRIVER_VERSION,
    reason: 'CLEANUP_REQUIRED',
    cleanup: 'REQUIRED',
  });
}

async function readIdentity(connection, driver, grant, counts) {
  try {
    connection.callTimeout = grant.timeouts.callMilliseconds;
    counts.readOnlyCalls += 1;
    const observation = await connection.execute(IDENTITY_SQL, [], {
      outFormat: driver.OUT_FORMAT_ARRAY,
      maxRows: 2,
    });
    const serverVersion = connection.oracleServerVersionString;
    if (!validObservedVersion(serverVersion, grant.expected.serverVersionString, grant.request.oracleVersion)
        || !Array.isArray(observation?.rows) || observation.rows.length !== 1
        || !identityMatches(observation.rows[0], grant)) {
      return { status: RESULT.rejected, reason: RESULT.identityMismatch };
    }
    return { status: RESULT.matched, observedServerVersion: serverVersion };
  } catch {
    return { status: RESULT.readFailed, reason: 'READ_FAILED' };
  }
}

/**
 * Build a restricted read-only probe. The injected admission/provider ports
 * belong to trusted worker wiring; this module deliberately supplies none.
 * claimDispatch must consume a one-use permit atomically with current authority
 * checks; an in-memory-only or caller-controlled implementation is not valid.
 * No database connection or secret lookup occurs until probe() is called.
 */
export function createReadOnlyThinProbe({ admit, claimDispatch, resolveCredentials, resolveTrust, driver = oracledb, now = Date.now } = {}) {
  if (typeof admit !== 'function' || typeof resolveCredentials !== 'function'
      || typeof claimDispatch !== 'function' || typeof resolveTrust !== 'function' || typeof now !== 'function') {
    throw new TypeError('probe_ports_required');
  }

  return async function probe(input) {
    const counts = { connectionCalls: 0, readOnlyCalls: 0 };
    let request;
    try {
      request = immutableRequest(input);
    } catch {
      return rejected(RESULT.requestRejected, counts);
    }
    if (!request) return rejected(RESULT.requestRejected, counts);
    if (!validDriver(driver)) return rejected(RESULT.driverRejected, counts);
    if (!safeWorkerEnvironment()) return rejected(RESULT.workerEnvironmentRejected, counts);

    const admitted = await admitRequest(admit, request, now);
    if (!admitted) return rejected(RESULT.authorityRejected, counts);
    const inputs = await resolveInputs(admitted, resolveTrust, resolveCredentials);
    if (inputs.reason) return rejected(inputs.reason, counts);
    if (!await authorityStillCurrent(admit, request, admitted, now)) return rejected(RESULT.authorityChanged, counts);
    if (!validDriver(driver)) return rejected(RESULT.driverRejected, counts);
    if (!await consumePermit(claimDispatch, admitted)) return rejected(RESULT.authorityChanged, counts);
    if (!validDriver(driver)) return rejected(RESULT.driverRejected, counts);
    if (!safeWorkerEnvironment()) return rejected(RESULT.workerEnvironmentRejected, counts);
    if (!grantNotExpired(admitted, now)) return rejected(RESULT.authorityChanged, counts);
    return connectAndCheck(driver, admitted, inputs.credential, inputs.trust, counts);
  };
}

async function connectAndCheck(driver, grant, credential, trustMaterial, counts) {
  const opened = await openConnection(driver, grant, credential, trustMaterial, counts);
  if (opened.rejected) return rejected(RESULT.connectRejected, counts, { driverVersion: DRIVER_VERSION });
  const { connection } = opened;

  let isThinConnection = false;
  try {
    isThinConnection = Boolean(connection) && connection.thin === true;
  } catch {
    if (connection && !(await closeQuietly(connection))) return result(RESULT.cleanupRequired, counts, { reason: 'CLEANUP_REQUIRED', cleanup: 'REQUIRED', driverVersion: DRIVER_VERSION });
    return rejected(RESULT.driverRejected, counts, { driverVersion: DRIVER_VERSION });
  }
  if (!isThinConnection) {
    if (connection && !(await closeQuietly(connection))) return result(RESULT.cleanupRequired, counts, { reason: 'CLEANUP_REQUIRED', cleanup: 'REQUIRED', driverVersion: DRIVER_VERSION });
    return rejected(RESULT.driverRejected, counts, { driverVersion: DRIVER_VERSION });
  }
  const observation = await readIdentity(connection, driver, grant, counts);
  return closeConnectionResult(connection, counts, observation.status, {
    driverVersion: DRIVER_VERSION,
    ...(observation.reason ? { reason: observation.reason } : {}),
    ...(observation.observedServerVersion ? { observedServerVersion: observation.observedServerVersion } : {}),
  });
}
