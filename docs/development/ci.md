# Build-first CI

Every PR and master push runs:

- `foundation` (`check.yml`): source syntax/integrity, TypeScript, web build,
  tracker and JSON validation, offline unit tests, pinned dependency smoke,
  license closure, and installed dependency byte/lock verification. One npm
  install; fresh offline reinstallation is reserved for regression.
- `product` (`product.yml`): a fail-closed aggregate of change selection and
  focused real PostgreSQL acceptance. `scripts/ci-focused-tests.mjs` maps affected
  domains to security, integrity, governance, execution, schema, connectivity and
  SQL suites. Shared API/database/dependency/test-fixture changes select every
  boundary; backup changes also require native backup/restore. Changed API test
  files run directly. Parser changes require ANTLR integration and approval/SQL
  acceptance. Selection failure, missing parser/database inputs or any selected
  job failure blocks this gate. Documentation/frontend-only changes use source,
  unit and image gates without PostgreSQL acceptance. Extend the mapping and
  focused tests when introducing a domain; new shared packages select all boundaries.
- `platform (amd64)`, `platform (arm64)` and `verify` (`containers.yml`): pinned
  native app/worker builds, exact-artifact governance/security/runtime smoke,
  SHA-256 verification and assembly of exactly two-platform OCI indexes. BuildKit
  caches use architecture-specific scopes; only master writes caches (with bounded,
  non-fatal export errors), and PRs read them. Pinned parser inputs occupy stable
  build layers; worker builds reuse app shared stages.
- Default CodeQL: all four existing language analyses. Publication also rejects
  open code-scanning findings.

PR workflows cancel superseded PR runs. Master verification and active delivery
writes are never cancelled. No path filter can leave a fast gate permanently pending.
The master ruleset currently prevents deletion/force pushes but configures no required
status checks; normal integration should still wait for the gates above and CodeQL.
No repository protection or security policy is weakened by this change.

Full suites retain their original commands, partitions and disposable services:

- `regression.yml` / **Kelryvo full product regression**: all eight API shards,
  three Chromium shards and full fresh-source installation/release acceptance;
  the release partition also checks fresh offline dependency installation.
- `parser.yml` / **Offline ANTLR parser acceptance**: pinned parser build,
  exhaustive corpus and ANTLR acceptance.

Both run weekly on Sunday at 02:17 UTC and accept `workflow_dispatch`. Run manually
with `gh workflow run regression.yml --repo devsecopslonghn/kelryvo` or
`gh workflow run parser.yml --repo devsecopslonghn/kelryvo`. An explicit dispatch of
`product.yml` selects all focused boundaries plus parser integration. Optional
regression failures remain visible but do not hold the default publication gate.

Delivery consumes the successful master OCI run/attempt artifact, rechecks source
currency and all fast/security gates before every write, publishes immutable
`SOURCE_SHA-OCI_RUN_ID-OCI_RUN_ATTEMPT` tags with preserved digests, and verifies the
registry indexes/configurations. It never rebuilds images or publishes PR artifacts.
Source labels and same-repository guards use `devsecopslonghn/kelryvo`. Helm promotion
remains separately gated by its existing `GITOPS_TOKEN` and chart validation; see
[container delivery](containers.md).

Runtime comparisons must distinguish elapsed PR completion from aggregate runner
seconds, include CodeQL, and disclose cold/warm cache conditions. Record Actions run
links and actual job timestamps in the implementation PR; queue/runner/network cost
is variable, so a single run is evidence rather than a universal guarantee.
