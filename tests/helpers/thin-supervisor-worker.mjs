import { runThinProbeWorker } from '../../experiments/db-devops-wp0/thin-probe-worker.mjs';
import { THIN_WORKER_PROTOCOL } from '../../experiments/db-devops-wp0/thin-probe-protocol.mjs';
import { probeFixture } from './thin-readonly-fixture.mjs';

// Fixed UNIT entry only; no driver connection, provider backend or network is used.
const mode = process.argv[2];
const fixture = probeFixture();
const hold = () => new Promise(() => {});
function hanging(phase) {
  return async () => {
    process.stdout.write(`unit-phase:${phase}\n`);
    return hold();
  };
}
const phases = {
  admit: () => { fixture.ports.admit = hanging('admit'); },
  trust: () => { fixture.ports.resolveTrust = hanging('trust'); },
  credentials: () => { fixture.ports.resolveCredentials = hanging('credentials'); },
  claim: () => { fixture.ports.claimDispatch = hanging('claim'); },
  connect: () => { fixture.ports.driver.getConnection = hanging('connect'); },
  read: () => { fixture.connection.execute = hanging('read'); },
  close: () => { fixture.connection.close = hanging('close'); },
  'event-loop': () => { fixture.ports.admit = async () => {
    process.stdout.write('unit-phase:event-loop\n');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
    return undefined;
  }; },
};

if (Object.hasOwn(phases, mode)) {
  phases[mode]();
  runThinProbeWorker(fixture.ports);
} else if (mode === 'matched') {
  runThinProbeWorker(fixture.ports);
} else if (mode === 'denied') {
  runThinProbeWorker({ ...fixture.ports, driver: undefined, admit: async () => undefined });
} else if (mode === 'environment') {
  const expectedEnvironment = { PATH: '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' };
  const safe = Object.keys(process.env).length === 3 && process.execArgv.length === 0
    && Object.entries(expectedEnvironment).every(([key, value]) => process.env[key] === value);
  runThinProbeWorker({ ...fixture.ports, admit: async () => {
    if (!safe) throw new Error('unit_environment_rejected');
    return fixture.grant;
  } });
} else if (mode === 'ignore-term') {
  process.on('SIGTERM', () => { process.stdout.write('unit-term-ignored\n'); });
  fixture.ports.admit = hanging('admit');
  runThinProbeWorker(fixture.ports);
} else {
  process.send({ type: 'READY', protocol: THIN_WORKER_PROTOCOL });
  process.once('message', message => {
    if (mode === 'crash') return process.exit(1);
    if (mode === 'missing') return process.disconnect();
    if (mode === 'output') {
      process.stdout.write('x'.repeat(8192));
      return;
    }
    if (mode === 'oversize') {
      process.send({ type: 'RESULT', extra: 'x'.repeat(8192) });
      return;
    }
    if (mode === 'duplicate') {
      process.send({ type: 'READY', protocol: THIN_WORKER_PROTOCOL });
      return;
    }
    process.send({ type: 'RESULT', protocol: THIN_WORKER_PROTOCOL, request: message.request,
      result: { status: 'READ_ONLY_IDENTITY_MATCHED', secret: fixture.ports } });
  });
}
