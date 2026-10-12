# Kelryvo Architecture Migration Plan

**Status:** Final additive migration blueprint, 2026-10-12. No database or application changes were made. Stages 1 and 3 together implement roadmap M1 (target-bound planning); Stage 2 is roadmap M2 (inventory and assignment UX); Stages 4 and 5 are externally gated future work.

## Goals and constraints

Move from project profiles plus provisional workspace references toward workspace-owned Oracle infrastructure with explicit project-schema assignments and target-bound plans. Preserve all existing projects, source, approvals, plans, audit, offline history, requests, attempts, and evidence. Keep Oracle execution and new production rollout disabled. The future identity matrix is single-instance CDB/PDB and non-CDB, each requiring separate authorized lab acceptance; RAC, Data Guard, cloning, restore automation, and PDB relocation execution stay deferred.

### Non-negotiable invariants

- Every legacy plan and history record keeps its original identity, source digest, decision, and `NOT_EXECUTED` / `NOT_OBSERVED` meaning.
- Existing profile rows remain immutable snapshots. New configuration never silently changes an old profile’s host, service, owner, or credential reference.
- Existing registration UUIDs remain manual catalog IDs. They are not converted into DBID, CDB, PDB, or attested identity values.
- A physical database/PDB is workspace-owned. One schema has at most one active project assignment; one PDB may serve many projects through different schemas.
- Assignment transfer is temporal and revisioned. It closes an old interval and creates a new one; it never rewrites prior records.
- No automated backfill infers schema assignment, environment, Oracle target, applied migration, approval intent, or owner from names, audit facts, profile strings, or project history.
- Target assignment change, identity mismatch, or unknown DDL result blocks execution. No automatic replay or hold release.
- Each additive migration is restartable, has a preflight/report mode, and records counts and exceptions. Destructive cleanup is a separate owner-approved future operation.

## Current-to-target mapping

| Current record | Treatment | Target role |
|---|---|---|
| `sf_organizations` and fixed `ORG` | Retain | Single workspace boundary for current product. |
| `sf_projects` | Retain | Workflow/source owner; not physical infrastructure owner. |
| `sf_environments` | Retain | Project workflow environment definitions. Reference exactly one from each target-binding revision after explicit mapping. |
| `sf_profiles` | Retain unchanged as legacy snapshots | Existing project/environment endpoint and opaque credential-reference selections. Do not use them as proof of target identity. |
| `sf_reference_databases` | Retain; label manual/provisional | Workspace physical estate catalog key. Add separately observed identity facts when available. |
| `sf_reference_containers` | Retain; clarify container vs identity state | PDB/non-CDB catalog reference. Existing environment remains a hint. |
| `sf_reference_services` | Retain as route facts | Connection route to container. Normalize routing changes as new/versioned route facts rather than changing target identity. |
| `sf_reference_schemas` | Retain exact owner | Logical Oracle schema target and assignment subject. |
| `sf_reference_assignments` | Retain intervals/revisions/audit | Project-schema ownership history only. Do not put environment, route, identity, or SQL policy onto the ownership interval; link it to a separate immutable target-binding revision. |
| `sf_releases`, `sf_plans`, decisions, comments, `sf_history` | Retain byte-for-byte semantics | Historical offline governance records. New target binding applies to newly created plans. |
| Execution jobs/attempts/events/receipts | Retain | Requests and metadata evidence. No conversion into actual applied history. |

## Record-by-record compatibility and migration rules

