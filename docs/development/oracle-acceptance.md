# Disposable Oracle execution acceptance

The unified container is a new runtime qualification boundary. Its local and deployed
metadata/browser acceptance alone does not qualify Oracle. The owner-attested installation
now has bounded governed DDL evidence below; the complete OA01–OA10 program remains
incomplete until its remaining SQL/fault and recovery cases are observed.
The dated results below remain valid only for their recorded sources and installations.
The current cases use one external instance master reference, purpose-restricted processes
and a separate protected ledger; historical separate-account results are not rewritten.

Live Oracle execution acceptance is **IN PROGRESS as a complete program**. Retained V1
and V2 governed executions passed with independently observed Oracle effects. A fresh,
independently accepted lineage now also passes NOOP; the original pre-admission HOLD
is retained. The continuation below supersedes earlier status without rewriting its
historical evidence. Fixture discovery,
UNIT_SYNTHETIC workers and PostgreSQL tests do not establish Oracle migration effects.

This bounded suite uses the existing Oracle provider, target ledger and session
mutex. It introduces no deployment infrastructure. The lab owner supplies the
attested scope; a database operator prepares isolated disposable schemas and
accounts; an independent reviewer evaluates retained evidence. The application
operator installs the private trusted worker only after these prerequisites pass.

## Unified runtime: bounded acceptance on 2026-10-23

The [new governed DDL evidence](../../evidence/product/unified-oracle-20261023/governed-ddl.json)
is tied to source `a4dbb8d` and image digest `01018b1d9cc464dd3f6ea0125e748c55e2bf0690fcea94b565f728272ba6fce4`.
It covers two assigned schemas using one master reference: browser-authored and independently
approved CREATE TABLE V1, ALTER TABLE ADD plus CREATE INDEX V2, and NOOP. The six DDL
acknowledgments have six central receipts, and direct Oracle observation confirms the
expected columns, valid indexes and complete ledger sequences. NOOP adds no statement
starts or receipts and leaves target metadata and ledger events unchanged. Both browser
roles retain identical downloadable record facts after application restart.

The [initial failed V1](../../evidence/product/unified-oracle-20261023/initial-held-v1.json)
and its two HOLD requests remain preserved in the original PDB. The successful run uses a
fresh owned PDB; no held SQL was replayed. The separate
[implicit-commit fixture](../../evidence/product/unified-oracle-20261023/implicit-commit.json)
retains both the failed parse-time assumption and the observed successful/runtime-failed
DDL commit behavior. No DML support is inferred.

This is a bounded success sequence, not full OA01–OA10 or pilot acceptance. Mismatched
identity, governed unsafe SQL, route-alias concurrency, interruption, real lost-ack,
ambiguous reconciliation, the remaining incompatible-history matrix and managed
PostgreSQL operational parity still require current-source evidence. A newer `ee44f6f`
[managed restore and historical-read proof](../../evidence/product/unified-oracle-20261023/managed-restore-ee44f6f.json)
preserves exact metadata in a new owned PostgreSQL database, keeps RESTORE_HOLD after
restart, revokes old tokens and blocks writes without an Oracle installation. It does
not exercise recovery of interrupted Oracle DDL or a live metadata cutover. Discovery and schema
snapshots with incomplete visibility remain PARTIAL/UNKNOWN/UNVERIFIED. Earlier sections
below retain their original source-specific outcomes, including failures.

The newer [before-first-DDL interruption proof](../../evidence/product/unified-oracle-20261023/interrupt-before-first-ee44f6f.json)
qualifies one OA06 boundary on `ee44f6f`. An independently approved request reaches
central/target STARTED evidence, then the operator kills the essential execution role
while the fixed wrapper reports zero native DDL calls. The whole container exits;
lease expiry retains HOLD and one attempt with no receipt. An independent observer sees
no application objects, and the same three target-ledger events survive another app
recreate. Both browser roles download valid held records. This does not cover a kill
after the first acknowledged statement, lost acknowledgment, reconciliation or the
full recovery matrix. The held request and PDB remain intact; execution is disabled.

## Live qualification on 2026-10-14

The initial phase below predates the purpose-separated follow-up. Its unchanged-grant
and cleanup statements describe that phase only.

