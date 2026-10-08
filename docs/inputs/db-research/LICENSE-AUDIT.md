# License and edition audit

## License/release review sâu, 04/10/2026

[Component register](evaluation/research-round-2/licensing/license-components.csv) tách source, image, plugin, driver và edition.
[Pricing provenance](evaluation/research-round-2/coordinator/public-docs/pricing-observation.md) ghi CloudDM index 10 instance/5 account và direct GET khác nội dung. Current enforcement chưa kiểm.
[Oracle client review](evaluation/research-round-2/licensing/licensing-review.md) tách JDBC Thin với Instant Client và quyền dùng/phân phối/disclosure benchmark.
[Release pins](evaluation/research-round-2/licensing/release-pins.csv) không thay historical image/source. Archive SHA không là OCI digest.
Source license không xác nhận toàn image hoặc mọi feature entitled. Không có full SBOM audit mới.

## Cập nhật license T03, 04/10/2026

[Source reports T03](evaluation/README.md) tách repo, image, plugin, driver và feature edition.
[Bytebase review](evaluation/candidates/bytebase/source-review.md) kiểm lại license/plan đúng runtime commit `a85f6cb4195299995e8554303550d672d5093e1d`.
[CloudDM review](evaluation/candidates/clouddm/source-review.md) giữ current image/free limits là chưa xác minh.
Các bảng cũ phía dưới vẫn thuộc snapshot đã ghi, không thay giấy phép image hoặc hợp đồng hiện tại.

The revised platform shortlist contains ODC and AccessFlow.
Neither shortlist entry establishes complete execution acceptance.
A free source license does not establish a complete database change platform.
This register separates source rights, product limits, and required dependencies.

