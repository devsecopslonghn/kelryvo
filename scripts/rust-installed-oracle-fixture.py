#!/usr/bin/env python3
"""Opt-in local Oracle qualification; never accepts an external endpoint.

Uses one fresh vendor Oracle Free root, one PostgreSQL cluster and one copy of an
independently verified amd64 image. Database activity is confined to a private
network/PID/mount/IPC/UTS namespace with no external route. A failed fixture is
retained, stopped, for inspection; it cannot be resumed or silently replayed.
"""
import argparse
import ctypes
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import time
import urllib.request
import uuid
import zipfile

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / '.cache/native-oracle-fixture'
PRIVATE = ROOT / 'private'
APP = ROOT / 'app-root'
ORACLE = ROOT / 'oracle-root/rootfs'
P = '/run/kelryvo/operator/private'
SOURCE_IDENTITY = '/run/kelryvo/operator/source-identity.json'
BASE_ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC'}
ORACLE_IMAGE = 'docker://docker.io/gvenzl/oracle-free@sha256:7ed34d0ade89c91a553c9cbe9d42457c758fa29a762aaaa3137541ff30a2d1cb'
CLIENT_HASH = 'cab59aa3b411b3b50898e456fa9aabfe48d67e25cbc1bb23303800390ce7de26'
PKI_HASH = 'c8dd5edc858624295c81c9bc32639e697f8cb3c0d31201fdb02db438e2472e0d'
SCHEMAS = ['KRV_ACK', 'KRV_APP']


def digest(file):
    h = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def encoded(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True).encode()


def seal(value, field):
    value[field] = hashlib.sha256(encoded({k: v for k, v in value.items() if k != field})).hexdigest()


def result_path(report):
    source = report['sourceTreeDigest']
    assert len(source) == 64 and all(char in '0123456789abcdef' for char in source)
    return REPO / f'.cache/native-image-build/amd64-{source[:8]}-oracle-result.json'


