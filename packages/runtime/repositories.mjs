import path from 'node:path';
import { resolveLocalRepositories } from '../../scripts/local-repositories.mjs';

// Operator-owned configuration only. The API receives read-only local checkouts,
// never remote credentials, clone commands or arbitrary application-selected paths.
export async function containerRepositories(manifest, mountRoot = '/run/kelryvo/repositories') {
  const reject = () => new Error('Container repository configuration unavailable');
  if (!manifest || Array.isArray(manifest) || Object.keys(manifest).sort().join(',') !== 'format,paths'
      || manifest.format !== 1 || !Array.isArray(manifest.paths) || manifest.paths.length > 8
      || manifest.paths.some(value => typeof value !== 'string' || !path.isAbsolute(value)
        || !value.startsWith(`${mountRoot}/`) || value.split('/').includes('..'))) throw reject();
  try {
    const repositories = await resolveLocalRepositories(manifest.paths);
    if (repositories.some(repository => !repository.path.startsWith(`${mountRoot}/`))) throw reject();
    return repositories;
  } catch { throw reject(); }
}
