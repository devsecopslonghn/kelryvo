#!/usr/bin/env bash
set -u
run_dir=$(cd "$(dirname "$0")" && pwd)
seq=$(find "$run_dir" -maxdepth 1 -name 'command-*.json' | wc -l | tr -d ' ')
seq=$(printf '%03d' "$((seq + 1))")
cmd="$*"
python3 - "$run_dir/command-$seq.json" "$cmd" <<'PY'
import json,sys
with open(sys.argv[1],'x') as f: json.dump({'command':sys.argv[2],'started_utc':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()},f,indent=2); f.write('\n')
PY
set +e
bash -lc "$cmd" >"$run_dir/command-$seq.stdout" 2>"$run_dir/command-$seq.stderr"
status=$?
set -e
python3 - "$run_dir/command-$seq.json" "$status" <<'PY'
import json,sys
p=sys.argv[1]
d=json.load(open(p)); d['exit_code']=int(sys.argv[2]); json.dump(d,open(p,'w'),indent=2); open(p,'a').write('\n')
PY
cat "$run_dir/command-$seq.stdout"
cat "$run_dir/command-$seq.stderr" >&2
exit "$status"
