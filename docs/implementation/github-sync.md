# GitHub synchronization

The owner authorized development branches, commits, ordinary pushes, PR creation, independent
review, draft readiness and eligible automatic PR merges on 2026-10-08.
`origin` is `https://github.com/devsecopslonghn/schemaForge.git`; its default branch is
`master`. The original local foundation `e817a4b65eb07c2c84d810509c912046f09a233c` and
independent remote README `b2b2b9c10eae24243ae42aef8d94ac00aed6c2f9` are preserved
as parents of the initial reconciliation. The original local `main` remains intact.

Before publication, inspect history and changed tracked files for secrets, private lab
configuration, confidential imports and restricted source. The foundation review found
no such content. Authored research, public upstream references and synthetic `.invalid`
fixtures are included. Local developer paths in provenance identify the source of the
immutable snapshot; they contain no enterprise infrastructure or credential material.
The owner selected PolyForm Shield 1.0.0 on 2026-10-09 for independently authored
SchemaForge code/documentation. Preserve LICENSE/NOTICE and independent third-party
grants; naming and full F31 packaging/distribution clearance remain separate.

For each verified milestone, run relevant checks, review the diff, scan tracked content,
update implementation state, commit, push, then compare the remote branch SHA. Use a
feature branch and reviewable pull request for substantial changes. Independently review
the exact head, run relevant tests, inspect dependencies/licenses and scan publication content
for secrets. Check remote required CI, CodeQL/security findings, unresolved blocking reviews,
mergeability and whether the base is current before marking a draft ready or merging.
All required checks must pass; never suppress or reclassify a required failing check.
Use the actual branch/ruleset and check configuration to distinguish required checks from
optional GitHub capabilities. A branch response explicitly reporting protection disabled
and zero required contexts is evidence of that configuration; a paid-feature API error
alone is not. Disabled code/secret scanning is UNAVAILABLE, never PASS, and does not
create an unconfigured required check. Retain independent security review, scoped secret
scans and license checks. An enabled required check or actual blocking finding still
blocks integration even when its API is inaccessible. Use ordinary merges only.
The owner's 2026-10-09 Sonar availability exception applies while the confirmed free LOC
quota outage prevents scanning: retain CANCELLED/missing results as unavailable, require
all other CI and independent security/QA review, and use ordinary merges. A passing Sonar
result is not claimed. Preserve concrete annotations and resolve actionable findings;
do not change scanner thresholds, disable analysis or bypass branch protection. Resume
normal Sonar gating when scans are available.
Documented negative research/candidate evidence can coexist with a verified bounded task;
it does not establish product or Oracle acceptance. Prefer merge commits to preserve
reviewed source SHAs; squash is also authorized for a coherent increment. Recheck the head
before merge, synchronize local master with a fast-forward, then continue eligible work.
Never force-push, force-merge, bypass protection, reset remote history, delete remote
branches or modify another repository. Continue independent offline work when Oracle
authorization or credentials are missing; runtime acceptance stays blocked.

## Local CI integration gates

Push workflows run on `master`; feature candidates run through `pull_request` (and
manual `workflow_dispatch`), avoiding duplicate push/PR acceptance. Require the exact
candidate's foundation, parser and product checks before ordinary merge, followed by
all three workflows on the resulting master. Do not require intentionally removed
feature-push duplicates. Recheck actual protection and blocking findings at merge;
this trigger change does not waive a configured required check.

PRODUCT runs the complete PostgreSQL/API/security, browser and fresh-source installation
suites in parallel on separate runners and disposable PostgreSQL services. All run on
every PR and master integration; no test list or skip policy changes. The stable `product`
aggregate requires every matrix suite to succeed, including on failure or cancellation.
API files run on four complementary shards and browser files on three, with files still
serial inside each shard. Both suites use deterministic partitions weighted by observed
file durations in `scripts/product-test-shards.mjs`. Each partition retains the full input
list exactly once across all shards and keeps its original order within each shard. New
unmeasured files receive a fixed estimate of 30 seconds and remain included. Estimates
affect placement only; refresh them from actual complete CI observations when useful,
without changing tests, assertions or timeouts.

For measured master run 38158157839 (acceptance jobs 114525305349, 114525305616,
114525305541 and 114525305594), the old two-shard API test steps took 593s and 865s, and
browser test steps took 281s and 542s. Greedy weighted scheduling predicts 346s API and 278s
browser test time with the new shard counts. Allowing roughly 60–100s for runner
setup/build gives an estimate near 406–446s (about 7–8 minutes), compared with
the observed 865s slowest old test step. This is an estimate from one run; three added runners may increase queue
delay and runner-minute use. All API, browser and release suites remain required, and the
aggregate check still fails closed.
Every shard has its own database; never run shards against
the same database because fixtures reset shared metadata. Local commands run the full
lists by default; `SCHEMAFORGE_TEST_SHARD=1/N` selects one shard explicitly. Compare
the combined shard test counts to the baseline to verify complete coverage.
The release suite still performs fresh npm installation, parser/web builds, HTTPS and
controlled UNIT-host/history acceptance inside the extracted source bundle. Its outer
checkout does not duplicate those builds. Browser acceptance remains mandatory.
After the full build, CI invokes the browser launcher directly to avoid rebuilding
the same web output. The developer-facing `npm run test:browser` retains its build.

Node setup caches only npm's downloaded package content, keyed by the committed lockfile;
`npm ci --ignore-scripts` still installs exact dependencies. Do not cache `node_modules`,
product state, credentials, installed JDKs or built parser helpers. Parser preparation
and pinned reproducible builds retain their existing verification. Parallelism reduces
wall time, not summed runner time; compare measured timings and complete test counts.
