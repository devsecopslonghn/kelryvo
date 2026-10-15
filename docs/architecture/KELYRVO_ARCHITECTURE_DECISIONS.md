# Kelryvo architecture and safety contracts

These decisions constrain implementation. [Product requirements and roadmap](../product/KELYRVO_PRODUCT_REQUIREMENTS.md) is authoritative for current delivery status and priorities. A contract here does not establish Oracle runtime acceptance.

## Adopted decisions

| Topic | Contract and tradeoff |
| --- | --- |
| Workspace and inventory | One server-owned workspace owns database/container/service/schema references. A project owns Git, environments, plans and reviews. Do not duplicate physical inventory per project or cascade archive into infrastructure deletion. |
| Exact schema ownership | At most one active project assignment per exact-case owner. Shared PDBs may serve multiple projects through distinct schemas. Assignment intervals preserve transfer/release history and never grant Oracle privileges. |
| Routes and configuration | Services are routes, not migration identities. Keep project/environment deployment profiles for compatibility and separately authorized workspace discovery connections. Configuration edits append immutable revisions; retained plans keep original facts. Project/browser projections use safe aliases rather than private references. |
| Environment | Each revisioned binding selects one project-defined environment and snapshots its name. Container environment is only an operator hint. No global rank, inferred target or automatic promotion ladder. |
| Target intent | Format-3 plans bind assignment/binding/option/configuration/policy/principal/identity/stream and retained source/statement facts. Currentness is separate from immutable approved intent. Changes invalidate future authority; they cannot retarget a plan. |
| Discovery | Manual declarations, observations, accepted identity and executable authority remain distinct. Observations are immutable, bounded and visibility-aware; fixtures cannot certify Oracle. Read-only discovery has a purpose-separated runtime and explicit lab gate. |
| Migration continuity | Stream identity follows lineage + exact owner + namespace, not project, profile, service or runtime member. Transfer cannot reset or clone applied authority. Live stream/adoption/baseline semantics still need acceptance. |
| Serialization | Serialize initial DDL per verified PDB/non-CDB across all projects/schemas, with a continuously held writer-session mutex and central governance locks. Conservative serialization trades throughput for safety. CDB-root and cross-schema administration are excluded. |
| Lifecycle and recovery | Reasoned configuration disable/retire and schema transfer preserve history and in-flight safety. Uncertain execution remains HOLD; no automatic replay or API clear-HOLD authority. Project archive retains reads and blocks new workflow writes. |
| Authorization | Fixed human developer/approver identities, trusted OS provisioning, current project grants and separate deploy grant. Independent approval is required. No inferred creator/admin/machine authority. |
| Deferred trust boundaries | Multi-tenancy, app-admin/invitations/SSO, machine identities, arbitrary query/data access, external Git/webhooks and broader Oracle topology require separately scoped contracts; none is implied by offline governance. |

## Compatibility and migration invariants

- Do not rename, rewrite, or infer historical plans, decisions, audit entries, comments, source releases, `sf_history`, execution jobs, attempts, or receipts.
- Retained project/environment profile revisions remain immutable historical configuration snapshots; new workspace routes or current profile edits do not silently retarget old intent.
- Existing manual database/container/service/schema rows remain labeled `MANUAL_REFERENCE` and provisional. A future observation creates linked evidence and a new identity state; it does not turn a random UUID into an observed Oracle ID.
- Existing schema assignment intervals remain authoritative for their recorded dates. New environment, target identity, or credential-purpose fields require additive migration and explicit backfill status.
- No migration step may mark a plan executed or history observed without independently verified target evidence.
- Preserve the single-active-project-per-schema invariant. Transfers close the prior assignment and create a new interval with optimistic revision checks and audit.
- Keep execution admission disabled until approved target binding, credential resolution, worker installation, physical identity, history, and lock contracts pass their separate acceptance gates.

## Oracle identity contract and topology handling

The architecture uses five distinct identities. They must never be represented by one ambiguous “instance ID.”

