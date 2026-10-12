# Kelryvo MVP scope and feature matrix

Locked 2026-10-12 under the owner's product-first completion objective. The practical
governance MVP is implemented, merged through application PR #72, published from exact
master `86eea330657cabc9c175a6a4c70e035978fd57d6`, and deployed through Helm PR #4 /
Argo revision `fbaffdfc70e15ce8596d0a4412b1cef591c1a21d`. Original export/estate work,
Git history and the immutable 220-feature catalog are preserved. This milestone does
not certify all original MVP/V1/V2 requirements or real Oracle behavior.

Source workflows passed complete candidate/master regression and independent review.
The deployed column records actual public API/Chromium observations, not tracker status
or a claim that destructive/adversarial tests ran on the deployment. Argo is Synced /
Healthy; the running app digest is
`sha256:32660abd9e70ad8cfaf7a3f115d8305f01410a9b6106904edb83f60093abec31`.
One app replica is ready and workers remain zero. Helm remote CI is **UNAVAILABLE**
under the existing billing exception; local chart/review/dry-run gates passed.

| Feature/module | Backend status | Frontend status | Deployed availability / observation | Remaining work | External dependencies |
| --- | --- | --- | --- | --- | --- |
| IAM: identities and fixed roles | Implemented; exact live-credential authority | Implemented secure sign-in | Both roles signed in; self-approval denied | Operator lifecycle duties | Trusted OS operator |
| IAM: browser sessions | Implemented HTTPS/CSRF/expiry and own-session revoke | Implemented Account navigation and controls | Secure cookie, empty browser storage and targeted remote-session revoke passed | None in locked scope | HTTPS |
| IAM: project/deployment access | Implemented explicit grants and immutable operator audit | Implemented own-grant overview and operator guidance | Account view, grant/revoke, denied/regranted request path passed | Operator provisions/grants access | Trusted OS operator; no application administrator |
| Instances: environments and reference-only Oracle profiles | Implemented create/list and input validation | Implemented project forms and Instances screen | Browser created environment/profile and inspected configuration | No live connection certification | No Oracle credentials resolved |
| Instances: retirement | Implemented additive lifecycle and admission gates | Implemented reasoned retirement and warnings | API role denial, browser retirement and rejected retired-target planning passed | None in locked scope | None |
| Instances: manual database/service/schema catalog | Implemented declare/assign/release | Implemented grouped project estate | Both roles viewed synthetic assigned DEV/service group; endpoints hidden | Live discovery remains excluded | Trusted operator attestation; declarations provisional |
| Git: allowlisted mirrors and source binding | Implemented | Implemented repository/folder/ref selection | Browser saved demo binding and imported exact committed source | Operators register private mirrors | Local Git mirror; remote OAuth excluded |
| Migrations: releases, parser validation, preview/comparison | Implemented immutable source and integrity checks | Implemented | Public API/browser import returned VALID; full preview/comparison regression passed CI | None in locked scope | Pinned parser |
| Review: exact intent, independence and reviewer inbox | Implemented | Implemented | Browser comment, reviewer assignment, inbox and independent approval passed | None in locked scope | None |
| Review: rejection/resubmission and withdrawal | Implemented; complete API/browser CI verified | Implemented | Browser withdrawal retained REVOKED record/history after restart; rejection/resubmission covered in CI | No code work; those two flows not separately repeated on deployment | None |
| Controlled execution: requests/cancel/status/HOLD/no replay/recovery | Implemented governance and worker safety kernel; UNIT verified | Implemented truthful queued status/history | API/browser WAITING_VALIDATION → CANCELLED passed; no target effects | Real Oracle execution externally blocked | Explicit target authority, trusted worker installation and attestation |
| History/audit and record downloads | Implemented scoped retained evidence/checksums | Implemented navigation and downloads | Approval/audit/history, plan/execution downloads and checksums passed | Checksums confer no signed authenticity | None |
| Operations: readiness, backup/restore and recovery hold | Implemented; native roundtrip/HOLD regression passed | Implemented readiness/HOLD feedback | Probes, private read-only backup and app restart/preservation passed | Deployed restore/DR not exercised | Trusted operator; matching-release restore procedures |
| Real Oracle connectivity/discovery/execution | Partial source; externally blocked | Intentionally unavailable | Disabled / NOT_EXECUTED; zero workers | Explicit authorized Oracle acceptance | Target credentials, isolation, authority and lab |

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

All milestone stages completed: local regression, independent review/fixes, one application
PR, mandatory candidate/master checks, ordinary merge, immutable publication, Helm/Argo
release and deployed API/Chromium acceptance. Existing releases/plans/history/audit,
Secret data, PVC/PV and PostgreSQL pod identities matched the pre-rollout baseline.
Synthetic acceptance records are retained; Oracle remains unverified and disabled.
See [the final release record](../../evidence/product/mvp-completion-20261012/release.json).

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
safety gates; failed attempts remain retained. Candidate/master GitHub checks, immutable
publication and deployed acceptance subsequently passed as recorded above. Oracle
acceptance remains external.
