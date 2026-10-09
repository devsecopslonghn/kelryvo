# Resume SchemaForge PRODUCT delivery

Read AGENTS.md, CURRENT.md and the tracker. The owner authorizes implementation, verified
branches/PRs and eligible ordinary merges. Inspect the latest `origin/master`, existing
changes and open PR exact heads first. Resume the unmerged PRODUCT branch lineage when it
contains newer reviewed work; do not discard it or restart from the old WP0-only master.
Start independent new milestones from the latest eligible parent and preserve all WP0 history. PRODUCT delivery is
independent of Oracle VALIDATION. Do not repeatedly ask for a 19c/21c lab or reinterpret
BLOCKED Oracle acceptance as a prohibition on API/web/governance development.

```sh
cd /home/longhn0710/workspace/schemaforge
git status --short
git fetch origin
gh pr list --repo devsecopslonghn/schemaForge --state open
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
```

The runnable vertical slice began with SF-PRODUCT-T01 and includes locally verified
T02 archival and T03 operator-owned Git imports. Read the actual implementation in apps/api,
apps/web, packages/database and packages/migrations, and [local operation](../development/local-product.md).
Run `npm run local:prepare` then `npm run dev` for the local PostgreSQL/API/web demonstration.
`npm run test:product` exercises PostgreSQL/API and actual Git/ANTLR; install the separate
browser with `node node_modules/playwright/cli.js install chromium`, then `npm run test:browser` for the full flow.
Private generated metadata credentials and two bearer tokens live only under .cache.
Never publish them or resolve target credential references. No Oracle connection is needed.

After each milestone: implement, test, independently review, PR, inspect all exact-head
CI/security/license/quality gates, merge only if eligible, inspect the runnable product,
then choose another missing catalog feature. Local T01 acceptance is VERIFIED with real PostgreSQL/Git/parser/browser evidence in
`evidence/product/product-t01-20261008T163522Z-87ad39d8/`. Initial failures and corrections are retained. PR #9 currently has ten passing checks
and a cancelled Sonar analysis with zero source annotations. Public Sonar task/component
APIs and GitHub suite rerequest returned 404. Inspect the real scanner error or a fresh
passing analysis before merging; never treat cancellation as success. Full catalog features and Oracle cases are not verified.

SF-PRODUCT-T02 is the archival increment in `development/product-archive`
(`/home/longhn0710/workspace/schemaforge-product-archive`); it keeps all records readable
and rejects new/stale writes under PostgreSQL locks. SF-PRODUCT-T03 implements operator
local Git bindings in `development/product-local-repositories`
(`/home/longhn0710/workspace/schemaforge-product-repositories`). Complete each branch
against the current parent, run its actual tests and inspect its own exact-head gates. Add later explicit SF-PRODUCT contracts with product dependencies and evidence;
keep original catalog acceptance/dependencies exact. Local task verification cannot certify
full catalog features or Oracle cells. Pending plans are offline candidates with
NOT_OBSERVED target history. Approval never fabricates successful execution; all migration
history remains NOT_EXECUTED until real authorized execution is supported and evidenced.

WP0-T04 and all 124 Oracle cells remain BLOCKED. Production authority/providers, target history,
worker isolation and real acceptance are VALIDATION work. Product license/name and F31
packaging decisions remain pending for distribution. Preserve them while progressing local
product work. Resolve the current milestone's own head/PR/merge from Git/GitHub and inspect
fresh evidence rather than hardcoding the checkpoint's own hash.

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

The latest completed local increment is SF-PRODUCT-T04 in `development/product-source-binding`
(`/home/longhn0710/workspace/schemaforge-product-binding`): project repository/folder
binding with pre-import enforcement. Local acceptance is VERIFIED with real API/browser evidence. PRs #9, #10, #11 and #12 contain the PRODUCT
lineage and must merge in that order only after each exact head is eligible. The local
`development/product-delivery-checkpoint` checkout in the primary directory holds the
runnable prototype; resolve its current commit and open PRs from Git/GitHub.

A PR #10 push CI run exposed concurrent schema initialization (PostgreSQL catalog
duplicate type) and a connection-pool leak on setup failure; it reached the workflow
time limit. The advisory-lock/pool-cleanup repair is implemented in PR #10 and carried
into PR #11, with 131 standard tests, 11 product cases and both browser workflows
passing. Fresh exact-head push/PR product CI also passes. Preserve the original failure
and `product-t02-20261008T172809Z-local-retry1/quality-repair-2/` evidence.
PR #11 Sonar still reports CLI argument/path findings after defensive hardening; do not
claim them resolved without the real passing analysis or richer rule diagnostics.

## Preserved WP0 evidence

PR #7 implements the supervised read-only Thin candidate (merged at
5ab696918a8bafcbd36a7277e810ec6cde34e2e2, reviewed head
ef8a2ec4f161abf84631769754d0afd1a924ab50). PR #8 persisted its checkpoint at
f2b333e. Historical evidence is under
`evidence/db-devops-wp0/t04-thin-supervision-20261008T151430Z-fc1518f5/`, including
`postmerge-checkpoint.json` and `next-work-boundary.json`. That audit bounded further
T04 offline work under its then-current interfaces; it does not block independent PRODUCT.

T03 retains exact external inputs, immutable grammars, parser corpus and licensed adapter.
Preparation is `npm run parser:antlr:prepare`; fresh Linux x64 sets
`SCHEMAFORGE_JAVA_HOME="$PWD/.cache/antlr/temurin"`. Build/corpus/integration never
silently download or reclassify failed CI. T04 retains its plan, read-only candidate and
supervisor with no default starter, live CLI or production authority backend. Every
Oracle acceptance restriction remains in AGENTS.md and the immutable acceptance records.
See CURRENT.md and the evidence index for prior PRs and exact source/result records.

SF-PRODUCT-T04 local acceptance passed 137/137 standard checks, 17/17 mandatory
product cases and both browser workflows with zero skips. Evidence: `evidence/product/product-t04-source-binding-20261008T235123Z-37c7ae9c-retry1`.
The initial integrated lock-observation failure is retained in the preceding run. Test
workflows now own separate temporary PostgreSQL databases; each restart retains its own
data until teardown. The UI explicitly refreshes when the selected project is clicked again
and ignores stale mutation responses after sign-out. Original Oracle/catalog acceptance
is unchanged. Next queued PRODUCT task is SF-PRODUCT-T05 (GOV-023/SEC-011): authenticated
review-denial audit. Complete its bounded implementation/tests without waiting for Oracle.

PR #12 contains T04 source binding. Sonar UI warnings were repaired with the same two
passing browser workflows; two inherited CLI security annotations remain unresolved.
Inspect current check details and all exact-head gates; do not waive, mark false-positive
or merge around them. The primary checkout includes the tested PRODUCT lineage and
persisted demo `SchemaForge demo 2026-10-09 00:03 UTC`; private tokens remain under .cache.
The latest local demo survived an actual API restart and contains approved/rejected plans
and four NOT_EXECUTED history rows. See the indexed primary-live-demo evidence.
