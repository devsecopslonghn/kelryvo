# Verified prediction-context runtime repair

The application uses the published `antlr-rust-runtime 0.34.0` archive plus the
single-function `ContextArena::merge` repair in `context-merge.patch`. The repair
uses a heap worklist and preserves the original cache, wildcard behavior and
interning order. Parser output, bounds, hashes and grammar generation are unchanged.

## Why this dependency mechanism

On 2026-11-14 the official crates.io API reports 0.34.0 as the newest release.
Upstream main `826518d1f326b77ad094d4871d001144adfd8ba1` has byte-identical
`crates/antlr-rust-runtime/src/prediction.rs` to the published archive, including
the recursive merge. There is no official fixed version to select.
A separately maintained Git fork would add another repository and security/source
archive type: the existing source gate deliberately accepts exact registry
archives, not Git dependencies. An immutable fork is feasible, but offers no
benefit over retaining this small patch against the already verified archive.
Full vendoring is unnecessary because explicit preparation works offline.

Primary evidence: [official crate metadata](https://crates.io/api/v1/crates/antlr-rust-runtime),
[pinned upstream source](https://github.com/ophi-dev/antlr-rust-runtime/blob/826518d1f326b77ad094d4871d001144adfd8ba1/crates/antlr-rust-runtime/src/prediction.rs).

## Prepare before invoking application Cargo commands

Prerequisites: Linux, Python 3.9 or later (standard library only), `/usr/bin/git`,
and the repository's pinned Rust/toolchain and native system prerequisites.
Python is a host preparation tool; Docker builder and final application images
do not contain it. Prepare the dependency before invoking `docker build`. The
existing native generator verifies the supplied tree before application compilation
using `--verify-runtime`; Docker never applies a patch or downloads this runtime.
From the repository root:

```sh
# Explicit online preparation; does not write Cargo's registry cache.
python3 tools/prepare-dependencies.py --fetch
cargo fetch --locked
cargo fetch --locked --manifest-path tools/oracle-codegen/Cargo.toml

# Subsequent preparation/verification requires no network.
python3 tools/prepare-dependencies.py --verify
CARGO_NET_OFFLINE=true cargo check --workspace --all-targets --all-features --locked --offline
CARGO_NET_OFFLINE=true cargo check --locked --offline --manifest-path tools/oracle-codegen/Cargo.toml
```

For an air-gapped checkout, transfer the exact archive and the prepared Cargo cache
through the approved dependency-input channel. Use
`python3 tools/prepare-dependencies.py --archive /absolute/antlr-rust-runtime-0.34.0.crate`.
Plain preparation without flags reads the previously verified `.deps/` archive;
only `--fetch` permits a download. Missing or corrupt prepared sources fail closed;
the tool never replaces a corrupt existing directory or changes a global cache.
Keep Cargo's caches for both independently locked workspaces: fetching only the
application workspace does not prepare the host grammar generator.
The generator's build-script fallback explicitly uses `--locked --offline`.

The tool verifies the pristine archive, extracts only bounded regular files into
a temporary private directory, checks the exact patch hash, applies it with
`git apply --no-index`, verifies all 79 resulting files, and atomically installs
`.deps/antlr-rust-runtime`. No ordinary Cargo build script applies patches.
The root `[patch.crates-io]` uses this explicit relative path. Cargo.lock records
the same package/version/dependencies as PR #151; path packages have no registry
checksum in Cargo.lock. `provenance.json` therefore pins the archive, patch and
complete prepared source identity independently. No branch tracking is involved.

## Immutable identities and verification

- Pristine archive SHA-256: `11b6fb4f9634cc5620c38a6951c0898d5bbbd03f43e384e64292570dafa48182`.
- Published source commit: `513228ada1f8033a81d83a28e62f3a755b8495d9`.
- Patch SHA-256: `12a148955364eabb53d37929eac056a8818459ce71841ade745db17ebf3d6e23`.
- Patched prediction.rs SHA-256: `73436aa50e50eef9e7838592ff0de38d6ec189663c3e4787689a5d5b08e67e24`.
- Complete source identity: `accf7f40f3ca83864f44f11bcbcf3daa707cffbf3911ca2d43b2523338f5c5b9`.

The complete identity hashes sorted UTF-8 records `relativePath + NUL + fileSHA256 + LF`.
Prepared source files have mode 0644; read-only distribution copies may use 0444.
Symlinks, hardlinks, extra/missing files, other modes and
identity changes are rejected. `cargo repository dependencies`, grammar provenance
tests, and distribution source collection independently verify the prepared tree.
The grammar provenance test additionally compares every file with the original
archive and permits changes only inside `ContextArena::merge`.

`python3 tools/check-context-merge.py` retains the 4,000 deterministic DAG comparison
and 10,000-parent/256-KiB regression. It expects the pristine implementation to
abort on the latter and the repaired implementation to succeed. The unchanged
300-parenthesis parser regression and debug-info=2 CI gate remain enabled.

The application distribution includes the prepared source, exact archive, patch,
preparation tool and original BSD-3-Clause license. The host generator also retains
the pristine registry archive in its existing Cargo license inventory. Source tree
identity includes prepared runtime bytes before compilation and is independently
recomputed by distribution/image verification. Nothing is downloaded at runtime.
Remove this patch only after an upstream release passes the same contracts and
reviewed dependency provenance changes. Updating any pin requires code review and
all existing source, security, architecture and delivery gates.