[Sanitized results](../../evidence/product/oracle-lab-qualification-20261014/acceptance.json)
retain the tested source, checks and limitations. The owner approved a separate
Oracle Free lab variant using private TCP. The actual database reported **Oracle AI
Database 26ai Free 23.26.3.0.0**, in a CDB/PDB topology behind a Kubernetes ClusterIP.
This qualification does not change the existing 19c/21c TCPS WP0 contract or establish
an accepted execution installation for the Free variant.

Private, expiring manifests retain owner authorization, observed identity, grants,
credential references and the bounded fixture allowlist. An existing privileged
operator observed the full database/container identity separately. That identity
was not substituted for the application's missing identity evidence. The application
account cannot read `SYS.V_$DATABASE` or `SYS.V_$CONTAINERS`; its effective privileges
also permit DDL, so it does not establish least-privilege discovery isolation.
No privileges were changed, and the privileged operator was not installed in the API.

| Scope | Actual result | Remaining acceptance boundary |
| --- | --- | --- |
| R1 | Live registration/connectivity, permission diagnostics, immutable history, rejected identity binding/verification, browser display and restart passed with `PARTIAL/UNKNOWN` evidence. | Full application identity, a least-privilege discovery identity and independently accepted exact-target evidence remain unavailable. |
| R2 | Own-schema tables/defaults/CHECK/PK/FK, quoted names, views, sequences, indexes and dependencies were collected from real prefixed fixtures; repeated observations were stable. Actual metadata changes were observed. Application baselines retained unavailable identity and comparisons stayed `INCOMPARABLE`. Privileged owner-bound comparisons retained `MODIFIED` findings and `UNVERIFIED` absence/coverage. | No accepted identity-bound complete baseline/drift workflow. Descending indexes expose internal expressions and remain partial; multi-query consistency remains unverified. |
| R3 / OA01–OA10 | **NOT_RUN** as complete governed execution cases. Direct fixture DDL is not worker/migration evidence. | Purpose-separated discovery/writer/ledger/mutex/observer authorities, reviewed execution installation and acceptance/adoption evidence are missing. No fault scope was attested. |
| R4 | Real observation/baseline metadata survived application restart and native backup/restore; restored immutable evidence stayed under `RESTORE_HOLD`. | Oracle worker recovery, target-ledger durability, interrupted migration/fault handling and deployment isolation remain untested on Oracle. |

All owned prefixed fixture objects were removed; the application object inventory
matched its initial state, and effective privileges remained unchanged. PVC free capacity was
929 MiB before and after the run (4 GiB claim). The lab remains intact for remaining
acceptance. Raw identities, routes, manifests, SQL and backups remain private.

## Purpose-separated follow-up on 2026-10-14

[Follow-up evidence](../../evidence/product/oracle-lab-qualification-20261014/followup.json)
records the owner's subsequent authorization to create dedicated lab accounts and
scoped grants. Four distinct discovery, writer, protected execution-owner and observer
sessions passed bounded privilege/denial probes. The installed ledger trigger rejected
mutation, and the real target mutex excluded another writer session across COMMIT.
These direct qualification probes do not establish governed migration acceptance.

An independent reviewer accepted the actual isolated read-only adapter within three
explicit owner scopes, on both supplied service spellings. Exact database/PDB/service/
version identity, route pins, expiry and actual grants matched. Discovery remains
`PARTIAL` solely for metadata visibility outside the accepted scopes.

The positive API/Chromium run passed 11 bounded checks: registration/connectivity,
accepted identity, observe/verify binding revisions, stale/wrong-digest rejection,
immutable observations, identity-bound partial snapshots/baselines, independent plan
approval and application restart. A second run passed 15 checks, including actual
fixture ALTER/add/remove, `MODIFIED` differences with unverified absence, permanent
old-plan staleness after restoring structure, and pagination of 51 real snapshots and
101 named baselines. The runs overlap; their counts are not distinct full contracts.

