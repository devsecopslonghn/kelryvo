# Current engineering state

## SF-PRODUCT-T06 — persistent plan comments verified locally (2026-10-09)

T06 adds authenticated developer/approver plain-text comments to pending plans, ordered
server author/time history and atomic audit references. Scoped reads retain comments after
terminal decisions and archival; invalid/oversized/unauthorized/stale writes are rejected.
Migration bytes, plan content and decision behavior remain intact; execution is NOT_EXECUTED.

Local checks: 139/139 standard, 19/19 PostgreSQL/product, 4/4 browser, 4/4 real helper
integration, zero skips; offline parser corpus passed. Browser acceptance includes both
roles, literal HTML rendered as text, plan isolation, archive/terminal read-only states and
server/database-pool restart persistence. Evidence: `evidence/product/product-t06-comments-20261009T023621Z/record.json`.

Branch: `development/product-plan-comments`, based on latest verified master
`3522000b02941f6004f6d1ef3f7c13ff83aafd07` (PR #15). T06 PR/CI/merge are pending at
this evidence snapshot; resolve exact current heads and gates from GitHub. After eligible
merge, verify all master workflows, fast-forward local master, inspect the running app and
register the next independently buildable missing PRODUCT catalog workflow.

The Sonar quota exception in AGENTS.md/github-sync.md is unchanged: unavailable is never
PASS and all other gates still apply. PolyForm Shield 1.0.0 remains selected; Oracle
runtime acceptance and all 124 applicable Oracle cells remain BLOCKED independently.

## Earlier checkpoints — superseded where T06 updates state

## Owner-selected license — 2026-10-09

The owner selected unmodified PolyForm Shield 1.0.0 for independently authored
software/current documentation. LICENSE contains the official text; NOTICE scopes the
grant and preserves third-party licenses and immutable imported research provenance.
Free internal use is permitted; competing products/services are restricted by Shield.
Noncompeting paid installation, consulting and support are not categorically prohibited.
Describe SchemaForge as source-available. This replaces the initial Apache-2.0 proposal
and closes only the owner product-license selection; public naming and F31 packaging,
source/notice assembly and distribution acceptance remain pending.

PR #14 merged at `16260b9710c9c7d23e64149772b048505aa60c3b` after all ten non-Sonar
exact-head checks passed. All four workflows on that master also passed. This license
increment starts from that validated master; resolve its own head/PR/merge from Git/GitHub.
The product remains T01–T05 VERIFIED_LOCAL; next is T06 (BACKLOG). WP0-T04 and all
124 Oracle cells remain BLOCKED; migration execution remains NOT_EXECUTED.

License/static and startup evidence:
`evidence/product/product-shield-license-20261009T021701Z/`.
Fresh local `npm run check` passed 138/138, zero skips. `npm run dev` served API health
and web assets with HTTP 200; read-only authenticated checks found the persisted demo's
two approved/rejected plans, four NOT_EXECUTED history rows and review-denial audit.
The owned dev process was stopped after verification; metadata PostgreSQL remains running.

## Current merged PRODUCT checkpoint — 2026-10-09

PRODUCT PRs #9–#13 merged ordinarily into `master` in dependency order. The resulting
product master is `60ef83466376100424e7103057c1cf5fbb2b9095`; its source tree matches
the independently reviewed T05 head `ac8779cb57eee31dbac3169be016bad925d08e18`.
All ten non-Sonar checks passed on each exact PR head. PRODUCT, parser, WP0 and CodeQL
master workflows also passed. No implementation PR in this batch remains open.

The owner confirmed exhausted SonarCloud free LOC quota and explicitly authorized these
merges. Sonar remains CANCELLED/not reported, not PASS. Preserve its historical CLI
annotations and prior failures; no scanner thresholds, branch protection or security
findings were waived or changed. Follow the availability exception in AGENTS.md and
github-sync.md while the same outage persists; restore normal Sonar gating when available.
Merge/security evidence is indexed under
`evidence/product/product-merge-20261009T010502Z-owner-quota/`.

This checkpoint's first push PRODUCT job failed its 120-second browser case while its
PR job passed. The raw failure is preserved in `quality-repair-1/` under that merge run.
Browser tests now close their original Chromium client before graceful API restart;
the main flow then uses a fresh browser against the same PostgreSQL data. All assertions
and timeout thresholds remain unchanged. Fresh local checks pass 138/138 and browser
flows 3/3, zero skips. A standalone unused TCP connection reproduced delayed Fastify
close, but the original CI stall's exact cause remains unconfirmed. Inspect this
checkpoint's own fresh exact-head CI before merge; no non-Sonar failure is exempted.

SF-PRODUCT-T01–T05 are VERIFIED_LOCAL: a runnable PostgreSQL/API/web product with
projects, environments, reference-only profiles, immutable Git/parser imports, source
binding, candidate plans, approval/rejection, archival and review-denial audit.
Integrated verification passed 138/138 standard, 18/18 product and 3/3 browser tests,
zero skips. The persisted demo survived restart; approval never executes migrations.
All migration history remains NOT_EXECUTED and target history NOT_OBSERVED.

Run `npm run local:prepare` then `npm run dev`; open http://127.0.0.1:4317.
See [local operation](../development/local-product.md) for private local tokens and
fresh-checkout preparation. The dev process was stopped after verification.
Resolve this checkpoint's own head/PR/merge from Git/GitHub; the literal master above
identifies the validated preceding product merge, not a self-referential checkpoint hash.

Next: SF-PRODUCT-T06 (BACKLOG), bounded persistent plain-text comments on pending
plan reviews. Independent PRODUCT delivery continues from latest master. WP0-T04 and
all 124 Oracle cells remain BLOCKED; original feature acceptance is unchanged.
Product naming and F31 distribution decisions remain pending; the license selection
above supersedes this snapshot's earlier pending-license statements.

## Historical delivery snapshots — superseded by the checkpoint above

The following entries preserve prior observations. Their open-PR, pre-merge master and
Sonar scheduling statements describe earlier snapshots, not current instructions.

Owner clarification (2026-10-08): ship a runnable PRODUCT first; Oracle VALIDATION remains
separate. Development scheduling uses the explicit PRODUCT/VALIDATION overlay. Original
acceptance dependencies, the 220 feature IDs, T01–T03 verification and every WP0 artifact
remain unchanged. The owner has no Oracle 19c/21c lab; do not request one as a prerequisite
to independent product work.

The runnable local product slice began with SF-PRODUCT-T01: Fastify/TypeScript API, React web app,
PostgreSQL persistent projects/environments and reference-only profiles, immutable local
Git import, existing ANTLR offline parsing, candidate plans, independent approval/rejection,
transactional audit and NOT_EXECUTED history. It has no target connector or executor.
Local auth uses named server-configured bearer identities and loopback serving; it does not
claim production RBAC, TLS or multi-tenancy. Target history stays NOT_OBSERVED.

Run `npm ci --ignore-scripts --no-audit --no-fund`, `npm run local:prepare`, then `npm run dev`.
Open http://127.0.0.1:4317 and use the private local tokens documented in
[local product operation](../development/local-product.md). Track implementation and local
verification separately from full catalog/Oracle acceptance. Current PR/head/merge are
resolved from Git/GitHub; never record a self-referential commit hash.

Local T01 acceptance is VERIFIED with real PostgreSQL/Git/parser/browser evidence in
`evidence/product/product-t01-20261008T163522Z-87ad39d8/`. Initial failures and corrections are retained. PR #9 currently has ten successful
exact-head checks, including CodeQL and real product CI; Sonar analysis is cancelled with
zero source annotations. The public Sonar component/task APIs and GitHub suite rerequest
return 404, so no scanner failure detail or passing quality result is available. Keep PR #9
unmerged until Sonar passes; preserve this failure separately from local acceptance. Full catalog features and Oracle cases are not verified.

SF-PRODUCT-T02 implements project archival with preserved releases/audit/history and
transactional rejection of stale writes. SF-PRODUCT-T03 follows with operator-supplied
local Git repositories, using the existing importer rather than a new provider backend.
Select further bounded product tasks from the existing catalog. WP0-T04 and all 124 Oracle
cells remain BLOCKED; preserve Oracle safety boundaries without blocking API/web work.
Product license/name and F31 distribution remain unresolved; local delivery is authorized.

T02 local acceptance is VERIFIED with 127 standard tests passing (three dedicated-DB
cases skip there), 10 PostgreSQL/API/importer cases passing, and both real browser
workflows passing. Evidence and the initial missing-JDK failure are preserved under
`evidence/product/product-t02-20261008T172809Z-local*`. This does not certify PR merge
readiness or catalog/Oracle acceptance. After T03, select the next bounded missing PRODUCT behavior from the catalog.

T03 local acceptance is VERIFIED: operator-owned local Git startup options validate
before any database/container setup, expose IDs/names only, and reuse immutable Git
import/ANTLR parsing. Verification passed 130 standard tests (four dedicated-DB cases
run separately), 14 product/startup/Git/API cases and both browser workflows. Evidence:
`evidence/product/product-t03-20261008T173420Z-local/`. No provider credentials or
Oracle execution are introduced. All three local PRODUCT milestones have implementation
and local acceptance evidence; remote merge eligibility remains separate.

SF-PRODUCT-T04 source binding is VERIFIED locally in `development/product-source-binding`.
PRs #9/#10/#11/#12 remain unmerged; inspect current exact heads and gates. The primary
checkout uses `development/product-delivery-checkpoint` for the runnable local prototype,
which is advanced to the reviewed runnable PRODUCT lineage. Master remains the WP0 checkpoint until eligible merges.
One PR #10 product push run hit a concurrent schema-creation race and leaked its failed
setup pool. Advisory locking and failed-pool cleanup repair it; the fresh concurrent
initialization regression, 131 standard tests, 11 product cases and both browser flows
pass, as do the repaired exact-head push/PR product jobs. Preserve the cancelled original
run and quality-repair-2 evidence. Sonar remains cancelled; PR #11 retains CLI path/argument
annotations after defensive hardening, so no remote issue-resolution claim is made.

The previous master checkpoint was PR #8 at f2b333e. The following WP0 snapshot is retained
as historical evidence; its scheduling-only API/UI prohibition is superseded by the owner
clarification and SF-D008. Its Oracle acceptance restrictions remain current.

## Historical WP0 checkpoint


Foundation and the bounded WP0-T01, T02 and T03 offline increments are VERIFIED.
WP0-T04 has offline probe preparation, a read-only Thin candidate and child-process supervision;
it remains BLOCKED for runtime acceptance.
The milestone is offline WP0 feasibility; no Oracle execution, API/UI or product feature is verified.

**Latest implementation:** `development/wp0-thin-supervision` adds actual child-process
supervision around the existing read-only probe. PR #6 checkpoint is merged at
`6aa97d8db47fb3978fa11b0e59c09c1e9ad538b2`; its three master workflows passed.
The new supervisor/worker protocol uses child-owned privileged ports, a bounded total
deadline, strict result validation, TERM/KILL and confirmed reaping. Malformed output,
crashes and timeouts return HOLD with unknown connection/read counts and required cleanup.
An unreaped child remains owned by a referenced reaper; replacement probes are refused.
The same-UID child is not an OS sandbox; native IPC parsing has no transport memory cap.
The trusted starter has no default implementation or public path/environment selection.
No authority or provider backend is added. PR #7 merged at
`5ab696918a8bafcbd36a7277e810ec6cde34e2e2` after all nine exact-head checks passed;
reviewed head is `ef8a2ec4f161abf84631769754d0afd1a924ab50`. Independent QA/security
approve that head; code/secret/dependency alerts and blocking review threads are empty.
Final SonarCloud has zero new/accepted issues, hotspots and duplication. No implementation
PR remains open. This postmerge checkpoint uses `development/wp0-supervisor-checkpoint`;
resolve its own PR/head/merge and current master from Git/GitHub. Evidence is under
`evidence/db-devops-wp0/t04-thin-supervision-20261008T151430Z-fc1518f5/`.

PR #1 merged at `42249826d105d44dbf5d6243f9ebe3748612e1c7`. PR #2 merged after
independent QA/security review, empty code/secret/dependency alerts and all nine exact-head
checks passed, including SonarCloud and CodeQL. Its reviewed head was
`97432efde71ed16ad47d3995731625334000d059`; synchronized master was
`ca232a5a4f4535bb4e6d14954bdba9b5a8ffa9b6`. Initial Sonar failure and subsequent repairs
are retained as append-only evidence. No quality gate was bypassed.

PR #3 merged after independent review and all nine exact-head checks passed. Its reviewed
head is `4299b4d0ce770d0d961a39046ec997bb05cc1446`; synchronized master before this
checkpoint is `87d41da43886306a3a996aa458ced27130de130f`. Its initial SonarCloud duplication
failure was fixed without changing the threshold; the final scan has zero issues, hotspots
and new-code duplication. No implementation PR remains open at this checkpoint.

PR #4 checkpoint merged at `01ff4446e0318d4b7f91a003cf15799ab3b7be11`; its three master
workflows completed successfully. That checkpoint used
`development/wp0-thin-checkpoint`. PR #5 merged at
`de86263e8a8c5faae8af8b18197fe03a7cbf138e` after all nine exact-head gates passed;
its reviewed head is `fe63aebcc911c1b0de89659be253ea0f186ae277`. Final SonarCloud has
zero new/accepted issues, hotspots and duplication; CodeQL has no new alerts. The two
initial CodeQL review threads automatically resolved after repair. Independent QA/security
approved that exact head; code/secret/dependency alert lists are empty. No implementation
PR remains open. Resolve the checkpoint's own PR/merge and current master from Git/GitHub;
literal hashes name the preceding validated implementation master. Earlier read-only evidence is under
`evidence/db-devops-wp0/t04-thin-readonly-20261008T143528Z-0b734360/`.
That earlier continuation record is `session-checkpoint.json` in that directory; the
current supervision run uses `postmerge-checkpoint.json`.

T03 uses unchanged licensed grammars-v4 PL/SQL sources at
`7df52be94698550d219d299d04105c6bafadd9c3`, ANTLR 4.13.2 and reviewed authored callbacks.
No custom grammar/splitter or headerless upstream support class is included. Exact pins
and prior source exposure are recorded in [provenance](../dependencies/antlr-provenance.md)
and [lock](../dependencies/antlr-parser-lock.json). The byte adapter preserves comments,
UTF-8 and LF/CRLF delimiters, rejects SQL*Plus commands and uncovered source bytes, and
checks bounded helper output without logging SQL. Whole-release prevalidation snapshots
all files and stops the release if a later file fails, without partial execution approval.

The original corpus passes all 31 files across 14 groups/30 variants; four real-helper
integration tests pass. Two isolated builds reproduce helper SHA-256
`a8aa930fd0a17aee5d74a5d65dc91bcc7e166fca99ac6aca4a4d8bc995351f38`.
Generator/runtime/JDK remain separate; source drift stops before compilation and a
mismatched build preserves the installed reviewed artifact. T03 evidence is under
`evidence/db-devops-wp0/t03-antlr-20261008T130643Z-98b033db/` and its quality repair under
`evidence/db-devops-wp0/pr2-quality-20261008T133102Z-1646ac2e/`.
The old Flyway corpus still exposes its 11 documented mismatches; historical evidence
and all 43 immutable inputs remain preserved.

**T04 offline implementation:** `prepareThinProbePlan(profile)` always runs the existing
preflight. It produces twelve frozen descriptors for the six connectivity/fault/security
cases across Oracle 19c and 21c, with a pinned canonical acceptance projection. Caller
report-shaped objects cannot supply a successful preflight result. No input endpoints,
credential references or submitted blocker text enter the plan. The CLI caps JSON input
at 1 MiB and emits fixed errors. Run `npm run probes:thin:plan -- [--profile PATH]`.
Exit 0 means a plan was prepared from valid offline inputs; it grants no runtime authority.
Exit 1 means missing prerequisites; exit 2 means rejected inputs or a command error.
Every descriptor remains NOT_RUN/BLOCKED and non-executable, with false authority flags.
This component remains plan-only; it does not invoke the separate Thin candidate.

**T04 read-only candidate:** `createReadOnlyThinProbe(ports)(request)` implements one
strict TCPS connection, one fixed session-identity SELECT and close. It requires trusted
admission, atomic single-use dispatch claim and scoped credential/trust provider ports;
none of these privileged backends or a runnable CLI are supplied. It snapshots bound
grants, pins exact server version and credential revision, checks the approved mTLS
wallet/CA hashes against native TLS context construction, and stops on identity mismatch,
stale authority or unsafe debugger/TLS environment. Read/cleanup errors remain HOLD;
there is no migration SQL, pooling, fallback or retry. Every result keeps acceptance
NOT_EVALUATED/runtime BLOCKED. Identity labels do not establish canonical container identity.

Twenty-one new UNIT tests use fake positive connectors, actual offline TLS contexts and
ephemeral test keys removed from private temporary directories. The real default-driver
test stops at denied admission. No Oracle connection or handshake was performed.
Independent QA/security approve this bounded candidate. Live wiring still requires an
authenticated authority/atomic claim backend, approved client wallet and trust providers,
authorized labs, independent observations and deployed worker isolation. Driver phase and
round-trip timeouts alone do not supply the new supervisor's total provider/call/cleanup watchdog.

**Earlier local evidence:** 72 tests and dependency smoke pass. Independent QA passes
16 focused T01/T04/CLI tests plus ad hoc malformed UTF-8 and argument checks; independent
security approves the input/provenance/redaction boundary. T04 evidence and PR2 merge
records are under `evidence/db-devops-wp0/t04-offline-plan-20261008T134759Z-2e424822/`.
These new records claim no full T04 criterion or Oracle case coverage.

**Earlier read-only evidence:** 93 tests and dependency smoke pass. Independent focused
QA/security each pass 21/21. T04 read-only source hashes, raw checks, review corrections
and limitations are recorded in its read-only evidence run. Initial CodeQL/Sonar failures
for a PEM backtracking regex and fixed UNIT canary are preserved; bounded literal PEM
marker scanning and a generated per-process canary replace them. No full T04 criterion or case
coverage was added; existing parser unit cells and all Oracle cells retain their statuses.

**Current local evidence:** 115 tests and dependency smoke pass; independent QA passes
22/22 supervisor tests. Security approves after both concrete findings were repaired,
without claiming a completed independent test capture. Source hashes, raw full checks,
initial formatting failure and review limitations are preserved in the supervision run.
The initial Sonar reliability failure for a UNIT environment sort was fixed by checking
the exact allowed values directly. Repaired full checks pass 115/115; original gate output
and source-specific repair hashes are retained without changing any threshold.
All nine remote exact-head gates and independent final-head reviews passed before merge.

Thirteen parser unit cells PASS; opaque PL/SQL atomicity `WP0-03-13` unit remains NOT_RUN.
All **124 applicable Oracle cells remain BLOCKED**. No Oracle connection or actual
credential-reference resolution occurred; positive UNIT paths use fake providers only.
No deployment or infrastructure change occurred. No actual authorized disposable 19c/21c
manifest was supplied. Runtime probes also require scoped identities/grants/fault/teardown
permission and approved trust material with peer/target verification. CA digest and
identity labels alone do not establish this behavior. An example or hostname is not authority.

Product license/name and full F31 distribution closure remain pending. Apache-2.0 is
proposed. The reviewed Apache grammar/BSD grants cover the offline candidate boundary;
product distribution still needs its owner decision and final source/notice/artifact closure.
**Historical scheduling snapshot (superseded by PRODUCT scheduling above):**

Work: four VERIFIED, one BLOCKED, 60 BACKLOG. Features: 213 BACKLOG, seven DEFERRED,
zero VERIFIED. `npm run next` returns no fully unblocked task.

Next: inspect the checkpoint's own PR/master workflow state. The read-only next-work
audit found no additional substantive offline T04 increment under existing specified
interfaces. Supply lab/trust/provider authority, deployed isolation and independent
observations before connecting the candidate, then
complete the remaining fault/rotation harness and real T04 acceptance. T05 and
later tasks depend on T04; WP1/API/UI cannot bypass WP0-T12. Follow
[CONTINUE.md](CONTINUE.md) and the existing graph; do not create a replacement roadmap.

## Historical PRODUCT delivery (continued)

SF-PRODUCT-T04 local acceptance passed 137/137 standard checks, 17/17 mandatory
product cases and both browser workflows with zero skips. Evidence: `evidence/product/product-t04-source-binding-20261008T235123Z-37c7ae9c-retry1`.
The initial integrated lock-observation failure is retained in the preceding run. Test
workflows now own separate temporary PostgreSQL databases; each restart retains its own
data until teardown. The UI explicitly refreshes when the selected project is clicked again
and ignores stale mutation responses after sign-out. Original Oracle/catalog acceptance
is unchanged. SF-PRODUCT-T05 follows with authenticated review-denial audit (GOV-023/SEC-011);
its current local acceptance is recorded below.

PR #12 is open for T04 source binding. Its initial UI quality warnings were repaired
without changing behavior, tests or thresholds; the two inherited CLI security annotations
still require a real passing analysis or concrete diagnostics. The primary product checkout
includes the reviewed local lineage and a persisted `SchemaForge demo 2026-10-09 00:03 UTC`.
The actual API demo and restart proof are indexed under product-t04-primary-live-demo.

SF-PRODUCT-T05 is VERIFIED locally in `development/product-review-audit`
(`/home/longhn0710/workspace/schemaforge-product-review-audit`). Role, author and
terminal-state decision denials persist fixed audit reasons with server actor/resource
metadata, while plans/history remain unchanged. Malformed, unauthenticated, missing-plan
and archived-project requests append no denial event. The web displays the fixed denial
reason. The implementation reuses existing auth, PostgreSQL transactions and audit tables.
Verification passed 138/138 standard tests, 18/18 mandatory product cases and 3/3 real
browser workflows, with zero skips. Evidence: `evidence/product/product-t05-review-audit-20261009T001803Z-75210e75/`.
Initial focused-trial failures are explicitly reported as native implementer observations;
their raw logs were not retained and are not used as verification evidence.
Resolve this increment's own PR/head/gates from Git/GitHub; predecessor PRs #9–#12 remain
unmerged. The primary checkout advances to the verified local lineage independently of
remote merge eligibility. Next PRODUCT task is SF-PRODUCT-T06: persistent plain-text
comments on pending plan reviews (GOV-020 partial increment); it is BACKLOG, unimplemented,
and cannot certify full catalog acceptance. All 124 Oracle cells remain BLOCKED.

PR #13 is open for the T05 review-denial increment; current exact head/CI/merge remain
derived from Git/GitHub. PRs #9–#13 are unmerged. The primary runnable checkout was
started and its persisted demo produced an authenticated role denial with fixed audit
facts while every plan/history row stayed unchanged. The dev process was stopped after
verification; run `npm run dev` to open it again. PostgreSQL metadata remains persistent.


PR #12 head 796b4cd had a cancelled push product run after its main browser case
timed out at 120 seconds; the original CI log is preserved in quality-repair-2. The
CI-only stall was not reproduced locally. Test-only abort cleanup, bounded route fetch
and phase diagnostics now pass both browser flows with CI=true; an intentional stalled
throwaway fixture exits with its expected timeout and drops its owned database. Original
120-second test and 15-minute workflow thresholds/assertions remain unchanged. This
local repair is not a confirmed root-cause fix or remote quality-gate pass: inspect the
fresh exact-head CI before merging.

The T04 browser cleanup parent was merged ordinarily into T05, preserving all evidence
records. Integrated verification with CI=true passed 138/138 standard tests, 18/18 product
cases and 3/3 browser workflows, zero skips, in T05 quality-repair-1. Fresh T04 exact-head
product jobs pass; the original timeout remains preserved and its root cause unconfirmed.
Inspect Sonar and every fresh exact-head gate before any merge; predecessor Sonar
cancellations still prevent an eligible product merge. Next remains SF-PRODUCT-T06.
