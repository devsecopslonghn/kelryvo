# Kelryvo Phase 1 — Product specification

Status: implementation-ready **offline vertical slice**, 2026-10-12. Scope is exactly (1) Project and Access Management, (2) Instance, Database and Schema Management, (3) Database Change Management. This document is normative for this increment; it does not authorize implementation, deployment or Oracle access in this specification task.

This specification defines independently authored Kelryvo product behavior. Existing-source statements below refer to the Kelryvo code baseline, not new test or live-system claims. For this increment, these contracts take precedence over overlapping proposals in the earlier requirements/UI documents; unrelated backlog and established safety invariants remain unchanged. Mandatory licenses, copyright notices and dependency attribution remain in their established notice files.

## Product boundary and decisions

The first useful outcome is: an authorized developer selects an assigned Oracle schema and explicit project environment, prepares an immutable target-bound offline plan from retained Git source, a different authorized approver reviews exactly those facts, and a separately deploy-granted actor can create and inspect a durable **non-executable** request. Revision changes block further authority without rewriting old evidence.

| Product concern | Kelryvo contract |
|---|---|
| Infrastructure ownership | One private workspace owns physical infrastructure; projects own Git releases, environments, plans and reviews. Use explicit schema assignments, not project-owned physical instances. |
| Oracle target selection | UI separates physical database, PDB/non-CDB, route and exact owner; no ambiguous “database” ID as the approved target. |
| Human authority | Preserve fixed developer/approver roles, operator-provisioned project and deploy grants, and one mandatory independent approval. No implicit creation grant. |
| Change records | Keep immutable plan/review and separate execution request/attempt evidence. No generic Issue or second rollout model is needed for this slice. |
| Target cardinality | Exactly one assignment/binding/environment per plan. The same release may produce separately reviewed plans; no implicit promotion order or expanding target set. |
| Evidence and execution | Phase 1 uses manual reference facts and offline parser evidence. Discovery and execution require separately accepted Oracle evidence; unknown DDL outcome always HOLD, never automatic replay. |

Safety invariants: API services never receive application writer secrets; credential references remain private metadata; no CDB root DDL; no approval bypass; no applied-history claim from parser, request, checksum or receipt alone; no destructive project/inventory purge; no secret in URLs/logs/browser persistence; no cross-project resource disclosure. Keep existing local Git allowlist, parser bounds, current credential/grant rechecks, restore hold and immutable evidence protections.

## Authority and shared behavior

Use existing authentication and same-origin browser sessions. At every read recheck current actor/grant. At mutation commit recheck credential, session/CSRF, membership, metadata generation and active project in the same serialized operation. UI eligibility is advisory. Grant removal during parsing or a delayed response must not leave protected data on screen or create new authority.

| Action | Current member, developer | Current member, approver | Deploy grant / OS operator |
|---|---|---|---|
| Read granted projects, assignments, target facts, retained plans/reviews/history | Yes | Yes | Deploy grant alone grants no read access |
| Create project receipt | Yes | Yes (existing API behavior) | Does not grant membership; operator must grant explicitly |
| Add environment/profile; import release; prepare plan | Preserve existing API allowance | Preserve existing API allowance; cannot approve own plan | No inferred execution privilege |
| Change protected source; archive project; retire profile; create project target binding | Yes; binding is new | No | Bootstrap/archived/restore-held writes blocked |
| Comment / assign eligible reviewer | Existing pending-plan eligibility rules | Existing pending-plan eligibility rules | Assignment is routing, not approval authority |
| Approve/reject / withdraw approval | No | Independent authorized approver only; respect assigned reviewer on decision | Mandatory independent approval; deploy grant cannot replace it |
| Create request | With deploy grant and current project grant | With deploy grant and current project grant | Current request checks remain authoritative |
| Cancel undispatched own request | Original requester with current project grant | Original requester with current project grant | No new deploy grant requirement; preserve existing cancellation authority |
| Register infrastructure, exact-owner assignment/transfer/release, configure target options, identity/grants | No browser action | No browser action | Trusted local OS operator CLI only |

Source nuance: generic create/environment/profile/release/plan handlers in `apps/api/index.ts` do not impose developer-only role checks; archive/source/retirement do. Preserve that compatibility deliberately. The first slice must show permitted actions consistently in UI and API, while adding developer-only binding mutation. A future role-policy change requires its own specification and migration.

All twelve screens below implement loading, empty, request error, stale/conflict, unavailable/incomplete facts, archived read-only, access-revoked/session-expired and metadata restore-hold states where applicable. Empty means a successfully read empty collection, never a failed/unknown inventory. Project/sign-out/session switch invalidates requests and clears old drafts/records before rendering the next scope. Same-scope refresh preserves a valid reviewer draft. Errors identify the failed action and safe next step; no sensitive connection/secret details. Use text status, keyboard-operable actions, one H1, labeled inputs, `aria-busy`, status/alert announcements and focus return after confirmation.

