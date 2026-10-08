# Architecture decisions for implementation

8 October 2026. These ADRs review the original [technology decisions](../TECHNOLOGY-DECISIONS.md) rather than ratifying them. READY applies to a design boundary, not working software. All production integrations remain NOT_TESTED. Source keys refer to [existing evidence](../evidence/feature-evidence.md); no new product survey was performed.

## ADR-I01 — Modular control plane with a restricted independent worker

**Status: CONDITIONAL; boundary accepted, implementation not started.** Inventory, permissions, releases, plans, approvals and audit need relational consistency at the initial scale; microservices add synchronization and offline operating cost. Required features include PRJ-001/004/011, GOV-001/002/018, SEC-005/009/011, OPS-001/002.

Use a modular monolith for the governance control plane. Run the executor in a separate process/deployment with the same versioned domain contracts and only admitted jobs. The API can resolve discovery references and read approved evidence, but cannot read application writer secrets. The worker resolves one admitted target credential and verifies database identity before writes. Bootstrap is a separately authorized DBA operation, not an API grant escalation.

Planning reads target history through an authenticated worker read job and a narrowly granted read-only observer profile. Missing ledger/catalog visibility blocks a plan; the API never obtains owner credentials to compensate. Acceptance must cover both successful scoped reads and denied writer-secret access.

Alternatives are an in-API executor, per-job Kubernetes workers and full microservices. The in-API executor weakens credential/process isolation; Jobs still need durable admission/orphan-session reconciliation; microservices need a demonstrated scaling/security reason. WS uses separate local processes and loopback-only API; Core proves restricted cluster identities/egress. An independent worker may use another language. This boundary does not require one language for the whole platform.

**Evidence:** original resource/runtime contracts and Oracle lock/commit documentation; the isolation benefit is a design inference. **Risks:** worker impersonation, overbroad secret access, stale job generations and unknown sessions. **License:** original code plus audited OSS dependencies; no Bytebase source reuse. **Before implementation acceptance:** WP0-06/07/10, then actual platform API-to-worker negative tests and Core cluster restrictions.

## ADR-I02 — Backend, frontend and metadata choices

| Component | Why / requirements | Alternatives | Operational and license risk | Evidence / proof gate |
|---|---|---|---|---|
| TypeScript/Fastify control plane | Typed contracts, modular API, retained immutable intent; GOV/SEC/GIT modules | Python/FastAPI/Django or Java/Spring; Go HTTP stack | Team skills UNKNOWN; framework validation is not authorization; exact package closure unreviewed | TECH-FASTIFY and original comparison; choose maintained pins/toolchain, measure development spike and test server boundaries |
| PostgreSQL metadata/jobs/blobs | Relational org/project FKs, transactional admission/outbox and retained artifacts; OPS-001, SEC-011 | Other transactional relational database; SQLite for pure unit fixtures only; external queue later | Two-store Oracle commit gap remains; artifact growth, backups and queue polling; audited distribution required | TECH-POSTGRES; prove unique active admission/claim generation, restart persistence and backup/artifact continuity |
| React/TypeScript UI | Original English accessible screens for later operators; UX map | CLI/API first, small server-rendered UI, alternative maintained frontend | Portal can dominate early effort; XSS/SQL visibility and asset licenses | Existing UX contracts establish design only; defer from WP0/WS, select when workflow is functional |
| Kubernetes/OpenShift | Required on-prem multi-user operation and secret isolation; OPS-022 | Local processes for WS, portable containers for harness | Random UID, secret/network policies, offline images and dependency readiness; distribution-specific packages | Original deployment requirements; actual disposable-cluster Core acceptance before estate use |

**Status:** PostgreSQL/modular typed API are READY as proposed contracts; exact backend pins are CONDITIONAL. React is DEFERRED from WS. Cluster delivery is CONDITIONAL for Core. Framework/language selections may change after WP0 and team capability review without changing target/intent/receipt contracts. The lower effort estimate assumes CLI-first delivery, not demonstrated team velocity.

## ADR-I03 — Select execution architecture from observed parser/driver results

**Status: NEEDS_POC. No engine architecture is finally selected.** Compare the actual assessed candidates below. No reviewed candidate's history table makes arbitrary Oracle DDL atomic with central governance.

