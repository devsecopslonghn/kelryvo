# Independent open-source Database DevOps platform research

Research completed as a documentation/evidence design study, **8 October 2026**. Scope: an independently implemented, self-hosted, free platform for Oracle 19c/21c, initially 50 services, 500 application schemas and 20 users, DEV/SIT/UAT/PROD, on-prem Kubernetes/OpenShift, GitLab and Jenkins. Capacity inputs are not license/product limits. No platform code, production connection or POC deployment was created or modified.

**Recommendation:** a modular monolith with separately restricted API/worker deployments, PostgreSQL metadata and durable jobs, original English React UI, immutable Git releases/plans, fixed independent approval, canonical Oracle service/container/schema resources, hybrid per-schema migration receipts and central audit, DDL-safe target mutexes, required object/postcondition verification, and explicit recovery holds. TypeScript/Fastify plus OSS node-oracledb Thin is the preferred conditional stack; investigate mature Apache Flyway parsing as a local parser-only helper. This helper and the independently owned coordinator are proposals, not implemented integrations.

Begin with a bounded Oracle driver/parser/lock/crash-consistency feasibility milestone, then build one safe end-to-end workflow. Do not start with a broad portal or assume a mature engine eliminates approval, validity or recovery work. All proposed platform features are **DESIGN_PROPOSAL / NOT_TESTED**. Native source and historical runtime evidence remain separate.

## Deliverable index

| Deliverable | Purpose |
|---|---|
| [Feature catalog](FEATURE-CATALOG.md) | Searchable IDs, source/edition scope, behavior, personas, dependencies, Oracle/security considerations and acceptance |
| [Machine-readable catalog](feature-catalog.json), [JSON Schema](feature-catalog.schema.json) | Stable structured feature contract with consistent identifiers |
| [Bytebase baseline](BYTEBASE-FEATURE-BASELINE.md) | API/UI/model/gate discovery and actual migration path |
| [Cross-product discovery](CROSS-PRODUCT-FEATURES.md) | ODC, Archery, Flyway, Liquibase, Sqitch, AccessFlow, Atlas, DbGate and further OSS references |
| [Database resource model](DATABASE-RESOURCE-MODEL.md) | Canonical Oracle identity, ownership/credentials, ERD and cardinality |
| [Migration runtime](MIGRATION-RUNTIME-ARCHITECTURE.md) | Release/ledger/approval/execution/recovery contracts and ten required sequence diagrams |
| [UI/UX map](UI-UX-FEATURE-MAP.md) | Fourteen screen records with actions/data/API/permission/empty/error states and page flows |
| [Roadmap](PRODUCT-ROADMAP.md) | Complete phased allocation, every MVP acceptance criterion, packages, effort and first milestone |
| [Technology ADRs](TECHNOLOGY-DECISIONS.md) | Stack comparison, mature-engine assessment, independent runtime/parser boundary and deployment decisions |
| [Gap analysis](GAP-ANALYSIS.md) | Native versus external engine versus custom integration versus future work; MoSCoW |
| [License assessment](LICENSE-COMPLIANCE.md) | Exact source/client/edition distinctions and independent implementation boundaries |
| [Risk register](RISK-REGISTER.md) | Twenty technical/security/license/operational risks and acceptance gates |
| [Source manifest](evidence/source-manifest.md), [feature evidence](evidence/feature-evidence.md) | Pinned repositories/versions/files/lines/hashes, live-document summaries and historical runtime scope |
| [Research limitations](evidence/research-limitations.md) | Unknowns, inaccessible documentation, proposed integrations and runtime exclusions |

## Feature totals

| Domain | Count |
|---|---|
| Database Management | 27 |
| Project Management | 15 |
| Migration Management | 34 |
| Change Governance | 25 |
| SQL and Review | 25 |
| Security and Governance | 28 |
| GitOps and CI/CD | 19 |
| Observability and Operations | 27 |
| Additional Features | 20 |

**Total: 220.** Classification: **112 BASELINE**, **45 ENHANCEMENT**, **32 DIFFERENTIATOR**, **24 OPTIONAL**, **7 REJECTED**. Roadmap: **95 MVP, 77 V1, 41 V2, 7 rejected**. MVP rows are granular safety/behavior obligations grouped into ten packages, not 95 separate products or screens.

Bytebase baseline count is 112 classified reference capabilities. Across the whole catalog, 103 source contracts/declarations are present, 83 requested behaviors are partial, 30 are unknown and 4 are not found in the reviewed paths. This is not a count of verified Community functionality or exhaustive parity across every Bytebase release. “Present” may concern an API, route or feature declaration; the evidence scope accompanies each record.

Additional useful ideas include Flyway/Liquibase/Sqitch target history and checksums, Sqitch verification/dependencies, ODC target queue/schema assignment UX, Archery compiler diagnostics, AccessFlow external gate/outcome separation, and DbGate/CloudBeaver workbench UX. The 32 differentiators strengthen specific safety/resource semantics; they are not asserted absent from every source product.

## Twenty most important features

