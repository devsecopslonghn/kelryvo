import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANTLR_PROFILE, MAX_INPUT_BYTES, MAX_STDOUT_BYTES, classifySpawnFailure, validateResponse } from './parser-envelope.mjs';

export const PROFILE = ANTLR_PROFILE;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => ({ ok: false, code });

async function checkedArtifact(relativePath, expectedHash) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)
      || !/^[a-f0-9]{64}$/.test(expectedHash ?? '')) throw new Error('invalid_artifact');
  const file = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('invalid_artifact');
  let cursor = ROOT;
  for (const part of relative.split(path.sep)) {
    cursor = path.join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw new Error('artifact_symlink');
  }
  if (!(await lstat(file)).isFile() || sha256(await readFile(file)) !== expectedHash) throw new Error('artifact_digest_mismatch');
  return file;
}

/** Bounded offline helper. Never returns or logs subprocess SQL/stdout/stderr. */
export async function runAntlrCandidate(rawValue) {
  const raw = Buffer.from(rawValue);
  if (raw.length > MAX_INPUT_BYTES) return fail('input_too_large');
  let registry, jar, runtime;
  try {
    registry = JSON.parse(await readFile(path.join(ROOT, 'docs/dependencies/antlr-parser-lock.json')));
    if (registry.profile !== PROFILE || registry.unknown_required_third_party_grants !== 0
        || registry.upstream_headerless_bases_included !== false
        || registry.main_class !== 'local.schemaforge.antlrparser.Main') return fail('unreviewed_parser_inputs');
    jar = await checkedArtifact(registry.helper_path, registry.helper_sha256);
    const runtimePin = registry.artifacts.find(item => item.id === 'runtime');
    runtime = await checkedArtifact(runtimePin.path, runtimePin.sha256);
  } catch { return fail('helper_artifacts_unavailable_or_invalid'); }

  const javaHome = process.env.SCHEMAFORGE_JAVA_HOME ?? path.join(ROOT, '.cache/licenses/runtime/temurin');
  let result;
  try {
    result = spawnSync(path.join(javaHome, 'bin/java'), ['-Xmx256m', '-Xss1m', '-Dfile.encoding=UTF-8',
      '-cp', `${jar}${path.delimiter}${runtime}`, registry.main_class], {
      input: raw, encoding: null, timeout: 5000, maxBuffer: MAX_STDOUT_BYTES, windowsHide: true,
      env: { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8' },
    });
  } catch { return fail('helper_launch_failed'); }
  if (result.error) return fail(classifySpawnFailure(result.error));
  return validateResponse(raw, result.status, result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0), PROFILE);
}
