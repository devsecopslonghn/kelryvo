# Feature catalog

Research date: 8 October 2026. **220 features** across nine domains. All proposed platform implementations are DESIGN_PROPOSAL and NOT_TESTED. Native findings concern the source product only; API presence proves a contract, not enforcement or free-edition availability.

## Counts

| Domain | Features |
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

Roadmap: 95 MVP, 77 V1, 41 V2, 7 rejected. These are atomic capabilities, not independent projects or additive estimates.

## Machine-readable contract

[JSON catalog](feature-catalog.json) follows [JSON Schema draft 2020-12](feature-catalog.schema.json), schema version 1.0.0. IDs are stable DOMAIN-001 strings; never renumber existing IDs. References identify pinned repository/file/line or dated primary documentation in the evidence registry. `dependencies` contain feature IDs. `bytebase_native` separates source presence, partial scope, unknown and not-found-in-reviewed-path findings. `evidence_level` describes reference evidence; `implementation_status` always describes the proposed platform. Missing evidence is UNKNOWN; proposed behavior never upgrades native availability. Runtime evidence from historical products is discussed separately and is not transferred to this platform.

Complexity S: roughly 1–2 engineer-weeks; M: 2–5; L: 5–12 or a required technical spike. Shared infrastructure makes rows nonadditive. Native edition limitations and dependency rights need exact version/build review. `example.invalid` in schema `$id` is a namespace placeholder, not a required hosted service.

## Searchable master inventory

