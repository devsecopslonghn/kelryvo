import { coordinate, type AdmittedJob, type CoordinatorPorts } from '../../packages/execution/coordinator.ts';

/** Worker entry point receives a trusted admitted envelope and scoped capabilities from its host. */
export async function runAdmittedJob(job: AdmittedJob, ports: CoordinatorPorts) {
  return coordinate(job, ports);
}
