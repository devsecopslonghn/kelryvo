# Kelryvo browser coverage

Chromium verifies DOM behavior and the web/API boundary. PostgreSQL persistence,
worker dispatch, parser correctness, locking, authorization decisions, ambiguous
DDL, HOLD and recovery invariants belong to the always-gated API/integration
suites. Synthetic UI fixtures exercise the real built React bundle with explicit
public HTTP response contracts; they neither authorize execution nor attest
Oracle effects. Unmodeled API requests and page errors fail these tests.

## Three representative real-stack smoke flows

1. Phase 6 HTTPS infrastructure registration → fixture discovery → SQL review →
   immutable plan → independent approval → governed request → retained records.
2. MVP Git intake → assigned reviewer/inbox → approval → independent withdrawal →
   new release and fresh plan. Comparison, provisional catalog rendering and audit
   cursor pagination have their own focused regressions rather than repeating here.
3. Secure sessions: real TLS trust, Secure/HttpOnly/Strict cookie, JS/storage
   isolation, real CSRF denial, failed logout retry, revocation and expiry UX.

`npm run test:browser:smoke` selects these three flows. `test:browser:extended`
selects complementary UI regressions. The existing `test:browser` command and
CI run **both** sets: splitting tiers does not remove a required gate or silently
exclude critical coverage. CI uses eight isolated serial API shards, three browser
shards, release acceptance and the fail-closed `product` aggregate. API scheduling
uses top-level TAP costs from master PRODUCT run 38379731590 at `8f4c15b`; browser
partitions and assertions are unchanged. The preceding optimization measurements
below retain their historical four-shard configuration.

## Assertion audit

All 40 preceding browser files were audited. Each row distinguishes essential
browser interactions from duplicated domain/API assertions and misplaced
backend/recovery work. `API` names refer to `tests/product-NAME.test.mjs` unless
an integration filename is stated. Removal requires the listed UI transfer and
surviving API gate; small distinct UI races remain extended regressions.

