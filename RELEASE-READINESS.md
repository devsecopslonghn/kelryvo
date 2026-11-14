# Release readiness assessment — 2026-11-14

**The current checkout is not release-qualified.** Focused product workflows and
witnessed metadata restoration passed locally. Oracle execution/recovery and
exact-image release gates remain unverified. The original local core/parser
failure is resolved by the Phase 6.1 investigation below. That correction does
not grant runtime or release qualification.

## Source and review scope

The Phase 5/5.1 scope and counts below describe PR #150. The separate Phase 6.1
runtime repair, dependency provenance and verification are recorded at the end
of this assessment.

Baseline: `d32a221f9d8f52c481fdaddd1348899ea8418a16` (`master`, also remote master
when inspected). Phase 5/5.1 began as 16 modified tracked files and two new Rust
files. All 18 belong to the workflow change; this assessment is the additional
delivery document. Generated assets, private fixtures, credentials and diagnostic
scripts remain ignored. No backend, persisted schema, dependency, lockfile,
worker, runtime, delivery workflow or security-gate changes are included.

The complete diff was inspected, including both originally untracked modules.
`browser::preparation` coordinates existing APIs and retains request outcomes in
the signed-in page session. Existing backend transactions, CAS, authorization,
validation, immutable artifacts, independent approval and protected execution
remain authoritative. `plans` owns review reads; project setup reuses instance
controls; `workflow` contains request projection and presentation labels only.
There is no additional engine or generic orchestration/state framework.

Unconfirmed Git imports are reconciled by pinned source; unconfirmed plan writes
are inspected without another POST. Validation may append diagnostics only after
an explicit retry and an unsuccessful retained-report lookup. These paths never
execute SQL. Plan response projection and mutation authorization happen before
the server transaction commits. Completed artifact IDs are reused. A page reload
loses session checkpoints: users must inspect retained server artifacts before
starting a fresh preparation. This remains a documented recovery limitation.

The review uses the backend's `PROTECTED_SOURCE_CURRENT` result. The author still
cannot approve their own plan. HOLD and unknown states offer no replay authority.
No historical record is rewritten, no old approval acquires new parser/runtime
authority, and compatibility creation/inspection paths remain available. Passing
retained contracts/catalog tests establishes bounded compatibility, not full
browser parity or qualification of every historical Oracle installation.

Phase 6 found and fixed one workflow lint defect: the WASM-only `plan_body`
helper/import is now compiled only for WASM, so native unit-test lint does not
fail on unused code. No warning suppression or gate change was introduced.

## Workflow changes represented in the PR

| Change | Previous workflow | Preferred workflow and actions reduced | Responsibilities removed / added | Compatibility and remaining risk |
|---|---|---|---|---|
| Preparation | Invoke release preparation/import, retained validation, plan creation and review navigation separately | Saved SQL revision or full committed Git SHA + target → Prepare for Review → consolidated review. Four manual stage/navigation actions become one; saving, independent approval and deployment requests remain explicit. | Reuses existing operations; one feature coordinator, scoped outcome checkpoints and visible recovery are added. Duplicated request-body construction was removed. | No API/schema change. Advanced steps remain. Checkpoints are session-local; full live target loop remains unqualified. |
| Target setup | Move between configuration, instance administration and target verification; choose project again | Project Target setup contains environment, registration/credential, discovery, binding and verification controls. Project reselection and cross-screen setup navigation are removed; privileged operations are retained. | Same instance view serves project and workspace. Duplicate route-state ownership and post-assignment N+1 detail reads were removed. | Existing entities/paths remain. Labels do not attest physical identity; credential replacement still invalidates revisions. Accepted discovery/verification needs Oracle qualification. |
| Review/status | Open source, validation and readiness separately; interpret internal execution states | Open/refresh review loads them together; inbox opens it directly. Up to three inspection actions become one. Status labels retain detailed evidence and HOLD. | Reuses existing review/readiness actions and source detail; redundant source caches/client integrity logic were removed. Small shared status mapping added. | Backend decision/authorization unchanged. Historical unvalidated plans are identified explicitly. Synthetic status checks prove presentation only. |
| Operations | Several supported deployment/distribution integrations without one ownership map | One documented workflow per deployment mode and explicit consumer/dependency/migration/rollback matrix | Documentation added; no optional production capability removed or disabled. | External consumers remain incompletely inventoried. Removal requires evidence and explicit scope approval. |