| Identity | Meaning | Stable across | Must not be confused with |
|---|---|---|---|
| Kelryvo resource ID | Workspace UUIDs for database, container, service route, schema reference, assignment interval, binding revision, and target lineage. These identify Kelryvo records. | Display-name, endpoint, and project changes unless an explicit new resource is recorded. | Oracle DBID, PDB GUID, or proof a connection reached the record. |
| Observed Oracle identity | Versioned, privileged observation of database/container identity plus role/incarnation and exact schema user. Includes observation time, adapter/version, and evidence digest. | Only when the observation contract establishes continuity. A mismatch creates a new or conflicted observation; never mutate the old one. | A host, service alias, `CON_NAME`, `CON_ID`, `SESSION_USER`, or caller-provided digest alone. |
| Service/endpoint route | Workspace-owned connect path and transport/TLS facts that can resolve to a database/PDB and runtime member. | DNS/listener/service updates when the resolved target is independently re-attested. | Target lineage or an Oracle service guaranteed to route to exactly one database. |
| Runtime member | RAC instance or Data Guard member that serves a connection at observation time. | RAC instance failover only if observed identity and primary/role policy remain valid. | Migration target or stream identity. |
| Migration stream | Immutable namespace for ordered application migrations on a target lineage and exact schema. | Project handover and a verified in-place route/CDB move that preserves the same logical PDB/schema lineage. | Project ID, release ID, environment label, connection profile, or assignment interval. |

### Identity key and evidence

The Kelryvo target-lineage ID is an operator-controlled surrogate with immutable history. It links one or more Oracle identity observations only through a separately authorized continuity event. Three values must remain separate: `targetLineageId` is the stable logical continuity record; `targetKey` is a canonical, versioned physical-container lock key derived by the trusted installation; `targetIdentityDigest` binds one full, time/version-scoped observation. They are not raw Kelryvo UUIDs or service strings. A route, RAC member, parent CDB, role, or restore incarnation can change the observation without silently changing the lineage.

A route revision names exactly one intended Kelryvo target lineage and an explicit set of allowed Oracle destinations for the accepted single-instance topology. A route that can resolve to unrelated target lineages is not executable. Connection-time service and actual destination observations are required; endpoint equality is never identity proof. RAC and Data Guard member sets are rejected in the initial scope.

For a **non-CDB**, the observation should include `DBID`, `DB_NAME`, `DB_UNIQUE_NAME`, database incarnation/resetlogs facts, database role/open mode, exact schema owner, service, and server version. For a **CDB/PDB**, include the CDB identity, PDB GUID and PDB DBID where available, parent CDB identity, container name for diagnostics, role/open mode, exact owner, service, and server version. `CON_ID` is a runtime/container-local observation, not a durable PDB key. The current session query in `packages/execution/oracle-driver.mjs` checks session user/current schema, `DB_UNIQUE_NAME`, `CON_NAME`, `CON_ID`, service, session ID, and proxy user; it does not itself read DBID or PDB GUID. `apps/worker/oracle-host.ts` delegates the physical identity/GUID/TLS/grant proof to the privileged installation's `attest` capability. Bounded disposable-lab installations have source-specific Oracle acceptance; this does not certify a general production installation.

Oracle documentation distinguishes DBID and Data Guard `DB_UNIQUE_NAME`; Data Guard members can share DBID while using distinct unique names. RAC instances share one database identity while services route sessions among instances. PDBs have GUIDs; documented PDB clone operations assign a new GUID. These distinctions support the model but do not establish Kelryvo's adapter correctness. See [Oracle DB_UNIQUE_NAME](https://docs.oracle.com/en/database/oracle/oracle-database/26/refrn/DB_UNIQUE_NAME.html), [Data Guard database identity](https://docs.oracle.com/en/database/oracle/oracle-database/19/bradv/reporting-rman-operations.html), [RAC services](https://docs.oracle.com/en/database/oracle/oracle-database/21/rilin/database-services-for-an-oracle-rac-database.html), and [PDB clone identity](https://docs.oracle.com/en/database/oracle/oracle-database/21/multi/multitenant-administrators-guide.pdf).

### Topology decision matrix