| Preceding browser file | Essential browser-only interactions | Duplicated API/domain or misplaced backend/recovery assertions | Disposition |
| --- | --- | --- | --- |
| phase6-workflow | HTTPS forms, explicit target, SQL findings, independent review, request controls, mobile layout, downloads | Stored checksums, discovery authority, durable audit: database-discovery, sql-validation, target-workflow, execution-record/readiness | Core; absorbs mobile/environment/credential and hostile decision rendering |
| mvp-workflow | Git intake, assignment/inbox navigation, independent withdrawal, fresh-plan intake | Comparison facts, provisional catalog, cursor fixtures, immutable withdrawal: release-comparison, schema-reference, approval-revocation, audit-pages | Core; remove repeated comparison/catalog/cursor journey |
| secure-sessions | Certificate rejection, real cookie attributes/JS isolation, logout retry, expiry clears login | Plan approval, native restore, revoked session history: secure-sessions, backup-restore, metadata-recovery | Core; no Git/backup fixture, virtual clock advances the unchanged poll |
| phase5-execution | HOLD/no-cancel/retry controls, digest-only evidence, independent reconciliation UX | Real worker dispatch/receipts, restart, no replay, persisted reconciliation: phase5-execution, execution-reconciliation, execution-jobs | Focused HTTP contract; backend assertions remain API |
| target-workflow | Explicit environment/mobile layout; target selection beyond first 50 | Second full binding/approval/request/restart journey: target-workflow, target-bindings; already Phase 6 core | Keep pagination regression; fold first journey into core |
| database-discovery | Connection/status/history rendering, supersession and revoked view clearing | Discovery scope, private refs, trust, identity persistence/currentness: database-discovery, target-workflow | Extended distinct discovery UI |
| sql-validation | Unknown/blocked/stale findings, disabled plan controls | Parser/policy, immutable validation and record contents, restart: sql-validation, plan-record | Extended distinct validation UI |
| instances | Retirement controls; approve disabled/reject retained; retained plan remains readable | Retirement authorization and persisted history: profile-lifecycle, credential-lifecycle | Extended |
| account | Session list, revoke another, preserve own, clear on logout | Actor scope, revocation, CSRF and audit: account | Extended |
| membership | Bootstrap read-only UX, receipt/grant refresh, revoked selection clears panels | Grant authority, organization scope, no unauthorized writes: membership | Extended |
| credential | Old delayed 401 cannot expire new actor; active revocation clears login; token not echoed | Credential validity/authority: credential-lifecycle, secure-sessions | Extended essential epoch fence |
| browser | Invalid/dirty/unbound source controls; committed stale write response ignored | Binding validation/authorization/persistence: source-binding, protected-source-binding | Extended essential session/project fence |
| archive | Archived forms read-only while retained source/history stay visible | Archive transaction, lock/revocation and record immutability: archive | Extended |
| review-audit | Denial reason/actor/action shown in timeline | Denial audit persistence, read-only plan/history: review-audit | Remove after transferring rendering to audit-action-filters |
| comments | XSS-safe author/evidence rendering; attach/reopen; draft resets by plan/project/session; terminal/archive read-only; source-generation/delayed-preview invalidation | Stored comments, source verification, archive/restart, immutable rows: comments, comment-evidence-unit, statement-preview, protected-source-binding | Focused HTTP contracts; no parser or restart |
| decision-record | Hostile reason as literal text, plan-specific attribution | Retained actor/reason snapshot through restart/rename: decision-record | Remove after transferring hostile rendering to Phase 6 |
| status-filters | Status/order filtering, decision/comment draft context, terminal/archive controls | Stored status, immutable records: approval-integrity, archive, comments | Extended |
| audit-action-filters | Action dropdown/filter order and reset; denial actor/reason text | Event generation, scope, immutable rows: review-audit, audit-pages, comments, archive | Extended; absorbs review-audit rendering |
| audit-pages | Paging and late cursor/filter/refresh/project/logout fences; revoked view clears | SQL cursor order/scope/archive/revocation/read-only: audit-pages | Extended essential cursor races |
| git-ref-selection | Scoped ref selection, rebind clears ref, stale prior-project ref response ignored | Git ref validation/order/bounds: repositories | Extended |
| release-provenance | Retained provenance and unavailable detail rendering; project-switch response fence | Registry removal/archive retention, malformed records and no planning: retained-detail, release-integrity, archive | Extended |
| release-integrity | Fixed integrity error/banner, no plan displayed | Corrupt retained release rejected without writes: release-integrity | Extended fixed-error feedback |
| release-comparison | Selected pair, comparison presentation, stale pair/project/session response discarded | Canonical comparison facts, scope, read-only and repository removal: release-comparison | Extended |
| plan-source | UTF-8 byte/hash validation, rejected malformed detail, stale plan/project/session previews | Repeated Git/parser corpus, repo move/restart, metadata snapshots: import, statement-preview, release-integrity, protected-source-binding | Focused HTTP contract; backend retention remains API |
| plan-target | Frozen/current target and malformed/foreign profile rendering; context clearing | Target immutability, assignment/profile scope and persistence: target-workflow, profile-lifecycle | Extended |
| approval-integrity | Fixed failure leaves rejection available | Corrupt release/plan facts denied under lock without writes: approval-integrity | Extended approval controls |
| plan-requester | Author cannot approve/reject; malformed author fails closed; independent actor can decide | 403 SELF_APPROVAL_DENIED, immutable rows and denial audit: api, review-audit, approval-integrity | Extended essential authorization UX |
| plan-intent | Frozen versus current config, escaped hostile data, malformed fallback, plan/session context clearing | Stored envelope immutability, restart and corruption gate: plan-intent | Focused HTTP contract |
| plan-record | Download delivery/hash verification and late export discarded | Export content/private metadata/read-only/authorization: plan-record | Merge into execution-record UI regression |
| execution-record | Download wire format, late plan/logout exports discarded | Complete journal, checksums/private fields and no mutations: execution-record | Combined export UI regression |
| statement-envelope | Complete paging, file identities, legacy badge, stale selection/readiness | Complete ordered digest, tamper and legacy persistence: statement-envelope, execution-readiness | Extended |
| plan-resubmission | Read-only navigation clears stale source/drafts; role/archive/unbound guards | Full second Git import/approval and predecessor snapshots: plan-resubmission, protected-source-binding | Extended navigation guards; fresh Git flow is core MVP |
| protected-source-binding | Held stale denial ignored; scoped fresh-plan guidance, no-write navigation, held creation response fence | Generations, ABA, serialized update/approval, immutable predecessor: protected-source-binding | Extended essential guidance/context races |
| review-inbox | Stale scopes, exact plan navigation, revocation between pages | SQL cursor filtering/order/scoping/grant checks: review-inbox | Extended |
| reviewer-assignment | Assignment/filter controls; stale choices/write response cannot cross context | Revision, eligible actor, audited/enforced decision: reviewer-assignment | Extended |
| schema-reference | Provisional identity, omitted-service warning, project/session/revocation clearing | Exact identity, CLI authority, idempotency/locking: schema-reference | Extended |
| approval-revocation | Immutable decision display and held withdrawal response after project ABA | Immutable approval/revocation linkage and corrupted source handling: approval-revocation | Extended essential withdrawal race |
| execution-jobs | Lost-response retry reuses key; cancel invalidates old event; monotonic state/draft preservation; nonoverlapping polling and visibility/project fences; revocation clears view | Installed worker/supervisor cycles, SQL receipts/counts, NOOP/no replay: execution-service, controlled-execution, execution-jobs, installed-expiry-recovery | Focused HTTP contract and virtual clock; pure merge/window cases moved to Node unit test |
| execution-history | Independent event/receipt/request pages; migration labels; missing-receipt ambiguity; stale reads and revoked access clear cached history | Lease recovery, synthetic SQL journal creation, persistence/no replay: execution-history, phase5-execution, execution-reconciliation, execution-record | Focused HTTP contract; no SQL journal fixture |
| backup-restore | Invalid former credential login, RESTORE_HOLD banner, disabled request/no cancellation, retained event display and reload | Native backup/witness import, session revocation/history and restart: backup-restore, phase5-backup, secure-sessions, metadata-recovery | Focused recovery UI contract; native restore remains API/integration |

