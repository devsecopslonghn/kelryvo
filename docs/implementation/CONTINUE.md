# Resume SchemaForge PRODUCT delivery

## T08–T10 locally delivered; T10 root review pending — 2026-10-09

T08 plan-status filters merged through PR #19 at
`577124f1b15058000fa89e5a17074992435efcd9`; T09 recent audit-action filters merged
through PR #20 at `d970375e15706d4718a2e30f8b6754f17f4e7418`. The T10 isolated
worktree started from merged master checkpoint `534c6e4024b7642bb7ece17447367d873335edc3`;
root reports PR #21's four master workflows passed. T10 is implemented and VERIFIED locally,
with exact-head review/publication pending. A local implementation commit is ready for independent review; publication remains pending.
Resolve this increment’s PR/head/merge and post-merge workflows from Git/GitHub before resuming.

PRODUCT T01–T10 are VERIFIED_LOCAL. T10 adds authenticated, project-bound local branch and
commit-resolving tag choices for release intake, capped at 200 refs with fixed fail-closed
over-limit behavior. Same-named branch/tag refs remain distinct; nested annotated tags resolve
to commits; noncommit refs are excluded. HEAD/manual refs remain, and imports use the existing
immutable importer. PostgreSQL/API/parser/product tests pass 21/21; browser regressions pass
8/8; standard checks pass 141/141. Every suite had zero skips. T10 evidence is recorded under
`evidence/product/product-t10-local-git-refs-20261009T042638Z/`.

Git Hygiene integration remains pending. Root reports the reproduced history matches are
benign synthetic/test values, with original-report comparison still open. Keep the required
source, lockfiles and immutable evidence; do not broadly allowlist findings or rewrite public
history. Any hygiene change still requires provenance classification, security review and
passing CI. T10’s publication scan also matched one recorded API-test raw-output digest;
root verified it against exact bytes without printing the match. Independent review remains
required. Sanitized metadata is in `evidence/product/product-t10-root-review-20261009T045700Z/publication-classification.json`.

The next bounded PRODUCT task is **SF-PRODUCT-T11 — Inspect retained release provenance**,
registered READY. `npm run next` selects T11. Display stored full commit/repository ID/object
format/folder/manifest digest/parser profile/import time through the current API; verify retained
reads when Git is unavailable, project switching and archived read-only access. It is a partial
GIT-006 display increment, with no schema changes, Git re-read, execution or Oracle acceptance.
T10 worktree: `/home/longhn0710/workspace/schemaforge-product-git-refs`, branch
`development/product-local-git-refs`, based on checkpoint `534c6e4024b7642bb7ece17447367d873335edc3`.

Sonar remains unavailable under the unchanged quota exception and must never be reported PASS.
Oracle VALIDATION and all 124 applicable cells remain BLOCKED independently; T10 is local
PRODUCT evidence only.

## Earlier verified merge checkpoints

T08 plan-status filters merged through PR #19 at
`577124f1b15058000fa89e5a17074992435efcd9`; T09 audit-action filters merged through PR
#20 at `d970375e15706d4718a2e30f8b6754f17f4e7418`. Each implementation head passed its
ten non-Sonar checks with independent QA, security and license approval; all four master
workflows passed on the relevant implementation merge. Immutable records remain at
`evidence/product/product-t08-merge-20261009T035130Z/` and
`evidence/product/product-t09-merge-20261009T040900Z/`.

PR #21 merged the delivery checkpoint at `534c6e4024b7642bb7ece17447367d873335edc3`;
its six captured PR/check/workflow/alert files are indexed under
`evidence/product/product-delivery-checkpoint21-merge-20261009T042700Z/`. Four post-merge
master workflows passed, and the three captured code, dependency and secret alert responses
were empty. This checkpoint is the verified T10 base.

At the last hygiene cross-check, Gitleaks 8.30.1 had four reproduced history matches: one
project UUID, two hashes verified against exact source blobs, and one malformed synthetic
UNIT PEM fixture. No credential was identified for rotation. The original redacted report
comparison remains open; see `evidence/product/product-t08-merge-20261009T035130Z/gitleaks-provenance.json`.

## SF-PRODUCT-T09 verified locally; root review pending — 2026-10-09

