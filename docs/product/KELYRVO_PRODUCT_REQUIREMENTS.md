# Kelryvo product requirements, state and roadmap

This is the source of truth for product direction, delivered capability and the remaining backlog. Baseline: master `975dea5`, including PR #94; R1 onboarding changes assessed 2026-10-14. This document records delivered product behavior and its evidence boundaries; it does not certify the current deployment.

Kelryvo is a self-hosted, Oracle-first Database DevOps platform. Its usable product today is an integrated **offline change-governance workflow**: configure project targets, retain Git or authored SQL, validate and compare it, prepare immutable plans, obtain independent approval, request deployment and inspect durable evidence. Real Oracle discovery and execution have source implementations but have **not passed live acceptance**.

## Start here and maintain one backlog

1. Read the capability table and roadmap below; select one bounded outcome and its exit criteria.
2. Inspect the referenced code, tests and retained evidence. A merged PR or test file alone is not functional proof.
3. Read [architecture and safety contracts](../architecture/KELYRVO_ARCHITECTURE_DECISIONS.md), repository `AGENTS.md` and the relevant [local product/API contract](../development/local-product.md). Preserve compatibility and security gates.
4. Implement the complete API + database + browser workflow, run relevant acceptance, review and satisfy [integration gates](../implementation/github-sync.md). Update this document's affected row and milestone with the actual evidence boundary.

The [legacy tracker](../implementation/tracking.md) preserves the 220 original feature IDs, original criteria/dependencies, 63 Oracle feasibility cases and historical bounded tasks. Its BACKLOG state often means **full original catalog acceptance is unproven**, not that the current product has no implementation. Its historical phase labels do not schedule new development. Do not duplicate this roadmap in a new phase plan or mark whole catalog features verified from narrower acceptance. Original research is immutable input, never product evidence.

[Current session entry](../implementation/CURRENT.md) links here. [UI conventions](KELYRVO_UI_UX_DESIGN_SPECIFICATION.md) specify shared interactions. [Historical MVP acceptance](../implementation/MVP.md), the historical Phase 1 protocol reference and Stitch handoff retain dated evidence/design context; they are not active specifications or current deployment claims.

## Current product and evidence

**Delivered offline** means connected backend/database/browser behavior with local PostgreSQL/Git/parser/Chromium acceptance coverage and retained or hosted passing results. **Partial** means usable facets exist but a material requirement remains. **Unverified runtime** means code and fixture/synthetic tests exist without the relevant live Oracle evidence. No status below claims all original catalog criteria passed.

The baseline candidate for PR #93 (`60dd5a2`) passed the full hosted API, browser, frozen-source release, parser, foundation, both OCI platforms and security checks. These suites use disposable metadata and fixtures, not Oracle. See [PR #93 checks and acceptance scope](https://github.com/devsecopslonghn/kelryvo/pull/93). Earlier retained runs include [runtime journey](../../evidence/product/phase6-runtime-acceptance-20261013/acceptance.json), [SQL workspace](../../evidence/product/phase7-product-workspace-20261013/acceptance.json) and [workflow hardening](../../evidence/product/phase9-hardening-20261013/acceptance.json). They establish their recorded source/date only; final consolidation checks are reported by its PR.

