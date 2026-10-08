# WP0 Oracle feasibility test plan

8 October 2026. **63 proposed mandatory cases, all NOT_RUN.** No harness/fixtures/Oracle objects were created in this task. Objectives below are executable engineering specifications for [WP0 tasks](IMPLEMENTATION-BACKLOG.md); no command or fixture is claimed to exist. The [acceptance matrix](WP0-ACCEPTANCE-MATRIX.md) is a result template, not a PASS report.

## Scope, prerequisites and isolation

Future workspace: `experiments/db-devops-wp0/`; append-only results: `evidence/db-devops-wp0/<UTC-run-id>/`. Existing `poc/`, source snapshots, research files and current deployments are read-only inputs. Run only against targets explicitly supplied and attested as disposable; a hostname containing “dev” is not authorization. No Oracle image downloads, cluster deployments or infrastructure changes are implied. If a new disposable container/namespace/fault proxy is needed, keep it within the supplied authorized lab scope.

Before the first connection, WP0-T01 must record a secret-free lab manifest: harness/build/fixture hashes; 19c/21c exact versions; Oracle entitlement/lab permission; approved TCPS CA/server identity; service/container expected identity; exact A/B/C fixture owners/prefixes and project labels; discovery, owner, observer and bootstrap credential references; grants and narrow lock-package permission; allowed fault-proxy/session-stop actions; PostgreSQL fixture store; alias endpoints; offline artifacts; teardown ownership. Record unavailable values as missing inputs, not guessed defaults. Discovery never creates schemas/PDBs or grants itself privileges.

Only the DBA/bootstrap capability may create/drop **explicitly allowlisted disposable** schema/lock/ledger resources. Discovery has dictionary-only grants; executor uses owner-scoped credentials; observer independently checks owner/type/committed state. No SYSDBA/ANY grants for ordinary workers. Use fresh generation per isolated case where necessary. A/B share a DEV container and have different project assignments; they cannot be labeled DEV/PROD independently in that PDB.

STATIC and pure-unit phases may run without Oracle. Each applicable Oracle cell needs a real named 19c/21c profile and independent observations. A mocked connector, recorded old product POC, expected JSON, SQLite result or simulated approval/state model never becomes an Oracle-runtime PASS. WP0 governance is an isolated harness model; actual production server authorization requires later integration regression.

## Fixture contract

F01–F06 describe connection/discovery/identity/visibility profiles, including aliases and wrong-PDB/principal controls. F07–F20 are parser inputs covering ordinary DDL, every required PL/SQL object/block form, quoting/slashes, malformed/unsupported/encoding variants and opaque commits. Each receives original-byte hash, exact expected statement count/ranges/executable-byte golden file and expected owner/name/type/postcondition manifest during implementation. **No new Oracle grammar is allowed.** F21 is the five-file V001–V005 release, prepared by actual earlier approved runs so A has 1–3 and B has 1; F22 is version/order/history negatives. F23–F24 are invalid object controls. F25–F30 are contention/barrier/approval/ledger-rewind profiles. F31–F32 are exact dependency/offline/secret-canary fixtures. Fixture names are contracts, not existing files.

Each case must reset its fixture footprint or start a fresh allowlisted schema generation. Ordinary DDL's four-statement fixture expects one table, its altered column, one index and one valid view. Package specification and body have separate manifests. Later malformed-file validation happens before any migration statement is admitted. Unsupported SQL*Plus commands are rejected, not shell-executed. Includes/placeholders/client substitutions are disabled.

## Instrumentation and deterministic fault barriers

Record source/file/statement IDs, original and executable hashes, UTC times, authenticated fixture actors/decisions, intent/history/route/generation, claim/admission generation, actual session/principal, lock request/acquisition/release, call send/acknowledgment and independent observations. Capture metadata transaction IDs/receipt IDs where meaningful; do not call a Git SHA a transaction ID. Count **migration statement calls** separately from read-only discovery/observer queries and fixture bootstrap/cleanup.

Include authority revision and dispatch-permit commit order in observations. Use explicit named synchronization barriers and IPC acknowledgments, not timing-only sleeps, before and after each authorization checkpoint and at: durable admission before target; local STARTED commit; first DDL acknowledgment/effect; file receipt commit; between files; after target success receipt before central completion. For response loss, the fault proxy controls only authorized lab transport; independent target observations determine what occurred. A kill signal/hook report alone is not proof of the Oracle commit window. Observer read-only queries and actual target/session facts are the evidence oracle.

Test central admission conflicts separately from target mutex contention. Where the central active-job constraint prevents a second contender reaching Oracle, exercise the target lock using isolated metadata stores/direct harness worker contenders under the same approved fixture capability. This tests the lock boundary without weakening production admission. An Oracle session lock has no platform lease TTL; central lease expiry marks HOLD, and replacement writes require observed session termination/released mutex. If RAC is a required supported profile, distinct RAC-instance routes must be tested; a pair of single-instance aliases cannot certify RAC.

