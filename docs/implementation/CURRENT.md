# SchemaForge product state

## Product-first MVP completion — 2026-10-12

The practical governance MVP is deployed and accepted through application PR #72,
master `86eea330657cabc9c175a6a4c70e035978fd57d6`, publication run `38197820209` and
Helm PR #4 / Argo revision `fbaffdfc70e15ce8596d0a4412b1cef591c1a21d`.
[Final feature matrix and external limitations](MVP.md) and
[concise acceptance record](../../evidence/product/mvp-completion-20261012/release.json)
supersede the historical checkpoints below. Candidate/master CI passed 123 API,
38 Chromium and fresh-source acceptance cases; deployed API/browser flows, downloads,
app restart and preservation checks passed. Argo is Synced/Healthy; worker replicas
remain zero. Helm CI stays UNAVAILABLE under its billing exception. Original catalog,
prior export/estate work, historical data, Secrets and storage identities are preserved.
Post-release evidence is pushed on the integration branch without another application
milestone PR or publishing unchanged code. Oracle acceptance remains external.


Git import, offline Oracle validation, retained plans, review/approval, controlled UNIT execution, history UI, secure sessions and reproducible source installation are integrated. The installed worker, metadata-only recovery, serial queue service and current deployment status are integrated through PR #65 at master `dc38fa7e856b720d435ff110bf7716748e9eb1ec`. Candidate and master Foundation, parser, PRODUCT and CodeQL passed; PRODUCT covered 110 API, 33 browser and one fresh-source release case with zero failures, cancellations or skips.

The service binds children and durable writes to the active metadata generation, runs expiry recovery before dispatch and drains through confirmed child exit. Isolated PostgreSQL service/supervisor acceptance passed 34/34, including active leader loss after statement 1, no second dispatch and preserved uncertainty. Prior failed FIFO evidence remains retained alongside its passing correction.

SF-PRODUCT-T38 adds bounded job-only status refresh, current summary/event inspection and truthful queued-worker feedback without resetting review drafts. PR #64 candidate and resulting-master Foundation, parser, complete PRODUCT and CodeQL passed, with identical reviewed tree and 110 API / 33 browser / one release case per head, zero failures/cancellations/skips.

SF-PRODUCT-T39 adds a separate bounded request-history browser for the selected plan, including empty-for-plan project pages and older events/attempts/receipts. PR #65 candidate and resulting-master Foundation/parser/complete PRODUCT/CodeQL passed with identical reviewed tree and 110 API / 33 browser / one release case per head, zero failures/cancellations/skips.

SF-PRODUCT-T40 separates cheap process liveness from bounded metadata readiness. PR #66 candidate and resulting master `8e1f31157a1d6ca9f333dd921b48873f923d1e58` passed Foundation/parser/full PRODUCT/CodeQL with 112 API, 33 browser and one fresh-source case per head, zero failures/cancellations/skips. Target availability stays explicitly unverified.

Private trusted purpose authority, target routes and attestations, deployed isolation/orphan containment and authorized Oracle runtime acceptance remain product gaps. UNIT target facts do not establish Oracle effects. The supplied GitGuardian finding is a release UUID entity identifier; its redacted assessment is retained and dashboard incident closure remains pending.

Required checks follow `docs/implementation/github-sync.md`. Complete PRODUCT API, browser and fresh-source acceptance remains mandatory. Catalog 220 has 0 fully verified, 59 partial, 154 not implemented and 7 deferred. Original contracts, history, evidence and PolyForm Shield 1.0.0 remain preserved.

Kelryvo deployment is verified at app master `46a82f49ab6a7b87984628e94ca53834a7e77528` and GitOps `ef88e89e63d80551928b362a89631a463adcb8bf`. PR67 candidate/master Foundation, parser, full PRODUCT, OCI and four CodeQL checks passed; publication run38154459321 supplied the immutable running digest. Public Chromium acceptance for both roles passed, including retained VALID release/approved plan/audit/history and secure sessions after app restart. PVC/PV and PostgreSQL pod identities were unchanged; Argo is Synced/Healthy; worker replicas remain zero. Evidence: `evidence/product/kelryvo-deployment-20261011/`. This does not certify Oracle execution, database disaster recovery or public distribution.

SF-PRODUCT-T42 resumes the deferred scoped plan-record export: public retained intent, current decision/withdrawal and an exact-record checksum. Full execution-evidence export and signed authenticity remain outside this bounded slice. Its verified source is merged; release promotion proceeds independently of subsequent development under the owner’s updated continuous-delivery instruction.

## PR 68 release checkpoint — 2026-10-12

PR #68 merged as `d53c91cc1cf231a9bae8fbd373683c66983de53a`; mandatory resulting-master Foundation/parser/PRODUCT/OCI/CodeQL and publication security gates passed. Immutable publication run `38184202487` is in progress. The healthy prior deployment remains unchanged; Helm CI remains UNAVAILABLE under the owner exception. Release state and prepared acceptance live in `evidence/product/plan-record-release-20261012/checkpoint.json`. Oracle execution remains disabled.

Development stream: `SF-PRODUCT-T43` is locally implemented and independently reviewed on `development/execution-record-export`, based on merged source `d53c91c`. Actual PostgreSQL and Chromium acceptance passed; npm run check passed306tests with68offline database skips. It adds joined retained execution-request record downloads with scoped reads and no new execution authority. Required candidate/master CI remains pending. Release PR68 remains pinned to its own checkpoint; pending release CI does not block independent development.

SF-PRODUCT-T44 groups loaded project schema assignments by declared environment and stable service references. Actual PostgreSQL/Chromium cases passed3/3, including shared-service isolation, ownership transfer, delayed/logout/revoked reads,52assignments across pages and11-service summary truncation. Independent UI review passed. Full source CI remains required; manual/provisional declarations do not certify Oracle estate. CI optimization PR #70 merged as `25796f6`. Its complete candidate acceptance passed117API/35browser/1fresh-source case, zero failures/cancellations/skips; slowest job431seconds versus measured927seconds before. Four API and three browser shards preserve full coverage; resulting-master checks remain required.
