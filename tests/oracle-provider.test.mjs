import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createPrivateOracleProvider } from '../apps/worker/oracle-provider.mjs';
import { executionDigest } from '../packages/execution/admission.ts';

const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture({installedOverrides={},connectionOverrides={},connectionFactory,...overrides}={}) {
  const request={jobId:randomUUID(),planId:randomUUID(),approvalReference:randomUUID(),intentDigest:hash('intent'),
    profile:{engine:'oracle',username:'APP',service:'SERVICE'},migrations:[{path:'V1.sql',version:'1',sha256:hash('file'),
      statementManifestDigest:hash('manifest'),statementDigests:[hash('stmt')]}],statementDigests:[hash('stmt')]};
  const events=[],connections=[]; let authCount=0;
  const installed={scope:'UNIT_SYNTHETIC',workerId:'unit-worker',authorize:async r=>{
    events.push('authorize');authCount++;
    return {scope:'UNIT_SYNTHETIC',action:'EXECUTE_APPROVED_MIGRATIONS',workerId:'unit-worker',jobId:r.jobId,planId:r.planId,
      intentDigest:r.intentDigest,approvalReference:r.approvalReference,
      profileDigest:executionDigest(Object.fromEntries(Object.entries(r.profile).sort(([a],[b])=>a.localeCompare(b)))),
      statementDigestsDigest:executionDigest(r.statementDigests),dispatchPermitDigest:hash('dispatch'+authCount),expiresAt:Date.now()+60000};
  },resolvePrivateOptions:async()=>{events.push('resolve');return {writer:{connectString:'fixed-writer'},ledgerOwner:{connectString:'fixed-ledger'},
      ledgerOwnerName:'SF_LEDGER',callTimeout:4321};},
    bindTarget:async(_r,_p,writer,ledgerOwner,ledgerOwnerName)=>({writer,ledgerOwner,ledgerOwnerName,
      attest:async()=>null,verifyEmptyTarget:async()=>false,claimDispatch:async()=>null,verifyPostconditions:async()=>false,
      centralEvidenceComplete:async()=>false}),...installedOverrides};
  const provider=createPrivateOracleProvider(installed,{allowUnitSynthetic:true,unitGetConnection:connectionFactory??(async opts=>{
    events.push('connect:'+opts.connectString);const c={callTimeout:0,closed:0,execute:async()=>{events.push('execute');},
      commit:async()=>{},rollback:async()=>{},close:async()=>{c.closed++;events.push('close:'+opts.connectString);},...connectionOverrides};connections.push(c);return c;
  })});
  return {provider,request,events,connections,...overrides};
}

test('authorizes exact purpose and request before resolving routes or opening two bounded sessions',async()=>{
  const f=fixture(),permit=await f.provider.authorize(f.request);
  assert.equal(f.events.join(','),'authorize');
  let raw;
  await f.provider.withTarget(f.request,permit,async target=>{raw=target;assert.notEqual(target.writer,target.ledgerOwner);return 'done';});
  assert.equal(f.events.filter(x=>x.startsWith('connect:')).length,2);
  assert.deepEqual(f.connections.map(c=>c.callTimeout),[4321,4321]);
  assert.equal(f.connections.every(c=>c.closed===1),true);
  assert.equal(f.events.includes('execute'),false);
  assert.equal(raw.writer.closed,1);
});

test('denies wrong request, copied forged authority, wrong purpose, reuse, and overlapping invocation',async()=>{
  const f=fixture(),permit=await f.provider.authorize(f.request);
  await assert.rejects(f.provider.withTarget({...f.request,jobId:randomUUID()},permit,async()=>{}));
  assert.equal(f.events.includes('resolve'),false);
  const f2=fixture(),p2=await f2.provider.authorize(f2.request);
  await assert.rejects(f2.provider.withTarget(f2.request,{...p2,dispatchPermitDigest:hash('forged')},async()=>{}));
  const f2b=fixture(),p2b=await f2b.provider.authorize(f2b.request);
  await assert.rejects(f2b.provider.withTarget(f2b.request,{...p2b,action:'READ_ONLY'},async()=>{}));
  const f2c=fixture(),p2c=await f2c.provider.authorize(f2c.request);
  await f2c.provider.withTarget(f2c.request,p2c,async()=>{});
  assert.equal(await f2c.provider.authorize(f2c.request),null);
  await assert.rejects(f2c.provider.withTarget(f2c.request,p2c,async()=>{}));
  const f3=fixture(),p3=await f3.provider.authorize(f3.request);let release;
  const pending=f3.provider.withTarget(f3.request,p3,()=>new Promise(resolve=>{release=resolve;}));
  while(!release) await new Promise(r=>setImmediate(r));
  await assert.rejects(f3.provider.withTarget(f3.request,p3,async()=>{}));release('settled');
  await assert.rejects(pending,/Oracle target capability unavailable/);
  assert.equal(f3.connections.every(c=>c.closed===1),true);
});