The API suites retain security, authorization, immutability, concurrency, HOLD,
expiry/recovery, trusted-host boundaries and no automatic DDL replay. Removal of
backend setup from Chromium does not remove those assertions. Routine screenshots
were already removed in the preceding optimization; the failure-only screenshot
and hosted failure diagnostics remain. Historical acceptance evidence is preserved.

The native restore API case now explicitly creates two real HTTPS cookie
credentials before the existing witnessed backup. After restoration it verifies
both cookies return 401, both revoked credentials/history and restore witnesses
remain, and the existing HOLD/request/cancel/no-claim assertions still pass.
The browser reconciliation case checks both developer and approver submitters
cannot independently review their own evidence, and review leaves deployment
controls disabled. These preserve critical checks formerly mixed into browser
journeys instead of assuming the backend duplicates them.

Run a HTTP-contract regression without a database using
`node --test tests/product-comments-browser.integration.mjs` (build the web
bundle first). The product runner's `--name` accepts a bounded literal fragment,
escapes regex syntax before forwarding to Node and retains one-file scoping.
This repairs the preceding head's CodeQL regex-injection finding without
changing security gates.

## Actual hosted baseline and critical path

The preceding optimization head is `32962879cb30cdd53d2a4e6b45657e84262c3ea4`.
[PRODUCT run 38360930977](https://github.com/devsecopslonghn/schemaForge/actions/runs/38360930977)
passed PRODUCT acceptance. Its separate CodeQL aggregate flagged CLI regex
construction, repaired in this change. Browser test steps were 320/288/220 seconds; browser 1/3
was the slowest at 410 seconds including preparation. The actual critical path
was API 3/4 at 567 seconds (512-second test step); release was 420 seconds.

The first optimized hosted run at `2ac637a`,
[PRODUCT run 38369582109](https://github.com/devsecopslonghn/schemaForge/actions/runs/38369582109),
passed all acceptance and CodeQL. Browser steps fell to 145/87/114 seconds
(slowest step 320 → 145, 54.7% lower); release fell from 420 to 174 seconds.
API steps were 478/590/325/411 seconds. Its slowest API job rose from 567 to
646 seconds, so this run did **not** establish an overall CI speedup.
Controlled execution rose from 71 to 173 seconds, and SQL validation from 46
to 107 seconds. The first scheduling projection was insufficient for this run.

Scheduling now uses that complete hosted run's top-level per-file TAP costs,
with nested durations included once in their parent. Those same observed costs
project to API loads 448/448/448/448 and browser loads 109/109/108 seconds after
repartitioning. These are scheduling estimates, not measured hosted improvements.
All four API and three browser shards remain, with every file selected exactly
once. No runner or timeout increase is used. Browser regressions remove native
restore, real worker cycles, repeated parsing and real 15/22-second polling waits
from cases that only need UI responses.

The PR records the final exact-head GitHub Actions comparison, including API,
browser, release and total acceptance timing. Local focused timings establish
correctness and test cost; hosted timings establish PR critical-path improvement.

## Local verification

The complete default browser gate passed all 41 tests without skips in 436.63
seconds wall time, serially against disposable local PostgreSQL where required.
Its top-level case durations sum to about 411 seconds. Local costs provided the
first browser scheduling estimate; the final scheduler uses hosted measurements.
The restored-cookie API transfer passed separately (one existing native restore
case, 35.40 seconds). Follow-up focused runs verified the approver-submitter HOLD
restriction and the final comment HTTP contracts. The scheduling/selector/window
unit tests passed all 15 cases. Two bounded contributors independently reviewed
the UI assertion transfers, surviving API safety coverage, cancellation cleanup,
strict fixture behavior and literal-name selector.

After recalibration, required `npm run check` passed in 44.01 seconds with the
prepared parser and configured fixture Java: 350 passed, zero failures, 103
existing unconfigured-database skips. Hosted acceptance configures PostgreSQL
and requires the integration cases to run. Focused partition/suite checks passed.