def write(file, value, mode=0o600):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    # Apply the requested mode before writing, including with public-dir umask
    # 022. O_EXCL also refuses existing files and symlinks without overwriting.
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    with os.fdopen(os.open(file, flags, mode), 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        stream.write(value if isinstance(value, bytes) else value.encode())


def json_file(file, value, mode=0o600):
    write(file, encoded(value), mode)


def run(args, *, data=None, env=None, preexec=None, timeout=180, name='command'):
    result = subprocess.run([str(a) for a in args], input=data, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env or BASE_ENV,
                            preexec_fn=preexec, timeout=timeout)
    if result.returncode:
        # Diagnostics may contain disposable credentials. Never print them.
        json_file(PRIVATE / f'{name}-{uuid.uuid4()}.json', {
            'exitCode': result.returncode,
            'stdout': result.stdout.decode(errors='replace'),
            'stderr': result.stderr.decode(errors='replace'),
        })
        raise RuntimeError(f'{name} failed; inspect private fixture diagnostics')
    return result.stdout


def stage(value):
    print('Oracle fixture: ' + value, flush=True)


def stop_runtime(wrapper):
    """Signal the owned namespace PID 1, not unshare's waiting parent."""
    if wrapper.poll() is not None:
        return wrapper.returncode == 0
    roots = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal():
            continue
        try:
            args = proc.joinpath('cmdline').read_bytes().split(b'\0')
            status = dict(line.split(':', 1) for line in proc.joinpath('status').read_text().splitlines())
            if (args[0] == b'/opt/kelryvo/bin/kelryvo-runtime'
                    and proc.joinpath('root').resolve() == APP
                    and status['PPid'].strip() == str(wrapper.pid)
                    and status['NSpid'].split()[-1] == '1'
                    and status['Uid'].split() == ['0'] * 4
                    and status['NoNewPrivs'].strip() == '1'):
                roots.append(int(proc.name))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
    if len(roots) == 1:
        try:
            os.kill(roots[0], signal.SIGTERM)
            return wrapper.wait(timeout=30) == 0
        except (ProcessLookupError, subprocess.TimeoutExpired):
            pass
    # This is our Popen-owned unshare wrapper, whose --kill-child boundary is
    # private. Never select an unrelated process by name or a stale marker PID.
    if wrapper.poll() is None:
        wrapper.kill()
    wrapper.wait(timeout=10)
    return False


def drop(uid, gid=None, groups=(), chroot=None, no_privileges=False):
    def change():
        if chroot:
            os.chroot(chroot)
            os.chdir('/opt/oracle')
        if no_privileges:
            libc = ctypes.CDLL(None, use_errno=True)
            for capability in range(41):
                assert libc.prctl(24, capability, 0, 0, 0) == 0
            assert libc.prctl(38, 1, 0, 0, 0) == 0
        os.setgroups(list(groups))
        os.setgid(gid if gid is not None else uid)
        os.setuid(uid)
    return change


def native(binary, *args, data=None, uid=None, timeout=180):
    privilege = ['--bounding-set=-all,+chown,+kill,+setuid,+setgid'] if uid is None else [
        '--bounding-set=-all', f'--reuid={uid}', f'--regid={uid}', '--clear-groups']
    return run(['/usr/sbin/chroot', APP, '/usr/bin/setpriv', *privilege,
                '--no-new-privs', f'/opt/kelryvo/bin/{binary}', *args],
               data=data, timeout=timeout, name='native-' + binary + '-' + str(args[0]))


def worker(*args):
    raw = native('kelryvo-worker', *args)
    return json.loads(raw) if raw else None


def mount(*args):
    run(['/usr/bin/mount', *args], name='mount')


def prepare(args):
    assert os.getuid() == 0 and not ROOT.exists(), 'Fresh fixture required; never resume partial Oracle DDL'
    assert shutil.disk_usage(REPO).free >= 12 * 1024**3
    image = Path(args.image).resolve(strict=True)
    assert image == REPO / '.cache/buildkit-overlay.current-amd64/rootfs'
    report = json.loads((REPO / '.cache/native-image-build/amd64-independent-verification.json').read_text())
    identity = json.loads((image / 'opt/kelryvo/source-identity.json').read_text())
    assert report['sourceTreeDigest'] == identity['sourceTreeDigest']
    assert not result_path(report).exists(), 'Retain the previous source-qualified result before starting another fixture'
    assert report['archiveSha256'] == digest(REPO / '.cache/native-image-build/kelryvo-current-amd64.oci.tar')
    assert report['sourceComparison'] == 'CURRENT_WORKTREE' and identity['architecture'] == 'x86_64'
    client = REPO / '.cache/native-client-loader-check/basic.zip'
    assert digest(client) == CLIENT_HASH
    tools = {'node': str(Path(args.node).resolve(strict=True)),
             'java': str(Path(args.java).resolve(strict=True))}
    assert all(os.access(value, os.X_OK) for value in tools.values())
    ROOT.mkdir(mode=0o711)
    PRIVATE.mkdir(mode=0o700)
    json_file(PRIVATE / 'fixture-artifact.json', report)
    json_file(PRIVATE / 'harness-inputs.json', {name: digest(REPO / name) for name in [
        'scripts/rust-installed-oracle-fixture.py', 'scripts/rust-oracle-fixture-read.mjs',
        'scripts/test-rust-installed-oracle.py', 'scripts/oracle-ack-monitor.mjs',
        'scripts/oracle-ack-proxy-control.py', 'scripts/oracle-ack-proxy.py',
    ]})
    json_file(PRIVATE / 'tools.json', tools)
    json_file(PRIVATE / 'containers-auth.json', {'auths': {}})
    stage('fetch pinned public vendor image into one private root')
    for attempt in range(3):
        try:
            run(['/usr/bin/skopeo', 'copy', '--authfile', PRIVATE / 'containers-auth.json',
                 '--override-os', 'linux', '--override-arch', 'amd64', ORACLE_IMAGE,
                 'oci:' + str(ROOT / 'vendor-layout') + ':oracle'], timeout=900, name='vendor-download')
            break
        except RuntimeError:
            if attempt == 2:
                raise
            # Only this public, content-addressed download may reuse partial
            # blobs. Never retry an Oracle/metadata command or product job.
            stage('retry public vendor download; no database has started')
            time.sleep(2 * (attempt + 1))
    for blob in (ROOT / 'vendor-layout/blobs/sha256').iterdir():
        assert blob.name == digest(blob)
    index = json.loads((ROOT / 'vendor-layout/index.json').read_text())
    manifest = json.loads((ROOT / 'vendor-layout/blobs' / index['manifests'][0]['digest'].replace(':', '/')).read_text())
    config = json.loads((ROOT / 'vendor-layout/blobs' / manifest['config']['digest'].replace(':', '/')).read_text())
    assert config['architecture'] == 'amd64' and config['os'] == 'linux'
    assert config['config']['User'] == 'oracle' and config['config']['Entrypoint'] == ['container-entrypoint.sh']
    json_file(PRIVATE / 'vendor-config.json', config)
    run([REPO / '.cache/native-image-build/bin/umoci', 'unpack', '--image',
         str(ROOT / 'vendor-layout') + ':oracle', ROOT / 'oracle-root'], timeout=300, name='vendor-unpack')
    shutil.rmtree(ROOT / 'vendor-layout')
    shutil.copytree(image, APP, symlinks=True)
    # buildctl's local destination inherits the caller's private umask. It is
    # an export container, not the OCI / directory; roles need to traverse /.
    APP.chmod(0o755)
    client_dir = APP / 'opt/kelryvo/oracle/client'
    client_dir.mkdir(parents=True, mode=0o755)
    with zipfile.ZipFile(client) as archive:
        members = {Path(i.filename).name: i for i in archive.infolist()
                   if not i.is_dir() and i.filename.startswith('instantclient_23_26/')
                   and len(Path(i.filename).parts) == 2}
        for name, info in members.items():
            if stat.S_ISLNK(info.external_attr >> 16):
                if name != 'libclntsh.so':
                    continue
                target = archive.read(info).decode()
                assert '/' not in target and target in members
                info = members[target]
                assert not stat.S_ISLNK(info.external_attr >> 16)
            write(client_dir / name, archive.read(info), 0o444)
    tools = ROOT / 'pki-tools'
    tools.mkdir(mode=0o700)
    with urllib.request.urlopen('https://repo.maven.apache.org/maven2/com/oracle/database/security/oraclepki/23.26.0.0.0/oraclepki-23.26.0.0.0.jar', timeout=60) as response:
        write(tools / 'oraclepki.jar', response.read(1024 * 1024))
    assert digest(tools / 'oraclepki.jar') == PKI_HASH
    shutil.copyfile(APP / 'usr/lib/x86_64-linux-gnu/libaio.so.1.0.2', tools / 'libaio.so.1')
    json_file(PRIVATE / 'fixture-prepared.json', {'format': 1, 'phase': 'BEFORE_ORACLE_START'})
    run_prepared()


def run_prepared():
    assert os.getuid() == 0 and ROOT.is_dir() and not ROOT.is_symlink()
    marker = json.loads((PRIVATE / 'fixture-prepared.json').read_text())
    assert marker == {'format': 1, 'phase': 'BEFORE_ORACLE_START'}
    assert not (PRIVATE / 'oracle.log').exists() and not (ROOT / 'postgres').exists(), 'Never resume an initialized database'
    output = result_path(json.loads((PRIVATE / 'fixture-artifact.json').read_text()))
    assert not output.exists(), 'A source-qualified result must never be overwritten'
    previous_log = PRIVATE / 'namespace.log'
    if previous_log.exists():
        previous_log.rename(PRIVATE / f'namespace-before-start-{uuid.uuid4()}.log')
    unused_password = ORACLE / 'run/fixture/oracle-password'
    if unused_password.exists():
        assert unused_password.is_file() and not unused_password.is_symlink()
        unused_password.unlink()
    stage('download checksums verified; enter isolated local namespaces')
    with (PRIVATE / 'namespace.log').open('xb') as log:
        child = subprocess.run(['/usr/bin/unshare', '--mount', '--pid', '--fork', '--net',
                                '--ipc', '--uts', '--mount-proc', '--kill-child=SIGKILL',
                                '/usr/bin/python3', '-B', Path(__file__).resolve(), '--namespace'],
                               env=BASE_ENV, stdout=log, stderr=log)
    assert child.returncode == 0, 'Fixture failed; inspect private namespace.log; never replay its jobs'
    result = json.loads((PRIVATE / 'fixture-result.json').read_text())
    assert result['status'] == 'PASS'
    assert result['runtimeCleanShutdown'] is True, 'Runtime shutdown failed; retained product assertions do not qualify teardown'
    json_file(output, result)
    os.chown(output, REPO.stat().st_uid, REPO.stat().st_gid)
    # unshare has exited: all private mounts/processes are gone. This exact
    # owned root contains no reusable product data and no external mounts.
    assert not ROOT.is_symlink()
    assert not any(str(ROOT) in line.split(' - ')[0] for line in Path('/proc/self/mountinfo').read_text().splitlines())
    shutil.rmtree(ROOT)
    stage('PASS; private databases, keys, wallet and vendor root removed')


def namespace():
    assert os.getuid() == 0 and os.getpid() == 1 and ROOT.is_dir() and not ROOT.is_symlink()
    mount('--make-rprivate', '/')
    run(['/usr/bin/hostname', 'kelryvo-oracle-fixture'])
    run(['/usr/sbin/ip', 'link', 'set', 'lo', 'up'])
    run(['/usr/sbin/ip', 'link', 'add', 'oracle0', 'type', 'dummy'])
    Path('/proc/sys/net/ipv6/conf/oracle0/disable_ipv6').write_text('1')
    run(['/usr/sbin/ip', 'address', 'add', '192.0.2.1/32', 'dev', 'oracle0'])
    run(['/usr/sbin/ip', 'link', 'set', 'oracle0', 'up'])
    mount('-t', 'tmpfs', '-o', 'mode=755', 'tmpfs', '/opt')
    Path('/opt/kelryvo-fixture').mkdir()
    mount('--bind', ROOT, '/opt/kelryvo-fixture')
    tools = json.loads((PRIVATE / 'tools.json').read_text())
    vendor = json.loads((PRIVATE / 'vendor-config.json').read_text())
    oracle_env = dict(item.split('=', 1) for item in vendor['config']['Env'])
    oracle_env.update(ORACLE_PASSWORD_FILE='/run/fixture/oracle-password', ORACLE_DATABASE='')
    (ORACLE / 'etc/hosts').write_text('127.0.0.1 localhost kelryvo-oracle-fixture\n192.0.2.1 kelryvo-oracle-fixture\n')
    for name in ['proc', 'dev', 'dev/shm', 'run/fixture']:
        (ORACLE / name).mkdir(parents=True, exist_ok=True)
    mount('-t', 'proc', 'proc', ORACLE / 'proc')
    mount('-t', 'tmpfs', '-o', 'mode=755', 'tmpfs', ORACLE / 'dev')
    for name in ['null', 'zero', 'random', 'urandom']:
        write(ORACLE / 'dev' / name, b'')
        mount('--bind', '/dev/' + name, ORACLE / 'dev' / name)
    (ORACLE / 'dev/shm').mkdir(mode=0o1777)
    mount('-t', 'tmpfs', '-o', 'size=2g,mode=1777', 'tmpfs', ORACLE / 'dev/shm')
    write(ORACLE / 'run/fixture/oracle-password', 'Krv9' + secrets.token_hex(24))
    os.chown(ORACLE / 'run/fixture/oracle-password', 54321, 54321)
    oracle_log = (PRIVATE / 'oracle.log').open('xb')
    oracle = subprocess.Popen(['/bin/bash', '/opt/oracle/container-entrypoint.sh'], env=oracle_env,
                              preexec_fn=drop(54321, chroot=ORACLE, no_privileges=True),
                              stdin=subprocess.DEVNULL, stdout=oracle_log, stderr=oracle_log)
    runtime = proxy = None
    pg_started = False
    result = None
    try:
        stage('boot fresh vendor Oracle and one PostgreSQL cluster')
        deadline = time.monotonic() + 360
        while 'DATABASE IS READY TO USE!' not in (PRIVATE / 'oracle.log').read_text(errors='replace'):
            assert oracle.poll() is None and time.monotonic() < deadline, 'Fresh Oracle startup failed'
            time.sleep(1)
        # Private PostgreSQL uses a fresh random password, never trust TCP.
        pg_uid = REPO.stat().st_uid
        pg = ROOT / 'postgres'
        pg.mkdir(mode=0o700)
        os.chown(pg, pg_uid, pg_uid)
        password = secrets.token_hex(32)
        write(pg / 'initial-password', password)
        os.chown(pg / 'initial-password', pg_uid, pg_uid)
        pgdata = pg / 'data'
        run(['/usr/bin/initdb', '-D', pgdata, '-U', 'fixture', '--pwfile', pg / 'initial-password',
             '-A', 'scram-sha-256', '--no-locale', '--encoding=UTF8'], preexec=drop(pg_uid), name='initdb')
        run(['/usr/bin/pg_ctl', '-D', pgdata, '-l', pg / 'postgres.log', '-o',
             '-c listen_addresses=127.0.0.1 -c port=15432 -c unix_socket_directories=', 'start'],
            preexec=drop(pg_uid), name='pg-start')
        pg_started = True
        write(PRIVATE / 'pgpass', f'127.0.0.1:15432:*:fixture:{password}\n')
        pg_env = {**BASE_ENV, 'PGPASSFILE': str(PRIVATE / 'pgpass')}
        run(['/usr/bin/createdb', '-h', '127.0.0.1', '-p', '15432', '-U', 'fixture', 'kelryvo_rust_test'], env=pg_env)
        runtime, proxy, result = qualify(tools, oracle_env, password)
        # Preserve product assertions before teardown. A wrapper/vendor shutdown
        # failure must remain visible without losing evidence or rerunning jobs.
        json_file(PRIVATE / 'product-result.json', result)
    finally:
        runtime_clean = stop_runtime(runtime) if runtime is not None else None
        if proxy is not None and proxy.poll() is None:
            proxy.terminate()
            proxy.wait(timeout=10)
        if pg_started:
            run(['/usr/bin/pg_ctl', '-D', ROOT / 'postgres/data', '-m', 'fast', 'stop'],
                preexec=drop(REPO.stat().st_uid), name='pg-stop')
        clean_oracle = oracle.poll() == 0
        if oracle.poll() is None:
            oracle.terminate()
            try:
                clean_oracle = oracle.wait(timeout=150) == 0
            except subprocess.TimeoutExpired:
                clean_oracle = False
                oracle.kill()
                oracle.wait(timeout=10)
        if result is not None:
            result['oracleCleanShutdown'] = clean_oracle
            result['runtimeCleanShutdown'] = runtime_clean
            json_file(PRIVATE / 'fixture-result.json', result)
        json_file(PRIVATE / 'cleanup-result.json', {'oracleCleanShutdown': clean_oracle,
                  'runtimeCleanShutdown': runtime_clean,
                  'postgresStopped': not (ROOT / 'postgres/data/postmaster.pid').exists()})


def qualify(tools, oracle_env, pg_password):
    """Prepare via native root commands, then exercise two independent streams."""
    def sys_sql(text):
        script = ('WHENEVER SQLERROR EXIT SQL.SQLCODE\n'
                  'SET ECHO OFF FEEDBACK OFF HEADING OFF PAGESIZE 0 LINESIZE 32767\n'
                  + text + '\nEXIT\n').encode()
        return run(['/bin/bash', '-c', 'exec "$ORACLE_HOME/bin/sqlplus" -s / as sysdba'],
                   data=script, env=oracle_env,
                   preexec=drop(54321, groups=(54322,), chroot=ORACLE), name='sys-fixture-bootstrap')

    def pki(*args):
        return run([tools['java'], '-cp', ROOT / 'pki-tools/oraclepki.jar',
                    'oracle.security.pki.textui.OraclePKITextUI', *args], name='pki')

    wallet = APP / 'opt/kelryvo/oracle/wallet'
    server_wallet = ORACLE / 'opt/oracle/oradata/fixture-wallet'
    for directory in (wallet, server_wallet):
        directory.mkdir(mode=0o750, parents=True)
        pki('wallet', 'create', '-wallet', directory, '-auto_login_only')
    pki('wallet', 'add', '-wallet', server_wallet, '-dn', 'CN=localhost', '-keysize', '2048',
        '-self_signed', '-validity', '1', '-sign_alg', 'sha256', '-auto_login_only')
    pki('wallet', 'export', '-wallet', server_wallet, '-dn', 'CN=localhost',
        '-cert', ROOT / 'pki-tools/server.crt')
    pki('wallet', 'add', '-wallet', wallet, '-trusted_cert', '-cert', ROOT / 'pki-tools/server.crt',
        '-auto_login_only')
    lock = wallet / 'cwallet.sso.lck'
    if lock.exists():
        assert lock.is_file() and not lock.is_symlink() and lock.stat().st_size == 0
        lock.unlink()  # Unused PKI-tool lock, before sealing the closed wallet inventory.
    for directory, gid in ((wallet, 10002), (server_wallet, 54321)):
        os.chown(directory, 0 if gid == 10002 else 54321, gid)
        for entry in directory.iterdir():
            entry.chmod(0o440)
            os.chown(entry, 0 if gid == 10002 else 54321, gid)
    # The vendor's network/admin files are absolute symlinks inside its chroot.
    # Write their known private backing directory, not the host's /opt path.
    net = ORACLE / 'opt/oracle/oradata/dbconfig/FREE'
    assert net.is_dir() and not net.is_symlink()
    (net / 'listener.ora').write_text('''LISTENER=(DESCRIPTION_LIST=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=1521))(ADDRESS=(PROTOCOL=TCPS)(HOST=127.0.0.1)(PORT=2485))))
WALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/opt/oracle/oradata/fixture-wallet)))
SSL_CLIENT_AUTHENTICATION=FALSE
SSL_VERSION=1.2
''')
    (net / 'sqlnet.ora').write_text('''NAMES.DIRECTORY_PATH=(TNSNAMES,EZCONNECT)
WALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/opt/oracle/oradata/fixture-wallet)))
SSL_CLIENT_AUTHENTICATION=FALSE
SSL_VERSION=1.2
''')
    for action in ('stop', 'start'):
        run(['/bin/bash', '-c', 'exec "$ORACLE_HOME/bin/lsnrctl" ' + action], env=oracle_env,
            preexec=drop(54321, chroot=ORACLE), name='private-listener-' + action)
    master = 'Krv9' + secrets.token_hex(24)
    write(PRIVATE / 'master-password', master)
    catalog = ['DBA_CONSTRAINTS', 'DBA_CONS_COLUMNS', 'DBA_INDEXES', 'DBA_IND_COLUMNS',
               'DBA_OBJECTS', 'DBA_ROLE_PRIVS', 'DBA_SCHEMA_PRIVS', 'DBA_SOURCE', 'DBA_SYS_PRIVS',
               'DBA_TAB_COLUMNS', 'DBA_TAB_PRIVS', 'DBA_TRIGGERS', 'DBA_USERS', 'V_$CONTAINERS',
               'V_$DATABASE', 'V_$LOCK', 'V_$SESSION', 'V_$VERSION', 'GV_$SESSION']
    grants = [f"CREATE USER KRV_MASTER IDENTIFIED BY \"{master}\";",
              'GRANT CREATE SESSION, CREATE USER, ALTER USER, CREATE TABLE, CREATE PROCEDURE, '
              'CREATE TRIGGER, GRANT ANY PRIVILEGE, GRANT ANY OBJECT PRIVILEGE, '
              'CREATE ANY TABLE, ALTER ANY TABLE, CREATE ANY INDEX, READ ANY TABLE '
              'TO KRV_MASTER WITH ADMIN OPTION;',
              'GRANT EXECUTE ON SYS.DBMS_LOCK TO KRV_MASTER WITH GRANT OPTION;']
    grants.extend(f"GRANT {'READ' if view == 'V_$VERSION' else 'SELECT'} ON SYS.{view} "
                  'TO KRV_MASTER WITH GRANT OPTION;' for view in catalog)
    sys_sql("ALTER SYSTEM SET local_listener='(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=1521))' SCOPE=BOTH;\n"
            'ALTER SYSTEM REGISTER;\nALTER SESSION SET CONTAINER=FREEPDB1;\n' + '\n'.join(grants))
    witness_env = {**BASE_ENV, 'KELRYVO_ACK_FIXTURE_ROOT': str(ROOT),
                   'LD_LIBRARY_PATH': str(APP / 'opt/kelryvo/oracle/client') + ':' + str(ROOT / 'pki-tools')}

    def oracle_read(mode):
        return json.loads(run([tools['node'], REPO / 'scripts/rust-oracle-fixture-read.mjs', mode],
                              env=witness_env, timeout=20, name='read-only-' + mode))

    # Listener registration is asynchronous. Read-only readiness can be retried;
    # native provisioning and approved SQL below are each invoked exactly once.
    deadline = time.monotonic() + 40
    while True:
        try:
            oracle_identity = oracle_read('identity')
            break
        except RuntimeError:
            assert time.monotonic() < deadline, 'TCPS readiness unavailable before native provisioning'
            time.sleep(1)
    stage('pinned TCPS and Oracle identity verified; initialize native API')
    for directory in ['run', 'tmp', 'var/lib']:
        mount('-t', 'tmpfs', '-o', 'mode=1777' if directory == 'tmp' else 'mode=755',
              'tmpfs', APP / directory)
    mount('-t', 'proc', 'proc', APP / 'proc')
    for name in ['null', 'zero', 'random', 'urandom']:
        (APP / 'dev' / name).touch(exist_ok=True)
        mount('--bind', '/dev/' + name, APP / 'dev' / name)
    secret = APP / 'run/kelryvo/secrets'
    secret.mkdir(parents=True, mode=0o700)
    operator = APP / P.lstrip('/')
    operator.parent.mkdir(mode=0o711)
    operator.mkdir(mode=0o700)
    (APP / 'run/kelryvo/installation').mkdir(mode=0o700)
    database_url = f'postgresql://fixture:{pg_password}@127.0.0.1:15432/kelryvo_rust_test'
    for name, value in {'database-url': database_url, 'developer-token': secrets.token_hex(32),
                        'approver-token': secrets.token_hex(32)}.items():
        write(secret / name, value)
    write(operator / 'database-url', database_url)
    run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
         '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
         '-keyout', secret / 'tls.key', '-out', secret / 'tls.crt'], name='api-tls')
    run(['/usr/bin/openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072',
         '-out', operator / 'oracle-vault-private.pem'], name='vault-key')
    run(['/usr/bin/openssl', 'pkey', '-in', operator / 'oracle-vault-private.pem', '-pubout',
         '-out', secret / 'oracle-vault-public.pem'], name='vault-public')
    for file in [*secret.iterdir(), operator / 'oracle-vault-private.pem']:
        file.chmod(0o600)
    customer = APP / 'run/kelryvo/repositories/customer'
    (customer / 'migrations').mkdir(parents=True)
    write(customer / 'migrations/V001__fixture.sql', 'CREATE TABLE fixture_source(id NUMBER);\n', 0o644)
    git_env = {**BASE_ENV, 'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null'}
    for args in (['init', '--initial-branch=main'], ['add', '--', '.'],
                 ['-c', 'user.name=Native Oracle fixture', '-c', 'user.email=fixture@kelryvo.invalid',
                  '-c', 'commit.gpgSign=false', 'commit', '-m', 'Native disposable Oracle source fixture']):
        run(['/usr/bin/git', '-c', 'core.hooksPath=/dev/null', '-C', customer, *args], env=git_env)
    json_file(secret / 'repositories.json', {'format': 1, 'paths': ['/run/kelryvo/repositories/customer']})
    for directory, dirs, files in os.walk(customer):
        Path(directory).chmod(0o755)
        for name in files:
            (Path(directory) / name).chmod(0o644)
    mount('--bind', customer, customer)
    mount('-o', 'remount,bind,ro', customer)
    # Keep the root read-only without hiding existing child mounts.
    mount('--rbind', APP, APP)
    mount('-o', 'remount,bind,ro', APP)
    for action in ('initialize', 'seed-actors', 'activate'):
        native('kelryvo-operator', action)
    native('kelryvo-operator', 'database-grant', 'kelryvo-developer')
    runtime_log = (PRIVATE / 'runtime.log').open('xb')
    runtime = subprocess.Popen(['/usr/bin/unshare', '--mount', '--pid', '--fork',
                                '--mount-proc=' + str(APP / 'proc'), '--kill-child=SIGKILL',
                                '/usr/sbin/chroot', APP, '/usr/bin/setpriv',
                                '--bounding-set=-all,+chown,+kill,+setuid,+setgid', '--no-new-privs',
                                '/opt/kelryvo/bin/kelryvo-runtime'],
                               env={**BASE_ENV, 'KELRYVO_BIND_HOST': '127.0.0.1', 'KELRYVO_PORT': '8443',
                                    'KELRYVO_EXECUTION_ENABLED': 'true', 'KELRYVO_DISCOVERY_ENABLED': 'true'},
                               stdin=subprocess.DEVNULL, stdout=runtime_log, stderr=runtime_log)
    proxy_log = (PRIVATE / 'proxy.log').open('xb')
    proxy = subprocess.Popen(['/usr/bin/python3', '-B', REPO / 'scripts/oracle-ack-proxy-control.py', ROOT],
                             env=BASE_ENV, stdin=subprocess.DEVNULL, stdout=proxy_log, stderr=proxy_log)
    try:
        os.environ['KELRYVO_RUST_INSTALLED_IMAGE_ROOT'] = str(APP)
        spec = importlib.util.spec_from_file_location('installed_fixture', REPO / 'scripts/test-rust-installed-oracle.py')
        test = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(test)
        # Test-runner fixed paths resolve inside this fixture via private binds.
        test.SECRETS = secret
        test.INSTALLATION = APP / 'run/kelryvo/runtime/execution/installation.json'
        deadline = time.monotonic() + 30
        while True:
            assert runtime.poll() is None and proxy.poll() is None
            try:
                developer = test.Api('developer')
                break
            except (OSError, AssertionError):
                assert time.monotonic() < deadline, 'Native HTTPS startup unavailable'
                time.sleep(.2)
        projects = []
        for label in ('Metadata recovery', 'Committed ACK loss'):
            project = developer.post('/api/projects', {'name': 'Native Oracle ' + label})['project']['id']
            for role in ('developer', 'approver'):
                native('kelryvo-operator', 'grant', project, 'kelryvo-' + role)
                native('kelryvo-operator', 'deploy-grant', project, 'kelryvo-' + role)
            environment = developer.post(f'/api/projects/{project}/environments', {'name': 'DEV'})['environment']['id']
            projects.append((project, environment))
        project, environment = projects[0]
        connection = developer.post(f'/api/projects/{project}/database-instances/master', {
            'name': 'Isolated Oracle Free', 'containerName': 'FREEPDB1', 'kind': 'PDB', 'environment': 'DEV',
            'host': '127.0.0.1', 'port': 2484, 'service': 'freepdb1', 'transport': 'TCPS',
            'username': 'KRV_MASTER', 'password': master, 'reason': 'Explicit synthetic local fixture registration',
        })['connection']
        connection_id = connection['id']
        developer.post(f'/api/projects/{projects[1][0]}/database-instances/attach', {
            'connectionId': connection_id, 'reason': 'Separate synthetic schema for one-shot ACK fault',
        })
        generation = test.sql('SELECT generation_id FROM sf_metadata_current WHERE singleton')
        raw = json.loads(test.sql(f"SELECT to_jsonb(c) FROM sf_database_connections c WHERE id='{connection_id}'"))
        artifact = json.loads((PRIVATE / 'fixture-artifact.json').read_text())
        source = json.loads((APP / 'opt/kelryvo/source-identity.json').read_text())
        reviewed_source = '1' * 40  # Explicit synthetic local review, not a Git nomination.
        json_file(APP / SOURCE_IDENTITY.lstrip('/'), {**source, 'sourceSha': reviewed_source}, 0o444)
        artifacts = []
        paths = [('WORKER', '/opt/kelryvo/bin/kelryvo-worker'),
                 *[('OCI_LIBRARY', '/opt/kelryvo/oracle/client/' + f.name)
                   for f in sorted((APP / 'opt/kelryvo/oracle/client').iterdir())],
                 *[('WALLET', '/opt/kelryvo/oracle/wallet/' + f.name) for f in sorted(wallet.iterdir())],
                 ('SOURCE_IDENTITY', SOURCE_IDENTITY)]
        for kind, name in paths:
            artifacts.append({'kind': kind, 'path': name, 'sha256': digest(APP / name.lstrip('/'))})
        expiry = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=2)).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        authorization = 'native-two-stream-disposable-fixture'
        route = {'host': '127.0.0.1', 'port': 2484, 'service': 'freepdb1',
                 'pinnedIPs': ['127.0.0.1'], 'serverCertificateDN': 'CN=localhost'}
        policy = {'format': 1, 'route': {**route, 'transport': 'TCPS'},
                  'expectedIdentity': oracle_identity['identity'], 'schemaOwners': SCHEMAS,
                  'protectedOwners': ['SYS', 'SYSTEM'], 'createSchemaOwners': SCHEMAS,
                  'tablespace': 'USERS', 'quotaMiB': 20, 'expiresAt': expiry, 'authorizationId': authorization}
        principal_prefix = 'KRV_' + hashlib.sha256(connection_id.encode()).hexdigest()[:12].upper()
        template = {'format': 1, 'driverProfile': source['driverProfile'], 'authorizationId': authorization,
                    'installationDigest': '0' * 64, 'metadataGenerationId': generation,
                    'workerId': 'native-current-fixture', 'expiresAt': expiry, 'leaseSeconds': 300,
                    'callTimeoutMs': 3000, 'routeId': raw['route_id'], 'connectionId': connection_id,
                    'connectionRevision': '1', 'masterUsername': 'KRV_MASTER',
                    'masterCredentialRef': raw['credential_ref'], 'sourceCommit': reviewed_source,
                    'appImageDigest': artifact['manifestDigest'],
                    'metadataDatabase': {'host': '127.0.0.1', 'port': 15432, 'database': 'kelryvo_rust_test', 'user': 'fixture'},
                    'identity': oracle_identity['identity'], 'driverServerVersionString': oracle_identity['serverVersion'],
                    'route': route, 'principals': {'writer': principal_prefix + '_W', 'ledgerOwner': principal_prefix + '_L',
                                                  'observer': principal_prefix + '_O'},
                    'readerSchemas': SCHEMAS, 'protectedOwners': ['SYS', 'SYSTEM'],
                    'targetSchemas': {s: {'schemaPrivileges': ['ALTER TABLE', 'CREATE INDEX', 'CREATE TABLE']} for s in SCHEMAS},
                    'mutexPackageSourceDigest': '3' * 64, 'ledgerImmutableTriggerSourceDigest': '4' * 64,
                    'secretDirectory': P, 'witnessDirectory': '/run/kelryvo/witness',
                    'clientDirectory': '/opt/kelryvo/oracle/client', 'walletDirectory': '/opt/kelryvo/oracle/wallet',
                    'artifacts': artifacts, 'review': {'identity': 'uid:0', 'authorizationId': authorization,
                                                     'expiresAt': expiry, 'digest': '0' * 64}}
        seal(template['review'], 'digest')
        seal(template, 'installationDigest')
        json_file(operator / 'policy.json', policy)
        json_file(operator / 'template.json', template)
        (APP / 'run/kelryvo/witness').mkdir(mode=0o700)
        worker('installation-init-witness', '/run/kelryvo/witness')
        client_check = worker('installation-client-check', P + '/template.json')
        assert client_check['status'] == 'CLIENT_READY_NO_DATABASE'
        json_file(operator / 'prepare.json', {'format': 1, 'policyFile': P + '/policy.json',
                  'installationTemplate': P + '/template.json', 'vaultKeyFile': P + '/oracle-vault-private.pem',
                  'outputDirectory': P + '/prepared'})
        stage('native one-shot scoped provisioning, publication and read-only refresh')
        preparation = worker('installation-prepare', P + '/prepare.json')
        prepared = operator / 'prepared'
        password_hashes = {name: digest(prepared / name) for name in ('writer-password', 'ledger-password', 'observer-password')}
        refreshed_template = json.loads((prepared / 'installation.json').read_text())
        json_file(operator / 'refresh-template.json', refreshed_template)
        json_file(operator / 'refresh.json', {'format': 1, 'previousDirectory': P + '/prepared',
                  'installationTemplate': P + '/refresh-template.json', 'outputDirectory': P + '/refreshed'})
        refresh = worker('installation-refresh', P + '/refresh.json')
        refreshed = operator / 'refreshed'
        assert password_hashes == {name: digest(refreshed / name) for name in password_hashes}
        json_file(operator / 'publish.json', {'format': 1, 'sourceDirectory': P + '/refreshed',
                  'destinationDirectory': '/run/kelryvo/runtime/execution', 'outputDirectory': P + '/publication'})
        publication = worker('installation-publish', P + '/publish.json')
        scope = worker('installation-observer-scope', P + '/refreshed')
        scope.pop('oracleMigrationExecution')
        scope['acceptedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
        scope['evidenceDigest'] = hashlib.sha256(encoded({
            'artifact': artifact, 'preflightSha256': digest(refreshed / 'preflight.json'),
            'journalSha256': digest(refreshed / 'journal.json'), 'scope': scope,
            'qualification': 'LOCAL_DISPOSABLE_PREFLIGHT_AND_ARTIFACT_REVIEW_ONLY',
        })).hexdigest()
        json_file(operator / 'observer-review.json', scope)
        json_file(operator / 'observer.json', {'format': 1, 'sourceDirectory': P + '/refreshed',
                  'acceptanceReviewFile': P + '/observer-review.json'})
        observer = worker('installation-observer', P + '/observer.json')
        # API role cannot read Oracle wallets, write credentials or the private vault key.
        for name in ['/opt/kelryvo/oracle/wallet/cwallet.sso', P + '/oracle-vault-private.pem',
                     *['/run/kelryvo/runtime/execution/' + f for f in password_hashes]]:
            result = subprocess.run(['/usr/sbin/chroot', APP, '/usr/bin/setpriv', '--bounding-set=-all',
                                     '--reuid=10001', '--regid=10001', '--clear-groups', '--no-new-privs',
                                     '/usr/bin/test', '-r', name], env=BASE_ENV)
            assert result.returncode == 1
        worker_pids = []
        for proc in Path('/proc').iterdir():
            if not proc.name.isdecimal():
                continue
            try:
                if proc.joinpath('cmdline').read_bytes().split(b'\0')[:2] == [
                        b'/opt/kelryvo/bin/kelryvo-worker', b'runtime-service']:
                    assert proc.joinpath('root').resolve() == APP
                    worker_pids.append(proc.name)
            except FileNotFoundError:
                pass
        assert len(worker_pids) == 1
        test.RUNTIME_WORKER_PID = worker_pids[0]
        os.environ['KELRYVO_ACK_NODE'] = tools['node']
        retained_ledger_checks = []
        for method in ('recover_held', 'refuse_incomplete_ack_completion'):
            original = getattr(test, method)

            def with_ledger_witness(*args, _original=original, _method=method):
                before = oracle_read('ledger')
                value = _original(*args)
                assert oracle_read('ledger') == before, 'Recovery and lease expiry cannot mutate the target ledger'
                retained_ledger_checks.append({'case': _method, **before})
                return value

            setattr(test, method, with_ledger_witness)
        stage('independent API approval and fully receipted recovery on KRV_APP')
        results = []
        first_project_history = None
        for index, owner in enumerate(('KRV_APP', 'KRV_ACK')):
            project, environment = projects[index]
            json_file(PRIVATE / 'installed-test-context.json', {
                'kind': 'KELRYVO_DISPOSABLE_NATIVE_ORACLE_V1', 'projectId': project,
                'environmentId': environment, 'connectionId': connection_id,
                'sourceTreeDigest': source['sourceTreeDigest'], 'appImageDigest': artifact['manifestDigest'],
                'schemaOwner': owner, 'readerSchemas': SCHEMAS,
            })
            before = oracle_read('ledger') if index else None
            test.main(lost_commit_ack=bool(index))
            case_result = json.loads((PRIVATE / 'installed-test-result.json').read_text())
            case_result['schemaOwner'] = owner
            results.append(case_result)
            first_jobs_query = f"SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM sf_execution_jobs j WHERE project_id='{projects[0][0]}'"
            if not index:
                first_project_history = test.sql(first_jobs_query)
            else:
                assert test.sql(first_jobs_query) == first_project_history
            after = oracle_read('ledger')
            if index:
                assert before['events'] < after['events'] and before['heads'] + 1 == after['heads']
            history = PRIVATE / ('metadata-evidence' if index == 0 else 'ack-evidence')
            history.mkdir(mode=0o700)
            for file in PRIVATE.glob('installed-test-*'):
                file.rename(history / file.name)
            stage('positive recovery retained; proceed on independent ACK stream' if not index else 'ACK HOLD/no-replay assertions passed')
        assert test.sql('SELECT count(*) FROM sf_execution_jobs') == '6'
        assert test.sql("SELECT count(*) FROM sf_execution_jobs WHERE state='HOLD'") == '2'
        assert test.sql("SELECT count(*) FROM sf_audit WHERE action='EXECUTION_RECOVERED_APPLIED'") == '1'
        return runtime, proxy, {'status': 'PASS', 'artifact': artifact, 'cases': results,
                               'oracleServerVersion': oracle_identity['serverVersion'],
                               'clientArchiveSha256': CLIENT_HASH, 'schemaOwners': SCHEMAS,
                               'clientCheck': client_check,
                               'harnessInputs': json.loads((PRIVATE / 'harness-inputs.json').read_text()),
                               'preparation': preparation, 'refresh': refresh, 'publication': publication,
                               'observer': observer, 'passwordsPreservedOnRefresh': True,
                               'apiCredentialIsolation': True, 'ledger': oracle_read('ledger'),
                               'ledgerRetentionChecks': retained_ledger_checks,
                               'firstStreamJobsUnchangedAfterSecondStream': True,
                               'qualification': 'DISPOSABLE_LOCAL_FIXTURE_ONLY'}
    except BaseException:
        stop_runtime(runtime)
        for child in (proxy,):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=10)
        raise


if __name__ == '__main__':
    # Public chroot roots must remain traversable by the vendor/API/worker UIDs
    # even when the caller uses umask 077. Secrets have explicit 0700/0600 modes.
    os.umask(0o022)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image', nargs='?')
    parser.add_argument('--node')
    parser.add_argument('--java')
    parser.add_argument('--namespace', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--prepared', action='store_true',
                        help='Use the retained checked vendor download only before any database has started')
    options = parser.parse_args()
    if options.namespace:
        namespace()
    elif options.prepared:
        run_prepared()
    else:
        assert options.image and options.node and options.java
        prepare(options)