Keep the existing `/` application shell and page selection. Screen IDs below are contracts, not a demand for new deep-link routes. Add Project targets adjacent to Schema references; keep request/attempt views inside selected-plan context. Do not add a global inventory dashboard or navigation to unrelated modules.

## Screen contracts

### S01 — Sign in and workspace shell (module 1)

Fields: password-masked local access token; current actor ID/name/fixed role; selected project; bootstrap/restore banner. Actions: Continue, project selection, page navigation, Refresh, Sign out. HTTPS uses existing Secure/HttpOnly/SameSite cookie and CSRF; local HTTP development keeps bearer only in memory. POST `/api/session`, GET `/api/session`, POST `/api/session/logout`, GET `/api/recovery/status`. Invalid/expired credential gives generic 401; clear all protected content. Bootstrap has no workflow mutations. Do not expand the existing bootstrap resource projection in new endpoints: targets/options return no protected rows until access is ENFORCED.

### S02 — Projects and project settings (module 1)

List: name, description, active/archived state, retained ID. Detail: source binding summary and environments; project grant context. Create: name 1–200 characters, optional nonblank description up to 2000; preserve existing trimmed length validation. Receipt gives ID/time; explicitly say operator grant is needed and do not select/read the project until granted. Environment create: name 1–200; project-owned ID, no inferred stage ranking. Archive: nonblank reason up to 2000; confirmation retains release/plan/audit data and physical inventory. GET/POST `/api/projects`, GET `/api/projects/:id`, POST `/:id/environments`, POST `/:id/archive`. No rename, restore, delete or cascade is introduced. Do not invent display-name uniqueness: return existing `CONFLICT` only when an actual metadata unique constraint fails.

### S03 — Account and access (module 1)

Fields: own project grants and separate deploy capability; own session IDs, issued time, idle/absolute expiry and current-session flag. Actions: refresh, revoke another own browser session; for the current session use Sign out. The revoke endpoint returns 409 `CURRENT_SESSION_USE_SIGN_OUT` on current-session ID. GET `/api/account/access`, GET `/api/account/sessions`, POST `/api/account/sessions/:id/revoke` (no body). No other actor's token/grants, editable IAM or invitations. Render grant changes on next authorized request. An empty project list provides OS-operator provisioning guidance, not a grant button. Retain existing membership/session suites.

### S04 — Instance and connection context (module 2)

Existing project profiles: name, environment, engine Oracle, configured endpoint/user, active/retired status; label **Configured · unverified**. Reference catalog context: database label and PDB/non-CDB name only through authorized assignments. Profile create retains existing name/environment/host/port/service/username/reference validation, integer port 1–65535, and reference-only submission. Retirement requires reason 1–2000 and preserves old plans; admitted work blocks retirement. APIs: project detail, POST `/api/projects/:id/profiles`, POST `/api/projects/:projectId/profiles/:id/retire`.

Before target-bound planning ships, replace ordinary browser `credentialRef` output with a server-issued safe `credentialAlias`; remove raw reference from create/read responses, profile cards, error objects and record projections. Existing input accepts a reference but no password; clear this draft on completion or scope loss. References remain retained privately for compatibility and digest verification. Endpoint/user are compatibility facts, not physical identity or exact-owner assignment. No Test Connection or live Users tab in Phase 1.

### S05 — Assigned schemas and database context (module 2)

List only currently assigned schema rows: exact case-sensitive owner, database/container labels/kind, manual provenance, schema generation, **assignment ID and assignment revision**, route aliases/services, explicit binding environment or “Environment not mapped.” Keep legacy declared container environment separately labeled reference-only. Existing grouping by environment/service is display grouping, not project environment binding. Detail includes assignment start time, lineage/stream provisional state and current binding summaries. Actions: Refresh, Load more, Open target bindings. No assignment mutation in browser.

Extend GET `/api/projects/:id/schema-references?after=<schema UUID>` additively with assignment ID/start/revision; preserve existing 50-row pages, 10-service summaries and `servicesTruncated`. The existing `revision` is a **schema stewardship counter**, not a revision column on `sf_reference_assignments`. Define the active assignment revision as this captured counter; each ASSIGN/TRANSFER/RELEASE increments it. Closed intervals keep their original captured revision in retained binding/plan records. Never conflate registration `serverId` UUID with Oracle identity.

### S06 — Project targets and binding editor (modules 1/2/3)

List/detail: assignment/owner, selected project environment, binding ID/revision, safe route and principal aliases/purposes, policy revision, observation state/digest/time, provisional lineage/stream, eligibility reasons. Actions: developer **Create binding revision**, Refresh, Prepare plan from selected binding. Required input: active assignment, its expected revision, one current project environment, one operator-configured target option, expected option revision, expected current binding revision, nonblank reason 1–2000. First binding uses current revision `"0"`; replacement creates next revision for the same binding identity. No environment/route auto-selection. Explain that it prepares offline intent.

