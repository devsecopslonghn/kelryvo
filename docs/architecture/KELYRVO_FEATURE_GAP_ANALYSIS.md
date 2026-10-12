# Kelryvo Feature Gap Analysis

**Assessment date:** 2026-10-12. **Basis:** Immutable DB-Research inputs under `docs/inputs/db-research/product-research/`, current SchemaForge/Kelryvo source, implementation records, and the retained FR-001–035 / AS-01–30 summaries. The referenced standalone `BYTEBASE_FEATURE_RESEARCH.md` and `FUNCTIONAL_SPECIFICATION.md` are not present in this checkout, so exact original wording cannot be re-verified here. This is a source-level assessment, not a new test run or Oracle validation. See [Product Requirements](../product/KELYRVO_PRODUCT_REQUIREMENTS.md) for the reconciled normative outcomes and traceability policy.

## Specification reconciliation baseline

The product decisions are finalized for planning. They supersede any “decide/confirm” language in the retained gap notes while leaving their implementation evidence classifications intact.

| Topic | Adopted outcome | Scope / trace |
|---|---|---|
| Workspace and identity | One private workspace; fixed developer/approver identities, explicit project grants, separate deploy grant, trusted local OS operator. | FR-001–003, FR-029; multi-tenancy, app-admin, invitations, machine clients deferred. |
| Inventory and ownership | Workspace owns infrastructure; a project owns workflow; exact schemas are assigned to one project at a time. Different schemas in a shared PDB may belong to different projects. | FR-004, FR-007–008; AS-02–04, AS-07. No database-level project ownership or shared-schema co-ownership. |
| Environments and binding | Project environments remain project-owned; every immutable target-binding revision selects exactly one. Container labels are legacy hints only. A binding/assignment change makes existing intent stale and requires a new plan. | FR-011, FR-015; AS-05, AS-11, AS-27. No name-based mapping, global ordering, or silent reapproval. |
| Oracle support boundary | Plan for single-instance non-CDB and single-instance CDB/PDB as separate acceptance profiles, each requiring an authorized lab. | FR-006, FR-009, FR-027, FR-031, FR-035; RAC, Data Guard, cloning, restore automation, and PDB relocation execution deferred. |
| SQL and execution safety | Reject cross-schema and database/CDB/PDB-level DDL by default; ambiguous SQL blocks executable admission. Preserve independent approval, immutable evidence, HOLD, and no automatic replay. | FR-014, FR-020–025, FR-032–034; AS-09–10, AS-14–21. |
| Optional features | Defer query/data access, external webhooks, machine identities, general audit export, configurable approvals, emergency bypass, retry/skip, and schema co-ownership. | FR-003, FR-018, FR-023–024, FR-026, FR-028, FR-030; AS-19–21, AS-23, AS-25, AS-29–30. |

The source-level statuses below still describe what is implemented or externally evidenced. They do not mark a design choice as unresolved, and they do not imply Oracle execution acceptance.

## Classification key

- **IMPLEMENTED_VERIFIED** — a bounded behavior has direct local test or acceptance evidence. This never implies Oracle acceptance.
- **IMPLEMENTED_UNVERIFIED** — substantial code exists, but the relevant target/runtime behavior has not been verified; unit/synthetic evidence may exist.
- **PARTIAL** — a subset exists; material parts of the stated requirement remain.
- **BACKEND_ONLY** / **UI_ONLY** — behavior is present on only one side of the product boundary.
- **MISSING** — no material implementation found.
- **ARCHITECTURALLY_INCOMPATIBLE** — the requirement's proposed ownership or contract conflicts with the recommended Kelryvo model and needs specification resolution before implementation.
- **BLOCKED_EXTERNAL** — meaningful completion requires an authorized Oracle environment, target credentials, or other external capability not available in this review.

Effort is a rough engineering estimate: XS <2 days, S 2–5 days, M 1–2 weeks, L 2–4 weeks, XL >4 weeks. Estimates exclude procurement and scheduling of an Oracle lab. Risk reflects customer, data, authorization, or execution impact if incomplete.

## Functional requirements FR-001–FR-035