| Existing representation | Target representation / schema work | Backfill and validation | API, UI, and authorization compatibility | History, rollback, and required tests |
|---|---|---|---|---|
| Organization and project records (`sf_organizations`, `sf_projects`, source binding fields) | Keep identifiers and rows; workspace remains the organization boundary. Add no tenant conversion in this migration. | Inventory IDs, archived state, source binding generation. No creator/audit inference for grants. | Existing project URLs/API IDs continue to work. Project list/detail remain membership-scoped; target admin is separate. | Never rewrite project IDs. Previous app versions can read unchanged rows. Test archive/read, memberships, source binding, and referential integrity. |
| Project grants, actors, credentials, account/operator audit | Preserve fixed actor IDs/roles, credential digests/revocations, explicit grants, and audit. Add workspace/inventory operator authorization only as a separate explicit authority. | Validate active grants and referenced actors; do not synthesize grants from creator or audit rows. | Existing local token/session and project access checks remain. New infrastructure writes are operator-only unless a later policy is approved. | Credential revocation and grant revocation are not auto-reversed. Test stale token, revoked membership, cross-project lookup, and recovery authority. |
| Project environments (`sf_environments`) | Retain project environment IDs. A separate immutable target-binding revision references exactly one environment; do not put the FK on `sf_reference_assignments` or inherit the container label. | Candidate mappings can be reported by exact project/environment name only. Apply requires an operator-reviewed manifest; unmatched/ambiguous assignments stay unbound. | Existing environment API/UI continues. New target selector requires explicit mapping and reports unbound. Auth remains project grant for read, developer/operator for mutation per contract. | Existing profile/environment references remain. Rollback drops no mapping facts; tests cover duplicate names, no-match, ambiguity, and binding revision invalidation. |
| Project connection profiles (`sf_profiles`, `credential_ref`) | Retain immutable profile snapshots. Add a separate workspace route/config model with purpose enum and revision; do not transfer profile IDs or mutate endpoints. | No automatic profile-to-route matching. Produce a candidate report on endpoint/service/user equality; require explicit reviewed linking. Keep `UNBOUND` otherwise. Never resolve/print secret contents. | Legacy plan/profile endpoints and exports continue read-only. New target-bound API accepts binding ID, not arbitrary endpoint or username. Restrict credential reference fields and return a safe alias to project users. | Profile ID remains valid for historical plans. Retirement remains permanent; config revision changes stale new intent. Test legacy detail compatibility, field visibility, retirement, and request invalidation. |
| Manual references (`sf_reference_databases/containers/services/schemas`) | Keep current rows as `MANUAL_REFERENCE`; add immutable observed identity and route revisions alongside, with explicit match link/status. | Never map random registration UUID to DBID/PDB ID. Identity observation creates a new fact; conflicts are retained and marked unresolved. Validate keys, hierarchy, provenance, route-to-container cardinality. | Existing project schema-reference GET remains. New workspace inventory API/UI is operator-scoped. No live health/discovery shown until observed. | Preserve registration UUIDs and external references. Identity link is a forward-only provenance event; rollback leaves evidence and returns status to unresolved. Test restartability, conflicts, route aliases, and foreign-scope access. |
| Schema assignment intervals and operator audit | Keep IDs and closed/open intervals as ownership only. Add a separate immutable target-binding revision table with optimistic expected revision. | Active uniqueness applies to schema assignment. Do not backfill target environment or infer owner. A reviewed manifest may explicitly create a binding referencing one project environment and attested/provisional target facts. | Existing project reference read remains. Operator CLI stays functional through an adapter; later API writes require explicit operator authority. Project selectors show only current assignments and binding. | Never reopen/delete old intervals during rollback. New transfer is an audited forward action. Test transfer races, archived project behavior, idempotency, binding revision changes, and plan/job staleness. |
| Repositories and releases (`sf_releases`, retained manifest/files) | Keep all IDs and immutable payloads. No release rewrite required. New target plans refer to existing release ID and verified manifest digest. | Validate digests on read/use; never infer repo state from an unavailable provider. | Existing release API/UI and links remain. Target selection is added to plan creation, not release import. Current project grant continues. | Preserve commit/folder/manifest facts and plan references. Rollback leaves releases untouched. Test legacy release read/compare and target-bound plan creation from same release. |
| Plans, approvals, comments, reviewer assignments, revocations | Keep legacy plan rows and intent format. Add a versioned target-bound envelope for newly created plans; nullable target-binding reference means explicitly legacy/unbound. | No backfill. Do not infer target from profile host/service or current assignment. Preserve approval, actor, reason, timestamp, digest, comments, and revocation facts byte-for-byte. | Existing plan URLs and records continue; UI labels legacy plans as offline/unbound. New approval screen shows bound target/revision. New plan ID is required after target change. | New intent format is forward-only. Rollback can display new rows read-only; cannot strip binding from approved plan. Test old/new serialization, approval digest, transfer staleness, and immutability. |
| Execution jobs, attempts, events, proofs, receipts | Retain journal IDs/revisions and state. New admissions capture target-binding revision and identity digest in separate proof facts. | Do not convert `WAITING_VALIDATION`, `HOLD`, synthetic attempts, or receipts into Oracle execution. Validate all current jobs against current state without changing them. | Existing records/read/cancel APIs remain; no job gains execution by migration. New worker uses only trusted binding snapshots and purpose-specific credential reference. | Never reset attempt count, retry, or clear HOLD on rollback. Test old event projection, admission rejection of legacy plans, stale binding, and synthetic labels. |
| Migration history (`sf_history`) and audit journals | Preserve existing rows and meanings. Add a distinct applied-history/target-ledger record only after Oracle observation and verified worker receipt. | Existing `NOT_EXECUTED`/`NOT_OBSERVED` stays exact. No baseline inference from release version or current schema registration. Reconcile counts/digests before and after every migration phase. | Legacy history remains visible with clear offline label; future applied history is separately identified and target-scoped. Audit paging remains membership-protected. | Audit/history are append-only from product perspective. No migration deletes, rewrites, or normalizes prior actor/resource IDs. Test row snapshots/digest equality and append-only behavior. |
| External resource IDs and API references | Keep UUIDs and route contracts. New IDs are additive and explicitly versioned. Maintain old aliases/adapters while UI transitions. | Build foreign-key/reference report before constraints. Missing references remain unresolved and do not block historical reads. | Existing endpoints remain for current modules; new binding endpoints are additive and versioned. Avoid repurposing `/api/projects/:id` fields without compatibility review. | API consumers and bookmarks retain IDs. Removing an endpoint or changing ID semantics is a separate, explicit breaking release; test old client contract and all old routes. |

