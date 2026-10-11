import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

const productName = process.env.SCHEMAFORGE_PRODUCT_NAME ?? 'SchemaForge';
if (!['SchemaForge', 'Kelryvo'].includes(productName)) throw new Error('Invalid product name');

await mkdir('dist/web', { recursive: true });
await build({ entryPoints: ['apps/web/src/app.jsx'], outfile: 'dist/web/app.js', bundle: true,
  minify: true, platform: 'browser', format: 'esm', target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"', 'process.env.SCHEMAFORGE_PRODUCT_NAME': JSON.stringify(productName) }, legalComments: 'linked' });
await writeFile('dist/web/index.html', (await readFile('apps/web/index.html', 'utf8')).replaceAll('SchemaForge', productName));
await copyFile('apps/web/styles.css', 'dist/web/styles.css');
await copyFile('docs/dependencies/product-NOTICES.txt', 'dist/web/third-party-notices.txt');
console.log('Web application built in dist/web.');
