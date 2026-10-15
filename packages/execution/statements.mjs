import { assessOracleSchemaScope } from './schema-scope.mjs';
import { createHash } from 'node:crypto';
import { verifyOfflinePlanIntent, MAX_PLAN_STATEMENTS } from '../migrations/offline-plan-intent.mjs';
import { verifyRetainedRelease } from '../migrations/verify-retained-release.mjs';
import { ANTLR_PROFILE, MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';
import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { runAntlrExecutionCandidate } from '../../experiments/db-devops-wp0/antlr-envelope.mjs';
import { approvedMigrationIdentities } from './pending-migrations.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Materialize only the exact reviewed statement sequence. No target authority.
 * Both source ranges and delimiter-free execution bytes come from the pinned
 * helper's validated protocol, never from a second splitter or SQL rewriting.
 */
export async function materializeApprovedStatements(release, envelope, digest, expected, runParser = runAntlrExecutionCandidate) {
  try {
    if (!release || release.validation_status !== 'VALID' || release.parser_profile !== ANTLR_PROFILE
        || !Array.isArray(release.files) || release.files.length > MAX_RELEASE_FILES
        || Buffer.byteLength(JSON.stringify(release.files)) > 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024
        || !verifyRetainedRelease(release)) return null;
    // Copy before any await; a caller cannot change the approved source mid-read.
    const snapshot = { ...release, files: release.files.map(file => ({ ...file })) };
    const intent = verifyOfflinePlanIntent(envelope, digest, { ...expected,
      releaseId: snapshot.id, commit: snapshot.commit_id, objectFormat: snapshot.object_format,
      folder: snapshot.folder, parserProfile: snapshot.parser_profile, manifestDigest: snapshot.manifest_digest,
      items: snapshot.files.map(({ path, version, sha256 }) => ({ path, version, sha256 })) });
    if (!intent || ![2,3,4].includes(intent.format)) return null;
    const statements = [], identities = [];
    for (const file of snapshot.files) {
      const parsed = await runParser(Buffer.from(file.content, 'utf8'));
      if (!parsed?.ok || parsed.kind !== 'PARSE' || parsed.profile !== ANTLR_PROFILE
          || !Array.isArray(parsed.statements) || parsed.statementCount !== parsed.statements.length
          || parsed.statementCount !== file.statementCount || statements.length + parsed.statementCount > MAX_PLAN_STATEMENTS) return null;
      for (const [index, statement] of parsed.statements.entries()) {
        if (!(statement.executionBytes instanceof Uint8Array) || !statement.executionBytes.length
            || hash(statement.executionBytes) !== statement.executionSha256) return null;
        const owner=intent.target?.exactOwner ?? intent.username;
        if (!assessOracleSchemaScope(new TextDecoder('utf-8',{fatal:true}).decode(statement.executionBytes),owner).eligible) return null;
        identities.push({ ordinal: identities.length + 1, path: file.path, fileOrdinal: index + 1,
          startByte: statement.startByte, endByte: statement.endByte,
          sourceSha256: statement.sourceSha256, executionSha256: statement.executionSha256 });
        statements.push(Object.freeze({ digest: statement.executionSha256, bytes: Uint8Array.from(statement.executionBytes) }));
      }
    }
    if (JSON.stringify(identities) !== JSON.stringify(intent.statements)) return null;
    return { intent, statements: Object.freeze(statements), statementManifestDigest: hash(JSON.stringify(identities)),
      migrations: approvedMigrationIdentities(intent) };
  } catch { return null; }
}
