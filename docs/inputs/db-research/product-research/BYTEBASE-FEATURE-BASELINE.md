# Bytebase feature baseline

8 October 2026. Bytebase is the functional benchmark, not the implementation base. All records have explicit source/edition scope. **112 catalog items are classified BASELINE**; this counts proposed Bytebase-inspired capabilities, not 112 verified free features. Across the full 220-item catalog, Bytebase findings are 103 source-declared/contracts present, 83 partial, 30 unknown and 4 not found in reviewed paths. The latter findings are bounded searches, not proof of absence across every release.

Primary source pin: `bytebase/bytebase@80524fc54601bcc5545575e02f83b23ee6bb0a70`. Current upstream observation: `16b89d9b49741c65623970038859d0d6397c8fe5`. Eight selected current files, including LICENSE, plan and versioned executor, match the frozen snapshot byte-for-byte; that does not establish equality of the entire repository. Historical runtime is **3.22.1/FREE**, with its separate runtime pin in [POC results](../BYTEBASE-ORACLE-POC-RESULTS.md). No current source, 3.23 release or Enterprise build inherits that runtime verdict.

The static [surface inventory](evidence/bytebase-surface-inventory.json) records **218 API methods, 93 route declarations, 48 metadata tables and 145 edition-feature entries** with source paths and lines. Edition entries repeat across plans and are not distinct feature counts. API contracts, route presence and feature declarations each prove their own scope; they do not prove runtime enforcement. All catalog rows contain their own evidence and acceptance record.

## A1. Inventory and Oracle model

InstanceService exposes lifecycle, synchronization and datasource mutations; DataSource includes engine-specific connection parameters and Oracle SID/service. Instance can be workspace- or project-scoped. Database records have project assignment, environment override and computed effective environment; the instance and database are connected resources, not a strict `Instance → Project → Environment` ownership tree [BB-INSTANCE, BB-CONNECTION, BB-INSTANCE-MODEL, BB-DATABASE-MODEL].

The Oracle SyncInstance implementation discovers owners using ALL_USERS and reports each as a Database entry. SyncDBSchema collects tables, views, sequences, routines, packages and other metadata for the owner; the generic nested schema metadata is not an explicit Oracle CDB/PDB inventory [BB-ORACLE-SYNC, BB-ORACLE-USERS]. Schema synchronization creates newly discovered database records in the scoped or default project [BB-SYNC]. Initial inherited/default placement is separate from deliberate project reassignment.

| Relationship | Inspected representation | Nature | New platform implication |
|---|---|---|---|
| Instance → datasource | Repeated datasource config | Native configured association | One route catalog, separately scoped secret bindings |
| Instance → Oracle schema | Owner becomes Database name | Native discovered association | Preserve physical container and owner as separate resources |
| Database → project | Explicit project field/foreign key | Stored/manual or initial discovery/default assignment | One active owner project; assignment revision/history |
| Database → environment | Optional override | Stored explicit assignment | Avoid per-schema PROD→DEV weakening |
| Database effective environment | Override then inherited instance environment | Computed | Authoritative physical environment and no hidden security downgrade |
| Project membership → database access | IAM/project rules and grants | Permission resolution | Recheck every API and worker admission |
| Instance → CDB/PDB/service | SID/service configuration; no complete physical hierarchy established | Partial | Canonical container identity, route aliases and generations |

Labels, grouping, transfers, sync controls, connection tests and archival are inventoried in DBM-001–027. A dedicated instance-group or schema-group resource and native credential rotation orchestration were not established. Updating a datasource is not automatically evidence of safe rotation. A health/sync timestamp is not full database performance monitoring.

## A2. Projects

ProjectService provides create/update/archive/restore/search, IAM and project webhooks [BB-PROJECT]. Settings include self-approval, required issue approval and last plan editor controls [BB-PROJECT-SETTINGS]. Policy contracts distinguish workspace and project configuration and inheritance/precedence [BB-POLICY]. Database assignment and project-scoped instances are separate mechanisms; sharing a physical Oracle service among projects must be checked against the chosen resource scope.

PRJ-001–015 include membership, roles, policies, settings, approval/deployment configuration, repository binding, cross-project visibility, isolation, administrator transfer and export/import proposals. Project ownership transfer is primarily membership administration; no dedicated all-resource ownership-transfer mechanism was established. Git automation provenance in a release does not by itself prove a native persistent project repository connector.

