#!/usr/bin/env python3
"""Opt-in installed-binary integration against an isolated disposable Oracle fixture.

Run as the fixture OS operator, inside its mount/network/PID/IPC namespaces.
The fixture supplies a real native installation, private PostgreSQL, a read-only
Git repository, API TLS certificate, and two operator-issued local credentials.
This runner never provisions Oracle, changes external infrastructure, or treats
fixture acceptance as release qualification. Its default metadata fault rejects
only VERIFIED_SUCCESS; the opt-in ACK case requires a separate private proxy and
read-only observer. Both retain all product guards and immutable history.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import ssl
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path('/opt/kelryvo-fixture')
PRIVATE = ROOT / 'private'
SECRETS = Path('/run/kelryvo/secrets')
BINARY = Path('/opt/kelryvo/bin/kelryvo-worker')
INSTALLATION = Path('/run/kelryvo/runtime/execution/installation.json')
ENV = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC',
       'PGPASSFILE': str(PRIVATE / 'pgpass')}
ORIGIN = 'https://127.0.0.1:8443'
IMAGE_ROOT = os.environ.get('KELRYVO_RUST_INSTALLED_IMAGE_ROOT')
RUNTIME_WORKER_PID = os.environ.get('KELRYVO_RUST_INSTALLED_RUNTIME_WORKER_PID')


def native_command(args, uid=None):
    if IMAGE_ROOT is None:
        return args
    root = Path(IMAGE_ROOT)
    assert root.is_absolute() and root.name == 'app-root'
    assert root.parent.name == 'native-oracle-fixture' and root.parent.parent.name == '.cache'
    assert root.is_dir() and not root.is_symlink()
    privilege = ['--bounding-set=-all,+chown,+kill,+setuid,+setgid'] if uid is None else [
        '--bounding-set=-all', f'--reuid={uid}', f'--regid={uid}', '--clear-groups',
    ]
    return ['/usr/sbin/chroot', root, '/usr/bin/setpriv', *privilege, '--no-new-privs', *args]


def require_isolated_network(links, addresses, routes):
    names = {link['ifname'] for link in links}
    assert names in ({'lo'}, {'lo', 'oracle0'}) and len(links) == len(names)
    for link in links:
        if link['ifname'] == 'lo':
            assert link['link_type'] == 'loopback'
        else:
            # Newer Oracle Free builds need a non-loopback IPv4 address for
            # local IPC. A dummy has no peer and cannot provide external access.
            assert link.get('linkinfo', {}).get('info_kind') == 'dummy'
            assert not any(key in link for key in ('link_index', 'link_netnsid'))
    assert {entry['ifname'] for entry in addresses} == names
    for entry in addresses:
        actual = {(a['family'], a['local'], a['prefixlen']) for a in entry['addr_info']}
        if entry['ifname'] == 'lo':
            assert actual in ({('inet', '127.0.0.1', 8)},
                              {('inet', '127.0.0.1', 8), ('inet6', '::1', 128)})
        else:
            assert actual == {('inet', '192.0.2.1', 32)}
    for route in routes:
        assert not any(key in route for key in ('gateway', 'nexthops', 'via'))
        assert route.get('table') == 'local'
        assert route.get('type') in ('local', 'broadcast')
        if route.get('dev') == 'lo':
            assert route.get('dst') in ('127.0.0.0/8', '127.0.0.1', '127.255.255.255', '::1')
        else:
            assert 'oracle0' in names and route.get('dev') == 'oracle0'
            assert route.get('type') == 'local' and route.get('dst') == '192.0.2.1'


def require_fixture():
    assert os.getuid() == 0, 'The disposable fixture OS operator is required'
    assert socket.gethostname() == 'kelryvo-oracle-fixture'
    network = [json.loads(subprocess.check_output(['/usr/sbin/ip', '-j', *args], env=ENV))
               for args in (['-d', 'link'], ['address'], ['route', 'show', 'table', 'all'])]
    require_isolated_network(*network)
    marker = json.loads((PRIVATE / 'installed-test-context.json').read_text())
    assert marker['kind'] == 'KELRYVO_DISPOSABLE_NATIVE_ORACLE_V1'
    for field in ('projectId', 'connectionId', 'environmentId'):
        assert str(uuid.UUID(marker[field])) == marker[field]
    installation = json.loads(INSTALLATION.read_text())
    assert installation['connectionId'] == marker['connectionId']
    assert installation['route']['host'] == '127.0.0.1'
    assert installation['route']['port'] == 2484
    owner, readers = fixture_schemas(marker)
    assert installation['readerSchemas'] == readers and owner in readers
    assert installation['metadataDatabase'] == {
        'host': '127.0.0.1', 'port': 15432,
        'database': 'kelryvo_rust_test', 'user': 'fixture',
    }
    if IMAGE_ROOT is not None:
        identity = json.loads((Path(IMAGE_ROOT) / 'opt/kelryvo/source-identity.json').read_text())
        assert installation['appImageDigest'] == marker['appImageDigest']
        info = json.loads(command([BINARY, '--build-info']))
        assert info['sourceTreeDigest'] == identity['sourceTreeDigest'] == marker['sourceTreeDigest']
        assert info['profile'] == 'release' and info['architecture'] == 'x86_64'
    return marker, installation


def fixture_schemas(marker):
    # These are synthetic fixture schemas, never a caller-supplied production
    # owner. Two streams allow independent faults without replaying a HOLD.
    owner = marker.get('schemaOwner', 'KRV_APP')
    readers = marker.get('readerSchemas', ['KRV_APP'])
    assert owner in ('KRV_APP', 'KRV_ACK')
    assert readers in (['KRV_APP'], ['KRV_ACK', 'KRV_APP']) and owner in readers
    return owner, readers


def fixture_target_id(stream_id):
    assert str(uuid.UUID(stream_id)) == stream_id
    return hashlib.sha256(json.dumps(['INSTANCE_SCHEMA_STREAM_V2', stream_id],
                                    separators=(',', ':')).encode()).hexdigest()


def private_json(name, value):
    path = PRIVATE / name
    path.write_text(json.dumps(value, separators=(',', ':')))
    path.chmod(0o600)


def command(args, stdin=None, uid=None):
    def drop():
        os.setgroups([])
        os.setgid(uid)
        os.setuid(uid)
    image_command = IMAGE_ROOT is not None and Path(args[0]) == BINARY
    result = subprocess.run(
        [str(arg) for arg in (native_command(args, uid) if image_command else args)], input=stdin, text=True,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV,
        preexec_fn=drop if uid is not None and not image_command else None, timeout=180,
    )
    if result.returncode:
        private_json('installed-test-command-failure.json', {
            'exitCode': result.returncode, 'stdout': result.stdout,
            'stderr': result.stderr,
        })
        raise AssertionError('Native command failed; inspect the private fixture diagnostics')
    return result.stdout


def sql(query):
    return command([
        '/usr/bin/psql', '-XAt', '-h', '127.0.0.1', '-p', '15432',
        '-U', 'fixture', '-d', 'kelryvo_rust_test', '-v', 'ON_ERROR_STOP=1',
    ], query).strip()


class Api:
    def __init__(self, role):
        self.headers = {
            'Origin': ORIGIN,
            'Authorization': 'Bearer ' + (SECRETS / f'{role}-token').read_text(),
        }
        self.context = ssl.create_default_context(cafile=str(SECRETS / 'tls.crt'))
        self.call('POST', '/api/session')

    def call(self, method, path, body=None, expected=None):
        data = None if body is None else json.dumps(body).encode()
        headers = dict(self.headers)
        if data is not None:
            headers['Content-Type'] = 'application/json'
        request = urllib.request.Request(ORIGIN + path, data, headers, method=method)
        try:
            response = urllib.request.urlopen(request, context=self.context, timeout=40)
        except urllib.error.HTTPError as error:
            raw = error.read()
            if expected == error.code:
                return None
            private_json('installed-test-http-failure.json', {
                'path': path, 'status': error.code, 'body': raw.decode(),
            })
            raise AssertionError(f'HTTP {error.code}: {method} {path}') from None
        assert expected is None or response.status == expected
        raw = response.read()
        value = json.loads(raw) if raw else None
        if method == 'POST' and path == '/api/session':
            self.headers = {
                'Origin': ORIGIN,
                'Cookie': response.headers['Set-Cookie'].split(';')[0],
                'x-csrf-token': value['csrfToken'],
            }
        return value

    def get(self, path):
        return self.call('GET', path)

    def post(self, path, body):
        return self.call('POST', path, body)


def worker_until(job, expected):
    if RUNTIME_WORKER_PID is not None:
        assert IMAGE_ROOT is not None and RUNTIME_WORKER_PID.isdecimal()
        process = Path('/proc') / RUNTIME_WORKER_PID
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            assert process.joinpath('root').resolve() == Path(IMAGE_ROOT)
            assert process.joinpath('cmdline').read_bytes().split(b'\0')[:2] == [
                str(BINARY).encode(), b'runtime-service',
            ]
            status = dict(line.split(':', 1) for line in process.joinpath('status').read_text().splitlines())
            assert status['Uid'].split() == ['10002'] * 4
            assert int(status['CapEff'].strip(), 16) == 0 and status['NoNewPrivs'].strip() == '1'
            state = sql(f"SELECT state FROM sf_execution_jobs WHERE id='{job}'")
            if state == expected:
                return
            assert state in ('WAITING_VALIDATION', 'ADMITTED'), f'Unexpected job state: {state}'
            time.sleep(.2)
        raise AssertionError('Runtime-managed installed execution did not reach the required terminal state')
    def drop():
        os.setgroups([])
        os.setgid(10002)
        os.setuid(10002)
    with (PRIVATE / f'installed-test-worker-{job}.log').open('a') as log:
        child = subprocess.Popen(
            native_command([BINARY, 'execution-service', INSTALLATION.parent / 'worker.json'], 10002),
            stdin=subprocess.DEVNULL, stdout=log, stderr=log,
            env=ENV, preexec_fn=drop if IMAGE_ROOT is None else None,
        )
        try:
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline:
                assert child.poll() is None, 'Installed execution service exited'
                state = sql(f"SELECT state FROM sf_execution_jobs WHERE id='{job}'")
                if state == expected:
                    return
                assert state in ('WAITING_VALIDATION', 'ADMITTED'), f'Unexpected job state: {state}'
                time.sleep(.2)
            raise AssertionError('Installed execution did not reach the required terminal state')
        finally:
            child.terminate()
            child.wait(timeout=10)
            assert child.returncode == 0, 'Execution service shutdown/reaping failed'


def wait_expired(job):
    # HOLD never shortens, renews or reclaims the original immutable lease.
    deadline = time.monotonic() + 310
    while sql(f"SELECT lease_until<=clock_timestamp() FROM sf_execution_attempts WHERE job_id='{job}' AND state='HOLD'") != 't':
        assert time.monotonic() < deadline, 'Original held lease did not expire'
        time.sleep(.5)


def dispatch_witness_file(native):
    directory = Path(native['witnessDirectory'])
    assert directory.is_absolute() and '..' not in directory.parts
    if IMAGE_ROOT is not None:
        # Installed paths belong to the worker's chroot, not the host driver.
        directory = Path(IMAGE_ROOT) / directory.relative_to('/')
    return directory / 'dispatch-preimages.jsonl'


def recover_held(developer, reviewer, held, native, project):
    dispatch_file = dispatch_witness_file(native)
    wait_expired(held)
    retained = sql(f"SELECT jsonb_build_object('job',to_jsonb(j),'attempts',(SELECT jsonb_agg(to_jsonb(a)) FROM sf_execution_attempts a WHERE a.job_id=j.id),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.ordinal) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id=j.id)) FROM sf_execution_jobs j WHERE j.id='{held}'")
    dispatch_after_hold = dispatch_file.read_bytes()
    preview = json.loads(command([BINARY, 'held-preview', held], uid=10002))
    assert preview['status'] == 'PREPARED' and preview['jobState'] == 'HOLD'
    revision = int(sql(f"SELECT revision FROM sf_execution_jobs WHERE id='{held}'"))
    reconciliation = developer.post(f'/api/execution-jobs/{held}/reconciliations', {
        'evidenceDigest': preview['evidenceDigest'], 'evidenceKind': 'TARGET_LEDGER',
        'expectedRevision': revision, 'reason': 'Review exact installed native held completion',
    })['reconciliation']['id']
    developer.call('POST', f'/api/execution-jobs/{held}/reconciliations/{reconciliation}/decision', {
        'decision': 'EVIDENCE_REVIEWED', 'expectedRevision': revision, 'reason': 'Self review must fail',
    }, expected=403)
    reviewer.post(f'/api/execution-jobs/{held}/reconciliations/{reconciliation}/decision', {
        'decision': 'EVIDENCE_REVIEWED', 'expectedRevision': revision,
        'reason': 'Independent review of exact native target-ledger evidence',
    })
    confirmed = json.loads(command([BINARY, 'held-confirm', held, reconciliation], uid=10002))
    repeated = json.loads(command([BINARY, 'held-confirm', held, reconciliation], uid=10002))
    assert confirmed['status'] == repeated['status'] == 'RECOVERED_APPLIED'
    assert not confirmed['repeated'] and repeated['repeated']
    after = sql(f"SELECT jsonb_build_object('job',to_jsonb(j),'attempts',(SELECT jsonb_agg(to_jsonb(a)) FROM sf_execution_attempts a WHERE a.job_id=j.id),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.ordinal) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id=j.id)) FROM sf_execution_jobs j WHERE j.id='{held}'")
    assert after == retained, 'Recovery cannot change HOLD, attempts, leases or receipts'
    assert dispatch_file.read_bytes() == dispatch_after_hold, 'Recovery must never replay SQL'
    completion = developer.get(f'/api/execution-jobs/{held}/reconciliations')['recoveredCompletion']
    assert completion['status'] == 'RECOVERED_APPLIED'
    assert not completion['executionAuthority'] and not completion['retryEligible']
    assert sql(f"SELECT count(*) FROM sf_audit WHERE project_id='{project}' AND resource_id='{held}' AND action='EXECUTION_RECOVERED_APPLIED'") == '1'
    print('PASS: native held preview, independent review, idempotent confirmation, unchanged HOLD and no replay', flush=True)
    return preview


def ack_monitor_files(migration_path):
    assert re.fullmatch(r'V[1-9][0-9]{0,3}__[a-z0-9_]{1,40}\.sql', migration_path)
    stem = 'oracle-ack-' + migration_path[:-4]
    return PRIVATE / (stem + '-ready.json'), PRIVATE / (stem + '-result.json')


def start_ack_monitor(stream_id, migration_path='V2__recovery.sql'):
    assert IMAGE_ROOT is not None, 'The ACK fixture requires the current exported image'
    node = Path(os.environ['KELRYVO_ACK_NODE'])
    assert node.is_absolute() and node.is_file()
    fixture = Path(IMAGE_ROOT).parent
    ready, report = ack_monitor_files(migration_path)
    assert not ready.exists() and not report.exists()
    environment = {**ENV, 'KELRYVO_ACK_FIXTURE_ROOT': str(fixture),
                   'KELRYVO_ACK_MIGRATION_PATH': migration_path,
                   'KELRYVO_ACK_TARGET_ID': fixture_target_id(stream_id),
                   'LD_LIBRARY_PATH': str(Path(IMAGE_ROOT) / 'opt/kelryvo/oracle/client')
                   + ':' + str(fixture / 'pki-tools')}
    log_path = ready.with_name(ready.name.replace('-ready.json', '.log'))
    with log_path.open('x') as log:
        log_path.chmod(0o600)
        child = subprocess.Popen([node, Path(__file__).with_name('oracle-ack-monitor.mjs')],
                                 env=environment, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    try:
        deadline = time.monotonic() + 20
        while not ready.exists():
            assert child.poll() is None, 'Read-only ACK monitor failed before admission'
            assert time.monotonic() < deadline, 'Read-only ACK monitor not ready'
            time.sleep(.05)
        return child
    except BaseException:
        child.terminate()
        child.wait(timeout=10)
        raise


def refuse_incomplete_ack_completion(developer, held, native, project):
    query = f"SELECT jsonb_build_object('job',to_jsonb(j),'attempts',(SELECT jsonb_agg(to_jsonb(a)) FROM sf_execution_attempts a WHERE a.job_id=j.id),'receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.ordinal) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id=j.id)) FROM sf_execution_jobs j WHERE j.id='{held}'"
    retained = sql(query)
    dispatch_file = dispatch_witness_file(native)
    dispatch = dispatch_file.read_bytes()
    wait_expired(held)
    for _ in range(2):
        result = subprocess.run(native_command([BINARY, 'held-preview', held], 10002),
                                env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=180)
        assert result.returncode == 1 and not result.stdout, 'Missing receipt must refuse completion'
    assert sql(query) == retained, 'HOLD, immutable leases, attempts and receipts must be retained'
    assert dispatch_file.read_bytes() == dispatch, 'Lease expiry and failed preview cannot replay SQL'
    history = developer.get(f'/api/execution-jobs/{held}/reconciliations')
    assert history['recoveredCompletion'] is None
    assert not history['retryEligible'] and not history['executionAuthority']
    assert sql(f"SELECT count(*) FROM sf_audit WHERE project_id='{project}' AND resource_id='{held}' AND action='EXECUTION_RECOVERED_APPLIED'") == '0'
    print('PASS: committed ledger with missing central receipt retains HOLD; completion refused without replay', flush=True)


def main(lost_commit_ack=False):
    marker, native = require_fixture()
    developer, reviewer = Api('developer'), Api('approver')
    assert developer.headers['Cookie'] != reviewer.headers['Cookie']
    assert developer.get('/api/readyz')['status'] == 'ready'
    project, connection = marker['projectId'], marker['connectionId']
    owner, _ = fixture_schemas(marker)
    assert sql(f"SELECT count(*) FROM sf_execution_jobs WHERE project_id='{project}'") == '0', (
        'Use a fresh fixture project; retained execution jobs must never be silently rerun'
    )
    base = f'/api/projects/{project}'
    report_file = PRIVATE / 'installed-test-result.json'
    assert not report_file.exists(), 'A completed fixture must not be silently rerun'

    observation = developer.post(base + f'/database-connections/{connection}/discover', {
        'reason': 'Fresh installed native Oracle fixture discovery',
    })['observation']
    private_json('installed-test-observation.json', observation)
    assert observation['provenance'] == 'ORACLE_READ_ONLY'
    assert observation['verificationAcceptance'] is not None
    print('PASS: HTTPS sessions and installed native TCPS observer acceptance', flush=True)

    bindings = developer.post(base + f'/database-connections/{connection}/assign-schemas', {
        'observationId': observation['id'], 'expectedConnectionRevision': '1',
        'owners': [owner], 'environmentId': marker['environmentId'],
        'reason': 'Explicit disposable native schema assignment',
    })['bindings']
    binding = bindings[0]
    binding_id = binding['bindingId']
    detail = developer.post(base + f'/target-bindings/{binding_id}/verify', {
        'connectionId': connection, 'observationId': observation['id'],
        'expectedIdentityDigest': observation['identityDigest'],
        'expectedBindingRevision': binding['bindingRevision'],
        'expectedAssignmentRevision': binding['assignmentRevision'],
        'owner': owner, 'reason': 'Accept current native disposable fixture identity',
    })
    private_json('installed-test-target.json', detail)

    repository = developer.get('/api/repositories')['repositories'][0]
    developer.call('PUT', base + '/source', {
        'repositoryId': repository['id'], 'folder': 'migrations',
    })

    # Each retained file is the same source on later releases; no ledger seed,
    # target-history mutation or direct release/approval row insertion is used.
    files = [{
        'id': str(uuid.uuid4()), 'path': 'V1__widget.sql',
        'sql': 'CREATE TABLE widget(id NUMBER, label VARCHAR2(40 BYTE));\n'
               'CREATE INDEX ix_widget ON widget(id);\n',
    }]
    draft = developer.post(base + '/sql-drafts', {
        'name': 'Installed native Oracle integration', 'targetBindingId': binding_id,
        'files': files,
    })['draft']
    draft_id = draft['id']
    private_json('installed-test-case.json', {'bindingId': binding_id, 'draft': draft})

    def prepare_release(draft_revision):
        current = developer.get(base + f'/target-bindings/{binding_id}')['binding']
        return developer.post(base + f'/sql-drafts/{draft_id}/prepare-release', {
            'expectedRevision': draft_revision, 'targetBindingId': binding_id,
            'expectedBindingRevision': current['bindingRevision'],
            'expectedAssignmentRevision': current['assignmentRevision'],
        })['release']['id']

    def request_execution(release, reject_final_projection=False):
        current = developer.get(base + f'/target-bindings/{binding_id}')['binding']
        retained_plan = developer.post(base + '/plans', {
            'intentVersion': 2, 'releaseId': release,
            'assignmentId': current['assignmentId'],
            'expectedAssignmentRevision': current['assignmentRevision'],
            'targetBindingId': binding_id, 'expectedBindingRevision': current['bindingRevision'],
        })['plan']
        plan = retained_plan['id']
        expected = {
            'expectedIntentDigest': retained_plan['offlineIntent']['digest'],
            'expectedAssignmentRevision': current['assignmentRevision'],
            'expectedBindingRevision': current['bindingRevision'],
        }
        developer.call('POST', f'/api/plans/{plan}/decision', {
            **expected, 'decision': 'APPROVE', 'reason': 'Self approval must fail',
        }, expected=403)
        reviewer.post(f'/api/plans/{plan}/decision', {
            **expected, 'decision': 'APPROVE', 'reason': 'Independent native Oracle fixture SQL review',
        })
        if reject_final_projection:
            # Install before enqueueing: a runtime-managed worker may dispatch
            # immediately. Only this fresh independently approved plan is scoped.
            sql(f"""CREATE FUNCTION rust_fixture_reject_success() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.plan_id='{plan}'::uuid AND NEW.project_id='{project}'::uuid
              AND NEW.state='VERIFIED_SUCCESS' THEN
              RAISE EXCEPTION 'Disposable native fixture: lost terminal metadata projection';
            END IF; RETURN NEW; END $$;
            CREATE TRIGGER rust_fixture_reject_success BEFORE UPDATE ON sf_execution_jobs
            FOR EACH ROW EXECUTE FUNCTION rust_fixture_reject_success();""")
        return developer.post(f'/api/plans/{plan}/execution', {
            **expected, 'idempotencyKey': str(uuid.uuid4()), 'reason': 'Explicit native fixture execution',
        })['job']['id']

    release = prepare_release(draft['revision'])
    success = request_execution(release)
    private_json('installed-test-success.json', {'releaseId': release, 'jobId': success})
    worker_until(success, 'VERIFIED_SUCCESS')
    assert sql(f"SELECT count(*) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id='{success}'") == '2'
    dispatch_file = dispatch_witness_file(native)
    before_noop = dispatch_file.read_bytes()
    noop = request_execution(release)
    worker_until(noop, 'NOOP')
    assert dispatch_file.read_bytes() == before_noop, 'NOOP must dispatch no SQL'
    assert sql(f"SELECT count(*) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id='{noop}'") == '0'
    print('PASS: independent API approval, installed worker success and zero-dispatch NOOP', flush=True)

    files.append({
        'id': str(uuid.uuid4()), 'path': 'V2__recovery.sql',
        'sql': 'CREATE TABLE recovery_marker(id NUMBER);\n',
    })
    updated = developer.call('PUT', base + f'/sql-drafts/{draft_id}', {
        'name': draft['name'], 'targetBindingId': binding_id,
        'expectedRevision': draft['revision'], 'files': files,
    })['draft']
    recovery_release = prepare_release(updated['revision'])
    if lost_commit_ack:
        monitor = start_ack_monitor(binding['streamId'])
        try:
            held = request_execution(recovery_release)
            private_json('installed-test-held.json', {'releaseId': recovery_release, 'jobId': held})
            worker_until(held, 'HOLD')
            assert monitor.wait(timeout=10) == 0, 'Actual committed-response fault was not proven'
        finally:
            if monitor.poll() is None:
                monitor.terminate()
                monitor.wait(timeout=10)
        fault = json.loads(ack_monitor_files('V2__recovery.sql')[1].read_text())
        assert fault['status'] == 'PASS' and fault['oracleCommitProven'] is True
        assert fault['committedEvent']['targetId'] == fixture_target_id(binding['streamId'])
        assert sql(f"SELECT count(*) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id='{held}'") == '0'
        refuse_incomplete_ack_completion(developer, held, native, project)
        evidence_digest = fault['evidenceDigest']
    else:
        # Reject only this job's final metadata projection after Oracle commits.
        # The transaction rolls back normally; original guards stay active.
        try:
            held = request_execution(recovery_release, reject_final_projection=True)
            private_json('installed-test-held.json', {'releaseId': recovery_release, 'jobId': held})
            worker_until(held, 'HOLD')
            assert sql(f"SELECT count(*) FROM sf_execution_receipts r JOIN sf_execution_attempts a ON a.id=r.attempt_id WHERE a.job_id='{held}'") == '1'
        finally:
            sql('DROP TRIGGER rust_fixture_reject_success ON sf_execution_jobs; DROP FUNCTION rust_fixture_reject_success();')
        evidence_digest = recover_held(developer, reviewer, held, native, project)['evidenceDigest']
    private_json('installed-test-result.json', {
        'status': 'PASS', 'successJob': success, 'noopJob': noop, 'heldJob': held,
        'evidenceDigest': evidence_digest, 'actualLostCommitAck': lost_commit_ack,
        'artifact': json.loads(command([BINARY, '--build-info'])),
        'appImageDigest': native['appImageDigest'],
        'runtimeManagedWorker': RUNTIME_WORKER_PID is not None,
        'qualification': 'DISPOSABLE_LOCAL_FIXTURE_ONLY',
    })


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lost-commit-ack', action='store_true',
                        help='Use the one-shot private proxy/observer instead of a metadata projection fault')
    main(parser.parse_args().lost_commit_ack)
