import { createOracleDiscoveryRuntime } from './oracle.mjs';
import { probeOracleSocketGuard } from './oracle.mjs';

process.on('message', async request => {
  if (!request || typeof request !== 'object' || !process.send) process.exit(2);
  if (request.socketGuardProbe) {
    const denied=await probeOracleSocketGuard(request.socketGuardProbe);
    process.send({socketRedirectDenied:denied},()=>process.exit(0));
    return;
  }
  const runtime=createOracleDiscoveryRuntime({manifestPath:request.manifestPath,secretDirectory:request.secretDirectory,timeoutMs:request.timeoutMs,isolated:true});
  const result=await runtime.run(request.connection,request.operation,{owner:request.owner});
  process.send(result,()=>process.exit(0));
});
