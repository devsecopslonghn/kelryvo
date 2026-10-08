# Implementation readiness review

8 October 2026. Planning only. Review inputs are the original [research index](../README.md), all fifteen research Markdown files, the complete 220-entry [catalog](../feature-catalog.json), schema, evidence registers and validation reports. Their original hashes are retained in [implementation plan](implementation-plan.json). No original catalog ID, classification, acceptance criterion, roadmap or evidence file is changed.

**Decision: CONDITIONAL GO for WP0 preflight and feasibility work in a subsequent implementation session. NO-GO for a production platform or production rollout.** The research supports a coherent specification; it does not prove the proposed runtime. Walking Skeleton implementation is conditional on an accepted WP0 decision and separate implementation scope. Lab availability, grants, actual dependency closure and estate compatibility are UNKNOWN until preflight; no database survey was performed in this planning turn.

## Area decisions

READY means sufficient specification/evidence to implement a bounded design task; it does not mean working software. CONDITIONAL means a stated prerequisite must hold. NEEDS_POC requires observed technical experiments. BLOCKED names an unmet release gate, rather than claiming an unavailable lab has already been tested.

| Area | Decision | Evidence and finding | Gate / implementation owner |
|---|---|---|---|
| Catalog identity and coverage | READY | 220 IDs, nine domains, explicit proposed/source/runtime distinctions and consistent JSON/Markdown; prior artifact validator passes | Preserve IDs; domain engineer maintains traceability |
| MVP decomposition | CONDITIONAL | 95 atomic requirements include safety invariants, presentation and estate operations in one release | Approve the additive 74/17/4 stage overlay, not a silent original-roadmap rewrite |
| Feature dependency graph | CONDITIONAL | Existing graph is acyclic and phase-closed; many rows use shared generic prerequisites | New task DAG must resolve ledger-before-planning and auth-before-profiles; metadata/domain engineer |
| Physical Oracle resource hierarchy | CONDITIONAL | Container/schema/route separation and one active assignment are specified; BB-ORACLE-USERS supports owner discovery, not PDB identity proof | WP0-02 and DBA attestation; inventory engineer |
| Git/release/checksum model | READY | Independent byte/manifest/commit identities; mature-engine checksum/order references; changed Bytebase checksum behavior is bounded to historical evidence | Golden canonical/version vectors and complete release prevalidation; artifact engineer |
| Approval/authorization specification | CONDITIONAL | Intent/contributor/expiry/revocation checks are specified; no implemented server or race evidence exists | WP0-08 then actual platform bypass/race regression; governance engineer |
| Node/Fastify and official Thin driver | NEEDS_POC | NODE-LICENSE/NODE-VERSION and Thin documentation prove candidate source/driver mode, not estate compatibility | WP0-01/10; runtime engineer and DBA |
| Mature parser-only adapter | NEEDS_POC | FW-PARSER/FW-L show an Apache parser mechanism; standalone adapter/API stability is unproved | WP0-T02/T03; no custom grammar fallback |
| Same-session target mutex | NEEDS_POC | Oracle DBMS_LOCK documentation supports session locks across commit; restricted package and alias routing are unimplemented | WP0-06; DBA grants, allocation semantics and actual session probes |
| Hybrid history/crash consistency | NEEDS_POC | Mature histories and documented Oracle commits motivate it; two-store commit gaps are explicitly acknowledged | WP0-07/09; runtime/recovery engineer |
| Object/postcondition validity | NEEDS_POC | Historical DONE/INVALID case and USER_ERRORS documentation show why a separate gate matters | WP0-05 on correct owner/type and independent observer; verification engineer |
| Minimal API/CLI | READY | Sixteen WS outcomes can be exercised without a portal; proposed API resources exist only as design | Implement module adapters after accepted runtime gates; API engineer |
| React portal | CONDITIONAL | Fourteen source-informed screen contracts exist; no portal is required for WS | Defer; select after CLI/API workflow and user needs are observed |
| Kubernetes/OpenShift operation | CONDITIONAL | Restricted deployment/secret/backup requirements are specified, not cluster-tested | Core disposable-cluster TLS, random UID, egress, backup and restore acceptance |
| Required OSS dependency rights | CONDITIONAL | Pinned candidate source grants reviewed; package/transitive/JRE/base-image closure is absent | WP0-10-01 before candidate selection; release/license maintainer |
| Production readiness | BLOCKED | No new executor, integrated platform tests, exact supported profile, security audit, physical restore or capacity evidence | Core exit review WP9-T05 plus later explicit production deployment authorization |

