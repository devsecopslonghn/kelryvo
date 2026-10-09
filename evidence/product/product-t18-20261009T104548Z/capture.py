#!/usr/bin/env python3
"""Capture a product verification command with UTC times, raw output, and source hashes."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

root = Path(__file__).resolve().parents[3]
folder = Path(__file__).resolve().parent
if len(sys.argv) < 3:
    raise SystemExit('usage: capture.py LABEL COMMAND [ARG ...]')
label = sys.argv[1]
command = sys.argv[2:]
run_number = len(list(folder.glob("*.result.json"))) + 1
stem = f"{run_number:02d}-{label}"
paths = [
    'apps/web/src/app.jsx', 'scripts/test-product.mjs', 'docs/development/local-product.md',
    'tests/product-plan-resubmission.test.mjs', 'tests/product-plan-resubmission-browser.integration.mjs',
]
hashes = {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in paths}
source_digest = hashlib.sha256(''.join(f'{name}\0{hashes[name]}\n' for name in sorted(hashes)).encode()).hexdigest()
started = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
proc = subprocess.run(command, cwd=root, env=os.environ.copy(), stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
ended = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
(folder / f'{stem}.command.json').write_text(json.dumps({'command': command}, indent=2) + '\n')
(folder / f'{stem}.raw.log').write_bytes(proc.stdout)
result = {
    'label': label, 'command': command, 'startedUtc': started, 'endedUtc': ended,
    'exitCode': proc.returncode, 'sourceSnapshotSha256': source_digest,
    'sourceFileSha256': hashes, 'rawOutputSha256': hashlib.sha256(proc.stdout).hexdigest(),
    'rawOutputPath': f'{stem}.raw.log',
}
(folder / f'{stem}.result.json').write_text(json.dumps(result, indent=2) + '\n')
sys.stdout.buffer.write(proc.stdout)
raise SystemExit(proc.returncode)