| Capability | Assessment and practical limits | Implementation / acceptance anchors |
| --- | --- | --- |
| Access, projects and environments | Delivered offline: fixed human roles, explicit project/deploy grants, independent approval, archive/read-only history, own-session management, HTTPS cookie/CSRF/expiry. Provisioning stays with the trusted OS operator; no invitations, SSO or app administrator. | `packages/database/{project-membership,browser-sessions,account}.ts`; `apps/web/src/Account.jsx`; `tests/product-membership.test.mjs`, `tests/product-secure-sessions.test.mjs` |
| Instances and connections | Delivered offline: deployment profiles and authorized discovery connections, endpoint validation, Service Name/SID metadata, private credential aliases, immutable revisions, filtering, reasoned enable/disable/retire and offline preflight. SID deployment eligibility is blocked; preflight never proves connectivity. Edits invalidate dependent authority while retaining old plans/decisions. | `packages/connectivity/{management,api}.ts`, `packages/database/profile-lifecycle.ts`; `apps/web/src/{Instances,Connections,ConnectionConfiguration}.jsx`; `tests/product-connection-management.test.mjs`, `tests/product-connection-management-browser.integration.mjs` |
| Inventory, schema ownership and targets | Delivered offline: manual workspace catalog, single active project assignment per exact owner, revisioned transfer/release, project target bindings, explicit environment/route/policy/principal facts and stale-plan display. Operator provisioning and assignment remain outside ordinary web authority. Declared lineage is provisional. | `packages/catalog-reference/`, `packages/targets/`; `apps/web/src/ProjectTargets.jsx`; `tests/product-target-bindings.test.mjs`, `tests/product-target-workflow-browser.integration.mjs` |
| Oracle connectivity and identity discovery | R1 product integration implemented; live Oracle NOT_RUN: bounded opt-in read-only adapter, expiring authorization, exact attested database/container/service/version comparison, retained observations and historical binding evidence. Configuration validity, connectivity and accepted identity are separate. Mismatches block binding; fixtures cannot certify identity. Default runtime is unavailable; accepted exact-target live evidence is required for verification. Discovery lists visible owners; it is not a complete schema/object snapshot. | `packages/connectivity/{oracle.mjs,api.ts,evidence.mjs}`; `apps/web/src/Connections.jsx`; `tests/oracle-discovery.test.mjs`, `tests/product-database-discovery.test.mjs`; [runtime contract](../development/local-product.md#read-only-database-connectivity-and-discovery) |
| Git releases and retained SQL | Delivered offline: allowlisted local repositories, project folder binding, branch/tag/commit import, immutable retained source/digests, parser results, statement preview and comparison. No remote provider authentication, webhook or push to the bound repository. | `packages/migrations/`; `apps/web/src/app.jsx`; `tests/product-mvp-workflow-browser.integration.mjs`, `tests/product-statement-preview.test.mjs` |
| SQL Workspace | Delivered offline: project/target-scoped drafts and immutable revisions, saved SQL comparison, offline syntax/risk review, protected unsaved context and idempotent authored-release preparation into an isolated Git snapshot. Partial editor: no query/data execution, semantic compilation, autocomplete or multi-file authoring. | `packages/sql-workspace/`, `packages/migrations/authored-snapshot.mjs`; `apps/web/src/SqlWorkspace.jsx`; `tests/product-sql-workspace-browser.integration.mjs` |
| Schema-aware validation and migration analysis | Partial: retained parser/statement checks, exact-owner scope policy, risk/findings, dependency and ordered pending-migration analysis tied to source/target revisions. Object existence, dependency completeness and actual Oracle semantic validity remain UNKNOWN/unverified without observed catalog/target evidence. Offline VALID does not mean executable. | `packages/sql-validation/`, `packages/execution/migration-analysis.ts`; `apps/web/src/{SchemaValidation,MigrationAnalysis}.jsx`; `tests/product-sql-validation.test.mjs`, `tests/product-sql-validation-browser.integration.mjs` |
| Plans and independent review | Delivered offline: format-3 target-bound envelopes, retained statement/source/target facts, optimistic currentness, reviewer inbox/routing, comments with exact statement refs, approval/rejection, fresh-plan correction and approval withdrawal. Changed source/configuration never rewrites old intent or revives old authority. | `packages/targets/`, `packages/migrations/offline-plan-intent.mjs`, `packages/governance/`; `apps/web/src/{PlanRecord,PlanSourceComparison}.jsx`; `tests/product-target-bindings.test.mjs`, `tests/product-comments.test.mjs` |
| Deployment requests and worker safety | Delivered request workflow; unverified Oracle runtime: request/idempotency/cancel, readiness, durable jobs/attempts/receipts, supervised serial worker, target-ledger/mutex adapters and expiry-to-HOLD. UNIT_SYNTHETIC effects are labeled. Requests remain WAITING_VALIDATION without trusted installation, target evidence and authority. No automatic ambiguous replay. | `packages/execution/`, `apps/worker/`; `apps/web/src/{ExecutionReadiness,ExecutionHistory}.jsx`; `tests/product-execution-readiness.test.mjs`, `tests/product-installed-worker-factory.test.mjs` |
| HOLD reconciliation | Partial: immutable evidence capture, independent governance review and history reconciliation UI/API exist; actual target/ledger/object witnesses and approved recovery remain external. This does not provide an app button that clears restore hold or authorizes retry. | `packages/execution/{reconciliation,history-reconciliation}.ts`; `apps/web/src/ExecutionReconciliation.jsx`; `tests/product-execution-reconciliation.test.mjs` |
| Audit, migration history and downloads | Delivered offline: scoped filtered/paged audit and consolidated plan/decision/request/ledger history, stable cursors, retained source/statement links, checksummed plan/request records. Historical events and current statuses are labeled separately. Checksums are integrity evidence, not signatures or proof SQL ran. | `packages/{migration-history,audit}/`, `packages/{governance,execution}/`; `apps/web/src/{MigrationHistory,PlanRecord,ExecutionRecord}.jsx`; `tests/product-migration-history-cursor.integration.mjs` |
| Install, operate and preserve metadata | Delivered local source bundle, parser/dependency notices, OCI verification and runtime diagnostics; native backup/compatible restore retain evidence under a new generation and persistent RESTORE_HOLD. Production writer isolation, actual Oracle recovery and deployed disaster recovery remain unverified. | `packages/backup/`, `packages/observability/`, `scripts/local-release.mjs`; `tests/product-backup-restore.test.mjs`, `tests/product-local-release.integration.mjs`; [runtime guide](../development/runtime-readiness.md) |

## Authoritative requirement outcomes

Stable FR identifiers are retained from earlier reconciliation. The original standalone functional specification is absent, so these are the adopted Kelryvo outcomes, not purported quotations. The 220 research IDs and original criteria remain in the legacy tracker. The capability table above supplies implementation evidence; this table supplies required behavior without a second progress count.

| ID | Required outcome / remaining boundary |
| --- | --- |
| FR-001 | One private server-owned workspace; multi-tenancy deferred. |
| FR-002 | Fixed developer/approver roles, explicit project and separate deploy grants; reject self-approval and recheck current authority. |
| FR-003 | Machine identities and public automation clients deferred. |
| FR-004 | Workspace owns physical inventory; project target views derive from schema assignments. |
| FR-005 | Secrets stay external; safe aliases in project/browser responses; discovery and writer purposes remain separate. |
| FR-006 | Discovery appends immutable observations, preserves manual facts and labels visibility/provenance. Live Oracle acceptance remains required. |
| FR-007 | One active project per exact schema owner; revisioned transfer preserves streams and history and blocks unsafe active/ambiguous work. |
| FR-008 | Project archive cannot delete physical inventory. Inventory lifecycle remains workspace/operator-owned. |
| FR-009 | Future metadata sync/drift uses complete observed snapshots; limited visibility means UNKNOWN. Not delivered by owner discovery. |
| FR-010 | Archive preserves read access and history; normal project purge/restore deferred. |
| FR-011 | Environments are project-defined; each binding selects one explicitly. No inferred promotion rank. |
| FR-012 | Retain exact local Git commit/folder/file/manifest facts; remote providers and webhooks deferred. |
| FR-013 | Stable stream follows target lineage + exact schema owner + namespace. Version/checksum history never resets on project transfer; live adoption/baseline semantics remain to be accepted. |
| FR-014 | Supported pinned Oracle parser and explicit scope checks only; unsupported syntax blocks executable admission. Parsing does not establish compilation. |
| FR-015 | Plans/approvals bind exact assignment, binding, configuration, identity, policy, environment, stream and statement revisions. |
| FR-016 | Review retained source, digests, scope/risk/dependency findings and target evidence; surface unknown/conflicting facts. |
| FR-017 | Immutable plan and durable execution request are separate objects; no general business-issue subsystem required. |
| FR-018 | One independent human approval; configurable routes/multi-stage approval deferred. |
| FR-019 | Request requires approved current plan and deploy grant; it does not grant worker execution authority. |
| FR-020 | Only a separately installed trusted worker may resolve writer secrets and execute after target/runtime acceptance. |
| FR-021 | Serialize per verified PDB/non-CDB; actual mutex continuity and session-loss behavior require Oracle evidence. |
| FR-022 | Preserve immutable request/attempt/event/receipt/target-ledger evidence with truthful scope. |
| FR-023 | Cancel only before dispatch; retry/skip/resume and automatic replay deferred. |
| FR-024 | Ambiguity stays HOLD; recovery needs independent target evidence and two distinct authorized actors, never client timeout inference. |
| FR-025 | Distinguish offline intent from applied history; approvals, requests and synthetic receipts cannot fabricate Oracle effects. |
| FR-026 | Scoped audit/history and record downloads; general retention policy and signed export deferred. |
| FR-027 | Drift compares observed object snapshots to versioned baselines. No material complete implementation yet. |
| FR-028 | SQL authoring is supported; arbitrary query execution, data browsing and masking remain deferred. |
| FR-029 | Preserve private `/api` compatibility and historical formats additively; no general public API guarantee. |
| FR-030 | Inbound/outbound webhooks deferred. |
| FR-031 | Observed Oracle identity stays separate from local UUIDs/routes and must pass exact-target acceptance. |
| FR-032 | Exact schema scope and purpose-specific principal are bound to intent; assignment never grants Oracle privileges. |
| FR-033 | Lost response, lock/session continuity, receipt or uncertain DDL produces HOLD; no automatic takeover/replay. |
| FR-034 | Preserve parsed dependencies; unknown object/dependency visibility stays unresolved. Semantic completion depends on catalog observation. |
| FR-035 | Accept single-instance non-CDB and CDB/PDB independently by version/topology. RAC, Data Guard, clone/refresh, restore automation and relocation execution deferred. |

## Non-negotiable acceptance criteria

Retain AC identifiers as stable review anchors. Earlier AS-01–30 scenarios are historical crosswalks; tests and these outcomes govern new acceptance.

| Criterion | Observable outcome |
| --- | --- |
| AC-01 Access | Revoked/foreign/expired credentials and grants deny new admissions without disclosing other projects; author cannot self-approve. |
| AC-02 Inventory | Shared-container fixtures isolate each project's assigned exact schemas; manual facts remain provisional. |
| AC-03 Ownership | Concurrent assignment/transfer has one winner, retained intervals/reasons and no fabricated stream reset. |
| AC-04 Target revisions | Binding selects one environment; configuration/source/assignment change, including away-and-back, invalidates dependent new authority while old evidence remains readable. |
| AC-05 Secrets | API/browser/log/storage expose no secret or private writer reference; writer secrets stay outside API/web. |
| AC-06 Source | Retained commit, bytes and digests survive ref movement/unavailability; corruption blocks plan/approval/request. |
| AC-07 SQL scope | Show statement identity, scope/risk and unknown dependencies; unsupported/cross-owner/admin SQL cannot become executable through offline success. |
| AC-08 Approval | Decision binds exact immutable intent; fresh changes require fresh independent approval. Reviewer/comment/withdrawal history persists. |
| AC-09 Readiness | Without accepted target evidence and trusted worker authority, integrated browser request workflow makes zero Oracle writer calls and shows the actual blocker. |
| AC-10 Ambiguity | Fault/timeout/session/ledger loss yields durable HOLD or explicit persistence uncertainty; no second attempt or automatic replay. |
| AC-11 Observations | Incomplete visibility stays UNKNOWN; fixtures and checksum-only evidence cannot create verified identity, drift or applied history. |
| AC-12 Scope | Deferred functions do not appear as enabled UI/API promises or bypasses. |
| AC-13 Evidence | Authorized filtered history/downloads show original facts separately from current status and never label a checksum as signed authenticity. |
| AC-14 Restore | Compatible restore preserves evidence, revokes restored credentials and retains persistent RESTORE_HOLD until trusted external recovery. |

## Prioritized roadmap

Previously proposed target-binding and project-target milestones are delivered offline; improve existing modules rather than building parallel planners, ledgers or tracking systems. R1 product integration is implemented with local acceptance; the live entry gate below remains open.

| Order | Bounded milestone and value | Dependencies / exit criteria |
| --- | --- | --- |
| **R1 — product integration delivered; live acceptance NOT_RUN** | Connection registration/configuration/preflight, read-only testing/discovery, scoped exact-owner selection, evidence diagnostics/history and revision-bound plan/review/request workflow are integrated. Users see why verification is unavailable. A demonstrated real-Oracle workflow remains pending. | Use existing adapters and contracts; obtain explicit disposable-lab read-only authorization and attested exact-target manifest. Demonstrate one accepted version/topology first; others stay unsupported until separately accepted. Pass the R1 criteria below. No writer capability or DDL. |
| R2 — observed schema baseline and drift | Add immutable, visibility-aware object/dependency snapshots and browser comparison to a retained baseline. This closes object UNKNOWN and makes drift useful for planning. | R1 identity accepted; define least-privilege object scope, completeness and size limits. API + browser show added/removed/changed/unknown objects and provenance; partial access never means no drift. Changes stale dependent validation/plans; preserve prior snapshots. Include cross-project/owner isolation and actual read-only Oracle acceptance. |
| R3 — controlled Oracle migration pilot | Demonstrate the existing approval → request → trusted worker → actual target effect → retained history/reconciliation workflow on one disposable accepted topology. Reuse worker, ledger, mutex and governance implementation. | R1/R2 evidence, reviewed purpose-separated installation, enforced external-change window, separately authorized DDL/fault/teardown. Pass [OA01–OA10](../development/oracle-acceptance.md) and controlled reconciliation gates, including V1/V2/NOOP, ambiguity/HOLD/no replay, identity/currentness and independent recovery. No production enablement is implied. |
| R4 — operating acceptance for an eligible pilot release | Make the accepted workflow installable and recoverable with truthful readiness and support limits. | R3; prove private secret isolation, process/orphan containment, restart, backup/restore and disaster recovery in the intended non-production runtime. Retain exact image/source identity, notices and operator witnesses. Publication/deployment each require task authorization and existing gates. |

### R1 selected-work acceptance

R1 code reuses existing persistence and APIs: observations/acceptance append to existing immutable tables, configuration/binding revisions preserve plans and review meaning, and old unbound acceptance remains readable while failing new verified eligibility. UI scopes candidate bindings to the assigned container, route and exact accessible owner and presents observation history, permissions, timeout and mismatch diagnostics. Read-only manifests now require expiry; accepted evidence binds the complete target tuple, exact accepted owner scope and manifest/configuration digests. Project readiness cannot inherit another owner’s acceptance. Discovery uses the authenticated session's exact owner and preserves TCPS certificate verification with an optional attested server DN.

Local acceptance covers fixed SELECT-only probes, purpose/secret isolation, wrong database/container/service/version, absent permissions, expired authority, default/fixture verification denial, real PostgreSQL/API persistence, compatible native backup/restore, Chromium registration/discovery/history, target-bound planning, independent review and WAITING_VALIDATION readiness. Results and source/tool versions are retained in [R1 acceptance evidence](../../evidence/product/r1-oracle-onboarding-20261014/acceptance.json). **Live Oracle: NOT_RUN**, zero live connections. R1 remains incomplete under its live exit criteria. The lab owner/DBA must supply explicit read-only authorization and an expiring owner-attested disposable manifest with exact endpoint/version/topology/identity, transport/CA policy, approved metadata grants, private discovery-secret paths and stop/teardown duties. No Oracle version/topology is certified; R2/R3 are not started.

- Reuse `packages/connectivity/`, target options/bindings and the current Connections/ProjectTargets UI. First inspect the existing tests and fix only gaps exposed by acceptance; do not build another discovery subsystem.
- Before connecting, the lab owner supplies explicit authorization, exact endpoint/version/topology, entitlement, read-only identity/grants, transport/CA policy, allowed reads, expiry and bounded stop/teardown duties. Keep secret material private; record only sanitized evidence. Missing authorization leaves live cases **NOT_RUN** and the milestone incomplete.
- Demonstrate the full browser + API path: create connection → offline preflight → bounded connectivity test → discovery observation → exact-owner binding verification → fresh target-bound offline plan → independent review → truthful request readiness. Default startup and fixture data must remain unable to certify a target or dispatch a writer.
- Exercise wrong destination/container/identity, missing privileges/owner visibility, unsupported root/SID, expired observation, superseded/disabled connection, timeout and revoked access. Confirm retained evidence/revisions and stale-plan feedback survive restart and compatible backup/restore.
- Record exact source/driver/parser versions and provenance. Only accepted live evidence for the matched target may produce verified identity/connectivity; configuration readiness, a successful socket test and injected fixtures cannot. Separate version/topology support claims explicitly.
- Run full local/hosted metadata, API, browser and source-installation gates, independent security/correctness review and the authorized read-only Oracle cases. An offline pass alone cannot close R1. Worker enablement, DDL, fault injection and infrastructure changes need separate authority.

### Later backlog, deliberately unscheduled

Remote Git providers and automation, SSO/invitations/machine identities, advanced approval/promotion policy, multi-file editor convenience, signed/general evidence export and retention, query/data access, non-Oracle engines and broader Oracle topology each need a bounded requirement and acceptance slice before scheduling. Prioritize them only when the core pilot workflow works; none is a hidden dependency of the current offline product.

## Cleanup and historical boundaries

The 2026-10-14 consolidation removed superseded gap/roadmap/migration proposals, duplicated continuation notes and obsolete local agent-session configuration notes. Their recoverable text remains in Git history. Detailed safety decisions, historical Phase 1 protocol and design provenance, historical MVP acceptance, immutable research, license/notice/dependency records, decision log, tracker contracts and all `evidence/` files remain. Historical records are dated evidence, not instructions to repeat completed work or authority to deploy.