Source keys resolve in [feature evidence](../evidence/feature-evidence.md). [Research limitations](../evidence/research-limitations.md) distinguish retained historical runtime from this unimplemented platform. No additional feature discovery or current-upstream survey was repeated.

## Critical findings and proposed resolutions

| Review ID | Location / issue | Consequence | Proposed resolution in this planning overlay |
|---|---|---|---|
| RR-01 | Runtime calls the parser helper optional; ADR-003 makes a mature splitter a mandatory correctness gate | “Optional” can be misread as permission to run unsplit scripts or a naive splitter | A mature Oracle parser/runner capability is mandatory. The separate JVM process is one conditional packaging option; see ADR-I03 |
| RR-02 | Original roadmap WP4 planning precedes WP6 runtime/ledger; planning requires MIG-025 actual target history | Implementing whole packages numerically creates a dependency dead end | Bootstrap/read-only ledger adapter WP5-T01 precedes WP3-T05; execution WP5-T03/T04 follows approval. Task DAG is authoritative |
| RR-03 | Most generic catalog prerequisites do not name exact artifacts/modules, although the graph passes validation | A valid feature graph is not an executable build order | Map every MVP ID to owner/module/primary task and add task edges without altering source IDs |
| RR-04 | Shared generic authorization/evidence acceptance accompanies the unique criterion on all 95 MVP records | It lacks a fixture, actor, failure mode and evidence oracle | Preserve it and add AC-ID, negative actor/target case, applicable WP0 regression and actual integration test at the owning task |
| RR-05 | Resource model says local history retains project-at-execution; runtime history field list omits it | Transfer/restore audit could lose the original project | DATA-CONTRACTS makes project/assignment-at-execution immutable receipt fields; target UUID references are not cross-database SQL FKs |
| RR-06 | Runtime recovery uses ADOPTED_AFTER_VERIFICATION while the proposed history table lists only APPLIED/BASELINED | A reconciled adopted version could be planned as pending or recorded as fake execution | Propose a distinct approved adoption history disposition in Core; planner must recognize it only with linked recovery authority. WS keeps unsupported adoption held |
| RR-07 | Original success wording spans file checks, receipt commit and release-wide observer checks | A local APPLIED file could be displayed as a verified release before postchecks/central evidence | Separate execution, commit knowledge, receipt disposition and verification; local APPLIED never alone means run VERIFIED_SUCCESS |
| RR-08 | Original numeric tuple and canonical JSON descriptions leave trailing-zero versions, encoding/ranges and large-number serialization open | Languages can disagree about order/digest | Specify V1 and V1.0 as distinct tuples, arbitrary-precision decimal components, RFC-8785-compatible restricted string-number envelope and UTF-8 byte-exclusive ranges |
| RR-09 | Original runtime binds credential logical scope but does not state whether credential-version rotation changes approved intent | Rotation could change principal/session settings without visible plan revision | Bind profile/scope/principal and credential-reference revision, excluding secret bytes; a revision change requires new intent |
| RR-10 | MVP promotion is required although configurable windows are V1; resource rules mention an allowed window | Scheduling could become an accidental dependency | WS has only DEV/manual admission. Core has fixed current deployment policy; configurable windows/scheduling stay V1 and cannot bypass policy |
| RR-11 | Original 95-row pilot gate and broad UI package assume one combined MVP release | A CLI skeleton can be blocked by presentation before feasibility is proved | Add WS/Core/Extended milestones. A refined Core exit covers 91 required IDs; full original 95-row completion still requires all four Extended records |
| RR-12 | Same PDB may contain different projects, while environment is container-authoritative | Placing A=DEV/B=PROD in one PDB would contradict the physical environment rule | The WS fixture has two projects in the same DEV container. Core promotion uses separate environment containers |
| RR-13 | Original work packages and this implementation backlog reuse WP1–WP9 numbers for different boundaries | A later session could execute the wrong “WP5” | Refer to implementation task IDs plus this directory; explicit package crosswalk in IMPLEMENTATION-BACKLOG |
| RR-14 | Required filesystem/JVM/Git/driver package closure and long-term maintenance are not actual release artifacts | Source license labels cannot establish an all-OSS distributable | Exact package contents, notices, optional native pieces and offline build evidence remain hard WP0 gates |

