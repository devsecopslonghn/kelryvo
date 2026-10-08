# Gap analysis and prioritization

8 October 2026. All new-platform capabilities remain **DESIGN_PROPOSAL / NOT_TESTED**. Source-declared product capability does not imply a reusable implementation or Community entitlement. Full item-level MoSCoW, complexity and dependencies are in [catalog](feature-catalog.json); package estimates and acceptance gates are in [roadmap](PRODUCT-ROADMAP.md).

## Capability comparison

| Capability | Bytebase | ODC | Archery | Migration engines | Proposed MVP | V1/V2 |
|---|---|---|---|---|---|---|
| Shared service/schema inventory and ownership | Native inventory/project fields; Oracle physical hierarchy partial | Datasource/database/project model native | Connection/resource-group model; schema discovery, no required project ownership model | Not platform inventory | Independent canonical physical/container/schema model | Deeper metadata, groups, transfers and additional engines |
| Ordered Git folder release | Supported action → Release/Plan, central versions | Native SQL batch/task; full version-folder contract not established | One SQL ticket/file text, no native file release | Flyway version-folder; Liquibase changesets; Sqitch plan | Bound GitLab folder → immutable release | MR/check/status adapters and repeatables/desired state |
| Applied/pending history | Central revision lookup; not target-local history | Central task history, not required version ledger | Ticket/review history | Target version/changeset/registry | Hybrid local applied receipts + central authority | Historical engine import via reviewed baseline |
| Changed checksum blocks execution | Release warning and skip in historical FREE POC | Required native enforcement not established | Per-version file enforcement absent in reviewed executor | Flyway/Liquibase validation, Sqitch integrity | Mandatory SHA-256 block at plan/dispatch | Broader artifact/config drift checks |
| Independent approval and immutable intent | Native approval configuration with Enterprise boundaries; current contract checks exist | Native task approval; exact intent/SoD gaps remain | Audit chain/ticket state, not full frozen release intent | No platform human approval | Fixed independent approver and digest-bound plan | Templates/quorum/risk/identity/window controls |
| Oracle SQL/PLSQL execution | Native go-ora/splitter, historical cases passed | JDBC, historical representative cases passed | Oracle driver/splitter source, current local probes; Oracle runtime not run | Mature Oracle engine paths with client/edition boundaries | Independent driver/coordinator with mature splitter dependency | Optional engine adapters after license/contract decisions |
| Object validity and semantic outcome | Historical DONE despite INVALID | Required postcompile/promotion gate not established | Named PL/SQL check narrower than complete object-type coverage | Execution/history alone not full application validity | Required object/type, diagnostics and postcondition gate | Dependency/impact graph and broader engine checks |
| Crash/partial/restore recovery | Central gap inference; key runtime cases NOT_RUN | Commit/result uncertainty; duplicate batch concerns | Same-ticket guards do not reconcile target effects | Partial-DDL recovery still operational | HOLD, observed facts and independently approved recovery | Controlled orphan termination, HA and richer tooling |
| DEV/SIT/UAT/PROD promotion | Stages native; historical API order bypass | Batch stages/manual queue; required verified release chain not proved | No required native release ladder | CI orchestration external | Same digest, verified predecessor, new per-stage plan | Parallel multi-target/dependency rollout |
| Security/audit/offline operations | Edition-sensitive; audit/SSO/secrets commercial boundaries | Apache core; image/client dependency review | Apache source; release/head driver differences | Engine/client dependency review | Core fixed RBAC/audit/secrets/TLS/offline free | Identity, exports, governance analytics and editor data access |

References: BB-STATE/RELEASE-CHECK/ROLLOUT, P-ODC-BATCH-EXEC, AR-EXEC/COMPILE, FW-ORA/FAIL/CHECKSUM, LB4-STATE and SQ-EVENTS in [evidence registry](evidence/feature-evidence.md). Runtime claims are bounded to [Bytebase](../BYTEBASE-ORACLE-POC-RESULTS.md), [ODC](../ODC-ORACLE-POC-RESULTS.md) and [Archery source/probe limits](../evaluation/archery-database-management-runtime.md).

