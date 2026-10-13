# Controlled execution and recovery

In **Plans & review**, an independently approved plan can be requested by a
member with a separate project deployment grant. **Refresh readiness** checks
the saved intent, approval, source, target revisions, schema validation,
deployment permission and metadata generation. These are metadata checks;
queue eligibility grants no permission to connect to or execute on Oracle.
Oracle runtime acceptance remains **NOT_RUN**.

Requests retain the presenting credential, approval reference and exact intent
digest. Format 3/4 requests also prevent another queued, admitted or held request
on the same retained stream, including historical requests from another project.
Retries with the same idempotency key recover the original request. A changed
reason/key cannot bypass an active or held stream. Historical unbound requests
retain their earlier queue behavior and still require canonical target admission.

The installed worker reproduces the approved ordered statement bytes with the
pinned parser and verifies current approval, credential, deployment grant,
source, assignment, binding and validation evidence. Target-bound admission
requires observed identity; fixture observations cannot authorize a trusted
worker. The supplied host must independently verify physical identity, transport,
privileges, target history, target mutex and a separate dispatch permit. The
schema owner and deployment login are distinct identities and are checked
separately. Worker connection credentials stay outside the API service.

Admission proof, owned attempt and job transition commit before dispatch. Each
statement has a durable STARTED event before the target call and an acknowledged
outcome/receipt after confirmed effects. The existing Oracle adapter, checksummed
target ledger and session mutex handle nontransactional DDL. A dropped connection,
timeout, missing receipt, uncertain commit, expired attempt or interrupted
sequence enters HOLD. Missing evidence never proves a statement failed. Workers
do not reclaim or replay an uncertain attempt. Cancellation is available only
before admission; there is no rollback promise for Oracle DDL.

Completed-history reconciliation accepts retained statement intents in formats
2–4. Target-bound formats additionally verify the saved binding tuple and digest
against the captured identity evidence. Only an independently attested, matching
target prefix with complete retained receipts and validity evidence can support
skipping prior migrations; missing evidence remains blocked.

The plan view's **Incremental migration preview** compares the immutable release
with retained completion evidence and shows its exact ordered source SQL. The
read-only `migration-analysis` endpoint binds the plan intent, source manifest,
target and retained history in an analysis digest. Later SQL pages require that
digest; changed evidence requires refreshing the comparison. Existing bounded
SQL review identifies known risks without asserting semantic equivalence or
resolving unobserved object dependencies.
The preview verifies saved source ranges and hashes without reparsing the release;
the worker still independently reparses and verifies execution bytes at admission.

Completed rows describe retained receipts, acknowledgments and terminal validity
evidence, with their execution scope. They do not attest current target effects.
A NOOP candidate still requires independent target-ledger verification at worker
admission. Missing, conflicting or uncertain history blocks the comparison;
file-only legacy plans retain their evidence and require a fresh statement-bound
plan. Format 2 lacks an exact target binding, so its target history remains
unverifiable. Source, target or scope changes require a fresh independent review.
The preview performs no writes, grants no execution authority and cannot clear
HOLD or metadata recovery. Retained evidence is read from existing tables, so no
metadata migration or archive-format change is introduced.

**View execution history** shows attempts, statement progress, receipts and their
approved migration identities. Synthetic acceptance remains explicitly labelled
UNIT_SYNTHETIC, including retained success metadata. It does not verify Oracle.
**Download execution record** exports the existing checksum bundle; HOLD evidence
references are inspected separately in the reconciliation section.

## HOLD evidence and independent review

For a held request, a deployment-authorized member can retain an external
evidence SHA-256 digest, kind and reason. Keep the actual operator report, target
observation or ledger evidence in a separately controlled location. The API
accepts no SQL, credential material or raw evidence bundle. Submissions bind
the request revision, plan, approval, intent, admission scope and observed target
identity when admission evidence exists. Records are append-only and survive
metadata restart and native backup/restore.
New evidence and review rows also enforce their current held job, approved plan
and admission bindings in PostgreSQL. Exact review retries recover the retained
decision without adding another audit event; conflicting reviews stay blocked.

An approver distinct from the submitter, requester and plan author can record
**Retain HOLD** or **Record evidence reviewed**. Both decisions append audit
evidence and preserve HOLD. Evidence reviewed acknowledges a human review; it
does not attest target effects, release a worker lock, clear uncertainty, enable
retry or authorize SQL replay. Actual target reconciliation and any further
execution require separately authorized disposable Oracle lab acceptance and
trusted target evidence. No management API currently clears HOLD.
**Refresh evidence** loads other reviewers' decisions without clearing your input.
Stale requests require **Refresh requests** before another submission. Consolidated
migration history links reconciliation audit events to their retained job, plan,
release and target; audit facts alone cannot supply those links.

Metadata RESTORE_HOLD and project archive allow historical reads and block
reconciliation mutations. Backup restores retain evidence and decisions, then
keep restored metadata on its existing recovery hold. Phase 1–4 native archives
remain accepted only against their pinned schema signatures and upgrade to the
new reconciliation schema. Digests detect changed bytes against trusted copies;
they are not signatures or proof of physical Oracle effects.
Phase 10 archives retain their exact previous schema signature during import and
then gain the new insert guards. Current archives preserve evidence from projects
archived after review. The isolated restore database suspends only those insert
checks during historical import and enables them before returning the database;
immutable history guards and the recovery HOLD remain enforced.

## Verification

`npm run check` covers source, TypeScript, build, unit and dependency checks.
`npm run test:product` includes Phase 5 admission, readiness, reconciliation,
stream-conflict and native backup cases against disposable PostgreSQL.
`npm run test:browser` includes Chromium acceptance of preflight, queued requests,
statement HOLD, evidence submission, independent review and persistence after
restart, with desktop/mobile layout assertions.
Run parser-building unit checks before product acceptance; do not mutate helper
artifacts while product/browser tests use the pinned parser.

Real Oracle acceptance has not run. No execution capability is upgraded to
VERIFIED by mocks, fixtures, PostgreSQL acceptance or browser tests. No lab,
infrastructure deployment or live SQL execution is authorized by this workflow.
