# Product roadmap

8 October 2026. **DESIGN_PROPOSAL**. The 220-feature catalog is a searchable scope decomposition, not 220 independently estimated projects. It assigns **95 atomic acceptance obligations to MVP, 77 to V1, 41 to V2 and 7 to REJECTED**. MVP obligations are grouped into ten delivery packages below. Several “features” are essential safety invariants, fields or negative cases in the same workflow; they do not require separate screens or services.

The MVP is one coherent workflow: register/attest Oracle services, discover/assign schemas, ingest an immutable GitLab commit/folder, reconcile target history, approve exact pending plans, execute under a DDL-safe mutex, verify objects/postconditions, preserve evidence and resolve partial/unknown work. It includes basic fixed roles, independent approval, reliable durable jobs, secrets/TLS, audit and backup/restore hold. Deferring these to enterprise V1 would make the MVP unsafe.

V1 adds deeper metadata browsing, transfer/administration, policy templates, custom RBAC, OIDC/LDAP/MFA, schedules/notifications, Jenkins/GitLab MR/status automation, dashboards/metrics, drift checks and proven replica failover. V2 adds engines/desired-state/schema comparison, the SQL editor and sensitive data governance, richer dependency/impact analysis and optional AI/MCP/IaC integrations. Full multi-target parallel rollouts are V1; MVP can apply a release to individually planned schemas and promote serially through DEV/SIT/UAT/PROD.

## Delivery packages and effort

Estimates are **engineer-weeks**, including design implementation, targeted automated tests and reviews; they are expert estimates, not measured velocity. They assume experienced Oracle/platform developers, existing Kubernetes/GitLab availability, timely DBA participation, usable TCPS and authorized disposable 19c/21c labs. The prior POC software is a regression reference and is not modified as a shortcut.

| Package | Outcome and main IDs | Dependencies | Effort | Exit evidence |
|---|---|---|---|---|
| WP0 | FOSS parser/driver/lock feasibility: SQL-017, DBM-019, MIG-019 | Authorized disposable lab and pin/license review | 6–10 | Correct SQL/PLSQL splitting, Thin TCPS/owner visibility, DDL-persistent locking, failure-window probes |
| WP1 | Project/identity/audit foundation: PRJ-001/003/004/011, SEC-001/005/006/011/019 | WP0 decision accepted | 8–12 | Server authorization/SoD negative cases and durable auditable state transitions |
| WP2 | Shared Oracle inventory and schema assignment: DBM-001/003/004/007/009/019/020/023 | WP1 and DBA topology/bootstrap rules | 10–16 | One shared service, two projects, identity/visibility isolation and assignment revisions |
| WP3 | Git folder and immutable release artifacts: PRJ-008, MIG-004–009, GIT-001/003/006/007 | WP1 | 8–12 | Exact commit/bytes retained; traversal, duplicate version and malformed script rejection |
| WP4 | Target history, checksum planning and baseline: MIG-010–015/025/028/029 | WP2/3 and WP0 | 10–15 | Per-schema divergent history/pending lists; changed checksums block; zero-pending plan |
| WP5 | Independent immutable intent approval/admission: GOV-001/002/006/007/009–013/018/023 | WP1/4 | 10–15 | Author/editor denial, edits/expiry/revocation/history change block dispatch |
| WP6 | Durable execution, hybrid receipts and target mutex: MIG-001/002/018–020/026, OPS-001–006 | WP0/4/5 | 18–28 | Duplicate requests/workers/aliases cannot overlap; target-commit/central-update crash handling |
| WP7 | Object/postcondition verification and recovery: SQL-016–020, MIG-017/021/023/031/034, OPS-025 | WP6 | 14–24 | INVALID package body blocks promotion; partial DDL/unknown session resolution with independent recovery decision |
| WP8 | Focused independent UI: release/plan/approval/progress/history/recovery screens | WP2–7 API contracts | 10–16 | Usable English flow exposes per-target pending SQL and four outcome states |
| WP9 | Offline packaging, backup/restore and estate acceptance: SEC-009/010/013/017/018, OPS-011/012/018/019/022/023/026 | WP1–8 | 16–22 | Restricted OpenShift deployment, evidence retention, restore hold, 50-service/500-schema lab behavior |

Total MVP: **110–170 engineer-weeks**. With 4–5 engineers and 25% reserved for support/coordination, approximately **30–57 calendar weeks (7–13 months)**. DBA/security operations participation and acceptance infrastructure are additional staffing dependencies, not hidden product limits. A mature full engine with a separately accepted Oracle-client exception might reduce custom runtime work; it does not remove governance/recovery/verification obligations. Measure that trade-off in WP0 before revising estimates.