## A3. Migration runtime trace

1. The supported action reads local file glob matches, extracts leading numeric versions and builds Release_File objects [BB-FOLDER-ACTION]. It warns/skips files without a version; it does not implement the proposed stricter name/encoding/include contract. This is native supported **action/client intake**, not proof of server-side Git folder retrieval.
2. The action creates a VERSIONED or DECLARATIVE release with VCS provenance and references it in a plan [BB-ACTION-ROLLOUT]. Release APIs represent files and source metadata [BB-RELEASE]. Backend validation calculates SHA-256, rejects duplicate supplied versions and sorts parsed versions [BB-RELEASE-VALIDATE]. The proposal's canonical `V001`/`V1` duplicate rule is independently specified, not assumed identical.
3. `runVersionedRelease` lists **central** revisions for the instance/database and builds an applied-version map. It skips matching versions, reads retained sheets, invokes the native Oracle driver and creates a central revision after execution [BB-STATE]. A central revision references release/file/hash/task run; it is a versioned central ledger, more than ordinary query history. It is not a target-local `flyway_schema_history` table.
4. The native Oracle driver uses go-ora and Oracle-aware splitting with transactional/autocommit paths [BB-DRIVER, BB-ORA]. The inspected path does not invoke Flyway or JDBC. Oracle's implicit DDL commits still apply independently of application transaction APIs.
5. Release checking emits WARNING when a previously applied version's sheet hash differs [BB-RELEASE-CHECK]. Historical FREE POC observed warning plus skip/DONE, while the required checksum acceptance criterion failed. The new platform must block this condition.
6. Execution-before-central-revision ordering creates a potential target-effect/central-record gap. This is a **source inference**, not a newly injected crash. Recovery, stale sessions and restore replay remain untested for the proposed platform.

MIG-001–034 distinguish schema/data changes, declarative mode, folder releases, ordering, checksum enforcement, central versus target history, baseline, repeatables, retry, multi-target rollout, rollback, drift and promotion. A baseline changelog snapshot is not necessarily an approved imported version baseline. Repeatable migration semantics equivalent to Flyway R-files were not established. Declarative source paths exist, but Oracle parity and safe generated PL/SQL/dependency behavior are not certified.

## A4. Change and approval

IssueService exposes approve/reject/request changes, retry approval finding and review; Issue has ordered approval roles/templates and decision states [BB-ISSUE, BB-APPROVAL-MODEL]. Project settings govern self-approval/last-editor and required issue approval. Rollout APIs provide scheduling/dispatch/cancel/rollback preview and task evidence [BB-ROLLOUT]. These contracts underpin GOV-001–025.

Exact expiration/revocation, fully immutable approval-bound artifacts, emergency/hotfix handling and policy-change revalidation need precise runtime/gate review; they are not guessed from the word approval. Current source contains approval-version and required-issue checks; old FREE runtime with approval SKIPPED is not proof that Enterprise lacks or satisfies approval binding. New designs must guard manual and automated dispatch, console execution and selected-target changes equally.

## A5. SQL editor and review

The frontend has a separate SQL editor route group; SQLService has query/admin execution/history/export with target/access options [BB-SQL-ROUTES, BB-SQL-API, BB-SQL-OPTIONS]. Saved query APIs, schema metadata, review policies and source-declared autocomplete/diagram features broaden the baseline [BB-SAVED, BB-DATABASE, BB-POLICY, BB-PLAN]. Each UI capability remains subject to permission and engine scope.

Oracle packages/procedures/functions/triggers, anonymous blocks, q-quotes and slash terminators have historical successful cases. The invalid-procedure case produced DONE/Deployed while USER_ERRORS remained, so driver success did not establish compile validation. SQL*Plus bundled commands failed in the POC and cannot be advertised as complete native SQL*Plus. Object validity, dependency ordering and package-body checking are distinct from statement splitting or syntax highlighting.

## A6. Security and edition boundaries

