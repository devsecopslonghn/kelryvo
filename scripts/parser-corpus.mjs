import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFixture, runCandidate } from '../experiments/db-devops-wp0/parser-envelope.mjs';
import { PROFILE as ANTLR_PROFILE, runAntlrCandidate } from '../experiments/db-devops-wp0/antlr-envelope.mjs';
import { prevalidateRelease } from '../experiments/db-devops-wp0/parser-release.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--antlr')) {
  console.error('Usage: node scripts/parser-corpus.mjs [--antlr]');
  process.exit(2);
}
const isAntlr = args[0] === '--antlr';
const parserProfile = isAntlr ? ANTLR_PROFILE : 'flyway-oracle-13.9.0@a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c';
const parse = isAntlr ? runAntlrCandidate : runCandidate;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = path.join(root, 'experiments/db-devops-wp0/fixtures');
const manifestBytes = await readFile(path.join(fixturesRoot, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const safeHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function statementsMatch(actual, goldens) {
  return actual.kind === 'PARSE' && actual.statements.length === goldens.length
    && actual.statements.every((statement, index) => {
      const golden = goldens[index];
      return statement.startByte === golden.start_byte && statement.endByte === golden.end_byte
        && statement.sourceSha256 === golden.source_sha256 && statement.executionSha256 === golden.execution_sha256
        && safeHash(statement.sourceSha256) && safeHash(statement.executionSha256);
    });
}

async function observeFile(group, variant, file) {
  const prefix = `${group.fixture_id}/${variant.id}`;
  let raw;
  try { raw = await readFixture(fixturesRoot, file.path); }
  catch { return { blocker: `${prefix}:fixture_unavailable` }; }
  if (raw.length !== file.bytes || sha(raw) !== file.sha256) return { blocker: `${prefix}:fixture_digest_mismatch` };
  const actual = await parse(raw);
  const releaseFile = { id: file.path, raw, sha256: file.sha256 };
  if (!actual.ok) return { releaseFile, actual, blocker: `${prefix}:${actual.code}`,
    observation: { path: file.path, status: 'ENVELOPE_REJECTED', code: actual.code } };
  const goldens = file.statements ?? [];
  const expected = goldens.length > 0 ? 'PARSE' : variant.expected;
  const goldenMatch = expected === 'PARSE' ? statementsMatch(actual, goldens) : actual.kind === 'STOP';
  return { releaseFile, actual, blocker: goldenMatch ? null : `${prefix}:compatibility_mismatch`,
    observation: { path: file.path, rawSha256: sha(raw), bytes: raw.length,
      status: actual.kind, statementCount: actual.statementCount, goldenMatch } };
}

async function observeVariant(group, variant) {
  // Files in the immutable offline corpus are independent. Promise.all preserves manifest order.
  const files = await Promise.all(variant.files.map(file => observeFile(group, variant, file)));
  const releaseFiles = files.filter(file => file.releaseFile).map(file => file.releaseFile);
  const validated = new Map(files.filter(file => file.releaseFile).map(file => [file.releaseFile.sha256, file.actual]));
  const fileObservations = files.filter(file => file.observation).map(file => file.observation);
  const blockers = files.filter(file => file.blocker).map(file => file.blocker);
  // Reuse already envelope-validated results for exact bytes; never run a helper twice.
  const release = await prevalidateRelease(releaseFiles, { profile: parserProfile,
    parse: async raw => validated.get(sha(raw)) });
  const expectedOutcome = variant.expected === 'PARSE' ? 'PARSED_OFFLINE' : 'STOP';
  if (isAntlr && (releaseFiles.length !== variant.files.length || release.outcome !== expectedOutcome)) {
    blockers.push(`${group.fixture_id}/${variant.id}:release_prevalidation_mismatch`);
  }
  let observed = fileObservations.some(file => file.status === 'PARSE') ? 'PARSE' : 'INCOMPLETE';
  if (fileObservations.some(file => file.status === 'STOP')) observed = 'STOP';
  return { blockers, observation: { fixtureId: group.fixture_id, caseId: group.case_id, variantId: variant.id,
    expected: variant.expected, observed, files: fileObservations, wholeVariantPrevalidation: release.outcome,
    allFilesParsed: release.all_files_parsed, executionApproved: release.execution_approved } };
}

const variants = manifest.groups.flatMap(group => group.variants.map(variant => ({ group, variant })));
// Keep fixture variants sequential to bound working-set growth. Within one variant,
// file reads overlap; both parser profiles invoke Java synchronously.
const findings = await variants.reduce(async (previous, { group, variant }) => {
  const accumulated = await previous;
  accumulated.push(await observeVariant(group, variant));
  return accumulated;
}, Promise.resolve([]));
const blockers = findings.flatMap(finding => finding.blockers);
const observations = findings.map(finding => finding.observation);

const result = {
  schema_version: 1,
  scope: 'OFFLINE_PARSER_CORPUS_ONLY',
  fixture_manifest_sha256: sha(manifestBytes),
  parser_profile: parserProfile,
  candidate_profile_accepted: false,
  execution_approved: false,
  production_approved: false,
  observations,
  blockers: [...new Set(blockers)],
};
process.stdout.write(`${JSON.stringify(result)}\n`);
if (blockers.length > 0) process.exitCode = 1;