| ID | Status | Current evidence and gap / next action | Risk / effort |
|---|---|---|---|
| FR-001 | PARTIAL | `sf_organizations` and API `ORG` establish one fixed organization. Local recovery/operator paths exist; there is no workspace create/configure UI or multi-workspace boundary. The initial private product explicitly keeps this single-workspace boundary; multi-tenancy is deferred. | High / L |
| FR-002 | PARTIAL | Fixed local developer/approver actors, explicit OS-operator grants, membership checks, and separate deploy grants exist (`project-membership.ts`, API auth prehandler). No invitation or configurable-role UI exists; both are deferred from the initial private workspace. | High / M |
| FR-003 | MISSING | Local bearer/browser credentials exist, but no machine identity, service account, or scoped API client contract was found. Machine identities and automation clients are deferred; the initial UI is operated by named local human actors. | High / L |
| FR-004 | PARTIAL | Workspace-level manual DB/container/service/schema references exist, plus project/environment-scoped Oracle profiles. No live instance setup or verification; project profile and shared inventory have different ownership. Adopt workspace-owned infrastructure and assignment-derived project views, then add verified registration. | High / L |
| FR-005 | PARTIAL | Profiles hold endpoint, user, and opaque credential reference; retirement is revision-safe and tested. No secret resolver, purpose-separated identities, or project-visible credential isolation contract; project detail currently returns `credentialRef` to granted members. Define credential purposes and narrow visibility before resolution. | Critical / L |
| FR-006 | BLOCKED_EXTERNAL | `local-inventory-operator.mjs` registers manual references and intentionally offers no probe/connect. There is no Oracle discovery or metadata sync. Requires approved Oracle lab, discovery principal, scope, and evidence policy. | Critical / XL |
| FR-007 | PARTIAL | Schema-level assignment, one-active-owner constraint, transfer/release intervals, optimistic revision, operator audit, and tests exist. Database-level project membership in the proposed spec is the wrong boundary for shared PDBs. Amend FR to assign schemas; add broader portfolio transfer UI/API after contract is settled. | High / M |
| FR-008 | ARCHITECTURALLY_INCOMPATIBLE | There is no project-owned instance lifecycle. Profiles are retired, while workspace references and project schema assignments are operator-owned. Adopt workspace lifecycle and schema assignment transfer; explicitly exclude physical database deletion from project flows. | High / M |
| FR-009 | BLOCKED_EXTERNAL | The reference catalog records manually supplied schema owner strings, not live catalog metadata. No discovery snapshot, drift detection, or schema inventory sync exists. Requires target access and an Oracle-specific least-privilege contract. | Critical / XL |
| FR-010 | PARTIAL | Project create/archive and archived read retention exist. No restore or physical purge flow; this is consistent with retention-first architecture. Archived projects remain read-only; restore and physical purge are outside the initial private MVP. | Medium / S |
| FR-011 | PARTIAL | Project environments exist; manual containers have DEV/SIT/UAT/PROD labels and current UI groups assignments by that declared container environment. No ordered rank, target mapping, or transition validation. Put the authoritative project environment on a separately revisioned target binding; preserve container labels as legacy hints and require explicit mapping. | High / M |
| FR-012 | PARTIAL | Local allowlisted Git import produces retained release identities, manifests, and validation; comparison and parser workflows exist. Local mirrors and explicit import remain the initial source workflow; remote provider integrations and webhook ingestion are deferred. | Medium / M |
| FR-013 | PARTIAL | Releases retain versioned migration files and integrity digests. Plans/history are project-scoped and offline; there is no applied migration stream keyed to physical target + owner. Add target-bound stream identity only after target identity is trusted. | Critical / L |
| FR-014 | PARTIAL | A pinned ANTLR parser validates supported SQL and derives statement ranges. No schema-aware policy engine or complete Oracle construct coverage. Unsupported syntax should stay explicitly unverified/manual review; expand only from a defined parser compatibility matrix. | High / L |
| FR-015 | ARCHITECTURALLY_INCOMPATIBLE | Plans bind `release_id` and `profile_id`; they do not bind a schema assignment or observed physical identity. Approval is offline and cannot yet authorize a unique Oracle target. Revise the plan envelope to include assignment revision, identity digest/status, schema owner, route/config, and execution principal before executable admission. | Critical / L |
| FR-016 | PARTIAL | Release integrity, parser checks, and immutable intent validation exist. Target-aware dependency, conflict, schema-policy, and drift checks do not. Add these after verified inventory and migration stream identity. | Critical / XL |
| FR-017 | PARTIAL | A plan is the immutable proposed change and review object; an execution request is a separate durable object created after approval. A general business issue/work-request record is deferred. | High / M |
| FR-018 | PARTIAL | Independent approve/reject, comments, reviewer assignment, revocation, and audit exist. Configurable approval routes and environment/deployment policy do not. Preserve independent-review invariant; add policies after environment mapping is defined. | High / M |
| FR-019 | PARTIAL | Explicit deploy grant and request creation exist; requests enter `WAITING_VALIDATION`. Environment rollout policy and verified target readiness are absent. Keep requests non-executable until target binding and policy checks exist. | Critical / L |
| FR-020 | BLOCKED_EXTERNAL | Restricted worker/coordinator and durable execution journal exist, but deployment shows zero workers and no Oracle runtime acceptance. No proven staged rollout across real targets. Lab validation and target-bound plan contract are prerequisites. | Critical / XL |
| FR-021 | IMPLEMENTED_UNVERIFIED | PostgreSQL advisory locks, target mutex/ledger mechanisms, and schema catalog revision locks exist. Physical identity and cross-project/RAC serialization have not been validated against Oracle. Retain as unverified; lab-test lock scope and failure recovery before claiming serialization. | Critical / L |
| FR-022 | IMPLEMENTED_UNVERIFIED | Execution job/attempt/event/receipt structures and HOLD-oriented coordinator logic are present; synthetic tests/evidence exist. No Oracle attempt/receipt semantics have been proven. Validate outcome ambiguity and durability in an authorized lab. | Critical / XL |
| FR-023 | PARTIAL | Cancellation of undispatched requests and immutable attempt history exist. Retry, skip, and resume are deferred; any future continuation requires independently reconciled state and explicit authority. Ambiguous requests remain HOLD. | Critical / L |
| FR-024 | MISSING | No compensation plan or approved recovery-release workflow was found. HOLD preserves ambiguity but does not implement recovery. Future recovery requires immutable evidence and two-person authorization; until then the UI is read-only for HOLD cases. | Critical / XL |
| FR-025 | PARTIAL | Offline plan file history is explicitly `NOT_EXECUTED`; jobs and attempts record requested work. There is no verified applied migration history keyed by Oracle target/schema. Add only from worker receipts reconciled with target ledger. | Critical / XL |
| FR-026 | PARTIAL | Project audit supports bounded keyset paging; operator and execution audit/journals exist. General export, retention configuration, and tamper-evidence products are deferred; current retained records and bounded downloads remain in scope. | High / M |
| FR-027 | BLOCKED_EXTERNAL | No Oracle schema synchronization or drift baseline exists. Manual registration cannot establish live schema state. Requires discovery permissions, identity, snapshot format, and an authorized target. | Critical / XL |
| FR-028 | MISSING | No SQL query editor, data access layer, or masking policy found. Query/data access is explicitly outside the initial migration-governance MVP and requires a separate security contract. | Critical / XL |
| FR-029 | PARTIAL | Fastify API supports current project/release/plan/review/catalog/job resource set, but it is not a public uniform API. Keep current `/api` routes backward-compatible and add versioned target/plan payloads as needed; broad public API and machine-client support are deferred. | High / L |
| FR-030 | MISSING | No webhook or callback delivery subsystem found. Local Git source flow is manually initiated; inbound/outbound webhooks are deferred until a separate provider, signature, replay, and delivery policy is specified. | High / M |
| FR-031 | BLOCKED_EXTERNAL | Catalog database IDs are generated registration UUIDs with `MANUAL_REFERENCE` provenance. No Oracle DBID/CDB/PDB identity is observed. Requires a verified identity adapter and lab evidence. | Critical / XL |
| FR-032 | PARTIAL | Exact-case schema owner and project assignment are modeled; profile username is separately stored. Assignment is not included in plan intent, and catalog/read/deploy principals are not separated. Bind owner and execution principal to the approved target envelope. | Critical / L |
| FR-033 | BLOCKED_EXTERNAL | Code includes ambiguous-outcome HOLD and protected execution ledger paths. No Oracle DDL outcome has been observed or reconciled. Validate DDL commit/response-loss cases, ledger integrity, and safe operator recovery in lab. | Critical / XL |
| FR-034 | PARTIAL | Parser-derived statement envelopes exist, but no target-aware dependency graph or schema comparison is performed. Add catalog-aware review after discovery; keep unknown dependencies explicitly unresolved. | High / L |
| FR-035 | BLOCKED_EXTERNAL | Manual catalog includes container kind, endpoint/service, and environment hint. It lacks observed CDB/PDB/RAC topology and runtime identity. Requires Oracle lab, supported topology matrix, and stable target identity rules. | Critical / XL |

