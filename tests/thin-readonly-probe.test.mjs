import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPrivateKey } from 'node:crypto';
import { createSecureContext } from 'node:tls';
import { createReadOnlyThinProbe } from '../experiments/db-devops-wp0/thin-readonly-probe.mjs';
import { probeFixture, UNIT_NOW, UNIT_PASSWORD, UNIT_PEM, UNIT_CA_PEM } from './helpers/thin-readonly-fixture.mjs';

function assertNoConnection(fixture) {
  assert.equal(fixture.state.connects.length, 0);
  assert.equal(fixture.state.reads.length, 0);
  assert.equal(fixture.state.closes, 0);
}

function assertNoSecret(result) {
  const serialized = JSON.stringify(result);
  for (const sensitive of [UNIT_PASSWORD, 'vault://', 'UNIT_OWNER_A', 'unit-lab.example.invalid', 'BEGIN CERTIFICATE', 'raw-driver-canary']) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.equal(result.migrationCalls, 0);
  assert.equal(result.acceptance, 'NOT_EVALUATED');
}

test('candidate uses one strict TCPS connection, one fixed read and closes without accepting a case', async () => {
  const fixture = probeFixture();
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assert.equal(result.status, 'READ_ONLY_IDENTITY_MATCHED');
  assert.equal(result.connectionCalls, 1);
  assert.equal(result.readOnlyCalls, 1);
  assert.equal(fixture.state.admissions.length, 2);
  assert.equal(fixture.state.claims.length, 1);
  assert.equal(fixture.state.trust.length, 1);
  assert.equal(fixture.state.credentials.length, 1);
  assert.equal(fixture.state.closes, 1);
  assert.equal(fixture.connection.callTimeout, 1000);
  const [options] = fixture.state.connects;
  assert.equal(options.sslServerDNMatch, true);
  assert.equal(options.sslAllowWeakDNMatch, false);
  assert.equal(options.walletContent, UNIT_PEM);
  assert.equal(options.user, fixture.grant.credential.principal);
  assert.equal(options.password, UNIT_PASSWORD);
  assert.equal(options.connectTimeout, 5);
  assert.equal(options.transportConnectTimeout, 3);
  assert.equal(options.retryCount, 0);
  assert.equal('walletLocation' in options, false);
  assert.equal('privilege' in options, false);
  assert.equal('configDir' in options, false);
  assert.match(options.connectString, /TCPS|tcps/);
  const [sql, binds, executionOptions] = fixture.state.reads[0];
  assert.match(sql, /^SELECT\b/i);
  assert.match(sql, /SYS_CONTEXT\('USERENV',\s*'SESSION_USER'\)/i);
  assert.match(sql, /FROM SYS\.DUAL\s*$/i);
  assert.deepEqual(binds, []);
  assert.equal(executionOptions.maxRows, 2);
  assert.equal(executionOptions.outFormat, fixture.ports.driver.OUT_FORMAT_ARRAY);
  assertNoSecret(result);
});

test('21c has a separately matched version; wrong service/PDB controls never trigger another route', async () => {
  const fixture = probeFixture();
  fixture.request.oracleVersion = '21c';
  fixture.request.caseId = 'WP0-01-02';
  fixture.grant.request = { ...fixture.request };
  fixture.grant.expected.serverVersionString = '21.12.0.0.0';
  fixture.connection.oracleServerVersionString = '21.12.0.0.0';
  const probe = createReadOnlyThinProbe(fixture.ports);
  const matched = await probe(fixture.request);
  assert.equal(matched.status, 'READ_ONLY_IDENTITY_MATCHED');
  fixture.grant.permitId = 'unit-permit-02';
  fixture.connection.execute = async (...args) => {
    fixture.state.reads.push(args);
    return { rows: [['UNIT_OWNER_A', 'WRONG_SERVICE', 'WRONG_PDB', '3', 'UNIT_CDB']] };
  };
  const mismatch = await probe(fixture.request);
  assert.notEqual(mismatch.status, 'READ_ONLY_IDENTITY_MATCHED');
  assert.equal(mismatch.connectionCalls, 1);
  assert.equal(mismatch.readOnlyCalls, 1);
  assert.equal(fixture.state.connects.length, 2);
  assert.equal(fixture.state.closes, 2);
  assertNoSecret(mismatch);
});