No blind data remapping is planned. Where exact candidate matches are useful, the migration should emit a signed/reviewable mapping manifest with source ID, proposed destination ID, facts used, reviewer, and apply revision. Missing/duplicate/ambiguous candidates remain unresolved.

## Staged migration

### Stage 0 — Product contract and baseline (read-only)

1. Use the finalized decisions in `KELYRVO_ARCHITECTURE_DECISIONS.md` and [Product Requirements](../product/KELYRVO_PRODUCT_REQUIREMENTS.md); this stage does not wait on ordinary product choices.
2. Capture a versioned export/count of current projects, profiles, references, assignments, plans, decisions, history, jobs, attempts, and receipts. Record database generation and timestamp. Do not export credential contents.
3. Run a dry-run inventory report: orphan references, duplicate logical route declarations, active assignment cardinality, archived project assignments, profile-to-assignment candidate matches, and environment name differences. Report candidate matches without applying them.
4. Keep all target bindings provisional until an isolated Oracle lab and purpose-specific principals are separately authorized.

**Exit:** planning contract recorded; baseline counts and constraint report available before any data migration; no Oracle authority assumed.

### Stage 1 — Additive identity and assignment facts

1. Add a versioned schema migration mechanism if continuing startup DDL is insufficiently reviewable; do not rewrite prior DDL behavior in this change.
2. Add identity-observation storage as an empty/additive capability with state `UNOBSERVED`; no Oracle observation is created in this stage. Keep `MANUAL_REFERENCE` intact. A manual record may be linked to a later observation only through an explicit operator-confirmed match record.
3. Add a versioned connection route/configuration model with explicit purpose and opaque credential reference. Represent endpoint/service changes as route revisions; keep physical target identity separate.
4. Add a separate `sf_target_bindings`-style immutable revision record linked to assignment, with exactly one current binding per active assignment. Each binding has one project environment, target-lineage/resource ID, observed-identity state/digest, route/config revision, SQL-scope policy revision, execution-principal reference, and creation/supersession facts. Assignment remains the ownership interval only.
5. Add constraints and indexes only after preflight confirms existing rows conform. Keep existing one-active-assignment-per-schema rule.

