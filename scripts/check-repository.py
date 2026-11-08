#!/usr/bin/env python3
"""Keep generated reports out of Git and one checklist as the shared handoff."""
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys


OUTPUT_DIRECTORIES = {
    '.cache', 'node_modules', 'coverage', 'dist', 'target', 'evidence',
    'reports', 'screenshots', 'test-results', 'playwright-report', 'blob-report',
    '__pycache__',
}
OUTPUT_FILES = {'.coverage', 'coverage.xml', 'junit.xml', 'lcov.info'}
LEGAL_MARKDOWN = {'license.md', 'notice.md', 'copying.md'}
IGNORE_PROBES = [
    '.cache/reports/result.json', 'coverage/lcov.info', 'reports/result.json',
    'screenshots/browser.png', 'test-results/result.xml', 'playwright-report/index.html',
    'blob-report/result.zip', 'evidence/run/result.json', 'checks.log',
]


def git(root, *args, input_bytes=None):
    result = subprocess.run(
        ['git', '-C', str(root), *args], input=input_bytes,
        capture_output=True, timeout=30, check=False,
    )
    if result.returncode not in (0, 1) or result.returncode == 1 and args[0] != 'check-ignore':
        raise RuntimeError('Repository hygiene requires a readable Git checkout')
    return result.stdout


def check_repository(root):
    paths = git(root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z')
    errors = []
    for raw in paths.split(b'\0'):
        if not raw:
            continue
        name = raw.decode('utf-8', errors='strict')
        path = PurePosixPath(name)
        if not (root / name).exists():
            continue  # A pending deletion will be removed with git add --update.
        display = json.dumps(name, ensure_ascii=True)
        if OUTPUT_DIRECTORIES.intersection(path.parts[:-1]) or path.name in OUTPUT_FILES or path.suffix in {'.log', '.lcov', '.pyc'}:
            errors.append(f'Generated output must stay outside Git: {display}')
        elif name.startswith('docs/') and not name.startswith('docs/dependencies/'):
            errors.append(f'Keep current requirements in CHECKLIST.md: {display}')
        elif path.suffix.lower() == '.md':
            allowed = name in {'README.md', 'CHECKLIST.md', 'CUSTOMER-GUIDE.md', 'docs/dependencies/antlr-provenance.md'}
            if not allowed and path.name.lower() not in LEGAL_MARKDOWN:
                errors.append(f'Use CHECKLIST.md instead of another status document: {display}')

    readme = root / 'README.md'
    if not readme.is_file() or 'CHECKLIST.md' not in readme.read_text(encoding='utf-8'):
        errors.append('README.md must point to the shared CHECKLIST.md')
    if readme.is_file() and len(readme.read_text(encoding='utf-8').splitlines()) > 30:
        errors.append('Keep README.md under 30 lines; details belong in CHECKLIST.md')
    if (root / 'CHECKLIST.md').is_file() and (root / 'Chart.yaml').is_file():
        errors.append('Helm must link to the app checklist instead of duplicating it')
    if not (root / 'CHECKLIST.md').is_file() and not (root / 'Chart.yaml').is_file():
        errors.append('Application checkout must contain CHECKLIST.md')
    ignored = git(root, 'check-ignore', '--no-index', '--stdin', '-z',
                  input_bytes=b'\0'.join(p.encode() for p in IGNORE_PROBES) + b'\0')
    missing = set(IGNORE_PROBES) - {p.decode() for p in ignored.split(b'\0') if p}
    if missing:
        errors.append('Missing generated-output ignore rules: ' + ', '.join(sorted(missing)))
    return errors


def main():
    root = Path(__file__).resolve().parents[1]
    try:
        errors = check_repository(root)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError):
        print('Repository hygiene could not inspect the checkout', file=sys.stderr)
        return 1
    if errors:
        print('\n'.join(errors), file=sys.stderr)
        return 1
    print('PASS: one checklist handoff; generated outputs ignored and absent from Git')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
