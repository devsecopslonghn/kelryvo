# SchemaForge security correction and MVP integration checkpoint — 2026-10-11

Active outcome: repair T35 and integrate the already implemented local MVP. No new
functionality is scheduled until this checkpoint is complete.

T35 corrected source: 1d428b416f76df65659aff1f30bb1b0c250fb6a7. Operator journals
now witness LOCAL credentials only; actor-wide revocation still invalidates all browser
sessions. Recovery accepts earlier v1 journals containing browser digests and uses LOCAL
revocation to determine commit state. The recovered capacity-limit proposal is preserved
under evidence/product/product-t35-journal-repair-20261010/. Focused regression: 5/5
passed, including >32 HTTPS sessions, rotation/revoke and six crash phases with legacy
browser-inclusive journals. Final frozen serial acceptance passed 192 standard / 55 product-parser / 31 Chromium,
zero failures/cancellations/skips. Corrected PR #48 exact-head CI is pending. T35 stays IMPLEMENTED; old source acceptance does not certify the correction.

Integration path: corrected #48 will target master as one aggregate reviewed PR. Its
ancestry contains exact #45/#46/#47 heads and current master; #45 includes #37–#44.
Preserve every source branch/worktree and verify host PR reconciliation after merge.
Local master was fast-forwarded to actual origin/master 0fd6980.
The master branch API explicitly reports protected=false, protection disabled and no
required contexts. Protection/rulesets require a paid feature, code scanning requires
Advanced Security, and secret scanning is disabled. These are unavailable optional
capabilities, never PASS. Repository review/security/license/available CI gates remain.
No bypass, subscription change or security threshold change is authorized.

MVP status: Git intake, retained SQL/parser validation, offline plans, independent review,
approval withdrawal and persistent audit/history are implemented locally. Deployment
requests, immutable intents, claim/checkpoint/UNIT receipt safety and metadata backup /
RESTORE_HOLD are implemented; no authorized Oracle executor/runtime is demonstrated.
M1/M2 local foundation and offline preparation workflows are demonstrable in existing
API/Chromium acceptance, pending integration. M3/M4 are partial: the trusted execution
host is not wired to actual target authority; Oracle runtime and
reconciliation acceptance remain BLOCKED_EXTERNAL; M5 remains incomplete. The shortest
next path is host/admission wiring → truthful journal/reconciliation UI → reproducible
release acceptance, reusing the coordinator/supervisor and preserving unknown/HOLD safety.
Catalog remains 220 = 0 full /
48 partial / 165 not implemented / 7 deferred. PARTIAL is not full feature completion.

Next: publish the scanned/reviewed bounded correction to #48 and wait for actual CI.
License closure is unchanged: 85 pinned packages, zero unknown required grants.
Then ordinarily merge aggregate #48 after its exact-head gates and verify master CI plus a
local PostgreSQL/Git/parser/HTTPS browser demonstration. Retain all124 Oracle cells
BLOCKED and never claim real migration execution. Persist exact heads and results here.
