from client import *
from lost_ack_protocol import sample, baseline, transition, ready, stamp
import time,hashlib,traceback

APP_NS='kelryvo'; LAB_NS='kelryvo-oracle-lab'
PIN_IMAGE='longhn0710t/kelryvo-pilot@sha256:cd46b7c5e95fd02896dc0877196a2190d886da1a3ff571561b5d2c012b2e3398'
RUNTIME='/run/kelryvo/runtime/execution'
policy=json.loads((ROOT/'FAULT-controller-policy.json').read_text())
s=load();case=s['cases']['FAULT'];pod=None;proxy=None;enabled=False;cut=False
trace=[]
def utc():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def retain(label,value):
 trace.append({'label':label,'observedAt':utc(),'monotonicNs':time.monotonic_ns(),'value':value})
 (ROOT/'FAULT-controller-trace.private.json').write_text(json.dumps(trace,indent=2)+'\n')
def kube(ns,args,input=None,timeout=12):
 p=subprocess.run(['kubectl','--context=k8s-admin-public','--request-timeout=8s','-n',ns,*args],input=input,capture_output=True,text=True,timeout=timeout)
 if p.returncode:
  (ROOT/'FAULT-control-error.private.txt').write_text(p.stderr)
  raise RuntimeError('Pinned lab control failed')
 return p.stdout
def obj(ns,kind,name):return json.loads(kube(ns,['get',kind,name,'-o','json']))
def pinned(ns,p):
 current=obj(ns,'pod',p['metadata']['name'])
 assert current['metadata']['uid']==p['metadata']['uid'] and not current['metadata'].get('deletionTimestamp'),'Pinned Pod changed'
 return current
def node(ns,p,code,input=None):
 return json.loads(kube(ns,['exec','-i',p['metadata']['name'],'--','node','--input-type=module','--eval',code],input))
def mode(value):
 assert value in ('PASS','BUFFER','CUT')
 pinned(LAB_NS,proxy)
 return node(LAB_NS,proxy,"import fs from 'node:fs';const v=fs.readFileSync(0,'utf8');if(!['PASS','BUFFER','CUT'].includes(v))throw Error('mode');fs.writeFileSync('/run/control/mode',v+'\\n',{flag:'w'});console.log(JSON.stringify({at:new Date().toISOString(),mode:v}));",value)
def proxy_state():
 value=node(LAB_NS,proxy,"import fs from 'node:fs';console.log(JSON.stringify({observedAt:new Date().toISOString(),status:JSON.parse(fs.readFileSync('/run/control/status.json','utf8'))}));")
 return {'podUid':proxy['metadata']['uid'],**value}
def app_state():
 return node(APP_NS,pod,"import fs from 'node:fs';process.setgid(10002);process.setuid(10002);const o={observedAt:new Date().toISOString()};for(const [k,n] of [['ready','fault-ready.json'],['status','fault-status.json'],['lostAckReady','fault-lost-ack-ready.json']]){try{o[k]=JSON.parse(fs.readFileSync('/run/kelryvo/runtime/execution/'+n,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}console.log(JSON.stringify(o));")
def flag(value):
 d=obj(APP_NS,'deployment','kelryvo-app');c=d['spec']['template']['spec']['containers'][0];assert c['image']==PIN_IMAGE
 i=next(i for i,e in enumerate(c['env']) if e['name']=='KELRYVO_EXECUTION_ENABLED')
 if c['env'][i]['value']==value:return
 patch=[{'op':'test','path':'/metadata/resourceVersion','value':d['metadata']['resourceVersion']},{'op':'replace','path':f'/spec/template/spec/containers/0/env/{i}/value','value':value}]
 kube(APP_NS,['patch','deployment','kelryvo-app','--type=json','--patch-file=/dev/stdin'],json.dumps(patch))
def job():return request('GET','/api/execution-jobs/'+case['jobId'])['job']
def until(function,predicate,seconds,label):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  value=function()
  if predicate(value):return value
  time.sleep(.12)
 raise RuntimeError('Bounded wait failed: '+label)
