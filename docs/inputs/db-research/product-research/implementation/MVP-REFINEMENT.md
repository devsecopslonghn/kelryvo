# MVP refinement

8 October 2026. Additive planning overlay: **74 WS, 17 MVP-Core, 4 MVP-Extended**, accounting for all **95** original MVP IDs exactly once. The original 220-feature inventory and 95/77/41/7 roadmap are unchanged. V1/V2/rejected features are not silently pulled into this scope.

## Walking Skeleton boundary

WS is a real **DEV-only CLI/API workflow**: one attested service/PDB per version acceptance run, two application schemas assigned to two projects in the same DEV environment, independent named actors, protected local Git mirror, PostgreSQL metadata/artifacts, separate loopback API/restricted worker and actual Oracle execution. Reuse the accepted WP0 driver/parser/lock findings, but rerun conformance against actual platform modules.

Seventy-four IDs are granular assertions in roughly twelve shared modules, not seventy-four screens or independently built components. The scope reduction removes broad portal delivery, remote sessions, live GitLab API integration, multi-environment/estate operations and general baseline/adoption tooling from the first workflow. A high row count is an artifact of the original decomposition; changing names alone would not reduce effort.

Named WS CLI credentials are hashed, expiring, revocable and project-scoped; author/approver/deployer eligibility is checked by the API/worker. They are a bounded local identity implementation, not a claim of production browser-session readiness. Writer credentials stay in worker-only references. Oracle transport remains verified TCPS. No remote plaintext API, arbitrary query console/DSN, unsupported schema baseline, restore/adoption shortcut or non-DEV execution is exposed.

The new stages do not imply every broader UI/production/future-transfer scenario in an original feature is complete at WS. Its unique criterion is retained verbatim below. Where a scenario requires absent functionality, use an explicit contract/fixture test for the WS invariant and retain the actual scenario as later conformance; never label a simulated transfer or capacity fixture as a production runtime result. The actual WS exit is the sixteen outcomes plus all applicable safety/permission/byte/ledger tests.

## Sixteen required WS outcomes

| Outcome | Required evidence / acceptance | Main IDs |
|---|---|---|
| WS-01 | Register an attested DEV Oracle service/PDB with verified identity/TCPS and scoped credentials | DBM-001/003/014/016/019 |
| WS-02 | Discover A/B with repeatable IDs; maintained/merely visible owners remain non-executable | DBM-004/020/021 |
| WS-03 | Assign A and B to separate projects in the same DEV container; unauthorized cross-project reads fail | DBM-007/009, PRJ-001/003/004/011 |
| WS-04 | Ingest a bound immutable Git folder from a read-only local mirror; branch changes cannot alter retained bytes | PRJ-008, MIG-006/007, GIT-003/006/016 |
| WS-05 | Canonical versions sort deterministically; duplicates/traversal/unsupported commands reject the entire release | MIG-004/005/009, SQL-017 |
| WS-06 | Original raw checksums and parsed execution digests are reproducible and independent | MIG-008/013, GIT-007 |
| WS-07 | Read each target's genuine version receipts plus unresolved central attempts with known visibility | MIG-025/026/011 |
| WS-08 | A with V001–V003 plans V004/V005; B with V001 plans V002–V005 | MIG-010/028 |
| WS-09 | Independent named actor approves the exact commit/manifest/statement/target/history intent; all mutations deny | GOV-001/002/006/007/009/012/013/018, SEC-008 |
| WS-10 | Authorized worker alone runs approved pending bytes under same-session DDL-safe mutex; duplicate requests do not duplicate effects | MIG-001/002/018/019, OPS-001/002 |
| WS-11 | Expected owner/name/type, package spec/body, compiler errors and approved postchecks determine validity | SQL-016/018/019/020, MIG-031 |
| WS-12 | Persist distinct target STARTED/APPLIED records with immutable digests; no fabricated success or repaired checksum | MIG-025/027 |
| WS-13 | Persist central actor/approval/attempt/outcome/audit evidence independent of worker process/log lifetime | SEC-011, GOV-023, OPS-005/006 |
| WS-14 | Independently approved replan of same applied release yields zero pending and zero migration calls | MIG-029 |
| WS-15 | Changed applied V002 raw byte blocks planning and stale dispatch | MIG-013, GOV-012/013 |
| WS-16 | Partial/crashed/unacknowledged effects remain AMBIGUOUS/HOLD; no blind retry; observed receipt can reconstruct central evidence | MIG-017/020/026, OPS-019/025 |

## Core and Extended exits

**MVP-Core** adds 17 requirements to the WS foundations, for 91 cumulative IDs: actual live GitLab provider, HTTPS/multi-user session lifecycle, protected secrets/storage, full baseline/correction/restore/promotion, supported Kubernetes/OpenShift/offline updates/retention and measured 50-service/500-schema/20-user operation. Production readiness also needs actual integrated evidence, supported capability profiles and explicit operational ownership; a Core code-complete label is insufficient.

**MVP-Extended** adds four safely postponable presentation/export requirements: grouped project estate (PRJ-002), guided rejection/resubmission (GOV-010), portable deployment evidence bundle (SEC-013) and dedicated outcome panel (EXT-010). Their minimum facts already exist in WS APIs/audit; their views/export do not authorize SQL. Completing these is still required to claim the original full 95-row MVP milestone. A full React portal is separately optional, not a dependency injected into WS.

## Per-feature audit and refinement

Owner/module is implementation responsibility, not a message sent to an external person. Relative S/M/L complexity is retained for comparison and is nonadditive. Original prerequisite IDs remain unchanged; the primary task adds concrete engineering dependencies through the task DAG. AC-ID names the acceptance contract to implement/test in a later session. WP0 cases are regression inputs, not evidence the actual platform passes.

### DBM-001