**Backfill:** initialize no observed identity and no executable target binding for legacy assignments. A binding row may be created only from an explicit reviewed mapping of the operator's container environment hint to a project environment, target-lineage/resource ID, route, scope policy, and principal purpose. It remains `PROVISIONAL` until Oracle identity is attested. If any dimension is missing or ambiguous, the assignment remains `UNBOUND`; no automatic backfill is allowed. Preserve the container environment field unchanged as legacy inventory metadata.

**Exit:** additive migration restartability verified; old row snapshot compares equal; all legacy records display an explicit unbound/provisional state; tests cover new constraints and rollback/restart.

### Stage 2 — Workspace catalog and project assignment views

1. Keep the workspace-wide inventory read/write surface in the existing trusted local operator CLI. Add only project-scoped read views for assigned targets; a global web inventory waits until the existing OS operator authority can be represented safely in browser authentication. Keep resource IDs distinct from Oracle identity observations.
2. Keep declare/assign/release/transfer operations under trusted local OS-operator authority for the initial product scope; do not add app-level workspace administration.
3. Add project views derived from current schema assignments. Show physical database/PDB and route labels without implying project ownership of the infrastructure.
4. Add explicit target-binding environment and route revision selection, separate from assignment transfer. Require reason, expected assignment/binding revision, and show affected plans/jobs. Environment changes create a binding revision; owner transfers close the assignment interval and require a new binding.
5. Hide credential references from ordinary project detail responses. Expose only a purpose-specific display alias where needed; retain opaque refs for trusted configuration screens.

**Backfill:** no copying infrastructure rows into project scope. No name-based profile-to-assignment association. Provide a human-reviewed mapping tool that produces a dry-run report and an auditable apply receipt.

**Exit:** a shared-PDB fixture displays separate schema assignments in the authorized project views; foreign projects cannot read or mutate assignment; transfer preserves prior interval and history; ordinary project views do not expose raw credential references.

### Stage 3 — Immutable target-bound plans (still non-executable)

1. Extend plan intent format version. For new plans, require project, release digest, schema assignment ID/revision, target-binding ID/revision, stable `stream_id`, Kelryvo target-lineage ID, observed identity state/digest, exact owner, route/config revision, environment, SQL-scope policy revision, and intended execution-principal purpose/identity.
2. Include all target facts in displayed plan review and approval digest. Existing plan format remains parseable as legacy `OFFLINE_CANDIDATE` and can never be silently upgraded.
3. At approval and request time, recheck project grant, deploy grant where relevant, release integrity, assignment revision, route revision, target state, and profile lifecycle. A changed target assignment makes the existing intent stale.
4. Add API/UI to choose from the caller’s current project assignments, with fixed nonleaking behavior for foreign/stale IDs. Do not accept arbitrary database/profile/owner strings as plan target.
5. Continue to produce `NOT_EXECUTED`/`NOT_OBSERVED`; this stage does not enable Oracle execution.

**Exit:** approval digest covers target binding; transfer/revision change invalidates request; foreign assignment IDs reveal no data; legacy plans and exports remain stable; no stage reports applied state.

### Stage 4 — Oracle discovery and identity acceptance

1. Implement a read-only Oracle adapter only for single-instance non-CDB and single-instance CDB/PDB. These are separate acceptance profiles. RAC, Data Guard, clone/refresh, restore automation/RESETLOGS recovery, and PDB relocation execution are unsupported and fail closed until separately specified and verified.
2. Verify returned DBID/DB_UNIQUE_NAME/incarnation, CDB/PDB GUID/DBID and parent, role/open mode, service/user identity, TLS, and effective grants against the approved binding before any DDL privilege is considered. Topology changes create new observations; they never silently mutate a binding.
3. Record observed metadata as immutable snapshots and compare against the manual catalog with drift state; never silently overwrite registrations.
4. Validate least privilege, TLS/network boundaries, secret resolution, service failover, and target mismatch behavior in an isolated lab.

