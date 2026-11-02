# Kelryvo — checklist hiện hành

Nguồn trạng thái duy nhất cho app và Helm. README chỉ là cửa vào. Cập nhật 2026-11-02 (Asia/Saigon).
`[x]` nghĩa là hoàn thành đúng phạm vi ghi bên cạnh; không đồng nghĩa production-ready.
`[ ]` nghĩa là còn thiếu nghiệm thu hoặc điều kiện hoàn thành. Không suy diễn kết quả
offline thành kết quả Oracle, hoặc chuyển nghiệm thu giữa các source/image.

## Trạng thái tiếp quản

PR [#132](https://github.com/devsecopslonghn/kelryvo/pull/132) đã merge vào master tại
`ff23918975ba017d523b7a443e4965d5f935dbbf`, chữ ký GitHub verified. Check, focused,
OCI amd64/arm64, CodeQL và full regression trên đúng master đều PASS. Image CI hiện
nghiệm thu có local descriptor `sha256:916ac5cb5ce4d5e1d84e9a45820c404483a46b8e8888f89837c4b589e5b8c653`;
OCI config/layer payload đã được đối chiếu; wrapper Docker khác OCI index gốc.
Đợt R3/R4/R5 trên đúng artifact CI đã đạt R1/R2, OA01–OA10 và phần kỹ thuật R4.
Hai installations mới chạy A/B V1/V2/NOOP, tính lại đủ sáu receipt digests; identity,
purpose/isolation, unsupported SQL và history/idempotency negatives PASS. Fixture
`QC3_MUTEX2` có actual native acquire A=0/B=1, physical UL giữ qua DDL commit,
A VERIFIED_SUCCESS và B HOLD không SQL; verifier độc lập 13 checks PASS.

OA04 có fixture marker riêng trên image CI: marker chưa commit không thấy từ observer;
sau CREATE thành công hoặc duplicate DDL ORA-00955, marker đã commit và rollback không
đảo ngược. Fixture native riêng không đi qua dispatcher và không cho phép DML trong sản phẩm.

Schema quoted/empty/hidden, row/byte limits, deadline thực 1.006 ms, interquery DDL
và mất/khôi phục READ grant PASS; comparison giữ UNVERIFIED. API/browser giữ bốn
snapshot cũ và snapshot thứ năm; digest được tính lại từ PostgreSQL. Restart cùng
container giữ nguyên 68 bảng, prior approval và zero execution jobs.

Fault matrix mới đạt dừng owned child qua PIDfd trước SQL và sau ACK đầu tiên,
mất SQL reply, và mất native receipt COMMIT reply. Ca cuối dùng owner chưa dùng
`QC_FAULT_B`: forward một COMMIT, giữ rồi bỏ reply thật 19 bytes, native ACK 4 events
nhưng central receipt 0, job/attempt HOLD. Bốn stream trước không đổi. Fixture lỗi
`QC_FAULT_A` và mọi lỗi harness/HOLD được giữ nguyên, không replay. Verifier đọc cuối
khớp 24 events trên 5 streams, sáu jobs terminal và tính lại hai receipts của fault B.

Upgrade T32, backup/restore và DR API/browser/restart PASS trong lab cách ly: giữ
68 bảng, 4 jobs/3 attempts/3 receipts, tính lại ba receipts; 30 credentials cũ revoked,
generation mới RESTORE_HOLD chặn bốn mutations hợp lệ. Reconciliation qua hai actor
độc lập giữ HOLD qua restart; backup/restore riêng của native HOLD này giữ cả submission,
decision và toàn bộ 68 bảng, revokes 41 credentials cũ, không sửa source database.
Docker PID 1 chết không để fixed execution child tồn tại trong phép thử network=none.
Worker UID 10002 là trusted component và sở hữu staged modules; đây không phải sandbox
cho code đã chiếm được chính UID đó. API/worker/proc/secrets và readonly source mount
đã được kiểm chứng. Năm writer runtimes và năm fault transports đã dừng sau khi jobs
terminal; không xóa container, database, HOLD hoặc lịch sử.

**Còn mở: DIST — public naming/redistribution sign-off.** Inventory đúng OCI kiểm tra
211 runtime files, 115 Debian notices, 38 Temurin legal files, Node license và hai source
archives; `public_distribution_clearance` vẫn false. Nghiệm thu này không cấp quyền
public release, production deployment hay managed production DR. Kết quả `bb5c98c`
bên dưới giữ đúng phạm vi lịch sử. Commit tài liệu không đổi artifact `ff239189` đã thử.

Bằng chứng bền vững [bundle R12](/home/longhn0710/workspace/kelryvo/acceptance-artifacts/acceptance-ff239189-20261102T003404Z-technical-r12.tar.gz)
có 1.824 files, SHA-256 `aa4bd0340b05dd488e00313b6c07de8550867e827d0da20b2a8b48b498496436`.
Đã mở lại và đối chiếu từng member; kiểm tra 216 giá trị bí mật đã biết, zero matches.
URL có credential trong operator return được giữ riêng dưới private storage và redacted
trước khi tạo archive. Original CI OCI được giữ riêng ngoài cache, SHA-256
`e4f35ebf4e4f8602b181ec26a2b10f3a24bc03a7f5e94ed84904af670f1882f0`.
Bundle ghi rõ technical PASS, DIST còn mở; không chứng nhận production/public release.

| Phạm vi hiện hành | Đã kiểm chứng | Giới hạn |
| --- | --- | --- |
| Oracle native | Oracle Free 23.26.3, PDB, TCP loopback, Linux amd64, Thin driver 7.0.1 | Chưa nghiệm thu 19c/21c, non-CDB, TCPS, RAC hoặc Data Guard |
| Metadata | PostgreSQL 17.10; upgrade T32, backup/restore và restart trong lab owned | Chưa nghiệm thu managed production DR hoặc HA |
| OCI | Artifact CI của `ff239189`, kiểm tra amd64/arm64; native acceptance dùng amd64 | Không chuyển kết quả native sang arm64 hoặc image cluster đang triển khai |
| Bàn giao | Pilot nội bộ và bằng chứng local có checksum | Public naming/redistribution và deploy/publish vẫn là gate riêng |

- App: `kelryvo`, source runtime được nghiệm thu `ff23918975ba017d523b7a443e4965d5f935dbbf`; mốc native local trước đó `bb5c98c10eaaf779959008aeaeebbc32f1b8bba0` (2026-11-01).
- Helm: `kelryvo-helm-chart`, source hiện hành `9fe32cb` (2026-11-01).
- Image development được ghi nhận đã triển khai: `docker.io/longhn0710t/kelryvo-pilot@sha256:afe222f97fddcf69e91ce0f2127afb55eaadd6a09b85ac8f3098c285f57775ec`.
- Delivery này ghi nhận Helm revision 4, execution/discovery **off**, Argo reconciliation
  của riêng Kelryvo tạm dừng. Image cluster này khác image local bên dưới; không chuyển
  kết quả nghiệm thu local thành kết quả rollout. Đợt QC này đã push/merge PR #132 theo ủy quyền riêng; chưa deploy/publish.
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

Tiến độ local 01/11, source `bb5c98c`, image
`sha256:e13837c6b7ded2b1336141e05c249d438256ee3afffbf91551b05f890418a857`:
offline 486 PASS/0 FAIL/152 optional SKIP, API 219 PASS, browser suite 58 PASS;
source-bundle suite và direct exact-head source bundle đều có 25 workflows PASS,
không FAIL/SKIP. Direct archive SHA-256
`2e27b77323707a3d9b9b8672e2da78b9556e3b7ca989745aa35bd3439be09988`.
Browser thực tế trên
pilot Oracle có thêm 13 checks PASS. Hosted checks được lưu riêng theo đúng commit.

Lab Oracle Free 23.26.3 TCP loopback có scope/grants mới, bốn purpose accounts, cùng
full identity được pin; API đã discover/verify/bind/validate/approve và chạy A/B V1/V2
VERIFIED_SUCCESS. B NOOP dùng plan/phê duyệt mới và không chạy SQL. Observer độc lập
khớp native tables/columns/indexes, ledger và central journals. Ba receipts B có preimages
và digest được tính lại; ba receipts A thiếu dispatch UUID nên chỉ xác minh được chain.
HOLD A được giữ nguyên, không replay. Reconciliation qua hai actors và restart PASS;
backup/restore 68 bảng qua clone metadata cách ly PASS, generation mới RESTORE_HOLD,
credentials cũ revoked, không dispatch. Đây chưa phải managed production backup.
Isolation trên đúng pilot PASS cho API/worker/secret/proc boundaries; worker vẫn có quyền
ghi module staged do chính UID 10002 sở hữu, trong khi installation source bind read-only.

Ca fault riêng `QC_INT_AFTER`: giữ nguyên một TNS request tạo index sau ACK của ALTER;
request không được gửi tới Oracle. Runtime tự dừng exit 1; sau restart, expiry recovery
giữ job/attempt HOLD với `LEASE_EXPIRED_UNKNOWN`, ledger vẫn 11 events, không index,
writer session hay mutex lock. Hai acknowledged receipt digests được tính lại đầy đủ;
statement 2 có STARTED/preimage nhưng không ACK/receipt. Đây là request-loss case,
chưa thay thế lost server ACK hoặc manual worker interruption. Trong ca cũ này không có
SIGKILL từ QC.
Ca `QC_INT_BEFORE` hết hạn observation 7.096 ms trước CLAIMED, rồi HOLD trước STARTED;
không Oracle object/ledger event. Giữ nguyên ca này, không replay; không suy diễn là
đã chạy thành công ca interruption dự định. Chưa có reason code riêng cho gate bị chặn.

Lab retry riêng có hai PDB GUID mới, cùng source/image ở trên. `QC_BEFORE2` đã dừng
đúng UID 10002 execution child bằng PIDfd sau native STARTED và trước khi SQL được gửi;
child được reap, không object/receipt, session writer và mutex đều đóng. Sau một restart
đúng container và lease expiry, job/attempt giữ HOLD với 3 ledger events nguyên vẹn;
exact retry trả cùng job, không attempt/SQL mới. Lần guard đầu từ chối vì helper kiểm tra
thiếu prefix `migrations/`; giữ bằng chứng lỗi, sửa đúng literal, làm mới native/MVCC
witnesses rồi mới gửi tín hiệu cho chính job đang giữ, không tạo request khác.

`QC_ACK_SQL` đã forward CREATE đúng một lần; observer thấy bảng/cột ID đã tồn tại,
transport giữ rồi bỏ server reply 67 bytes. Native ledger chỉ có 3 events đến STARTED,
không ACK/central receipt; job/attempt chuyển HOLD, object/ledger không đổi, không writer
session/mutex và exact retry trả cùng job. Production ledger reader xác minh cả hai
IN_FLIGHT chains. Đây là lost SQL-server-reply case thật; chưa phải receipt COMMIT ACK.
`QC_AFTER_ACK` đã có thêm V1 prefix VERIFIED_SUCCESS, rồi SIGKILL đúng execution child
qua PIDfd sau ACK của ALTER và STARTED của INDEX. INDEX request được giữ trước Oracle;
job/attempt chuyển HOLD sau lease expiry, native ledger giữ 11 events, không INDEX,
writer session hay UL lock. V1 receipt và V2 statement-1 receipt được tính lại từ đủ
preimages và native checkpoints; statement 2 không ACK/receipt. Ca manual này đạt OA06
cùng với `QC_BEFORE2`; các HOLD/lịch sử cũ vẫn được giữ nguyên.

Hai metadata installations `QC_MUTEX_A/B` có worker IDs, generations và streams riêng,
đi qua aliases `127.0.0.1`/`localhost` tới cùng PDB GUID. A giữ physical UL lock sau CREATE
commit, rồi VERIFIED_SUCCESS với một receipt tính lại khớp; B HOLD, không attempt/receipt/
preimage hay ledger row riêng. Reason code của B là `TARGET_HISTORY_UNTRUSTED`; bằng chứng
chưa xác định trực tiếp B đã gọi và bị mutex từ chối. Ca này chỉ là kết quả an toàn có
giới hạn. Driver DNS path qua `localhost` đã được qualify riêng bằng kết nối native.

Ca mới `QC_MUTEX3_A/B` dùng hai metadata installations, worker IDs, generations và streams
riêng trên cùng PDB GUID mới. Native witness fsync ghi A acquire=0, B acquire=1 trong lúc
A giữ physical UL qua CREATE implicit commit; SID/AUDSID của A khớp session giữ khóa.
B gọi sau khi server reply bị giữ và trước khi reply gốc được thả. Bảy witnesses có hash
được kiểm tra trước khi thả đúng một reply 68 bytes; không gửi lại SQL. A VERIFIED_SUCCESS
với một receipt tính lại khớp từ dispatch preimage và production ledger reader COMPLETE
sequence 5; B HOLD `TARGET_HISTORY_UNTRUSTED`, không attempt/receipt/preimage hay object
riêng. Verifier độc lập truy vấn lại PostgreSQL và Oracle chỉ đọc, xác nhận ledger và
cleanup không đổi. Exact retry trả các jobs gốc, không replay. OA05 đạt trong phạm vi này.
Witness giữ nguyên dedicated writer object để bảo toàn provider identity guard; ca
`QC_MUTEX2_A` trước đó bị guard từ chối khi dùng Proxy vẫn giữ HOLD và không SQL, B chưa
được request. Raw TNS reply bytes không được lưu để replay độc lập; tính liên tục của
reply được chứng minh bằng hash/length và record `identical=true` của transport đã pin.

`QC_RECEIPT2` trên PDB GUID mới đã forward native receipt ACK và COMMIT đúng một lần;
Oracle observer thấy 4 ledger events đến ACK đã bền vững. Proxy giữ rồi bỏ server reply
19 bytes, không forward reply; central không có receipt, cùng job/attempt giữ HOLD,
objects/ledger không đổi, không writer session/UL lock; exact retry trả cùng HOLD.
Controller đầu timeout vì nhánh giữ reply chưa publish status; lưu lỗi và hoàn tất trên
chính job đó bằng fresh native/MVCC witnesses và scoped CUT, không tạo request khác.
Ca `QC_ACK_RECEIPT` trước đó bị chặn tại cached RPC cũng giữ nguyên HOLD, không được tính
là receipt COMMIT ACK-loss PASS. Các ca mới không thay thế hoặc xóa lịch sử cũ.

Backup/restore mới của `kelryvo_after_ack` đã giữ đủ 68 bảng, hai jobs và hai receipts
có đủ preimages; verifier riêng tính lại cả hai receipt digests. Sáu job events và mười
attempt events được giữ đúng, không thêm event ngoài dự kiến. Restore vào database
cách ly có generation mới `8b16d623-5649-4924-8bed-8c7bef882164` ở RESTORE_HOLD,
12/12 credentials revoked, không dispatchable/CLAIMED job; app role và PUBLIC không có
CONNECT/TEMP trên clone/restore. Source không đổi trong backup; cùng container nguồn
đã restart, hai jobs/receipts và native 11-event chain giữ nguyên, không request/SQL mới.
Đây là quarantined local-clone proof, chưa phải managed production backup/DR.

Một diagnostic đã in nhầm metadata credential của riêng installation lab này; đã dừng
installation, đổi mật khẩu và cập nhật private inputs. Mật khẩu cũ bị từ chối, mật khẩu
mới được xác minh chỉ đọc; không thay dữ liệu nguồn. Installation đã hoạt động lại.

PDB `QC_QUALIFY` có GUID mới, cùng source/image local bên trên. Tám kết nối native
bốn purpose accounts qua pinned IP và driver DNS `localhost` khớp full identity và chỉ
đọc. Ma trận production discovery 19 ca có positive control và từ chối sai từng thành
phần identity, route/destination/SID, hết hạn, sai credentials, thiếu quyền, root container
và handshake timeout; không writer dispatch. Verifier riêng xác nhận ledger còn rỗng,
QC_A/QC_B chưa có objects và account thiếu quyền chỉ có CREATE SESSION. Lỗi entrypoint
permission và guard nhầm độ dài source SHA được giữ riêng; đều dừng trước khi chạy SQL
fixture. Các ca native này được bổ sung bằng API/browser và persistence proof bên dưới;
không dùng kết quả native riêng lẻ để đóng R1/R2.

Fixture cấu trúc `QC_QUALIFY` đã tạo đúng 14 câu setup được review, gồm normal/quoted
owners, default/CHECK/FK, descending index, view/dependency và sequence. Verifier catalog
riêng xác nhận 11 objects dự kiến, đúng hai sequence SELECT grants, zero data rows;
QC_EMPTY có grant nhưng rỗng, QC_HIDDEN có bảng nhưng discovery không có quyền. Cả bốn
production schema observations giữ comparison UNVERIFIED. Sáu bảng bổ sung, mỗi bảng
700 cột, kích hoạt TABLE_ROW_LIMIT_EXCEEDED và BYTE_LIMIT_EXCEEDED trên cả hai owners;
so sánh khi thiếu object cũng UNVERIFIED. Ledger và QC_A/QC_B vẫn rỗng. Đây là native
fixture setup, không phải governed product execution cho OA03.

Pilot `kelryvo_qualify` discovery-only đã tạo instance, discover, gán và verify bốn exact
owners qua API, tạo validation/immutable plan và independent approval. Bốn snapshots /
baselines ban đầu giữ nguyên qua browser reload và same-container restart. Native fixture
DDL commit giữa query tables và columns được witness trực tiếp; quan sát trộn vẫn
UNVERIFIED. Thu hồi đúng schema READ grant làm các bảng biến mất khỏi quan sát nhưng
không kết luận REMOVED; grant được khôi phục và kiểm tra lại. Ca production SCHEMA deadline
trả TIMEOUT sau 1.008 ms khi owned Oracle tạm pause; container được unpause, native state
không đổi. Đây là handshake deadline, chưa phải đo một catalog SELECT chậm.

Đổi service qua API làm discovery UNAUTHORIZED; khôi phục route ở revision mới không làm
plan cũ current trở lại. API từ chối hidden owner, quoted owner sai hoa/thường và asserted
identity digest sai. Observation dùng binding cấu hình cũ bị HTTP 409, không tạo snapshot;
chỉ sau explicit fresh binding revisions mới collect tiếp. Browser sau đó thấy native
bảng mới, giữ drift UNVERIFIED và snapshot thứ năm qua reload/restart. Verifier riêng đọc
PostgreSQL, tính lại cả năm content digests, đối chiếu bốn baselines, hai actors phê duyệt,
29 critical table fingerprints và native catalog; zero execution jobs/attempts/receipts,
QC_A/QC_B và protected ledger vẫn rỗng. R1/R2 đạt trong phạm vi source/image local và
Oracle Free TCP này; concurrent native witness dùng execute instrumentation tại chỗ trong
runtime sandbox, không thay production source. Pilot execution vẫn off.

PDB mới `QC_EXECUTION` có GUID `5F371E2DF1410EFCE063040011AC4892`, hai installations
`QC_EXEC_A/B` với metadata generations, workers và streams riêng. Mỗi installation đã
chạy V1 CREATE TABLE, V2 ALTER ADD/CREATE INDEX và NOOP bằng plan/phê duyệt mới. Verifier
chỉ đọc tính lại đủ sáu receipt digests từ fsynced dispatch UUIDs và production ledger
reader tại sequences 5/10/13; bytes/order, native objects và central journals khớp.
NOOP không thêm native event, dispatch hay receipt. Retry lúc WAITING_VALIDATION,
ADMITTED, VERIFIED_SUCCESS và NOOP trả jobs gốc; đổi payload cùng key bị 409.

Trên chính hai runtimes này, API không đọc được bốn Oracle secrets; cross-UID/proc/spawn
bị từ chối. QC_DISCOVERY chạy TEST/DISCOVER/SCHEMA bằng 22 fixed SELECTs mỗi installation.
Route alias, alternate owned PDB service, owner và physical identity mismatch bị chặn
trước private options. Các expected full-tuple variants được review riêng trong bộ nhớ
chỉ phát native identity SELECTs rồi từ chối, hoặc bị config guard chặn trước connection;
không thay installed files/source. Catalog cuối vẫn đúng 56 application + 11 discovery
grants, không role/public DBMS_LOCK grant ngoài manifest.

Validation hiện hành chặn CTAS trước tạo plan. API tương thích `intentVersion:2` vẫn cho
independent approval của CTAS/foreign-owner/DML; production materializer đọc đúng retained
approved bytes và từ chối cả ba trước Oracle. Ba jobs giữ WAITING_VALIDATION, zero
attempt/proof/receipt, rồi được hủy qua API; exact retry trả CANCELLED originals. Đây là
kiểm thử đường compatibility, không bỏ hoặc override validation policy của luồng hiện hành.
Plan V1 mới/current gặp applied V2 chuyển HOLD `TARGET_HISTORY_UNTRUSTED` trước attempt;
exact retry giữ HOLD, cancel bị chặn và replacement plan mới/current/approved bị 409
`EXECUTION_ALREADY_PENDING`. Stale new request và cross-plan key conflict cũng bị từ chối.
Verifier cuối xác nhận sáu positive jobs/receipts, sáu dispatch preimages và 26 native
events không đổi qua negatives, không writer session hay UL lock còn sót.

Đợt này Docker daemon bị dừng khi công việc gián đoạn; khởi động lại đúng persistent
databases và discovery containers. B onboarding chỉ tiếp tục phần V2 plan còn thiếu sau
đối chiếu API/metadata, không replay POST/SQL không rõ kết quả. Mutex instrumentation
ở fixture execution không chạy do prefix guard không khớp case names; không dùng log
rỗng này làm acquire-call proof. OA05 vẫn dựa trên fixture `QC_MUTEX3` riêng đã giữ.

Bộ chứng cứ chọn lọc local ngoài cache (833 files, đã đối chiếu 150 secret values):
[acceptance-bb5c98c-20261101T153652Z-partial-r10.tar.gz](/home/longhn0710/workspace/kelryvo/acceptance-artifacts/acceptance-bb5c98c-20261101T153652Z-partial-r10.tar.gz),
SHA-256 `2c007d192e87eaeb318937ea23a07bc97c52794c64880bd98eca4404f548b53b`.
Audit riêng kiểm tra 4.373 main/historical file hashes, zero secret matches và toàn bộ
saved OCI graph của candidate local. R10 giữ các manifests/bằng chứng R8/R9 và tách
frozen image đã nghiệm thu Oracle khỏi candidate sửa RESTORE_HOLD chưa có qualification mới.
Snapshot này giữ cả manifest lịch sử và các ca HOLD/thử nghiệm chưa đạt; không gộp các
kết quả có giới hạn thành nghiệm thu hoàn chỉnh.
Manifest chứa checksums từng file, source/image, scope, cách tái hiện và limitations.
Đây là snapshot nghiệm thu PARTIAL, chưa phải release sign-off; các tiêu chí còn thiếu
bên dưới giữ nguyên. Lab/runtime và backup chứa dữ liệu được giữ riêng, không nằm trong bundle.

- [x] **R1 — Fresh target qualification:** chọn exact source/image cho pilot, lấy
  attestation mới có endpoint/version/topology, expiry, allowed reads và purpose grants;
  chứng minh create connection → discovery → exact-owner binding → plan/review/readiness
  qua API/browser. Wrong destination/container/version, missing privilege, root/SID,
  expired/changed configuration và timeout phải bị chặn; lịch sử giữ nguyên qua restart.
  Đạt qua fresh QC_QUALIFY scope, native purpose/negative probes, API onboarding,
  independent approval/readiness và browser/restart proof trong bundle R7.
- [x] **R2 — Schema visibility/drift:** nghiệm thu exact quoted owners, empty/hidden
  objects, mất quyền, row/byte/time limits, default/CHECK/FK/index/view/sequence/dependency
  definitions, concurrent DDL và thay đổi identity/configuration. Browser phải giữ đúng
  snapshots/baselines qua reload/restart; incomplete/multi-query observations không được
  kết luận không drift. Qualify driver DNS connect-string path riêng với pinned-IP path.
  Đạt trong phạm vi Oracle Free TCP đã ghi bên trên: 5 retained snapshots, 4 baselines,
  row/byte limits, inter-query DDL, privilege loss/restore, configuration invalidation,
  1-second SCHEMA handshake deadline và browser reload/same-container restarts.
  Định nghĩa không đầy đủ tiếp tục PARTIAL/UNVERIFIED; không mở rộng support matrix.
- [x] **OA01 — Identity:** full target tuple và exact owner khớp; mismatched route
  được cho phép trong lab phải bị từ chối trước mọi writer statement.
  Đạt qua native execution/observer và installed authority/provider negatives trong R8;
  expected tuple variants chỉ chạy SELECT nhận diện, không callback ghi dữ liệu.
- [x] **OA02 — Purpose isolation:** trên exact runtime, chứng minh API không đọc master
  secret, discovery chỉ fixed SELECT, cross-UID/proc denial và approved unsafe/foreign-owner
  SQL không dispatch; không có quyền ledger vượt manifest.
  Đạt trên `QC_EXEC_A/B`, gồm ba independently approved compatibility plans và exact
  final grant catalog. R4 đã review boundary: UID 10002 là trusted worker, không phải sandbox chống chính UID đó;
  source installation/image readonly và cross-UID isolation đã được kiểm chứng.
- [x] **OA03 — Ordering/checksum/SQL:** chạy V1/V2/NOOP cho từng dạng SQL nằm trong
  manifest của image được chọn; STARTED bền vững trước DDL, bytes/order/objects/receipts
  khớp target và central journals; unsupported SQL bị chặn sau approval.
  Hai installations đạt đủ ba SQL forms và NOOP; đủ sáu receipt digests được tính lại.
  Current validation và compatibility execution rejection được ghi riêng trong R8.
- [x] **OA04 — Implicit commit:** trên đúng image local bên trên, fixture riêng cho
  successful CREATE và failing duplicate DDL cùng uncommitted marker; observer riêng thấy
  marker commit trong cả hai trường hợp và rollback sau đó không đảo ngược. Bằng chứng
  `implicit-commit.json` trong bundle; phạm vi native Oracle, không suy diễn dispatcher rollback.
- [x] **OA05 — Mutex:** thêm hai installations/worker IDs độc lập qua route aliases và
  assigned streams khác nhau; chỉ một writer vào container, lock liên tục qua DDL commit,
  lịch sử từng stream nguyên vẹn. `QC_MUTEX3_A/B` có native acquire witnesses A=0/B=1,
  physical UL/SID/AUDSID khớp sau DDL commit; A thành công và B HOLD không SQL/receipt.
  Verifier độc lập kiểm tra actual PostgreSQL, production ledger reader, receipt digest
  từ dispatch preimage và fresh native cleanup; reason code chung vẫn được giữ nguyên.
- [x] **OA06 — Interruption:** dừng đúng owned worker sau STARTED và sau ACK statement 1;
  chứng minh child/session kết thúc, không dispatch statement 2, expiry giữ HOLD và không replay.
- [x] **OA07 — Network/lost ACK:** proxy/session fault có scope riêng; mất ACK của DDL
  hoặc receipt phải UNKNOWN/HOLD, giữ ledger/object witnesses; không reconnect-and-retry.
  Đã chứng minh bằng `QC_ACK_SQL` và `QC_RECEIPT2` trên source/image local bên trên;
  receipt reply S2C được đối chiếu qua nhánh server parser đã pin và hash frame bị giữ.
- [x] **OA08 — Reconciliation:** trên đúng pilot local bên trên, developer gửi independent
  target observations + ledger/central evidence, self-review bị chặn, approver riêng chọn
  RETAIN_HOLD; retry decision trả record cũ. Job HOLD/revision/events và quyết định giữ nguyên
  qua app restart, response không cấp retry/execution authority. Bằng chứng `reconciliation.json`
  và `pilot-restart.json` trong bundle. Ca mất ACK riêng vẫn thuộc OA07, chưa được suy diễn PASS.
- [x] **OA09 — Idempotency/history:** hoàn tất queued/admitted/held/current/stale-plan và
  incompatible-history matrix trên image được chọn; exact retry trả request gốc, payload/key
  conflict bị từ chối, HOLD không cho replacement/replay; giữ checksum/lineage từng stream.
  R8 bổ sung exact queued/admitted/completed/NOOP/CANCELLED/HOLD retries, stale new request,
  cross-plan key conflict và backward applied-history HOLD với current approved replacement
  bị chặn. Cả hai native streams và các positive receipts giữ nguyên qua toàn bộ negatives.
- [x] **OA10 — Recovery/audit:** restart app/worker, witnessed metadata backup/restore vào
  database disposable riêng; giữ plan/approval/events/receipts/history, restored generation
  ở RESTORE_HOLD và không dispatch writer. Có preimages đủ để kiểm tra receipt digests mới.
  Đạt trong phạm vi source/image local bên trên qua backup 68 bảng của `QC_AFTER_ACK`,
  kiểm tra độc lập hai receipt digests, zero event delta và same-container restart;
  không suy diễn thành managed production backup hay disaster recovery.
- [x] **R4 — Pilot operations kỹ thuật (bounded internal pilot):** sau R1/R2/OA, nghiệm thu exact image cho secret
  isolation, orphan containment, restart/upgrade, backup/restore và disaster recovery;
  full API/browser/fresh-source/OCI/security/license gates PASS. Công bố support matrix
  theo version/topology/transport; chỉ publish/deploy khi có ủy quyền riêng.
  Hosted gates đã lưu cho `bb5c98c` đạt full API/browser/release, parser, OCI và CodeQL;
  publication/promotion không chạy. Upgrade metadata T32 → hiện hành bằng đúng image
  frozen ở trên giữ legacy records và 68 bảng, reinitialize không đổi dữ liệu.
  Kiểm kê notices/runtime của image này đạt trong phạm vi internal artifact; không
  cấp public redistribution clearance và không chuyển Oracle qualification sang image khác.
  Đợt DR phát hiện credential phục hồi vẫn tạo được project khi RESTORE_HOLD (HTTP 201).
  Giữ nguyên project/audit của lỗi, không xóa hoặc replay. Bản sửa local chặn configuration
  writes tại transaction checkpoint, giữ historical review comments và error precedence
  hiện hành của SQL Workspace/reconciliation. Runtime context chỉ do trusted route chọn.
  Candidate local được thử trước PR #132 có image
  `sha256:86729abf9b20a38f8cc6f0b7fab092297c886285d544dd3b3079d757807b0bd0`,
  khác frozen image đã nghiệm thu Oracle; 211 runtime files được đối chiếu, chỉ ba file
  runtime thay đổi. API trên restore từ chối bốn mutations, đọc đủ hai jobs/receipts,
  browser trước/sau restart PASS; 68 bảng, source và prior restore được giữ nguyên.
  Verifier chỉ đọc tính lại hai receipt digests, xác nhận 12 credentials cũ còn revoked
  và generation vẫn RESTORE_HOLD. Comment trên APPROVED plan vẫn bị PLAN_NOT_PENDING.
  `npm run check` đạt 486 PASS/0 FAIL/154 optional SKIP. Lượt cuối có typecheck PASS,
  API 221/221 PASS (gồm 37 native backup tests), browser 58/58 PASS và extracted source
  bundle 27/27 workflow tests PASS; zero FAIL/SKIP ở các suites này. Sáu code/test file
  hashes không đổi từ đầu đến cuối lượt. Source bundle dùng unsigned isolated test-fixture
  commit, không phải canonical signed release. Lượt trước có 220 PASS/1 FAIL do assertion
  mới chọn audit theo thứ tự UUID; đã giữ lỗi và sửa để đối chiếu đúng comment ID.
  Review code độc lập không có actionable finding; audit image độc lập xác nhận đủ
  211 source files, notices/dependencies và ba COPY layers dự kiến. Saved image được
  kiểm tra cả OCI index/manifest/config/30 blobs, legacy Docker manifest và 24 diff IDs;
  verifier cũ nhầm index digest với config digest được giữ riêng, không sửa image.
  [Code patch để review](/home/longhn0710/workspace/kelryvo/acceptance-artifacts/restore-guard-bb5c98c-reviewed-v4.patch)
  có SHA-256 `25b58b478a05c223e559b70b5ea288b5de4a7b3726d3d323cc206d123ad4795c`.
  Hai assertions checklist cũ cố định R1 đã được sửa để đọc pending entry hiện hành;
  không đổi tiêu chí nghiệm thu. Các lần lỗi fixture, bản sửa quá rộng và lỗi test giữ riêng.
  Candidate đã được merge bằng signed master commit `ff239189` qua PR #132; hosted gates
  trên PR và master PASS. OCI artifact của đúng master đã được nghiệm thu native bằng
  fixture R3/R4/R5 mới; kết quả hiện hành ghi ở đầu checklist. Phần kỹ thuật R4 PASS;
  DIST/public release sign-off vẫn mở.
  Chưa deploy/publish; delivery mode chưa được cấu hình nên promotion đã SKIP.
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
