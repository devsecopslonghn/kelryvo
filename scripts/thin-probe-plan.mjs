import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { prepareThinProbePlan } from '../experiments/db-devops-wp0/thin-probe-plan.mjs';

const MAX_PROFILE_BYTES = 1024 * 1024;

async function readProfile(file) {
  const info = await stat(file);
  if (!info.isFile() || info.size > MAX_PROFILE_BYTES) throw new Error('profile_file_invalid');
  const chunks = [];
  let bytes = 0;
  await pipeline(createReadStream(file, { signal: AbortSignal.timeout(5000) }), new Writable({
    write(chunk, encoding, callback) {
      bytes += chunk.length;
      if (bytes > MAX_PROFILE_BYTES) return callback(new Error('profile_limit'));
      chunks.push(chunk);
      callback();
    },
  }));
  const raw = Buffer.concat(chunks);
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--profile' || args[1].startsWith('--'))) {
    throw new Error('invalid_arguments');
  }
  const profile = args.length === 0 ? {} : await readProfile(args[1]);
  const plan = await prepareThinProbePlan(profile);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.exitCode = { PREFLIGHT_VALID: 0, BLOCKED: 1, REJECTED: 2 }[plan.preflightStatus];
} catch {
  console.error('thin_probe_plan_input_or_contract_invalid');
  process.exitCode = 2;
}
