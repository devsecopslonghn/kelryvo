# Continue Kelryvo development

Start with [product requirements, current capabilities and prioritized roadmap](../product/KELYRVO_PRODUCT_REQUIREMENTS.md). That document is the single source of product direction and progress.

**Latest verified delivery, 2026-10-28 16:31 UTC:**
The bounded D6 ADMITTED/idempotency/NOOP case **passed on the real lab** with an
independent outcome review. Job `fa198a6e-4e45-418f-9a4b-11fb74ab6f6a`, plan
`0ce1568b-65eb-42bf-a764-cbb4906044db`: same-key returned the same ADMITTED job
(200); changed reason, a new key while pending, and stale cancellation returned the
three expected 409 errors. All four responses were saved before gate release.
Preflight proved EXACT_APPLIED for two migrations with zero pending statements;
the owned worker finished NOOP, quiescent, with zero application SQL or ledger writes.

Both browser children were revoked. A fresh root completion audit matched all 68
metadata tables and **58 jobs: 23 CANCELLED, 12 HOLD, 6 NOOP, 17 VERIFIED_SUCCESS**,
868 credential projections, no WAITING/ADMITTED, four old snapshots and one baseline.
The ten Oracle ledger rows, two migrations, two application objects, complete
identity/grant/protected-object witness and all 129 old-PDB rows are preserved.
Full snapshot SHA: `f67529200d1f9b78c9956925a5e75dc0b1119ad492fb3e7da4b8f7621e634ac9`.
The app responds HTTPS 200 at https://kelryvo.apps.drgdevlab.com/ on the same image.
Only installation.json changed among thirteen Secret keys, followed by the reviewed
same-image singleton restart; execution and Argo auto-sync remain off. Native
installation `b97e48c7…` expires at `2026-10-28T16:38:24.392Z`; it is not authority
for any future action.

Root operator session 32160 exited 0 and the independent watcher completed.
Keep `delivery6-admitted-live-20261027-2/` result, independent outcome, root audit,
clock/probe/release records and source archives, plus flow2's completed record and
the separate scope4 first-execution repair approval. Never restart either flow or
rerun its execution. The failed wrapper preflight and all historical failures remain
retained. The focused operator suite passed 54/54, lineage fixtures 5/5, reviewer
contracts 4/4; standard checks passed 494/0 with 152 optional skips and 94-package
license closure.

This completes the bounded ADMITTED/NOOP delivery. Full OA01–OA10 / R1–R2 topology,
SQL/fault/recovery matrices and the driver DNS connect-string path remain unqualified;
the earlier seed's native receipt preimages remain unavailable. Those gaps must not
be reported as covered by this case. See the
[continuation evidence](../../evidence/product/oracle-delivery6-currentness-20261026/continuation-20261027.json).

**Historical live operation, 2026-10-28 16:26 UTC (both processes are now terminal):**
The first coordinator (`delivery6-complete-flow-20261028-1`) stopped in its wrapper
preflight before any case4 execution: case4 omitted the wrapper's read-retry fields.
Preserve it and every original case4 scope/lab/review/source byte. A separate
independent repair review (`3b74c218…`) approved first execution of the unchanged
case4 through its unchanged strict runner, with zero retries and no read adapter.
The repair scope/lab/review are in
`delivery6-scope4-first-execution-repair-20261028-1/`; expiry remains the original
`2026-10-28T16:41:38.151Z`. New flow2's first-execution intent binds all three repair
hashes and the original scope hash before creating the original execution marker.

**Inspect, never restart:** root operator session `32160`, OS PID `16332`, runs
`run-delivery6-scope4-repair.mjs run`; sole independent watcher OS PID `12929`
(its agent-local session `22766`) waits through currentness4 → ADMITTED2 → native
review → final outcome. At 16:26, case4's first execution marker exists and its first
two API reads returned; no result/failure was present. Check live `/proc` identity,
these exact handles and `.cache/private-lab/d6-scope4-repair-live-20261028.log` before
acting. An unavailable cross-agent tool handle does not mean a process stopped.
The coordinator retains browser sessions across native handoff and handles cleanup;
never launch a competing operator. Actual ADMITTED/NOOP acceptance remains unproven
until final artifacts and independent outcome pass.

**Latest verified state, 2026-10-28 16:10 UTC:**
Currentness case3 completed one discovery and all five existing-binding verifies;
its independent outcome accepted the exact full PostgreSQL/Kubernetes state.
Current totals are **57 jobs / 860 credential projections / 68 tables**, with
23 CANCELLED, 12 HOLD, 5 NOOP and 17 VERIFIED_SUCCESS, no WAITING/ADMITTED.
The accepted snapshot SHA starts `d1960fe2`; retain the complete hash and proofs in
`delivery6-currentness-after-seed-20261028-3/`. Case2 remains a retained partial
failure after four verifies; neither failed case was replayed.

The case3 observation expired at `2026-10-28T15:55:18.594Z`. ADMITTED case1 was
prepared only and expired at `15:53:39.047Z`; no review, API-ready record or job was
created. Never run that preparation. The active work is a new case4 refresh from
the authenticated case3 after-state, followed by ADMITTED case2. Prepare the fixed
independent review watcher before discovery and use the persistent one-shot
`run-delivery6-complete-flow.mjs` coordinator so review handoffs retain the live
browser session. The coordinator must not be restarted after its exclusive flow
directory exists; poll its actual process handle and retained artifacts instead.
Currentness read retries are limited to two PostgreSQL/Kubernetes reads and are
hash-only diagnosed; API and Oracle operations are never automatically retried.
The focused operator suite passed 54/54; live ADMITTED/NOOP is still unproven.

**Historical verified state, 2026-10-28 13:57 UTC:**
Gov3/stage3/seed2 ran once on the unchanged image. PostgreSQL reached
**57 jobs: 23 CANCELLED, 12 HOLD, 5 NOOP, 17 VERIFIED_SUCCESS**, with 848 credential
rows at seed completion, all 68 tables and no WAITING/ADMITTED. Both new browser children were revoked.
Fresh full PG/Kubernetes state matches retained final snapshot
`fcfd55a020205558a2d88a76550ba4fce8c5b04ef5394fb46dec4277a8f96b13`.

The original operator remains `STOPPED_NO_REPLAY`: its after-run validator assumed
an uppercase actor role; production stores `developer`. Later read-only validation
also identified two incorrect assumptions: native-host receipt digests and Oracle
ledger receipt digests use different domains; request reason belongs to the immutable
queued job, not the materialized worker request. Preserve the failed case and original
archived verifier (`0c88d06b…`); never rerun its DDL or rewrite it as an operator PASS.

A separate independent actual-effect review accepted the seed effects from retained
witnesses and a fresh full snapshot. Exact PostgreSQL job/attempt events and two
acknowledgement receipts match their planned ordinals, statement digests and central
evidence. Oracle POST matches the independently production-derived ten-event ledger,
head and two applied migrations, with exactly two KP_B tables. All 129 protected old
PDB witness rows are unchanged. Native receipt digest preimages cannot be independently
recomputed because their dispatch UUID was not retained; this limitation is explicit.
The separate accepted-effect loader verifies that lineage without fabricating the
missing coordinator PASS or replaying any execution.

Discovery renewal `delivery6-discovery-renewal-20261028-1` independently passed before
Gov3. The current manifest SHA is
`5f2f908e5ad9131fb46b406d4ed5b9fd6df09e7166da4a89ed8a1502d020169d`.
Installed native configuration is stage3 D6 (`eefc71e9…`), expired at
`2026-10-28T13:38:01.515Z`. Execution and Argo auto-sync remain off.

**ADMITTED/idempotency/NOOP remains open; the goal is active.** Currentness-only
case1 stopped without retry after one discovery, three successful verifies (KP_A,
KP_B, KP_COMMIT) and ten calls. Its five-minute review could not cover the runner's
135-second per-call reserve. Both sessions logged out; all jobs, HOLDs and
infrastructure remain exact. Independent partial-effect review preserves this
failure and does not label it a completed five-binding refresh. Current state has
**852 credential rows / 57 jobs**, snapshot SHA
`a943bf2149d74dc80373bfb04fde0584398e73f1226b2722d74baa7db62bfcf6`.

A new separately reviewed case2 must start from that exact independently accepted
partial snapshot, use fresh discovery and complete all five existing-binding verifies,
and carry at least ten minutes of review authority within its twenty-minute scope.
Do not extend case1's review or replay it. Expect four further login projections
(856 total) with no job changes. Only after independent complete-refresh acceptance
may ADMITTED use its new observation and KP_B revision. Its two-applied-file NOOP
must have zero pending statements; qualify the current Pod clock, save all four live
API probes before gate release and verify native/Oracle preservation. ADMITTED
archives exclude hash-pinned account secret bytes, including those read by refresh
lineage validation. No actual ADMITTED case has been created.

Local standard checks pass 494/0 with 152 optional skips and 94-package license
closure. Private operator tests are separate from live acceptance. The generated
ADMITTED wrapper is tested in a local child process; clock artifacts use distinct
exclusive filenames, and both native CAS steps require a reviewed 135-second reserve.

