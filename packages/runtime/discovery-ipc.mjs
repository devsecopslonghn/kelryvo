import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { normalizeObservation } from '../connectivity/evidence.mjs';
import { normalizeSchema } from '../schema-baselines/contracts.mjs';

const VERSION = 1;
const REQUEST_LIMIT = 16 * 1024;
const RESPONSE_LIMIT = 2 * 1024 * 1024;
const OPERATIONS = new Set(['TEST', 'DISCOVER', 'SCHEMA']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const clean = (value, maxBytes) => typeof value === 'string' && value.length > 0
  && Buffer.byteLength(value, 'utf8') <= maxBytes && !/[\u0000-\u001f\u007f]/.test(value);
const unavailable = status => ({
  status: status ?? 'UNAVAILABLE', identity: null, schemas: [], limitations: status === 'TIMEOUT' ? [] : ['RUNTIME_UNAVAILABLE'],
  provenance: 'UNAVAILABLE', verificationAcceptance: null,
});
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value, keys) => isRecord(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

function validConnection(value) {
  const allowed = ['id', 'engine', 'host', 'port', 'service', 'transport', 'username', 'credentialRef', 'credentialMode'];
  if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))
      || !['id', 'engine', 'host', 'port', 'service', 'transport', 'username'].every(key => Object.hasOwn(value, key))) return null;
  if (!UUID.test(value.id) || value.engine !== 'oracle' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
      || !clean(value.host, 253) || !(net.isIP(value.host) > 0 || validHostname(value.host))
      || !clean(value.service, 128) || !/^[A-Za-z0-9_$#.-]+$/.test(value.service)
      || !['TCP', 'TCPS'].includes(value.transport) || !clean(value.username, 128)) return null;
  if (Object.hasOwn(value, 'credentialRef') && value.credentialRef !== null
      && (!clean(value.credentialRef, 512) || !/^(?:vault|secret):\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(value.credentialRef))) return null;
  if (Object.hasOwn(value, 'credentialMode') && !['INSTANCE_MASTER', 'LEGACY_SEPARATE'].includes(value.credentialMode)) return null;
  const connection = Object.fromEntries(allowed.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
  return connection;
}

function validHostname(host) {
  return host.length <= 253 && /^[a-z0-9.-]+$/i.test(host) && !host.includes('..')
    && host.split('.').every(label => label.length > 0 && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function safeResult(raw, operation, owner) {
  try {
    if (!isRecord(raw)) return unavailable();
    const result = normalizeObservation(raw, operation === 'SCHEMA' ? 'DISCOVER' : operation);
    if (operation === 'SCHEMA') {
      if (!clean(owner, 128)) return unavailable();
      result.schema = normalizeSchema(raw.schema, owner);
    }
    return result;
  } catch {
    return unavailable();
  }
}

function sendFrame(socket, message, limit) {
  try {
    const frame = Buffer.from(`${JSON.stringify(message)}\n`, 'utf8');
    if (frame.length > limit) return false;
    socket.write(frame);
    return true;
  } catch { return false; }
}

function validLimit(value, fallback, maximum) {
  return value === undefined ? fallback : Number.isInteger(value) && value > 0 && value <= maximum ? value : null;
}

/** Client for the private discovery socket inherited by the API process. */
export function createDiscoveryClient(socket, { timeoutMs = 10_000, maxPending = 2, requestLimit = REQUEST_LIMIT, responseLimit = RESPONSE_LIMIT } = {}) {
  const limit = validLimit(maxPending, 2, 32);
  const requestBytes = validLimit(requestLimit, REQUEST_LIMIT, REQUEST_LIMIT);
  const responseBytes = validLimit(responseLimit, RESPONSE_LIMIT, RESPONSE_LIMIT);
  if (!(socket instanceof net.Socket) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000
      || !limit || !requestBytes || !responseBytes) throw new TypeError('Invalid discovery IPC configuration');
  const pending = new Map();
  let buffer = Buffer.alloc(0), closed = false;

  const finish = (id, result) => {
    const item = pending.get(id);
    if (!item) return;
    pending.delete(id);
    clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.abort);
    item.resolve(result);
  };
  const failAll = () => {
    if (closed) return;
    closed = true;
    for (const id of pending.keys()) finish(id, unavailable());
  };
  const breakChannel = () => {
    failAll();
    socket.destroy();
  };
  const onData = chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > responseBytes && !buffer.includes(0x0a)) return breakChannel();
    while (true) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) {
        if (buffer.length > responseBytes) breakChannel();
        return;
      }
      if (newline + 1 > responseBytes) return breakChannel();
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      let message;
      try { message = JSON.parse(line.toString('utf8')); } catch { return breakChannel(); }
      if (!exactKeys(message, ['version', 'id', 'result']) || message.version !== VERSION || !UUID.test(message.id)
          || !isRecord(message.result)) return breakChannel();
      const item = pending.get(message.id);
      if (item) finish(message.id, safeResult(message.result, item.operation, item.owner));
      // A timed-out or cancelled request can still have a late response. Its ID is ignored.
    }
  };
  socket.on('data', onData);
  socket.on('error', failAll);
  socket.on('close', failAll);

  return {
    run(connection, operation, { signal, owner } = {}) {
      const valid = validConnection(connection);
      if (closed || !valid || !OPERATIONS.has(operation) || operation === 'SCHEMA' && !clean(owner, 128)
          || signal?.aborted || pending.size >= limit) return Promise.resolve(unavailable(signal?.aborted ? 'TIMEOUT' : undefined));
      const request = { version: VERSION, id: randomUUID(), connection: valid, operation,
        ...(operation === 'SCHEMA' ? { owner } : {}) };
      if (!sendFrame(socket, request, requestBytes)) {
        breakChannel();
        return Promise.resolve(unavailable());
      }
      return new Promise(resolve => {
        const item = { resolve, operation, owner, signal, timer: null, abort: null };
        item.abort = () => {
          sendFrame(socket, { version: VERSION, id: request.id, cancel: true }, requestBytes);
          finish(request.id, unavailable('TIMEOUT'));
        };
        item.timer = setTimeout(item.abort, timeoutMs);
        item.timer.unref?.();
        pending.set(request.id, item);
        signal?.addEventListener('abort', item.abort, { once: true });
        if (signal?.aborted) item.abort();
      });
    },
    close() {
      if (!closed) {
        for (const id of pending.keys()) {
          sendFrame(socket, { version: VERSION, id, cancel: true }, requestBytes);
          finish(id, unavailable());
        }
        closed = true;
        socket.destroy();
      }
    },
  };
}