These are clarifications or proposed changes, not corrections to historical source observations. In particular, an all-contributor exclusion is proposed stronger governance; source declaration evidence for Bytebase's settings is not proof it implements this exact rule.

## Duplication and implementation grouping

| Capability group | Existing IDs | Review decision |
|---|---|---|
| Source identity/intake | PRJ-008, MIG-006/007, GIT-003/006/016 | One repository-binding/reader module with distinct authorizations/provenance assertions |
| Bytes and immutability | MIG-008/009/013, GOV-012/013, GIT-007 | One artifact/canonical-intent subsystem; raw-byte and statement/intent digests remain distinct |
| Independent approval | PRJ-004, GOV-002/006/007/018, SEC-005/008/014 | One authorization/admission pipeline; each denial is an independently testable invariant |
| Target identity and exclusion | DBM-019/022/023, MIG-019 | One topology identity service plus target lock adapter; metadata dedup is not connection-pool credential sharing |
| Oracle parsing/validity | SQL-016–020, MIG-027/031 | Parser, executor, verifier and diagnostics adapters; no single “SQL success” boolean |
| History/recovery | MIG-011/017/020/025/026/034, OPS-005/012/025 | Shared recovery kernel with separate local receipt/central authority/restore operations |
| Logs/evidence | SEC-011/013, OPS-006/018, GOV-023 | Retained records are WS; portable export/retention/administrative presentation have later exits |
| Promotion/continuation | MIG-021, GOV-022 | One server-enforced Core promotion rule; GitLab/Jenkins callbacks remain later adapters |
| Outcome presentation | OPS-005, EXT-010 | Canonical states are WS; dedicated panel is Extended |

Do not merge or delete these feature IDs now. They are useful regression/contract identifiers. Build shared modules and tests rather than treating each row as a separate service, screen or estimate. Proposed split facets include seed/local CLI authentication versus browser session management, durable evidence versus export, initial schema assignment versus historical transfer UX, and fault HOLD versus general baseline/adoption tooling. Their release boundaries are explicit in [MVP refinement](MVP-REFINEMENT.md).

## MVP audit conclusion

Every original MVP entry now has a purpose, original prerequisite chain, proposed module/owner, primary task, acceptance identifier, original unique acceptance and regression case mapping in [MVP refinement](MVP-REFINEMENT.md) and [machine plan](implementation-plan.json). The WS subset is closed over original feature prerequisites; the task DAG adds operational dependencies and is separately validated. Features with broader future scenarios retain those scenarios rather than claiming all catalog functionality is already implemented.

The largest missing proof is the driver/parser/lock/receipt combination. The immediate executable task is **WP0-T01**. It performs a secret-free preflight without Oracle calls. If required runtime inputs are absent, offline fixture/license work may proceed where independently useful, but runtime gates remain NOT_RUN/BLOCKED and the next implementation must not begin WP1.