## Acceptance scenarios AS-01–AS-30

| ID | Status | Current evidence and gap / next action | Risk / effort |
|---|---|---|---|
| AS-01 | PARTIAL | API prehandler checks current project grant for project detail, audit, release, plan, and scoped routes; reference tests cover foreign-project, revoked-grant, and revoked-credential reads. Extend route coverage to every new workspace/target endpoint and test sensitive `credentialRef` visibility. | Critical / S |
| AS-02 | PARTIAL | Manual shared database/container references can contain separately assigned schemas; tests exercise project isolation. There is no real shared Oracle PDB observation or database-level ownership display. Keep workspace DB with schema assignments and validate against a shared-PDB fixture. | High / M |
| AS-03 | ARCHITECTURALLY_INCOMPATIBLE | Project-scoped instances are not modeled and are rejected by the recommended workspace-owned inventory. Amend acceptance to require project-specific schema views and shared workspace infrastructure. | High / S |
| AS-04 | PARTIAL | Project-scoped profile and schema-reference views exist; no complete workspace-wide inventory summary or multi-project physical estate portfolio. Add operator inventory view once target model is approved. | Medium / M |
| AS-05 | PARTIAL | Project environments and container environment hints exist independently. No ordered environment-to-target map or validation that a plan targets an allowed stage. Add one explicit environment per target-binding revision and policy. | High / M |
| AS-06 | PARTIAL | Project detail returns endpoint/user and opaque `credentialRef` to granted members; secret contents are not resolved there. Purpose-separated principal and field-level visibility are absent. Restrict reference visibility and define catalog/read/deploy identity boundaries. | Critical / M |
| AS-07 | IMPLEMENTED_VERIFIED | `sf_reference_assignments` enforces one active project per schema; transfer uses expected revision and audit. `product-schema-reference.test.mjs` exercises overlap/race rejection and history preservation. Shared schema ownership remains intentionally unsupported. | High / XS |
| AS-08 | IMPLEMENTED_VERIFIED | Local allowlisted Git releases retain commit, folder, manifest digest, and immutable file metadata; release integrity/comparison suites cover source facts. Does not imply target deployment. | Medium / S |
| AS-09 | MISSING | No SQL policy review engine or schema-aware policy set found. Unsupported, cross-schema, and database-level operations remain unverified and block executable admission; a future policy engine needs a separately versioned rule set. | High / L |
| AS-10 | PARTIAL | Pinned parser handles supported Oracle syntax and reports validation results. Complete dynamic PL/SQL and all constructs are not assured; unsupported syntax remains visible as unverified and cannot be treated as a pass. | High / M |
| AS-11 | BLOCKED_EXTERNAL | A plan/profile exists without a physical database/schema assignment in the intent. No unique target proof. Target binding is a prerequisite and requires observed Oracle identity. | Critical / XL |
| AS-12 | IMPLEMENTED_VERIFIED | Independent reviewer checks and self-approval restrictions are present in workflow tests/evidence. Preserve as a gate when target facts are added. | High / S |
| AS-13 | IMPLEMENTED_VERIFIED | Plan intent and decisions are immutable; source/intent changes require a new plan. Revocation preserves the original approval record. Tests cover retained facts. No in-place approved-plan editing should be introduced. | High / S |
| AS-14 | IMPLEMENTED_UNVERIFIED | Durable job and target mutex/ledger code exists, with synthetic tests. No Oracle or RAC concurrency acceptance. Use unit evidence only until multi-session Oracle tests pass. | Critical / L |
| AS-15 | BLOCKED_EXTERNAL | RAC topology and node/service failover are not observed. Requires authorized RAC lab and defined canonical target lock. | Critical / XL |
| AS-16 | BLOCKED_EXTERNAL | Current manual service/container references cannot prove selected PDB identity at connection time. Require worker-side physical identity check and mismatch HOLD in Oracle lab. | Critical / XL |
| AS-17 | IMPLEMENTED_UNVERIFIED | Coordinator is designed to hold uncertain execution and avoid automatic replay; synthetic execution tests exist. Real DDL commit followed by lost response is untested against Oracle. | Critical / XL |
| AS-18 | IMPLEMENTED_UNVERIFIED | Durable event/attempt metadata distinguishes request state and uncertainty, but no real target observation or applied history exists. Preserve all `NOT_OBSERVED` labels until proven. | Critical / XL |
| AS-19 | MISSING | No operator reconciliation authority/UI that compares real target ledger with durable job evidence and releases a HOLD. Future recovery requires independent target evidence and two distinct authorized actors; until accepted, HOLD is read-only. | Critical / XL |
| AS-20 | MISSING | No controlled public retry action found. Retry is deferred; any future manual continuation must follow independent reconciliation. Ambiguous DDL is never retried automatically. | Critical / L |
| AS-21 | MISSING | No skip migration action found. Skip is deferred until stream continuity, dependencies, approval, and immutable history semantics have their own contract. | High / M |
| AS-22 | BLOCKED_EXTERNAL | Drift comparison needs observed schema metadata; current catalog is manual. Requires discovery and versioned baseline. | Critical / XL |
| AS-23 | MISSING | No query execution, data masking, or result governance. Query/data access is outside the initial MVP and requires a separate security/product contract. | Critical / XL |
| AS-24 | PARTIAL | API resources are project-scoped and reference queries require membership; plans cannot carry arbitrary target IDs because target binding is absent. Add validated assignment ID scoped to the same project, with nonleaking failures. | Critical / L |
| AS-25 | MISSING | No callback delivery or deduplication contract found. Webhooks are deferred pending a separate provider, signature, idempotency, delivery, and replay policy. | High / M |
| AS-26 | PARTIAL | Project archive and profile retirement exist; workspace reference target lifecycle/disable behavior and in-flight job protection are incomplete. Add lifecycle states only after target-binding impact rules are defined. | High / M |
| AS-27 | PARTIAL | Assignment transfer closes old interval, records operator/reason, increments revision, and preserves plan/release/history rows. Existing plans do not bind assignment revision, so target-change invalidation is not enforceable yet. | Critical / M |
| AS-28 | PARTIAL | Plan records, execution attempts, and selected history are readable/downloadable with bounded fields; audit has paged API. No complete audit export contract or Oracle-applied history. | High / M |
| AS-29 | MISSING | No approval-service outage/fail-closed policy is needed while approval and identity remain local. Any future external policy/identity dependency must fail closed; the integration is deferred. | Medium / S |
| AS-30 | MISSING | No emergency bypass was found. Emergency bypass remains out of scope; no runtime or UI path may bypass approval, deployment grant, identity, or HOLD controls. | Critical / M |