| Criterion | A: original Node executor/coordinator | B: mature full OSS engine integration | C: governance plane + independent worker using mature parser/runner |
|---|---|---|---|
| Oracle client | Official node-oracledb Thin candidate; estate profile untested | Flyway/Liquibase normal Oracle route needs separately licensed JDBC; Sqitch Oracle route uses SQL*Plus/client | Node/Python official Thin or reviewed FOSS alternative; worker language independent |
| SQL/PLSQL handling | Must integrate a mature legally usable splitter; original grammar is excluded | Flyway Oracle parser mature; Liquibase raw SQL/changelog split options; Sqitch authoring differs | Mature parser/runner isolated behind pinned statement contract; candidate JVM helper internal API unproved |
| Ordering/checksums | Own numeric tuple/raw SHA-256/manifest rules, so maintenance/testing belongs to us | Native identity/checksum semantics differ; wrapper must additionally enforce approved raw-byte digest and exact pending set | Control plane owns immutable source identity; worker implements accepted contract or translates one engine's native history |
| Locking | Same-session DDL-safe mutex plus central admission needed | Engine-specific lock/history cannot be assumed DDL/crash/alias-safe without testing | Worker owns target mutex on actual execution session; no control-plane lease pretends to fence Oracle |
| Recovery | Independently owned partial/unknown/HOLD logic | Engine repair/retry/rollback commands may violate approved intent; must disable uncontrolled routes | Separate observed receipts/recovery protocol; explicit authority and no blind replay |
| Extension | Narrow capability adapters; original ledger semantics maintained | Rich native callbacks/preconditions, but tight engine semantics/version/client constraints | Typed capability/receipt interface; changing worker language cannot weaken safety invariants |
| Required OSS rights | Driver source candidate permissive; full package closure still needs audit | Flyway 13.9.0 public Apache, Liquibase 4.33.0 historical Apache, Sqitch MIT; client/binary rights separate; current Liquibase FSL excluded | Audit parser/helper/JRE/client closure; process separation does not waive license obligations |
| Maintenance | Greatest new executor/ledger responsibility; no claim of inherited mature-engine safety | Smaller native engine surface to own but pin/edition/patch/adapter maintenance remains | Adds boundary/packaging regression; runtime ownership remains explicit and independently maintained |

**Evidence:** FW-ORA/PARSER/EXEC/FAIL/CHECKSUM, LB4-STATE/EXEC/SKIP/CHECKSUM, SQ-STATE/EVENTS/SQLPLUS, NODE-LICENSE/VERSION and existing driver-mode documentation. Full-engine suitability is bounded to these reviewed paths; this is not proof no other OSS option could ever satisfy the requirements.

**Proposed decision:** start WP0 with C's boundary and Node Thin candidate, assessing a driver-free Apache Flyway parser helper before executing scripts. The control-plane language is not a reason to reject a Python/Go/Java worker. A is acceptable only with a demonstrated mature splitter; B can be chosen only if its complete required dependency/client path satisfies the original OSS requirement and immutable-plan/ledger/recovery tests. Do not silently permit a proprietary JDBC/Instant Client exception, old unsupported engine or commercial parser feature.

**Stop/reopen:** parser isolation fails, required artifact rights are UNKNOWN, required authentication/transport cannot be met, or exact execution bytes/receipts/locks cannot be demonstrated. Do not implement semicolon/regex splitting, a new Oracle grammar, opaque SQL*Plus shell execution or a second competing ledger as a fallback. Compare reviewed legal alternatives and record an ADR revision with real results.

**Implementation proof:** WP0-T02/T03/T04/T06/T08/T10/T11. A parser-only JVM is a packaging proposal, not a supported public Flyway parser API. Freeze its exact source/dependency hashes and own internal API compatibility tests before adopting it. If a full engine is selected, use one authoritative local applied-history interpretation, supplement its metadata with raw-hash attestations as needed, and retest pending-set/race/receipt gaps; do not run both engines against the same stream.

## ADR-I04 — Hybrid history with explicit adoption and restore fences