| Rank | Feature ID | Capability |
|---|---|---|
| 1 | [DBM-001](FEATURE-CATALOG.md#dbm-001) | Oracle service registration |
| 2 | [DBM-004](FEATURE-CATALOG.md#dbm-004) | Inventory discovery and reconciliation |
| 3 | [DBM-019](FEATURE-CATALOG.md#dbm-019) | Oracle CDB/PDB/service distinction |
| 4 | [DBM-007](FEATURE-CATALOG.md#dbm-007) | Schema ownership and assignment |
| 5 | [PRJ-004](FEATURE-CATALOG.md#prj-004) | Fixed project roles |
| 6 | [MIG-006](FEATURE-CATALOG.md#mig-006) | Immutable Git commit ingestion |
| 7 | [MIG-007](FEATURE-CATALOG.md#mig-007) | Folder migration discovery |
| 8 | [MIG-005](FEATURE-CATALOG.md#mig-005) | Migration numeric ordering |
| 9 | [MIG-013](FEATURE-CATALOG.md#mig-013) | Raw-file checksum enforcement |
| 10 | [MIG-010](FEATURE-CATALOG.md#mig-010) | Per-target migration planning |
| 11 | [MIG-025](FEATURE-CATALOG.md#mig-025) | Target-local ledger |
| 12 | [MIG-026](FEATURE-CATALOG.md#mig-026) | Hybrid history and reconciliation |
| 13 | [GOV-002](FEATURE-CATALOG.md#gov-002) | Independent plan approval |
| 14 | [GOV-012](FEATURE-CATALOG.md#gov-012) | SQL or target edits invalidate approval |
| 15 | [MIG-019](FEATURE-CATALOG.md#mig-019) | Target mutex across all aliases |
| 16 | [SQL-017](FEATURE-CATALOG.md#sql-017) | Oracle script splitting |
| 17 | [SQL-019](FEATURE-CATALOG.md#sql-019) | Required object validity gate |
| 18 | [MIG-017](FEATURE-CATALOG.md#mig-017) | Failed migration recovery |
| 19 | [MIG-021](FEATURE-CATALOG.md#mig-021) | Release promotion ladder |
| 20 | [SEC-013](FEATURE-CATALOG.md#sec-013) | Deployment evidence bundles |

## Core decisions and risks

1. Organization owns physical Oracle catalog resources; independently identified schemas have one active project assignment. Service aliases share canonical target identity, not duplicated project connections.
2. Git commit, release, file/version, target generation and execution attempt are different identities. Approval binds retained SQL/statement bytes, exact targets/options/checks, policy and history snapshot.
3. Use hybrid history: local applied receipts plus central approval/admission/evidence. Oracle DDL and metadata are separate commits; no exactly-once arbitrary DDL or release-wide rollback promise.
4. A same-session target mutex survives DDL commits. Central queue leases alone cannot fence an orphan Oracle call. Any partial/unknown outcome stays HOLD until observed and independently resolved.
5. Success requires object-type-specific validity, compiler diagnostics and approved postconditions. Promotion uses the same artifact and verified predecessor evidence enforced on the server.
6. Core roles/approval/audit/secrets/offline operation are free; advanced policy/identity/CI/dashboard work follows in V1, editor/multi-engine/desired-state in V2.

Top technical risks: untested parser-only adapter and internal API churn; Thin transport/auth constraints; DDL commit/receipt gaps; stale sessions/alias locks; invisible or invalid Oracle objects; changed-intent/alternate-entry-point bypass; restore disagreement. [Risk register](RISK-REGISTER.md) records owners and concrete tests.

Top license risks: Bytebase mixed restricted code/enablement; current Liquibase FSL versus historical Apache source; mixed binaries/Oracle JDBC/Instant Client terms; Atlas Oracle Pro; GPL DbGate embedding; unreviewed transitive/base-image/JVM/parser packages. The OSS node-oracledb Thin candidate avoids a required proprietary Oracle Client, subject to compatibility and actual package audit. Existing Oracle Database rights remain separate.

## Scope and implementation recommendation

Do not copy Bytebase source, gate logic, branding/UI assets or count quotas. Restricted source has no assumed OSS reuse grant; copying even its permissive code is excluded by this task's independent implementation requirement. Do not reproduce warning-only changed-checksum acceptance, task success for INVALID objects, central-log-only replay decisions, blind retry or stage labels without enforced promotion. Optional AI/MCP/editor/provisioning/bulk-data/online-change scope does not belong in the reliable migration MVP.

Estimated MVP implementation: **110–170 engineer-weeks**, approximately **7–13 months with 4–5 engineers** reserving 25% for coordination/support, plus timely DBA/security participation. V1: 70–110 engineer-weeks; V2: 100–180 if full optional scope is selected. Package estimates are nonadditive with per-feature complexity. Key dependencies: authorized disposable 19c/21c labs, TCPS/grants/bootstrap, parser/license feasibility, maintained offline build artifacts and a recovery DBA operating model.

Recommended first phase: **WP0, Oracle execution feasibility harness**, 6–10 engineer-weeks (roughly 3–5 calendar weeks with two engineers plus DBA), verifying mature parser integration, OSS Thin execution, DDL-safe locking, validity and commit/receipt/crash/restore behavior. A later implementation request should carry these contracts/pins/acceptance criteria into a fresh bounded context. This research does not initiate that phase.

Local branch: `research/independent-db-devops-20261008`, based on `44b3ee7413204bdbddd587b1d5f220180eef3904`. Existing unrelated tracked/untracked work is preserved. No push or merge performed.

## Verification

Run from repository root:

```bash
python3 tools/verify_research_documents.py
python3 product-research/evidence/validate_research.py
```

The second check validates required deliverables, identifiers/fields/enums, catalog/Markdown/roadmap allocation, dependency graph and phase closure, source hash/line references, local links and pre-existing tracked change preservation. Full JSON Schema validation is also run when the jsonschema module is available; this research used version 4.25.1 in a temporary directory outside the checkout. Add `--verify-upstream` to re-fetch the 22 exact pinned current source files and verify their hashes. Results and limitations are retained in [validation results](evidence/validation-results.json). These checks validate research artifacts, never platform or Oracle execution acceptance.
