# Resume SchemaForge PRODUCT delivery

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
