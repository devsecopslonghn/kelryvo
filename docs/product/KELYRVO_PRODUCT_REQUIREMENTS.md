# Kelryvo Product Requirements

For the three-module Phase 1 increment, use the [Bytebase-first implementation contracts](KELYRVO_PHASE1_SPECIFICATION.md) and [pinned reference inventory](BYTEBASE_REFERENCE_INVENTORY.md). They supersede overlapping proposals here for that increment; this document retains the earlier requirement identifiers and wider recovery baseline.

**Status:** Final planning baseline, 2026-10-12. **Scope:** Product behavior and implementation contracts for the private Kelryvo Oracle migration-governance product. Documentation only; no application behavior is changed or authorized by this document.

## Source and traceability

This specification reconciles the existing product baseline, source, architecture decisions, immutable DB-Research snapshot, and the FR-001–035 / AS-01–30 identifiers retained in the feature gap analysis. The separately named `FUNCTIONAL_SPECIFICATION.md` and `BYTEBASE_FEATURE_RESEARCH.md` files are not present in this checkout. The requirement identifiers are preserved, but exact legacy wording cannot be independently compared in this pass. The outcomes below are the normative product wording going forward; they do not claim to be a verbatim replacement of unavailable files.

| Question | Source of truth |
|---|---|
| What works today and what was accepted | [MVP scope and feature matrix](../implementation/MVP.md) and [current product state](../implementation/CURRENT.md) |
| What the product must do | This document |
| What source and external evidence support each current classification | [Feature Gap Analysis](../architecture/KELYRVO_FEATURE_GAP_ANALYSIS.md) |
| Ownership, identity, target, and safety contracts | [Architecture Decisions](../architecture/KELYRVO_ARCHITECTURE_DECISIONS.md) |
| Page behavior, states, responsive rules, and design tokens | [UI/UX Design Specification](KELYRVO_UI_UX_DESIGN_SPECIFICATION.md) |
| Additive rollout and data preservation | [Architecture Migration Plan](../architecture/KELYRVO_MIGRATION_PLAN.md) |

The immutable research snapshot is reference material, not implementation evidence. No Stitch mockup was found in the checkout; this written specification does not claim visual acceptance.

## Product definition

Kelryvo is a private, self-hosted developer platform for managing Oracle schema change workflows. It helps teams retain the exact Git migration source, validate supported SQL offline, prepare immutable change plans, obtain independent approval, request controlled deployment, and inspect durable governance evidence.

The product is a change-governance workspace, not a general Oracle monitoring console. Projects organize migration source and review. Workspace-owned infrastructure facts are referenced through project schema assignments. A project or schema assignment does not itself grant Oracle privileges or execute SQL.

The repository reports an accepted, deployed practical governance MVP. It covers project access, environment and reference-only profile setup, local Git release import and parsing, immutable plans, independent review, durable deployment requests, audit/history, evidence downloads, secure sessions, and restore-hold visibility. It does not certify Oracle connection or DDL execution. The next product increment binds plans to explicit schema assignments and immutable target-binding revisions while keeping all plans offline. Oracle discovery and execution remain later, separately gated capabilities.

## Goals

- Preserve a simple single-workspace experience for a private installation.
- Make ownership legible: workspace owns infrastructure; projects own workflows; exact schemas are assigned to projects.
- Make every new plan identify the exact schema assignment and target-binding revision reviewed.
- Preserve immutable source, plan, approval, request, audit, history, attempt, and receipt evidence.
- Keep approval independent from authorship and deployment permission.
- Keep uncertainty visible and safe: unknown target or DDL outcome blocks admission and yields `HOLD`; no automatic replay.
- Provide a clean, light-first enterprise developer interface with dark-mode support and accessible states.
- Build only capabilities supported by current product requirements and a defined trust boundary.

## Scope and release boundaries

### Existing practical governance MVP

The current implementation baseline includes the workflows listed in `docs/implementation/MVP.md`. Preserve them as the compatibility baseline: local human sign-in, explicit project grants, project/environment/profile setup, manually declared and provisional schema references, local allowlisted Git import, release validation/preview/comparison, offline plan creation, independent decision/comment/revocation, durable execution requests and cancellation where safe, request/attempt inspection, project audit/history and record downloads, and metadata restore-hold feedback.

