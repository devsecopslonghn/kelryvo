# Kelryvo — checklist hiện hành

Nguồn trạng thái duy nhất cho app và Helm. README chỉ là cửa vào. Cập nhật 2026-11-01 (Asia/Saigon).
`[x]` nghĩa là hoàn thành đúng phạm vi ghi bên cạnh; không đồng nghĩa production-ready.
`[ ]` nghĩa là còn thiếu nghiệm thu hoặc điều kiện hoàn thành. Không suy diễn kết quả
offline thành kết quả Oracle, hoặc chuyển nghiệm thu giữa các source/image.

## Trạng thái tiếp quản

- App: `kelryvo`, base commit `66c4a313420322dc2c56594203a42d90f1267b75` (2026-10-29).
- Helm: `kelryvo-helm-chart`, base commit `bc29f7949e9637d6b1235d5b79273ac246ce6607` (2026-10-29).
- Image development được ghi nhận đã triển khai: `docker.io/longhn0710t/kelryvo-pilot@sha256:afe222f97fddcf69e91ce0f2127afb55eaadd6a09b85ac8f3098c285f57775ec`.
- Delivery này ghi nhận Helm revision 4, execution/discovery **off**, Argo reconciliation
  của riêng Kelryvo tạm dừng. Đây là trạng thái trong bằng chứng ngày 29/10, chưa kiểm tra
  lại cluster ngày 01/11. Source sau đợt cleanup chưa có image hoặc nghiệm thu triển khai mới.
- PostgreSQL metadata nằm ngoài app container. App và execution/discovery dùng cùng
  image, tách UID 10001/10002 và quyền truy cập secrets. Web dùng React, API dùng Fastify/TypeScript.
- Luồng chính: instance → discovery → gán schema cho project → SQL/Git release → validate
  → immutable plan → phê duyệt độc lập → execution request → history/audit.

## Đã triển khai và phạm vi đã kiểm chứng

- [x] **D01 — Access/identity:** local password, project grants, deploy grant riêng,
  session/CSRF/revocation; optional LDAP/OIDC với mapping vào actor có sẵn. Delivery
  2026-10-29 đã ghi nhận 20 kiểm tra browser cho developer/approver, gồm restart/logout,
  LDAP sai mật khẩu và từ chối approver cấu hình provider. Chỉ Keycloak/OpenLDAP đã thử.
- [x] **D02 — Instance/schema ownership:** một master credential reference cho PDB/non-CDB,
  discovery và gán nhiều schema cho project; một project active cho mỗi exact owner;
  revisions làm stale plan cũ. API/browser có kiểm thử offline và một số ca lab giới hạn.
- [x] **D03 — SQL/Git:** SQL Workspace nhiều file, immutable revisions, reconciliation
  sửa đồng thời, local Git import và authored releases; giữ bytes/digests/source provenance.
  Đã có kiểm thử PostgreSQL/API/Chromium; không cung cấp arbitrary query execution.
- [x] **D04 — Validate/plan/review:** pinned parser, scope/risk/dependency findings,
  source/schema context, immutable plans, comments, reject/withdraw và independent approval.
  Offline VALID không chứng minh Oracle compilation hay execution eligibility.
- [x] **D05 — Schema/history:** snapshots, baselines, structural comparison, filtering,
  pagination, target context, stale approvals, audit và checksummed downloads. Đã có
  API/browser acceptance; live coverage vẫn PARTIAL và comparison có thể UNVERIFIED.
- [x] **D06 — Execution/recovery implementation:** durable request/attempt/receipt,
  container mutex, target ledger, idempotency, HOLD, independent reconciliation và
  restore generation hold. Bounded Oracle cases ở bảng dưới; chưa nghiệm thu trọn ma trận.
- [x] **D07 — Packaging/identity delivery:** source bundle, unified image/entrypoint,
  Helm và secret isolation đã có kiểm thử. Delivery 2026-10-29 ghi nhận source CI/CodeQL,
  OCI amd64/arm64, local check 503 PASS/0 FAIL/151 optional SKIP, bảo toàn 68 bảng và
  58 jobs qua rollout. Delivery này không thực hiện Oracle SQL hay nghiệm thu Oracle mới.