| Topology/event | Identity and stream treatment | Mismatch / execution behavior | Decision status |
|---|---|---|---|
| Non-CDB, stable database | One target lineage maps to observed database identity + exact owner. Incarnation is observed and included in validity/history evidence. | Any changed DBID, DB_UNIQUE_NAME, incarnation/resetlogs, role, owner, route destination, or grants makes observation stale/conflicted and blocks admission pending explicit continuity review. | Identity model READY; actual Oracle collection/runtime validation BLOCKED_EXTERNAL. |
| CDB/PDB | Logical migration target is PDB identity + exact local schema owner. Record parent CDB identity and runtime container facts in each observation. `CON_ID`/name is diagnostic, not sole identity. | Wrong PDB/GUID or parent not linked by approved move event => HOLD before dispatch. CDB root/common-user and cross-PDB work are outside schema scope. | Bounded Oracle 26ai Free single-PDB TCP lab acceptance recorded below; other installations, versions and topology behavior remain unqualified. |
| RAC | RAC nodes are members, not separate streams. RAC is not in the initial supported topology. | Reject RAC routes and any unrecognized runtime member; HOLD on a detected multi-instance destination. Reconsider only under a separate topology and lock-acceptance specification. | **DEFERRED**; no RAC support claim or acceptance in the initial product. |
| Data Guard switchover/failover | Treat each database member as a distinct target until a separately accepted role-group lineage and fencing contract exists. | Reject Data Guard routes and role transitions. Same DBID or service name cannot establish continuity; the current DBMS_LOCK cannot fence a former primary across independent sites. | **DEFERRED**; no Data Guard write/failover support claim in the initial product. |
| Clone / duplicate / refreshable clone | A clone is a new target lineage by default, even if it contains copied schemas and ledger rows. Keep any future source link as provenance; never inherit applied authority from a copied ledger. | Reject clone/refresh targets for execution. No automatic production stream on a clone; any later clone workflow needs a separate fork/baseline contract. | **DEFERRED**; no clone or refresh execution in the initial product. |
| Restore / point-in-time recovery / RESETLOGS | Restore automation is outside scope. A detected external restore, target rewind, changed incarnation, missing ledger tail, or central/Oracle divergence invalidates the observation and holds the target pending independent reconciliation. | Never roll central history backward, reuse an expired lease, or infer that the prior stream remains valid. No automatic dispatch after restore. | **DEFERRED** for restore automation; observed divergence remains HOLD. Any future automation requires separate lab acceptance. |
| PDB relocation / unplug-plug / move to another CDB | Relocation continuity is not assumed. A future handover would need before/after observations and old-route retirement; matching name or GUID alone is not enough. | Reject relocation execution and hold on a detected unexpected parent/identity change. Do not dispatch on the moved target under the old binding. | **DEFERRED**; no relocation continuity or execution claim in the initial product. |

