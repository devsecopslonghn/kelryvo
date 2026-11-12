// Load the verified platform archive without converting its manifest or config.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const daemon = ['--host', 'unix:///var/run/docker.sock'];
function docker(args) {
  const result = spawnSync('/usr/bin/docker', [...daemon, ...args], {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('Exact OCI loading requires the local Docker containerd image store');
  return result.stdout;
}

export function loadOCIPlatform(archive, sha, architecture, { run = docker } = {}) {
  const source = resolve(archive);
  // Complete archive/source verification must precede any daemon mutation.
  const checked=spawnSync(process.env.KELRYVO_RUST_CLI??resolve('target/debug/kelryvo'),['oci','verify-platform',source,sha,architecture],{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024});
  assert.ifError(checked.error);assert.equal(checked.status,0,'Native OCI verification failed before image load');
  const expected=JSON.parse(checked.stdout);
  assert.equal(expected.config.rootfs?.type, 'layers');
  assert.equal(expected.config.rootfs.diff_ids.length, expected.manifest.layers.length);
  run(['image', 'load', '--input', source]);
  function inspect(reference) {
    const [actual] = JSON.parse(run(['image', 'inspect', reference]));
    const descriptor = actual.Descriptor?.digest ?? actual.Id;
    assert.equal(descriptor, expected.descriptor.digest, 'Docker changed the tested OCI manifest');
    assert([expected.descriptor.digest, expected.configDigest].includes(actual.Id), 'Docker changed the tested OCI config');
    assert.equal(actual.Architecture, architecture);
    assert.equal(actual.Os, 'linux');
    assert.deepEqual(actual.RootFS.Layers, expected.config.rootfs.diff_ids);
    for (const field of ['Labels', 'Entrypoint', 'User', 'Env']) {
      assert.deepEqual(actual.Config[field], expected.config.config[field], 'Docker changed the verified OCI role configuration');
    }
    assert.deepEqual(actual.Config.Cmd ?? [], expected.config.config.Cmd ?? [], 'Docker changed the verified OCI command');
  }
  inspect(expected.descriptor.digest);
  run(['image', 'tag', expected.descriptor.digest, 'kelryvo-app:test']);
  inspect('kelryvo-app:test');
  return { architecture, manifestDigest: expected.descriptor.digest, configDigest: expected.configDigest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 3) throw new Error('Usage: node scripts/load-oci-platform.mjs ARCHIVE SOURCE_SHA ARCHITECTURE');
    console.log(JSON.stringify(loadOCIPlatform(...args)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
