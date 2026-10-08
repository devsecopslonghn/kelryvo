# Flyway Oracle parser isolation feasibility

**Status: feasible for an offline isolated Java helper; distribution approval and the complete parser contract remain gated.** This is WP0-T02 evidence only. It does not accept WP0-T03 or certify Oracle behavior.

The prototype under `experiments/db-devops-wp0/parser-helper/` constructs Flyway's internal `OracleParser` directly and reads SQL bytes from stdin. It has no database connection path. Its response carries `schema_version: 1`, `scope: OFFLINE_CANDIDATE_ONLY`, and false production/execution approval fields; STOP exits with status 2. Input is capped at 2 MiB and malformed UTF-8 and UTF-8 BOM are rejected generically. The source checkout was clean at Flyway commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; the helper was rebuilt and run with the published Maven Central artifacts, rather than source-built jars.

## Runtime closure observed

The helper's pinned runtime Maven tree is:

```text
local.schemaforge:flyway-oracle-parser-helper:0.1.0-SNAPSHOT
`- org.flywaydb:flyway-database-oracle:13.9.0
   `- org.flywaydb:flyway-core:13.9.0
      `- com.fasterxml.jackson.core:jackson-annotations:2.22
```

`ojdbc11` appears as optional in the Flyway Oracle module POM and is absent from this runtime closure and the assembled helper. No Redgate proprietary runtime dependency was observed. The helper POM pins runtime and Maven plugin versions: clean 3.4.1, resources 3.3.1, compiler 3.14.1, surefire 3.5.4, jar 3.4.2, dependency 3.8.1, and assembly 3.7.1. It sets Java release 21 and fixed output timestamp `2026-10-08T00:00:00Z`. The tested toolchain is Temurin `21.0.12.1+1` and Maven `3.9.16`. Maven plugin transitive dependencies are build-time inputs and are not part of the runtime tree above. The full resolved Maven plugin graph and runtime tree are retained in ignored `.cache/parser/plugin-resolution.log` and `.cache/parser/runtime-dependency-tree.txt`; plugin closure includes Maven's default install/deploy plugins and is not part of the helper runtime.

Published artifact hashes (SHA-256):

| Artifact | SHA-256 |
|---|---|
| `org.flywaydb:flyway-database-oracle:13.9.0` | `4ff1e0bf055165aad8a6561e0aaa7975678c16684c0fc6ec75fb0db9f8c96ad6` |
| `org.flywaydb:flyway-core:13.9.0` | `d7ef137f0c02ef18fb85f21370504c737061a446d0387109ee6111ff27e631fe` |
| `com.fasterxml.jackson.core:jackson-annotations:2.22` | `21ddb598807d3a51a876704eb979d9296e1c6a6f47ab1826ff88c6d6a127a2d0` |

The Flyway source modules declare Apache-2.0. Jackson Annotations 2.22 declares Apache-2.0. These declarations are inputs to the separate license/NOTICE audit, not distribution approval. The prototype fat jar is a feasibility artifact; its assembly merges metadata and is not a final notice-compliant distribution format. The product license remains pending.

## Smoke evidence and boundary

Command: `mvn -q -DskipTests clean package` in the helper directory, followed by piping representative SQL into `java -jar target/flyway-oracle-parser-helper-0.1.0-SNAPSHOT-jar-with-dependencies.jar`.

- Two ordinary Oracle SQL/PLSQL statements were recognized in order, including slash-delimited PL/SQL.
- A multibyte UTF-8 identifier (`café`) produced correct exclusive byte offsets. The helper maps Flyway's character offset to UTF-8 bytes and checks the exact source slice against Flyway's SQL plus delimiter before returning it.
- A script with a leading comment returned `STOP: parser_output_not_contiguous_source_bytes` because Flyway's parsed SQL did not match the source slice. The helper fails closed instead of inventing ranges or dropping bytes.
- An incomplete `BEGIN NULL;` was rejected by Flyway and converted to a generic `parser_rejected_input` STOP. No source SQL is emitted in the CLI error response.
- `PROMPT hello;` and `SET DEFINE OFF;` were both accepted as ordinary statements. The mature parser alone does not detect SQL*Plus-only commands. `@other.sql` did not produce a usable exact source range and stopped.
- Against all manifest files, 21 of 23 expected statement goldens matched exact source ranges, source hashes, execution bytes, and execution hashes. Of 15 files expected to stop, 6 stopped as expected. The remaining failures were the required comment-preservation cases (`F14/comments.sql`, `F17/comment-control.sql`) and nine `F17` SQL*Plus directive cases that the Flyway parser accepted as statements. This corpus result blocks parser compatibility; it does not invalidate isolated packaging feasibility.
- Two separate offline clean/package builds with the selected Temurin 21.0.12.1+1 and Maven 3.9.16 produced the same helper assembly SHA-256: `cfeab7e0db89348aece0f56f896e3acb0024056e531e02637b318a6800650a15`.

This establishes that the actual released parser can run in a small driver-free JVM package and can support byte ranges when its returned statement plus delimiter is a contiguous source slice. It also demonstrates real boundaries requiring policy and fixture coverage: comments and any parser normalization that breaks exact source correspondence must yield STOP, and SQL*Plus-only commands can pass through as statements. The internal parser API exposes a statement start character offset but no exclusive end offset or explicit SQL*Plus rejection result. The prototype derives an end only when its exact-slice check succeeds. Do not weaken this guard with custom tokenization or a fallback splitter. T03 must establish a reviewed mature-parser boundary for these required cases or remain blocked/reopen ADR-I03; this smoke does not prove compatibility.

Before selecting the helper for WP0-T03, finish the artifact/license/NOTICE and JRE distribution audit, agree the failure contract with the parent envelope, and exercise all required positive and negative parser fixtures. No Oracle 19c/21c behavior is established here.

PR review additionally requires complete source coverage at the parent boundary. Only ASCII
whitespace bytes (space and bytes 0x09 through 0x0d) may precede, separate or follow returned
ranges. Any other uncovered byte causes `uncovered_source_bytes`, including a zero-statement
response for executable or comment-only input. Comments must be included in parser-produced
source ranges; the parent does not tokenize comments or SQL. This conservative boundary fixes
omission acceptance without changing the documented comment/SQL*Plus candidate failures.