T08 merged through PR #19 at 577124f1b15058000fa89e5a17074992435efcd9; root reports all four post-merge workflows passed. T09 adds read-only All/action filters to the existing recent project audit timeline. Action choices come only from the selected project's scoped recent audit rows; server ordering and immutable audit data remain intact. The selected action resets on explicit project changes, sign-out, disappearance from the recent-action list, and automatic project fallback. Archived project reads remain available.

T09 local verification: 140/140 standard, 20/20 PostgreSQL/product, 7/7 browser, and focused T09 browser 1/1, all zero skips. The pinned ANTLR helper rebuilt reproducibly; it is test setup only. Evidence: evidence/product/product-t09-audit-action-filters-20261009T040052Z/record.json.

Worktree: /home/longhn0710/workspace/schemaforge-product-audit-filters, branch development/product-audit-action-filters, based on merged master 577124f1b15058000fa89e5a17074992435efcd9. T09 is VERIFIED_LOCAL; root review/commit/PR and its post-merge checkpoint remain pending. No T10 is registered. Root will inspect the next bounded catalog workflow; GIT-004 branch/tag choice is a candidate for review, not an acceptance task yet.

Git Hygiene integration remains separate. Root reports the historical pattern findings classified from exact provenance; hygiene branch/PR eligibility and its own evidence remain under root review.

Sonar remains unavailable under the unchanged owner quota exception, never PASS. Oracle VALIDATION and all applicable Oracle cells remain BLOCKED independently. T09 does not claim full SEC-011 search, pagination, retention/tamper evidence, or Oracle acceptance.

## T06/T07 merged; next PRODUCT task T08 READY — 2026-10-09

T06 persistent plan comments merged through PR #16 at
`b5c0392feda043b26138fd591acb5be5b166fe74`. T07 retained decision provenance merged
through PR #17 at `dd943508f8fabd5449f8bf05b22449be92a305fc`. Both exact PR heads
had ten passing non-Sonar checks and independent native review. All four master
workflows passed on each implementation merge, and local master was synchronized.

PRODUCT T01–T07 are VERIFIED_LOCAL. Final implementation verification: 140/140
standard, 20/20 PostgreSQL/product and 5/5 browser workflows, zero skips. T06 also ran
4/4 real parser-helper tests and the offline parser corpus; master parser/WP0 regressions
passed on both merges. Interrupted/initial test observations remain separate from PASS.

The merged local app was inspected again: reviewer ID fallback, stored decision reason
and server timestamp match retained API facts, comments remain readable, no browser
errors, PostgreSQL healthy, execution NOT_EXECUTED. It was stopped gracefully, retaining
the local PostgreSQL volume and private config. Restart using `npm run dev`.
Merge/app evidence: `evidence/product/product-t07-merge-20261009T031557Z/record.json`. This checkpoint's
own PR/head/merge and post-merge checks must be resolved from Git/GitHub; the literal
master above identifies the verified preceding implementation, not a self-reference.

`npm run next` selects **SF-PRODUCT-T08 — filter project plan reviews by decision status**
(READY, frontend, bounded GOV-021 partial). Implement All/Pending approval/Approved/Rejected
filters in a fresh task context using current scoped project data. Retain the All default,
clear another plan's unsent comment draft on selection changes, and preserve comments,
decision records and archived read access. Assignment, delegation, notifications and full
catalog inbox acceptance are excluded. Acceptance/test references are registered in the
tracker; T08 implementation remains outstanding. No unresolved defect was found in T06/T07.

The owner-selected PolyForm Shield 1.0.0 license and unchanged Sonar quota exception
remain in force; Sonar is unavailable, never PASS. Oracle acceptance and all 124 applicable
Oracle cells remain BLOCKED independently. Public naming/F31 distribution remain pending.

## Earlier checkpoints — superseded by the merged T06/T07 state above

## T07 local verification completed — 2026-10-09

SF-PRODUCT-T07 now displays retained terminal decision reviewer/name/ID, timestamp and
plain-text reason. New decisions snapshot the server-configured reviewer name; historical
NULL names use the stored actor ID. The existing approval/rejection/audit/comment and
execution behavior remains intact. Local verification passed 140/140 standard, 20/20
PostgreSQL/product and 5/5 real browser workflows, zero skips. The interrupted browser
run is retained without PASS; a fresh retry completed, and its test-owned database was
cleaned after identity/session checks. Evidence: `evidence/product/product-t07-decision-record-20261009T025416Z/record.json`.

