#!/usr/bin/env python3
"""Prepare an isolated Docker Compose pilot; never starts services during init."""
import argparse
import getpass
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
IMAGE = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{1,240}$')
GIT_ENV = {**os.environ, 'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_SYSTEM': '/dev/null',
           'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_COUNT': '0'}


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def private_write(file, value, mode=0o400):
    descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'w') as out:
        out.write(value)


def prepare(directory, image, repository=None, cert=None, key=None, port=8443):
    if os.geteuid() != 0:
        raise ValueError('Run init with sudo: runtime source secrets require root ownership.')
    if not IMAGE.fullmatch(image) or not 1024 <= port <= 65535:
        raise ValueError('Use a release image reference and a port from 1024 to 65535.')
    if bool(cert) != bool(key):
        raise ValueError('Provide both --tls-cert and --tls-key.')
    directory = Path(directory).absolute()
    if directory.exists() or directory.is_symlink() or not re.fullmatch(r'/[A-Za-z0-9_./-]+', str(directory)):
        raise ValueError('Choose a new absolute installation directory without spaces or shell characters.')
    if directory.parent.resolve() != directory.parent:
        raise ValueError('The installation parent must not contain symlinks.')
    if repository:
        repository = Path(repository).resolve(strict=True)
        result = run(['git', '-c', 'core.hooksPath=/dev/null', '-C', str(repository),
                      'rev-parse', '--show-toplevel'], env=GIT_ENV, capture_output=True, text=True)
        if Path(result.stdout.strip()) != repository:
            raise ValueError('Repository must be the root of a local Git checkout.')
    directory.mkdir(mode=0o700)
    for name in ['secrets', 'postgresql', 'init', 'repositories']:
        (directory / name).mkdir(mode=0o700)
    os.chown(directory / 'postgresql', 0, 999)
    os.chmod(directory / 'postgresql', 0o750)
    os.chmod(directory / 'init', 0o755)
    os.chmod(directory / 'repositories', 0o755)
    app_password = secrets.token_hex(32)
    for name, value in [('admin-password', secrets.token_hex(32)), ('app-password', app_password)]:
        file = directory / 'postgresql' / name
        private_write(file, value, 0o440)
        os.chown(file, 0, 999)
    for name, value in [('database-url', f'postgres://kelryvo:{app_password}@postgresql:5432/kelryvo'),
                        ('developer-token', secrets.token_hex(32)), ('approver-token', secrets.token_hex(32))]:
        private_write(directory / 'secrets' / name, value)
    private_write(directory / 'init' / '10-app.sh', '''#!/bin/bash
set -euo pipefail
app_password=$(cat /run/kelryvo/postgresql/app-password)
[[ "$app_password" =~ ^[a-f0-9]{64}$ ]] || exit 1
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE kelryvo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$app_password';
ALTER DATABASE kelryvo OWNER TO kelryvo;
ALTER SCHEMA public OWNER TO kelryvo;
REVOKE ALL ON DATABASE kelryvo FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
unset app_password
''', 0o555)
    if cert:
        for source, name in [(cert, 'tls.crt'), (key, 'tls.key')]:
            source = Path(source).resolve(strict=True)
            if not source.is_file() or source.stat().st_size > 131072:
                raise ValueError('TLS input must be a bounded regular file.')
            private_write(directory / 'secrets' / name, source.read_text())
    else:
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '90',
             '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
             '-keyout', str(directory / 'secrets/tls.key'), '-out', str(directory / 'secrets/tls.crt')],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for name in ['tls.crt', 'tls.key']:
            os.chmod(directory / 'secrets' / name, 0o400)
    if repository:
        target = directory / 'repositories/customer'
        run(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--no-local', '--', str(repository), str(target)],
            env=GIT_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for current, dirs, files in os.walk(target, followlinks=False):
            os.chown(current, 10001, 10001)
            os.chmod(current, 0o755)
            for name in files:
                file = Path(current) / name
                os.chown(file, 10001, 10001, follow_symlinks=False)
                if not file.is_symlink():
                    os.chmod(file, 0o644)
        private_write(directory / 'secrets/repositories.json', json.dumps({
            'format': 1, 'paths': ['/run/kelryvo/repositories/customer']}) + '\n')
    shutil.copyfile(ROOT / 'compose.pilot.yaml', directory / 'compose.yaml')
    os.chmod(directory / 'compose.yaml', 0o600)
    private_write(directory / 'pilot.env', f'KELRYVO_HOME={directory}\nKELRYVO_IMAGE={image}\nKELRYVO_HOST_PORT={port}\n', 0o600)
    print(f'Prepared {directory}. Services have not been started. Secrets were not printed.')
    print(f'Start: sudo docker compose --env-file {directory}/pilot.env -f {directory}/compose.yaml up -d')
    print(f'Then: sudo python3 scripts/pilot.py bootstrap --directory {directory}')


def compose(directory, args, **kwargs):
    directory = Path(directory).absolute()
    if directory.resolve() != directory or not directory.is_dir() or directory.stat().st_uid != 0:
        raise ValueError('Use the root-owned installation directory created by init.')
    for name in ['pilot.env', 'compose.yaml']:
        file = directory / name
        if file.is_symlink() or not file.is_file() or file.stat().st_uid != 0 or file.stat().st_mode & 0o077:
            raise ValueError('Installation configuration permissions are invalid.')
    return run(['docker', 'compose', '--env-file', str(directory / 'pilot.env'), '-f', str(directory / 'compose.yaml'), *args], **kwargs)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='action', required=True)
    init = commands.add_parser('init', help='Generate a new, private installation; does not deploy')
    init.add_argument('--directory', required=True)
    init.add_argument('--image', required=True)
    init.add_argument('--repository')
    init.add_argument('--tls-cert')
    init.add_argument('--tls-key')
    init.add_argument('--port', type=int, default=8443)
    for action in ['bootstrap', 'grant', 'status']:
        command = commands.add_parser(action)
        command.add_argument('--directory', required=True)
        if action == 'grant':
            command.add_argument('--project', required=True)
    args = parser.parse_args(argv)
    if args.action == 'init':
        prepare(args.directory, args.image, args.repository, args.tls_cert, args.tls_key, args.port)
    elif args.action == 'status':
        compose(args.directory, ['ps'])
    elif args.action == 'grant':
        if not re.fullmatch(r'[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}', args.project):
            raise ValueError('Use the project UUID shown by the application.')
        for identity in ['developer', 'approver']:
            compose(args.directory, ['exec', '-T', 'kelryvo', 'node', 'scripts/container-membership.mjs',
                                     'grant', args.project, f'kelryvo-{identity}'])
    else:
        accounts = []
        for identity in ['developer', 'approver']:
            username = input(f'{identity} username: ').strip()
            password = getpass.getpass(f'{identity} password: ')
            if password != getpass.getpass('Confirm password: '):
                raise ValueError('Password confirmation did not match; no accounts changed.')
            if not re.fullmatch(r'[a-z][a-z0-9._-]{2,63}', username) or not 15 <= len(password) <= 128 or len(password.encode('utf-8')) > 512 or any(ord(c) < 32 or ord(c) == 127 for c in password):
                raise ValueError('Use a 3-64 character lowercase username and a 15-128 character password (at most 512 UTF-8 bytes).')
            accounts.append((identity, {'username': username, 'password': password}))
        if accounts[0][1]['username'].lower() == accounts[1][1]['username'].lower():
            raise ValueError('Developer and approver need distinct usernames.')
        compose(args.directory, ['exec', '-T', 'kelryvo', 'node', 'scripts/container-membership.mjs', 'activate'])
        for identity, body in accounts:
            compose(args.directory, ['exec', '-T', 'kelryvo', 'node', 'scripts/container-password.mjs', 'reset', identity],
                    input=json.dumps(body), text=True)
        print('Accounts ready. Trust your installation TLS certificate, then sign in at the configured HTTPS address.')
        print('Create a project in the UI, then run the grant command with its project UUID.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError):
        print('Pilot operation failed. Check prerequisites, private file permissions and command inputs; existing data is preserved.', file=sys.stderr)
        sys.exit(1)