Existing project profiles are compatibility snapshots, not proof of an Oracle target. Their endpoint and credential-reference exposure must be narrowed as target-bound planning is introduced. Existing plans remain readable with their original meaning and cannot be silently upgraded or retargeted.

### Remaining target-binding MVP work

1. Add explicit project schema-assignment and target-binding views with revision and provenance.
2. Define a target-binding revision that selects exactly one project environment, route/config revision, scope-policy revision, and purpose-specific execution-principal reference.
3. Create a versioned, immutable plan envelope that binds release bytes and parser facts to the exact assignment, binding, schema owner, stream, and identity state reviewed.
4. Show the same target envelope on plan review and preserve stale/ineligible state when target facts change.
5. Keep target-bound plans and requests non-executable until separate Oracle acceptance and execution authority exist.

The workspace-wide inventory mutation surface remains the trusted local OS operator's CLI workflow. A broad in-app operator console is deferred until the existing OS operator authority can be represented safely in the web identity boundary. Project users receive only their currently assigned schema view.

### Explicitly deferred

- Multi-workspace tenancy, public SaaS operation, application administrator, invitations, configurable roles, SSO, and machine/service identities.
- Remote Git provider integration, webhook/callback delivery, and public third-party API guarantees.
- SQL query/data access, result masking, AI assistance, and arbitrary SQL execution.
- Shared-schema co-ownership, emergency approval bypass, configurable multi-stage approval, retry/skip, and general retention/export policy.
- RAC, Data Guard, cloning/refresh, restore automation, and PDB relocation execution.
- New production deployment or release promotion of planned changes.

## Roles and authorization

| Principal | Allowed product behavior | Limits |
|---|---|---|
| Trusted local OS operator | Provision/revoke local actors and explicit project/deploy grants; declare, assign, transfer, or release workspace schema references through the documented local operator path; perform documented metadata backup/recovery operations. | This is an out-of-band trust role, not an application administrator. No Oracle credential is inferred or resolved by the operator UI. No grant is inferred from project creation, audit, or history. |
| Developer with current project grant | Read the granted project; configure project workflow metadata; bind an allowlisted local Git source; import a retained release; create a new plan; comment; request/cancel deployment where separately granted. | Cannot change workspace inventory through the web app, self-approve, change another project's assignment, read unassigned resources, or resolve a secret. |
| Approver with current project grant | Inspect retained source, target facts, policy findings, comments, history, and approval digest; independently approve, reject, comment, or withdraw their own approval where allowed. | Cannot approve a plan they authored. Approval does not equal deployment permission or proof that SQL ran. |
| Actor with deployment grant | Create an execution request for an approved, current plan and inspect its retained status. | Deploy grant is separate from role and approval. The API creates a durable request only; a separately authorized worker is the sole future execution boundary. Current product requests remain non-executable without that boundary. |
| Project reader | Read data for explicitly granted projects, including retained plans, audit, history, and safe assigned-schema facts. | There is no separate auditor role in the initial model. Foreign-project and foreign-target identifiers must fail without revealing resource existence. |

Every project resource read and write rechecks the current actor credential and project grant. Revocation takes effect on the next request. Archived projects are readable but do not accept new workflow mutations. Workspace inventory reads are not exposed to ordinary project members.

## Domain and immutable contracts

### Ownership and cardinality

- One private workspace owns physical database/CDB/PDB/non-CDB references, service routes, credential-reference metadata, and operator audit.
- A project owns repositories/source bindings, releases, environments, plans, comments, decisions, and project workflow history.
- A schema is identified by exact case-sensitive owner within a verified target lineage. It has at most one active project assignment at a time. A PDB can host schemas assigned to multiple projects.
- Assignment is a revisioned ownership interval. It does not contain an environment, route, Oracle privilege, SQL-scope grant, or execution authorization.
- A target-binding revision refers to one assignment revision and exactly one project environment. It captures the environment ID and name snapshot, route/config revision, target-lineage reference, identity observation state/digest, exact schema owner, policy revision, execution-principal purpose/reference, reason, creator, and time. A change to the selected environment, its meaning, the route, or the target identity creates a new binding revision.
- Project environment names are project-defined. No global order, stage ranking, or implicit promotion ladder exists. A physical container environment label remains a legacy hint.