| Capability family | Source/plan scope | Free-edition conclusion |
|---|---|---|
| Basic project IAM, inventory, release/change/query operations | BB-PROJECT, BB-PLAN and APIs | Source-declared free capability families; correctness needs testing |
| Custom approval, risk/enterprise governance | BB-GATES and approval settings | Enterprise boundaries; no Community assumption |
| Audit search/export | BB-AUDIT-GATE; plan TEAM/Enterprise distinctions | Not Community; TEAM limited versus Enterprise; marketing names may differ |
| LDAP/OIDC versus Google/GitHub login | BB-IDP | Enterprise SSO versus separate lower-tier social feature |
| Custom roles | BB-ROLE-GATE | Enterprise gate |
| External secret manager | BB-CONNECTION, BB-GATES | Enterprise feature; connection parameter presence is insufficient |
| Read-only datasource / query policy | BB-READONLY-GATE, BB-QUERY-GATE | Separate gates; not equivalent to basic SQL editor access |
| Masking, classification, JIT access, auth policies/SCIM | BB-CATALOG, BB-ACCESS, plan/source surface | Distinct enterprise feature boundaries; exact API/build review needed |
| HA | Current pricing/documentation | Enterprise add-on; source replicas are not free runtime HA entitlement |

Current [pricing](https://www.bytebase.com/pricing/) lists Community up to 20 users/10 instances. That does not fit 50 services merely because 20 users fit. The inspected license is mixed: MIT subset, restricted enterprise directories and excluded enablement code. Use functionality as a benchmark; do not reuse proprietary code or gate logic.

SEC-001–028 cover authentication, sessions, roles, schema grants, secrets, audit, APIs, network/TLS, evidence, MFA/SCIM/JIT/classification, workload identities and tamper evidence. Encryption/redaction cannot be assumed solely from a datasource type. Session/credential and compliance behavior need a deployed exact-build test, and product compliance claims are not a certification of this design.

## A7. GitOps and CI/CD

The supported action has GitHub, GitLab, Azure and Bitbucket provider packages, source-provenance creation and release/plan execution. Repository intake is partly performed in a checked-out CI workspace. Native action support is valuable; a release API carrying a commit ID is not proof of server-side commit verification. GitLab/Jenkins workflows and callbacks must be classified as product client integration or custom bridge according to the actual implementation.

GIT-001–019 cover repository connection, branch resolution, MR checks, retained artifact/provenance, CI/webhooks, API deployment, promotion, Jenkins/status reports, drift, source protection, IaC, offline mirrors and extra providers. Jenkins has a feasible generic API route; no built-in Jenkins server plugin executing Oracle with this integrity contract was verified.

## A8. Operations

Task/runner sources expose scheduling, task runs, session/log inspection, cancellation and worker state; metrics.go configures Prometheus collection/access [BB-ROLLOUT, BB-METRICS]. Instance sync intervals/limits and source-declared pooling/replica controls are discovery inputs, not throughput benchmarks. Audit backup/restore, stale Oracle sessions, durability/retention, failover and endpoint identity require operating acceptance rather than route inspection.

OPS-001–027 separate queues/retries, state/logs, notifications, email/webhooks, metrics/health, backup/HA/pools, dashboards/resource limits, cancellation, Kubernetes/offline packaging, performance, capacity and upgrades. A scheduled retry of arbitrary Oracle DDL is not a safety capability without reconciliation.

## A9. Additional discovery and what to leave behind

Navigation/API/model inspection also identifies access grants, saved-query stars/folders, workload identities, AI APIs/MCP, classification/semantic types, risk configuration, instance change history, review runs and organization policies. EXT and SEC/SQL records capture these rather than restricting discovery to the original comparison matrix.

Do not copy vendor branding/assets, restricted code, enablement logic or commercial quotas. Do not reproduce warning-only checksum acceptance, green UI state for invalid objects, central-history replay assumptions, or stage labels without mandatory predecessor enforcement. Defer general SQL workbench, AI/MCP, provisioning, broad data movement, proprietary Oracle declarative adapters and engine-specific online-change tools until justified. See [cross-product discovery](CROSS-PRODUCT-FEATURES.md), [roadmap](PRODUCT-ROADMAP.md) and [top twenty](README.md#twenty-most-important-features).

## Historical runtime scope

The [Bytebase POC](../BYTEBASE-ORACLE-POC-RESULTS.md) remains the RUNTIME_VERIFIED evidence for its own 3.22.1/FREE build: ordered versioned replay skip, representative Oracle PL/SQL, checksum warning rather than blocking, invalid object despite DONE and out-of-order stage dispatch. Approval/audit cases were edition-blocked; commit-gap crashes, restore and replica failover were NOT_RUN. No results were rerun or overwritten here. The new platform is entirely NOT_TESTED.
