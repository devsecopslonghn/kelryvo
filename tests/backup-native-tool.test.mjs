import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runDockerTool } from '../packages/backup/native-tool.mjs';

class Child extends EventEmitter {
  constructor({autoClose=true,exitCode=0,closeSignal=null}={}) {
    super();this.stdout=new PassThrough();this.stderr=new PassThrough();this.kills=[];
    this.autoClose=autoClose;this.exitCode=exitCode;this.closeSignal=closeSignal;this.closed=false;
  }
  kill(signal) {
    this.kills.push(signal);
    if((this.autoClose||signal===this.closeSignal)&&!this.closed){this.closed=true;queueMicrotask(()=>this.emit('close',signal==='SIGKILL'?null:this.exitCode,signal));}
    return true;
  }
  unref(){this.unreferenced=true;}
}
const deferred=()=>new Promise(resolve=>setImmediate(resolve));

test('native Docker runner drains stderr and returns complete stdout',async()=>{
  const main=new Child(),calls=[];
  const result=runDockerTool(['run','--entrypoint','pg_restore'],{spawnProcess:(file,args,options)=>{calls.push({file,args,options});return main;}});
  main.stderr.write(Buffer.alloc(5*1024*1024,0x61));main.stdout.write('complete');main.emit('close',0,null);
  assert.equal(await result,'complete');
  assert.equal(calls.length,1);assert.equal(calls[0].file,'/usr/bin/docker');
  assert.equal(calls[0].args[0],'--host');assert.equal(calls[0].args[1],'unix:///var/run/docker.sock');
  assert.ok(calls[0].args.includes('--name'));
});

test('native Docker runner counts output bytes and fails closed on overflow',async()=>{
  const main=new Child(),killer=new Child(),calls=[];
  const result=runDockerTool(['run','--entrypoint','pg_restore'],{outputLimit:4,spawnProcess:(file,args)=>{
    calls.push(args);if(args.includes('rm'))queueMicrotask(()=>killer.emit('close',0,null));return args.includes('rm')?killer:main;
  }});
  main.stdout.write(Buffer.from('😀'));await deferred();
  assert.equal(main.kills.length,0);
  main.stdout.write(Buffer.from('x'));
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_ABORTED');
  assert.ok(calls[1].includes('rm'));assert.ok(calls[1].at(-1).startsWith('kelryvo-backup-'));
  assert.deepEqual(main.kills,['SIGTERM']);
});

test('native Docker runner timeout kills and reaps its named run container',async()=>{
  const main=new Child({autoClose:false,closeSignal:'SIGKILL'}),killer=new Child(),calls=[];
  const result=runDockerTool(['run','--entrypoint','pg_dump'],{timeout:10,cleanupTimeout:20,terminationGrace:10,
    spawnProcess:(file,args)=>{calls.push(args);if(args.includes('rm'))queueMicrotask(()=>killer.emit('close',0,null));return args.includes('rm')?killer:main;}});
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_ABORTED');
  assert.ok(calls[1].includes('rm'));assert.deepEqual(main.kills,['SIGTERM','SIGKILL']);
});

test('native Docker runner reports uncertain cleanup when Docker rm hangs',async()=>{
  const main=new Child({autoClose:false}),killer=new Child({autoClose:false}),calls=[];
  const result=runDockerTool(['run','--entrypoint','pg_dump'],{timeout:10,cleanupTimeout:10,terminationGrace:10,
    spawnProcess:(file,args)=>{calls.push(args);return args.includes('rm')?killer:main;}});
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_CLEANUP_UNCERTAIN');
  assert.deepEqual(main.kills,['SIGTERM','SIGKILL']);assert.deepEqual(killer.kills,['SIGTERM','SIGKILL']);
  assert.equal(killer.unreferenced,true);
});

test('native Docker runner cleans up named container after nonzero CLI exit',async()=>{
  const main=new Child({exitCode:9}),cleanup=new Child(),calls=[];
  const result=runDockerTool(['run','--entrypoint','pg_dump'],{spawnProcess:(file,args)=>{
    calls.push(args);if(args.includes('rm'))queueMicrotask(()=>cleanup.emit('close',0,null));return args.includes('rm')?cleanup:main;
  }});
  main.emit('close',9,null);
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_FAILED');
  assert.equal(calls.length,2);assert.deepEqual(calls[1].slice(2,5),['container','rm','--force']);
});

test('native Docker runner confirms already-absent named containers from exact daemon response',async()=>{
  const main=new Child({exitCode:1}),cleanup=new Child(),calls=[];
  const result=runDockerTool(['run'],{spawnProcess:(file,args)=>{
    calls.push(args);if(args.includes('rm'))queueMicrotask(()=>{
      cleanup.stderr.end(`Error response from daemon: No such container: ${args.at(-1)}\n`);
      cleanup.emit('close',1,null);
    });return args.includes('rm')?cleanup:main;
  }});
  main.emit('close',1,null);
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_FAILED');
});

test('native Docker runner validates bounded cleanup timing values',async()=>{
  for(const options of [{cleanupTimeout:0},{terminationGrace:Infinity},{terminationGrace:1.5},{outputLimit:4*1024*1024+1}])
    await assert.rejects(runDockerTool(['inspect'],options),error=>error.code==='KELRYVO_TOOL_INVALID');
});

test('native Docker runner fails closed on spawn errors and nonzero non-run exits',async()=>{
  await assert.rejects(runDockerTool(['run','--entrypoint','pg_dump'],{spawnProcess:()=>{throw Error('spawn');}}),
    error=>error.code==='KELRYVO_TOOL_START');
  const main=new Child({exitCode:9});const result=runDockerTool(['inspect'],{spawnProcess:()=>main});
  main.emit('close',9,null);
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_FAILED');
});

// A later container cleanup result must not erase uncertainty about the CLI process.
test('native runner retains main-process uncertainty after successful delayed container cleanup',async()=>{
  const main=new Child({autoClose:false}),cleanup=new Child({autoClose:false});
  const result=runDockerTool(['run'],{timeout:10,cleanupTimeout:200,terminationGrace:10,spawnProcess:(file,args)=>{
    if(args.includes('rm')){setTimeout(()=>cleanup.emit('close',0,null),60);return cleanup;}
    return main;
  }});
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_CLEANUP_UNCERTAIN');
  assert.equal(main.unreferenced,true);
});

test('native runner rejects an absence response referring to another container',async()=>{
  const main=new Child({exitCode:1}),cleanup=new Child();
  const result=runDockerTool(['run'],{spawnProcess:(file,args)=>{
    if(args.includes('rm'))queueMicrotask(()=>{cleanup.stderr.write('Error response from daemon: No such container: unrelated\n');cleanup.emit('close',1,null);});
    return args.includes('rm')?cleanup:main;
  }});
  main.emit('close',1,null);
  await assert.rejects(result,error=>error.code==='KELRYVO_TOOL_CLEANUP_UNCERTAIN');
});