/** Serve fixed, bounded discovery requests on the execution process's private socket. */
export function serveDiscovery(socket, runtime, { maxPending = 2, requestLimit = REQUEST_LIMIT, responseLimit = RESPONSE_LIMIT } = {}) {
  const limit = validLimit(maxPending, 2, 32);
  const requestBytes = validLimit(requestLimit, REQUEST_LIMIT, REQUEST_LIMIT);
  const responseBytes = validLimit(responseLimit, RESPONSE_LIMIT, RESPONSE_LIMIT);
  if (!(socket instanceof net.Socket) || !runtime || typeof runtime.run !== 'function' || !limit || !requestBytes || !responseBytes) {
    throw new TypeError('Invalid discovery IPC configuration');
  }
  const pending = new Map();
  let buffer = Buffer.alloc(0), closed = false;

  const reply = (id, raw, operation, owner) => {
    const result = safeResult(raw, operation, owner);
    if (!sendFrame(socket, { version: VERSION, id, result }, responseBytes)) close();
  };
  const abortAll = () => {
    if (closed) return;
    closed = true;
    for (const item of pending.values()) item.controller.abort();
    pending.clear();
  };
  const close = () => {
    if (!closed) {
      abortAll();
      socket.destroy();
    }
  };
  const onData = chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > requestBytes && !buffer.includes(0x0a)) return close();
    while (!closed) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) {
        if (buffer.length > requestBytes) close();
        return;
      }
      if (newline + 1 > requestBytes) return close();
      const line = buffer.subarray(0, newline);
      buffer = buffer.subarray(newline + 1);
      let message;
      try { message = JSON.parse(line.toString('utf8')); } catch { return close(); }
      if (!isRecord(message) || message.version !== VERSION || !UUID.test(message.id)) return close();
      if (message.cancel === true && exactKeys(message, ['version', 'id', 'cancel'])) {
        pending.get(message.id)?.controller.abort();
        continue;
      }
      if (!exactKeys(message, Object.hasOwn(message, 'owner')
        ? ['version', 'id', 'connection', 'operation', 'owner'] : ['version', 'id', 'connection', 'operation'])) return close();
      const connection = validConnection(message.connection);
      const operation = message.operation;
      const owner = message.owner;
      if (!connection || !OPERATIONS.has(operation) || operation === 'SCHEMA' && !clean(owner, 128)
          || operation !== 'SCHEMA' && Object.hasOwn(message, 'owner')) {
        reply(message.id, unavailable(), 'TEST');
        continue;
      }
      if (pending.has(message.id)) return close();
      if (pending.size >= limit) {
        reply(message.id, unavailable(), operation, owner);
        continue;
      }
      const controller = new AbortController();
      const item = { controller, operation, owner };
      pending.set(message.id, item);
      Promise.resolve().then(() => runtime.run(connection, operation, { signal: controller.signal, ...(owner === undefined ? {} : { owner }) }))
        .then(raw => { if (!closed && pending.get(message.id) === item) reply(message.id, raw, operation, owner); },
          () => { if (!closed && pending.get(message.id) === item) reply(message.id, unavailable(), operation, owner); })
        .finally(() => { if (pending.get(message.id) === item) pending.delete(message.id); });
    }
  };
  socket.on('data', onData);
  socket.on('error', abortAll);
  socket.on('close', abortAll);
  return { close };
}