**Oracle service registration — WS / M.** Purpose: Register a verified Oracle service route with a stable endpoint ID and explicit transport.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `inventory`. **Primary task:** [WP2-T01](IMPLEMENTATION-BACKLOG.md#wp2-t01).

**Prerequisites:** Foundational catalog capability; primary task prerequisites still apply.

**Acceptance AC-DBM-001:** Register two services without embedding passwords in API output.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-003

**Connection profiles and scoped credentials — WS / M.** Purpose: Separate discovery and schema-owner execution references on one endpoint.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `credentials`. **Primary task:** [WP2-T01](IMPLEMENTATION-BACKLOG.md#wp2-t01).

**Prerequisites:** [DBM-001](../FEATURE-CATALOG.md#dbm-001); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-DBM-003:** A discovery identity cannot be selected as a writer without an explicit reviewed binding.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-004

**Inventory discovery and reconciliation — WS / M.** Purpose: Upsert observed endpoint/container/schema identities and expose stale or incomplete results.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `discovery`. **Primary task:** [WP2-T03](IMPLEMENTATION-BACKLOG.md#wp2-t03).

**Prerequisites:** [DBM-001](../FEATURE-CATALOG.md#dbm-001); [DBM-003](../FEATURE-CATALOG.md#dbm-003)

**Acceptance AC-DBM-004:** Repeating discovery creates no duplicate schemas and preserves manual assignment.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-007

**Schema ownership and assignment — WS / M.** Purpose: Assign independently identified schemas to one active owning project.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `assignments`. **Primary task:** [WP2-T04](IMPLEMENTATION-BACKLOG.md#wp2-t04).

**Prerequisites:** [DBM-004](../FEATURE-CATALOG.md#dbm-004); [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-DBM-007:** Two schemas through one service can belong to different projects without duplicate endpoint metadata.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-009

**Environment mapping — WS / M.** Purpose: Use authoritative container environments inherited by schemas.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `topology`. **Primary task:** [WP2-T02](IMPLEMENTATION-BACKLOG.md#wp2-t02).

**Prerequisites:** [DBM-019](../FEATURE-CATALOG.md#dbm-019)

**Acceptance AC-DBM-009:** A PROD container cannot be made DEV by editing a schema label.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-014

**Connection testing — WS / M.** Purpose: Verify authentication, service/container identity and required visibility separately.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `connection-tests`. **Primary task:** [WP2-T01](IMPLEMENTATION-BACKLOG.md#wp2-t01).

**Prerequisites:** [SEC-005](../FEATURE-CATALOG.md#sec-005); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-DBM-014:** A successful ping with wrong PDB identity fails onboarding.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-016

**TLS and connection trust — WS / M.** Purpose: Require verified TCPS trust/server identity for production transport.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `transport`. **Primary task:** [WP2-T01](IMPLEMENTATION-BACKLOG.md#wp2-t01).

**Prerequisites:** [SEC-005](../FEATURE-CATALOG.md#sec-005); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-DBM-016:** An untrusted certificate blocks execution and produces a redacted diagnostic.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-01-01](WP0-TEST-PLAN.md#wp0-01-01), [WP0-01-03](WP0-TEST-PLAN.md#wp0-01-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-019

**Oracle CDB/PDB/service distinction — WS / L.** Purpose: Model route, physical container and schema separately and attest aliases.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `topology`. **Primary task:** [WP2-T02](IMPLEMENTATION-BACKLOG.md#wp2-t02).

**Prerequisites:** [DBM-001](../FEATURE-CATALOG.md#dbm-001)

**Acceptance AC-DBM-019:** Two aliases to one PDB/owner resolve to the same target mutex.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-020

**Discovery visibility profile — WS / M.** Purpose: Record catalog grants and missing visibility rather than assuming full discovery.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `visibility`. **Primary task:** [WP2-T03](IMPLEMENTATION-BACKLOG.md#wp2-t03).

**Prerequisites:** [SEC-005](../FEATURE-CATALOG.md#sec-005); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-DBM-020:** Zero ALL_ERRORS rows without required visibility cannot satisfy validity checks.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-021

**Oracle maintained account filtering — WS / M.** Purpose: Exclude Oracle-maintained owners through a reviewed catalog-aware policy.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `discovery`. **Primary task:** [WP2-T03](IMPLEMENTATION-BACKLOG.md#wp2-t03).

**Prerequisites:** [SEC-005](../FEATURE-CATALOG.md#sec-005); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-DBM-021:** New application owner is discoverable; SYS/SYSTEM are not deployable targets.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-022

**Physical connection deduplication — WS / M.** Purpose: Share endpoint metadata across project schemas and credential-specific sessions.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `assignments`. **Primary task:** [WP2-T04](IMPLEMENTATION-BACKLOG.md#wp2-t04).

**Prerequisites:** [SEC-005](../FEATURE-CATALOG.md#sec-005); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-DBM-022:** Registering 500 schemas on 50 services does not create 500 physical inventory endpoints.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-02-04](WP0-TEST-PLAN.md#wp0-02-04), [WP0-02-03](WP0-TEST-PLAN.md#wp0-02-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### DBM-023

**Topology generations and clone detection — WS / L.** Purpose: Bind target generation and attest clone/restore/service remapping.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `topology`. **Primary task:** [WP2-T05](IMPLEMENTATION-BACKLOG.md#wp2-t05).

**Prerequisites:** [DBM-019](../FEATURE-CATALOG.md#dbm-019)

**Acceptance AC-DBM-023:** A changed container generation invalidates an otherwise approved plan.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-05](WP0-TEST-PLAN.md#wp0-02-05), [WP0-09-03](WP0-TEST-PLAN.md#wp0-09-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### PRJ-001

**Project creation and archival — WS / M.** Purpose: Create projects with stable IDs and archive only after active work is resolved.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Domain/metadata engineer; `projects`. **Primary task:** [WP1-T02](IMPLEMENTATION-BACKLOG.md#wp1-t02).

**Prerequisites:** Foundational catalog capability; primary task prerequisites still apply.

**Acceptance AC-PRJ-001:** Archived projects cannot admit new jobs and keep historical evidence readable.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### PRJ-002

**Project schema estate — MVP-Extended / M.** Purpose: Show project schemas grouped by environment and physical service.

**Reason:** WS lists authorized schema assignments directly. A grouped project estate presentation can follow without changing ownership or authorization.

**Owner/module:** API/CLI engineer; `estate-view`. **Primary task:** [WP7-T04](IMPLEMENTATION-BACKLOG.md#wp7-t04).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-PRJ-002:** One service shows two isolated project estates according to assignments.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### PRJ-003

**Project membership — WS / M.** Purpose: Manage explicit principal memberships with server authorization.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `membership`. **Primary task:** [WP4-T02](IMPLEMENTATION-BACKLOG.md#wp4-t02).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-PRJ-003:** Removing a member immediately denies new actions on project resources.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### PRJ-004

**Fixed project roles — WS / M.** Purpose: Provide developer, approver, deployer and auditor roles as free core controls.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `authorization`. **Primary task:** [WP4-T02](IMPLEMENTATION-BACKLOG.md#wp4-t02).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-PRJ-004:** Developer cannot approve own intent or execute a PROD job without deployer permission.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### PRJ-008

**Project repository binding — WS / M.** Purpose: Bind allowed repository, migration folder and read-only secret scope.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `repository-binding`. **Primary task:** [WP3-T01](IMPLEMENTATION-BACKLOG.md#wp3-t01).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-PRJ-008:** An unrelated repository/folder cannot ingest into the project.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### PRJ-011

**Project resource isolation — WS / M.** Purpose: Check object authorization on catalog, SQL, artifacts, jobs and history.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `authorization`. **Primary task:** [WP4-T02](IMPLEMENTATION-BACKLOG.md#wp4-t02).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-PRJ-011:** Guessing another project's resource UUID returns no SQL or metadata.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-02-01](WP0-TEST-PLAN.md#wp0-02-01), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-001

**Versioned schema migrations — WS / M.** Purpose: Apply ordered immutable SQL versions to selected schemas.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `executor`. **Primary task:** [WP5-T04](IMPLEMENTATION-BACKLOG.md#wp5-t04).

**Prerequisites:** [MIG-010](../FEATURE-CATALOG.md#mig-010); [GOV-002](../FEATURE-CATALOG.md#gov-002); [MIG-019](../FEATURE-CATALOG.md#mig-019); [SQL-017](../FEATURE-CATALOG.md#sql-017); [SQL-019](../FEATURE-CATALOG.md#sql-019)

**Acceptance AC-MIG-001:** V001 creates a table and one matching target history entry.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-002

**Versioned data migrations — WS / M.** Purpose: Execute approved INSERT/UPDATE data scripts under explicit transaction classification.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `transaction-profile`. **Primary task:** [WP5-T04](IMPLEMENTATION-BACKLOG.md#wp5-t04).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-002:** A successful data version is skipped on replay and has observer evidence.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-004

**Migration file naming — WS / M.** Purpose: Validate V<number>__description.sql and canonicalize numeric versions.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `migration-files`. **Primary task:** [WP3-T03](IMPLEMENTATION-BACKLOG.md#wp3-t03).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-004:** V001 and V1 together fail before planning due to duplicate canonical version.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-005

**Migration numeric ordering — WS / M.** Purpose: Order dotted numeric versions deterministically within a stable stream.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `migration-files`. **Primary task:** [WP3-T03](IMPLEMENTATION-BACKLOG.md#wp3-t03).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-005:** V2 executes before V10 regardless of directory listing order.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-006

**Immutable Git commit ingestion — WS / M.** Purpose: Resolve a full commit from a bound repository and retain its bytes.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `git-reader`. **Primary task:** [WP3-T02](IMPLEMENTATION-BACKLOG.md#wp3-t02).

**Prerequisites:** [PRJ-008](../FEATURE-CATALOG.md#prj-008); [GIT-006](../FEATURE-CATALOG.md#git-006)

**Acceptance AC-MIG-006:** Moving a branch after ingestion cannot change the release artifact.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-007

**Folder migration discovery — WS / M.** Purpose: Read a declared migration directory as one release with no manual per-file submission.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `migration-files`. **Primary task:** [WP3-T03](IMPLEMENTATION-BACKLOG.md#wp3-t03).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-007:** One folder submission yields all five sample versions with path/hash metadata.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-008

**Release creation and identity — WS / M.** Purpose: Give each immutable manifest a release ID and content digest.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `release-manifest`. **Primary task:** [WP3-T04](IMPLEMENTATION-BACKLOG.md#wp3-t04).

**Prerequisites:** [MIG-004](../FEATURE-CATALOG.md#mig-004); [MIG-005](../FEATURE-CATALOG.md#mig-005); [MIG-006](../FEATURE-CATALOG.md#mig-006); [MIG-009](../FEATURE-CATALOG.md#mig-009)

**Acceptance AC-MIG-008:** Two different folder/settings manifests at one commit produce distinguishable release identities.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-009

**Release structural validation — WS / M.** Purpose: Validate files, encoding, sizes, capability profile and duplicate versions before target writes.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `release-manifest`. **Primary task:** [WP3-T04](IMPLEMENTATION-BACKLOG.md#wp3-t04).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-009:** A symlink or unsupported SQL*Plus command yields a file/line error and no target effects.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-010

**Per-target migration planning — WS / M.** Purpose: Read applied target history and freeze exact pending file lists per schema.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `planner`. **Primary task:** [WP3-T05](IMPLEMENTATION-BACKLOG.md#wp3-t05).

**Prerequisites:** [MIG-025](../FEATURE-CATALOG.md#mig-025); [MIG-013](../FEATURE-CATALOG.md#mig-013); [DBM-007](../FEATURE-CATALOG.md#dbm-007); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-MIG-010:** Schema A with two versions plans three files while schema B with one plans four.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-011

**Pending and applied reconciliation — WS / M.** Purpose: Compare target receipts, central mirror and immutable files before execution.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Recovery engineer + DBA; `reconciliation`. **Primary task:** [WP6-T01](IMPLEMENTATION-BACKLOG.md#wp6-t01).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-011:** A central UNKNOWN attempt blocks even when local history shows the version pending.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-012

**Migration execution history — WS / M.** Purpose: Expose actor, file, version, target, attempt, time and result separately from SQL queries.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** API/CLI engineer; `history-api`. **Primary task:** [WP7-T02](IMPLEMENTATION-BACKLOG.md#wp7-t02).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-012:** Query history cannot appear as proof that a migration version was applied.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-013

**Raw-file checksum enforcement — WS / L.** Purpose: Reject changes to any included applied version using SHA-256 over original bytes.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `planner`. **Primary task:** [WP3-T05](IMPLEMENTATION-BACKLOG.md#wp3-t05).

**Prerequisites:** [MIG-008](../FEATURE-CATALOG.md#mig-008); [MIG-025](../FEATURE-CATALOG.md#mig-025)

**Acceptance AC-MIG-013:** One changed byte in an applied file blocks both planning and dispatch.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-015

**Approved schema baseline — MVP-Core / M.** Purpose: Record a reviewed baseline for preexisting schemas without pretending SQL executed.

**Reason:** WS accepts only explicitly bootstrapped fresh lab schemas; adopting pre-existing application state needs a reviewed baseline in Core.

**Owner/module:** Recovery engineer + DBA; `baseline`. **Primary task:** [WP6-T04](IMPLEMENTATION-BACKLOG.md#wp6-t04).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-015:** Baseline has separate state, snapshot, versions/hashes and independent approval.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-017

**Failed migration recovery — WS / L.** Purpose: Place partial/unknown work on HOLD and require evidence-based recovery authorization.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Recovery engineer + DBA; `recovery`. **Primary task:** [WP6-T02](IMPLEMENTATION-BACKLOG.md#wp6-t02).

**Prerequisites:** [MIG-026](../FEATURE-CATALOG.md#mig-026); [OPS-005](../FEATURE-CATALOG.md#ops-005)

**Acceptance AC-MIG-017:** A CREATE followed by failing ALTER cannot be blindly replayed.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-07-02](WP0-TEST-PLAN.md#wp0-07-02), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04), [WP0-07-08](WP0-TEST-PLAN.md#wp0-07-08), [WP0-09-04](WP0-TEST-PLAN.md#wp0-09-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-018

**Idempotent deployment API — WS / M.** Purpose: Bind idempotency key to actor, action and complete request digest.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `admission`. **Primary task:** [WP4-T04](IMPLEMENTATION-BACKLOG.md#wp4-t04).

**Prerequisites:** [GOV-002](../FEATURE-CATALOG.md#gov-002); [GOV-018](../FEATURE-CATALOG.md#gov-018)

**Acceptance AC-MIG-018:** Same key/body returns same job; same key/different targets returns conflict.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-019

**Target mutex across all aliases — WS / L.** Purpose: Serialize all managed streams and service aliases touching one schema.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `target-lock`. **Primary task:** [WP5-T02](IMPLEMENTATION-BACKLOG.md#wp5-t02).

**Prerequisites:** [DBM-019](../FEATURE-CATALOG.md#dbm-019); [DBM-023](../FEATURE-CATALOG.md#dbm-023)

**Acceptance AC-MIG-019:** Two workers through different aliases never execute statements concurrently.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-01](WP0-TEST-PLAN.md#wp0-06-01), [WP0-06-03](WP0-TEST-PLAN.md#wp0-06-03), [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-06-05](WP0-TEST-PLAN.md#wp0-06-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-020

**Safe migration retry admission — WS / M.** Purpose: Retry SQL only after proven no effects or an explicitly approved recovery plan.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Recovery engineer + DBA; `recovery-admission`. **Primary task:** [WP6-T03](IMPLEMENTATION-BACKLOG.md#wp6-t03).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-020:** Network loss cannot cause automatic retry of a PL/SQL or DDL file.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-021

**Release promotion ladder — MVP-Core / M.** Purpose: Require same release digest and verified predecessor results for each stage.

**Reason:** WS is DEV-only. Four-stage promotion needs distinct environment containers, predecessor rules and operating users in Core.

**Owner/module:** Integration/release engineer; `promotion`. **Primary task:** [WP8-T02](IMPLEMENTATION-BACKLOG.md#wp8-t02).

**Prerequisites:** [MIG-031](../FEATURE-CATALOG.md#mig-031); [SQL-019](../FEATURE-CATALOG.md#sql-019); [GOV-002](../FEATURE-CATALOG.md#gov-002)

**Acceptance AC-MIG-021:** PROD API dispatch is denied while UAT is pending, failed, invalid or unknown.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-023

**Reviewed corrective migrations — MVP-Core / M.** Purpose: Use fix-forward versions linked to recovery evidence and application compatibility.

**Reason:** WS detects/holds partial effects and permits narrowly proven recovery. General fix-forward authoring and compatibility review arrive in Core.

**Owner/module:** Recovery engineer + DBA; `corrective-change`. **Primary task:** [WP6-T04](IMPLEMENTATION-BACKLOG.md#wp6-t04).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-023:** A correction cannot bypass an unresolved lower-version HOLD.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-025

**Target-local ledger — WS / M.** Purpose: Persist immutable stream/version/checksum application receipts in the actual schema.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `target-ledger`. **Primary task:** [WP5-T01](IMPLEMENTATION-BACKLOG.md#wp5-t01).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [DBM-023](../FEATURE-CATALOG.md#dbm-023)

**Acceptance AC-MIG-025:** Target history survives central outage and distinguishes baseline from executed application.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04), [WP0-07-05](WP0-TEST-PLAN.md#wp0-07-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-026

**Hybrid history and reconciliation — WS / L.** Purpose: Keep central approval/admission history plus local target receipts and reconcile both.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Recovery engineer + DBA; `reconciliation`. **Primary task:** [WP6-T01](IMPLEMENTATION-BACKLOG.md#wp6-t01).

**Prerequisites:** [MIG-025](../FEATURE-CATALOG.md#mig-025); [SEC-011](../FEATURE-CATALOG.md#sec-011); [OPS-001](../FEATURE-CATALOG.md#ops-001)

**Acceptance AC-MIG-026:** Local success with missing central completion restores evidence without replaying SQL.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-09-01](WP0-TEST-PLAN.md#wp0-09-01), [WP0-09-02](WP0-TEST-PLAN.md#wp0-09-02), [WP0-09-03](WP0-TEST-PLAN.md#wp0-09-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-027

**Statement-level diagnostics — WS / M.** Purpose: Record file/version/source range and database error for acknowledged statement calls.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `executor-diagnostics`. **Primary task:** [WP5-T04](IMPLEMENTATION-BACKLOG.md#wp5-t04).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-027:** A failing statement is locatable in the retained original file.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-028

**Exact plan history precondition — WS / L.** Purpose: Bind ledger snapshot digest and invalidate a plan when target history changes.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `dispatch-revalidation`. **Primary task:** [WP5-T03](IMPLEMENTATION-BACKLOG.md#wp5-t03).

**Prerequisites:** [MIG-010](../FEATURE-CATALOG.md#mig-010); [MIG-019](../FEATURE-CATALOG.md#mig-019)

**Acceptance AC-MIG-028:** A concurrent completed deployment requires a new plan/approval even if pending files shrink.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-01](WP0-TEST-PLAN.md#wp0-06-01), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-029

**Per-target zero-pending success — WS / M.** Purpose: Record a checked NOOP run without migration statements.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `dispatch-revalidation`. **Primary task:** [WP5-T03](IMPLEMENTATION-BACKLOG.md#wp5-t03).

**Prerequisites:** [DBM-007](../FEATURE-CATALOG.md#dbm-007); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-MIG-029:** Replanning an applied five-file release yields zero effects and a no-op receipt.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-031

**Preconditions and postconditions — WS / L.** Purpose: Bind read-only semantic checks and required objects to the approved manifest.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `verification`. **Primary task:** [WP5-T05](IMPLEMENTATION-BACKLOG.md#wp5-t05).

**Prerequisites:** [SQL-019](../FEATURE-CATALOG.md#sql-019)

**Acceptance AC-MIG-031:** A failed mandatory postcondition prevents VERIFIED_SUCCESS and promotion.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-04-01](WP0-TEST-PLAN.md#wp0-04-01), [WP0-04-02](WP0-TEST-PLAN.md#wp0-04-02), [WP0-04-03](WP0-TEST-PLAN.md#wp0-04-03), [WP0-07-04](WP0-TEST-PLAN.md#wp0-07-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### MIG-034

**Restore divergence detection — MVP-Core / L.** Purpose: Quarantine restored central or target history until both are reconciled.

**Reason:** WS blocks detected ledger disagreement and any declared restore. Full two-direction restore protocols and generation witnesses arrive in Core.

**Owner/module:** Recovery engineer + DBA; `restore`. **Primary task:** [WP6-T05](IMPLEMENTATION-BACKLOG.md#wp6-t05).

**Prerequisites:** [MIG-026](../FEATURE-CATALOG.md#mig-026); [OPS-012](../FEATURE-CATALOG.md#ops-012)

**Acceptance AC-MIG-034:** A rewound Oracle ledger cannot silently make old data migrations pending.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-09-03](WP0-TEST-PLAN.md#wp0-09-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-001

**Change request and issue creation — WS / M.** Purpose: Create an accountable request for one immutable plan revision.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `plan-requests`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [MIG-010](../FEATURE-CATALOG.md#mig-010); [PRJ-003](../FEATURE-CATALOG.md#prj-003)

**Acceptance AC-GOV-001:** Request links requester, release, target set and intent digest.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-002

**Independent plan approval — WS / M.** Purpose: Require an authenticated independent approver for the frozen plan.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `approval`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [GOV-001](../FEATURE-CATALOG.md#gov-001); [GOV-007](../FEATURE-CATALOG.md#gov-007)

**Acceptance AC-GOV-002:** Author and last editor approvals are denied through UI and direct API.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-006

**Segregation of duties — WS / M.** Purpose: Separate author, reviewer and execution authorization on every entry point.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `authorization`. **Primary task:** [WP4-T02](IMPLEMENTATION-BACKLOG.md#wp4-t02).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-006:** Requester cannot bypass deployer permission using CI, scheduler or SQL console.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-007

**Self-approval and last-editor restrictions — WS / M.** Purpose: Exclude requester and every authenticated SQL/target/postcheck editor contributing to the current intent; later metadata edits cannot erase exclusions.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `approval`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004)

**Acceptance AC-GOV-007:** Changing only the target still makes that editor ineligible to approve.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-009

**Approval expiration — WS / M.** Purpose: Set explicit decision validity and check it again at dispatch.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `approval`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-009:** Expired approval fails admission even if the UI remains open.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-010

**Rejection and resubmission — MVP-Extended / M.** Purpose: Persist rejection and create a fresh plan revision for changed intent.

**Reason:** WS records rejection and accepts a new independently approved plan; a guided resubmission lineage workflow can follow.

**Owner/module:** API/CLI engineer; `resubmission-view`. **Primary task:** [WP7-T04](IMPLEMENTATION-BACKLOG.md#wp7-t04).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-010:** Resubmitting edited SQL cannot reuse an old approval.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-011

**Approval revocation — WS / M.** Purpose: Revoke future execution and place active work into controlled stop/HOLD.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `admission`. **Primary task:** [WP4-T04](IMPLEMENTATION-BACKLOG.md#wp4-t04).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-011:** A revoked queued deployment cannot start; committed effects remain recorded.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-012

**SQL or target edits invalidate approval — WS / L.** Purpose: Treat every SQL, target, option or postcheck change as a new immutable intent.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `approval`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-012:** A changed schema or statement hash rejects old approval at dispatch.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-013

**Immutable approved artifacts — WS / M.** Purpose: Approve retained artifact and statement hashes with full provenance.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `approval`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-013:** Replacing a file in storage fails hash verification before any SQL.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-018

**Execution authorization — WS / M.** Purpose: Check deployer permission and scoped worker admission independent of approval.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `admission`. **Primary task:** [WP4-T04](IMPLEMENTATION-BACKLOG.md#wp4-t04).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004)

**Acceptance AC-GOV-018:** An approver without deployer permission cannot dispatch SQL.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-022

**Manual continuation between stages — MVP-Core / M.** Purpose: Continue only after verified lower-stage evidence and required approval.

**Reason:** There is no stage-continuation endpoint in WS; Core adds it only with server-enforced promotion.

**Owner/module:** Integration/release engineer; `promotion`. **Primary task:** [WP8-T02](IMPLEMENTATION-BACKLOG.md#wp8-t02).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-022:** Manual continue API cannot skip a failed predecessor.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GOV-023

**Approval decision audit — WS / M.** Purpose: Persist actor/eligibility/intent/policy/time/reason for every decision and denial.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `approval-audit`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [PRJ-004](../FEATURE-CATALOG.md#prj-004); [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GOV-023:** Auditor can reconstruct all approval revisions after project transfer.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08), [WP0-08-05](WP0-TEST-PLAN.md#wp0-08-05), [WP0-08-02](WP0-TEST-PLAN.md#wp0-08-02).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SQL-015

**Exact execution preview — WS / M.** Purpose: Show pending statement bytes/ranges and target intent before approval.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** API/CLI engineer; `plan-preview`. **Primary task:** [WP7-T01](IMPLEMENTATION-BACKLOG.md#wp7-t01).

**Prerequisites:** [DBM-020](../FEATURE-CATALOG.md#dbm-020); [SEC-006](../FEATURE-CATALOG.md#sec-006)

**Acceptance AC-SQL-015:** Preview digest matches the worker's parsed statement digest.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-03-05](WP0-TEST-PLAN.md#wp0-03-05), [WP0-03-08](WP0-TEST-PLAN.md#wp0-03-08), [WP0-05-01](WP0-TEST-PLAN.md#wp0-05-01), [WP0-05-03](WP0-TEST-PLAN.md#wp0-05-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SQL-016

**Oracle PL/SQL scripts — WS / M.** Purpose: Execute procedures/functions/triggers/anonymous blocks through a mature splitter.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `executor`. **Primary task:** [WP5-T04](IMPLEMENTATION-BACKLOG.md#wp5-t04).

**Prerequisites:** [DBM-020](../FEATURE-CATALOG.md#dbm-020); [SEC-006](../FEATURE-CATALOG.md#sec-006)

**Acceptance AC-SQL-016:** All required PL/SQL fixtures preserve body boundaries and result semantics on 19c/21c.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-03-05](WP0-TEST-PLAN.md#wp0-03-05), [WP0-03-08](WP0-TEST-PLAN.md#wp0-03-08), [WP0-05-01](WP0-TEST-PLAN.md#wp0-05-01), [WP0-05-03](WP0-TEST-PLAN.md#wp0-05-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SQL-017

**Oracle script splitting — WS / L.** Purpose: Preserve q-quotes, comments, internal semicolons and standalone slash delimiters.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `parser-adapter`. **Primary task:** [WP3-T04](IMPLEMENTATION-BACKLOG.md#wp3-t04).

**Prerequisites:** [MIG-009](../FEATURE-CATALOG.md#mig-009)

**Acceptance AC-SQL-017:** No slash delimiter is sent as SQL and q-quoted semicolons do not split statements.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-03-01](WP0-TEST-PLAN.md#wp0-03-01), [WP0-03-08](WP0-TEST-PLAN.md#wp0-03-08), [WP0-03-09](WP0-TEST-PLAN.md#wp0-03-09), [WP0-03-10](WP0-TEST-PLAN.md#wp0-03-10), [WP0-03-11](WP0-TEST-PLAN.md#wp0-03-11), [WP0-03-12](WP0-TEST-PLAN.md#wp0-03-12).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SQL-018

**Package specification and body validation — WS / L.** Purpose: Validate each expected owner/name/object-type independently.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `verification`. **Primary task:** [WP5-T05](IMPLEMENTATION-BACKLOG.md#wp5-t05).

**Prerequisites:** [SQL-017](../FEATURE-CATALOG.md#sql-017); [SQL-019](../FEATURE-CATALOG.md#sql-019)

**Acceptance AC-SQL-018:** VALID specification with INVALID body prevents VERIFIED_SUCCESS.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-03-05](WP0-TEST-PLAN.md#wp0-03-05), [WP0-03-08](WP0-TEST-PLAN.md#wp0-03-08), [WP0-05-01](WP0-TEST-PLAN.md#wp0-05-01), [WP0-05-03](WP0-TEST-PLAN.md#wp0-05-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SQL-019

**Required object validity gate — WS / L.** Purpose: Require expected objects to exist and be VALID with known dictionary visibility.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `verification`. **Primary task:** [WP5-T05](IMPLEMENTATION-BACKLOG.md#wp5-t05).

**Prerequisites:** [DBM-020](../FEATURE-CATALOG.md#dbm-020)

**Acceptance AC-SQL-019:** Missing object or inaccessible compiler diagnostics blocks final success.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-03-05](WP0-TEST-PLAN.md#wp0-03-05), [WP0-03-08](WP0-TEST-PLAN.md#wp0-03-08), [WP0-05-01](WP0-TEST-PLAN.md#wp0-05-01), [WP0-05-03](WP0-TEST-PLAN.md#wp0-05-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SQL-020

**Compiler diagnostics explorer — WS / M.** Purpose: Display compiler name/type/line/position/text and map to retained source.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** API/CLI engineer; `diagnostics-cli`. **Primary task:** [WP7-T02](IMPLEMENTATION-BACKLOG.md#wp7-t02).

**Prerequisites:** [DBM-020](../FEATURE-CATALOG.md#dbm-020); [SEC-006](../FEATURE-CATALOG.md#sec-006)

**Acceptance AC-SQL-020:** A PL/SQL compiler ERROR is shown even if driver execution returned success.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-03-05](WP0-TEST-PLAN.md#wp0-03-05), [WP0-03-08](WP0-TEST-PLAN.md#wp0-03-08), [WP0-05-01](WP0-TEST-PLAN.md#wp0-05-01), [WP0-05-03](WP0-TEST-PLAN.md#wp0-05-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-001

**Local authentication — WS / M.** Purpose: Provide secure local identities for offline operation with invite-only setup.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `local-identity`. **Primary task:** [WP4-T01](IMPLEMENTATION-BACKLOG.md#wp4-t01).

**Prerequisites:** Foundational catalog capability; primary task prerequisites still apply.

**Acceptance AC-SEC-001:** Unauthenticated endpoints disclose no SQL or catalog resources.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-005

**Role-based authorization — WS / M.** Purpose: Enforce fixed roles centrally for UI/API and worker admission.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `authorization`. **Primary task:** [WP4-T02](IMPLEMENTATION-BACKLOG.md#wp4-t02).

**Prerequisites:** [SEC-001](../FEATURE-CATALOG.md#sec-001); [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-SEC-005:** Direct API calls have the same authorization result as UI actions.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-006

**Resource-level permissions — WS / M.** Purpose: Authorize stable project/schema resources at every read/write boundary.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `authorization`. **Primary task:** [WP4-T02](IMPLEMENTATION-BACKLOG.md#wp4-t02).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-SEC-006:** Guessable IDs never bypass object authorization.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-008

**Approval policy enforcement — WS / M.** Purpose: Apply independent approval as a server admission condition.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `admission`. **Primary task:** [WP4-T04](IMPLEMENTATION-BACKLOG.md#wp4-t04).

**Prerequisites:** [GOV-002](../FEATURE-CATALOG.md#gov-002)

**Acceptance AC-SEC-008:** Missing, invalid or expired approval denies worker dispatch.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-009

**Scoped secrets provider — WS / M.** Purpose: Use versioned secret references with API/worker separation and no plaintext catalog storage.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `credentials`. **Primary task:** [WP2-T01](IMPLEMENTATION-BACKLOG.md#wp2-t01).

**Prerequisites:** Foundational catalog capability; primary task prerequisites still apply.

**Acceptance AC-SEC-009:** API cannot read PROD writer secrets while a scoped worker can fetch its admitted target secret.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-010

**Credential encryption and redaction — MVP-Core / M.** Purpose: Avoid plaintext in metadata/logs and protect secrets at rest using existing Kubernetes controls.

**Reason:** WS never stores secret bytes centrally and already redacts logs. Cluster encryption-at-rest and backup controls require Core deployment.

**Owner/module:** Security/operations engineer + DBA; `secret-hardening`. **Primary task:** [WP9-T01](IMPLEMENTATION-BACKLOG.md#wp9-t01).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-SEC-010:** Known-secret scan finds no credentials in exported research/deployment evidence.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-011

**Complete change audit trail — WS / M.** Purpose: Persist change/security decisions, denials and recovery events with retention policy.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Domain/metadata engineer; `audit`. **Primary task:** [WP1-T03](IMPLEMENTATION-BACKLOG.md#wp1-t03).

**Prerequisites:** [SEC-001](../FEATURE-CATALOG.md#sec-001)

**Acceptance AC-SEC-011:** Audit reconstructs WHO/WHAT/WHERE/WHEN/HOW/RESULT for a completed and failed attempt.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-013

**Deployment evidence bundles — MVP-Extended / M.** Purpose: Retain hashed artifacts, decisions, receipts and compiler/postcheck evidence.

**Reason:** WS stores complete central evidence and hashes. A portable joined deployment bundle/export workflow can follow; WP0 test evidence export remains required.

**Owner/module:** Security/operations engineer + DBA; `evidence-export`. **Primary task:** [WP9-T04](IMPLEMENTATION-BACKLOG.md#wp9-t04).

**Prerequisites:** [SEC-011](../FEATURE-CATALOG.md#sec-011); [MIG-011](../FEATURE-CATALOG.md#mig-011)

**Acceptance AC-SEC-013:** An exported bundle can match each executed file to its approved bytes and target.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-014

**Policy enforcement on alternate entry points — WS / L.** Purpose: Prevent CI, console, scheduler and admin APIs from bypassing managed migration controls.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `admission`. **Primary task:** [WP4-T04](IMPLEMENTATION-BACKLOG.md#wp4-t04).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-SEC-014:** A developer denied dispatch cannot execute equivalent SQL through the editor.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-017

**Network restrictions — WS / M.** Purpose: Allow only configured Git/Oracle/secret endpoints from restricted workers.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Inventory engineer + DBA; `endpoint-allowlist`. **Primary task:** [WP2-T01](IMPLEMENTATION-BACKLOG.md#wp2-t01).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-SEC-017:** Requester-supplied URLs or DNS redirects cannot reach metadata or secret endpoints.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-018

**Web and API TLS — MVP-Core / M.** Purpose: Terminate verified HTTPS and secure worker transport in the on-prem deployment.

**Reason:** WS API binds only to loopback; no browser or remote access. Core requires verified HTTPS before multi-user network access.

**Owner/module:** Integration/release engineer; `api-transport`. **Primary task:** [WP8-T03](IMPLEMENTATION-BACKLOG.md#wp8-t03).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-SEC-018:** Session cookies/tokens never transit plaintext outside the trusted pod boundary.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### SEC-019

**Session lifecycle and logout — MVP-Core / M.** Purpose: Use secure cookies, idle/absolute expiry, CSRF controls and immediate revocation checks.

**Reason:** WS uses seeded named, revocable, short-lived CLI credentials. Browser cookies, logout, CSRF and invite/session management arrive in Core.

**Owner/module:** Identity/governance engineer; `browser-sessions`. **Primary task:** [WP4-T05](IMPLEMENTATION-BACKLOG.md#wp4-t05).

**Prerequisites:** [PRJ-001](../FEATURE-CATALOG.md#prj-001)

**Acceptance AC-SEC-019:** Logged-out or revoked sessions cannot approve queued work.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-10-02](WP0-TEST-PLAN.md#wp0-10-02), [WP0-10-03](WP0-TEST-PLAN.md#wp0-10-03), [WP0-08-08](WP0-TEST-PLAN.md#wp0-08-08).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GIT-001

**GitLab repository integration — MVP-Core / M.** Purpose: Read a permitted self-hosted GitLab repository at an immutable commit.

**Reason:** WS reads a protected local bare Git mirror by immutable object identity; live GitLab API/token integration is Core.

**Owner/module:** Integration/release engineer; `gitlab-provider`. **Primary task:** [WP8-T01](IMPLEMENTATION-BACKLOG.md#wp8-t01).

**Prerequisites:** [PRJ-008](../FEATURE-CATALOG.md#prj-008)

**Acceptance AC-GIT-001:** A GitLab token needs read-only repository scope and cannot approve deployments.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-01](WP0-TEST-PLAN.md#wp0-08-01), [WP0-03-14](WP0-TEST-PLAN.md#wp0-03-14), [WP0-10-04](WP0-TEST-PLAN.md#wp0-10-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GIT-003

**Repository connection and test — WS / M.** Purpose: Bind provider/repository identity and check access without exposing token values.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `repository-binding`. **Primary task:** [WP3-T01](IMPLEMENTATION-BACKLOG.md#wp3-t01).

**Prerequisites:** [PRJ-008](../FEATURE-CATALOG.md#prj-008)

**Acceptance AC-GIT-003:** A repository test verifies the allowed project/folder and redacts authentication failures.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-01](WP0-TEST-PLAN.md#wp0-08-01), [WP0-03-14](WP0-TEST-PLAN.md#wp0-03-14), [WP0-10-04](WP0-TEST-PLAN.md#wp0-10-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GIT-006

**Commit and source provenance — WS / M.** Purpose: Record full repository and commit identity in each manifest/evidence bundle.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `git-reader`. **Primary task:** [WP3-T02](IMPLEMENTATION-BACKLOG.md#wp3-t02).

**Prerequisites:** [GIT-003](../FEATURE-CATALOG.md#git-003)

**Acceptance AC-GIT-006:** A release at a short ambiguous SHA is rejected until resolved fully.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-01](WP0-TEST-PLAN.md#wp0-08-01), [WP0-03-14](WP0-TEST-PLAN.md#wp0-03-14), [WP0-10-04](WP0-TEST-PLAN.md#wp0-10-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GIT-007

**Immutable release artifact retention — WS / M.** Purpose: Retain content-addressed bytes independent of Git server availability.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `artifact-store`. **Primary task:** [WP3-T04](IMPLEMENTATION-BACKLOG.md#wp3-t04).

**Prerequisites:** [MIG-008](../FEATURE-CATALOG.md#mig-008)

**Acceptance AC-GIT-007:** Approved deployment still validates stored bytes when Git is temporarily offline.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-01](WP0-TEST-PLAN.md#wp0-08-01), [WP0-03-14](WP0-TEST-PLAN.md#wp0-03-14), [WP0-10-04](WP0-TEST-PLAN.md#wp0-10-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GIT-016

**Protected source configuration — WS / M.** Purpose: Protect ingestion bindings and executable adapters from requester edits.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Artifact/planner engineer; `repository-binding`. **Primary task:** [WP3-T01](IMPLEMENTATION-BACKLOG.md#wp3-t01).

**Prerequisites:** [PRJ-008](../FEATURE-CATALOG.md#prj-008)

**Acceptance AC-GIT-016:** Changing repository/folder/runner image invalidates relevant approved intent.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-01](WP0-TEST-PLAN.md#wp0-08-01), [WP0-03-14](WP0-TEST-PLAN.md#wp0-03-14), [WP0-10-04](WP0-TEST-PLAN.md#wp0-10-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### GIT-018

**Offline Git mirrors and artifacts — MVP-Core / M.** Purpose: Support local GitLab, artifact retention and internal package mirrors with no SaaS dependency.

**Reason:** WS runtime has no SaaS dependency and WP0 tests offline feasibility. Supported offline mirrors/install/update procedures are Core.

**Owner/module:** Integration/release engineer; `offline-mirrors`. **Primary task:** [WP8-T04](IMPLEMENTATION-BACKLOG.md#wp8-t04).

**Prerequisites:** [PRJ-008](../FEATURE-CATALOG.md#prj-008)

**Acceptance AC-GIT-018:** End-to-end lab workflow functions with external internet egress disabled.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-08-01](WP0-TEST-PLAN.md#wp0-08-01), [WP0-03-14](WP0-TEST-PLAN.md#wp0-03-14), [WP0-10-04](WP0-TEST-PLAN.md#wp0-10-04).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-001

**Durable background job scheduling — WS / M.** Purpose: Persist admission/jobs in PostgreSQL and claim bounded work after restart.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `durable-jobs`. **Primary task:** [WP5-T03](IMPLEMENTATION-BACKLOG.md#wp5-t03).

**Prerequisites:** [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-001:** API restart retains queued jobs without creating duplicate SQL attempts.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-002

**Restricted execution workers — WS / M.** Purpose: Run approved jobs in a restricted worker process with scoped secrets.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `worker`. **Primary task:** [WP5-T03](IMPLEMENTATION-BACKLOG.md#wp5-t03).

**Prerequisites:** [OPS-001](../FEATURE-CATALOG.md#ops-001); [SEC-009](../FEATURE-CATALOG.md#sec-009)

**Acceptance AC-OPS-002:** Worker accepts only admitted jobs and cannot execute arbitrary submitted DSNs.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-003

**Execution queues and concurrency budgets — MVP-Core / M.** Purpose: Apply global/per-service/per-schema budgets independent of user count.

**Reason:** WS limits claims and connections statically and tests two contenders; configurable estate-wide budgets and the 500-schema profile are Core.

**Owner/module:** Runtime engineer + DBA; `capacity-budgets`. **Primary task:** [WP5-T06](IMPLEMENTATION-BACKLOG.md#wp5-t06).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-003:** 500 schemas do not open 500 idle writer connections at startup.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-005

**Execution state model — WS / M.** Purpose: Represent waiting, running, partial, unknown, verifying, verified, no-op and hold explicitly.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Domain/metadata engineer; `outcomes`. **Primary task:** [WP1-T04](IMPLEMENTATION-BACKLOG.md#wp1-t04).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-005:** Driver success with failed validity is never displayed as deployed success.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-006

**Structured execution logs — WS / M.** Purpose: Retain correlated release/plan/target/attempt/file/range logs with redaction.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Runtime engineer + DBA; `execution-logs`. **Primary task:** [WP5-T04](IMPLEMENTATION-BACKLOG.md#wp5-t04).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-006:** Auditor finds the failing statement without exposing secrets or query result rows.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-011

**Health and readiness checks — MVP-Core / M.** Purpose: Separate process liveness, metadata readiness and target availability.

**Reason:** WS commands report dependency errors directly. Orchestrator probes, degraded readiness and health endpoints are Core.

**Owner/module:** Integration/release engineer; `health`. **Primary task:** [WP8-T03](IMPLEMENTATION-BACKLOG.md#wp8-t03).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-011:** Oracle outage cannot trigger a liveness restart loop of the control plane.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-012

**Metadata and artifact backup/restore — MVP-Core / M.** Purpose: Back up approval/catalog/artifact/receipt records and restore into reconciliation hold.

**Reason:** WS retains artifacts in PostgreSQL and blocks declared restores. Supported backups and actual coordinated restore exercises are Core.

**Owner/module:** Recovery engineer + DBA; `restore`. **Primary task:** [WP6-T05](IMPLEMENTATION-BACKLOG.md#wp6-t05).

**Prerequisites:** [SEC-011](../FEATURE-CATALOG.md#sec-011); [GIT-007](../FEATURE-CATALOG.md#git-007)

**Acceptance AC-OPS-012:** Restore never dispatches queued jobs until target history agreement is re-established.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-09-03](WP0-TEST-PLAN.md#wp0-09-03).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-018

**Audit and log retention — MVP-Core / M.** Purpose: Retain required change evidence independently from disposable pod logs.

**Reason:** WS evidence survives worker process loss. Configurable retention, backup inclusion and deletion policy are Core.

**Owner/module:** Security/operations engineer + DBA; `retention`. **Primary task:** [WP9-T02](IMPLEMENTATION-BACKLOG.md#wp9-t02).

**Prerequisites:** [SEC-011](../FEATURE-CATALOG.md#sec-011)

**Acceptance AC-OPS-018:** Deleting a worker pod preserves SQL hashes, decisions and compiler evidence.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-019

**Graceful shutdown and drain — WS / M.** Purpose: Stop new claims, observe active calls and mark unresolved work for reconciliation.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Recovery engineer + DBA; `worker-drain`. **Primary task:** [WP6-T02](IMPLEMENTATION-BACKLOG.md#wp6-t02).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-019:** SIGTERM during DDL cannot produce a fabricated rolled-back success/failure.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-022

**On-prem Kubernetes/OpenShift packaging — MVP-Core / M.** Purpose: Define nonroot containers, PVCs, network policy and offline install instructions.

**Reason:** WS runs isolated local API/worker processes; supported Kubernetes/OpenShift deployment is Core.

**Owner/module:** Integration/release engineer; `packaging`. **Primary task:** [WP8-T03](IMPLEMENTATION-BACKLOG.md#wp8-t03).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-022:** A disposable OpenShift lab deploys without privileged SCC or external egress.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-023

**Air-gapped updates and SBOM — MVP-Core / M.** Purpose: Provide dependency pins, notices, SBOM, signed artifacts and offline upgrade bundle.

**Reason:** Exact WP0/WS dependency rights and hashes are hard gates. Signed distributable offline installation/update bundles are Core.

**Owner/module:** Integration/release engineer; `offline-release`. **Primary task:** [WP8-T04](IMPLEMENTATION-BACKLOG.md#wp8-t04).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-023:** An offline install can verify every required artifact hash and license record.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-025

**Operational recovery case management — WS / M.** Purpose: Track hold reason, assigned DBA, evidence, decisions and approved recovery attempts.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Recovery engineer + DBA; `recovery`. **Primary task:** [WP6-T02](IMPLEMENTATION-BACKLOG.md#wp6-t02).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-025:** Unknown outcomes remain assigned/open until an auditable terminal resolution.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### OPS-026

**Capacity acceptance workload — MVP-Core / M.** Purpose: Measure inventory and safe queue behavior at 50 services/500 schemas/20 users.

**Reason:** The initial functional fixture is one service/two schemas; the required 50-service/500-schema/20-user capacity acceptance is Core before estate rollout.

**Owner/module:** Security/operations engineer + DBA; `capacity-acceptance`. **Primary task:** [WP9-T03](IMPLEMENTATION-BACKLOG.md#wp9-t03).

**Prerequisites:** [SEC-009](../FEATURE-CATALOG.md#sec-009); [MIG-018](../FEATURE-CATALOG.md#mig-018)

**Acceptance AC-OPS-026:** Under that lab scale, one-schema serialization holds and inventory p95 meets agreed budget.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-06-04](WP0-TEST-PLAN.md#wp0-06-04), [WP0-07-07](WP0-TEST-PLAN.md#wp0-07-07), [WP0-10-05](WP0-TEST-PLAN.md#wp0-10-05).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### EXT-008

**Justification and risk acknowledgement — WS / M.** Purpose: Require purpose, expected effect and recovery notes for destructive changes.

**Reason:** Required for one of the sixteen WS outcomes or its authorization, byte-integrity, target-identity, audit or failure-safety prerequisite; implement a CLI/API facet without a portal.

**Owner/module:** Identity/governance engineer; `risk-acknowledgement`. **Primary task:** [WP4-T03](IMPLEMENTATION-BACKLOG.md#wp4-t03).

**Prerequisites:** [MIG-001](../FEATURE-CATALOG.md#mig-001); [SEC-005](../FEATURE-CATALOG.md#sec-005)

**Acceptance AC-EXT-008:** A destructive plan lacks admission until explicit reviewer acknowledgement is recorded.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-05-04](WP0-TEST-PLAN.md#wp0-05-04), [WP0-08-07](WP0-TEST-PLAN.md#wp0-08-07).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.

### EXT-010

**Independent Oracle outcome panel — MVP-Extended / M.** Purpose: Show execution, commit knowledge, ledger and object validity as distinct fields.

**Reason:** WS CLI/API already exposes four outcome fields. A dedicated outcome panel is a presentation enhancement.

**Owner/module:** API/CLI engineer; `outcome-view`. **Primary task:** [WP7-T04](IMPLEMENTATION-BACKLOG.md#wp7-t04).

**Prerequisites:** [SQL-019](../FEATURE-CATALOG.md#sql-019); [MIG-026](../FEATURE-CATALOG.md#mig-026)

**Acceptance AC-EXT-010:** A DONE/INVALID case displays verification failure and blocks promotion.

**Negative/traceability tests:** enforce current named actor/project/schema permissions and byte/target/state integrity; denied attempts produce no migration calls and retain sanitized audit. Related WP0 fixtures: [WP0-05-04](WP0-TEST-PLAN.md#wp0-05-04), [WP0-08-07](WP0-TEST-PLAN.md#wp0-08-07).

## Sequencing and estimates

Implement task prerequisites, not whole work packages in numeric order. Metadata/auth foundations precede profiles; target bootstrap/reader precedes pending planning; exact plan precedes approval; approved admission and target lock precede execution; recovery/verification precede WS integrated acceptance. After actual WS integration (WP7-T03) and the WS security/evidence gate (WP9-T06), Core environment/provider/security/deployment work proceeds; optional views/export follow Core operating gates.

Package estimates in [backlog](IMPLEMENTATION-BACKLOG.md) total 30–46 engineer-weeks for WS **including** WP0, another 40–60 for Core, another 12–20 for Extended; full refined MVP 82–126. The reduction from 110–170 reflects CLI-first delivery and removal of broad UI from the early path, not proof that new runtime software became simpler. Parser failure, incompatible estate authentication or actual recovery faults reopen estimates/ADRs. No full mature-engine cost saving is assumed before WP0 evidence.
