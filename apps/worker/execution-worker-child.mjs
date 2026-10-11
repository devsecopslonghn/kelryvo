import { runSupervisedExecutionWorker } from './supervised-runner.mjs';

// argv[2] is fixed by the installed supervisor closure, never read from IPC.
const factorySpecifier = process.argv[2];
if (!factorySpecifier || process.argv.length !== 3) throw new Error('privileged_worker_binding_required');
const binding = await import(factorySpecifier);
await runSupervisedExecutionWorker(binding.createExecutionWorker);