Net production Rust delta against the baseline is **+470 physical lines**;
inline-test delta is **+15 lines**. Counts include blank/comment lines, include
the two new modules and exclude documentation. Shared files span multiple rows,
so per-row LOC would double-count responsibilities. Phase 5.1 removed 148
production lines from the initial Phase 5 implementation; Phase 6 adds two
conditional-compilation lines. The target is coherent ownership, not a LOC quota.

## Environment actually available

- Linux x86_64 host; pinned Rust 1.99.1 and WASM tools; cached real Chrome;
  PostgreSQL 16.15 server, `pg_dump` and `pg_restore`.
- New private socket-only PostgreSQL fixtures were created for source tests and
  HTTPS browser verification. Separate developer and approver credentials/grants
  were used. The target fixture is synthetic and grants no Oracle authority.
- Native backup tests create a separate database and witnessed archive, validate
  tools/catalog/witness, and restore into a newly created quarantined destination.
  Root-only recovery is exercised through the existing private fixture helper.
- Docker CLI exists but `/var/run/docker.sock` does not: no reachable daemon.
  No native arm64 builder or nominated two-platform image was available.
- No Oracle client libraries were reported by `ldconfig`; `/opt/oracle` and
  `/usr/lib/oracle` are absent. No current disposable-lab attestation, supported
  client/wallet, sealed protected installation or Oracle purpose credentials were
  supplied. `../acceptance-artifacts` is absent.
- A Kubernetes context exists, but it supplies no authorization to test a shared
  environment. No cluster or retained customer Oracle resources were modified or
  used as disposable targets. Historical customer results retain their own scope.

## Verification matrix

PASS means only the environment/procedure shown. BLOCKED means a missing required
prerequisite. NOT RUN means no execution was attempted. FAIL is retained even
when another check succeeds.

