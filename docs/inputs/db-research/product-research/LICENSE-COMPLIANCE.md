# License and independent implementation assessment

8 October 2026. Evidence-driven component assessment, not a legal clearance of an unbuilt distribution. The platform is a design; there is no dependency lockfile, binary SBOM or release artifact to certify. Existing [license audit](../LICENSE-AUDIT.md) and [component review](../evaluation/research-round-2/licensing/licensing-review.md) remain unchanged.

Recommend **Apache-2.0 for independently authored platform code**, with notices and explicit contribution provenance. It is an OSI-approved permissive license with a patent grant and suits public self-hosted releases and integrations. MIT is simpler but lacks the same express patent structure. AGPL-3.0 is an alternative if network-source reciprocity is a deliberate product goal; do not choose it accidentally by embedding a copyleft product. License choice is a recommendation for a future repository, not a license applied to historical research or third-party snapshots.

## Component rights and boundaries

| Component / exact source scope | Evidence | Reuse or integration decision | Outstanding release requirement |
|---|---|---|---|
| Bytebase `80524fc…`; selected current head `16b89d9…` files unchanged | BB-L, BB-ENT, current-source-review.json | Functional reference only. Root license excludes enterprise directories and enablement code from its MIT subset; this task excludes copying any Bytebase source | Independently implement requirements/tests/assets; do not import Bytebase code or remove its gates |
| ODC backend `d517c0f…`, frontend `273fa3c…` | P-ODC-LICENSE, P-ODC-CLIENT-L | Apache core may legally inform reviewed reuse; proposed product does not fork it | Drivers, fonts, transitive dependencies and packaged image still need inspection |
| Archery `ccc7134…` | AR-L, AR-ORA | Apache code patterns can inform research; no executor code reused | HEAD/release differ: historical release can require cx_Oracle/Instant Client; no transfer of HEAD rights/capability to image |
| Flyway **13.9.0** `a549f5d…` | FW-L, FW-PARSER, module POM | Candidate Apache parser-only dependency; optional full engine adapter separately | Verify core/Oracle module NOTICE and full transitive closure; no Redgate proprietary package introduced; JDBC rights distinct |
| Liquibase **4.33.0** `75773ed…` | LB4-L | Apache source candidate only; optional adapter, not default | Inspect binary distribution for commercial modules and fund security maintenance |
| Current Liquibase `893a20a…` | LB5-CURRENT-LICENSE | FSL-1.1-ALv2 is source-available with permitted-purpose restrictions; exclude required OSS path | Two-year future conversion is version/time specific, not an immediate blanket Apache grant |
| Sqitch `b08e5c8…` | SQ-L, SQ-SQLPLUS | MIT source candidate; verification/registry ideas useful | Oracle SQL*Plus/client and Perl dependency distribution are separate |
| Atlas `1317a57…` | AT-L, AT-DRIVERS, ATLAS-DOC | Apache public core; Oracle Pro adapter excluded as mandatory runtime | Public source does not grant proprietary Oracle features |
| AccessFlow `55c209a…`, current gate docs `c8bb247…` | AF-L, AF-DEPLOY-DOC | Apache deployment-gate model informs design; no product fork | JDBC/SaaS/AI/secret adapters have distinct components and rights |
| DbGate `d7c62fd…`; Oracle plugin package 7.0.0-alpha.1 | DBGATE-LICENSE, DBGATE-ORACLE | GPL-3.0: independent UX study; exclude embedded plugin/application code from proposed Apache core | Combining or distributing derivative code requires appropriate GPL compliance; a process boundary alone is not legal clearance |
| CloudBeaver `74123b3…` | CB-L, CB-SCOPE, CB-ORA | Apache Community workbench can inform UX, not assumed governance parity | Commercial features and Oracle driver distribution separate |
| node-oracledb **7.0.1** `80c54f8…` | NODE-LICENSE, NODE-VERSION | Choose Apache-2.0 option of Apache/UPL dual license; Thin path requires no Instant Client | Verify exact package contents/native optional pieces, notices, advisories and source availability |
| go-ora inspected commit in current-source-review.json | GO-ORA-LICENSE | MIT FOSS reserve; not default solely because Bytebase uses it | Driver correctness/support, complete dependencies and security patch ownership |
| Oracle JDBC / UCP / wallet companion JARs | ORACLE-JDBC-DOC | Proprietary terms separate from OSS engine/source; optional BYO profile only if user accepts requirement change | Exact JAR version/hash, applicable FDHUT/FUTC or other actual terms, use versus redistribution and companion coverage |
| Oracle Instant Client / SQL*Plus | Historical licensing review | Exclude required Thin core. Optional adapter requires specific terms | Distribution conditions and any benchmark/disclosure restrictions depend on exact client agreement; do not generalize to all platform measurements |
| Oracle Database target | User's existing target requirement | Platform FOSS status does not grant Oracle server/pack rights | Existing database entitlements; no implied right to AWR/ASH, options or Oracle images |