Research date: 2026-10-03.
Each source license reference resolves to the inspected commit in [EVIDENCE.md](EVIDENCE.md#source-references).
The audit concerns the inspected repository source.
It does not certify every published binary, image, extension, or dependency.

| Candidate | Actual inspected license | Internal modification and fork | User / database / environment limits | Paid capability or unresolved boundary | Required SaaS for normal local execution | Source evidence |
|---|---|---|---|---|---|---|
| Bytebase | MIT subset. Proprietary enterprise directories. Enablement code is excluded from the MIT grant. | YES for MIT portions. Enterprise production rights require a subscription. Unrestricted enablement-code rights not established. | Free: 20 users, 10 instances. Separate free environment count not identified. | Approval, audit, enterprise identity, custom roles, external secrets | NO | BB-L, BB-ENT, BB-PLAN, BB-GATES |
| AccessFlow | Apache-2.0 | YES under license conditions | No license limit identified in the inspected governance path | No paid workflow gate identified. Optional remote AI and secret providers are separate dependencies. | NO. Local deployment and local AI alternatives are documented. | AF-L, AF-DR, AF-CI |
| D-Band DRM | ISC declaration in package.json. Complete payload coverage UNKNOWN. | UNKNOWN for the complete Python payload | No paid count limit identified. Local metadata does not establish unlimited central users. | Flyway dryRunOutput requires Teams. Complete license text missing. | NO for the documented local command path | DRM-L, DRM-LOCAL, DRM-FW |
| Open Migration | MIT | YES under license conditions | No license count limit identified. Multi-user governance absent. | Oracle implementation absent | NO | OM-L, OM-ENG, OM-AUTH |
| SchemaPilot | Custom restricted license | PARTIAL. Internal use and modification within the specified scope. | No count limit established | Commercial redistribution and paid hosting restricted | NO for the inspected local server | SP-L, SP-DRIVERS |
| Flyway UI | Apache-2.0 | YES under license conditions | No count limit identified. One supplied Flyway service is not central inventory. | Flyway 2.2.1 and legacy Java dependency | NO | UI-L, UI-DEPS, UI-SERVLET |
| Flyway Play | Apache-2.0 | YES under license conditions | Application module. No central user or environment product limit. | Configured engine and driver licenses require separate checks. | NO | PLAY-L, PLAY-DEPS, PLAY-SCOPE |
| Liquibase Community 5.x | FSL-1.1-ALv2 | PARTIAL. Specified permitted uses, with a commercial-competition restriction. | No central platform provided | Current source is not strict OSS. Apache conversion occurs after two years. | NO for command execution | LB5-L |
| Liquibase 4.33.0 source | Apache-2.0 | YES under license conditions | No central platform provided | Actual distributions can include commercial code. Future Apache-only maintenance UNKNOWN. | NO | LB4-L and official 4.33 FAQ |
| Flyway Community source | Apache-2.0 | YES under license conditions | No central platform provided | SQLPlus interpretation and dryRunOutput require Teams. Native Redgate features are separate. | NO for JDBC migration | FW-L, FW-ORA and official Flyway feature references |
| Sqitch | MIT | YES under license conditions | No central platform provided | Oracle SQLPlus client has separate license terms. | NO for command execution | SQ-L, SQ-SQLPLUS |
| Atlas public OSS | Apache-2.0 | YES for public Apache source | No OSS central platform established | Oracle support requires Pro. Public source license does not grant Oracle Pro rights. | NO for supported OSS engines | AT-L, AT-DRIVERS and official Atlas compatibility |
| Yearning | AGPL-3.0 | YES, subject to AGPL obligations | No paid count limit identified in the reviewed scope | MySQL only. Required external checker dependencies need their own license review. | NO | YE-L, YE-SCOPE |
| Archery | Apache-2.0 | YES under license conditions | No paid count limit identified in the reviewed scope | External review and backup tools have separate dependencies. No target migration ledger. | NO | AR-L, AR-DOC, AR-EXEC |
| Tareya derivative | Apache-2.0 inherited source | YES under license conditions | Independent product limits UNKNOWN | Independent support and dependency coverage UNKNOWN | NO for inherited local deployment | FORK-L, FORK-EXEC |
| .NET dbdeploy | MIT | YES under license conditions | No central platform provided | Oracle Managed Data Access dependency needs separate distribution review. | NO | DEP-L, DEP-ORA |
| DbMaintain | Apache-2.0 | YES under license conditions | No central platform provided | Deprecated. Oracle JDBC and native client dependencies are separate. | NO | MAINT-L, MAINT-SCOPE |
| dbpm | Apache-2.0 command repository | YES for the inspected command source. Complete Core rights UNKNOWN. | No central platform provided | Required Core substrate and Oracle client were not fully audited. | NO for the described Oracle execution path | PM-L, PM-SCOPE |
| dbward core | Apache-2.0 core. Commercial identity and plan code. | YES for Apache core. Separate rights apply to commercial code. | Documented Free distribution: 20 active users, 3 connections. Full OSS-build limit behavior UNKNOWN. | OIDC, group authorization, and audit export have paid boundaries. | NO for local core deployment | WARD-L, WARD-BOUNDARY, WARD-PLAN |
| CloudBeaver Community | Apache-2.0 public source. Separate commercial editions. | YES for Apache source | No count limit established in this review | Enterprise identity and administration boundaries need separate versioned review. | NO for Community local deployment | CB-L, CB-SCOPE, CB-ORA |

A proprietary Oracle database or client is not evidence that the platform source is proprietary.
The platform still needs a permitted distribution and execution path for each dependency.
A strict OSS composition must distinguish engine source from commercially bundled executables.

Apache and MIT licenses permit modification under their stated conditions.
AGPL applies additional source obligations, including relevant network use of modified software.
The exact license file controls those conditions.
This report does not propose removal of proprietary license enforcement.

Current FSL and SchemaPilot restrictions differ from open-source licenses.
The [Open Source Definition](https://opensource.org/definition-annotated) permits commercial use and derived works without those product restrictions.

Official boundary references:

- [Bytebase pricing](https://www.bytebase.com/pricing/)
- [Liquibase 4.33 FAQ](https://docs.liquibase.com/oss/user-guide-4-33/faq)
- [Liquibase Community license change](https://www.liquibase.com/blog/liquibase-community-for-the-future-fsl)
- [Flyway Oracle settings](https://documentation.red-gate.com/flyway/reference/configuration/flyway-namespace/flyway-oracle-namespace)
- [Flyway settings and dryRunOutput](https://documentation.red-gate.com/fd/flyway-namespace-277578913.html)
- [Atlas compatibility](https://atlasgo.io/features)

## Product-model search additions

These source findings supplement the original twenty-candidate audit.
License rights do not establish product capability or runtime correctness.

| Project | Inspected source license | Internal modification | Free Oracle/platform boundary | Source |
|---|---|---|---|---|
| OceanBase ODC backend and pinned frontend | Apache-2.0 | YES under license conditions | No paid user/instance gate identified in inspected project and batch-change paths. Oracle JDBC plugin and ojdbc8 driver are present in the deployed image. Complete dependency license audit remains outstanding. | P-ODC-LICENSE, P-ODC-CLIENT-L, P-ODC-ORACLE |
| SQLE and DMS core | MPL-2.0 | YES under license conditions | Project creation/changes, global inventory, SQL versions, dependencies, and batch releases are Enterprise features. | P-SQLE-L, P-DMS-L, P-SQLE-CE, P-DMS-PROJECT-CE, P-DMS-INVENTORY-CE |
| SQLE Oracle plugin | No root license file in inspected snapshot | UNKNOWN for full plugin rights | Direct Oracle execution exists. Fully licensed free Oracle distribution not established. | P-SQLE-ORACLE, P-SQLE-ORACLE-DOC |
| NineData Community repository | No implementation source or OSS license | UNKNOWN | Free self-hosted distribution is documented. OSS platform rights are not established. | P-NINE-DOC |
| Historical and renamed Bytebase forks | Apache/MIT subsets or Apache snapshot, depending on repository | Depends on exact snapshot and file coverage | Enterprise source remains restricted where included. Inherited or renamed code does not remove edition boundaries. | P-FORK-* and FORK-SEARCH.md |

All `P-` references resolve in [PRODUCT-EVIDENCE.md](PRODUCT-EVIDENCE.md#source-references).
The current Bytebase license excludes enablement code from its MIT grant without a clear separate grant on that line.
The report does not assume unrestricted reuse of that code.
The [fork record](FORK-SEARCH.md) records snapshot-specific license differences.

## ODC licensing and commercial trial distinction

ODC's backend and pinned frontend use Apache-2.0. The grant does not require purchasing an OceanBase commercial database trial.
The [official trial page](https://www.oceanbase.com/free-trial) describes commercial database trials, hosted-service credit, and Community Edition.
Those are different offerings from this self-hosted ODC deployment.
The [Apache-2.0 license](https://www.apache.org/licenses/LICENSE-2.0) permits commercial distribution and paid support.
Infrastructure, operation, support, and Oracle target licensing remain separate costs.
Do not extend the ODC license grant to OceanBase CE or every packaged dependency without reviewing their licenses.
The [ODC evaluation](ODC-EVALUATION.md) records product boundaries and the inspected driver packaging.