**Exit:** authorized per-topology acceptance results and signed evidence; exact physical identity can be re-observed; mismatch fails closed; no discovery credential can execute DDL. Completing this stage does not turn on Oracle execution.

### Stage 5 — Execution ledger, serialization, and controlled pilot

1. Validate one exclusive target mutex per attested PDB/non-CDB under concurrent projects/schemas. Keep a same-session DBMS_LOCK across DDL implicit commits; separately validate any RAC-wide service failover behavior. Do not support Data Guard write-role failover until the old primary is conclusively fenced and a shared logical target lock/leadership contract exists.
2. Validate target identity and migration ledger/stream uniqueness under successful DDL, syntax/privilege errors, process crash, lost execute/commit response, database failover, target-ledger write failure, central receipt failure, external schema change, and Oracle restore/RESETLOGS.
3. Implement reconciliation and hold-release as a separate, dual-authorized operator workflow, bound to immutable evidence and target identity.
4. Pilot a non-production schema with known snapshot and reversible low-risk DDL. Keep automatic retry disabled. Expand only after an explicit acceptance review.
5. Convert a record to applied history only from a trusted worker receipt plus independently reconciled target ledger; preserve request and receipt records as evidence.

**Exit:** separately authorized target-specific security and recovery acceptance; no unresolved ambiguous state; concurrency proof; audited dual-authorized recovery. This planning document does not authorize a pilot, Oracle execution, or production deployment.

### Migration stream and baseline rules

- Create an immutable `stream_id` for target lineage + exact schema owner + migration namespace. The stream ID is not the project ID or assignment ID. Enforce unique `(stream_id, canonical_version)`.
- Same version/same complete source and statement digest is a candidate no-op only after independent ledger and target verification. Same version/different digest is a hard conflict/HOLD. Reject digest reuse at another version by default; repeatable migrations require an explicitly designed type.
- Ownership transfer preserves stream, version prefix, checksums, approvals, ledger and history. Require no active/ambiguous attempt, old-owner release, new-owner acceptance, and trusted operator transfer. If the old owner cannot release or the evidence is ambiguous, HOLD the transfer; only a separately authorized two-person recovery decision can resolve it.
- Clone creates a new target lineage and cannot inherit applied authority; target-side copied ledger is untrusted until separately baselined. Restore creates a new validity epoch; any rewind/divergence holds. Relocation continuity requires a verified handover and retirement of the source route.
- Empty adoption requires an exact target attestation plus independently verified empty schema and no in-flight external change. A missing/UNINITIALIZED ledger is not evidence of emptiness.
- A non-empty baseline is an explicit signed/approved manifest with target identity, exact schema owner, object/privilege snapshot digest, initial stream/version, known unmanaged objects, source provenance, reviewers, and reconciliation report. It records `BASELINED_AT_VERSION`; it never fabricates per-migration receipts or changes legacy `sf_history`.

### Minimum offline end-to-end acceptance gate

Before any Oracle execution implementation or pilot, prove this complete local path using only disposable PostgreSQL, local/allowlisted Git, and an offline or synthetic host whose scope remains `UNIT_SYNTHETIC`:

1. Import an immutable Git release; validate retained bytes and parser-derived statement digests.
2. Select a project assignment and a versioned target binding. It may be marked provisional; the plan must display and digest-bind that state and cannot claim target verification.
3. Independently approve the exact intent and create a durable execution request. With no trusted Oracle attestation/credentials, the API/worker must make zero Oracle calls and leave the request non-executable (`WAITING_VALIDATION` or a durable HOLD only when an attempt was actually admitted).
4. Transfer the assignment or change binding revision. The old plan/request must fail revalidation; no silent reapproval or retargeting. A new plan retains a clear link to the same target stream where applicable.
5. Verify project/foreign-target authorization, audit events, release/plan/request records, and byte-for-byte preservation of legacy plan/approval/history rows.
6. Simulate timeout, worker restart, lost receipt, and metadata lease expiry. Every ambiguous case remains HOLD and no test double can promote itself to `TRUSTED_VALIDATED`.