**Status: NEEDS_POC; recommended authority split is retained.** Local history records observed applied versions/digests within a target generation. Central metadata authorizes plans/admissions, retains original bytes and decisions, and holds uncertain work. Neither store alone proves a successful authorized deployment. The [data contracts](DATA-CONTRACTS.md) define disagreement outcomes.

Target-only history lacks approval/audit authority and is editable/restorable by target owners/DBAs. Central-only history has a commit/result gap and cannot treat missing revisions as safe pending work. Hybrid adds reconciliation and operational ownership without claiming distributed exactly-once. Simple ordinary DML may share target data and receipt commit only under an explicitly proven transaction profile; arbitrary PL/SQL/DDL cannot.

**Proposal:** local APPLIED, BASELINED and Core ADOPTED_AFTER_VERIFICATION dispositions remain distinct. An adoption references independent recovery authority and original expected effects/digests; it never claims a missing execution occurred. WS supports receipt-based central reconstruction and proven-no-effect new attempts; uncertain adoption/correction stays held until Core procedure support.

**Risks:** both-store restore, hostile DBA/manual edits, missing artifacts and fake authorization. Core requires an external restore/generation witness and operator restore declaration, not reliance only on metadata restored from the same backup. Arbitrary undeclared/coordinated DBA rewinds are outside an advisory lock's protection and cannot be magically detected. **Proof:** WP0-07/09, followed by actual Core backup/Oracle restore tests; logical rewind injection is insufficient for the latter. License consequences are own original metadata/bootstrap code and approved target Oracle rights, not Oracle pack entitlements.

## ADR-I05 — Approval binds exact bytes, route and current authority

**Status: CONDITIONAL; normative contract accepted for WP0.** Commit, release, stream/version, target generation, plan and attempt are different identities. Bind raw and execution digests, parser profile, ordered per-target pending items, history snapshot, endpoint/profile/credential-reference revisions, assignment/policy, checks, contributors, expiry and predecessor requirements. Secret bytes never enter the digest.

At admission and under target mutex, recheck current eligibility/permission/revocation/history. Any changed history requires a fresh plan even if pending shrinks. Reject caller-supplied actor identities; preserve all authenticated substantive contributors to the current intent. Git author text is provenance, not authentication. A role grant/admin privilege is not an independent approval decision.

Alternatives are mutable branch pointers, approval by ticket ID or broad CI approval. They cannot establish exact target/byte authority. **Risks:** race between recheck and a call, already-running effects after revocation, alternate APIs and credential-version change. Commit each exact statement's dispatch permit in a transaction serialized with current authority updates. Revocation before that checkpoint denies the call; after it, the permitted call is treated as in flight and subsequent permits stop. The [dispatch contract](DATA-CONTRACTS.md) retains the non-atomic PostgreSQL/Oracle gap and cancelled/unknown effects without rollback promises. **Proof:** WP0-08 and integrated server/worker tests, including barriers on both sides of the checkpoint; exact canonical vectors are prerequisite to approval, not postimplementation cleanup.

## ADR-I06 — DEV-only WS, then Core estate and explicit deferred work

**Status: READY as a scope proposal, subject to acceptance of this plan.** WS uses one attested DEV PDB/service with A/B schemas assigned to separate projects and seeded named independent actors, a protected local Git mirror, PostgreSQL metadata and separate loopback API/worker processes. It exposes no remote browser login, general query console, arbitrary DSN, nonempty-schema baseline, promotion or restore/adoption shortcut. Omitted endpoints must fail closed.

Core adds multi-user session lifecycle/HTTPS, actual GitLab provider, multi-environment promotion, supported baseline/correction/restore, configured budgets, offline cluster deployment and the required 50/500/20 acceptance. Extended adds estate/resubmission/outcome views and portable evidence export. Four original MVP IDs are presentation/export deferrals; immutable evidence, diagnostic facts and approval integrity remain WS prerequisites.

Do not replace the original catalog with these stages. V1/V2/REJECTED scope is unchanged. Removed from the immediate execution path: production portal, additional database engines, declarative migrations, SQL editor, scheduling, paid Oracle adapters and automatic rollback/recovery. This preserves the free/open-source/English/on-prem product vision without claiming production readiness for a lab skeleton.
