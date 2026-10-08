import test from 'node:test';
import assert from 'node:assert/strict';
import { runAntlrCandidate, PROFILE } from '../experiments/db-devops-wp0/antlr-envelope.mjs';
import { prevalidateRelease } from '../experiments/db-devops-wp0/parser-release.mjs';
import { createHash } from 'node:crypto';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = text => runAntlrCandidate(Buffer.from(text));

test('SQLPlus commands stop at every release position, ordinary SQL comments survive', async () => {
  for (const text of ['REM hi\nSELECT 1 FROM dual;\n', 'SELECT 1 FROM dual;\nREM hi\r\n',
    'REM hi', 'SELECT 1 FROM dual; REM hi\n', 'PROMPT hi\nSELECT 1 FROM dual;\n',
    'SELECT 1 FROM dual;\nHOST dangerous\n']) {
    const result = await parse(text);
    assert.equal(result.ok, true);
    assert.equal(result.kind, 'STOP');
    assert.equal(result.statementCount, 0);
    assert.equal(Object.hasOwn(result, 'statements'), false);
  }
  for (const prefix of ['-- REM hi\n', '/* REM hi */\n', '-- first\n/* second */\n']) {
    const text = `${prefix}SELECT 1 FROM dual;`;
    const result = await parse(text);
    assert.equal(result.kind, 'PARSE');
    assert.equal(result.statements[0].startByte, 0);
    assert.equal(result.statements[0].sourceSha256, sha(Buffer.from(text)));
  }
});

test('source mapping preserves supplementary Unicode and literal LF/CRLF slash delimiters', async () => {
  for (const newline of ['\n', '\r\n']) {
    const execution = `-- café 😀${newline}BEGIN DBMS_OUTPUT.PUT_LINE('😀 / ;'); END;`;
    const text = `${execution}${newline}/`;
    const result = await parse(text);
    assert.equal(result.kind, 'PARSE');
    assert.deepEqual(result.statements, [{ startByte: 0, endByte: Buffer.byteLength(text),
      sourceSha256: sha(Buffer.from(text)), executionSha256: sha(Buffer.from(execution)) }]);
  }
  const first = 'SELECT \'😀\' FROM dual;';
  const second = 'SELECT "😀" FROM dual;';
  const result = await parse(`${first}\r\n${second}`);
  assert.equal(result.kind, 'PARSE');
  assert.equal(result.statementCount, 2);
  assert.equal(result.statements[1].startByte, Buffer.byteLength(first) + 2);
});

test('licensed grammar callbacks handle numeric functions and join prefixes', async () => {
  const result = await parse('SELECT SUM(a.n), COUNT(*) FROM a LEFT JOIN b ON a.id=b.id;');
  assert.equal(result.kind, 'PARSE');
  assert.equal(result.statementCount, 1);
  assert.equal((await parse('SELECT 1 FROM dual; / SELECT 2 FROM dual;')).kind, 'STOP');
});

test('real helper rejects a late release file before returning any complete release', async () => {
  const files = ['CREATE TABLE sf_fixture (id NUMBER);', 'BEGIN NULL;'].map((text, i) => {
    const raw = Buffer.from(text);
    return { id: `V00${i + 1}.sql`, raw, sha256: sha(raw) };
  });
  const result = await prevalidateRelease(files, { parse: runAntlrCandidate, profile: PROFILE });
  assert.equal(result.outcome, 'STOP');
  assert.equal(result.all_files_parsed, false);
  assert.equal(result.execution_approved, false);
  assert.deepEqual(result.observations.map(row => row.status), ['PARSE', 'STOP']);
  assert.equal(JSON.stringify(result).includes('CREATE TABLE'), false);
});
