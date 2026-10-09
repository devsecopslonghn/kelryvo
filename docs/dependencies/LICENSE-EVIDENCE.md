# Third-party dependency notices and license evidence

Register date: 2026-10-08. This records exact selected artifacts and evidence for WP0; it does not decide the independently authored product license.

At this register's 2026-10-08 snapshot the product license was **PENDING_OWNER_DECISION**.
On 2026-10-09 the owner selected PolyForm Shield 1.0.0; see the current
[product license scope](../product/license-and-naming.md). Historical WP0 registers,
including `third-party-notices.json`, retain their original observations. The artifact-level
grants below are unchanged; packaging must preserve notices and applicable source obligations.

## Selected npm closure

The selected lockfile closure is the three exact packages below. Downloaded npm tarball SHA-512 values match `package-lock.json`; their SHA-256 values, source evidence and notice paths are in [third-party-notices.json](third-party-notices.json). There are no transitive npm dependencies in the selected closure.

| Package | Version | License | Role | Evidence |
|---|---:|---|---|---|
| `oracledb` | 7.0.1 | Apache-2.0 OR UPL-1.0 | Oracle Thin driver | Exact tarball includes `package/LICENSE.txt` and `package/NOTICE.txt`; the selected operating mode is Thin. |
| `postgres` | 3.4.9 | Unlicense | PostgreSQL client | Exact npm tarball has no license file. The exact npm `gitHead` source archive contains `UNLICENSE`; raw upstream text hash is recorded in the JSON register. |
| `typescript` | 6.0.2 | Apache-2.0 | Build compiler | Exact tarball includes `package/LICENSE.txt`. |

The rejected `pg@8.23.1` candidate and its 15-package closure remain in `third-party-notices.json` under `historical_candidate_evaluations` with `NOT_SELECTED` status. The two MIT text gaps (`pg-types`, `pgpass`) are not part of the selected dependency closure.

## Parser helper runtime and build closure

The helper uses Flyway source commit `a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c`; its only Maven runtime artifacts are:

| Coordinate | License | SHA-256 | Evidence |
|---|---|---|---|
| `org.flywaydb:flyway-database-oracle:13.9.0` | Apache-2.0 | `4ff1e0bf055165aad8a6561e0aaa7975678c16684c0fc6ec75fb0db9f8c96ad6` | Exact published Maven Central JAR; source-root license and Flyway Core license evidence. |
| `org.flywaydb:flyway-core:13.9.0` | Apache-2.0 | `d7ef137f0c02ef18fb85f21370504c737061a446d0387109ee6111ff27e631fe` | Exact published JAR includes `META-INF/LICENSE.txt`. |
| `com.fasterxml.jackson.core:jackson-annotations:2.22` | Apache-2.0 | `21ddb598807d3a51a876704eb979d9296e1c6a6f47ab1826ff88c6d6a127a2d0` | Exact published JAR includes `META-INF/LICENSE` and `META-INF/NOTICE`. |

`ojdbc11` is optional and excluded. The exact assembled helper artifact SHA-256 is `cfeab7e0db89348aece0f56f896e3acb0024056e531e02637b318a6800650a15`; the JAR contains `META-INF/LICENSE`, `META-INF/LICENSE.txt`, and `META-INF/NOTICE`.

The seven declared Maven plugins resolve to 90 closure artifacts. All have checksum evidence and identified license grants; the register reports zero missing artifacts and zero unknown required licenses. [maven-build-plugin-closure.json](maven-build-plugin-closure.json) records coordinates and direct/parent POM evidence. [maven-build-cache-lock.json](maven-build-cache-lock.json) records exact checksums and source URLs for selected runtime/plugin JARs and the recursively used parent/imported-BOM POMs. These plugins are build-time inputs and are not in the helper runtime closure.

## Runtime and build tools

| Artifact | Exact selection and evidence | Current workflow role |
|---|---|---|
| Node.js and npm | Node 22.23.3 Linux x64 archive SHA-256 `df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de`, matching official `SHASUMS256.txt`; npm 10.9.9. Exact npm source commit and all 195 bundled package records are in [node-npm-closure.json](node-npm-closure.json). Every package declares a license; seven exact npm bundled instances lack colocated license text, with upstream source evidence/any remaining text gap explicitly tracked there. | Node/npm are provided externally here; npm performs installation/build functions and is not invoked by the application. The workflow does not bundle the Node distribution. The npm text gaps are relevant if a later package bundles Node/npm. Node 22's published release schedule lists end of life as 2027-04-30. |
| Eclipse Temurin JDK | 21.0.12.1+1 Linux x64 archive SHA-256 `ce79869e1307ed8ee1e2baa86a412b1eb5b75d10a01006d788a6f968bcfaee94`; source commit `1c417fbfc2f70ab03a565b0af0a5a3c6f5e15ad6`. The JSON register includes hashes for all 38 exact `legal/` files. | Externally installed build/runtime prerequisite, not bundled by this project. The exact distribution identifies GPL-2.0 with Classpath Exception and component-specific notices. Any later JDK redistribution must preserve the legal files and follow the license's applicable source availability terms. |
| Apache Maven | 3.9.16 binary archive SHA-512 `831a8591fe20c8243b1dbe7d71e3244f31d1665b0804b2e825e38cbbe5ce0cafb8338851f90780735568773e0a6cd07bbec107cda0b896b008b861075358b6f6`; source archive SHA-512 `a1498f762615c2f536aebe4b8823045590815b8704423254a98bd28f243115d8bd3483c653254c489b979286b593170153567c89004a8b1f6c41c8794c1dbd94`. Official versioned dependency metadata identifies all 51 distribution JAR licenses; zero unknown components. The register includes each legal-file hash. | Build-only tool, externally installed and not bundled. See [maven-runtime-closure.json](maven-runtime-closure.json). |

No Oracle JDBC driver, Instant Client, SQL*Plus, Liquibase FSL, or Bytebase artifact is in the required dependency closure. Product license selection remains the owner’s independent decision; this audit does not infer or select it.

## ANTLR successor

The reviewed offline T03 boundary adds unchanged Apache-2.0 PL/SQL grammar sources and
separately pinned BSD-3-Clause ANTLR4 runtime. The complete generator is external/build-only;
its included BSD components and declared-but-absent ICU4J are recorded distinctly in
[lock](antlr-parser-lock.json). External JDK is the already audited Temurin artifact.
The helper includes notice/license texts and excludes runtime/tool classes. Upstream Java
support files without explicit grants are excluded; [provenance](antlr-provenance.md)
discloses the independent rewrite and prior source exposure. The product license is now
selected; final packaging/source obligations remain pending. This is no general legal clearance.
