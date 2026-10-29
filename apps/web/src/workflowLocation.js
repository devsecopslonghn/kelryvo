const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const pages = new Set(['workspace','instances','references','targets','schema','sql','release','review','inbox','records','history','account','identity']);

// Only object identities are retained in the URL. Access is rechecked by the API.
export function readWorkflowLocation(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const result = {tab: pages.has(params.get('page')) ? params.get('page') : 'workspace'};
  for (const key of ['project','target','draft','release','plan']) {
    if (uuid(params.get(key))) result[key] = params.get(key);
  }
  return result;
}

export function writeWorkflowLocation(context) {
  const params = new URLSearchParams({page: pages.has(context.tab) ? context.tab : 'workspace'});
  for (const key of ['project','target','draft','release','plan']) {
    if (uuid(context[key])) params.set(key, context[key]);
  }
  return `#${params}`;
}