**Previously verified state, 2026-10-27 16:05 UTC:**
[Reviewed continuation and cancellation effect](../../evidence/product/oracle-delivery6-currentness-20261026/continuation-20261027.json)
retains the unchanged application image. The second independently approved D6-only
discovery renewal expires at `2026-10-27T23:26:45.384Z`; inspect actual time before use.
A fresh DISCOVER and five existing-binding verifies passed. The real browser then
created a two-file release, an independently approved plan and one WAITING request.
The native handoff stopped before any Secret mutation or Oracle SQL: its reviewer
wrote to the wrong inbox and the required start reserve elapsed. Do not replay it.

The exact WAITING request was subsequently cancelled once under a separate reviewed
scope. The cancellation and logout succeeded, but the operator ended
`FAIL_RETAINED_NO_REPLAY` because its result verifier used a wrong scope field and
expected an explicit zero-count state. Independent review confirmed the actual
before/after effect and preservation; the original failure is retained, not rewritten.
Current state is **68 tables, 832 credential rows and 54 jobs: 21 CANCELLED, 12 HOLD,
5 NOOP, 16 VERIFIED_SUCCESS, no WAITING/ADMITTED**. All 53 prior jobs and their HOLDs,
plans, reviews, old schema snapshots and infrastructure remain preserved. Current
full snapshot SHA is `7b04276a4822a14b81e98302e667953d4e9dbf595b34a20c7abb3e517fcaadfb`.
Execution and Argo auto-sync remain off; native installation still has expired D5
authority. No D6 native seed or ADMITTED/NOOP is accepted; the goal remains active.

Retain private flow `delivery6-reviewed-flow-20261027-1`, browser
`delivery6-browser-seed-20261027-1`, unexecuted stage
`delivery6-native-stage-20261027-1`, and executed cleanup
`delivery6-waiting-cleanup-20261027-3`. Cleanup cases 1/2 are unexecuted, invalid
preparations; never repair their pins or replay them. Renewal/currentness case 6
from the preceding day was only prepared, never approved or executed.

The next API/native path is being tested against dynamic captured job totals,
explicit owner-authorized read-only preparation, and separate independent stage
and worker reviews. Preparation conveys no Oracle or execution approval. Fresh PG
reads must match the reviewed full snapshot immediately before native action;
historical snapshot timestamps are not live currentness. The independent reviewer
must be ready before starting another 15-minute observation window. Earlier clock
qualification is not reusable: calibrate the current Pod immediately before an
ADMITTED gate, save its receipt/probes before release, and retain count **0** for a
zero-pending NOOP admission even when its approved release has two applied files.
Standard checks passed 494/0 with 152 optional skips; current private operator
checks are recorded separately and are not live Oracle acceptance.

**Historical Oracle attempt, 2026-10-25 12:05 UTC:**
[Retained ADMITTED failures and independently reviewed preservation](../../evidence/product/oracle-admitted-attempt-20261025/acceptance.json)
record two fresh cases on the unchanged `557c7d47…` image. The first stopped before
Secret mutation and ended CANCELLED. The second staged its reviewed installation,
preserved all 68 tables across a same-image restart, passed an EXACT_APPLIED preflight,
and reached one real ADMITTED/CLAIMED zero-pending attempt. The controller did not
release its gate; four live API probes and a successful NOOP are **not accepted**.
The owned worker stopped, and a separately reviewed PostgreSQL-only recovery retained
that exact expired attempt as HOLD. No uncertain execution was retried or HOLD cleared.

There are now **53 jobs: 20 CANCELLED, 12 HOLD, 5 NOOP, 16 VERIFIED_SUCCESS**,
no WAITING/ADMITTED. All 52 prior jobs and 11 prior HOLDs remain unchanged; four KP_B
snapshots and one baseline remain. The retained D5 eight-object/48-event/four-head
state and four historical PDBs match the before-observation exactly. Both cases' browser
children are revoked; normal non-bearer password roots remain. Execution and Argo
auto-sync stay off. Discovery and installation review times have expired; none may
authorize another Oracle action. The latest installed configuration is the expired
case-2 `104a7806…` installation, not the old `c0c16d4a…` bytes.

Private cases are `.cache/oracle-concurrency-20261025/oa09-admitted-live-{1,2}/`.
Retain every failure, review, source archive and recovery witness. Regular mode-600
JSON patch files fix the Node `/dev/stdin` socket issue. Expiry-only factory composition
exposes `runWaitingRequest`; exact lease comparison must bind text before PostgreSQL
timestamptz conversion to preserve microseconds. The controller's original receipt
clock/probe diagnostics were not saved, so its rejection cause remains unproven.
The recorded gate's offline replay is not live acceptance. A further native case needs
a fresh target; do not use the held KP_DELIVERY5 container or alter its history.
The later D6 bootstrap below supersedes local-only preparation; old D5 reviews still
authorize no further Oracle action.
Local standard checks passed 494/0 with 152 optional skips; the first six temporary-Git
fixture failures from a missing personal signing key remain retained. Full OA/R1/R2
matrices and the installed grant-negative gap remain open.

**Fresh D6 bootstrap, 2026-10-26 local / 2026-10-25 22:31 UTC:**
[Independently reviewed bootstrap and preservation](../../evidence/product/oracle-delivery6-bootstrap-20261026/acceptance.json)
passed once on the unchanged image. `KP_DELIVERY6` / `kp_delivery6` is new PDB 13,
DBID `3453530694`, GUID `5EB2C4026807E0F8E0638101F40A9278`. It has five NO AUTHENTICATION
schema owners, three purpose principals, a locked bootstrap admin, exactly 56 segregated
grants and seven valid protected ledger/mutex objects. Application objects and ledger
rows are zero. All 129 old witness rows, every pre-existing PDB catalog identity, all 68
metadata tables, 802 credential projections, 53 jobs and Kubernetes infrastructure match
before/after; independent outcome review also compared the current read-only app state.
The volume has 8,272,957,440 bytes free, above the 6 GiB post-run reserve.

Actual private evidence is `.cache/private-lab/delivery6-run-20261026-3/`; the matching
credential/template set is `.cache/private-lab/delivery6-prepared-20261026-4/`. Keep all
source archives, review and one-shot markers. Never rerun `delivery6-operator.py` against
this now-existing target. Earlier local preparations/run-1/run-2 were unexecuted and
unapproved. Independent review corrected the SYSDBA service-context check and missing
create-PDB CDB guard before execution; each SQL then used exact current hash/expiry
checks, a 135-second authority reserve and bounded remote/local processes.

This proves target provisioning and preservation. The successful purpose-account qualification
below supersedes that bootstrap gap. D6 discovery/connection/schema assignments, V1/V2
governed execution and ADMITTED/NOOP remain open. Execution stays off, and the installed trusted configuration still targets
D5 with expired authority. Fresh D6 discovery credentials must use distinct prefixed keys
while retaining every existing D5 Secret key. The runtime manifest has one global expiry:
install a D6-only canonical manifest and archive the expired D5 manifest byte-identically
instead of accidentally renewing its entry. Discovery supports multiple targets, whereas
the trusted execution installation is single-target. New D6 plans need independent
approval and a fresh reviewed D6 worker/configuration, including the full grant-negative
query. Private ADMITTED helpers also still contain D5 / 11-HOLD / 4-snapshot assumptions;
update and review them against the actual fresh baseline before use. Standard checks
passed 494/0 with 152 optional skips; operator tests verify preservation and no retry after
an unknown create result. None of those offline checks qualifies Oracle migrations.

The first reviewed D6 SELECT qualification (`delivery6-qualification-20261026-6`) failed
at its SQL hash gate on 2026-10-25 22:48 UTC, before the D6 witness/purpose-account phase.
Only the CDB catalog and 129 old witness rows were read. The preparer included explicit
empty-state markers that the runner's duplicate SQL builder omitted. Keep its failure,
source archive and started markers; never rerun that case. A fresh read-only app snapshot
matches all 68 tables/802 credential projections/53 jobs and infrastructure exactly.
The corrected path must share one program builder and exercise the real prepare-to-run
hash gate offline before a new independently reviewed case.

**D6 purpose-account qualification, 2026-10-25 23:08 UTC:**
[Independent read-only acceptance](../../evidence/product/oracle-delivery6-readonly-20261026/acceptance.json)
passed six actual connections: KP_MASTER, KP_LEDGER and KP_OBSERVER through each of two
route aliases. DNS resolved to the pinned ClusterIP; the client connected by IP in both
cases, so the driver DNS connect-string path remains unqualified. Exact 56-grant closure,
including the ledger principal in the negative schema-privilege check, protected source,
identity and empty ledger/application state passed. All 129 old witness rows, twelve PDB
catalog rows and all 68 PostgreSQL tables/802 credentials/53 jobs remain exact.
Independent outcome review saved matching full before/after file hashes and the qualified
Service UID, ClusterIP and full spec hash.

