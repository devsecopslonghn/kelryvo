# Kelryvo Implementation Roadmap

**Status:** Final planning baseline, 2026-10-12. Planning only; no implementation or tests were run. The current practical governance MVP is already deployed and accepted as summarized in `docs/implementation/MVP.md`; M1 onward completes the target-binding/product-design gap and does not imply that Oracle execution is enabled.

## Product direction

Finish the private Oracle migration-governance product around a central workspace inventory and project-owned schema assignments. Protect immutable project workflow and make every new plan identify the schema assignment and target evidence it was approved for. Keep Oracle execution and new production rollout disabled. The initial support boundary is single-instance CDB/PDB and non-CDB, each subject to separate lab acceptance; defer RAC, Data Guard, cloning, restore automation, and PDB relocation execution.

### Recommended ownership model

- **Workspace owns:** database/CDB/PDB catalog, service routes, credential references, discovery observations, workspace operator audit, and worker configuration.
- **Project owns:** source repository/folder, releases, review, project environments, plans, comments, and project workflow audit.
- **Schema assignment joins them:** one active project owner per exact Oracle schema; one PDB can host schemas assigned to many projects. Project inventory is derived from its current assignments.
- **Worker owns execution admission:** only a separately installed trusted worker may resolve execution credentials, revalidate target identity, lock, run DDL, and record receipts. The API creates durable requests, not SQL authority.

## First milestone: target-binding foundation

This is the highest-value next milestone because today’s approval binds a project profile but not the schema assignment that a worker later observes. It should remain non-executable.

### M0 — Specification and safety contract (complete for planning)

- Reconcile the retained FR/AS identifiers with workspace-owned infrastructure, schema ownership, explicit target binding, credential minimization, and no-replay safety defaults.
- Define manual/provisional versus Oracle-observed state and preserve legacy profile/plan compatibility.
- Define the versioned target-binding envelope and fail-closed behavior for assignment or route changes.
- Link the product requirements, screen-level UI/UX specification, architecture decisions, feature gap, and additive migration strategy.

**Exit:** planning contract is recorded in the linked documents. Application changes remain outside this work item.

### M1 — Assignment and plan target binding (M, 1–2 weeks)

- Add a separate immutable target-binding revision with exactly one explicit project environment; keep schema assignment as ownership interval only. Legacy assignments remain unbound/provisional until reviewed mapping.
- Extend new plan intent and UI to select one currently assigned schema and stable `stream_id`; include assignment and binding revisions, target-lineage/identity observation state and digest, exact owner, route revision, SQL-scope policy revision, and execution-principal purpose/reference.
- Cover approval/request revalidation and stale assignment behavior. Keep all new plans offline and `NOT_EXECUTED`.
- Stop returning opaque `credentialRef` to ordinary project detail consumers; add a minimal display alias if product workflow requires it.
- Add focused migration, API, browser, authorization, transfer race, and legacy-record preservation tests.

**Exit:** reviewer sees target facts; target facts are digest-bound; assignment transfer invalidates stale intent; legacy plan snapshots are unchanged; synthetic/local tests pass; worker admission remains unavailable absent trusted observed target identity.

### Minimum offline end-to-end acceptance before Oracle work

This is a go/no-go gate between M1 and M3. Use a disposable PostgreSQL database, local allowlisted Git fixture, and explicit `UNIT_SYNTHETIC` host only. The test evidence must prove:

1. Git release import → immutable source/parser facts → project assignment and target-binding selection → plan intent with exact environment/target/assignment/binding revisions → independent approval → durable request and audit record.
2. With only a provisional/manual target and no installed trusted Oracle attestation, the worker performs zero Oracle calls and cannot claim `TRUSTED_VALIDATED`, execute a statement, or mark history applied.
3. Transfer, environment/route/identity-binding revision, membership revoke, approval revoke, or profile/principal change makes pending plan/request stale and prevents new admission without rewriting the original plan/approval.
4. Cross-project target IDs are non-disclosing; only one project owns an exact schema at a time; a shared PDB can expose different schema assignments to separate projects.
5. Expiry, child restart, lost mock response/receipt, target-ledger unknown, and metadata restore produce HOLD or request decline as specified, with immutable attempts/receipts and no replay.
6. Legacy project/profile/release/plan/approval/history/audit/job records remain byte-for-byte semantically unchanged and render as offline/unbound where applicable.