Target options are safe, project-scoped projections of trusted operator configuration: route must address the assignment's container, deployment-principal purpose must be `DEPLOY` (not `DISCOVERY`), and SQL-scope policy explicitly names the exact owner. Each option explicitly links an existing active project compatibility profile; its endpoint/service must match the declared route, environment must match the selected project environment, and username/reference must match the intended principal facts. That profile is a configuration anchor, never proof of owner or physical identity. The operator registers option and purpose references locally; the browser cannot invent or edit them. For manual inventory an option is **PROVISIONAL/OFFLINE_ONLY**, not an executable entitlement. A new binding must select a current, enabled option. ID/alias/revision and permitted environment are returned; raw refs and secret material are not. The option constrains available environments but never selects one automatically.

New GET `/api/projects/:id/target-options?assignmentId=<UUID>&after=<option UUID>`, GET `/api/projects/:id/target-bindings?after=<binding UUID>`, GET `/api/projects/:id/target-bindings/:bindingId`, POST `/api/projects/:id/target-bindings`. List pages max 50, stable UUID order, scoped cursor; collection responses are `{options,nextCursor}` and `{bindings,nextCursor}`. Binding detail returns `{binding,revisions,currentness}` for that project's binding only; `revisions` is a bounded latest-50 summary with older revisions accessible only through retained plan evidence in P0. POST returns 201 `{binding,currentness}`; no in-place update or delete. Bad/foreign assignment/option/binding/environment returns non-disclosing 404; current but disabled/incompatible option gives 409 `TARGET_OPTION_INELIGIBLE`; revision race 409 `TARGET_REVISION_CONFLICT`. After conflict preserve authorized inputs, refresh options/revisions, require explicit resubmit. Option changes never silently update a binding.

### S07 — Schema observation and object detail (module 2, later gated)

Phase 1 displays **Not observed** and provenance, not a fabricated empty table list. Reserve the existing schema detail area for a later read-only observation contract: observation ID/time/digest, lineage/physical container identity, exact owner, visibility/completeness, collector purpose/version, sync status/error; objects and column/constraint/index definitions only from a selected immutable snapshot. Last successful snapshot remains visible with stale label after collection failure. An unknown/incomplete snapshot cannot assert “no drift.” Schema export would identify that snapshot and its evidence scope. Sync/drift/export actions and APIs are **not shipped or invented in the first slice**; the blocker and prerequisites are defined below. No query/data editor, masking or schema editing is specified.

### S08 — Releases, retained source and comparison (module 3)

Fields: registered allowlisted repository/folder, protected source generation; branch/tag/ref or commit selector; full resolved commit/object format; release ID/manifest; file path/version/digest/bytes; parser profile/status; parsed statements with source ranges and source/execution digests. Actions: developer Change source, permitted member Import, inspect retained release, preview statements, compare two retained releases. Source comparison clearly says source-only. No arbitrary inline SQL changes to an imported immutable release.

Reuse GET `/api/repositories`, GET `/api/projects/:id/git-refs`, PUT `/:id/source` `{repositoryId,folder}`, POST `/:id/releases` `{repositoryId,commit,folder}`, GET `/api/releases/:id`, GET `/api/releases/:id/statement-preview?path=<retained path>` and POST `/api/projects/:id/releases/compare` `{baseReleaseId,candidateReleaseId}`. Preserve source allowlist/folder checks, pinned parser, resource limits and UTF-8/digest verification. Source unavailable/ref missing/parser unavailable do not become VALID; integrity failure blocks plan creation. Import after source change creates new retained evidence. Browser source and plan detail must agree on release ID and manifest before displaying shared facts.

### S09 — Plans, create and immutable detail (module 3)

List: ID, author/name/time, retained release, target owner/environment, decision status, current/stale/legacy target status. Create form: validated retained release and explicit current binding revision; show resolved owner/environment/route/assignment revision and provisional evidence before Submit. Exactly one target. No SQL editor, draft server Plan or extra Issue object is required; local create draft can be edited until submission. Persist directly as `PENDING_APPROVAL`, `OFFLINE_CANDIDATE`, `NOT_EXECUTED`, `NOT_OBSERVED`.

Detail: source evidence, **immutable target snapshot** and separate currentness comparison, parser/checks, approval digest, author, current decision/revocation, comments/evidence references, reviewer routing, request/history links and plan record download. A changed current target never replaces saved labels/owner/revisions. Unknown target currentness blocks approve/request. Stale plans remain readable and can be replaced with a fresh plan; no reset/resubmit of the same record.

Extend POST `/api/projects/:id/plans` with the versioned payload below, while preserving legacy `{releaseId,profileId}` decoding and behavior. Project detail/read and plan-record export return a safe additive target projection. Existing formats 1 and 2 of `offline-plan-intent.mjs` remain byte-for-byte valid; **new target-bound envelope is format 3**. HTTP `intentVersion:2` is the new request version, not retained envelope format 2.

```json
{
  "intentVersion": 2,
  "releaseId": "<UUID>",
  "assignmentId": "<UUID>",
  "expectedAssignmentRevision": "3",
  "targetBindingId": "<UUID>",
  "expectedBindingRevision": "2"
}
```

