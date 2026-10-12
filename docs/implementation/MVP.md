# Kelryvo MVP scope and feature matrix

Locked 2026-10-12 under the owner's product-first completion objective. The source workflows are feature-complete; milestone verification is in progress. Work lands on
`development/kelryvo-mvp-completion`, preserving the unfinished execution-record export
and project estate implementation. Commit/push completed features; defer milestone PR,
full CI, publication and deployment until feature completion. The immutable 220-feature
research catalog remains unchanged; this is a practical governance MVP, not acceptance
of all original MVP/V1/V2 requirements.

Status describes audited source functionality, not tracker task completion. Existing
deployment is HTTP 200, Argo Synced/Healthy, one app replica and zero worker replicas
(read-only observation 2026-10-12). Its pinned app digest is
`sha256:8d4de8bd6d6b5a3ba19122fee2d923cfdfd6c6db50470332de290bcc4a8c5d30`.
Authenticated deployed workflows require milestone browser/API acceptance; availability
below is not acceptance. Helm CI billing exception remains **UNAVAILABLE**, never PASS.

| Feature/module | Backend | Frontend | Deployed availability | Remaining MVP work | External dependencies |
| --- | --- | --- | --- | --- | --- |
| IAM: named identities, fixed developer/approver roles | Implemented, hashed credentials | Implemented token sign-in | Existing release; acceptance pending | Preserve operator credential issue/rotate/revoke | Trusted OS operator |
| IAM: secure sessions | Implemented HTTPS/CSRF/expiry/revocation | Implemented login/resume/logout and own-session controls | New controls on integration branch; unavailable deployed | Full milestone/deployed regression | HTTPS |
| IAM: explicit access/deployment grants | Implemented operator-only persistence/audit and own access API | Implemented own-grant/privilege overview and bootstrap guidance | New overview unavailable deployed | Full milestone/deployed regression | Trusted OS operator grants; no new administrator role |
| Instance/connection: environments and reference-only Oracle profiles | Implemented create/list | Implemented project forms and Instances navigation | New Instances screen unavailable deployed | Full milestone/deployed regression | No Oracle access required |
| Instance/connection: profile retirement | Implemented transactional lifecycle/admission gates | Implemented reasoned retirement and target warnings | Unavailable until milestone release | Full milestone/deployed regression | None |
| Instance/connection: provisional database/service/schema catalog | Implemented operator declare/assign/release | Implemented grouped project estate | Unfinished estate source preserved; acceptance pending | Milestone/deployed regression; preserve provisional labels | Operator attestation; live discovery excluded |
| Git: registered local mirrors and protected folder binding | Implemented | Implemented binding/ref selection | Existing release; acceptance pending | Validate cohesive browser workflow | Operator-mounted Git mirror; remote provider OAuth excluded |
| Migrations: immutable releases, parser validation, previews/comparison | Implemented | Implemented | Existing release; acceptance pending | Focused/full milestone regression | Pinned parser artifacts |
| Review: exact intent, independent approval/rejection, reviewer inbox | Implemented | Implemented | Existing release; acceptance pending | Preserve separation and fail-closed integrity | None |
| Review: discussion, rejection/resubmission, withdrawal | Implemented | Implemented | Existing release; acceptance pending | Milestone regression | None |
| Controlled execution: durable requests/cancel/status/recovery/HOLD | Implemented governance and worker safety kernel | Implemented queued status/history | Governance existing; worker disabled | Milestone/deployed regression; preserve truthful waiting states | Actual Oracle acceptance externally blocked |
| History/audit: scoped paging, retained plans/request records | Implemented (unfinished export preserved) | Implemented | Export/estate not fully accepted deployed | Integrated regression and deployed acceptance | None |
| Operations: readiness, metadata backup/restore and recovery hold | Implemented local/operator workflows | Implemented hold/status feedback | Readiness available; restore not exercised | Operational documentation and milestone checks | Operator; no destructive deployed restore |
| Real Oracle connectivity/discovery/execution | Partial worker source; externally blocked | Intentionally unavailable | Disabled, zero workers | Report as NOT_EXECUTED; never accept simulation as Oracle evidence | Explicit target authority, secrets, trusted routes/attestation and lab |

## Exit criteria

An authorized developer can discover project access and instances, configure an
environment and profile, bind a registered mirror, import/validate immutable migrations,
prepare exact intent and submit it for independent review. An eligible approver can
inspect source/target/evidence, discuss, reject/resubmit or approve/withdraw. A separately
granted actor can request/cancel a durable deployment and inspect truthful status and
retained audit/history; Oracle remains disabled. Users can inspect and revoke their own
browser sessions. Retiring a profile preserves historical evidence and prevents new
authority for it. Ungranted, expired, cross-project and stale requests fail safely.

Operator-only identity provisioning, explicit grants, mirror registration, catalog
attestation and recovery remain intentional trust boundaries with documented commands.
No SSO, invitations, arbitrary SQL console, remote Git provider, secret resolver, live
connection test, automatic replay or Oracle target execution is silently added to scope.

After feature completion: full local integration/regression, independent security and
correctness review/fixes, one milestone PR, mandatory GitHub checks without bypass,
eligible merge, immutable images, GitOps release, deployed browser/API acceptance and
final matrix with external limitations. Never label unverified features accepted.

## Local milestone verification checkpoint

Local regression passed 123 API cases across four complementary isolated shards, 38
Chromium cases, one fresh-source installation with 12 embedded workflows, and actual
OCI/PostgreSQL acceptance. Database suites had zero failures, cancellations or skips.
Affected API shards were rerun after the authority fixes; exact per-run source revisions
are recorded in [the concise integration record](../../evidence/product/mvp-completion-20261012/integration.json).
`npm run check` passed 308 cases with 74 intentional offline database skips; build,
tracker/format checks and license closure passed (89 pins, zero unknown required grants).
Independent review of source `0804b85` found no must-fix security/correctness defect;
changed-file and integration-history secret scans found no secrets.

Earlier overlapping local parser workloads exceeded the existing fixed deadline. Serial
repository checks and the affected full API shard passed without changing timeouts or
safety gates; failed attempts remain retained. GitHub checks, immutable publication and
deployed acceptance are still required. Local success never establishes Oracle acceptance.