Retain qualification cases 6 and 7 as failures. Case 7 passed the three initial SYS SELECT
phases, then stopped at the Node route-scope guard before DNS or purpose connections:
the old comparator treated JSON key order as identity. Case 8 uses recursive canonical
comparison and one shared SQL builder; offline tests exercise the actual Node program
and real prepare/run SQL hash gate. Each case has separate evidence and no replay.
Private successful case: `.cache/private-lab/delivery6-qualification-20261026-8/`.
This qualifies read-only accounts only. Its execution review has expired; new discovery
or execution requires its own current manifest and independent approval.

**D6 discovery configuration, 2026-10-25 23:41 UTC:**
[Independently reviewed discovery stage](../../evidence/product/oracle-delivery6-discovery-stage-20261026/acceptance.json)
passed with the same application image. The canonical discovery manifest now contains
D6 only; the expired D5 manifest is archived byte-identically. All eight other original
Secret keys are unchanged, three D6-prefixed password files were added, and the Secret
has thirteen keys. The same-image singleton restart produced Pod
`kelryvo-app-bd89c496b-gssjv` (`1926cab9-349c-42a2-9f0b-ac3f84535bc5`).
All five staged files are private to UID 10002; API UID 10001 received EACCES. All 68
metadata tables, 802 credential rows and 53 jobs/12 HOLDs match before/after exactly;
independent current read-only reconstruction agrees. Public HTTPS returned 200.

Private case: `.cache/private-lab/delivery6-discovery-20261026-1/`. D6 discovery authority
expires at `2026-10-26T00:24:35.660Z`; inspect actual current time before using it.
The stage used a fresh independent scope, not the expired qualification approval.
No Oracle connection, API mutation or metadata write occurred in this stage. The native
installation remains the expired D5 configuration; execution and Argo auto-sync remain
off. Product onboarding and governed migrations/ADMITTED remain open. Retain the source
archives and one-shot markers; never replay the stage. The later onboarding candidate
1 was unexecuted/unapproved; source was finalized around preparation, so fresh candidate
2 supersedes it before any login or metadata mutation.

**D6 onboarding partial result, 2026-10-25 23:53 UTC:**
The independently reviewed one-shot API case
`.cache/private-lab/delivery6-api-onboarding-20261026-2/` created project
`9d170611-af70-4a46-9ca9-3b7e89435c96`, environment
`5094f471-f491-46b8-bab1-98575bf72936` and master connection
`46011931-e10f-42c0-b2c8-2a28f8257d8c` revision 1. It stopped before its DISCOVER
HTTP call: the master insert's revision-capture trigger added a row to
`sf_connection_revisions`, which the operator's table allowlist omitted. A replay of
the actual preservation guard against saved before/after snapshots reproduces that
exact rejection. There is no new observation or binding, and no Oracle connection.

Independent failure-preservation review retains all old rows across 68 tables, all
53 jobs/12 HOLDs, old target snapshots/baselines/history/attempts/receipts and exact
infrastructure. The fourteen changed tables contain the scoped project/setup additions,
including the unexpected-to-the-guard revision row. Credential rows are now 806: two new
PASSWORD roots and two revoked BROWSER children; both sessions logged out. This is not
successful onboarding or a claim that every table outside the old allowlist is unchanged.
Never replay this case, recreate its project/master or alter its source archive. A fresh
continuation must reuse these exact IDs, review actual trigger-derived deltas (including
profile revision capture during assignment), and run only discovery and five owner
assignment/verification transitions under current independent authority.

**D6 discovery authorization failure, 2026-10-26 00:07 UTC:**
[Retained onboarding attempts and independent preservation](../../evidence/product/oracle-delivery6-onboarding-attempt-20261026/acceptance.json)
records the next bounded continuation at
`.cache/private-lab/delivery6-api-continuation-20261026000439/`.
It passed all guards and returned one DISCOVER response, then stopped because the
observation was UNAUTHORIZED / ENDPOINT_NOT_AUTHORIZED with no identity. The manifest
copied `acceptedAt` from Python as `2026-10-25T23:08:43.166934+00:00`; production
`validatedAcceptance` requires a canonical ISO timestamp of at most 24 characters.
Source order proves rejection before the Oracle driver's getConnection. No Oracle
connection, schema assignment, verification, DDL or migration occurred.

Exactly one observation, one connection audit, one audit and four credentials were added.
All prior rows across 68 tables, 53 jobs/12 HOLDs, old targets/history/attempts/receipts
and infrastructure remain unchanged. Credential projections are now 810; both new browser
children are revoked. Independent review checked current state and returned explicit JSON;
the parent recorded it with separate recorder provenance because the reviewer role is
read-only. Keep all original source archives, failures, malformed manifest bytes and
reviews. The prior unexecuted continuation `20261026000017` was rejected before running;
its replacement added exact per-phase table delta checks before approval.

The discovery configuration stage remains evidence of exact Secret/restart preservation,
not runtime endpoint acceptance. Next use a new repair scope to normalize acceptedAt,
verify the actual production authorizer offline, and replace only the canonical D6
manifest while preserving every other Secret key. A later fresh continuation must reuse
the existing project/environment/master and retain the unauthorized observation. No old
review/expiry is renewed and neither failed case may be replayed.

**Read-only reinspection, 2026-10-26:** current Kubernetes infrastructure exactly matches
case 2's staged successor, and a repeatable-read PostgreSQL snapshot matches all 68 table
projections, all 802 credential rows and the 53-job ledger after reviewed recovery. The
deployment remains the same singleton image/UID and there is still no WAITING/ADMITTED
job. Private witnesses are in
`.cache/oracle-concurrency-20261025/continuation-readonly-reinspection-20261026/`.
The current app Pod also passed five-sample clock qualification (offset -147.5 ms,
uncertainty 65.5 ms); evidence is
`.cache/oracle-concurrency-20261025/oa09-qualified-clock-live-20261026.private.json`.
This validates only clock measurement on the current Pod, not the prior failure cause.
The revised offline harness now qualifies a successor Pod before worker dispatch and
retains per-probe receipt diagnostics; those exact bytes need a new independent review.

**Current running development image, 2026-10-25 07:26 UTC:**
`longhn0710t/kelryvo-pilot@sha256:557c7d47062355bcde3f259d3601254656b2464cf14267adead605da43ff90fc`,
context `87cc3018f28567877707bf59e107b06339a7b6957ec937ed9ba53f37df4b634d`,
at `https://kelryvo.apps.drgdevlab.com`.
[Schema navigation delivery](../../evidence/product/schema-route-delivery-20261025/acceptance.json)
records the reviewed three-file web fix: Schema and its selected exact target stay in the
URL across reload. Both developer and approver passed real HTTPS viewing, comparison and
reload; four desktop/mobile light/dark screenshots are retained. The Stitch-guided layout
separates history, inspection and comparison, with technical forms and identifiers expandable.
Warnings, coverage and provenance remain visible. Standard checks passed 494 tests with
152 skips, six schema/theme browser cases and one focused route regression passed, and
cold OCI isolation, anonymous digest pull and exact live asset verification passed.
The independently reviewed image-only rollout preserved all 68 metadata tables, four
snapshots, one baseline, 50 jobs and 11 HOLDs. After 18 local/LDAPS/OIDC browser checks and
the two-role Schema checks, all 64 business tables still match and all eight new browser
children are revoked. Execution and Argo auto-sync stay off; discovery stays on.
No fresh Oracle operation occurred in this rollout or its browser checks. Native collector
evidence below belongs to the preceding `00d27393…` image; full R1/R2/OA acceptance remains open.

**Current-image read-only qualification, 2026-10-25 07:37 UTC:**
[Fresh bounded qualification](../../evidence/product/schema-route-readonly-20261025/acceptance.json)
passed on image `557c7d47…` under a new independently reviewed SELECT-only scope.
Six purpose identities through DNS/IP, exact grants and protected objects passed;
Oracle before/after evidence preserves eight application objects, 48 events, four heads
and all four historical PDBs. A separately saved PostgreSQL after-snapshot and independent
read-only reconstruction match all 68 pre-qualification tables. No DDL, DML, dispatch,
catalog refresh, new schema observation or installation-authority renewal occurred.
Private case: `.cache/oracle-concurrency-20261025/qualification-schema-route-1/`.
The pre-review inherited manifest operator/Deployment pins were corrected with original
bytes retained; no Oracle access preceded approval. This qualification does not close
the remaining R1/R2/OA matrices or authorize governed execution.

