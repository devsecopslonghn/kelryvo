const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export const reviewInboxScopes = Object.freeze(['ALL', 'MINE', 'ELIGIBLE']);

export function decodeReviewInboxCursor(value, actorId, scope) {
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value) return null;
    const source = bytes.toString('utf8');
    if (!Buffer.from(source, 'utf8').equals(bytes)) return null;
    const parsed = JSON.parse(source);
    if (!parsed || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'actor,createdAt,id,scope,v') return null;
    if (parsed.v !== 1 || parsed.actor !== actorId || parsed.scope !== scope
        || typeof parsed.actor !== 'string' || parsed.actor.length > 200 || JSON.stringify({ v: parsed.v, actor: parsed.actor, scope: parsed.scope, createdAt: parsed.createdAt, id: parsed.id }) !== source
        || typeof parsed.createdAt !== 'string' || !timestamp.test(parsed.createdAt)
        || !validCursorTime(parsed.createdAt) || typeof parsed.id !== 'string' || !uuid.test(parsed.id) || parsed.id !== parsed.id.toLowerCase()) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch { return null; }
}

function validCursorTime(value) {
  if (Number(value.slice(0, 4)) < 1) return false;
  const millis = value.slice(0, 23) + 'Z';
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 19) === value.slice(0, 19);
}

export function encodeReviewInboxCursor({ actor, scope, createdAt, id }) {
  if (!uuid.test(id) || id !== id.toLowerCase() || !timestamp.test(createdAt) || !validCursorTime(createdAt)
      || !reviewInboxScopes.includes(scope) || typeof actor !== 'string' || actor.length < 1 || actor.length > 200) throw new TypeError('invalid review inbox cursor position');
  return Buffer.from(JSON.stringify({ v: 1, actor, scope, createdAt, id })).toString('base64url');
}