**Gate result:** focused migration/API/browser/worker tests plus row-snapshot preservation evidence are required. This proves the Kelryvo offline product contract only; it does not authorize or verify an Oracle connection.

### M2 — Project assignment and target experience (M, 1–2 weeks)

- Extend the existing project-scoped schema-reference view with assignment and target-binding revisions, environment, safe route alias, provenance, identity state, and last observation.
- Show a shared PDB through separate authorized schema rows in each project. Do not expose a global inventory listing to project members.
- Keep declare/assign/transfer/release under the trusted local OS operator CLI. A workspace-wide in-app inventory is deferred until existing operator authority can be represented safely in web authentication.
- Show transfer effects and operator audit facts to the authorized project; do not add physical target deletion.

**Exit:** shared-PDB/multi-project project views are coherent; foreign-project reads fail closed; operator history is preserved; no new web trust role is introduced.

### M3 — Oracle discovery and identity (XL plus lab time)

- Build a least-privilege read-only adapter for single-instance non-CDB and single-instance CDB/PDB as separate acceptance profiles.
- Treat RAC, Data Guard, clone/refresh, restore automation/RESETLOGS recovery, and PDB relocation execution as unsupported until separate identity, continuity, lock, and recovery evidence passes.
- Distinguish manual declaration, observed identity, mismatch, and drift.
- Validate route-to-container identity, endpoint/identity mismatch, and credential purpose boundaries for each accepted profile.

**Exit:** authorized Oracle lab evidence for both intended profiles; no use of a registration UUID as Oracle identity; mismatch holds before DDL. This does not enable execution.

### M4 — Deployment correctness and reconciliation (XL plus lab time)

- Validate one exclusive physical PDB/non-CDB mutex across project schemas and worker sessions. The central lease is not a SQL fencing token; expiry can only HOLD. RAC remains outside this gate.
- Validate success, database error, process death, DDL implicit commit followed by response loss, target-ledger write failure after DDL, central receipt loss, external schema changes, and reconciliation.
- Implement dual-authorized reconciliation and immutable applied-history transitions.
- Pilot only with an owner-approved non-production target; no automatic replay of unknown outcome.

**Exit:** separately authorized security/recovery acceptance; all ambiguous cases remain held until evidence-based resolution; target-specific concurrency verified. This planning task does not authorize a pilot or production release.

### M5 — Broader governance integrations (M–XL, selectively prioritized)

Only after M1/M2 contracts settle, prioritize policy review, provider webhooks, machine identities, approval routing, audit export, migration retry/skip, or query access as separate bounded work. Query/data access requires a separate security review and must not be bundled into migration target binding.

## Milestone work-package contracts

The estimates are engineering order-of-magnitude estimates and exclude Oracle lab provisioning. Test names below are proposed focused suites based on current repository conventions; this planning phase did not execute them.