test('expired authority and cleanup uncertainty never cause replacement connections',async()=>{
  const f=fixture(),expired=createPrivateOracleProvider({...{
    scope:'UNIT_SYNTHETIC',workerId:'unit-worker',authorize:async r=>({...{
      scope:'UNIT_SYNTHETIC',action:'EXECUTE_APPROVED_MIGRATIONS',workerId:'unit-worker',jobId:r.jobId,planId:r.planId,
      intentDigest:r.intentDigest,approvalReference:r.approvalReference,
      profileDigest:executionDigest(Object.fromEntries(Object.entries(r.profile).sort(([a],[b])=>a.localeCompare(b)))),
      statementDigestsDigest:executionDigest(r.statementDigests),dispatchPermitDigest:hash('expired'),expiresAt:Date.now()-1
    }}),resolvePrivateOptions:async()=>{f.events.push('unexpected resolve');return{};},bindTarget:async()=>null
  }},{allowUnitSynthetic:true,unitGetConnection:async()=>{throw Error('unexpected connect');}});
  assert.equal(await expired.authorize(f.request),null);

  let closeCount=0,connectCount=0;
  const provider=createPrivateOracleProvider({scope:'UNIT_SYNTHETIC',workerId:'unit-worker',authorize:async r=>({
    scope:'UNIT_SYNTHETIC',action:'EXECUTE_APPROVED_MIGRATIONS',workerId:'unit-worker',jobId:r.jobId,planId:r.planId,
    intentDigest:r.intentDigest,approvalReference:r.approvalReference,
    profileDigest:executionDigest(Object.fromEntries(Object.entries(r.profile).sort(([a],[b])=>a.localeCompare(b)))),
    statementDigestsDigest:executionDigest(r.statementDigests),dispatchPermitDigest:hash('cleanup'),expiresAt:Date.now()+60000}),
    resolvePrivateOptions:async()=>({writer:{fixed:'w'},ledgerOwner:{fixed:'l'},ledgerOwnerName:'SF_LEDGER',callTimeout:2000}),
    bindTarget:async(_r,_p,writer,ledgerOwner,ledgerOwnerName)=>({writer,ledgerOwner,ledgerOwnerName,attest:async()=>null,
      verifyEmptyTarget:async()=>false,claimDispatch:async()=>null,verifyPostconditions:async()=>false,centralEvidenceComplete:async()=>false})
  },{allowUnitSynthetic:true,unitGetConnection:async()=>{connectCount++;return {callTimeout:1,execute:async()=>{},commit:async()=>{},rollback:async()=>{},
    close:async()=>{if(++closeCount===1)throw Error('secret close detail');}};}});
  const permit=await provider.authorize(f.request);
  await assert.rejects(provider.withTarget(f.request,permit,async()=>{}),e=>e.message==='Oracle target capability unavailable');
  assert.equal(await provider.authorize(f.request),null);
  assert.equal(connectCount,2);assert.equal(closeCount,2);
});

test('writer is retired when ledger acquisition fails; no reconnect is attempted',async()=>{
  const f=fixture();let calls=0,writer;
  const provider=createPrivateOracleProvider({...{
    scope:'UNIT_SYNTHETIC',workerId:'unit-worker',authorize:f.provider.authorize,
    resolvePrivateOptions:async()=>({writer:{connectString:'fixed-writer'},ledgerOwner:{connectString:'fixed-ledger'},ledgerOwnerName:'SF_LEDGER',callTimeout:1000}),
    bindTarget:async()=>null,
  }},{allowUnitSynthetic:true,unitGetConnection:async opts=>{
    calls++;if(opts.connectString==='fixed-ledger')throw Error('private driver detail');
    writer={callTimeout:1,closed:0,execute:async()=>{},commit:async()=>{},rollback:async()=>{},close:async()=>{writer.closed++;}};
    return writer;
  }});
  const permit=await provider.authorize(f.request);
  await assert.rejects(provider.withTarget(f.request,permit,async()=>{}),/Oracle target capability unavailable/);
  assert.equal(calls,2);assert.equal(writer.closed,1);
});

