"""Bounded client checks for the existing file-controlled lab proxy protocol."""
from datetime import datetime, timezone
import hashlib

STATUS_FIELDS={'mode','listening','active','bufferedBytes','acceptedConnections','rejectedConnections','cutConnections','upstreamErrors','capturedOracleBytes','releasedOracleBytes','bufferOverflow','updatedAt'}
COUNTERS=STATUS_FIELDS-{'mode','listening','active','bufferOverflow','updatedAt'}
class ProtocolError(ValueError):pass

def stamp(value):
 try:
  result=datetime.fromisoformat(value.replace('Z','+00:00'))
  if result.tzinfo is None:raise ValueError()
  return result.timestamp()
 except (TypeError,ValueError,AttributeError):raise ProtocolError('INVALID_TIMESTAMP')

def sample(value,pod_uid,now=None):
 if not isinstance(value,dict) or set(value)!={'podUid','observedAt','status'} or value['podUid']!=pod_uid:raise ProtocolError('POD_IDENTITY')
 current=stamp(now) if isinstance(now,str) else (now or datetime.now(timezone.utc)).timestamp()
 observed=stamp(value['observedAt'])
 if not -1<=current-observed<=5:raise ProtocolError('CURRENT_OBSERVATION_REPLAY')
 status=value['status']
 if not isinstance(status,dict) or set(status)!=STATUS_FIELDS:raise ProtocolError('STATUS_SHAPE')
 if status['mode'] not in ('PASS','BUFFER','CUT'):raise ProtocolError('MODE')
 if any(type(status[k]) is not bool for k in ('listening','active','bufferOverflow')):raise ProtocolError('BOOLEAN_SHAPE')
 if any(type(status[k]) is not int or not 0<=status[k]<=2**53-1 for k in COUNTERS):raise ProtocolError('COUNTER_SHAPE')
 if not status['listening'] or status['bufferOverflow'] or status['bufferedBytes']>2*1024*1024:raise ProtocolError('PROXY_BOUNDARY')
 age=stamp(value['observedAt'])-stamp(status['updatedAt'])
 if not -1<=age<=5:raise ProtocolError('CURRENT_STATUS_STALE')
 return status

def baseline(value,pod_uid):
 status=sample(value,pod_uid,now=value['observedAt'])
 if status['mode']!='BUFFER' or not status['active'] or status['bufferedBytes']!=0:raise ProtocolError('BASELINE_NOT_PAUSED_EMPTY_BUFFER')
 return value

def transition(old,current,pod_uid,cut=False,buffered=None,now=None):
 # A baseline is validated against its capture time, never aged against a later poll.
 prior=sample(baseline(old,pod_uid),pod_uid,now=old['observedAt'])
 now=sample(current,pod_uid,now=now)
 if stamp(current['observedAt'])<stamp(old['observedAt']):raise ProtocolError('OBSERVATION_ORDER')
 for field in ('acceptedConnections','rejectedConnections','upstreamErrors','releasedOracleBytes'):
  if now[field]!=prior[field]:raise ProtocolError('UNEXPECTED_'+field.upper())
 captured=now['capturedOracleBytes']-prior['capturedOracleBytes']
 if captured<=0 or captured!=now['bufferedBytes']:raise ProtocolError('WITHHELD_BYTE_ACCOUNTING')
 if cut:
  if now['mode']!='CUT' or now['active'] or now['cutConnections']!=prior['cutConnections']+1:raise ProtocolError('CUT_NOT_CONFIRMED')
  if buffered is None:raise ProtocolError('BUFFER_WITNESS_MISSING')
  if stamp(current['observedAt'])<stamp(buffered['observedAt']):raise ProtocolError('CUT_BEFORE_BUFFER_WITNESS')
  held=transition(old,buffered,pod_uid,now=buffered['observedAt'])
  if now['bufferedBytes']<held['bufferedBytes']:raise ProtocolError('BUFFER_LOSS')
 else:
  if now['mode']!='BUFFER' or not now['active'] or now['cutConnections']!=prior['cutConnections']:raise ProtocolError('BUFFER_NOT_ACTIVE')
 return now

def ready(value,case):
 expected=hashlib.sha256(case['nonce'].encode()).hexdigest()
 if value.get('format')!=2 or value.get('jobId')!=case['jobId'] or value.get('planId')!=case['planId'] or value.get('mode')!='LOST_ACK' or value.get('exactOwner')!=case['exactOwner'] or value.get('statementDigests')!=case['statementDigests'] or value.get('nonceSha256')!=expected or value.get('stage')!='BEFORE_PROXY_BUFFER' or value.get('pauseBeforeOrdinal')!=1 or value.get('statementDigest')!=case['statementDigests'][0]:raise ProtocolError('READY_CASE_BINDING')
 c=value.get('counters',{})
 if any(type(c.get(k)) is not int for k in ('nativeWriterExecuteCalls','priorAcknowledgedWriterCalls','matchingStatementCalls','pausedBeforeOrdinal')):raise ProtocolError('READY_COUNTER_TYPE')
 if c.get('nativeWriterExecuteCalls')!=0 or c.get('priorAcknowledgedWriterCalls')!=0 or c.get('matchingStatementCalls')!=1 or c.get('pausedBeforeOrdinal')!=1:raise ProtocolError('READY_NATIVE_BOUNDARY')
 return value
