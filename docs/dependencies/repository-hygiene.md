# Repository ownership, dependency preparation and hygiene

Audit date: 2026-11-14. Baseline master: `758bcaf0fc264aec4ff167174ab6d7e6eb9d3697`;
PR #151 before cleanup: `c983b90715a90bbba4d29ec384b5467ebb9534fb`.
The existing branch remains the delivery vehicle; no merge, release or deployment.

## Measurement and ownership

The inventory covers every tracked blob from both complete Git trees, including
hidden paths, every Rust crate, nested manifests, archives and non-Rust assets.
Counts use Git tree membership, physical text lines including blanks, and exact
uncompressed blob bytes (not filesystem allocation, compressed Git size or caches).
Application Rust LOC includes owned tests/build adapters; third-party Rust and
upstream-generated Rust are disjoint. Inventory LOC includes all UTF-8 text;
compressed/binary blobs count toward bytes, not text LOC. Lockfile counts include
all targets and build/dev dependencies. No dependency version was upgraded.

<!-- metrics:start -->
| Metric | Before PR #151 cleanup | After | Difference |
|---|---:|---:|---:|
| Tracked files | 523 | 450 | -73 |
| Tracked repository bytes | 8,826,360 | 6,160,620 | -2,665,740 |
| Application Rust LOC | 78,984 | 79,352 | +368 |
| Vendored third-party Rust LOC | 60,496 | 0 | -60,496 |
| Generated tracked Rust LOC | 129 | 0 | -129 |
| Cargo dependencies (root external packages) | 381 | 381 | +0 |
| Lockfile packages (root) | 395 | 395 | +0 |
| Lockfile packages (host generator) | 302 | 302 | +0 |
| PR additions | 63,975 | 1,460 | -62,515 |
| PR deletions | 6 | 14 | +8 |
<!-- metrics:end -->

The final PR delta is measured against fetched `origin/master`, rather than the
older local `master` ref. Deleting the vendor tree removes it from the current
tracked tree and final PR diff; existing Git history retains the prior blobs.
No history rewrite or destructive cache cleanup was performed.

## Complete master and original PR inventory

Rows partition all tracked files. Each application crate row includes its source,
manifest, tests and required embedded SQL; separately listed immutable inputs are
excluded from that crate's row. No directory was assumed redundant from its size.

