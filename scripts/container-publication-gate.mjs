import { readFile, appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const SOURCE_REPOSITORY = 'devsecopslonghn/kelryvo';
export const HELM_REPOSITORY = 'devsecopslonghn/kelryvo-helm-chart';
export const CODEQL_JOBS = ['Analyze (javascript-typescript)', 'Analyze (actions)', 'Analyze (java-kotlin)', 'Analyze (python)'];
export const REQUIRED_WORKFLOWS = ['check.yml', 'product.yml', 'containers.yml'];
export const isSha = value => /^[a-f0-9]{40}$/.test(value ?? '');
export const isDigest = value => /^sha256:[a-f0-9]{64}$/.test(value ?? '');

// Never include response bodies or credentials in diagnostics.
export function githubApi(token, repository = SOURCE_REPOSITORY, request = fetch) {
  if (!token) throw new Error(`Missing GitHub credential for ${repository}`);
  return async (route, method = 'GET', body) => {
    const response = await request(`https://api.github.com/repos/${repository}/${route}`, {
      method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const error = new Error(`GitHub ${method} ${repository}/${route.split('?')[0]} failed (HTTP ${response.status}); check token permissions, branch policy or concurrent updates`);
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? undefined : response.json();
  };
}

export function sourceRevision(env, event) {
  if (env.GITHUB_REPOSITORY !== SOURCE_REPOSITORY) throw new Error('Unexpected source repository');
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/master' && isSha(env.GITHUB_SHA)) return env.GITHUB_SHA;
  const run = event.workflow_run;
  if (env.GITHUB_EVENT_NAME !== 'workflow_run' || event.action !== 'completed'
      || !['push', 'dynamic'].includes(run?.event) || run.head_branch !== 'master'
      || run.head_repository?.full_name !== SOURCE_REPOSITORY || !isSha(run.head_sha)) {
    throw new Error('Delivery requires a completed source master workflow event');
  }
  return run.head_sha;
}

// One snapshot per completion event: pending/failed gates never wait or publish.
// The final completion event (including CodeQL) evaluates all gates again.
export async function publicationGate(get, sha) {
  if (!isSha(sha)) throw new Error('Invalid source revision');
  if ((await get('git/ref/heads/master')).object.sha !== sha) return { ready: false, reason: 'Source is superseded' };
  const verified = {};
  for (const workflow of REQUIRED_WORKFLOWS) {
    const { workflow_runs: runs } = await get(`actions/workflows/${workflow}/runs?head_sha=${sha}&event=push&branch=master&per_page=100`);
    const run = runs.sort((a, b) => b.id - a.id)[0];
    if (!run || run.head_sha !== sha || run.head_branch !== 'master' || run.event !== 'push'
        || run.status !== 'completed' || run.conclusion !== 'success') return { ready: false, reason: `${workflow} is not successful` };
    verified[workflow] = run;
  }
  const { workflows } = await get('actions/workflows?per_page=100');
  const codeql = workflows.find(workflow => workflow.path === 'dynamic/github-code-scanning/codeql' && workflow.state === 'active');
  if (!codeql) throw new Error('Required default CodeQL workflow is unavailable');
  const { workflow_runs: runs } = await get(`actions/workflows/${codeql.id}/runs?head_sha=${sha}&branch=master&per_page=100`);
  const run = runs.filter(item => ['push', 'dynamic'].includes(item.event)).sort((a, b) => b.id - a.id)[0];
  if (!run || run.head_sha !== sha || run.head_branch !== 'master' || run.status !== 'completed' || run.conclusion !== 'success') return { ready: false, reason: 'CodeQL is not successful' };
  const { jobs } = await get(`actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (CODEQL_JOBS.some(name => !jobs.some(job => job.name === name && job.head_sha === sha && job.status === 'completed' && job.conclusion === 'success'))) return { ready: false, reason: 'Required CodeQL language is not successful' };
  if ((await get('code-scanning/alerts?state=open&per_page=100')).length) throw new Error('Open code-scanning findings require review');
  if ((await get('git/ref/heads/master')).object.sha !== sha) return { ready: false, reason: 'Source is superseded' };
  const oci = verified['containers.yml'];
  return { ready: true, sha, ociRun: String(oci.id), ociAttempt: String(oci.run_attempt) };
}

export async function requirePublication(get, sha) {
  const result = await publicationGate(get, sha);
  if (!result.ready) throw new Error(`Publication blocked: ${result.reason}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const sha = sourceRevision(process.env, event);
    if (process.env.SOURCE_SHA && process.env.SOURCE_SHA !== sha) throw new Error('Delivery revision changed');
    const result = await publicationGate(githubApi(process.env.GITHUB_TOKEN), sha);
    if (process.argv.includes('--require') && !result.ready) throw new Error(`Publication blocked: ${result.reason}`);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
      `ready=${result.ready}\nsha=${sha}\noci_run=${result.ociRun ?? ''}\noci_attempt=${result.ociAttempt ?? ''}\n`);
    console.log(result.ready ? `Publication gates verified for ${sha}.` : `Delivery deferred: ${result.reason}.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
