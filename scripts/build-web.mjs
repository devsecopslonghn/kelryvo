import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist/web', { recursive: true });
await build({ entryPoints: ['apps/web/src/app.jsx'], outfile: 'dist/web/app.js', bundle: true,
  minify: true, platform: 'browser', format: 'esm', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'linked' });
await copyFile('apps/web/index.html', 'dist/web/index.html');
await copyFile('apps/web/styles.css', 'dist/web/styles.css');
await copyFile('docs/dependencies/product-NOTICES.txt', 'dist/web/third-party-notices.txt');
console.log('Web application built in dist/web.');