| ID | Domain | Feature | Class | Bytebase source finding | Priority / phase | Reference evidence |
|---|---|---|---|---|---|---|
| [DBM-001](#dbm-001) | Database Management | Oracle service registration | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263); [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [DBM-002](#dbm-002) | Database Management | Multi-engine connection configuration | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [DBM-003](#dbm-003) | Database Management | Connection profiles and scoped credentials | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [DBM-004](#dbm-004) | Database Management | Inventory discovery and reconciliation | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/schemasync/syncer.go#L428-L543) |
| [DBM-005](#dbm-005) | Database Management | Schema and object metadata synchronization | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156) |
| [DBM-006](#dbm-006) | Database Management | Database metadata explorer | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217) |
| [DBM-007](#dbm-007) | Database Management | Schema ownership and assignment | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) |
| [DBM-008](#dbm-008) | Database Management | Resource labels | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602); [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) |
| [DBM-009](#dbm-009) | Database Management | Environment mapping | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) |
| [DBM-010](#dbm-010) | Database Management | Project database assignment and transfer | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) |
| [DBM-011](#dbm-011) | Database Management | Instance groups | OPTIONAL | UNKNOWN | P2 / V2 | [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602) |
| [DBM-012](#dbm-012) | Database Management | Database groups | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-GROUP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_group_service.proto#L1-L120) |
| [DBM-013](#dbm-013) | Database Management | Schema groups | OPTIONAL | UNKNOWN | P2 / V2 | [BB-GROUP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_group_service.proto#L1-L120) |
| [DBM-014](#dbm-014) | Database Management | Connection testing | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263) |
| [DBM-015](#dbm-015) | Database Management | Credential rotation | ENHANCEMENT | PARTIAL | P1 / V1 | [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263) |
| [DBM-016](#dbm-016) | Database Management | TLS and connection trust | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [DBM-017](#dbm-017) | Database Management | Database lifecycle inventory | BASELINE | PARTIAL | P1 / V1 | [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263) |
| [DBM-018](#dbm-018) | Database Management | Instance health and sync freshness | BASELINE | PARTIAL | P1 / V1 | [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602) |
| [DBM-019](#dbm-019) | Database Management | Oracle CDB/PDB/service distinction | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943); [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156) |
| [DBM-020](#dbm-020) | Database Management | Discovery visibility profile | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-ORACLE-USERS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L198-L235) |
| [DBM-021](#dbm-021) | Database Management | Oracle maintained account filtering | ENHANCEMENT | PARTIAL | P0 / MVP | [BB-ORACLE-USERS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L198-L235) |
| [DBM-022](#dbm-022) | Database Management | Physical connection deduplication | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-METADATA-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/migrator/migration/LATEST.sql#L549-L608) |
| [DBM-023](#dbm-023) | Database Management | Topology generations and clone detection | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [DBM-024](#dbm-024) | Database Management | Schema dictionary and ER diagrams | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217); [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44) |
| [DBM-025](#dbm-025) | Database Management | Resource maintenance mode | DIFFERENTIATOR | UNKNOWN | P1 / V1 | [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263) |
| [DBM-026](#dbm-026) | Database Management | Database provisioning | REJECTED | PARTIAL | WONT / REJECTED | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [DBM-027](#dbm-027) | Database Management | SSH and bastion routes | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [PRJ-001](#prj-001) | Project Management | Project creation and archival | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [PRJ-002](#prj-002) | Project Management | Project schema estate | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216); [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) |
| [PRJ-003](#prj-003) | Project Management | Project membership | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [PRJ-004](#prj-004) | Project Management | Fixed project roles | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [PRJ-005](#prj-005) | Project Management | Project policies | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [PRJ-006](#prj-006) | Project Management | Project settings | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500) |
| [PRJ-007](#prj-007) | Project Management | Project approval configuration | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500); [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588) |
| [PRJ-008](#prj-008) | Project Management | Project repository binding | BASELINE | PARTIAL | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410) |
| [PRJ-009](#prj-009) | Project Management | Project deployment configuration | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [PRJ-010](#prj-010) | Project Management | Cross-project database visibility | BASELINE | PARTIAL | P1 / V1 | [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) |
| [PRJ-011](#prj-011) | Project Management | Project resource isolation | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-METADATA-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/migrator/migration/LATEST.sql#L549-L608); [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [PRJ-012](#prj-012) | Project Management | Project ownership transfer | BASELINE | PARTIAL | P1 / V1 | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [PRJ-013](#prj-013) | Project Management | Schema assignment inbox | ENHANCEMENT | UNKNOWN | P1 / V1 | [P-ODC-DATABASE](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/connection/DatabaseEntity.java#L1-L125) |
| [PRJ-014](#prj-014) | Project Management | Project dashboard | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ROUTES-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L498-L800) |
| [PRJ-015](#prj-015) | Project Management | Project export/import configuration | ENHANCEMENT | UNKNOWN | P2 / V2 | [AF-IAC](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17) |
| [MIG-001](#mig-001) | Migration Management | Versioned schema migrations | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135) |
| [MIG-002](#mig-002) | Migration Management | Versioned data migrations | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492) |
| [MIG-003](#mig-003) | Migration Management | Declarative migrations | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [MIG-004](#mig-004) | Migration Management | Migration file naming | ENHANCEMENT | PARTIAL | P0 / MVP | [BB-FOLDER-ACTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/file.go#L20-L107); [BB-RELEASE-VALIDATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434); [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200) |
| [MIG-005](#mig-005) | Migration Management | Migration numeric ordering | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-RELEASE-VALIDATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434) |
| [MIG-006](#mig-006) | Migration Management | Immutable Git commit ingestion | BASELINE | PARTIAL | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [MIG-007](#mig-007) | Migration Management | Folder migration discovery | ENHANCEMENT | PARTIAL | P0 / MVP | [BB-FOLDER-ACTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/file.go#L20-L107); [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200) |
| [MIG-008](#mig-008) | Migration Management | Release creation and identity | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [MIG-009](#mig-009) | Migration Management | Release structural validation | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-RELEASE-VALIDATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434) |
| [MIG-010](#mig-010) | Migration Management | Per-target migration planning | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492) |
| [MIG-011](#mig-011) | Migration Management | Pending and applied reconciliation | ENHANCEMENT | PARTIAL | P0 / MVP | [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [LB4-SKIP](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java#L15-L77) |
| [MIG-012](#mig-012) | Migration Management | Migration execution history | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600) |
| [MIG-013](#mig-013) | Migration Management | Raw-file checksum enforcement | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-RELEASE-CHECK](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service_check.go#L389-L431); [FW-CHECKSUM](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java#L322-L342) |
| [MIG-014](#mig-014) | Migration Management | Schema drift detection | BASELINE | PARTIAL | P1 / V1 | [AF-DRIFT](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L478-L498); [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217) |
| [MIG-015](#mig-015) | Migration Management | Approved schema baseline | ENHANCEMENT | PARTIAL | P0 / MVP | [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [LB4-STATE](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java#L45-L67) |
| [MIG-016](#mig-016) | Migration Management | Repeatable migration files | ENHANCEMENT | UNKNOWN | P2 / V2 | [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492) |
| [MIG-017](#mig-017) | Migration Management | Failed migration recovery | DIFFERENTIATOR | PARTIAL | P0 / MVP | [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362); [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600) |
| [MIG-018](#mig-018) | Migration Management | Idempotent deployment API | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [AF-REST](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L235-L244) |
| [MIG-019](#mig-019) | Migration Management | Target mutex across all aliases | DIFFERENTIATOR | PARTIAL | P0 / MVP | [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492); [ORACLE-LOCK](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html) |
| [MIG-020](#mig-020) | Migration Management | Safe migration retry admission | DIFFERENTIATOR | PARTIAL | P0 / MVP | [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362) |
| [MIG-021](#mig-021) | Migration Management | Release promotion ladder | DIFFERENTIATOR | PARTIAL | P0 / MVP | [AF-PROM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175); [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [MIG-022](#mig-022) | Migration Management | Multi-database rollout | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [P-ODC-BATCH-MODEL](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java#L1-L82) |
| [MIG-023](#mig-023) | Migration Management | Reviewed corrective migrations | ENHANCEMENT | PARTIAL | P0 / MVP | [SQ-EXEC](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1041-L1068); [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362) |
| [MIG-024](#mig-024) | Migration Management | Automatic Oracle DDL rollback | REJECTED | UNKNOWN | WONT / REJECTED | [ORACLE-COMMIT](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html) |
| [MIG-025](#mig-025) | Migration Management | Target-local ledger | ENHANCEMENT | NOT_FOUND_IN_REVIEW | P0 / MVP | [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [LB4-STATE](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java#L45-L67); [SQ-STATE](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L29-L52) |
| [MIG-026](#mig-026) | Migration Management | Hybrid history and reconciliation | DIFFERENTIATOR | NOT_FOUND_IN_REVIEW | P0 / MVP | [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135) |
| [MIG-027](#mig-027) | Migration Management | Statement-level diagnostics | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218) |
| [MIG-028](#mig-028) | Migration Management | Exact plan history precondition | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [FW-CHECKSUM](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java#L322-L342) |
| [MIG-029](#mig-029) | Migration Management | Per-target zero-pending success | ENHANCEMENT | SOURCE_VERIFIED | P0 / MVP | [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [LB4-SKIP](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java#L15-L77) |
| [MIG-030](#mig-030) | Migration Management | Out-of-order migration policy | ENHANCEMENT | PARTIAL | P1 / V1 | [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492) |
| [MIG-031](#mig-031) | Migration Management | Preconditions and postconditions | ENHANCEMENT | UNKNOWN | P0 / MVP | [SQ-EVENTS](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141); [LB4-EXEC](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java#L115-L143) |
| [MIG-032](#mig-032) | Migration Management | Migration stream namespaces | ENHANCEMENT | PARTIAL | P1 / V1 | [SQ-STATE](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L29-L52); [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135) |
| [MIG-033](#mig-033) | Migration Management | Schema comparison and sync | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217); [P-ODC-SCHEMA-DIFF-DOC](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/900.structural-comparison.md#L5-L36) |
| [MIG-034](#mig-034) | Migration Management | Restore divergence detection | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600) |
| [GOV-001](#gov-001) | Change Governance | Change request and issue creation | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247) |
| [GOV-002](#gov-002) | Change Governance | Independent plan approval | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588) |
| [GOV-003](#gov-003) | Change Governance | Multi-stage approval | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588) |
| [GOV-004](#gov-004) | Change Governance | Dynamic approvers | BASELINE | PARTIAL | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [GOV-005](#gov-005) | Change Governance | Environment-specific approval | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [GOV-006](#gov-006) | Change Governance | Segregation of duties | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500) |
| [GOV-007](#gov-007) | Change Governance | Self-approval and last-editor restrictions | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500) |
| [GOV-008](#gov-008) | Change Governance | Approval templates | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588) |
| [GOV-009](#gov-009) | Change Governance | Approval expiration | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588) |
| [GOV-010](#gov-010) | Change Governance | Rejection and resubmission | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247) |
| [GOV-011](#gov-011) | Change Governance | Approval revocation | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247) |
| [GOV-012](#gov-012) | Change Governance | SQL or target edits invalidate approval | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247); [BB-PLAN-DISCOVERY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/plan_service.proto#L18-L185) |
| [GOV-013](#gov-013) | Change Governance | Immutable approved artifacts | BASELINE | PARTIAL | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [GOV-014](#gov-014) | Change Governance | Deployment windows | BASELINE | PARTIAL | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [GOV-015](#gov-015) | Change Governance | Scheduled execution | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [GOV-016](#gov-016) | Change Governance | Emergency change workflow | ENHANCEMENT | UNKNOWN | P1 / V1 | [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129) |
| [GOV-017](#gov-017) | Change Governance | Hotfix release workflow | ENHANCEMENT | UNKNOWN | P1 / V1 | [AF-PROM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175) |
| [GOV-018](#gov-018) | Change Governance | Execution authorization | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [GOV-019](#gov-019) | Change Governance | Risk-based approval routing | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154); [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [GOV-020](#gov-020) | Change Governance | Review comments and evidence attachments | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247) |
| [GOV-021](#gov-021) | Change Governance | Approval inbox and delegation | ENHANCEMENT | PARTIAL | P1 / V1 | [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436) |
| [GOV-022](#gov-022) | Change Governance | Manual continuation between stages | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [GOV-023](#gov-023) | Change Governance | Approval decision audit | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588); [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53) |
| [GOV-024](#gov-024) | Change Governance | Execution cancellation semantics | DIFFERENTIATOR | PARTIAL | P1 / V1 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [GOV-025](#gov-025) | Change Governance | Policy change revalidation | DIFFERENTIATOR | PARTIAL | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [SQL-001](#sql-001) | SQL and Review | Web SQL editor | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-SQL-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/sqlEditor.tsx#L1-L86) |
| [SQL-002](#sql-002) | SQL and Review | Syntax highlighting | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-SQL-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/sqlEditor.tsx#L1-L86) |
| [SQL-003](#sql-003) | SQL and Review | Metadata autocomplete | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44) |
| [SQL-004](#sql-004) | SQL and Review | Schema browsing | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217) |
| [SQL-005](#sql-005) | SQL and Review | Interactive SQL execution | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102) |
| [SQL-006](#sql-006) | SQL and Review | Query history | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102) |
| [SQL-007](#sql-007) | SQL and Review | Query result export | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102) |
| [SQL-008](#sql-008) | SQL and Review | SQL review rule configuration | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [SQL-009](#sql-009) | SQL and Review | Static SQL linting | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [SQL-010](#sql-010) | SQL and Review | Destructive statement review | BASELINE | PARTIAL | P1 / V1 | [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [SQL-011](#sql-011) | SQL and Review | Sensitive data controls | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-QUERY-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/org_policy_service.go#L680-L728) |
| [SQL-012](#sql-012) | SQL and Review | Query and export permissions | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102) |
| [SQL-013](#sql-013) | SQL and Review | Read-only query sessions | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-READONLY-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/instance_service.go#L1215-L1245) |
| [SQL-014](#sql-014) | SQL and Review | Explain plan | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-SQL-OPTIONS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L105-L195) |
| [SQL-015](#sql-015) | SQL and Review | Exact execution preview | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PLAN-DISCOVERY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/plan_service.proto#L18-L185) |
| [SQL-016](#sql-016) | SQL and Review | Oracle PL/SQL scripts | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218); [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200) |
| [SQL-017](#sql-017) | SQL and Review | Oracle script splitting | ENHANCEMENT | SOURCE_VERIFIED | P0 / MVP | [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200); [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218) |
| [SQL-018](#sql-018) | SQL and Review | Package specification and body validation | DIFFERENTIATOR | PARTIAL | P0 / MVP | [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [ORACLE-ERRORS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html) |
| [SQL-019](#sql-019) | SQL and Review | Required object validity gate | DIFFERENTIATOR | PARTIAL | P0 / MVP | [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [ORACLE-ERRORS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html) |
| [SQL-020](#sql-020) | SQL and Review | Compiler diagnostics explorer | ENHANCEMENT | PARTIAL | P0 / MVP | [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [ORACLE-ERRORS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html) |
| [SQL-021](#sql-021) | SQL and Review | SQL*Plus command profile | OPTIONAL | PARTIAL | P2 / V2 | [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200); [FW-ORACLE-DOC](https://documentation.red-gate.com/flyway/reference/database-driver-reference/oracle-database) |
| [SQL-022](#sql-022) | SQL and Review | Saved and shared SQL scripts | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-SAVED](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/saved_query_service.proto#L1-L124) |
| [SQL-023](#sql-023) | SQL and Review | Visual query builder | OPTIONAL | UNKNOWN | P2 / V2 | [DBGATE-README](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/README.md#L1-L100) |
| [SQL-024](#sql-024) | SQL and Review | Batch query UX | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44) |
| [SQL-025](#sql-025) | SQL and Review | Oracle dependency-aware object checks | ENHANCEMENT | PARTIAL | P1 / V1 | [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156); [P-ODC-SCHEMA-DIFF-DOC](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/900.structural-comparison.md#L5-L36) |
| [SEC-001](#sec-001) | Security and Governance | Local authentication | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154) |
| [SEC-002](#sec-002) | Security and Governance | LDAP federation | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-IDP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242); [AR-LDAP](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/archery/settings.py#L360-L387) |
| [SEC-003](#sec-003) | Security and Governance | OIDC single sign-on | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-IDP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242) |
| [SEC-004](#sec-004) | Security and Governance | OAuth2 social login | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-IDP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242) |
| [SEC-005](#sec-005) | Security and Governance | Role-based authorization | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [SEC-006](#sec-006) | Security and Governance | Resource-level permissions | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216); [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) |
| [SEC-007](#sec-007) | Security and Governance | Database/schema access grants | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ACCESS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/access_grant_service.proto#L15-L144) |
| [SEC-008](#sec-008) | Security and Governance | Approval policy enforcement | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500) |
| [SEC-009](#sec-009) | Security and Governance | Scoped secrets provider | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [SEC-010](#sec-010) | Security and Governance | Credential encryption and redaction | BASELINE | PARTIAL | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [SEC-011](#sec-011) | Security and Governance | Complete change audit trail | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53) |
| [SEC-012](#sec-012) | Security and Governance | Activity versus audit separation | BASELINE | PARTIAL | P1 / V1 | [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247); [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53) |
| [SEC-013](#sec-013) | Security and Governance | Deployment evidence bundles | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [SQ-EVENTS](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141) |
| [SEC-014](#sec-014) | Security and Governance | Policy enforcement on alternate entry points | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102); [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [SEC-015](#sec-015) | Security and Governance | API credentials and key rotation | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-SERVICE-ACCOUNT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/service_account_service.proto#L1-L122) |
| [SEC-016](#sec-016) | Security and Governance | Named service accounts | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-SERVICE-ACCOUNT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/service_account_service.proto#L1-L122) |
| [SEC-017](#sec-017) | Security and Governance | Network restrictions | ENHANCEMENT | PARTIAL | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [SEC-018](#sec-018) | Security and Governance | Web and API TLS | BASELINE | PARTIAL | P0 / MVP | [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) |
| [SEC-019](#sec-019) | Security and Governance | Session lifecycle and logout | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154) |
| [SEC-020](#sec-020) | Security and Governance | Compliance reports | OPTIONAL | PARTIAL | P2 / V2 | [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53) |
| [SEC-021](#sec-021) | Security and Governance | Custom RBAC roles | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ROLE-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/role_service.go#L68-L88) |
| [SEC-022](#sec-022) | Security and Governance | User groups | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [SEC-023](#sec-023) | Security and Governance | Multi-factor authentication | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154) |
| [SEC-024](#sec-024) | Security and Governance | SCIM provisioning | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44) |
| [SEC-025](#sec-025) | Security and Governance | Just-in-time database access | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-ACCESS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/access_grant_service.proto#L15-L144) |
| [SEC-026](#sec-026) | Security and Governance | Data classification and masking | BASELINE | SOURCE_VERIFIED | P2 / V2 | [BB-CATALOG](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_catalog_service.proto#L1-L110); [BB-QUERY-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/org_policy_service.go#L680-L728) |
| [SEC-027](#sec-027) | Security and Governance | Workload identity federation | ENHANCEMENT | SOURCE_VERIFIED | P2 / V2 | [BB-WORKLOAD](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/workload_identity_service.proto#L1-L140) |
| [SEC-028](#sec-028) | Security and Governance | Audit tamper evidence and external retention | DIFFERENTIATOR | PARTIAL | P1 / V1 | [AF-SIEM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1018-L1036); [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53) |
| [GIT-001](#git-001) | GitOps and CI/CD | GitLab repository integration | BASELINE | PARTIAL | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410) |
| [GIT-002](#git-002) | GitOps and CI/CD | GitHub provider adapter | BASELINE | PARTIAL | P1 / V1 | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410) |
| [GIT-003](#git-003) | GitOps and CI/CD | Repository connection and test | BASELINE | PARTIAL | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [GIT-004](#git-004) | GitOps and CI/CD | Branch and tag selection | BASELINE | PARTIAL | P1 / V1 | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [GIT-005](#git-005) | GitOps and CI/CD | Merge request SQL checks | BASELINE | PARTIAL | P1 / V1 | [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410); [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) |
| [GIT-006](#git-006) | GitOps and CI/CD | Commit and source provenance | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [GIT-007](#git-007) | GitOps and CI/CD | Immutable release artifact retention | BASELINE | PARTIAL | P0 / MVP | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [GIT-008](#git-008) | GitOps and CI/CD | CI trigger ingestion | ENHANCEMENT | PARTIAL | P1 / V1 | [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410) |
| [GIT-009](#git-009) | GitOps and CI/CD | Signed webhook ingestion | ENHANCEMENT | UNKNOWN | P1 / V1 | [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410) |
| [GIT-010](#git-010) | GitOps and CI/CD | API-driven release and deployment | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [GIT-011](#git-011) | GitOps and CI/CD | Environment promotion integration | ENHANCEMENT | PARTIAL | P1 / V1 | [AF-PROM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175) |
| [GIT-012](#git-012) | GitOps and CI/CD | Jenkins integration | ENHANCEMENT | UNKNOWN | P1 / V1 | [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129); [JENKINS-INPUT](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/) |
| [GIT-013](#git-013) | GitOps and CI/CD | Deployment status callbacks | ENHANCEMENT | PARTIAL | P1 / V1 | [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129) |
| [GIT-014](#git-014) | GitOps and CI/CD | Pipeline execution reports | ENHANCEMENT | PARTIAL | P1 / V1 | [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129) |
| [GIT-015](#git-015) | GitOps and CI/CD | Git drift detection | ENHANCEMENT | PARTIAL | P1 / V1 | [AF-DRIFT](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L478-L498) |
| [GIT-016](#git-016) | GitOps and CI/CD | Protected source configuration | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [GITLAB-APPROVAL](https://docs.gitlab.com/ci/environments/deployment_approvals/) |
| [GIT-017](#git-017) | GitOps and CI/CD | GitOps policy as code | OPTIONAL | PARTIAL | P2 / V2 | [AF-IAC](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17) |
| [GIT-018](#git-018) | GitOps and CI/CD | Offline Git mirrors and artifacts | ENHANCEMENT | PARTIAL | P0 / MVP | [AF-DR](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1680-L1707) |
| [GIT-019](#git-019) | GitOps and CI/CD | Azure DevOps and Bitbucket adapters | OPTIONAL | PARTIAL | P2 / V2 | [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) |
| [OPS-001](#ops-001) | Observability and Operations | Durable background job scheduling | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [OPS-002](#ops-002) | Observability and Operations | Restricted execution workers | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218) |
| [OPS-003](#ops-003) | Observability and Operations | Execution queues and concurrency budgets | BASELINE | PARTIAL | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [OPS-004](#ops-004) | Observability and Operations | Read-only job retries | DIFFERENTIATOR | PARTIAL | P1 / V1 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [OPS-005](#ops-005) | Observability and Operations | Execution state model | DIFFERENTIATOR | PARTIAL | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [OPS-006](#ops-006) | Observability and Operations | Structured execution logs | BASELINE | SOURCE_VERIFIED | P0 / MVP | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [OPS-007](#ops-007) | Observability and Operations | User notifications | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [OPS-008](#ops-008) | Observability and Operations | Email notifications | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154) |
| [OPS-009](#ops-009) | Observability and Operations | Outbound project webhooks | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) |
| [OPS-010](#ops-010) | Observability and Operations | Prometheus metrics | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-METRICS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/server/metrics.go#L1-L39) |
| [OPS-011](#ops-011) | Observability and Operations | Health and readiness checks | BASELINE | PARTIAL | P0 / MVP | [BB-METRICS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/server/metrics.go#L1-L39) |
| [OPS-012](#ops-012) | Observability and Operations | Metadata and artifact backup/restore | ENHANCEMENT | PARTIAL | P0 / MVP | [AF-DR](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1680-L1707) |
| [OPS-013](#ops-013) | Observability and Operations | High availability failover | BASELINE | PARTIAL | P1 / V1 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [BB-HA-DOC](https://docs.bytebase.com/changelog/bytebase-3-17-0) |
| [OPS-014](#ops-014) | Observability and Operations | Credential-scoped connection pooling | BASELINE | PARTIAL | P1 / V1 | [NODE-THIN-DOC](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html) |
| [OPS-015](#ops-015) | Observability and Operations | Operational deployment dashboard | BASELINE | SOURCE_VERIFIED | P1 / V1 | [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436) |
| [OPS-016](#ops-016) | Observability and Operations | Resource usage budgets | ENHANCEMENT | PARTIAL | P1 / V1 | [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602) |
| [OPS-017](#ops-017) | Observability and Operations | Multiple worker replicas | BASELINE | PARTIAL | P1 / V1 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [OPS-018](#ops-018) | Observability and Operations | Audit and log retention | ENHANCEMENT | PARTIAL | P0 / MVP | [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53) |
| [OPS-019](#ops-019) | Observability and Operations | Graceful shutdown and drain | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [NODE-THIN-DOC](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html) |
| [OPS-020](#ops-020) | Observability and Operations | OpenTelemetry traces | ENHANCEMENT | UNKNOWN | P1 / V1 | [TECH-OTEL](https://opentelemetry.io/docs/) |
| [OPS-021](#ops-021) | Observability and Operations | Cancellation and orphan session tooling | DIFFERENTIATOR | PARTIAL | P1 / V1 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [ORACLE-LOCK](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html) |
| [OPS-022](#ops-022) | Observability and Operations | On-prem Kubernetes/OpenShift packaging | ENHANCEMENT | PARTIAL | P0 / MVP | [P-ODC-DEPLOY](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/README.md#L43-L108) |
| [OPS-023](#ops-023) | Observability and Operations | Air-gapped updates and SBOM | ENHANCEMENT | UNKNOWN | P0 / MVP | [TECH-SPDX](https://spdx.dev/use/specifications/) |
| [OPS-024](#ops-024) | Observability and Operations | Database performance observability | OPTIONAL | PARTIAL | P2 / V2 | [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602) |
| [OPS-025](#ops-025) | Observability and Operations | Operational recovery case management | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362) |
| [OPS-026](#ops-026) | Observability and Operations | Capacity acceptance workload | DIFFERENTIATOR | UNKNOWN | P0 / MVP | [P-ODC-BATCH-MODEL](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java#L1-L82) |
| [OPS-027](#ops-027) | Observability and Operations | Upgrade compatibility and ledger versioning | ENHANCEMENT | UNKNOWN | P1 / V1 | [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135) |
| [EXT-001](#ext-001) | Additional Features | Oracle definer/invoker rights review | ENHANCEMENT | PARTIAL | P1 / V1 | [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195) |
| [EXT-002](#ext-002) | Additional Features | Oracle dependency-aware rollout | ENHANCEMENT | PARTIAL | P2 / V2 | [SQ-EXEC](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1041-L1068) |
| [EXT-003](#ext-003) | Additional Features | Oracle edition-based redefinition | OPTIONAL | UNKNOWN | P2 / V2 | [NODE-MODES-DOC](https://node-oracledb.readthedocs.io/en/latest/user_guide/appendix_a.html) |
| [EXT-004](#ext-004) | Additional Features | Oracle online DDL capability profiles | OPTIONAL | UNKNOWN | P2 / V2 | [ORACLE-COMMIT](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html) |
| [EXT-005](#ext-005) | Additional Features | Sqitch-style verification scripts | ENHANCEMENT | NOT_FOUND_IN_REVIEW | P1 / V1 | [SQ-EVENTS](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141) |
| [EXT-006](#ext-006) | Additional Features | Liquibase-style changeset preconditions | ENHANCEMENT | UNKNOWN | P1 / V1 | [LB4-EXEC](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java#L115-L143) |
| [EXT-007](#ext-007) | Additional Features | Release impact graph | OPTIONAL | UNKNOWN | P2 / V2 | [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156) |
| [EXT-008](#ext-008) | Additional Features | Justification and risk acknowledgement | ENHANCEMENT | PARTIAL | P0 / MVP | [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129) |
| [EXT-009](#ext-009) | Additional Features | Multi-language UI design | ENHANCEMENT | PARTIAL | P1 / V1 | [P-ODC-LOCALE](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/util/intl.tsx#L24-L40) |
| [EXT-010](#ext-010) | Additional Features | Independent Oracle outcome panel | DIFFERENTIATOR | PARTIAL | P0 / MVP | [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600) |
| [EXT-011](#ext-011) | Additional Features | SQL review assistant using local AI | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-AI](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/ai_service.proto#L1-L107) |
| [EXT-012](#ext-012) | Additional Features | Automatic AI approval or recovery | REJECTED | UNKNOWN | WONT / REJECTED | [BB-AI](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/ai_service.proto#L1-L107) |
| [EXT-013](#ext-013) | Additional Features | MCP read-only discovery | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436) |
| [EXT-014](#ext-014) | Additional Features | MCP autonomous production writes | REJECTED | PARTIAL | WONT / REJECTED | [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436) |
| [EXT-015](#ext-015) | Additional Features | Terraform/IaC inventory provider | OPTIONAL | PARTIAL | P2 / V2 | [AF-IAC](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17) |
| [EXT-016](#ext-016) | Additional Features | Data backup and data rollback previews | OPTIONAL | SOURCE_VERIFIED | P2 / V2 | [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) |
| [EXT-017](#ext-017) | Additional Features | Arbitrary data import/export tooling | REJECTED | UNKNOWN | WONT / REJECTED | [DBGATE-README](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/README.md#L1-L100) |
| [EXT-018](#ext-018) | Additional Features | Vendor branding and identical UI assets | REJECTED | NOT_FOUND_IN_REVIEW | WONT / REJECTED | [BB-L](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE#L1-L25); [BB-ENT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE.enterprise#L1-L26) |
| [EXT-019](#ext-019) | Additional Features | Commercial instance/user quotas | REJECTED | SOURCE_VERIFIED | WONT / REJECTED | [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44) |
| [EXT-020](#ext-020) | Additional Features | Public extensibility API | ENHANCEMENT | PARTIAL | P2 / V2 | [AF-REST](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L235-L244) |

## Detailed acceptance records

### DBM-001

**Oracle service registration** — Database Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Register a verified Oracle service route with a stable endpoint ID and explicit transport.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263); [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** Foundational capability; no catalog prerequisite. **Operational value:** Critical: Register two services without embedding passwords in API output.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Register two services without embedding passwords in API output.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-002

**Multi-engine connection configuration** — Database Management; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Advertise engine capabilities and validate only supported engine configuration.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Reject Oracle-specific parameters on a PostgreSQL endpoint.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Reject Oracle-specific parameters on a PostgreSQL endpoint.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-003

**Connection profiles and scoped credentials** — Database Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Separate discovery and schema-owner execution references on one endpoint.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** DBM-001, SEC-009 **Operational value:** Critical: A discovery identity cannot be selected as a writer without an explicit reviewed binding.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A discovery identity cannot be selected as a writer without an explicit reviewed binding.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-004

**Inventory discovery and reconciliation** — Database Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Upsert observed endpoint/container/schema identities and expose stale or incomplete results.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/schemasync/syncer.go#L428-L543). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** DBM-001, DBM-003 **Operational value:** Critical: Repeating discovery creates no duplicate schemas and preserves manual assignment.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Repeating discovery creates no duplicate schemas and preserves manual assignment.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-005

**Schema and object metadata synchronization** — Database Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Collect visible objects and snapshot visibility/errors separately from execution state.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: An incomplete dictionary read is displayed as incomplete and never deletes resources.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An incomplete dictionary read is displayed as incomplete and never deletes resources.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-006

**Database metadata explorer** — Database Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Browse columns, constraints, indexes, routines and latest successful snapshot.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: A user sees metadata only for granted project schemas with freshness timestamps.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A user sees metadata only for granted project schemas with freshness timestamps.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-007

**Schema ownership and assignment** — Database Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Assign independently identified schemas to one active owning project.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** DBM-004, PRJ-001 **Operational value:** Critical: Two schemas through one service can belong to different projects without duplicate endpoint metadata.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Two schemas through one service can belong to different projects without duplicate endpoint metadata.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-008

**Resource labels** — Database Management; BASELINE; P1 / V1; complexity S.

**Description / expected behavior:** Use validated key/value labels for search and policy inputs.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602); [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Label changes cannot silently alter an approved target set.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Label changes cannot silently alter an approved target set.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-009

**Environment mapping** — Database Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Use authoritative container environments inherited by schemas.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** DBM-019 **Operational value:** Critical: A PROD container cannot be made DEV by editing a schema label.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A PROD container cannot be made DEV by editing a schema label.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-010

**Project database assignment and transfer** — Database Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Close/open assignments atomically while preserving schema identity/history.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Transfer denies during execution and invalidates queued plans with old assignment revisions.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Transfer denies during execution and invalidates queued plans with old assignment revisions.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-011

**Instance groups** — Database Management; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Offer saved inventory filters if operator demand justifies them.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: A saved group expands to explicit endpoint IDs and cannot grant access.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A saved group expands to explicit endpoint IDs and cannot grant access.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-012

**Database groups** — Database Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Define selectors for batches and materialize members before approval.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-GROUP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_group_service.proto#L1-L120). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Adding a database after approval does not add it to an existing plan.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Adding a database after approval does not add it to an existing plan.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-013

**Schema groups** — Database Management; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Allow project-scoped saved schema selectors with frozen plan expansion.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [BB-GROUP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_group_service.proto#L1-L120). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Cross-project schemas require explicit permission and never join silently.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Cross-project schemas require explicit permission and never join silently.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-014

**Connection testing** — Database Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Verify authentication, service/container identity and required visibility separately.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Critical: A successful ping with wrong PDB identity fails onboarding.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A successful ping with wrong PDB identity fails onboarding.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-015

**Credential rotation** — Database Management; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Rotate a secret version, drain affected pools and retain logical scope.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Old credentials stop being used after pool drain; plaintext is absent from logs.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Old credentials stop being used after pool drain; plaintext is absent from logs.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-016

**TLS and connection trust** — Database Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Require verified TCPS trust/server identity for production transport.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Critical: An untrusted certificate blocks execution and produces a redacted diagnostic.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An untrusted certificate blocks execution and produces a redacted diagnostic.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-017

**Database lifecycle inventory** — Database Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Archive or retire catalog resources without changing Oracle users or PDBs.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Retired targets retain audit/history and reject new deployment plans.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Retired targets retain audit/history and reject new deployment plans.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-018

**Instance health and sync freshness** — Database Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Show connection/sync status and stale snapshots with bounded probes.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: A timeout changes observed health without marking migrations failed or rolled back.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A timeout changes observed health without marking migrations failed or rolled back.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-019

**Oracle CDB/PDB/service distinction** — Database Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Model route, physical container and schema separately and attest aliases.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943); [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** DBM-001 **Operational value:** Critical: Two aliases to one PDB/owner resolve to the same target mutex.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Two aliases to one PDB/owner resolve to the same target mutex.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-020

**Discovery visibility profile** — Database Management; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Record catalog grants and missing visibility rather than assuming full discovery.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ORACLE-USERS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L198-L235). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Critical: Zero ALL_ERRORS rows without required visibility cannot satisfy validity checks.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Zero ALL_ERRORS rows without required visibility cannot satisfy validity checks.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-021

**Oracle maintained account filtering** — Database Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Exclude Oracle-maintained owners through a reviewed catalog-aware policy.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ORACLE-USERS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L198-L235). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Critical: New application owner is discoverable; SYS/SYSTEM are not deployable targets.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- New application owner is discoverable; SYS/SYSTEM are not deployable targets.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-022

**Physical connection deduplication** — Database Management; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Share endpoint metadata across project schemas and credential-specific sessions.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-METADATA-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/migrator/migration/LATEST.sql#L549-L608). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Critical: Registering 500 schemas on 50 services does not create 500 physical inventory endpoints.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Registering 500 schemas on 50 services does not create 500 physical inventory endpoints.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-023

**Topology generations and clone detection** — Database Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Bind target generation and attest clone/restore/service remapping.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** DBM-019 **Operational value:** Critical: A changed container generation invalidates an otherwise approved plan.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A changed container generation invalidates an otherwise approved plan.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-024

**Schema dictionary and ER diagrams** — Database Management; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Generate diagrams from authorized metadata without claiming complete dependency knowledge.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217); [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: A diagram has snapshot timestamp and excludes unauthorized schema names.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A diagram has snapshot timestamp and excludes unauthorized schema names.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-025

**Resource maintenance mode** — Database Management; DIFFERENTIATOR; P1 / V1; complexity M.

**Description / expected behavior:** Suspend new writes while allowing discovery and evidence inspection.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [BB-INSTANCE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Entering maintenance blocks every UI/API/scheduler deployment path.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Entering maintenance blocks every UI/API/scheduler deployment path.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### DBM-026

**Database provisioning** — Database Management; REJECTED; WONT / REJECTED; complexity NOT_ESTIMATED.

**Description / expected behavior:** Keep Oracle user/PDB provisioning outside the migration MVP.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Avoid false safety claims, unnecessary scope or incompatible licensing.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Discovery and retirement never issue CREATE or DROP USER/PDB.
- No implementation of this rejected behavior is included in the core product.

### DBM-027

**SSH and bastion routes** — Database Management; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Support approved bastion profiles only if on-prem routing needs them.

**Persona:** DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Confirm actual container/owner identity and catalog visibility; preserve quoted owner names and do not treat CURRENT_SCHEMA as authentication.

**Security:** Do not reveal credentials or other projects through shared endpoints.

**Dependencies:** SEC-005, SEC-009 **Operational value:** Useful: Arbitrary requester-supplied tunnel hosts are rejected.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Arbitrary requester-supplied tunnel hosts are rejected.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-001

**Project creation and archival** — Project Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Create projects with stable IDs and archive only after active work is resolved.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** Foundational capability; no catalog prerequisite. **Operational value:** Critical: Archived projects cannot admit new jobs and keep historical evidence readable.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Archived projects cannot admit new jobs and keep historical evidence readable.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-002

**Project schema estate** — Project Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Show project schemas grouped by environment and physical service.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216); [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: One service shows two isolated project estates according to assignments.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- One service shows two isolated project estates according to assignments.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-003

**Project membership** — Project Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Manage explicit principal memberships with server authorization.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** PRJ-001, SEC-005 **Operational value:** Critical: Removing a member immediately denies new actions on project resources.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Removing a member immediately denies new actions on project resources.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-004

**Fixed project roles** — Project Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Provide developer, approver, deployer and auditor roles as free core controls.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** PRJ-001, SEC-005 **Operational value:** Critical: Developer cannot approve own intent or execute a PROD job without deployer permission.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Developer cannot approve own intent or execute a PROD job without deployer permission.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-005

**Project policies** — Project Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Compose organization minimum controls and project restrictions.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: A project override cannot weaken mandatory production separation.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A project override cannot weaken mandatory production separation.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-006

**Project settings** — Project Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Version execution/risk settings and expose their effect on planning.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Changing execution settings invalidates existing intent revisions.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Changing execution settings invalidates existing intent revisions.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-007

**Project approval configuration** — Project Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Allow scoped approver templates under organization constraints.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500); [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Project templates cannot allow author or last editor self-approval.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Project templates cannot allow author or last editor self-approval.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-008

**Project repository binding** — Project Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Bind allowed repository, migration folder and read-only secret scope.

**Persona:** Project owner. **Reference products:** bytebase/bytebase, bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** PRJ-001, SEC-009 **Operational value:** Critical: An unrelated repository/folder cannot ingest into the project.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An unrelated repository/folder cannot ingest into the project.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-009

**Project deployment configuration** — Project Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Define allowed environments, windows and batch behavior in versioned settings.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: A stale deployment configuration requires replanning.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A stale deployment configuration requires replanning.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-010

**Cross-project database visibility** — Project Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Grant explicit read-only cross-project views without ownership transfer.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Audit-only access cannot export secrets or deploy into another project.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Audit-only access cannot export secrets or deploy into another project.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-011

**Project resource isolation** — Project Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Check object authorization on catalog, SQL, artifacts, jobs and history.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-METADATA-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/migrator/migration/LATEST.sql#L549-L608); [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: Guessing another project's resource UUID returns no SQL or metadata.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Guessing another project's resource UUID returns no SQL or metadata.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-012

**Project ownership transfer** — Project Management; BASELINE; P1 / V1; complexity S.

**Description / expected behavior:** Transfer administrator responsibility through audited membership changes.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: An administrator transfer preserves approved history and rechecks future approver eligibility.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An administrator transfer preserves approved history and rechecks future approver eligibility.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-013

**Schema assignment inbox** — Project Management; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Display unassigned discovered schemas and accountable ownership requests.

**Persona:** Project owner. **Reference products:** oceanbase/odc. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [P-ODC-DATABASE](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/connection/DatabaseEntity.java#L1-L125). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Assignment never grants a project visibility before an authorized decision.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Assignment never grants a project visibility before an authorized decision.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-014

**Project dashboard** — Project Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Show pending approvals, deployed versions, holds and estate freshness.

**Persona:** Project owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROUTES-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L498-L800). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Unknown execution outcomes remain visible until recovery is resolved.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Unknown execution outcomes remain visible until recovery is resolved.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### PRJ-015

**Project export/import configuration** — Project Management; ENHANCEMENT; P2 / V2; complexity L.

**Description / expected behavior:** Export portable policies and bindings without plaintext credentials.

**Persona:** Project owner. **Reference products:** bablsoft/accessflow. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [AF-IAC](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Assignments refer to physical schema identity, not a duplicated service connection.

**Security:** Enforce organization/project isolation on every API and historical artifact read.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Import uses secret placeholders and cannot import forged approvals.

**Design:** [DATABASE-RESOURCE-MODEL.md](DATABASE-RESOURCE-MODEL.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Import uses secret placeholders and cannot import forged approvals.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-001

**Versioned schema migrations** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Apply ordered immutable SQL versions to selected schemas.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-010, GOV-002, MIG-019, SQL-017, SQL-019 **Operational value:** Critical: V001 creates a table and one matching target history entry.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- V001 creates a table and one matching target history entry.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-002

**Versioned data migrations** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Execute approved INSERT/UPDATE data scripts under explicit transaction classification.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: A successful data version is skipped on replay and has observer evidence.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A successful data version is skipped on replay and has observer evidence.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-003

**Declarative migrations** — Migration Management; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Generate reviewed differences from desired schema definitions for supported engines.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Generated bytes become an immutable approved artifact before execution.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Generated bytes become an immutable approved artifact before execution.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-004

**Migration file naming** — Migration Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Validate V<number>__description.sql and canonicalize numeric versions.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-FOLDER-ACTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/file.go#L20-L107); [BB-RELEASE-VALIDATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434); [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: V001 and V1 together fail before planning due to duplicate canonical version.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- V001 and V1 together fail before planning due to duplicate canonical version.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-005

**Migration numeric ordering** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Order dotted numeric versions deterministically within a stable stream.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-RELEASE-VALIDATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: V2 executes before V10 regardless of directory listing order.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- V2 executes before V10 regardless of directory listing order.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-006

**Immutable Git commit ingestion** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Resolve a full commit from a bound repository and retain its bytes.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** PRJ-008, GIT-006 **Operational value:** Critical: Moving a branch after ingestion cannot change the release artifact.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Moving a branch after ingestion cannot change the release artifact.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-007

**Folder migration discovery** — Migration Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Read a declared migration directory as one release with no manual per-file submission.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-FOLDER-ACTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/file.go#L20-L107); [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: One folder submission yields all five sample versions with path/hash metadata.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- One folder submission yields all five sample versions with path/hash metadata.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-008

**Release creation and identity** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Give each immutable manifest a release ID and content digest.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-004, MIG-005, MIG-006, MIG-009 **Operational value:** Critical: Two different folder/settings manifests at one commit produce distinguishable release identities.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Two different folder/settings manifests at one commit produce distinguishable release identities.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-009

**Release structural validation** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Validate files, encoding, sizes, capability profile and duplicate versions before target writes.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-RELEASE-VALIDATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: A symlink or unsupported SQL*Plus command yields a file/line error and no target effects.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A symlink or unsupported SQL*Plus command yields a file/line error and no target effects.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-010

**Per-target migration planning** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Read applied target history and freeze exact pending file lists per schema.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-025, MIG-013, DBM-007, MIG-008 **Operational value:** Critical: Schema A with two versions plans three files while schema B with one plans four.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Schema A with two versions plans three files while schema B with one plans four.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-011

**Pending and applied reconciliation** — Migration Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Compare target receipts, central mirror and immutable files before execution.

**Persona:** Database release engineer. **Reference products:** flyway/flyway, liquibase/liquibase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [LB4-SKIP](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java#L15-L77). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries. Only pinned 4.33.0 source is Apache-2.0 here; current 5.x source is FSL; JDBC and binary payload require separate review.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: A central UNKNOWN attempt blocks even when local history shows the version pending.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A central UNKNOWN attempt blocks even when local history shows the version pending.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-012

**Migration execution history** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Expose actor, file, version, target, attempt, time and result separately from SQL queries.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: Query history cannot appear as proof that a migration version was applied.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Query history cannot appear as proof that a migration version was applied.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-013

**Raw-file checksum enforcement** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Reject changes to any included applied version using SHA-256 over original bytes.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE-CHECK](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service_check.go#L389-L431); [FW-CHECKSUM](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java#L322-L342). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-008, MIG-025 **Operational value:** Critical: One changed byte in an applied file blocks both planning and dispatch.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- One changed byte in an applied file blocks both planning and dispatch.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-014

**Schema drift detection** — Migration Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Compare approved metadata snapshots and observed definitions outside deployment.

**Persona:** Database release engineer. **Reference products:** bablsoft/accessflow, bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-DRIFT](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L478-L498); [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: A manually added column produces a scoped drift finding rather than rewriting history.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A manually added column produces a scoped drift finding rather than rewriting history.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-015

**Approved schema baseline** — Migration Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Record a reviewed baseline for preexisting schemas without pretending SQL executed.

**Persona:** Database release engineer. **Reference products:** flyway/flyway, liquibase/liquibase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [LB4-STATE](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java#L45-L67). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries. Only pinned 4.33.0 source is Apache-2.0 here; current 5.x source is FSL; JDBC and binary payload require separate review.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: Baseline has separate state, snapshot, versions/hashes and independent approval.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Baseline has separate state, snapshot, versions/hashes and independent approval.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-016

**Repeatable migration files** — Migration Management; ENHANCEMENT; P2 / V2; complexity L.

**Description / expected behavior:** Support content-triggered repeatables after deterministic versioned files.

**Persona:** Database release engineer. **Reference products:** flyway/flyway. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Changed repeatable content requires a fresh plan and checksum; unchanged content is skipped.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Changed repeatable content requires a fresh plan and checksum; unchanged content is skipped.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-017

**Failed migration recovery** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Place partial/unknown work on HOLD and require evidence-based recovery authorization.

**Persona:** Database release engineer. **Reference products:** flyway/flyway, bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362); [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-026, OPS-005 **Operational value:** Critical: A CREATE followed by failing ALTER cannot be blindly replayed.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A CREATE followed by failing ALTER cannot be blindly replayed.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-018

**Idempotent deployment API** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Bind idempotency key to actor, action and complete request digest.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [AF-REST](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L235-L244). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** GOV-002, GOV-018 **Operational value:** Critical: Same key/body returns same job; same key/different targets returns conflict.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Same key/body returns same job; same key/different targets returns conflict.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-019

**Target mutex across all aliases** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Serialize all managed streams and service aliases touching one schema.

**Persona:** Database release engineer. **Reference products:** flyway/flyway, Oracle. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492); [ORACLE-LOCK](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-019, DBM-023 **Operational value:** Critical: Two workers through different aliases never execute statements concurrently.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Two workers through different aliases never execute statements concurrently.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-020

**Safe migration retry admission** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Retry SQL only after proven no effects or an explicitly approved recovery plan.

**Persona:** Database release engineer. **Reference products:** flyway/flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: Network loss cannot cause automatic retry of a PL/SQL or DDL file.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Network loss cannot cause automatic retry of a PL/SQL or DDL file.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-021

**Release promotion ladder** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Require same release digest and verified predecessor results for each stage.

**Persona:** Database release engineer. **Reference products:** bablsoft/accessflow, bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-PROM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175); [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-031, SQL-019, GOV-002 **Operational value:** Critical: PROD API dispatch is denied while UAT is pending, failed, invalid or unknown.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- PROD API dispatch is denied while UAT is pending, failed, invalid or unknown.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-022

**Multi-database rollout** — Migration Management; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Track explicit per-target outcomes with bounded parallelism and stop policy.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, oceanbase/odc. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [P-ODC-BATCH-MODEL](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java#L1-L82). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Failure on one target halts undispatched targets without mislabeling completed ones.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Failure on one target halts undispatched targets without mislabeling completed ones.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-023

**Reviewed corrective migrations** — Migration Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Use fix-forward versions linked to recovery evidence and application compatibility.

**Persona:** Database release engineer. **Reference products:** sqitchers/sqitch, flyway/flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [SQ-EXEC](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1041-L1068); [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: A correction cannot bypass an unresolved lower-version HOLD.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A correction cannot bypass an unresolved lower-version HOLD.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-024

**Automatic Oracle DDL rollback** — Migration Management; REJECTED; WONT / REJECTED; complexity NOT_ESTIMATED.

**Description / expected behavior:** Reject any claim that an arbitrary Oracle release can be atomically rolled back.

**Persona:** Database release engineer. **Reference products:** Oracle. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [ORACLE-COMMIT](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Avoid false safety claims, unnecessary scope or incompatible licensing.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- UI describes committed partial effects and never promises transaction rollback for DDL.
- No implementation of this rejected behavior is included in the core product.

### MIG-025

**Target-local ledger** — Migration Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Persist immutable stream/version/checksum application receipts in the actual schema.

**Persona:** Database release engineer. **Reference products:** flyway/flyway, liquibase/liquibase, sqitchers/sqitch. **Native Bytebase:** NOT_FOUND_IN_REVIEW. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [LB4-STATE](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java#L45-L67); [SQ-STATE](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L29-L52). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries. Only pinned 4.33.0 source is Apache-2.0 here; current 5.x source is FSL; JDBC and binary payload require separate review.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, DBM-023 **Operational value:** Critical: Target history survives central outage and distinguishes baseline from executed application.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Target history survives central outage and distinguishes baseline from executed application.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-026

**Hybrid history and reconciliation** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Keep central approval/admission history plus local target receipts and reconcile both.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** NOT_FOUND_IN_REVIEW. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-025, SEC-011, OPS-001 **Operational value:** Critical: Local success with missing central completion restores evidence without replaying SQL.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Local success with missing central completion restores evidence without replaying SQL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-027

**Statement-level diagnostics** — Migration Management; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Record file/version/source range and database error for acknowledged statement calls.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: A failing statement is locatable in the retained original file.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A failing statement is locatable in the retained original file.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-028

**Exact plan history precondition** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Bind ledger snapshot digest and invalidate a plan when target history changes.

**Persona:** Database release engineer. **Reference products:** flyway/flyway. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [FW-CHECKSUM](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java#L322-L342). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-010, MIG-019 **Operational value:** Critical: A concurrent completed deployment requires a new plan/approval even if pending files shrink.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A concurrent completed deployment requires a new plan/approval even if pending files shrink.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-029

**Per-target zero-pending success** — Migration Management; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Record a checked NOOP run without migration statements.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, liquibase/liquibase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [LB4-SKIP](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java#L15-L77). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Only pinned 4.33.0 source is Apache-2.0 here; current 5.x source is FSL; JDBC and binary payload require separate review.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Critical: Replanning an applied five-file release yields zero effects and a no-op receipt.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Replanning an applied five-file release yields zero effects and a no-op receipt.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-030

**Out-of-order migration policy** — Migration Management; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Default deny lower new versions beneath applied head; require a reviewed exception.

**Persona:** Database release engineer. **Reference products:** flyway/flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-EXEC](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Adding V002 below deployed V003 blocks without explicit exception policy.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Adding V002 below deployed V003 blocks without explicit exception policy.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-031

**Preconditions and postconditions** — Migration Management; ENHANCEMENT; P0 / MVP; complexity L.

**Description / expected behavior:** Bind read-only semantic checks and required objects to the approved manifest.

**Persona:** Database release engineer. **Reference products:** sqitchers/sqitch, liquibase/liquibase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [SQ-EVENTS](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141); [LB4-EXEC](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java#L115-L143). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Only pinned 4.33.0 source is Apache-2.0 here; current 5.x source is FSL; JDBC and binary payload require separate review.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** SQL-019 **Operational value:** Critical: A failed mandatory postcondition prevents VERIFIED_SUCCESS and promotion.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A failed mandatory postcondition prevents VERIFIED_SUCCESS and promotion.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-032

**Migration stream namespaces** — Migration Management; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Keep stable stream identity independent of folder renames and protect cross-stream ordering.

**Persona:** Database release engineer. **Reference products:** sqitchers/sqitch, flyway/flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [SQ-STATE](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L29-L52); [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: Renaming a folder cannot cause deployed versions to execute again.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Renaming a folder cannot cause deployed versions to execute again.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-033

**Schema comparison and sync** — Migration Management; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Generate reviewed difference plans with engine-specific limitations.

**Persona:** Database release engineer. **Reference products:** bytebase/bytebase, oceanbase/odc-doc. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217); [P-ODC-SCHEMA-DIFF-DOC](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/900.structural-comparison.md#L5-L36). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** DBM-007, SEC-005 **Operational value:** Useful: A diff never executes directly and warns about unsupported Oracle object kinds.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A diff never executes directly and warns about unsupported Oracle object kinds.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### MIG-034

**Restore divergence detection** — Migration Management; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Quarantine restored central or target history until both are reconciled.

**Persona:** Database release engineer. **Reference products:** flyway/flyway, bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Oracle DDL/PLSQL may commit independently; target history absence cannot prove no effects.

**Security:** Bind artifact, target and options to independent approval; uncertainty blocks replay.

**Dependencies:** MIG-026, OPS-012 **Operational value:** Critical: A rewound Oracle ledger cannot silently make old data migrations pending.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A rewound Oracle ledger cannot silently make old data migrations pending.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-001

**Change request and issue creation** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Create an accountable request for one immutable plan revision.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** MIG-010, PRJ-003 **Operational value:** Critical: Request links requester, release, target set and intent digest.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Request links requester, release, target set and intent digest.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-002

**Independent plan approval** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Require an authenticated independent approver for the frozen plan.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** GOV-001, GOV-007 **Operational value:** Critical: Author and last editor approvals are denied through UI and direct API.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Author and last editor approvals are denied through UI and direct API.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-003

**Multi-stage approval** — Change Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Resolve ordered review stages under a versioned template.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Stage two cannot approve before stage one satisfies its required quorum.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Stage two cannot approve before stage one satisfies its required quorum.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-004

**Dynamic approvers** — Change Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Resolve approver candidates from role, project, environment and risk.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Candidate membership is recorded and eligibility is rechecked at decision time.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Candidate membership is recorded and eligibility is rechecked at decision time.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-005

**Environment-specific approval** — Change Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Apply stronger approver/quorum requirements to production targets.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: A DEV template cannot satisfy a PROD intent.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A DEV template cannot satisfy a PROD intent.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-006

**Segregation of duties** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Separate author, reviewer and execution authorization on every entry point.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Critical: Requester cannot bypass deployer permission using CI, scheduler or SQL console.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Requester cannot bypass deployer permission using CI, scheduler or SQL console.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-007

**Self-approval and last-editor restrictions** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Exclude requester and every authenticated SQL/target/postcheck editor contributing to the current intent; later metadata edits cannot erase exclusions.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004 **Operational value:** Critical: Changing only the target still makes that editor ineligible to approve.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Changing only the target still makes that editor ineligible to approve.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.
- Two successive substantive editors both remain ineligible after a third actor changes only request metadata.

### GOV-008

**Approval templates** — Change Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Version reusable templates with roles/quorum/expiry and mandatory organization controls.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Deleting a template does not erase historical decisions.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Deleting a template does not erase historical decisions.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-009

**Approval expiration** — Change Governance; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Set explicit decision validity and check it again at dispatch.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Critical: Expired approval fails admission even if the UI remains open.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Expired approval fails admission even if the UI remains open.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-010

**Rejection and resubmission** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Persist rejection and create a fresh plan revision for changed intent.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Critical: Resubmitting edited SQL cannot reuse an old approval.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Resubmitting edited SQL cannot reuse an old approval.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-011

**Approval revocation** — Change Governance; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Revoke future execution and place active work into controlled stop/HOLD.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Critical: A revoked queued deployment cannot start; committed effects remain recorded.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A revoked queued deployment cannot start; committed effects remain recorded.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-012

**SQL or target edits invalidate approval** — Change Governance; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Treat every SQL, target, option or postcheck change as a new immutable intent.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247); [BB-PLAN-DISCOVERY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/plan_service.proto#L18-L185). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Critical: A changed schema or statement hash rejects old approval at dispatch.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A changed schema or statement hash rejects old approval at dispatch.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-013

**Immutable approved artifacts** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Approve retained artifact and statement hashes with full provenance.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** MIG-008 **Operational value:** Critical: Replacing a file in storage fails hash verification before any SQL.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Replacing a file in storage fails hash verification before any SQL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-014

**Deployment windows** — Change Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Check explicit timezone/window rules and record blackout exceptions.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: A delayed queued job cannot start outside its approved window.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A delayed queued job cannot start outside its approved window.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-015

**Scheduled execution** — Change Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Schedule admission while rechecking approval, history and current permissions.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: A schedule does not retain authority after approver grant revocation.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A schedule does not retain authority after approver grant revocation.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-016

**Emergency change workflow** — Change Governance; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Use time-bound two-person exceptions with narrow targets and mandatory retrospective evidence.

**Persona:** Approver, DBA. **Reference products:** bablsoft/accessflow. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Break-glass cannot replace artifact checks, mutexes or recovery holds.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Break-glass cannot replace artifact checks, mutexes or recovery holds.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-017

**Hotfix release workflow** — Change Governance; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Keep hotfix lineage, explicit predecessor exceptions and reconciliation into normal stream.

**Persona:** Approver, DBA. **Reference products:** bablsoft/accessflow. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [AF-PROM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: A PROD hotfix cannot silently diverge the future UAT promotion artifact.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A PROD hotfix cannot silently diverge the future UAT promotion artifact.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-018

**Execution authorization** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Check deployer permission and scoped worker admission independent of approval.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004 **Operational value:** Critical: An approver without deployer permission cannot dispatch SQL.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An approver without deployer permission cannot dispatch SQL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-019

**Risk-based approval routing** — Change Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Use explainable deterministic risk inputs before optional automated risk analysis.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154); [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Unknown PL/SQL effects yield elevated/manual review rather than low-risk auto-approval.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Unknown PL/SQL effects yield elevated/manual review rather than low-risk auto-approval.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-020

**Review comments and evidence attachments** — Change Governance; BASELINE; P1 / V1; complexity S.

**Description / expected behavior:** Attach discussions/evidence to immutable intent revisions with scoped access.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Attachments cannot change executable content or expose another project's SQL.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Attachments cannot change executable content or expose another project's SQL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-021

**Approval inbox and delegation** — Change Governance; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Offer assigned inbox filters; temporary delegation rechecks author exclusion.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Delegated approver cannot approve an intent they authored.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Delegated approver cannot approve an intent they authored.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-022

**Manual continuation between stages** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Continue only after verified lower-stage evidence and required approval.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Critical: Manual continue API cannot skip a failed predecessor.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Manual continue API cannot skip a failed predecessor.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-023

**Approval decision audit** — Change Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Persist actor/eligibility/intent/policy/time/reason for every decision and denial.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-APPROVAL-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588); [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Critical: Auditor can reconstruct all approval revisions after project transfer.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Auditor can reconstruct all approval revisions after project transfer.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-024

**Execution cancellation semantics** — Change Governance; DIFFERENTIATOR; P1 / V1; complexity M.

**Description / expected behavior:** Record requested cancellation separately from confirmed session stop and target outcome.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Cancellation during DDL yields UNKNOWN or observed partial state, never implied rollback.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Cancellation during DDL yields UNKNOWN or observed partial state, never implied rollback.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GOV-025

**Policy change revalidation** — Change Governance; DIFFERENTIATOR; P1 / V1; complexity M.

**Description / expected behavior:** Apply current minimum security policy at dispatch with versioned plan binding.

**Persona:** Approver, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Every schema/environment requires a target-specific intent; committed Oracle effects survive cancellation.

**Security:** Deny requester and all substantive editors of the current intent; recheck permission/policy/expiry at dispatch.

**Dependencies:** PRJ-004, MIG-008 **Operational value:** Useful: Tightening PROD policy blocks an old plan until reviewed under the new revision.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Tightening PROD policy blocks an old plan until reviewed under the new revision.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-001

**Web SQL editor** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Provide governed interactive queries only after migration path is reliable.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SQL-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/sqlEditor.tsx#L1-L86). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Editor write operations cannot bypass managed schema migration controls.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Editor write operations cannot bypass managed schema migration controls.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-002

**Syntax highlighting** — SQL and Review; OPTIONAL; P2 / V2; complexity S.

**Description / expected behavior:** Highlight Oracle SQL and PL/SQL in independent UI components.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SQL-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/sqlEditor.tsx#L1-L86). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Quoted text and PL/SQL bodies display without modifying retained bytes.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Quoted text and PL/SQL bodies display without modifying retained bytes.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-003

**Metadata autocomplete** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Suggest only objects visible to the current principal.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Autocomplete does not reveal another project's object names.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Autocomplete does not reveal another project's object names.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-004

**Schema browsing** — SQL and Review; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Navigate authorized tables/routines and visible definitions.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-DATABASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Hidden routine text cannot be fetched through a guessed object URL.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Hidden routine text cannot be fetched through a guessed object URL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-005

**Interactive SQL execution** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Execute bounded queries with separate read-only credentials and policy.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: A read-only editor principal cannot execute UPDATE or hidden PL/SQL writes.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A read-only editor principal cannot execute UPDATE or hidden PL/SQL writes.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-006

**Query history** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Store query attempts under query-specific retention and access.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Query history is clearly separate from versioned migration history.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Query history is clearly separate from versioned migration history.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-007

**Query result export** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Require independent export permission and bounded results.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Query permission without export permission cannot download result files.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Query permission without export permission cannot download result files.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-008

**SQL review rule configuration** — SQL and Review; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Version engine-aware naming, destructive-change and style rules.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: A blocking rule finding prevents dispatch on every API path.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A blocking rule finding prevents dispatch on every API path.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-009

**Static SQL linting** — SQL and Review; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Report deterministic rule findings tied to statement hashes.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Reformatting cannot conceal a changed SQL hash after approval.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Reformatting cannot conceal a changed SQL hash after approval.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-010

**Destructive statement review** — SQL and Review; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Flag obvious destructive SQL and mark opaque PL/SQL effects for manual review.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: DROP TABLE requires explicit risk acknowledgement; dynamic SQL is not certified safe.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- DROP TABLE requires explicit risk acknowledgement; dynamic SQL is not certified safe.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-011

**Sensitive data controls** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Apply authorized classification/masking/export controls to interactive results.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-QUERY-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/org_policy_service.go#L680-L728). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Denied columns remain inaccessible through query and export routes.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Denied columns remain inaccessible through query and export routes.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-012

**Query and export permissions** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Separate query, export, admin execution and migration permissions.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Granting query access cannot authorize release execution.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Granting query access cannot authorize release execution.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-013

**Read-only query sessions** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Enforce read-only access with real target grants and session constraints.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-READONLY-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/instance_service.go#L1215-L1245). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: A read-only label on a writer credential is rejected.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A read-only label on a writer credential is rejected.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-014

**Explain plan** — SQL and Review; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Offer cost/plan information with engine-specific privileges and side-effect warnings.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SQL-OPTIONS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L105-L195). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: EXPLAIN does not count as execution validation or proof of safe resource use.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- EXPLAIN does not count as execution validation or proof of safe resource use.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-015

**Exact execution preview** — SQL and Review; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Show pending statement bytes/ranges and target intent before approval.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PLAN-DISCOVERY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/plan_service.proto#L18-L185). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-020, SEC-006 **Operational value:** Critical: Preview digest matches the worker's parsed statement digest.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Preview digest matches the worker's parsed statement digest.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-016

**Oracle PL/SQL scripts** — SQL and Review; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Execute procedures/functions/triggers/anonymous blocks through a mature splitter.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase, flyway/flyway. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218); [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-020, SEC-006 **Operational value:** Critical: All required PL/SQL fixtures preserve body boundaries and result semantics on 19c/21c.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- All required PL/SQL fixtures preserve body boundaries and result semantics on 19c/21c.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-017

**Oracle script splitting** — SQL and Review; ENHANCEMENT; P0 / MVP; complexity L.

**Description / expected behavior:** Preserve q-quotes, comments, internal semicolons and standalone slash delimiters.

**Persona:** Developer, DBA. **Reference products:** flyway/flyway, bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200); [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** MIG-009 **Operational value:** Critical: No slash delimiter is sent as SQL and q-quoted semicolons do not split statements.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- No slash delimiter is sent as SQL and q-quoted semicolons do not split statements.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-018

**Package specification and body validation** — SQL and Review; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Validate each expected owner/name/object-type independently.

**Persona:** Developer, DBA. **Reference products:** hhyo/Archery, Oracle. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [ORACLE-ERRORS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** SQL-017, SQL-019 **Operational value:** Critical: VALID specification with INVALID body prevents VERIFIED_SUCCESS.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- VALID specification with INVALID body prevents VERIFIED_SUCCESS.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-019

**Required object validity gate** — SQL and Review; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Require expected objects to exist and be VALID with known dictionary visibility.

**Persona:** Developer, DBA. **Reference products:** hhyo/Archery, Oracle. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [ORACLE-ERRORS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-020 **Operational value:** Critical: Missing object or inaccessible compiler diagnostics blocks final success.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Missing object or inaccessible compiler diagnostics blocks final success.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-020

**Compiler diagnostics explorer** — SQL and Review; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Display compiler name/type/line/position/text and map to retained source.

**Persona:** Developer, DBA. **Reference products:** hhyo/Archery, Oracle. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [ORACLE-ERRORS](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-020, SEC-006 **Operational value:** Critical: A PL/SQL compiler ERROR is shown even if driver execution returned success.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A PL/SQL compiler ERROR is shown even if driver execution returned success.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-021

**SQL*Plus command profile** — SQL and Review; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Keep slash delimiters in core but reject unsupported SQL*Plus executable directives.

**Persona:** Developer, DBA. **Reference products:** flyway/flyway, Flyway. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [FW-PARSER](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200); [FW-ORACLE-DOC](https://documentation.red-gate.com/flyway/reference/database-driver-reference/oracle-database). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: SET, HOST and unapproved includes fail before execution under MVP profile.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- SET, HOST and unapproved includes fail before execution under MVP profile.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-022

**Saved and shared SQL scripts** — SQL and Review; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Store access-controlled personal/team queries with explicit execution intent.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SAVED](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/saved_query_service.proto#L1-L124). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: A saved script cannot grant its creator's database access to another user.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A saved script cannot grant its creator's database access to another user.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-023

**Visual query builder** — SQL and Review; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Explore metadata-driven query composition if operator demand exists.

**Persona:** Developer, DBA. **Reference products:** dbgate/dbgate. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [DBGATE-README](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/README.md#L1-L100). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** GPL-3.0 application/plugin: independent UX study; no embedding into proposed Apache core without explicit compatibility review.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: Generated query remains subject to the same permissions and result limits.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Generated query remains subject to the same permissions and result limits.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-024

**Batch query UX** — SQL and Review; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Show independent results for authorized read queries across targets.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: One denied target cannot expose data through a merged result grid.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- One denied target cannot expose data through a merged result grid.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SQL-025

**Oracle dependency-aware object checks** — SQL and Review; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Inspect affected dependencies and new invalid objects beyond directly changed objects.

**Persona:** Developer, DBA. **Reference products:** bytebase/bytebase, oceanbase/odc-doc. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156); [P-ODC-SCHEMA-DIFF-DOC](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/900.structural-comparison.md#L5-L36). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Use Oracle-aware boundaries and object-type-specific validity, including package body.

**Security:** Interactive/admin SQL must not bypass the managed migration path; protect result/definition visibility.

**Dependencies:** DBM-005, SEC-006 **Operational value:** Useful: New invalid dependent view blocks promotion; dynamic dependency limits are explicit.

**Design:** [UI-UX-FEATURE-MAP.md](UI-UX-FEATURE-MAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- New invalid dependent view blocks promotion; dynamic dependency limits are explicit.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-001

**Local authentication** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Provide secure local identities for offline operation with invite-only setup.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** Foundational capability; no catalog prerequisite. **Operational value:** Critical: Unauthenticated endpoints disclose no SQL or catalog resources.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Unauthenticated endpoints disclose no SQL or catalog resources.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-002

**LDAP federation** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Integrate LDAP through maintained identity components with explicit group mapping.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase, hhyo/Archery. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-IDP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242); [AR-LDAP](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/archery/settings.py#L360-L387). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Removing an LDAP group grant denies subsequent authorized actions.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Removing an LDAP group grant denies subsequent authorized actions.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-003

**OIDC single sign-on** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Use an on-prem OIDC provider with issuer/audience/state/nonce checks.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-IDP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Tokens with wrong issuer or audience are rejected.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Tokens with wrong issuer or audience are rejected.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-004

**OAuth2 social login** — Security and Governance; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Offer optional provider login only for connected installations.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-IDP](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Offline core operation never requires a social account.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Offline core operation never requires a social account.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-005

**Role-based authorization** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Enforce fixed roles centrally for UI/API and worker admission.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** SEC-001, PRJ-001 **Operational value:** Critical: Direct API calls have the same authorization result as UI actions.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Direct API calls have the same authorization result as UI actions.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-006

**Resource-level permissions** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Authorize stable project/schema resources at every read/write boundary.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216); [BB-DATABASE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Critical: Guessable IDs never bypass object authorization.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Guessable IDs never bypass object authorization.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-007

**Database/schema access grants** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Grant scoped temporary or permanent data-access actions independently of ownership.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ACCESS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/access_grant_service.proto#L15-L144). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Grant on one schema cannot authorize another schema through the shared endpoint.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Grant on one schema cannot authorize another schema through the shared endpoint.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-008

**Approval policy enforcement** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Apply independent approval as a server admission condition.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT-SETTINGS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** GOV-002 **Operational value:** Critical: Missing, invalid or expired approval denies worker dispatch.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Missing, invalid or expired approval denies worker dispatch.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-009

**Scoped secrets provider** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Use versioned secret references with API/worker separation and no plaintext catalog storage.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** Foundational capability; no catalog prerequisite. **Operational value:** Critical: API cannot read PROD writer secrets while a scoped worker can fetch its admitted target secret.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- API cannot read PROD writer secrets while a scoped worker can fetch its admitted target secret.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-010

**Credential encryption and redaction** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Avoid plaintext in metadata/logs and protect secrets at rest using existing Kubernetes controls.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Critical: Known-secret scan finds no credentials in exported research/deployment evidence.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Known-secret scan finds no credentials in exported research/deployment evidence.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-011

**Complete change audit trail** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Persist change/security decisions, denials and recovery events with retention policy.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** SEC-001 **Operational value:** Critical: Audit reconstructs WHO/WHAT/WHERE/WHEN/HOW/RESULT for a completed and failed attempt.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Audit reconstructs WHO/WHAT/WHERE/WHEN/HOW/RESULT for a completed and failed attempt.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-012

**Activity versus audit separation** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Separate user notifications/comments from durable security evidence.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ISSUE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247); [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Deleting an activity notification cannot delete an approval or audit event.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Deleting an activity notification cannot delete an approval or audit event.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-013

**Deployment evidence bundles** — Security and Governance; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Retain hashed artifacts, decisions, receipts and compiler/postcheck evidence.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase, sqitchers/sqitch. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); [SQ-EVENTS](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** SEC-011, MIG-011 **Operational value:** Critical: An exported bundle can match each executed file to its approved bytes and target.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An exported bundle can match each executed file to its approved bytes and target.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-014

**Policy enforcement on alternate entry points** — Security and Governance; DIFFERENTIATOR; P0 / MVP; complexity L.

**Description / expected behavior:** Prevent CI, console, scheduler and admin APIs from bypassing managed migration controls.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-SQL-API](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102); [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Critical: A developer denied dispatch cannot execute equivalent SQL through the editor.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A developer denied dispatch cannot execute equivalent SQL through the editor.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-015

**API credentials and key rotation** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Issue hashed, scoped machine credentials with revocation and expiry.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SERVICE-ACCOUNT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/service_account_service.proto#L1-L122). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: A revoked CI key cannot ingest or dispatch further requests.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A revoked CI key cannot ingest or dispatch further requests.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-016

**Named service accounts** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Keep machine actors distinct from human approvers.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SERVICE-ACCOUNT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/service_account_service.proto#L1-L122). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: CI service identity cannot satisfy an independent human approval.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- CI service identity cannot satisfy an independent human approval.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-017

**Network restrictions** — Security and Governance; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Allow only configured Git/Oracle/secret endpoints from restricted workers.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Critical: Requester-supplied URLs or DNS redirects cannot reach metadata or secret endpoints.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Requester-supplied URLs or DNS redirects cannot reach metadata or secret endpoints.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-018

**Web and API TLS** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Terminate verified HTTPS and secure worker transport in the on-prem deployment.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-CONNECTION](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Critical: Session cookies/tokens never transit plaintext outside the trusted pod boundary.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Session cookies/tokens never transit plaintext outside the trusted pod boundary.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-019

**Session lifecycle and logout** — Security and Governance; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Use secure cookies, idle/absolute expiry, CSRF controls and immediate revocation checks.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Critical: Logged-out or revoked sessions cannot approve queued work.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Logged-out or revoked sessions cannot approve queued work.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-020

**Compliance reports** — Security and Governance; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Produce traceable control evidence without claiming compliance certification.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: A report identifies retention gaps and links to underlying immutable evidence.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A report identifies retention gaps and links to underlying immutable evidence.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-021

**Custom RBAC roles** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Add validated role definitions beneath organization minimum controls.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLE-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/role_service.go#L68-L88). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Custom roles cannot disable separation or expose secrets through wildcard permissions.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Custom roles cannot disable separation or expose secrets through wildcard permissions.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-022

**User groups** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Resolve membership groups into resource grants with revocation semantics.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Group removal is effective at approval and dispatch rechecks.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Group removal is effective at approval and dispatch rechecks.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-023

**Multi-factor authentication** — Security and Governance; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Require MFA through the identity provider for privileged production actions.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: An unenrolled privileged principal cannot approve PROD changes.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An unenrolled privileged principal cannot approve PROD changes.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-024

**SCIM provisioning** — Security and Governance; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Support automated identity lifecycle after SSO stabilizes.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Deprovisioning revokes project grants and active session authority.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Deprovisioning revokes project grants and active session authority.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-025

**Just-in-time database access** — Security and Governance; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Approve scoped access duration and automatically expire it.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ACCESS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/access_grant_service.proto#L15-L144). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Query after expiry is denied even when connection pooling keeps a session open.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Query after expiry is denied even when connection pooling keeps a session open.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-026

**Data classification and masking** — Security and Governance; BASELINE; P2 / V2; complexity L.

**Description / expected behavior:** Classify columns and enforce result masking under reviewed rules.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-CATALOG](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_catalog_service.proto#L1-L110); [BB-QUERY-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/org_policy_service.go#L680-L728). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. Enterprise approval/identity/custom role/access policy boundary applies; verify exact gate.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Raw results cannot bypass masking through export or alternate query API.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Raw results cannot bypass masking through export or alternate query API.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-027

**Workload identity federation** — Security and Governance; ENHANCEMENT; P2 / V2; complexity L.

**Description / expected behavior:** Replace long-lived CI keys with issuer-bound short-lived identities where available.

**Persona:** Security engineer, auditor. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-WORKLOAD](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/workload_identity_service.proto#L1-L140). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Wrong repository/environment claims fail authorization.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Wrong repository/environment claims fail authorization.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### SEC-028

**Audit tamper evidence and external retention** — Security and Governance; DIFFERENTIATOR; P1 / V1; complexity M.

**Description / expected behavior:** Export signed/digested evidence to independently controlled storage.

**Persona:** Security engineer, auditor. **Reference products:** bablsoft/accessflow, bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-SIEM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1018-L1036); [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Use schema-scoped grants and verify discovery/writer separation rather than UI labels.

**Security:** Fail closed on missing identity/scope/evidence and redact secrets from all output.

**Dependencies:** PRJ-001 **Operational value:** Useful: Deleting central events creates a detectable export continuity gap.

**Design:** [LICENSE-COMPLIANCE.md](LICENSE-COMPLIANCE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Deleting central events creates a detectable export continuity gap.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-001

**GitLab repository integration** — GitOps and CI/CD; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Read a permitted self-hosted GitLab repository at an immutable commit.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase, bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Critical: A GitLab token needs read-only repository scope and cannot approve deployments.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A GitLab token needs read-only repository scope and cannot approve deployments.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-002

**GitHub provider adapter** — GitOps and CI/CD; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Use the same release contract for GitHub without provider-specific migration semantics.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase, bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table. Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: Equivalent files produce the same raw hashes through both providers.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Equivalent files produce the same raw hashes through both providers.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-003

**Repository connection and test** — GitOps and CI/CD; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Bind provider/repository identity and check access without exposing token values.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Critical: A repository test verifies the allowed project/folder and redacts authentication failures.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A repository test verifies the allowed project/folder and redacts authentication failures.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-004

**Branch and tag selection** — GitOps and CI/CD; BASELINE; P1 / V1; complexity S.

**Description / expected behavior:** Allow branch/tag selection only to resolve an immutable commit during ingestion.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: A tag moved after ingestion does not mutate release bytes.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A tag moved after ingestion does not mutate release bytes.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-005

**Merge request SQL checks** — GitOps and CI/CD; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Publish nonprivileged validation/risk findings against the exact MR commit.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow, bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410); [BB-POLICY](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: An untrusted MR job cannot retrieve PROD credentials or dispatch SQL.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An untrusted MR job cannot retrieve PROD credentials or dispatch SQL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-006

**Commit and source provenance** — GitOps and CI/CD; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Record full repository and commit identity in each manifest/evidence bundle.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** GIT-003 **Operational value:** Critical: A release at a short ambiguous SHA is rejected until resolved fully.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A release at a short ambiguous SHA is rejected until resolved fully.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-007

**Immutable release artifact retention** — GitOps and CI/CD; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Retain content-addressed bytes independent of Git server availability.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** MIG-008 **Operational value:** Critical: Approved deployment still validates stored bytes when Git is temporarily offline.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Approved deployment still validates stored bytes when Git is temporarily offline.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-008

**CI trigger ingestion** — GitOps and CI/CD; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Accept authenticated ingestion requests with bounded idempotency.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: Duplicate CI triggers create one release/request for the same key and body.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Duplicate CI triggers create one release/request for the same key and body.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-009

**Signed webhook ingestion** — GitOps and CI/CD; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Verify provider signatures, delivery IDs and repository allowlists.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [AF-CI](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: Invalid or replayed signatures cannot generate deployment admissions.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Invalid or replayed signatures cannot generate deployment admissions.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-010

**API-driven release and deployment** — GitOps and CI/CD; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Provide stable OpenAPI contracts for ingestion, planning, approvals and status.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: CI can ingest/poll while its credential cannot issue a human approval.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- CI can ingest/poll while its credential cannot issue a human approval.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-011

**Environment promotion integration** — GitOps and CI/CD; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Link CI environment names to platform environment IDs and verified predecessors.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-PROM](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: CI environment labels cannot spoof successful UAT evidence.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- CI environment labels cannot spoof successful UAT evidence.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-012

**Jenkins integration** — GitOps and CI/CD; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Use trusted pipeline adapters to ingest releases and poll platform authority.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow, Jenkins. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129); [JENKINS-INPUT](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: Jenkins input alone is never accepted as a platform approval decision.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Jenkins input alone is never accepted as a platform approval decision.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-013

**Deployment status callbacks** — GitOps and CI/CD; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Send signed idempotent state changes and verification outcomes to CI.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: Repeated or out-of-order callbacks cannot overwrite a terminal newer state.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Repeated or out-of-order callbacks cannot overwrite a terminal newer state.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-014

**Pipeline execution reports** — GitOps and CI/CD; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Link CI run IDs to platform attempts and retained evidence.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: A pipeline green result without platform verification cannot promote PROD.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A pipeline green result without platform verification cannot promote PROD.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-015

**Git drift detection** — GitOps and CI/CD; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Compare deployed release provenance with protected branch policy.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-DRIFT](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L478-L498). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: A new branch head is shown as undeployed, never applied automatically.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A new branch head is shown as undeployed, never applied automatically.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-016

**Protected source configuration** — GitOps and CI/CD; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Protect ingestion bindings and executable adapters from requester edits.

**Persona:** CI engineer. **Reference products:** GitLab. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [GITLAB-APPROVAL](https://docs.gitlab.com/ci/environments/deployment_approvals/). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Critical: Changing repository/folder/runner image invalidates relevant approved intent.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Changing repository/folder/runner image invalidates relevant approved intent.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-017

**GitOps policy as code** — GitOps and CI/CD; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Review policy/configuration changes through versioned repositories and signed reconciliation.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-IAC](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: Imported policy cannot weaken mandatory organization controls.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Imported policy cannot weaken mandatory organization controls.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-018

**Offline Git mirrors and artifacts** — GitOps and CI/CD; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Support local GitLab, artifact retention and internal package mirrors with no SaaS dependency.

**Persona:** CI engineer. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-DR](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1680-L1707). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Critical: End-to-end lab workflow functions with external internet egress disabled.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- End-to-end lab workflow functions with external internet egress disabled.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### GIT-019

**Azure DevOps and Bitbucket adapters** — GitOps and CI/CD; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Add provider adapters only after GitLab/GitHub contracts stabilize.

**Persona:** CI engineer. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-RELEASE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Commit/folder identity is distinct from schema applied history and target generation.

**Security:** CI can ingest and poll but cannot supply human approval or arbitrary privileged SQL.

**Dependencies:** PRJ-008 **Operational value:** Useful: Provider addition does not change approval or ledger semantics.

**Design:** [TECHNOLOGY-DECISIONS.md](TECHNOLOGY-DECISIONS.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Provider addition does not change approval or ledger semantics.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-001

**Durable background job scheduling** — Observability and Operations; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Persist admission/jobs in PostgreSQL and claim bounded work after restart.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** MIG-018 **Operational value:** Critical: API restart retains queued jobs without creating duplicate SQL attempts.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- API restart retains queued jobs without creating duplicate SQL attempts.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-002

**Restricted execution workers** — Observability and Operations; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Run approved jobs in a restricted worker process with scoped secrets.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ORA](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** OPS-001, SEC-009 **Operational value:** Critical: Worker accepts only admitted jobs and cannot execute arbitrary submitted DSNs.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Worker accepts only admitted jobs and cannot execute arbitrary submitted DSNs.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-003

**Execution queues and concurrency budgets** — Observability and Operations; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Apply global/per-service/per-schema budgets independent of user count.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: 500 schemas do not open 500 idle writer connections at startup.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- 500 schemas do not open 500 idle writer connections at startup.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-004

**Read-only job retries** — Observability and Operations; DIFFERENTIATOR; P1 / V1; complexity M.

**Description / expected behavior:** Retry discovery/download failures with backoff while separating SQL attempt recovery.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Retry policy cannot transparently rerun a target statement after uncertain failure.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Retry policy cannot transparently rerun a target statement after uncertain failure.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-005

**Execution state model** — Observability and Operations; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Represent waiting, running, partial, unknown, verifying, verified, no-op and hold explicitly.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: Driver success with failed validity is never displayed as deployed success.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Driver success with failed validity is never displayed as deployed success.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-006

**Structured execution logs** — Observability and Operations; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Retain correlated release/plan/target/attempt/file/range logs with redaction.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: Auditor finds the failing statement without exposing secrets or query result rows.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Auditor finds the failing statement without exposing secrets or query result rows.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-007

**User notifications** — Observability and Operations; BASELINE; P1 / V1; complexity S.

**Description / expected behavior:** Notify scoped actors of pending decisions, failures and holds.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Notifications link authorized resources and do not leak SQL to unauthorized members.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Notifications link authorized resources and do not leak SQL to unauthorized members.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-008

**Email notifications** — Observability and Operations; BASELINE; P1 / V1; complexity S.

**Description / expected behavior:** Use internal SMTP with delivery retry separated from execution outcome.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-SETTING](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: SMTP outage cannot prevent recorded success or cause SQL replay.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- SMTP outage cannot prevent recorded success or cause SQL replay.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-009

**Outbound project webhooks** — Observability and Operations; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Send signed minimal state payloads to allowed recipients.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PROJECT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Webhook failure creates delivery retry only, not a new deployment.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Webhook failure creates delivery retry only, not a new deployment.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-010

**Prometheus metrics** — Observability and Operations; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Expose queue age, holds, verification failures and bounded resource counters.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-METRICS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/server/metrics.go#L1-L39). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Metrics omit SQL, usernames and unbounded schema/file labels.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Metrics omit SQL, usernames and unbounded schema/file labels.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-011

**Health and readiness checks** — Observability and Operations; BASELINE; P0 / MVP; complexity M.

**Description / expected behavior:** Separate process liveness, metadata readiness and target availability.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-METRICS](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/server/metrics.go#L1-L39). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: Oracle outage cannot trigger a liveness restart loop of the control plane.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Oracle outage cannot trigger a liveness restart loop of the control plane.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-012

**Metadata and artifact backup/restore** — Observability and Operations; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Back up approval/catalog/artifact/receipt records and restore into reconciliation hold.

**Persona:** Platform operator. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-DR](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1680-L1707). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-011, GIT-007 **Operational value:** Critical: Restore never dispatches queued jobs until target history agreement is re-established.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Restore never dispatches queued jobs until target history agreement is re-established.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-013

**High availability failover** — Observability and Operations; BASELINE; P1 / V1; complexity L.

**Description / expected behavior:** Scale API/worker replicas while preserving single admitted target execution.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase, Bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [BB-HA-DOC](https://docs.bytebase.com/changelog/bytebase-3-17-0). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Paused old worker and new worker cannot overlap target SQL after lease expiry.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Paused old worker and new worker cannot overlap target SQL after lease expiry.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-014

**Credential-scoped connection pooling** — Observability and Operations; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Allocate bounded lazy homogeneous pools and discard uncertain sessions.

**Persona:** Platform operator. **Reference products:** node-oracledb. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [NODE-THIN-DOC](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: A pooled connection cannot leak owner/session state into another project.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A pooled connection cannot leak owner/session state into another project.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-015

**Operational deployment dashboard** — Observability and Operations; BASELINE; P1 / V1; complexity M.

**Description / expected behavior:** Show per-target stage status, oldest holds, queue age and recovery owners.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Partial rollout totals reconcile with individual target outcomes.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Partial rollout totals reconcile with individual target outcomes.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-016

**Resource usage budgets** — Observability and Operations; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Expose configurable CPU/memory/session limits and queue backpressure.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: A connection storm yields bounded queueing instead of target exhaustion.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A connection storm yields bounded queueing instead of target exhaustion.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-017

**Multiple worker replicas** — Observability and Operations; BASELINE; P1 / V1; complexity L.

**Description / expected behavior:** Use duplicate-tolerant job delivery, session locks and explicit recovery.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Killing a worker after target commit cannot replay a completed migration automatically.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Killing a worker after target commit cannot replay a completed migration automatically.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-018

**Audit and log retention** — Observability and Operations; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Retain required change evidence independently from disposable pod logs.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-AUDIT-GATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-011 **Operational value:** Critical: Deleting a worker pod preserves SQL hashes, decisions and compiler evidence.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Deleting a worker pod preserves SQL hashes, decisions and compiler evidence.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-019

**Graceful shutdown and drain** — Observability and Operations; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Stop new claims, observe active calls and mark unresolved work for reconciliation.

**Persona:** Platform operator. **Reference products:** node-oracledb. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [NODE-THIN-DOC](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: SIGTERM during DDL cannot produce a fabricated rolled-back success/failure.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- SIGTERM during DDL cannot produce a fabricated rolled-back success/failure.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-020

**OpenTelemetry traces** — Observability and Operations; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Correlate API, planning, worker and Oracle calls without recording secret/result payloads.

**Persona:** Platform operator. **Reference products:** OpenTelemetry. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [TECH-OTEL](https://opentelemetry.io/docs/). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: A trace links an attempt to its admission but contains no secret values.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A trace links an attempt to its admission but contains no secret values.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-021

**Cancellation and orphan session tooling** — Observability and Operations; DIFFERENTIATOR; P1 / V1; complexity M.

**Description / expected behavior:** Provide audited observation/termination runbooks and recovery ownership.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase, Oracle. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); [ORACLE-LOCK](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: Stale lease resolution requires session evidence before replacement SQL.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Stale lease resolution requires session evidence before replacement SQL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-022

**On-prem Kubernetes/OpenShift packaging** — Observability and Operations; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Define nonroot containers, PVCs, network policy and offline install instructions.

**Persona:** Platform operator. **Reference products:** oceanbase/odc. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [P-ODC-DEPLOY](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/README.md#L43-L108). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: A disposable OpenShift lab deploys without privileged SCC or external egress.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A disposable OpenShift lab deploys without privileged SCC or external egress.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-023

**Air-gapped updates and SBOM** — Observability and Operations; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Provide dependency pins, notices, SBOM, signed artifacts and offline upgrade bundle.

**Persona:** Platform operator. **Reference products:** SPDX. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [TECH-SPDX](https://spdx.dev/use/specifications/). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: An offline install can verify every required artifact hash and license record.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An offline install can verify every required artifact hash and license record.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-024

**Database performance observability** — Observability and Operations; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Add opt-in low-impact metrics with target edition/pack review.

**Persona:** Platform operator. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-INSTANCE-MODEL](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: No AWR/ASH or Diagnostics Pack query runs without explicit entitlement/configuration.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- No AWR/ASH or Diagnostics Pack query runs without explicit entitlement/configuration.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-025

**Operational recovery case management** — Observability and Operations; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Track hold reason, assigned DBA, evidence, decisions and approved recovery attempts.

**Persona:** Platform operator. **Reference products:** flyway/flyway. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [FW-FAIL](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: Unknown outcomes remain assigned/open until an auditable terminal resolution.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Unknown outcomes remain assigned/open until an auditable terminal resolution.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-026

**Capacity acceptance workload** — Observability and Operations; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Measure inventory and safe queue behavior at 50 services/500 schemas/20 users.

**Persona:** Platform operator. **Reference products:** oceanbase/odc. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [P-ODC-BATCH-MODEL](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java#L1-L82). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Critical: Under that lab scale, one-schema serialization holds and inventory p95 meets agreed budget.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Under that lab scale, one-schema serialization holds and inventory p95 meets agreed budget.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### OPS-027

**Upgrade compatibility and ledger versioning** — Observability and Operations; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Version metadata/target ledger contracts with dry-run upgrade and restore procedures.

**Persona:** Platform operator. **Reference products:** flyway/flyway. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [FW-ORA](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Inspected 13.9.0 Apache-2.0 source; Oracle JDBC separate, SQL*Plus command emulation/advanced features have paid boundaries.

**Oracle:** Lease loss and Oracle session/commit outcome are separate facts; no blind DDL retries.

**Security:** Restrict worker egress/secrets and retain audit evidence beyond disposable logs.

**Dependencies:** SEC-009, MIG-018 **Operational value:** Useful: A worker with unsupported ledger version fails closed before SQL.

**Design:** [MIGRATION-RUNTIME-ARCHITECTURE.md](MIGRATION-RUNTIME-ARCHITECTURE.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A worker with unsupported ledger version fails closed before SQL.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-001

**Oracle definer/invoker rights review** — Additional Features; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Display AUTHID/grant risks and require direct privileges for compiled objects.

**Persona:** DBA, product owner. **Reference products:** hhyo/Archery. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: A package compiling only under unintended ANY privilege fails the approved privilege profile.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A package compiling only under unintended ANY privilege fails the approved privilege profile.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-002

**Oracle dependency-aware rollout** — Additional Features; ENHANCEMENT; P2 / V2; complexity L.

**Description / expected behavior:** Represent explicit cross-schema dependencies and topological stage admission.

**Persona:** DBA, product owner. **Reference products:** sqitchers/sqitch. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [SQ-EXEC](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1041-L1068). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: A dependent target cannot run before its required verified predecessor.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A dependent target cannot run before its required verified predecessor.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-003

**Oracle edition-based redefinition** — Additional Features; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Evaluate EBR as a separately approved deployment capability profile.

**Persona:** DBA, product owner. **Reference products:** node-oracledb. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [NODE-MODES-DOC](https://node-oracledb.readthedocs.io/en/latest/user_guide/appendix_a.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: Edition identity is included in intent and tested independently before use.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Edition identity is included in intent and tested independently before use.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-004

**Oracle online DDL capability profiles** — Additional Features; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Expose version/edition/grant constraints for approved online operations.

**Persona:** DBA, product owner. **Reference products:** Oracle. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [ORACLE-COMMIT](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: A generic online label never bypasses actual Oracle support/entitlement checks.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A generic online label never bypasses actual Oracle support/entitlement checks.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-005

**Sqitch-style verification scripts** — Additional Features; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Separate deploy/check artifacts so correctness can be evaluated independently.

**Persona:** DBA, product owner. **Reference products:** sqitchers/sqitch. **Native Bytebase:** NOT_FOUND_IN_REVIEW. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [SQ-EVENTS](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** New platform design remains subject to exact dependency license review; no source reuse authorized by a feature reference.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: Changing verification SQL invalidates the approval digest.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Changing verification SQL invalidates the approval digest.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-006

**Liquibase-style changeset preconditions** — Additional Features; ENHANCEMENT; P1 / V1; complexity M.

**Description / expected behavior:** Add explicit preconditions without silently MARK_RAN behavior.

**Persona:** DBA, product owner. **Reference products:** liquibase/liquibase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [LB4-EXEC](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java#L115-L143). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Only pinned 4.33.0 source is Apache-2.0 here; current 5.x source is FSL; JDBC and binary payload require separate review.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: Failed prerequisite blocks before SQL and is recorded without fabricated application.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Failed prerequisite blocks before SQL and is recorded without fabricated application.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-007

**Release impact graph** — Additional Features; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Display metadata-derived impact with dynamic-SQL uncertainty.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [BB-ORACLE-SYNC](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: Unknown dependencies are visible and cannot be interpreted as no impact.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Unknown dependencies are visible and cannot be interpreted as no impact.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-008

**Justification and risk acknowledgement** — Additional Features; ENHANCEMENT; P0 / MVP; complexity M.

**Description / expected behavior:** Require purpose, expected effect and recovery notes for destructive changes.

**Persona:** DBA, product owner. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-DEPLOY-DOC](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Critical: A destructive plan lacks admission until explicit reviewer acknowledgement is recorded.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A destructive plan lacks admission until explicit reviewer acknowledgement is recorded.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-009

**Multi-language UI design** — Additional Features; ENHANCEMENT; P1 / V1; complexity S.

**Description / expected behavior:** Use English defaults and externalized strings/timezones from the first screen.

**Persona:** DBA, product owner. **Reference products:** oceanbase/odc-client. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [P-ODC-LOCALE](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/util/intl.tsx#L24-L40). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: English works offline and a second locale does not alter API/resource identifiers.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- English works offline and a second locale does not alter API/resource identifiers.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-010

**Independent Oracle outcome panel** — Additional Features; DIFFERENTIATOR; P0 / MVP; complexity M.

**Description / expected behavior:** Show execution, commit knowledge, ledger and object validity as distinct fields.

**Persona:** DBA, product owner. **Reference products:** hhyo/Archery, bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AR-COMPILE](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); [BB-STATE](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate. Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** SQL-019, MIG-026 **Operational value:** Critical: A DONE/INVALID case displays verification failure and blocks promotion.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- A DONE/INVALID case displays verification failure and blocks promotion.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-011

**SQL review assistant using local AI** — Additional Features; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Offer optional local risk explanations with explicit human/policy authority.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-AI](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/ai_service.proto#L1-L107). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: Removing AI configuration does not remove core approval or runtime correctness.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Removing AI configuration does not remove core approval or runtime correctness.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-012

**Automatic AI approval or recovery** — Additional Features; REJECTED; WONT / REJECTED; complexity NOT_ESTIMATED.

**Description / expected behavior:** Keep approval/recovery decisions explicit and independently authenticated.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [BB-AI](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/ai_service.proto#L1-L107). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Avoid false safety claims, unnecessary scope or incompatible licensing.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Model output cannot authorize SQL replay or waive unknown target state.
- No implementation of this rejected behavior is included in the core product.

### EXT-013

**MCP read-only discovery** — Additional Features; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Expose authorized catalog/evidence tools after API security stabilizes.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: An agent receives no broader visibility than its authenticated principal.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An agent receives no broader visibility than its authenticated principal.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-014

**MCP autonomous production writes** — Additional Features; REJECTED; WONT / REJECTED; complexity NOT_ESTIMATED.

**Description / expected behavior:** Exclude autonomous unreviewed production SQL from product scope.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-ROUTES](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Avoid false safety claims, unnecessary scope or incompatible licensing.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- No MCP tool can skip approval/admission/verification.
- No implementation of this rejected behavior is included in the core product.

### EXT-015

**Terraform/IaC inventory provider** — Additional Features; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Manage catalog/policy configuration through reviewed IaC resources.

**Persona:** DBA, product owner. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-IAC](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: Provider readbacks never return secrets or overwrite historical evidence.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Provider readbacks never return secrets or overwrite historical evidence.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-016

**Data backup and data rollback previews** — Additional Features; OPTIONAL; P2 / V2; complexity L.

**Description / expected behavior:** Explore approved DML recovery with data volume, privacy and engine restrictions.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-ROLLOUT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: Feature is never advertised as general Oracle DDL rollback.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Feature is never advertised as general Oracle DDL rollback.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.

### EXT-017

**Arbitrary data import/export tooling** — Additional Features; REJECTED; WONT / REJECTED; complexity NOT_ESTIMATED.

**Description / expected behavior:** Keep bulk movement outside the safe-migration core until separate product need exists.

**Persona:** DBA, product owner. **Reference products:** dbgate/dbgate. **Native Bytebase:** UNKNOWN. **Source availability:** UNKNOWN for native Bytebase behavior; cited material supplies context or another product reference.

**Evidence:** [DBGATE-README](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/README.md#L1-L100). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** GPL-3.0 application/plugin: independent UX study; no embedding into proposed Apache core without explicit compatibility review.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Avoid false safety claims, unnecessary scope or incompatible licensing.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- MVP contains no ad hoc bulk import route bypassing review.
- No implementation of this rejected behavior is included in the core product.

### EXT-018

**Vendor branding and identical UI assets** — Additional Features; REJECTED; WONT / REJECTED; complexity NOT_ESTIMATED.

**Description / expected behavior:** Design independent English UI assets and names.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** NOT_FOUND_IN_REVIEW. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [BB-L](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE#L1-L25); [BB-ENT](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE.enterprise#L1-L26). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Avoid false safety claims, unnecessary scope or incompatible licensing.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- Asset/license review finds no copied vendor branding or proprietary components.
- No implementation of this rejected behavior is included in the core product.

### EXT-019

**Commercial instance/user quotas** — Additional Features; REJECTED; WONT / REJECTED; complexity NOT_ESTIMATED.

**Description / expected behavior:** Exclude artificial product/license quotas; retain configurable operational budgets.

**Persona:** DBA, product owner. **Reference products:** bytebase/bytebase. **Native Bytebase:** SOURCE_VERIFIED. **Source availability:** Public cited contract/path exists; runtime and edition scope must be checked.

**Evidence:** [BB-PLAN](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Bytebase mixed MIT/restricted enterprise and enablement code; functional study only. API/source presence does not establish free entitlement; consult edition table.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Avoid false safety claims, unnecessary scope or incompatible licensing.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- 51st endpoint and 21st user are accepted subject only to actual capacity/authorization.
- No implementation of this rejected behavior is included in the core product.

### EXT-020

**Public extensibility API** — Additional Features; ENHANCEMENT; P2 / V2; complexity L.

**Description / expected behavior:** Version engine/provider adapter contracts and publish conformance fixtures.

**Persona:** DBA, product owner. **Reference products:** bablsoft/accessflow. **Native Bytebase:** PARTIAL. **Source availability:** Partial or comparison evidence only; the complete requested behavior is not established.

**Evidence:** [AF-REST](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L235-L244). Cited API contract, source mechanism or documentation only. No new product runtime verification in this research.

**License/edition:** Pinned source/doc evidence; Apache-2.0 core where applicable. Drivers, build artifacts and optional editions are separate.

**Oracle:** Engine/edition-specific features need an explicit capability profile and Oracle lab evidence.

**Security:** Optional integrations cannot weaken the core approval, checksum or recovery invariant.

**Dependencies:** MIG-001, SEC-005 **Operational value:** Useful: An adapter cannot override core approval, target identity or recovery state.

**Design:** [PRODUCT-ROADMAP.md](PRODUCT-ROADMAP.md). Proposed implementation: DESIGN_PROPOSAL; runtime: NOT_TESTED.

**Acceptance:**

- An adapter cannot override core approval, target identity or recovery state.
- All applicable authorization and evidence checks are enforced by the API/worker, including negative cases.
