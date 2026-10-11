// Dispatch publishing only from the exact, fully verified current master.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_REF, GITHUB_EVENT_NAME } = process.env;
if (GITHUB_EVENT_NAME !== 'workflow_dispatch' || GITHUB_REF !== 'refs/heads/master'
    || !/^[a-f0-9]{40}$/.test(GITHUB_SHA ?? '')) throw new Error('Container publication requires verified master dispatch');
const get = async route => {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}/${route}`, {
    headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Publication verification unavailable');
  return response.json();
};
if ((await get('git/ref/heads/master')).object.sha !== GITHUB_SHA) throw new Error('Publication head is no longer current');
for (const workflow of ['check.yml', 'parser.yml', 'product.yml', 'containers.yml']) {
  const { workflow_runs: runs } = await get(`actions/workflows/${workflow}/runs?head_sha=${GITHUB_SHA}&event=push&per_page=100`);
  if (!runs.length || runs[0].head_sha !== GITHUB_SHA || runs[0].status !== 'completed' || runs[0].conclusion !== 'success') throw new Error('Required master workflow is not successful');
}
const { check_runs: checks } = await get(`commits/${GITHUB_SHA}/check-runs?per_page=100`);
for (const name of ['Analyze (javascript-typescript)', 'Analyze (actions)', 'Analyze (java-kotlin)', 'Analyze (python)']) {
  const check = checks.find(item => item.app?.slug === 'github-actions' && item.name === name);
  if (!check || check.status !== 'completed' || check.conclusion !== 'success') throw new Error('Required CodeQL checks are not successful');
}
const alerts = await get('code-scanning/alerts?state=open&per_page=100');
if (alerts.length) throw new Error('Open code-scanning findings require review');
console.log(`Publication gates verified for ${GITHUB_SHA}.`);