| Milestone | Scope and affected modules | Data/API/UI | Security and compatibility | Acceptance scenarios and required tests | External dependency and completion criteria |
|---|---|---|---|---|---|
| M0 — Contract and safety (complete for planning) | No application modules changed. The requirements, UX specification, four architecture records, `docs/decisions/log.json`, architecture boundaries, source, and worker authority boundary are reconciled. | No schema/API/UI migration. The target-binding envelope, state vocabulary, UI dependencies, and safe credential display are specified. | One active project per schema, explicit operator authority, credential minimization, and offline-only legacy state are the baseline. The FR/AS IDs remain stable; conflicts are resolved in product requirements. | Planning acceptance: every target-state requirement links to a user journey, screen/data contract, authorization rule, acceptance criteria, and milestone. No runtime claim is added. | Complete for planning. Oracle validation, implementation, and deployment are separate gates. |
| M1 — Resource identity and target binding (M) | `packages/database/index.ts` additive DDL; new target-binding package; `packages/governance/plan-record.ts` and intent code; `apps/api/index.ts` plan/reviewer/admission handlers; project plan UI in `apps/web/src/app.jsx`; operator catalog adapter. | Add a separate target-binding revision/table with environment and explicit provisional state; introduce versioned plan envelope including stable `stream_id`; additive API to list/select current project assignments and create target-bound offline plan. No old row backfill. | Keep old profile and plan formats readable; reject arbitrary/foreign assignment IDs; hide raw credential reference; recheck assignment and binding revisions at approval/request. No DDL authority. | AS-01, AS-07, AS-11, AS-12, AS-13, AS-24, AS-27. Add migration/restart tests, plan intent unit/API tests, membership matrix, stale transfer test, old plan snapshot test, and browser selection/reviewer display. Candidate suites: `product-schema-reference`, `product-plan-intent`, `product-plan-target-browser`, `product-approval-integrity`, `product-profile-lifecycle`. | No Oracle dependency; local PostgreSQL fixture. Complete when approved new plan digest includes exact binding and stream, legacy data is unchanged, transfer invalidates intent, and request remains `WAITING_VALIDATION` / not executable. |
| M2 — Project assignment and target experience (M) | `packages/catalog-reference/index.mjs`, `scripts/local-inventory-operator.mjs`, project schema-reference read API, `apps/web/src/Instances.jsx`, navigation in `apps/web/src/app.jsx`, project target view. | Add project-scoped paginated assignment/binding reads and project-derived target view; maintain registration UUIDs and provenance. Inventory writes stay in the existing trusted local operator CLI; no secret resolver or workspace-wide in-app inventory. | Project reads derive only authorized active assignments and strip credential references. Existing project reference API remains a compatibility adapter. Do not introduce an app-level workspace administrator. | AS-02, AS-03, AS-04, AS-05, AS-06, AS-07, AS-26, AS-27. Add authorization matrix, shared-PDB fixture, pagination, empty/provisional/error-state browser cases, and operator transfer/audit evidence. | Contract from M0/M1. Oracle not required for manual inventory UX. Complete when project views show only assigned schemas and a shared PDB can safely appear in different project views. |
| M3 — Discovery, environments, and target resolution (XL) | New read-only Oracle adapter; target identity package; reference catalog observation persistence; worker preflight identity check; binding environment mapping; API/UI discovery and mismatch state. | Add immutable observations and explicit manual-to-observed link; binding revision; distinct non-CDB/CDB/PDB identity facts and route observations. RAC/Data Guard/clone/restore/relocation remain unsupported. | Separate read/discovery principal from deployment principal; TLS and network allowlist; no secret exposure; mismatch denies admission and enters HOLD. Old unbound plans remain offline. | FR-006, FR-009, FR-011, FR-027, FR-031, FR-032, FR-035; AS-05, AS-11, AS-16, AS-22. Add unit contract tests plus Oracle integration tests for each accepted topology, wrong PDB, route mismatch, stale observation, role/owner mismatch, and exact owner. | Requires an authorized isolated Oracle lab and purpose-specific principals. Complete only with observed identity evidence for both intended profiles and demonstrated fail-closed mismatch. |
| M4 — Approval, execution, history, and audit compatibility (XL) | `packages/execution/admission.ts`, `oracle-target-mutex.mjs`, `oracle-target-ledger.mjs`, receipt/reconciliation packages, `apps/worker/*`, API job routes and project request detail, history/audit projections, database journal schema. | Bind worker admission proof, physical lock key, stream ledger, applied history, and receipt to target lineage + identity observation + exact schema + binding revision. Add dual-authorized HOLD reconciliation; never rewrite legacy history. | Independent reviewer and deploy grant remain separate. Worker alone resolves deploy credential. Exclusive PDB/non-CDB lock includes all projects in that container; same writer session holds DBMS_LOCK through DDL implicit commits. Metadata lease expiry only projects HOLD. External DBA changes are outside Kelryvo mutex and require change control/audit. | FR-020–027, FR-033; AS-14–21, AS-27–29. Add synthetic crash/lease tests and Oracle tests for concurrent projects, DDL commit+lost response, process death, ledger failure, external DDL, independent reconciliation, and no replay. Existing `product-execution-*` suites are regression coverage only; RAC and other deferred topologies are not in this gate. | Authorized Oracle lab, worker host, identity acceptance, SQL-scope policy, and security review. Complete when each outcome is receipt-backed success or held/reconciled with independent evidence; no applied history is written from API/client assertion. |
| M5 — End-to-end operations and optional integrations (M–XL by feature) | Project/operations navigation, approval policy service, webhook/provider integration, machine identity, audit export, query/masking subsystem only if chosen. | Add only individually approved resource/API contracts. Keep query result and callback stores separate from migration ledger. | Every new integration gets independent identity, scope, audit, replay, rate, and revocation policy. Query features require read-only role and masking; emergency bypass requires dual control. | Acceptance scenarios specific to selected feature; include authorization-negative, restart, duplicate/replay, retention, and browser tests. No blanket “all integrations” acceptance. | Separate product-owner choices and security reviews. Complete each feature independently; no effect on Oracle execution gate unless it changes target authority. |