No mixed legacy/new fields or arbitrary endpoint/owner/credential strings. Revisions are canonical nonnegative decimal strings ≤ signed 64-bit max, matching existing stewardship conventions, not JavaScript numbers. Missing/foreign dependencies 404; valid-scope stale revisions 409 `TARGET_REVISION_CONFLICT`; invalid source/parser and integrity errors reuse existing codes. Return 201 with immutable plan ID/digest/public target and currentness. Serialize authority/project/assignment/binding/source checks; no plan/audit row on failed creation.

### S10 — Review inbox, comments and decisions (modules 1/3)

Inbox preserves All/Authored by me/Eligible scopes and bounded cursor. Row: project, plan, author, time, eligibility; detail rechecks scope and pending state. Review shows retained SQL/parser result, target envelope, currentness, required independent approver and reviewer assignment revision. Actions: author or current assigned approver assigns eligible reviewer with expected revision; an independent approver may claim an unassigned plan. Comment has nonblank body ≤4000 and up to 8 bounded statement evidence refs. Approve/reject requires nonblank reason ≤2000; withdrawal requires reason and expected approval reference. Existing pending/reviewer/author and comment evidence restrictions remain.

Reuse GET `/api/review-inbox`, GET/POST `/api/projects/:projectId/plans/:id/comments`, GET `…/reviewers`, PUT `…/reviewer`, POST `/api/plans/:id/decision`, POST `/api/plans/:id/approval-revocation`. For format-3 plans append `expectedIntentDigest` and expected assignment/binding revisions to decision request; server verifies them and target currentness at commit. Both APPROVE and REJECT on a stale plan return `FRESH_PLAN_REQUIRED`; view/comment routing must reflect current existing pending/evidence rules. Independent withdrawal remains possible for damaged/stale approved offline intent under existing safe withdrawal rules; it removes authority, not history, and does not clear HOLD. Decision preserves original envelope; approval reference links immutable audit and digest. Two concurrent decisions yield one retained decision; second sees pending-state conflict. Self approval 403; stale input 409; integrity failure 409. No automatic approval or bypass UI.

### S11 — Execution request and request/attempt inspection (module 3)

Form: selected approved plan/approval reference/digest, immutable target summary, explicit reason 1–1000; client-generated idempotency key 16–128 allowed characters. Button says **Request deployment**, with **Waiting for validation · execution unavailable** result. POST `/api/plans/:id/execution` `{idempotencyKey,reason}` rechecks target currentness for format 3 plus independent approval, current deploy/project grants, source/profile compatibility, metadata restore state and integrity. It creates a durable `PRODUCT_REQUEST/WAITING_VALIDATION` only. Same actor/key/payload returns same request; changed payload gives conflict. On network ambiguity retain key and inspect/repeat the identical request; do not issue a new key automatically.

Detail fields: request ID/state/revision/reason/requester/time, plan/approval/digest, readiness blockers, events, attempt IDs/states, receipt scope/digest where present. Separate request state from target effects. GET `/api/projects/:projectId/execution-jobs`, GET `/api/execution-jobs/:id`, GET `/:id/attempts`, GET `/:id/attempts/:attemptId`; bounded existing cursors/status refresh. POST `/api/execution-jobs/:id/cancel` `{expectedRevision}` (existing safe integer revision) is only for the original requester with current credential/project grant on an active project and undispatched WAITING_VALIDATION; no deploy regrant is required. Stale revision/dispatch/HOLD reject. No Run, Retry, Resume, Skip, Clear HOLD or automatic rollback. UNIT_SYNTHETIC evidence remains labeled as such, never Oracle evidence. Worker admission must reject format 3 until its separate admission/runtime acceptance is implemented.

### S12 — Audit, offline history and record downloads (module 3)

Fields: immutable action/time/actor/resource/context/reason, plan/source/target digests, review and request linkage. Use GET `/api/projects/:id/audit` and selected-plan request/attempt history. Offline migration rows remain NOT_EXECUTED/NOT_OBSERVED. Downloads retain bounded no-store checksummed JSON attachments: GET `/api/projects/:projectId/plans/:id/record` and GET `/api/execution-jobs/:id/record`. Show export time/scope, checksum-not-signature explanation, and current revocation limits. Add public format-3 target fields through versioned record projection; do not expose private credential refs or silently alter old export verification. Archived projects remain readable; current grant is always required. No generic whole-estate export or new retention policy.

## API and data contracts shared by the modules

Existing API baseline: `apps/api/index.ts`, `packages/database/{browser-sessions,account,project-membership,mutation-authority,profile-lifecycle}.ts`; data schema `packages/database/index.ts`; catalog lifecycle `packages/catalog-reference/index.mjs`. New APIs above are **proposed**, not present in that baseline.

Binding POST input (only these fields): `assignmentId`, `expectedAssignmentRevision`, `environmentId`, `targetOptionId`, `expectedTargetOptionRevision`, `bindingId` (optional only on first create), `expectedBindingRevision`, `reason`. On first create omit bindingId and expect `"0"`; on replacement supply existing bindingId and current revision. Reject unknown fields. Never use client-selected project/workspace/owner/endpoint/private refs as authority.

