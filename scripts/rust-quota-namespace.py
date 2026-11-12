"""Run the quota harness as the caller in an otherwise empty private network."""
import json
import os
from pathlib import Path
import subprocess
import sys

assert os.getuid() == 0 and os.getpid() == 1
assert len(sys.argv) == 5
repository, node, distribution, database = sys.argv[1:]
repository = Path(repository).resolve()
assert (repository / 'scripts/test-rust-quota.mjs').is_file()
assert Path(node).is_absolute() and Path(node).is_file()
assert distribution == '-' or Path(distribution).is_absolute()
assert database.startswith('postgresql:///kelryvo_rust_test?host=' + str(repository / '.cache/rust-tests.'))
links = json.loads(subprocess.check_output(['/usr/sbin/ip', '-j', 'link']))
assert {entry['ifname'] for entry in links} == {'lo'}
subprocess.run(['/usr/sbin/ip', 'link', 'set', 'lo', 'up'], check=True)
for address in ['2001:db8:42:10::1/128', '2001:db8:42:10::2/128', '2001:db8:42:11::1/128']:
    subprocess.run(['/usr/sbin/ip', '-6', 'address', 'add', address, 'dev', 'lo', 'nodad'], check=True)
subprocess.run(['/usr/sbin/ip', 'address', 'add', '192.0.2.1/32', 'dev', 'lo'], check=True)
uid, gid = repository.stat().st_uid, repository.stat().st_gid
assert uid != 0 and uid not in (10001, 10002)
environment = {'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC',
               'KELRYVO_RUST_TEST_DATABASE_URL': database, 'KELRYVO_RUST_QUOTA_NETWORK': 'PRIVATE'}
if distribution != '-':
    environment['KELRYVO_RUST_DISTRIBUTION'] = distribution
for key in ['KELRYVO_RUST_QUOTA_RESULT_FILE', 'KELRYVO_RUST_WEB_DIRECTORY']:
    if os.environ.get(key):
        environment[key] = os.environ[key]
os.chdir(repository)
os.execve('/usr/bin/setpriv', ['setpriv', f'--reuid={uid}', f'--regid={gid}',
          '--clear-groups', '--bounding-set=-all', '--no-new-privs', node,
          str(repository / 'scripts/test-rust-quota.mjs')], environment)
