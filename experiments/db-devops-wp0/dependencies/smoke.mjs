import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import oracledb from 'oracledb';
import postgres from 'postgres';
import ts from 'typescript';

// Import-only verification: never resolve credentials, construct a database client,
// call initOracleClient(), or connect to any service.
assert.equal(oracledb.versionString, '7.0.1');
assert.equal(oracledb.thin, true);
assert.equal(typeof postgres, 'function');
assert.equal(ts.version, '6.0.2');

const directory = await mkdtemp(join(tmpdir(), 'schemaforge-compiler-'));
try {
  const source = join(directory, 'profile.ts');
  const options = {
    noEmit: true, strict: true, target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    types: [],
  };
  await writeFile(source, 'const mode: "THIN" = "THIN";\nexport { mode };\n');
  const accepted = ts.getPreEmitDiagnostics(ts.createProgram([source], options));
  assert.equal(accepted.length, 0, 'Pinned compiler must accept the positive fixture');
  await writeFile(source, 'const mode: "THIN" = "THICK";\nexport { mode };\n');
  const rejected = ts.getPreEmitDiagnostics(ts.createProgram([source], options));
  assert.ok(rejected.some(diagnostic => diagnostic.code === 2322),
    'Pinned compiler must reject the incompatible fixture');
  console.log(JSON.stringify({
    outcome: 'PASS', oracle_driver: oracledb.versionString, thin: oracledb.thin,
    postgres_client_import: 'PASS', compiler: ts.version,
    compiler_positive: 'PASS', compiler_negative: 'PASS',
    database_calls: 0, scope: 'OFFLINE_DEPENDENCY_SMOKE_ONLY',
  }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
