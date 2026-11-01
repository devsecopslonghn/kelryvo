import { copyFile, lstat, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { selectedReleasePath } from '../../scripts/local-release.mjs';

// Production packaging remains committed-source-only. Tests freeze the current
// public source into an isolated fixture commit so uncommitted changes are tested.
export async function prepareReleaseRepository(source, destination) {
  execFileSync('/usr/bin/git', ['clone', '--no-hardlinks', '--quiet', source, destination]);
  const tracked = execFileSync('/usr/bin/git', ['-C', source, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const names = new Set([...tracked.filter(selectedReleasePath), 'CHECKLIST.md']);
  for (const name of names) {
    const target = path.join(destination, name);
    const file = path.join(source, name);
    const info = await lstat(file).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!info) { await rm(target, { force: true }); continue; }
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Release test source must be a regular public file');
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  }
  execFileSync('/usr/bin/git', ['-C', destination, 'add', '--', ...names]);
  execFileSync('/usr/bin/git', ['-C', destination, '-c', 'user.name=Release fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false', 'commit', '--allow-empty', '-m', 'Freeze public source for release tests'], { stdio: 'ignore' });
  return destination;
}