| Capability | Environment / procedure | Evidence and result | Qualification limitation | Next action |
|---|---|---|---|---|
| Build and formatting | Host; `cargo fmt --all --check`, workspace all-targets/all-features Clippy, native web tests/lint, WASM Clippy and `cargo build-web` | PASS; two web tests; native lint failure corrected with target cfg and rechecked | Host build, not packaged runtime qualification | Require configured exact-source CI |
| API/governance contracts | Disposable PG; `cargo native-test --ci-tests server` | PASS; 26 tests, including product/CAS/idempotency/independent-review/access contracts | Synthetic targets; no Oracle | Retain currentness and authorization gates |
| Worker/runtime contracts | Disposable PG; `cargo native-test --ci-tests worker` | PASS; 42 tests | Offline admission/evidence/locking contracts do not prove actual DDL or lost ACK | Run authorized Oracle lab procedure |
| Metadata/operator contracts | Disposable PG16; `cargo native-test --ci-tests operator` | PASS; 20 tests | Includes real PostgreSQL tools/operator subprocesses, not managed-cluster or Oracle DR | Qualify selected installation/artifact separately |
| Historical catalog/restore | Operator suite: all 16 declared bootstraps; retained identity archive upgrade | PASS; trusted catalog profiles and retained schema restore under HOLD | Profile coverage is not an inventory of every customer archive | Rehearse actual selected historical archives with witnesses |
| Witnessed backup/restore | Existing `witnessed_native_restore_preserves_data_and_quarantines_jobs_and_credentials` | PASS; real archive/witness; invalid tool/witness refusal; source data preserved; destination RESTORE_HOLD; credentials revoked; WAITING_VALIDATION/ADMITTED jobs and CLAIMED attempt held; prior events/receipts retained | Jobs contain constrained synthetic history, no actual Oracle-admitted job; no production/managed DR qualification | Restore an actual admitted-job archive in authorized isolated lab |
| Post-restore execution prevention | Same restore test; activation/seed denied, root credential recovery leaves HOLD | PASS for metadata gates; no worker or Oracle connected | Does not prove full installed-worker restart behavior | Qualify protected runtime against restored metadata without replay |
| Browser SQL/Git preparation | Chrome + HTTPS native API/WASM + private PG; existing CDP smoke procedure | PASS; one primary action; retained artifacts; blocked findings; CAS/stale binding; explicit validation retry; independent approval | Full UI parity and live target verification not established | Test accepted discovery and target setup with lab runtime |
| Uncertain preparation writes | Same browser; drop responses after committed import/validation/plan, and before unconfirmed plan | PASS; retained IDs recovered; no repeated import/plan POST; absent unconfirmed plan stays inspection-only | Deliberate browser-fetch faults; not lost Oracle ACK | Keep this evidence scoped to preparation |
| Source byte retention | Browser fixture plus direct read-only artifact comparison | PASS; all 11 retained file hashes recomputed; two imported Git blobs match exact committed bytes including newline | SQL tests also cover exact saved bytes; not arbitrary encoding/runtime coverage | Preserve parser/source identity on future changes |
| Status and access | Browser; separate accounts, revoke grant; synthetic execution GET responses | PASS; scoped source/progress cleared; HOLD/unknown labels; no self-approval | Synthetic execution rows prove presentation only | Verify actual execution/recovery evidence in Oracle lab |
| Parser source group | `cargo native-test --ci-tests core-parser` | Original result: FAIL after 37 tests with stack overflow/SIGABRT. Phase 6.1: PASS, 47 tests | Prediction-context merge repaired without changing grammar, limits or output; default debug and hosted-profile coverage retained | See Phase 6.1 evidence below; retain configured CI |
| Documented release parser measurements | `cargo parser-performance` | PASS; one measurement test covering eight workloads in optimized release profile. Does not waive the failed debug source group | Offline measurements never imply grammar equivalence or Oracle acceptance | Resolve result before delivery assessment |
| Source/delivery integrity | `cargo check-delivery` | PASS; frozen 169-route/1,228-kernel inventory, architecture tool checksums, 381 application and 301 generator archives/licenses, selected tool contracts | No OCI image built or published | Run exact-image gates on nominated signed source |
| Oracle connection/identity/credential lifecycle | Authorized disposable Oracle + supported client/wallet + sealed worker installation | BLOCKED; prerequisites above unavailable; NOT RUN | No accepted discovery, physical identity, replacement or revocation qualification for this checkout | Supply current secret-free lab authorization/attestation and protected inputs |
| Oracle approved DDL/NOOP | Same lab; distinct actors, approval, admission, supported DDL, receipt/ledger/postcondition comparison and second NOOP | BLOCKED; NOT RUN | No native end-to-end Oracle evidence or no-replay NOOP qualification | Run against nominated source/image after lab readiness |
| Oracle HOLD/recovery | Same lab; real lost ACK/interruption/restart, partial evidence, complete-held reconciliation and independent recovery approval | BLOCKED; NOT RUN | Synthetic HOLD responses and offline contracts do not qualify recovery or preserve actual original HOLD evidence | Run controlled witnessed faults only in authorized disposable lab |
| Native images/architectures | Native amd64 + arm64 exact-image/governance/pilot checks and OCI assembly | BLOCKED; daemon/builders/image unavailable | Host build and QEMU cannot substitute | Provide builders and nominate exact source/artifact |
| Hosted security/release gates | `check.yml`, `containers.yml`, exact-source Rust/actions CodeQL and no open findings | NOT RUN locally; PR checks must be inspected separately | No release-gate or advisory clearance claimed | Require all configured gates before publication |
| Release qualification | All mandatory runtime, recovery, provenance and security gates | BLOCKED — NOT QUALIFIED | Mandatory Oracle/runtime/image gates unverified; the Phase 6.1 parser correction does not qualify them | Close each scoped blocker; no deployment, merge or release authorized here |

