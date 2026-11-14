#!/usr/bin/env python3
"""Explicit, verified preparation of the one patched Cargo dependency.

Uses only Python's standard library and Git; never writes Cargo's cache.
Network access requires --fetch. Ordinary Cargo build scripts do not call this.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
INPUTS = ROOT / "dependencies/antlr-rust-runtime"
DEPS = ROOT / ".deps"
SOURCE = DEPS / "antlr-rust-runtime"
ARCHIVE = DEPS / "antlr-rust-runtime-0.34.0.crate"
LIMIT = 8 * 1024 * 1024


def digest(data):
    return hashlib.sha256(data).hexdigest()


def regular(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > LIMIT:
        raise ValueError(f"Expected bounded regular file: {path}")
    return path.read_bytes()


def verified(data, expected, label):
    if digest(data) != expected:
        raise ValueError(f"Identity mismatch: {label}")
    return data


def identity(files):
    return digest("".join(f"{name}\0{digest(data)}\n"
                          for name, data in sorted(files.items())).encode())


def source_files(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Expected prepared source directory")
    files = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError(f"Source symlink: {path}")
        if not path.is_dir():
            if stat.S_IMODE(path.stat().st_mode) not in (0o444, 0o644):
                raise ValueError(f"Source mode changed: {path}")
            files[path.relative_to(directory).as_posix()] = regular(path)
    return files


def verify_source(directory, pin):
    files = source_files(directory)
    if len(files) != pin["files"] or identity(files) != pin["sourceTreeSha256"]:
        raise ValueError("Prepared source inventory changed; do not build it")
    verified(files["src/prediction.rs"], pin["predictionSha256"], "prediction.rs")


def unpack(data, directory):
    total = 0
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        for member in archive:
            path = PurePosixPath(member.name)
            if (not member.isfile() or path.parts[0] != "antlr-rust-runtime-0.34.0"
                    or ".." in path.parts or path.is_absolute() or len(path.parts) < 2):
                raise ValueError("Unexpected upstream archive entry")
            relative = Path(*path.parts[1:])
            total += member.size
            if relative in seen or member.size > LIMIT or total > LIMIT:
                raise ValueError("Duplicate or oversized upstream archive entry")
            seen.add(relative)
            target = directory / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())
            target.chmod(0o644)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch", action="store_true", help="allow pinned HTTPS download")
    parser.add_argument("--archive", type=Path, help="use an existing archive without network")
    parser.add_argument("--verify", action="store_true", help="read-only prepared-source check")
    args = parser.parse_args()
    if args.fetch and (args.archive or args.verify):
        parser.error("--fetch cannot be combined with --archive or --verify")
    pin = json.loads(regular(INPUTS / "provenance.json"))
    if pin["format"] != 1 or pin["name"] != "antlr-rust-runtime" or pin["version"] != "0.34.0":
        raise ValueError("Unreviewed dependency identity")
    verified(regular(INPUTS / "context-merge.patch"), pin["patchSha256"], "patch")
    if DEPS.is_symlink():
        raise ValueError("Dependency directory must not be a symlink")
    if args.verify:
        verified(regular(ARCHIVE), pin["archiveSha256"], "archive")
        verify_source(SOURCE, pin)
        print(f"Verified prepared runtime: {pin['sourceTreeSha256']}")
        return
    DEPS.mkdir(exist_ok=True)
    if not ARCHIVE.exists():
        if args.archive:
            data = regular(args.archive)
        elif args.fetch:
            with urllib.request.urlopen(pin["archiveUrl"], timeout=60) as response:
                data = response.read(LIMIT + 1)
        else:
            raise ValueError("Archive missing; supply --archive FILE or explicitly use --fetch")
        if len(data) > LIMIT:
            raise ValueError("Archive exceeds bound")
        verified(data, pin["archiveSha256"], "downloaded archive")
        with ARCHIVE.open("xb") as output:
            output.write(data)
        ARCHIVE.chmod(0o644)
    data = verified(regular(ARCHIVE), pin["archiveSha256"], "archive")
    if SOURCE.exists() or SOURCE.is_symlink():
        verify_source(SOURCE, pin)
    else:
        with tempfile.TemporaryDirectory(prefix="prepare-", dir=DEPS) as temporary:
            staged = Path(temporary) / "source"
            staged.mkdir()
            unpack(data, staged)
            subprocess.run(["/usr/bin/git", "apply", "--no-index",
                            str(INPUTS / "context-merge.patch")], cwd=staged, check=True,
                           env={"PATH": "/usr/bin:/bin", "GIT_CONFIG_NOSYSTEM": "1",
                                "GIT_CONFIG_GLOBAL": "/dev/null"})
            verify_source(staged, pin)
            os.rename(staged, SOURCE)
    print(f"Prepared runtime: {pin['sourceTreeSha256']}; Cargo can now resolve --locked")


if __name__ == "__main__":
    main()