### Căn cứ theo ngày/source

Các path dưới đây nằm trong Git history, không phải file còn trong working tree.
Khôi phục để đọc bằng `git show COMMIT:PATH` trong đúng repo. Chọn căn cứ theo năng lực
và exact source/image, không theo tên thư mục hoặc ngày mới nhất của một năng lực khác.
Mốc thời gian trong bảng dùng UTC.

| Ngày / năng lực | Source/image đã thử | Kết luận có giới hạn | Tra bằng chứng |
| --- | --- | --- | --- |
| 2026-10-29, delivery/identity | Source `66c4a31`, image `afe222f9…` | Helm revision 4; 20 browser checks; execution/discovery off; không có Oracle SQL | [Acceptance](https://github.com/devsecopslonghn/kelryvo-helm-chart/blob/bc29f7949e9637d6b1235d5b79273ac246ce6607/evidence/20261029-direct-helm-identity/acceptance.json), [publication](https://github.com/devsecopslonghn/kelryvo-helm-chart/blob/bc29f7949e9637d6b1235d5b79273ac246ce6607/evidence/20261029-direct-helm-identity/publication.json) |
| 2026-10-28, D6 V1/V2 + ADMITTED/NOOP | Worktree base `8796a57`, context `87cc3018…`, image `557c7d47…` | Hai table/migrations, 10 ledger events; bốn probes và zero-write NOOP. Seed operator FAIL giữ nguyên; actual effects được review riêng; native receipt preimages thiếu dispatch UUID | [Kết quả và remaining gaps](https://github.com/devsecopslonghn/kelryvo/blob/66c4a313420322dc2c56594203a42d90f1267b75/evidence/product/oracle-delivery6-currentness-20261026/continuation-20261027.json), [exact source/image](https://github.com/devsecopslonghn/kelryvo/blob/66c4a313420322dc2c56594203a42d90f1267b75/evidence/product/schema-route-delivery-20261025/acceptance.json) |
| 2026-10-24–25, concurrency/history | Worktree base `8796a57`, context `98357aac…`, image `d97136fe…` | Shared-installation writers không overlap; mismatch history HOLD trước SQL. Chưa đủ distinct-installation OA05/full OA09 | [Concurrency](https://github.com/devsecopslonghn/kelryvo/blob/66c4a313420322dc2c56594203a42d90f1267b75/evidence/product/oracle-ui-image-concurrency-20261025/acceptance.json), [history negative](https://github.com/devsecopslonghn/kelryvo/blob/66c4a313420322dc2c56594203a42d90f1267b75/evidence/product/oracle-incompatible-history-20261025/acceptance.json) |
| 2026-10-24, lost ACK/reconciliation | Source `8796a57`, image `cd46b7c5…` | Mất ACK, native rejection và retained HOLD không replay; chưa đủ full fault/recovery matrix | [Acceptance](https://github.com/devsecopslonghn/kelryvo/blob/66c4a313420322dc2c56594203a42d90f1267b75/evidence/product/oracle-continuation-8796a57-20261024/acceptance.json) |
| 2026-10-23, ba dạng DDL | Source `a4dbb8d`, image `01018b1d…` | CREATE TABLE/ALTER ADD/INDEX, hai schema V1/V2/NOOP trên Oracle Free TCP; không chuyển qualification sang image khác | [Exact source/image và kết quả](https://github.com/devsecopslonghn/kelryvo/blob/66c4a313420322dc2c56594203a42d90f1267b75/evidence/product/unified-oracle-20261023/governed-ddl.json) |

Source/image rút gọn trong bảng chỉ để đọc nhanh; các record được liên kết giữ đủ SHA,
digest, thời gian và phạm vi. Có thể đọc offline bằng `git show COMMIT:PATH` theo URL;
checkout shallow dùng link hoặc fetch commit cần tra. Không khôi phục reports vào source.

D6 cuối cùng ghi nhận 58 jobs: 23 CANCELLED, 12 HOLD, 6 NOOP, 17 VERIFIED_SUCCESS;
không WAITING/ADMITTED. Tất cả authority trong các ca lịch sử đã hết hạn. Không chạy lại
seed, tái sử dụng approval cũ hoặc xóa HOLD. Git history giữ nguyên cả kết quả thất bại.

## Còn phải nghiệm thu — theo thứ tự

- [ ] **R1 — Fresh target qualification:** chọn exact source/image cho pilot, lấy
  attestation mới có endpoint/version/topology, expiry, allowed reads và purpose grants;
  chứng minh create connection → discovery → exact-owner binding → plan/review/readiness
  qua API/browser. Wrong destination/container/version, missing privilege, root/SID,
  expired/changed configuration và timeout phải bị chặn; lịch sử giữ nguyên qua restart.
  Chưa có authority mới thì chỉ chuẩn bị offline, không kết nối Oracle.
- [ ] **R2 — Schema visibility/drift:** nghiệm thu exact quoted owners, empty/hidden
  objects, mất quyền, row/byte/time limits, default/CHECK/FK/index/view/sequence/dependency
  definitions, concurrent DDL và thay đổi identity/configuration. Browser phải giữ đúng
  snapshots/baselines qua reload/restart; incomplete/multi-query observations không được
  kết luận không drift. Qualify driver DNS connect-string path riêng với pinned-IP path.
- [ ] **OA01 — Identity:** full target tuple và exact owner khớp; mismatched route
  được cho phép trong lab phải bị từ chối trước mọi writer statement.
- [ ] **OA02 — Purpose isolation:** trên exact runtime, chứng minh API không đọc master
  secret, discovery chỉ fixed SELECT, cross-UID/proc denial và approved unsafe/foreign-owner
  SQL không dispatch; không có quyền ledger vượt manifest.
- [ ] **OA03 — Ordering/checksum/SQL:** chạy V1/V2/NOOP cho từng dạng SQL nằm trong
  manifest của image được chọn; STARTED bền vững trước DDL, bytes/order/objects/receipts
  khớp target và central journals; unsupported SQL bị chặn sau approval.
- [ ] **OA04 — Implicit commit:** fixture riêng cho successful và failing DDL cùng
  uncommitted marker; independent observer chứng minh commit semantics, không hứa rollback.
- [ ] **OA05 — Mutex:** thêm hai installations/worker IDs độc lập qua route aliases và
  assigned streams khác nhau; chỉ một writer vào container, lock liên tục qua DDL commit,
  lịch sử từng stream nguyên vẹn. Ca shared-installation trước đây chỉ là một phần.
- [ ] **OA06 — Interruption:** dừng đúng owned worker sau STARTED và sau ACK statement 1;
  chứng minh child/session kết thúc, không dispatch statement 2, expiry giữ HOLD và không replay.
- [ ] **OA07 — Network/lost ACK:** proxy/session fault có scope riêng; mất ACK của DDL
  hoặc receipt phải UNKNOWN/HOLD, giữ ledger/object witnesses; không reconnect-and-retry.
- [ ] **OA08 — Reconciliation:** independent target observations + ledger/central evidence
  được người khác review, self-review bị chặn, evidence bền qua restart; quyết định không
  tự mở mutex, xóa HOLD hoặc cấp quyền retry.
- [ ] **OA09 — Idempotency/history:** hoàn tất queued/admitted/held/current/stale-plan và
  incompatible-history matrix trên image được chọn; exact retry trả request gốc, payload/key
  conflict bị từ chối, HOLD không cho replacement/replay; giữ checksum/lineage từng stream.
- [ ] **OA10 — Recovery/audit:** restart app/worker, witnessed metadata backup/restore vào
  database disposable riêng; giữ plan/approval/events/receipts/history, restored generation
  ở RESTORE_HOLD và không dispatch writer. Có preimages đủ để kiểm tra receipt digests mới.
- [ ] **R4 — Pilot operations/release:** sau R1/R2/OA, nghiệm thu exact image cho secret
  isolation, orphan containment, restart/upgrade, backup/restore và disaster recovery;
  full API/browser/fresh-source/OCI/security/license gates PASS. Công bố support matrix
  theo version/topology/transport; chỉ publish/deploy khi có ủy quyền riêng.
- [ ] **DIST — Distribution/naming:** xác nhận public naming và source/notice/redistribution
  obligations cho đúng artifact được phát hành, kể cả external runtime nếu được đóng gói.
  Dependency closure hiện tại không thay thế nghiệm thu redistribution toàn sản phẩm.

Oracle Free 23.26.3 TCP là lab đã thử có giới hạn. Oracle 19c/21c, TCPS, non-CDB và các
version/topology khác không được suy diễn là đã hỗ trợ. Source hiện tại chỉ cho phép scalar
CREATE TABLE, scalar ALTER TABLE ADD và simple local CREATE INDEX; dynamic/procedural SQL,
CTAS, DML, database links, foreign owners và administrative SQL vẫn bị chặn.

## Chủ động hoãn — không phải lỗi cần đóng pilot hiện tại

- Remote Git authentication/webhooks/push, public automation API và machine identities.
- Multi-tenancy, public signup/invitations/JIT provisioning, SAML và groups-to-role mapping.
- Multi-stage approval/promotion policy, general signed exports/retention và project purge.
- Arbitrary query/data browsing/masking, semantic SQL compilation và editor autocomplete.
- Non-Oracle engines; RAC, Data Guard, clone/refresh và PDB relocation execution.

## Quy tắc tiếp quản và lệnh local

Workspace sở hữu infrastructure; project sở hữu release/plan/review và schema assignments.
Giữ immutable source, revisions, decisions, history/audit và compatibility formats; đổi
configuration rồi đổi lại không hồi sinh authority cũ. Approval phải độc lập, execution
cần deploy grant và trusted installation hiện hành. Secrets chỉ là references ở API/web;
writer secrets chỉ được resolve trong purpose-restricted runtime. Ambiguous DDL luôn HOLD,
không replay tự động. Restore giữ RESTORE_HOLD; recovery cần target witness và hai actor độc lập.

Không kết nối Oracle, live migration, fault injection hoặc đổi lab/cluster nếu chưa có
ủy quyền tác vụ và secret-free disposable-lab attestation hiện hành. Không deploy, publish,
push, merge, thay infrastructure hoặc viết lại Git history từ một checklist. Giữ CI gates.
Không log secrets hoặc đưa secrets vào Git, image layers, browser storage hay command args.

Node 22.23.3, npm 10.9.9, Python 3.11+, Git. Parser cần pinned JDK; dùng
`SCHEMAFORGE_JAVA_HOME` trỏ tới JDK đã chuẩn bị. PostgreSQL test phải là fixture disposable
riêng qua `SCHEMAFORGE_TEST_DATABASE_URL`; không dùng metadata sản phẩm. Native backup fixtures dùng chung Docker daemon chạy tuần tự; các API files còn lại
chạy tối đa hai subprocesses. Product runner
nếu thiếu URL sẽ khởi tạo Docker local; chỉ chạy khi đã xác nhận fixture/environment.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
npm run parser:antlr:prepare
npm run parser:antlr:build
npm run test:product
npm run test:browser
npm run test:release
```

Development: `npm run local:prepare` rồi `npm run dev`, mở `http://127.0.0.1:4317`.
Hai lệnh này cần Docker, tạo metadata/demo local và không cấp quyền Oracle. HTTPS cần
trusted loopback cert/key: `npm run dev -- --tls-cert /private/server-chain.pem --tls-key /private/server-key.pem`.
Operator phải activate membership và grant actors riêng; không có password mặc định/public signup.
Các operator commands nằm trong `package.json` và `scripts/`, không tự chạy từ handoff.

Source bundle chỉ đóng gói committed source:
`npm run release:local -- --output /absolute/existing-parent/new-directory`.
Sau extract: `npm ci --ignore-scripts --no-audit --no-fund`, `npm run dependencies:product`,
`npm run parser:antlr:prepare`, `npm run parser:antlr:build`, `npm run build`,
`npm run release:verify`; `npm run release:acceptance` cần PostgreSQL disposable/JDK/Chromium.
Checksum/manifest verification không chứng nhận Oracle; không sửa bundle sau khi verify.

Trong repo Helm: `helm lint --strict .`, `helm lint --strict . -f values.development.yaml`,
`helm template kelryvo . --namespace kelryvo -f values.development.yaml`,
`python3 scripts/check-chart.py`,
`python3 lab/check-manifest.py`, `python3 lab/check-fault-proxy.py`. Đây là local checks,
không áp dụng manifests. `scripts/check-direct-helm-adoption.py` cần explicit context và
ủy quyền đọc cluster riêng; không thuộc local checks. Không xóa PostgreSQL/PVC/PV,
namespace, shared providers hay HOLD.

## Kỷ luật source và bằng chứng

- Cập nhật checklist tại chỗ, giữ ID và tiêu chí hoàn thành; không tạo checkpoint,
  tracker hoặc handoff song song. README giữ dưới 30 dòng và chỉ dẫn về checklist.
- Commit code kiểm thử, fixtures cần tái hiện hành vi và dependency/license metadata.
  Log, screenshot, coverage, build output và report của từng lần chạy vào ignored
  `.cache/` hoặc output directories. `npm run hygiene:check` và Helm chart checks từ chối
  chúng ngay cả khi bị `git add --force`; không ignore toàn bộ PNG/JSON vì còn assets/fixtures.
- Diagnostic browser artifacts chỉ upload khi test lỗi, giữ 7 ngày. Log CI theo retention
  đang cấu hình của repository; artifacts trao đổi giữa jobs/OCI vẫn giữ lifecycle hiện có.
  Không xem cache hoặc artifact sắp hết hạn là nơi lưu chứng cứ nghiệm thu lâu dài.
- Với mỗi pilot/release được ủy quyền, giữ một bộ bằng chứng chọn lọc, đã loại secrets,
  tại release assets hoặc kho lưu bền vững được owner chỉ định. Bộ đó phải có source SHA,
  image digest, test scope/topology/tool versions, timestamp, kết quả và limitations,
  checksums cùng cách tái hiện. Checklist giữ link và SHA-256 của bộ đó; không commit raw logs.
  Chỉ ghi nghiệm thu hoàn thành khi chứng cứ tương ứng còn truy cập và kiểm tra được.
- Plan/approval/execution history/audit của người dùng là dữ liệu sản phẩm, giữ trong
  metadata/backup theo quy tắc an toàn; chúng không phải report tạm để xóa.
- Bằng chứng lịch sử hiện có đọc từ các link Git ở trên, giữ nguyên cả thất bại.
  PR [app #130](https://github.com/devsecopslonghn/kelryvo/pull/130) và
  [Helm #8](https://github.com/devsecopslonghn/kelryvo-helm-chart/pull/8) dẫn tới checks
  của đợt cleanup; CI workflow links không thay thế bằng chứng Oracle/pilot.

Giữ nguyên LICENSE/NOTICE, dependency manifests, attribution và parser provenance trong
`docs/dependencies/` cùng vendored notices. Independently authored code dùng PolyForm Shield
1.0.0; không phải OSI open source. Không sao chép restricted external code/assets.

## Kiểm tra đợt cleanup

- [x] **CLEAN — Local verification:** `npm run check` PASS: 486 pass, 0 fail,
  152 optional skip (638 tests); build/typecheck/format, dependency smoke và 94-package
  license closure PASS. Status/next, source-bundle reproducibility/extraction/checksums,
  corruption/symlink rejection và report isolation PASS; `dependencies:offline` và
  artifact manifest write/verify trong `.cache/` PASS. Helm lint (default/development),
  template, chart safety, lab manifest và loopback-only fault-proxy tests PASS.
  Local full PostgreSQL/API, Chromium và extracted-install E2E **NOT_RUN**: không có
  `SCHEMAFORGE_TEST_DATABASE_URL`, PostgreSQL local hoặc Docker daemon. Không chạy OCI,
  remote CI, cluster inspection, Oracle hay deployment trong các kiểm tra local này.
  Giữ nguyên publication/security gates; hosted CI được đánh giá riêng trên PR.
  Logs local nằm trong ignored `.cache/reports/`. Cleanup không thay code runtime,
  database hay infrastructure; lịch sử Git và private lab/cache/data được giữ nguyên.