| Record | Data and integrity contract |
|---|---|
| Existing workspace catalog | Preserve `sf_reference_databases/containers/services/schemas/assignments` IDs and rows. One active assignment per schema; exact owner uses case-sensitive comparison. Schema stewardship counter supplies captured assignment revision. Service configuration is immutable today; future route change is an appended config revision, never old-row rewriting. |
| Target option (new operator metadata) | Workspace/project ID, immutable option ID/revision, scoped assignment/schema/container, compatibility profile ID and permitted project environment, route ID/config revision and safe alias, lineage reference and observation state/digest, SQL-scope policy ID/revision/exact-owner scope, deployment principal purpose/reference/private alias, migration namespace, enabled/current pointer. Operator provenance/time/reason. Disabled/superseded options remain retained. Each policy/principal/route/identity change creates a new option revision. No secret resolver. |
| Target binding (new project metadata) | Stable binding ID; project + assignment ID; append-only revision; captured assignment revision, project environment ID/name, option ID/revision and all resolved target facts, creator/time/reason. At most one current binding identity per `(project, assignment, environment)`; conditional unique constraints and composite scope FKs. Mutable current pointer advances only with expected revision. |
| Lineage / stream (new metadata) | Operator-declared provisional lineage ID per container, separate from generated registration UUID and eventual Oracle identity. Stable stream key `(lineage, exact owner, migration namespace)`; transfer preserves it. No project/environment/profile/service in stream key. Provisional stream has no applied authority. Identity mismatch blocks and requires explicit lineage/baseline decision; no automatic history inheritance on clone/restore. |
| Plan envelope format 3 | Immutable canonical bytes/digest: organization/project/author/time; release commit/object format/folder/manifest/file/statement/parser facts; source-binding generation; binding/assignment IDs/revisions; lineage/stream/state; exact owner; environment ID/name snapshot; route/config and identity observation state/digest; scope policy revision; intended deployment principal purpose/reference. Public projection omits private refs and raw endpoint where not needed. Digest covers private facts; public checksum cannot reconstruct/authenticate full envelope. |
| Decisions / requests / history | Preserve current immutable approval references, decisions/revocations, request identity, attempts/events/receipts and actor linkage. Approval covers full format-3 digest. Request saves that approval/digest and cannot be retargeted. Currentness is separately calculated, not a mutation of original intent/decision. |

Compatibility rule: `sf_plans.profile_id` is nonnullable today. New plans derive it from the operator-selected binding option, never from client input; retain that FK and existing legacy checks. Profile retirement stales/blocks new target-bound plans as it already blocks legacy approval/request. No null-profile migration or synthetic profile is needed.

Format 3 is the existing format-2 ordered array with discriminator 3 and one appended target tuple (position 22). Positions 1–21 keep format-2 meaning and include the explicitly selected compatibility profile/statement facts. The appended tuple order is fixed: `[bindingId, bindingRevision, assignmentId, assignmentRevision, targetOptionId, targetOptionRevision, lineageId, identityState, observationDigestOrNull, streamId, streamState, migrationNamespace, exactOwner, routeId, routeConfigRevision, routeAlias, policyId, policyRevision, deploymentPrincipalId, principalPurpose, privatePrincipalRef, principalAlias, createdAt, sourceBindingGeneration]`. Environment/profile are already in the base array; verify they equal binding facts. Snapshot time is a server-generated UTC ISO string. Manual identity uses PROVISIONAL and null observation digest; UNKNOWN/CONFLICT cannot pass binding creation. Digest is SHA-256 over exact canonical UTF-8 JSON array bytes. Golden round-trip vectors and malformed tuple tests are required in implementation. Reject extra/missing/oversized fields, invalid UTF-8, wrong-case owner substitution and digest mismatch. Unknown retained format stays readable as unavailable evidence and cannot gain authority. Composite FKs/unique constraints and transactions must enforce cross-project and revision rules; browser checks alone do not.

GET binding/plan projection includes `{retainedTarget, currentness:{state,reasons,checkedAt}}`. `state` is CURRENT, STALE, UNKNOWN or LEGACY_UNBOUND; reasons are bounded codes such as ASSIGNMENT_CLOSED, ASSIGNMENT_REVISION_CHANGED, BINDING_SUPERSEDED, OPTION_SUPERSEDED, ENVIRONMENT_CHANGED, SOURCE_CHANGED, POLICY_CHANGED, IDENTITY_CHANGED, INTEGRITY_UNAVAILABLE. CURRENT with PROVISIONAL identity means **offline-review eligible only**, never execution ready. Legacy format-1/2 plans are LEGACY_UNBOUND for target display; retain their existing offline APIs and mark them explicitly, rather than synthesizing a format-3 target or erasing their evidence.

In decision/request transactions compare saved assignment and current schema revision, assignment active project, binding current revision, option revision/enabled state, project environment, source generation and retained digests. Use existing authority serialization followed by consistent scoped project → schema/assignment → binding/option → release/profile/plan locks; align operator assignment/archive locks and add race tests before acceptance. Binding/option changes after approval preserve approval as historical evidence but invalidate new request/admission. Pending already-created requests remain inspectable/cancellable; no automatic target substitution. Any later admission must recheck every target fact.

