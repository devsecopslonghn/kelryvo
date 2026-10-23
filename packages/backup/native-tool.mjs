import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const fail=code=>Object.assign(new Error('Native backup tool failed.'),{code});
const DOCKER='/usr/bin/docker';
const DOCKER_HOST='unix:///var/run/docker.sock';
const maxOutputBytes=4*1024*1024;

function cleanupContainer(name,{spawnProcess,env,timeout,grace}) {
  return new Promise(resolve=>{
    let child;
    try{child=spawnProcess(DOCKER,['--host',DOCKER_HOST,'container','rm','--force',name],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});}
    catch{return resolve(false);}
    let closed=false,finished=false,stderr='',stderrBytes=0,deadline=null,termTimer=null,killTimer=null;
    const finish=certain=>{
      if(finished)return;finished=true;clearTimeout(deadline);clearTimeout(termTimer);clearTimeout(killTimer);
      if(!closed){child.unref?.();child.stdout?.destroy();child.stderr?.destroy();}
      resolve(certain);
    };
    child.stdout?.resume?.();
    child.stderr?.on('data',chunk=>{
      const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);stderrBytes+=bytes.byteLength;
      if(stderr.length<4096)stderr+=bytes.toString('utf8').slice(0,4096-stderr.length);
    });
    const stop=()=>{
      if(closed)return;
      try{child.kill('SIGTERM');}catch{}
      termTimer=setTimeout(()=>{
        if(closed)return;
        try{child.kill('SIGKILL');}catch{}
        killTimer=setTimeout(()=>finish(false),grace);
      },grace);
    };
    child.once('error',()=>{closed=true;finish(false);});
    child.once('close',code=>{
      closed=true;
      if(code===0){finish(true);return;}
      const exactAbsence=stderrBytes===Buffer.byteLength(stderr)
        &&new RegExp(`^(?:Error response from daemon: )?(?:No such container|No such object): ${name}\\r?\\n?$`).test(stderr);
      finish(exactAbsence);
    });
    deadline=setTimeout(stop,timeout);
  });
}

/** Run a fixed Docker CLI operation without blocking other local tunnel processes. */
export function runDockerTool(args,{env={},timeout=120_000,spawnProcess=spawn,outputLimit=maxOutputBytes,
  cleanupTimeout=3_000,terminationGrace=1_000}={}) {
  if(!Array.isArray(args)||!args.length||!Number.isSafeInteger(timeout)||timeout<1
    ||!Number.isSafeInteger(outputLimit)||outputLimit<0||outputLimit>maxOutputBytes||!Number.isSafeInteger(cleanupTimeout)||cleanupTimeout<1
    ||!Number.isSafeInteger(terminationGrace)||terminationGrace<1) return Promise.reject(fail('KELRYVO_TOOL_INVALID'));
  const name=args[0]==='run'?`kelryvo-backup-${randomUUID()}`:null;
  const commandArgs=args[0]==='run'?[args[0],'--name',name,...args.slice(1)]:args;
  const safeEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('DOCKER_')||key==='DOCKER_CONFIG')),
    ...env,PATH:'/usr/bin:/bin'};
  return new Promise((resolve,reject)=>{
    let main;
    try{main=spawnProcess(DOCKER,['--host',DOCKER_HOST,...commandArgs],{env:safeEnv,stdio:['ignore','pipe','pipe'],windowsHide:true});}
    catch{return reject(fail('KELRYVO_TOOL_START'));}
    let output=Buffer.alloc(0),outputBytes=0,mainClosed=false,mainError=false;
    let done=false,stopping=false,cleanupCertain=true,stopFailure='KELRYVO_TOOL_ABORTED';
    let mainKillTimer=null,operationTimer=null;
    const conclude=(error)=>{
      if(done)return;done=true;clearTimeout(operationTimer);clearTimeout(mainKillTimer);
      if(error)reject(fail(error));else resolve(output.toString('utf8'));
    };
    const terminateMain=()=>{
      if(mainClosed)return;
      try{main.kill('SIGTERM');}catch{}
      mainKillTimer=setTimeout(()=>{
        if(mainClosed)return;
        try{main.kill('SIGKILL');}catch{}
        setTimeout(()=>{
          if(!mainClosed){cleanupCertain=false;mainClosed=true;main.unref?.();main.stdout?.destroy();main.stderr?.destroy();}
          finishStop();
        },terminationGrace);
      },terminationGrace);
    };
    let cleanupDone=!name;
    const finishStop=()=>{
      if(!stopping||!mainClosed||!cleanupDone)return;
      conclude(cleanupCertain?stopFailure:'KELRYVO_TOOL_CLEANUP_UNCERTAIN');
    };
    const cleanupOwnedContainer=()=>{
      if(!name){cleanupDone=true;finishStop();return;}
      cleanupContainer(name,{spawnProcess,env:safeEnv,timeout:cleanupTimeout,grace:terminationGrace})
        .then(certain=>{cleanupCertain=cleanupCertain&&certain;cleanupDone=true;finishStop();});
    };
    const stop=(failure='KELRYVO_TOOL_ABORTED')=>{
      if(stopping)return;stopping=true;stopFailure=failure;
      cleanupOwnedContainer();terminateMain();
    };
    main.stdout?.on('data',chunk=>{
      if(done||stopping)return;
      const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
      outputBytes+=bytes.byteLength;
      if(outputBytes>outputLimit){stop();return;}
      output=Buffer.concat([output,bytes],outputBytes);
    });
    main.stderr?.resume?.();
    main.once('error',()=>{mainError=true;mainClosed=true;clearTimeout(mainKillTimer);if(!stopping)conclude('KELRYVO_TOOL_START');else finishStop();});
    main.once('close',code=>{
      mainClosed=true;clearTimeout(mainKillTimer);
      if(stopping){finishStop();return;}
      if(mainError||code!==0){
        if(name){stop('KELRYVO_TOOL_FAILED');return;}
        conclude('KELRYVO_TOOL_FAILED');
      }
      else conclude(null);
    });
    operationTimer=setTimeout(stop,timeout);
  });
}