**Queued request idempotency, 2026-10-25 07:52 UTC:**
[Current-image WAITING acceptance](../../evidence/product/oracle-queued-idempotency-20261025/acceptance.json)
passed 12 real authenticated API probes after fresh read-only catalog discovery verified
the five existing bindings at revision 21. The test reused unchanged KP_B V1 source,
created one new validation/immutable plan and separate approver decision, then one request.
Exact retries returned the same WAITING request; changed payloads, cross-plan key reuse,
a second request key and unauthorized/stale cancellation were denied. The request
`27ea3cb3-f1a3-44bf-9597-e01a212ccdee` finished CANCELLED at revision 1, with zero
admission proofs, attempts or receipts. Independent reconstruction retained all 4,017
prior row hashes in all 68 tables; only 17 scoped rows were added. Current totals are
At that checkpoint: **51 jobs: 19 CANCELLED, 11 HOLD, 5 NOOP, 16 VERIFIED_SUCCESS**, no WAITING/ADMITTED,
four snapshots and one baseline. Both new browser children are revoked; two non-bearer
PASSWORD roots remain under the normal session policy. A later direct PostgreSQL read
matches the saved outcome and confirms the exact WAITING → CANCELLED event pair.
Discovery's independently reconstructed catalog delta is retained. Its credential
row-preservation/revocation assertion was checked by the reviewed operator, but separate
before/after credential row files were not retained for independent reconstruction.
The queued case does retain those credential rows and has an independent full comparison.
No new runtime source/build/image, Oracle SQL, writer admission or dispatch was required.
The ADMITTED variant and complete OA09/R1/R2/OA matrices remain open. All old expired
qualification/discovery/installation reviews authorize no new Oracle work.
Private cases: `.cache/oracle-concurrency-20261025/{discovery-schema-route-1,oa09-queued-route-1}/`.

**ADMITTED harness preparation, 2026-10-25 (offline only):**
`.cache/oracle-concurrency-20261025/oa09-admitted-offline-verification-v2.json` records
14 worker, eight controller and eight session-helper tests, six UID-10002 release-file
checks, and a local handshake with a 5,300ms fake API delay. Independent offline reviews
passed. The exact retained B V2 parser measured 5,276/5,282ms in the running Pod without
Oracle access or metadata writes; the API verifies those statements before its fresh-key
conflict check. The initial five-second gate was therefore replaced with a hard 12-second
gate, 8-second request deadlines and a 9.5-second parallel probe budget. The worker keeps
its 30-second lease, requires 19 seconds remaining before READY, and retains at least
seven seconds after release. Original sources/reviews and the deadline finding remain.
The worker refuses application SQL and target-ledger writes; a timeout cannot report NOOP.
The read-only preparatory container/stream conflict check is clear for KP_B, but it is
not an admission or current Oracle qualification. No new job, admission, writer authority
or Oracle connection was created. The outer operator remains to be completed and reviewed;
it must keep the presenting BROWSER credential/CSRF in memory through review/restart,
pass the probe abort signal and override the session helper's default timeout to 8 seconds.
Its POST probes refresh that new browser credential's idle expiry; account for that exact
row in native-phase preservation evidence, confirm logout 204 before clearing secrets,
and pin request-key/reason lengths at 124/990 or below. Fresh per-job attestation,
qualification, discovery and independent installation/application reviews are still required.
That offline checkpoint preceded the retained live failures above; it does not establish
ADMITTED acceptance. No production source or image changed in those cases.

**Previous development image, 2026-10-25 07:03 UTC:**
`longhn0710t/kelryvo-pilot@sha256:1945dc939a66e81d30b17b23fc29d217afc7d9cc8b50764ecaff328827f4d37b`,
context `c50401bf61721a2d76d82733cc8f8994fe7fdcf455bb2c00715bd4f262cae517`,
at `https://kelryvo.apps.drgdevlab.com`.
[Retained partial UI delivery](../../evidence/product/schema-ui-delivery-20261025/acceptance.json)
records the exact image-only rollout, saved before/after equality across all 68 tables,
four KP_B snapshots, one baseline, 50 jobs and 11 HOLDs. The inherited rollout report's
literal snapshot count of three is corrected by a separate independently reviewed artifact;
the original report/operator remain unchanged. All 64 business tables remain unchanged
after 18 real local/LDAPS/OIDC checks and a retained read-only UI attempt; all seven new
browser children are revoked. Execution and Argo auto-sync stay off; discovery is on.

This image displayed and compared real native schema evidence at desktop/mobile widths
in both themes, but its retained live acceptance failed after reload: `schema` was absent
from the URL page allowlist, returning the view to Projects. The current image fixes this
and persists manual target selection. Private delivery and regression evidence are in
`.cache/schema-route-delivery-20261025/` and `.cache/schema-route-fix-20261025/`.
The first added HTTP-fixture regression omitted reauthentication after reload. The corrected
test authenticates without navigating away or storing its bearer token; focused and final
browser runs passed. Both the product failure and initial fixture failure remain retained.

**Native collector deadline acceptance, 2026-10-25 06:55 UTC, preceding image `00d27393…`:**
Fresh reviewed qualification preserved Oracle 8 objects/48 events/4 heads and four old PDBs;
catalog refresh verified all five bindings. One new KP_B snapshot
`dcbb7619-c54b-4d67-8091-cbe475f388fd` has exact identity, ORACLE_READ_ONLY provenance,
live acceptance, the two expected ID NUMBER tables and no query-unavailable limitations.
All five object-type coverages remain PARTIAL for foreign-owner visibility and multi-query
consistency. Comparison is UNVERIFIED with zero reported changes, not proof of no drift.
All prior rows in all 68 tables, the three older snapshots including failed `4a776f2b…`,
the baseline and all 11 HOLDs remain. Two-role/reload/390px checks passed and browser
children are revoked. This is bounded prior-image collector evidence; the full R1/R2/OA
matrices and current-image native migration acceptance remain open. Private evidence:
`.cache/schema-deadline-delivery-20261025/schema-acceptance/` and
`.cache/oracle-concurrency-20261025/{qualification-schema-deadline-1,discovery-schema-deadline-1}/`.
Expired scope/review times authorize no new Oracle access or replay.

**Previous development image, 2026-10-25 05:26 UTC:**
`longhn0710t/kelryvo-pilot@sha256:66ba95d116fd414776e9b1ecca5b1851e23ae626f66355b0725c0199ae0ccf98`,
context `62c55e6241b49921cc5a46e26af10ad93c919db54e9b06914ea848fbc88406c4`,
at `https://kelryvo.apps.drgdevlab.com`. This changes only the schema metadata query
budget and removes a duplicated drift summary; the other 211 build inputs match
image `7720529b…`. Standard checks passed 492/0/151 skips, five schema browser cases
passed, and exact-image OCI isolation plus anonymous registry digest pull passed.
The reviewed image-only rollout reports all 68 metadata tables unchanged; its
post-rollout snapshots were not saved separately. After 18 real local/LDAP/OIDC
sign-in checks, a separate retained snapshot confirms all 64 non-auth tables exact,
with the 50 jobs, 11 HOLDs, two KP_B snapshots and one baseline unchanged.
Execution remains off, discovery on, Argo auto-sync off. Fresh SELECT-only
qualification passed at 05:30 UTC and catalog refresh at 05:32 UTC, preserving the
Oracle 8-object/48-event/4-head baseline and four historical PDBs. The subsequent
native schema UI case FAILED after about nine seconds: snapshot
`4a776f2b-2da7-4046-b771-a245c8ccf7f6` is retained with UNAVAILABLE provenance and no
identity. Do not replay or delete it. All pre-existing rows in all 68 tables remain;
only that snapshot, one audit/connection-audit and two login credentials were added;
the browser child is verified revoked. KP_B now has three snapshots and one baseline.
Current-image native collector acceptance remains open. A separately reviewed nine-query
SELECT-only diagnostic passed at 05:39 UTC: the metadata queries alone took about
7.8 seconds, before the real runtime’s connection, test and schema inventory calls.
The end-to-end SCHEMA-specific deadline fix is now implemented and published as
`longhn0710t/kelryvo-pilot@sha256:00d27393e7917a9af0818f54f58d42637c183183b7f9fcda2e33768df940e92c`,
context `3c62c55685ad8761af22b23eadefd6074541210bf5af8786ab6ade7c24cfa18f`.
It was subsequently deployed at 06:28 UTC as recorded above. Source and frozen-image independent reviews passed, as did
494 standard tests (152 optional skips), 36 focused unit tests, seven PostgreSQL API
cases, five browser cases, cold OCI isolation and anonymous digest pull. SCHEMA uses
bounded 30/32/35-second runtime/IPC/API deadlines; TEST/DISCOVER and explicitly
configured short timeouts retain their current behavior. The retained image and completed
image-only scope are in `.cache/schema-deadline-delivery-20261025/`; no native
schema acceptance on this candidate is claimed yet.
[Retained partial delivery and diagnosis](../../evidence/product/schema-query-budget-20261025/acceptance.json)
records the rollout, authentication checks, failed native snapshot and timing evidence.
Private current delivery:
`.cache/schema-budget-delivery-20261025/`; preserve both the case-1 helper-hash precheck
failure (no patch) and the successful separately reviewed `image/upgrade-case-2`.

**Earlier sign-in UI delivery, 2026-10-25:** [sign-in UI delivery](../../evidence/product/ui-sign-in-refinement-20261025/acceptance.json)
is live at `https://kelryvo.apps.drgdevlab.com`, image
`longhn0710t/kelryvo-pilot@sha256:7720529b069858f8d6c5e335d3ec7559dbd4a7ebeccd21443fd8a894f5eed4cd`,
context `bf06fc9c504eab36a6799e26cb940beb07079c6dce30029aaa4462ac2728ba5c`.
[DESIGN.md](../../DESIGN.md) records the shared rules and two MCP Stitch references.
Sign-in is one compact column with local credentials first, optional LDAP/SSO below,
and secondary setup/recovery/session details. The SQL toolbar has one primary action
across Save, Prepare release and Create plan. Only five web files changed; all other
208 build inputs match the previous image. Cold build, OCI isolation, anonymous pull,
exact live asset hashes and 18 real local/LDAPS/OIDC browser checks passed.
The image-only upgrade preserved all 68 metadata tables, the whole installation Secret
and persistent resource identities. After live browser checks, all 64 non-auth tables
still match. Public execution stays disabled; discovery stays enabled and Argo auto-sync off.

