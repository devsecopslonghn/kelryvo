// These probes observe the control plane only. Target availability requires
// independent installed capabilities and is never inferred from metadata.
export function registerHealthProbes(app, readMetadataState) {
  let flight = null;
  const unavailable = () => ({ status: 'unavailable', metadata: 'UNAVAILABLE', targetAvailability: 'UNVERIFIED' });
  const observe = () => {
    if (flight) return flight;
    const observation = Promise.resolve().then(readMetadataState).then(state =>
      ['ACTIVE', 'RESTORE_HOLD'].includes(state)
        ? { status: 'ready', metadata: state, targetAvailability: 'UNVERIFIED' }
        : unavailable()).catch(unavailable);
    flight = observation;
    observation.finally(() => { if (flight === observation) flight = null; });
    return observation;
  };

  // A cheap constant response remains independent of metadata and business quota.
  app.get('/api/livez', { config: { rateLimit: false } }, async () => ({ status: 'alive' }));
  app.route({
    method: ['GET', 'HEAD'], url: '/api/readyz',
    config: { rateLimit: { max: 120, timeWindow: 60_000 } },
    handler: async (_req, reply) => {
      let timer;
      try {
        const result = await Promise.race([observe(), new Promise(resolve => {
          timer = setTimeout(() => resolve(unavailable()), 1000);
        })]);
        if (result.status !== 'ready') reply.code(503);
        return result;
      } finally { clearTimeout(timer); }
    },
  });
}