## Coverage summary

Counts below assign exactly one primary classification to each requirement (35 FRs and 30 ASs). “Implemented” counts represent bounded repository evidence, not live Oracle behavior.

| Classification | FR count | AS count | Total |
|---|---:|---:|---:|
| IMPLEMENTED_VERIFIED | 0 | 4 | 4 |
| IMPLEMENTED_UNVERIFIED | 2 | 3 | 5 |
| PARTIAL | 20 | 10 | 30 |
| BACKEND_ONLY | 0 | 0 | 0 |
| UI_ONLY | 0 | 0 | 0 |
| MISSING | 4 | 8 | 12 |
| ARCHITECTURALLY_INCOMPATIBLE | 2 | 1 | 3 |
| BLOCKED_EXTERNAL | 7 | 4 | 11 |
| **Total** | **35** | **30** | **65** |

The FR-006, FR-009, FR-020, FR-027, FR-031, FR-033, FR-035, AS-11, AS-15, AS-16, AS-17, AS-18, and AS-22 evidence boundary is decisive: no authorized Oracle target/runtime was available. Static implementation does not satisfy those scenarios.

## Cross-cutting findings

1. **The most consequential design gap is approval-to-target binding.** An approved plan identifies a project release and project profile, while target assignment is introduced later during host admission. Approval therefore does not yet commit to the physical target and assignment revision required by the Oracle requirements.
2. **Manual references are carefully auditable, but provisional.** They are useful for inventory stewardship and project ownership, not Oracle discovery, identity attestation, drift, or applied history.
3. **Execution infrastructure is ahead of Oracle evidence.** Durable requests, attempts, receipts, locks, and HOLD behavior form a substantial kernel. Deployed worker count is zero; no Oracle claim should be inferred from synthetic tests.
4. **The one-project-per-database rule is the wrong ownership invariant.** Preserve physical inventory at workspace scope and use one active project owner per schema. This aligns the implementation’s reference catalog with shared PDB use.
5. **Identity administration is intentionally constrained.** Single organization, fixed local roles, OS-provisioned membership, and explicit deploy grants match the current private product boundary. Machine identities, workspace admins, invitations, and multi-tenancy are deferred from the initial product scope.
6. **Credential references need a tighter boundary before they become executable.** The current project detail returns opaque refs and endpoint facts to project members. Separate profile purpose and minimize access before adding any resolver.