<!-- baseline:start -->
| Path | Classification | Master files / LOC / bytes | PR #151 before files / LOC / bytes | Disposition |
|---|---|---:|---:|---|
| `.github` | SOURCE_INPUT | 8 / 709 / 30,884 | 8 / 719 / 31,246 | KEEP TRACKED |
| `Cargo.lock` | CARGO_DEPENDENCY | 1 / 4,150 / 98,439 | 1 / 4,150 / 98,315 | KEEP TRACKED |
| `crates/antlr-rust-runtime` | THIRD_PARTY_SOURCE | 0 / 0 / 0 | 77 / 63,441 / 2,279,889 | MOVE TO DEPENDENCY MANAGEMENT |
| `crates/antlr-rust-runtime/PATCH.md` | DOCUMENTATION | 0 / 0 / 0 | 1 / 26 / 1,648 | MOVE TO DEPENDENCY MANAGEMENT |
| `crates/antlr-rust-runtime/src/xpath/generated` | GENERATED_SOURCE | 0 / 0 / 0 | 2 / 142 / 9,513 | MOVE TO DEPENDENCY MANAGEMENT |
| `crates/antlr-rust-runtime/upstream` | CARGO_DEPENDENCY | 0 / 0 / 0 | 1 / 0 / 434,609 | MOVE TO DEPENDENCY MANAGEMENT |
| `crates/kelryvo-cli` | APPLICATION_SOURCE | 34 / 8,223 / 302,106 | 34 / 8,223 / 302,106 | KEEP TRACKED |
| `crates/kelryvo-core` | APPLICATION_SOURCE | 25 / 5,160 / 182,444 | 25 / 5,160 / 182,444 | KEEP TRACKED |
| `crates/kelryvo-discovery` | APPLICATION_SOURCE | 5 / 604 / 21,388 | 5 / 604 / 21,388 | KEEP TRACKED |
| `crates/kelryvo-fixtures` | APPLICATION_SOURCE | 2 / 94 / 3,100 | 2 / 94 / 3,100 | KEEP TRACKED |
| `crates/kelryvo-launcher` | APPLICATION_SOURCE | 9 / 1,622 / 59,545 | 9 / 1,622 / 59,545 | KEEP TRACKED |
| `crates/kelryvo-operator` | APPLICATION_SOURCE | 34 / 7,981 / 310,934 | 34 / 7,981 / 310,934 | KEEP TRACKED |
| `crates/kelryvo-operator/src/backup/profiles.json` | COMPATIBILITY_DATA | 1 / 2,915 / 1,391,667 | 1 / 2,915 / 1,391,667 | KEEP TRACKED |
| `crates/kelryvo-operator/tests/fixtures` | TEST_FIXTURE | 1 / 190 / 5,775 | 1 / 190 / 5,775 | KEEP TRACKED |
| `crates/kelryvo-oracle-grammar` | APPLICATION_SOURCE | 6 / 521 / 19,126 | 7 / 606 / 22,188 | KEEP TRACKED |
| `crates/kelryvo-oracle-grammar license/NOTICE` | DOCUMENTATION | 2 / 228 / 13,091 | 2 / 228 / 13,091 | KEEP TRACKED |
| `crates/kelryvo-oracle-grammar/grammar` | SOURCE_INPUT | 2 / 111 / 2,780 | 2 / 111 / 2,780 | KEEP TRACKED |
| `crates/kelryvo-oracle-grammar/upstream` | SOURCE_INPUT | 2 / 12,725 / 362,107 | 2 / 12,725 / 362,107 | KEEP TRACKED |
| `crates/kelryvo-parser` | APPLICATION_SOURCE | 8 / 923 / 36,440 | 8 / 948 / 37,623 | KEEP TRACKED |
| `crates/kelryvo-runtime` | APPLICATION_SOURCE | 22 / 5,382 / 204,425 | 22 / 5,382 / 204,425 | KEEP TRACKED |
| `crates/kelryvo-server` | APPLICATION_SOURCE | 103 / 25,634 / 1,177,838 | 103 / 25,634 / 1,177,838 | KEEP TRACKED |
| `crates/kelryvo-test-tools` | APPLICATION_SOURCE | 17 / 3,181 / 120,458 | 17 / 3,181 / 120,458 | KEEP TRACKED |
| `crates/kelryvo-vault` | APPLICATION_SOURCE | 2 / 204 / 6,692 | 2 / 204 / 6,692 | KEEP TRACKED |
| `crates/kelryvo-web` | APPLICATION_SOURCE | 33 / 11,244 / 458,564 | 33 / 11,244 / 458,564 | KEEP TRACKED |
| `crates/kelryvo-worker` | APPLICATION_SOURCE | 39 / 10,204 / 418,805 | 39 / 10,204 / 418,805 | KEEP TRACKED |
| `docs/dependencies/*.json` | SOURCE_INPUT | 2 / 123 / 5,455 | 2 / 123 / 5,455 | KEEP TRACKED |
| `documentation and project licenses` | DOCUMENTATION | 7 / 1,622 / 107,031 | 7 / 1,857 / 120,295 | KEEP TRACKED |
| `root configuration and deploy inputs` | SOURCE_INPUT | 10 / 442 / 20,981 | 10 / 447 / 21,180 | KEEP TRACKED |
| `tests/fixtures/contracts` | COMPATIBILITY_DATA | 27 / 35 / 607,159 | 27 / 35 / 607,159 | KEEP TRACKED |
| `tests/fixtures/parser` | TEST_FIXTURE | 32 / 741 / 24,656 | 32 / 741 / 24,656 | KEEP TRACKED |
| `tests/fixtures/pilot-legacy-init.fixture` | COMPATIBILITY_DATA | 1 / 12 / 514 | 1 / 12 / 514 | KEEP TRACKED |
| `tests/support` | APPLICATION_SOURCE | 3 / 306 / 12,274 | 3 / 306 / 12,274 | KEEP TRACKED |
| `tools/oracle-codegen` | APPLICATION_SOURCE | 2 / 114 / 4,198 | 2 / 114 / 4,198 | KEEP TRACKED |
| `tools/oracle-codegen/Cargo.lock` | CARGO_DEPENDENCY | 1 / 2,869 / 73,879 | 1 / 2,869 / 73,879 | KEEP TRACKED |
<!-- baseline:end -->