V1 planning envelope: 70–110 engineer-weeks, prioritized by actual pilot needs; identity/governance before dashboards. V2 envelope: 100–180 engineer-weeks if all optional scope is chosen; adding an engine or sensitive query governance is an independently testable release, not a checkbox in a driver factory. Catalog complexity bands are relative and nonadditive.

## First implementation milestone

Recommend **WP0: Oracle execution feasibility harness**, a bounded 6–10 engineer-week milestone, roughly 3–5 weeks with two engineers plus DBA help. When implementation is separately requested, use a fresh task context carrying the runtime/resource contracts, source/license pins and test criteria. Begin with a disposable lab, never current POC deployments or production endpoints.

Its deliverables are a reproducible driver/parser/ledger-lock experiment, pin-level license/notice assessment, and observed results for 19c/21c. Required cases: package spec/body/procedure/function/trigger/view/anonymous block/q-quotes/slashes; unsupported SQL*Plus rejection; owner/observer visibility; raw checksum change; rerun with zero effects; concurrent aliases; partial DDL; crash after effects before receipt and after receipt before central result; orphan session and lease expiry; restore divergence. Accept a written result, including failures, before selecting final implementation dependencies.

STOP criteria: no permissive mature splitter boundary, Thin cannot meet approved transport/authentication requirements, no mutex that survives DDL, or recovery logic permits unproven replay. Resolve those architecture decisions instead of beginning a broad UI. The milestone recommendation does not authorize implementation or database connections during this research turn.

## Release gates

MVP pilot requires all MVP acceptance records below and historical Oracle workloads plus new integrity/crash cases to pass on the selected build. Approval, checksum, validity and promotion failures are release blockers. Not-tested failure windows remain blockers; a visible ticket, green pipeline or one successful migration is insufficient. Single-worker operation does not waive target locking/reconciliation.

Initial measurable capacity budget, **proposed and unmeasured**: at 50 services/500 schema records/20 authenticated users, paginated inventory reads p95 under 2 seconds on a documented representative lab; shallow discovery completes within a configured budget without exhausting target sessions; keep at most four active migration targets globally and one per service initially, with exact per-schema serialization. Benchmark hardware/network/DDL durations and revise resource settings from evidence. These are configurable budgets, not user/license caps. Recovery correctness is independent of throughput.

V1 exits include current policy/identity revocation, scheduler rechecks, replica/orphan session tests and retention/export continuity. V2 exits require per-engine capability/conformance suites and no weakened core admission or recovery semantics. Each release produces an offline package, source provenance, SBOM, notices, backup/upgrade instructions and observed acceptance report.

## Complete feature allocation and MVP acceptance

The generated sections below enumerate every catalog ID exactly once. The complete security/Oracle/dependency context remains in [feature catalog](FEATURE-CATALOG.md). Each MVP row provides its testable outcome; cross-cutting authorization and evidence requirements also apply.

<!-- generated allocation -->

## MVP — 95 catalog obligations