### Oracle identity and topology

- Manual reference IDs are Kelryvo resource IDs, not Oracle DBIDs, PDB GUIDs, service identities, or evidence of a live target.
- Keep separately: physical database identity, CDB/PDB or non-CDB identity, service route, RAC/runtime members when later supported, target-lineage identity, observation digest, and migration-stream identity.
- Initial topology intent is single-instance non-CDB and single-instance CDB/PDB, as separate acceptance profiles. Neither is considered supported for execution until the relevant Oracle version/topology has lab evidence.
- RAC, Data Guard, clone/refresh, restore automation/RESETLOGS recovery, and PDB relocation execution fail closed and remain deferred until each receives an explicit identity, continuity, lock, and recovery contract.
- A discovery credential is read-only and purpose-separated from a deployment credential. A secret provider reference is opaque metadata; the API and project browser never receive secret material.

### Migration stream and plan envelope

The stable `streamId` is based on a Kelryvo target-lineage reference, exact schema owner, and migration namespace. It is not based on project ID, assignment ID, profile, service route, runtime member, or environment. A stream created before Oracle observation is explicitly provisional; its ID is not proof of physical identity or applied history. Identity mismatch blocks the binding and requires an explicit new lineage/baseline decision rather than silently changing the stream. Assignment transfer preserves an established stream and its history. Clone/fork semantics are deferred; a new lineage cannot inherit applied authority by copying a ledger.

New plans use a versioned envelope. The client selects IDs/revisions from authorized server data and does not submit arbitrary owner, endpoint, or identity strings as trusted facts.

```json
{
  "intentVersion": 2,
  "releaseId": "<retained-release-id>",
  "assignmentId": "<current-project-assignment-id>",
  "expectedAssignmentRevision": 3,
  "targetBindingId": "<binding-id>",
  "expectedBindingRevision": 2
}
```

The server resolves and retains the complete immutable plan facts: project, release manifest/file/statement digests, assignment ID/revision, target-binding ID/revision, target lineage, exact owner, selected project environment ID/name snapshot, route/config revision, identity observation state/digest, stream ID and provisional/verified state, SQL-scope policy revision, intended principal purpose/reference, plan author/time, and intent digest. The approval digest covers the same envelope and the review decision.

`PROVISIONAL` identity can support offline review only. It cannot be represented as verified, executable, or applied. A future observation or route/environment/assignment change creates a new immutable fact; the existing plan is displayed as stale and requires a fresh plan. The old approval and plan remain intact.

### Execution and history

- Plans describe reviewed intent. Execution requests are separate durable records created only after independent approval and current permission checks.
- The current API/worker path does not connect to Oracle. Status must say `WAITING_VALIDATION`, `NOT_EXECUTED`, `NOT_OBSERVED`, or the actual retained request state; the UI must never infer success from a request, approval, receipt checksum, or missing error.
- If future execution is authorized, only a separately installed trusted worker resolves the deployment credential, rechecks the exact approved target, establishes the target lock, executes parser-approved bytes, and writes immutable attempts/receipts.
- The initial execution lock scope is one verified PDB or non-CDB across all projects and schemas. CDB root DDL is rejected. RAC locking is not assumed.
- Any timeout, transport/session loss, missing receipt, identity mismatch, target ledger uncertainty, restore hold, or uncertain DDL effect yields `HOLD`. Lease expiry may produce `HOLD`; it cannot establish fencing or permit takeover.
- Never automatically replay an ambiguous migration. No API request clears `HOLD`. Future reconciliation requires independent target/ledger/object evidence, two distinct authorized actors, a reason, and an immutable resolution event.
- Kelryvo coordination cannot prevent an external DBA from issuing DDL. If out-of-band DDL cannot be reliably excluded or detected, a target is ineligible for execution.
- Existing offline history remains `NOT_EXECUTED` / `NOT_OBSERVED`. Only accepted worker evidence plus independently checked target state may create future applied history.

