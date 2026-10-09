import sys, subprocess, json, datetime, hashlib
from pathlib import Path
config=Path('/tmp/schemaforge-t17-root-capture.json')
if sys.argv[1]=='init':
 root=Path('/home/longhn0710/workspace/schemaforge-product-offline-plan-intent')
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
 target=root/'evidence/product'/('product-t17-root-'+stamp)
 target.mkdir(exist_ok=False)
 config.write_text(json.dumps({'root':str(root),'target':str(target)}))
 print(str(target)); sys.exit(0)
cfg=json.loads(config.read_text()); root=Path(cfg['root']); target=Path(cfg['target'])
label=sys.argv[1]; command=sys.argv[2]
start=datetime.datetime.now(datetime.timezone.utc).isoformat()
meta=target/(label+'.command.json'); log=target/(label+'.log'); result=target/(label+'.result.json')
for p in [meta,log,result]:
 if p.exists(): raise RuntimeError('capture already exists: '+str(p))
meta.write_text(json.dumps({'command':command,'cwd':str(root),'started_at_utc':start},indent=2)+'\n')
with log.open('xb') as stream:
 proc=subprocess.run(['bash','-c',command],cwd=root,stdout=stream,stderr=subprocess.STDOUT)
record={'command':command,'cwd':str(root),'started_at_utc':start,'ended_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit_code':proc.returncode,'raw_output':{'path':str(log.relative_to(root)),'sha256':hashlib.sha256(log.read_bytes()).hexdigest()}}
result.write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record)); sys.exit(proc.returncode)