## Common evidence and result rules

Write a run manifest and per-case sanitized observations/result JSON, original fixture digests, parsed statement/range artifacts, approval/plan hashes, central/target receipt observations, compiler rows by owner/name/type, independent data/object checks, lock/session traces and cleanup report. Record dependency source/versions/license/NOTICE/SBOM hashes and offline build inputs. Known secret canaries must not appear in outputs/arguments; no fixture SQL contains real credentials. Approved production SQL can contain sensitive literals, so later platform artifact reads need separate permission.

Each applicable result cell is PASS, FAIL, BLOCKED or NOT_RUN. NOT_APPLICABLE needs a stated profile reason and cannot hide a required Oracle version. PASS requires every subrun and evidence item, including negative controls and actual 19c/21c runtime where specified. FAIL captures the observed violated invariant; BLOCKED captures missing prerequisites; a timeout with unknown target effects remains AMBIGUOUS/HOLD even if the negative test successfully detected it. Expected safe HOLD can make the **test** PASS while the **migration** remains unresolved; these statuses are different.

History dispositions APPLIED/BASELINED/ADOPTED_AFTER_VERIFICATION, attempt NOT_STARTED/RUNNING/APPLIED/FAILED/AMBIGUOUS/NEEDS_RECONCILIATION and run VERIFIED_SUCCESS/NOOP/HOLD are distinct. No receipt absence proves no effect. No repair command may rewrite applied checksums or fabricate a missing human decision. Logical receipt/metadata rewind is labeled fault injection; it does not certify physical RMAN/PDB restore.

## Common cleanup

First stop new claims and observe active calls/locks. Observe or, with supplied DBA authority, terminate only identified fixture sessions. Preserve raw sanitized evidence before teardown. Drop only resources listed in the allowlisted case footprint, using the separate bootstrap capability; never infer disposable ownership from a name alone. Remove temporary proxy/local stores/secret canaries after evidence retention and scope checks. An uncertain live session or unrecognized resource makes cleanup BLOCKED and is reported; no forceful global cleanup. Cleanup failure is retained separately from functional result and prevents lab exit until resolved or explicitly handed to the authorized owner.

## Detailed cases

### WP0-01-01

**Objective:** Thin TCPS on both supported versions. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F01 connection profiles.

**Fixture:** F01 connection profiles.

**Execution:**

1. Connect as discovery, owner A, owner B and observer through the attested PDB service.
2. record actual driver mode/version, database version and SESSION_USER.

