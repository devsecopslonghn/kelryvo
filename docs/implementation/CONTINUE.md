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
`evidence/product/product-t01-20261008T163522Z-87ad39d8/`. Initial failures and corrections are retained; remote exact-head CI/merge
remain to be resolved from Git/GitHub. Full catalog features and Oracle cases are not verified.

SF-PRODUCT-T02 is the next bounded archival
increment. Add later explicit SF-PRODUCT contracts with product dependencies and evidence;
keep original catalog acceptance/dependencies exact. Local task verification cannot certify
full catalog features or Oracle cells. Pending plans are offline candidates with
NOT_OBSERVED target history. Approval never fabricates successful execution; all migration
history remains NOT_EXECUTED until real authorized execution is supported and evidenced.

T04 and all 124 Oracle cells remain BLOCKED. Production authority/providers, target history,
worker isolation and real acceptance are VALIDATION work. Product license/name and F31
packaging decisions remain pending for distribution. Preserve them while progressing local
product work. Resolve the current milestone's own head/PR/merge from Git/GitHub and inspect
fresh evidence rather than hardcoding the checkpoint's own hash.

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