| Error family | HTTP / user behavior |
|---|---|
| Authentication / CSRF / role | Existing 401 UNAUTHENTICATED; 403 origin/CSRF/DEVELOPER_REQUIRED/APPROVER_REQUIRED/SELF_APPROVAL_DENIED. Clear protected state on session loss; role denial keeps authorized read view. |
| Missing / foreign scope | 404 NOT_FOUND for unknown or foreign new target dependencies; no existence, owner, route, count or grant hint. |
| Input | 400 INVALID_REQUEST; field errors for malformed IDs, revisions, blank/oversized reasons; reject mixed plan versions and client target strings. |
| Lifecycle/revision | 409 PROJECT_ARCHIVED, MEMBERSHIP_BOOTSTRAP_REQUIRED, METADATA_RESTORE_HOLD, TARGET_REVISION_CONFLICT, TARGET_OPTION_INELIGIBLE, FRESH_PLAN_REQUIRED; refresh eligible facts, then explicit new action. |
| Retained evidence | Existing RELEASE_INTEGRITY_FAILED, PLAN_APPROVAL_INTEGRITY_FAILED, PLAN_RECORD_UNAVAILABLE and execution-record errors; display unavailable and block authority. No fallback to live/editable source. |
| Request | Existing deploy/approval/idempotency/cancel conflict codes; preserve idempotency key on ambiguous response. WAITING_VALIDATION is a successful durable request, not SQL success. |
| Infrastructure/unknown | Generic bounded error with request identifier; show retry for safe reads. Mutations with unknown outcome require read-back, not automatic duplicate submission. HOLD remains read-only. |

## State transitions and connected workflows

| Object | Allowed Phase 1 transitions | Effect |
|---|---|---|
| Project | ACTIVE → ARCHIVED via authorized reasoned archive | Retained readable, new workflow writes blocked; no infrastructure deletion or implicit assignment release |
| Profile | ACTIVE → RETIRED; rejects admitted execution | Retain facts; new plans/approval/admission blocked; no restoration |
| Assignment | Unassigned → assigned; assigned → transferred/released via CLI CAS | Close interval, increment stewardship revision, preserve old ownership evidence and streams; affected format-3 plans become stale |
| Binding | Absent → revision 1; current r → appended r+1 via CAS | Preserve old revisions; old plan target immutable and stale |
| Plan decision | PENDING_APPROVAL → APPROVED or REJECTED; APPROVED → REVOKED by appended revocation | No reset/edit; currentness orthogonal; one independent decision |
| Product request | Creation → WAITING_VALIDATION; WAITING_VALIDATION → CANCELLED under current authority/revision | No admission or Oracle effects in first slice |
| Existing later execution states | ADMITTED → HOLD/NOOP/VERIFIED_SUCCESS are existing kernel states, **outside Phase 1 authority** | Preserve existing evidence display; no new transition producer; never infer Oracle acceptance from synthetic state |

Setup flow: OS operator provisions local actors/grants and registers manual database/container/service/owner assignment → member opens granted project and creates environment and compatibility profile → operator configures offline target option linking that profile and assignment → developer opens assigned schema and explicitly creates environment binding → member imports allowlisted retained release → creates format-3 offline plan → another eligible approver reads saved/current target, SQL and checks and approves → actor with deploy grant creates durable request → inspect/cancel/download. Each step has a server-validated prerequisite; missing assignment/option provides operator guidance, not free-form target entry. Extend the existing trusted local inventory operator with a target-option registration/revision action using the data contract above and the same local metadata-config authorization; this command is proposed, not present today. It registers references only and never tests connectivity.

Change flow: operator transfer/release or option change, developer new binding revision, source rebinding or archive → existing plans remain intact → currentness shows cause → decision/request on stale plan fails → prepare fresh plan if target remains assigned → independent new approval. Transfer reveals no new project's private facts to the old project; old project's retained plan snapshot remains readable under its own grant.

Failure flow: parser unavailable or damaged retained bytes → no new plan/approval; access revoked during read → clear view; grant revoked during commit → no mutation; stale reviewer/binding CAS → refresh without overwrite; request response lost → recover same idempotency key; restore hold → disable writes/cancellation; ambiguous later Oracle work → HOLD with evidence inspection only.

## Existing code: reuse, simplify, rebuild