## Functional requirements

The delivery column distinguishes the current implementation from the target requirement. Full source status and evidence remain in the feature gap analysis.

| ID | Reconciled requirement outcome | Delivery |
|---|---|---|
| FR-001 | Use one server-owned private workspace. Do not expose workspace creation or tenancy management in the initial product. | Current boundary; no multi-tenancy |
| FR-002 | Keep fixed human developer/approver roles and explicit project/deploy grants. Reject self-approval and recheck membership on every project resource. | Current baseline; operator provisioning remains out of band |
| FR-003 | Do not expose machine identities or service accounts in the initial product. | Deferred |
| FR-004 | Store physical inventory at workspace scope; project target views derive from schema assignments. | Manual catalog exists; target UX is next |
| FR-005 | Keep secrets external and references opaque; separate discovery/read/deploy purposes; ordinary project users see safe aliases only. | Current profile references need display minimization before target binding |
| FR-006 | Discovery must create an immutable observation and never overwrite manual facts silently. | Blocked on authorized Oracle lab |
| FR-007 | Assign exact schemas to at most one project at a time; permit distinct schemas in one PDB to belong to different projects. | Manual assignment exists; broader UX required |
| FR-008 | Physical inventory lifecycle is workspace-owned. Project archive never deletes or cascades into infrastructure. | Current project archive; inventory lifecycle remains bounded |
| FR-009 | Schema metadata sync and drift compare only observed snapshots, preserve prior snapshots, and report incomplete visibility as unknown. | Blocked on discovery |
| FR-010 | Archive a project as read-only while retaining history. Do not provide normal project delete/purge; restore is deferred. | Current archive behavior |
| FR-011 | Keep environments project-owned. Each immutable target binding selects exactly one environment; no automatic rank or inference. | Environment exists; binding is proposed |
| FR-012 | Import only allowlisted local Git mirrors by explicit commit/ref; retain full commit, folder, manifest, and file digests. | Current baseline; remote provider/webhooks deferred |
| FR-013 | Track migration version/checksum under a stable target-lineage/schema-owner/namespace stream. Project transfer does not reset history. | Current offline facts; target stream contract is proposed |
| FR-014 | Parse only supported Oracle syntax from pinned parser rules. Unsupported syntax is unverified and blocks executable admission. | Current parser is bounded; target-aware policy remains |
| FR-015 | Bind each new plan and approval to exact assignment/binding revisions, identity state, route, environment, stream, owner, and policy. | Critical proposed M1 capability |
| FR-016 | Review immutable source, checksums, parser output, dependencies, scope, and target evidence. Unknown/conflicting facts cannot pass. | Source validation exists; schema-aware checks await identity |
| FR-017 | Treat a plan as the immutable proposed change; treat an execution request as a separate durable object. A general business issue object is not required. | Plan/request exist; target facts are missing |
| FR-018 | Require one independent human approval. Keep configurable routes and promotion policy out of the initial scope. | Current approval baseline |
| FR-019 | Create requests only for approved, current plans with explicit deploy grant; an API request is not execution authority. | Current durable request path; target binding is missing |
| FR-020 | Execute only through a separate trusted worker after all external target, identity, permission, and runtime gates pass. | Disabled; no Oracle execution is accepted |
| FR-021 | Serialize DDL per verified physical PDB/non-CDB; lock/session loss fails closed. | Protocol source exists; Oracle behavior unverified |
| FR-022 | Preserve immutable request, attempt, event, receipt, and target-ledger evidence with explicit evidence scope. | Durable source exists; target semantics unverified |
| FR-023 | Support cancellation only before dispatch in the initial product. Defer retry, skip, and resume; never replay ambiguity automatically. | Safe cancellation exists; other actions deferred |
| FR-024 | Keep ambiguous work in HOLD. Future recovery uses immutable evidence and two distinct authorized actors. | HOLD behavior exists; recovery UI/authority is absent |
| FR-025 | Distinguish offline plan history from verified applied history; never synthesize applied history from approval or request. | Offline history exists; Oracle history blocked |
| FR-026 | Retain project/operator/execution audit and bounded records. General export/retention configuration is deferred. | Paged audit and scoped downloads exist |
| FR-027 | Compare observed schema snapshots to versioned baselines; manual registration is not a snapshot. | Blocked on Oracle discovery |
| FR-028 | Do not provide an SQL query editor or data browsing in the initial product. | Deferred |
| FR-029 | Keep current `/api` routes backward-compatible. Version target-bound payloads/resources additively; do not promise a general public API. | Current API is private app surface |
| FR-030 | Do not provide inbound/outbound webhooks in the initial product. | Deferred |
| FR-031 | Store Oracle-observed identity separately from Kelryvo registration IDs and route facts. | Blocked on authorized Oracle identity attestation |
| FR-032 | Bind exact schema owner and execution principal purpose to target intent. Assignment does not grant database authority. | Assignment exists; new plan envelope required |
| FR-033 | Treat ambiguous DDL outcome as HOLD until independent reconciliation; no retry from client timeout or missing receipt. | Source protocol is synthetic; Oracle validation blocked |
| FR-034 | Preserve parsed dependencies and flag unknown dependency/scope facts as unresolved. | Parser envelopes exist; schema-aware dependency review remains |
| FR-035 | Initially evaluate single-instance non-CDB and single-instance CDB/PDB as separate support profiles. Defer RAC, Data Guard, cloning, restore automation, and PDB relocation execution. | All topology support requires separate lab acceptance |

