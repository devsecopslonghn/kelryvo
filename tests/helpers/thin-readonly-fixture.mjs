import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

export const UNIT_NOW = Date.parse('2026-10-08T14:30:00Z');
export const UNIT_PASSWORD = randomBytes(24).toString('hex');
function temporaryUnitWallet() {
  const directory = mkdtempSync(join(tmpdir(), 'schemaforge-unit-wallet-'));
  const file = name => join(directory, name);
  const openssl = args => execFileSync('/usr/bin/openssl', args, {
    stdio: 'ignore', timeout: 10_000,
    env: { PATH: '/usr/bin:/bin', LANG: 'C', OPENSSL_CONF: '/dev/null' },
  });
  try {
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=schemaforge-unit-ca.invalid',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', file('ca.key'), '-out', file('ca.pem')]);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=schemaforge-unit-client.invalid',
      '-keyout', file('client.key'), '-out', file('client.csr')]);
    openssl(['x509', '-req', '-days', '2', '-in', file('client.csr'), '-CA', file('ca.pem'), '-CAkey', file('ca.key'),
      '-CAcreateserial', '-out', file('client.pem')]);
    const caPem = readFileSync(file('ca.pem'), 'utf8');
    return { caPem, pem: readFileSync(file('client.pem'), 'utf8') + readFileSync(file('client.key'), 'utf8') + caPem };
  } finally {
    // Test keys are ephemeral; no wallet, private key or permit is a tracked fixture.
    rmSync(directory, { recursive: true });
  }
}

const wallet = temporaryUnitWallet();
export const UNIT_PEM = wallet.pem;
export const UNIT_CA_PEM = wallet.caPem;

export function probeFixture() {
  const request = {
    runId: 'unit-run-01', caseId: 'WP0-01-01', oracleVersion: '19c',
    role: 'ownerA', intentSha256: '1'.repeat(64),
  };
  const grant = {
    request: { ...request }, permitId: 'unit-permit-01', expiresAt: UNIT_NOW + 60_000,
    profileSha256: '2'.repeat(64), buildSha256: '3'.repeat(64), fixtureSha256: '4'.repeat(64),
    action: 'CONNECT_AND_READ_IDENTITY', disposable: true,
    route: { host: 'unit-lab.example.invalid', port: 2484, serviceName: 'UNIT_PDB_SERVICE' },
    trust: {
      sha256: createHash('sha256').update(UNIT_CA_PEM).digest('hex'),
      walletSha256: createHash('sha256').update(UNIT_PEM).digest('hex'),
    },
    credential: { reference: 'vault://unit/owner-a', revision: 'revision-01', principal: 'UNIT_OWNER_A' },
    expected: { dbUniqueName: 'UNIT_CDB', serviceName: 'UNIT_PDB_SERVICE', pdb: 'UNIT_PDB', conId: 3, serverVersionString: '19.24.0.0.0' },
    timeouts: { connectSeconds: 5, transportSeconds: 3, callMilliseconds: 1000 },
  };
  const state = { admissions: [], claims: [], trust: [], credentials: [], connects: [], reads: [], closes: 0 };
  const claimed = new Set();
  const connection = {
    thin: true, oracleServerVersionString: '19.24.0.0.0', callTimeout: 0,
    async execute(...args) {
      state.reads.push(args);
      return { rows: [['UNIT_OWNER_A', 'UNIT_PDB_SERVICE', 'UNIT_PDB', '3', 'UNIT_CDB']] };
    },
    async close() { state.closes += 1; },
  };
  const ports = {
    now: () => UNIT_NOW,
    driver: {
      thin: true, versionString: '7.0.1', OUT_FORMAT_ARRAY: 4001,
      async getConnection(options) { state.connects.push(options); return connection; },
    },
    async admit(value) { state.admissions.push(value); return grant; },
    async claimDispatch(value) {
      state.claims.push(value);
      if (claimed.has(value.permitId)) return undefined;
      claimed.add(value.permitId);
      return { permitId: value.permitId, intentSha256: value.request.intentSha256, dispatchId: 'unit-dispatch-01' };
    },
    async resolveTrust(value) { state.trust.push(value); return { pem: UNIT_PEM, caPem: UNIT_CA_PEM, walletPassword: '' }; },
    async resolveCredentials(value) {
      state.credentials.push(value);
      return { ...grant.credential, password: UNIT_PASSWORD };
    },
  };
  return { request, grant, state, connection, ports };
}
