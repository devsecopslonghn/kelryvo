/** Match exact references to retained observations; never infer absence or SQL validity. */
export function catalogContext(statements, exactOwner, snapshot, expectedIdentityDigest = null) {
  const identityMismatch = snapshot && expectedIdentityDigest && snapshot.identityDigest !== expectedIdentityDigest;
  const objects = new Map();
  for (const object of snapshot?.objects ?? []) {
    if (identityMismatch || object.owner !== exactOwner || object.type === 'DEPENDENCY') continue;
    const matches = objects.get(object.name) ?? [];
    matches.push({type:object.type,checksum:object.checksum});
    objects.set(object.name,matches);
  }
  return statements.map(statement => ({...statement, catalogReferences:statement.references.map(reference => {
    // The bounded reviewer records links at statement level. It cannot prove
    // which individual reference is local, so withhold all matches in that statement.
    const linked = statement.findings.some(finding => finding.code === 'DATABASE_LINK_REFERENCE');
    const matches = !linked && reference.owner === exactOwner ? objects.get(reference.name) ?? [] : [];
    return {...reference, snapshotId:snapshot?.id ?? null,
      state:reference.owner !== exactOwner ? 'OUT_OF_SCOPE' : linked ? 'LINK_SCOPE_UNVERIFIED' : identityMismatch ? 'IDENTITY_MISMATCH' : matches.length ? 'OBSERVED' : 'UNKNOWN',
      matches};
  })}));
}