| Area / source-verified baseline | Disposition and gap |
|---|---|
| `apps/web/src/app.jsx`; `Instances.jsx`, `Account.jsx` | Reuse shell, project epoch invalidation, scoped drafts and feedback. Simplify instance page to compatibility connection context + assigned schema navigation; remove raw ref rendering. Build a bounded target list/editor/detail using existing page conventions, not a wholesale UI rewrite. |
| `apps/api/index.ts`; `packages/database/{mutation-authority,project-membership,browser-sessions,account}.ts` | Reuse Fastify/current identity/grants/CSRF. Add target APIs through same guards and safe projections. Preserve the existing local authority model; no browser operator administration. |
| `packages/catalog-reference/index.mjs`; `scripts/local-inventory-operator.mjs`; catalog tables | Reuse exact-owner registration, one-owner constraint, CAS transfer and operator audit. Add retained assignment revision projection, provisional lineage/options and trusted local configuration. Registration conflicts remain immutable; do not rebuild ownership. |
| `packages/migrations/{offline-plan-intent,verify-retained-release}.mjs`; parser envelopes | Reuse retained source/digests/parser/statement order. Add format-3 codec and target materialization beside compatibility codecs. Do not infer schema-aware correctness from parser validity. |
| Review/comment/reviewer/revocation handlers in `apps/api/index.ts`; `packages/governance/plan-record.ts` | Reuse decision independence, reviewer CAS, bounded evidence and safe withdrawal. Extend integrity and currentness checks to target envelope; version public export. |
| `packages/execution/{admission,postgres-jobs,history,record}.ts`; `apps/web/src/executionJobs.js`; `apps/web/src/{ExecutionHistory,ExecutionRequestsHistory,ExecutionRecord,PlanRecord}.jsx` | Reuse durable idempotent request/events and read/download panels. Add format-3 request checks; admission rejects unsupported new envelope until separately accepted. No new rollout/scheduler architecture. |
| `packages/database/index.ts` migrations | Add schema incrementally; preserve old rows/envelope bytes/IDs/grants/audit. Test migration rerun and old-data readability; no wholesale recovery merge/reset/rewrite. |

Current source has no target-binding table/API or format-3 plan codec, and project detail/Instances still expose opaque `credentialRef`. Those are implementation gaps, not delivered behavior. Existing discovery/driver/worker code and synthetic tests provide candidate mechanisms only; no lab observation or execution was performed in this task.

## Feature → screen → API → data → test traceability

Tests marked **existing** are source entry points to reuse, not executed here. `P1-…` are required new acceptance cases, not present test files. FR/AS links retain recovery identifiers without claiming the whole legacy catalog complete.

| Feature / requirement | Screens | API / command | Data | Verification |
|---|---|---|---|---|
| F01 Session and current project isolation (FR-002, AS-01) | S01–03, all protected screens | session/account/project reads; mutation authority | actors, credentials, project/deploy grants, browser sessions | Existing `product-secure-sessions`, `product-membership`, `product-mutation-authority`, `product-account` API/browser suites; P1-01 revoke during target read/create/decision/request, delayed response after switch/logout |
| F02 Project/env/archive, no implicit grant (FR-010/011) | S02 | create/env/archive routes | projects/environments/audit | Existing `product-archive-browser.integration.mjs`, `product-membership.test.mjs`; P1-02 archive preserves bindings/requests; approver compatibility and receipt remains unreadable until granted |
| F03 Connection minimization/lifecycle (FR-005, AS-06/26) | S04 | profile create/read/retire | profiles/private ref + alias | Existing `product-profile-lifecycle.test.mjs`, `product-instances-browser.integration.mjs`; P1-03 raw ref absent from browser/read/export/error while old digest verifies; no connection attempt |
| F04 Shared PDB exact-owner assignment (FR-007, AS-02/07/27) | S05 | schema references; local inventory assign/transfer/release | reference tables + stewardship revision | Existing `product-schema-reference.test.mjs` and browser suite; P1-04 two projects in one container, same-case/case-distinct owner isolation, captured interval revision, >50 pagination/service truncation |
| F05 Explicit environment binding/CAS (FR-011/015, AS-05/24) | S06 | target-options/bindings routes; trusted local option registration | target options/binding revisions, env, assignment | P1-05 first binding and two simultaneous replacements: one wins; foreign IDs nonleaking; no default environment; wrong container/purpose/owner policy rejected |
| F06 Immutable target and stream continuity (FR-013/015/031/032) | S05–06, S09–10 | versioned plans; currentness reads | lineage/stream + format-3 envelope | P1-06 schema transfer preserves stream but stales old plan; option/route/environment/source changes stale without rewriting bytes; provisional never executable |
| F07 Retained release/parser integrity (FR-012/014/016, AS-08/10) | S08–09 | source/releases/statement-preview/compare | retained releases/source generation/statements | Existing `product-release-integrity`, `product-statement-envelope`, `product-protected-source-binding` API/browser suites; P1-07 format-3 exact source digest and tampered/unsupported/oversized input rejects |
| F08 Independent bound approval/revocation (FR-018, AS-12/13) | S09–10 | decision/reviewer/comments/revocation | immutable plan/decision/approval/audit | Existing `product-approval-integrity`, `product-reviewer-assignment`, `product-comments`, `product-approval-revocation` suites; P1-08 author denial, concurrent decision, expected digest/revision race, stale approval blocks request, withdrawal preserves old record |
| F09 Durable request and safe cancellation (FR-019/023, AS-17/20) | S11 | execution/create/list/detail/cancel | jobs/events/attempts/admission scope | Existing `product-execution-jobs` API/browser suites; P1-09 same key same request, changed key-payload conflict, grant/binding race and stale cancel; format-3 cannot admit/dispatch |
| F10 Truthful retained evidence (FR-022/025/026, AS-18/28) | S09, S11–12 | plan/execution records, audit/history pages | public projections/digests/audit/receipts | Existing `product-plan-record`, `product-execution-record`, `product-audit-pages` API/browser suites; P1-10 format-3 public record checksum/limits/private-ref exclusion and explicit NOT_EXECUTED/NOT_OBSERVED |
| F11 Additive compatibility/recovery (AS-13/26/28) | All | old and new request codecs; migration bootstrap | unchanged old formats/IDs + additive tables | Existing `product-incremental-migrations.test.mjs`, `product-metadata-recovery.test.mjs`; P1-11 seeded format-1/2 plans and archived/revoked data readable after migration; restore hold denies all new target writes |
| F12 Observation/drift (FR-006/009/027; AS-22) | S07 | No Phase 1 live API | eventual immutable snapshots | P1-12 browser displays Not observed, not empty/live tables; later authorized collector/visibility/drift acceptance is external and required before capability ships |

