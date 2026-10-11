/** Privileged, installation-only Oracle connection provider.
 * Physical identity, TLS, grants, emptiness, and central proof remain independent capabilities.
 */
import oracledb from 'oracledb';
import { executionDigest, executionUuid } from '../../packages/execution/admission.ts';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_PLAN_STATEMENTS } from '../../packages/migrations/offline-plan-intent.mjs';
import { oracleExecutionProfileDigest } from './oracle-host.ts';
import { pinnedOracleThinDriverAvailable } from '../../packages/execution/oracle-driver.mjs';

const ACTION='EXECUTE_APPROVED_MIGRATIONS',OWNER=/^[A-Z][A-Z0-9_]{0,29}$/,DIGEST=/^[a-f0-9]{64}$/;
const KEYS=['scope','action','workerId','jobId','planId','intentDigest','approvalReference','profileDigest',
  'statementDigestsDigest','dispatchPermitDigest','expiresAt'];
const reject=()=>new Error('Oracle target capability unavailable');
const isRecord=v=>v&&typeof v==='object'&&!Array.isArray(v)
  &&[Object.prototype,null].includes(Object.getPrototypeOf(v))
  &&Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value'));
const deepFreeze=value=>{ if(value&&typeof value==='object'&&!Object.isFrozen(value)) { for(const v of Object.values(value)) deepFreeze(v);Object.freeze(value); }return value; };
const canonical=value=>Array.isArray(value)?value.map(canonical):isRecord(value)
  ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
function privateSnapshot(value,depth=0) {
  if(depth>8) throw reject();
  if(value===null||['string','number','boolean'].includes(typeof value)) return value;
  if(Array.isArray(value)) { if(value.length>4096) throw reject();return value.map(v=>privateSnapshot(v,depth+1)); }
  if(!isRecord(value)) throw reject();
  const out={};
  for(const [k,v] of Object.entries(value)) {
    if(/^(poolAlias|pool|poolName|connectionPoolName)$/i.test(k)) throw reject();
    out[k]=privateSnapshot(v,depth+1);
  }
  return out;
}
function snapshotRequest(input) {
  try {
    if(!isRecord(input)||!isRecord(input.profile)||input.profile.engine!=='oracle'||!OWNER.test(input.profile.username??'')
      ||![input.jobId,input.planId,input.approvalReference].every(executionUuid)||!DIGEST.test(input.intentDigest??'')
      ||!Array.isArray(input.migrations)||!input.migrations.length||input.migrations.length>MAX_RELEASE_FILES
      ||!Array.isArray(input.statementDigests)||!input.statementDigests.length||input.statementDigests.length>MAX_PLAN_STATEMENTS) return null;
    let total=0;
    const migrations=input.migrations.map(m=>{
      if(!isRecord(m)||!Array.isArray(m.statementDigests)||!m.statementDigests.length) throw reject();
      total+=m.statementDigests.length;if(total>MAX_PLAN_STATEMENTS) throw reject();
      return privateSnapshot(m);
    });
    const copy={jobId:input.jobId,planId:input.planId,approvalReference:input.approvalReference,intentDigest:input.intentDigest,
      profile:privateSnapshot(input.profile),migrations,statementDigests:privateSnapshot(input.statementDigests)};
    if(executionDigest(migrations.flatMap(m=>m.statementDigests))!==executionDigest(copy.statementDigests)) return null;
    return deepFreeze(copy);
  } catch { return null; }
}
function permitValid(p,request,workerId,scope,now) {
  if(!isRecord(p)||Object.keys(p).sort().join(',')!==[...KEYS].sort().join(',')||p.scope!==scope||p.action!==ACTION
    ||p.workerId!==workerId||p.jobId!==request.jobId||p.planId!==request.planId||p.intentDigest!==request.intentDigest
    ||p.approvalReference!==request.approvalReference||p.profileDigest!==oracleExecutionProfileDigest(request.profile)
    ||p.statementDigestsDigest!==executionDigest(request.statementDigests)||!DIGEST.test(p.dispatchPermitDigest??'')
    ||!Number.isSafeInteger(p.expiresAt)||p.expiresAt<=now||p.expiresAt-now>900000) return null;
  return deepFreeze({...p});
}
const samePermit=(a,b)=>executionDigest(a)===executionDigest(b);
const connectionShape=c=>c&&['execute','commit','rollback','close'].every(k=>typeof c[k]==='function');

/**
 * `authorize` is the installed purpose authority. The private resolver returns fixed
 * dedicated-session routes. `bindTarget` supplies independent host capabilities around
 * those exact sessions; this factory itself does not certify their evidence.
 */
