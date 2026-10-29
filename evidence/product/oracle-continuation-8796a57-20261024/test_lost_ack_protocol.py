import copy,unittest,ast,subprocess,tempfile
from pathlib import Path
from datetime import datetime,timedelta,timezone
from lost_ack_protocol import baseline,transition,sample,ProtocolError,ready
import hashlib

class ProtocolChecks(unittest.TestCase):
 def setUp(self):
  self.uid='owned-pod-uid';self.start=datetime(2026,10,24,11,0,tzinfo=timezone.utc)
  self.base=self.point(0,mode='BUFFER',active=True,acceptedConnections=7)
 def point(self,seconds,**changes):
  time=(self.start+timedelta(seconds=seconds)).isoformat()
  s=dict(mode='PASS',listening=True,active=False,bufferedBytes=0,acceptedConnections=0,rejectedConnections=0,cutConnections=2,upstreamErrors=0,capturedOracleBytes=1000,releasedOracleBytes=0,bufferOverflow=False,updatedAt=time);s.update(changes)
  return dict(podUid=self.uid,observedAt=time,status=s)
 def check(self,*args,**kwargs):return transition(*args,**kwargs,now=self.start+timedelta(seconds=91))
 def buffer(self,seconds=90):return self.point(seconds,mode='BUFFER',active=True,acceptedConnections=7,bufferedBytes=68,capturedOracleBytes=1068)
 def test_historical_baseline_is_not_rejected_as_stale(self):
  baseline(self.base,self.uid);held=self.buffer();self.check(self.base,held,self.uid)
  cut=self.point(91,mode='CUT',acceptedConnections=7,bufferedBytes=68,capturedOracleBytes=1068,cutConnections=3)
  self.check(self.base,cut,self.uid,cut=True,buffered=held)
 def test_stale_current_status_is_rejected(self):
  current=self.buffer();current['status']['updatedAt']=self.start.isoformat()
  with self.assertRaises(ProtocolError):self.check(self.base,current,self.uid)
 def test_replaying_an_old_current_observation_is_rejected(self):
  with self.assertRaises(ProtocolError):transition(self.base,self.buffer(),self.uid,now=self.start+timedelta(seconds=180))
 def test_changed_pod_is_rejected(self):
  value=self.buffer();value['podUid']='replacement'
  with self.assertRaises(ProtocolError):self.check(self.base,value,self.uid)
 def test_released_buffer_new_connection_retry_error_overflow_or_corruption_fails(self):
  for k,v in [('releasedOracleBytes',1),('acceptedConnections',8),('rejectedConnections',1),('upstreamErrors',1),('bufferOverflow',True),('capturedOracleBytes',1069),('bufferedBytes',0),('active',False),('cutConnections',3)]:
   with self.subTest(field=k):
    value=self.buffer();value['status'][k]=v
    with self.assertRaises(ProtocolError):self.check(self.base,value,self.uid)
 def test_counter_types_and_bounds_fail(self):
  for value in [True,-1,1.5,2**53]:
   v=self.buffer();v['status']['capturedOracleBytes']=value
   with self.assertRaises(ProtocolError):sample(v,self.uid,now=self.start+timedelta(seconds=91))
 def test_double_cut_or_cut_without_buffer_witness_fails(self):
  v=self.point(91,mode='CUT',acceptedConnections=7,bufferedBytes=68,capturedOracleBytes=1068,cutConnections=4)
  with self.assertRaises(ProtocolError):self.check(self.base,v,self.uid,cut=True,buffered=self.buffer())
  v['status']['cutConnections']=3
  with self.assertRaises(ProtocolError):self.check(self.base,v,self.uid,cut=True)
 def test_cut_cannot_precede_its_withheld_response_witness(self):
  cut=self.point(89,mode='CUT',acceptedConnections=7,bufferedBytes=68,capturedOracleBytes=1068,cutConnections=3)
  with self.assertRaises(ProtocolError):self.check(self.base,cut,self.uid,cut=True,buffered=self.buffer())
 def test_paused_controller_has_no_locking_http_calls(self):
  source=Path(__file__).with_name('run-lost-ack.py').read_text()
  paused=source[source.index(' paused=until('):source.index(' rejected=until(')]
  for node in ast.walk(ast.parse('if True:\n'+paused)):
   if isinstance(node,ast.Call) and isinstance(node.func,ast.Name):self.assertNotIn(node.func.id,{'request','job'})
 def test_exact_mode_client_payload_is_newline_terminated(self):
  source=ast.parse(Path(__file__).with_name('run-lost-ack.py').read_text())
  constants=[n.value for n in ast.walk(source) if isinstance(n,ast.Constant) and isinstance(n.value,str) and "fs.writeFileSync('/run/control/mode'" in n.value]
  self.assertEqual(len(constants),1)
  with tempfile.TemporaryDirectory() as directory:
   target=Path(directory)/'mode'
   code=constants[0].replace("'/run/control/mode'",repr(str(target)))
   subprocess.run(['node','--input-type=module','--eval',code],input='BUFFER',text=True,capture_output=True,check=True,timeout=5)
   self.assertEqual(target.read_bytes(),b'BUFFER\n')
 def test_nonce_and_exact_ready_boundary(self):
  case=dict(jobId='job',planId='plan',exactOwner='KP_FAULT_A',statementDigests=['digest'],nonce='a'*64)
  v=dict(format=2,jobId='job',planId='plan',exactOwner='KP_FAULT_A',statementDigests=['digest'],mode='LOST_ACK',nonceSha256=hashlib.sha256(case['nonce'].encode()).hexdigest(),stage='BEFORE_PROXY_BUFFER',pauseBeforeOrdinal=1,statementDigest='digest',counters=dict(nativeWriterExecuteCalls=0,priorAcknowledgedWriterCalls=0,matchingStatementCalls=1,pausedBeforeOrdinal=1))
  ready(v,case)
  for key,val in [('jobId','other'),('planId','other'),('nonceSha256','0'*64),('stage','AFTER_DDL'),('statementDigest','other'),('pauseBeforeOrdinal',2)]:
   bad=copy.deepcopy(v);bad[key]=val
   with self.assertRaises(ProtocolError):ready(bad,case)
  bad=copy.deepcopy(v);bad['counters']['nativeWriterExecuteCalls']=1
  with self.assertRaises(ProtocolError):ready(bad,case)

if __name__=='__main__':unittest.main()
