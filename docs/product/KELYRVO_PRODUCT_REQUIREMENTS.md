# Kelryvo product requirements, state and roadmap

This is the source of truth for product direction, delivered capability and the remaining backlog. Architecture alignment: [PR #112](https://github.com/devsecopslonghn/kelryvo/pull/112), reviewed source `8769fe8`, merged 2026-10-15 for one instance credential and multiple project schemas. This document records delivered product behavior and its evidence boundaries; it does not certify the current deployment.

Kelryvo is a self-hosted, Oracle-first Database DevOps platform. Its primary workflow is **Connect Instance → Discover Schemas → Assign to Project → Author SQL → Validate → Plan → Independent Review → Execute → History & Audit**. Projects may own multiple schemas; each migration stream targets one assigned exact schema through the instance master credential. Historical source revisions have bounded real Oracle discovery, V1/V2 execution and witnessed no-op evidence on one owner-approved lab variant; that evidence does not accept the unified runtime candidate. Full Oracle feature, topology and fault acceptance remains incomplete.

## Start here and maintain one backlog

1. Read the capability table and roadmap below; select one bounded outcome and its exit criteria.
2. Inspect the referenced code, tests and retained evidence. A merged PR or test file alone is not functional proof.
3. Read [architecture and safety contracts](../architecture/KELYRVO_ARCHITECTURE_DECISIONS.md), repository `AGENTS.md` and the relevant [local product/API contract](../development/local-product.md). Preserve compatibility and security gates.
4. Implement the complete API + database + browser workflow, run relevant acceptance, review and satisfy [integration gates](../implementation/github-sync.md). Update this document's affected row and milestone with the actual evidence boundary.

The [legacy tracker](../implementation/tracking.md) preserves the 220 original feature IDs, original criteria/dependencies, 63 Oracle feasibility cases and historical bounded tasks. Its BACKLOG state often means **full original catalog acceptance is unproven**, not that the current product has no implementation. Its historical phase labels do not schedule new development. Do not duplicate this roadmap in a new phase plan or mark whole catalog features verified from narrower acceptance. Original research is immutable input, never product evidence.

[Current session entry](../implementation/CURRENT.md) links here. [UI conventions](KELYRVO_UI_UX_DESIGN_SPECIFICATION.md) specify shared interactions. [Historical MVP acceptance](../implementation/MVP.md), the historical Phase 1 protocol reference and Stitch handoff retain dated evidence/design context; they are not active specifications or current deployment claims.

## Current product and evidence

**Latest bounded Oracle evidence, 2026-10-28:**
[Reviewed D6 continuation](../../evidence/product/oracle-delivery6-currentness-20261026/continuation-20261027.json)
records one real V1/V2 seed with two KP_B tables, ten ledger events, two applied
migrations and two central receipts. Its original operator failure remains retained;
a separate independent read-only review accepted the actual effect and preservation
of all 68 metadata tables, 12 HOLDs and 129 protected old-PDB witness rows. Native
receipt digests include an unretained dispatch UUID: their preimages were not
independently recomputed, and they are distinct from Oracle ledger receipt digests.
The later independently reviewed D6 ADMITTED/NOOP case passed all four live API
probes before gate release, then finished NOOP with zero application SQL or ledger
writes. A fresh full audit preserves 58 jobs (23 CANCELLED, 12 HOLD, 6 NOOP,
17 VERIFIED_SUCCESS), 868 credential projections, all 68 metadata tables and 129 old
Oracle witness rows, with no WAITING/ADMITTED. The two seeded migrations and ten
ledger rows remain unchanged. Full Oracle topology, SQL/fault/recovery matrices and
the driver DNS connect-string path remain unqualified; this is one bounded lab case.
Use [the current session entry](../implementation/CURRENT.md) for expiring authorities
and the required separately reviewed currentness refresh; never replay the seed.

**Historical Oracle attempt, 2026-10-25 12:05 UTC:**
[Two retained ADMITTED cases](../../evidence/product/oracle-admitted-attempt-20261025/acceptance.json)
have independently reviewed preservation, not successful probe/NOOP acceptance. One
request ended CANCELLED before staging; another reached a real zero-pending admission
after an EXACT_APPLIED preflight, then failed its controller gate and was recovered to
retained HOLD through a reviewed PostgreSQL-only operation. The old 52 jobs, 11 HOLDs,
four snapshots, baseline and Oracle 8/48/4 state remain; current totals are 53 jobs with
12 HOLDs and no WAITING/ADMITTED. Both cases' browser children are revoked. Image
`557c7d47…` is unchanged and execution stays off. KP_DELIVERY5 is held; further native
work requires a fresh qualified target and new approvals. Controller cause, live four-probe
acceptance, full OA09 and the remaining matrices stay open; consult CURRENT before acting.

**Fresh target bootstrap, 2026-10-26 local:**
[KP_DELIVERY6 bootstrap and preservation](../../evidence/product/oracle-delivery6-bootstrap-20261026/acceptance.json)
passed one independently reviewed operation. D6 is empty with 56 segregated purpose
grants; all prior PDB identities/recorded witnesses, 68 metadata tables, 802 credential
projections, 53 jobs and infrastructure were preserved. Image and execution-off state
are unchanged. This bootstrap result does not qualify later operations; read-only
purpose qualification passed subsequently as recorded below. Onboarding, governed
V1/V2 and the fresh ADMITTED/NOOP case remain open.

**D6 purpose qualification, 2026-10-25 23:08 UTC:**
[Read-only acceptance](../../evidence/product/oracle-delivery6-readonly-20261026/acceptance.json)
passed six purpose-account connections, the full 56-grant closure including the ledger
negative check, protected source and empty application/ledger state. All 68 metadata
tables, 802 credential projections, 53 jobs/12 HOLDs and recorded old Oracle witnesses
remain exact. DNS resolved to the pinned IP and both aliases connected by IP; the driver
DNS connect-string path is unqualified. Discovery/onboarding, governed V1/V2,
ADMITTED/NOOP and full acceptance matrices remain open. Historical reviews have expired;
further actions need their own current attestation and independent approval.

**D6 discovery repair, 2026-10-26 01:54 UTC:**
[Independent configuration and preservation proof](../../evidence/product/oracle-delivery6-discovery-repair-20261026/acceptance.json)
records the corrected canonical acceptance timestamp and a new D6-only discovery
window. The same-image restart preserved all 68 metadata tables, 810 credential
projections, 53 jobs/12 HOLDs and the other twelve Secret values. No Oracle connection
or API mutation occurred. Native execution authority remains expired; schema onboarding,
governed migrations, ADMITTED/NOOP and the full matrices remain open.

**D6 schema onboarding, 2026-10-26 01:58 UTC:**
[Independent live onboarding proof](../../evidence/product/oracle-delivery6-onboarding-20261026/acceptance.json)
records one actual read-only discovery, five explicit schema assignments and five
VERIFIED bindings. Discovery remains PARTIAL outside the five accepted owners.
All prior rows across 68 tables, 53 jobs/12 HOLDs and old target snapshots/history
are preserved. The two logins added four credential projections (810 to 814), with
both new browser children revoked. No Oracle DDL/DML or worker dispatch occurred.
Governed D6 migrations and ADMITTED/NOOP remain open.

**Latest bounded delivery, 2026-10-25 07:26 UTC:**
[Schema navigation and UI acceptance](../../evidence/product/schema-route-delivery-20261025/acceptance.json)
records image `557c7d47…`, the Stitch-guided schema layout and the three-file fix that
preserves Schema and its exact selected target after reload. Two-role real HTTPS viewing,
comparison and reload passed, with four desktop/mobile light/dark screenshots and 18
local/LDAPS/OIDC checks. The reviewed image-only rollout preserved all 68 metadata tables,
four snapshots, one baseline, 50 jobs and 11 HOLDs. All 64 business tables remain unchanged
after the browser checks; all eight new browser children are revoked. Standard checks
passed 494 tests with 152 skips; six schema/theme cases, a focused route regression,
cold OCI isolation, anonymous digest pull and exact live assets passed.
The preceding `00d27393…` collector passed one exact-identity KP_B schema read without
query-unavailable limitations. Coverage remains PARTIAL and comparison UNVERIFIED;
this image-only delivery performs no new Oracle observation or governed execution.
The earlier `1945dc93…` reload failure and corrected HTTP-fixture regression failure
remain retained. Full R1/R2/OA acceptance and absence of drift are not established. See
[the current entry](../implementation/CURRENT.md) before reusing any private case.

[Fresh current-image SELECT-only qualification](../../evidence/product/schema-route-readonly-20261025/acceptance.json)
then passed at 07:37 UTC: six purpose identities via DNS/IP, eight application objects,
48 ledger events/four heads and four historical PDBs preserved. Saved PostgreSQL
before/after snapshots match all 68 tables; independent outcome review passed.
This performs no new catalog/schema observation or migration, renews no expired
installation authority, and leaves the full acceptance matrices open.

[Queued request idempotency on the delivered image](../../evidence/product/oracle-queued-idempotency-20261025/acceptance.json)
passed at 07:52 UTC after fresh read-only discovery verified five existing bindings.
Twelve real API probes cover exact retries, changed payload/key/cross-plan conflicts,
authorization and revision checks, and cancellation. One new independently approved
plan/request was created; the request ended CANCELLED revision 1 without admission,
attempts, receipts or Oracle SQL. Independent comparison retains all 4,017 prior rows
across 68 tables. At that checkpoint totals were 51 jobs, including 11 unchanged HOLDs, four snapshots
and one baseline; both new browser children are revoked. A final live PostgreSQL read
matches the saved result. Discovery's separate credential row-preservation assertion
cannot be reconstructed from its saved aggregate hashes; the queued case does retain
and independently compare its credential rows. At that checkpoint ADMITTED and the
full matrices remained open; the latest D6 evidence above now covers the bounded
ADMITTED/NOOP case. Full OA/R1/R2 acceptance remains incomplete. No new runtime image
or writer authority was needed for that queued case.


The earlier [identity development delivery](../../evidence/product/local-identity-auth-20261025/acceptance.json)
is worktree `0afe074f…` based on `8796a57`, Docker Hub digest `c7d6faae…`.
Local password remains primary; optional configured OIDC SSO and verified LDAPS636
passed real public-browser login for both fixed roles before and after restart. Standard
checks, all 217 API cases, all 58 final browser cases and exact-image isolation passed;
the browser evidence retains one historical navigation-count failure and its corrected
final-source rerun. Every original metadata row was retained through upgrade; all 68 tables
and 14 historical record comparisons were unchanged across restart. This is owner-authorized
non-production acceptance, with no canonical signed commit, hosted CI or gated release claim.
Oracle execution stays disabled; discovery is enabled but target availability is UNVERIFIED.
The changed authentication/admission source does not inherit historical native qualification.

The historical unified container at source `3ea8859` has [bounded local and deployed acceptance](../../evidence/product/unified-runtime-20261023/acceptance.json):
one image/entrypoint for Docker and Helm, separate unprivileged API/execution roles,
199 API tests, 55 browser tests and fresh-source installation passed. Owner-authorized
AMD64 Kubernetes acceptance passed secure role login, review/downloads, mobile layout
and restart with unchanged original metadata and PostgreSQL/PVC identity. This uses a
temporary Docker Hub development image with Argo auto-sync paused, not a gated release.
Oracle discovery/execution remain disabled and new-runtime Oracle acceptance is NOT_RUN
pending the current attested lab/installation and SQL/fault scope. Historical Oracle
results below do not qualify this new runtime or the additional ALTER ADD/INDEX forms.

**Delivered offline** means connected backend/database/browser behavior with local PostgreSQL/Git/parser/Chromium acceptance coverage and retained or hosted passing results. **Partial** means usable facets exist but a material requirement remains. **Unverified runtime** means code and fixture/synthetic tests exist without the relevant live Oracle evidence. No status below claims all original catalog criteria passed.

The current packaging work is a **single-image runtime candidate**, not a completed pilot.
Docker and Helm use one application image with a native root bootstrap, API UID 10001 and
internal execution/discovery UID 10002. The processes exchange only fixed internal
operations; application migration work continues through durable PostgreSQL requests.
The current SQL policy admits scalar `CREATE TABLE`, scalar `ALTER TABLE ADD` and simple
`CREATE INDEX`, but Oracle evidence does not transfer between source revisions: historical
PR #112 evidence accepts only its tested `CREATE TABLE` statements. Full Oracle acceptance of
the unified runtime remains **IN PROGRESS**; use the dated bounded evidence above and
the current delivery entry for source-specific results.

The baseline candidate for PR #93 (`60dd5a2`) passed the full hosted API, browser, frozen-source release, parser, foundation, both OCI platforms and security checks. These suites use disposable metadata and fixtures, not Oracle. See [PR #93 checks and acceptance scope](https://github.com/devsecopslonghn/kelryvo/pull/93). Earlier retained runs include [runtime journey](../../evidence/product/phase6-runtime-acceptance-20261013/acceptance.json), [SQL workspace](../../evidence/product/phase7-product-workspace-20261013/acceptance.json) and [workflow hardening](../../evidence/product/phase9-hardening-20261013/acceptance.json). They establish their recorded source/date only; final consolidation checks are reported by its PR.

| Capability | Assessment and practical limits | Implementation / acceptance anchors |
| --- | --- | --- |
| Access, projects and environments | Fixed human roles, explicit project/deploy grants, independent approval, archive/read-only history, own-session management and HTTPS cookie/CSRF/expiry. Local username/password remains primary; proof-bound setup extends an existing identity. Optional OIDC SSO and LDAPS sign-in require an explicit OS-granted identity-configuration capability and exact subject-to-existing-actor mapping. Provider claims/groups never assign roles or grants; no JIT provisioning, invitations, or application superuser. Provider change/disable, mapping revocation, and anchor revocation invalidate external sessions. Real Keycloak/OpenLDAP lab interoperability is accepted for both roles before/after restart; other providers remain unqualified. | `packages/database/{project-membership,browser-sessions,password-auth,account}.ts`, `packages/identity/`; `apps/web/src/{PasswordLogin,ExternalSignIn,IdentityProviders,Account}.jsx`; `tests/product-password-auth.test.mjs`, `tests/product-password-auth-browser.integration.mjs`, `tests/product-identity-providers-browser.integration.mjs`, existing membership/session suites |
| Instances and connections | Delivered API/browser and bounded live master workflow: one external master reference per Oracle PDB/non-CDB, connection before assignment, multi-schema discovery/assignment, derived immutable deployment profiles, instance reuse and authorized legacy discovery connections, endpoint validation, Service Name/SID metadata, private credential aliases, immutable revisions, filtering, reasoned enable/disable/retire and offline preflight. SID deployment eligibility is blocked; preflight never proves connectivity. Edits invalidate dependent authority while retaining old plans/decisions. | `packages/connectivity/{instances,management,api}.ts`, `packages/database/profile-lifecycle.ts`; `apps/web/src/{InstanceOnboarding,Instances,Connections,ConnectionConfiguration}.jsx`; `tests/product-instance-master.test.mjs`, `tests/product-instance-master-browser.integration.mjs`, `tests/product-connection-management.test.mjs` |
| Inventory, schema ownership and targets | Delivered API/browser and bounded live multi-schema assignment: discovered or manual workspace catalog, multiple assigned schemas per project, single active project assignment per exact owner, revisioned transfer/release, project target bindings, explicit environment/route/policy/principal facts and stale-plan display. Assignment requires explicit workspace database management authority and current project access; project membership alone cannot allocate infrastructure. Declared lineage is provisional. | `packages/catalog-reference/`, `packages/targets/`; `apps/web/src/ProjectTargets.jsx`; `tests/product-target-bindings.test.mjs`, `tests/product-target-workflow-browser.integration.mjs` |
| Oracle connectivity and identity discovery | R1 product integration implemented; live qualification PARTIAL (2026-10-14), full acceptance incomplete: bounded opt-in read-only adapter, expiring authorization, exact attested database/container/service/version comparison, retained observations and historical binding evidence. This qualification is evidence for its recorded source only. Bounded unified-runtime read-only qualification and catalog/binding refreshes are retained for their recorded image and source; the full R1 matrix remains incomplete. Configuration validity, connectivity and accepted identity are separate. Mismatches block binding; fixtures cannot certify identity. Discovery lists visible owners; it is not a complete schema/object snapshot. | `packages/connectivity/{oracle.mjs,api.ts,evidence.mjs}`; `apps/web/src/Connections.jsx`; `tests/oracle-discovery.test.mjs`, `tests/product-database-discovery.test.mjs`; [runtime contract](../development/local-product.md#read-only-database-connectivity-and-discovery) |
| Schema baselines and drift | R2 product integration delivered offline: immutable, checksummed target/connection/stream-bound snapshots; named baselines; paginated history and expected/observed comparison with unambiguous retained references. Retained object browsing includes literal owner/name and type filters with visible counts. Exact owner/object identities, coverage and provenance remain visible. Schema changes stale dependent plans and validation without rewriting old approvals. Partial/unsupported/multi-query observations cannot establish absent drift. Real collector/partial workflow qualification is recorded below; full Oracle baseline/drift acceptance remains incomplete. | `packages/schema-baselines/`; `apps/web/src/{SchemaBaselines,SchemaDrift}.jsx`; `tests/{schema-baselines,product-schema-baselines,product-schema-backup}.test.mjs`; `tests/product-schema-baselines-browser.integration.mjs` |
| Git releases and retained SQL | Delivered offline: allowlisted local repositories, project folder binding, branch/tag/commit import, immutable retained source/digests, parser results, statement preview and comparison. No remote provider authentication, webhook or push to the bound repository. | `packages/migrations/`; `apps/web/src/app.jsx`; `tests/product-mvp-workflow-browser.integration.mjs`, `tests/product-statement-preview.test.mjs` |
| SQL Workspace | Delivered offline: project/target-scoped multi-file migration drafts and immutable manifest revisions, saved SQL comparison, offline syntax/risk review, protected unsaved context and idempotent authored-release preparation into an isolated Git snapshot. Authored release/review findings reopen the verified originating draft, distinguish historical source from its current revision and require fresh candidates after explicit edits. Partial editor: no query/data execution, semantic compilation or autocomplete. | `packages/sql-workspace/`, `packages/migrations/authored-snapshot.mjs`; `apps/web/src/SqlWorkspace.jsx`; `tests/product-multifile-sql-workspace.test.mjs`, `tests/product-sql-workspace-browser.integration.mjs` |
| Schema-aware validation and migration analysis | Partial: retained parser/statement checks, exact-owner scope policy, risk/findings, dependency and ordered pending-migration analysis tied to source/target revisions. Exact-name SQL references now show retained snapshot object types/checksums in validation and plan review; missing matches stay UNKNOWN, identity mismatches and database-link ambiguity withhold matches. General object existence, dependency completeness and Oracle semantic validity remain unverified. Offline VALID does not mean executable. | `packages/sql-validation/`, `packages/execution/migration-analysis.ts`; `apps/web/src/{SchemaValidation,MigrationAnalysis}.jsx`; `tests/product-sql-validation.test.mjs`, `tests/product-sql-validation-browser.integration.mjs`, `tests/sql-validation-catalog.test.mjs`, `tests/product-schema-baselines-browser.integration.mjs` |
| Plans and independent review | Delivered API/browser and demonstrated in the live master workflow: format-3 target envelopes and format-4 validation-bound envelopes, retained statement/source/target facts, optimistic currentness, reviewer inbox/routing, comments with exact statement refs, approval/rejection, fresh-plan correction and approval withdrawal. Changed source/configuration never rewrites old intent or revives old authority. | `packages/targets/`, `packages/migrations/offline-plan-intent.mjs`, `packages/governance/`; `apps/web/src/{PlanRecord,PlanSourceComparison}.jsx`; `tests/product-target-bindings.test.mjs`, `tests/product-comments.test.mjs` |
| Deployment requests and execution safety | The request workflow and supervised execution code are implemented. The latest unchanged unified image has independently accepted D6 V1/V2 effects (with the original operator failure retained) and a live ADMITTED/NOOP case: four API probes saved before gate release, zero pending statements, no application SQL or ledger writes, complete metadata/Oracle preservation and revoked browser children. This qualifies one bounded installation and does not establish full OA/R1/R2 or fault/topology acceptance. The candidate runs an internal execution role at UID 10002, with no separate worker image. Dated `ee44f6f` evidence qualifies bounded before-first native DDL and after-first-ACK interruptions, with lease expiry to HOLD and no replay after container/app restarts. The earlier after-first operator failure remains retained under HOLD on its original PDB. The [2026-10-24 lost-ack controller FAIL](../../evidence/product/unified-oracle-20261023/lost-ack-failed-ee44f6f.json) retains one real CREATE effect, withheld response bytes, one fail-closed cut, HOLD/one attempt/zero receipts and unchanged Oracle journals/history across app recreation. Post-cut native rejection was not captured; complete lost-ack and current-runtime fault acceptance remain incomplete. Preserve that held request and use a fresh target for another case. Real interruption and held-mutex reconciliation passed in their recorded scope; alias concurrency and lost-acknowledgment acceptance remain incomplete. Requests stay WAITING_VALIDATION without a current trusted installation, target evidence and authority. No automatic ambiguous replay. | `packages/execution/`, `apps/runtime/`, `apps/worker/`; `apps/web/src/{ExecutionReadiness,ExecutionHistory}.jsx`; `tests/product-execution-readiness.test.mjs`, `tests/product-installed-worker-factory.test.mjs` |
| HOLD reconciliation | Partial: immutable evidence capture, independent governance review and history reconciliation UI/API exist; actual target/ledger/object witnesses and approved recovery remain external. This does not provide an app button that clears restore hold or authorizes retry. | `packages/execution/{reconciliation,history-reconciliation}.ts`; `apps/web/src/ExecutionReconciliation.jsx`; `tests/product-execution-reconciliation.test.mjs` |
| Audit, migration history and downloads | Delivered offline: scoped filtered/paged audit and consolidated plan/decision/request/ledger history, stable cursors, retained source/statement links, checksummed plan/request records. Historical events and current statuses are labeled separately. Checksums are integrity evidence, not signatures or proof SQL ran. | `packages/{migration-history,audit}/`, `packages/{governance,execution}/`; `apps/web/src/{MigrationHistory,PlanRecord,ExecutionRecord}.jsx`; `tests/product-migration-history-cursor.integration.mjs` |
| Install, operate and preserve metadata | Local source bundle, parser/dependency notices, OCI verification and runtime diagnostics are implemented; native backup/compatible restore retain evidence under a new generation and persistent RESTORE_HOLD. Historical backup/restore and interrupted-worker results remain bound to their recorded source. The unified `ee44f6f` image has exact-source API/browser/OCI and app-upgrade evidence; witnessed managed PostgreSQL restore preserves 21 business tables and historical access under persistent HOLD in a separate owned database. Interrupted Oracle recovery, final deployment parity and full pilot disaster recovery remain unverified. See [bounded restore evidence](../../evidence/product/unified-oracle-20261023/managed-restore-ee44f6f.json). | `packages/backup/`, `packages/observability/`, `apps/runtime/`, `scripts/local-release.mjs`; `tests/product-backup-restore.test.mjs`, `tests/product-local-release.integration.mjs`; [runtime guide](../development/runtime-readiness.md) |

## Master credential alignment, 2026-10-15

The primary Instances screen connects one master reference before schema assignment,
discovers exact owners, selects several owners and a project environment, and records
separate retained bindings. Existing workspace instances can be attached to another
project without entering another credential or transferring schema ownership. Advanced
legacy tools and historical configurations remain available. Credential rotation,
disabling and retirement invalidate dependent plans permanently; derived deployment
profiles cannot be independently edited to bypass the instance reference.

Scope is enforced in validation, execution materialization and immediately before dispatch.
The supported automatic subset is scalar CREATE TABLE, scalar ALTER TABLE ADD and simple
local indexes, with literal defaults/NOT NULL. Dynamic SQL, procedural blocks, CTAS,
expressions, DML, foreign owners, database links, triggers, synonyms and administrative
operations remain blocked after approval. Existing objects must match exact physical
tables rather than synonyms. A trusted installation excludes concurrent external changes
and unreviewed DDL triggers; Oracle CURRENT_SCHEMA supplies context, not privileges.

Each plan targets one schema stream; users switch the assigned target to manage another
schema with the same master. Target history uses stable stream partitions and completed
history reconciles within its stream. Container-wide mutex and ambiguity/HOLD protection
remain. Old ledger keys/history are retained, and an empty new partition cannot discard
legacy history or adopt a nonempty schema automatically. Native backups preserve the
new source links and upgrade previous schemas under the existing RESTORE_HOLD contract.

PostgreSQL/API and Chromium acceptance exercise connection before assignment, two owner
bindings with one credential, project isolation, independent approval, revision staleness,
truthful fixture denial, reuse, persistence and mobile layout. [Master workflow acceptance](../../evidence/product/instance-master-workflow-20261015/acceptance.json) records two real schema V1 executions, a V2 suffix and a browser-authored witnessed no-op: four proofs/attempts, three receipts and target histories of two and one applied migrations. The browser exercised authoring two files, syntax review, validation, a format-4 plan, independent approval, a separate deployer request, restart history, audit and record download. Independent fixed SELECTs through the original authorized operator checked Oracle objects, ledger chains and unchanged master grants. The original HOLD, earlier V1 effect and all historical lab evidence remain retained.

The historical master workflow qualification above covers scalar CREATE TABLE in its recorded Oracle Free CDB/PDB TCP variant. Later [unified runtime evidence](../../evidence/product/unified-oracle-20261023/governed-ddl.json) covers CREATE TABLE, scalar ALTER TABLE ADD and simple CREATE INDEX on source `a4dbb8d`, including two-schema V1/V2/NOOP. Those historical records do not establish full Oracle acceptance on subsequent images; use the latest bounded delivery records and explicit remaining gates below. The pinned parser can reject otherwise valid Oracle forms, including some trailing-comment layouts; rejected SQL remains blocked. This does not qualify production, other topologies or the complete fault/recovery matrix.

## Authoritative requirement outcomes

Stable FR identifiers are retained from earlier reconciliation. The original standalone functional specification is absent, so these are the adopted Kelryvo outcomes, not purported quotations. The 220 research IDs and original criteria remain in the legacy tracker. The capability table above supplies implementation evidence; this table supplies required behavior without a second progress count.

| ID | Required outcome / remaining boundary |
| --- | --- |
| FR-001 | One private server-owned workspace; multi-tenancy deferred. |
| FR-002 | Fixed developer/approver roles, explicit project and separate deploy grants; reject self-approval and recheck current authority. |
| FR-003 | Machine identities and public automation clients deferred. |
| FR-004 | Workspace owns physical inventory; project target views derive from schema assignments. |
| FR-005 | One external master credential reference per registered Oracle PDB/non-CDB, reused for discovery and migration across assigned schemas. Purpose-restricted processes and internal ledger authority remain separate; API/browser never receive secrets. Legacy separate credentials remain readable. |
| FR-006 | Discovery appends immutable observations, preserves manual facts and labels visibility/provenance. Live Oracle acceptance remains required. |
| FR-007 | One project may manage multiple schemas; one active project per exact schema owner; revisioned transfer preserves streams and history and blocks unsafe active/ambiguous work. |
| FR-008 | Project archive cannot delete physical inventory. Inventory lifecycle remains workspace/operator-owned. |
| FR-009 | Immutable object snapshots and structural comparison are implemented. Limited visibility or collection consistency means UNVERIFIED; owner discovery remains a separate evidence scope. Live Oracle acceptance is pending. |
| FR-010 | Archive preserves read access and history; normal project purge/restore deferred. |
| FR-011 | Environments are project-defined; each binding selects one explicitly. No inferred promotion rank. |
| FR-012 | Retain exact local Git commit/folder/file/manifest facts; remote providers and webhooks deferred. |
| FR-013 | Stable stream follows target lineage + exact schema owner + namespace. Version/checksum history never resets on project transfer; live adoption/baseline semantics remain to be accepted. |
| FR-014 | Supported pinned Oracle parser and explicit scope checks only; unsupported syntax blocks executable admission. Parsing does not establish compilation. |
| FR-015 | Plans/approvals bind exact assignment, binding, configuration, identity, policy, environment, stream and statement revisions. |
| FR-016 | Review retained source, digests, scope/risk/dependency findings and target evidence; surface unknown/conflicting facts. |
| FR-017 | Immutable plan and durable execution request are separate objects; no general business-issue subsystem required. |
| FR-018 | One independent human approval; configurable routes/multi-stage approval deferred. |
| FR-019 | Request requires approved current plan and deploy grant; it does not grant execution authority. |
| FR-020 | Only the trusted execution runtime may resolve writer secrets and execute after target/runtime acceptance. |
| FR-021 | Serialize per verified PDB/non-CDB; actual mutex continuity and session-loss behavior require Oracle evidence. |
| FR-022 | Preserve immutable request/attempt/event/receipt/target-ledger evidence with truthful scope. |
| FR-023 | Cancel only before dispatch; retry/skip/resume and automatic replay deferred. |
| FR-024 | Ambiguity stays HOLD; recovery needs independent target evidence and two distinct authorized actors, never client timeout inference. |
| FR-025 | Distinguish offline intent from applied history; approvals, requests and synthetic receipts cannot fabricate Oracle effects. |
| FR-026 | Scoped audit/history and record downloads; general retention policy and signed export deferred. |
| FR-027 | Drift compares immutable object snapshots to named immutable baselines, with added/removed/modified/unknown details and retained target/stream/provenance. PostgreSQL/API/Chromium acceptance uses controlled fixtures; bounded real Oracle partial snapshots/drift now pass, while full live coverage remains incomplete. |
| FR-028 | SQL authoring is supported; arbitrary query execution, data browsing and masking remain deferred. |
| FR-029 | Preserve private `/api` compatibility and historical formats additively; no general public API guarantee. |
| FR-030 | Inbound/outbound webhooks deferred. |
| FR-031 | Observed Oracle identity stays separate from local UUIDs/routes and must pass exact-target acceptance. |
| FR-032 | Exact schema scope and master credential revision are bound through retained target/profile intent. Currentness rechecks the instance revision. Assignment never grants Oracle privileges; approval cannot override scope denial. |
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
| AC-09 Readiness | Without accepted target evidence and trusted execution authority, integrated browser request workflow makes zero Oracle writer calls and shows the actual blocker. |
| AC-10 Ambiguity | Fault/timeout/session/ledger loss yields durable HOLD or explicit persistence uncertainty; no second attempt or automatic replay. |
| AC-11 Observations | Incomplete visibility stays UNKNOWN; fixtures and checksum-only evidence cannot create verified identity, drift or applied history. |
| AC-12 Scope | Deferred functions do not appear as enabled UI/API promises or bypasses. |
| AC-13 Evidence | Authorized filtered history/downloads show original facts separately from current status and never label a checksum as signed authenticity. |
| AC-14 Restore | Compatible restore preserves evidence, revokes restored credentials and retains persistent RESTORE_HOLD until trusted external recovery. |

## Prioritized roadmap

Offline product development is eligible independently of Oracle acceptance. The following bounded improvements reuse existing workflows; they do not authorize Oracle access or change execution eligibility.

| Priority | Eligible outcome and dependencies | Objective exit criteria |
| --- | --- | --- |
| **O1 — authored SQL correction loop delivered offline** | Retained authored release/plan findings reopen the originating project-scoped draft and exact source file through a verified read-only provenance lookup. Reuses authored provenance, immutable draft revisions, source preview and SQL Workspace. | Local PostgreSQL/API and Chromium acceptance passed: historical origin/digest verification for v1/v2, current-vs-retained revision labeling, UTF-8 focus, changed/renamed/deleted files, unsaved work and stale navigation, scoped/revoked/reviewer/archive access, restart, fresh release/validation/plan, unchanged old source/approval and zero execution jobs. `tests/product-multifile-sql-workspace.test.mjs` and `tests/product-sql-workspace-browser.integration.mjs` retain the cases; hosted gates remain required before merge. |
| **O2 — concurrent multi-file reconciliation delivered offline** | Reconciles the cached saved base, local editor and latest remote manifest by immutable file IDs through existing optimistic revision updates. | Unit, PostgreSQL/API and Chromium acceptance passed for preserved independent edits/additions, explicit overlapping edit/rename/removal/name/target choices, canonical version collisions, explicit file exclusions, repeated races, unchanged prior revisions and scoped/revoked/reviewer mutations. Apply changes only editor state; explicit Save rechecks the latest revision. `tests/sql-workspace-contracts.test.mjs`, `tests/product-multifile-sql-workspace.test.mjs`, `tests/product-sql-workspace-browser.integration.mjs` retain the cases. Hosted gates remain required before merge. |
| **O3 — schema-to-history target context delivered offline** | Carry the selected exact binding from schema baselines into existing migration history filtering and cursor pagination. Consume the handoff once and clear earlier plan/request context. | Local PostgreSQL/API and Chromium acceptance passed for two bindings in one project, complete scoped pagination, cursor/filter rejection, manual filter preservation, direct history All targets and zero execution jobs. Cursor timestamps now preserve PostgreSQL microseconds instead of silently skipping tied records. `tests/product-migration-history-cursor.integration.mjs` and `tests/product-schema-baselines-browser.integration.mjs` retain the cases; hosted gates remain required before merge. |
| **O4 — retained schema object browsing delivered offline** | Add literal owner/name search and type filtering to the existing bounded immutable snapshot object table. Reuse the full retained payload; no new endpoint, storage or Oracle operation. | PostgreSQL/API and Chromium acceptance passed with 1,000 mixed-type retained objects: literal owner/name and type filtering, visible/total counts, truthful no-match state, clearing and snapshot-switch resets. Expanded definitions retain exact case-sensitive identities and checksums. Filtered capture/comparison keep full immutable snapshot IDs/content, partial coverage and provenance. `tests/product-schema-baselines-browser.integration.mjs` retains the journey; hosted gates remain required before merge. |
| **O5 — unambiguous comparison references delivered offline** | Distinguish named baselines and raw snapshots in the existing expected-reference selector, including duplicate baseline names. Reuse retained snapshot IDs/timestamps. | PostgreSQL/API and Chromium acceptance passed for same-named baselines on distinct snapshots: source type, timestamps and full snapshot IDs distinguish labels; each choice submits the exact expected/observed IDs and displays retained identities. Existing authorization, UNVERIFIED partial-coverage semantics and immutable baseline records remain enforced. `tests/product-schema-baselines.test.mjs` and `tests/product-schema-baselines-browser.integration.mjs` retain the cases; hosted gates remain required before merge. |

[O1 PR #100](https://github.com/devsecopslonghn/kelryvo/pull/100), [O2 PR #101](https://github.com/devsecopslonghn/kelryvo/pull/101) and [O3 PR #102](https://github.com/devsecopslonghn/kelryvo/pull/102) retain the reviewed source, focused local verification and passing hosted integration/security gates. The current bounded offline sequence is implemented. Inspection of the existing schema, SQL, release, governed review and history workflows found no further justified bounded gap in the current requirements. The owner-authorized Oracle Free TCP qualification below has run; R1/R2 full live acceptance remains incomplete, and R3/R4 require accepted runtime evidence and purpose-separated authorities. Broader capabilities below remain unscheduled until their requirements and dependencies are established.

Previously proposed target-binding and project-target milestones are delivered offline; improve existing modules rather than building parallel planners, ledgers or tracking systems. R1 product integration is implemented with local acceptance and partial live qualification; its remaining live gates below remain open.

| Order | Bounded milestone and value | Dependencies / exit criteria |
| --- | --- | --- |
| **R1 — product integration delivered; live qualification PARTIAL** | Connection registration/configuration/preflight, read-only testing/discovery, scoped exact-owner selection, evidence diagnostics/history and revision-bound plan/review/request workflow are integrated. Users see why verification is unavailable. Real permission-limited and independently accepted identity-bound API/browser workflows have been exercised; the full negative/operational matrix remains pending. | Use existing adapters and contracts; retain the supplied lab authorization and private observed-identity manifests, and retain purpose-scoped discovery authority and independent live acceptance for the tested variant. Demonstrate one accepted version/topology first; others stay unsupported until separately accepted. Pass the R1 criteria below. No writer capability or DDL. |
| **R2 — schema baseline product integration delivered; live qualification PARTIAL** | Immutable target/stream-bound object snapshots and named baselines, paginated history, structural comparison and browser inspection are implemented. SQL Workspace, validation, plan preparation/review and migration history navigation expose schema context. Changed schema facts invalidate dependent validation/plans while preserving approvals and historical evidence. | Controlled fixtures establish structural behavior and PostgreSQL/API/browser/restore acceptance. Bound owner SELECTs collect tables/columns/constraints/indexes/views/sequences/dependencies; incomplete visibility, unsupported expressions and multi-query consistency remain UNVERIFIED. Identity-bound partial real snapshots, actual structural changes, permanent approval staleness and pagination have passed bounded API acceptance. Full visibility/concurrency/browser coverage and Oracle semantic validity remain unaccepted. |
| R3 — controlled Oracle migration pilot | Demonstrate the existing approval → request → trusted worker → actual target effect → retained history/reconciliation workflow on one disposable accepted topology. Reuse worker, ledger, mutex and governance implementation. | R1/R2 evidence, reviewed purpose-separated installation, enforced external-change window, separately authorized DDL/fault/teardown. Pass [OA01–OA10](../development/oracle-acceptance.md) and controlled reconciliation gates, including V1/V2/NOOP, ambiguity/HOLD/no replay, identity/currentness and independent recovery. No production enablement is implied. |
| R4 — operating acceptance for an eligible pilot release | Make the accepted workflow installable and recoverable with truthful readiness and support limits. | R3; prove private secret isolation, process/orphan containment, restart, backup/restore and disaster recovery in the intended non-production runtime. Retain exact image/source identity, notices and operator witnesses. Publication/deployment each require task authorization and existing gates. |

The [2026-10-24 current-source lab continuation](../../evidence/product/oracle-continuation-8796a57-20261024/acceptance.json)
records the owner-authorized `8796a57` deployment, two schema V1/V2/NOOP streams and
six real receipts, plus one fresh-PDB lost-ack case with observed table effect,
withheld response/cut, native rejection and retained HOLD without replay. Independent
HOLD reconciliation, two-role historical reads and managed restore/restart checks are
bounded evidence. Full R1/R2 visibility matrices and OA01/OA02/OA05/OA09 gates remain
open; Oracle Free evidence does not qualify Oracle 19c/21c or production use.

The later [current UI-image concurrency case](../../evidence/product/oracle-ui-image-concurrency-20261025/acceptance.json)
passed two independently approved pending V2 migrations in distinct worker processes,
with native mutex continuity across DDL implicit commit, a positive PostgreSQL wait witness,
no SQL overlap and preserved historical HOLDs. This is a bounded shared-installation result;
the distinct-installation variant and full OA05/R1/R2 matrices remain open.

The later [incompatible applied-history case](../../evidence/product/oracle-incompatible-history-20261025/acceptance.json)
seeded an isolated stream and held a distinct approved V2 checksum mismatch before
admission, with zero application SQL, ledger writes, attempts or receipts. Existing
history and all old HOLDs were preserved. [Sign-in UI delivery](../../evidence/product/ui-sign-in-refinement-20261025/acceptance.json)
then preserved all 68 metadata tables across an image-only upgrade and passed real
local/LDAP/OIDC sign-in, two-role history/download checks and fresh SELECT-only Oracle
qualification on the new image. Full OA09 state/idempotency, governed OA01/OA02,
distinct-installation OA05 and R1/R2 visibility/browser matrices remain open.

[Retained request idempotency](../../evidence/product/oracle-retained-idempotency-20261025/acceptance.json)
adds 25 actual authenticated API probes on the latest image. Exact retries return the
original successful, cancelled or held job; changed payloads and cross-plan key reuse
are rejected. HOLD cancellation and an approver without deploy permission are denied.
All 67 non-credential metadata tables, every prior credential row and all 11 HOLDs
remain unchanged; only four new login credentials were added, with browser children
revoked. The stale-plan new-key probe returned FRESH_PLAN_REQUIRED and does not prove
the separate current-plan held-stream veto. No Oracle calls or new dispatch occurred.

[Current held-stream veto](../../evidence/product/oracle-current-hold-veto-20261025/acceptance.json)
then used the same retained release with a current binding and new metadata/parser
validation, immutable plan and separate approver. Readiness had only
NO_ACTIVE_OR_HELD_REQUEST blocked; the UI disabled Request deployment and the API
returned 409 EXECUTION_ALREADY_PENDING without creating a job. All prior row hashes
in all 68 tables remain; seven tables gained only the scoped plan/validation/audit/login
records and all 11 HOLDs are unchanged. Both new browser children were revoked.
The original browser command remains FAIL: its preservation allowlist omitted the
normal connection-plan record and its aggregate sorting differed from PostgreSQL.
Independent read-only reconstruction proved the row preservation and both ordering
hashes; the application mutations were not replayed. No native Oracle validation or
worker dispatch occurred. At that checkpoint WAITING/ADMITTED variants were open;
the later queued case above covers WAITING only. ADMITTED and the full matrices remain open.

[Native schema baseline browser acceptance](../../evidence/product/oracle-schema-baseline-ui-20261025/acceptance.json)
passed at 04:58 UTC on the delivered image: two exact-identity KP_B snapshots, one
immutable baseline, real comparison, developer/approver history after browser reload,
and 390px layout without overflow. Both snapshots are live accepted and retain the
same two observed table identities. TABLE coverage is UNAVAILABLE with
TABLE_QUERY_UNAVAILABLE; comparison remains UNVERIFIED with incomplete-coverage and
multi-query-consistency limitations. Zero observed differences does not establish no drift.
All old rows in all 68 metadata tables and all 11 HOLDs remain; only the five scoped
audit/login/snapshot/baseline tables gained rows. No DDL/DML, new jobs or worker dispatch.
The first attempt failed on an overly strict select-label locator before any native
snapshot; its FAIL and zero-effect proof remain. Three failed/diagnostic browser children
were verified revoked. The successful case is private `r2-schema-ui2`, following
`qualification-r2-ui-1` and `discovery-r2-ui-2` (five bindings at revision 18).
The D2 operator completed within all deadlines but lacks an immediate expiry recheck
before Secret CAS; add that guard to any future newly reviewed operator, preserving
these original bytes. Next gaps are the unavailable table query and duplicate drift
summary display; the full R1/R2/OA matrices above remain open.

### R1 selected-work acceptance

R1 code reuses existing persistence and APIs: observations/acceptance append to existing immutable tables, configuration/binding revisions preserve plans and review meaning, and old unbound acceptance remains readable while failing new verified eligibility. UI scopes candidate bindings to the assigned container, route and exact accessible owner and presents observation history, permissions, timeout and mismatch diagnostics. Read-only manifests now require expiry; accepted evidence binds the complete target tuple, exact accepted owner scope and manifest/configuration digests. Project readiness cannot inherit another owner’s acceptance. Discovery uses the authenticated session's exact owner and preserves TCPS certificate verification with an optional attested server DN.

Local acceptance covers fixed SELECT-only probes, purpose/secret isolation, wrong database/container/service/version, absent permissions, expired authority, default/fixture verification denial, real PostgreSQL/API persistence, compatible native backup/restore, Chromium registration/discovery/history, target-bound planning, independent review and WAITING_VALIDATION readiness. Results and source/tool versions are retained in [R1 acceptance evidence](../../evidence/product/r1-oracle-onboarding-20261014/acceptance.json). The original R1 evidence above was offline. **Initial live qualification: PARTIAL**, at source `0e2191d`: the owner authorized an Oracle Free TCP lab, and actual Oracle AI Database 26ai Free 23.26.3.0.0 CDB/PDB identity was observed through a separate private operator. Real application connectivity, permission diagnostics, immutable observations, rejected binding/verification, browser display and restart passed. The application account lacks the fixed database/container identity SELECT grants and is not a least-privilege discovery identity; no live acceptance was self-attested. Full R1 remains incomplete. [Current sanitized evidence](../../evidence/product/oracle-lab-qualification-20261014/acceptance.json) and the [live qualification boundaries](../development/oracle-acceptance.md#live-qualification-on-2026-10-14) distinguish observed behavior from accepted support. At that initial checkpoint, R3 execution had not run.

**Purpose-separated follow-up (2026-10-14):** the owner authorized dedicated lab accounts and scoped grants. An independent reviewer accepted the actual isolated reader within three explicit owner scopes on both service spellings. Full identity/PDB/service/version and actual grants matched. The positive API/Chromium run passed 11 bounded checks, including VERIFIED binding revisions, immutable identity-bound partial snapshots/baselines, independent plan review and restart. A second run passed 15 overlapping checks, including actual ALTER/add/remove drift, MODIFIED/UNKNOWN classification, stale approvals after structure restoration, and complete pagination of 51 real snapshots and 101 named baselines. Discovery remains PARTIAL outside accepted owner scope. [Follow-up evidence](../../evidence/product/oracle-lab-qualification-20261014/followup.json) and [current boundaries](../development/oracle-acceptance.md#purpose-separated-follow-up-on-2026-10-14) retain the exact scope. [PR #105](https://github.com/devsecopslonghn/kelryvo/pull/105) fixed dropped worker target facts and passed independent review plus hosted checks. A bounded failure run passed an actual invalid-password case (one attempt), missing Secret, wrong expected version and retirement checks. [PR #106](https://github.com/devsecopslonghn/kelryvo/pull/106) fixed the reproduced missing-Secret diagnostic and passed independent review plus all hosted checks. Full R1/R2 remains incomplete. The later [execution checkpoint](../development/oracle-acceptance.md#recovered-execution-checkpoint-on-2026-10-14) verifies actual governed V1/V2 effects and preserved ledger/history. NOOP is held after a private authority state-gate failure; bounded reconciliation/retry/audit/restart checks passed. Full R3/OA01–OA10 and R4 remain blocked by retained HOLD, unattested fault/fixture scope and the R3 metadata backup naming contract. The Oracle lab must be retained.

- Reuse `packages/connectivity/`, target options/bindings and the current Connections/ProjectTargets UI. First inspect the existing tests and fix only gaps exposed by acceptance; do not build another discovery subsystem.
- Before connecting, the lab owner supplies explicit authorization, exact endpoint/version/topology, entitlement, read-only identity/grants, transport/CA policy, allowed reads, expiry and bounded stop/teardown duties. Keep secret material private; record only sanitized evidence. Missing authorization leaves live cases **NOT_RUN** and the milestone incomplete.
- Demonstrate the full browser + API path: create connection → offline preflight → bounded connectivity test → discovery observation → exact-owner binding verification → fresh target-bound offline plan → independent review → truthful request readiness. Default startup and fixture data must remain unable to certify a target or dispatch a writer.
- Exercise wrong destination/container/identity, missing privileges/owner visibility, unsupported root/SID, expired observation, superseded/disabled connection, timeout and revoked access. Confirm retained evidence/revisions and stale-plan feedback survive restart and compatible backup/restore.
- Record exact source/driver/parser versions and provenance. Only accepted live evidence for the matched target may produce verified identity/connectivity; configuration readiness, a successful socket test and injected fixtures cannot. Separate version/topology support claims explicitly.
- Run full local/hosted metadata, API, browser and source-installation gates, independent security/correctness review and the authorized read-only Oracle cases. An offline pass alone cannot close R1. Worker enablement, DDL, fault injection and infrastructure changes need separate authority.

### R2 selected-work acceptance

R2 extends the existing read-only discovery runtime and authorization/secret isolation. It adds no inventory authority or writer access. Snapshot rows retain exact database/container facts, owner, connection/assignment/binding revisions, migration stream, observation time, object checksums, completeness and provenance. Named baselines refer to immutable snapshots; capture, observation and plan association are transactional and audited. Immutable database guards survive compatible native backup/restore; prior backup signatures remain accepted. Plans retain snapshot references in immutable evidence and public plan exports. Subsequent changed facts invalidate eligibility permanently, including after the original structure is observed again. SQL validation retains its schema snapshot and requires fresh validation after changed facts.

The browser supports authorized target selection, bounded observations, object definitions, baseline capture, paginated snapshot/baseline history, comparison with before/after values, and links to SQL Workspace, planning and migration history. Plan preparation and review show latest drift separately from the plan's retained snapshot. Fixture comparisons describe controlled structural evidence; they cannot certify a live target or live drift.

The SQL reference-context increment matches exact quoted/case-sensitive references to immutable snapshot object summaries and retains snapshot IDs, types and checksums in validation and downloadable plan evidence. It filters foreign owners, withholds matches on observed identity mismatch or database-link ambiguity, and never infers missing-object absence, statement-order effects, privileges or compilation. Existing reports remain readable. Focused local PostgreSQL/schema acceptance and Chromium acceptance passed, including independent approval, mobile layout, downloads, restart and changed-schema staleness; unit regressions cover scope, links and identity mismatch. [PR #99](https://github.com/devsecopslonghn/kelryvo/pull/99) retains the candidate and hosted gate results. This remains offline structural context, with zero Oracle calls. The authorized lab now has bounded independently accepted reader evidence; the remaining R1/R2 matrix and reviewed R3/R4 execution installation still require actual acceptance.

Focused acceptance covers exact quoted identities, structural checksums/differences, CHECK predicates, constraints/indexes/views/sequences/dependencies, incomplete visibility, cross-project isolation, immutable persistence/history, concurrent and timed-out observations, revision changes and revocation during collection, permanent stale approvals, validation currentness, Chromium navigation/restart/mobile layout, and native compatible restore under recovery HOLD. [R2 acceptance evidence](../../evidence/product/r2-schema-baselines-20261014/acceptance.json) records completed checks and their scope. [R2 PR #96](https://github.com/devsecopslonghn/kelryvo/pull/96) records the final candidate and hosted integration gates; passing fixtures do not close Oracle acceptance. R1 management backups also restore against their exact historical schema before upgrading to the current schema under HOLD.

The original R2 evidence above was offline. **Initial live qualification: PARTIAL**: real uniquely prefixed own-schema fixtures covered tables/columns/defaults/CHECK/PK/FK, quoted names, ascending and descending indexes, views, sequences and dependencies. Repeated collector snapshots were stable, and controlled changes were observed. Application snapshots/baselines retained unavailable identity and comparisons stayed INCOMPARABLE; separate operator observations kept partial coverage and UNVERIFIED absence rather than certifying drift. Actual observation metadata survived browser/application restart and native restore under HOLD. All fixture objects were removed, privileges remained unchanged and PVC free capacity remained 929 MiB. The purpose-separated follow-up above passed bounded identity-bound partial comparison; full baseline/drift acceptance remains incomplete. Live exit cases remaining: complete accepted comparison/visibility coverage; exact quoted/case-sensitive schema owners; empty own schema vs granted/hidden objects; privilege loss; row/byte/time truncation; default and CHECK expressions; FK/index/view/sequence/dependency definitions; concurrent DDL during metadata collection; endpoint/identity/configuration changes; persistence and browser comparison of real observations. The collector records multi-query consistency as unverified; function-based index expressions, partition definitions and foreign-owner completeness are explicitly partial. R2 provides useful observed differences without certifying a consistent Oracle catalog snapshot or semantic SQL compilation. No production or migration-execution acceptance is implied.

### Later backlog, deliberately unscheduled

Remote Git providers and automation, additional federation protocols (including SAML), invitations and machine identities, advanced approval/promotion policy, further editor convenience, signed/general evidence export and retention, query/data access, non-Oracle engines and broader Oracle topology remain unscheduled beyond the bounded offline outcomes above. The implemented OIDC/LDAPS paths are optional; only the configured Keycloak/OpenLDAP lab variant has live interoperability acceptance. Each additional scope needs a justified requirement, dependencies and objective acceptance slice; none is a hidden dependency of the current offline product.

## Cleanup and historical boundaries

The 2026-10-14 consolidation removed superseded gap/roadmap/migration proposals, duplicated continuation notes and obsolete local agent-session configuration notes. Their recoverable text remains in Git history. Detailed safety decisions, historical Phase 1 protocol and design provenance, historical MVP acceptance, immutable research, license/notice/dependency records, decision log, tracker contracts and all `evidence/` files remain. Historical records are dated evidence, not instructions to repeat completed work or authority to deploy.