## Architecture-review evidence refinement

The current worktree includes more Oracle execution contract code than the early deployment summary alone suggests. This refines source evidence but does not change classifications that depend on live Oracle proof.

| Topic / requirements | Current source evidence | What it establishes | What remains unproven / status effect |
|---|---|---|---|
| Session identity (FR-031/032/035; AS-11/16) | `packages/execution/oracle-driver.mjs` `oracleHostIdentitySql` and `readOracleSessionIdentity`; `apps/worker/oracle-host.ts` installed `attest` capability. | Session user/current schema, DB_UNIQUE_NAME, CON_NAME/CON_ID, service, session ID, proxy-user state are checked; privileged installer is expected to attest physical GUID/TLS/grants and route. | SQL itself does not collect DBID, PDB GUID, Data Guard membership/role, clone/restore/relocation lineage, or effective grants. No validated installed attestation exists. FR-031/035 and AS-11/16 remain `BLOCKED_EXTERNAL`. |
| Oracle mutex (FR-021/022; AS-14/15/17) | `packages/execution/oracle-target-mutex.mjs`; `apps/worker/oracle-host.ts`; worker continuity checks. | A same-session `DBMS_LOCK` with private nonce and no reacquisition is designed to survive DDL commit; target ledger and writer connections are separate. Loss/uncertainty poisons the capability. | No Oracle compilation/grant/RAC/service failover acceptance. DBMS_LOCK does not coordinate independent Data Guard databases. FR-021/22 and AS-14/17 stay `IMPLEMENTED_UNVERIFIED`; AS-15 stays `BLOCKED_EXTERNAL`. |
| Target ledger and ambiguity (FR-022/023/025/033; AS-17/18/19/20/21) | `packages/execution/oracle-target-ledger.mjs` (`oracleTargetLedgerId`); `apps/worker/run-request.ts`; `packages/execution/postgres-jobs.ts`; immutable DDL in `packages/database/index.ts`. | Complete file plan commits before STARTED; ordered ACKs precede APPLIED; lease expiry projects HOLD without creating a new attempt; API exposes durable request/attempt records. | Receipts/checksums do not prove SQL effects; no Oracle target is installed; no independently authorized HOLD reconciliation/recovery-release workflow exists. Current ledger partition helper hashes `targetKey + targetIdentityDigest`; if those contain mutable physical placement/full observation facts, it may not preserve one stream across relocation/role change. New contract must partition by stable `stream_id` and retain observation digests as ledger facts. FR-022 remains unverified, FR-023/025 partial, FR-033 blocked, FR-024/AS-19 missing, and retry/skip AS-20/21 missing. |
| SQL scope (FR-014/016/032/034; AS-09/10) | Pinned parser and exact statement envelope; `apps/worker/oracle-driver.mjs` executes parser-produced bytes unchanged. | Integrity and statement ordering are bounded; no semicolon splitting or implicit rewrite occurs. | Parser acceptance is not a proof that arbitrary Oracle SQL stays within one schema. Dynamic SQL, grants, ANY privileges, cross-schema references, CDB-root, and database-level DDL need a fail-closed grammar and effective-grant tests. FR-014/034 remain partial. |
| External schema changes and baseline (FR-009/016/025/027; AS-18/22) | `packages/execution/oracle-target-ledger.mjs` treats UNINITIALIZED as absent, requires separate empty-target verification or reviewed baseline, and holds unresolved tails. | The target ledger does not silently claim an empty schema or infer an applied prefix. | Ledger absence cannot detect out-of-band DBA changes or prove a baseline. No discovery/audit snapshot or accepted non-empty baseline exists. FR-009/027 blocked; FR-025 partial; AS-22 blocked. |

