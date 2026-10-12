// Safe projections preserve private envelope bytes while minimizing browser evidence.
export const credentialAlias = id => `Credential ${id.slice(0, 8)}`;
export function publicTarget(target) {
  if (!target) return null;
  const { privatePrincipalRef, credentialRef, ...safe } = target;
  return safe;
}
export function publicIntent(intent) {
  return intent ? { ...intent, ...(intent.target ? { target: publicTarget(intent.target) } : {}) } : null;
}