**Expected result:** Thin=true, verified peer/container and separate principals; no Instant Client required.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-04, R-11. **Tasks:** [WP0-T04](IMPLEMENTATION-BACKLOG.md#wp0-t04).

### WP0-01-02

**Objective:** Wrong service/PDB. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F01 plus second attested PDB route.

**Fixture:** F01 plus second attested PDB route.

**Execution:**

1. Attempt a profile whose observed container differs from the approved identity.

**Expected result:** Reject before bootstrap/migration statements; no identity fallback.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-09. **Tasks:** [WP0-T04](IMPLEMENTATION-BACKLOG.md#wp0-t04).

### WP0-01-03

**Objective:** Authentication and grant denial. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F02 deliberately invalid/restricted profile.

**Fixture:** F02 deliberately invalid/restricted profile.

**Execution:**

1. Use incorrect password, locked fixture account and an owner lacking one fixture privilege in separate subruns.

**Expected result:** Sanitized errors; no leaked secret, false onboarding or broad-grant fallback.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-04, R-11. **Tasks:** [WP0-T04](IMPLEMENTATION-BACKLOG.md#wp0-t04).

### WP0-01-04

**Objective:** Bounded connection timeout. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F02 controlled unreachable lab endpoint.

**Fixture:** F02 controlled unreachable lab endpoint.

**Execution:**

1. Apply configured connect timeout to a lab-only blackhole endpoint and inspect elapsed time/session inventory.

**Expected result:** Bounded error and zero migration statements; existing platform process remains usable.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-04, R-15. **Tasks:** [WP0-T04](IMPLEMENTATION-BACKLOG.md#wp0-t04).

### WP0-01-05

**Objective:** Network loss during a call. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F03 controlled fault proxy.

**Fixture:** F03 controlled fault proxy.

**Execution:**

1. Disconnect an active DDL call through the isolated lab proxy, then observe session/effects from a separate connection.

**Expected result:** AMBIGUOUS/HOLD until observation; no inference of rollback or automatic replay.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-02. **Tasks:** [WP0-T04](IMPLEMENTATION-BACKLOG.md#wp0-t04).

### WP0-01-06

**Objective:** Credential isolation and rotation boundary. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F01 two owner secrets and secret versions.

**Fixture:** F01 two owner secrets and secret versions.

**Execution:**

1. Attempt A-to-B scope substitution.
2. rotate a lab secret version between plan and dispatch.
3. inspect pools/logs.

**Expected result:** Cross-owner substitution denied; changed credential revision invalidates intent; no mixed-owner pool or secret output.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-11, R-16. **Tasks:** [WP0-T04](IMPLEMENTATION-BACKLOG.md#wp0-t04).

### WP0-02-01

**Objective:** Discover two application owners. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F04 empty application A/B plus maintained accounts.

**Fixture:** F04 empty application A/B plus maintained accounts.

**Execution:**

1. Enumerate visible owners twice using discovery-only principal.
2. map one PDB route to two projects in the harness fixture.

**Expected result:** Stable A/B identities, no duplicates, environment DEV on both; maintained owners excluded.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-09, R-11. **Tasks:** [WP0-T05](IMPLEMENTATION-BACKLOG.md#wp0-t05).

### WP0-02-02

**Objective:** Visibility is not authorization. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F04 plus visible unassigned owner C.

**Fixture:** F04 plus visible unassigned owner C.

**Execution:**

1. Expose C through ALL_USERS and attempt execution using discovery or unassigned credentials.

**Expected result:** C remains non-executable; discovery principal cannot become writer.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-11. **Tasks:** [WP0-T05](IMPLEMENTATION-BACKLOG.md#wp0-t05).

### WP0-02-03

**Objective:** Dictionary visibility negative. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F05 observer with insufficient dictionary grants.

**Fixture:** F05 observer with insufficient dictionary grants.

**Execution:**

1. Inspect an invalid expected object using owner and restricted observer, including empty diagnostic query results.

**Expected result:** Restricted/unknown visibility blocks success; empty rows do not mean VALID.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-05, R-11. **Tasks:** [WP0-T05](IMPLEMENTATION-BACKLOG.md#wp0-t05).

### WP0-02-04

**Objective:** Canonical identity across aliases. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F06 two service aliases and second PDB with same owner spelling.

**Fixture:** F06 two service aliases and second PDB with same owner spelling.

**Execution:**

1. Resolve both aliases and the same-named owner in the second PDB.

**Expected result:** Aliases share target generation/lock key; other PDB has a different target; CON_ID/name alone are insufficient.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-09. **Tasks:** [WP0-T05](IMPLEMENTATION-BACKLOG.md#wp0-t05).

### WP0-02-05

**Objective:** Clone/drop-recreate generation. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F06 fresh recreated disposable owner or cloned lab container.

**Fixture:** F06 fresh recreated disposable owner or cloned lab container.

**Execution:**

1. Change lifecycle generation and retain an older plan/identity receipt.
2. attempt dispatch.

**Expected result:** Quarantine old intent/history association; no automatic adoption of a copied schema identity table.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-09, R-12. **Tasks:** [WP0-T05](IMPLEMENTATION-BACKLOG.md#wp0-t05).

### WP0-03-01

**Objective:** Ordinary Oracle DDL. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F07 table, alter, index and view script.

**Fixture:** F07 table, alter, index and view script.

**Execution:**

1. Parse four ordered statements with recorded byte ranges.
2. execute in fresh owner and inspect definitions.

**Expected result:** Exactly four intended statements; expected table/column/index/view exist and view is VALID.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-05. **Tasks:** [WP0-T03](IMPLEMENTATION-BACKLOG.md#wp0-t03), [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-02

**Objective:** Procedure body boundaries. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F08 procedure with internal semicolons.

**Fixture:** F08 procedure with internal semicolons.

**Execution:**

1. Parse and execute procedure, then run approved observer check of its controlled effect.

**Expected result:** One CREATE routine statement; valid object; internal/terminal semicolons preserved.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-03

**Objective:** Function body boundaries. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F09 deterministic fixture function.

**Fixture:** F09 deterministic fixture function.

**Execution:**

1. Parse and execute function.
2. inspect validity and call it through a read-only postcheck.

**Expected result:** One CREATE function statement and expected returned value.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-04

**Objective:** Package specification. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F10 package specification.

**Fixture:** F10 package specification.

**Execution:**

1. Parse and execute specification as its own migration.
2. inspect PACKAGE status.

**Expected result:** One intact specification, expected owner/name/type and VALID status.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-05

**Objective:** Package body. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F11 matching package body.

**Fixture:** F11 matching package body.

**Execution:**

1. Apply valid specification prerequisite, parse/execute body and inspect both object types.

**Expected result:** Body is one intact statement; PACKAGE and PACKAGE BODY checked independently.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-06

**Objective:** Trigger. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F12 trigger plus controlled source table.

**Fixture:** F12 trigger plus controlled source table.

**Execution:**

1. Parse/execute trigger and approved DML fixture.
2. inspect resulting effect and compiler rows.

**Expected result:** Trigger boundary intact, expected effect exactly once in successful run and VALID object.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-07

**Objective:** Anonymous block. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F13 bounded anonymous block.

**Fixture:** F13 bounded anonymous block.

**Execution:**

1. Parse nested BEGIN/END with internal semicolons and execute a controlled effect.

**Expected result:** One block sent; required terminal semicolon retained; observed effect agrees with receipt.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-17. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-08

**Objective:** Comments and quoted strings. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F14 q-quotes, doubled quotes, quoted identifiers and comment semicolons.

**Fixture:** F14 q-quotes, doubled quotes, quoted identifiers and comment semicolons.

**Execution:**

1. Parse bytes including each quoting/comment form and execute permitted fixture statements.

**Expected result:** No spurious split, alteration or skipped statement; source byte mapping round-trips.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-08. **Tasks:** [WP0-T03](IMPLEMENTATION-BACKLOG.md#wp0-t03), [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-09

**Objective:** Slash delimiter versus SQL content. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F15 standalone slash, division and slash in strings/comments.

**Fixture:** F15 standalone slash, division and slash in strings/comments.

**Execution:**

1. Parse and execute.
2. instrument submitted statement bytes.

**Expected result:** Standalone delimiter never sent to Oracle; division and quoted/comment slashes preserved.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-08. **Tasks:** [WP0-T03](IMPLEMENTATION-BACKLOG.md#wp0-t03), [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-10

**Objective:** Malformed blocks and quotations. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F16 unclosed quotes, incomplete block and malformed delimiter boundaries.

**Fixture:** F16 unclosed quotes, incomplete block and malformed delimiter boundaries.

**Execution:**

1. Validate each malformed input before admission.
2. inspect target footprint using observer.

**Expected result:** Explicit file/range parse failure, zero migration calls; no catch-and-continue.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-20. **Tasks:** [WP0-T03](IMPLEMENTATION-BACKLOG.md#wp0-t03), [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-11

**Objective:** Unsupported SQL*Plus commands. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F17 SET/DEFINE/@/@@/HOST/SPOOL/CONNECT/WHENEVER/EXIT.

**Fixture:** F17 SET/DEFINE/@/@@/HOST/SPOOL/CONNECT/WHENEVER/EXIT.

**Execution:**

1. Validate each executable directive and a control comment containing the same words.

**Expected result:** Commands rejected with location; comments allowed; no include, shell or secondary login.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-20. **Tasks:** [WP0-T03](IMPLEMENTATION-BACKLOG.md#wp0-t03), [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-12

**Objective:** UTF-8 byte fidelity. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F18 non-ASCII text, LF/CRLF and BOM/invalid-byte variants.

**Fixture:** F18 non-ASCII text, LF/CRLF and BOM/invalid-byte variants.

**Execution:**

1. Hash original bytes.
2. parse allowed UTF-8 variants.
3. reject BOM/invalid encoding.
4. compare byte-exclusive ranges.

**Expected result:** Raw checksums remain byte-sensitive; approved statement stream is deterministic; rejected input has no effects.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-08. **Tasks:** [WP0-T03](IMPLEMENTATION-BACKLOG.md#wp0-t03), [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-13

**Objective:** Opaque PL/SQL transaction classification. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F19 explicit commit/autonomous transaction fixture.

**Fixture:** F19 explicit commit/autonomous transaction fixture.

**Execution:**

1. Parse as supported PL/SQL, classify non-atomic and execute only independently approved lab fixture.

**Expected result:** No DML-only atomicity assertion; committed effects and separate receipt windows recorded.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-17. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-03-14

**Objective:** Whole release parse failure before execution. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F20 valid first file plus malformed later file.

**Fixture:** F20 valid first file plus malformed later file.

**Execution:**

1. Ingest/prevalidate entire release before any write and inspect target with observer.

**Expected result:** No first-file effect when a later file cannot be parsed; validation completes before approval/admission.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-03, R-20. **Tasks:** [WP0-T03](IMPLEMENTATION-BACKLOG.md#wp0-t03), [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-04-01

**Objective:** Divergent histories. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 V001-V005 release with real prior runs A=1..3, B=1.

**Fixture:** F21 V001-V005 release with real prior runs A=1..3, B=1.

**Execution:**

1. Create A and B history by successful approved executions of earlier release prefixes.
2. plan and apply full release.

**Expected result:** A pending V004/V005; B pending V002-V005; respective execution counts 2 and 4; no fabricated APPLIED seed rows.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-08. **Tasks:** [WP0-T09](IMPLEMENTATION-BACKLOG.md#wp0-t09).

### WP0-04-02

**Objective:** Zero-pending rerun. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 after all five versions applied.

**Fixture:** F21 after all five versions applied.

**Execution:**

1. Create and independently approve a fresh plan.
2. validate under mutex and dispatch.

**Expected result:** NOOP with zero migration statements and checked ledger/audit evidence.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-08. **Tasks:** [WP0-T09](IMPLEMENTATION-BACKLOG.md#wp0-t09).

### WP0-04-03

**Objective:** Modified applied V002. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 with one changed raw byte in V002.

**Fixture:** F21 with one changed raw byte in V002.

**Execution:**

1. Ingest same canonical version with changed checksum.
2. attempt planning and stale approved dispatch.

**Expected result:** Both paths reject; no SQL replay or checksum repair; stored original receipt unchanged.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-08. **Tasks:** [WP0-T09](IMPLEMENTATION-BACKLOG.md#wp0-t09).

### WP0-04-04

**Objective:** Naming/order/history mismatch. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F22 V2/V10, V001/V1 collision, missing or unexpected applied version.

**Fixture:** F22 V2/V10, V001/V1 collision, missing or unexpected applied version.

**Execution:**

1. Test deterministic tuple ordering, duplicate canonical versions, and history disagreements in independent subruns.

**Expected result:** V2 precedes V10; collision rejected; inconsistent/missing history blocks plans.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-08, R-12. **Tasks:** [WP0-T09](IMPLEMENTATION-BACKLOG.md#wp0-t09).

### WP0-05-01

**Objective:** Valid specification, invalid package body. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F23 valid specification plus body with compiler error.

**Fixture:** F23 valid specification plus body with compiler error.

**Execution:**

1. Execute body whose driver may return without exception.
2. query owner/name/type and errors.

**Expected result:** FAILED validity/HOLD, no verified result or ordinary APPLIED success for failing file; PACKAGE BODY failure distinct from spec.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-05-02

**Objective:** Invalid procedure/function/view. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F24 invalid routine variants and FORCE view with missing dependency.

**Fixture:** F24 invalid routine variants and FORCE view with missing dependency.

**Execution:**

1. Run each invalid object fixture and inspect compiler/status diagnostics.
2. record any unsupported fixture variant explicitly.

**Expected result:** Each actually created INVALID expected object blocks success; driver exception alone is not the oracle.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-05-03

**Objective:** Wrong owner or missing expected object. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F05 plus altered approved expected-object identity.

**Fixture:** F05 plus altered approved expected-object identity.

**Execution:**

1. Check USER_ERRORS while CURRENT_SCHEMA differs from SESSION_USER.
2. inspect absent expected name/type with known visibility.

**Expected result:** No success from unrelated empty USER_ERRORS or missing object; owner/type visibility is demonstrated.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-05, R-11. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-05-04

**Objective:** Semantic postcheck failure. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 with approved read-only check expecting wrong seed count.

**Fixture:** F21 with approved read-only check expecting wrong seed count.

**Execution:**

1. Execute file, run local and independent committed-state checks, retain receipts and central result separately.

**Expected result:** No VERIFIED_SUCCESS/promotion; committed effects/history are retained truthfully and incident remains open.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-05. **Tasks:** [WP0-T08](IMPLEMENTATION-BACKLOG.md#wp0-t08).

### WP0-06-01

**Objective:** Two workers, one target. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 fresh pending version and two worker processes.

**Fixture:** F21 fresh pending version and two worker processes.

**Execution:**

1. Synchronize contenders at lock request and instrument Oracle call start/end times.

**Expected result:** Exactly one executing session per target; second waits/rechecks; changed history invalidates its old approved plan.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-02. **Tasks:** [WP0-T06](IMPLEMENTATION-BACKLOG.md#wp0-t06), [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-06-02

**Objective:** Duplicate requests and idempotency. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 plus identical/conflicting idempotency bodies.

**Fixture:** F21 plus identical/conflicting idempotency bodies.

**Execution:**

1. Dispatch concurrently using same key/body, then same key/different target/body.

**Expected result:** Same job for identical request, conflict for changed body; one admitted attempt and no duplicate effect.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-02, R-07. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-06-03

**Objective:** Alias/RAC contention. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F06 aliases to same PDB/owner.

**Fixture:** F06 aliases to same PDB/owner.

**Execution:**

1. Run two contenders through distinct aliases.
2. if approved estate requires RAC, repeat across distinct RAC instance routes.

**Expected result:** One canonical lock and non-overlapping execution; single-instance results do not certify RAC.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-02, R-09. **Tasks:** [WP0-T06](IMPLEMENTATION-BACKLOG.md#wp0-t06), [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-06-04

**Objective:** DDL-persistent lock and lease expiry. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F25 DDL followed by controlled pause.

**Fixture:** F25 DDL followed by controlled pause.

**Execution:**

1. Hold session mutex across DDL commit.
2. pause worker beyond central lease while it still owns Oracle session.
3. start contender.

**Expected result:** Target lock remains held, expired lease creates HOLD and does not fence/replay active SQL.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-02. **Tasks:** [WP0-T06](IMPLEMENTATION-BACKLOG.md#wp0-t06), [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-06-05

**Objective:** Crash while holding lock. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F25 with killed worker and optional surviving Oracle session.

**Fixture:** F25 with killed worker and optional surviving Oracle session.

**Execution:**

1. Terminate only fixture worker, observe actual session lifetime.
2. retry contender before and after confirmed termination.

**Expected result:** No replacement SQL while old session may execute; release proved by target/session observation, never wall-clock expiry alone.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-02. **Tasks:** [WP0-T06](IMPLEMENTATION-BACKLOG.md#wp0-t06), [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-01

**Objective:** Failure before target execution. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F26 barrier after durable admission before connection/STARTED.

**Fixture:** F26 barrier after durable admission before connection/STARTED.

**Execution:**

1. Terminate process at named barrier.
2. reconcile using admission and positive zero-call instrumentation.

**Expected result:** NOT_STARTED/known no effect; a new admitted attempt may run only with current authorization.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-02

**Objective:** Failure after first committed DDL. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F27 file with committed CREATE followed by failing ALTER.

**Fixture:** F27 file with committed CREATE followed by failing ALTER.

**Execution:**

1. Run first statement, inject failure and independently inspect created object/data.

**Expected result:** FAILED with partial commit knowledge, AMBIGUOUS where evidence is insufficient; HOLD and no blind replay.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-03

**Objective:** Failure between files. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 barrier after first APPLIED receipt before next STARTED.

**Fixture:** F21 barrier after first APPLIED receipt before next STARTED.

**Execution:**

1. Terminate process at file boundary.
2. read both histories and target objects.

**Expected result:** First file stays APPLIED; unstarted later file distinct; original approved history snapshot cannot be reused after change.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-06. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-04

**Objective:** Commit before target success receipt. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F28 barrier after known DDL commit before APPLIED insert/commit.

**Fixture:** F28 barrier after known DDL commit before APPLIED insert/commit.

**Execution:**

1. Terminate process at named barrier and run observer/reconciler without executing migration SQL.

**Expected result:** Effects with missing receipt yield AMBIGUOUS/NEEDS_RECONCILIATION; no assumption that pending means safe.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-05

**Objective:** Target receipt before central completion. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F28 barrier after target APPLIED commit before central completion.

**Fixture:** F28 barrier after target APPLIED commit before central completion.

**Execution:**

1. Terminate worker.
2. validate receipt against retained approval/bytes.
3. re-run safe observer checks.

**Expected result:** Reconstruct central completion without SQL replay; missing retained authorization keeps HOLD.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-12. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-06

**Objective:** Response loss during statement/commit. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F03 fault proxy at statement response and commit response in separate subruns.

**Fixture:** F03 fault proxy at statement response and commit response in separate subruns.

**Execution:**

1. Drop response after server may have accepted work.
2. independently inspect target/session/receipt.

**Expected result:** AMBIGUOUS until observed; acknowledgment absence is not rollback; no automatic reexecution.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-02. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-07

**Objective:** Worker restart and SIGTERM. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F25 active call plus persisted job/attempt.

**Fixture:** F25 active call plus persisted job/attempt.

**Execution:**

1. Request drain then terminate/restart fixture worker and inspect claimed generation/state.

**Expected result:** No new claims during drain; old RUNNING becomes unresolved HOLD if unobserved; restart never fabricates terminal result.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-02. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-07-08

**Objective:** Duplicate retry of ambiguous attempt. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F28 unresolved incident.

**Fixture:** F28 unresolved incident.

**Execution:**

1. Repeat run API, new idempotency key, worker claim and recovery submission without independent evidence/approval.

**Expected result:** All SQL replay paths denied; incident remains open until independently authorized resolution.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-07. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-08-01

**Objective:** Git commit mutation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 immutable approved intent and alternate full commit.

**Fixture:** F29 immutable approved intent and alternate full commit.

**Execution:**

1. Replace commit identity while retaining approval.
2. attempt harness admission and observe zero target migration calls.

**Expected result:** Digest mismatch rejects; a valid original control intent is tested separately.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-08-02

**Objective:** SQL content mutation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 retained file altered after approval.

**Fixture:** F29 retained file altered after approval.

**Execution:**

1. Change raw SQL bytes without changing other presented fields.

**Expected result:** Reject both artifact read and dispatch before SQL; no normalization hides change.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06, R-08. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-08-03

**Objective:** Checksum mutation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 approved raw/execution checksum fields.

**Fixture:** F29 approved raw/execution checksum fields.

**Execution:**

1. Change checksum or parsed statement digest without replacing approval.

**Expected result:** Reject mismatch and preserve original signed intent/decision.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06, R-08. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-08-04

**Objective:** Service/route mutation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 alternate endpoint even when alias maps to same PDB.

**Fixture:** F29 alternate endpoint even when alias maps to same PDB.

**Execution:**

1. Switch service/profile revision after approval.

**Expected result:** Route binding is part of intent; changed route denied and needs a new plan.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06, R-09. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-08-05

**Objective:** Schema mutation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 owner A plan replaced with B target.

**Fixture:** F29 owner A plan replaced with B target.

**Execution:**

1. Swap stable target UUID, exact owner, assignment revision or target generation.

**Expected result:** Reject substitution; no cross-project SQL or secret access.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06, R-11. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-08-06

**Objective:** Execution order mutation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 ordered multi-file plan.

**Fixture:** F29 ordered multi-file plan.

**Execution:**

1. Reorder pending files/statements while retaining original approval.

**Expected result:** Reject ordered digest mismatch; no dispatch.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-08-07

**Objective:** Release manifest mutation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 alternate folder/profile/parser/postcheck/options.

**Fixture:** F29 alternate folder/profile/parser/postcheck/options.

**Execution:**

1. Change each manifest execution-affecting field in separate subruns.

**Expected result:** All changed deployment intent rejected; cosmetic unbound request comments cannot alter SQL/targets.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06, R-20. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-08-08

**Objective:** Actor, expiry, revocation and history races. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F29 named author/editors/approver/deployer plus mutable policy/history.

**Fixture:** F29 named author/editors/approver/deployer plus mutable policy/history.

**Execution:**

1. Test self-approval, contributor exclusion, forged actor, expired/revoked decision, wrong deployer and changed history before the serialized dispatch-permit checkpoint; inspect zero migration calls for denied controls..
2. Use deterministic barriers before and after the per-statement permit commit; revoke/change membership concurrently, then observe the permitted call, next-permit denial and retained effect/ambiguity evidence..
3. Run the legitimate independent exact approval positive control; attempt stale claim-generation reuse and reject it without issuing a replacement call..

**Expected result:** Pre-checkpoint authority changes deny the call with audit and zero migration SQL. Post-checkpoint revocation treats the permitted call as in flight, stops later permits and retains actual/unknown effects without rollback or automatic replay. Legitimate independent exact approval succeeds; stale generations are rejected..

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime; Serialized authority/permit revisions and commit order; barrier IDs; before/after revocation observations and independent Oracle effect checks..

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-06, R-07. **Tasks:** [WP0-T07](IMPLEMENTATION-BACKLOG.md#wp0-t07).

### WP0-09-01

**Objective:** Local/central/hybrid gap comparison. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F28 ledger profiles.

**Fixture:** F28 ledger profiles.

**Execution:**

1. For each of three profiles inject commit-to-receipt/central gaps and compare artifacts, approval and observed target state.

**Expected result:** Record strengths/failures honestly; central-only pending never proves absence of effects; hybrid recommendation remains conditional on observed behavior.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-12. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-09-02

**Objective:** Local success missing central authorization. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F28 committed local receipt with withheld fixture approval/artifact.

**Fixture:** F28 committed local receipt with withheld fixture approval/artifact.

**Execution:**

1. Remove retained authorization from an isolated metadata copy and attempt reconciliation.

**Expected result:** NEEDS_RECONCILIATION/HOLD; target receipt cannot manufacture human approval.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-07, R-12. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-09-03

**Objective:** Logical history rewind in both directions. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F30 copied isolated metadata and fresh disposable generation.

**Fixture:** F30 copied isolated metadata and fresh disposable generation.

**Execution:**

1. Simulate target-receipt rewind by fixture mutation, and central rewind by restoring isolated metadata copy.
2. inspect without migration writes.

**Expected result:** Detected disagreement/restore declaration forces HOLD; label logical fault injection, not RMAN/PDB restore validation.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-09, R-12. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-09-04

**Objective:** Approved recovery classification. **Mode:** ORACLE_RUNTIME; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F27/F28 observed no-effect versus proven committed effects.

**Fixture:** F27/F28 observed no-effect versus proven committed effects.

**Execution:**

1. Propose recovery with observer evidence, require second actor, distinguish adoption from genuine new execution.

**Expected result:** Retry only proven safe; ADOPTED_AFTER_VERIFICATION remains a separate provenance state; never fabricate APPLIED or edit checksum.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-01, R-07. **Tasks:** [WP0-T10](IMPLEMENTATION-BACKLOG.md#wp0-t10).

### WP0-10-01

**Objective:** Dependency/license closure. **Mode:** STATIC; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F31 selected package/source/build manifest.

**Fixture:** F31 selected package/source/build manifest.

**Execution:**

1. Inspect exact driver/parser/JRE/Git/PostgreSQL closure and notices, including packaged optional native/client contents.

**Expected result:** Required components have acceptable OSS rights; no proprietary Bytebase/JDBC/Instant Client/FSL dependency; UNKNOWN rights block selection.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-13, R-14. **Tasks:** [WP0-T01](IMPLEMENTATION-BACKLOG.md#wp0-t01), [WP0-T02](IMPLEMENTATION-BACKLOG.md#wp0-t02), [WP0-T11](IMPLEMENTATION-BACKLOG.md#wp0-t11).

### WP0-10-02

**Objective:** Secret leakage canary. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F32 disposable unique secret canaries.

**Fixture:** F32 disposable unique secret canaries.

**Execution:**

1. Trigger connection/parser/execution failures and scan sanitized logs, metadata exports and evidence.
2. inspect process invocation handling.

**Expected result:** No secret canary in persisted outputs/arguments; SQL fixtures contain no secret literals; credential references only.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-16. **Tasks:** [WP0-T11](IMPLEMENTATION-BACKLOG.md#wp0-t11).

### WP0-10-03

**Objective:** Least privilege and API/worker separation. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F01 plus denied discovery/API credential reads.

**Fixture:** F01 plus denied discovery/API credential reads.

**Execution:**

1. Attempt DDL as discovery, other owner access, arbitrary DSN dispatch and writer-secret read from API/CI fixture.
2. Read target history through an authenticated worker OBSERVER job; verify scoped read succeeds, missing grants block planning and the API cannot resolve owner/bootstrap credentials..

**Expected result:** Unauthorized DDL, cross-owner/DSN dispatch and API writer-secret reads are denied. The worker resolves only the admitted profile/target credential; a separately granted observer can read scoped history without write grants, while missing observer grants block a plan. No ANY/SYSDBA defaults..

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-07, R-11. **Tasks:** [WP0-T11](IMPLEMENTATION-BACKLOG.md#wp0-t11).

### WP0-10-04

**Objective:** Offline build/runtime feasibility. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F31 mirrored exact artifacts and local Git repository.

**Fixture:** F31 mirrored exact artifacts and local Git repository.

**Execution:**

1. Build in clean temporary environment from verified mirrored inputs with internet egress denied.
2. run full approved local release against lab Oracle.

**Expected result:** No external download/SaaS at build/runtime; missing artifact is BLOCKED, never fetched silently.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-13, R-18. **Tasks:** [WP0-T11](IMPLEMENTATION-BACKLOG.md#wp0-t11).

### WP0-10-05

**Objective:** Audit and evidence completeness. **Mode:** UNIT_AND_ORACLE; mandatory; status NOT_RUN.

**Preconditions:** common mode-specific prerequisites above; Fixture-specific prerequisites: F21 success, no-op, invalid and ambiguous run bundles.

**Fixture:** F21 success, no-op, invalid and ambiguous run bundles.

**Execution:**

1. Delete fixture worker process/container logs and reconstruct all outcomes from central records/local receipts and retained artifacts.

**Expected result:** Actor/intent/target/file/attempt/diagnostics/recovery facts survive; hashes verify; simulated and Oracle evidence remain distinct.

**Evidence required:** Pinned harness/dependency/build/fixture digests and environment profile; Timestamped per-case raw sanitized observations, call counts, state transitions and independent checks; Separate unit, 19c and 21c result cells where applicable; no source or simulation upgraded to runtime.

**PASS:** All named subruns meet the expected result with required reproducible evidence; applicable 19c and 21c cells both PASS. **FAIL:** Any incorrect split/effect, unauthorized execution, unsafe retry, invalid-object success, leaked secret or inconsistent observation. **BLOCKED:** A required target, grant, fault barrier/proxy, reviewed dependency or evidence capability is unavailable; retain the precise missing prerequisite.

**Cleanup:** Use common allowlisted fixture cleanup; resolve/observe live sessions first; preserve evidence and never drop a non-fixture resource. **Risks:** R-16. **Tasks:** [WP0-T11](IMPLEMENTATION-BACKLOG.md#wp0-t11), [WP0-T12](IMPLEMENTATION-BACKLOG.md#wp0-t12).

## Exit and transition

Every mandatory applicable unit/static and 19c/21c cell must PASS with retained reproducible evidence and resolved cleanup; supported transport/topology/grants must be named. Required unsupported capabilities or unresolved license rights produce NO-GO for that candidate. Missing runtime prerequisites permit only continued independent offline work, not GO for the platform. WP0-T12 records the decision and stops; beginning WP1 needs an explicit later implementation instruction and destination. Reuse proven contracts/tests, then rerun them against actual platform modules; do not promote harness authorization mocks or prior product results into platform acceptance.
