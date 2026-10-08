import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFixture, runCandidate } from '../experiments/db-devops-wp0/parser-envelope.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = path.join(root, 'experiments/db-devops-wp0/fixtures');
const manifestBytes = await readFile(path.join(fixturesRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const blockers = [];
const observations = [];

for (const group of manifest.groups) {
  for (const variant of group.variants) {
    const fileObservations = [];
    for (const file of variant.files) {
      let raw;
      try { raw = await readFixture(fixturesRoot, file.path); }
      catch { blockers.push(`${group.fixture_id}/${variant.id}:fixture_unavailable`); continue; }
      if (raw.length !== file.bytes || sha(raw) !== file.sha256) {
        blockers.push(`${group.fixture_id}/${variant.id}:fixture_digest_mismatch`); continue;
      }
      const actual = await runCandidate(raw);
      if (!actual.ok) {
        blockers.push(`${group.fixture_id}/${variant.id}:${actual.code}`);
        fileObservations.push({ path: file.path, status: 'ENVELOPE_REJECTED', code: actual.code });
        continue;
      }
      const goldenStatements = file.statements ?? [];
      const statementsMatch = actual.kind === 'PARSE' && actual.statements.length === goldenStatements.length
        && actual.statements.every((statement, index) => {
          const golden = goldenStatements[index];
          return statement.startByte === golden.start_byte && statement.endByte === golden.end_byte
            && statement.sourceSha256 === golden.source_sha256 && statement.executionSha256 === golden.execution_sha256
            && safeHash(statement.sourceSha256) && safeHash(statement.executionSha256);
        });
      const fileExpected = goldenStatements.length > 0 ? 'PARSE' : variant.expected;
      const goldenMatches = fileExpected === 'PARSE' ? statementsMatch : actual.kind === 'STOP';
      if (!goldenMatches) blockers.push(`${group.fixture_id}/${variant.id}:compatibility_mismatch`);
      fileObservations.push({ path: file.path, rawSha256: sha(raw), bytes: raw.length,
        status: actual.kind, statementCount: actual.statementCount, goldenMatch: goldenMatches });
    }
    // Variant acceptance is all-or-nothing. Even complete parse observations do not approve this candidate.
    observations.push({ fixtureId: group.fixture_id, caseId: group.case_id, variantId: variant.id,
      expected: variant.expected,
      observed: fileObservations.some(file => file.status === 'STOP') ? 'STOP'
        : fileObservations.some(file => file.status === 'PARSE') ? 'PARSE' : 'INCOMPLETE',
      files: fileObservations, wholeVariantPrevalidation: 'STOP_UNAPPROVED_PROFILE' });
  }
}

const result = {
  schema_version: 1,
  scope: 'OFFLINE_PARSER_CORPUS_ONLY',
  fixture_manifest_sha256: sha(manifestBytes),
  parser_profile: 'flyway-oracle-13.9.0@a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c',
  candidate_profile_accepted: false,
  execution_approved: false,
  production_approved: false,
  observations,
  blockers: [...new Set(blockers)],
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (blockers.length > 0) process.exitCode = 1;
