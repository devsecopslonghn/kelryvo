import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeExecutionJobWindow } from '../apps/web/src/executionJobs.js';

const job = index => ({ id: `job-${index}`, projectId: 'project', planId: 'plan', state: 'WAITING_VALIDATION', revision: 0,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString() });

test('execution job window stays bounded, revision monotonic, and uses API order for timestamp ties', () => {
  let window = mergeExecutionJobWindow([], Array.from({ length: 50 }, (_, index) => job(index)));
  window = mergeExecutionJobWindow(window, Array.from({ length: 50 }, (_, index) => job(index + 50)));
  assert.equal(window.length, 50);
  assert.equal(window[0].id, 'job-50');
  assert.equal(window.at(-1).id, 'job-99');

  const latest = { ...window[0], revision: 1, state: 'VERIFIED_SUCCESS' };
  const stale = { ...latest, revision: 0, state: 'WAITING_VALIDATION' };
  const merged = mergeExecutionJobWindow(mergeExecutionJobWindow(window, null, [latest]), null, [stale]);
  assert.equal(merged[0].state, 'VERIFIED_SUCCESS');

  const sameTime = window[0].createdAt;
  const tiedCurrent = window.map(item => ({ ...item, createdAt: sameTime }));
  const listed = Array.from({ length: 50 }, (_, index) => ({ ...job(index + 100), createdAt: sameTime }));
  assert.deepEqual(mergeExecutionJobWindow(tiedCurrent, listed).map(item => item.id), listed.map(item => item.id));
  assert.deepEqual(mergeExecutionJobWindow(window, []), []);
});