T07 is VERIFIED_LOCAL on `development/product-decision-record`, based on merged and
master-workflow-verified T06 `b5c0392feda043b26138fd591acb5be5b166fe74`. T07 PR,
exact-head reviews, CI and merge remain pending at this snapshot; resolve from GitHub.
After eligible merge, verify master workflows and synchronize local master. Oracle
acceptance stays BLOCKED and the Sonar quota exception is unchanged.

## Earlier snapshots — superseded by T07 verification above

## T06 merged; T07 decision provenance in progress — 2026-10-09

PR #16 merged at `b5c0392feda043b26138fd591acb5be5b166fe74` after ten successful
non-Sonar checks and independent native QA/security approval at exact head
`a40b3fed6e5d86157aa19b5b6f47ec0352af0ca7`. All four master workflows passed
(PRODUCT, parser, WP0, CodeQL), and local master was synchronized. Merge evidence:
`evidence/product/product-t06-merge-20261009T024610Z/record.json`. Sonar remains unavailable under the unchanged owner quota exception.

The merged app was started and inspected with authenticated API/browser access: no
browser errors, PostgreSQL healthy, execution NOT_EXECUTED. Its terminal plan review
shows status but omits stored reviewer/time/reason detail. SF-PRODUCT-T07 now implements
that bounded provenance view under GOV-023, capturing reviewer name snapshots for new
decisions and retaining actor-ID fallback for historical records. Branch:
`development/product-decision-record`, based on the verified T06 merge above.

T07 does not certify full catalog decision audit/project transfer or Oracle runtime.
PRODUCT T01–T06 are VERIFIED_LOCAL; Oracle acceptance remains BLOCKED independently.
The inspected app was stopped; its PostgreSQL volume and private configuration remain.

## Earlier task snapshots — superseded by the merge state above

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

Read AGENTS.md, CURRENT.md and the tracker. The owner authorizes implementation,
verified branches/PRs and eligible ordinary merges. PRODUCT delivery is independent of
Oracle VALIDATION. Start new bounded increments from latest `origin/master`; inspect
existing changes and open exact-head PRs first. Do not repeatedly request an Oracle lab
or reinterpret BLOCKED acceptance as a prohibition on API/web/governance development.

The owner selected unmodified PolyForm Shield 1.0.0 on 2026-10-09. Preserve LICENSE,
NOTICE and separate third-party grants. Internal use is free; competing products/services
are restricted, including free competitors. Noncompeting paid support/consulting is not
categorically prohibited. Use source-available terminology; do not restore the Apache-2.0
proposal or treat old pending-license evidence as current instructions. Public naming
and F31 packaging/source/notice/distribution closure remain pending.
PR #14 merged at `16260b9710c9c7d23e64149772b048505aa60c3b`; all ten non-Sonar
head checks and its four master workflows passed. This license increment starts there;
resolve its own head/PR/merge from Git/GitHub.

License selection/static verification and current startup proof are under
`evidence/product/product-shield-license-20261009T021701Z/`. Local checks passed 138/138,
zero skips; API/web startup and the existing persisted demo were read-only verified.
The dev process was stopped; metadata PostgreSQL remains running. No product task,
catalog acceptance or Oracle cell advanced because of this license decision.

```sh
cd /home/longhn0710/workspace/schemaforge
git status --short
git fetch origin
gh pr list --repo devsecopslonghn/schemaForge --state open
git log -5 --oneline
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
```

PRODUCT T01–T05 are VERIFIED_LOCAL and PRs #9–#13 merged in order. The preceding
product master is `60ef83466376100424e7103057c1cf5fbb2b9095`; it contains the exact
reviewed product tree from T05 head `ac8779cb57eee31dbac3169be016bad925d08e18`.
All ten non-Sonar checks passed on each exact head, and PRODUCT/parser/WP0/CodeQL
master workflows passed. Resolve this checkpoint's own head/PR/merge from Git/GitHub.
Merge audit: `evidence/product/product-merge-20261009T010502Z-owner-quota/`.

