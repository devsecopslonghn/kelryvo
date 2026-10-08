# Technology decisions

Research recommendations, **DESIGN_PROPOSAL**, 8 October 2026. Decisions are proposed for an independently maintained Apache-2.0 platform. No platform dependencies were installed and no platform code was written. A temporary JSON Schema checker is used only to verify research artifacts. Exact evidence pins are in [source manifest](evidence/source-manifest.md), [source references](evidence/source-references.json) and [license assessment](LICENSE-COMPLIANCE.md).

## ADR-001 — Modular monolith with a restricted worker

**Status:** Proposed. **Context:** Fifty services and twenty users do not justify independently deployed services for inventory, approvals, artifacts and audit. Oracle calls can block, survive API restarts and require credentials the API must not have.

**Decision:** One repository/codebase with modules for identity, inventory, project access, artifact ingestion, planning, approval, admission, Oracle execution, verification, recovery and audit. Deploy API and worker separately for privilege/process isolation, using the same versioned domain contract and PostgreSQL metadata. Use PostgreSQL jobs/outbox initially. A local parser helper has no network API or authorization role.

**Alternatives:** Single API process executing SQL simplifies packaging but couples availability to long database calls and exposes writer secrets. Microservices add distributed policy/state failures, extra databases and offline upgrade complexity. Kubernetes Jobs per migration may be useful later for stronger isolation but require job reconciliation and orphan-session handling; restarting a Job is not safe SQL replay.

**Consequences:** Clear module ownership and transactional admission; worker replicas still need DDL-safe target locks. Default MVP may have one worker; failover must remain HOLD-aware even before automatic HA is added. Split modules only after measurable security, isolation or scaling needs.

## ADR-002 — Backend and Oracle driver selection

| Candidate | Advantages | Costs and Oracle boundary | Disposition |
|---|---|---|---|
| TypeScript / Fastify / node-oracledb Thin | Official maintained OSS Oracle protocol driver; no Instant Client required; one primary language with UI; structured API validation | Thin transport/authentication differs from Thick; lacks a drop-in mature versioned migration engine for this contract | Preferred conditional on Oracle driver/parser spike |
| Python / FastAPI or Django / python-oracledb Thin | Official OSS Thin driver; rapid API and DBA tooling; Archery source provides useful patterns | Separate frontend/backend language; mature migrations for application metadata do not solve this Oracle release runtime | Strong reserve if team Python experience exceeds TypeScript |
| Java 21 / Spring Boot / Flyway | Mature versioned migration/parser/history integration; typed Oracle ecosystem | Standard Oracle execution needs separately licensed JDBC binary; fails the requested all-OSS required client path | Optional adapter if user later accepts driver exception; not default |
| Go / HTTP framework / go-ora | Small deployable, pure Go MIT Oracle client, straightforward bounded workers | Smaller vendor support surface; dialect splitter/ledger coordination still needed; driver correctness needs the same lab gates | Reserve after official Thin driver comparison |
| Rust / SQL libraries | Strong ownership and concurrency model | No equivalently established reviewed Oracle path in this evidence pack | Defer |