| ID | Capability | Required acceptance outcome |
|---|---|---|
| [DBM-001](FEATURE-CATALOG.md#dbm-001) | Oracle service registration | Register two services without embedding passwords in API output. |
| [DBM-003](FEATURE-CATALOG.md#dbm-003) | Connection profiles and scoped credentials | A discovery identity cannot be selected as a writer without an explicit reviewed binding. |
| [DBM-004](FEATURE-CATALOG.md#dbm-004) | Inventory discovery and reconciliation | Repeating discovery creates no duplicate schemas and preserves manual assignment. |
| [DBM-007](FEATURE-CATALOG.md#dbm-007) | Schema ownership and assignment | Two schemas through one service can belong to different projects without duplicate endpoint metadata. |
| [DBM-009](FEATURE-CATALOG.md#dbm-009) | Environment mapping | A PROD container cannot be made DEV by editing a schema label. |
| [DBM-014](FEATURE-CATALOG.md#dbm-014) | Connection testing | A successful ping with wrong PDB identity fails onboarding. |
| [DBM-016](FEATURE-CATALOG.md#dbm-016) | TLS and connection trust | An untrusted certificate blocks execution and produces a redacted diagnostic. |
| [DBM-019](FEATURE-CATALOG.md#dbm-019) | Oracle CDB/PDB/service distinction | Two aliases to one PDB/owner resolve to the same target mutex. |
| [DBM-020](FEATURE-CATALOG.md#dbm-020) | Discovery visibility profile | Zero ALL_ERRORS rows without required visibility cannot satisfy validity checks. |
| [DBM-021](FEATURE-CATALOG.md#dbm-021) | Oracle maintained account filtering | New application owner is discoverable; SYS/SYSTEM are not deployable targets. |
| [DBM-022](FEATURE-CATALOG.md#dbm-022) | Physical connection deduplication | Registering 500 schemas on 50 services does not create 500 physical inventory endpoints. |
| [DBM-023](FEATURE-CATALOG.md#dbm-023) | Topology generations and clone detection | A changed container generation invalidates an otherwise approved plan. |
| [PRJ-001](FEATURE-CATALOG.md#prj-001) | Project creation and archival | Archived projects cannot admit new jobs and keep historical evidence readable. |
| [PRJ-002](FEATURE-CATALOG.md#prj-002) | Project schema estate | One service shows two isolated project estates according to assignments. |
| [PRJ-003](FEATURE-CATALOG.md#prj-003) | Project membership | Removing a member immediately denies new actions on project resources. |
| [PRJ-004](FEATURE-CATALOG.md#prj-004) | Fixed project roles | Developer cannot approve own intent or execute a PROD job without deployer permission. |
| [PRJ-008](FEATURE-CATALOG.md#prj-008) | Project repository binding | An unrelated repository/folder cannot ingest into the project. |
| [PRJ-011](FEATURE-CATALOG.md#prj-011) | Project resource isolation | Guessing another project's resource UUID returns no SQL or metadata. |
| [MIG-001](FEATURE-CATALOG.md#mig-001) | Versioned schema migrations | V001 creates a table and one matching target history entry. |
| [MIG-002](FEATURE-CATALOG.md#mig-002) | Versioned data migrations | A successful data version is skipped on replay and has observer evidence. |
| [MIG-004](FEATURE-CATALOG.md#mig-004) | Migration file naming | V001 and V1 together fail before planning due to duplicate canonical version. |
| [MIG-005](FEATURE-CATALOG.md#mig-005) | Migration numeric ordering | V2 executes before V10 regardless of directory listing order. |
| [MIG-006](FEATURE-CATALOG.md#mig-006) | Immutable Git commit ingestion | Moving a branch after ingestion cannot change the release artifact. |
| [MIG-007](FEATURE-CATALOG.md#mig-007) | Folder migration discovery | One folder submission yields all five sample versions with path/hash metadata. |
| [MIG-008](FEATURE-CATALOG.md#mig-008) | Release creation and identity | Two different folder/settings manifests at one commit produce distinguishable release identities. |
| [MIG-009](FEATURE-CATALOG.md#mig-009) | Release structural validation | A symlink or unsupported SQL*Plus command yields a file/line error and no target effects. |
| [MIG-010](FEATURE-CATALOG.md#mig-010) | Per-target migration planning | Schema A with two versions plans three files while schema B with one plans four. |
| [MIG-011](FEATURE-CATALOG.md#mig-011) | Pending and applied reconciliation | A central UNKNOWN attempt blocks even when local history shows the version pending. |
| [MIG-012](FEATURE-CATALOG.md#mig-012) | Migration execution history | Query history cannot appear as proof that a migration version was applied. |
| [MIG-013](FEATURE-CATALOG.md#mig-013) | Raw-file checksum enforcement | One changed byte in an applied file blocks both planning and dispatch. |
| [MIG-015](FEATURE-CATALOG.md#mig-015) | Approved schema baseline | Baseline has separate state, snapshot, versions/hashes and independent approval. |
| [MIG-017](FEATURE-CATALOG.md#mig-017) | Failed migration recovery | A CREATE followed by failing ALTER cannot be blindly replayed. |
| [MIG-018](FEATURE-CATALOG.md#mig-018) | Idempotent deployment API | Same key/body returns same job; same key/different targets returns conflict. |
| [MIG-019](FEATURE-CATALOG.md#mig-019) | Target mutex across all aliases | Two workers through different aliases never execute statements concurrently. |
| [MIG-020](FEATURE-CATALOG.md#mig-020) | Safe migration retry admission | Network loss cannot cause automatic retry of a PL/SQL or DDL file. |
| [MIG-021](FEATURE-CATALOG.md#mig-021) | Release promotion ladder | PROD API dispatch is denied while UAT is pending, failed, invalid or unknown. |
| [MIG-023](FEATURE-CATALOG.md#mig-023) | Reviewed corrective migrations | A correction cannot bypass an unresolved lower-version HOLD. |
| [MIG-025](FEATURE-CATALOG.md#mig-025) | Target-local ledger | Target history survives central outage and distinguishes baseline from executed application. |
| [MIG-026](FEATURE-CATALOG.md#mig-026) | Hybrid history and reconciliation | Local success with missing central completion restores evidence without replaying SQL. |
| [MIG-027](FEATURE-CATALOG.md#mig-027) | Statement-level diagnostics | A failing statement is locatable in the retained original file. |
| [MIG-028](FEATURE-CATALOG.md#mig-028) | Exact plan history precondition | A concurrent completed deployment requires a new plan/approval even if pending files shrink. |
| [MIG-029](FEATURE-CATALOG.md#mig-029) | Per-target zero-pending success | Replanning an applied five-file release yields zero effects and a no-op receipt. |
| [MIG-031](FEATURE-CATALOG.md#mig-031) | Preconditions and postconditions | A failed mandatory postcondition prevents VERIFIED_SUCCESS and promotion. |
| [MIG-034](FEATURE-CATALOG.md#mig-034) | Restore divergence detection | A rewound Oracle ledger cannot silently make old data migrations pending. |
| [GOV-001](FEATURE-CATALOG.md#gov-001) | Change request and issue creation | Request links requester, release, target set and intent digest. |
| [GOV-002](FEATURE-CATALOG.md#gov-002) | Independent plan approval | Author and last editor approvals are denied through UI and direct API. |
| [GOV-006](FEATURE-CATALOG.md#gov-006) | Segregation of duties | Requester cannot bypass deployer permission using CI, scheduler or SQL console. |
| [GOV-007](FEATURE-CATALOG.md#gov-007) | Self-approval and last-editor restrictions | Changing only the target still makes that editor ineligible to approve. |
| [GOV-009](FEATURE-CATALOG.md#gov-009) | Approval expiration | Expired approval fails admission even if the UI remains open. |
| [GOV-010](FEATURE-CATALOG.md#gov-010) | Rejection and resubmission | Resubmitting edited SQL cannot reuse an old approval. |
| [GOV-011](FEATURE-CATALOG.md#gov-011) | Approval revocation | A revoked queued deployment cannot start; committed effects remain recorded. |
| [GOV-012](FEATURE-CATALOG.md#gov-012) | SQL or target edits invalidate approval | A changed schema or statement hash rejects old approval at dispatch. |
| [GOV-013](FEATURE-CATALOG.md#gov-013) | Immutable approved artifacts | Replacing a file in storage fails hash verification before any SQL. |
| [GOV-018](FEATURE-CATALOG.md#gov-018) | Execution authorization | An approver without deployer permission cannot dispatch SQL. |
| [GOV-022](FEATURE-CATALOG.md#gov-022) | Manual continuation between stages | Manual continue API cannot skip a failed predecessor. |
| [GOV-023](FEATURE-CATALOG.md#gov-023) | Approval decision audit | Auditor can reconstruct all approval revisions after project transfer. |
| [SQL-015](FEATURE-CATALOG.md#sql-015) | Exact execution preview | Preview digest matches the worker's parsed statement digest. |
| [SQL-016](FEATURE-CATALOG.md#sql-016) | Oracle PL/SQL scripts | All required PL/SQL fixtures preserve body boundaries and result semantics on 19c/21c. |
| [SQL-017](FEATURE-CATALOG.md#sql-017) | Oracle script splitting | No slash delimiter is sent as SQL and q-quoted semicolons do not split statements. |
| [SQL-018](FEATURE-CATALOG.md#sql-018) | Package specification and body validation | VALID specification with INVALID body prevents VERIFIED_SUCCESS. |
| [SQL-019](FEATURE-CATALOG.md#sql-019) | Required object validity gate | Missing object or inaccessible compiler diagnostics blocks final success. |
| [SQL-020](FEATURE-CATALOG.md#sql-020) | Compiler diagnostics explorer | A PL/SQL compiler ERROR is shown even if driver execution returned success. |
| [SEC-001](FEATURE-CATALOG.md#sec-001) | Local authentication | Unauthenticated endpoints disclose no SQL or catalog resources. |
| [SEC-005](FEATURE-CATALOG.md#sec-005) | Role-based authorization | Direct API calls have the same authorization result as UI actions. |
| [SEC-006](FEATURE-CATALOG.md#sec-006) | Resource-level permissions | Guessable IDs never bypass object authorization. |
| [SEC-008](FEATURE-CATALOG.md#sec-008) | Approval policy enforcement | Missing, invalid or expired approval denies worker dispatch. |
| [SEC-009](FEATURE-CATALOG.md#sec-009) | Scoped secrets provider | API cannot read PROD writer secrets while a scoped worker can fetch its admitted target secret. |
| [SEC-010](FEATURE-CATALOG.md#sec-010) | Credential encryption and redaction | Known-secret scan finds no credentials in exported research/deployment evidence. |
| [SEC-011](FEATURE-CATALOG.md#sec-011) | Complete change audit trail | Audit reconstructs WHO/WHAT/WHERE/WHEN/HOW/RESULT for a completed and failed attempt. |
| [SEC-013](FEATURE-CATALOG.md#sec-013) | Deployment evidence bundles | An exported bundle can match each executed file to its approved bytes and target. |
| [SEC-014](FEATURE-CATALOG.md#sec-014) | Policy enforcement on alternate entry points | A developer denied dispatch cannot execute equivalent SQL through the editor. |
| [SEC-017](FEATURE-CATALOG.md#sec-017) | Network restrictions | Requester-supplied URLs or DNS redirects cannot reach metadata or secret endpoints. |
| [SEC-018](FEATURE-CATALOG.md#sec-018) | Web and API TLS | Session cookies/tokens never transit plaintext outside the trusted pod boundary. |
| [SEC-019](FEATURE-CATALOG.md#sec-019) | Session lifecycle and logout | Logged-out or revoked sessions cannot approve queued work. |
| [GIT-001](FEATURE-CATALOG.md#git-001) | GitLab repository integration | A GitLab token needs read-only repository scope and cannot approve deployments. |
| [GIT-003](FEATURE-CATALOG.md#git-003) | Repository connection and test | A repository test verifies the allowed project/folder and redacts authentication failures. |
| [GIT-006](FEATURE-CATALOG.md#git-006) | Commit and source provenance | A release at a short ambiguous SHA is rejected until resolved fully. |
| [GIT-007](FEATURE-CATALOG.md#git-007) | Immutable release artifact retention | Approved deployment still validates stored bytes when Git is temporarily offline. |
| [GIT-016](FEATURE-CATALOG.md#git-016) | Protected source configuration | Changing repository/folder/runner image invalidates relevant approved intent. |
| [GIT-018](FEATURE-CATALOG.md#git-018) | Offline Git mirrors and artifacts | End-to-end lab workflow functions with external internet egress disabled. |
| [OPS-001](FEATURE-CATALOG.md#ops-001) | Durable background job scheduling | API restart retains queued jobs without creating duplicate SQL attempts. |
| [OPS-002](FEATURE-CATALOG.md#ops-002) | Restricted execution workers | Worker accepts only admitted jobs and cannot execute arbitrary submitted DSNs. |
| [OPS-003](FEATURE-CATALOG.md#ops-003) | Execution queues and concurrency budgets | 500 schemas do not open 500 idle writer connections at startup. |
| [OPS-005](FEATURE-CATALOG.md#ops-005) | Execution state model | Driver success with failed validity is never displayed as deployed success. |
| [OPS-006](FEATURE-CATALOG.md#ops-006) | Structured execution logs | Auditor finds the failing statement without exposing secrets or query result rows. |
| [OPS-011](FEATURE-CATALOG.md#ops-011) | Health and readiness checks | Oracle outage cannot trigger a liveness restart loop of the control plane. |
| [OPS-012](FEATURE-CATALOG.md#ops-012) | Metadata and artifact backup/restore | Restore never dispatches queued jobs until target history agreement is re-established. |
| [OPS-018](FEATURE-CATALOG.md#ops-018) | Audit and log retention | Deleting a worker pod preserves SQL hashes, decisions and compiler evidence. |
| [OPS-019](FEATURE-CATALOG.md#ops-019) | Graceful shutdown and drain | SIGTERM during DDL cannot produce a fabricated rolled-back success/failure. |
| [OPS-022](FEATURE-CATALOG.md#ops-022) | On-prem Kubernetes/OpenShift packaging | A disposable OpenShift lab deploys without privileged SCC or external egress. |
| [OPS-023](FEATURE-CATALOG.md#ops-023) | Air-gapped updates and SBOM | An offline install can verify every required artifact hash and license record. |
| [OPS-025](FEATURE-CATALOG.md#ops-025) | Operational recovery case management | Unknown outcomes remain assigned/open until an auditable terminal resolution. |
| [OPS-026](FEATURE-CATALOG.md#ops-026) | Capacity acceptance workload | Under that lab scale, one-schema serialization holds and inventory p95 meets agreed budget. |
| [EXT-008](FEATURE-CATALOG.md#ext-008) | Justification and risk acknowledgement | A destructive plan lacks admission until explicit reviewer acknowledgement is recorded. |
| [EXT-010](FEATURE-CATALOG.md#ext-010) | Independent Oracle outcome panel | A DONE/INVALID case displays verification failure and blocks promotion. |

## V1 — 77 catalog obligations

| ID | Capability | MoSCoW / complexity |
|---|---|---|
| [DBM-005](FEATURE-CATALOG.md#dbm-005) | Schema and object metadata synchronization | Should / M |
| [DBM-006](FEATURE-CATALOG.md#dbm-006) | Database metadata explorer | Should / M |
| [DBM-008](FEATURE-CATALOG.md#dbm-008) | Resource labels | Should / S |
| [DBM-010](FEATURE-CATALOG.md#dbm-010) | Project database assignment and transfer | Should / M |
| [DBM-012](FEATURE-CATALOG.md#dbm-012) | Database groups | Should / M |
| [DBM-015](FEATURE-CATALOG.md#dbm-015) | Credential rotation | Should / M |
| [DBM-017](FEATURE-CATALOG.md#dbm-017) | Database lifecycle inventory | Should / M |
| [DBM-018](FEATURE-CATALOG.md#dbm-018) | Instance health and sync freshness | Should / M |
| [DBM-025](FEATURE-CATALOG.md#dbm-025) | Resource maintenance mode | Should / M |
| [PRJ-005](FEATURE-CATALOG.md#prj-005) | Project policies | Should / M |
| [PRJ-006](FEATURE-CATALOG.md#prj-006) | Project settings | Should / M |
| [PRJ-007](FEATURE-CATALOG.md#prj-007) | Project approval configuration | Should / M |
| [PRJ-009](FEATURE-CATALOG.md#prj-009) | Project deployment configuration | Should / M |
| [PRJ-010](FEATURE-CATALOG.md#prj-010) | Cross-project database visibility | Should / M |
| [PRJ-012](FEATURE-CATALOG.md#prj-012) | Project ownership transfer | Should / S |
| [PRJ-013](FEATURE-CATALOG.md#prj-013) | Schema assignment inbox | Should / M |
| [PRJ-014](FEATURE-CATALOG.md#prj-014) | Project dashboard | Should / M |
| [MIG-014](FEATURE-CATALOG.md#mig-014) | Schema drift detection | Should / M |
| [MIG-022](FEATURE-CATALOG.md#mig-022) | Multi-database rollout | Should / M |
| [MIG-030](FEATURE-CATALOG.md#mig-030) | Out-of-order migration policy | Should / M |
| [MIG-032](FEATURE-CATALOG.md#mig-032) | Migration stream namespaces | Should / M |
| [GOV-003](FEATURE-CATALOG.md#gov-003) | Multi-stage approval | Should / M |
| [GOV-004](FEATURE-CATALOG.md#gov-004) | Dynamic approvers | Should / M |
| [GOV-005](FEATURE-CATALOG.md#gov-005) | Environment-specific approval | Should / M |
| [GOV-008](FEATURE-CATALOG.md#gov-008) | Approval templates | Should / M |
| [GOV-014](FEATURE-CATALOG.md#gov-014) | Deployment windows | Should / M |
| [GOV-015](FEATURE-CATALOG.md#gov-015) | Scheduled execution | Should / M |
| [GOV-016](FEATURE-CATALOG.md#gov-016) | Emergency change workflow | Should / M |
| [GOV-017](FEATURE-CATALOG.md#gov-017) | Hotfix release workflow | Should / M |
| [GOV-019](FEATURE-CATALOG.md#gov-019) | Risk-based approval routing | Should / M |
| [GOV-020](FEATURE-CATALOG.md#gov-020) | Review comments and evidence attachments | Should / S |
| [GOV-021](FEATURE-CATALOG.md#gov-021) | Approval inbox and delegation | Should / M |
| [GOV-024](FEATURE-CATALOG.md#gov-024) | Execution cancellation semantics | Should / M |
| [GOV-025](FEATURE-CATALOG.md#gov-025) | Policy change revalidation | Should / M |
| [SQL-004](FEATURE-CATALOG.md#sql-004) | Schema browsing | Should / M |
| [SQL-008](FEATURE-CATALOG.md#sql-008) | SQL review rule configuration | Should / M |
| [SQL-009](FEATURE-CATALOG.md#sql-009) | Static SQL linting | Should / M |
| [SQL-010](FEATURE-CATALOG.md#sql-010) | Destructive statement review | Should / M |
| [SQL-025](FEATURE-CATALOG.md#sql-025) | Oracle dependency-aware object checks | Should / M |
| [SEC-002](FEATURE-CATALOG.md#sec-002) | LDAP federation | Should / M |
| [SEC-003](FEATURE-CATALOG.md#sec-003) | OIDC single sign-on | Should / M |
| [SEC-007](FEATURE-CATALOG.md#sec-007) | Database/schema access grants | Should / M |
| [SEC-012](FEATURE-CATALOG.md#sec-012) | Activity versus audit separation | Should / M |
| [SEC-015](FEATURE-CATALOG.md#sec-015) | API credentials and key rotation | Should / M |
| [SEC-016](FEATURE-CATALOG.md#sec-016) | Named service accounts | Should / M |
| [SEC-021](FEATURE-CATALOG.md#sec-021) | Custom RBAC roles | Should / M |
| [SEC-022](FEATURE-CATALOG.md#sec-022) | User groups | Should / M |
| [SEC-023](FEATURE-CATALOG.md#sec-023) | Multi-factor authentication | Should / M |
| [SEC-028](FEATURE-CATALOG.md#sec-028) | Audit tamper evidence and external retention | Should / M |
| [GIT-002](FEATURE-CATALOG.md#git-002) | GitHub provider adapter | Should / M |
| [GIT-004](FEATURE-CATALOG.md#git-004) | Branch and tag selection | Should / S |
| [GIT-005](FEATURE-CATALOG.md#git-005) | Merge request SQL checks | Should / M |
| [GIT-008](FEATURE-CATALOG.md#git-008) | CI trigger ingestion | Should / M |
| [GIT-009](FEATURE-CATALOG.md#git-009) | Signed webhook ingestion | Should / M |
| [GIT-010](FEATURE-CATALOG.md#git-010) | API-driven release and deployment | Should / M |
| [GIT-011](FEATURE-CATALOG.md#git-011) | Environment promotion integration | Should / M |
| [GIT-012](FEATURE-CATALOG.md#git-012) | Jenkins integration | Should / M |
| [GIT-013](FEATURE-CATALOG.md#git-013) | Deployment status callbacks | Should / M |
| [GIT-014](FEATURE-CATALOG.md#git-014) | Pipeline execution reports | Should / M |
| [GIT-015](FEATURE-CATALOG.md#git-015) | Git drift detection | Should / M |
| [OPS-004](FEATURE-CATALOG.md#ops-004) | Read-only job retries | Should / M |
| [OPS-007](FEATURE-CATALOG.md#ops-007) | User notifications | Should / S |
| [OPS-008](FEATURE-CATALOG.md#ops-008) | Email notifications | Should / S |
| [OPS-009](FEATURE-CATALOG.md#ops-009) | Outbound project webhooks | Should / M |
| [OPS-010](FEATURE-CATALOG.md#ops-010) | Prometheus metrics | Should / M |
| [OPS-013](FEATURE-CATALOG.md#ops-013) | High availability failover | Should / L |
| [OPS-014](FEATURE-CATALOG.md#ops-014) | Credential-scoped connection pooling | Should / M |
| [OPS-015](FEATURE-CATALOG.md#ops-015) | Operational deployment dashboard | Should / M |
| [OPS-016](FEATURE-CATALOG.md#ops-016) | Resource usage budgets | Should / M |
| [OPS-017](FEATURE-CATALOG.md#ops-017) | Multiple worker replicas | Should / L |
| [OPS-020](FEATURE-CATALOG.md#ops-020) | OpenTelemetry traces | Should / M |
| [OPS-021](FEATURE-CATALOG.md#ops-021) | Cancellation and orphan session tooling | Should / M |
| [OPS-027](FEATURE-CATALOG.md#ops-027) | Upgrade compatibility and ledger versioning | Should / M |
| [EXT-001](FEATURE-CATALOG.md#ext-001) | Oracle definer/invoker rights review | Should / M |
| [EXT-005](FEATURE-CATALOG.md#ext-005) | Sqitch-style verification scripts | Should / M |
| [EXT-006](FEATURE-CATALOG.md#ext-006) | Liquibase-style changeset preconditions | Should / M |
| [EXT-009](FEATURE-CATALOG.md#ext-009) | Multi-language UI design | Should / S |

## V2 — 41 catalog obligations

| ID | Capability | MoSCoW / complexity |
|---|---|---|
| [DBM-002](FEATURE-CATALOG.md#dbm-002) | Multi-engine connection configuration | Could / L |
| [DBM-011](FEATURE-CATALOG.md#dbm-011) | Instance groups | Could / L |
| [DBM-013](FEATURE-CATALOG.md#dbm-013) | Schema groups | Could / L |
| [DBM-024](FEATURE-CATALOG.md#dbm-024) | Schema dictionary and ER diagrams | Could / L |
| [DBM-027](FEATURE-CATALOG.md#dbm-027) | SSH and bastion routes | Could / L |
| [PRJ-015](FEATURE-CATALOG.md#prj-015) | Project export/import configuration | Could / L |
| [MIG-003](FEATURE-CATALOG.md#mig-003) | Declarative migrations | Could / L |
| [MIG-016](FEATURE-CATALOG.md#mig-016) | Repeatable migration files | Could / L |
| [MIG-033](FEATURE-CATALOG.md#mig-033) | Schema comparison and sync | Could / L |
| [SQL-001](FEATURE-CATALOG.md#sql-001) | Web SQL editor | Could / L |
| [SQL-002](FEATURE-CATALOG.md#sql-002) | Syntax highlighting | Could / S |
| [SQL-003](FEATURE-CATALOG.md#sql-003) | Metadata autocomplete | Could / L |
| [SQL-005](FEATURE-CATALOG.md#sql-005) | Interactive SQL execution | Could / L |
| [SQL-006](FEATURE-CATALOG.md#sql-006) | Query history | Could / L |
| [SQL-007](FEATURE-CATALOG.md#sql-007) | Query result export | Could / L |
| [SQL-011](FEATURE-CATALOG.md#sql-011) | Sensitive data controls | Could / L |
| [SQL-012](FEATURE-CATALOG.md#sql-012) | Query and export permissions | Could / L |
| [SQL-013](FEATURE-CATALOG.md#sql-013) | Read-only query sessions | Could / L |
| [SQL-014](FEATURE-CATALOG.md#sql-014) | Explain plan | Could / L |
| [SQL-021](FEATURE-CATALOG.md#sql-021) | SQL*Plus command profile | Could / L |
| [SQL-022](FEATURE-CATALOG.md#sql-022) | Saved and shared SQL scripts | Could / L |
| [SQL-023](FEATURE-CATALOG.md#sql-023) | Visual query builder | Could / L |
| [SQL-024](FEATURE-CATALOG.md#sql-024) | Batch query UX | Could / L |
| [SEC-004](FEATURE-CATALOG.md#sec-004) | OAuth2 social login | Could / L |
| [SEC-020](FEATURE-CATALOG.md#sec-020) | Compliance reports | Could / L |
| [SEC-024](FEATURE-CATALOG.md#sec-024) | SCIM provisioning | Could / L |
| [SEC-025](FEATURE-CATALOG.md#sec-025) | Just-in-time database access | Could / L |
| [SEC-026](FEATURE-CATALOG.md#sec-026) | Data classification and masking | Could / L |
| [SEC-027](FEATURE-CATALOG.md#sec-027) | Workload identity federation | Could / L |
| [GIT-017](FEATURE-CATALOG.md#git-017) | GitOps policy as code | Could / L |
| [GIT-019](FEATURE-CATALOG.md#git-019) | Azure DevOps and Bitbucket adapters | Could / L |
| [OPS-024](FEATURE-CATALOG.md#ops-024) | Database performance observability | Could / L |
| [EXT-002](FEATURE-CATALOG.md#ext-002) | Oracle dependency-aware rollout | Could / L |
| [EXT-003](FEATURE-CATALOG.md#ext-003) | Oracle edition-based redefinition | Could / L |
| [EXT-004](FEATURE-CATALOG.md#ext-004) | Oracle online DDL capability profiles | Could / L |
| [EXT-007](FEATURE-CATALOG.md#ext-007) | Release impact graph | Could / L |
| [EXT-011](FEATURE-CATALOG.md#ext-011) | SQL review assistant using local AI | Could / L |
| [EXT-013](FEATURE-CATALOG.md#ext-013) | MCP read-only discovery | Could / L |
| [EXT-015](FEATURE-CATALOG.md#ext-015) | Terraform/IaC inventory provider | Could / L |
| [EXT-016](FEATURE-CATALOG.md#ext-016) | Data backup and data rollback previews | Could / L |
| [EXT-020](FEATURE-CATALOG.md#ext-020) | Public extensibility API | Could / L |

## REJECTED — 7 catalog obligations

| ID | Capability | MoSCoW / complexity |
|---|---|---|
| [DBM-026](FEATURE-CATALOG.md#dbm-026) | Database provisioning | Wont / NOT_ESTIMATED |
| [MIG-024](FEATURE-CATALOG.md#mig-024) | Automatic Oracle DDL rollback | Wont / NOT_ESTIMATED |
| [EXT-012](FEATURE-CATALOG.md#ext-012) | Automatic AI approval or recovery | Wont / NOT_ESTIMATED |
| [EXT-014](FEATURE-CATALOG.md#ext-014) | MCP autonomous production writes | Wont / NOT_ESTIMATED |
| [EXT-017](FEATURE-CATALOG.md#ext-017) | Arbitrary data import/export tooling | Wont / NOT_ESTIMATED |
| [EXT-018](FEATURE-CATALOG.md#ext-018) | Vendor branding and identical UI assets | Wont / NOT_ESTIMATED |
| [EXT-019](FEATURE-CATALOG.md#ext-019) | Commercial instance/user quotas | Wont / NOT_ESTIMATED |
