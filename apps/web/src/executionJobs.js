export const terminalExecutionStates = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'HOLD', 'NOOP', 'VERIFIED_SUCCESS']);

export function mergeExecutionJobWindow(currentJobs, listedJobs = null, detailJobs = [], limit = 50) {
  const boundedLimit = Math.max(1, Math.min(50, Number.isSafeInteger(limit) ? limit : 50));
  const jobs = new Map();
  const merge = job => {
    if (!job || typeof job.id !== 'string') return;
    const prior = jobs.get(job.id);
    if (!prior || Number(job.revision) >= Number(prior.revision)) jobs.set(job.id, job);
  };
  for (const job of currentJobs || []) merge(job);
  for (const job of listedJobs || []) merge(job);
  for (const job of detailJobs || []) merge(job);
  // The API orders with PostgreSQL microseconds; serialized dates can lose that precision.
  // A list response owns window membership and order. Detail reads only update that window.
  const window = listedJobs === null ? currentJobs || [] : listedJobs;
  return [...new Set(window.map(job => job?.id).filter(id => typeof id === 'string'))]
    .slice(0, boundedLimit).map(id => jobs.get(id)).filter(Boolean);
}