## Module ownership at the target state

| Concern | Existing anchor to extend | New bounded module/API responsibility |
|---|---|---|
| Domain/persistence | `packages/database/index.ts`; reference tables and project-scoped workflow tables. | Versioned additive migration and target binding persistence; avoid continued unversioned startup DDL for new coupled entities. |
| Inventory | `packages/catalog-reference/index.mjs`, local inventory CLI. | Keep writes on the trusted local operator CLI; add project-scoped reads for assigned targets. A global web inventory waits for an explicitly safe operator identity integration; Oracle observation remains separate. |
| Authorization | `packages/database/project-membership.ts`, `mutation-authority.ts`. | Explicit workspace operator policy, project target read scope, field-level credential-reference policy, and worker target authority. |
| Planning/review | `packages/governance/plan-record.ts`, `apps/api/index.ts`, project workflow in `apps/web/src/app.jsx`. | Target-bound intent version, plan creation/select endpoint, reviewer target display, stale assignment revalidation. |
| Execution | `packages/execution/*`, `apps/worker/*`. | Verified identity, stable physical lock/ledger keys, Oracle adapter, reconciliation authority and applied-history writer. |
| UX | `apps/web/src/app.jsx`, `apps/web/src/Instances.jsx` and release/review/records screens. | Add project-scoped target and binding context; keep requests in plan detail. Defer global infrastructure and operations consoles; retain current project workflow components. |

## Dependency order

```mermaid
flowchart LR
  A[Final product contract] --> B[Additive assignment and target envelope]
  B --> C[Offline target-bound approval]
  C --> D[Offline end-to-end acceptance gate]
  D --> E[Workspace inventory and project views]
  E --> F[Oracle discovery and physical identity]
  F --> G[Ledger, locks and failure acceptance]
  G --> H[Controlled non-production pilot]
```

Project-scoped target views can proceed alongside M1 after M0. A global inventory UI waits on a safe operator web-authentication boundary; physical identity and execution cannot skip the target-envelope and lab gates.

## Priority grouping