Current [Bytebase pricing](https://www.bytebase.com/pricing/) has Community count and edition gates. Those are reference-product limits; the proposed platform has no instance/user/project quota. Source feature flags do not establish an entitlement to proprietary code. Licensing and engineering mechanisms are separate dimensions.

Oracle [JDBC FAQ](https://www.oracle.com/database/technologies/faq-jdbc.html) addresses separate redistribution terms. Do not confuse the UPL license of `ojdbc-extensions` with the JDBC driver binary. Oracle's OSS [node-oracledb license](https://github.com/oracle/node-oracledb/blob/80c54f80ded26fe3013244c275a2cfce38439d69/LICENSE.txt) supplies a default route that avoids that required client exception, subject to Thin feature compatibility.

## Candidate platform dependency register

| Proposed dependency family | Expected upstream grant to verify at implementation pin | Packaging choice |
|---|---|---|
| Node.js, TypeScript, Fastify, React, Vite | Permissive source licenses; runtime/bundled notices require a full pin-level review | Offline mirrored runtime/build packages; no dev dependency silently shipped |
| PostgreSQL | PostgreSQL license | Existing supported database distribution, with OS packages/backup tooling separately inventoried |
| Flyway parser / OpenJDK | Apache module; chosen OpenJDK distribution includes GPL/classpath and additional notices | Local parser helper with approved JRE; do not use an Oracle JDK subscription as an assumed requirement |
| Keycloak | Apache upstream candidate | Optional V1 identity service or existing OIDC provider |
| OpenBao | MPL-2.0 upstream candidate | Optional secret service; modified covered files require license obligations |
| Prometheus / OpenTelemetry | Apache upstream candidates | Optional local collectors; query/dashboard plugins and exporters separately reviewed |
| Icon/fonts/component library | UNKNOWN until exact selection | Choose permissive assets; preserve notices; original product branding |

These family-level descriptions are not pin-level approvals. Obtain license texts from the exact selected commit/package, not a current README alone. An SBOM must include application, transitive JavaScript/JVM/native modules, container/base OS, fonts, parser grammars, generated code and optional adapters. Review reciprocal obligations and patent/trademark clauses; retain LICENSE/NOTICE files and source offers where required. The documented schema's namespace placeholder does not create a proprietary dependency.

## Independent implementation protocol

Use this feature/acceptance catalog as the implementation specification. Preserve citation/provenance for research findings and explicitly label proposed behavior. Author platform code and UI anew; do not copy Bytebase source, including its enterprise and enablement paths. Observation of user-visible workflows does not grant rights to artwork, branding or implementation code. Public APIs may inform interoperability requirements, but the new API design is independent.

Any future reuse must record repository, full commit, exact files, licenses/headers, dependency closure, intended linkage/distribution, modifications and notices before importing code. Candidate parser reuse is **not yet approved through an actual code audit**: first milestone reviews the exact Apache closure and reproducible packaging. Do not add vendor code as an unreviewed convenience dependency or automatically switch to newer FSL/proprietary artifacts.

Security maintenance remains part of compliance: track advisories, mirror verified updates for offline installs, rebuild reproducibly, sign image/artifact digests, and publish versioned notices. A clean license label is not proof of production readiness. The largest unresolved compliance risks are exact parser/package closure, mixed binaries, Oracle optional clients and long-term support for older permissive engine lines.