## User journeys and acceptance criteria

| AC | User outcome and acceptance criteria | Related retained scenarios / milestone |
|---|---|---|
| AC-01 Access and project scope | A user sees only projects with a current explicit grant. Revoked credentials or grants stop reads and writes. A developer cannot approve their own plan. Foreign project/target IDs reveal no existence. | AS-01, AS-24; existing baseline + every new route |
| AC-02 Shared workspace inventory | The operator records a physical resource once. A shared PDB may contain schemas assigned to separate projects. Each project sees only its assigned schemas. Manual records are labeled provisional. | AS-02–04, AS-07; M2 |
| AC-03 Assignment lifecycle | One exact schema has no more than one active project owner. Transfer uses expected revision, records reason/operator, closes the old interval, preserves stream/history, and blocks if work is active or ambiguous. | AS-07, AS-26–27; baseline + M2 |
| AC-04 Environment and target binding | A binding revision names one project environment and route/config revision. Environment/container labels are not inferred. Changing a binding makes the existing plan stale and requires a new immutable plan. | AS-05, AS-11, AS-27; M1 |
| AC-05 Credential visibility | No screen or project response exposes secret material. Ordinary project users see a safe alias only; deployment credentials are never resolved by API/web code. | AS-06; M1 |
| AC-06 Source retention | Import records an immutable commit, migration folder, ordered file set and digests. Preview and comparison show retained bytes, parser state, and provenance. A damaged or unavailable release cannot produce a plan. | AS-08; current baseline |
| AC-07 SQL scope | Parser-approved statements are shown with source ranges and digests. Unsupported or ambiguous syntax, cross-schema references, and database/CDB/PDB-level DDL remain visibly unverified and cannot be admitted. | AS-09–10; M1/M3 |
| AC-08 Approval integrity | The reviewer sees the full target-bound envelope and exact source. Approval binds to the intent digest. Changed source/target requires a new plan; approval, comments, rejection, revocation, and audit remain immutable. | AS-11–13, AS-27; current baseline + M1 |
| AC-09 Execution readiness | Without a trusted installed worker and verified target identity, requests remain non-executable and cause zero Oracle calls. A deployment grant cannot bypass approval or target validation. | AS-14–18, AS-24; M1–M4 gates |
| AC-10 Ambiguous outcomes | Timeout, lost session, absent receipt, failed postcondition, identity change, or unknown target ledger yields HOLD. No new attempt or replay starts automatically. | AS-17–21; M4 external gate |
| AC-11 Drift and applied history | Only a complete Oracle-observed snapshot can drive drift state. Missing visibility is unknown. No release, approval, synthetic receipt, or missing ledger may create applied history. | AS-18, AS-22, AS-28; M3/M4 |
| AC-12 Optional capability boundaries | Query/data access, webhooks, emergency bypass, machine identity, and configurable approval remain absent from the initial product and API. | AS-23, AS-25, AS-29–30; deferred |
| AC-13 Audit and evidence | Project members can page authorized project audit/history and download scoped immutable records. A checksum is presented as integrity evidence, not as a signature or proof of Oracle effects. | AS-28; current baseline |
| AC-14 Restore hold | A restored metadata generation remains readable but mutation/request actions are blocked until the trusted external recovery procedure resolves the hold. The app cannot clear it. | AS-18, AS-29; current baseline |

