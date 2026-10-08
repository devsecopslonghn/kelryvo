# Resume SchemaForge PRODUCT delivery

Read AGENTS.md, CURRENT.md and the tracker. The owner authorizes implementation, verified
branches/PRs and eligible ordinary merges. Start from the latest `origin/master`; inspect
existing changes/open PRs/exact heads and preserve all WP0 history. PRODUCT delivery is
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

The current vertical slice is SF-PRODUCT-T01. Read the actual implementation in apps/api,
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

T04 and all 124 Oracle cells remain BLOCKED. Production authority/providers, target history,
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
