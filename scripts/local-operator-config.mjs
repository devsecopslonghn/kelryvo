import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

const fail = () => new Error('Local operator operation failed; inspect private local state and retry.');
const uid = () => process.geteuid?.() ?? process.getuid();

export async function readPrivateLocalConfig(file) {
  const config = path.resolve(file);
  const directory = path.dirname(config);
  let cursor = path.parse(config).root;
  for (const component of config.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw fail();
    } catch (error) {
      if (error.code !== 'ENOENT') throw fail();
    }
  }

  const dir = await lstat(directory);
  if (!dir.isDirectory() || dir.uid !== uid() || (dir.mode & 0o777) !== 0o700) throw fail();
  const handle = await open(config, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.uid !== uid() || stat.nlink !== 1
        || stat.size > 16_384 || (stat.mode & 0o777) !== 0o600) throw fail();
    const value = JSON.parse((await handle.readFile()).toString('utf8'));
    if (!value || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== 'approverToken,databasePassword,developerToken'
        || Object.values(value).some(item => typeof item !== 'string' || !/^[a-f0-9]{64}$/.test(item))
        || value.developerToken === value.approverToken) throw fail();
    return value;
  } finally {
    await handle.close();
  }
}

export async function authorizeLocalMetadataUrl(configPath, url) {
  if (!url || !configPath) throw fail();
  const config = await readPrivateLocalConfig(configPath);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw fail();
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const allowedDatabase = databaseName === 'schemaforge'
    || databaseName === 'schemaforge_tests'
    || /^sf_product_test_[a-f0-9]{32}$/.test(databaseName);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
      || !['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname.toLowerCase())
      || parsed.search || parsed.hash || !parsed.password
      || decodeURIComponent(parsed.password) !== config.databasePassword
      || !['postgres', 'schemaforge'].includes(decodeURIComponent(parsed.username))
      || !allowedDatabase) throw fail();
  return config;
}