On 2026-10-09 the owner confirmed exhausted SonarCloud free LOC quota and authorized
merging despite unavailable scans. Preserve actual CANCELLED/missing checks; never
claim Sonar PASS. While that same outage persists, use the availability exception in
AGENTS.md/github-sync.md with all other CI and independent QA/security/license review.
Preserve historical CLI annotations, resolve concrete actionable findings, and restore
normal Sonar gating when scans are available. Do not disable scanners, alter thresholds
or bypass branch protection/admin controls.

The runnable product includes persistent projects/environments, reference-only profiles,
immutable local Git imports, existing ANTLR validation and SQL display, candidate plans,
independent approval/rejection, project archival, source binding and fixed review-denial
audit. Read actual code in apps/api, apps/web, packages/database and packages/migrations.
Run `npm run local:prepare` then `npm run dev`; open http://127.0.0.1:4317. See
[local operation](../development/local-product.md) for fresh preparation and private tokens.
No dev server remains running after verification; PostgreSQL metadata stays persistent.
Never publish .cache credentials/tokens or resolve target credential references.

Latest integrated verification: 138/138 standard checks, 18/18 mandatory product cases
and 3/3 real browser workflows, zero skips. Evidence:
`evidence/product/product-t05-review-audit-20261009T001803Z-75210e75/quality-repair-1/`.
`npm run test:product` uses real PostgreSQL/Git/ANTLR; install the separate browser with
`node node_modules/playwright/cli.js install chromium`, then run `npm run test:browser`.
The persisted `SchemaForge demo 2026-10-09 00:03 UTC` survived API restart and contains
approved/rejected plans, four NOT_EXECUTED history rows and an authenticated denial audit.
Approval does not execute migrations; candidate target history remains NOT_OBSERVED.

`npm run next` selects SF-PRODUCT-T06 (GOV-020 partial): bounded persistent plain-text
comments on pending plan reviews with server actor/time. T06 is BACKLOG, unimplemented
and unverified. Reuse current organization/auth boundaries and PostgreSQL transactions;
reject terminal/archived writes, preserve comments for reads, immutable plan bytes and
NOT_EXECUTED history. Do not add attachments or claim full catalog/RBAC acceptance.
After each milestone: implement, test, independently review, PR, inspect exact-head gates,
merge when eligible, inspect the runnable product, select the next missing catalog feature.
Register bounded PRODUCT contracts/evidence without changing original acceptance criteria.

Preserve all historical failures and repairs in the evidence index. The T02 schema race
and failed-pool cleanup have real passing regression/CI evidence. T04's initial CI browser
stall remains unreproduced; test-only cleanup/diagnostics and an intentional stalled
fixture passed without changing the original timeout thresholds. A root-cause fix is not
claimed. Historical Sonar annotations remain observations, not issue-resolution evidence.

This merge checkpoint also retains its first failed push browser run in
`evidence/product/product-merge-20261009T010502Z-owner-quota/quality-repair-1/`.
Test-only lifecycle handling now closes Chromium before graceful API restart and opens
a fresh browser for the main persisted-state/UI checks. Fresh local verification passes
138/138 standard and 3/3 browser cases, zero skips, with all assertions and original
timeouts intact. Unused TCP connections can delay Fastify close in a standalone fixture;
the original CI cause is still unconfirmed. Resolve the checkpoint's own current exact
head/checks/merge from Git/GitHub; the owner waived only Sonar scan unavailability.

WP0-T01–T03 and all existing parser/driver/supervisor code and evidence stay intact.
WP0-T04 and all 124 applicable Oracle cells remain BLOCKED. The supervised read-only
candidate has no default starter, live CLI or production authority/provider backend.
Historical PR #7 merged at `5ab696918a8bafcbd36a7277e810ec6cde34e2e2`; PR #8 persisted
its checkpoint at f2b333e. Evidence:
`evidence/db-devops-wp0/t04-thin-supervision-20261008T151430Z-fc1518f5/`.

T03 retains immutable licensed grammar inputs, parser corpus and adapter. Preparation
is `npm run parser:antlr:prepare`; fresh Linux x64 uses
`SCHEMAFORGE_JAVA_HOME="$PWD/.cache/antlr/temurin"`. Builds never silently download.
No Oracle execution, credential resolution or deployment is authorized. Original feature
IDs, dependencies and acceptance remain unchanged. Product naming and F31 packaging
decisions remain pending for distribution; independent local delivery continues.
