import { createHash } from 'node:crypto';
import { physicalOracleTargetKey } from '../connectivity/instance-identity.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Rebuild only the exact persisted target-binding shapes from immutable evidence. */
export function expectedTargetBindingDigests(intent, evidence) {
  const hasSource = evidence.source_connection_id !== null && evidence.source_connection_id !== undefined;
  const mode = evidence.credential_mode;
  if (hasSource && mode !== 'INSTANCE_MASTER') return [];
  if (!hasSource && mode !== null && mode !== undefined) return [];

  const physicalTargetKey = physicalOracleTargetKey(evidence.identity);
  if (hasSource && !physicalTargetKey) return [];
  const fields = {
    expectedIdentityDigest:evidence.identity_digest,
    evidenceProvenance:evidence.provenance,
    liveVerificationAccepted:Boolean(evidence.verification_acceptance),
  };
  if (hasSource) {
    // The pre-canonical-key master format bound credential mode; current format
    // also binds the derived physical key. Both are reconstructable exactly.
    return [
      digest({ ...intent.target, credentialMode:mode, ...fields }),
      digest({ ...intent.target, credentialMode:mode, physicalTargetKey, ...fields }),
    ];
  }

  // Legacy proofs predate physical keys. Current legacy-mode executions retain
  // that exact target identity and add the canonical physical-container key.
  return physicalTargetKey
    ? [digest({ ...intent.target, ...fields }), digest({ ...intent.target, physicalTargetKey, ...fields })]
    : [digest({ ...intent.target, ...fields })];
}