The relevant integration test `tests/product-controlled-execution.test.mjs` (and related execution suites) uses a fake Oracle transport plus real local PostgreSQL/Git/parser/approval state. It demonstrates protocol handling under synthetic capabilities, not Oracle DBMS_LOCK, actual DDL, catalog identity, TLS, privilege behavior, crash cleanup on a real server, Data Guard or RAC.

The earlier feature rows should be read with the refined architecture decisions: FR-011/AS-05 environment is on a separate target-binding revision, not on the ownership interval; FR-021/AS-14 lock code remains `IMPLEMENTED_UNVERIFIED`; FR-031/AS-11/AS-16 remain `BLOCKED_EXTERNAL`; and any execution/API row remains non-executable until M1's offline target-binding gate and topology-specific Oracle acceptance pass. This addendum changes evidence detail, not the 65 requirement classifications.

## Evidence references

Primary implementation: `packages/database/index.ts`, `packages/catalog-reference/index.mjs`, `packages/database/project-membership.ts`, `packages/database/profile-lifecycle.ts`, `packages/execution/admission.ts`, `packages/execution/*`, `apps/worker/*`, `apps/api/index.ts`, `apps/web/src/Instances.jsx`, `apps/web/src/app.jsx` and project/release/review screens.

Evidence: `tests/product-schema-reference.test.mjs`, `tests/product-schema-reference-browser.integration.mjs`, `tests/product-profile-lifecycle.test.mjs`, release/approval/execution suites, `docs/architecture/boundaries.md`, `docs/development/local-product.md`, `docs/implementation/MVP.md`, `docs/implementation/CURRENT.md`, `docs/implementation/tracking.md`, `docs/decisions/log.json`, and `evidence/product/mvp-completion-20261012/release.json` where present. Database-gated tests require `SCHEMAFORGE_TEST_DATABASE_URL`. This review did not run tests or use Oracle. The pre-existing untracked `evidence/product/plan-record-release-20261012/` was left untouched.