Cloning, restore, switchover, and relocation require event records that identify the source/target resource IDs, before/after observation digests, operator/change authority, time/window, and reconciliation outcome. Until a corresponding event is accepted, any identity vector change is a hard mismatch. Oracle sources: [RMAN duplicate semantics](https://docs.oracle.com/en/database/oracle/oracle-database/26/rcmrf/DUPLICATE.html), [PDB identity and relocation](https://docs.oracle.com/en/database/oracle/oracle-database/18/multi/multitenant-administrators-guide.pdf), [PDB relocation procedure](https://docs.oracle.com/en/database/oracle/oracle-database/18/multi/relocating-a-pdb.html), and [Data Guard role transitions](https://docs.oracle.com/en/database/oracle/oracle-database/21/dgbkr/using-data-guard-broker-to-manage-switchovers-failovers.html).

## Schema assignment, environment binding, SQL scope, and principals

**Decision:** keep the ownership assignment and executable target binding as separate immutable records. Assignment says *which project owns the schema workflow during this interval*. Binding says *which target observation, route, project environment, SQL scope policy, and execution principal revision a new plan targets*. The assignment has one current binding pointer; each binding revision is immutable and exactly one environment is selected. A binding change never rewrites prior plan facts.

### Cardinality and lifecycle invariants

- A physical non-CDB/PDB may host many schemas. Each schema has zero or one active project assignment. No assignment means no project plan can select that schema.
- An active assignment belongs to exactly one project, one Kelryvo schema resource, and a bounded interval. Transfer closes it; it does not edit its project ID.
- Each route/config revision targets one logical lineage for a single-instance non-CDB or CDB/PDB and binds to an allowed destination. RAC and Data Guard member sets are rejected in the initial scope; future support requires a separate topology/fencing specification and lab acceptance.
- An active assignment has exactly one current target binding. A binding has one project environment, one target-lineage/identity observation state, one route/config revision, one allowed SQL scope policy revision, and one instance master credential revision used through purpose-restricted discovery and execution capabilities.
- A schema cannot be active in two project environments simultaneously. Environment reclassification creates a new binding revision, not a second live assignment. There is one canonical environment per target binding; aliases and rollout waves are deferred.
- Binding change, target mismatch, credential/principal change, policy change, or assignment revision change invalidates pending approvals/requests for execution. Previously approved immutable facts remain readable and are marked stale; no automatic reapproval.
- Only workspace operator authority registers physical resources/routes and creates/transfers assignments. Project membership permits project workflow and visibility; it grants no Oracle privileges. Keep this authority on the trusted local OS operator path; a web operator role is deferred until its authentication boundary is separately defined.

**Why environment belongs on binding:** environment is an interpretation of a project-to-target relationship and can change without changing physical schema ownership; target identity/route can change without changing project environment. Putting it on the assignment conflates these lifecycles; putting it only on a container cannot represent two projects' distinct release stages within a shared PDB. A separate binding revision records each target/environment/route combination reviewed by a plan. The existing container-level label continues only as legacy estate classification until mapped explicitly.

### Ownership is not SQL authority

An assignment does not grant DDL privileges. It scopes project governance and selected schema identity. Execution authority is independently granted to an installed worker permit and Oracle execution principal, with least privilege and verified effective grants. The principal/user must be bound in the plan's approved digest and observed session (`SESSION_USER`, `CURRENT_SCHEMA`, `PROXY_USER` plus install-attested grants). `CURRENT_SCHEMA` alone does not prove object privileges.

A project may own multiple assigned schemas. Each migration plan and stream targets **one assigned exact schema**, using the instance master credential. Allow only parser-produced operations whose resolved object owners are the assigned exact-case schema; reject unresolved or dynamic owner resolution. Reject cross-schema object changes, `ANY`-scope DDL, public/common objects, database/CDB/PDB administration, users/roles/grants, database links, directories, tablespaces, jobs, `ALTER SYSTEM`, and all CDB-root/common-user operations. No cross-schema or database-level exception is part of this product baseline. SYS/SYSTEM, common and protected Oracle owners are prohibited. A master account may have the explicitly attested DDL privileges needed for assigned schemas; full DBA authority is unnecessary. The fixed SELECT discovery process and the approved-statement worker restrict operations independently of the account's grants. CURRENT_SCHEMA is name resolution, never a security boundary.

Historical purpose-separated-account evidence remains dated evidence; it does not constrain new instance onboarding to multiple user-managed credentials. The initial SQL policy is fail-closed: parser or owner-resolution uncertainty is unverified and blocks admission. The [recorded master workflow acceptance](../../evidence/product/instance-master-workflow-20261015/acceptance.json) proves exact-schema scalar CREATE TABLE execution, principal grant checks and writer/ledger separation for the specified Oracle 26ai Free single-PDB TCP lab and source revisions. Other installations, SQL forms and topologies require their own runtime acceptance.

## Instance master credential model (2026-10-15)

One workspace connection per registered Oracle PDB/non-CDB holds the active master
credential **reference**. The secret remains in the private runtime resolver. Connect
before declaring schemas, discover exact owners, then let a workspace database manager
assign several accessible owners to a granted project. Reusing an instance in another
project appends a connection association; it never transfers schema ownership. Ordinary
project members see only assigned owners. Immutable discovery claims deduplicate physical DB/PDB identity across route aliases and survive master retirement. A container cannot silently retarget another database. Unsupported SID/root/topologies remain gated.

Deployment profiles are derived immutable credential snapshots linked to the exact
instance revision, retaining compatibility with existing plan formats. Users configure
one credential, not a credential per schema or purpose. Master configuration/lifecycle
changes permanently stale dependent profiles/plans, including change-and-restore.
Legacy separate profiles and old plans remain readable; automatic conversion is absent.
Internal ledger and observation authorities remain installation-owned, isolated from
API/browser, rather than additional application credentials users must manage.

Automatic dispatch requires both the pinned Oracle parser and a complete conservative
scope grammar: scalar CREATE TABLE, scalar ALTER TABLE ADD columns and simple local
CREATE INDEX. Expressions, CTAS, dynamic/procedural SQL, DML, triggers, synonyms,
database links, grants/admin and all other syntax are blocked. Literal defaults and
NOT NULL are supported; constraints and richer expressions need later scoped acceptance.
Validation surfaces the block, materialization rejects unsafe approved bytes before
opening Oracle, and the held writer rechecks immediately before ledger START/dispatch.
Existing-table operations require an exact-owner physical TABLE catalog match and never
follow synonyms. The trusted installation must exclude concurrent external DDL and
unreviewed database/schema DDL triggers; the application mutex does not fence other tools.

Oracle service names are case insensitive; configured route spelling may differ only in case from the attested observed service. The full observed identity remains exact ([Oracle service naming](https://docs.oracle.com/en/database/oracle/oracle-database/26/cncpt/CDBs-and-PDBs.html)).

The writer verifies the login separately from the assigned CURRENT_SCHEMA on its
dedicated session. A safely quoted installation-owned ALTER SESSION sets only that
context. Master ledgers use stable stream partitions. The mutex key is derived from observed DB unique name, DBID, and PDB GUID (or non-CDB DBID), independent of service aliases, version and RESETLOGS. Metadata admission serializes the same physical container across master and legacy workflows and fails closed for unknown mixed scope. The mutex remains physical-container
wide. Reconciliation scopes completed history to the stream, while HOLD/in-flight vetoes
remain conservative. Existing physical ledger keys remain unchanged. An empty master
partition cannot ignore retained legacy history or adopt a nonempty target; explicit
history adoption remains outside this automatic workflow.

## Migration stream continuity and baseline

### Stream identity and uniqueness

Use a workspace-issued immutable `stream_id` bound to one attested target lineage, exact Oracle schema owner, and migration namespace. Its identity is independent of project, assignment interval, profile, route, placement, and environment. A target plan snapshots `stream_id`, target-binding revision, assignment revision, exact schema owner, approved migration source, version/checksum list, and current history digest.

- Version ordering is canonical and arbitrary precision. Unique key: `(stream_id, canonical_version)`.
- Re-observing an already applied version with the exact approved checksum/statement manifest and receipts is a no-op only after independent history validation. Same version with a different source or statement checksum is a hard conflict and HOLD.
- Reuse of one content checksum under another version is rejected by default for versioned migrations; repeatable migrations, if required, need a distinct declared migration type and separate policy. A filename/path change does not create a new version identity.
- Project reassignment retains the same `stream_id` and full applied history. Transfer does not reset to version 1 or copy a second ledger. New project plans must select the next valid version and include full prior prefix evidence.
- Ledger partition identity is the stable `stream_id`; store target observation digests and lineage-continuity events as facts inside the stream. Do not partition the ledger solely by mutable service, RAC member, CDB placement, assignment, or full observation digest. Master `oracleTargetLedgerId` partitions by `stream_id`. Legacy separate-profile installations retain the historical physical-key/identity-digest partition unchanged; automatic history conversion is absent.
- A clone receives a different target lineage and cannot inherit production applied authority. A PDB relocation may preserve a stream only after an explicit, proven identity handover. Restore/RESETLOGS retains lineage provisionally but creates a new validity epoch and blocks work until reconciliation.

### Handover and baseline acceptance

**Project handover:** freeze new plan requests; require no active worker/attempt and no unresolved HOLD for the stream; export and hash the complete central and target ledger; require old-project independent approver release and new-project independent approver acceptance, plus trusted operator transfer. Preserve old plan, approvals, history, and assignment interval. If the old project is archived or cannot approve, block the transfer. There is no bypass in the initial product; a future recovery authority requires a separate two-person policy and evidence contract.

**Initial empty adoption:** `UNINITIALIZED` or an absent target ledger never means empty. A trusted host must verify the exact target identity and schema object inventory, effective grants, and no in-flight external work; a reviewed adoption record captures object snapshot digest, DB/PDB/schema identity, route, actor, time, tool version, and approver. A non-empty schema cannot use empty adoption.

**Non-empty baseline:** require an explicitly approved baseline manifest mapping current schema state to a chosen stream/version and checksums, full object/privilege snapshot, target identity, source repository/release provenance where available, unsupported/unmanaged objects, reviewers, and a reconciliation report. Baseline creates a `BASELINED_AT_VERSION` event, not fake per-migration receipts. Never translate legacy `sf_history` (`NOT_EXECUTED`) or infer applied migrations from filenames. Rebaseline/reset is forbidden as a user retry; it is a separately audited recovery event.

Baseline read APIs/metadata and operator views may be implemented offline, but baseline *acceptance* is `BLOCKED_EXTERNAL` until Oracle catalog inventory and effective grants are verified on an authorized target.

## Execution, locking, fencing, and ambiguous outcomes

### Lock model and worker lifecycle

1. **Metadata serialization:** retain PostgreSQL advisory/row locks around assignment, binding, grant, approval, request, and attempt transitions. Lock order must be documented and consistent: inventory/catalog serialization, physical assignment scope, global governance, then project/job rows.
2. **Physical serialization:** initial DDL lock is one exclusive lock per attested PDB/non-CDB. This serializes different project schemas sharing the same container. Database/CDB administration and cross-schema operations are rejected. PDB/non-CDB-wide serialization remains the default; lock narrowing is outside the initial scope.
3. **Oracle mutex:** private definer-rights `DBMS_LOCK` cover on the dedicated writer connection; acquire once with a private nonce and `release_on_commit=FALSE`; continuously prove current ownership using the existing handle (`CONVERT`), never reacquire after loss. Keep the same physical session through target identity checks, DDL, and receipt/cleanup. The protected ledger writer remains a different principal/connection. The application writer must have no direct/inherited DBMS_LOCK or broad/protected-ledger DML privileges. The master may hold only explicitly attested application DDL privileges. Oracle ANY DDL grants are broader than project scope: automatic execution relies on the complete exact-scope grammar, protected-ledger-owner veto, immutable central evidence and trusted installation controls against external DDL. The definer-rights cover supplies only the constrained mutex capability. Protected ledger head-row locks serialize append transactions, not Oracle DDL. Unknown commit poisons that capability without retry.
4. **Permit and fencing:** the installed short-lived write permit binds worker/job/plan/approval/intent/profile/statement digests and expires. The metadata claim uses immutable attempt generation and lease token. These fence central state writes but Oracle does not consume a generic Kelryvo fencing number. The actual non-overlap guard is the held Oracle session mutex plus one-use dispatch permit and private host-side continuity check. A lost mutex/session permanently poisons that operation; token renewal/reacquisition is not allowed.
5. **Restart/lease recovery:** a worker restart never reclaims an admitted attempt. Expired metadata lease projects `HOLD` only and creates no new attempt or Oracle call. If session termination or lock release cannot be established, retain HOLD. A later migration cannot start on the same target stream while any prior attempt has unresolved central or target-ledger state.
6. **RAC/Data Guard:** same PDB-wide mutex must be proven across RAC instances. Data Guard members are separate databases; a DBMS_LOCK on one member does not fence another member. Data Guard write failover is unsupported until old-primary fencing and cross-member leadership/lock design are validated.

Current source supports portions of this contract: `packages/execution/oracle-target-mutex.mjs` uses one same-session lock, nonce, and no reacquisition; `apps/worker/oracle-host.ts` re-attests identity and mutex through dispatch; `packages/database/index.ts` records immutable attempts/receipts; `packages/execution/postgres-jobs.ts` moves expired claims to HOLD; `apps/worker/run-request.ts` recovers expiry without replay; and `packages/execution/oracle-target-ledger.mjs` preserves ordered target history. Generic installations remain runtime-unvalidated; the recorded master workflow acceptance is bounded to its lab, source revisions and SQL forms. The existing target observation identity is installed/privileged and cannot be inferred from ordinary API metadata.

### DDL, ledger, connection loss, and external change

Oracle commits implicitly around DDL; a successful DDL cannot be undone by rolling back the following ledger write. Therefore target ledger `STARTED` must commit before each DDL call. A lost execute/commit acknowledgment, target-ledger append error after DDL, central receipt loss, postcondition mismatch, or lock continuity failure yields HOLD. No retry, connection replacement, `IF NOT EXISTS` guess, or client-reported success is sufficient. The ledger/central receipt chain is evidence and ordering, not proof by checksum that an effect occurred.

After a statement becomes ambiguous, require an independently authorized reconciliation operator to compare: target identity and session facts; complete target ledger including unresolved tail; immutable central attempt/receipt stream; actual object state/definition digest and relevant dependencies; grants/owner; and any database audit/change records. The reconciler appends a witnessed resolution (confirmed applied, confirmed not applied with proof, or manual repair/rebaseline) and cannot mutate original events. It requires two distinct authorized actors (one target operator and one independent governance approver) and a reason/change ticket. No automated service may clear HOLD based only on timeout/lease expiry or receipt absence.

Kelryvo locks coordinate only Kelryvo executions. External DBA/user changes bypass the application mutex. The initial execution policy requires an enforced maintenance/change-control window that prohibits out-of-band DDL for the target during admission and execution. If the environment cannot enforce that window, the target remains ineligible; an audit/control mechanism is not assumed as a substitute. Recheck a versioned schema/object/privilege snapshot before dispatch and after completion; any intervening unapproved change blocks or holds. Snapshot hashing is not a substitute for a complete and authorized discovery source. The recorded master workflow acceptance verifies the controlled disposable lab workflow; enforcement in other installations and the complete external-change/fault matrix remain unqualified.

Oracle documents that DDL issues implicit commits before and after execution and that `DBMS_LOCK` user locks can be named and released at session end. These facts motivate, but do not verify, the Kelryvo protocol: [DDL implicit commit](https://docs.oracle.com/en/database/oracle/oracle-database/19/tdddg/data-definition-language-ddl-statements.html), [DBMS_LOCK](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html). The current adapter's fake-driver and synthetic suites are not runtime proof.

## Implementation and compatibility

Target options, target-binding revisions and format-3 plan envelopes now exist in `packages/targets/` and `packages/migrations/offline-plan-intent.mjs`. Read-only connection observations exist in `packages/connectivity/`. Preserve the separation between declared references, observed identity and trusted execution authority. See [local product contracts](../development/local-product.md) for operator commands and API behavior.

- Expand metadata additively. Preserve resource IDs, original canonical envelope bytes, approval digests, assignment intervals, source, request journals and receipts. Never backfill historical identity or target authority by inference.
- HTTP `intentVersion: 2` is distinct from retained envelope format 3. Formats 1/2 remain readable under their original offline contract; they never gain target-bound authority automatically. Revision fields use canonical decimal strings where required by the existing protocol.
- Configuration and binding changes create new revisions and separately computed currentness; they do not rewrite retained plans or decisions. Changing away and back must not revive stale authority. Queued worker admission rechecks current revisions.
- Keep API/web free of deployment-writer secrets. Discovery uses a separately bounded read-only runtime; trusted execution uses private purpose-specific installation capabilities.
- A rollback must keep new records and expose unsupported formats read-only, rejecting mutation/admission it cannot understand. Do not drop evidence tables or decode unknown envelopes as legacy authority.
- Native backups verify the exact supported schema fingerprint before additive upgrade. Restoring metadata creates a new generation under persistent RESTORE_HOLD, revokes restored credentials and preserves journals. The browser cannot clear restore hold.
- Do not remove old binary/witness material needed to read an older supported backup. An incompatible downgrade must fail closed rather than discard new evidence.

## Verification boundaries

Source and local fixtures demonstrate product contracts; they do not prove Oracle privileges, DBMS_LOCK continuity, DDL effects, object validity, isolation or recovery. The [disposable Oracle suite](../development/oracle-acceptance.md) and [controlled execution guide](../development/controlled-execution.md) retain the live gates. RAC, Data Guard, clone/refresh, restore automation and PDB relocation execution remain unsupported until separately specified and accepted.