## Final tracked inventory

<!-- inventory:start -->
| Path | Classification | Origin | Tracked files | LOC | Size (bytes) | Must remain tracked? | Reason |
|---|---|---|---:|---:|---:|---|---|
| `.github` | SOURCE_INPUT | Kelryvo pinned workflows/actions | 8 | 724 | 31,514 | Yes | Configured source/security/image gates; no build outputs |
| `Cargo.lock` | CARGO_DEPENDENCY | Cargo exact dependency resolution | 1 | 4,150 | 98,315 | Yes | Immutable versions/checksums; not a cache or generated parser |
| `crates/kelryvo-cli` | APPLICATION_SOURCE | Kelryvo | 34 | 8,469 | 312,224 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-core` | APPLICATION_SOURCE | Kelryvo | 25 | 5,160 | 182,444 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-discovery` | APPLICATION_SOURCE | Kelryvo | 5 | 604 | 21,388 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-fixtures` | APPLICATION_SOURCE | Kelryvo | 2 | 94 | 3,100 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-launcher` | APPLICATION_SOURCE | Kelryvo | 9 | 1,622 | 59,545 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-operator` | APPLICATION_SOURCE | Kelryvo | 34 | 7,981 | 310,934 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-operator/src/backup/profiles.json` | COMPATIBILITY_DATA | historical application backup formats | 1 | 2,915 | 1,391,667 | Yes | Consumed by backup schema validation and regression tests |
| `crates/kelryvo-operator/tests/fixtures` | TEST_FIXTURE | application managed-backup fixture | 1 | 190 | 5,775 | Yes | Managed backup tests and probe consume it |
| `crates/kelryvo-oracle-grammar` | APPLICATION_SOURCE | Kelryvo | 7 | 607 | 22,312 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-oracle-grammar license/NOTICE` | DOCUMENTATION | original approved grammar license/attribution | 2 | 228 | 13,091 | Yes | Upstream-owned legal inputs remain intact |
| `crates/kelryvo-oracle-grammar/grammar` | SOURCE_INPUT | Kelryvo semantics and frozen grammar hash lock | 2 | 111 | 2,780 | Yes | Generator input and independent output identities |
| `crates/kelryvo-oracle-grammar/upstream` | SOURCE_INPUT | pinned grammars-v4 / Apache-2.0 | 2 | 12,725 | 362,107 | Yes | Original approved grammar inputs, independently hash-verified |
| `crates/kelryvo-parser` | APPLICATION_SOURCE | Kelryvo | 8 | 948 | 37,623 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-runtime` | APPLICATION_SOURCE | Kelryvo | 22 | 5,382 | 204,425 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-server` | APPLICATION_SOURCE | Kelryvo | 103 | 25,634 | 1,177,838 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-test-tools` | APPLICATION_SOURCE | Kelryvo | 17 | 3,181 | 120,458 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-vault` | APPLICATION_SOURCE | Kelryvo | 2 | 204 | 6,692 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-web` | APPLICATION_SOURCE | Kelryvo | 33 | 11,244 | 458,564 | Yes | Application/support source, manifests, tests and required SQL assets |
| `crates/kelryvo-worker` | APPLICATION_SOURCE | Kelryvo | 39 | 10,204 | 418,805 | Yes | Application/support source, manifests, tests and required SQL assets |
| `dependencies/antlr-rust-runtime` | SOURCE_INPUT | Kelryvo repair + upstream BSD-3-Clause license | 4 | 192 | 10,599 | Yes | Only patch, pinned identities, license and preparation documentation |
| `docs/dependencies/*.json` | SOURCE_INPUT | reviewed dependency/toolchain pins | 2 | 123 | 5,492 | Yes | Independent provenance and approved immutable input identities |
| `documentation and project licenses` | DOCUMENTATION | Kelryvo and attributed grammar notices | 8 | 2,145 | 144,674 | Yes | Maintained project documentation and license obligations |
| `root configuration and deploy inputs` | SOURCE_INPUT | Kelryvo | 10 | 467 | 21,877 | Yes | Manifests, ignore/format policy, Docker and deployment source inputs |
| `tests/fixtures/contracts` | COMPATIBILITY_DATA | retained independent migration contracts | 27 | 35 | 607,159 | Yes | 26 compressed contracts + hash inventory; 169 routes / 1228 kernel cases |
| `tests/fixtures/parser` | TEST_FIXTURE | retained parser corpus | 32 | 741 | 24,656 | Yes | Exact accepted/rejected SQL, UTF-8 and invalid-byte cases |
| `tests/fixtures/pilot-legacy-init.fixture` | COMPATIBILITY_DATA | historical pilot initialization format | 1 | 12 | 514 | Yes | Retained compatibility input; preserve even without a current direct consumer |
| `tests/support` | APPLICATION_SOURCE | Kelryvo | 3 | 306 | 12,274 | Yes | Shared test support |
| `tools/check-context-merge.py` | APPLICATION_SOURCE | Kelryvo preparation/verification tooling | 1 | 71 | 3,692 | Yes | Small explicit dependency preparation and regression checks |
| `tools/dependency_source.rs` | APPLICATION_SOURCE | Kelryvo preparation/verification tooling | 1 | 107 | 3,767 | Yes | Small explicit dependency preparation and regression checks |
| `tools/oracle-codegen` | APPLICATION_SOURCE | Kelryvo isolated generator adapter | 2 | 128 | 4,747 | Yes | Own source and manifest; all third-party implementation resolved by Cargo |
| `tools/oracle-codegen/Cargo.lock` | CARGO_DEPENDENCY | Cargo exact dependency resolution | 1 | 2,869 | 73,879 | Yes | Immutable versions/checksums; not a cache or generated parser |
| `tools/prepare-dependencies.py` | APPLICATION_SOURCE | Kelryvo preparation/verification tooling | 1 | 142 | 5,689 | Yes | Small explicit dependency preparation and regression checks |
<!-- inventory:end -->