[PR #105](https://github.com/devsecopslonghn/kelryvo/pull/105) fixed a confirmed provider
defect that dropped the governed execution target before private authorization/binding.
It preserves a detached frozen target and rejects changed or non-finite target facts.
Independent review, 62 focused host/provider tests and the complete local check passed;
hosted checks passed before merge `f0a1fe2e843ca9810e15fc34acf13d25a665ecd4`.

A bounded failure run also exercised one real invalid-password attempt, missing
private Secret, mismatched expected version and retired connections. The missing-Secret
case reproduced an incorrect endpoint diagnostic; [PR #106](https://github.com/devsecopslonghn/kelryvo/pull/106)
now returns `SECRET_UNAVAILABLE` after route authorization. Independent review, 23
focused discovery tests, the complete local check and hosted CI passed before merge
`e00f4d48098bb98d3edf7d8d76f7063da71d500b`. The failed run remains retained;
the follow-up reran only remaining cases and confirmed good reader connectivity.

R1/R2 complete negative, visibility/concurrency and browser matrices remain incomplete.
At this follow-up checkpoint, R3/OA01–OA10 and Oracle worker/fault/recovery cases were
**NOT_RUN** as complete contracts. The private execution installation was still under review. Two scoped
application discovery fixtures remain; controlled drift was restored with acknowledged
DDL. The fresh worker schema was independently observed entirely empty after its
temporary discovery anchor was removed. Existing application privileges remain
unchanged, PVC free capacity remains 929 MiB, and the lab must remain for further work.

## Recovered execution checkpoint on 2026-10-14

[Sanitized checkpoint evidence](../../evidence/product/oracle-lab-qualification-20261014/r3-checkpoint.json)
records retained execution/review digests and new read-only observations. V1/V2/NOOP
execution records match their separately accepted installation reviews and started
within those reviews' validity windows. PR #107 merged the reader follow-up at
`dc5a97899c4ccfaf83c09aaaff8678f3041d61da`; its source tree matches the retained execution checkout.

V1 executed two approved CREATE TABLE statements. V2 executed only its two new
statements, preserving V1. The current purpose observer matched the full attested
database identity, four exact tables/columns and complete two-migration target chain.
Target history is unchanged from V2. Original approvals, ordered STARTED/ACK events
and two receipts per execution remain retained across application restart.

NOOP had already run before session recovery. It is **FAIL (private harness)**:
the worker checks EXACT_APPLIED postconditions before admission, but the private
adapter allowed only ADMITTED candidates. Its safe terminal state is HOLD under
PRODUCT_REQUEST, with zero attempts, statement events or receipts. No ledger entry
was duplicated and no Oracle SQL was replayed. The private state gate was corrected
and independently reviewed; its original module is retained. Changed module bytes
invalidate the previous installation review. No corrected worker was invoked.

| Case | Complete contract status | Verified scope / remaining boundary |
| --- | --- | --- |
| OA01 identity | NOT_RUN | Full identity reobserved; allowlisted mismatched writer route remains untested. |
| OA02 purpose isolation | PASS | Retained narrow grants, denial probes, distinct sessions and private resolver isolation within accepted purpose-role scope. |
| OA03 ordering/checksum | PASS | Governed V1/V2 effects, exact bytes/order, durable starts, acknowledgments and target/central receipts. |
| OA04 implicit commit | NOT_RUN | Separate marker/failing-DDL fixture is outside the CREATE TABLE-only manifest. |
| OA05 stream mutex | NOT_RUN | Direct real mutex/COMMIT probe passed earlier; governed route-alias concurrency is untested. |
| OA06 interruption | NOT_RUN | Manifest explicitly disables worker-kill faults. |
| OA07 network failure | NOT_RUN | Manifest explicitly disables network faults. |
| OA08 reconciliation | NOT_RUN | Bounded pre-admission HOLD submission, independent review, no replay authority and restart durability passed; ambiguous DDL/mutex retention is untested. |
| OA09 idempotency/history | NOT_RUN | Exact HOLD retry, changed payload/new-key denial and V1/V2 history passed; full state/incompatible-history matrix and successful NOOP remain incomplete. |
| OA10 recovery/audit | BLOCKED | App restart and immutable reconciliation/audit passed; execution metadata backup/restore and worker recovery remain incomplete. |

R4 verified application restart, durable V1/V2 receipts, reconciliation/decision
retention, audit immutability and current Oracle effects/ledger preservation. Original
supervised runs retained terminal receipts with child reaping. This is bounded
operational evidence, not full recovery readiness. The retained R3 metadata database
uses an `sf_r3_` name, outside the product native-backup authorization contract;
that contract was not weakened or the database renamed. Earlier reader-only
backup/restore evidence cannot establish migration-history restore acceptance.

The original held request remains untouched. Exact retries return it; changed payload
and replacement-key requests are rejected. A distinct reviewer retained HOLD using
the independent observation digest, with retryEligible=false and executionAuthority=false.
Continuation requires an owner/operator-reviewed disposition that respects retained
HOLD, fresh installation acceptance and separately attested fixture/fault scope.
The lab is **not safe to delete for acceptance completion**. No Oracle infrastructure
was changed or deleted; observed free PVC capacity remains 929 MiB, above the 512 MiB floor.

## Integrated lifecycle continuation on 2026-10-14

[Continuation evidence](../../evidence/product/oracle-lab-qualification-20261014/lifecycle-continuation.json)
records a fresh, independently qualified installation on the same authorized lab.
V1/V2 succeeded with two receipts each. Both the fresh NOOP and a browser-authored
request completed NOOP with zero statement starts, acknowledgments or receipts;
the four tables and complete target ledger remained unchanged. Original successful
effects and the original HOLD were preserved.

The redesigned UI delivered in [PR #109](https://github.com/devsecopslonghn/kelryvo/pull/109)
ran against actual Oracle-backed metadata: two-file SQL authoring, target validation,
immutable planning, assigned independent approval, separate deployer submission,
installed worker execution, history and audit. Two actual four-table observations
and an immutable browser-captured baseline were retained. Comparison remained
UNVERIFIED because foreign-owner visibility and multi-query consistency are partial.
The baseline survived reload and project reselection. Temporary scoped SELECT grants
were revoked after observation.

OA04 passed in a separate approved fixture: markers preceding both successful DDL
and one ORA-00955 response remained visible after same-session rollback. Different
observer/operator sessions independently recorded rows and object state. The first
attempt stopped before mutation on a harness identity alias error; its evidence remains.

OA10 passed using the supported disposable metadata naming contract. A native archive
of V1/V2/NOOP and the genuinely queued browser request restored to a separate database.
Joined evidence, prior audit rows, witness and predecessor links survived. The restored
generation remains RESTORE_HOLD and its queued copy became HOLD. Actual installed
worker gates declined all restored requests before any Oracle authority, route or
target call. Independent read-only verification matched archive and witness hashes.
The source was unchanged through restore and subsequently completed the browser NOOP.

OA06 now has real interruption and recovery evidence at both durable claim boundaries.
Independent observations retained an IN_FLIGHT ledger and the original central event
prefix; native lease expiry held each job and attempt at generation 1 without replay.
The first boundary retained zero migration receipts; the second retained one acknowledgment
and receipt. Both private controllers recorded failures, preserved below. Actual
queued, admitted and held API idempotency checks passed. An ambiguous admitted HOLD
was independently reviewed and retained through application restart with no retry
or execution authority.

OA08 also passed on 2026-10-15 with the exact interrupted stream mutex held.
Separate actual writer sessions declined both before and after independent RETAIN_HOLD;
self-review was denied. Application restart preserved the decision and held mutex.
Central events/receipts, target ledger and objects remained unchanged; no Oracle DDL
or DML ran. Only the owned holder explicitly released its mutex after verification.

OA07 executed the approved lost-ack fault once: the target remained IN_FLIGHT with only
statement 1 STARTED, T1 exists, T2 is absent, and central job/attempt are HOLD with
zero receipts. Independent read-only verification passed. The original controller
result remains FAIL because cleanup caused a false HOLD_PERSISTENCE_PENDING report.
PR [111](https://github.com/devsecopslonghn/kelryvo/pull/111) fixes that reporting
defect with a PostgreSQL regression; the ambiguous request was never replayed.

OA01, OA05 and OA09 remain incomplete as full cases. R4 remains partial pending
governed alias concurrency, mismatched route and incompatible history coverage,
with the original OA07 full-case failure disclosed. The lab must remain intact. The continuation also discloses
one lost fresh V2 raw installation-probe artifact: original digests, independent
acceptance and effect observations remain, but the replacement is not original bytes.

OA06 preparation also exposed a review-gate incident: a helper imported an executable
provisioning entry point before independent review. Its isolated accounts, anchor and
ledger/mutex objects were created and retained; no migration worker ran. All logged
operations were acknowledged before an identity-shape assertion stopped preparation.
Independent read-only inspection confirmed the expected identity, narrow grants,
empty ledger, scoped valid objects and no residual owned sessions. The incident remains
unaccepted and the provisioner has not been replayed. A fresh read-only qualification
and independently reviewed future installation permitted the first-boundary worker
test; this does not retroactively approve the bootstrap incident.

The second-boundary recovery controller failed after native HOLD because its check
compared PostgreSQL Result and Array prototypes. Independent reads verified unchanged
values, ledger checksum and generation. Its original STARTED journal and missing
terminal receipt remain disclosed; recovery was not rerun. The first-boundary API
checker attempted metadata initialization while a worker transaction held a relation
lock. Only the identified owned initializer query was canceled; the supervisor reaped
the exact child and retained STOPPED_NO_REPLAY. A separate API check using the existing
schema passed admitted-state idempotency after reaping. Independent before/after
Oracle observations and native expired-lease recovery passed without a worker rerun.
The first native recovery also retained a separate PASS result and REAPED terminal
receipt; its exclusive one-shot guard journal remains STARTED and was not rewritten.

## Entry gate

Before even a connection, obtain a secret-free, owner-attested disposable-lab
manifest and explicit authorization. Before DDL, confirm the authorization includes
migration execution on the exact database/service/PDB/schema footprint. Discovery
permission alone is insufficient. Retain a digest of the approved manifest and
permission record outside public evidence. Never resolve credentials during offline
preflight or publish usernames, endpoints, secrets, raw connection errors or SQL logs
from the private lab.

From the engineering checkout, use
`npm run preflight -- --profile /absolute/private/lab-profile.json` for the
existing WP0 contract, which requires exact 19c/21c versions, disposable DEV routes,
TCPS identity/CA hashes, scoped credential references, entitlements, artifacts,
grants and separately permitted fault/teardown actions. A passing offline preflight
does not authorize connection or prove operational identity. Example profiles are
rejected as runtime authority. Do not weaken that contract to accommodate missing
inputs. If a different supported Oracle version is proposed, stop at that contract
boundary and obtain reviewed acceptance requirements before connecting.
The projected source installation bundle does not include the WP0 preflight command
or its offline lab artifacts; prepare this gate in the engineering checkout.

The product discovery manifest is a separate read-only contract documented in
[local-product.md](local-product.md). Its accepted discovery evidence cannot install
writer capabilities. Execution additionally needs the existing private installed-worker
factory, independently attested transport/identity/privilege/dispatch authorities,
target ledger and mutex. No public API accepts raw writer credentials.

Required private inputs and evidence:

- Exact observed DBID, DB unique name, resetlogs incarnation, CDB flag, container
  ID/GUID/DBID, PDB name, service and version, plus exact schema owner and deployment
  login. Compare observed values against the attested route before any execution.
- One external instance master reference reused for fixed discovery reads and approved
  exact-schema DDL, with its exact effective grants attested. The API has no access to
  its secret; discovery crosses the bounded internal Unix socket. Ledger/bootstrap/observer
  references remain installation-owned. Purpose-restricted discovery, writer and ledger
  capabilities stay separate; writer and ledger use distinct physical sessions.
- Allowlisted disposable objects, maximum statement count, byte/checksum manifest,
  retained plan/approval, migration namespace/lineage, execution permit lifetime,
  approved interruption points and exclusive test ownership. Use two migrations of
  at most two supported statements each, with a unique run prefix. Start with scalar
  CREATE TABLE; separately authorize scalar ALTER TABLE ADD and simple CREATE INDEX
  before qualifying those forms. Existing-table operations require exact-owner physical
  table witnesses; unsupported SQL, synonyms and foreign owners remain blocked.
- Narrow ledger/mutex bootstrap permission for the existing SQL in
  `apps/worker/oracle/`; permission for DBMS_LOCK and separate observer access.
  No global DBA/SYSDBA or broad ANY grants as a substitute for missing privileges.
- Explicit proxy/session-stop permissions and operator, bounded timeout settings,
  teardown owner and object allowlist. Without fault permission, leave fault cases
  NOT_RUN. Never induce faults outside the disposable sessions/routes.
- Metadata generation, source SHA, parser/driver pins, target identity digest,
  target/central ledger snapshots, statement checksums, audit and worker-exit evidence.
  Retain raw evidence privately; publish only sanitized summaries and trusted digests.

## Bounded cases

Run success and fault cases in separate fresh disposable schema/lineage footprints.
Do not reuse an ambiguous migration or clear HOLD to make another case pass. All
cases begin as NOT_RUN; change a status only after the listed live observations.

| Case | Action within authorized lab scope | Required observable result |
| --- | --- | --- |
| OA01 identity | Discover through the bounded master runtime; compare full identity tuple and exact owner; try an explicitly allowlisted mismatched route | Correct route retained; mismatch blocks admission with zero writer statement calls; identity evidence tied to manifest digest |
| OA02 purpose isolation | Inspect attested master grants, separate process/session capabilities, cross-UID secret/proc denial and negative discovery/SQL-scope probes | API cannot read the master secret; discovery admits only fixed SELECT operations; approved unsafe/foreign-owner SQL cannot dispatch; writer has no unapproved protected-ledger authority. The master account's DDL grants do not turn discovery into a writer |
| OA03 ordering/checksum | Independently approve the bounded CREATE/ALTER ADD/INDEX migrations explicitly included in the manifest and execute through the internal installed worker | Materialized parser order and checksums match approved bytes; durable STARTED precedes each call; exact-owner physical effects and receipts match both target and central journals; unsupported forms stay blocked |
| OA04 implicit commit | In a separate disposable fixture, place an approved uncommitted marker before successful DDL, then roll back the same session; repeat with an approved failing DDL | Independent observer records actual Oracle commit behavior and object/marker state; no rollback promise or inference from a failed DDL response |
| OA05 stream mutex | Request an accepted physical container through two allowlisted route aliases and independently installed test workers, including distinct assigned schema streams | At most one writer enters the container; canonical mutex spans DDL implicit commits on the same writer session; stream partitions retain their own history and second dispatch cannot overlap |
| OA06 interruption | Stop only the owned worker after STARTED and once after confirmed statement 1 before statement 2 | Confirm child/session termination and target observations; expiry recovery retains uncertainty in HOLD; no statement 2 dispatch or automatic reclaim/replay |
| OA07 network failure | Fault only the approved proxy/session during DDL or receipt acknowledgement | Lost acknowledgement is UNKNOWN/HOLD even if object exists; independent ledger/object inspection preserved; no reconnect-and-retry of the ambiguous statement |
| OA08 reconciliation | Submit externally retained target observations/ledger digest and review as a distinct approver | Evidence and independent decision survive restart; self-review denied; HOLD, retryEligible=false and executionAuthority=false persist; review does not release mutex or infer effects |
| OA09 idempotency/history | Repeat the exact request key; try changed payload/key while queued, admitted or held; inspect subsequent fresh migration history | Exact retry returns original request; changed payload rejected; held stream prevents replacement/replay; applied history checksums and lineage preserved, incompatible history blocks |
| OA10 recovery/audit | Restart app/worker; back up metadata and restore to a separate disposable database using witness | Joined plan/approval/admission/events/receipts/target history survive; restored metadata stays RESTORE_HOLD; no writer dispatch from restored generation; audit records remain immutable |

The independent observer must distinguish **applied**, **not observed**, and
**ambiguous** per statement. Missing receipts do not prove absence. Never change an
ambiguous result to failure merely to permit replay. A missing live result is NOT_RUN;
a failed assertion is FAIL and remains evidence. Cleanup requires separately attested
teardown permission and must preserve private evidence before removing owned objects.

## Existing local preparation

`tests/oracle-host.test.mjs`, `tests/oracle-provider.test.mjs`,
`tests/oracle-target-ledger.test.mjs`, `tests/oracle-target-mutex.test.mjs` and the
Phase 5 product suites exercise these contracts locally. The supervisor, execution
service and metadata-recovery suites exercise interruption, worker ownership and
generation isolation. These are regression prerequisites, never live Oracle evidence.

The remaining access gate belongs to the lab owner and database/security operators:
provide the attested disposable scope, explicit migration/fault/teardown permissions,
private purpose-scoped secret references and observed privilege/identity evidence.
Then a separately authorized acceptance run can execute this suite and retain results.