**Decision:** TypeScript strict mode with a maintained Node LTS and Fastify; explicit `oracledb` Thin mode. Investigated stable driver **7.0.1**, commit `80c54f80ded26fe3013244c275a2cfce38439d69`; recheck security/support before implementation. Pin the dependency closure and worker image, not `latest`. The source grant is Apache-2.0 OR UPL-1.0 [NODE-LICENSE, NODE-VERSION]. [Official introduction](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html) documents direct Thin connectivity; [mode comparison](https://node-oracledb.readthedocs.io/en/latest/user_guide/appendix_a.html) documents important limitations.

**Consequences:** Require tested TCPS, owner credentials and dictionary grants. Thin homogeneous pools must be credential-specific. Native Network Encryption, Kerberos and external authentication cannot be silently assumed; if the estate requires them and cannot use TCPS, this decision needs reopening. Go go-ora may be compared as a FOSS alternative; switching to proprietary Thick/JDBC is a product requirement change. JavaScript number limits require decimal/big-integer-safe handling for Oracle identifiers/numbers and version tuples. The platform source can be FOSS while Oracle Database itself remains the existing separately licensed target.

## ADR-003 — Assess mature engines before owning execution

| Engine | Version/source rights inspected | Useful native mechanisms | Mismatch with strict default path |
|---|---|---|---|
| Flyway | **13.9.0**, `a549f5dd…`, public Apache-2.0 core/Oracle module | Folder resolution, numeric versions, target history, checksums, repeatables, callbacks, mature Oracle parser | JDBC distribution is separate; SQL*Plus emulation/dry run/advanced recovery are not assumed Community; no whole Oracle DDL atomicity |
| Liquibase | **4.33.0**, `75773ed9…`, Apache source; current inspected 5.x FSL | Changeset identity/checksums, lock table, preconditions, rollback descriptions, update SQL | Plain V-files need changelog/changeset conversion; JDBC rights separate; old OSS line needs sustainable patch ownership; 5.x not strict OSS |
| Sqitch | `b08e5c8…`, MIT | Plan/dependency graph, deploy/verify/revert scripts, target registry, integrity checks | Authoring differs from folder version contract; Oracle SQL*Plus/client dependency is separate; revert scripts cannot undo arbitrary committed effects |
| Atlas | `1317a576…`, Apache public core | Desired-state inspection/diff and migration checks | Oracle driver Pro; cannot provide required Oracle core |
| Native ODC/Archery execution | Apache source snapshots | Tickets, approval and Oracle statement execution | Ticket batches do not supply this release/checksum/reconciliation contract; replacing their executor would create a platform fork |

Source mechanisms: [FW-EXEC/FW-FAIL/FW-CHECKSUM/FW-PARSER](evidence/feature-evidence.md), [LB4-STATE/LB4-EXEC/LB4-SKIP](evidence/feature-evidence.md), [SQ-STATE/SQ-EVENTS/SQ-INTEGRITY](evidence/feature-evidence.md). [Flyway Oracle documentation](https://documentation.red-gate.com/flyway/reference/database-driver-reference/oracle-database) distinguishes ordinary PL/SQL/slash syntax from Teams SQL*Plus commands. [Liquibase announcement](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl) and [Atlas compatibility](https://www.atlasgo.io/features) establish current licensing boundaries.

**Decision:** No reviewed mature engine simultaneously provides the required Oracle release semantics and a default execution path free of required proprietary clients. Independently implement the narrow release/admission/hybrid-ledger coordinator; do not implement an Oracle grammar. First validate use of Flyway's Apache Oracle parser through a small **parser-only JVM helper**, communicating ordered statement bytes/ranges over stdin/stdout with the TypeScript worker. No JDBC connection or proprietary driver is necessary for the intended parsing boundary. This is an integration proposal, **NOT_TESTED**, and not a supported public Flyway API claim.

**Consequences:** Internal parser API churn and JVM packaging are real costs. Confirm parser configuration can be isolated without optional commercial components, produces correct byte ranges, rejects unsupported directives and is reproducibly distributable. Fail the first milestone if this boundary cannot pass. Reopen with another mature permissive Oracle splitter or a reviewed adapter contract; never fall back silently to a custom semicolon parser. Reusing full GPL DbGate plugin code requires a different licensing assessment. A new coordinator is substantial engineering, already counted in estimates; describing it as a thin wrapper would hide risk.

An optional Flyway JVM executor can later own its own target ledger in a separate adapter profile, if the user explicitly accepts the JDBC dependency exception. Do not write into `flyway_schema_history` manually or run both engines on the same stream. Imported historical Flyway/Liquibase records require explicit approved baseline/reconciliation. No automatic engine switch on a live schema.

## ADR-004 — Hybrid ledger, immutable intent and no automatic uncertain replay

**Decision:** Central PostgreSQL governs permissions/approval/admission; target tables govern recorded applied versions. Plan approval binds all SQL, targets, history preconditions, execution/parser settings and required checks. Use a session-scoped target lock through a restricted DBMS_LOCK cover package. Every ambiguous effect blocks promotion and creates a recovery case.

**Consequences:** Requires DBA-controlled bootstrap and ledger privileges. Target owners/DBAs are not prevented cryptographically from changing their own database; independent central evidence detects disagreement. Central and target commits remain separate. See [runtime architecture](MIGRATION-RUNTIME-ARCHITECTURE.md) for commit ordering and crash matrix, and [Oracle transaction semantics](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html).

## ADR-005 — Metadata, jobs and artifacts

**Decision:** PostgreSQL for metadata, transactional outbox and bounded durable jobs. Model state transitions and unique active admissions explicitly; use SKIP LOCKED for queue consumers [PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.html). LISTEN/NOTIFY is a wake-up hint, not durable delivery. MVP stores bounded release blobs/evidence in PostgreSQL with per-object digests; an existing approved internal object store can be an adapter later.

**Alternatives:** SQLite limits multi-replica transactional operation; MongoDB adds no clear value for relational authorization and history; Redis queues add a required service and restore consistency problem. Temporal/Flowable provide rich durable workflows but cannot atomically commit Oracle DDL with approval metadata; their service/version/license burden is not justified initially. An in-process state machine backed by metadata transitions covers the focused workflow.

**Consequences:** Artifact retention growth must be measured; estimate daily release bytes × retention plus logs, not just 500 schemas. A default 20 MiB release budget is configurable. Data and artifacts restore together; restore mode blocks admissions until reconciliation. PostgreSQL major/minor pin and backup implementation must match the organization's supported on-prem distribution.

## ADR-006 — Frontend, APIs and Git

**Decision:** Independent React + TypeScript UI, accessible generic component library selected by license audit, English default with externalized strings. Vite build; OpenAPI-described REST and server-sent events for progress. Use server authorization for each resource/action. No vendor icons, CSS, screenshots or route implementations become platform code.

Git integration uses provider APIs for read-only immutable commit/tree/blob retrieval, initially self-hosted GitLab. This is simpler than a shell checkout for limited migration intake. Bound archive sizes/paths and pin commit identity; use a maintained Git library such as JGit/go-git only if repository features demand it, with language-specific cost and license review. GitHub is an adapter later. Jenkins calls platform APIs through trusted jobs; it is not the approval source of truth. [GitLab approvals](https://docs.gitlab.com/ci/environments/deployment_approvals/) have separate edition boundaries; platform approval works independently of those tiers.

**Consequences:** API contracts and errors are designed anew; learning a source product's API does not mean copying it. Source provider outage after ingestion does not modify approved SQL. Status callbacks/webhooks remain V1 custom integrations. Error states expose useful file/range/target diagnostics without framework traces or secret payloads.

## ADR-007 — Authentication, secrets and operations

**Decision:** MVP invite-only local authentication via maintained cryptographic/session libraries, fixed roles and independent approval. OIDC in V1 using an existing on-prem provider or optional Keycloak; LDAP federation through that identity component instead of implementing password protocols. OIDC-first pilot may substitute for local auth if an existing provider is confirmed, without adding deployment dependencies casually.

Kubernetes Secret references and cluster encryption/access controls provide initial secrets integration; OpenBao adapter is preferred if a FOSS secrets service is needed. Do not add HashiCorp Vault as a presumed OSI dependency without checking its exact license/version. The API has no PROD writer-secret access. Workers have restricted service accounts, egress, mounted runtime secrets and no arbitrary shell/remote commands.

MVP packaging specifies nonroot containers, random OpenShift UID compatibility, writable temporary paths, read-only root filesystem, probes, resource requests/limits, network policy and database/artifact backup runbooks. Avoid bundling or changing production infrastructure during research. Observability uses structured logs initially and optional Prometheus/OpenTelemetry collectors in V1. [OpenTelemetry](https://opentelemetry.io/docs/) is an integration choice; no observability SaaS is required.

## Decision gates and maintenance ownership

Before implementation phase one closes: validate license closure and exact pins; run the mature splitter with all Oracle fixtures; prove Thin TCPS/owner behavior and privilege visibility; prove locks survive DDL on 19c/21c; inject commit/receipt/central-update failures. Parser/driver/lock failure means architecture remains provisional. No new connection or lab authorization is implied by this research.

Each dependency has a maintainer, pinned version/hash, notices, known advisory review, offline source/build/package mirror and an upgrade regression policy. Apache source rights cannot substitute for security patching. The optional Liquibase 4.33 adapter requires explicit ownership of future fixes; adopting an unsupported older engine just because its license is permissive is rejected as a default strategy. Build tools, JVM/base images, fonts, icon sets and transitive native binaries belong in the SBOM.