## Coverage evidence by requirement

To keep the requirement assessment readable, the tables above give each ID a primary status and specific gap; the evidence bundles below expose the six requested implementation dimensions. Each requirement-to-bundle row applies every named bundle's source, API, UI, persistence, authorization, and test evidence. **None** means no material current evidence in that dimension. A bundle documents implementation that exists; it does not upgrade the status or imply that an absent portion of a requirement is covered.

### Evidence bundles

| Bundle | Source symbols and exact paths | API coverage | UI coverage | Persistence | Authorization | Relevant tests/evidence |
|---|---|---|---|---|---|---|
| B1 Identity/project | `packages/database/index.ts` (`sf_organizations`, actors, credentials, projects, grants); `packages/database/project-membership.ts`; `apps/api/index.ts` `authenticate`, `GET /api/session`, `GET /api/projects`, project detail/archive; `packages/database/mutation-authority.ts`. | `/api/session`, `/api/account/*`, `/api/projects`, `/api/projects/:id`, `/api/projects/:id/archive`; no workspace CRUD or machine-client API. | `apps/web/src/app.jsx` project workspace and account/session UI. No workspace user/role administration. | `sf_organizations`, `sf_local_actors`, `sf_local_credentials`, `sf_projects`, `sf_project_grants`, `sf_project_operator_audit`. | Fixed local roles; current credential and explicit membership on project routes; separate deploy grant; OS operator membership tooling. | `tests/product-membership.test.mjs`, `tests/product-membership-browser.integration.mjs`, `tests/product-mutation-authority.test.mjs`; local auth evidence in implementation docs. |
| B2 Environment/profile | `packages/database/index.ts` (`sf_environments`, `sf_profiles`); `packages/database/profile-lifecycle.ts`; API project environment/profile routes; `apps/web/src/Instances.jsx`. | POST project environments/profiles; profile retirement endpoint; profile facts included in project detail. No route resolver. | `Instances.jsx` presents project Oracle profiles and labels configuration `CONFIGURED · UNVERIFIED`; project forms select environment/profile. | `sf_environments`, `sf_profiles`; host/port/service/username and opaque `credential_ref`. | Project membership + mutation authority; retirement guarded by role and active execution metadata. Opaque ref currently returned to granted project members. | `tests/product-profile-lifecycle.test.mjs`, `tests/product-mutation-authority.test.mjs`. |
| B3 Infrastructure catalog/assignment | `packages/catalog-reference/index.mjs` (`declareReference`, `assignReference`); `scripts/local-inventory-operator.mjs`; `packages/database/index.ts` reference DDL; API schema-reference handler. | `GET /api/projects/:id/schema-references`; declaration/assign/transfer/release are local CLI operations, not general product API. | `apps/web/src/Instances.jsx`, schema-reference components in `apps/web/src/app.jsx`; project-scoped and explicitly provisional. | `sf_reference_databases`, containers, services, schemas, assignment intervals, operator audit; partial unique active schema assignment. | Membership for project read; trusted local OS operator for inventory writes; expected-revision concurrency. | `tests/product-schema-reference.test.mjs`, `tests/product-schema-reference-browser.integration.mjs`, `tests/helpers/product-inventory-fixture.mjs`; synthetic/manual metadata only. |
| B4 Repository/release/parser | `apps/api/index.ts` repository/source/release/compare/preview handlers; release/parser packages; `apps/web/src/app.jsx` release intake. | `/api/repositories`, project git refs/source, release create/read/compare, statement preview. No webhook receiver. | Release intake and comparison/preview UI. | `sf_releases` with commit, folder, manifest digest, files and parser validation facts. | Current credential, project grant, source allowlist, mutation revalidation. | `tests/product-release-integrity.test.mjs`, `tests/product-release-comparison.test.mjs`, browser counterparts, release acceptance/provenance suites. |
| B5 Plans/review | `packages/governance/plan-record.ts`, plan-intent code, API plan/review/revocation handlers in `apps/api/index.ts`; frontend project plan/review components. | Create plan, source envelope, comments, reviewer assignment, decision, revocation, plan record. Target assignment is absent from plan API/intent. | Plan creation, review inbox, comments, approval/revocation, project history. | `sf_plans`, comments, approval revocations, `sf_history`; offline plan and intent digests. | Project grant, fixed developer/approver roles, reviewer independence, deploy permission separate. | `tests/product-plan-intent.test.mjs`, plan-source/target browser suites, approval-integrity/revocation suites, plan-record suites. |
| B6 Execution | `packages/execution/admission.ts`, `packages/execution/*`, `apps/worker/*`; API execution handlers in `apps/api/index.ts`; execution records UI. | Request execution, list/read jobs, cancel, attempts and records. Request starts waiting validation; API has no SQL authority. | Request status, job/attempt/history records, cancellation; no actual Oracle execution screen. | `sf_execution_jobs`, admission proofs, events, attempts, receipts; metadata `NOT_OBSERVED`/HOLD. | Explicit deploy grant; worker allowlist/capability and admission revalidation; assignment is checked at host admission but is not plan-bound. | `tests/product-execution-service.test.mjs`, `product-execution-jobs*`, `product-execution-record*`, `product-execution-history*`, profile lifecycle. Tests are synthetic/database-gated. |
| B7 Audit/history | `packages/database/index.ts` audit/history DDL; audit handler/API in `apps/api/index.ts`; audit/records UI in `apps/web/src/app.jsx`. | Project audit keyset pages and plan/job record reads; no general audit export. | Project Audit & history and record downloads. | `sf_audit`, `sf_history`, operator and execution audit/event tables. | Project grant on audit/record read; scoped operator writes. | `tests/product-audit-pages.test.mjs`, audit page/filter browser suites, execution-history suites. No tamper-proof or Oracle history claim. |
| B8 Not present / external | No query editor, callback service, Oracle discovery adapter, or live Oracle identity path found in app source. Architecture boundary docs explicitly keep target credentials unresolved. | None for SQL query, webhook callback, or Oracle discovery/sync. | None for query editor, callback management, or live discovery/health. | No query result, webhook delivery, observed Oracle catalog, or drift baseline tables identified. | No corresponding read-data, callback-signing, or Oracle discovery principal scope. | No relevant Oracle runtime acceptance. Existing offline/synthetic suites do not cover these behaviors. |

