import postgres from 'postgres';
import { createSecureContext } from 'node:tls';
import { createApp } from './index.ts';
import { initializeDatabase } from '../../packages/database/index.ts';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export async function startProduct({ databaseUrl, actors, repositories, port = 4317, host = '127.0.0.1', tls, discoveryRuntime, discoveryTimeoutMs }: any, emitLifecycle: (event: any) => void = () => {}) {
  if (tls) createSecureContext({ ...tls, minVersion: 'TLSv1.2' });
  const sql = postgres(databaseUrl, { max: 5, connect_timeout: 5, onnotice: () => {} });
  let stage = 'metadata';
  try {
    await initializeDatabase(sql);
    const app = createApp({ sql, actors, repositories, discoveryRuntime, discoveryTimeoutMs, https: tls ? { ...tls, minVersion: 'TLSv1.2' } : undefined });
    const web = resolve('dist/web');
    const files = new Map([
      ['/', ['index.html', 'text/html; charset=utf-8']],
      ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
      ['/app.js.LEGAL.txt', ['app.js.LEGAL.txt', 'text/plain; charset=utf-8']],
      ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
      ['/third-party-notices.txt', ['third-party-notices.txt', 'text/plain; charset=utf-8']],
    ]);
    let assets;
    stage = 'web_assets';
    assets = await Promise.all([...files].map(async ([route, [filename, contentType]]) =>
      ({ route, contentType, bytes: await readFile(resolve(web, filename)) })));
    for (const { route, contentType, bytes } of assets) {
      app.get(route, (_request, reply) => {
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        reply.header('Cache-Control', 'no-store');
        reply.type(contentType);
        return bytes;
      });
    }
    app.addHook('onClose', async () => { await sql.end({ timeout: 5 }); });
    stage = 'listen';
    await app.listen({ host, port });
    return app;
  } catch (error) {
    const code = stage === 'metadata' ? 'metadata_unavailable'
      : stage === 'web_assets' ? 'web_assets_unavailable' : 'listen_unavailable';
    emitLifecycle({ event: 'startup', state: 'failed', code });
    try { await sql.end({ timeout: 2 }); } catch { /* retain the original startup error */ }
    throw error;
  }
}
