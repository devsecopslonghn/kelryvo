# Current engineering state

Phase 0, WP0-T01 offline preflight and **WP0-T02 candidate audit increment are VERIFIED**.
The current milestone is WP0 offline feasibility. There is no accepted execution architecture,
Oracle runtime acceptance, deployable product or verified product feature.

The foundation was safely reconciled and synchronized to GitHub `origin/master` at
`7dd5a3a902281d3850d1d23ab76cb460bb72bbab`, preserving original foundation `e817a4b`
and independent remote README `b2b2b9c`. Development uses
`development/wp0-dependency-closure` for review; ordinary verified pushes are authorized.
See [synchronization policy](github-sync.md). Eligible automatic merges are now explicitly
authorized after independent review and passing exact-head quality gates; never bypass checks.

T02 implements actual artifact pins, checksums, lockfiles, source/license/NOTICE records,
cache-only npm installation and reproducible driver-free Java builds. The selected inputs
are Node 22.23.3/npm 10.9.9, TypeScript 6.0.2, node-oracledb 7.0.1 **Thin**, Postgres.js 3.4.9,
Flyway 13.9.0, Temurin 21.0.12.1+1 and Maven 3.9.16. The npm closure has three packages;
90 Maven build dependencies and 277 cached JAR/POM files have exact checksum evidence.
Required selected Maven grants have zero unknown entries. `pg` was evaluated and rejected
because two source/package license texts were missing; it is historical, unselected evidence.
No mandatory Oracle JDBC, Instant Client, FSL, commercial Flyway or Bytebase code is included.
See [license evidence](../dependencies/LICENSE-EVIDENCE.md).

T02 verification covers its candidate register/isolation decision, **not full distributable
F31 or product approval**. The product license and public naming remain owner decisions;
future bundled runtimes must preserve versioned notices and applicable source availability.
Complete Git/metadata deployment artifact selection remains outside this candidate increment.
`WP0-10-01` therefore remains BLOCKED.

**WP0-T03 is BLOCKED; ADR-I03 is reopened.** The real driver-free helper builds offline with
identical SHA-256 `cfeab7e0db89348aece0f56f896e3acb0024056e531e02637b318a6800650a15`,
but the original F07–F20 corpus (14 groups, 30 variants) exposes 11 compatibility mismatches:
two required comment cases stop, and nine SQL*Plus directives are accepted. Unit cells
`WP0-03-08` and `WP0-03-11` are FAIL for this candidate. The bounded envelope checks byte
ranges, hashes, output/time limits and protocol authority fields. Every candidate/whole-release
result denies execution approval. No custom Oracle grammar or fallback splitter was added.
See [parser findings](../architecture/parser-feasibility.md).

**WP0-T04 remains BLOCKED** by missing explicit disposable 19c/21c authority and scoped
profile/TCPS/identity/credential/grant/fault/teardown references. No database connection,
credential resolution, infrastructure change or cleanup occurred. All 124 applicable Oracle
cells remain BLOCKED. There are no aggregate WP0 PASS cases or product verification claims.
Work status: three VERIFIED, two BLOCKED, 60 BACKLOG (64 imported tasks plus foundation).
Feature status: 213 BACKLOG and seven DEFERRED.

Actual commands, full sanitized outputs, advisory result (zero current npm advisories),
source preservation and candidate failures are retained in
`evidence/db-devops-wp0/t02-20261008T110223Z-f2cc022d/`. Native specialists contributed
Database packaging, Security artifact/license registers, DevOps offline installation,
Backend envelope/corpus and independent QA. The orchestrator reviewed and integrated them.
All 51 tests from the original T02 run passed. Fresh PR review passes **53** local tests,
source/lint/JSON checks and clean offline npm installation. The parent now rejects uncovered
non-whitespace source bytes, with independent QA follow-up approval. Review evidence is in
`evidence/db-devops-wp0/pr1-review-20261008T123632Z-97ca436e/`. Exact-head CI must pass again before PR #1 merges.
Two final offline Java builds reproduce the expected helper hash. All 43 immutable inputs
and DB-Research's pre-existing Git status are preserved.

Next actions:

1. **WP0-T03:** evaluate a licensed mature-parser alternative against the existing corpus
   and close reopened ADR-I03 before implementing an accepted adapter.
2. **WP0-T04:** supply explicit disposable 19c/21c authorization and strict lab references;
   then implement and verify bounded Thin connectivity/fault probes.
3. **WP0-T02/F31 follow-up:** choose the product license and packaging model, complete
   bundled-runtime notices/source availability and remaining Git/metadata artifact pins.

Resume with `npm ci --ignore-scripts --no-audit --no-fund`, `npm run check`,
`npm run dependencies:offline`, `npm run status` and `npm run next`.
See [offline build commands](../development/offline-build.md) for Java prerequisites;
`npm run parser:corpus` currently exits 1 with the recorded incompatibilities. The graph
has no currently unblocked remaining WP0 task. WP1/UI/deployment remain outside scope.