## Candidates, consumers and retained boundaries

- **MOVE TO DEPENDENCY MANAGEMENT:** all 81 files under
  `crates/antlr-rust-runtime/`, including the original `.crate`, normalized and
  original manifests, nested lockfile, source, snapshots, generated XPath lexer,
  README and local PATCH.md. The exact 79 published files and archive are prepared
  in ignored `.deps/`; only the small patch, identity manifest, BSD license and
  documentation remain tracked. This is dependency reconstruction, not a directory
  relocation. See [preparation and immutable identities](../../dependencies/antlr-rust-runtime/README.md).
- **KEEP TRACKED:** approved original `PlSqlLexer.g4` and `PlSqlParser.g4`, Apache
  license/NOTICE, semantic patterns and frozen output hash lock. Rust parser/lexer,
  adapted grammars and generated semantics belong in Cargo OUT_DIR, not Git.
- **KEEP TRACKED:** 26 independent gzip contract archives plus provenance.json.
  `kelryvo-fixtures`, shared contract tests and `cargo check-delivery` consume them;
  fixed route/kernel membership is 169/1,228. Large retained response fixtures
  cannot safely be regenerated from the implementation under test.
- **KEEP TRACKED:** `crates/kelryvo-operator/src/backup/profiles.json` is historical
  compatibility data exported from the former `packages/backup/index.mjs`, not a
  dependency cache. `backup/schema.rs`, backup tests and managed restore behavior
  rely on the exact trusted profile formats. It must not be regenerated casually.
- **KEEP TRACKED:** managed backup fixtures (managed tests and probe), parser SQL,
  invalid UTF-8 binary and CRLF corpus, and legacy pilot initialization fixture.
  The latter has no current direct source reference; retain it as compatibility
  evidence rather than inferring obsolescence from an absent current consumer.
- **KEEP TRACKED:** 14 application/support crates and the small isolated
  `tools/oracle-codegen` adapter. The isolated workspace contains authored source,
  Cargo manifest and lockfile, not copied generator/runtime implementations.
  SQL files, browser CSS/HTML, example programs and the Helm patch are source inputs.
