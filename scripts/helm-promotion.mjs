import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi, HELM_REPOSITORY, isDigest, isSha, requirePublication } from './container-publication-gate.mjs';
import { IMAGES, registryReader, verifyImage, command, imageRepository, imageTag } from './container-delivery.mjs';

// Preserve every byte except the two digest scalars; reject unfamiliar layouts.
export function updateValues(source, digests) {
  if (IMAGES.some(image => !isDigest(digests[image]))) throw new Error('Both verified SHA-256 image digests are required');
  let section, imageBlock = false;
  const seen = new Set();
  const output = source.split('\n').map(line => {
    if (/^\S/.test(line) && !line.startsWith('#')) { section = line.match(/^(app|worker):\s*$/)?.[1]; imageBlock = false; }
    if (/^  \S/.test(line)) imageBlock = line === '  image:';
    if (section && imageBlock && /^    digest:/.test(line)) {
      if (seen.has(section) || !/^    digest: sha256:[a-f0-9]{64}$/.test(line)) throw new Error('Unsupported chart digest layout');
      seen.add(section);
      return `    digest: ${digests[section]}`;
    }
    return line;
  }).join('\n');
  if (seen.size !== 2) throw new Error('Chart must contain exactly app.image.digest and worker.image.digest');
  return output;
}

export async function previousPromotion(api, base) {
  const commits = await api(`commits?sha=${base}&path=values.yaml&per_page=100`);
  for (const commit of commits) {
    const lines = commit.commit.message.split('\n').filter(line => line.startsWith('Kelryvo-Source-SHA:'));
    if (!lines.length) continue;
    if (lines.length !== 1 || !/^Kelryvo-Source-SHA: [a-f0-9]{40}$/.test(lines[0])) throw new Error('Invalid Helm source provenance');
    return lines[0].slice('Kelryvo-Source-SHA: '.length);
  }
  if (commits.length === 100) throw new Error('Helm promotion provenance is outside the inspected history');
  return undefined;
}

