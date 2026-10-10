// Audit cursors are canonical, bounded query positions. They never grant access.
const MAX_CURSOR_LENGTH = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACTION = /^[A-Z][A-Z0-9_]{0,63}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeAuditCursor({ projectId, action, createdAt, id }) {
  const value = { v: 1, p: projectId, a: action ?? null, t: createdAt, i: id };
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeAuditCursor(cursor, projectId, action) {
  if (typeof cursor !== 'string' || cursor.length < 1 || cursor.length > MAX_CURSOR_LENGTH
      || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== cursor) return null;
    const value = JSON.parse(decoded);
    if (!value || Array.isArray(value) || JSON.stringify(value) !== decoded
        || Object.keys(value).join(',') !== 'v,p,a,t,i'
        || value.v !== 1 || value.p !== projectId || value.a !== action
        || value.a !== null && (typeof value.a !== 'string' || !ACTION.test(value.a))
        || typeof value.t !== 'string' || !TIME.test(value.t) || value.t.startsWith('0000-')
        || typeof value.i !== 'string' || !UUID.test(value.i)) return null;
    const [date, clock] = value.t.split('T');
    const parsed = new Date(`${date}T${clock.slice(0, 8)}Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
        || parsed.toISOString().slice(11, 19) !== clock.slice(0, 8)) return null;
    return { createdAt: value.t, id: value.i };
  } catch { return null; }
}

export const AUDIT_PAGE_SIZE = 50;
