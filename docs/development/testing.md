# Kelryvo test feedback

## Local and CI tiers

Run `npm run check:fast` for source syntax/format, TypeScript, web build, tracker,
the complete `tests/*.test.mjs` command, dependency smoke and license closure.
`npm run check` uses the same gates. The source scan runs once rather than twice.
The offline command does not provision PostgreSQL or connect to Oracle. Database
cases skip without a test database; parser-dependent cases also skip in a fresh
checkout until the pinned helper is prepared. When the helper is installed, set
`SCHEMAFORGE_JAVA_HOME` to the prepared JDK as documented in [offline build](offline-build.md).

See the [browser strategy and complete assertion audit](browser-testing.md) for
the current three real-stack smoke flows, complementary focused UI regressions,
and the subsequent hosted baseline. `test:browser` and CI still run both tiers.

The foundation CI job supplies fast feedback and retains `dependencies:offline`.
Deeper acceptance retains all four API shards, three browser shards, extracted
release acceptance and the fail-closed `product` aggregate on PRs and master.
Every shard owns a disposable PostgreSQL database and runs its files serially.
Only the repeated source/type checks in those seven shards move to foundation;
each still builds its own web bundle and reproducible pinned parser. Parser,
container, CodeQL and publication gates retain their existing behavior and names.
Release acceptance remains a PR gate; making it master-only would change the
existing safety gate and requires a separate authorized decision.

## Run one failure

Use the same disposable test database/JDK environment as the failing shard.
Clear `SCHEMAFORGE_TEST_SHARD` when selecting a file. Listing and invalid file or
shard validation happen before resource provisioning.

```sh
node scripts/test-product.mjs --browser --list
node scripts/test-product.mjs --list
npm run test:product -- --file product-api.test.mjs
node scripts/test-product.mjs --browser --file product-comments-browser.integration.mjs
node scripts/test-product.mjs --browser --file product-browser.integration.mjs --name 'committed source-binding'
node --test --test-name-pattern='whole deadline.*child hanging at read' tests/thin-probe-supervisor.test.mjs
```

`--file` accepts a listed basename or repository path. `--name` takes a literal
name fragment (regex characters are escaped) and requires one file; Node can exit successfully when a pattern
matches no tests, so check the TAP test count/name. Product runs print suite,
file count, shard and a focused rerun hint. Comment fixtures now report the
failed setup operation/status rather than a later undefined plan ID. The
source-binding browser case emits committed-write/delivery diagnostics, retains
failure-only screenshots and bounds route cleanup after test cancellation.
CI uploads its failure screenshot and Phase 6 workflow result.

## Profile and deliberate removals

The baseline is stable master `30cf3b015b86ebe14128bf48cbddd8239b0bf7cd`.
[Master PRODUCT run 38345390341](https://github.com/devsecopslonghn/schemaForge/actions/runs/38345390341)
measured browser test steps at 305/308/325 seconds and API steps at
386/587/513/461 seconds. Browser shard 1/3 spent 87.22 seconds on durable worker
transitions, 39.80 on approval withdrawal and 34.68 on plan resubmission.
Those unique concurrency, authority and recovery cases remain intact.
The shard's broad legacy browser journey cost another 25.24 seconds.

`product-browser.integration.mjs` now tests the unique committed source-binding
response arriving after a project/session switch. It retains traversal rejection,
dirty/unbound import denial, approver mutation denial, empty browser storage,
current binding display and the committed server write. Its repeated project,
environment/profile creation, Git import, SQL preview, approval/rejection and API
restart journey was removed. Coverage survives as follows:

| Removed repeated flow | Surviving coverage |
| --- | --- |
| Git intake, profile setup, preview and approved request through restart | Phase 6 HTTPS and MVP browser workflows; source-binding/API suites |
| Independent approval/rejection, requester restrictions | Plan-requester and approval-integrity browser suites |
| Rejection recovery and retained plans | Plan-resubmission browser; approval/API suites |
| No-execution history and durable audit | Secure-session/Phase 6 browser; product API |
| Denied-execution audit after restart | Assertion moved into the existing product API restart test |

Removed 33 routine screenshot captures: target workflow 7, discovery 4, SQL
validation 5, Phase 5 execution 4, Phase 6 workflow 10, archive 1, comments 1,
legacy product journey 1. These were evidence images without pixel comparisons.
All desktop/mobile layout assertions remain. Obsolete screenshot directory
uploads and the Phase 6 screenshot counter were removed; existing historical
evidence stays intact. No shared fixtures or unique security, immutability,
HOLD, concurrency or recovery tests were deleted.

The eight thin-supervisor deadline cases retain real children, existing
three-second deadlines and all HOLD/reaping assertions. They now share one
parent with concurrency bounded to two, overlapping independent waits.
Suite membership comes from plain exported lists rather than TypeScript AST
inspection of the runner. That preceding optimization retained all 97 entries;
the subsequent browser audit consolidates three files after explicit UI transfers
and preserves all 57 API files (94 API/browser entries total).

## Measurements

Measured on the same local Linux host, Node 22.23.3/npm 10.9.9, with dependencies
already installed. These are observed runs, not statistical performance bounds.
Offline runs used the fresh-checkout mode without the generated helper/database;
browser runs used pinned parser/JDK, Chromium and disposable local PostgreSQL.
Install, parser preparation and database startup are outside command timings.

| Command or changed step | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Offline `check` / `check:fast` | 65.87 s | 43.53 s | 33.9% |
| Thin-supervisor file | 33.00 s | 21.33 s | 35.4% |
| Non-release shard `build` / `build:web` | 12.10 s | 0.30 s | 97.5% of repeated preparation |
| Legacy/focused product browser file | 26.72 s | 3.31 s | 87.6% |

The last row compares successful same-host command times: the new measurement
includes the runner's setup/selection overhead. Measure again with
`/usr/bin/time -f 'elapsed_seconds=%e'` around these commands in baseline and
optimized checkouts. The complete offline benchmark retained all 110 existing
unconfigured-environment skips; the new runner tests and supervisor parent add
test accounting without dropping any original safety cases.

Updated shard scheduling costs use only top-level TAP durations from the exact
master run (nested durations are already in their parent). Applying the same
observed costs to old/new assignments projects maximum API load
584.068 to 486.002 seconds and browser load 316.597 to 304.534 seconds. The edited
browser file intentionally retains its untrimmed CI estimate. These are
scheduling projections, not measured improvements in hosted CI; the new PR's CI
has yet to establish wall-clock improvement.

Local characterization found parser-dependent setup failures when heavy browser
and unit runs overlapped. The parser's five-second safety budget is unchanged;
run the changed database/browser files serially and diagnose the first setup
failure independently. Keep reproducibility unit checks from mutating the
helper while acceptance uses it, as described in [controlled execution](controlled-execution.md).

Integrated verification ran all eight changed browser files plus the API denial
audit test serially: 11 passed, zero skips, 231.81 seconds. Focused runner/shard
checks passed all 13 tests. Two bounded contributors independently reviewed the
integrated gates, suite inventory, safety coverage and cancellation cleanup.
