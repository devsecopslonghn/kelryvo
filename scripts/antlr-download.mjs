import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';

const transientStatuses = new Set([408, 429, 500, 502, 503, 504]);

// The caller validates the pinned origin, digest and destination parents first.
// Never install a partial response or retry an integrity/local filesystem failure.
export async function downloadArtifact(url, target, digest, { fetchArtifact = fetch, wait = delay } = {}) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('invalid_digest');
  const deadline = Date.now() + 180_000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const temporary = `${target}.${randomUUID()}.download`;
    let retryable = false;
    let retryAfter = 0;
    try {
      const signal = AbortSignal.timeout(Math.max(1, deadline - Date.now()));
      let response;
      try { response = await fetchArtifact(url, { signal }); }
      catch { retryable = true; throw new Error('artifact_download_network_failed'); }
      if (!response.ok || !response.body) {
        retryable = transientStatuses.has(response.status);
        const header = response.headers.get('retry-after');
        retryAfter = header && /^\d+$/.test(header) ? Number(header) * 1000
          : header ? Math.max(0, Date.parse(header) - Date.now()) || 0 : 0;
        await response.body?.cancel();
        throw new Error(`artifact_download_http_${response.status}`);
      }
      const hash = createHash('sha256');
      let bytes = 0;
      const bounded = new Transform({ transform(chunk, encoding, callback) {
        bytes += chunk.length;
        if (bytes > 300 * 1024 * 1024) return callback(new Error('artifact_download_limit'));
        hash.update(chunk);
        callback(null, chunk);
      } });
      // Stream failures from the remote peer can be retried; disk/limit errors cannot.
      try {
        await pipeline(response.body, bounded, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
      } catch (error) {
        retryable = error instanceof TypeError || ['ECONNRESET', 'ETIMEDOUT', 'UND_ERR_SOCKET'].includes(error.code);
        throw new Error(error.message === 'artifact_download_limit' ? error.message : 'artifact_download_stream_failed');
      }
      if (hash.digest('hex') !== digest) throw new Error('artifact_digest_mismatch');
      await rename(temporary, target);
      return;
    } catch (error) {
      // A server-provided delay must not be shortened into another early retry.
      const pause = Math.max(Math.min(10_000, 1000 * 2 ** attempt), retryAfter);
      if (!retryable || attempt === 3 || Date.now() + pause >= deadline) throw error;
      await wait(pause);
    } finally { await rm(temporary, { force: true }); }
  }
}