The scenario-to-criterion crosswalk is complete: AS-01 → AC-01; AS-02–04 → AC-02; AS-05 → AC-04; AS-06 → AC-05; AS-07 → AC-02/03; AS-08 → AC-06; AS-09–10 → AC-07; AS-11–13 → AC-08; AS-14–18 → AC-09/10/11; AS-19–21 → AC-10; AS-22 → AC-11; AS-23, AS-25, AS-29–30 → AC-12/14; AS-24 → AC-01/09; AS-26–27 → AC-03/04/08; AS-28 → AC-11/13.

## API and data compatibility

- Preserve existing `/api` routes and response meaning. Add new fields and routes without changing legacy project, profile, release, plan, history, job, or audit IDs.
- Version the new plan intent payload explicitly (`intentVersion: 2`) and version target-binding revisions independently. Do not require a global API version migration for this bounded private browser client.
- The server resolves all trusted facts from project-scoped IDs. It rejects stale revisions with a conflict response, foreign/missing IDs with a non-disclosing not-found response, unverified identity with an explicit non-executable result, and unknown parser/scope with a blocked result.
- Every new read and mutation applies the current credential and project authorization checks. Inventory mutations remain on the trusted local operator path; no new app-level workspace administrator is introduced by this specification.
- Add target binding and plan facts additively. Do not backfill environment, target identity, owner, profile mapping, approval intent, or applied history by name or inference.
- On rollback, retain the new facts and render the new plan format read-only. Never strip binding facts from a reviewed plan or drop audit/evidence rows.

## Incremental implementation roadmap

| Milestone | Outcome | Dependencies and exit gate |
|---|---|---|
| M0 — Planning contract | Complete these linked architecture, product, gap, migration, and UX specifications. | Complete for this task; no code or tests. |
| M1 — Target-bound offline plans | Add binding/assignment revisions, versioned plan envelope, stale-plan handling, safe profile-field visibility, and review display. Keep request non-executable. | Additive migration, existing PostgreSQL/Git/browser suites, legacy row preservation, zero Oracle calls. |
| M2 — Project target experience | Show assigned schemas, workspace-safe route labels, binding/environment revisions, provisional identity, transfer effects, and operator audit. Keep cross-project inventory writes out of the web app. | M1 contracts; project scope/authorization coverage; no Oracle needed for manual/provisional facts. |
| M3 — Oracle identity and discovery | Implement read-only discovery and identity snapshots for separately accepted single-instance non-CDB and CDB/PDB profiles. | Explicit isolated Oracle lab, named least-privilege identity, TLS/network policy, mismatch/drift acceptance. No execution enabled. |
| M4 — Execution correctness and reconciliation | Validate target locks, ledger, receipts, DDL ambiguity, external-change policy, and dual-authorized HOLD reconciliation for accepted topologies. | M3 evidence, separately authorized execution identity, offline end-to-end gate, security/recovery acceptance. No production rollout implied. |
| Later, separately scoped | Integrations, query/data access, machine identities, broader topology, advanced policy, audit export, or recovery convenience actions. | New product/security spec and explicit authorization for each trust-boundary change. |

## Readiness

Product behavior, domain invariants, role boundaries, target-binding contract, acceptance criteria, current/proposed screen scope, and milestone order are specified. The current governance MVP is reported accepted; the target-binding increment is implementation-ready at the contract level. Oracle discovery, execution, applied history, and production promotion are not ready because they require implementation and external acceptance. The exact original Functional Specification wording remains unavailable in this checkout; the stable IDs are preserved and their reconciled outcomes are recorded above.