| Priority | Work | Reason |
|---|---|---|
| P0 | Fix domain contract; target-binding envelope; credential reference exposure boundary; additive migration/legacy preservation | Approval must identify the target and assignment revision before execution can be safe. |
| P1 | Project-derived schema views; target-binding environment mapping; transfer-aware invalidation; trusted operator CLI stewardship | Makes shared infrastructure understandable without expanding browser authority or claiming Oracle connection. |
| P2 | Oracle read-only discovery, stable identity, topology matrix, and drift snapshots | Converts provisional catalog data into verified target facts. Requires authorized external lab. |
| P3 | Real Oracle lock/ledger/ambiguity/reconciliation acceptance and controlled pilot | Required before execution or applied-history claims. |
| Deferred, outside initial MVP | Workspace admin/multi-tenancy, machine clients, external Git/webhooks, configurable approval policy, general audit export, retry/skip, query editor/masking, emergency bypass, and shared-schema co-ownership | These add identity, trust, operational, or data-access scope. Keep them out until a separately scoped product/security specification exists. |

## Risks and gates

| Risk | Required gate |
|---|---|
| Approval does not currently bind to schema assignment/physical target | M1 digest and API tests prove target facts are reviewed and revalidated. |
| Manual registration can be mistaken for real Oracle identity | UI/API consistently labels provenance; only an Oracle observation creates verified state. |
| Profile route/user facts and credential references are visible in project detail | M1 field-level access review and tests; purpose-separated resolver design. |
| Shared database ownership in supplied spec conflicts with Oracle schema sharing | M0 replaces database-project cardinality with schema-project assignment. |
| Project environment and container environment diverge | Explicit target-binding mapping; no inferred backfill. |
| DDL outcome may be ambiguous after connection loss | Oracle lab demonstrates HOLD and evidence-based reconciliation; no automatic retry. |
| Worker code can be mistaken for product acceptance | Keep worker count/runtime evidence and Oracle acceptance status explicit in release notes. |
| Current schema startup DDL is not a reviewed migration stream | Use a versioned, additive, restartable migration for new coupled target-binding entities; do not extend unreviewed startup DDL for this contract. |

## Decisions already resolved for planning

1. Keep one private workspace; defer multi-tenancy, app-admin, invitations, and machine identities.
2. Make physical inventory and route configuration workspace-owned; assign exact schemas to projects, with one active owner per schema.
3. Keep environments project-owned. Every target-binding revision selects one environment explicitly; there is no global promotion order.
4. Preserve project profiles and legacy plans as immutable compatibility facts. Do not infer their target assignments or migrate opaque credential references automatically.
5. Show ordinary project users safe route labels and credential aliases only. The trusted local OS operator retains infrastructure mutation in the first product slice.
6. Plan for single-instance CDB/PDB and non-CDB. Each topology requires separate authorized Oracle evidence; RAC, Data Guard, cloning, restore automation, and PDB relocation execution are deferred.
7. Keep PDB/non-CDB serialization, immutable receipts, HOLD-only ambiguity handling, no automatic replay, and dual-authorized reconciliation as execution gates.
8. Reject cross-schema and database/CDB/PDB-level DDL by default; unsupported SQL is unverified and blocks execution.
9. If external DDL cannot be reliably excluded or detected, the target remains ineligible for execution.
10. Require no in-flight or ambiguous request plus operator-recorded handover for schema transfer; a target change invalidates pending approval and requires a new plan.
11. Keep webhooks, query/data access, emergency bypass, and shared-schema co-ownership deferred.

These choices resolve product planning. They do not substitute for Oracle lab authorization, implementation review, or production release approval.

## Completion measurement

The current requirement assessment has 65 primary classifications: 4 bounded `IMPLEMENTED_VERIFIED`, 5 `IMPLEMENTED_UNVERIFIED`, 30 `PARTIAL`, 12 `MISSING`, 3 `ARCHITECTURALLY_INCOMPATIBLE`, and 11 `BLOCKED_EXTERNAL`. No feature is classified backend-only or UI-only as its primary state. This count is about supplied Bytebase FR/AS coverage; it is not a measure of the separate 220-item SchemaForge catalog.

For milestone tracking, count a requirement complete only when its stated behavior, authorization boundary, persistence semantics, operator outcome, and acceptance evidence are all satisfied. Keep live Oracle acceptance as a separate explicit gate from local API/browser/unit verification.
