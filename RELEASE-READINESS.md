# Release readiness assessment — 2026-11-14

**The current checkout is not release-qualified.** Focused product workflows and
witnessed metadata restoration passed locally. Oracle execution/recovery and
exact-image release gates remain unverified. The configured core/parser source
group failed locally; that failure is not waived by the passing checks.

## Source and review scope

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
| Parser source group | `cargo native-test --ci-tests core-parser` | FAIL; 37 tests passed before `bounded_offline_workloads` aborted with stack overflow/SIGABRT in debug profile | Parser, grammar, runner, dependencies and performance test are unchanged from baseline. Runtime impact and hosted-CI behavior unresolved; not waived | Investigate baseline source-gate failure; preserve required CI |
| Documented release parser measurements | `cargo parser-performance` | PASS; one measurement test covering eight workloads in optimized release profile. Does not waive the failed debug source group | Offline measurements never imply grammar equivalence or Oracle acceptance | Resolve result before delivery assessment |
| Source/delivery integrity | `cargo check-delivery` | PASS; frozen 169-route/1,228-kernel inventory, architecture tool checksums, 381 application and 301 generator archives/licenses, selected tool contracts | No OCI image built or published | Run exact-image gates on nominated signed source |
| Oracle connection/identity/credential lifecycle | Authorized disposable Oracle + supported client/wallet + sealed worker installation | BLOCKED; prerequisites above unavailable; NOT RUN | No accepted discovery, physical identity, replacement or revocation qualification for this checkout | Supply current secret-free lab authorization/attestation and protected inputs |
| Oracle approved DDL/NOOP | Same lab; distinct actors, approval, admission, supported DDL, receipt/ledger/postcondition comparison and second NOOP | BLOCKED; NOT RUN | No native end-to-end Oracle evidence or no-replay NOOP qualification | Run against nominated source/image after lab readiness |
| Oracle HOLD/recovery | Same lab; real lost ACK/interruption/restart, partial evidence, complete-held reconciliation and independent recovery approval | BLOCKED; NOT RUN | Synthetic HOLD responses and offline contracts do not qualify recovery or preserve actual original HOLD evidence | Run controlled witnessed faults only in authorized disposable lab |
| Native images/architectures | Native amd64 + arm64 exact-image/governance/pilot checks and OCI assembly | BLOCKED; daemon/builders/image unavailable | Host build and QEMU cannot substitute | Provide builders and nominate exact source/artifact |
| Hosted security/release gates | `check.yml`, `containers.yml`, exact-source Rust/actions CodeQL and no open findings | NOT RUN locally; PR checks must be inspected separately | No release-gate or advisory clearance claimed | Require all configured gates before publication |
| Release qualification | All mandatory runtime, recovery, provenance and security gates | BLOCKED — NOT QUALIFIED | Mandatory Oracle/runtime/image gates unverified; local core/parser failure remains | Close each scoped blocker; no deployment, merge or release authorized here |

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
