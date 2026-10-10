import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decodeAuditCursor, encodeAuditCursor } from '../packages/audit/cursor.mjs';

test('audit cursors accept only canonical bounded project and filter positions', () => {
  const projectId = randomUUID();
  const id = randomUUID();
  const createdAt = '2025-03-01T12:34:56.123456Z';
  const cursor = encodeAuditCursor({ projectId, action: 'PLAN_APPROVED', createdAt, id });
  assert.deepEqual(decodeAuditCursor(cursor, projectId, 'PLAN_APPROVED'), { createdAt, id });
  assert.equal(decodeAuditCursor(cursor, randomUUID(), 'PLAN_APPROVED'), null);
  assert.equal(decodeAuditCursor(cursor, projectId, 'PLAN_REJECTED'), null);
  assert.equal(decodeAuditCursor(`${cursor}=`, projectId, 'PLAN_APPROVED'), null);
  assert.equal(decodeAuditCursor('A'.repeat(1025), projectId, 'PLAN_APPROVED'), null);

  for (const value of [
    { v: 1, p: projectId, a: 'PLAN_APPROVED', t: '2025-02-30T12:34:56.123456Z', i: id },
    { v: 1, p: projectId, a: 'PLAN_APPROVED', t: '0000-01-01T00:00:00.000000Z', i: id },
    { v: 1, p: projectId, a: 'PLAN_APPROVED', t: '2025-03-01T25:34:56.123456Z', i: id },
    { v: 1, p: projectId, a: 'PLAN_APPROVED', t: createdAt, i: id, x: 1 },
  ]) assert.equal(decodeAuditCursor(Buffer.from(JSON.stringify(value)).toString('base64url'), projectId, 'PLAN_APPROVED'), null);

  const duplicate = `{"v":1,"p":"${projectId}","a":"PLAN_APPROVED","a":"PLAN_APPROVED","t":"${createdAt}","i":"${id}"}`;
  assert.equal(decodeAuditCursor(Buffer.from(duplicate).toString('base64url'), projectId, 'PLAN_APPROVED'), null);
  const whitespace = ` ${JSON.stringify({ v: 1, p: projectId, a: 'PLAN_APPROVED', t: createdAt, i: id })}`;
  assert.equal(decodeAuditCursor(Buffer.from(whitespace).toString('base64url'), projectId, 'PLAN_APPROVED'), null);
});
