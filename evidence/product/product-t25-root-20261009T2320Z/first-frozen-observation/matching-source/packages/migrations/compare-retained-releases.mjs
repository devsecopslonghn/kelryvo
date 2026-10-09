/** Compare two already verified retained manifests without consulting Git or a parser. */
export function compareRetainedReleases(base, candidate) {
  const left = new Map(base.files.map((file) => [file.version, file]));
  const right = new Map(candidate.files.map((file) => [file.version, file]));
  const versions = [...new Set([...left.keys(), ...right.keys()])].sort(compareVersions);
  return versions.map((version) => {
    const before = left.get(version) ?? null;
    const after = right.get(version) ?? null;
    const change = !before ? 'ADDED' : !after ? 'REMOVED'
      : before.path !== after.path || before.sha256 !== after.sha256 || before.bytes !== after.bytes || before.content !== after.content
        ? 'CHANGED' : 'UNCHANGED';
    return { version, change,
      base: before && { path: before.path, sha256: before.sha256, bytes: before.bytes, content: before.content },
      candidate: after && { path: after.path, sha256: after.sha256, bytes: after.bytes, content: after.content } };
  });
}

export function compareVersions(left, right) {
  const a = left.split('.');
  const b = right.split('.');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? '0'; const y = b[i] ?? '0';
    if (x.length !== y.length) return x.length - y.length;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