export function createPrivateOracleProvider(installed,options={}) {
  const {scope,workerId}=installed??{},unit=scope==='UNIT_SYNTHETIC';
  if(!installed||!['TRUSTED_VALIDATED','UNIT_SYNTHETIC'].includes(scope)||unit&&options.allowUnitSynthetic!==true
    ||!unit&&options.unitGetConnection!==undefined||typeof workerId!=='string'||!/^[A-Za-z0-9._:-]{1,100}$/.test(workerId)
    ||typeof installed.authorize!=='function'||typeof installed.resolvePrivateOptions!=='function'
    ||typeof installed.bindTarget!=='function'||!unit&&!pinnedOracleThinDriverAvailable()) throw new Error('Installed Oracle provider unavailable');
  const getConnection=unit?options.unitGetConnection:oracledb.getConnection.bind(oracledb);
  if(typeof getConnection!=='function') throw new Error('Installed Oracle provider unavailable');
  let authPending=false,authorized=false,active=false,retired=false,grant=null;
  return Object.freeze({workerId,scope,
    async authorize(input) {
      if(authPending||authorized||active||retired) { retired=true;return null; }
      const request=snapshotRequest(input);if(!request) { retired=true;return null; }
      authPending=true;
      try {
        const permit=permitValid(await installed.authorize(request),request,workerId,scope,Date.now());
        if(!permit||retired) { retired=true;return null; }
        grant={request,permit};authorized=true;return permit;
      } catch { retired=true;return null; }
      finally { authPending=false; }
    },
    async withTarget(input,permit,run) {
      let request;
      try { request=snapshotRequest(input); } catch { request=null; }
      if(active) { retired=true;throw reject(); }
      if(retired||!authorized||!grant||!request||typeof run!=='function'||executionDigest(grant.request)!==executionDigest(request)) { retired=true;throw reject(); }
      try { if(!samePermit(grant.permit,permit)||!permitValid(permit,grant.request,workerId,scope,Date.now())) throw reject(); }
      catch { retired=true;throw reject(); }
      authorized=false;const fixed=grant;grant=null;active=true;
      const pending=new Set();let ending=false,poisoned=false;
      const track=operation=>{
        if(ending||poisoned||retired) { poisoned=true;return Promise.reject(reject()); }
        let promise;try { promise=Promise.resolve(operation()); }catch { promise=Promise.reject(reject()); }
        promise=promise.catch(()=>{poisoned=true;retired=true;throw reject();});
        pending.add(promise);promise.finally(()=>pending.delete(promise)).catch(()=>{});return promise;
      };
      const waitPending=async()=>{ while(pending.size) await Promise.allSettled([...pending]); };
      let writer,ledgerOwner,result,callbackStarted=false,closeFailed=false;
      try {
        if(retired) throw reject();
        // No request field enters this resolver; its fixed options are private installation state.
        const routes=deepFreeze(privateSnapshot(await installed.resolvePrivateOptions()));
        if(retired||!isRecord(routes)||!isRecord(routes.writer)||!isRecord(routes.ledgerOwner)
          ||executionDigest(canonical(routes.writer))===executionDigest(canonical(routes.ledgerOwner))||!OWNER.test(routes.ledgerOwnerName??'')
          ||routes.ledgerOwnerName===fixed.request.profile.username||!Number.isInteger(routes.callTimeout)
          ||routes.callTimeout<1||routes.callTimeout>30000) throw reject();
        const timeout=routes.callTimeout;
        const acquire=async opts=>{
          const c=await getConnection(opts);
          try {
            if(!c||typeof c!=='object') throw reject();
            // node-oracledb connections default to zero; install the private bound first.
            c.callTimeout=timeout;
            if(c.callTimeout!==timeout||!connectionShape(c)) throw reject();
            for(const method of ['execute','commit','rollback']) {
              const original=c[method].bind(c);
              c[method]=(...args)=>track(()=>original(...args));
              if(typeof c[method]!=='function') throw reject();
            }
            return c;
          } catch { try { await c?.close(); } catch {} throw reject(); }
        };
        writer=await acquire(routes.writer);if(retired||poisoned) throw reject();
        ledgerOwner=await acquire(routes.ledgerOwner);if(retired||poisoned||writer===ledgerOwner) throw reject();
        const target=await installed.bindTarget(fixed.request,fixed.permit,writer,ledgerOwner,routes.ledgerOwnerName);
        if(retired||poisoned||!isRecord(target)||target.writer!==writer||target.ledgerOwner!==ledgerOwner
          ||target.ledgerOwnerName!==routes.ledgerOwnerName
          ||!['attest','verifyEmptyTarget','claimDispatch','verifyPostconditions','centralEvidenceComplete'].every(k=>typeof target[k]==='function')) throw reject();
        const wrapped={writer,ledgerOwner,ledgerOwnerName:routes.ledgerOwnerName};
        for(const name of ['attest','verifyEmptyTarget','claimDispatch','verifyPostconditions','centralEvidenceComplete']) {
          const method=target[name];wrapped[name]=(...args)=>track(()=>method.apply(target,args));
        }
        callbackStarted=true;
        try { result=await run(Object.freeze(wrapped)); }
        finally { if(pending.size) poisoned=true;ending=true;await waitPending(); }
        if(retired||poisoned) throw reject();
        return result;
      } catch { ending=true;poisoned=true;await waitPending();retired=true;throw reject(); }
      finally {
        ending=true;await waitPending();
        for(const c of new Set([ledgerOwner,writer])) if(c) { try { await c.close(); } catch { closeFailed=true; } }
        active=false;retired=true;
        if(closeFailed||!callbackStarted) throw reject();
      }
    }
  });
}