**Retained governed Oracle state:** [isolated incompatible-history acceptance](../../evidence/product/oracle-incompatible-history-20261025/acceptance.json)
records one successful new KP_FAULT_A seed (two statements, one attempt/two receipts),
then a distinct approved V2 checksum mismatch held before admission: zero application SQL,
ledger writes, attempts or receipts. The old 10 HOLDs remain; total is now **11 HOLDs**.
Current target state is **8 application objects, 48 ledger events and 4 heads**.
Fresh SELECT-only qualification on the newly deployed UI image passed again at 04:41 UTC;
four old PDBs and all 68 metadata tables were unchanged. The reviewed 04:43 UTC catalog
refresh verified all five existing bindings at revision 17 while preserving their identities
and every prior job/HOLD. Two-role browser inspection
of seed/HOLD history and hashed record downloads passed four cases after the upgrade.
The selected Secret remains `kelryvo-oracle-concurrency-20261025`, installation digest
`c0c16d4a84572c7f8a351e85e7aa2bcefe9d45ad64ff28231bd5efe59b7acf43`.
Private evidence: `.cache/stitch-design-refinement-20261025/` and
`.cache/oracle-concurrency-20261025/{oa09-negative-case-1,qualification-r2-ui-1,discovery-r2-ui-1}/`.
The native mismatch case ran on the preceding image; this image has fresh read-only
qualification, not new governed execution acceptance. These cases do not close full
OA01/OA02/OA09, the distinct-installation OA05 variant or remaining R1/R2 matrices.
Expired scope/review times never authorize a replay or another Oracle connection.

[Retained request idempotency](../../evidence/product/oracle-retained-idempotency-20261025/acceptance.json)
adds 25 actual authenticated API probes on the latest image. Exact retries return the
original successful, cancelled or held job; changed payloads and cross-plan key reuse
are rejected. HOLD cancellation and an approver without deploy permission are denied.
All 67 non-credential metadata tables, every prior credential row and all 11 HOLDs
remain unchanged; only four new login credentials were added, with browser children
revoked. The stale-plan new-key probe returned FRESH_PLAN_REQUIRED and does not prove
the separate current-plan held-stream veto. No Oracle calls or new dispatch occurred.

[Current held-stream veto](../../evidence/product/oracle-current-hold-veto-20261025/acceptance.json)
then used the same retained release with a current binding and new metadata/parser
validation, immutable plan and separate approver. Readiness had only
NO_ACTIVE_OR_HELD_REQUEST blocked; the UI disabled Request deployment and the API
returned 409 EXECUTION_ALREADY_PENDING without creating a job. All prior row hashes
in all 68 tables remain; seven tables gained only the scoped plan/validation/audit/login
records and all 11 HOLDs are unchanged. Both new browser children were revoked.
The original browser command remains FAIL: its preservation allowlist omitted the
normal connection-plan record and its aggregate sorting differed from PostgreSQL.
Independent read-only reconstruction proved the row preservation and both ordering
hashes; the application mutations were not replayed. No native Oracle validation or
worker dispatch occurred. At that checkpoint WAITING/ADMITTED variants were open;
the later queued case above covers WAITING only. ADMITTED and the full matrices remain open.

[Native schema baseline browser acceptance](../../evidence/product/oracle-schema-baseline-ui-20261025/acceptance.json)
passed at 04:58 UTC on the delivered image: two exact-identity KP_B snapshots, one
immutable baseline, real comparison, developer/approver history after browser reload,
and 390px layout without overflow. Both snapshots are live accepted and retain the
same two observed table identities. TABLE coverage is UNAVAILABLE with
TABLE_QUERY_UNAVAILABLE; comparison remains UNVERIFIED with incomplete-coverage and
multi-query-consistency limitations. Zero observed differences does not establish no drift.
All old rows in all 68 metadata tables and all 11 HOLDs remain; only the five scoped
audit/login/snapshot/baseline tables gained rows. No DDL/DML, new jobs or worker dispatch.
The first attempt failed on an overly strict select-label locator before any native
snapshot; its FAIL and zero-effect proof remain. Three failed/diagnostic browser children
were verified revoked. The successful case is private `r2-schema-ui2`, following
`qualification-r2-ui-1` and `discovery-r2-ui-2` (five bindings at revision 18).
The D2 operator completed within all deadlines but lacks an immediate expiry recheck
before Secret CAS; add that guard to any future newly reviewed operator, preserving
these original bytes. Next gaps are the unavailable table query and duplicate drift
summary display; the full R1/R2/OA matrices above remain open.