- **REMOVE FROM GIT:** no additional master files qualify. Both inspected trees
  have no tracked compiler outputs, registry caches, toolchain executables, Git
  submodules, LFS pointers or `.gitmodules`. `.gitattributes` has only text/binary
  fixture and patch whitespace policy. No other copied Rust library was found
  after reviewing all manifests, ownership headers and every Rust source location.
- **INVESTIGATE / retained:** legal clearance described in the existing grammar
  provenance document remains an explicit qualification limit; this cleanup does
  not resolve it. No unlicensed upstream Java support code is introduced.

Local `target/` (~62 GiB at audit start), `.cache/` (~2.5 GiB), generated Cargo
OUT_DIRs, dependency registry sources/archives and the new `.deps/` are
BUILD_ARTIFACT / CACHE / GENERATED_SOURCE / CARGO_DEPENDENCY with **zero tracked
files**. Ignored runtime/account fixtures may contain private inputs; no such
files were deleted or inspected for contents. Some private fixture directories
reject ordinary-user reads. Git's non-ignored untracked inventory was empty before
this task. Cache sizes are diagnostic observations, not cleanup targets.

## Ignore policy and guardrails

The existing ignore file already covered nested Cargo targets, generated parser
outputs, caches, reports, secrets, wallet files, node_modules and Python bytecode.
Only `.deps/` was added; no duplicate catch-all rules or source exclusions were
needed. Cargo.lock, approved grammar inputs, compatibility profiles, frozen
archives and licenses remain tracked and explicitly checked as non-ignored.
`.dockerignore` admits only the small new dependency inputs/tools; only the prepared runtime directory and exact archive are admitted from `.deps/`.
The existing native Rust generator independently verifies their complete identities
before Docker invokes root Cargo; Docker never installs a Python interpreter or
changes the bootstrap gate.

The existing `cargo repository hygiene` gate now rejects forced tracked caches,
unauthorized vendor/upstream trees, unknown nested Cargo manifests even under
innocent names, Rust outside known application/tool/test ownership, compiler
extensions, generated grammar paths, and upstream/generated Rust header markers.
It probes required ignore rules and retained inputs. Existing `check-delivery`
runs focused repository gate tests, including a forced `git add -f` cache and a
renamed dependency manifest. It uses no file-size heuristic and exempts only the
two approved original grammar source paths, not an entire third-party directory.

An intentional vendoring exception requires a reviewed change naming exact paths,
upstream version/commit, archive/file hashes and license, necessity versus Cargo
or explicit preparation, and removal/update ownership. Add a narrowly scoped
policy exception with positive/negative regression coverage in that same PR;
do not add generic vendor-directory exemptions or change a gate without approval.
The Cargo archive inventory also rejects unreviewed non-workspace path packages;
only the exact prepared runtime is accepted and independently verified. Source
collection excludes ignored nested compiler targets while final distribution
verification still checks every delivered file.

Header/path detection cannot prove authorship of arbitrary disguised code; normal
source review and complete Cargo/provenance verification remain necessary.

## Verification

Results are recorded after the implementation and fresh-cache exercises below.
No unrun check is treated as passing. Existing PR #151 parser investigation in
RELEASE-READINESS.md remains historical evidence; paths to the previously tracked
runtime there refer to the original implementation stage.