### Requirement-to-evidence mapping

| Requirement | Evidence bundles (all dimensions above) |
|---|---|
| FR-001 | B1 |
| FR-002 | B1 |
| FR-003 | B1 |
| FR-004 | B2, B3 |
| FR-005 | B2 |
| FR-006 | B3, B8 |
| FR-007 | B3 |
| FR-008 | B2, B3 |
| FR-009 | B3, B8 |
| FR-010 | B1 |
| FR-011 | B2, B3 |
| FR-012 | B4 |
| FR-013 | B4, B5, B6 |
| FR-014 | B4, B5 |
| FR-015 | B3, B5, B6 |
| FR-016 | B3, B4, B5 |
| FR-017 | B5 |
| FR-018 | B1, B5 |
| FR-019 | B1, B5, B6 |
| FR-020 | B6, B8 |
| FR-021 | B3, B6, B8 |
| FR-022 | B6 |
| FR-023 | B6 |
| FR-024 | B6 |
| FR-025 | B5, B6, B7 |
| FR-026 | B1, B3, B5, B6, B7 |
| FR-027 | B3, B8 |
| FR-028 | B8 |
| FR-029 | B1, B3, B4, B5, B6 |
| FR-030 | B4, B8 |
| FR-031 | B3, B8 |
| FR-032 | B2, B3, B6 |
| FR-033 | B6, B8 |
| FR-034 | B3, B4, B8 |
| FR-035 | B3, B8 |
| AS-01 | B1, B3 |
| AS-02 | B3 |
| AS-03 | B2, B3 |
| AS-04 | B1, B2, B3 |
| AS-05 | B2, B3 |
| AS-06 | B2 |
| AS-07 | B3 |
| AS-08 | B4 |
| AS-09 | B4, B8 |
| AS-10 | B4, B8 |
| AS-11 | B3, B5, B6, B8 |
| AS-12 | B5 |
| AS-13 | B5 |
| AS-14 | B6 |
| AS-15 | B6, B8 |
| AS-16 | B3, B6, B8 |
| AS-17 | B6, B8 |
| AS-18 | B6, B7 |
| AS-19 | B6, B8 |
| AS-20 | B6 |
| AS-21 | B6 |
| AS-22 | B3, B8 |
| AS-23 | B8 |
| AS-24 | B1, B3, B5 |
| AS-25 | B4, B8 |
| AS-26 | B1, B2, B3, B6 |
| AS-27 | B3, B5, B7 |
| AS-28 | B5, B6, B7 |
| AS-29 | B1, B5, B8 |
| AS-30 | B1, B6 |

The bundle mapping makes bounded evidence traceable without treating unrelated tests as proof. For example, B6 provides source/API/UI/persistence/auth/test coverage of the execution kernel, while B8 records that real Oracle execution, discovery, and query behavior have no current evidence.
