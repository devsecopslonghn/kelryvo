# Disposable Oracle execution acceptance

Phase 6 live Oracle acceptance is **NOT_RUN**. Fixture discovery, UNIT_SYNTHETIC
workers, PostgreSQL tests and browser screenshots do not establish Oracle effects.
No Oracle lab manifest or migration-execution authorization was supplied for this phase.

This bounded suite uses the existing Oracle provider, target ledger and session
mutex. It introduces no deployment infrastructure. The lab owner supplies the
attested scope; a database operator prepares isolated disposable schemas and
accounts; an independent reviewer evaluates retained evidence. The application
operator installs the private trusted worker only after these prerequisites pass.

## Entry gate

Before even a connection, obtain a secret-free, owner-attested disposable-lab
manifest and explicit authorization. Before DDL, confirm the authorization includes
migration execution on the exact database/service/PDB/schema footprint. Discovery
permission alone is insufficient. Retain a digest of the approved manifest and
permission record outside public evidence. Never resolve credentials during offline
preflight or publish usernames, endpoints, secrets, raw connection errors or SQL logs
from the private lab.

Use `npm run preflight -- --profile /absolute/private/lab-profile.json` for the
existing WP0 contract, which requires exact 19c/21c versions, disposable DEV routes,
TCPS identity/CA hashes, scoped credential references, entitlements, artifacts,
grants and separately permitted fault/teardown actions. A passing offline preflight
does not authorize connection or prove operational identity. Example profiles are
rejected as runtime authority. Do not weaken that contract to accommodate missing
inputs. If a different supported Oracle version is proposed, stop at that contract
boundary and obtain reviewed acceptance requirements before connecting.

The product discovery manifest is a separate read-only contract documented in
[local-product.md](local-product.md). Its accepted discovery evidence cannot install
writer capabilities. Execution additionally needs the existing private installed-worker
factory, independently attested transport/identity/privilege/dispatch authorities,
target ledger and mutex. No public API accepts raw writer credentials.

Required private inputs and evidence:

- Exact observed DBID, DB unique name, resetlogs incarnation, CDB flag, container
  ID/GUID/DBID, PDB name, service and version, plus exact schema owner and deployment
  login. Compare observed values against the attested route before any execution.
- Separate opaque discovery, deployment writer, ledger owner and bootstrap/observer
  references; purpose-scoped grants and denied-operation results. Writer and ledger
  must use separate physical sessions. API processes must have no writer secrets.
- Allowlisted disposable objects, maximum statement count, byte/checksum manifest,
  retained plan/approval, migration namespace/lineage, execution permit lifetime,
  approved interruption points and exclusive test ownership. Use two migrations of
  at most two simple CREATE TABLE statements each, with a unique run prefix.
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
| OA01 identity | Discover with least-privilege account; compare full identity tuple and exact owner; try an explicitly allowlisted mismatched route | Correct route retained; mismatch blocks admission with zero writer statement calls; identity evidence tied to manifest digest |
| OA02 purpose isolation | Inspect narrow grants and use allowlisted negative read/write probes for discovery and writer accounts | Discovery cannot execute migration DDL; writer cannot acquire unapproved schema/ledger authority; API has no resolver access to writer references |
| OA03 ordering/checksum | Independently approve the two bounded migrations and execute through the installed worker | Materialized parser order and checksums match approved bytes; durable STARTED precedes each call; acknowledged effects and receipts match both target and central journals |
| OA04 implicit commit | In a separate disposable fixture, place an approved uncommitted marker before successful DDL, then roll back the same session; repeat with an approved failing DDL | Independent observer records actual Oracle commit behavior and object/marker state; no rollback promise or inference from a failed DDL response |
| OA05 stream mutex | Request the same physical stream through two allowlisted route aliases and isolated workers | At most one writer enters; canonical mutex spans DDL implicit commits on the same writer session; second admission/dispatch cannot overlap |
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