## Prioritized first browser-usable vertical slice

**P0: Target-bound offline governance**, one connected delivery, no intermediate API-only acceptance.

1. Add assignment revision projection, provisional lineage/stream and operator-configured offline target options; add append-only project bindings/CAS with safe project projection. Add migration and foreign-scope/race coverage first.
2. Add S06 list/detail/editor using an operator-seeded two-project/shared-container fixture; minimize raw credential-reference output in S04 and retained public projections.
3. Add immutable format-3 plan creation/detail and currentness; extend independent review/request/export guards, preserve old envelope readers and reject new worker admission.
4. Finish browser path across S01/02/05/06/08/09/10/11/12: developer creates binding and plan; different approver reviews; deploy-granted actor requests and inspects WAITING_VALIDATION/cancels; transfer or revision change makes the saved plan stale. Use real local PostgreSQL + Chromium with offline parser fixtures, no Oracle adapter or network call.

Acceptance requires P1-01 through P1-12 and affected existing regression suites, `npm run check`, project PRODUCT API/browser/fresh-source checks as required by repository CI, and a reviewed documentation/code diff. Test independence, grant-revocation commit race, simultaneous binding/decision/CAS, stale requests, no raw refs, existing data preservation, no format-3 worker dispatch and zero Oracle interactions. Check local UI states at desktop and narrow viewport with keyboard-only flow. Mock browser APIs are useful for delayed/error states, but successful governance behavior must exercise real metadata persistence. Never claim skipped/offline checks establish Oracle acceptance.

**P1 after that slice:** improve retained source/target readability and bounded listing within these modules only, guided by browser acceptance. Keep established shell and API unless the connected flow demonstrates a concrete issue. No broad architecture work, new admin boundary or extra workflow object.

**P2 externally gated:** accepted read-only Oracle identity/schema observation, then schema-aware checks/drift, then separately accepted trusted execution. These are not prerequisites to implementing/accepting the P0 offline slice and are not authorized by this task.

## Coverage and unresolved blockers

Coverage: all three modules have navigation, screen, field, action, API, permission, state, error and workflow contracts; twelve Kelryvo screen contracts; twelve traceability rows with required acceptance outcomes; explicit data/version/authority/race compatibility contracts and an ordered P0 slice. S01–06 and S08–12 are implementation-ready for offline behavior; S07 is a deliberately gated Not observed state. Retained Kelryvo Git import and bounded execution views define the release and request inspection behavior; live Oracle capabilities remain externally gated.

| Unresolved external prerequisite | Precise impact / evidence required / responsible role |
|---|---|
| Oracle version/topology/identity and disposable-lab authority | Blocks connection/discovery/execution, not offline slice. Owner + DBA must supply authorized, secret-free attested disposable target, permitted actions and accepted non-CDB or PDB identity/grants evidence. No RAC/Data Guard/clone/restore/relocation authority assumed. |
| Read-only observation/completeness and policy engine acceptance | Blocks live S07 metadata/drift and schema-aware checks. DBA + implementation owner must establish discovery-principal scope, immutable snapshot completeness and collector/policy revision evidence. Offline parser validity cannot replace it. |
| Execution-principal/worker/lock/ledger and outcome evidence | Blocks ADMITTED/Oracle success for new target-bound plans. Owner + worker/DBA acceptance must prove isolated secret resolution, exact identity, shared physical-container locking, commit/response-loss HOLD and reconciliation. No automatic replay or API release of HOLD. |
| Future web inventory administration / configurable roles | Deferred product boundary, not required work. Needs explicit representation of OS-operator authority before any inventory/IAM browser mutation; no provisional application-admin role is created. |

No unresolved product decision blocks the first offline slice. Real grant holders, safe route/principal aliases and repository fixtures are operator setup inputs, not invented identities. Stop Phase 1 specification here; implementation begins as a separately authorized task using these contracts.
