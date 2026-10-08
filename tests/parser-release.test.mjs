import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prevalidateRelease, MAX_RELEASE_FILES, MAX_RELEASE_BYTES } from '../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_INPUT_BYTES, PROFILE } from '../experiments/db-devops-wp0/parser-envelope.mjs';

const file = (id, text) => {
  const raw = Buffer.from(text);
  return { id, raw, sha256: createHash('sha256').update(raw).digest('hex') };
};
const parsed = { ok: true, kind: 'PARSE', profile: PROFILE, statementCount: 1 };

test('release parse failure in a later file returns no executable or partially approved release', async () => {
  let calls = 0;
  const result = await prevalidateRelease([file('V001.sql', 'SELECT 1 FROM dual;'), file('V002.sql', 'BEGIN NULL;')], {
    parse: async () => ++calls === 1 ? parsed : { ok: true, kind: 'STOP', profile: PROFILE, statementCount: 0 },
  });
  assert.equal(calls, 2);
  assert.equal(result.outcome, 'STOP');
  assert.equal(result.all_files_parsed, false);
  assert.equal(result.execution_approved, false);
  assert.equal(result.production_approved, false);
  assert.deepEqual(result.observations.map(row => row.status), ['PARSE', 'STOP']);
  assert.equal(JSON.stringify(result).includes('SELECT'), false);
});

test('all release bytes and digests are snapshotted before parser calls', async () => {
  const files = [file('V001.sql', 'SELECT 1 FROM dual;'), file('V002.sql', 'SELECT 2 FROM dual;')];
  const second = Buffer.from(files[1].raw);
  const inputs = [];
  const result = await prevalidateRelease(files, { parse: async raw => {
    inputs.push(Buffer.from(raw));
    files[1].raw.fill(0); // A caller cannot change a later file during prevalidation.
    raw.fill(0); // The adapter cannot change our retained source snapshot either.
    return parsed;
  } });
  assert.deepEqual(inputs[1], second);
  assert.equal(result.outcome, 'PARSED_OFFLINE');
  assert.equal(result.all_files_parsed, true);
  assert.equal(result.execution_approved, false);
});

test('bad, duplicate, traversing or oversized release inputs stop before parser invocation', async () => {
  let calls = 0;
  const options = { parse: async () => { calls++; return parsed; } };
  const valid = file('V001.sql', 'SELECT 1 FROM dual;');
  const invalids = [[], Array(MAX_RELEASE_FILES + 1).fill(valid), [valid, valid],
    [file('../V001.sql', 'SELECT 1;')], [file('private\nlabel', 'SELECT 1;')], [file('V001.sql', '')],
    [{ ...valid, sha256: '0'.repeat(64) }], [{ ...valid, raw: Buffer.alloc(MAX_INPUT_BYTES + 1) }],
    Array.from({ length: MAX_RELEASE_BYTES / MAX_INPUT_BYTES + 1 }, (_, i) => file(`V${i}.sql`, Buffer.alloc(MAX_INPUT_BYTES)))];
  for (const files of invalids) assert.equal((await prevalidateRelease(files, options)).outcome, 'STOP');
  assert.equal(calls, 0);
});

test('parser throws, wrong profile, empty parses and envelope failures all stop safely', async () => {
  const canary = 'PRIVATE_SQL_ERROR_CANARY';
  const options = [async () => { throw new Error(canary); }, async () => ({ ...parsed, profile: 'unreviewed' }),
    async () => ({ ...parsed, statementCount: 0 }), async () => ({ ok: false, code: canary })];
  for (const parse of options) {
    const result = await prevalidateRelease([file('V001.sql', 'SELECT 1 FROM dual;')], { parse });
    assert.equal(result.outcome, 'STOP');
    assert.equal(JSON.stringify(result).includes(canary), false);
  }
});
