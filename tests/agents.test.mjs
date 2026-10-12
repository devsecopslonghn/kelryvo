import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

test('repository constraints use AGENTS.md without project-scoped agent overrides', async () => {
  await access(new URL('../AGENTS.md', import.meta.url));
  await assert.rejects(access(new URL('../.codex/config.toml', import.meta.url)), { code: 'ENOENT' });
  await assert.rejects(access(new URL('../.codex/agents/', import.meta.url)), { code: 'ENOENT' });
});
