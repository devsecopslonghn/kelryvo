import datetime, hashlib, json, pathlib, sys
root = pathlib.Path.cwd()
run = root / 'evidence/product/t15-approval-integrity-20261009T071325Z'
source_paths = [
    'apps/api/index.ts', 'apps/web/src/app.jsx', 'scripts/test-product.mjs',
    'tests/product-approval-integrity.test.mjs', 'tests/product-approval-integrity-browser.integration.mjs',
    'tests/product-comments.test.mjs', 'tests/product-decision-record.test.mjs',
    'tests/product-decision-record-browser.integration.mjs', 'docs/development/local-product.md',
]
def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()
all_command_json = sorted(run.glob('command-*.json'))
# This script runs under the command runner; the newest metadata file is its own
# incomplete record and is deliberately excluded from the immutable input set.
current_meta = all_command_json[-1] if all_command_json else None
logs = []
for path in sorted(run.glob('command-*')):
    if path == current_meta or not path.is_file():
        continue
    if path.suffix in ('.stdout', '.stderr', '.request', '.json'):
        logs.append({'path': str(path.relative_to(root)), 'sha256': digest(path)})
commands = []
for path in all_command_json:
    if path == current_meta:
        continue
    try:
        commands.append(json.loads(path.read_text()))
    except Exception:
        continue
record = {
    'task_id': 'SF-PRODUCT-T15',
    'run_id': run.name,
    'recorded_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'base_head': '76826e92216ac7ddda16b66448d4ce29d8521776',
    'source_sha256': [{'path': p, 'sha256': digest(root / p)} for p in source_paths],
    'command_records': commands,
    'raw_log_sha256': logs,
    'checks': [
        {'command': 'npm ci', 'exit_code': 0, 'result': 'installed 60 packages; audit reported zero vulnerabilities'},
        {'command': 'npm run check', 'exit_code': 0, 'result': '143 standard tests passed; zero skips; build, typecheck, lint, formatting, dependency smoke and product license closure passed'},
        {'command': 'npm run test:product', 'exit_code': 0, 'result': '23 product tests passed; zero skips'},
        {'command': 'npm run test:browser', 'exit_code': 0, 'result': '13 browser tests passed; zero skips'},
        {'command': 'focused approval API regression', 'exit_code': 0, 'result': '1 test passed; source/hash/manifest/item mismatches, bounded oversized item, auth/archive/foreign-org paths, no-write snapshots, release row-lock race, registry-free valid approval and damaged-source rejection'},
        {'command': 'focused approval browser regression', 'exit_code': 0, 'result': '1 test passed; fixed integrity feedback and authorized rejection recovery'},
        {'command': 'git diff --check, format:check, check-source', 'exit_code': 0, 'result': 'passed'},
    ],
    'preserved_failed_attempts': 'Initial focused browser invocations failed on missing frontend build and assertion whitespace; both raw outputs remain in the run folder. Full browser attempts failing only on the same assertion are preserved. Final full browser suite passed after the focused correction.',
    'scope_notes': [
        'Approval verifies a locked project scoped VALID release with the existing retained-release verifier, then compares bounded ordered plan file facts before decision writes.',
        'REJECT skips retained-source verification; authorization and terminal denials remain separately audited.',
        'The existing composite foreign keys prevent cross-project release linkage; foreign-organization plan references return NOT_FOUND without writes.',
        'No target connection, credential resolution, worker execution, schema change or Oracle behavior is claimed.',
        'Current command-runner self-capture metadata is excluded from this record because its exit metadata is finalized after this process; the parent can independently hash that final raw log set.'
    ],
}
(run / 'root-record.json').write_text(json.dumps(record, indent=2) + '\n')
# Record generation intentionally emits no stdout/stderr so its captured self logs stay empty.