**Gate:** focused API/browser/PostgreSQL tests and a documented evidence bundle pass. This gate is not Oracle validation and does not permit DDL. Only after it passes may the separately authorized Oracle discovery/identity work start.

## Compatibility matrix for application rollout

| Component combination | Required behavior during additive rollout |
|---|---|
| New database schema + old API | Old API may read legacy records. It must not be exposed as an execution-capable deployment while new target binding is mandatory; use a feature gate or drain old API before accepting target-bound requests. It may not create an executable plan without binding. |
| New API + old frontend | Keep existing endpoints and response fields stable. Legacy UI may create/view only explicitly offline legacy plans; API must reject target-executable status without a bound format. Upgrade UI before activating target-bound planning. |
| New API + new frontend | New target fields are additive/versioned. UI distinguishes provisional/observed identity and binding revision; unknown fields and foreign resource IDs fail closed. |
| New API + old worker | Old worker cannot claim new target-bound format or trusted scope. Do not route such jobs to it. Drain/disable old workers before turning on the new admission gate. |
| New worker + old plan rows | Historical and approved legacy plans remain readable, but are non-promotable and non-executable. Worker rejects missing binding/stream/identity rather than reconstructing from profile or current assignment. |
| New worker + new API/schema | Worker validates envelope version, binding/assignment revision, full observation, SQL scope, target mutex, history and permits. Capability negotiation is explicit and version-pinned; no optimistic fallback. |

Expand/contract ordering: add new nullable tables/keys and indexes; deploy read-compatible API/UI; populate only explicitly reviewed provisional binding records; turn on the new-plan envelope; keep existing workers disabled from target-bound/Oracle execution; then enable non-executable target-bound plan workflow. Oracle execution remains disabled until separate identity, runtime, and recovery gates pass. Rollback keeps new facts and IDs, disables target-bound writes/execution, and serves retained records read-only. It never drops the binding schema or rewrites approvals.

## Rollback and operational recovery

- Application rollback must keep additive columns/tables readable by the previous version; do not remove identity facts or intervals on rollback.
- A failed backfill stops at the last committed batch and resumes by stable row key. It must never partially retarget plans.
- If new target-bound planning is rolled back, newly created plans remain immutable records with their new format and are read-only; do not strip their target facts.
- If identity observation conflicts with manual facts, retain both and mark conflict/HOLD. Operator review links or rejects the candidate; no update-in-place.
- If assignment transfer has occurred, rollback does not reopen or delete the old interval automatically. A new transfer is required and audited.
- Any worker or database ambiguity leaves the job in HOLD. Recovery is a separate workflow and cannot replay SQL by default.

### Changes that are not safely reversible

- A target identity observation is historical evidence. Do not erase it on rollback; mark the observation superseded/conflicted and add a later fact.
- An assignment transfer closes an ownership interval. Do not reopen it automatically; a new transfer is required.
- Approval, revocation, worker attempt, receipt, and audit events are append-only facts. Never delete them to simulate rollback.
- A new target-bound approval cannot be converted into a legacy profile-only approval. Roll back the application to read-only handling and require a new plan under the corrected version.
- An Oracle DDL effect cannot be “rolled back” by a metadata migration. Unknown outcome remains HOLD until reconciliation establishes state.

## Verification approach for future implementation phases

For each future implementation phase, use focused unit/API/browser tests, additive migration/restart checks, and explicit authorization matrix tests. Keep synthetic worker evidence labeled synthetic. Oracle-lab checks begin only after a separately authorized isolated target and bounded manifest exist; CI/test suites must never connect to production Oracle. Avoid broad CI reruns unless a concrete change requires them; use the repository's existing focused checks and report skipped Oracle gates plainly.