**Existing lab access, rechecked 2026-10-24:** the owner has already authorized direct
testing of the existing internal Oracle lab through `https://kelryvo.apps.drgdevlab.com`.
The owner further confirmed that the whole cluster and backend are dedicated to test,
with full lab infrastructure authority; routine scoped test work needs no repeated permission.
Use the [existing-lab resumption guide](../development/oracle-acceptance.md#resume-the-existing-kubernetes-lab)
for the verified `k8s-admin-public` context, namespaces, service routes and installed
private Secret references before asking for another lab or repeated access approval.
The live development image now has local username/password as the primary sign-in,
with optional real OIDC SSO and verified LDAPS636 choices. Existing proof-bound first
setup, password change and audited operator reset/disable remain available. Identity
provider configuration has its own explicit OS-granted capability; it creates no new
actors, roles, project grants or deploy authority. The lab developer owns that capability;
the approver does not. Provider subjects map explicitly to the existing local actors.

The preceding UI delivery context was `98357aac15b8f461791b5be53cf3afc5bc4ab6a6633a48ce42506c1122ff63be`;
its Docker Hub development digest was
`d97136fe5fd8e7074c8cc9304f03ea293efb5463ac0f44e35cb8c0c97c3bba74`.
The [UI clarity delivery](../../evidence/product/ui-clarity-20261025/acceptance.json)
uses a Google Stitch reference and changes five web files only. Backend, authentication
and worker bytes match the preceding `0afe074f…` / `c7d6faae…` image. Navigation is grouped,
mobile uses a drawer, Projects has search and a bounded list, and setup/archive/technical
details are secondary disclosures. SQL editing leads its screen; account/provider settings
use summaries and explicit editing. All actions and authority boundaries remain available.
Standard checks passed (491 pass, 151 documented optional skips); all 58 browser cases
have successful final-source coverage through the retained full run and corrected reruns.
Nine visual captures have no page errors or overflow. Exact-image OCI isolation and
anonymous digest pull passed. Live HTML/JS/CSS hashes match the image, and all 18 live
local/LDAP/OIDC checks passed. The image-only upgrade preserved every row in all 68 tables;
after sign-ins all 64 non-authentication tables still match, including all plans/jobs/HOLDs.
The original browser failures and signature-fixture padding correction remain recorded;
no all-in-one green full browser command or native Oracle acceptance is claimed by that UI record.

The preceding authentication implementation and its original verification are recorded below.
See [identity delivery evidence](../../evidence/product/local-identity-auth-20261025/acceptance.json)
and [account/provider operations](../development/local-product.md#https-browser-sessions).
Base source is `8796a57`; no canonical signed commit, Git push, source-install qualification,
hosted CI run or gated release is claimed. Standard checks, all 217 API cases, exact-image
OCI isolation and identity-secret staging passed. The browser gate covers all 58 final
cases: its retained full run passed 57 and failed the old 12-item navigation expectation;
the corrected final-source case passed all 13 destinations in both themes at three widths.
The original failure remains retained; no green full-run command is claimed.

Real public Chromium acceptance passed local, LDAP and OIDC sign-in for both fixed
roles, session/cookie checks, provider UI connectivity tests, approver denial, logout and
bad LDAP password denial, both before and after restart (18 checks each). The image
upgrade retained every row in all 61 original tables and added seven empty identity tables.
After actual sign-ins, all 60 non-credential original tables still match; only the expected
authentication credential table changed. All 68 tables and 14 two-role historical record
comparisons remain unchanged across app restart, including preserved HOLDs.

Open the private mode0600 `.cache/private-lab/OWNER_ACCESS.txt` for local credentials
and the optional lab LDAP/SSO test users. Change local passwords in Account & access.
Current identity runtime, fixture scope and infrastructure evidence are retained privately
under `.cache/identity-delivery/`; the public evidence contains hashes and generic outcomes.
OIDC backend routing uses an OS-managed hostname pin to the existing private ingress,
verified TLS and an app-only Cilium HTTPS rule for its observed control-plane identity.
Do not replace it with an unrestricted egress rule or change global Cilium settings.
The earlier [local-password delivery](../../evidence/product/local-password-auth-20261024/acceptance.json)
remains historical on worktree `d8fc1717…` / image `10101100…`. Additional federation
protocols, public signup and general user-management UI remain outside the accepted slice.

The preceding [mobile and Oracle delivery](../../evidence/product/development-delivery-20261024/acceptance.json)
remains historical on worktree `6c5d4a8f…` / image `b5a6add6…`. Its Oracle observations
do not certify native execution on the changed authentication/admission source above.

The selected private installation is now `kelryvo-oracle-concurrency-20261025` for
`KP_DELIVERY5`; the old `kelryvo-oracle-fresh-delivery5-20261024` Secret is retained.
[Current-source read-only qualification](../../evidence/product/oracle-current-source-readonly-20261025/acceptance.json)
verified six purpose-account identities over DNS/IP, the complete five-owner object
inventory, 28 ledger events/three heads, exact protected sources/grants, and four unchanged
historical PDBs. It does not establish a governed migration or concurrency result.
The reviewed installation switch preserved all 68 metadata tables and persistent resource
UIDs; API UID10001 still cannot read Oracle writer credentials. Post-stage local/LDAP/OIDC
browser acceptance passed all 18 checks. Execution is disabled and discovery is enabled.
A fresh independent qualification passed at 19:00 UTC on October 24, followed by an
explicit catalog refresh and verification of all five bindings at 19:07 UTC. The refresh
preserved historical plans, jobs, HOLDs and assignment/stream/lineage identities. Its
private scope expires at 19:27 UTC; the observation becomes stale sooner. Writer authority
remains unavailable pending fresh approved requests and an independent native case review.
The subsequent [discovery continuation evidence](../../evidence/product/oracle-current-source-discovery-20261025/acceptance.json)
retains a second completed catalog refresh at 19:23 UTC, with observation expiry at
19:38 UTC and five bindings at revision 8. Its operator failed an incorrect credential
count assertion after completing the API calls. Independent read-only reconstruction
verified the outcome, all prior credential rows and the revoked browser child; the
original command remains FAIL. Discovery and binding calls were not replayed.

Private operations remain in `.cache/oracle-concurrency-20261025/`. The latest
[bounded Oracle concurrency acceptance](../../evidence/product/oracle-ui-image-concurrency-20261025/acceptance.json)
is `native-ui-case-4`, PASS at 20:58 UTC on the current UI image. Fresh qualification
(`qualification-ui-3`), catalog discovery (`discovery-ui-3`) and actual browser preparation
(`browser-cases-ui-3`) preceded separate native case review. Both independently approved
jobs reached VERIFIED_SUCCESS: `24d39549-20d3-42c0-bb41-e8b560103f6e` for KP_B and
`d4ff0fbf-dd36-4582-96b9-28a42b0fc3d9` for KP_COMMIT. Each ran one pending V2 statement,
with one attempt and receipt; applied V1 was not replayed. The native same-container
mutex remained held across real DDL implicit commit, a distinct session observed busy,
and C waited on the PostgreSQL advisory lock before entering Oracle. No writer SQL overlapped.
Both processes use the same reviewed installation/worker ID; a separately installed,
distinct-worker-ID variant is still unqualified. This does not close the full OA05 matrix.
Independent outcome review validated the complete retained evidence. Actual public
[Chromium history acceptance](../../evidence/product/oracle-ui-image-concurrency-20261025/browser-history.json)
passed all four developer/approver × two-job cases: one attempt and receipt shown, format-2
record downloads hash-valid, role facts equal except export time, and logout complete.
That concurrency run left the same image ready; it required no runtime source or image change.

That concurrency case ended with **six application objects, 38 ledger events and three heads**.
All old objects/events, four historical PDBs, old plans/jobs/journal rows and 10 central
HOLDs remain unchanged; 61 unrelated metadata tables match exactly. The seven changed
tables contain the scoped admission, execution and audit evidence. Keep `KP_LOST_ACK4`,
the CUT proxy and its 68 withheld diagnostic bytes intact. Never replay a successful,
cancelled or ambiguous request.

Earlier operator failures remain FAIL: case1 stopped during metadata preparation on the
expected restart's Pod UID change; case2's parent rejected valid UUIDs before driver
imports; case3 declined before the private resolver because its minimal child environment
omitted the parser Java path. All earlier requests had zero attempts/receipts and were
normally cancelled, preserving plans. Separate read-only recovery proved their before/after
state; none was rerun. The corrected parent is `concurrency-parent-ui4.mjs`, with complete
input and pinned parser-environment coverage. UI2's execution-skipping guard was rejected
and must not be used. Artifact reads require UID10002 even when the exec starts as root.

Public execution remains disabled and discovery enabled. The selected Secret remains
`kelryvo-oracle-concurrency-20261025`; the case4 installation digest is
`9d0f3a85b84d23f567ac4c4a1e3f80f60ebeadebe17df7e37f325f648a959f7d`.
Its native review expires at 21:08 UTC, with observation/case expiry at 21:09 UTC on
October 24. Those times are evidence, not renewable authority. Before another connection
or dispatch, inspect the actual current Pod/mounted sources and retained state, then
obtain a new attested manifest and review. Old four-object/28-event qualification baselines
are now stale; never use them to erase the two verified V2 effects. Full OA01/OA02/OA09,
the remaining OA05 variant and R1/R2 visibility/browser matrices remain open.

Source `8796a57` now has [local build/test/public-image evidence](../../evidence/product/local-development-image-20261024T101817Z/acceptance.json):
202 API/PostgreSQL tests, 55 Chromium tests, 25 fresh-source installation workflows,
container isolation and anonymous digest-pinned registry pull passed. Its development
digest is `cd46b7c5e95fd02896dc0877196a2190d886da1a3ff571561b5d2c012b2e3398`.
The image was deployed through a guarded image-only upgrade; all 59 metadata tables
and stable persistent-resource identities were preserved. The locally prepared chart
source is not merged, and Argo automatic sync remains paused.
Its [actual Compose acceptance](../../evidence/product/compose-local-20261024T103111Z/acceptance.json)
also passes HTTPS governance, credential rotation, app restart/recreate, external
PostgreSQL restart and essential-child failure without automatic restart. The complete
rows of five selected business tables remain unchanged across those lifecycle checks.
These local results do not qualify live Oracle execution or restored-cluster cutover.

The [current live continuation](../../evidence/product/oracle-continuation-8796a57-20261024/acceptance.json)
adds actual browser-authored/independently approved V1/V2/NOOP on two schema streams,
six central receipts, immutable NOOP Oracle state, and a successful real lost-ack
observation on a fresh PDB. Response withholding/cut, native-driver rejection and
unexpired lease evidence precede retained HOLD (one attempt, zero receipts). Independent
HOLD reconciliation, two-role historical downloads, native managed backup/restore and
restart checks are retained. Every failed controller/pre-admission case remains recorded;
none was replayed. This is bounded acceptance, not the complete Oracle pilot. Remaining
identity-negative, unsafe governed dispatch, route-alias concurrency and incompatible
history matrices still require their full live cases.



The [current installed negative probes](../../evidence/product/oracle-negative-authority-8796a57-20261024/acceptance.json)
add six denials for identity, unassigned owner, statement checksum, service and actual
writer/ledger wrong-PDB sessions. Native purpose SELECTs also deny protected-ledger
reads to the writer and application-table reads to the ledger owner. No application
DDL or mutation was called; exact Oracle state, prior journals and the one-attempt,
zero-receipt lost-ack HOLD remain unchanged. These no-admission probes do not complete
the governed OA01/OA02 matrices.

**Current product architecture:** one master credential reference per registered Oracle
PDB/non-CDB, multiple assigned schemas per project, one exact-schema stream per migration
plan and mandatory independent approval. Keep the current browser journey and components:
Connect → Discover → Assign → Author → Validate → Plan → Review → Execute → History.
Improve context, blocked-state explanations and next steps within the existing interface;
do not redesign the workflow.

**Runtime candidate:** package the API, discovery and execution roles in one OCI image. A
minimal-capability root PID 1 stages root-owned source credentials, then runs the API as
UID 10001 and internal execution/discovery as UID 10002. The children have no effective
capabilities; discovery uses a fixed internal Unix socket contract. Essential child loss
stops the container. Lease expiry continues to project HOLD; no child restart or SQL
replay is allowed. Docker Compose and Helm use the same image and runtime configuration,
with PostgreSQL outside the application container. This candidate is not yet an accepted
Oracle runtime or completed pilot.

The [2026-10-23 unified runtime acceptance](../../evidence/product/unified-runtime-20261023/acceptance.json)
records source `3ea8859`: 199 PostgreSQL/API tests, 55 Chromium tests, fresh-source
installation, AMD64 container isolation and owner-authorized public deployment acceptance.
The development image passed role login, review/downloads, mobile layout and app restart;
original metadata and PostgreSQL/PVC identities were preserved. Argo automatic sync is
paused in both live configuration and the chart source. The accepted development overlay
is `values.development.yaml` in the chart repository; it is separate from gated release
publication. Do not re-enable sync against the old master/image while the pilot is incomplete.

The previous source-specific development candidate was `ee44f6f`: [exact-source regression](../../evidence/product/unified-oracle-20261023/regression-ee44f6f.json)
passes 202 API and 55 browser tests plus frozen-source release and local OCI isolation.
Its [guarded app upgrade](../../evidence/product/unified-oracle-20261023/upgrade-ee44f6f.json)
preserves all 21 observed business tables, PostgreSQL/PVC/Service identities and 24
historical record downloads across both browser roles. Execution remains disabled.
Those results remain historical; the continuation above repeats bounded V1/V2/NOOP
and adds the new real lost-ack observation on `8796a57`.
A [witnessed managed PostgreSQL restore](../../evidence/product/unified-oracle-20261023/managed-restore-ee44f6f.json)
using the exact new operator and image preserves all 21 compared business tables in a new
owned database. Root-recovered developer/approver access reads historical records while
old credentials fail; restart retains RESTORE_HOLD and mutation denial. No Oracle writer
is installed in that restored app. This qualifies historical read access under HOLD,
not restored-cluster cutover or recovery of interrupted Oracle execution.
[Three fresh fault PDBs](../../evidence/product/unified-oracle-20261023/fault-pdb-preparation.json)
are provisioned and qualified in the existing lab. The first PDB now has a
[bounded before-first-DDL interruption proof](../../evidence/product/unified-oracle-20261023/interrupt-before-first-ee44f6f.json)
on `ee44f6f`: killing UID 10002 after the central STARTED event but before native DDL
stops the container; lease recovery retains HOLD, one attempt and zero receipts. Oracle
has no application objects and retains its three ledger events unchanged after another
app recreate. Both browser roles can inspect and download the held records. Execution
is disabled again; the after-acknowledgment evidence follows below, followed by the
retained real lost-ack controller FAIL.
The [first after-acknowledgment attempt](../../evidence/product/unified-oracle-20261023/interrupt-after-first-failed-ee44f6f.json)
is retained as FAIL: the private fault operator stopped on a transient old/new Pod list
before sending SIGKILL. The fixed pause expired after CREATE TABLE was acknowledged;
ALTER ADD never reached its native writer. HOLD, one receipt, the ID-only table and six
ledger events survive controlled app recreation and both roles can download the records.
This verifies retained partial state, not the intended process-interruption boundary.
Preserve this failed request/PDB. A [fresh qualified PDB](../../evidence/product/unified-oracle-20261023/fault-retry-pdb-preparation.json)
now has [after-first-ACK interruption evidence](../../evidence/product/unified-oracle-20261023/interrupt-after-first-ee44f6f.json)
on the same `ee44f6f` image. The corrected operator verifies a live watcher and the
reviewed mounted modules before opt-in, tolerates terminating old Pods, then confirms
one receipt and the ID-only table before killing UID 10002. The container exits 1;
lease expiry retains HOLD, one attempt and one receipt. Oracle metadata and all six
ledger rows are identical before the kill, after automatic restart and after another
controlled app recreate; both roles retain history downloads. Execution is disabled.
These two bounded interruption cases do not qualify lost-ack or full pilot acceptance. A
[lab-only proxy route proof](../../evidence/product/unified-oracle-20261023/lost-ack-proxy-readiness.json)
now verifies the fixed TCP proxy and one read-only Oracle identity query from the app's
execution UID. The proxy starts in PASS with no buffered response or cut; this prepares
network-fault testing and is not lost-ack acceptance. It is a separate lab fixture,
not an application worker or production deployment requirement.

The [2026-10-24 lost-ack attempt](../../evidence/product/unified-oracle-20261023/lost-ack-failed-ee44f6f.json)
on `ee44f6f` remains **FAIL**. Its installed no-dispatch preflight observes the writer
through the proxy while ledger/observer sessions stay direct. During the actual case,
one native CREATE takes effect, 68 upstream response bytes are withheld, and fail-closed
cleanup cuts the session once without releasing bytes. The private controller rejects
its historical BUFFER baseline as stale before its successful CUT path; post-cut native
rejection status is not captured. Do not infer the exact cause of HOLD from its timestamp.
The job retains one attempt, zero receipts and HOLD. The ID-only table, head checksum and
all three unacknowledged ledger events remain identical across the cut and a controlled
app recreate; both roles download matching retained records. Execution is disabled,
Argo stays paused, and the proxy remains CUT with cumulative counters preserved.
The closed-session buffered-byte diagnostic remains 68; there is no active session.
Never replay this request or PDB. A corrected operator, fresh target and new independent
approval are required to qualify another fault case. Full pilot acceptance remains incomplete.
A [fresh retry PDB](../../evidence/product/unified-oracle-20261023/lost-ack-retry-pdb-preparation.json)
now has source-bound metadata and native purpose-account qualification, including exact
grants/quotas, service identity, protected-ledger denial and cross-COMMIT mutex exclusion.
The earlier held target's object and complete journal remain unchanged. Application
installation and governed retry were NOT_RUN at that checkpoint. The current-source
continuation above records their subsequent results and preserved failures.

The same `a4dbb8d` image also passed [Docker Compose governance and persistence](../../evidence/product/unified-oracle-20261023/compose.json)
with external disposable PostgreSQL, HTTPS, independent approval, credential rotation,
restart and recreate. The corrected workstation override binds only to loopback; the
initial all-interface fixture is explicitly retained as invalid evidence. Compose Oracle
execution remains unverified; the newer candidate has the bounded restored metadata proof above.

The owner subsequently authorized a new disposable Oracle Free 23.26.3 lab and bounded
pilot SQL/fault tests on 2026-10-23. The private authorization and observed identity are
retained outside Git. The new lab is ready on a Longhorn-compatible worker with a retained
20 GiB PVC; direct identity, scoped grants, protected ledger denials and cross-COMMIT mutex
probes passed. These probes do not qualify governed execution. The reviewed private
installation now has [bounded governed acceptance](../../evidence/product/unified-oracle-20261023/governed-ddl.json)
on source `a4dbb8d` and its pinned development image: two schema V1 CREATE TABLE runs,
two V2 suffix runs (ALTER ADD and CREATE INDEX), then two NOOP requests. The six DDL
acknowledgments have central receipts; Oracle ledger heads are 13 for each schema.
NOOP leaves object metadata and every ledger event unchanged. Both browser roles can
inspect and download the retained records before and after app restart. These bounded
results do not complete OA01–OA10 or operational acceptance. Argo stays paused; preserve
the historical lab evidence.

The first governed unified-runtime V1 run is retained as
[FAIL/HOLD](../../evidence/product/unified-oracle-20261023/initial-held-v1.json):
one real table effect, a complete target ledger and one central receipt were observed,
but a private postcondition SELECT used an Oracle-reserved bind name and final validity
could not be verified. Both held requests and all evidence remain unchanged. The bind
was corrected and rechecked read-only. A fresh owned PDB in the same lab completed the bounded
V1/V2/NOOP sequence; the failed PDB remains intact. No HOLD is cleared and no uncertain SQL is replayed.

[PR #112](https://github.com/devsecopslonghn/kelryvo/pull/112) and [its bounded real
Oracle acceptance](../../evidence/product/instance-master-workflow-20261015/acceptance.json)
remain historical source-specific evidence: two schema V1 executions, a V2 suffix, a
browser-authored no-op and independent history/audit verification. That evidence covers
the recorded CREATE TABLE statements only. The current source policy also recognizes
scalar ALTER TABLE ADD and simple CREATE INDEX. The new source-specific acceptance above
covers those exact forms on Oracle Free 23.26.3; fault, identity-negative, concurrency,
unsafe-dispatch and managed backup/restore cases remain incomplete. Snapshot coverage
remains PARTIAL/UNKNOWN where the observer has not established complete visibility.

For an owner-authorized development image test, use a temporary Docker Hub tag tied to
the exact source revision while Argo CD auto-sync for the Kelryvo application is paused.
Keep that direct test separate from the existing source-gated, immutable GHCR publication
and product-release path. Do not merge or waive required CI/review checks to perform the
test. Resume the saved Argo behavior only after the pilot is complete and the desired
source/image have been reconciled through review.

Acceptance is version, topology, statement and source specific. Consult the product
requirements and retained Oracle acceptance before claiming a new runtime capability.
Existing HOLDs remain retained; never replay uncertain DDL or delete the Oracle lab.

Before changing code, inspect `AGENTS.md`, [architecture/safety contracts](../architecture/KELYRVO_ARCHITECTURE_DECISIONS.md), relevant [API/operator contracts](../development/local-product.md) and [testing guidance](../development/testing.md). Run `npm run status` and `npm run next` for retained tracker context, then follow the selected roadmap criteria. Do not start another target-binding, SQL-workspace or connection-management phase merely because an older catalog task is BACKLOG.

The [tracking guide](tracking.md) explains original catalog acceptance versus bounded product delivery. Historical acceptance and all raw evidence remain available; they do not establish today's deployment or live Oracle support. Stop at missing live authorization, retain NOT_RUN honestly, and continue only independent in-scope preparation. Deployment, infrastructure changes and writer execution require explicit task authority.


**D6 discovery manifest repair, 2026-10-26 01:54 UTC:**
[Independent repair and preservation evidence](../../evidence/product/oracle-delivery6-discovery-repair-20261026/acceptance.json)
passed once under a new reviewed scope. The manifest now uses the canonical 24-character
UTC acceptance timestamp, contains D6 only and expires at `2026-10-26T09:50:08.249Z`.
All thirteen Secret keys remain; the other twelve values are byte-identical. The same
image singleton restart preserved all 68 metadata tables, 810 credential projections,
53 jobs and 12 HOLDs. Five mounted files remain UID 10002/mode 600 and API UID 10001
is denied access. Independent current read-only reconstruction matches the saved after
snapshot. No API mutation, Oracle connection or database write occurred in this repair.

Private case: `.cache/private-lab/delivery6-discovery-repair-20261026-3/`. Cases 1 and 2
stopped during local archive preparation before approval or execution; retain them.
The corrected archive writer accepts duplicate names only for byte-identical private
regular files and rejects tampered files/symlinks. Never replay any started case.
The expired D5 native installation and all retained failures/HOLDs remain unchanged.
A new onboarding finish operator binds the actual raw pre-repair snapshot, historical
repair authority at execution time and the full deployed backend source identity.
Its focused offline checks passed 9/9; standard checks passed 494/0 with 152 optional
skips. Actual schema onboarding and ADMITTED/NOOP still require their own acceptance.


**D6 schema onboarding, 2026-10-26 01:58 UTC:**
[Independently reviewed API onboarding](../../evidence/product/oracle-delivery6-onboarding-20261026/acceptance.json)
passed on the unchanged image. One real read-only discovery returned exact D6 identity
and accepted all five named owners. The observation is PARTIAL: it lists 40 schemas
including inaccessible schemas, so this is bounded owner-scope acceptance. One bulk
assignment and five verification calls created five VERIFIED bindings in the existing
`Kelryvo Oracle Delivery 6 20261026-2` project. No DDL/DML or worker dispatch occurred.

All prior rows across 68 metadata tables, 53 jobs/12 HOLDs and the old KP_B four
snapshots/one baseline are preserved. The two logins added four credential projections
(810 → 814); both new browser children are revoked and the password roots remain.
Independent current PostgreSQL/Kubernetes reconstruction matches the saved after-state.
All 111 backend source files used by the operator match the deployed immutable image.
Private case: `.cache/private-lab/delivery6-onboarding-finish-20261026-1/`. Retain its
review, one-shot marker, fourteen response journals, source archives and both earlier
failed onboarding cases. Never replay a started case. The observation expires at
`2026-10-26T02:12:04.012Z`; later execution needs fresh currentness evidence and its own review.

The browser-to-native seed handoff remains local preparation. Complete and review
the native coordinator before creating a WAITING request: its developer browser
credential must remain active through admission. D5 native authority remains expired;
ADMITTED/NOOP and the full matrices are not accepted. Execution and Argo auto-sync
stay off. The native installer candidate must replace exactly two of the thirteen
Secret values and preserve the other eleven.


**Native handoff preparation, 2026-10-26 02:15 UTC (source only):**
The private browser seed, normalized candidate builder, two-key installer and live
Kubernetes adapter passed independent source reviews. Their combined focused suite
passed 45/45; the candidate also passed the actual authority consumer offline.
Private review record: `.cache/private-lab/delivery6-native-source-review-20261026.json`.
This records source review, not a live execution approval. No browser seed request,
native stage or worker was started. Do not create WAITING work until the complete
file producer, owned worker/watchdog and Oracle PRE/POST witness coordinator are ready.

Reviewed modules are `browser-delivery6-seed.mjs`, `normalize-delivery6-seed.mjs`,
`prepare-delivery6-native.mjs`, `stage-delivery6-native.mjs`,
`stage-delivery6-native-live.mjs` and `delivery6-seed-worker.mjs` under private-lab.
The installer binds its full raw baseline as well as its canonical snapshot, marks
CAS requests in flight before awaiting responses, preserves all eleven other Secret
values, and captures unknown outcomes without rollback/replay. Its live observer
checks PostgreSQL only between Secret update and restart; after Ready it checks the
complete infrastructure again. Seed reread uses production target/governance locks
in a normal transaction because PostgreSQL SELECT row locks cannot run in a read-only
transaction; that phase issues no application DML. Native profile proof retains the
full production profile while validating its fixed route fields.

A fresh read-only capture at 02:14 UTC matches the reviewed onboarding after-state
exactly: snapshot `463c4e7e…`, 68 tables, 814 credentials, 53 jobs/12 HOLDs, Pod
`kelryvo-app-bb4ddfc4c-bl2gm`. The 01:57 observation has now expired. Complete the
coordinator first, then obtain fresh discovery/reverification before planning; preserve
all original observations and reviews. Browser/normalizer counts currently describe
the 814 → 818 credential phase: a new refresh login changes that baseline, so update
the actual producer/consumer contract and test it before a refreshed live seed.
ADMITTED/NOOP remains unproved and the goal remains active.

**D6 currentness and coordinator, 2026-10-26 08:59 UTC:**
[Independent currentness acceptance](../../evidence/product/oracle-delivery6-currentness-20261026/acceptance.json)
records one actual read-only discovery and five existing-binding reverifications in
`delivery6-currentness-refresh-20261026-3`. All five bindings advanced to revision 3;
all 68 tables' unapproved rows, 53 jobs, 12 HOLDs and infrastructure were preserved.
Credential projections changed exactly 814 → 818; both new browser children were
revoked. The observation expired at 08:13:30 UTC and cannot authorize another action.

Browser seed case 1 stopped at its expiry guard before `execution.started`, login,
plan/job creation or native staging. Reviewed-flow case 1 subsequently stopped while
waiting for refresh case 4's independent approval; its PID is gone, its failure is
retained, and refresh case 4 has no execution marker. Never restart either flow.
No D6 native installation or worker has run; the expired D5 installation remains.

The browser-to-native coordinator, owned worker and actual PG/Oracle witness adapters
are implemented locally. Source review and 81 focused tests passed; standard checks
passed 494/0 with 152 optional skips. Repeated refreshes now carry bounded, raw-hash-bound
predecessor proofs: they preserve historical deadlines and require the next baseline
and binding revisions to match the last accepted result. A mocked full round trip
checks 818 → 822 → 826 across refresh/browser/native consumers; these are not live counts.
The unused prospective-policy prototype was rejected during review and removed.
All existing independent execution approvals remain required. ADMITTED/NOOP is open.

**Second D6 currentness result, 2026-10-26 13:01 UTC:**
[The second independently reviewed refresh](../../evidence/product/oracle-delivery6-currentness-20261026/second-refresh.json)
completed at 09:07 UTC in `delivery6-currentness-refresh-20261026-5`.
All five existing bindings were reverified; credential projections changed exactly
818 → 822 with both browser children revoked. All 53 jobs, 12 HOLDs, unapproved rows
and infrastructure were preserved. Its observation expired at 09:20:53 UTC.

Reviewed-flow case 2 reached read-only preparation of browser seed case 2, then stopped
waiting for that case's independent approval. Its terminal failure is retained and PID
is gone. Browser case 2 has no review or execution marker; no login, plan/job creation,
native installation or D6 worker followed. Never restart the old flow. The canonical
D6 discovery manifest also expired at 09:50 UTC; a fresh reviewed configuration scope
is needed before another discovery. Historical reviews and observations stay unchanged.

**D6 discovery renewal, 2026-10-26 14:30 UTC:**
[Independently accepted configuration renewal](../../evidence/product/oracle-delivery6-discovery-renewal-20261026/acceptance.json)
replaced only `discovery-manifest.json` and restarted the singleton on the same image.
The new canonical manifest hash is `d5bb8327…`; it expires at **22:25:56.220 UTC**.
Its D6 target and historical acceptance are unchanged; the original manifest is retained
byte-identically. All thirteen Secret keys remain and the other twelve values are exact.
Pod UID is `af979de2-24a5-4643-9ac2-4a1c4a3f0e0e`; runtime UID 10002/mode 600 and API
UID 10001 denial passed. Execution remains off; the expired D5 installation is unchanged.

Both before/after snapshots and the independent current read-only reconstruction prove
all 68 metadata tables, 822 credential projections, 53 jobs and 12 HOLDs unchanged.
Full after-snapshot SHA is `28957a32be9ddecdcb882b088edb1fa2b5776213bea4ca59894885252b02e787`.
The case made no Oracle connection, application API call or metadata write. Private case:
`.cache/private-lab/delivery6-discovery-renewal-20261026-1/`; never replay it.

Currentness/browser/native consumers now carry this independently accepted configuration
transition separately from expired historical observations. The mocked complete chain
checks 822 → 826 → 830 while the actual lab remains at 822. Another real discovery needs
a new reviewed currentness scope using refresh case 5 plus this renewal proof. Do not
start another short-lived observation until the complete execution/review path is ready.
ADMITTED/NOOP, native D6 seed and current qualified-clock evidence remain open. Admission
statement counts describe pending statements: a post-seed two-file NOOP must admit zero,
while retaining the two applied migrations as provenance.
