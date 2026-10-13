const CODES = new Set([
  'configuration_unavailable',
  'metadata_unavailable',
  'web_assets_unavailable',
  'listen_unavailable',
  'startup_unavailable',
  'shutdown_unavailable',
]);

/** Write a secret-free lifecycle record. Callers may only provide fixed event values. */
export function writeRuntimeEvent({ event, state, code } = {}) {
  const allowed = event === 'startup'
    ? ['started', 'ready', 'failed']
    : event === 'shutdown' ? ['started', 'complete', 'failed', 'timeout'] : [];
  if (!allowed.includes(state)) throw new TypeError('Invalid runtime lifecycle event');
  const record = { event, state };
  if (code !== undefined) {
    if (!CODES.has(code)) throw new TypeError('Invalid runtime lifecycle code');
    record.code = code;
  }
  process.stderr.write(`${JSON.stringify(record)}\n`);
}