## Ownership and legal reuse

| Work | Category | Disposition | MoSCoW / phase | Effort/risk |
|---|---|---|---|---|
| Original inventory/assignment/API/UI/approval/admission/recovery code | Native new platform | Must implement independently; no claim of existing implementation | Must / MVP | WP1/2/4/5/7/8, medium–large |
| OSS Oracle driver | External component | Integrate node-oracledb Thin after exact pin/security review | Must / WP0 + MVP | Compatibility/security risk; no required proprietary client |
| Mature Oracle script splitter | External component + custom integration | Investigate Apache Flyway parser-only helper; wrapper/output/ranges are custom and untested | Must / WP0 | Large gate; no new grammar fallback |
| Hybrid target ledger/mutex and central jobs | Native new platform runtime | Independently implement, bootstrap and test; not inherited engine safety | Must / MVP | WP6/7, greatest engineering risk |
| Flyway/Liquibase/Sqitch full execution adapter | External engine + custom bridge | Optional profile; keep one executor/ledger per stream; require separate client requirement decision | Could / V2 | Moderate bridge plus compliance/recovery burden |
| GitLab/Jenkins/MR/status integration | Custom integration | Minimal GitLab intake MVP; CI orchestration and callbacks V1 | Must intake; Should automation | WP3 then V1; untrusted executable CI must lack PROD secrets |
| OIDC/LDAP/OpenBao/metrics services | External optional components + integration | Prefer existing infrastructure; no automatic deployment in research | Should / V1 | Identity/secrets revocation, offline maintenance |
| GPL DbGate UI/plugin and Bytebase source | Code reuse | Do not embed/copy into proposed independent Apache core | Wont | License/derivative-work exposure |
| DDL-wide rollback, warning-only checksum, blind SQL retries | Behavior | Explicitly reject | Wont | False safety and duplicate effects |

Apache/MIT source rights allow reviewed reuse under their terms, but no source-product code has been copied into a platform. Bytebase functional concepts are studied independently; ODC/Archery permissive grants do not justify adopting their missing runtime contracts. OSS engine target-history algorithms are reference mechanisms, not evidence that our coordinator already implements them.

## Highest-priority unresolved gaps

1. **Parser integration and driver capabilities:** SOURCE evidence establishes mature components, not a tested driver-free parser/helper path or the estate's exact TCPS/NNE/authentication compatibility. Resolve in WP0.
2. **Oracle execution/receipt atomicity:** No mature engine makes arbitrary DDL atomic with a second database. Test target mutex, receipt gaps, orphan sessions, duplicate requests and restore holds before UI release.
3. **Required verification visibility:** Discovering owner names does not establish ALL_ERRORS/ALL_OBJECTS visibility. Test owner versus CURRENT_SCHEMA/observer identity, package spec/body and missing expected objects.
4. **Approval races and alternate paths:** All UI/API/CI/scheduler/editor paths must enforce exact artifact/target/history binding; a review result or successful previous stage cannot be advisory only.
5. **Operational ownership:** Offline patching, dependency/license closure, backups, audit retention and recovery DBA availability are part of the product effort. They cannot be relegated to an unspecified external engine.

## Prioritization discipline

Must includes reliable end-to-end Oracle runtime and basic governance, not a UI demonstration. Should covers stronger enterprise configuration and automation after the fixed safe path is proven. Could includes V2 engine/editor/analysis scope with separate acceptance. Wont explicitly excludes seven catalog behaviors. Feature-level M/S/L estimates are not summed; 110–170 engineer-weeks for MVP reflects shared packages and risk gates.

A strict all-OSS required client path motivates new runtime ownership after mature engine assessment. If the user later relaxes that requirement, compare a full Flyway adapter against this coordinator and revise ADRs/effort; do not silently select JDBC or an old unmaintained engine. There is no runtime verdict for the proposed platform and no production adoption recommendation in this research.
