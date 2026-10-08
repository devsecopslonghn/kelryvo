# Feature evidence

Each catalog evidence key resolves here and in the machine registries. Source ranges concern the named mechanism/contract; a route or plan declaration is not enforcement evidence. Reused historical references retain their pins/hashes and do not modify original evidence. New platform runtime remains NOT_TESTED.

## Source register

| Evidence ID | Level | Repository / pin | Exact path and lines | Claim scope |
|---|---|---|---|---|
| [AF-L](#af-l) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [LICENSE.md:1–45](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/LICENSE.md#L1-L45) | License text. Read the complete file for its conditions. |
| [BB-L](#bb-l) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [LICENSE:1–25](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE#L1-L25) | License text. Read the complete file for its conditions. |
| [OM-L](#om-l) | SOURCE_VERIFIED | minuth/open-migration / `5dc73cc3ee98e3951d7436bfccb12063c0d6441e` | [LICENSE:1–21](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/LICENSE#L1-L21) | License text. Read the complete file for its conditions. |
| [LB5-L](#lb5-l) | SOURCE_VERIFIED | liquibase/liquibase / `3ed5c81625671e91b4423ba4503fe68ce947d1ff` | [LICENSE.txt:1–45](https://github.com/liquibase/liquibase/blob/3ed5c81625671e91b4423ba4503fe68ce947d1ff/LICENSE.txt#L1-L45) | License text. Read the complete file for its conditions. |
| [LB4-L](#lb4-l) | SOURCE_VERIFIED | liquibase/liquibase / `75773ed9b45b0a5adf3c42872d2e5494da669427` | [LICENSE.txt:1–45](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/LICENSE.txt#L1-L45) | License text. Read the complete file for its conditions. |
| [FW-L](#fw-l) | SOURCE_VERIFIED | flyway/flyway / `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c` | [LICENSE.txt:1–13](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/LICENSE.txt#L1-L13) | License text. Read the complete file for its conditions. |
| [SQ-L](#sq-l) | DOC_VERIFIED | sqitchers/sqitch / `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e` | [LICENSE.md:1–21](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/LICENSE.md#L1-L21) | License text. Read the complete file for its conditions. |
| [AT-L](#at-l) | SOURCE_VERIFIED | ariga/atlas / `1317a57674f3795de395f535a258c088d7f767bf` | [LICENSE:1–45](https://github.com/ariga/atlas/blob/1317a57674f3795de395f535a258c088d7f767bf/LICENSE#L1-L45) | License text. Read the complete file for its conditions. |
| [YE-L](#ye-l) | SOURCE_VERIFIED | cookieY/Yearning / `6e56e685beb2fff830ddd55ac406f842d575b82c` | [LICENSE:1–45](https://github.com/cookieY/Yearning/blob/6e56e685beb2fff830ddd55ac406f842d575b82c/LICENSE#L1-L45) | License text. Read the complete file for its conditions. |
| [AR-L](#ar-l) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [LICENSE:1–45](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/LICENSE#L1-L45) | License text. Read the complete file for its conditions. |
| [CB-L](#cb-l) | SOURCE_VERIFIED | dbeaver/cloudbeaver / `74123b3a36340282a6ab117dfa1733d69c32fe75` | [LICENSE:1–45](https://github.com/dbeaver/cloudbeaver/blob/74123b3a36340282a6ab117dfa1733d69c32fe75/LICENSE#L1-L45) | License text. Read the complete file for its conditions. |
| [BB-ENT](#bb-ent) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [LICENSE.enterprise:1–26](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE.enterprise#L1-L26) | Enterprise code requires a valid subscription for production use. |
| [BB-PLAN](#bb-plan) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/enterprise/plan.yaml:1–44](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44) | The Free plan permits 10 instances and 20 seats. It lists the free features. |
| [BB-GATES](#bb-gates) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/enterprise/plan.yaml:135–163](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L135-L163) | Enterprise approval/SSO/custom roles/external secrets boundaries; audit is also in TEAM with limits. See complete plan and actual API gate. |
| [BB-STATE](#bb-state) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/runner/taskrun/database_migrate_executor.go:533–600](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600) | The runner skips central revisions. It executes SQL before creating the next central revision. |
| [BB-ORA](#bb-ora) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/plugin/db/oracle/oracle.go:101–218](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218) | The Go Oracle driver splits SQL. It supports transaction and autocommit execution paths. |
| [BB-DRIVER](#bb-driver) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/plugin/db/oracle/oracle.go:12–22](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L12-L22) | Oracle execution uses the Go go-ora driver. |
| [AF-PROM](#af-prom) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java:77–175](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175) | Promotion checks central state and a central checksum. It submits an ordered request group. |
| [AF-GATE](#af-gate) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementGate.java:126–150](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementGate.java#L126-L150) | The schema gate refuses transaction markers, multiple statements, and DML. |
| [AF-SCAN](#af-scan) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementScanner.java:13–88](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementScanner.java#L13-L88) | The scanner treats BEGIN as a transaction marker. Internal semicolons can fail the single-statement gate. |
| [AF-GROUP](#af-group) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [backend/src/main/java/com/bablsoft/accessflow/requestgroups/internal/GroupExecutionService.java:152–218](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/requestgroups/internal/GroupExecutionService.java#L152-L218) | The group executes target SQL before saving the member result centrally. |
| [AF-JDBC](#af-jdbc) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [backend/src/main/java/com/bablsoft/accessflow/proxy/internal/DefaultQueryExecutor.java:138–163](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/proxy/internal/DefaultQueryExecutor.java#L138-L163) | Relational execution uses a JDBC prepared statement. |
| [AF-ORA](#af-ora) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [backend/src/main/java/com/bablsoft/accessflow/core/internal/DefaultJdbcCoordinatesFactory.java:31–118](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/core/internal/DefaultJdbcCoordinatesFactory.java#L31-L118) | The built-in Oracle connector uses a Thin JDBC URL and the Oracle JDBC driver. |
| [AF-SSO](#af-sso) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/07-security.md:48–74](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/07-security.md#L48-L74) | The security documentation describes SAML and OAuth/OIDC authentication. |
| [AF-VAULT](#af-vault) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/07-security.md:1535–1549](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/07-security.md#L1535-L1549) | The product resolves Vault, AWS, and Azure secret references. |
| [AF-DR](#af-dr) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/09-deployment.md:1680–1707](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1680-L1707) | The deployment guide covers backup and recovery. |
| [AF-CI](#af-ci) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/18-deployment-governance.md:396–410](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410) | The repository provides a GitLab deployment gate template. |
| [AF-DOC](#af-doc) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/20-schema-change-governance.md:85–95](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L85-L95) | The schema workflow stores its sets, statements, and promotions in central PostgreSQL. |
| [AF-IAC](#af-iac) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/16-iac.md:1–17](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17) | Terraform, OpenTofu, and CI templates manage governance resources through the REST API. |
| [AF-SIEM](#af-siem) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/09-deployment.md:1018–1036](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1018-L1036) | External audit sinks include Splunk, syslog, signed HTTPS, and S3 Object Lock. |
| [AF-RECOVERY](#af-recovery) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/20-schema-change-governance.md:389–406](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L389-L406) | The documentation identifies lost status projection and partial application without an in-module repair path. |
| [AF-DRIFT](#af-drift) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/20-schema-change-governance.md:478–498](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L478-L498) | Oracle is a catalog-backed drift target. Sampling targets are excluded. |
| [AF-DISASTER](#af-disaster) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/09-deployment.md:1673–1695](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1673-L1695) | Disaster recovery includes central database backup and preservation of audit ownership and keys. |
| [AF-AUDIT](#af-audit) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/07-security.md:1825–1844](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/07-security.md#L1825-L1844) | The audit log has a cryptographic chain and separate writer permissions. |
| [AF-REST](#af-rest) | DOC_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [docs/20-schema-change-governance.md:235–244](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L235-L244) | The schema workflow exposes REST endpoints. |
| [OM-ENG](#om-eng) | SOURCE_VERIFIED | minuth/open-migration / `5dc73cc3ee98e3951d7436bfccb12063c0d6441e` | [server/services/engines/EngineFactory.ts:1–21](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/services/engines/EngineFactory.ts#L1-L21) | The engine factory supports PostgreSQL, SQLite, MySQL, and MariaDB. It has no Oracle engine. |
| [OM-STATE](#om-state) | SOURCE_VERIFIED | minuth/open-migration / `5dc73cc3ee98e3951d7436bfccb12063c0d6441e` | [server/services/engines/PostgresEngine.ts:50–96](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/services/engines/PostgresEngine.ts#L50-L96) | The target tracking table stores names and dates. PostgreSQL SQL and tracking inserts share a transaction. |
| [OM-RUN](#om-run) | SOURCE_VERIFIED | minuth/open-migration / `5dc73cc3ee98e3951d7436bfccb12063c0d6441e` | [server/services/migration.service.ts:99–163](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/services/migration.service.ts#L99-L163) | Applied detection uses filenames. A failure does not stop the outer migration loop. |
| [OM-META](#om-meta) | SOURCE_VERIFIED | minuth/open-migration / `5dc73cc3ee98e3951d7436bfccb12063c0d6441e` | [server/database/schema.ts:1–42](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/database/schema.ts#L1-L42) | The central server uses SQLite metadata. The schema has no user identity on migration rows. |
| [OM-AUTH](#om-auth) | SOURCE_VERIFIED | minuth/open-migration / `5dc73cc3ee98e3951d7436bfccb12063c0d6441e` | [server/utils/auth.ts:28–47](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/utils/auth.ts#L28-L47) | The application documents one administrator session. |
| [FW-ORA](#fw-ora) | SOURCE_VERIFIED | flyway/flyway / `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c` | [flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java:75–135](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135) | Oracle history stores version, checksum, actor, time, and success. Oracle DDL transactions are unsupported. |
| [FW-PARSER](#fw-parser) | SOURCE_VERIFIED | flyway/flyway / `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c` | [flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java:145–200](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200) | The parser recognizes Oracle PL/SQL and slash delimiters. |
| [FW-EXEC](#fw-exec) | SOURCE_VERIFIED | flyway/flyway / `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c` | [flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java:437–492](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492) | The runner executes a migration before adding its successful history row. |
| [FW-FAIL](#fw-fail) | SOURCE_VERIFIED | flyway/flyway / `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c` | [flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java:340–362](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362) | For nontransactional failure, the runner records failure and requires recovery. |
| [FW-CHECKSUM](#fw-checksum) | SOURCE_VERIFIED | flyway/flyway / `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c` | [flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java:322–342](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java#L322-L342) | Migration validation compares resolved checksums with applied history. |
| [LB4-ORA](#lb4-ora) | SOURCE_VERIFIED | liquibase/liquibase / `75773ed9b45b0a5adf3c42872d2e5494da669427` | [liquibase-standard/src/main/java/liquibase/database/core/OracleDatabase.java:328–338](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/database/core/OracleDatabase.java#L328-L338) | Liquibase 4.33 uses the Oracle JDBC driver. |
| [LB4-STATE](#lb4-state) | SOURCE_VERIFIED | liquibase/liquibase / `75773ed9b45b0a5adf3c42872d2e5494da669427` | [liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java:45–67](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java#L45-L67) | DATABASECHANGELOG stores identity, checksum, execution type, and deployment information. |
| [LB4-EXEC](#lb4-exec) | SOURCE_VERIFIED | liquibase/liquibase / `75773ed9b45b0a5adf3c42872d2e5494da669427` | [liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java:115–143](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java#L115-L143) | Changeset execution occurs before the database records its execution status. |
| [LB4-SKIP](#lb4-skip) | SOURCE_VERIFIED | liquibase/liquibase / `75773ed9b45b0a5adf3c42872d2e5494da669427` | [liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java:15–77](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java#L15-L77) | The changeset filter has an already-applied decision. |
| [LB4-CHECKSUM](#lb4-checksum) | SOURCE_VERIFIED | liquibase/liquibase / `75773ed9b45b0a5adf3c42872d2e5494da669427` | [liquibase-standard/src/main/java/liquibase/changelog/visitor/ValidatingVisitor.java:123–140](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/ValidatingVisitor.java#L123-L140) | Validation checks applied changeset checksums, subject to runOnChange and runAlways settings. |
| [LB4-SEC](#lb4-sec) | DOC_VERIFIED | liquibase/liquibase / `75773ed9b45b0a5adf3c42872d2e5494da669427` | [SECURITY.md:1–22](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/SECURITY.md#L1-L22) | The source includes a vulnerability reporting policy. |
| [SQ-STATE](#sq-state) | SOURCE_VERIFIED | sqitchers/sqitch / `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e` | [lib/App/Sqitch/Engine/oracle.sql:29–52](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L29-L52) | The Oracle registry stores change IDs, script hashes, and deployment identities. |
| [SQ-EVENTS](#sq-events) | SOURCE_VERIFIED | sqitchers/sqitch / `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e` | [lib/App/Sqitch/Engine/oracle.sql:106–141](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141) | The target registry stores deploy, revert, fail, and merge events. |
| [SQ-EXEC](#sq-exec) | SOURCE_VERIFIED | sqitchers/sqitch / `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e` | [lib/App/Sqitch/Engine.pm:1041–1068](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1041-L1068) | Sqitch runs a deploy script before verifying and recording the change. |
| [SQ-SQLPLUS](#sq-sqlplus) | SOURCE_VERIFIED | sqitchers/sqitch / `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e` | [lib/App/Sqitch/Engine/oracle.pm:616–640](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.pm#L616-L640) | The Oracle engine invokes SQLPlus for scripts. |
| [SQ-INTEGRITY](#sq-integrity) | SOURCE_VERIFIED | sqitchers/sqitch / `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e` | [lib/App/Sqitch/Engine.pm:1260–1319](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1260-L1319) | The check command compares deployed script hashes with the plan and reports divergence. |
| [AT-DRIVERS](#at-drivers) | SOURCE_VERIFIED | ariga/atlas / `1317a57674f3795de395f535a258c088d7f767bf` | [cmd/atlas/main.go:12–34](https://github.com/ariga/atlas/blob/1317a57674f3795de395f535a258c088d7f767bf/cmd/atlas/main.go#L12-L34) | The public CLI imports MySQL, PostgreSQL, SQLite, and related drivers. Oracle is absent here. |
| [YE-SCOPE](#ye-scope) | DOC_VERIFIED | cookieY/Yearning / `6e56e685beb2fff830ddd55ac406f842d575b82c` | [README.md:6–35](https://github.com/cookieY/Yearning/blob/6e56e685beb2fff830ddd55ac406f842d575b82c/README.md#L6-L35) | The project documents MySQL auditing, approval, history, and RBAC. |
| [YE-IDENTITY](#ye-identity) | SOURCE_VERIFIED | cookieY/Yearning / `6e56e685beb2fff830ddd55ac406f842d575b82c` | [src/router/router.go:76–86](https://github.com/cookieY/Yearning/blob/6e56e685beb2fff830ddd55ac406f842d575b82c/src/router/router.go#L76-L86) | The router exposes LDAP and OIDC login endpoints. |
| [AR-ORA](#ar-ora) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql/engines/oracle.py:19–50](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L19-L50) | Oracle execution uses python-oracledb with SID or service-name connections. |
| [AR-EXEC](#ar-exec) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql/engines/oracle.py:1108–1212](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1108-L1212) | The workflow executes and commits each statement. It checks PL/SQL object compilation. |
| [AR-PARSER](#ar-parser) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql/utils/sql_utils.py:151–217](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/utils/sql_utils.py#L151-L217) | The parser identifies procedures, functions, packages, triggers, and anonymous PL/SQL blocks. |
| [AR-STATE](#ar-state) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql/models.py:325–411](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/models.py#L325-L411) | Central workflow records contain actor, target, time, SQL, review, and result. |
| [AR-SQLPLUS](#ar-sqlplus) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql/engines/oracle.py:786–805](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L786-L805) | The SQL review rejects SET, ROLLBACK, and EXIT commands. |
| [AR-IDENTITY](#ar-identity) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [archery/settings.py:316–343](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/archery/settings.py#L316-L343) | The settings configure an OIDC authentication backend. |
| [AR-LDAP](#ar-ldap) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [archery/settings.py:360–387](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/archery/settings.py#L360-L387) | The settings configure LDAP authentication. |
| [AR-API](#ar-api) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql_api/urls.py:57–110](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql_api/urls.py#L57-L110) | REST endpoints cover workflow checks, review, execution, content, and logs. |
| [AR-DOC](#ar-doc) | DOC_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [README.md:24–48](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/README.md#L24-L48) | The feature table distinguishes Oracle review, execution, backup, and other engine capabilities. |
| [CB-ORA](#cb-ora) | SOURCE_VERIFIED | dbeaver/cloudbeaver / `74123b3a36340282a6ab117dfa1733d69c32fe75` | [server/bundles/io.cloudbeaver.resources.drivers.base/plugin.xml:1–57](https://github.com/dbeaver/cloudbeaver/blob/74123b3a36340282a6ab117dfa1733d69c32fe75/server/bundles/io.cloudbeaver.resources.drivers.base/plugin.xml#L1-L57) | The public server bundles an Oracle Thin JDBC driver declaration. |
| [CB-SCOPE](#cb-scope) | DOC_VERIFIED | dbeaver/cloudbeaver / `74123b3a36340282a6ab117dfa1733d69c32fe75` | [README.md:1–27](https://github.com/dbeaver/cloudbeaver/blob/74123b3a36340282a6ab117dfa1733d69c32fe75/README.md#L1-L27) | CloudBeaver provides a shared web database editor and deployment instructions. |
| [P-BB-MODEL](#p-bb-model) | DOC_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [CONTEXT.md:1–89](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/CONTEXT.md#L1-L89) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-BB-ROUTES](#p-bb-routes) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [frontend/src/app/router/routes/dashboard.tsx:1–1049](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L1-L1049) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-BB-NAV](#p-bb-nav) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [frontend/src/components/ProjectSidebar.tsx:1–432](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/components/ProjectSidebar.tsx#L1-L432) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-BB-LICENSE](#p-bb-license) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [LICENSE:1–24](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE#L1-L24) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AF-ROUTES](#p-af-routes) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [frontend/src/App.tsx:1–891](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/App.tsx#L1-L891) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AF-NAV](#p-af-nav) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [frontend/src/components/common/Sidebar.tsx:1–492](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/components/common/Sidebar.tsx#L1-L492) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AF-SETS](#p-af-sets) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [frontend/src/pages/schemaChange/SchemaChangeSetListPage.tsx:1–311](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/schemaChange/SchemaChangeSetListPage.tsx#L1-L311) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AF-PROMOTE](#p-af-promote) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [frontend/src/pages/schemaChange/SchemaChangeSetDetailPage.tsx:1–484](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/schemaChange/SchemaChangeSetDetailPage.tsx#L1-L484) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AF-PIPELINE](#p-af-pipeline) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [frontend/src/pages/admin/deployments/DeploymentPipelineSettingsPage.tsx:1–282](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/admin/deployments/DeploymentPipelineSettingsPage.tsx#L1-L282) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AF-ENV](#p-af-env) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [frontend/src/components/deployments/PipelineEnvironmentsTab.tsx:1–379](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/components/deployments/PipelineEnvironmentsTab.tsx#L1-L379) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AF-INVENTORY](#p-af-inventory) | SOURCE_VERIFIED | bablsoft/accessflow / `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133` | [frontend/src/pages/datasources/DatasourceSettingsPage.tsx:1–2164](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/datasources/DatasourceSettingsPage.tsx#L1-L2164) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AR-NAV](#p-ar-nav) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [common/templates/base.html:1–762](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/common/templates/base.html#L1-L762) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-AR-ROUTES](#p-ar-routes) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql/urls.py:1–168](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/urls.py#L1-L168) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-OM-NAV](#p-om-nav) | SOURCE_VERIFIED | minuth/open-migration / `5dc73cc3ee98e3951d7436bfccb12063c0d6441e` | [app/components/AppSidebar.vue:1–127](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/app/components/AppSidebar.vue#L1-L127) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-LICENSE](#p-odc-license) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [LICENCE:1–202](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/LICENCE#L1-L202) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-DEPLOY](#p-odc-deploy) | DOC_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [README.md:43–108](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/README.md#L43-L108) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-ROADMAP](#p-odc-roadmap) | DOC_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [README.md:145–162](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/README.md#L145-L162) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-PROJECT](#p-odc-project) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/ProjectEntity.java:1–80](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/ProjectEntity.java#L1-L80) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-ENV](#p-odc-env) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/EnvironmentEntity.java:1–90](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/EnvironmentEntity.java#L1-L90) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-DATABASE](#p-odc-database) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/metadb/connection/DatabaseEntity.java:1–125](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/connection/DatabaseEntity.java#L1-L125) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-BATCH-MODEL](#p-odc-batch-model) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java:1–82](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java#L1-L82) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-BATCH-EXEC](#p-odc-batch-exec) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/MultipleDatabaseChangeRuntimeFlowableTask.java:1–347](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/MultipleDatabaseChangeRuntimeFlowableTask.java#L1-L347) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-EXEC](#p-odc-exec) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/DatabaseChangeThread.java:1–485](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/DatabaseChangeThread.java#L1-L485) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-PARAMS](#p-odc-params) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/DatabaseChangeParameters.java:1–60](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/DatabaseChangeParameters.java#L1-L60) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-ORACLE](#p-odc-oracle) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/plugins/connect-plugin-oracle/src/main/java/com/oceanbase/odc/plugin/connect/oracle/OracleConnectionExtension.java:52–124](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/plugins/connect-plugin-oracle/src/main/java/com/oceanbase/odc/plugin/connect/oracle/OracleConnectionExtension.java#L52-L124) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-BATCH-DOC](#p-odc-batch-doc) | DOC_VERIFIED | oceanbase/odc-doc / `40dc7c03522fef1968bd11b2b051bc216091e60d` | [en-US/700.database-change-management/650.multiple-database-change.md:1–120](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/650.multiple-database-change.md#L1-L120) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-PROJECT-DOC](#p-odc-project-doc) | DOC_VERIFIED | oceanbase/odc-doc / `40dc7c03522fef1968bd11b2b051bc216091e60d` | [en-US/700.database-change-management/200.project-collaborative-management.md:1–334](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/200.project-collaborative-management.md#L1-L334) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-DATASOURCE-API](#p-odc-datasource-api) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DataSourceController.java:1–234](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DataSourceController.java#L1-L234) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-FLOW-API](#p-odc-flow-api) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/FlowInstanceController.java:1–278](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/FlowInstanceController.java#L1-L278) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-GIT-API](#p-odc-git-api) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/GitIntegrationController.java:1–92](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/GitIntegrationController.java#L1-L92) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-DB-PERMISSION-API](#p-odc-db-permission-api) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DatabasePermissionController.java:1–92](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DatabasePermissionController.java#L1-L92) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-ROLE-INHERITANCE](#p-odc-role-inheritance) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/permission/DBResourcePermissionHelper.java:1–484](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/permission/DBResourcePermissionHelper.java#L1-L484) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-DB-PERMISSION-SERVICE](#p-odc-db-permission-service) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/DatabasePermissionService.java:1–236](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/DatabasePermissionService.java#L1-L236) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-DB-PERMISSION-TYPES](#p-odc-db-permission-types) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/model/DatabasePermissionType.java:1–133](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/model/DatabasePermissionType.java#L1-L133) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-SWAGGER](#p-odc-swagger) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-server/src/main/java/com/oceanbase/odc/server/config/SwaggerConfiguration.java:1–74](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/config/SwaggerConfiguration.java#L1-L74) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-DEVELOPER-GUIDE](#p-odc-developer-guide) | DOC_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [docs/en-US/DEVELOPER_GUIDE.md:1–547](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/docs/en-US/DEVELOPER_GUIDE.md#L1-L547) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-USER-ROLES-DOC](#p-odc-user-roles-doc) | DOC_VERIFIED | oceanbase/odc-doc / `40dc7c03522fef1968bd11b2b051bc216091e60d` | [en-US/700.database-change-management/100.user-permission-and-management/100.odc-users-and-roles.md:1–207](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/100.user-permission-and-management/100.odc-users-and-roles.md#L1-L207) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-HA-DOC](#p-odc-ha-doc) | DOC_VERIFIED | oceanbase/odc-doc / `40dc7c03522fef1968bd11b2b051bc216091e60d` | [en-US/1100.deployment-guide/400.deploy-ha-odc-images.md:1–42](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/1100.deployment-guide/400.deploy-ha-odc-images.md#L1-L42) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-SCHEMA-DIFF-DOC](#p-odc-schema-diff-doc) | DOC_VERIFIED | oceanbase/odc-doc / `40dc7c03522fef1968bd11b2b051bc216091e60d` | [en-US/700.database-change-management/900.structural-comparison.md:5–36](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/900.structural-comparison.md#L5-L36) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-FLOW-REQUEST](#p-odc-flow-request) | SOURCE_VERIFIED | oceanbase/odc / `d517c0f27971642fb0cd7565fd61ab2309875ec3` | [server/odc-service/src/main/java/com/oceanbase/odc/service/flow/model/CreateFlowInstanceReq.java:1–135](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/model/CreateFlowInstanceReq.java#L1-L135) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-LOCALE](#p-odc-locale) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/util/intl.tsx:24–40](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/util/intl.tsx#L24-L40) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-CLIENT-L](#p-odc-client-l) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [LICENSE:1–202](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/LICENSE#L1-L202) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-ROUTES](#p-odc-routes) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [config/routes.js:1–96](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/config/routes.js#L1-L96) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-NAV](#p-odc-nav) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/layout/SpaceContainer/Sider/index.tsx:1–271](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/layout/SpaceContainer/Sider/index.tsx#L1-L271) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-PROJECT-UI](#p-odc-project-ui) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/page/Project/index.tsx:1–370](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/page/Project/index.tsx#L1-L370) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-SECURE-UI](#p-odc-secure-ui) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/page/Secure/index.tsx:1–138](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/page/Secure/index.tsx#L1-L138) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-PAGE-IDS](#p-odc-page-ids) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/d.ts/_index.ts:1–59](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/d.ts/_index.ts#L1-L59) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-QUEUE](#p-odc-queue) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/component/Task/MutipleAsyncTask/CreateModal/DatabaseQueue.tsx:1–355](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/CreateModal/DatabaseQueue.tsx#L1-L355) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-CHANGE-UI](#p-odc-change-ui) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/component/Task/MutipleAsyncTask/CreateModal/index.tsx:1–919](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/CreateModal/index.tsx#L1-L919) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-STRATEGY](#p-odc-strategy) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/component/Task/MutipleAsyncTask/CreateModal/MoreSetting.tsx:1–295](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/CreateModal/MoreSetting.tsx#L1-L295) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-RESULT-UI](#p-odc-result-ui) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/component/Task/MutipleAsyncTask/DetailContent/index.tsx:1–412](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/DetailContent/index.tsx#L1-L412) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-ODC-ORACLE-UI](#p-odc-oracle-ui) | SOURCE_VERIFIED | oceanbase/odc-client / `273fa3c4cc7d87f942ade231ce9220b98fa595e2` | [src/common/datasource/oracle/index.tsx:1–111](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/common/datasource/oracle/index.tsx#L1-L111) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-SQLE-L](#p-sqle-l) | SOURCE_VERIFIED | actiontech/sqle / `44e88c45f9cd55edb2d826795770001e019dda81` | [LICENSE:1–373](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/LICENSE#L1-L373) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-DMS-L](#p-dms-l) | SOURCE_VERIFIED | actiontech/dms / `d63b4ea798e811881107d193b25d2c33f6d8685c` | [LICENSE:1–373](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/LICENSE#L1-L373) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-SQLE-CE](#p-sqle-ce) | SOURCE_VERIFIED | actiontech/sqle / `44e88c45f9cd55edb2d826795770001e019dda81` | [sqle/api/controller/v1/sql_version_ce.go:1–57](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/sqle/api/controller/v1/sql_version_ce.go#L1-L57) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-SQLE-VERSION](#p-sqle-version) | SOURCE_VERIFIED | actiontech/sqle / `44e88c45f9cd55edb2d826795770001e019dda81` | [sqle/server/sqlversion/sql_version_ce.go:1–19](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/sqle/server/sqlversion/sql_version_ce.go#L1-L19) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-SQLE-README](#p-sqle-readme) | DOC_VERIFIED | actiontech/sqle / `44e88c45f9cd55edb2d826795770001e019dda81` | [README.md:1–206](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/README.md#L1-L206) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-DMS-FRONTEND](#p-dms-frontend) | SOURCE_VERIFIED | actiontech/dms / `d63b4ea798e811881107d193b25d2c33f6d8685c` | [Makefile:1–252](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/Makefile#L1-L252) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-DMS-PROJECT-CE](#p-dms-project-ce) | SOURCE_VERIFIED | actiontech/dms / `d63b4ea798e811881107d193b25d2c33f6d8685c` | [internal/dms/biz/project_ce.go:1–57](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/biz/project_ce.go#L1-L57) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-DMS-PROJECT-MODEL](#p-dms-project-model) | SOURCE_VERIFIED | actiontech/dms / `d63b4ea798e811881107d193b25d2c33f6d8685c` | [internal/dms/biz/project.go:1–100](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/biz/project.go#L1-L100) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-DMS-INVENTORY-CE](#p-dms-inventory-ce) | SOURCE_VERIFIED | actiontech/dms / `d63b4ea798e811881107d193b25d2c33f6d8685c` | [internal/dms/service/db_service_ce.go:1–30](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/service/db_service_ce.go#L1-L30) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [P-DMS-ENV](#p-dms-env) | SOURCE_VERIFIED | actiontech/dms / `d63b4ea798e811881107d193b25d2c33f6d8685c` | [internal/dms/biz/environment_tag.go:1–100](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/biz/environment_tag.go#L1-L100) | Pinned source or repository documentation; claim scope follows the cited lines. |
| [BB-INSTANCE](#bb-instance) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/instance_service.proto:21–263](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263) | Instance lifecycle and datasource API contracts. |
| [BB-CONNECTION](#bb-connection) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/instance_service.proto:747–943](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943) | Datasource connection parameters including Oracle SID/service; provider parameters are engine specific. |
| [BB-INSTANCE-MODEL](#bb-instance-model) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/instance_service.proto:543–602](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602) | Workspace or project instance, environment, datasource list, labels and synchronization fields. |
| [BB-DATABASE](#bb-database) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/database_service.proto:18–217](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217) | Database sync, metadata, schema and diff API contracts. |
| [BB-DATABASE-MODEL](#bb-database-model) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/database_service.proto:503–562](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562) | Database project assignment, environment override and computed effective environment. |
| [BB-PROJECT](#bb-project) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/project_service.proto:20–216](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216) | Project CRUD, IAM bindings and webhooks. |
| [BB-PROJECT-SETTINGS](#bb-project-settings) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/project_service.proto:421–500](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500) | Project self-approval, issue approval and last-editor settings. |
| [BB-RELEASE](#bb-release) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/release_service.proto:291–362](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362) | Release type, ordered files and VCS source identity API contract. |
| [BB-RELEASE-VALIDATE](#bb-release-validate) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/api/v1/release_service.go:354–434](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434) | Computes file SHA256; rejects duplicate versions and orders parsed versions. |
| [BB-RELEASE-CHECK](#bb-release-check) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/api/v1/release_service_check.go:389–431](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service_check.go#L389-L431) | Applied version with changed content produces WARNING advice. |
| [BB-ISSUE](#bb-issue) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/issue_service.proto:145–247](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247) | Approval, rejection, change requests, approval retry and review API contracts. |
| [BB-APPROVAL-MODEL](#bb-approval-model) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/issue_service.proto:504–588](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588) | Approver states, template and ordered approval steps. |
| [BB-POLICY](#bb-policy) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/org_policy_service.proto:255–396](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396) | Workspace/project policy inheritance and conditional rollout/review configuration. |
| [BB-ROLLOUT](#bb-rollout) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/rollout_service.proto:94–194](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194) | Task log/session, dispatch, cancellation and rollback preview contracts. |
| [BB-PLAN-DISCOVERY](#bb-plan-discovery) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/plan_service.proto:18–185](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/plan_service.proto#L18-L185) | Plan lifecycle, checks and preview API contracts. |
| [BB-METADATA-MODEL](#bb-metadata-model) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/migrator/migration/LATEST.sql:549–608](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/migrator/migration/LATEST.sql#L549-L608) | Instance scope, database assignment and central revision uniqueness. |
| [BB-SYNC](#bb-sync) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/runner/schemasync/syncer.go:428–543](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/schemasync/syncer.go#L428-L543) | Instance sync creates databases with scoped or default project assignment. |
| [BB-ORACLE-SYNC](#bb-oracle-sync) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/plugin/db/oracle/sync.go:28–156](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156) | Oracle owner discovery becomes Database entries and schema metadata includes routines/packages. |
| [BB-ORACLE-USERS](#bb-oracle-users) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/plugin/db/oracle/sync.go:198–235](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L198-L235) | ALL_USERS-based discovery and explicit internal user filtering. |
| [BB-SQL-API](#bb-sql-api) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/sql_service.proto:18–102](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102) | Query, admin execution, query history and export API contracts. |
| [BB-SQL-OPTIONS](#bb-sql-options) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/sql_service.proto:105–195](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L105-L195) | Query target and limits, explain and access grant options. |
| [BB-IDP](#bb-idp) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/api/v1/idp_service.go:226–242](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242) | Enterprise SSO versus Google/GitHub feature check. |
| [BB-ROLE-GATE](#bb-role-gate) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/api/v1/role_service.go:68–88](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/role_service.go#L68-L88) | Custom role creation checks entitlement. |
| [BB-AUDIT-GATE](#bb-audit-gate) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/api/v1/audit_log_service.go:28–53](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53) | Audit search checks license feature. |
| [BB-QUERY-GATE](#bb-query-gate) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/api/v1/org_policy_service.go:680–728](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/org_policy_service.go#L680-L728) | Copy restrictions, query policy and masking check distinct features. |
| [BB-READONLY-GATE](#bb-readonly-gate) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/api/v1/instance_service.go:1215–1245](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/instance_service.go#L1215-L1245) | Readonly datasource addition has separate feature guard. |
| [BB-METRICS](#bb-metrics) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [backend/server/metrics.go:1–39](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/server/metrics.go#L1-L39) | Prometheus endpoint registry and access restriction. |
| [BB-ROUTES](#bb-routes) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [frontend/src/app/router/routes/dashboard.tsx:106–436](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436) | Navigation includes inventory, policies, audit, identity and integrations. |
| [BB-ROUTES-PROJECT](#bb-routes-project) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [frontend/src/app/router/routes/dashboard.tsx:498–800](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L498-L800) | Detail and project route composition; page availability is separate from authorization. |
| [BB-SQL-ROUTES](#bb-sql-routes) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [frontend/src/app/router/routes/sqlEditor.tsx:1–86](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/sqlEditor.tsx#L1-L86) | Separate SQL editor route group. |
| [BB-SETTING](#bb-setting) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/setting_service.proto:115–154](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154) | Workspace settings including approvals, environment, identity and security. |
| [BB-GROUP](#bb-group) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/database_group_service.proto:1–120](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_group_service.proto#L1-L120) | Database group API; selected group membership must be materialized for deployment. |
| [BB-ACCESS](#bb-access) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/access_grant_service.proto:15–144](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/access_grant_service.proto#L15-L144) | Temporary project access grant lifecycle and scoped database association. |
| [BB-SAVED](#bb-saved) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/saved_query_service.proto:1–124](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/saved_query_service.proto#L1-L124) | Saved query lifecycle, listing and stars. |
| [BB-SERVICE-ACCOUNT](#bb-service-account) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/service_account_service.proto:1–122](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/service_account_service.proto#L1-L122) | Service account CRUD and key lifecycle API. |
| [BB-WORKLOAD](#bb-workload) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/workload_identity_service.proto:1–140](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/workload_identity_service.proto#L1-L140) | Workload identity API contract. |
| [BB-AI](#bb-ai) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/ai_service.proto:1–107](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/ai_service.proto#L1-L107) | AI related APIs; no Oracle execution correctness guarantee. |
| [BB-CATALOG](#bb-catalog) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [proto/v1/v1/database_catalog_service.proto:1–110](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_catalog_service.proto#L1-L110) | Database catalog configuration API. |
| [AR-COMPILE](#ar-compile) | SOURCE_VERIFIED | hhyo/Archery / `ccc7134f48d0e261f9e3ffa0d445dcec48adb790` | [sql/engines/oracle.py:1153–1195](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195) | Named PL/SQL validity lookup exists; OWNER/OBJECT_NAME with fetchone is narrower than complete package spec/body verification. |
| [DBGATE-README](#dbgate-readme) | DOC_VERIFIED | dbgate/dbgate / `d7c62fd89385543af59eb5ecdea3526a3f26ba70` | [README.md:1–100](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/README.md#L1-L100) | DbGate documents multi-database workbench, compare/query designer and import/export capabilities; per-feature Oracle parity is not established. |
| [DBGATE-LICENSE](#dbgate-license) | SOURCE_VERIFIED | dbgate/dbgate / `d7c62fd89385543af59eb5ecdea3526a3f26ba70` | [LICENSE:1–20](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/LICENSE#L1-L20) | Current DbGate root license is GPL-3.0; root rights do not eliminate dependency review. |
| [DBGATE-ORACLE](#dbgate-oracle) | SOURCE_VERIFIED | dbgate/dbgate / `d7c62fd89385543af59eb5ecdea3526a3f26ba70` | [plugins/dbgate-plugin-oracle/src/backend/driver.js:1–130](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/plugins/dbgate-plugin-oracle/src/backend/driver.js#L1-L130) | Oracle driver implementation is present; not a governed versioned release platform. |
| [NODE-LICENSE](#node-license) | SOURCE_VERIFIED | oracle/node-oracledb / `80c54f80ded26fe3013244c275a2cfce38439d69` | [LICENSE.txt:1–20](https://github.com/oracle/node-oracledb/blob/80c54f80ded26fe3013244c275a2cfce38439d69/LICENSE.txt#L1-L20) | node-oracledb is dual Apache-2.0 or UPL-1.0; choose Apache for proposed platform integration. |
| [NODE-VERSION](#node-version) | SOURCE_VERIFIED | oracle/node-oracledb / `80c54f80ded26fe3013244c275a2cfce38439d69` | [package.json:1–35](https://github.com/oracle/node-oracledb/blob/80c54f80ded26fe3013244c275a2cfce38439d69/package.json#L1-L35) | Inspected stable package version is 7.0.1, distinct from current development head. |
| [GO-ORA-LICENSE](#go-ora-license) | SOURCE_VERIFIED | sijms/go-ora / `62f8a42fe821414cec8fcacb1b877dfef836f798` | [LICENSE:1–21](https://github.com/sijms/go-ora/blob/62f8a42fe821414cec8fcacb1b877dfef836f798/LICENSE#L1-L21) | go-ora driver source uses MIT; no OCI dependency follows from its documented pure Go design. |
| [AF-DEPLOY-DOC](#af-deploy-doc) | DOC_VERIFIED | bablsoft/accessflow / `c8bb247637df76ce36e52f47b45899823409495e` | [ci-templates/examples/generic-curl-deployment.md:1–129](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129) | Supported external deployment gate, idempotent request/confirmation and outcome API documented; it does not establish Oracle engine dispatch uniqueness. |
| [LB5-CURRENT-LICENSE](#lb5-current-license) | SOURCE_VERIFIED | liquibase/liquibase / `893a20a519cae987c152d84637f70c9cf5b70067` | [LICENSE.txt:1–66](https://github.com/liquibase/liquibase/blob/893a20a519cae987c152d84637f70c9cf5b70067/LICENSE.txt#L1-L66) | Current inspected Liquibase source uses FSL-1.1-ALv2; restricted permitted-purpose grant is not current OSI open source. |
| [BB-FOLDER-ACTION](#bb-folder-action) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [action/command/file.go:20–107](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/file.go#L20-L107) | Supported action recursively globs local migration files, extracts numeric versions and builds Release_File entries; a server-side repository folder loader is a separate scope. |
| [BB-ACTION-ROLLOUT](#bb-action-rollout) | SOURCE_VERIFIED | bytebase/bytebase / `80524fc54601bcc5545575e02f83b23ee6bb0a70` | [action/command/rollout.go:68–123](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/rollout.go#L68-L123) | Supported action creates a versioned/declarative release with VCS provenance then references it in a plan. |

## Dated primary documentation

| Evidence ID | Product | Source / access date | Scope |
|---|---|---|---|
| [BB-PRICING](#bb-pricing) | Bytebase | [www.bytebase.com](https://www.bytebase.com/pricing/) / 2026-10-08 | Current page has 20-user/10-instance Community quota and separate approval, identity, audit and HA edition boundaries. Use page/plan gates together; no Enterprise runtime acceptance was performed. |
| [BB-APPROVAL-DOC](#bb-approval-doc) | Bytebase | [docs.bytebase.com](https://docs.bytebase.com/change-database/approval) / 2026-10-08 | Documentation describes custom approval policy configuration. Presence of documentation is not proof of Community entitlement or runtime enforcement. |
| [BB-HA-DOC](#bb-ha-doc) | Bytebase | [docs.bytebase.com](https://docs.bytebase.com/changelog/bytebase-3-17-0) / 2026-10-08 | Documentation index advertises high availability since 3.17.0; current deployment behavior needs an exact licensed-build test. |
| [FW-ORACLE-DOC](#fw-oracle-doc) | Flyway | [documentation.red-gate.com](https://documentation.red-gate.com/flyway/reference/database-driver-reference/oracle-database) / 2026-10-08 | Oracle SQL/PLSQL and slash delimiters are documented. SQL*Plus command emulation is Teams; open-source Java Oracle artifact and JDBC driver are separate components. |
| [ORACLE-COMMIT](#oracle-commit) | Oracle | [docs.oracle.com](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html) / 2026-10-08 | Oracle commits before syntactically valid DDL and after successful DDL. Failure/response loss may leave committed effects; release-wide atomicity is not assumed. |
| [ORACLE-ERRORS](#oracle-errors) | Oracle | [docs.oracle.com](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html) / 2026-10-08 | USER_ERRORS reports compiler errors on objects owned by the current user. Changing CURRENT_SCHEMA does not make it another owner. |
| [ORACLE-LOCK](#oracle-lock) | Oracle | [docs.oracle.com](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html) / 2026-10-08 | Session locks with release_on_commit false survive commits; session termination releases them. ALLOCATE_UNIQUE commits; autonomous allocation avoids committing caller work. A restricted cover package is recommended. |
| [NODE-THIN-DOC](#node-thin-doc) | node-oracledb | [node-oracledb.readthedocs.io](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html) / 2026-10-08 | Thin driver connects directly without Oracle Client libraries and handles SQL/PLSQL and pools. Documentation is broader than the exact new-platform test matrix. |
| [NODE-MODES-DOC](#node-modes-doc) | node-oracledb | [node-oracledb.readthedocs.io](https://node-oracledb.readthedocs.io/en/latest/user_guide/appendix_a.html) / 2026-10-08 | Thin supports Oracle 12.1+, TLS, proxy connections and homogeneous pools. Native Network Encryption/Kerberos/external authentication/AC require careful mode review and are not default Thin assumptions. |
| [ORACLE-JDBC-DOC](#oracle-jdbc-doc) | Oracle | [www.oracle.com](https://www.oracle.com/database/technologies/faq-jdbc.html) / 2026-10-08 | Oracle JDBC Thin needs no Instant Client but is distributed under separate Oracle terms, not the open-source extensions license. Exact JAR/version and companion terms must be reviewed. |
| [ATLAS-DOC](#atlas-doc) | Atlas | [www.atlasgo.io](https://www.atlasgo.io/features) / 2026-10-08 | Oracle driver is Pro; Apache public core does not grant access to that driver. |
| [LIQUIBASE-LICENSE-DOC](#liquibase-license-doc) | Liquibase | [www.liquibase.com](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl) / 2026-10-08 | Community transitioned to FSL; inspect exact version. Pinned 4.33 source rights differ from 5.x and from mixed binary distributions. |
| [GITLAB-APPROVAL](#gitlab-approval) | GitLab | [docs.gitlab.com](https://docs.gitlab.com/ci/environments/deployment_approvals/) / 2026-10-08 | Deployment approvals have Premium/Ultimate boundaries. New platform approval remains authoritative, allowing GitLab Free as source provider. |
| [JENKINS-INPUT](#jenkins-input) | Jenkins | [www.jenkins.io](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/) / 2026-10-08 | Pipeline input supports submitter restrictions but administrator behavior and executable pipeline permissions need consideration; platform approval cannot be inferred from build color. |
| [TECH-FASTIFY](#tech-fastify) | Fastify | [fastify.dev](https://fastify.dev/docs/latest/) / 2026-10-08 | Candidate maintained HTTP framework. Framework adoption and exact dependency closure require an implementation-time pin. |
| [TECH-POSTGRES](#tech-postgres) | PostgreSQL | [www.postgresql.org](https://www.postgresql.org/docs/current/sql-select.html) / 2026-10-08 | SKIP LOCKED supports queue consumers; PostgreSQL transaction/admission does not atomically commit Oracle DDL. |
| [TECH-OTEL](#tech-otel) | OpenTelemetry | [opentelemetry.io](https://opentelemetry.io/docs/) / 2026-10-08 | Candidate interoperable tracing/metrics instrumentation; payload redaction and offline collector configuration are new platform responsibilities. |
| [TECH-SPDX](#tech-spdx) | SPDX | [spdx.dev](https://spdx.dev/use/specifications/) / 2026-10-08 | Candidate SBOM interchange standard; SBOM existence does not establish acceptable licenses or vulnerability status. |

## Historical runtime evidence

| Evidence ID | Level | Evidence | Scope / finding |
|---|---|---|---|
| RT-BB | RUNTIME_VERIFIED | [Bytebase report](../../BYTEBASE-ORACLE-POC-RESULTS.md) | 3.22.1/FREE only: representative Oracle execution and replay skip; checksum/INVALID/promotion failures; approval/audit edition blocked; crash/restore cases NOT_RUN |
| RT-ODC | RUNTIME_VERIFIED | [ODC report](../../ODC-ORACLE-POC-RESULTS.md) | Recorded ODC image only: representative Oracle SQL/PLSQL, connection/API/UI evidence; complete versioned release/recovery/identity contract not proven |
| RT-ARCHERY | NOT_TESTED | [Archery assessment](../../evaluation/archery-database-management-runtime.md) | SOURCE and bounded local code probes; no new Oracle runtime acceptance |

## Exact reference details

### AF-L

DOC_VERIFIED — [bablsoft/accessflow / LICENSE.md:1–45](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/LICENSE.md#L1-L45); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`.

License text. Read the complete file for its conditions.

### BB-L

SOURCE_VERIFIED — [bytebase/bytebase / LICENSE:1–25](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE#L1-L25); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `cabda19dfa84124f47c423da96e65b4860ac28fe443663cda21a3a84a09b762e`.

License text. Read the complete file for its conditions.

### OM-L

SOURCE_VERIFIED — [minuth/open-migration / LICENSE:1–21](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/LICENSE#L1-L21); full commit `5dc73cc3ee98e3951d7436bfccb12063c0d6441e`; full file SHA-256 `e40f408c466e72a3b02eabe846ef35cfab210c14daff782a072dd4903d911f93`.

License text. Read the complete file for its conditions.

### LB5-L

SOURCE_VERIFIED — [liquibase/liquibase / LICENSE.txt:1–45](https://github.com/liquibase/liquibase/blob/3ed5c81625671e91b4423ba4503fe68ce947d1ff/LICENSE.txt#L1-L45); full commit `3ed5c81625671e91b4423ba4503fe68ce947d1ff`; full file SHA-256 `06a5644579563750de2a41006d75d2fe40149e22f90aea9d5fe919095f43a508`.

License text. Read the complete file for its conditions.

### LB4-L

SOURCE_VERIFIED — [liquibase/liquibase / LICENSE.txt:1–45](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/LICENSE.txt#L1-L45); full commit `75773ed9b45b0a5adf3c42872d2e5494da669427`; full file SHA-256 `f92896db6490e0e3aa53401adcb0aa36dba01839fb137fc353602a37bc89a124`.

License text. Read the complete file for its conditions.

### FW-L

SOURCE_VERIFIED — [flyway/flyway / LICENSE.txt:1–13](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/LICENSE.txt#L1-L13); full commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; full file SHA-256 `6707b7b3ba3220ab64a81a5ab869ffecc3a6a023e9488ea08b897471b069c078`.

License text. Read the complete file for its conditions.

### SQ-L

DOC_VERIFIED — [sqitchers/sqitch / LICENSE.md:1–21](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/LICENSE.md#L1-L21); full commit `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e`; full file SHA-256 `a04edd4f562552d52dd3558804e9f13b429b8a91f9f02058718212d2d912f81d`.

License text. Read the complete file for its conditions.

### AT-L

SOURCE_VERIFIED — [ariga/atlas / LICENSE:1–45](https://github.com/ariga/atlas/blob/1317a57674f3795de395f535a258c088d7f767bf/LICENSE#L1-L45); full commit `1317a57674f3795de395f535a258c088d7f767bf`; full file SHA-256 `58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd`.

License text. Read the complete file for its conditions.

### YE-L

SOURCE_VERIFIED — [cookieY/Yearning / LICENSE:1–45](https://github.com/cookieY/Yearning/blob/6e56e685beb2fff830ddd55ac406f842d575b82c/LICENSE#L1-L45); full commit `6e56e685beb2fff830ddd55ac406f842d575b82c`; full file SHA-256 `a14f15b79ab1cca1fd6b96f3795f5782b6dcc313ae107b53468a28e27e0c5ff4`.

License text. Read the complete file for its conditions.

### AR-L

SOURCE_VERIFIED — [hhyo/Archery / LICENSE:1–45](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/LICENSE#L1-L45); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1`.

License text. Read the complete file for its conditions.

### CB-L

SOURCE_VERIFIED — [dbeaver/cloudbeaver / LICENSE:1–45](https://github.com/dbeaver/cloudbeaver/blob/74123b3a36340282a6ab117dfa1733d69c32fe75/LICENSE#L1-L45); full commit `74123b3a36340282a6ab117dfa1733d69c32fe75`; full file SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`.

License text. Read the complete file for its conditions.

### BB-ENT

SOURCE_VERIFIED — [bytebase/bytebase / LICENSE.enterprise:1–26](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE.enterprise#L1-L26); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `24ff745fd7be9f66ba03952a41e5714fbe1ea45224557802e4794f6e1ce06af5`.

Enterprise code requires a valid subscription for production use.

### BB-PLAN

SOURCE_VERIFIED — [bytebase/bytebase / backend/enterprise/plan.yaml:1–44](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L1-L44); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `643e788c6cac459f4c8f9e9588b37f4892ea05c4ddd1307a2fc6931a1885f5e9`.

The Free plan permits 10 instances and 20 seats. It lists the free features.

### BB-GATES

SOURCE_VERIFIED — [bytebase/bytebase / backend/enterprise/plan.yaml:135–163](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/enterprise/plan.yaml#L135-L163); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `643e788c6cac459f4c8f9e9588b37f4892ea05c4ddd1307a2fc6931a1885f5e9`.

Enterprise approval/SSO/custom roles/external secrets boundaries; audit is also in TEAM with limits. See complete plan and actual API gate.

### BB-STATE

SOURCE_VERIFIED — [bytebase/bytebase / backend/runner/taskrun/database_migrate_executor.go:533–600](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/taskrun/database_migrate_executor.go#L533-L600); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `a15c3ef10a3e9bea3ed2690670d169e7614824fc5fced86858be155aa8a8e031`.

The runner skips central revisions. It executes SQL before creating the next central revision.

### BB-ORA

SOURCE_VERIFIED — [bytebase/bytebase / backend/plugin/db/oracle/oracle.go:101–218](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L101-L218); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `f9be79a80101c3eebfd732b094c438a21f82686be18b69f5a0f7e7762097a22a`.

The Go Oracle driver splits SQL. It supports transaction and autocommit execution paths.

### BB-DRIVER

SOURCE_VERIFIED — [bytebase/bytebase / backend/plugin/db/oracle/oracle.go:12–22](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/oracle.go#L12-L22); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `f9be79a80101c3eebfd732b094c438a21f82686be18b69f5a0f7e7762097a22a`.

Oracle execution uses the Go go-ora driver.

### AF-PROM

SOURCE_VERIFIED — [bablsoft/accessflow / backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java:77–175](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/DefaultSchemaChangePromotionService.java#L77-L175); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `3a9adc602d1753c75780681507727d8e994bbe995eabc994c286a53c79f75832`.

Promotion checks central state and a central checksum. It submits an ordered request group.

### AF-GATE

SOURCE_VERIFIED — [bablsoft/accessflow / backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementGate.java:126–150](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementGate.java#L126-L150); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `97a9b06d97b941582420c59a755b06420706592e1f836378380e18274194dab1`.

The schema gate refuses transaction markers, multiple statements, and DML.

### AF-SCAN

SOURCE_VERIFIED — [bablsoft/accessflow / backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementScanner.java:13–88](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/schemachange/internal/SchemaChangeStatementScanner.java#L13-L88); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `c876feaceb0a5cc47de3638379b2efb7bd8728eb054cde865651ab3004d6ee24`.

The scanner treats BEGIN as a transaction marker. Internal semicolons can fail the single-statement gate.

### AF-GROUP

SOURCE_VERIFIED — [bablsoft/accessflow / backend/src/main/java/com/bablsoft/accessflow/requestgroups/internal/GroupExecutionService.java:152–218](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/requestgroups/internal/GroupExecutionService.java#L152-L218); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `df0838f4a918e18a7dd890115a0c0b53f743b915740080d8af85948ec0f0df3c`.

The group executes target SQL before saving the member result centrally.

### AF-JDBC

SOURCE_VERIFIED — [bablsoft/accessflow / backend/src/main/java/com/bablsoft/accessflow/proxy/internal/DefaultQueryExecutor.java:138–163](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/proxy/internal/DefaultQueryExecutor.java#L138-L163); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `2ed9ac13e4d68e3457ad4d18c5c5b65174148a99d5aa62e92624cb1393f9a7e3`.

Relational execution uses a JDBC prepared statement.

### AF-ORA

SOURCE_VERIFIED — [bablsoft/accessflow / backend/src/main/java/com/bablsoft/accessflow/core/internal/DefaultJdbcCoordinatesFactory.java:31–118](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/backend/src/main/java/com/bablsoft/accessflow/core/internal/DefaultJdbcCoordinatesFactory.java#L31-L118); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `43513739ea0da2612da8e34a28784b946a0d7d9244a74b8a424711e74c46e4f0`.

The built-in Oracle connector uses a Thin JDBC URL and the Oracle JDBC driver.

### AF-SSO

DOC_VERIFIED — [bablsoft/accessflow / docs/07-security.md:48–74](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/07-security.md#L48-L74); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `0df6dfe3d7dd76f6c646a22b194d2bb593edc7f6383aa3a2bd738affe6c6f7b4`.

The security documentation describes SAML and OAuth/OIDC authentication.

### AF-VAULT

DOC_VERIFIED — [bablsoft/accessflow / docs/07-security.md:1535–1549](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/07-security.md#L1535-L1549); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `0df6dfe3d7dd76f6c646a22b194d2bb593edc7f6383aa3a2bd738affe6c6f7b4`.

The product resolves Vault, AWS, and Azure secret references.

### AF-DR

DOC_VERIFIED — [bablsoft/accessflow / docs/09-deployment.md:1680–1707](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1680-L1707); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `70af59ccbdaa121fa139d519dbbd3b9ace686c88608476aedba97fba17f3184b`.

The deployment guide covers backup and recovery.

### AF-CI

DOC_VERIFIED — [bablsoft/accessflow / docs/18-deployment-governance.md:396–410](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/18-deployment-governance.md#L396-L410); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `af7e6bf7090486790714908b7c6c46208272c0e6d4d7ea55642363bc49846b82`.

The repository provides a GitLab deployment gate template.

### AF-DOC

DOC_VERIFIED — [bablsoft/accessflow / docs/20-schema-change-governance.md:85–95](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L85-L95); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `03aab0ede2ef2b4a57046940f2d98e4f773e31fa11e9e7810147f24a14227f6a`.

The schema workflow stores its sets, statements, and promotions in central PostgreSQL.

### AF-IAC

DOC_VERIFIED — [bablsoft/accessflow / docs/16-iac.md:1–17](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/16-iac.md#L1-L17); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `259325dfa7c6d07560b444a8e96091909751a128365c638638af1534440e6d38`.

Terraform, OpenTofu, and CI templates manage governance resources through the REST API.

### AF-SIEM

DOC_VERIFIED — [bablsoft/accessflow / docs/09-deployment.md:1018–1036](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1018-L1036); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `70af59ccbdaa121fa139d519dbbd3b9ace686c88608476aedba97fba17f3184b`.

External audit sinks include Splunk, syslog, signed HTTPS, and S3 Object Lock.

### AF-RECOVERY

DOC_VERIFIED — [bablsoft/accessflow / docs/20-schema-change-governance.md:389–406](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L389-L406); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `03aab0ede2ef2b4a57046940f2d98e4f773e31fa11e9e7810147f24a14227f6a`.

The documentation identifies lost status projection and partial application without an in-module repair path.

### AF-DRIFT

DOC_VERIFIED — [bablsoft/accessflow / docs/20-schema-change-governance.md:478–498](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L478-L498); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `03aab0ede2ef2b4a57046940f2d98e4f773e31fa11e9e7810147f24a14227f6a`.

Oracle is a catalog-backed drift target. Sampling targets are excluded.

### AF-DISASTER

DOC_VERIFIED — [bablsoft/accessflow / docs/09-deployment.md:1673–1695](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/09-deployment.md#L1673-L1695); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `70af59ccbdaa121fa139d519dbbd3b9ace686c88608476aedba97fba17f3184b`.

Disaster recovery includes central database backup and preservation of audit ownership and keys.

### AF-AUDIT

DOC_VERIFIED — [bablsoft/accessflow / docs/07-security.md:1825–1844](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/07-security.md#L1825-L1844); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `0df6dfe3d7dd76f6c646a22b194d2bb593edc7f6383aa3a2bd738affe6c6f7b4`.

The audit log has a cryptographic chain and separate writer permissions.

### AF-REST

DOC_VERIFIED — [bablsoft/accessflow / docs/20-schema-change-governance.md:235–244](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/docs/20-schema-change-governance.md#L235-L244); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `03aab0ede2ef2b4a57046940f2d98e4f773e31fa11e9e7810147f24a14227f6a`.

The schema workflow exposes REST endpoints.

### OM-ENG

SOURCE_VERIFIED — [minuth/open-migration / server/services/engines/EngineFactory.ts:1–21](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/services/engines/EngineFactory.ts#L1-L21); full commit `5dc73cc3ee98e3951d7436bfccb12063c0d6441e`; full file SHA-256 `d67c0900f8e6f4a331953c1664b632ebf3b3367ced6a9a214ae8dc86d4a6c971`.

The engine factory supports PostgreSQL, SQLite, MySQL, and MariaDB. It has no Oracle engine.

### OM-STATE

SOURCE_VERIFIED — [minuth/open-migration / server/services/engines/PostgresEngine.ts:50–96](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/services/engines/PostgresEngine.ts#L50-L96); full commit `5dc73cc3ee98e3951d7436bfccb12063c0d6441e`; full file SHA-256 `1b9a078258b23956031f0eaac61de1ae9d232d3434eaf2e790b5db872876083e`.

The target tracking table stores names and dates. PostgreSQL SQL and tracking inserts share a transaction.

### OM-RUN

SOURCE_VERIFIED — [minuth/open-migration / server/services/migration.service.ts:99–163](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/services/migration.service.ts#L99-L163); full commit `5dc73cc3ee98e3951d7436bfccb12063c0d6441e`; full file SHA-256 `cf8b7e5a6e10f2aa790fc496436d2d9c1179329203039accde25b4446821f1c1`.

Applied detection uses filenames. A failure does not stop the outer migration loop.

### OM-META

SOURCE_VERIFIED — [minuth/open-migration / server/database/schema.ts:1–42](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/database/schema.ts#L1-L42); full commit `5dc73cc3ee98e3951d7436bfccb12063c0d6441e`; full file SHA-256 `c9ddf61ccf7aeec60296800da29712f707dc4a17a818d04c4762ea64f640020d`.

The central server uses SQLite metadata. The schema has no user identity on migration rows.

### OM-AUTH

SOURCE_VERIFIED — [minuth/open-migration / server/utils/auth.ts:28–47](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/server/utils/auth.ts#L28-L47); full commit `5dc73cc3ee98e3951d7436bfccb12063c0d6441e`; full file SHA-256 `5d819042e100cf934793defd6e447b339fc14b5d95a97ef85befce9b52ac5f91`.

The application documents one administrator session.

### FW-ORA

SOURCE_VERIFIED — [flyway/flyway / flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java:75–135](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleDatabase.java#L75-L135); full commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; full file SHA-256 `c88a57c2cdd1783f7cc6867f27e9c86caa941918bb3a915f5e390e4375acf866`.

Oracle history stores version, checksum, actor, time, and success. Oracle DDL transactions are unsupported.

### FW-PARSER

SOURCE_VERIFIED — [flyway/flyway / flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java:145–200](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-database/flyway-database-oracle/src/main/java/org/flywaydb/database/oracle/OracleParser.java#L145-L200); full commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; full file SHA-256 `46174fc2b87bcb1bffc7da9157ec53e61ffbe246179b9e0188e704838e859408`.

The parser recognizes Oracle PL/SQL and slash delimiters.

### FW-EXEC

SOURCE_VERIFIED — [flyway/flyway / flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java:437–492](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L437-L492); full commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; full file SHA-256 `69927edba2b52c2d7f9de283e13b21c203cc7d3ec6abe5c5c910263384e6ba89`.

The runner executes a migration before adding its successful history row.

### FW-FAIL

SOURCE_VERIFIED — [flyway/flyway / flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java:340–362](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/command/DbMigrate.java#L340-L362); full commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; full file SHA-256 `69927edba2b52c2d7f9de283e13b21c203cc7d3ec6abe5c5c910263384e6ba89`.

For nontransactional failure, the runner records failure and requires recovery.

### FW-CHECKSUM

SOURCE_VERIFIED — [flyway/flyway / flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java:322–342](https://github.com/flyway/flyway/blob/a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c/flyway-core/src/main/java/org/flywaydb/core/internal/info/MigrationInfoImpl.java#L322-L342); full commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; full file SHA-256 `e9b5c0d46ad31b950f533e742688738147c1fd6dc877c73cd0b51583d13bdf66`.

Migration validation compares resolved checksums with applied history.

### LB4-ORA

SOURCE_VERIFIED — [liquibase/liquibase / liquibase-standard/src/main/java/liquibase/database/core/OracleDatabase.java:328–338](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/database/core/OracleDatabase.java#L328-L338); full commit `75773ed9b45b0a5adf3c42872d2e5494da669427`; full file SHA-256 `af28f5ab9f24485d0218f509d70b8ac4b14972cd58adf8f12120a99bf6bd1507`.

Liquibase 4.33 uses the Oracle JDBC driver.

### LB4-STATE

SOURCE_VERIFIED — [liquibase/liquibase / liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java:45–67](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/sqlgenerator/core/CreateDatabaseChangeLogTableGenerator.java#L45-L67); full commit `75773ed9b45b0a5adf3c42872d2e5494da669427`; full file SHA-256 `055f621df16b29feec69865766718e973efc60a759b377d4f2ee4bc785ae0662`.

DATABASECHANGELOG stores identity, checksum, execution type, and deployment information.

### LB4-EXEC

SOURCE_VERIFIED — [liquibase/liquibase / liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java:115–143](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/UpdateVisitor.java#L115-L143); full commit `75773ed9b45b0a5adf3c42872d2e5494da669427`; full file SHA-256 `0a7dee4ac6dea59cc98f0ddc9904dbf86e4fd9497a431431226afe316b9a9e98`.

Changeset execution occurs before the database records its execution status.

### LB4-SKIP

SOURCE_VERIFIED — [liquibase/liquibase / liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java:15–77](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/filter/ShouldRunChangeSetFilter.java#L15-L77); full commit `75773ed9b45b0a5adf3c42872d2e5494da669427`; full file SHA-256 `ce3a661d48085026733561bf7a9e2d8fce1f5e24c5bccfd6acae9ac021eb79cd`.

The changeset filter has an already-applied decision.

### LB4-CHECKSUM

SOURCE_VERIFIED — [liquibase/liquibase / liquibase-standard/src/main/java/liquibase/changelog/visitor/ValidatingVisitor.java:123–140](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/liquibase-standard/src/main/java/liquibase/changelog/visitor/ValidatingVisitor.java#L123-L140); full commit `75773ed9b45b0a5adf3c42872d2e5494da669427`; full file SHA-256 `10372673ccfc9f64f5aed78337a632626d42b8525268a0a9cf977cccffb3221f`.

Validation checks applied changeset checksums, subject to runOnChange and runAlways settings.

### LB4-SEC

DOC_VERIFIED — [liquibase/liquibase / SECURITY.md:1–22](https://github.com/liquibase/liquibase/blob/75773ed9b45b0a5adf3c42872d2e5494da669427/SECURITY.md#L1-L22); full commit `75773ed9b45b0a5adf3c42872d2e5494da669427`; full file SHA-256 `34e5a7f676d8005e3946fb5c133bae1a41885cd0b4af70d6327eba4628b23c04`.

The source includes a vulnerability reporting policy.

### SQ-STATE

SOURCE_VERIFIED — [sqitchers/sqitch / lib/App/Sqitch/Engine/oracle.sql:29–52](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L29-L52); full commit `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e`; full file SHA-256 `5c0374630e93b3a9220013dd4d3bb4a140b874a0d2719c4122b063f7427d1a1e`.

The Oracle registry stores change IDs, script hashes, and deployment identities.

### SQ-EVENTS

SOURCE_VERIFIED — [sqitchers/sqitch / lib/App/Sqitch/Engine/oracle.sql:106–141](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.sql#L106-L141); full commit `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e`; full file SHA-256 `5c0374630e93b3a9220013dd4d3bb4a140b874a0d2719c4122b063f7427d1a1e`.

The target registry stores deploy, revert, fail, and merge events.

### SQ-EXEC

SOURCE_VERIFIED — [sqitchers/sqitch / lib/App/Sqitch/Engine.pm:1041–1068](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1041-L1068); full commit `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e`; full file SHA-256 `a865a48fa5f45b6dda2c8d81b07273f3395fe3a44e3b9c88cf620fe2c16b457c`.

Sqitch runs a deploy script before verifying and recording the change.

### SQ-SQLPLUS

SOURCE_VERIFIED — [sqitchers/sqitch / lib/App/Sqitch/Engine/oracle.pm:616–640](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine/oracle.pm#L616-L640); full commit `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e`; full file SHA-256 `6d4dd9d2f20fbfd15378a93914fd6ba6b5938caf5ea41f179fa67b3e522a5c1b`.

The Oracle engine invokes SQLPlus for scripts.

### SQ-INTEGRITY

SOURCE_VERIFIED — [sqitchers/sqitch / lib/App/Sqitch/Engine.pm:1260–1319](https://github.com/sqitchers/sqitch/blob/b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e/lib/App/Sqitch/Engine.pm#L1260-L1319); full commit `b08e5c8a773ee4ab5ea4ab7cf6f7a16c55d6994e`; full file SHA-256 `a865a48fa5f45b6dda2c8d81b07273f3395fe3a44e3b9c88cf620fe2c16b457c`.

The check command compares deployed script hashes with the plan and reports divergence.

### AT-DRIVERS

SOURCE_VERIFIED — [ariga/atlas / cmd/atlas/main.go:12–34](https://github.com/ariga/atlas/blob/1317a57674f3795de395f535a258c088d7f767bf/cmd/atlas/main.go#L12-L34); full commit `1317a57674f3795de395f535a258c088d7f767bf`; full file SHA-256 `b2712ed3e25b5b9f7c91040d6a11ea8098d1045e050157ee6dfafc170e341302`.

The public CLI imports MySQL, PostgreSQL, SQLite, and related drivers. Oracle is absent here.

### YE-SCOPE

DOC_VERIFIED — [cookieY/Yearning / README.md:6–35](https://github.com/cookieY/Yearning/blob/6e56e685beb2fff830ddd55ac406f842d575b82c/README.md#L6-L35); full commit `6e56e685beb2fff830ddd55ac406f842d575b82c`; full file SHA-256 `be5ce15f6a0aa68a8f69e590f5ff8f0fb3e7c1c6ab068ad6917c6a76bd3876e9`.

The project documents MySQL auditing, approval, history, and RBAC.

### YE-IDENTITY

SOURCE_VERIFIED — [cookieY/Yearning / src/router/router.go:76–86](https://github.com/cookieY/Yearning/blob/6e56e685beb2fff830ddd55ac406f842d575b82c/src/router/router.go#L76-L86); full commit `6e56e685beb2fff830ddd55ac406f842d575b82c`; full file SHA-256 `cedbcf07839bec3b292ab582019495843cf04be17236c68b01ed5b769e927a42`.

The router exposes LDAP and OIDC login endpoints.

### AR-ORA

SOURCE_VERIFIED — [hhyo/Archery / sql/engines/oracle.py:19–50](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L19-L50); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `b16d94c9756ae35e5047e44cd93887190fe751864d529cf62b59fc9f8b2ccbb9`.

Oracle execution uses python-oracledb with SID or service-name connections.

### AR-EXEC

SOURCE_VERIFIED — [hhyo/Archery / sql/engines/oracle.py:1108–1212](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1108-L1212); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `b16d94c9756ae35e5047e44cd93887190fe751864d529cf62b59fc9f8b2ccbb9`.

The workflow executes and commits each statement. It checks PL/SQL object compilation.

### AR-PARSER

SOURCE_VERIFIED — [hhyo/Archery / sql/utils/sql_utils.py:151–217](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/utils/sql_utils.py#L151-L217); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `bf947d191e9a9345575d9b884c7acc00a4b45cc135076c215f3b0f5cf531dc75`.

The parser identifies procedures, functions, packages, triggers, and anonymous PL/SQL blocks.

### AR-STATE

SOURCE_VERIFIED — [hhyo/Archery / sql/models.py:325–411](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/models.py#L325-L411); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `f28c7c86be5b1f81b931bd6268b5f53305348db86b57bd9f2d8252f80a3c8a1d`.

Central workflow records contain actor, target, time, SQL, review, and result.

### AR-SQLPLUS

SOURCE_VERIFIED — [hhyo/Archery / sql/engines/oracle.py:786–805](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L786-L805); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `b16d94c9756ae35e5047e44cd93887190fe751864d529cf62b59fc9f8b2ccbb9`.

The SQL review rejects SET, ROLLBACK, and EXIT commands.

### AR-IDENTITY

SOURCE_VERIFIED — [hhyo/Archery / archery/settings.py:316–343](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/archery/settings.py#L316-L343); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `e887858ac252ecb14c60c67b600c563a02adc4fda91bb3ebe410474c3f04f1f8`.

The settings configure an OIDC authentication backend.

### AR-LDAP

SOURCE_VERIFIED — [hhyo/Archery / archery/settings.py:360–387](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/archery/settings.py#L360-L387); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `e887858ac252ecb14c60c67b600c563a02adc4fda91bb3ebe410474c3f04f1f8`.

The settings configure LDAP authentication.

### AR-API

SOURCE_VERIFIED — [hhyo/Archery / sql_api/urls.py:57–110](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql_api/urls.py#L57-L110); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `576057c995c0b05808f988407571eed15678f0e2d3d3fd16b4c3912fa76a4bee`.

REST endpoints cover workflow checks, review, execution, content, and logs.

### AR-DOC

DOC_VERIFIED — [hhyo/Archery / README.md:24–48](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/README.md#L24-L48); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `9dfd9cb5b199a7b989228661ec5423006c5551cf47e5ff3e03207bfb605ab7f6`.

The feature table distinguishes Oracle review, execution, backup, and other engine capabilities.

### CB-ORA

SOURCE_VERIFIED — [dbeaver/cloudbeaver / server/bundles/io.cloudbeaver.resources.drivers.base/plugin.xml:1–57](https://github.com/dbeaver/cloudbeaver/blob/74123b3a36340282a6ab117dfa1733d69c32fe75/server/bundles/io.cloudbeaver.resources.drivers.base/plugin.xml#L1-L57); full commit `74123b3a36340282a6ab117dfa1733d69c32fe75`; full file SHA-256 `e116abc19bc63bda9d73fde80d292a443e5189462e901d7973a33fe3f3c64cac`.

The public server bundles an Oracle Thin JDBC driver declaration.

### CB-SCOPE

DOC_VERIFIED — [dbeaver/cloudbeaver / README.md:1–27](https://github.com/dbeaver/cloudbeaver/blob/74123b3a36340282a6ab117dfa1733d69c32fe75/README.md#L1-L27); full commit `74123b3a36340282a6ab117dfa1733d69c32fe75`; full file SHA-256 `df00bf309ccc22526e0e2e65e6c9b65a81eade4ff2f34ae2be15f0c28b1e3c5f`.

CloudBeaver provides a shared web database editor and deployment instructions.

### P-BB-MODEL

DOC_VERIFIED — [bytebase/bytebase / CONTEXT.md:1–89](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/CONTEXT.md#L1-L89); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `559131c44e99afde77d9d962d46414fdfc5d93da89e87eadae00f6d084cdb827`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-BB-ROUTES

SOURCE_VERIFIED — [bytebase/bytebase / frontend/src/app/router/routes/dashboard.tsx:1–1049](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L1-L1049); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `bad9d6ec0b86f2dc226eb195fb19d0709363c9e064640101f68e9f338c904119`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-BB-NAV

SOURCE_VERIFIED — [bytebase/bytebase / frontend/src/components/ProjectSidebar.tsx:1–432](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/components/ProjectSidebar.tsx#L1-L432); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `48750b37a0e0b3032942c2202b5a9c10ee2c7ae8023a29aad6853447872b9896`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-BB-LICENSE

SOURCE_VERIFIED — [bytebase/bytebase / LICENSE:1–24](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/LICENSE#L1-L24); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `cabda19dfa84124f47c423da96e65b4860ac28fe443663cda21a3a84a09b762e`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AF-ROUTES

SOURCE_VERIFIED — [bablsoft/accessflow / frontend/src/App.tsx:1–891](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/App.tsx#L1-L891); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `cd2afa6fdf26bab22a5da8fdfdfbc0d34a571d2c5fca265c4878feeecb304f9c`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AF-NAV

SOURCE_VERIFIED — [bablsoft/accessflow / frontend/src/components/common/Sidebar.tsx:1–492](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/components/common/Sidebar.tsx#L1-L492); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `a7dfcd44c3a220c2e76457560f22dff983d9a388e0e554f7028bfa042e47b469`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AF-SETS

SOURCE_VERIFIED — [bablsoft/accessflow / frontend/src/pages/schemaChange/SchemaChangeSetListPage.tsx:1–311](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/schemaChange/SchemaChangeSetListPage.tsx#L1-L311); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `0d4c10fc7fed1790bbcffec9b57266e4d1bbfaa070317cdf05f77c4f1152dafb`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AF-PROMOTE

SOURCE_VERIFIED — [bablsoft/accessflow / frontend/src/pages/schemaChange/SchemaChangeSetDetailPage.tsx:1–484](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/schemaChange/SchemaChangeSetDetailPage.tsx#L1-L484); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `aef350bad49941cb4ad96a38b7a6d9dcfa02ae6942127a41ac22e33f0e9c7da4`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AF-PIPELINE

SOURCE_VERIFIED — [bablsoft/accessflow / frontend/src/pages/admin/deployments/DeploymentPipelineSettingsPage.tsx:1–282](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/admin/deployments/DeploymentPipelineSettingsPage.tsx#L1-L282); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `f398915d2370f6460e93819b2cd0d8312b98d509912dc4ea1592287dc41b470f`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AF-ENV

SOURCE_VERIFIED — [bablsoft/accessflow / frontend/src/components/deployments/PipelineEnvironmentsTab.tsx:1–379](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/components/deployments/PipelineEnvironmentsTab.tsx#L1-L379); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `cf7db01664a317e12348f41c5602aef0e25effe709e7ab59367917350d33c3fb`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AF-INVENTORY

SOURCE_VERIFIED — [bablsoft/accessflow / frontend/src/pages/datasources/DatasourceSettingsPage.tsx:1–2164](https://github.com/bablsoft/accessflow/blob/55c209a4d9e4ba09a6c089f90e68a8b16b3f2133/frontend/src/pages/datasources/DatasourceSettingsPage.tsx#L1-L2164); full commit `55c209a4d9e4ba09a6c089f90e68a8b16b3f2133`; full file SHA-256 `f8027c7244cd58a86e117432581a3a7889c3cccfd411384e89ea66e6c839480f`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AR-NAV

SOURCE_VERIFIED — [hhyo/Archery / common/templates/base.html:1–762](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/common/templates/base.html#L1-L762); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `27c0fb7363f840ba90be7b0e0c46ceacc2b680de31347e433d2823ed270138c0`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-AR-ROUTES

SOURCE_VERIFIED — [hhyo/Archery / sql/urls.py:1–168](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/urls.py#L1-L168); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `3eed34fc72faca9aedb2cc24870cfb75a54409538b4de83fa07856daa604ead0`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-OM-NAV

SOURCE_VERIFIED — [minuth/open-migration / app/components/AppSidebar.vue:1–127](https://github.com/minuth/open-migration/blob/5dc73cc3ee98e3951d7436bfccb12063c0d6441e/app/components/AppSidebar.vue#L1-L127); full commit `5dc73cc3ee98e3951d7436bfccb12063c0d6441e`; full file SHA-256 `674010c4f60ff7fee6acced57989f95d6580e528dfc2e7cdf9ee73c39a77e576`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-LICENSE

SOURCE_VERIFIED — [oceanbase/odc / LICENCE:1–202](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/LICENCE#L1-L202); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-DEPLOY

DOC_VERIFIED — [oceanbase/odc / README.md:43–108](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/README.md#L43-L108); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `ad44252acc7fc30540c45c1b3ee716fd4c182d02d2a07d181ea5d6a73056d7d6`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-ROADMAP

DOC_VERIFIED — [oceanbase/odc / README.md:145–162](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/README.md#L145-L162); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `ad44252acc7fc30540c45c1b3ee716fd4c182d02d2a07d181ea5d6a73056d7d6`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-PROJECT

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/ProjectEntity.java:1–80](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/ProjectEntity.java#L1-L80); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `121a16e107bcd0ba25e24c5040a6a44669e084e051c4d08a21da2feb0e99ef32`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-ENV

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/EnvironmentEntity.java:1–90](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/collaboration/EnvironmentEntity.java#L1-L90); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `f52f19d1acd5634fe1dc6fc0f112cdc0b83832380f8a3380defd3aa6049470bc`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-DATABASE

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/metadb/connection/DatabaseEntity.java:1–125](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/metadb/connection/DatabaseEntity.java#L1-L125); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `048d0e58658d58750fb4e515297592a6ce2486de812a4f7836da357ee9b5a49c`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-BATCH-MODEL

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java:1–82](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/MultipleDatabaseChangeParameters.java#L1-L82); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `92f8cf2943ca755f81a0489cc56d724c24c9eb046ceb2fa8acd8d5602d2ab4b9`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-BATCH-EXEC

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/MultipleDatabaseChangeRuntimeFlowableTask.java:1–347](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/MultipleDatabaseChangeRuntimeFlowableTask.java#L1-L347); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `7f959051c179025739faf8a375cb9df45797b94dec942a9075ca4f45b83fde4e`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-EXEC

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/DatabaseChangeThread.java:1–485](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/DatabaseChangeThread.java#L1-L485); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `46308c7a8e96476f7bcde25841382e3ce2c50bedd6ee3872df6c04b9b7d09613`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-PARAMS

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/DatabaseChangeParameters.java:1–60](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/task/model/DatabaseChangeParameters.java#L1-L60); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `f40d3f0055160ec5160754b38534bb017e604f620c903e5e03d2dfc32f31307b`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-ORACLE

SOURCE_VERIFIED — [oceanbase/odc / server/plugins/connect-plugin-oracle/src/main/java/com/oceanbase/odc/plugin/connect/oracle/OracleConnectionExtension.java:52–124](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/plugins/connect-plugin-oracle/src/main/java/com/oceanbase/odc/plugin/connect/oracle/OracleConnectionExtension.java#L52-L124); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `b3fd90bd12faa7e413eb516f7ba5ec04118de0aadf1fbc15335c997cedb51592`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-BATCH-DOC

DOC_VERIFIED — [oceanbase/odc-doc / en-US/700.database-change-management/650.multiple-database-change.md:1–120](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/650.multiple-database-change.md#L1-L120); full commit `40dc7c03522fef1968bd11b2b051bc216091e60d`; full file SHA-256 `36b0888ff979f185f41aeec4777b2568981e0dfa6eb1fb8dd10b7e256a23e345`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-PROJECT-DOC

DOC_VERIFIED — [oceanbase/odc-doc / en-US/700.database-change-management/200.project-collaborative-management.md:1–334](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/200.project-collaborative-management.md#L1-L334); full commit `40dc7c03522fef1968bd11b2b051bc216091e60d`; full file SHA-256 `c1a6049fd0d3e9f7fdde3cae5138a82c08aad725334dfcd7b27e6eb6acb60378`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-DATASOURCE-API

SOURCE_VERIFIED — [oceanbase/odc / server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DataSourceController.java:1–234](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DataSourceController.java#L1-L234); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `5257dc36a320a2a3e40e81e04a9b85e0d59e66f8ffbdd863ed3151f427ec4e97`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-FLOW-API

SOURCE_VERIFIED — [oceanbase/odc / server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/FlowInstanceController.java:1–278](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/FlowInstanceController.java#L1-L278); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `da39a0d169f341c6bfca2810f8bc44fb9481215fbfdcb9b438f630172ad59334`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-GIT-API

SOURCE_VERIFIED — [oceanbase/odc / server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/GitIntegrationController.java:1–92](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/GitIntegrationController.java#L1-L92); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `8dd1b6d1beb69adfc3d5d74f03f05318e221fb46c5c854370fb54e0cae8fd788`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-DB-PERMISSION-API

SOURCE_VERIFIED — [oceanbase/odc / server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DatabasePermissionController.java:1–92](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/web/controller/v2/DatabasePermissionController.java#L1-L92); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `f2988eec95de9566aa879d634e6487de004d27c9d244a526939946515168b87f`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-ROLE-INHERITANCE

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/permission/DBResourcePermissionHelper.java:1–484](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/permission/DBResourcePermissionHelper.java#L1-L484); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `88913ac5c58587a63a1851c08c471b79181190ed4d218c60dccdd396256c37d6`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-DB-PERMISSION-SERVICE

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/DatabasePermissionService.java:1–236](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/DatabasePermissionService.java#L1-L236); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `8da0996a5adc0977e560c6926c58024fd7d97c56b0d9a1a1b8ccc3826ca4a6ea`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-DB-PERMISSION-TYPES

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/model/DatabasePermissionType.java:1–133](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/permission/database/model/DatabasePermissionType.java#L1-L133); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `5737c2760c89f7c451a03b68c700e38d14b5d20cd13d23f71cff90814ecd1986`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-SWAGGER

SOURCE_VERIFIED — [oceanbase/odc / server/odc-server/src/main/java/com/oceanbase/odc/server/config/SwaggerConfiguration.java:1–74](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-server/src/main/java/com/oceanbase/odc/server/config/SwaggerConfiguration.java#L1-L74); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `8ce3c81f949c33eda0df869b4d8e6363eb5cfed7506f169bc78c3e4197780f50`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-DEVELOPER-GUIDE

DOC_VERIFIED — [oceanbase/odc / docs/en-US/DEVELOPER_GUIDE.md:1–547](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/docs/en-US/DEVELOPER_GUIDE.md#L1-L547); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `f1d665456785ed1c18ce78876498d0acc372e385a9c74e00ffd9cd5ca060d313`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-USER-ROLES-DOC

DOC_VERIFIED — [oceanbase/odc-doc / en-US/700.database-change-management/100.user-permission-and-management/100.odc-users-and-roles.md:1–207](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/100.user-permission-and-management/100.odc-users-and-roles.md#L1-L207); full commit `40dc7c03522fef1968bd11b2b051bc216091e60d`; full file SHA-256 `db8a42b72e09d28cb5f9ed309a8b6a35103803297539627b77dcecd827c3d5a7`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-HA-DOC

DOC_VERIFIED — [oceanbase/odc-doc / en-US/1100.deployment-guide/400.deploy-ha-odc-images.md:1–42](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/1100.deployment-guide/400.deploy-ha-odc-images.md#L1-L42); full commit `40dc7c03522fef1968bd11b2b051bc216091e60d`; full file SHA-256 `678a218deac1da25d8d73aab9fdbbbb3155fdfcedbf34950f98f2293a450c3d8`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-SCHEMA-DIFF-DOC

DOC_VERIFIED — [oceanbase/odc-doc / en-US/700.database-change-management/900.structural-comparison.md:5–36](https://github.com/oceanbase/odc-doc/blob/40dc7c03522fef1968bd11b2b051bc216091e60d/en-US/700.database-change-management/900.structural-comparison.md#L5-L36); full commit `40dc7c03522fef1968bd11b2b051bc216091e60d`; full file SHA-256 `93b009dbb3e79bfe207b44c4711aea16857cc73703adb8f4fbeca3e0571cd18e`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-FLOW-REQUEST

SOURCE_VERIFIED — [oceanbase/odc / server/odc-service/src/main/java/com/oceanbase/odc/service/flow/model/CreateFlowInstanceReq.java:1–135](https://github.com/oceanbase/odc/blob/d517c0f27971642fb0cd7565fd61ab2309875ec3/server/odc-service/src/main/java/com/oceanbase/odc/service/flow/model/CreateFlowInstanceReq.java#L1-L135); full commit `d517c0f27971642fb0cd7565fd61ab2309875ec3`; full file SHA-256 `082edde914e9ad70093cd69e22acc36c84a85e79919c591723d1ff76cb6c48ba`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-LOCALE

SOURCE_VERIFIED — [oceanbase/odc-client / src/util/intl.tsx:24–40](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/util/intl.tsx#L24-L40); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `5586c0d7061fc24de026394b22acd773f0c0b4c1bf4a54e2f9c22e22bbaa72ca`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-CLIENT-L

SOURCE_VERIFIED — [oceanbase/odc-client / LICENSE:1–202](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/LICENSE#L1-L202); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-ROUTES

SOURCE_VERIFIED — [oceanbase/odc-client / config/routes.js:1–96](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/config/routes.js#L1-L96); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `7e215d201c83e1e30c7d26e7f02fb074df91978daf5912defe90bd40bdda3f95`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-NAV

SOURCE_VERIFIED — [oceanbase/odc-client / src/layout/SpaceContainer/Sider/index.tsx:1–271](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/layout/SpaceContainer/Sider/index.tsx#L1-L271); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `ca9d1601d556e036967cd52ddeaa05c5884eec95feedcfecfbd25adc20b31ca0`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-PROJECT-UI

SOURCE_VERIFIED — [oceanbase/odc-client / src/page/Project/index.tsx:1–370](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/page/Project/index.tsx#L1-L370); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `d2fba7514942c09d34fe39f3c2c1da97adc233953f9d42f84f7edb7de36ad086`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-SECURE-UI

SOURCE_VERIFIED — [oceanbase/odc-client / src/page/Secure/index.tsx:1–138](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/page/Secure/index.tsx#L1-L138); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `2bf950a855ef6126095905fc6049c0d0f8c763fc860fbd08ea25e3a09f6dc829`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-PAGE-IDS

SOURCE_VERIFIED — [oceanbase/odc-client / src/d.ts/_index.ts:1–59](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/d.ts/_index.ts#L1-L59); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `10e808e85f3f54421af28a729b487910e3e2e30804ef9a8bb6a95fa5e90bcc05`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-QUEUE

SOURCE_VERIFIED — [oceanbase/odc-client / src/component/Task/MutipleAsyncTask/CreateModal/DatabaseQueue.tsx:1–355](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/CreateModal/DatabaseQueue.tsx#L1-L355); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `91565327e7f0a4eac93fbaf4fff94ce7be7f3db60634755c92aa57522235693d`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-CHANGE-UI

SOURCE_VERIFIED — [oceanbase/odc-client / src/component/Task/MutipleAsyncTask/CreateModal/index.tsx:1–919](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/CreateModal/index.tsx#L1-L919); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `df2b5cf71f1a2a544ea1bafccb8bf8f74dd39e06c1d24dde8c28148e261a3102`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-STRATEGY

SOURCE_VERIFIED — [oceanbase/odc-client / src/component/Task/MutipleAsyncTask/CreateModal/MoreSetting.tsx:1–295](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/CreateModal/MoreSetting.tsx#L1-L295); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `7e8c753c16bab0fa251a2b2bb66ca2bb1e48991432c79dbcb1a15dbb35f095cf`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-RESULT-UI

SOURCE_VERIFIED — [oceanbase/odc-client / src/component/Task/MutipleAsyncTask/DetailContent/index.tsx:1–412](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/component/Task/MutipleAsyncTask/DetailContent/index.tsx#L1-L412); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `4750d102737d56fdc39cb15c046ef44f09b8752d2a4b5fea218e16be478d3594`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-ODC-ORACLE-UI

SOURCE_VERIFIED — [oceanbase/odc-client / src/common/datasource/oracle/index.tsx:1–111](https://github.com/oceanbase/odc-client/blob/273fa3c4cc7d87f942ade231ce9220b98fa595e2/src/common/datasource/oracle/index.tsx#L1-L111); full commit `273fa3c4cc7d87f942ade231ce9220b98fa595e2`; full file SHA-256 `270bfa399c2042fac6dc13caed62f24445d82d82fadc731fbcf907ebe5b6636e`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-SQLE-L

SOURCE_VERIFIED — [actiontech/sqle / LICENSE:1–373](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/LICENSE#L1-L373); full commit `44e88c45f9cd55edb2d826795770001e019dda81`; full file SHA-256 `1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-DMS-L

SOURCE_VERIFIED — [actiontech/dms / LICENSE:1–373](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/LICENSE#L1-L373); full commit `d63b4ea798e811881107d193b25d2c33f6d8685c`; full file SHA-256 `1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-SQLE-CE

SOURCE_VERIFIED — [actiontech/sqle / sqle/api/controller/v1/sql_version_ce.go:1–57](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/sqle/api/controller/v1/sql_version_ce.go#L1-L57); full commit `44e88c45f9cd55edb2d826795770001e019dda81`; full file SHA-256 `771224da85beda979fc12d4b8f9e1645f26db9a07e71729053b2a12de7aa2e9e`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-SQLE-VERSION

SOURCE_VERIFIED — [actiontech/sqle / sqle/server/sqlversion/sql_version_ce.go:1–19](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/sqle/server/sqlversion/sql_version_ce.go#L1-L19); full commit `44e88c45f9cd55edb2d826795770001e019dda81`; full file SHA-256 `f6114349912382ad4d24c57cbd0c8a3be8a02d071f337a09911e66d9a82b2f6e`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-SQLE-README

DOC_VERIFIED — [actiontech/sqle / README.md:1–206](https://github.com/actiontech/sqle/blob/44e88c45f9cd55edb2d826795770001e019dda81/README.md#L1-L206); full commit `44e88c45f9cd55edb2d826795770001e019dda81`; full file SHA-256 `515e41412c7367fd64eef84418d3d06f4dd0a0f0ef9f73599207e5707a389529`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-DMS-FRONTEND

SOURCE_VERIFIED — [actiontech/dms / Makefile:1–252](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/Makefile#L1-L252); full commit `d63b4ea798e811881107d193b25d2c33f6d8685c`; full file SHA-256 `b48c57876b6605923fa3ec0f56d22b0a1dd6342fbc57e7c00cc262874a1fe8c7`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-DMS-PROJECT-CE

SOURCE_VERIFIED — [actiontech/dms / internal/dms/biz/project_ce.go:1–57](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/biz/project_ce.go#L1-L57); full commit `d63b4ea798e811881107d193b25d2c33f6d8685c`; full file SHA-256 `fa160310a5b84e40a26da9d3c5f5229fac26bb0c4130437b325674687d45dc31`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-DMS-PROJECT-MODEL

SOURCE_VERIFIED — [actiontech/dms / internal/dms/biz/project.go:1–100](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/biz/project.go#L1-L100); full commit `d63b4ea798e811881107d193b25d2c33f6d8685c`; full file SHA-256 `76a396341734663314124d229b642c2489a956adf3bb98311c30da4abe840f4a`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-DMS-INVENTORY-CE

SOURCE_VERIFIED — [actiontech/dms / internal/dms/service/db_service_ce.go:1–30](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/service/db_service_ce.go#L1-L30); full commit `d63b4ea798e811881107d193b25d2c33f6d8685c`; full file SHA-256 `8633d8bcea1249061db1e9a4758c120d8a60848a57dcedf8dbf17f3dcaf51281`.

Pinned source or repository documentation; claim scope follows the cited lines.

### P-DMS-ENV

SOURCE_VERIFIED — [actiontech/dms / internal/dms/biz/environment_tag.go:1–100](https://github.com/actiontech/dms/blob/d63b4ea798e811881107d193b25d2c33f6d8685c/internal/dms/biz/environment_tag.go#L1-L100); full commit `d63b4ea798e811881107d193b25d2c33f6d8685c`; full file SHA-256 `fba088a0aac819538f4f1745790005898a39cfb05a404db8bae65943b62e90e2`.

Pinned source or repository documentation; claim scope follows the cited lines.

### BB-INSTANCE

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/instance_service.proto:21–263](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L21-L263); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `ecb8604d3da82497149c3bd1f81a94cf6ba3c8c55ae53c9866dcc381744ba3d9`.

Instance lifecycle and datasource API contracts.

### BB-CONNECTION

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/instance_service.proto:747–943](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L747-L943); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `ecb8604d3da82497149c3bd1f81a94cf6ba3c8c55ae53c9866dcc381744ba3d9`.

Datasource connection parameters including Oracle SID/service; provider parameters are engine specific.

### BB-INSTANCE-MODEL

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/instance_service.proto:543–602](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/instance_service.proto#L543-L602); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `ecb8604d3da82497149c3bd1f81a94cf6ba3c8c55ae53c9866dcc381744ba3d9`.

Workspace or project instance, environment, datasource list, labels and synchronization fields.

### BB-DATABASE

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/database_service.proto:18–217](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L18-L217); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `38f6e7c556e1332e7a375391ce7a12b09706570d9b69a30826f43e6e3560f6df`.

Database sync, metadata, schema and diff API contracts.

### BB-DATABASE-MODEL

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/database_service.proto:503–562](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_service.proto#L503-L562); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `38f6e7c556e1332e7a375391ce7a12b09706570d9b69a30826f43e6e3560f6df`.

Database project assignment, environment override and computed effective environment.

### BB-PROJECT

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/project_service.proto:20–216](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L20-L216); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `bfdb6971d4f1df6f23febf07fa4a7b1610dedb5ccbfe6f3d3533fe404c1c887a`.

Project CRUD, IAM bindings and webhooks.

### BB-PROJECT-SETTINGS

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/project_service.proto:421–500](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/project_service.proto#L421-L500); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `bfdb6971d4f1df6f23febf07fa4a7b1610dedb5ccbfe6f3d3533fe404c1c887a`.

Project self-approval, issue approval and last-editor settings.

### BB-RELEASE

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/release_service.proto:291–362](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/release_service.proto#L291-L362); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `4826c8b03c1368e45b1d21bbaa0d434fa9ef44812b200ac490e4cdecd2ff5361`.

Release type, ordered files and VCS source identity API contract.

### BB-RELEASE-VALIDATE

SOURCE_VERIFIED — [bytebase/bytebase / backend/api/v1/release_service.go:354–434](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service.go#L354-L434); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `e77781db5d329d94ffa6aedb38980504303dc9acb50f07cfd2dc970813a3255c`.

Computes file SHA256; rejects duplicate versions and orders parsed versions.

### BB-RELEASE-CHECK

SOURCE_VERIFIED — [bytebase/bytebase / backend/api/v1/release_service_check.go:389–431](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/release_service_check.go#L389-L431); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `de23e7743a884bf4f210dbf804533fa91e8e69ba57ad99e89d3162f9c318d252`.

Applied version with changed content produces WARNING advice.

### BB-ISSUE

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/issue_service.proto:145–247](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L145-L247); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `d81ce0cb4aee73225c44045b362a6d8a905e4f632f1af51fcab39c73a21f7ec7`.

Approval, rejection, change requests, approval retry and review API contracts.

### BB-APPROVAL-MODEL

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/issue_service.proto:504–588](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/issue_service.proto#L504-L588); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `d81ce0cb4aee73225c44045b362a6d8a905e4f632f1af51fcab39c73a21f7ec7`.

Approver states, template and ordered approval steps.

### BB-POLICY

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/org_policy_service.proto:255–396](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/org_policy_service.proto#L255-L396); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `6940882756adacb7387f06c33c12a7efd6a047fd9216f85ae23effc1eb6866c8`.

Workspace/project policy inheritance and conditional rollout/review configuration.

### BB-ROLLOUT

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/rollout_service.proto:94–194](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/rollout_service.proto#L94-L194); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `957136f6999a831619c6df1455a98aff9234769cad5882d5232e4fb7517b5aae`.

Task log/session, dispatch, cancellation and rollback preview contracts.

### BB-PLAN-DISCOVERY

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/plan_service.proto:18–185](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/plan_service.proto#L18-L185); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `61f32d99fe9b61a5fbb4161c3088a58feb824976f012ca445d3f3ff5f5121554`.

Plan lifecycle, checks and preview API contracts.

### BB-METADATA-MODEL

SOURCE_VERIFIED — [bytebase/bytebase / backend/migrator/migration/LATEST.sql:549–608](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/migrator/migration/LATEST.sql#L549-L608); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `954dae611a45efbdb81230445aa6240ad935355efd3e620439df6590145e6e47`.

Instance scope, database assignment and central revision uniqueness.

### BB-SYNC

SOURCE_VERIFIED — [bytebase/bytebase / backend/runner/schemasync/syncer.go:428–543](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/runner/schemasync/syncer.go#L428-L543); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `56fea4a263ba200d2dc9c7bb2ebc731a1f0c7e49c201146ebedfeb8a2afc98c1`.

Instance sync creates databases with scoped or default project assignment.

### BB-ORACLE-SYNC

SOURCE_VERIFIED — [bytebase/bytebase / backend/plugin/db/oracle/sync.go:28–156](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L28-L156); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `b10f53d929a1cfee9a90533cd034ce9abbf7e3556dfe6792e936273511cd067f`.

Oracle owner discovery becomes Database entries and schema metadata includes routines/packages.

### BB-ORACLE-USERS

SOURCE_VERIFIED — [bytebase/bytebase / backend/plugin/db/oracle/sync.go:198–235](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/plugin/db/oracle/sync.go#L198-L235); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `b10f53d929a1cfee9a90533cd034ce9abbf7e3556dfe6792e936273511cd067f`.

ALL_USERS-based discovery and explicit internal user filtering.

### BB-SQL-API

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/sql_service.proto:18–102](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L18-L102); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `a83216ed7b0678f9eda59c4c5171c709868afc930e6e5c5b7f26499989161cb4`.

Query, admin execution, query history and export API contracts.

### BB-SQL-OPTIONS

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/sql_service.proto:105–195](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/sql_service.proto#L105-L195); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `a83216ed7b0678f9eda59c4c5171c709868afc930e6e5c5b7f26499989161cb4`.

Query target and limits, explain and access grant options.

### BB-IDP

SOURCE_VERIFIED — [bytebase/bytebase / backend/api/v1/idp_service.go:226–242](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/idp_service.go#L226-L242); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `c340e1f9271e32dd964e293f5c023eff0f3a1b75c5696e73b7422b23b2da3e8d`.

Enterprise SSO versus Google/GitHub feature check.

### BB-ROLE-GATE

SOURCE_VERIFIED — [bytebase/bytebase / backend/api/v1/role_service.go:68–88](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/role_service.go#L68-L88); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `a0b9177e9112f528de180f6bdf93b8a52f7390c90a5bb24504a55671495907a3`.

Custom role creation checks entitlement.

### BB-AUDIT-GATE

SOURCE_VERIFIED — [bytebase/bytebase / backend/api/v1/audit_log_service.go:28–53](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/audit_log_service.go#L28-L53); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `c519d2e5cfa46e2235799cf29aa959cb354071e42ee0f1e748843f422e5abc56`.

Audit search checks license feature.

### BB-QUERY-GATE

SOURCE_VERIFIED — [bytebase/bytebase / backend/api/v1/org_policy_service.go:680–728](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/org_policy_service.go#L680-L728); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `25628a1adbb092f5d0dc638d5647e8d0dfc476273edcd612f86314a795462056`.

Copy restrictions, query policy and masking check distinct features.

### BB-READONLY-GATE

SOURCE_VERIFIED — [bytebase/bytebase / backend/api/v1/instance_service.go:1215–1245](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/api/v1/instance_service.go#L1215-L1245); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `0140fa20a11118a8a38f6ec84d1ab207f55aa84c8be0d6ba208196bd1aa56868`.

Readonly datasource addition has separate feature guard.

### BB-METRICS

SOURCE_VERIFIED — [bytebase/bytebase / backend/server/metrics.go:1–39](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/backend/server/metrics.go#L1-L39); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `0d12017f13b6e4e87ea53be86df51bc4f9651dfbbb38da81f0eed54dc564b140`.

Prometheus endpoint registry and access restriction.

### BB-ROUTES

SOURCE_VERIFIED — [bytebase/bytebase / frontend/src/app/router/routes/dashboard.tsx:106–436](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L106-L436); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `bad9d6ec0b86f2dc226eb195fb19d0709363c9e064640101f68e9f338c904119`.

Navigation includes inventory, policies, audit, identity and integrations.

### BB-ROUTES-PROJECT

SOURCE_VERIFIED — [bytebase/bytebase / frontend/src/app/router/routes/dashboard.tsx:498–800](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/dashboard.tsx#L498-L800); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `bad9d6ec0b86f2dc226eb195fb19d0709363c9e064640101f68e9f338c904119`.

Detail and project route composition; page availability is separate from authorization.

### BB-SQL-ROUTES

SOURCE_VERIFIED — [bytebase/bytebase / frontend/src/app/router/routes/sqlEditor.tsx:1–86](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/frontend/src/app/router/routes/sqlEditor.tsx#L1-L86); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `004d744d26f479eeb54fb785a1ca3bdfa6620830a00938047682d006128f46b9`.

Separate SQL editor route group.

### BB-SETTING

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/setting_service.proto:115–154](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/setting_service.proto#L115-L154); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `132a02dc4b27082cabf5dfd44aa52a46a83bf2fb55edbbd47c2e10bc0f9ef4a2`.

Workspace settings including approvals, environment, identity and security.

### BB-GROUP

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/database_group_service.proto:1–120](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_group_service.proto#L1-L120); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `26863b773b4d92f50ae866f15cb81c06f5f3fd8056c9b9562f5a3fead8585e5e`.

Database group API; selected group membership must be materialized for deployment.

### BB-ACCESS

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/access_grant_service.proto:15–144](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/access_grant_service.proto#L15-L144); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `99da6a83724c192723549b089afb6f41cd233b7b93c699f438af383671cf8554`.

Temporary project access grant lifecycle and scoped database association.

### BB-SAVED

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/saved_query_service.proto:1–124](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/saved_query_service.proto#L1-L124); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `59003dd1e535a1b851755ee7c8fafa47604c1e36787d6e8822b1feffccc7a8e7`.

Saved query lifecycle, listing and stars.

### BB-SERVICE-ACCOUNT

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/service_account_service.proto:1–122](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/service_account_service.proto#L1-L122); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `abae2c51818646b7af62a5fed56460417a536af8ef96b768f4473d934cde3c1d`.

Service account CRUD and key lifecycle API.

### BB-WORKLOAD

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/workload_identity_service.proto:1–140](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/workload_identity_service.proto#L1-L140); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `dc8c4cdc2a88a678abeb351804195e7c6cb1a246293d3f84ff62839e0c1c01a5`.

Workload identity API contract.

### BB-AI

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/ai_service.proto:1–107](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/ai_service.proto#L1-L107); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `0ba90aa579b2a692026be8ad83a4f730f65e16946657a44414b61b938cd4ee88`.

AI related APIs; no Oracle execution correctness guarantee.

### BB-CATALOG

SOURCE_VERIFIED — [bytebase/bytebase / proto/v1/v1/database_catalog_service.proto:1–110](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/proto/v1/v1/database_catalog_service.proto#L1-L110); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `89e0e88c0b1a1fa294d4f7075572ff65673e5e91cf4b3d628d5d33b84d65a824`.

Database catalog configuration API.

### AR-COMPILE

SOURCE_VERIFIED — [hhyo/Archery / sql/engines/oracle.py:1153–1195](https://github.com/hhyo/Archery/blob/ccc7134f48d0e261f9e3ffa0d445dcec48adb790/sql/engines/oracle.py#L1153-L1195); full commit `ccc7134f48d0e261f9e3ffa0d445dcec48adb790`; full file SHA-256 `b16d94c9756ae35e5047e44cd93887190fe751864d529cf62b59fc9f8b2ccbb9`.

Named PL/SQL validity lookup exists; OWNER/OBJECT_NAME with fetchone is narrower than complete package spec/body verification.

### DBGATE-README

DOC_VERIFIED — [dbgate/dbgate / README.md:1–100](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/README.md#L1-L100); full commit `d7c62fd89385543af59eb5ecdea3526a3f26ba70`; full file SHA-256 `f6c0ce2244a1ea1971528a76880bd352b625a476b92077564a02ccb6afcdab1e`.

DbGate documents multi-database workbench, compare/query designer and import/export capabilities; per-feature Oracle parity is not established.

### DBGATE-LICENSE

SOURCE_VERIFIED — [dbgate/dbgate / LICENSE:1–20](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/LICENSE#L1-L20); full commit `d7c62fd89385543af59eb5ecdea3526a3f26ba70`; full file SHA-256 `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.

Current DbGate root license is GPL-3.0; root rights do not eliminate dependency review.

### DBGATE-ORACLE

SOURCE_VERIFIED — [dbgate/dbgate / plugins/dbgate-plugin-oracle/src/backend/driver.js:1–130](https://github.com/dbgate/dbgate/blob/d7c62fd89385543af59eb5ecdea3526a3f26ba70/plugins/dbgate-plugin-oracle/src/backend/driver.js#L1-L130); full commit `d7c62fd89385543af59eb5ecdea3526a3f26ba70`; full file SHA-256 `95d8db78cf84c72bd5ed542378dfb6e17da11c731586b874de68fd6bbb95fafb`.

Oracle driver implementation is present; not a governed versioned release platform.

### NODE-LICENSE

SOURCE_VERIFIED — [oracle/node-oracledb / LICENSE.txt:1–20](https://github.com/oracle/node-oracledb/blob/80c54f80ded26fe3013244c275a2cfce38439d69/LICENSE.txt#L1-L20); full commit `80c54f80ded26fe3013244c275a2cfce38439d69`; full file SHA-256 `43d6761493f537b481d7a8e8247a803c979f32265f3e597d7d5ee64bcd710423`.

node-oracledb is dual Apache-2.0 or UPL-1.0; choose Apache for proposed platform integration.

### NODE-VERSION

SOURCE_VERIFIED — [oracle/node-oracledb / package.json:1–35](https://github.com/oracle/node-oracledb/blob/80c54f80ded26fe3013244c275a2cfce38439d69/package.json#L1-L35); full commit `80c54f80ded26fe3013244c275a2cfce38439d69`; full file SHA-256 `37265e1e960b39090707c0a2f294e2633afd7ecf72fb37815c54d9e8ead0eee8`.

Inspected stable package version is 7.0.1, distinct from current development head.

### GO-ORA-LICENSE

SOURCE_VERIFIED — [sijms/go-ora / LICENSE:1–21](https://github.com/sijms/go-ora/blob/62f8a42fe821414cec8fcacb1b877dfef836f798/LICENSE#L1-L21); full commit `62f8a42fe821414cec8fcacb1b877dfef836f798`; full file SHA-256 `86b6a31a08af7288285c3f242fd257d8d985587182c6af3796cb421daa0b8339`.

go-ora driver source uses MIT; no OCI dependency follows from its documented pure Go design.

### AF-DEPLOY-DOC

DOC_VERIFIED — [bablsoft/accessflow / ci-templates/examples/generic-curl-deployment.md:1–129](https://github.com/bablsoft/accessflow/blob/c8bb247637df76ce36e52f47b45899823409495e/ci-templates/examples/generic-curl-deployment.md#L1-L129); full commit `c8bb247637df76ce36e52f47b45899823409495e`; full file SHA-256 `1f4c9b51691959a49857cdefb329821b406552ba711d5ae47583ed963e29df09`.

Supported external deployment gate, idempotent request/confirmation and outcome API documented; it does not establish Oracle engine dispatch uniqueness.

### LB5-CURRENT-LICENSE

SOURCE_VERIFIED — [liquibase/liquibase / LICENSE.txt:1–66](https://github.com/liquibase/liquibase/blob/893a20a519cae987c152d84637f70c9cf5b70067/LICENSE.txt#L1-L66); full commit `893a20a519cae987c152d84637f70c9cf5b70067`; full file SHA-256 `06a5644579563750de2a41006d75d2fe40149e22f90aea9d5fe919095f43a508`.

Current inspected Liquibase source uses FSL-1.1-ALv2; restricted permitted-purpose grant is not current OSI open source.

### BB-FOLDER-ACTION

SOURCE_VERIFIED — [bytebase/bytebase / action/command/file.go:20–107](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/file.go#L20-L107); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `f7ecfb762c9193532ea72e25db5b3b67ef39ddc7747ae698cbab9aca412d43c6`.

Supported action recursively globs local migration files, extracts numeric versions and builds Release_File entries; a server-side repository folder loader is a separate scope.

### BB-ACTION-ROLLOUT

SOURCE_VERIFIED — [bytebase/bytebase / action/command/rollout.go:68–123](https://github.com/bytebase/bytebase/blob/80524fc54601bcc5545575e02f83b23ee6bb0a70/action/command/rollout.go#L68-L123); full commit `80524fc54601bcc5545575e02f83b23ee6bb0a70`; full file SHA-256 `efd798ae9d4fb6941515bd8b08dcebfa950218bd4a0866e71a270d7f88c9fe55`.

Supported action creates a versioned/declarative release with VCS provenance then references it in a plan.

### BB-PRICING

DOC_VERIFIED — [Bytebase primary documentation](https://www.bytebase.com/pricing/), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Current page has 20-user/10-instance Community quota and separate approval, identity, audit and HA edition boundaries. Use page/plan gates together; no Enterprise runtime acceptance was performed.

### BB-APPROVAL-DOC

DOC_VERIFIED — [Bytebase primary documentation](https://docs.bytebase.com/change-database/approval), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Documentation describes custom approval policy configuration. Presence of documentation is not proof of Community entitlement or runtime enforcement.

### BB-HA-DOC

DOC_VERIFIED — [Bytebase primary documentation](https://docs.bytebase.com/changelog/bytebase-3-17-0), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Documentation index advertises high availability since 3.17.0; current deployment behavior needs an exact licensed-build test.

### FW-ORACLE-DOC

DOC_VERIFIED — [Flyway primary documentation](https://documentation.red-gate.com/flyway/reference/database-driver-reference/oracle-database), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Oracle SQL/PLSQL and slash delimiters are documented. SQL*Plus command emulation is Teams; open-source Java Oracle artifact and JDBC driver are separate components.

### ORACLE-COMMIT

DOC_VERIFIED — [Oracle primary documentation](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Oracle commits before syntactically valid DDL and after successful DDL. Failure/response loss may leave committed effects; release-wide atomicity is not assumed.

### ORACLE-ERRORS

DOC_VERIFIED — [Oracle primary documentation](https://docs.oracle.com/en/database/oracle/oracle-database/19/refrn/USER_ERRORS.html), accessed 2026-10-08. Live documentation; not a fixed deployed build.

USER_ERRORS reports compiler errors on objects owned by the current user. Changing CURRENT_SCHEMA does not make it another owner.

### ORACLE-LOCK

DOC_VERIFIED — [Oracle primary documentation](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Session locks with release_on_commit false survive commits; session termination releases them. ALLOCATE_UNIQUE commits; autonomous allocation avoids committing caller work. A restricted cover package is recommended.

### NODE-THIN-DOC

DOC_VERIFIED — [node-oracledb primary documentation](https://node-oracledb.readthedocs.io/en/latest/user_guide/introduction.html), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Thin driver connects directly without Oracle Client libraries and handles SQL/PLSQL and pools. Documentation is broader than the exact new-platform test matrix.

### NODE-MODES-DOC

DOC_VERIFIED — [node-oracledb primary documentation](https://node-oracledb.readthedocs.io/en/latest/user_guide/appendix_a.html), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Thin supports Oracle 12.1+, TLS, proxy connections and homogeneous pools. Native Network Encryption/Kerberos/external authentication/AC require careful mode review and are not default Thin assumptions.

### ORACLE-JDBC-DOC

DOC_VERIFIED — [Oracle primary documentation](https://www.oracle.com/database/technologies/faq-jdbc.html), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Oracle JDBC Thin needs no Instant Client but is distributed under separate Oracle terms, not the open-source extensions license. Exact JAR/version and companion terms must be reviewed.

### ATLAS-DOC

DOC_VERIFIED — [Atlas primary documentation](https://www.atlasgo.io/features), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Oracle driver is Pro; Apache public core does not grant access to that driver.

### LIQUIBASE-LICENSE-DOC

DOC_VERIFIED — [Liquibase primary documentation](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Community transitioned to FSL; inspect exact version. Pinned 4.33 source rights differ from 5.x and from mixed binary distributions.

### GITLAB-APPROVAL

DOC_VERIFIED — [GitLab primary documentation](https://docs.gitlab.com/ci/environments/deployment_approvals/), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Deployment approvals have Premium/Ultimate boundaries. New platform approval remains authoritative, allowing GitLab Free as source provider.

### JENKINS-INPUT

DOC_VERIFIED — [Jenkins primary documentation](https://www.jenkins.io/doc/pipeline/steps/pipeline-input-step/), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Pipeline input supports submitter restrictions but administrator behavior and executable pipeline permissions need consideration; platform approval cannot be inferred from build color.

### TECH-FASTIFY

DOC_VERIFIED — [Fastify primary documentation](https://fastify.dev/docs/latest/), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Candidate maintained HTTP framework. Framework adoption and exact dependency closure require an implementation-time pin.

### TECH-POSTGRES

DOC_VERIFIED — [PostgreSQL primary documentation](https://www.postgresql.org/docs/current/sql-select.html), accessed 2026-10-08. Live documentation; not a fixed deployed build.

SKIP LOCKED supports queue consumers; PostgreSQL transaction/admission does not atomically commit Oracle DDL.

### TECH-OTEL

DOC_VERIFIED — [OpenTelemetry primary documentation](https://opentelemetry.io/docs/), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Candidate interoperable tracing/metrics instrumentation; payload redaction and offline collector configuration are new platform responsibilities.

### TECH-SPDX

DOC_VERIFIED — [SPDX primary documentation](https://spdx.dev/use/specifications/), accessed 2026-10-08. Live documentation; not a fixed deployed build.

Candidate SBOM interchange standard; SBOM existence does not establish acceptable licenses or vulnerability status.