def lease_witness():
 code="""import fs from 'node:fs';import {createRequire} from 'node:module';const postgres=createRequire('/opt/kelryvo/package.json')('postgres');process.setgid(10002);process.setuid(10002);const id=fs.readFileSync(0,'utf8');if(!/^[a-f0-9-]{36}$/.test(id))throw Error('id');const sql=postgres(fs.readFileSync('/run/kelryvo/runtime/execution/database-url','utf8').trim(),{max:1,onnotice:()=>{}});try{const rows=await sql`SELECT j.state,a.state AS attempt_state,a.lease_until,clock_timestamp() AS database_now,EXTRACT(EPOCH FROM (a.lease_until-clock_timestamp()))::float8 AS seconds_remaining FROM sf_execution_jobs j JOIN sf_execution_attempts a ON a.job_id=j.id WHERE j.id=${id} ORDER BY a.generation`;console.log(JSON.stringify({observedAt:new Date().toISOString(),rows}));}finally{await sql.end({timeout:2});}"""
 value=node(APP_NS,pod,code,case['jobId'])
 assert len(value['rows'])==1
 row=value['rows'][0];assert row['state']=='ADMITTED' and row['attempt_state']=='CLAIMED' and row['seconds_remaining']>8
 assert abs(stamp(value['observedAt'])-stamp(row['database_now']))<2
 return value
def fault_table():
 sql="""set heading off feedback off pagesize 0 linesize 32767
whenever sqlerror exit failure rollback
alter session set container=KP_LOST_ACK4;
select 'GUID|'||rawtohex(guid) from v$containers where con_id=sys_context('USERENV','CON_ID');
select 'COLUMN|'||table_name||'|'||column_name||'|'||data_type||'|'||column_id from dba_tab_columns where owner='KP_FAULT_B' order by table_name,column_id;
select 'OBJECT|'||object_type||'|'||object_name from dba_objects where owner='KP_FAULT_B' and subobject_name is null order by object_type,object_name;
"""
 raw=kube(LAB_NS,['exec','-i','oracle-free-0','--','sqlplus','-s','/','as','sysdba'],sql)
 lines=[x.strip() for x in raw.splitlines() if x.strip()]
 assert 'GUID|5E95FDD6F58AC1FEE0638101F40A1707' in lines
 return lines
