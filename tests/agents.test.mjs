import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const reader = `
import json, pathlib, tomllib
root = pathlib.Path('.codex')
print(json.dumps({
  'config': tomllib.loads((root / 'config.toml').read_text()),
  'agents': {p.stem: tomllib.loads(p.read_text()) for p in (root / 'agents').glob('*.toml')}
}))
`;

test('native specialist TOML parses with standard-library TOML and keeps parent settings', () => {
  let parsed;
  for (const interpreter of ['python3.11', 'python3']) {
    const run = spawnSync(interpreter, ['-c', reader], { cwd: root, encoding: 'utf8' });
    if (run.status === 0) { parsed = JSON.parse(run.stdout); break; }
  }
  assert.ok(parsed, 'Python 3.11+ with tomllib is required to validate native TOML');
  assert.deepEqual(parsed.config, {
    agents: { enabled: true, max_concurrent_threads_per_session: 3 },
  });
  const expected = ['backend', 'database', 'devops', 'frontend', 'qa', 'security'];
  assert.deepEqual(Object.keys(parsed.agents).sort(), expected);
  for (const [name, agent] of Object.entries(parsed.agents)) {
    assert.equal(agent.name, name);
    assert.ok(agent.description.length > 10);
    assert.ok(agent.developer_instructions.length > 100);
    assert.ok(!Object.hasOwn(agent, 'model'));
    assert.ok(!Object.hasOwn(agent, 'model_provider'));
    assert.ok(!Object.hasOwn(agent, 'model_reasoning_effort'));
    assert.ok(!Object.hasOwn(agent, 'approval_policy'));
    if (['security', 'qa'].includes(name)) assert.equal(agent.sandbox_mode, 'read-only');
  }
});