test('drains an unawaited target callback and its raw session operation before closing sessions',async()=>{
  let finishOperation,callbackReturned=false;
  let started;
  const began=new Promise(resolve=>{started=resolve;});
  const f=fixture({connectionOverrides:{execute:async()=>{started();return new Promise(resolve=>{finishOperation=resolve;});}},
    installedOverrides:{bindTarget:async(_r,_p,writer,ledgerOwner,ledgerOwnerName)=>({writer,ledgerOwner,ledgerOwnerName,
      attest:async()=>{await writer.execute('synthetic delayed call');return null;},verifyEmptyTarget:async()=>false,
      claimDispatch:async()=>null,verifyPostconditions:async()=>false,centralEvidenceComplete:async()=>false})}});
  const permit=await f.provider.authorize(f.request);
  const task=f.provider.withTarget(f.request,permit,target=>{target.attest();callbackReturned=true;});
  await began;
  while(!callbackReturned) await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.connections.some(c=>c.closed),false);
  finishOperation();
  await assert.rejects(task,e=>e.message==='Oracle target capability unavailable');
  assert.equal(f.connections.every(c=>c.closed===1),true);
});

test('allows a fully awaited installed attestation to use its raw fixed session',async()=>{
  const f=fixture({installedOverrides:{bindTarget:async(_r,_p,writer,ledgerOwner,ledgerOwnerName)=>({writer,ledgerOwner,ledgerOwnerName,
    attest:async()=>{await writer.execute('synthetic identity query');return 'attested';},verifyEmptyTarget:async()=>false,
    claimDispatch:async()=>null,verifyPostconditions:async()=>false,centralEvidenceComplete:async()=>false})}});
  const permit=await f.provider.authorize(f.request);
  const result=await f.provider.withTarget(f.request,permit,async target=>await target.attest());
  assert.equal(result,'attested');assert.equal(f.events.includes('execute'),true);
  assert.equal(f.connections.every(c=>c.closed===1),true);
});

test('a caught owned operation rejection still retires the invocation',async()=>{
  const f=fixture({connectionOverrides:{execute:async()=>{throw Error('private driver secret');}},
    installedOverrides:{bindTarget:async(_r,_p,writer,ledgerOwner,ledgerOwnerName)=>({writer,ledgerOwner,ledgerOwnerName,
      attest:async()=>writer.execute('synthetic failing call'),verifyEmptyTarget:async()=>false,claimDispatch:async()=>null,
      verifyPostconditions:async()=>false,centralEvidenceComplete:async()=>false})}});
  const permit=await f.provider.authorize(f.request);
  await assert.rejects(f.provider.withTarget(f.request,permit,async target=>{try { await target.attest(); } catch { return 'caught'; }}),
    e=>e.message==='Oracle target capability unavailable');
  assert.equal(f.connections.every(c=>c.closed===1),true);
});

test('a reused physical handle is closed exactly once and cannot bind as two sessions',async()=>{
  const conn={callTimeout:0,closed:0,execute:async()=>{},commit:async()=>{},rollback:async()=>{},close:async()=>{conn.closed++;}};
  const f=fixture({connectionFactory:async()=>conn});
  const permit=await f.provider.authorize(f.request);
  await assert.rejects(f.provider.withTarget(f.request,permit,async()=>{}),e=>e.message==='Oracle target capability unavailable');
  assert.equal(conn.closed,1);
});

test('callback and malformed session failures close resources with generic errors',async()=>{
  const callback=fixture(),permit=await callback.provider.authorize(callback.request);
  await assert.rejects(callback.provider.withTarget(callback.request,permit,async()=>{throw Error('credential-secret-detail');}),
    e=>e.message==='Oracle target capability unavailable');
  assert.equal(callback.connections.length,2);assert.equal(callback.connections.every(c=>c.closed===1),true);

  const malformed=fixture({connectionOverrides:{commit:undefined}}),p=await malformed.provider.authorize(malformed.request);
  await assert.rejects(malformed.provider.withTarget(malformed.request,p,async()=>{}),
    e=>e.message==='Oracle target capability unavailable');
  assert.equal(malformed.connections.length,1);assert.equal(malformed.connections[0].closed,1);
});

test('UNIT fake ports require explicit opt-in and TRUSTED scope cannot inject one',()=>{
  const installed={scope:'UNIT_SYNTHETIC',workerId:'unit-worker',authorize:async()=>null,resolvePrivateOptions:async()=>({}),bindTarget:async()=>({})};
  assert.throws(()=>createPrivateOracleProvider(installed,{unitGetConnection:async()=>({})}),/unavailable/);
  assert.throws(()=>createPrivateOracleProvider({...installed,scope:'TRUSTED_VALIDATED'},
    {unitGetConnection:async()=>({}),allowUnitSynthetic:true}),/unavailable/);
});