## Reproduction and evidence

Use the existing commands above; the native runner owns disposable PostgreSQL
clusters and enables retained ignored database tests. Plain `cargo test` alone
would skip them. The focused browser procedure is documented in
[CUSTOMER-GUIDE.md](CUSTOMER-GUIDE.md#native-workflow-verification-boundary).
The temporary CDP scripts reuse that procedure; no browser framework was added.
The new browser fixture ended with **11 releases, 12 validations, nine plans and
zero execution jobs**. Transport-fault tests do not simulate successful Oracle
execution. A fixture setup attempt initially omitted the synthetic actor display
name, and an initial browser attempt preceded persistent process startup; both
were setup failures corrected before the successful runs.

Local ignored evidence uses `.cache/phase6-*.log` (server, worker, core-parser,
delivery, browser, browser-rest, uncertain, validation, native web lint before and
after correction, WASM lint/build, web tests, formatting and parser measurements).
Operator-suite output is retained in this task's tool transcript rather than a
second redundant run. Private fixture paths and inputs are never Git artifacts.
The source/artifact manifest and evidence hashes are retained under ignored
`.cache/phase6-*.json`; final source provenance is the PR commit, not the baseline.

Implemented and verified: the bounded browser/metadata workflows and lint fix
listed PASS. Implemented but not runtime-verified: accepted Oracle target setup,
protected execution and recovery presentation against real Oracle results.
Deferred: live Oracle/recovery, actual admitted-job archive/managed restoration,
full browser/federation/parser parity, native two-platform/security release gates.
Rejected: adding another workflow/state/test framework, weakening gates, deleting
optional integrations without a consumer inventory, or treating synthetic evidence
as runtime acceptance. Phase 6 adds no product feature or general cleanup.

The final rebuilt WASM passed an additional read-only Chrome review smoke with
unchanged artifact/job counts. The initial smoke assertion had a CDP expression
quoting error, corrected in the diagnostic script; this was not a product error.

Final WASM SHA-256: `088ca2eff1d021708ae59b4be0c8cf13cf123bd17250f43a4e09d1c9f1191f56`.
The sorted JSON manifest of the 18 Phase 5/5.1 files (excluding this report) is
SHA-256 `33db16d33dfd5176ce68e75bc89d61bebb15a7190a3eb897dc891059e74f2aa6`.
Both manifests identify local evidence; they are not OCI provenance attestations.


## Phase 6.1 — debug parser stack overflow investigation

Dependency-management follow-up: the full vendor tree used for the original
investigation at `c983b90` has been replaced by a small verified patch and
explicit ignored dependency preparation. The source fix and identities below
are unchanged. See the [repository inventory and offline verification](docs/dependencies/repository-hygiene.md)
and [preparation instructions](dependencies/antlr-rust-runtime/README.md).
Original vendor paths below identify that investigation stage. The final source
group has 47 tests; the earlier 46 count used a stale unrelated web test binary
from a shared baseline target directory, which was rebuilt before the final run.

Investigated from master `758bcaf0fc264aec4ff167174ab6d7e6eb9d3697`, the merge
of PR #150. The pre-Phase-5 baseline is
`d32a221f9d8f52c481fdaddd1348899ea8418a16`. Both reproduce the failure;
parser, grammar, runner, Cargo profiles and locked dependencies have identical
bytes across those two commits. The correction is limited to one runtime
function, its local dependency selection/provenance, regression coverage and
this evidence. The vendored snapshot is the complete upstream release, not a
parser rewrite.

### Environment and profiles

- AlmaLinux 10.2, x86_64 GNU/Linux under WSL2; kernel
  `6.18.58.1-microsoft-standard-WSL2`.
- `rustc 1.99.1 (58cf8f9c3 2026-10-13)`, full compiler commit
  `58cf8f9c35b355199727627d07ae34a4e2846d67`, LLVM 23.1.1;
  `cargo 1.99.1 (5f94df478 2026-08-27)`.
- Shell/main-thread stack soft limit: 8,192 KiB; core-dump limit: zero.
  `RUST_MIN_STACK` was unset. GDB observed the Rust test-thread mapping
  `0x7ffff7bb0000..0x7ffff7db0000` (2 MiB), preceded by a 4 KiB guard page.
  The shell limit is not the size of the libtest-created thread.
- Local default dev/test profile: opt-level 0, debug info 2, debug assertions
  and overflow checks enabled, incremental compilation enabled. The existing
  package overrides optimize SHA-256, scrypt and Salsa20; none modifies the
  parser runtime. No profile setting changes in this fix.
- Hosted Offline WP0: the same unoptimized test profile, but
  `CARGO_PROFILE_DEV_DEBUG=0`, `CARGO_PROFILE_TEST_DEBUG=0`,
  `CARGO_INCREMENTAL=0`, `CARGO_BUILD_JOBS=4`. Assertions remain enabled.
- Release: opt-level 3, debug assertions disabled by Cargo's default release
  profile, `lto=false`, `codegen-units=16`, `strip=debuginfo`. The correction
  does not disable assertions in debug builds.

### Exact reproduction and isolation

Run in a shell without Cargo profile or stack overrides. The worktree command
preserves the corrected checkout and does not change master:

```sh
export PATH="$HOME/.cargo/bin:$PATH"
git worktree add --detach /tmp/kelryvo-parser-before 758bcaf0fc264aec4ff167174ab6d7e6eb9d3697
cd /tmp/kelryvo-parser-before
rustc -Vv
cargo -V
uname -a
ulimit -s
cargo test --locked -p kelryvo-parser --test performance bounded_offline_workloads -- --exact --ignored --nocapture
cargo native-test --ci-tests core-parser
cargo test --locked -p kelryvo-parser --test performance bounded_offline_workloads -- --exact --ignored --nocapture --test-threads=1
cargo test --locked -p kelryvo-parser --test performance bounded_offline_workloads -- --exact --ignored --nocapture --test-threads=16
CARGO_PROFILE_TEST_DEBUG=0 cargo test --locked -p kelryvo-parser --test performance bounded_offline_workloads -- --exact --ignored --nocapture
CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_TEST_DEBUG=0 CARGO_INCREMENTAL=0 cargo test --locked -p kelryvo-parser --test performance bounded_offline_workloads -- --exact --ignored --nocapture
cargo parser-performance
```

The isolated test fails on its own, with both one and 16 test threads, and in
repeated debugger/ordinary runs. It does not require preceding tests. The full
baseline source group reproduces the original **37 passed, then SIGABRT**.
The workload inputs are fixed literals/repetitions of constants; no database,
network, random data or environment-selected workload is involved.

The first six workloads finish. The failure occurs on the 619-byte
`excessive-rule-depth` workload: `SELECT `, 300 opening parentheses, `1`,
300 closing parentheses and ` FROM dual;`. The 2 MiB input and 4,096-statement
cases do not trigger it. Both the complete hosted-profile environment and
changing only `CARGO_PROFILE_TEST_DEBUG=0` pass locally. Thus it is inaccurate
to say that every debug build fails; debug information changes the relevant
native frame sizes. Optimized release also passes. The same isolated test and
full source-group failure were reproduced on the pre-Phase-5 baseline worktree.

### Root cause and measurements

GDB stops at the guard page in this call path:

```text
kelryvo_parser::parse
  kelryvo_oracle_grammar::parse -> generated PlSqlParser rules
    ParserAtnSimulator::adaptive_predict_stream_info_sll_probe
      adaptive_predict_stream_inner -> compute_target_state
        ContextArena::merge
          merge_uncached -> merge_two_entries / merge_arrays
            ContextArena::merge ...
```

The captured backtrace has 8,964 frames, including 2,838 `merge` frames,
2,838 `merge_uncached`, 2,554 `merge_two_entries` and 283 `merge_arrays` frames.
The recursive prediction-context DAG walk, rather than AST destruction or a
single large array/clone, exhausts the stack. A single lookahead decision can
visit thousands of prediction-context parents before another generated rule
is entered. The unchanged `set_max_rule_depth(Some(256))` and the runtime's
existing stack checks at generated-rule boundaries cannot bound this inner
walk.

Disassembly of the original binaries shows the immediate stack reservations
below (bytes, excluding return addresses and callees):

| Function | Default debug info 2 | Hosted debug info 0 |
|---|---:|---:|
| `merge` | 104 | 72 |
| `merge_uncached` | 120 | 72 |
| `merge_two_entries` | 120 | 104 |
| `merge_arrays` | 312 | 248 |

These differences accumulate across thousands of calls. Debug info zero leaves
enough room for this workload, but does not eliminate its unnecessary recursive
stack use. The same-host one-variable experiment rules out an OS difference or
incremental-compilation setting as a necessary explanation for the discrepancy.

### Correction and compatibility

`ContextArena::merge` now schedules parent pairs in postorder on a heap
worklist. Existing wildcard/empty rules, merge helpers, cache and interner are
reused. Child pairs complete before their enclosing helper runs; its calls back
into `merge` therefore return immediately through the existing identity/cache
fast paths. Native call depth no longer scales with context ancestry. Children
are scheduled in the original left-to-right order to retain interning order.

The root Cargo patch selects `crates/antlr-rust-runtime`, the exact published
0.34.0 release with only that function changed. The original 434,609-byte
registry archive, its SHA-256 and BSD-3-Clause license are retained. A source
provenance test checks every published file byte-for-byte against that archive,
checks the patched file hash, permits a difference only inside `merge`, rejects
symlinks and checks the exact file inventory. The separately locked host grammar
generator still uses the original registry release. Its pinned output hashes
are unchanged. Distribution source inventories already include the entire
`crates` tree, including the repair, original archive and notices; original
registry archives also remain in the host-generator closure.

A temporary direct probe compiled the original and patched `prediction.rs`
with the same Rust compiler and ordinary assertions. Both produced identical
context IDs and entry sequences for 4,000 deterministic DAG constructions and
merges, including full-context/wildcard merges, reversed arguments and cache
resets. Output SHA-256:
`4b5c995467a95382810858c904090201d7f1c1d76fc9c261afdb896d7f4fb7f0`.
On a deliberately smaller 256 KiB thread, merging 10,000 context parents aborts
with the original function and succeeds with the correction; the resulting
parent chain and leaf alternatives are checked. This demonstrates eliminated
stack growth, independently of the grammar or a larger runner stack.

No test is suppressed, no workload/nesting/statement/byte limit is weakened,
and no debug assertion or parser case is removed. Grammar bytes, parser profile,
statement boundaries, offsets, execution SQL, source/execution hashes,
approval flags and existing frozen expectations remain unchanged. The new
non-ignored native regression rejects the exact 300-parenthesis input and
checks accepted nesting with UTF-8 comments, CRLF and exact retained identities.

### Verification after correction

All commands below passed on the corrected checkout without `RUST_MIN_STACK`:

| Check | Result |
|---|---|
| Previously failing isolated performance test, default debug | PASS, all eight workloads; 56.65 s in the isolated run |
| `cargo native-test --ci-tests core-parser` | PASS, 47 tests, including original corpus, compatibility, snapshot, grammar provenance, ignored performance and new regressions |
| `cargo test --release --locked -p kelryvo-parser -p kelryvo-oracle-grammar` | PASS, 22 tests; the opt-in performance case is exercised separately below |
| `cargo parser-performance` | PASS, all eight unchanged optimized workloads |
| CI regression command with `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=2 CARGO_PROFILE_TEST_DEBUG=2`: `cargo test --locked -p kelryvo-parser --test native` | PASS, five tests |
| `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings` | PASS |
| `cargo clippy -p kelryvo-web --target wasm32-unknown-unknown --locked -- -D warnings` | PASS |
| `cargo fmt --all --check`, `git diff --check`, actionlint for `check.yml` | PASS |
| `cargo check-delivery` | PASS; frozen routes/kernel, build-tool contracts, 380 application registry archives plus the local repaired runtime, and 301 host-generator archives |

The application registry count falls from 381 to 380 because the runtime is
now a local, independently provenance-checked source dependency; it is not
removed from the application or its distributed source. No registry version or
transitive dependency update is introduced.

Initial timing runs overlapped compilation and are not used to claim a speedup
or regression. A sequential, otherwise idle before/after run of the original
and corrected release binaries gave these warm medians (milliseconds):

| Unchanged workload | Before | After |
|---|---:|---:|
| small-ddl | 1.219 | 1.208 |
| ddl-batch-128 | 139.051 | 138.159 |
| maximum-statements | 51.527 | 50.955 |
| maximum-bytes | 5.228 | 4.871 |
| late-syntax-error | 138.744 | 146.166 |
| excessive-statements | 49.596 | 49.261 |
| excessive-rule-depth | 1,252.439 | 1,271.210 |
| maximum-bytes-unterminated-quote | 0.470 | 0.480 |

All workload input hashes and expected outcomes match before/after. These are
bounded offline samples, not a machine-independent latency gate or runtime
qualification. The worklist adds heap scheduling/allocation on uncached merges;
no further parser optimization is included.

### Why the hosted checks passed

The inspected master Offline WP0 run
[43596622705](https://github.com/devsecopslonghn/kelryvo/actions/runs/43596622705),
core/parser job 132452396320, checked out `758bcaf...`, ran the same
`cargo native-test --ci-tests core-parser` command and enabled ignored tests
through the same runner. Its log explicitly runs `tests/performance.rs` and
reports `bounded_offline_workloads ... ok`. It used the unoptimized test profile
with debug information zero. Reproducing that profile locally passes; restoring
default debug information reproduces the overflow. Original hosted shell stack
limits were not logged, so no retrospective numeric stack-limit claim is made.
The new CI step records the toolchain and shell stack limit and requires
`RUST_MIN_STACK` to be unset.

PR #150's passing
[OCI run 43594307738](https://github.com/devsecopslonghn/kelryvo/actions/runs/43594307738)
and [CodeQL run 43594307655](https://github.com/devsecopslonghn/kelryvo/actions/runs/43594307655)
checked out synthetic merge commit
`351828e9ca97da0f1552b8f29a74a92248f01bf1`. Its tree,
`94e1f77f96b3c45a98c0c96efb97e204f822c992`, equals both the PR head
`7222eacf26a0bef2ea0f0698c650301c053dd31d` and merged master `758bcaf...` trees.
Different commit IDs therefore do not explain this result. The OCI log runs
`cargo test --locked -p kelryvo-test-tools --bins` and optimized release image
builds/probes; it does not execute this source performance test. CodeQL uses
`build-mode: none` for static analysis and executes no parser workload. Their
success does not attest default-debug stack safety.

The required source gate retains its complete original command and ignored
coverage. An additional core/parser CI step now runs the native parser tests
with debug info 2, independent of the workflow's debug-info-zero build settings.
The new regression must pass in the profile that previously overflowed.
No gate is waived, no approval is bypassed, and no stack size is increased.

Local diagnostics are retained under ignored `.cache/phase61-*`, including
before/after runs, GDB traces, profile isolation, the direct probe and downloaded
hosted logs. Remaining risks: maintaining the small local runtime patch until a
reviewed upstream release replaces it; extra heap work on cache misses; parser
inputs outside the existing bounded corpus/workloads are not exhaustively
qualified. Oracle execution/recovery, managed deployments, native image release
qualification and publication remain outside this investigation. No deployment
or release is performed.