export async function promoteHelm({ api, sourceApi, sha, digests, directory, validate, gate }) {
  if (!isSha(sha) || IMAGES.some(image => !isDigest(digests[image]))) throw new Error('Invalid promotion source or missing image digest');
  await gate();
  const branch = await api('branches/master');
  const base = branch.commit.sha;
  if (!isSha(base)) throw new Error('Invalid Helm master revision');
  const checkedOut = command('git', ['rev-parse', 'HEAD'], { cwd: directory }).trim();
  if (checkedOut !== base) throw new Error('Helm checkout is no longer current; rerun delivery');
  const file = await api(`contents/values.yaml?ref=${base}`);
  const before = await readFile(resolve(directory, 'values.yaml'), 'utf8');
  if (file.encoding !== 'base64' || Buffer.from(file.content, 'base64').toString('utf8') !== before) throw new Error('Helm values checkout mismatch');
  const previous = await previousPromotion(api, base);
  if (previous && previous !== sha) {
    const comparison = await sourceApi(`compare/${previous}...${sha}`);
    if (comparison.status !== 'ahead') throw new Error('Helm promotion would roll back or diverge from the promoted source');
  }
  const after = updateValues(before, digests);
  if (previous === sha && after !== before) throw new Error('Source already promoted with different digests; preserve the existing promotion');
  if (after === before) return { status: 'unchanged', sha: base };
  await writeFile(resolve(directory, 'values.yaml'), after);
  await validate(directory);
  // Validation must not add chart changes or silently repair another setting.
  if (await readFile(resolve(directory, 'values.yaml'), 'utf8') !== after
      || command('git', ['diff', '--name-only'], { cwd: directory }).trim() !== 'values.yaml') throw new Error('Chart validation changed unrelated files');
  await gate();
  if ((await api('git/ref/heads/master')).object.sha !== base) throw new Error('Helm master changed during validation; rerun delivery');
  const head = `automation/kelryvo-images-${sha}`;
  let reusableRef;
  if (branch.protected) {
    const open = await api('pulls?state=open&base=master&per_page=100');
    if (open.length === 100) throw new Error('Too many open chart PRs to safely supersede promotions');
    for (const pr of open) {
      if (pr.head.repo?.full_name === HELM_REPOSITORY
          && /^automation\/kelryvo-images-[a-f0-9]{40}$/.test(pr.head.ref) && pr.head.ref !== head) {
        await gate();
        await api(`pulls/${pr.number}`, 'PATCH', { state: 'closed' });
      }
    }
    const existing = open.filter(pr => pr.head.ref === head && pr.head.repo?.full_name === HELM_REPOSITORY);
    if (existing.length) {
      const proposed = await api(`contents/values.yaml?ref=${existing[0].head.sha}`);
      if (Buffer.from(proposed.content, 'base64').toString('utf8') !== after) throw new Error('Existing promotion PR differs; review it before retrying');
      return { status: 'pull-request', url: existing[0].html_url };
    }
    // A failed PR creation can leave this deterministic branch behind. Reuse
    // only an exact, single-commit promotion from the inspected chart base.
    try { reusableRef = await api(`git/ref/heads/${head}`); }
    catch (error) { if (error.status !== 404) throw error; }
    if (reusableRef) {
      const candidate = await api(`git/commits/${reusableRef.object.sha}`);
      const proposed = await api(`contents/values.yaml?ref=${reusableRef.object.sha}`);
      const diff = await api(`compare/${base}...${reusableRef.object.sha}`);
      if (candidate.parents.length !== 1 || candidate.parents[0].sha !== base
          || !candidate.message.split('\n').includes(`Kelryvo-Source-SHA: ${sha}`)
          || Buffer.from(proposed.content, 'base64').toString('utf8') !== after
          || diff.files.length !== 1 || diff.files[0].filename !== 'values.yaml') {
        throw new Error('Existing promotion branch differs from the validated promotion');
      }
    }
  }
  const commit = await api(`git/commits/${base}`);
  const tree = await api('git/trees', 'POST', { base_tree: commit.tree.sha,
    tree: [{ path: 'values.yaml', mode: '100644', type: 'blob', content: after }] });
  const created = await api('git/commits', 'POST', { tree: tree.sha, parents: [base],
    message: `Promote verified Kelryvo images ${sha.slice(0, 12)}\n\nKelryvo-Source-SHA: ${sha}\nKelryvo-App-Digest: ${digests.app}\nKelryvo-Worker-Digest: ${digests.worker}` });
  await gate();
  if (branch.protected) {
    // Never grant a bypass or merge a protected promotion automatically.
    if (!reusableRef) await api('git/refs', 'POST', { ref: `refs/heads/${head}`, sha: created.sha });
    const pr = await api('pulls', 'POST', { head, base: 'master',
      draft: true,
      title: `Promote verified Kelryvo images ${sha.slice(0, 12)}`,
      body: `Both immutable image digests belong to verified source ${sha}. Only app.image.digest and worker.image.digest change. Strict Helm lint, chart security checks and template validation passed.\n\nApp: ${digests.app}\nWorker: ${digests.worker}\n\nRecheck that this source is current before merging; repository review and CI policies apply.` });
    return { status: 'pull-request', url: pr.html_url };
  }
  // A non-forced ref update rejects a concurrent Helm commit because this
  // commit has exactly the inspected master as parent. Never rebase/retry blind.
  await api('git/refs/heads/master', 'PATCH', { sha: created.sha, force: false });
  return { status: 'promoted', sha: created.sha };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const env = process.env;
    const sourceApi = githubApi(env.GITHUB_TOKEN);
    const gate = () => requirePublication(sourceApi, env.SOURCE_SHA);
    await gate();
    const tag = imageTag(env.SOURCE_SHA, env.OCI_RUN, env.OCI_ATTEMPT);
    const digests = { app: env.APP_DIGEST, worker: env.WORKER_DIGEST };
    for (const image of IMAGES) {
      const reader = await registryReader(image, env.GITHUB_ACTOR, env.GITHUB_TOKEN);
      const remote = await reader(digests[image]);
      verifyImage(remote, env.SOURCE_SHA);
      if ((await reader(tag)).digest !== digests[image]) throw new Error('Promotion digest does not match the verified publication tag');
    }
    const result = await promoteHelm({ api: githubApi(env.HELM_TOKEN, HELM_REPOSITORY), sourceApi,
      sha: env.SOURCE_SHA, digests, directory: resolve('helm-chart'), gate,
      validate: directory => {
        command('helm', ['lint', '--strict', '.'], { cwd: directory, stdio: 'inherit' });
        command('/usr/bin/python3', ['scripts/check-chart.py'], { cwd: directory, stdio: 'inherit' });
        command('helm', ['template', 'kelryvo', '.', '--namespace', 'kelryvo'], { cwd: directory });
      },
    });
    await appendFile(env.GITHUB_STEP_SUMMARY, `Helm ${result.status}: ${result.url ?? result.sha}\n\nSource ${env.SOURCE_SHA}\n${IMAGES.map(image => `${imageRepository(image)}@${digests[image]}`).join('\n')}\n`);
    console.log(`Helm ${result.status}: ${result.url ?? result.sha}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
