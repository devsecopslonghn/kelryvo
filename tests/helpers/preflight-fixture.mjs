import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const repo = process.cwd();
const offlineRoot = join(repo, 'experiments/db-devops-wp0/offline-inputs');
const kinds = ['node-runtime', 'npm-toolchain', 'oracle-driver', 'sql-parser', 'postgresql-image', 'fixture-bundle'];
const actions = ['connect', 'discover-dictionary', 'execute-owner-ddl', 'observe-fixtures', 'bootstrap-allowlisted-fixtures', 'use-dbms-lock', 'fault-proxy', 'stop-fixture-session', 'teardown-allowlisted-fixtures'];
const NEGATIVE_PROBE_ACTIONS = ['connect', 'observe-fixtures'];

export { kinds };

export const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function relativeOffline(path) {
  return path.slice(offlineRoot.length + 1).split(requireSeparator()).join('/');
}

function requireSeparator() {
  return process.platform === 'win32' ? '\\' : '/';
}

export async function profileFixture() {
  await mkdir(offlineRoot, { recursive: true });
  const dir = await mkdtemp(join(offlineRoot, 'preflight-test-'));
  const paths = [];
  const artifact = async (name, bytes) => {
    const path = join(dir, name);
    await writeFile(path, bytes);
    paths.push(path);
    return { path: relativeOffline(path), sha256: sha(bytes) };
  };
  const noticeBytes = Buffer.from('synthetic fixture notice marker; no rights assertion');
  const notice = await artifact('NOTICE-fixture.txt', noticeBytes);
  const artifacts = await kinds.reduce(async (previous, kind) => {
    const entries = await previous;
    const content = Buffer.from(`synthetic ${kind} input`);
    const data = await artifact(`${kind}.bin`, content);
    entries.push({ kind, path: data.path, sha256: data.sha256, version: '1.0.0', sourceRef: `source://synthetic/${kind}`, noticePath: notice.path, noticeSha256: notice.sha256, maintenanceRef: `attestation://synthetic/${kind}` });
    return entries;
  }, Promise.resolve([]));
  const pgBytes = Buffer.from('synthetic offline postgres image marker');
  const pg = await artifact('postgres.fixture', pgBytes);
  const route19 = { service: 'svc19', containerId: 'cdb19', pdb: 'pdb19', environment: 'DEV', endpoint: 'tcps://oracle19.example.invalid:2484/svc19' };
  const route21 = { service: 'svc21', containerId: 'cdb21', pdb: 'pdb21', environment: 'DEV', endpoint: 'tcps://oracle21.example.invalid:2484/svc21' };
  const schemas = {};
  for (const [key, owner, prefix, project, pdb19, pdb21, service19, service21] of [
    ['A', 'APP_A', 'WP0A_', 'project-a', 'pdb19', 'pdb21', 'svc19', 'svc21'],
    ['B', 'APP_B', 'WP0B_', 'project-b', 'pdb19', 'pdb21', 'svc19', 'svc21'],
    ['C', 'APP_C', 'WP0C_', 'cross-pdb-negative', 'other19', 'other21', 'negative19', 'negative21'],
  ]) {
    schemas[key] = {
      owner,
      prefix,
      project,
      targets: {
        '19c': { service: service19, containerId: 'cdb19', pdb: pdb19, environment: 'DEV' },
        '21c': { service: service21, containerId: 'cdb21', pdb: pdb21, environment: 'DEV' },
      },
    };
  }
  const footprint = [];
  for (const version of ['19c', '21c']) {
    for (const key of ['A', 'B', 'C']) {
      const fixture = schemas[key];
      const target = fixture.targets[version];
      footprint.push({ version, owner: fixture.owner, prefix: fixture.prefix, project: fixture.project, ...target });
    }
  }
  const profile = {
    schemaVersion: '1.0.0',
    oracle: {
      '19c': { exactVersion: '19.22.0.0.0', route: route19, tcps: { caSha256: 'a'.repeat(64), serverIdentity: 'oracle19.example.invalid' } },
      '21c': { exactVersion: '21.3.0.0.0', route: route21, tcps: { caSha256: 'b'.repeat(64), serverIdentity: 'oracle21.example.invalid' } },
    },
    authorization: {
      disposable: true,
      labOwner: 'lab-owner',
      targets: [
        { version: '19c', service: 'svc19', containerId: 'cdb19', pdb: 'pdb19' },
        { version: '21c', service: 'svc21', containerId: 'cdb21', pdb: 'pdb21' },
      ],
      negativeProbeTargets: [
        { version: '19c', service: 'negative19', endpoint: 'tcps://oracle19.example.invalid:2484/negative19', serverIdentity: 'oracle19.example.invalid', caSha256: 'a'.repeat(64), containerId: 'cdb19', pdb: 'other19', actions: NEGATIVE_PROBE_ACTIONS },
        { version: '21c', service: 'negative21', endpoint: 'tcps://oracle21.example.invalid:2484/negative21', serverIdentity: 'oracle21.example.invalid', caSha256: 'b'.repeat(64), containerId: 'cdb21', pdb: 'other21', actions: NEGATIVE_PROBE_ACTIONS },
      ],
      schemaFootprint: footprint,
      actions,
    },
    entitlement: {
      oracle19: { attested: true, evidenceRef: 'attestation://lab/oracle19' },
      oracle21: { attested: true, evidenceRef: 'attestation://lab/oracle21' },
      labPermission: { attested: true, evidenceRef: 'attestation://lab/disposable' },
    },
    fixtures: { sha256: 'c'.repeat(64), schemas },
    credentials: {
      discovery: { ref: 'vault://lab/discovery' },
      ownerA: { ref: 'vault://lab/owner-a' },
      ownerB: { ref: 'vault://lab/owner-b' },
      observer: { ref: 'vault://lab/observer' },
      bootstrap: { ref: 'vault://lab/bootstrap' },
    },
    grants: {
      discovery: ['dictionary-read'],
      ownerA: ['own-schema-ddl'],
      ownerB: ['own-schema-ddl'],
      observer: ['fixture-observe'],
      bootstrap: ['allowlisted-fixture-ddl'],
      dbmsLock: { authorized: true, scope: 'fixture mutex only' },
    },
    faults: {
      proxy: { authorized: true, owner: 'lab-owner', actions: ['fault-proxy'] },
      sessionStop: { authorized: true, owner: 'lab-owner', actions: ['stop-fixture-session'] },
    },
    postgresql: { metadataFixture: { image: 'postgres fixture', version: '16.4', path: pg.path, sha256: pg.sha256, offline: true } },
    aliases: [
      { name: 'alias-one', version: '19c', service: 'alias-one', endpoint: 'tcps://alias-one.example.invalid:2484/alias-one', serverIdentity: 'alias-one.example.invalid', caSha256: 'a'.repeat(64), expectedContainerId: 'cdb19', expectedPdb: 'pdb19' },
      { name: 'alias-two', version: '19c', service: 'alias-two', endpoint: 'tcps://alias-two.example.invalid:2484/alias-two', serverIdentity: 'alias-two.example.invalid', caSha256: 'a'.repeat(64), expectedContainerId: 'cdb19', expectedPdb: 'pdb19' },
      { name: 'alias-three', version: '21c', service: 'alias-three', endpoint: 'tcps://alias-three.example.invalid:2484/alias-three', serverIdentity: 'alias-three.example.invalid', caSha256: 'b'.repeat(64), expectedContainerId: 'cdb21', expectedPdb: 'pdb21' },
      { name: 'alias-four', version: '21c', service: 'alias-four', endpoint: 'tcps://alias-four.example.invalid:2484/alias-four', serverIdentity: 'alias-four.example.invalid', caSha256: 'b'.repeat(64), expectedContainerId: 'cdb21', expectedPdb: 'pdb21' },
    ],
    artifacts,
    harness: { sha256: 'd'.repeat(64) },
    build: { sha256: 'e'.repeat(64) },
    toolchain: { node: process.version, npm: '10.9.3' },
    teardown: { owner: 'lab-owner', authorized: true, actions: ['teardown-allowlisted-fixtures'], schemaKeys: ['A', 'B'] },
  };
  return { profile, dir, paths, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