try:
 scope=json.loads((ROOT/'FAULT-scope.json').read_text())
 assert scope['jobId']==case['jobId'] and scope['planId']==case['planId'] and scope['controllerSha256']==hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
 assert scope['scope']=='FRESH_SCHEMA_SINGLE_NATIVE_DDL_LOST_ACK' and stamp(scope['expiresAt'])>time.time()+300
 assert obj(LAB_NS,'pod','oracle-free-0')['metadata']['uid']==scope['oraclePodUid']
 assert case['jobId']==policy['jobId'] and case['planId']==policy['planId'] and policy['exactOwner']=='KP_FAULT_B'
 assert stamp(policy['expiresAt'])>time.time()+300
 pre=json.loads((ROOT/'FAULT-preflight-restaged.stdout').read_text());assert pre['status']=='PASS' and pre['nativeDdlAttempts']==0 and pre['jobId']==case['jobId']
 assert stamp(s['observation']['expiresAt'])>time.time()+180,'Observation too close to expiry; do not enable worker'
 assert job()['state']=='WAITING_VALIDATION'
 d=obj(APP_NS,'deployment','kelryvo-app');assert next(e['value'] for e in d['spec']['template']['spec']['containers'][0]['env'] if e['name']=='KELRYVO_EXECUTION_ENABLED')=='false'
 proxies=json.loads(kube(LAB_NS,['get','pods','-l','app.kubernetes.io/name=oracle-fault-proxy','-o','json']))['items']
 assert len(proxies)==1;proxy=proxies[0]
 assert proxy['metadata']['uid']=='4b347bb7-7ba1-4fba-a854-53d419f4b338'
 before=proxy_state();status=sample(before,proxy['metadata']['uid']);assert status['mode']=='PASS' and not status['active'] and status['bufferedBytes']==0
 retain('proxy_before_enable',before)
 target=fault_table();assert not any(x.startswith(('OBJECT|','COLUMN|')) for x in target);retain('empty_fresh_fault_schema',target)
 enabled=True;flag('true');print('Fresh exact fault job enabled once',flush=True)
 end=time.monotonic()+75
 while time.monotonic()<end:
  pods=json.loads(kube(APP_NS,['get','pods','-l','app.kubernetes.io/component=app,app.kubernetes.io/instance=kelryvo','-o','json']))['items']
  matches=[p for p in pods if not p['metadata'].get('deletionTimestamp') and p.get('status',{}).get('containerStatuses') and p['status']['containerStatuses'][0].get('state',{}).get('running') and next(e['value'] for e in p['spec']['containers'][0]['env'] if e['name']=='KELRYVO_EXECUTION_ENABLED')=='true']
  if len(matches)==1:pod=matches[0];break
  time.sleep(.15)
 assert pod is not None,'Enabled runtime did not start'
 retain('pinned_runtime',{'name':pod['metadata']['name'],'uid':pod['metadata']['uid'],'image':pod['spec']['containers'][0]['image']})
 paused=until(app_state,lambda a:'ready' in a,25,'native pause')
 ready(paused['ready'],policy);assert abs(stamp(paused['observedAt'])-stamp(paused['ready']['readyAt']))<10
 retain('writer_paused_before_native_call',paused)
 retain('central_admitted_at_native_pause',lease_witness())
 retain('set_buffer',mode('BUFFER'))
 base=until(proxy_state,lambda a:a['status']['mode']=='BUFFER' and a['status']['active'],3,'BUFFER active')
 baseline(base,proxy['metadata']['uid']);sample(base,proxy['metadata']['uid']);retain('immutable_buffer_baseline',base)
 release={k:policy[k] for k in ('nonce','jobId','planId')}
 result=node(APP_NS,pod,"import fs from 'node:fs';process.setgid(10002);process.setuid(10002);const v=JSON.parse(fs.readFileSync(0,'utf8'));const p='/run/kelryvo/runtime/execution/fault-release.json';const f=fs.openSync(p,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(f,JSON.stringify(v)+'\\n');fs.fsyncSync(f);fs.closeSync(f);console.log(JSON.stringify({releasedAt:new Date().toISOString(),uid:process.getuid()}));",json.dumps(release))
 retain('one_use_release_written',result)
 buffered=until(proxy_state,lambda a:a['status']['bufferedBytes']>0,5,'withheld native response')
 transition(base,buffered,proxy['metadata']['uid']);retain('native_response_withheld',buffered)
 target=fault_table();assert target==['GUID|5E95FDD6F58AC1FEE0638101F40A1707','COLUMN|KELRYVO_LOST_ACK_T|ID|NUMBER|1','OBJECT|TABLE|KELRYVO_LOST_ACK_T'];retain('independent_table_effect_before_cut',target)
 pending=app_state();assert pending['status']['stage']=='LOST_ACK_NATIVE_EXECUTE_PENDING' and pending['status']['counters']['nativeWriterExecuteCalls']==1;retain('native_pending_before_cut',pending)
 retain('unexpired_central_lease_before_cut',lease_witness())
 pinned(APP_NS,pod);retain('cut_requested',mode('CUT'));cut=True
 severed=until(proxy_state,lambda a:a['status']['mode']=='CUT' and not a['status']['active'],3,'cut confirmed')
 transition(base,severed,proxy['metadata']['uid'],cut=True,buffered=buffered);retain('cut_confirmed',severed)
 rejected=until(app_state,lambda a:a.get('status',{}).get('stage')=='NATIVE_DRIVER_REJECTED_AFTER_RELEASE',8,'actual native rejection')
 counters=rejected['status']['counters'];assert counters['nativeWriterExecuteCalls']==1 and counters['priorAcknowledgedWriterCalls']==0;retain('actual_native_driver_rejection',rejected)
 held=until(job,lambda j:j['state']=='HOLD',45,'central HOLD');retain('central_hold',held)
 record=request('GET','/api/execution-jobs/'+case['jobId']+'/record');(ROOT/'FAULT-execution-record.json').write_text(json.dumps(record,indent=2)+'\n')
 parsed=json.loads(record['record']);assert len(parsed['attempts'])==1 and parsed['attempts'][0]['state']=='HOLD' and not parsed['attempts'][0]['receipts']
 assert sum(e['phase']=='STARTED' for e in parsed['attempts'][0]['events'])==1
 assert not any(e['phase']=='ACKNOWLEDGED' for e in parsed['attempts'][0]['events'])
 assert stamp(held['updatedAt'])>=stamp(severed['status']['updatedAt'])-1,'HOLD ordering outside observed clock bound'
 assert proxy_state()['status']['acceptedConnections']==severed['status']['acceptedConnections'],'Unexpected writer reconnect after cut'
 case['finalJob']=held;case['controllerResult']='NATIVE_REJECTION_AND_CUT_BEFORE_OBSERVED_HOLD';save(s)
 retain('controller_complete',{'status':'PASS','statementNativeCalls':1,'priorAcknowledgedWriterCalls':0,'automaticReplay':False})
 print('Lost-ack observation PASS: table exists, response withheld/cut, native rejection captured, HOLD retained',flush=True)
except BaseException:
 (ROOT/'FAULT-controller-failure.private.txt').write_text(traceback.format_exc())
 retain('controller_failed',{'status':'FAIL','noReplay':True})
 print('Fault controller stopped; retain all evidence and never replay this request',flush=True)
 raise
finally:
 # CUT is fail closed. Never return BUFFER to PASS or flush a withheld response.
 if proxy is not None and enabled:
  try:retain('final_fail_closed_cut',mode('CUT'))
  except Exception:pass
 if enabled:
  flag('false');print('Execution disabled; fault target and journals retained',flush=True)