<!-- verification:start -->
| Check | Result / evidence |
|---|---|
| Explicit preparation and read-only verification | PASS; exact archive and all 79 prepared files match pinned identities |
| Fresh Cargo cache | PASS; initially empty private CARGO_HOME fetched both locked closures (608 distinct registry archives); no dependency upgrades |
| Cold prepared checkout, network disconnected | PASS; `unshare -Urn` + `CARGO_NET_OFFLINE=true cargo check --workspace --all-targets --all-features --locked --offline` (156.26 s) |
| Isolated host generator, network disconnected | PASS; separate `cargo check --locked --offline --manifest-path tools/oracle-codegen/Cargo.toml` (44.69 s) |
| Final source update in the independent prepared checkout | PASS; same two network-isolated checks (39.54 s / 0.73 s), including the native verifier adapter |
| Full core/parser source group | PASS; `cargo native-test --ci-tests core-parser`, 47 tests, original ignored workload enabled |
| Release parser and grammar contracts | PASS; `cargo test --release --locked --offline -p kelryvo-parser -p kelryvo-oracle-grammar`, 22 tests |
| Default debug-info=2 regression gate | PASS; dev/test debug=2, incremental=0, default test-thread stack; all 5 native tests |
| Deterministic context comparisons | PASS; 4,000 DAG outputs byte-identical to upstream; SHA-256 `4b5c995467a95382810858c904090201d7f1c1d76fc9c261afdb896d7f4fb7f0`; 10,000-parent chain fails upstream and succeeds patched on 256 KiB |
| Parser performance | PASS; `cargo parser-performance`, all 8 optimized workloads, unchanged input hashes/outcomes and limits |
| Workspace Clippy | PASS; `cargo clippy --workspace --all-targets --all-features --locked --offline -- -D warnings` on final implementation |
| WASM Clippy and release bundle | PASS; existing web WASM Clippy command and `cargo build-web`, using wasm-bindgen 0.2.130 |
| Delivery/archive/license gates | PASS; `cargo check-delivery`: unchanged 12 bootstrap inputs across both architectures, 169-route/1,228-kernel contracts, focused repository/OCI/tool tests, 380 application + 301 host-generator registry archives and independently verified prepared runtime |
| Source packaging integrity | PASS; ignored nested compiler output excluded from source inventory; final distribution membership/mode/symlink checks remain strict (2 focused tests) |
| Rejection probes | PASS; missing archive forbids implicit fetch; corrupt archive/patch/source, extra/missing source, symlinks and unapproved writable modes fail; immutable 0444 distribution copies succeed in both Python and native Rust verification |
| Repository formatting and workflow syntax | PASS; workspace/generator formatting, `git diff --check`, actionlint |
| Tracked secrets/compiler payloads | No private-key payloads, ELF/PE/WASM executables, LFS pointers or dependency archives; required invalid-encoding fixture and frozen gzip contracts retained |
| Hosted source, CodeQL, OCI/platform checks | Required on updated PR #151 head; exact run identities and final conclusions are recorded in the PR, never inferred from previous-head checks |

Optimized warm medians (milliseconds; diagnostic measurements, no new latency gate):

| Workload | Warm median ms |
|---|---:|
| small-ddl | 1.305 |
| ddl-batch-128 | 155.216 |
| maximum-statements | 52.007 |
| maximum-bytes | 5.395 |
| late-syntax-error | 139.190 |
| excessive-statements | 49.808 |
| excessive-rule-depth | 1217.311 |
| maximum-bytes-unterminated-quote | 0.489 |

The initial attempt to install Python in the Docker builder was rejected by the
existing bootstrap policy. That policy was preserved: host preparation plus the
existing native Rust generator's read-only verification satisfies the build
requirement. Final delivery tests pass; no approval/security gate was weakened.
The parser implementation is byte-identical to the repaired runtime in the
original PR; accepted/rejected cases, offsets, profiles, SQL/digests, grammar
inputs and frozen output hashes remain unchanged. Source-tree identity changes
with the reviewed build/dependency layout and continues to bind exact image bytes.

Local evidence is in ignored `.cache/hygiene-*` logs, including fresh-cache and
network-isolated command/result records. A clean clone of the final committed
head is additionally checked offline before completion; its result and hosted
run URLs are retained in the PR description to avoid rewriting report history
merely to insert the commit's own SHA or CI run IDs.
<!-- verification:end -->

## Remaining risks

The explicit preparation step is required before root Cargo metadata/builds,
including cache actions. A fresh air-gapped environment must receive both pinned
Cargo dependency closures, the exact runtime archive, native system prerequisites
and the pinned toolchain before disconnecting. Prepared source modification is
rejected by source tests, dependency/archive gates and distribution identity
collection; Cargo itself does not checksum path dependencies. The patch must be
reviewed against a future upstream release before removal. Local Git history
still contains earlier vendor objects; reducing historical storage would require
a separate explicitly authorized history rewrite, which this PR does not perform.