test('preflight/report booleans, write/fault cases and extra SQL cannot admit a probe', async () => {
  for (const mutate of [
    request => ({ ...request, connectionAuthorized: true }),
    request => ({ ...request, caseId: 'WP0-01-05' }),
    request => ({ ...request, sql: 'CREATE TABLE unit_bad (id NUMBER)' }),
    () => ({ preflight: { status: 'PREFLIGHT_VALID' }, disposable: true }),
  ]) {
    const fixture = probeFixture();
    const result = await createReadOnlyThinProbe(fixture.ports)(mutate(fixture.request));
    assert.equal(fixture.state.admissions.length, 0);
    assert.equal(fixture.state.credentials.length, 0);
    assert.equal(fixture.state.trust.length, 0);
    assertNoConnection(fixture);
    assertNoSecret(result);
  }
});

test('denied or throwing authority never resolves credentials or calls the driver', async () => {
  for (const response of [undefined, false, true, { authorized: true }]) {
    const fixture = probeFixture();
    fixture.ports.admit = async () => response;
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assert.equal(fixture.state.credentials.length, 0);
    assert.equal(fixture.state.trust.length, 0);
    assertNoConnection(fixture);
    assertNoSecret(result);
  }
  const fixture = probeFixture();
  fixture.ports.admit = async () => { throw new Error(`raw-driver-canary ${UNIT_PASSWORD}`); };
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('expired, overlong, unbound and descriptor-injected grants are rejected before providers', async () => {
  const mutations = [
    grant => { grant.expiresAt = UNIT_NOW; },
    grant => { grant.expiresAt = UNIT_NOW + 16 * 60_000; },
    grant => { grant.disposable = false; },
    grant => { grant.request.intentSha256 = '9'.repeat(64); },
    grant => { grant.route.host = 'x.invalid)(ADDRESS=(PROTOCOL=TCP'; },
    grant => { grant.route.serviceName = 'UNIT?wallet_location=SYSTEM'; },
    grant => { grant.route.port = 0; },
    grant => { grant.timeouts.connectSeconds = 0; },
    grant => { grant.timeouts.callMilliseconds = Infinity; },
    grant => { grant.credential.principal = 'UNIT_A[UNIT_B]'; },
  ];
  for (const mutate of mutations) {
    const fixture = probeFixture();
    mutate(fixture.grant);
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assert.equal(fixture.state.credentials.length, 0);
    assert.equal(fixture.state.trust.length, 0);
    assertNoConnection(fixture);
    assertNoSecret(result);
  }
});

test('changed trust bytes and secret scope or revision cannot open a connection', async () => {
  const mutations = [
    ports => { ports.resolveTrust = async () => ({ pem: `${UNIT_PEM}\n`, caPem: UNIT_CA_PEM, walletPassword: '' }); },
    ports => { ports.resolveTrust = async () => ({ pem: `-----BEGIN PRIVATE KEY-----\n${UNIT_PASSWORD}\n-----END PRIVATE KEY-----`, caPem: UNIT_CA_PEM, walletPassword: '' }); },
    ports => { ports.resolveCredentials = async () => ({ reference: 'vault://unit/owner-b', revision: 'revision-01', principal: 'UNIT_OWNER_A', password: UNIT_PASSWORD }); },
    ports => { ports.resolveCredentials = async () => ({ reference: 'vault://unit/owner-a', revision: 'revision-02', principal: 'UNIT_OWNER_A', password: UNIT_PASSWORD }); },
    ports => { ports.resolveCredentials = async () => ({ reference: 'vault://unit/owner-a', revision: 'revision-01', principal: 'UNIT_OWNER_B', password: UNIT_PASSWORD }); },
  ];
  for (const mutate of mutations) {
    const fixture = probeFixture();
    mutate(fixture.ports);
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assertNoConnection(fixture);
    assertNoSecret(result);
  }
});

test('invalid CA material with a matching digest is rejected without consulting the driver', async () => {
  const fixture = probeFixture();
  const pem = '-----BEGIN CERTIFICATE-----\nINVALID\n-----END CERTIFICATE-----\n';
  fixture.grant.trust.sha256 = createHash('sha256').update(pem).digest('hex');
  fixture.grant.trust.walletSha256 = createHash('sha256').update(pem).digest('hex');
  fixture.ports.resolveTrust = async () => ({ pem, caPem: pem, walletPassword: '' });
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('re-admission rejects revocation, scope revision and expiry after resolving providers', async () => {
  for (const mutate of [
    () => undefined,
    grant => ({ ...grant, fixtureSha256: '8'.repeat(64) }),
    grant => ({ ...grant, credential: { ...grant.credential, revision: 'revision-02' } }),
  ]) {
    const fixture = probeFixture();
    let admissions = 0;
    fixture.ports.admit = async () => (++admissions === 1 ? fixture.grant : mutate(fixture.grant));
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assert.equal(admissions, 2);
    assertNoConnection(fixture);
    assertNoSecret(result);
  }
  const fixture = probeFixture();
  fixture.ports.resolveCredentials = async () => {
    fixture.ports.now = () => UNIT_NOW + 60_000;
    return { ...fixture.grant.credential, password: UNIT_PASSWORD };
  };
  let clockCalls = 0;
  fixture.ports.now = () => (++clockCalls === 1 ? UNIT_NOW : UNIT_NOW + 60_000);
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('authority and request snapshots resist mutation during asynchronous credential lookup', async () => {
  const fixture = probeFixture();
  fixture.ports.resolveCredentials = async grant => {
    assert.equal(Object.isFrozen(grant), true);
    assert.equal(Object.isFrozen(grant.credential), true);
    assert.throws(() => { grant.credential.principal = 'UNIT_OWNER_B'; }, TypeError);
    fixture.request.role = 'ownerB';
    fixture.grant.route.host = 'changed.example.invalid';
    return { ...grant.credential, password: UNIT_PASSWORD };
  };
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('a wrong principal, container fact, version or malformed result always closes with no fallback', async () => {
  for (const row of [
    ['UNIT_OWNER_B', 'UNIT_PDB_SERVICE', 'UNIT_PDB', '3', 'UNIT_CDB'],
    ['UNIT_OWNER_A', 'UNIT_PDB_SERVICE', 'UNIT_PDB', '9', 'UNIT_CDB'],
    ['UNIT_OWNER_A', 'UNIT_PDB_SERVICE', 'UNIT_PDB', '3', 'WRONG_DB'],
    [],
  ]) {
    const fixture = probeFixture();
    fixture.connection.execute = async (...args) => { fixture.state.reads.push(args); return { rows: [row] }; };
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assert.notEqual(result.status, 'READ_ONLY_IDENTITY_MATCHED');
    assert.equal(fixture.state.closes, 1);
    assert.equal(fixture.state.connects.length, 1);
    assertNoSecret(result);
  }
  const fixture = probeFixture();
  fixture.connection.oracleServerVersionString = '23.1.0.0.0';
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assert.notEqual(result.status, 'READ_ONLY_IDENTITY_MATCHED');
  assert.equal(fixture.state.closes, 1);
  assertNoSecret(result);
});

test('connect/read/close errors are sanitized; read or uncertain cleanup requires HOLD without retry', async () => {
  for (const phase of ['connect', 'read', 'close']) {
    const fixture = probeFixture();
    const fail = async () => { throw new Error(`raw-driver-canary ${UNIT_PASSWORD} unit-lab.example.invalid`); };
    if (phase === 'connect') fixture.ports.driver.getConnection = async options => { fixture.state.connects.push(options); return fail(); };
    if (phase === 'read') fixture.connection.execute = async (...args) => { fixture.state.reads.push(args); return fail(); };
    if (phase === 'close') fixture.connection.close = async () => { fixture.state.closes += 1; return fail(); };
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assert.equal(fixture.state.connects.length, 1);
    assert.equal(fixture.state.closes, phase === 'connect' ? 0 : 1);
    if (phase !== 'connect') assert.equal(result.status, 'HOLD');
    if (phase === 'close') assert.equal(result.cleanup, 'REQUIRED');
    assertNoSecret(result);
  }
});

test('wallet produces the actual native TLS context while CA-only material fails closed', async () => {
  assert.doesNotThrow(() => createSecureContext({ cert: UNIT_PEM, key: UNIT_PEM, ca: UNIT_PEM }));
  assert.throws(() => createSecureContext({ cert: UNIT_CA_PEM, key: UNIT_CA_PEM, ca: UNIT_CA_PEM }));
  const fixture = probeFixture();
  fixture.grant.trust.walletSha256 = createHash('sha256').update(UNIT_CA_PEM).digest('hex');
  fixture.ports.resolveTrust = async () => ({ pem: UNIT_CA_PEM, caPem: UNIT_CA_PEM, walletPassword: '' });
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('approved encrypted client wallet supports its scoped password without publishing it', async () => {
  const fixture = probeFixture();
  const encryptedKey = createPrivateKey(UNIT_PEM).export({
    type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: UNIT_PASSWORD,
  });
  const pem = UNIT_PEM.replace(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----\n/, encryptedKey);
  fixture.grant.trust.walletSha256 = createHash('sha256').update(pem).digest('hex');
  fixture.ports.resolveTrust = async () => ({ pem, caPem: UNIT_CA_PEM, walletPassword: UNIT_PASSWORD });
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assert.equal(result.status, 'READ_ONLY_IDENTITY_MATCHED');
  assert.equal(fixture.state.connects[0].walletPassword, UNIT_PASSWORD);
  assertNoSecret(result);
});

test('atomic claim is required, cannot reuse a consumed permit and never retries a denied claim', async () => {
  const fixture = probeFixture();
  const probe = createReadOnlyThinProbe(fixture.ports);
  const matched = await probe(fixture.request);
  assert.equal(matched.status, 'READ_ONLY_IDENTITY_MATCHED');
  const replay = await probe(fixture.request);
  assert.notEqual(replay.status, 'READ_ONLY_IDENTITY_MATCHED');
  assert.equal(replay.connectionCalls, 0);
  assert.equal(fixture.state.connects.length, 1);
  assert.equal(fixture.state.claims.length, 2);
  assertNoSecret(replay);
  const denied = probeFixture();
  denied.ports.claimDispatch = async () => { throw new Error(`raw-driver-canary ${UNIT_PASSWORD}`); };
  const rejected = await createReadOnlyThinProbe(denied.ports)(denied.request);
  assertNoConnection(denied);
  assertNoSecret(rejected);
});

test('the real pinned default driver can only reach denied admission, without credential resolution', async () => {
  const fixture = probeFixture();
  delete fixture.ports.driver;
  fixture.ports.admit = async request => { fixture.state.admissions.push(request); return undefined; };
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assert.equal(fixture.state.admissions.length, 1);
  assert.equal(fixture.state.credentials.length, 0);
  assert.equal(fixture.state.trust.length, 0);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('driver mode changes and throwing provider objects fail closed without leaking errors', async () => {
  for (const mutate of [
    ports => { ports.driver.thin = false; },
    ports => { Object.defineProperty(ports.driver, 'thin', { get() { throw new Error(UNIT_PASSWORD); } }); },
    ports => { ports.resolveTrust = async () => Object.defineProperty({}, 'pem', { get() { throw new Error(UNIT_PASSWORD); } }); },
    ports => { ports.resolveCredentials = async () => Object.defineProperty({}, 'password', { get() { throw new Error(UNIT_PASSWORD); } }); },
  ]) {
    const fixture = probeFixture();
    mutate(fixture.ports);
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assertNoConnection(fixture);
    assertNoSecret(result);
  }
});

test('wallet ordering is checked against the native driver TLS context, including CA-first rejection', async () => {
  const fixture = probeFixture();
  const certificates = UNIT_PEM.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
  const key = UNIT_PEM.match(/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/)[0];
  const pem = `${certificates[1]}\n${certificates[0]}\n${key}\n`;
  assert.throws(() => createSecureContext({ cert: pem, key: pem, ca: pem }));
  fixture.grant.trust.walletSha256 = createHash('sha256').update(pem).digest('hex');
  fixture.ports.resolveTrust = async () => ({ pem, caPem: UNIT_CA_PEM, walletPassword: '' });
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('debugger or disabled TLS environment rejects both early admission and late dispatch', async () => {
  for (const [name, value] of [['ORA_DEBUG_JDWP', 'host=unit-debug.example.invalid;port=4000'], ['NODE_TLS_REJECT_UNAUTHORIZED', '0']]) {
    const previous = process.env[name];
    try {
      process.env[name] = value;
      const fixture = probeFixture();
      const denied = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
      assert.equal(fixture.state.admissions.length, 0);
      assert.equal(fixture.state.trust.length, 0);
      assert.equal(fixture.state.credentials.length, 0);
      assertNoConnection(fixture);
      assertNoSecret(denied);
      delete process.env[name];
      const late = probeFixture();
      const claim = late.ports.claimDispatch;
      late.ports.claimDispatch = async grant => {
        const receipt = await claim(grant);
        process.env[name] = value;
        return receipt;
      };
      const stopped = await createReadOnlyThinProbe(late.ports)(late.request);
      assertNoConnection(late);
      assertNoSecret(stopped);
    } finally {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
});

test('dispatch rejects wrong receipts, expired claims and late driver mode changes', async () => {
  for (const modify of [
    () => ({ permitId: 'wrong-permit', intentSha256: '1'.repeat(64), dispatchId: 'unit-dispatch' }),
    () => ({ permitId: 'unit-permit-01', intentSha256: '9'.repeat(64), dispatchId: 'unit-dispatch' }),
    () => true,
    fixture => { fixture.ports.driver.thin = false; return { permitId: 'unit-permit-01', intentSha256: '1'.repeat(64), dispatchId: 'unit-dispatch' }; },
  ]) {
    const fixture = probeFixture();
    fixture.ports.claimDispatch = async () => modify(fixture);
    const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
    assertNoConnection(fixture);
    assertNoSecret(result);
  }
  const fixture = probeFixture();
  let time = UNIT_NOW;
  fixture.ports.now = () => time;
  const claim = fixture.ports.claimDispatch;
  fixture.ports.claimDispatch = async grant => {
    const receipt = await claim(grant);
    time = grant.expiresAt;
    return receipt;
  };
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assertNoConnection(fixture);
  assertNoSecret(result);
});

test('exact patch version and read failure count remain distinct from Oracle acceptance', async () => {
  const fixture = probeFixture();
  fixture.connection.oracleServerVersionString = '19.25.0.0.0';
  const result = await createReadOnlyThinProbe(fixture.ports)(fixture.request);
  assert.notEqual(result.status, 'READ_ONLY_IDENTITY_MATCHED');
  assert.equal(fixture.state.closes, 1);
  assertNoSecret(result);
});
