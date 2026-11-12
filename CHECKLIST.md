# Kelryvo — checklist hiện hành

Nguồn trạng thái duy nhất cho app và Helm. README chỉ là cửa vào. Cập nhật 2026-11-08 (Asia/Saigon).
`[x]` nghĩa là hoàn thành đúng phạm vi ghi bên cạnh; không đồng nghĩa production-ready.
`[ ]` nghĩa là còn thiếu nghiệm thu hoặc điều kiện hoàn thành. Không suy diễn kết quả
offline thành kết quả Oracle, hoặc chuyển nghiệm thu giữa các source/image.

## Current delivery goal — 2026-11-08

### Full Rust rewrite — 2026-11-09


**Rust-only source cleanup — 2026-11-12 (Asia/Saigon):** the user authorized
removing the retired Node application, replacing its live comparison dependencies
with fixed fixtures, and committing/pushing the migration for review. This
supersedes the earlier no-push handoff below; it does not authorize deployment,
image publication, merging or changing infrastructure.

The Node API/worker/runtime, React UI, legacy operators, release scripts and old
application tests are removed. Rust under `crates/` is the application. Root npm
commands invoke Rust or development/test tooling only; the lock now contains four
installed test packages and no Node application dependencies. Oracle ledger/mutex
SQL and the original parser corpus/grammars have native-owned locations. Licenses,
notices, dependency evidence, native backup profiles and metadata compatibility
remain retained.

Migration expectations are frozen under `tests/fixtures/contracts/`, with capture
provenance and SHA-256 membership. Exact core, completion and legacy vault wire
vectors are independent of the current native implementation. Metadata snapshots
consistently rename generated identifiers/hashes and credential aliases and ignore
volatile clocks; cursor payload structure and tied-order fixtures remain checked.
Synthetic fixture setup uses normal constraints and guarded native metadata APIs.
The retired Node implementation is no longer needed to run these checks. This
changes the validation method and does not assert complete behavioral parity.

Local verification covers native workspace unit tests, the 1,228 fixed core
vectors, parser corpus, synthetic OCI integrity/assembly, PostgreSQL product and
named-object integration, identity/inventory, held recovery, local credential
interruption and fixed v1 journal recovery, pilot preparation/import, and focused
Chromium HTTPS/WASM schema navigation and evidence flows. Full browser regression,
new exact-image/native ARM/Oracle qualification and hosted CI are not rerun by
this cleanup. The earlier `0d6d1238` archives and results below belong to their
pre-cleanup source and cannot qualify this checkout. RUST3–RUST6 retain their open
qualification boundaries. Existing CI, CodeQL and publication/approval gates stay
required; source review is prepared on `cleanup/rust-only-migration`.


**Current working state — 2026-11-12 (Asia/Bangkok):** goal status is blocked.
Three consecutive read-only audits confirm the required native-platform CI /
real-commit provenance gate cannot be completed for this preserved dirty source
within the current no-push/no-external-infrastructure authorization. Local work
and relevant checks are complete within the scopes below; full rewrite/release
completion is not asserted. No pending build, test or fixture remains.
All existing uncommitted/untracked changes are retained. The current native
source is 0d6d1238 (319 inputs, canonical full-string-key map). Both source-qualified
AMD64/ARM64 OCI archives and exported roots are available and independently match
all source bytes/modes, seven blobs/layer diff IDs and 119 runtime package notices.
The earlier 5905f163 value was only a misordered local verifier map, corrected
without changing native source; its explanation and original map remain below.

AMD64 passes exact release body/auth/routing/quota/root/WASM checks, actual offline
Docker Engine checks, focused release Chromium HTTPS/WASM/password flow and both
installed Oracle recovery cases (74680 exits 0). Runtime stops cleanly; Oracle
vendor shutdown is explicitly unclean, with private namespace disposal recorded.
ARM64 passes explicit-QEMU five-binary/root/role/inventory checks. Its JS/WASM is
not byte-identical to AMD64, so it is tested directly by reconciliation checks and
host Chromium against the same-source AMD64 API; that also passes. This does not
claim native ARM server/Oracle/hosted-CI acceptance. Component checks remain scoped:
22 library tests, 39 routing/96 body/46 auth/nine quotas, product/named-object
integration, all-target server Clippy and 19 relevant container static tests.

Current artifacts use kelryvo-0d6d1238-{amd64,arm64}.oci.tar and
.cache/buildkit-overlay.0d6d1238-{amd64,arm64}/rootfs; the final scoped evidence
index is source-0d6d1238-evidence.json under .cache/native-image-build. All test
DBs, Oracle/vendor/client copies, wallets, browser/API/TLS/Docker/root-contract
fixtures and temporary cache seeds are removed. Five superseded archive/root
pairs are removed after checksum/source checks, reclaiming about 2.4 GiB; their
reports/indexes remain historical evidence only, not usable old artifact paths.
The idle private BuildKit daemon is stopped; its reusable cache and the one host
Cargo target remain. No build or verification process is pending. Approximately
779 GiB is free. Source-commit nomination/native ARM/hosted CI and the broader
rewrite/parity audit remain open. The read-only audit also confirms 189 unchanged component inputs, retained
16-profile/five-archive scope, 1,228 current-release kernel comparisons and current
parser/grammar contracts (nine tests, 31 original files). The goal is blocked
on the required external/native-CI and real-commit provenance boundary; no
deployment, publication, external infrastructure, push/merge or approval/CI gate
is changed.
The following cleanup handoff and earlier artifact paths are historical.

**Remaining parity and qualification boundaries — 2026-11-12:**

| Area | Verified scope / remaining boundary |
| --- | --- |
| Parser (RUST3) | Existing 31-file corpus and distinct native-v2 fail-closed policy pass. Full grammar/semantic equivalence and performance are unqualified; old parser approvals never acquire v2 implicitly. A bounded authored-source scan finds no native todo!/unimplemented! stubs; inherited pinned grammar TODOs remain unchanged. |
| API/UI (RUST4) | All 169 registered method/path pairs and the scoped product/named-object contracts pass. Current AMD64 release passes 39 routing/96 body/46 auth/nine quota cases and packaged Chromium login/password/static/WASM flow; ARM packaged JS/WASM also passes host Chromium with the same-source AMD64 API. Full behavioral/browser parity audit remains open; route presence alone does not prove it. |
| Installed Oracle (RUST5) | Retained 218 passes both recovery cases and clean runtime shutdown (89292, exit 0), with explicitly unclean Oracle vendor shutdown. Current 0d6d1238 fixture 74680 exits 0: both recovery cases, both whole-ledger comparisons and clean runtime shutdown pass; private fixtures are removed. Oracle vendor shutdown is explicitly unclean. Six captured harness hashes still match. Earlier-source reports cannot qualify current source. |
| Delivery (RUST6) | Both exact 0d6d1238 OCI/source/package inventories pass. AMD64 has actual offline Engine and installed Oracle proof; ARM64 has explicit-QEMU root/binary and direct packaged-web proof. Native ARM server/Oracle/hosted CI, nominated-commit release gates and publication remain unrun/unchanged. Final local artifacts are ready for review, not release-nominated. |

These open scopes are not new confirmed product defects. Keep preparing the
reviewable local replacement without adding a routine broad-suite/QC gate or
claiming production replacement, deployment or publication.

**Session handoff and cleanup — 2026-11-11:** rewrite work is paused for a new
session at the user's request. Preserve the current uncommitted source changes;
do not restart the rewrite or infer completion from the historical checks below.
The API, WASM UI, native parser, Oracle components, operators and default native
delivery entrypoints have been implemented, with the bounded checks recorded
under RUST1–RUST6. Complete replacement qualification remains unfinished.
The latest isolated integration additionally passes real HTTPS readiness before
Oracle installation, two independent authenticated sessions, explicit OS-operator
grants and API instance registration with encrypted master credentials. This is
registration only: the complete approval → installed worker → Oracle execution
and recovery workflow has not passed. The local component test separately passes
45 provisioning steps, scoped grants, protected sources, mutex exclusion, fixed
CREATE TABLE, postconditions and durable ledger readback; it grants no production
qualification. The 33-character trigger source readback correction is retained.
On cleanup, no session test processes remain. Session-generated BuildKit/OCI
outputs, private source snapshots and debug bundles, Oracle client/wallet copies,
local Oracle/PostgreSQL data, browser fixtures, logs and generated WASM output
were removed: 518 workspace paths plus 25 temporary paths under /tmp,
approximately 124.3 GiB freed. All 863 source files were
checked unchanged during deletion; only this handoff note is subsequently added.
Original credential inputs, older unrelated project caches and shared toolchains
are retained. Paths to deleted caches below are historical references, not
available evidence or runnable installations. Rebuild only the required native
components and revalidate affected behavior. Reuse one build target and bounded
fixtures; avoid accumulating duplicate images, source copies and test databases.

**Session continuation — 2026-11-11:** work resumed from the uncommitted source
above after reading the global engineering instructions and cleanup handoff.
Earlier unqualified statements in RUST3–RUST6 describe their historical
checkpoints; the bounded installed-Oracle and current-artifact results immediately
below are the continuation evidence and retain their separate artifact identities.
No previous cache, installation or historical result was reused as a current
artifact. A single Cargo target uses disabled development/test debug symbols,
disabled incremental compilation and bounded build concurrency. The supplied
credential file and its endpoint were not read or contacted in this continuation.

The installed native path now has a bounded real-Oracle integration result on
one disposable local Oracle Free 23.26.0.0.0 PDB, Linux/amd64, with verified TCPS,
Instant Client 23.26.4.0.0 and newly generated local credentials. The client ZIP
SHA-256 matches Oracle's official download page. The fixture has isolated mount,
network, PID, IPC and UTS namespaces and its own PostgreSQL database. Actual HTTPS
readiness, two independent cookie/CSRF sessions, OS-operator project/deployment/
database grants and API registration with an encrypted master credential pass.
The API runs as UID 10001 with only the public vault key; the installed worker
runs as UID 10002 with separately published writer, ledger and observer secrets.
Native preparation completes all 45 provisioning steps and protected-source/grant
preflight. Publication records its installation and audits. A read-only refresh
then independently qualifies the source-bound release worker without changing
passwords or target history, followed by fresh publication and observer review.
The review uses an explicitly local fixture artifact identity; it does not
nominate an OCI image or create production qualification.

The release binaries pass API discovery through the installed worker, native
observer acceptance, schema assignment and identity verification. Authored SQL
is prepared through the API and independently approved with exact intent/target
expectations. The first installed execution reaches VERIFIED_SUCCESS with two
central receipts for CREATE TABLE and CREATE INDEX. A separately approved request
reaches NOOP with zero receipts and unchanged dispatch-preimage bytes. A private
PostgreSQL trigger then rejects only the next job's final VERIFIED_SUCCESS
projection after Oracle has applied the incremental migration. Existing guards
stay enabled; the trigger is removed afterward. That job reaches HOLD with one
receipt. After its original immutable 300-second lease expires, installed
held-preview, independent API reconciliation review and held-confirm pass.
Repeated confirmation is idempotent: exactly one EXECUTION_RECOVERED_APPLIED
audit is retained, while the complete job/attempt/receipt snapshot, HOLD state
and dispatch-preimage bytes remain unchanged. The public completion retains
retryEligible=false and executionAuthority=false. Actual lost Oracle COMMIT ACK
and production restore/recovery qualification remain separate from this metadata
projection failure case.

The opt-in `bash scripts/test-rust.sh --installed-oracle-only` runner now lives
in `scripts/test-rust-installed-oracle.py`. It requires an already prepared,
protected disposable namespace context and fixed loopback fixture destinations;
it provisions no Oracle accounts and creates no second PostgreSQL fixture.
It refuses to silently rerun a project with retained execution jobs. During runner
development, extra derived draft fields, missing approval expectations and a
string reconciliation revision were correctly rejected by the API. Premature
held-preview was correctly refused before lease expiry. The same retained jobs
were subsequently checked in two phases; no admission, migration, lease, receipt
or approval was rewritten to repair the test. The final runner includes the
original-lease wait and the retained numeric reconciliation-revision contract.
Two focused completion/catalog tests, four native parser tests, formatting,
runner syntax, shell syntax, source hygiene for 521 authored files and whitespace
checks pass. Real HTTPS additionally
serves the exact generated index/CSS/JavaScript/WASM bytes with certificate
verification. A full browser suite was not rerun.

One current local release distribution is retained at
`.cache/rust-native-distribution/` (approximately 162 MiB), with its bounded
redacted Oracle result at `.cache/rust-installed-oracle-result.json`.
Its sourceTreeDigest is
`c03871c3d487cb8db51b92fa133943ef4f54eb1aaeefedfab3f332ce660773b2`;
the distribution.json SHA-256 is
`9b7094a08483583abf058ea879d69ae4894358efbca915c9b7eaadf5f64e8f56`.
Independent comparison matches membership, bytes and original-mode fingerprint
for all 313 current build inputs; all five release executables report that same
source identity. Native verify-dist passes its 701 inventory entries, including
the matching source, WASM and locked dependency source archives. The actual
Oracle/API worker check uses the matching release worker/server bytes.
The same release distribution additionally passes the native PID-1 namespace
smoke: API/worker UID and capability isolation, protected projected secrets,
TLS readiness/WASM before the first installation, root controller lock/shutdown,
retained witness handoff, read-only mounted repositories, socket peers, API-only
restaging, governance/credential rotation and restart. A dummy OCI library fails
closed; this separate smoke retains one cancelled job and zero attempts and
contacts no Oracle. Post-smoke native verify-dist still passes unchanged.
This is local-unpublished host-built distribution evidence, not a signature,
release-source approval, OCI-image qualification, arm64 result, Docker
Engine/Compose result or companion-chart/cluster acceptance. RUST3–RUST6 remain
open for their stated broader parity and replacement limits; existing CI and
publication/approval gates remain required. No deployment, infrastructure change,
push, merge or publication was performed.
Both disposable namespace runs and their PostgreSQL/Oracle databases have stopped.
Their image/root, generated credentials, wallets, client/PKI copies, private
diagnostics and smoke roots are deleted after use. The current distribution,
redacted result and small build/check logs remain, with one approximately 4 GiB
Cargo target and no incremental/debug-symbol accumulation. Original credential
inputs and older unrelated caches remain untouched. The deleted fixtures are not
runnable installations or retained recovery databases.

**CI and artifact parity follow-up — 2026-11-11:** the retained parser workflow
still invoked two removed `parser:antlr:*` aliases, and the release regression
invoked the removed `test:release` alias. They now call the matching existing
`reference:*` scripts. Their original parser corpus/tests and release test remain
selected; schedules, jobs and publication/security gates are unchanged. A focused
workflow-to-package script-resolution regression first fails on the obsolete
commands, then passes after the correction. Current native parser acceptance
passes all 31 original corpus files. The current private-PostgreSQL product
integration passes, including actual registration coverage of all 169 retained
method/path pairs and the configuration, authority, audit, approval and execution
contracts. The native Helm patch also passes strict lint and every retained/native
rendering assertion against clean companion commit
`0d11a258302f2011d8952dae530172a8f08525dd`, with no companion source or cluster change.

Browser testing can now select `KELRYVO_RUST_DISTRIBUTION` and use its exact
packaged API binary and WASM, verifying bundle integrity before and after the
run. With that selector, `--browser-product-only` avoids rebuilding debug binaries
or another WASM bundle. The complete existing native product browser smoke passes
on the release distribution identified above, including author/reviewer workflows,
validation, accounts, schema, history, HOLD review and desktop/mobile shell guards.
Its private PostgreSQL/browser fixtures and the Helm candidate are removed after
use. The source-bound host distribution remains intact.

The Docker builder now explicitly shares `/opt/kelryvo-source/target` across the
wasm-bindgen tool installation and workspace builds, with development debug
symbols and incremental artifacts disabled. This recipe change creates a new
source-tree identity: the preceding `c03871c3…` bundle remains a tested earlier
artifact and must not be reported as the current Docker recipe artifact.
That pre-loader-fix recipe has 313 build inputs and sourceTreeDigest
`056cadd9853cf1c9f8eb4b520deb404c2cceed984847bdfe0acc9f2ec435ccd5`.
To keep one accumulating Cargo target, the completed approximately 4.2 GiB host
target is removed after retaining the verified host CLI/runtime probe. Runtime
and exported-image smoke runners now accept explicit absolute host tool paths,
so image verification need not recreate another host Cargo target.
A single private BuildKit OCI worker builds the current default Dockerfile
with a private Unix socket and no registry publication.
BuildKit v0.34.1 comes from the official release archive, checked against its
GitHub release asset SHA-256
`a59539daf547fe0958efe2d07e41c0a6944e1112a66d7e519ec1cf5b673ef15b`.
The linux/amd64 build now completes and retains the mode-0600 OCI archive
`.cache/native-image-build/kelryvo-current-amd64.oci.tar` (152,539,136 bytes).
Its application manifest is
`sha256:7e0821544048ad31db9fd96f4c6cb53d5010bbc9f1a73afdbc033d8bac29e4bf`;
config is
`sha256:88bfb0be3bc5d0a658ed7ab260336b80bd3aed78f715301ec15e343e098e2ed5`;
archive SHA-256 is
`46ab968cfe709b2e47ff3f06ff74eb09dee9993fee6e6b9cda3fa1eec13b8903`.
Independent verification checks all seven OCI blob hashes, descriptor sizes,
config/layer links and uncompressed layer digests, then recomputes the source
fingerprint and compares all 313 packaged inputs with the original bytes and
modes at that checkpoint. All 119 actual runtime package notice hashes also match. The five
release binaries share the compiled source identity above; native bundle
verification passes in both builder and final image.

The exact image filesystem passes the read-only/empty-network/zero-capability
image contract, absence of build interpreters, role-UID refusals and missing-mount
failure. It also passes the complete native PID-1 namespace/TLS/WASM/governance/
rotation/restart smoke with its actual Debian libraries. Only a disposable test
copy receives the private probe and fixtures. That smoke retains one cancelled
job and zero attempts, and contacts no Oracle. Its PostgreSQL and filesystem
fixtures are removed after terminal completion. The immutable OCI archive and
unpacked source artifact remain verified. This current `056cadd9…` image is
LOCAL_UNPUBLISHED; it does not inherit actual Oracle qualification from the
previous `c03871c3…` host distribution, nominate a release SHA or establish Docker
Engine/Compose, native-arm64 CI, cluster or production restore acceptance.

After amd64 verification, approximately 5 GB of builder cache is pruned, retaining
no amd64 Cargo target. The same private worker then builds linux/arm64 using its
explicit official BuildKit QEMU executable without host binfmt registration.
That second-platform build is subsequently cancelled (terminal exit 1, not a
passing artifact) when the offline Oracle-loader check below exposes a prerequisite
hidden by the earlier fixture's ldconfig setup. Its only in-progress release is
not retained or qualified.
The bounded current delivery gate passes: 521 authored-file source checks,
TypeScript/reference web build, checklist/format validation, 88 JavaScript tests,
three Python tests and the 94-package dependency grant closure. No full browser
or broad regression suite is repeated after the preceding relevant checks pass.

A private Docker Engine 29.9.2 fixture now also passes the existing complete
container smoke on that exact amd64 OCI archive and pinned PostgreSQL 17.10.
Direct OCI load retains manifest `7e082154…` and every rootfs layer diff ID.
A transport conversion whose loaded image identity differed from the OCI
manifest/config identities was discarded before any smoke; it supplies no
exact-artifact result. That observation does not by itself isolate a config-only
change. The daemon uses private mount/PID/IPC/UTS
namespaces, a namespace-private Unix socket/data root, disabled bridge/iptables/
forwarding changes and the smoke's explicit HOST_LOOPBACK mode. The initial
projected-secret assertion incorrectly tried to stat an API-owned mode-0500
subdirectory as root without DAC capabilities. The test now checks its file as
UID 10001 with cleared supplemental groups; runtime permissions/capabilities and
all negative-access assertions remain unchanged. With that correction, the Engine
run passes HTTPS cookies/CSRF, independent approval, mounted-Git/parser validation,
API/worker UID and secret isolation, credential rotation without renewed expiry,
graceful restart/persistence, and container exit without restart after essential
API-child loss. Missing Oracle installation retains API readiness and creates no
execution authority. It is Engine host-loopback evidence, not isolated-bridge,
Compose/pilot, Oracle or native-arm64 CI acceptance. All test containers and their
metadata database are removed; the daemon is stopped and its temporary storage
is deleted after use. Only the bounded result and exact-image inspection remain.

The observed transport conversion also exposed a source-CI provenance defect:
`containers.yml` used that same `skopeo ... docker-daemon:` conversion before
claiming to smoke the exact platform archive. It now enables the existing local
Docker daemon's [containerd image store](https://docs.docker.com/engine/storage/containerd/)
before Buildx, preserving other daemon configuration, and invokes
`scripts/load-oci-platform.mjs`. This adapter verifies the complete existing
source/platform archive contract before Docker mutation, loads the OCI archive
directly, verifies the retained manifest descriptor, config identity, role/env/
labels and every rootfs diff ID, then tags and reverifies the smoke candidate.
Converted config-only representations fail before candidate tagging. Both native
platform jobs, existing container/pilot smokes, artifact assembly, source/security
and publication gates remain selected and required. Six focused OCI verification/
loader tests pass, including changed manifest/config/layers/role and wrong-source
rejection; the direct OCI transport itself is exercised by the Engine result
above. The revised remote workflow has not been run or declared passing.

**Current blocking Oracle-image gap:** an offline check of the [official Instant Client
23.26.4.0.0 Basic ZIP](https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html) (SHA-256
`cab59aa3b411b3b50898e456fa9aabfe48d67e25cbc1bb23303800390ce7de26`,
137,184,838 bytes) confirms no RPATH/RUNPATH in libclntsh.so.23.1. The current
image's glibc loader, with its actual Debian libraries and cache inhibited, fails
with an unresolved Oracle dependency when the client directory is absent from
its startup search path; adding that exact directory resolves all dependencies.
No Oracle connection, credential or SQL is used. Native OCI initialization
supplies lib_dir, but the sanitized worker/operator child startup currently omits
its reviewed client directory from the dependency loader path. The earlier real
Oracle fixture's namespace-private ldconfig setup supplied that prerequisite.
The `056cadd9…` amd64 image retains its bounded no-Oracle smoke results but does
not qualify the missing default installed-Oracle loader behavior. Fix startup
from validated private artifacts before rebuilding final images; preserve the
same independent review, permissions, child deadlines, audit and no-replay rules.
The supplied credential file/endpoint remains untouched.

The source fix is now implemented in the native worker. A non-deserializable
client-directory selector uses the same complete private preparation/publication/
preflight checks, or the fixed installed discovery/execution configuration. OCI
commands replace their still-unused process with the same binary/PID and stdio,
using only fixed PATH/LANG/TZ, the validated client directory and a one-pass marker.
The replacement reloads and revalidates all inputs before stdin, checkpoints,
metadata locks or Oracle work. A changed directory/environment after replacement
fails rather than replacing again. Loader separators/tokens are rejected; API,
waiting services, expiry recovery and read-only observer-scope commands get no
loader path. No approval, lease, receipt, audit or PostgreSQL/API schema changes.

Root-only `installation-client-check PRIVATE_INSTALLATION` uses the same artifact
and private-file checks, initializes only OCI, verifies mapped/rehashed artifacts
and reports `CLIENT_READY_NO_DATABASE`, client version and explicit false runtime/
execution-authority flags. It neither resolves a database credential nor creates
an installation record or database session. A fresh isolated host-debug fixture
passes this command on official client 23.26.4.0.0 under the existing four bootstrap
capabilities and no-new-privileges, with no database credential file and with UID
10001/10002 refusals. Its inherited debug/secret selector variables are removed.
The bounded result is `.cache/native-image-build/host-offline-client-check.log`;
it qualifies only host-debug client startup, not an image, Oracle session,
installation or release source. Fixture construction errors involving redundant
legacy ZIP aliases and a nonprivate configuration parent were corrected without
relaxing product guards. Only regular package members and the required unversioned
libclntsh alias are materialized. Their disposable namespace roots are gone.

All 38 focused runtime/worker checks pass, including real process replacement,
retained PID/stdin, environment cleanup, changed-selection refusal, independent
admission, immutable dispatch/NOOP/unknown-ACK HOLD, recovery and installation
journal fences. Worker/runtime all-target Clippy passes. Their private PostgreSQL
and 19 generated fixture paths are removed after completion. The completed 1.7 GiB
host Cargo target has also been removed; only BuildKit's shared target remains.
The namespace image runner now has opt-in `KELRYVO_RUST_ORACLE_CLIENT_ZIP` support:
it checks that exact official x86-64 ZIP, reuses its existing root/database fixture
and requires offline client readiness with read-only image root, writable tmpfs,
four bootstrap capabilities, no metadata credential file and UID refusals. This
new exact-image mode now passes the complete namespace runtime smoke. The changed source
has 315 build inputs and sourceTreeDigest
`2fa46061c8d44ad76902ee411f83af8cfb641ed6e98a8cbca3d2955e32086824`.
The Docker builder now also fixes Cargo concurrency at two jobs, retaining the
same shared target and disabled debug/incremental artifacts.
The cancelled arm64 attempt and preceding `056cadd9…` image cannot qualify this
changed source. Before the new build, the completed host target and the obsolete
056cadd9 OCI archive/layout/exported root are removed; their bounded logs and
provenance reports remain historical evidence, not runnable artifacts. The earlier
c03871c3 host distribution and its redacted Oracle result remain separately scoped.

The rebuilt linux/amd64 OCI archive is
`.cache/native-image-build/kelryvo-current-amd64.oci.tar` (152,573,952 bytes,
SHA-256 `91699cf6e31ebfb5ed554102752d7b937196fc4007a35b77d57a4b6e764ef425`).
Its manifest is `sha256:2a06f3a1c01e263e0698529922f437fbb63ef90cd2df1551dac70d3c6bccadfa`
and config is `sha256:67873dd6121c9f802303984753ec06a7342ad3907e743cdf864ced9005840fd4`.
Independent archive/blob/diff-ID/source-mode/source-byte verification passes for
all 315 build inputs and all 119 Debian package versions. The no-network,
read-only-root artifact contract passes. The opt-in namespace runtime smoke then
passes actual OCI initialization at 23.26.4.0.0 with the four bootstrap capabilities,
no metadata credential file, no database session and UID 10001/10002 refusals,
followed by PID 1/TLS/WASM/governance/rotation/restart/socket checks. Its report is
`.cache/native-image-build/amd64-real-client-runtime.log`. Two fixture-only failures
(a nonprivate config parent and a nonrecursive root bind hiding proc) were corrected
without changing product guards or rebuilding the verified image. This closes the
bounded image-loader startup gap; actual current-image Oracle execution/recovery
and remaining platform qualification are still required. A fresh isolated Oracle
Free fixture is being prepared; the supplied credential file/endpoint is untouched.

The current-image Oracle fixture exposes a second integration defect: native init
and the chart prerequisite requested a root:10002 wallet directory at 0710, but
the unprivileged worker verifies its complete artifact set using directory
enumeration. File access alone succeeds; enumeration fails. On the unchanged
`2fa46061…` image, changing only that fixture directory to 0750 changes discovery
from unavailable to accepted ORACLE_READ_ONLY. The source init contract, chart
comment and customer instructions now require 0750; wallet files remain root:10002
0440, with API UID 10001 excluded. The namespace smoke additionally rejects 0710
before creating state and checks enumeration access and API denial. The new
315-input source digest is
`9299ccfcf7859ec6f5f642d4c6cc571f85920f1b2b9dff5f9ded46bed56e38c6`.
Its amd64 rebuild and bounded exact-image Oracle checks now pass below; the
preceding image does not qualify this updated contract.

One isolated Oracle Free 23.26.0 fixture and one private Unix-socket PostgreSQL
cluster were reused under `.cache/native-oracle-fixture`. The supplied credential
input/endpoint is untouched. The exact preceding image's root PID 1 supervises an
API at UID 10001 and runtime worker at UID 10002 with no capabilities; its root controller uses
only CHOWN/KILL/SETUID/SETGID plus no-new-privileges. HTTPS registration uses newly
generated credentials, explicit grants and encrypted master storage. A fresh
controller authorization completes all 45 setup steps, publishes automatically,
and reaches READY. Fresh read-only native preflight plus a separate scoped fixture
review publishes accepted native discovery. Earlier fixture attempts remained
stopped until final fixture cleanup: listener registration failure, service-name case mismatch and a missing
direct READ grant on SYS.V_$VERSION. No pending journal is reset or resumed; all
preceding journals have zero completed DDL steps. This demonstrates refusal, not
successful recovery of those setup attempts. The same database/principals were
reused with read-only refresh for the new image, without reprovisioning or duplicate DBs.
The installed-Oracle runner now optionally executes native commands inside the
verified image root and observes the actual runtime-managed worker, including its
UID/capabilities/root. Its metadata fault is installed before enqueueing and scopes
only a fresh independently approved plan, avoiding a race with that worker.
The new amd64 archive now passes independent verification: manifest
`sha256:be3d95f91e48fd8495bc07f07fb0f2e1cea0bc27dc2647d93d255cb0a6b85292`,
config `sha256:69cb06a6a3d77aa56a13d7ef4de44f2251497d46ffd20102b50110ffff412819`,
archive SHA-256 `90b64c29fba6810005911395e79e3e7a3e90397cc616acb5a5d7bb2bb1a56461`
at 152,573,952 bytes, 315 current source inputs and 119 Debian packages. The
actual new binary rejects 0710, accepts 0750 and retains API wallet exclusion.
The existing Oracle fixture then adopts all verified distribution bytes, retaining
its database, principals, private passwords, metadata and witness. The new root
controller performs a read-only refresh and republishes; a separate fresh native
preflight/review passes, and the controller restarts with that review and reaches
READY. The app now runs on a read-only root with writable runtime/state/tmp mounts.
Fixture mount repairs restored the PostgreSQL relay and the host test driver's
witness view; no product guard or database history was changed.

On this exact image, the actual PID-1-managed UID-10002 worker reaches
VERIFIED_SUCCESS with two receipts, then an independently approved NOOP with zero
receipts and unchanged dispatch bytes. A fresh independently approved incremental
plan reaches HOLD with one receipt after the scoped metadata fault. After the
original immutable 300-second lease expires, held-preview, independent API review,
held-confirm and repeated confirmation pass. Exactly one recovery audit is retained;
the entire job/attempt/receipt snapshot, HOLD and dispatch bytes remain unchanged.
The public completion retains retryEligible=false and executionAuthority=false. The
initial runner stopped after successful execution on the missing host witness
view. Its explicit continuation verifies that exact sole successful job and both
receipts, then executes only the remaining unchanged harness statements; no
successful SQL is rerun. The redacted bounded report is
`.cache/native-image-build/amd64-current-oracle-result.json`; retained logs have
the `amd64-oracle-current-` prefix in that directory. All four process boundaries
are independently checked on the read-only root: root supervisor has KILL only,
API/worker have zero capabilities and the controller has the four bootstrap
capabilities; all use no-new-privileges. All three retained preparations, including
two read-only refreshes, retain identical private writer/ledger/observer password bytes. This is the local
amd64 metadata-projection recovery case, not lost Oracle COMMIT ACK, native arm64
CI or production restore qualification. Native runtime and controller stop with
exit 0, Oracle shuts down cleanly and PostgreSQL stops. The complete disposable
fixture, server image/data, app copy, wallets, fresh credentials and PKI tool are
removed. Only one official client ZIP remains for reuse; the stopped fixture paths
above are historical, not runnable installations. Approximately 832 GiB is free.
After the completed amd64 build, pruning its private BuildKit cache frees 8.02 GB.
The same private builder starts the current arm64 build with explicit QEMU and
two Cargo jobs; this is emulated build validation, not native arm64 CI. Its log is
`.cache/native-image-build/current-arm64-build.log`; no arm64 artifact exists yet.
The live build client handle is 87911 (host PID 291114) and private daemon handle
is 58919 (host PID 291059). Revalidate these handles/processes before any continuation;
do not restart on an observation timeout. The current arm64 archive path is an
unfinished export until the client exits successfully. No Oracle/PostgreSQL test
process remains. No host Cargo target, Docker daemon, host binfmt registration,
external deployment, push, merge or approval/CI bypass was introduced.

**Current PostgreSQL 17.10 compatibility — 2026-11-11:** the same verified
`9299ccfc…` release operator/server bytes now pass a bounded standalone metadata
check on one fresh local PostgreSQL 17.10 cluster from the configured pin
`postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f`.
The upstream manifest digest and actual server version 170010 are checked.
Native initialization, pinned real pg_dump/pg_restore attestation, witnessed backup
and restore pass. The complete native backup schema object equals the retained
Node inventory on that same PostgreSQL server (70 tables, schema signature
`d252a0313bfc9e76718234a3009d1dc922fedb669c4c104f41a2b6facbd62c04`). Restored rows in all 60 business tables match
source; the new lineage remains RESTORE_HOLD, both original credentials are retired
and source rows remain unchanged. A mismatched witness creates no new database;
a mismatched tool checksum creates no backup/witness. Initialization preserves
HOLD while activation/reseeding and reuse of the retired token are refused.
Root recovery issues a fresh historical-read credential without clearing HOLD.
The native UID-10001 API then passes verified-TLS browser-session creation and
historical project reads on that restored database; project creation returns
409 METADATA_RESTORE_HOLD. This uses the vendor PostgreSQL-root libraries and
qualifies current standalone PostgreSQL compatibility, not application-image
runtime isolation, a historical customer archive, managed Kubernetes tunnel,
admitted-job restoration or production restore. The API exits 0, PostgreSQL stops
cleanly and the disposable server image/cluster, restored DB, archives, credentials
and TLS material are removed. Bounded redacted evidence is
`.cache/native-image-build/amd64-pg17-compatibility-result.json` with `pg17-*.log`.
No product code or build inputs change during this check; the current arm64 build
continues on the same 315-input source, with no duplicate Cargo target or DB.
The exact current amd64 exported-image contract also passes independently: all
five native binary identities, bundle integrity, read-only root, empty network,
zero capabilities, role UID refusals and missing protected mounts. The bounded
report/log are `.cache/native-image-build/amd64-current-contract.json` and
`amd64-current-contract.log`; its disposable root is removed. This contract is
separate from the Oracle and PostgreSQL checks above. The continued source audit
finds no unimplemented native route/stub; retained route-registration coverage is
still distinct from semantic and browser parity. RUST3–RUST6 remain open for the
stated broader replacement audit and final platform/CI limits. The current arm64
client/daemon remain live; no successful artifact is inferred from a partial log.

**Reconciliation browser parity correction — 2026-11-11:** a bounded response
fixture on the actual `9299ccfc…` packaged WASM reproduces a missing retained UI
guard: reconciliation data for the wrong job with true execution/retry authority
is rendered instead of refused. This is a browser-consumption defect; the
separately verified API/worker authorization and no-replay boundaries are not
bypassed. Native UI now binds history to the current project/job, requires both
authority flags to be false, bounds rows to 20 and validates recovered completion
status, HOLD, flags and lowercase SHA-256. Submission/review response bindings and
flags are checked before refreshing history. Invalid digest/reason input stays
local. Review controls require known independent author context and only HOLD
jobs expose reconciliation controls. Verified recovery explains its separate
installed-verifier result, retained HOLD/no replay and linked independent review.
No API, metadata schema, worker, credential, lease or dispatch code changes.

The compiled WASM passes valid/null recovery, valid submission/review, 14 malformed
history and six malformed mutation response refusals, unknown-author control
refusal, non-HOLD controls and invalid-digest zero-request checks. These isolated
public-response fixtures create no DB, approval or Oracle evidence. The helper is
`scripts/test-rust-reconciliation.mjs`, selected by the existing full native browser
smoke; focused unrelated browser modes retain their scope. WASM Clippy, formatting,
JS syntax, 523 authored source checks and diff checks pass. Logs and the original
failing reproduction are under `.cache/reconciliation-response-fixture/`. Its one
temporary 314 MiB host target is removed before image work resumes.

The preceding arm64 build completed before this fix: manifest
`sha256:67d8b7e943f453eba230c0d054ee0a83b21f031f9b06c63bad31352deb38f2f9`,
config `sha256:475bbe345945cafcfef2083d743458faed1529c8a78a265e14dfd685cfc81f6b`,
151,141,888-byte archive SHA-256
`764be8502a91870d5ad2aadfb46827abe0fa7b205b7eefbaaf5a1912dc70702c`.
Its seven blobs/diff IDs, 315 source inputs and 119 OS packages verify against the
already verified matching amd64 packaged source, not the subsequently edited
worktree. Packaged source files are intentionally 0444; their original source
modes remain bound by the retained source-input digest. Its emulated image
contract passes all five binary identities and the read-only/empty-network/UID/
capability/bundle checks, without host binfmt registration. This is pre-UI-fix
local evidence, not current-source or native ARM CI qualification. Bounded reports
use the `arm64-9299ccfc-` prefix. Completed pre-fix archives/layouts/exported roots
and contract copies are removed; their reports and the small before-fix browser
source remain, with no runnable old image assumed.

The same compiled-browser fixture subsequently reproduces a second retained UI
parity defect: a local validation failure or unconfirmed mutation response erases
the entered HOLD evidence/review reason. The native UI now preserves those fields
through rerendering, clears them only after a confirmed mutation response,
and discards stored HOLD form values on logout or actor change. The regression
checks preserve invalid digest/reason and refused submission/review text, and
confirm that successful submission clears the evidence fields. Actual compiled
WASM, WASM Clippy with warnings denied, 523 authored source checks, checklist
validation, repository checks and diff/JS syntax checks pass. The one temporary
host Cargo target is removed after these terminal checks; no test DB is created.

A further bounded case reproduces confirmed-POST/unavailable-history behavior
on the packaged `b1b60c15…` WASM: evidence input remains populated although the API
has already confirmed retention. The retained UI clears the confirmed form and
explains that only history refresh failed. Native UI now does the same for both
submission and independent review, while preserving input when the mutation
itself is unconfirmed. Malformed history and actual HTTP 503 refresh cases pass
on compiled WASM for both mutations. These public-response fixtures still create
no database, Oracle effect or actual approval. WASM Clippy with warnings denied,
formatting, JS syntax, diff checks and all 523 authored source checks pass after
the correction; the single temporary host target is removed.

The current source has 315 build inputs, with only
`crates/kelryvo-web/src/browser.rs` changed from the Oracle/PostgreSQL-qualified
`9299ccfc…` artifact. Its digest is
`c2ee21e4d5834868079bc9ae06c2f31c9d189d8422047463414d1c6d41b1afa8`.
The `b1b60c15…` intermediate amd64 image was successfully built: manifest
`sha256:cf5f3d39500702fb414d56068ae319f5e3df255073c3ff0b2eab8886d9648cdf`,
config `sha256:c3dc48fc62a1b74abf7c1a19d20675e7483e10c61facd67a26e194b9d8f435d7`,
152,577,536-byte archive SHA-256
`347e756bb4de76546f25b56c11abaa1065adcc2eee4999d575d51c2bd1ba7adc`.
Independent verification passes all seven blobs/diff IDs, 315 then-current source
inputs and 119 runtime packages/notices. The exact image contract passes all five
binary identities, read-only root, empty network, capability drop, role refusals,
bundle inventory and missing protected mounts. The full existing real TLS/API
product browser smoke also passes against its packaged release API/WASM on one
host PostgreSQL 16.15 cluster, including actual independently authenticated HOLD
evidence/review DTOs and the earlier reconciliation response fixtures. This does
not include the subsequently added refresh-failure fix and is not silently
transferred to the next image. All browser DBs, keys/credentials, contract copies,
archive/layout/exported root are removed after terminal success. Bounded reports
and logs use `amd64-b1b60c15-` under `.cache/native-image-build/`.

The matching `b1b60c15…` arm64 build was explicitly canceled after the reproduced
UI defect, before any output export; it has no successful artifact. Client 53236
is terminal with cancellation, not a platform failure or live build. Its bounded
log remains `arm64-reconciliation-final-build.log`.

The current `c2ee21e4…` default-Dockerfile amd64 build completes successfully
(client 54828 terminal): manifest
`sha256:f23fd5fe28266ad22ec64c4a1e5bf610ce1e5e418d1afc77fc5e3e8c147f7ad9`,
config `sha256:0b51745d519d2f3b7f80f265846f2e3646eb775c653fcd6d95e3b15fd27533d0`,
152,577,536-byte archive SHA-256
`bbc6ed75e010137de39d930dcd1edd8fd315d84bfdf51747ca7c75e5bd728e67`.
All seven blobs/diff IDs, 315 exact current source inputs and 119 runtime package
versions/notices independently verify. Its exact five-binary/read-only/empty-
network/capability/UID/bundle/missing-mount contract passes; that disposable copy
is removed. All reconciliation response/form/confirmed-mutation refresh-failure
cases pass on the exact packaged WASM. Bounded evidence is
`.cache/native-image-build/amd64-independent-verification.json`,
`amd64-current-independent-verification.log` and `amd64-current-final-contract.*`.
The full existing real TLS/API/browser smoke also passes against that exact
packaged release API/WASM on one disposable PostgreSQL 16.15 cluster, including
independent approval/withdrawal, retained attempts/receipts, actual HOLD submission
and review DTOs, audit/access/HOLD guards, credentials, schema/target workflows,
account/session behavior and all reconciliation response/refresh-failure fixtures.
The driver and private DB run on the host; this is packaged API/WASM product
qualification, separate from the exact Debian image contract and previous Oracle
integration. Terminal exit is 0. PostgreSQL stops, API/browser exit, and the DB,
private Git fixture, TLS keys and generated credentials are removed. Bounded
logs/results are `amd64-current-browser.log` and
`amd64-current-browser-result.json`, with `fixtureCleanup=true`.

The matching current-source arm64 build is now running (client handle 82067,
client host PID 451014; private daemon host PID 291059), log
`.cache/native-image-build/arm64-reconciliation-current-build.log`. Keep the
existing builder cache and one accumulating target. No current arm64 output is
inferred until successful export and independent verification; emulation does not
replace native ARM CI. Prior Oracle/PostgreSQL evidence retains its exact
preceding artifact identity. The immediate remaining artifact work is to await
this same arm64 client, independently verify its export against the sealed current
source map, then run its emulated image contract and packaged reconciliation
fixtures. Do not restart a healthy live build because an observation wait ends.
The single current amd64 archive/layout/exported root and required builder cache
are retained; no host Cargo target or test DB remains. Available disk is about
817 GiB. Rewrite qualification and the goal remain open for the documented
platform/parity limits; no deploy, push, merge, external infrastructure mutation
or approval/CI bypass is authorized or performed.


**Current local Docker/Compose delivery — 2026-11-11:** the same independently
verified `c2ee21e4…` amd64 OCI now passes a bounded actual Docker Engine 29.9.2 and
Compose 5.6.1 customer-pilot check. Import preserves the exact verified OCI config
identity `sha256:0b51745d519d2f3b7f80f265846f2e3646eb775c653fcd6d95e3b15fd27533d0`.
An independent local-unpublished engine contract passes all five release binary
identities, complete bundle verification, actual read-only-root refusal, zero
capabilities/NoNewPrivs, missing protected mounts, role UID refusals and absence
of build/interpreter prerequisites. Existing CI revision/publication gates are
unchanged; this local unpublished contract is not substituted for their results.
The existing unmodified `scripts/test-pilot.mjs` then passes actual native
installation/verification, Compose startup, explicit two-account password
bootstrap, verified HTTPS readiness, non-default password sign-in, project
creation, explicit grants and customer Git import. Oracle is NOT_RUN.

One private daemon/data root owns both application and pinned PostgreSQL
`17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f`
images. Prefetch uses no bridge, forwarding or firewall changes; runtime has its
own mount/network/PID/IPC/UTS namespaces and loopback. The fixture socket is
separate from the absent host `/var/run/docker.sock`. Original local-product
cache/config and root Docker configuration are hidden inside that private mount
namespace. Host network link identities remain unchanged. Initial failures are
fixture-only: a Unix socket path longer than 104 bytes, the installed Node path,
and a working directory resolved before entering the mount namespace. Short
private `/run` state, the actual Node executable and `nsenter --wdns` resolve
those failures without product changes or weakened gates. A diagnostic preload
records failed Compose stderr only; it leaves command arguments/results and all
test assertions unchanged. Containers and metadata volumes are removed by the
existing smoke; the private daemon exits 0 and its entire image/data/fixture tree
is removed. Bounded mode-0600 user-owned reports/logs are
`.cache/native-image-build/amd64-current-docker-{result.json,engine.log,pilot.log,fixture.log}`.
All 315 build inputs remain sealed at `c2ee21e4…`; no host Cargo target or test DB
remains. The same arm64 client 82067/PID 451014 continues; no new image build is
started or inferred from this amd64-only result. Native ARM CI, companion-cluster
acceptance, historical archive interoperation and production/lost-COMMIT-ACK
qualification retain their separate open scopes.


**Backup locale compatibility correction — 2026-11-11:** a fresh disposable
PostgreSQL 17.10 instance from the configured official pin uses its default
`en_US.utf8` locale. The unchanged retained Node inventory and exact `c2ee21e4…`
release operator both reject its initialized schema before archive/policy output,
with identical digest
`cddcb143b4a0c4fd918859e57b4abbfadf4ca56f6a76da382cb1ce398115bf13`.
Read-only diagnostic capture proves that all 456 constraint records and every
other schema field are unchanged; only constraint-array ordering differs. The
`regclass::text` ORDER BY inherits the database locale. Applying `COLLATE "C"` to
that read-only query alone restores the existing trusted signature
`d252a0313bfc9e76718234a3009d1dc922fedb669c4c104f41a2b6facbd62c04` and the original
Node verifier accepts it. The diagnostic creates no archive, policy, new schema
signature or restore authority. No validator or whitelist is loosened.

The production query is now corrected identically in
`packages/backup/index.mjs` and `crates/kelryvo-operator/src/backup/schema.rs`.
The existing native witnessed-restore integration now chooses an installed
English libc locale for its source DB, retaining every data/HOLD/job/receipt/
credential/witness/tool assertion. Hosts without that locale explicitly report
that non-C coverage was not run and retain the original restore checks. The
current host has `en_US.utf8`; the targeted native witnessed-restore test passes
with that actual source locale, including original admitted/waiting metadata-only
jobs, attempts/receipts, immutable lease, witness/tool vetoes, credential retirement
and root-only historical-read recovery. The original test assertions remain.
Targeted operator/backup Clippy with warnings denied also passes. One host target
uses two jobs, disabled incremental compilation and disabled debug symbols, and
is removed after terminal checks. The test exits 0; initial wrapper cleanup fails
on the deliberately root-owned recovery secrets, then OS-root removes only those
completed fixture paths. PostgreSQL stops cleanly. Bounded logs/results are
`.cache/native-image-build/backup-collation-regression*` and
`backup-collation-clippy.log`. Formatting, JS syntax, all 523 authored source
checks and diff checks pass.

The `c2ee21e4…` arm64 client 82067/PID 451014 is explicitly canceled after this
confirmed product defect, with no export. It is terminal, not a timeout or
platform failure. The prior amd64 OCI/browser/Docker results retain their exact
source identities and do not qualify default-locale metadata backup. The worktree
now differs from that sealed map in the operator query and its existing test;
new corrected release artifacts are still required. Keep the private builder
cache (daemon PID 291059) for those builds. The supplied sensitive credential and
endpoint remain untouched.

One private interoperability fixture is retained at
`.cache/native-backup-interop/` with its own daemon (host PID 465750, handle 61995).
Its sole PostgreSQL container `kelryvo-node-native-archive-pg` was cleanly stopped
(exit 0) before the host regression, preserving the failed default-locale source;
no source journal/history is reset. Node/private configuration and generated
credentials stay inside the mode-0700 fixture. The host-targeted regression uses
a separate temporary PostgreSQL 16.15 socket while that container is stopped;
only one test server is active. That host cluster is now removed. The same PG17
container is subsequently restarted without resetting its source and retains
one verified Node archive/restore result for continued historical-profile work.
Reuse this fixture, then remove its images/data. Initial diagnostic schema files
are not backup/restore evidence; its later archive/config/data files are private
fixture data and must not be printed or retained after cleanup.
The earlier `amd64-current-docker-*` result remains a separately completed and
cleaned delivery check. The goal and RUST3–RUST6 stay open.


**Corrected current archive interoperation — 2026-11-11:** source now has 315 build
inputs at digest
`bf72a688e89cebf013b3a977830562b111e054a5a3010309895b08c3bc34ee56`.
Only `backup/schema.rs` and the existing operator backup test differ from the
preceding `c2ee21e4…` build map. The retained Node reference changes only that same
catalog ORDER BY; its file SHA-256 is
`32f43f31500239177d2e255132ac8491919f4d81fdceea4a5973ea2864b6d834`.
The default-Dockerfile amd64 build completes (client 73183/PID 480814 terminal):
manifest `sha256:1d8593cf4246c4b900bc6d2bb8b63bc0d32dbb6c8f1e9802c1d1fc9b091ae01b`,
config `sha256:22779beb0d720a146778711c2e0724faeaf6f75121befb98cde21f9ffef44e8c`,
152,578,560-byte archive SHA-256
`165e5313c2ad030c88be81f5b99a37dda99456a38428446bfdf958e69d44dbf8`.
Independent verification passes seven blobs/diff IDs, 315 exact current source
inputs and 119 runtime packages/notices. Its exact five-binary/read-only/empty-
network/UID/capability/bundle/missing-mount contract and packaged reconciliation
WASM fixtures pass. The disposable contract root is removed. The pre-fix amd64
archive/layout/root are removed; its independent report is retained as
`amd64-c2ee21e4-independent-verification.json`. The single current OCI/layout/root
and builder cache remain for further verification, with no host Cargo target.

The actual retained Node backup producer, with the corrected catalog query,
creates a witnessed current-schema archive on the unchanged default-locale PG17
source. A private fixture comparison initially mistakes the driver's Array
subclass for a wire-JSON difference after the producer has succeeded. Comparing
the complete serialized schema resolves that harness issue. The sole original
archive/witness is validated against its source checkpoint and all hashes;
no backup or source bootstrap is repeated. Docker copy preserves UID 1000, so
the receiving OS-root operator explicitly takes ownership of the copied private
files, with unchanged bytes/modes and guards, before native attestation/restore.
The root-private import check initially refuses that untransferred ownership;
it is not a product guard relaxation or an archive rewrite. Neither initial
fixture failure reaches native restore.

The exact new release operator bytes (SHA-256
`8034ed16651b89f33f023572fce5ac7d8dca78cd937ca5dc8e679c309dc5b23f`)
then pass actual native tool attestation and restore of that Node archive, using
the official PG17 root/libraries and its real pinned native pg_dump/pg_restore.
The complete 70-table schema matches the original trusted signature. All 63
selected business tables are byte-value equivalent; both original local
credentials are retired. New lineage remains RESTORE_HOLD with the original
predecessor/witness and exactly one restore audit. Initialization preserves HOLD;
activation and reseeding with valid private inputs are refused. The complete
source data and original manifest/witness/archive bytes remain unchanged.
No admitted job, Oracle effect, application-image runtime isolation, historical
archive or production restore is qualified by this vendor-PG-root check.
Bounded evidence is `.cache/native-image-build/amd64-backup-collation-*` and
`amd64-independent-verification.json`; the interoperation result retains
`fixtureCleanup=false` while the one private PG17 fixture is reused.

No arm64 build is currently running: client 82067 was canceled for the reproduced
backup defect, not an observation timeout. Finish the declared historical-profile
compatibility audit using this same private PG17 instance before spending another
long arm64 build on the source. The fixed current-schema archive does not close
historical-profile acceptance. The build cache daemon 291059 remains idle and the
private Docker daemon 465750 remains live. Native ARM CI, final artifact nomination
and the previously stated Oracle/production recovery limits remain open. No
sensitive supplied credential is read, and no external infrastructure, deployment,
push, merge or approval/CI gate is changed.

**Historical archive compatibility and current artifact — 2026-11-11:** the
subsequent audit reproduces all 16 declared schema bootstraps on the same default-
locale PostgreSQL 17.10 fixture, one scratch database at a time. Twelve frozen
profiles use C constraint ordering; four original Node profiles (`identity`,
`preInstanceSchema`, `instance`, `password`) retain their original English-order
wire representation. Their complete catalog records match; only array order
differs. Both producers now explicitly preserve those four frozen representations
while current profiles use the locale-independent catalog query. No bootstrap SQL,
trusted signature, admitted profile or schema guard is changed. Native inventory
prefers the original Node identity representation. Restore explicitly selects the
already validated incoming profile, including the older native C-order identity
alias, and retains complete pre-data and post-restore schema equality. It neither
rewrites input archives nor executes archive-supplied schema SQL.

The targeted native checks pass all 16 exact trusted catalog signatures, reject
an extra constraint, and pass both witnessed-restore integrations, including the
retained original identity schema upgraded under RESTORE_HOLD. The current host's
English locale is exercised. Operator all-target Clippy with warnings denied
passes. The one host Cargo target and temporary PostgreSQL fixture are removed
after terminal success. Evidence is `backup-history-regression-result.json`,
`backup-history-regression.log` and `backup-history-clippy.log` under
`.cache/native-image-build/`.

The original Node producer is loaded from Git commit
`7b5cc80281198ef1cf12e7694efae8b64ccc77af`, blob
`7682275f7a7dd173a4907c949b2035f292c6b505`, source SHA-256
`d7f7f5c5f1bb711da223d06f12329fb88c040b2e20a12064b48cfd669bd75a5b`.
Only import URLs are relocated in memory; its implementation and validators are
unchanged. Actual witnessed archives from all four original Node profiles and
one earlier native C-order identity archive pass restore with the new release
operator. All five upgrade to the existing current schema signature, preserve
selected business values, retire both local credentials, retain predecessor/
witness and exactly one restore audit, and refuse activation/reseeding under
RESTORE_HOLD. Complete source data and original archive/witness hashes remain
unchanged. This uses real pinned PG17 dump/restore tools inside the vendor
PostgreSQL root; it does not qualify admitted-job restoration, Oracle effects,
application runtime isolation or production restore. Bounded results are
`amd64-backup-history-interop-result.json` and its corresponding log.

The current 315 native build inputs have digest
`7b006abeadf21be4fda0e1f996c61709c12a9b26f88ad10f13ad507728760eba`.
The retained Node reference SHA-256 is
`13f7e91f2fb47027837407d1f7c12de82d41f9442dfd8a49e9cb115c147236d5`.
The current default-Dockerfile amd64 export passes independent verification of
all seven blobs/diff IDs, exact worktree source bytes/modes, and 119 installed
packages/notices. Its manifest is
`sha256:12a7b43c1adf4074283cd93f18af0e0b7f49a53e2bf45e1262a8c8afcabfa91b`,
config `sha256:7bf915272f0b9acb56e331b23ee4270155c11d348aee6191f9c9c9599b03da13`,
152,579,072-byte OCI archive SHA-256
`7362169c256b01cbe4e490cab8c9e70caa51091d360b926b85973fa9ee79ebe8`.
Its exact five-binary/read-only/empty-network/UID/capability/bundle/missing-mount
contract and packaged reconciliation WASM fixture pass. Independent evidence is
`amd64-independent-verification.json`; current contract/UI logs use the
`amd64-backup-history-` prefix. Broader browser and installed-Oracle results above
retain their earlier source identities; they are not exact-current-image results.

The unchanged versioned Docker governance smoke passes on this exact image in
the isolated daemon: real HTTPS/cookie/CSRF, independent approval, credential
rotation without expiry extension or resurrection, restart persistence, UID and
capability separation, root-private source secrets, terminal child failure and
API readiness without an Oracle installation. The customer pilot smoke also
passes install/verify, private account bootstrap, password login, explicit grants
and customer Git import with a normal UID-1000 caller. Its fixture now stages the
extracted native operator and parent as OS-root controlled and cleans that whole
temporary directory; native filesystem guards remain unchanged. That script is
outside the sealed native build inputs. The first governance wrapper's private
umask made the public customer checkout unreadable by the API; using the required
public checkout permissions fixes the wrapper while logs remain mode 0600.
The pilot's initial user-owned staging failure is likewise retained as a fixture
failure, not hidden or treated as product qualification. Oracle is NOT_RUN in
these delivery smokes. Current evidence is `amd64-backup-history-docker-result.json`
with its Docker and pilot logs.

All completed private Docker containers, networks and volumes are removed; daemon
465750 is stopped and verified absent. The entire private interoperability fixture,
including its images, databases, source copies, archives, keys and credentials,
and the disposable contract root are removed. The relevant results now record
`fixtureCleanup=true`; their former private paths are not reusable. The host Docker
socket remains absent. Only the current amd64 OCI/layout/root, bounded redacted
reports, one retained official client ZIP and the live private BuildKit cache are
kept. Disk free space is approximately 810 GiB. No host Cargo target remains.

The corrected arm64 build is running as client 7224, host PID 532100, against
the same 315-input digest; daemon 291059 and
`arm64-backup-history-build.log` remain authoritative. It is still compiling,
with no terminal export or arm64 acceptance inferred. Keep its cache and do not
restart it for an observation timeout. Final cross-platform verification, native
ARM CI and the separately documented parser/API/Oracle/recovery/replacement scopes
remain open under RUST3–RUST6. The goal remains active. Supplied credentials and
their endpoint remain untouched; no deployment, publication, external infrastructure,
push, merge or approval/CI gate is changed.

The installed-Oracle runner now resolves dispatch-witness reads against the
configured image root in image mode, for both the NOOP byte comparison and held
recovery. Previously it used the host driver's `/run` path, causing the recorded
missing-host-witness interruption despite successful execution. Standalone mode
retains its original path. A disposable file-context check reads exact witness
bytes through the image path, preserves standalone addressing and rejects relative
or traversal paths; its temporary directory is removed. Python syntax, all 523
authored source checks and diff checks pass. This runner-only correction is outside
the 315 build inputs. It is not a rerun of Oracle execution or a new artifact
qualification; the earlier Oracle result and continuation retain their exact scope.

**HTTP parse-error compatibility correction — 2026-11-11:** a bounded actual-
binary check reproduces a status mismatch on public `/api/auth/setup`: unsupported
XML produces `415 INVALID_REQUEST` in the preceding `7b006abe…` image while the
retained application returns `400 INVALID_REQUEST`. Both refuse the input. The
retained application is exercised with its real registered parser/error handler
and a startup-only SQL stub; all requests must fail before any metadata query.
The native probe uses one fresh Unix-socket PostgreSQL fixture, with zero public
relations before and after. An initial project-route probe reaches missing
metadata in that deliberately empty fixture and is inconclusive; it is not a
product failure or the mismatch proof. The public setup probe needs no metadata
and reproduces the actual 415/400 difference. The server shuts down with exit 0;
that private PostgreSQL cluster and generated configuration are removed.

The native error normalizer now maps unsupported media types to the retained 400
contract, alongside its existing typed-JSON 422 mapping. It preserves the existing
JSON error body, 413 body-limit rejection, authentication, audit, execution and
credential behavior. A permanent differential regression runs the actual retained
HTTP parser against the native router for XML/binary media types, truncated/empty
JSON, exactly 1 MiB and one byte above that limit. It first fails on 415 versus
400, then passes all six comparisons after the correction. The native fixture uses
an unreachable private socket and opens zero pool connections; no database or
authority is created. Server all-target Clippy with warnings denied, formatting,
524 authored source checks and diff checks pass. Bounded evidence is
`.cache/native-image-build/http-parsing-before.json`, `http-parsing-red.log`,
`http-parsing-green.log`, `http-parsing-clippy.log` and
`http-parsing-regression-result.json`. The one completed host target is removed.

The preceding arm64 client 7224/PID 532100 is explicitly canceled for this
reproduced API compatibility defect, not an observation timeout. It is terminal
with no export; its zero-byte output is removed. Its cancellation report and log
remain. No current arm64 artifact is implied. The preceding amd64, original
archive and Oracle evidence retain their recorded source identities.

The Docker bootstrap CLI now uses the release profile already used by
`build-dist`, retaining the same Cargo target directory, pinned toolchain and
normal build/verification gates. This avoids requiring a second native profile
for the grammar and shared dependencies. It adds no cache mount, source snapshot
or parallel target. The final native 315-input candidate digest is now
`b4bd9a3a513fa055a7110a549e4c3ddbf6f16a743529ddfe241f67dc599c92fe`;
only `Dockerfile` and `kelryvo-server/src/lib.rs` differ from `7b006abe…`.
Its default-Dockerfile amd64 build is running as client 19845/PID 571732 using
private builder 291059, with `amd64-http-parsing-build.log`. The client runs as
UID 1000 with an empty private Docker credential configuration. Revalidate that
process before continuing; no corrected export or qualification is inferred yet.
Disk free space is approximately 812 GiB. The supplied credential input/endpoint
remain untouched; no publication, deployment, external infrastructure, push,
merge, or approval/CI gate is changed. RUST3–RUST6 and the goal remain open.

**Corrected HTTP export and packaged check — 2026-11-11:** the
`b4bd9a3a513fa055a7110a549e4c3ddbf6f16a743529ddfe241f67dc599c92fe` amd64 build
is terminal with exit 0. Release-profile bootstrap, source-bound rebuild of all
five executables, WASM build and distribution verification complete successfully.
Independent verification matches all seven blobs/diff IDs, 315 exact current
source inputs and 119 installed packages/notices. The manifest is
`sha256:f7656bed1f0a1fb6145b211696f76edae8bebfe76311ad83466adaceb5de8eed`,
config `sha256:e86a441803a5e029d7a7382ad640f6ec4deeb1fdcf1baaa6740487f10605c89d`,
152,579,584-byte archive SHA-256
`a7bdcdfdc05b7a8a0137fa8efbbf8835d3c104a5d5feed4e74de5ff243146c5d`.
The previous amd64 root/layout are removed and replaced with this single current
export. Its five-binary/read-only/empty-network/UID/capability/bundle/missing-mount
contract and actual packaged reconciliation WASM response fixture pass.

The new `bash scripts/test-rust.sh --http-only` mode reuses the runner's one empty
private PostgreSQL cluster. With `KELRYVO_RUST_DISTRIBUTION` set to the current
absolute `/opt/kelryvo` export directory it rebuilds nothing and verifies the
distribution before and after the check. `scripts/test-rust-http.mjs` compares
the same six actual retained-parser cases against raw HTTP responses from the
packaged release server. All pass, including 400 for unsupported media and 413
above the unchanged 1 MiB limit. The private database retains zero public relations;
no actor, session, audit or execution authority is created. The API exits 0, its
private application directory is removed, and the parent runner stops PostgreSQL.
The stopped cluster and disposable image-contract copy are subsequently removed
and independently checked absent. The final result records complete fixture
cleanup; its nested HTTP result explicitly distinguishes application cleanup
from the caller-owned PostgreSQL lifecycle. No Oracle is contacted.

Current bounded evidence is `.cache/native-image-build/amd64-independent-verification.json`
and `amd64-http-parsing-result.json`, with independent/API/contract/UI logs using
the same `amd64-http-parsing-` prefix. This exact-artifact check covers parsing and
the stated image/UI contracts, not a new Docker Engine, TLS/PID-1 supervision,
installed-Oracle, lost-COMMIT-ACK or production restore acceptance. The preceding
broader results retain their own source identities. The new runner scripts are
outside the sealed 315 build inputs; syntax, 525 authored source checks and diff
checks pass. The CHECKLIST remains the sole handoff.

The matching arm64 default-Dockerfile build is now live as client 78924, host PID
584472, private builder 291059, log `arm64-http-parsing-build.log`. It reuses the
existing pinned toolchain/client build cache and uses explicit QEMU without host
binfmt changes. No ARM export or native-ARM qualification is inferred. Keep this
healthy build and cache until terminal completion; do not restart for quiet logs
or an observation timeout. There is no host Cargo target or live test database.
Approximately 809 GiB is free. The rewrite/goal and RUST3–RUST6 remain open for
their stated remaining qualifications; supplied credentials and external
infrastructure remain untouched.

**Current amd64 Docker governance and customer pilot — 2026-11-11:** the exact
`b4bd9a3a…` export additionally passes the unchanged versioned
`scripts/test-containers.mjs` and `scripts/test-pilot.mjs` against a private Docker
29.9.2 daemon with overlay2 and Compose 5.6.1. Import preserves image config digest
`sha256:e86a441803a5e029d7a7382ad640f6ec4deeb1fdcf1baaa6740487f10605c89d`.
The official pinned PostgreSQL 17.10 image is downloaded once in a prefetch phase
with bridge/iptables/IP forwarding disabled. That daemon exits 0; the same image
store is reused in a new private mount/network/PID/IPC/UTS namespace. Runtime
smokes use isolated bridges, with one PostgreSQL fixture at a time. The caller is
UID 1000, with empty private Docker credentials and the public Git checkout umask.

Governance passes actual HTTPS and secure cookie/CSRF, independent approval,
credential rotation without expiry extension or resurrection, restart persistence,
graceful exit 0, root-0400 source secrets, API UID 10001/worker UID 10002 separation,
KILL-only supervision, terminal child failure and API readiness before Oracle
installation without execution authority. History remains NOT_EXECUTED. Customer
pilot passes native install/verify, private-stdin account bootstrap, non-default
password login, explicit grants and customer repository import. No Oracle is
contacted or qualified by these smokes.

The first governance attempt stops at metadata readiness because the new private
`/run` scaffold omitted `/run/user/0`; Docker exec cannot create its process file.
PostgreSQL is healthy, and no product bootstrap has been reached. Its containers
and networks are removed by the runner. Creating that expected root-private
runtime directory only inside the namespace fixes the harness; the same versioned
product smoke then exits 0, with no source/assertion changes or gate bypass.
This environment failure remains explicit in the bounded result.

Both successful runs finish and remove their own containers/volumes/networks.
Only default Docker networks remain before shutdown. The namespace's local-product
mount is independently confirmed to point at its private customer fixture;
the original host cache directory metadata remains unchanged. The runtime daemon
exits 0. Its complete fixture, image store, databases, generated keys/credentials,
customer Git fixture and private diagnostics are removed, and absence is checked.
The host Docker socket remains absent. Evidence is
`.cache/native-image-build/amd64-http-parsing-docker-result.json`,
`amd64-http-parsing-docker.log` and `amd64-http-parsing-pilot.log`, with
`fixtureCleanup=true`. This is local unpublished Linux/amd64 Engine acceptance,
not hosted CI, native ARM, installed-Oracle/lost-ACK or production qualification.
The current ARM client 78924/PID 584472 continues normally with its existing
cache. Its initial release CLI bootstrap completes successfully in 32m 07s;
the source-bound distribution build is now compiling its native dependency graph.
The overall image build is still live, with no ARM export or acceptance inferred.
No host Cargo target or test database remains. Approximately 808 GiB is
free. No source build input changes, external infrastructure changes, deployment,
publication, push, merge or approval/CI bypass occur.

**Matching corrected platform exports — 2026-11-12:** ARM client 78924/PID
584472 is terminal with exit 0 after its existing uninterrupted build. Its native
release build, WASM build, source-bound distribution verification and 119-package
runtime inventory complete successfully. No observation timeout or quiet-log
period causes a restart. Independent verification of the exported arm64 OCI
passes all seven blobs/diff IDs, 315 exact current-worktree source inputs and all
installed package notices. Its manifest is
`sha256:9ade3caf9d328957f313d4f5a1415f177eb9433db8346040a955c33aaba618aa`,
config `sha256:d71b45c6d00e61792ce8ac2cfd97d295fd02f4726cd746b474ee612d9e7c13c7`,
151,151,104-byte archive SHA-256
`fa620f7a5dc91beeb73512057662d4196a1245c243caac967cdab5e4fb6fe52d`.
Both current platform exports independently match native source digest
`b4bd9a3a513fa055a7110a549e4c3ddbf6f16a743529ddfe241f67dc599c92fe`.

The exact arm64 root additionally passes its explicitly emulated five-binary
identity/read-only-root/empty-network/capability-drop/role-UID/bundle/missing-mount
contract, using the existing explicit QEMU binary without changing host binfmt.
Its newly packaged WASM passes the same reconciliation response fixture: 14
malformed history and six malformed mutation refusals, valid submission/review
and retained successful mutation despite failed history refresh. This browser
fixture creates no metadata, Oracle session or authority. The sole disposable
contract copy is removed and independently checked absent; the final result has
`fixtureCleanup=true`. Bounded evidence is
`.cache/native-image-build/arm64-independent-verification.json`,
`arm64-http-parsing-result.json`, and the build/independent/contract/UI logs with
the same `arm64-http-parsing-` prefix.

One current OCI archive/layout/exported root per platform remains for review.
These are local unpublished artifacts, with no source/release nomination or
assembled production OCI index. The arm64 checks establish an emulated local
artifact contract, not native ARM CI, ARM Docker Engine/TLS/PID-1 supervision,
ARM Oracle operation, actual lost Oracle COMMIT ACK or production restore.
Current amd64 Engine/HTTPS/governance/pilot and historical Oracle/archive results
retain exactly their recorded separate scopes. RUST3–RUST6 and the goal remain
open pending the completion audit of their remaining requirements; no full
replacement or production qualification is inferred from these bounded checks.
No test database, private Docker daemon, contract root or host Cargo target
remains. The private BuildKit daemon 291059 is now idle; keep its one cache until
the remaining work is assessed. Approximately 806 GiB is free. Supplied credentials,
their endpoint and all uncommitted source remain preserved. No deployment,
external infrastructure, publication, push, merge or approval/CI gate changes occur.

**Recovery qualification continuation — 2026-11-12:** the completion audit
compares all 315 current native inputs against the earlier installed-Oracle
candidate. Seven files differ: Dockerfile, the server HTTP rejection normalization,
the WASM browser reconciliation handling, and four backup representation files.
The worker/runtime/parser and remaining server implementation are unchanged.
Reversing only the added HTTP normalization/test in memory exactly reproduces
the previous server SHA-256; this is change-impact evidence, not transfer of the
older Oracle artifact acceptance to the current image.

A bounded loopback TCP fixture helper, `scripts/oracle-ack-proxy.py`, now withholds
opaque server responses and permits one selected-stream cut only while a
conservative monotonic proof window remains valid. It logs no SQL, credentials
or transport bytes. Five transport-only tests pass, including binary preservation,
stream isolation, stale-window refusal, one-shot behavior and the eight-connection
bound. `test:delivery` includes these tests without removing a gate. Transport
proof alone explicitly leaves `oracleCommitProven=false`; no actual Oracle
COMMIT-ACK qualification is claimed yet. Source hygiene checks 527 authored files.

One fresh local Oracle Free 23.26.3 image is pinned to
`sha256:7ed34d0ade89c91a553c9cbe9d42457c758fa29a762aaaa3137541ff30a2d1cb`.
Its OCI blobs verify before unpacking; its compressed fixture layout is removed
afterward. The first startup terminates before any product SQL with
`ORA-00600 [ksipc: no private ips avail for use]`/`ORA-29701` in an empty-network
namespace. Adding only a namespace-local dummy interface with documentation
address `192.0.2.1/32` allows startup. There is no veth, peer, default route or
external endpoint. A single fresh PostgreSQL fixture and one current amd64
application root are staged for the targeted installed-path test. Namespace
PID 638262/session 56268 is active; all product preparation/admission and real
ACK assertions are still pending. No historical database is reused. Fixture
startup diagnostics remain private under `.cache/native-oracle-fixture/private`;
none are release evidence. The native build inputs and both verified exports
remain unchanged. Approximately 800 GiB is free; no host Cargo target is created.
Supplied credentials and their endpoint remain untouched. The goal stays active;
no deployment, publication, infrastructure change, push, merge or gate bypass occurs.

**Current installed Oracle and real COMMIT-response fault — 2026-11-12:** the
current amd64
`b4bd9a3a...` artifact now passes real Oracle Free 23.26.3 HTTPS discovery,
API encrypted master registration, separate OS-issued grants, 45-step native
preparation, fresh read-only publication preflight and scoped native observer
review. The exact packaged runtime runs as PID 1 with only CAP_KILL after startup;
API UID 10001 and worker UID 10002 retain zero effective capabilities and NNP,
all on a read-only root. Actual API-UID read attempts refuse the wallet, each
installed writer/ledger/observer password and the operator vault private key.
Initial fixture readiness, mount aliases and a public source-identity traversal
permission caused harness-only setup failures before product admission. Private
credential permissions were retained. These failures are not reported as passing.

The fresh current-image project then passes independent API approval and
VERIFIED_SUCCESS for TABLE + INDEX with two receipts, followed by a separately
approved NOOP with zero receipts and unchanged dispatch-preimage bytes. The first
ACK monitor misses its V2 fault because FILE_APPLIED deliberately has no path;
FILE_STARTED retains the configured `migrations/` prefix. V2 succeeds normally
and is retained. The corrected monitor joins protected target/file/sequence
identity to FILE_STARTED. No applied V1/V2 SQL or retained job is rerun or reset.
A single new V3 migration receives a fresh independent approval. A monitor-log
collision refuses before V3 admission; the same existing reviewed plan is then
admitted without replacing its approval. No recovery guard is weakened.

The V3 independent observer sees a committed FILE_APPLIED event while the proxy
still withholds a 40-byte ledger response. Its exact monotonic proof is:
last forwarded capture 78595103010950 ns, last negative read start
78595202511862 ns, pending response capture 78595206234174 ns, selected ledger
upstream port 43182. The selected transport closes once; unrelated/new streams
remain usable. The installed worker reaches HOLD with zero central receipts.
The monitor records `oracleCommitProven=true` only with its independent Oracle
read; the transport proof alone still records false. After the original unchanged
300-second lease expires, two actual native
held-preview calls refuse completion because the central receipt is missing.
The complete job/attempt/receipt snapshot and dispatch-preimage bytes remain
unchanged, with zero EXECUTION_RECOVERED_APPLIED audits. The API returns no
recovered completion, retryEligible=false and executionAuthority=false.
A second read-only Oracle snapshot proves all 18 events and the sole head remain
unchanged across lease expiry and both refused previews, at SHA-256
`983017e7837f25eab65c935daace1460fe8ffc1be71d711eec5da0d64a2e1afa`.

The opt-in installed runner now accepts `--lost-commit-ack`; its existing metadata
projection case remains separate. New versioned proxy control/observer helpers
retain private control sockets, bounded opaque transport and exact nanosecond
JSON strings. Network guards accept only loopback plus the exact unconnected
dummy documentation address, refusing peers, other addresses and external routes.
Nine proxy/network/clock tests and 49 bounded delivery/completion tests pass;
script syntax, installed shell argument forwarding, JSON formatting, whitespace
and source hygiene for 529 authored files pass. All 315 current native source
bytes/modes still exactly match both verified platform exports; no Cargo target
or new application image is created for this phase.

The terminal installed continuation is exit 0, with prior V1/V2 jobs unchanged.
Bounded current-artifact evidence is
`.cache/native-image-build/amd64-actual-commit-ack-result.json`, SHA-256
`454b142ec580af81abdfadcffbfda6310f01482bb6c31f44b85d7221ed09846c`,
and the corresponding `amd64-actual-ack-` logs. This qualifies the current amd64
local installed path for the recorded real response-loss/HOLD/refused-completion
case. It does not manufacture a missing central receipt or transfer the separate
older metadata-projection RECOVERED_APPLIED acceptance to this image.

Runtime, proxy and namespace sessions 83433/48172/56268 are terminal exit 0;
PostgreSQL stops normally. Oracle's vendor SMCO fails to stop within 30 seconds;
the fixture then exhausts its 40-second graceful allowance and disposes its
private PID namespace. The result explicitly records oracleCleanShutdown=false;
all product assertions completed before this bounded fixture cleanup. The sole
6.3 GiB Oracle/PostgreSQL/application/client/wallet/private-key/credential fixture
is deleted and independently checked absent. No related process or test database
remains. These deleted fixture paths cannot be reused as artifacts. Approximately
806 GiB is free. The one idle 26 GiB BuildKit cache remains for the pending parity
work; no host Cargo target exists.

Current amd64 and arm64 exports remain reviewable local candidates at source
`b4bd9a3a513fa055a7110a549e4c3ddbf6f16a743529ddfe241f67dc599c92fe`.
The goal and RUST3–RUST6 remain open for their complete parity audit, native ARM/
configured CI and release/production qualifications; this result is not full
replacement approval. Supplied credentials and their endpoint remain untouched.
No external publication, deployment, infrastructure change, push, merge or
approval/CI bypass occurs.

**Confirmed HTTP quota parity defect — 2026-11-12:** the next parity audit
finds that the native limiter keys full IPv6 addresses, omits the retained setup
quota and quota headers, merges independent identity route budgets, and applies
a 20-request budget to legacy bearer session creation. These are confirmed on
the retained b4 amd64 binary using actual IPv6/IPv4 peers and certificate-verified
HTTPS in one private loopback-only namespace. Nine scenarios compare directly
against the retained registered Fastify application. The report records 112
quota/header differences, including a second address in the same /64 receiving
401 instead of 429 and setup request 11 remaining unthrottled. This is a product
parity/security defect, not a passing check. The PostgreSQL fixture retains zero
public relations and stops; generated TLS/application inputs are deleted. The
first harness startup correctly refuses plaintext bind `::`; enabling verified
fixture TLS fixes the harness without relaxing the product's loopback/TLS guard.
No supplied credential or Oracle endpoint is contacted.

The correction now uses normalized IPv6 /64 and mapped IPv4 identity, separate
bounded fixed-window/LRU stores for configured routes, retained quota/reset/retry
headers and the 10-request setup budget. Session POST selects its distinct
password/token budget after JSON parsing, preserves null-body bearer semantics,
and refuses absent bearer credentials before metadata. Authenticated approval,
CSRF, vault and worker execution guards remain active. The new direct reference
fixture and actual-peer runner live in `scripts/rust-quota-reference.mjs`,
`rust-quota-namespace.py` and `test-rust-quota.mjs`; `--quota-only` reuses the one
empty caller-owned PostgreSQL fixture. Native quota regression/expiry/LRU and
missing-credential tests pass. The corrected debug binary passes all nine
actual-peer HTTPS scenarios with zero remaining quota/header differences, still
with zero public PostgreSQL relations. A focused actual HTTPS/Rust-WASM password
browser flow then passes setup/login, invalid input/current-password/CSRF/HOLD
refusals, one password audit, retirement of old browser/password sessions,
unchanged LOCAL anchors and retained password-verifier interoperability. It uses
the unchanged packaged b4 UI as a component fixture, not a corrected OCI image.

A further retained-handler comparison confirms nine setup/login shape differences:
TLS/origin precedence and INVALID_PASSWORD_SETUP were lost to typed extraction;
array-encoded structs also reached native setup credential handling and login
metadata instead of being rejected. The focused test is RED with exit 101 before
the correction. Setup now checks TLS/origin before named-object validation, and
login/setup explicitly refuse arrays. The same 14 retained shape cases then pass
without metadata. Latest native server library checks pass all 17 tests, including
HTTP parser, quota and authentication shape comparisons. Clippy across all server
targets passes with warnings denied; formatting, shell/script syntax, JSON,
source hygiene for 533 authored files and whitespace checks pass. Actual-peer and
password-browser results precede only the final invalid setup shape/order tweak;
the latest router tests include that tweak. These scopes remain explicit rather
than treating an earlier binary run as the latest artifact.

Current native source inventory has 317 inputs at digest
`e1ecc227cf160b9290851c30c38ef6ccaddd64494ab1764c59290a03112a755d`.
Only server HTTP/auth files change from the prior native inventory, plus the new
quota module and its tests; runtime/worker/parser inputs are unchanged. Bounded
evidence is `.cache/native-image-build/quota-regression-result.json`,
`quota-before.json`, `quota-green.json`, and the corresponding quota/auth/shape
logs. The new inventory is `source-inputs-quota.json`; the original b4 inventory
is separately retained. One approximately 1.9 GiB host Cargo target remains for
the next bounded input-shape audit, with two jobs, disabled debug symbols and
incremental compilation. No compilation or test process remains.

The previous b4 platform exports and real Oracle evidence remain retained under
their exact identities. They do not match the corrected worktree, and cannot be
reported as final corrected artifacts. Finish the targeted checks, audit the
remaining HTTP boundary and prepare matching exports once it is stable. The
next concrete audit is the same positional-array deserialization behavior in the
remaining typed API request structs, including nested authored file inputs; the
authentication correction does not establish object-shape parity for those
routes. Use retained handler comparisons and metadata-preservation assertions
before deciding the appropriate shared correction. No application image rebuild
or second concurrent test database has been started. The one PostgreSQL fixture
was reused through actual-peer and password tests, stopped normally and deleted
after use, together with generated application/TLS inputs. The idle 26 GiB
BuildKit cache and the single host Cargo target remain reusable; no new source
snapshot or Oracle fixture is created. Approximately 804 GiB is free. The
goal/RUST3–RUST6 remain open, all existing uncommitted work is preserved, and no
deployment, publication, external infrastructure change, push, merge or
approval/CI bypass occurs.

**Named-object API request parity — 2026-11-12:** the remaining positional
struct audit confirms a real mutation defect. With a valid fixture credential,
POST /api/projects using a positional array returns 201 natively instead of the
retained 400, increasing project/audit counts from 1/1 to 2/2. The independent
PostgreSQL comparison is RED with exit 101; its red fixture is stopped and removed
after retaining the result. A separate unit regression is RED because malformed
nested file arrays panic while assigning an automatic draft-file ID.

A shared ObjectJson extractor now enforces the named-object request contract for
all 20 remaining typed HTTP parameters across 11 modules, preserving Axum's
content-type/syntax/body limits and the existing field/default/null validation.
Legitimate nested lists remain accepted. Draft-file creation verifies each file
is an object before assigning an ID, so malformed nested values return
INVALID_REQUEST instead of panicking. No worker/runtime/parser implementation or
approval, grant, credential, audit, generation or HOLD guard is removed.

The corrected server library passes all 19 tests. The targeted real-PostgreSQL
integration passes seven invalid retained-handler comparisons, the native-only
parser endpoint's invalid-array check, and valid named-object project/environment
controls. Every refusal preserves full row fingerprints for projects,
environments, audit, drafts/revisions, jobs/attempts, credentials and grants.
The first green attempt exposes a harness assumption: the standalone parser is
a native diagnostic HTTP extension, absent from retained Fastify registration.
That test now names its native-only scope instead of inventing a retained route;
its original 404 harness failure is retained. No test database is reused to hide
the red mutation or reset a migration/approval/receipt.

The complete existing native PostgreSQL product integration then passes in
91.72 seconds, including its registered-route inventory and existing source,
validation, target, approval, execution/recovery and session checks. Server
Clippy across all targets passes with warnings denied. Source/format/whitespace
checks pass. Bounded evidence is
`.cache/native-image-build/json-object-before.json`,
`json-object-regression-result.json` and the corresponding red, nested, library,
green, product and Clippy logs. Each fixture is stopped normally and removed
before the next is created; no test database or API remains. One host Cargo target
of approximately 2.2 GiB remains reusable, with debug symbols and incremental
compilation disabled.

The frozen replacement source contains 319 native inputs at
`75514880efd77345aa4efae86460fa37e933562a90bedcc6398913b222db09a0`.
Its inventory is `source-inputs-json-objects.json` and the active source-input
map. Corrected default-Dockerfile builds are live: arm64 client session 35000 and
amd64 14922. Their `*-json-objects-build.log` files are active build logs, not
export acceptance. Native inputs remain frozen while these builds run.
The former BuildKit daemon was confirmed absent with connection-refused RPC and
no process; it is restarted once in private mount/PID/IPC/UTS namespaces on the
same retained cache. Daemon session 56766/PID 8484 answers worker RPC. Explicit
BuildKit QEMU is active for ARM; host binfmt is unchanged. Each image uses the
existing two-job release build, one Cargo target, no debug/incremental artifacts
and an empty public-registry auth configuration. Approximately 804 GiB is free.

Both previous b4 candidates are checksum-checked before being retained under
`kelryvo-b4-{amd64,arm64}.oci.tar`, `b4-{amd64,arm64}-layout`, and
`.cache/buildkit-overlay.b4-{amd64,arm64}/rootfs`; their independent reports now
have `-b4-` names. The current output paths are reserved for the replacement,
which is not exported or qualified yet. Keep the b4 evidence/artifacts until a
matching corrected candidate passes. Remaining final-artifact and Oracle scope
must be established on the corrected bytes; earlier results retain their own
identities. RUST3–RUST6 and the goal remain open. Supplied credentials and their
endpoint remain untouched; no deployment, publication, external infrastructure
change, push, merge or approval/CI bypass occurs.

**Corrected artifact verification and reusable Oracle fixture — 2026-11-12:**
the corrected amd64 build exits 0. Its 152,603,136-byte OCI archive has SHA-256
`ada529e5a0aed3736eb07ae7b02578884ab54060b0ad61ddec2cde2fa646661b`,
manifest `sha256:d896f37f6178b875ba7d1ab3f2900fc70a924759e5ecd9d5ae3e035a568a8de0`
and config `sha256:e162779e1d82082b66d9a7b920d809b1b30dfff2937cf770eef56d436125058c`.
Independent verification passes all seven OCI blobs/diff IDs, the 319 current
native source inputs, and the 119-package runtime inventory/notices. The source
digest remains `75514880efd77345aa4efae86460fa37e933562a90bedcc6398913b222db09a0`.
The exact exported filesystem passes the native five-binary identity, read-only
root, empty network, role UID/capability and missing protected-mount contract.
Packaged Rust/WASM reconciliation checks pass. The actual release server and its
packaged UI pass all nine IPv4/IPv6 HTTPS quota comparisons with zero differences
and no metadata rows created. Its PostgreSQL and image-contract copies are
stopped/removed; no additional host Cargo build is needed. Evidence is
`amd64-independent-verification.json`, `amd64-final-quota.json`, and the
`amd64-json-objects-{build,root,reconciliation,quota}.log` files in
`.cache/native-image-build/`. This does not inherit Docker or Oracle acceptance
from a different source identity. The corrected arm64 build remains live.

The versioned installed-Oracle runner now supports only its explicit synthetic
KRV_APP/KRV_ACK schema allowlist. The ACK monitor additionally requires the exact
approved stream's derived target ID and constrains its FILE_STARTED/FILE_APPLIED
join to that target, preventing a same-named migration on another stream from
serving as fault evidence. Eleven bounded proxy/network/schema-scope tests pass.
No product admission, approval, receipt or recovery guard changes here.

`scripts/rust-installed-oracle-fixture.py` and its read-only witness helper now
reproduce the local fixture from one checked amd64 root, the pinned public Oracle
Free image and the retained official client ZIP. The fixture accepts no external
endpoint and confines database activity to private network/PID/mount/IPC/UTS
namespaces. Its separate schema streams preserve the first HOLD while checking
fully receipted recovery and an actual committed-response fault independently.
This harness is being exercised; its presence is not a passing Oracle result.
The initial launch rejects an obsolete Node path before download/database work.
A second pre-boot launch exposes a Python Path ownership API mistake; it is
corrected before Oracle starts. The single verified vendor download is reused
only after confirming no Oracle process log or PostgreSQL exists. The explicit
--prepared guard refuses any fixture in which Oracle has already started.
Fixture session 81216 then fails before master creation/native provisioning:
the vendor listener configuration is an absolute symlink inside its chroot, so
the host-side write follows an unavailable host path. This is a harness failure,
not product acceptance. PostgreSQL stops and the isolated namespace exits; clean
Oracle shutdown is not recorded. The bounded result is
`amd64-final-oracle-bootstrap-failure.json`. There are no approved jobs and no
native provisioning attempt to resume. After inspection the exact stopped
fixture is removed, and the harness writes the known private dbconfig backing
directory. Session 26424 verifies TCPS identity, then exposes a second harness
failure before an API session or provisioning: copying the local BuildKit
destination preserves its private 0700 export-container mode as the chroot root.
UID 10001/10002 cannot traverse it. The fixture driver now uses 0755 for its
chroot / directory; this does not alter packaged file contents. The result is
`amd64-final-oracle-runtime-bootstrap-failure.json`: PostgreSQL stops, Oracle
exceeds its 150-second graceful allowance and the isolated namespace is disposed
with oracleCleanShutdown=false. No approved job or native provisioning exists.
The stopped failed fixture is removed. Fresh session 27642 uses
`amd64-final-oracle-fixture-3.log`; only one Oracle root/cluster exists at a time.
Private diagnostics remain under
`.cache/native-oracle-fixture/private/`. Do not restart its database or repeat
approved SQL on a timeout. The fixture will be removed after successful
evidence extraction; failed product history must be inspected and retained until
its exact scope is recorded. Supplied credentials remain untouched.

Session 27642 passes native API bootstrap/TCPS, but the private preparation input
guard refuses its request before creating an output directory or provisioning
journal. The harness incorrectly places private requests/templates beneath the
0711 public provenance parent instead of a separate 0700 directory. Its PKI tool
also leaves a zero-length cwallet.sso.lck file, which cannot be an accepted closed
wallet artifact. Two offline client diagnostics correctly refuse those inputs;
they perform no Oracle operation. The driver now keeps private inputs beneath
`/run/kelryvo/operator/private` (0700), public source identity separately (0444
under the 0711 parent), and removes only the unused empty PKI lock before sealing
the wallet inventory. An explicit CLIENT_READY_NO_DATABASE check precedes native
provisioning. Product guards are unchanged. The third stopped fixture's bounded
result is `amd64-final-oracle-input-bootstrap-failure.json`; PostgreSQL stops and
Oracle clean shutdown is false. No approved job or native provisioning journal
exists. After inspection that root is removed, and fresh session 11571 uses
`amd64-final-oracle-fixture-4.log`. The driver now retains hashes of its exact six
harness inputs with the eventual result. Final Oracle qualification remains
pending; earlier failed harness runs do not count as passing product evidence.

Session 11571 passes native HTTPS/API bootstrap and TCPS again, but its newly
required offline client check still refuses the fixture before native
provisioning. Its private input parent/mode, canonical template/review digests,
all artifact bytes/ownership/modes/link counts and the closed wallet inventory
are independently checked without finding a mismatch. PostgreSQL stops and the
namespace exits; oracleCleanShutdown remains false. Keep this stopped fixture
for offline diagnosis instead of creating another Oracle database. Two
non-secret fixture JSON inputs are retained under its private/offline-inputs;
they confer no authority and no approved job has been created. The next
diagnostic builds only the worker library in the same warm host Cargo target,
with two jobs/debug=0/incremental=0, to distinguish typed config validation from
artifact/client loading. No installed worker guard is relaxed and no DDL is
resumed. Corrected arm64 export remains pending in its original live build.

The offline diagnosis resolves the fourth launch: CLIENT_READY_NO_DATABASE was
called before the mandatory witness directory was initialized. Restoring the
two non-secret inputs and the complete layout in an empty network/PID/mount
namespace passes typed Config validation, identity/canonical review digests and
the actual exported worker's loader replacement/client check. It reports OCI
23.26.4.0.0, oracleRuntimeVerified=false and executionAuthority=false; no Oracle
operation occurs. The warm worker library build takes 4.99 seconds and reuses the
same approximately 2.2 GiB target. Evidence is
`amd64-final-offline-config-result.log`, `amd64-final-offline-client.log` and
`amd64-final-oracle-offline-bootstrap-failure.json`. The required witness setup
now precedes the offline check in the versioned fixture driver. The stopped
diagnosed fixture is removed after retaining that bounded result. Fresh session
45850 runs with `amd64-final-oracle-fixture-5.log`. This is still pending full
Oracle/job qualification; no security or receipt requirement is bypassed.

Session 45850 now reaches real product behavior on the corrected amd64 image:
the offline native client check passes, all 48 scoped two-schema provisioning
steps complete with no pending journal stage, and native catalog preflight,
read-only password-preserving refresh, publication and observer acceptance pass.
The installed runtime's HTTPS sessions and native TCPS discovery/verification
pass. Independent API approval drives the installed worker to VERIFIED_SUCCESS
for the table/index release with two central receipts, then a fresh independently
approved NOOP dispatches no SQL and creates no receipt. Preparation-only evidence
is `amd64-final-oracle-prepared-check.json`. Fully receipted HOLD recovery and the
separate target-scoped committed-response fault remain in progress; do not claim
their acceptance from this intermediate success or shorten their original lease.

While that original lease elapses, one authenticated HTTPS request to the actual
exported API independently verifies the named-object correction: positional
POST /api/projects returns exactly 400 INVALID_REQUEST. Full row fingerprints of
projects, audit, jobs, attempts, receipts and project grants remain unchanged.
The same live local fixture is reused; no additional database, session, approval,
job or Oracle operation is created. The result is
`amd64-final-json-object-live.json`, bound to the corrected source digest.

The actual installed roles are independently inspected during the held lease:
runtime is namespace PID 1/UID 0 with only CAP_KILL effective/permitted, API is
UID 10001 and worker is UID 10002 with zero effective/permitted capabilities.
All have no-new-privileges enabled. Evidence is
`amd64-final-runtime-roles.json`; this is the live local installed namespace,
not a Docker Engine or native ARM acceptance claim.

The corrected artifact's fully receipted recovery now passes after the complete
original 300-second lease. Native held-preview, a rejected self-review, an
independent API review and two native confirmations produce one idempotent
RECOVERED_APPLIED completion while retaining HOLD, whole attempts/receipts/lease
and dispatch bytes. The driver's independent Oracle ledger comparison also
passes unchanged. `amd64-final-positive-recovery-result.json` retains the exact
case result hash, compiled source and OCI manifest identity before beginning the
second schema. This replaces the need to infer positive recovery for this
artifact from the older 929 result. The KRV_ACK schema is now executing its
separate independently approved sequence; the first schema's HOLD is retained.
Actual lost-COMMIT-ACK acceptance and final fixture cleanup remain pending.

The second schema also passes its independent table/index execution and
zero-dispatch NOOP. Its target-scoped ACK witness now independently reads a
committed FILE_APPLIED and cuts one withheld ledger response in the proven
monotonic-clock window. `amd64-final-ack-witness.json` retains the exact monitor
report (SHA-256
`b47195f4f4bd77840352d88ef4f8cd6ce3686a9ecdd4d7ed0e86d8f33db18971`).
The monitor reports oracleCommitProven=true only with
the independent Oracle read; transport alone remains false. The missing-receipt
HOLD/expiry refusal checks and final cleanup are still pending. Do not infer
RECOVERED_APPLIED eligibility from this committed event.

The second case's complete original lease now expires and its two native
held-preview attempts both refuse the missing central receipt. Whole HOLD,
attempts/lease, receipts and dispatch bytes remain unchanged; the API retains
false retry/execution authority and no recovered completion or recovery audit.
The driver's whole Oracle ledger comparison also passes unchanged, and the first
schema's retained jobs survive the second case unchanged. The exact negative
case is retained in `amd64-final-negative-recovery-result.json`. Both current
artifact recovery branches now pass; final aggregate extraction and Oracle/
PostgreSQL/runtime cleanup are in progress. Do not substitute a clean-shutdown
claim for the eventual observed cleanup result.

The complete two-case product assertions pass, but the fifth harness exits 1
during teardown: it sends SIGTERM to unshare's waiting parent, not the actual
runtime PID 1, and times out after 30 seconds. Namespace disposal then forces
runtime/PostgreSQL/Oracle termination. This is retained as
`amd64-final-oracle-teardown-result.json` with
PRODUCT_ASSERTIONS_PASS_TEARDOWN_HARNESS_FAILURE; the original full harness is
not reported as passing or cleanly shut down. Both case results and the ACK
witness were extracted before disposal. Whole Oracle ledger comparisons pass in
the driver, but their in-memory hashes are not extracted by this failed teardown.

The versioned fixture now selects only the Popen-owned wrapper's exact runtime
child, checking its root, parent PID, namespace PID 1, UID 0 and no-new-privileges
before signaling it. It also persists product-result.json before teardown so a
vendor/wrapper failure cannot erase assertions or encourage job replay. A
targeted integration verifies the fix without rerunning approved SQL: the same
synthetic PostgreSQL is crash-recovered in a new unreachable namespace, retaining
six jobs, two HOLDs and exactly one recovered audit. The current artifact starts
HTTPS with execution/discovery disabled and no Oracle process/installation.
The corrected helper sends SIGTERM to the actual PID 1, all application roles
exit and the wrapper exits 0. Seven whole metadata-table fingerprints, including
credentials, remain unchanged; replacement startup token files issue no new
credential. PostgreSQL then stops normally. Evidence is
`amd64-final-runtime-cleanup-check.json/.log`, bound to fixture-driver SHA-256
`2f64d55d98562ecf102fee89ed0f5d2f428608a470113ba8e8c0fd8ed296a92b`.
This passing shutdown/crash-recovery scope does not retroactively make the
original Oracle fixture shutdown clean. No Oracle database or approved job is
restarted/replayed. The stopped fixture remains available only for bounded
evidence cleanup; corrected ARM export and broader release qualification remain
open.

**Exact current amd64 OCI in Docker — 2026-11-12:** Oracle's vendor root,
wallet/client copy, master/vault material and installed-image copy are removed
after evidence extraction. The one stopped 67 MiB PostgreSQL fixture is reused
for the local Docker check; no second database or Oracle instance is created.
Docker Engine 29.9.2 runs only in private mount/PID/network/IPC/UTS/cgroup
namespaces, with a private data root and empty public-registry auth. The initial
daemon attempt fails before image load because its containerd ttrpc socket path
exceeds the Unix limit. A short private /run exec root resolves that harness
issue. A subsequent container-start attempt fails before any image binary or
PostgreSQL starts because the inherited cgroup mount cannot resolve the private
PID. Fresh private sysfs/cgroup2 mounts resolve the environment mismatch;
cgroup, seccomp and application security controls are not disabled. Bounded
failure results are `amd64-final-docker-daemon-failure.json` and
`amd64-final-docker-start-environment-failure.json`.

The final Docker check exits 0 and retains the exact OCI manifest, config and
diff IDs. Five release binaries report the corrected 319-input source identity;
verify-dist and missing-protected-mount refusal pass. The read-only runtime with
no-new-privileges starts verified HTTPS against the same six-job metadata,
then receives SIGTERM through Docker and exits 0. Seven whole-table fingerprints,
including credentials, remain unchanged, retaining both HOLDs and exactly one
recovered audit. No new approval, credential or SQL execution is created; Oracle
is not started. `amd64-final-docker-check.json`,
`amd64-final-docker-image-inspect.json` and `amd64-final-docker-check-4.log`
retain this LOCAL_UNPUBLISHED_ACTUAL_DOCKER_ONLY scope. PostgreSQL stops normally
and dockerd exits 0. The entire owned Docker/metadata fixture and its TLS/token/
password files are removed after confirming no process or mount retains them.
No test database, Docker daemon or Oracle installation remains. Approximately
800 GiB is free; the one approximately 2.2 GiB Cargo target and the live private
BuildKit cache remain reusable. Corrected arm64 session 35000 continues linking;
do not restart it for quiet output. Source/hygiene/syntax checks pass after the
fixture cleanup correction. Publication and hosted CI gates remain unchanged;
local-unpublished is not a nominated source SHA or native ARM qualification.

`current-candidate-evidence.json` indexes the eleven current-source amd64
reports with their actual SHA-256 values. Its status is
AMD64_SCOPED_CHECKS_CAPTURED_ARM64_EXPORT_PENDING, not release qualification.
It keeps the original Oracle harness exit-1 teardown distinct from the passing
product cases and corrected runtime/metadata recovery check. All database,
Oracle, installed-client and private Docker state is removed; only the current
OCI/source artifacts, bounded reports, one Cargo target and active BuildKit cache
remain. The goal and RUST3–RUST6 stay open for the remaining parity audit and
matching ARM/release qualification. Do not infer hosted CI or publication from
this local candidate index.

**Required test isolation — 2026-11-12:** a bounded sequential reproduction finds
a test-runner defect: json_objects and product both seed the fixed retained
rust-developer actor/token. Each passes alone, but the shared workspace database
sequence fails product setup with PostgreSQL 23505 on sf_local_actors_pkey.
`json-objects-suite-isolation-red.json/.log` retain the exit-101 reproduction;
this is a fixture collision, not an API/Oracle defect. The stopped RED fixture is
removed only after that result is recorded.

The full runner now moves this one fresh-fixture test to a mandatory explicit
step after all shared-fixture checks/exports complete. Its original workspace
invocation filters that exact test name, then an explicit invocation runs the
unchanged test body after drop/create of only the newly created disposable test
database, using the same PostgreSQL cluster/socket. Every existing test remains
required; a failure before or after the fixture boundary still fails the driver.
No application database, retained user history, approval or CI predicate is
changed. The focused --product-and-json-objects-only path exercises that same
boundary: product passes in 106.13 seconds, followed by named-object integration
in 3.09 seconds. The full default workspace is not rerun in this bounded check.
`json-objects-suite-isolation-result.json` retains the result and runner hash;
the green log is `json-objects-suite-isolation-green.log`. Its single cluster is
stopped normally and removed. Shell/whitespace checks pass. The runner lies
outside the frozen 319 native inputs, so neither candidate is rebuilt. ARM
continues its WASM build in session 35000. The candidate index now references
twelve current-scope reports; it remains local/unpublished and incomplete.

**Current artifact state — 2026-11-12:** both corrected build clients finish
with exit 0 on the unchanged 319 native inputs/source digest
`75514880efd77345aa4efae86460fa37e933562a90bedcc6398913b222db09a0`.
Both independent verifications compare the actual current worktree and packaged
source, all seven OCI blobs/diff IDs and the 119-package runtime inventory.

- amd64: `.cache/native-image-build/kelryvo-current-amd64.oci.tar`, 152,603,136
  bytes, SHA-256 `ada529e5a0aed3736eb07ae7b02578884ab54060b0ad61ddec2cde2fa646661b`,
  manifest `sha256:d896f37f6178b875ba7d1ab3f2900fc70a924759e5ecd9d5ae3e035a568a8de0`,
  config `sha256:e162779e1d82082b66d9a7b920d809b1b30dfff2937cf770eef56d436125058c`.
  Current-source quota/named-object, installed Oracle positive/missing-receipt
  recovery, role separation, metadata crash recovery and exact Docker checks
  retain the distinct passing/failing scopes recorded above. The original Oracle
  harness teardown remains exit 1; its later corrected shutdown check passes.
- arm64: `.cache/native-image-build/kelryvo-current-arm64.oci.tar`, 151,172,608
  bytes, SHA-256 `75c7cd88b2d45247f1d03dc6c403070f8ee5c1365eb3d94fafe0405b034c69a0`,
  manifest `sha256:db7a9e6beab5097fc17143b3a0bc55a0d98a130d70af76f4029dcbe48c7235c2`,
  config `sha256:a2cb2879da1db1bfada8f8fbe529669d3548e342171bec35671b462c98c7cb83`.
  Explicit QEMU checks all five release binaries, read-only root, empty network,
  role UID/capability refusals, bundle inventory and missing protected inputs.
  Its packaged WASM recovery response fixtures also pass. Both check clients
  exit 0; the single disposable image-contract copy is removed. No native ARM
  hardware, ARM Docker/Oracle or hosted CI acceptance is claimed.

The matching current exported roots remain at
`.cache/buildkit-overlay.current-amd64/rootfs` and
`.cache/buildkit-overlay.current-arm64/rootfs`. The active source map and
`source-inputs-json-objects.json` remain available. The candidate index now has
fourteen checksummed reports and status
BOTH_ARCHIVES_VERIFIED_WITH_SCOPED_LOCAL_CHECKS; its SHA-256 is
`0d48dc8b38a0a606edc823c3f19908aa5ed4ae587c974656e15a29fdce65495a`.
It explicitly records the Oracle teardown failure and corrected-check scope;
releaseQualified remains false.

After verifying both replacements, the owned b4 archives, exported roots and
extracted OCI layouts are checksum/identity-checked and removed. Their bounded
historical reports/source hash map remain; their old artifact paths are no
longer usable. `b4-artifact-cleanup-result.json` records the six removed entries.
The idle private BuildKit daemon is identified by its exact cache-root command
and stopped with SIGTERM; its wrapper reports exit 1 during requested shutdown,
separately from the two successful build clients. No builder, Docker daemon,
Oracle, test database or disposable image-contract copy remains active. One
31 GiB BuildKit cache and one approximately 2.2 GiB Cargo target remain reusable;
approximately 800 GiB is free. All uncommitted/untracked source is retained.

Source checks (535 authored files), repository hygiene, fixture/shell syntax,
JSON formatting, checklist validation and whitespace checks pass. No supplied
credential contents or endpoint is accessed, and no deployment, external
infrastructure change, push, merge, publication or approval/CI bypass occurs.
The goal and RUST3–RUST6 remain open for the remaining parity audit and complete
release qualification. These are identified local candidates, not a nominated
Git source or a substitute for configured hosted/native-platform gates.

**Protected HTTP parsing parity — 2026-11-12:** the next bounded comparison
confirms a current-artifact defect: an unsupported XML POST /api/projects
returns native 401 instead of retained 400. Parsing must precede authentication
even for handlers which ignore a body. The exact 75514880 amd64 binary fails the
real HTTP check (exit 1), and a new library regression fails with exit 101.
`protected-http-red-result.json`, `protected-http-red.log` and
`protected-http-unit-red.log` retain this evidence. The same empty disposable
PostgreSQL is stopped/reused for the corrected comparison, then removed; no
product schema, credential or job is created in these raw HTTP checks.

A shared input parsing middleware now runs inside the existing quota boundary
and before handler authentication. It enforces the retained JSON/plain-text
media types and request limits (1 MiB, or 2,200,000 bytes for draft create/save),
rejects malformed/empty JSON and prototype-poisoning keys at every depth, and
normalizes the retained leading-BOM/UTF-8 JSON boundary. Last-key-wins decoding
precedes prototype scanning; ordinary prototype fields and overwritten/null
constructors remain legal parser inputs. Valid bodies still reach the unchanged
authentication/CSRF/authorization path. No metadata, grant, approval, receipt,
Oracle or recovery code changes. The first compile attempt catches a request
borrow lifetime error; it is corrected before any green result is claimed.

Twenty-one library tests pass, including 80 retained HTTP comparisons across
typed project, generic decision, body-ignoring logout and larger draft routes,
plus valid/ordinary-key/plain-text/no-body controls. An additional well-formed
bearer with malformed/prototype JSON proves no metadata connection is attempted
and retains quota/security headers. The actual corrected debug binary also
passes all 80 comparisons on the empty PostgreSQL, preserving zero relations and
exiting 0; it reuses the previous packaged UI component only. Its result reports
debug/sourceTreeDigest=null separately from the 75514880 web component, rather
than claiming a new release image. Logs are `protected-http-lib-final.log` and
`protected-http-actual-green.log`. Server Clippy across all targets passes with
warnings denied. The complete existing product-plus-isolated-named-object
integration is running in session 33567 with `protected-http-product.log`.

The retained 75514880 amd64/arm64 archives and their fourteen-report evidence
index still identify their exact former source scope. They no longer match the
current modified native worktree; do not relabel them or apply their Oracle/
Docker qualification to the parsing correction. A replacement source inventory
and final image verification are pending the current checks and remaining parity
review. Keep those retained artifacts until a corrected replacement passes.

The complete product integration passes in 91.96 seconds and the isolated
named-object integration passes in 2.68 seconds. A subsequent numeric parser
control confirms that JSON containing 1e400 is syntactically accepted by the
retained boundary before authentication. The middleware now uses a borrowed
RawValue fallback for syntactically valid values outside native numeric range,
still scanning all sibling/nested prototype keys and retaining the native
128-level nesting bound. This adds only serde_json's existing raw_value feature;
no dependency version or lockfile bytes change. The initial 88-case comparison
exceeds the test's former 16 KiB aggregate-output bound; the bounded fixture
allowance becomes 32 KiB, matching the actual HTTP driver, and no assertion is
removed. The final library passes 21 tests and the actual corrected debug binary
passes all 88 HTTP comparisons with zero public metadata relations. Final server
Clippy passes across all targets with warnings denied. The product run precedes
only the final numeric fallback; its exact scope is retained rather than
reported as a rerun. Logs include `protected-http-lib-numeric-2.log`,
`protected-http-actual-final-green.log`, `protected-http-clippy-final.log` and
`protected-http-regression-result.json`. All test clusters are stopped and
removed before replacement image builds begin.

The new frozen source digest is
`92f8890540562c8cd7a30c3b4a1d3c2c92baf515d70fbe83dc9df0cad79e7fcf`,
with the same 319 inputs. Only kelryvo-server/Cargo.toml, src/input_json.rs and
src/lib.rs differ from 75514880. `source-inputs-protected-http.json` and the
active map capture their exact bytes/modes. Both previous candidates are
checksum-checked and retained as `kelryvo-75514880-{amd64,arm64}.oci.tar`,
`{arch}-75514880-independent-verification.json`, and
`.cache/buildkit-overlay.75514880-{arch}/rootfs`; former extracted layouts have
75514880 names as well. Their original evidence index is preserved byte-for-byte
as `source-75514880-evidence-before-retention.json`, retaining SHA-256
`0d48dc8b38a0a606edc823c3f19908aa5ed4ae587c974656e15a29fdce65495a`.
The mutable candidate index explicitly marks its current-worktree mismatch.

Default-Dockerfile replacement builds now run on the same retained cache:
arm64 session 1284 and amd64 84404, with `*-protected-http-build.log` outputs.
Daemon session 99703/PID 100491 answers worker RPC from its private mount/PID/
IPC/UTS namespaces. The original 31 GiB cache, two-job release profile, no debug/
incremental artifacts, explicit QEMU and empty public-registry auth are reused;
no host binfmt or external infrastructure changes. Approximately 800 GiB is
free before launch. Native inputs stay frozen; quiet ARM output is not grounds
to restart. These live builds are not yet exported/qualified. A focused actual
HTTPS/Rust-WASM password check reuses the corrected debug API and unchanged
packaged UI while the builds run; it has its own single disposable cluster and
does not qualify the replacement release artifact. No supplied credential or
endpoint is touched. The goal and RUST3–RUST6 remain open.

The focused current-debug API/unchanged packaged Rust-WASM password flow now
passes real HTTPS, invalid/current-password/CSRF/HOLD refusals, one password audit,
retirement of prior browser/password sessions, unchanged LOCAL anchor and retained
verifier interoperability. Its private API/TLS/PostgreSQL fixture is stopped and
removed; `protected-http-password.log` and the regression result retain its
component-limited scope. The retained 75514880 evidence index has its two renamed
verification-report references updated in `source-75514880-evidence.json`, whose
SHA-256 is `d31c07c6c5b69e697202992c687dd217c3212b2f221eb5bb0b55ec74374758a5`.
All fourteen referenced report hashes are checked after renaming; the original
byte-for-byte index remains separately available under its before-retention name.

**HTTP-boundary replacement artifact — 2026-11-12:** the new amd64 build exits
0. Its 152,614,400-byte OCI archive has SHA-256
`26bc61fbfcf8e14afac7310f9d6fecfdcb893df0411f69cf20d270d322d4a839`,
manifest `sha256:35b09285b517bf631b93d07f1db2550d7a27e0256517a672c98554c953062c9f`
and config `sha256:3c32d90095de2ceb6fb821d5ccda6939f406094c66d5f4f89854aaf282cce703`.
Independent verification passes all seven OCI blobs/diff IDs, the 319 frozen
current worktree/packaged inputs at
`92f8890540562c8cd7a30c3b4a1d3c2c92baf515d70fbe83dc9df0cad79e7fcf`
and the 119-package runtime inventory/notices. The release binary and matching
packaged UI pass all 88 protected HTTP comparisons and all nine real IPv4/IPv6
HTTPS quota scenarios, with no metadata relation created. The same empty private
cluster is reused between these two checks, then stopped and removed. Native
five-binary/read-only-root/empty-network/UID-capability/bundle/refusal checks and
packaged WASM recovery response fixtures also pass; their disposable root copy
is removed. Evidence is `amd64-independent-verification.json`,
`amd64-92f88905-local-checks.json`, `amd64-92f88905-quota.json` and their
`amd64-92f88905-{http,quota,root,reconciliation}.log` files.

The versioned isolated Oracle fixture is now running against these exact bytes
in session 42305, with `amd64-92f88905-oracle-fixture.log`. It rechecks the current
archive/source identity before making one fresh vendor root/cluster; no earlier
HOLD, installation or approved SQL is resumed. Its root is
`.cache/native-oracle-fixture`, private diagnostics stay in private/, and its
aggregate output path `amd64-final-oracle-result.json` was confirmed unused.
The corrected owned-PID-1 cleanup and product-before-teardown persistence are in
the exact versioned driver. Oracle/recovery acceptance is still pending this
run, and arm64 session 1284 continues compiling on the same cache. Approximately
797 GiB is free and 7.6 GiB memory is available before the fresh Oracle fixture.
The retained 75514880 reports/artifacts keep their own scope. No supplied secret,
external endpoint/infrastructure, deployment, push, merge or CI gate is touched.

The fresh 92f88905 fixture now passes all native preparation/publication/observer
stages, independent API approval, table/index VERIFIED_SUCCESS and zero-dispatch
NOOP. Fully receipted HOLD recovery passes after the unchanged original
300-second lease: self-review refuses, independent review succeeds, and two
native confirmations produce idempotent RECOVERED_APPLIED while preserving
whole HOLD/attempt/receipt/lease and dispatch snapshots. The independent Oracle
ledger comparison remains unchanged. The exact case is retained as
`amd64-92f88905-positive-recovery.json`; its compiled source and manifest are the
new candidate, not the earlier 75514880. The second schema passes its own
execution/NOOP and is running the target-scoped ACK fault. Its missing-receipt
HOLD/expiry refusal, aggregate product report and final cleanup remain pending.
The live candidate index now describes 92f88905 and references the separate
retained 75514880 index explicitly; it does not combine their qualification.

**Decoded UTF-8 body limit — 2026-11-12:** a raw-byte boundary probe confirms
another defect in the 92f88905 HTTP middleware. A 400,002-byte JSON string with
invalid UTF-8 replacement sequences decodes to 1,200,002 UTF-8 bytes. Retained
Fastify rejects it with 413 REQUEST_TOO_LARGE before authentication/metadata;
the actual 92f88905 HTTPS API returns 401 on the body-ignoring logout route.
`decoded-utf8-limit-red.json` records the current artifact's exact response,
source identity and absence of supplied credentials/Oracle operations. This is
a confirmed retained body-boundary mismatch, so 92f88905 cannot be nominated as
the final replacement despite its earlier narrower passing checks.

The middleware now checks decoded UTF-8 byte length before authentication for
both supported JSON and plain-text bodies, retaining the raw-byte limit too.
Eight additional wire cases cover both media types at the normal and larger
draft limits. All 21 library tests pass with 96 protected HTTP comparisons;
the relevant log is `decoded-utf8-limit-lib-green.log`. No credential, approval,
Oracle/recovery or business-handler code changes. A corrected debug server build
and all-server-target Clippy are running in session 17384. Actual corrected-wire
and replacement-image checks remain pending; no new source digest is nominated
yet. The old active source map continues to identify the tested 92f88905 bytes.

The exact ARM build client for 92f88905 is identified by its platform/output
arguments and cancelled with SIGINT. Session 1284 exits 1 with CANCELED/context
canceled; it has no accepted ARM export. The cancellation is caused by this
confirmed source defect, not a quiet log, timeout or restart policy. Its log is
retained and BuildKit's one cache remains available. The already approved
92f88905 Oracle fixture continues unchanged: its positive recovery has passed,
and its second case independently proves committed FILE_APPLIED plus one
withheld-response cut. `amd64-92f88905-ack-witness.json` retains that proof with
SHA-256 `dbdea0eb603c25a15dd033b46d5615d24b860ee65ef0c7e1d3f468644b75ba7b`.
Missing-receipt HOLD/expiry refusal and aggregate teardown remain pending in
session 42305. Completing this retained candidate's test preserves approved
history; it cannot qualify the later guard correction. Do not restart or replay
its jobs to obtain a different result. The goal and RUST3–RUST6 remain open.

The 92f88905 Oracle run then completes both cases and its aggregate is persisted
before teardown. Both independent whole-ledger retention comparisons pass; the
final ledger has 26 events/two heads, SHA-256
`5fb1292776a2504b19dbe700ea0d97add9beaeee7d26637f7a8ce19d98a5a0aa`.
The corrected owned-PID-1 signal path stops runtime cleanly and PostgreSQL stops
normally. Oracle's vendor shutdown exceeds its graceful allowance and requires
private namespace disposal: oracleCleanShutdown=false is retained, not reported
as a clean Oracle shutdown. The parent exits 0 and removes the private databases,
keys, wallet, installed client copy and vendor root. The aggregate is retained as
`amd64-92f88905-oracle-result.json`, SHA-256
`efbec3b7502422ff7f731588add28506a2850fd04b735b3547b733557b38ff7d`;
`amd64-92f88905-oracle-product.json` separately retains pre-teardown assertions.
The fixture driver now derives source-qualified output filenames and refuses
an existing result before boot, preventing an ambiguous overwrite/late failure.
That small output-path change passes syntax and naming checks; its next full run
remains bound to its newly captured harness hashes. This does not qualify the
later decoded-limit/public-auth source or erase the 92f88905 body-limit defect.

**Public auth transport/shape parity — 2026-11-12:** the final pre-build wire
audit expands the retained login/setup comparison from 14 to 46 cases, including
missing/plain-text/empty/large-number/string/XML/prototype/malformed inputs over
both transport modes and exact quota-limit headers. It reproduces 14 status,
error-code or quota-header differences (exit 101 in `public-auth-wire-red.log`).
The parser now retains only a private typed body-truthiness discriminator for
the session quota. Login still rejects unsupported shapes, but applies its
retained preHandler quota and transport/origin checks in order. Setup captures
semantic extraction refusals so HTTPS/origin checks precede INVALID_PASSWORD_SETUP.
Syntax/media/size/prototype failures remain at the shared parser boundary. The
credential verifier, CSRF, metadata/anchor/grant checks and issuance logic are
unchanged; no malformed shape is treated as a valid password/token request.

All 21 library tests pass with the 96 body and 46 auth comparisons. The new
--public-auth-only actual-binary driver uses verified HTTPS, plain HTTP and real
distinct loopback peers to match the reference's fresh quotas without disabling
or trusting proxy headers. All 46 responses/status/quota limits match, no cookie
is issued and no public metadata relation is created. The same private cluster
is then reused sequentially for the current 96-case HTTP check, full existing
product integration (92.41 seconds), isolated named-object integration
(2.69 seconds) and actual HTTPS/Rust-WASM password change. All pass. Database
resets affect only that freshly created private cluster, after each completed
phase; the entire stopped cluster and private TLS/application files are removed.
Current debug API and the unchanged 92f88905 packaged UI are named separately.
Server Clippy across all targets passes with warnings denied. Logs/results are
`public-auth-wire-{lib-green,actual-green,functional,clippy}.log` and
`public-auth-wire-regression-result.json`. Source checks (536 authored files),
repository hygiene, Rust/shell/Python/JS syntax/format, checklist and whitespace
checks pass. No additional broad/browser suite or external service is run.

The new frozen source is
`2185932c838af5e4bc93808bde1f823166d7a277c7f8e868c85c902d14f49356`,
with 319 native inputs captured in `source-inputs-public-auth.json` and the
active map. Only auth.rs, input_json.rs, lib.rs and rate_limit/tests.rs differ
from 92f88905. The intermediate decoded-only map/result remains an explicitly
earlier component checkpoint, not an image or the final auth source. The old
amd64 candidate is checksum-checked and retained as
`kelryvo-92f88905-amd64.oci.tar`,
`amd64-92f88905-independent-verification.json` and
`.cache/buildkit-overlay.92f88905-amd64/rootfs`, with a source-qualified extracted
layout. `source-92f88905-evidence.json` retains its known defect and separate
Oracle/HTTP scopes, SHA-256
`af59c228eed17a0051a7d436c3f3e628ffe441d4e33f096bce89544c767cc6e3`.
The older 75514880 candidates/index remain separate and retained.

New default-Dockerfile builds run on the same cache/daemon: arm64 83523 and
amd64 24378 with `*-public-auth-build.log`. Daemon PID 100491/session 99703 is
still live and answers RPC; no restart occurs. A pre-launch absence assertion
encounters the cancelled exporter's zero-byte tar placeholder. This is not an
accepted artifact: both current output files are explicitly observed at zero
bytes while the new clients compile. Require successful terminal exports and
independent current-source/blob checks before any acceptance. The source stays
frozen, one host Cargo target and the existing two-job/no-debug/no-incremental
release settings are reused, and approximately 797 GiB is free. No test database,
Oracle or temporary browser/application fixture remains. New image/Oracle
qualification, remaining parity and release gates stay open; no supplied
credentials, deployment, external infrastructure, push/merge/publication or
approval/CI predicate is touched.

**Frozen-source AMD64 export — 2026-11-12:** build 24378 exits 0. The new
152,636,928-byte archive has SHA-256
`3cae1a5670df3da183b56c0a46629c1c89d8360497011075a6a79b38316ac599`,
manifest `sha256:4ebdc86c33ababa10d12ab33f1db3476e5cf5e61de2879aee93a416a96cbb3e4`
and config `sha256:dfc52e3ebe9f69833cc7381c707a3a6d1c6d8a141357a8bb7f651d40bae01bee`.
Independent verification recomputes all seven blobs/diff IDs, all 319 source
members/bytes/modes against the current worktree and all 119 runtime package
notices. `amd64-2185932c-independent-verification.json` retains the result;
current archive/root paths now contain this real export. Local qualification
runner 21102 checks the exact release and packaged WASM, using one private empty
PostgreSQL cluster sequentially for body/auth/quota. ARM64 build 83523 continues.
The matching Oracle fixture is not started until the smaller checks finish and
their temporary root/database are removed. No native source change or extra
build target is introduced. Both images remain local/unpublished; native ARM CI,
complete parser/API parity and release gates retain their separate open scopes.

The exact 2185932c AMD64 release checks finish with exit 0 in session 21102.
All 96 actual body cases, 46 actual HTTP/HTTPS auth cases and nine actual IPv4/
IPv6 quota scenarios match the retained contract. All five release binaries,
read-only root, UID/capability refusals, bundle inventory and packaged WASM
reconciliation refusals pass. The single private empty PostgreSQL cluster and
root-contract copy are stopped/removed before the next fixture. The result is
`amd64-2185932c-local-checks.json`; no debug/earlier web artifact is substituted.
With approximately 793 GiB disk free and 8.5 GiB available memory, session 32712
starts one fresh pinned local Oracle fixture against this exact AMD64 export.
Only this synthetic fixture permits installation DDL; the supplied sensitive
credential file and external endpoint remain untouched. Current-source Oracle
acceptance is pending until both cases, teardown and result extraction finish.

**Oracle preboot harness correction — 2026-11-12:** session 32712 exits 1
before the vendor entrypoint can execute: the caller's umask 077 makes the
unpacked chroot root 0700, so UID 54321 cannot run /bin/bash. The Oracle log is
zero bytes, no PostgreSQL directory exists, and no installation DDL, product job
or replay occurs. A real UID-54321 /bin/true check reproduces PermissionError
before correcting that root to 0755 and passes afterward. The stopped owned
fixture has no remaining process/mount and is removed. The driver now uses
umask 022 for traversable public fixture roots, retaining explicit 0700/0600
secret modes. This changes only the host test harness, not frozen image inputs.
`amd64-2185932c-oracle-preboot-failure.json` records the cause, refusal/control,
zero-start scope and corrected driver hash. Fresh session 90268 uses
`amd64-2185932c-oracle-fixture-v2.log`; its newly captured harness hashes qualify
only its own eventual result. It does not resume a database or replay any job.

Session 90268 then stops during the public vendor download with connection
reset by peer, still before unpack/start/DDL or any product job. The owned partial
download is removed; `amd64-2185932c-oracle-download-failure.json` records this
network failure separately from product behavior. The driver now permits three
bounded attempts only for the pinned public content-addressed download, reusing
partial blobs within that one destination. Oracle/metadata commands and product
jobs retain zero automatic retries. Fresh session 89292 uses
`amd64-2185932c-oracle-fixture-v3.log` and captures the final driver hash before
any database start. Syntax and whitespace checks pass; native image inputs remain
frozen. Its KRV_APP case then passes: independently approved TABLE/INDEX,
zero-dispatch NOOP and fully receipted HOLD recovery with independent review,
retained immutable job/attempt/receipt/dispatch/ledger state and one recovery
audit. `amd64-2185932c-positive-recovery.json` retains the case, SHA-256
`59ecba18df9fa988a78ad7411edb0a3d846b60ce6ad5607d1545b55d72a8f2ed`.
The KRV_ACK stream then proves an actual committed event with a withheld
response, retained in `amd64-2185932c-ack-witness.json`, SHA-256
`edf1a59a46ae0cb7811b9a4a4adb0e6ce48ba15cd9f961c90cf6f5e0021bacf6`.
Its original-lease expiry/missing-receipt refusal then passes, including
unchanged HOLD/central history/dispatch/whole ledger and no recovery authority
or replay. Both product cases and ledger-retention assertions are persisted in
`amd64-2185932c-oracle-product.json`, SHA-256
`0cec40e2b41ebbff2b2710bb6a6a81f6688a55ac9e2af4af6563ac324ae17a1d`.
Aggregate teardown remains pending. No existing held job is restarted or replayed.

**Frozen-source installed Oracle result — 2026-11-12:** session 89292 exits
0. `amd64-2185932c-oracle-result.json` retains both cases and teardown, SHA-256
`242fe9ca865621c827602c052722a6b528b4e20395a32577ab137381b165e213`.
The first stream's jobs remain unchanged after the second; both independent
whole-ledger retention comparisons pass. The final ledger has 26 events/two
heads, SHA-256 `90b3699f7b36a2ccb84484c08c4b85d557e9f57bf11b88e835c4fc26702a2045`.
The exact-source ACK witness also matches the tested manifest. Runtime stops
cleanly and PostgreSQL stops normally. Oracle vendor shutdown exceeds its
allowance and uses private namespace disposal; oracleCleanShutdown=false remains
explicit. The driver removes all private databases, wallet, keys, client copy
and vendor root. This qualifies the recorded disposable installed AMD64 flow,
not production DR or native ARM/hosted CI.

After that completed run, the host fixture write helper is tightened to create
files exclusively with their requested mode before writing under umask 022.
Checks pass 0600 secret/0444 read-only modes, refusal of existing files/symlinks,
unchanged original bytes and temporary-fixture cleanup. The component result is
`amd64-2185932c-fixture-write-modes.json`. No Oracle command/job is rerun and no
native input changes. The aggregate retains its original six captured harness
hashes; this post-run helper change has a separate hash/scope and is not silently
substituted into that Oracle proof. Reverting only this write-helper change
reconstructs the exact captured pre-run driver hash; the five other harness
inputs still match. No source snapshot is needed to establish this delta.
ARM64 build 83523 finishes bootstrap CLI release in 35m03s and is compiling the
distribution/server/runtime dependencies. Its current tar remains a zero-byte
placeholder until successful export. After terminal exit 0, run the independent
verifier against the current ARM64 root, then the prepared ignored local runner
`.cache/native-image-build/check-current-arm64.py` for the explicit-QEMU root
contract and web byte comparison/reconciliation. It creates no database and
removes its one temporary root after success. Do not restart this active build
or rerun the completed Oracle jobs. All current evidence hashes and 319 frozen
worktree inputs are checked again; no private DB/Oracle/root-contract fixture
remains and approximately 793 GiB is free. Source checks (536 authored files),
repository hygiene, checklist validation and whitespace checks pass. All new
artifacts remain local/unpublished and RUST3–RUST6 retain the boundaries above.

**Routing fallback parity — 2026-11-12:** a bounded retained-app comparison
shows default unknown-method/path responses differ from registered API errors:
JSON 404 or the root parser's FST_ERR_CTP_* JSON refusals, with no API quota or
metadata query. The first 30-case matrix reproduces actual 218 AMD64 DELETE
/api/projects 405 versus 404 (exit 1); a native unit regression also fails with
exit 101. The stopped private PostgreSQL fixture is removed. Evidence is
`amd64-2185932c-routing-{red.log,defect.json}` and `routing-unit-red.log`.

The working implementation adds the root fallback envelope/parser, including
QUERY prerequisites, normal raw/decoded JSON/plain-text bounds, and keeps static
file serving and outer security headers. API parser/quota layers stay on known
paths, with method fallback installed afterward to avoid consuming their quotas.
Typed authentication, membership, independent approval, audit, credentials,
worker dispatch and HOLD/replay logic are unchanged. Route-inventory controls
now require the real registered quota scope (or explicit liveness exception),
so a path match with an unsupported method cannot falsely prove coverage.
The final 39-case unit matrix includes plain text plus raw/decoded root limits.
All 22 library tests pass. Initial actual 36-case fallback, 96-case body, 46-case
HTTP/HTTPS auth and nine real-peer quota checks pass against current debug code
and the separately named retained 218 packaged UI. Full product and fresh
named-object integrations pass in 107.85/3.08 seconds. One private cluster is
reused sequentially and removed. The last fallback text-limit change has unit
proof; its final actual HTTP smoke remains pending. Server all-target Clippy
passes with warnings denied, 19 relevant container static tests pass, source
checks cover 537 authored files and hygiene/whitespace checks pass. Logs use
`routing-{lib-green-final,actual-green,protected-green,public-auth-green,
quota-green,product-green,json-objects-green,clippy,container-static}.log`.
These are working-source/component checks, not a newly built release/Oracle claim.

To avoid rebuilding all dependencies after this confirmed defect, the existing
native-build graph exports only its completed Cargo target. AMD64 export 47808
is a cache hit, import 54820 exits 0 and verifies the target CLI still reports
source 218. Registry export 85837/import 12322 also exit 0. Empty-destination
checks protect cache initialization; both local seeds are removed. Result
`routing-cache-migration.json` explicitly asserts no runtime qualification.
The Dockerfile now uses target cache ID kelryvo-native-${TARGETARCH}-rust-1.99.1
and one serialized shared registry cache kelryvo-registry-rust-1.99.1, preserving
the same target path/two-job/no-debug/no-incremental build settings. No CI or
publication predicate changes. ARM export 63670 joins the same running native
compilation as 83523 (matching elapsed compiler log lines and one cargo parent),
so no duplicate ARM compiler is started. Its eventual owned seed must be imported
through the empty-cache-only `.cache/native-image-build/cargo-cache-import.Dockerfile`
(target-seed, platform linux/arm64, named local context cargo_seed), then removed.
Native source has advanced for this confirmed defect while those old BuildKit
input snapshots remain immutable source 218; the old map stays retained until
new freeze. Do not compare that old export to the changed worktree or qualify it
as the new source. New matching artifacts and installed Oracle/recovery proof
remain required; no supplied credentials/external endpoint/DDL is touched.

**Frozen routing replacement builds — 2026-11-12:** the final 39-case actual
HTTP fallback smoke exits 0 (`routing-actual-green-final.log`) and its stopped
private PostgreSQL cluster is removed. The frozen source is
`5905f163cb301734971da14c5c346a8c11b56431b4f9aea48d7ec4cdff44c01a`,
319 inputs in `source-inputs-routing.json` and the active map. Its only native
changes from 218 are Dockerfile, server input_json.rs/lib.rs and route-inventory
test support. `routing-regression-result.json` captures component scope/log hashes
and distinguishes current debug API from retained 218 web bytes. No Oracle run
is transferred to this new source.

Old ARM build/export handles are gone and authoritative logs show completed
OCI/local exports. Independent verification checks its seven blobs/diff IDs,
119 package notices and all 319 source inputs against the verified AMD64
packaged source, because current worktree has advanced. Its 151,204,864-byte
archive SHA-256 is `9da63c48839d46f534a218f1ac5f68e21e586cb982dbe2b3b9d4a351de56a12e`,
manifest `sha256:d0e43a863b321cea9c56fa4a022b82315bc1d4e095477afec07d753cdd1a009c`,
config `sha256:3170d252bf230e73e5d4e4cc738892d5c12b8b809fff61edc966eaaae7794265`.
Both old archives are retained as `kelryvo-2185932c-{amd64,arm64}.oci.tar`, roots
as `.cache/buildkit-overlay.2185932c-{amd64,arm64}/rootfs`, verification reports
as `{arch}-2185932c-independent-verification.json`. The immutable scoped index
`source-2185932c-evidence.json` has SHA-256
`3bb034d710c9453063a82673da52d215406a8a6cfb9fbc6ee3491e45fa7e07c6`.
They remain local/unpublished with the confirmed routing defect; no optional
old-ARM runtime suite is added before preparing the corrected artifact.

ARM target cache import 62989 exits 0 through its empty-destination guard and
that one temporary seed is removed. The completed cache migration has a separate
`routing-cache-migration-complete.json`, retaining the earlier indexed report
unchanged. New default-recipe builds start with the same private BuildKit daemon,
AMD64 90476 (`amd64-routing-build.log`) and ARM64 22523
(`arm64-routing-build.log`). Each wrapper persists an explicit .exit file for
terminal evidence across lost tool handles. AMD64 immediately reuses dependencies
and compiles only native workspace crates; ARM waits for the locked shared
registry. Both platform targets retain the same path and two-job/no-debug/
no-incremental settings. Approximately 779 GiB is free, no duplicate seed or
private DB/Oracle fixture remains, and no new export is accepted before successful
exit/independent verification. The current artifact runners are updated for
5905f163, including all 39 fallback cases on the same empty private cluster.
Source remains frozen until those exact artifacts and installed Oracle recovery
are checked. No CI predicate, nomination, external service or publication changes.

**Canonical source manifest and AMD64 export — 2026-11-12:** build 90476
exits 0, but the first independent verifier rejects the local map digest. No
artifact/runtime test is accepted on that refusal; the attempted local runner
cannot find a successful verification report and exits. All 319 packaged file
bytes already match. A tiny cached builder-side proof confirms every input's
hash/size/mode, with no native recompilation. The cause is local Python Path
component ordering, which differs from Rust BTreeMap full-relative-string order.
Sorting the exact same entries by full string yields
`0d6d12382f25814a0191b33065ed41cb2dffcfe2daa03f0831128b0bde3587ef`,
matching the compiled/package identity. The earlier local 5905f163 number is the
misordered verifier map hash, not a different native source or accepted artifact.
No native file, gate or verifier predicate is changed to resolve this mismatch.
The original map remains in source-inputs-routing.json; corrected canonical map
is source-inputs-routing-canonical.json and the active map. Evidence
`routing-manifest-order-correction.json` and a separately named canonical
component report retain this correction without overwriting earlier evidence.

The unchanged independent verifier now passes all seven blobs/diff IDs, 319
current-worktree/source entries and 119 package notices. AMD64 archive has
152,650,240 bytes, SHA-256
`9d1469552e18330fcee128285cb20e9ffc5eb7952e6c50b359e21be2b83d6802`,
manifest `sha256:2f53b7638541c0920e3ca1ddadf192cae1d917ef6071267553bbf4a5bd03d38b`,
config `sha256:b9c90f20cb6683ddf9f76f79a7d8aa804430f1d75763dc0d9e8e77ae7c1fe9eb`.
Source-qualified verification is amd64-0d6d1238-independent-verification.json.
Exact release checks run in 48464, including 39 routing cases and the existing
body/auth/quota/root/WASM checks, reusing one private cluster and removing it
before Oracle. The frozen native source remains unchanged; the existing ARM64
build 22523 continues and must match the canonical digest. No duplicate build,
publication, external endpoint or approval/CI bypass occurs.

The exact canonical-source AMD64 release checks exit 0 in 48464. All 39
routing cases, 96 body cases, 46 HTTP/HTTPS auth cases, nine actual-peer quota
scenarios, root/roles/inventory and packaged WASM reconciliation checks pass.
The single private cluster and root-contract copy are stopped/removed; report
is `amd64-0d6d1238-local-checks.json`. With approximately 777 GiB disk free and
7.8 GiB available memory, installed Oracle fixture 74680 starts against this
exact verified export (`amd64-0d6d1238-oracle-fixture.log`, explicit .exit file).
It captures the corrected host driver's current hashes. No Oracle result from
218 or a debug binary is transferred. Current-source Oracle qualification is
pending until both cases, teardown and extraction finish; native source remains
frozen while ARM64 builds the same inputs.

**Current exact-OCI offline Engine check — 2026-11-12:** session 23366 exits
0 against canonical-source AMD64. Docker Engine 29.9.2 in a private mount/PID/
network/IPC/UTS namespace loads the independently verified exact OCI archive;
manifest, config metadata and ordered layer diff IDs remain unchanged. All five
release binaries report the same 0d6d1238 identity, bundle integrity passes,
read-only root rejects a write, effective capabilities are zero and NoNewPrivs
is set. UID 10001/10002 cannot run the operator and runtime refuses missing
protected mounts. Containers use pull=never/network=none and no database, TLS
session or Oracle command is created by this check. It does not claim the
separate installed fixture's TLS/PID1/Oracle scope or native ARM/hosted CI.
The daemon exits 0, no containers remain, and the owned daemon image store/root
is removed. `amd64-0d6d1238-docker-offline.json` retains this narrow result.
Oracle fixture 74680 has reached independent approval/recovery on KRV_APP;
ARM64 build 22523 remains live and native source is unchanged.

The current-source KRV_APP case passes and is retained before the next
stream: independently approved execution, zero-dispatch NOOP, fully receipted
HOLD, native preview, self-review refusal, independent review and idempotent
confirmation with one recovery audit and unchanged original history/dispatch/
ledger. Report `amd64-0d6d1238-positive-recovery.json` has SHA-256
`af568210a4e803a5efbd18de7e3e3d2a7e8396f1976b3380e5c9b498e1532923`.
The separate KRV_ACK stream proves the actual Oracle commit and withheld
response on the same source/manifest, without resetting/replaying the first
stream. `amd64-0d6d1238-ack-witness.json` has SHA-256
`c4f9da6bcc8bffa049d310260eecded1497cda3fec9578cbb5ab8faca0819819`.
The original-lease expiry/missing-receipt refusal then passes, along with both
whole-ledger retention comparisons and unchanged first-stream jobs. Both product
cases are persisted in amd64-0d6d1238-oracle-product.json before teardown. Runtime/
Oracle shutdown and final extraction remain pending in 74680; ARM64 build 22523
continues with the same frozen native source.

**Current routing-source Oracle aggregate — 2026-11-12:** fixture 74680
exits 0; amd64-0d6d1238-oracle-fixture.exit preserves that terminal result.
`amd64-0d6d1238-oracle-result.json` has SHA-256
`ad38533bb56c95f15660da09cf6ba7cc6f40f78f346afe420c4ca24cc5b66750`.
Both KRV_APP/KRV_ACK cases pass on the independently verified current source/
manifest: execution, zero-dispatch NOOP, independently reviewed full-receipt
recovery, actual committed-response loss, missing-receipt refusal after the
original lease, preserved HOLD/attempts/receipts/dispatch/whole ledgers and no
replay. First-stream jobs remain unchanged after the separate second stream.
Both independent ledger-retention comparisons pass; the aggregate ledger has
26 events/two heads, SHA-256
`fc005eb180a54411407c1b211f7f6c17d6c78d1c608e94f0c37c9d99302ff1e4`.
Runtime stops cleanly and PostgreSQL stops normally. Oracle vendor shutdown
exceeds its allowance; oracleCleanShutdown=false explicitly records private
namespace disposal, not a production DR result. All databases, keys, wallet,
installed client copy and vendor root are removed. All six current harness
files still match their pre-run captured hashes, and all 319 current native
inputs still match the canonical map. No product or harness edit follows this
run. Docker/private-root test fixtures are also absent.

The current candidate index now binds source/component checks, exact AMD64 OCI,
39 routing/96 body/46 auth/nine quota/root/WASM release checks, offline Engine
integrity/role refusals and the full installed Oracle aggregate without crossing
source scopes. ARM64 build 22523 remains live: server optimization finishes and CLI compilation
starts at build log 1782.9 seconds, then all native release binaries finish
in 38m38s and WASM compilation starts (log 2541.9 seconds). Source stays frozen. Follow-on 86456 (.cache/native-image-build/finish-current-arm64.py)
identifies the one existing live ARM buildctl PID and waits only for its explicit
terminal marker. It starts no new compilation; after exit 0 it runs the unchanged
independent verifier with the canonical map, saves the source-qualified report
and invokes check-current-arm64.py. Logs/terminal marker are
arm64-0d6d1238-finish.log/.exit. Do not launch duplicate verification while that
follow-on is live. It uses explicit
BuildKit QEMU, no host binfmt change or database, and removes its one temporary
root. Native ARM/hosted CI, source-commit nomination and broader parity retain
their separate open boundaries. No supplied credentials, external endpoint,
deployment, push, merge or approval/publication/CI predicate is changed.

**Current packaged browser/static fallback smoke — 2026-11-12:** to cover
the changed router's static fallback as a complete user flow, the existing
focused password harness now accepts an explicit KELRYVO_RUST_DISTRIBUTION.
With that selection --password-only skips rebuilds and uses both server and
WASM from the verified release; the default debug behavior remains available.
Bundle integrity is checked before/after and binary/web identities are reported
separately. These two host test-harness changes do not change any of the 319
native image inputs or the six captured Oracle harness files.

Session 57630 exits 0 against exact release/source 0d6d1238. Chromium loads the
served static bundle and WASM, signs in through actual HTTPS, checks invalid
input/current-password/CSRF/restore-HOLD refusals, changes a password, retires
prior browser/password sessions and signs in again with grants preserved. The
LOCAL anchor is unchanged, exactly one password audit event is appended and
the retained password verifier reads the new hash. No browser page error occurs.
The one fresh private PostgreSQL fixture, browser/context, API and TLS files are
stopped/removed. `amd64-0d6d1238-password-browser.json` captures exact identities,
log/harness hashes and cleanup. No broad browser suite, second concurrent DB,
Oracle replay, dependency download or native source/build change is introduced.
ARM64 22523 and guarded follow-on 86456 remain live on the same frozen source.

**Final local pair and cleanup — 2026-11-12:** ARM64 build 22523 exits 0.
Guarded follow-on 86456 also exits 0 after independent OCI/current-worktree/
package verification and explicit-QEMU root/roles/five-binary/inventory checks.
Each platform matches all 319 canonical source inputs, seven blobs/layer diff IDs
and 119 runtime package notices. Current source is
`0d6d12382f25814a0191b33065ed41cb2dffcfe2daa03f0831128b0bde3587ef`.

| Platform | Archive bytes / SHA-256 | OCI application manifest |
| --- | --- | --- |
| AMD64 | 152,650,240 / `9d1469552e18330fcee128285cb20e9ffc5eb7952e6c50b359e21be2b83d6802` | `sha256:2f53b7638541c0920e3ca1ddadf192cae1d917ef6071267553bbf4a5bd03d38b` |
| ARM64 | 151,226,880 / `93552a4284134f418b28ac1eef6b71865018987eca5ab1bee2dbfa5eaa5d9785` | `sha256:e2c0bb0a628cd0fd0d5769e6e0c68609107278733aa4c24064a83db6d6b78d48` |

ARM64 config is sha256:406eddc7567368e29cadd31f8d74e5cb2101c5a9684ffbd3c71352d1b3193af1;
AMD64 config is sha256:b9c90f20cb6683ddf9f76f79a7d8aa804430f1d75763dc0d9e8e77ae7c1fe9eb.
Source-qualified reports are {arch}-0d6d1238-independent-verification.json and
{arch}-0d6d1238-local-checks.json. ARM has no native hardware/Oracle/Engine or
hosted-CI claim. Its app.js/app_bg.wasm differ from the AMD64 bundle; byte
reproducibility is not asserted. Direct ARM-packaged reconciliation checks pass.
A focused host Chromium check then serves the exact ARM-packaged JS/WASM with the
independently verified same-source AMD64 API. Both distributions are integrity-
verified before/after, and identities/architectures are reported separately.
Session 82763 exits 0: static loading, login, password change, CSRF/HOLD refusals,
session retirement, retained verifier, unchanged anchor and one audit pass.
arm64-0d6d1238-web-browser.json retains that scope/harness hashes. Its fresh private
cluster/browser/API/TLS fixtures are removed. The host password harness gains an
explicit same-source packaged-web override; no native or Oracle harness input
changes, and no prior result is silently requalified with the later harness.

Both current archives/roots are checksum-checked, renamed without copying to
kelryvo-0d6d1238-{amd64,arm64}.oci.tar and
.cache/buildkit-overlay.0d6d1238-{amd64,arm64}/rootfs. Host verify-dist passes
again after the rename. Previous current-path logs describe their actual test-
time paths; use the final source-qualified paths now. There are no current-path
aliases or pending builds. Final index source-0d6d1238-evidence.json has SHA-256
`5875c547d3be29a5c8f162a1ff4293579927ab95b4bb1e837699d27682ad89ec`; current-candidate-evidence.json remains the mutable pointer.

After the current pair and both web bundles pass, only the five owned superseded
75514880/92f88905/2185932c archive/root pairs are removed. Each archive SHA, root
identity/architecture, absence of mounts/live chroot users and retained report
hash is checked before removal. No repository source/uncommitted work or unrelated
cache is removed. The cleanup report records 2,586,775,552 bytes reclaimed. Old
source indexes/reports retain their exact hashes and historical scopes, but all
those old OCI/root paths are now unavailable; do not infer artifacts from them.
The idle private BuildKit PID 100491 receives SIGTERM only after both builds/
checks finish and no owned build client remains. /proc confirms it is gone;
the old tool handle is unavailable, so no daemon exit code is invented. Private
cache state is retained for reuse. Docker, Oracle, PostgreSQL, browser/API/TLS and
root-contract fixtures are all absent. Build/finish terminal markers, result
reports, source map and current source-qualified pair remain available.

Final source checks (537 authored files), repository hygiene, JSON formatting,
checklist validation, JS/shell syntax and whitespace checks pass. Both current
archive hashes/roots, all 319 native inputs and all 16 current evidence references
are rechecked after the rename/cleanup. Configured containers CI still requires
both native platform jobs before OCI assembly; it is inspected, not executed.
The local candidate is ready for review within the recorded scopes. The full
rewrite/goal remains active for its requirement-by-requirement parity audit;
native ARM server/Oracle/hosted CI and real-commit nomination remain unrun. No
release approval, publication or CI predicate is bypassed or changed. Supplied
credentials/external endpoint, deployment, external infrastructure, push and
merge remain untouched.

**Remaining-scope source audit — 2026-11-12:** source remains exactly
0d6d1238; no new build, database or product change is introduced. Comparing the
recorded 7b006abe input map to the current canonical map proves identical hash,
size and original mode for 189 files across core, parser, grammar, vault, runtime,
worker, operator, CLI and web. Workspace Cargo.toml/lock and pinned toolchain inputs
also match. Only 19 server inputs and Dockerfile differ; their current boundary/
product/exact-image/Oracle results are recorded above. An unchanged-component
comparison preserves earlier component evidence; it does not silently turn the
old binary/runtime results into current-artifact acceptance.

The retained backup-history reports still exist and their hashes are checked.
All 16 frozen catalog signatures/two witnessed restore scenarios pass in the
recorded component run. The original Node producer Git blob still hashes to its
recorded identity. All five witnessed archive cases (four original Node profiles
and the earlier native C-order identity alias) record PASS, unchanged source/
archive/witness, two retired credentials, RESTORE_HOLD and no execution authority.
Their fixtureCleanup fields are true; none of their removed database/image paths
is treated as reusable. The current operator source is unchanged from that
qualified component. Admitted-job archive restoration, managed-cluster operation
and production DR are separate unqualified scopes, not outcomes inferred from
these cases or the current installed execution-recovery fixture.

The parser audit confirms all 28 generated semantic coordinates are accounted
for (two lexer hooks, nineteen parser hooks and seven synthetic parser actions),
unknownSemantics=ERROR in provenance and generator configuration, and explicit
native callbacks matching the retained Java base contracts. The parser/core/web
source is unchanged from the retained-contract checks. The distinct native-v2
profile, unknown/recovered-syntax refusal and lack of execution/production approval
remain intentional boundaries. This static audit does not prove arbitrary grammar
or all browser/API behavior beyond their recorded contract inventories.

README now points exclusively to this checklist for exact artifact/Oracle status,
removing its stale blanket qualification sentence. RUST5 historical wording is
made explicitly chronological; current installed Oracle/archival evidence is not
hidden behind earlier missing-qualification notes. Audit result is
remaining-parity-source-audit-0d6d1238.json. The immutable 16-reference final source
index remains unchanged; the mutable current index adds this separate read-only
audit. The current release CLI then passes all 1,228 retained kernel comparisons,
with bundle integrity checked before/after and its actual 0d6d1238 release identity
reported (amd64-0d6d1238-core-parity.json). The existing parity harness now accepts
an explicit verified distribution; its default debug path remains available.
Targeted offline parser/grammar tests on the current frozen source also pass:
nine tests across the corpus/native/snapshot binaries, including all 31 original
files with exact source hashes/byte ranges/digests and raw invalid-UTF8/BOM/
malformed-input refusals. Snapshot/Git identity and zero implicit approval pass.
The same host Cargo target uses two jobs, no debug symbols/incremental and no
network; compilation takes 46.90 seconds, with no DB or image created. Result is
0d6d1238-parser-contracts.json. These are current-source parser contracts and an
exact AMD64 kernel result, not native ARM/hosted CI or universal grammar proof.
Both archives and all 319 native source inputs remain unchanged.

The README hygiene check first catches a 31-line entry page; compacting its status
pointer to 30 lines resolves that documentation-only failure. Source checks,
repository hygiene, checklist validation, JS syntax and whitespace checks pass
again. No failed check is presented as a passing product test.
Full behavioral parity, native ARM/hosted CI, real-commit nomination and
production acceptance remain unproven where stated. Existing gates and all
uncommitted source are preserved, no supplied credential/endpoint is touched,
and the goal stays active.

**Required release-gate availability audit — 2026-11-12:** the local worktree
still has all preserved tracked/untracked rewrite changes; Git HEAD remains
7b5cc80281198ef1cf12e7694efae8b64ccc77af, while both current artifacts explicitly
report local-unpublished/source tree 0d6d1238. The actual current release OCI
verifier is exercised without publication: verify-platform with local-unpublished
returns 1/Expected a verified 40-character source revision; using the real old
HEAD returns 1/OCI source, platform or process role mismatch. These are expected
passing negative gate checks, not new product failures. No label, archive,
commit, approval predicate or CI rule is changed to make them pass.

The configured containers workflow uses native ubuntu-24.04 and ubuntu-24.04-arm
runners, then requires both platform jobs to succeed before real-commit OCI
assembly. This workspace is x86_64 and its completed ARM checks are explicitly
QEMU/host-browser checks. No authorized native ARM CI execution environment has
been established for this dirty source. A run on old HEAD would not qualify the
new worktree. Completing these required gates for the rewrite needs a real
source commit and authorized CI/source publication; the user's current no-push/
no-external-infrastructure instruction is preserved. There is no pending local
build/test/fixture to wait on and no relevant failed product check to fix.
Bounded local artifacts, current kernel/parser/API/browser/Oracle proofs and
unchanged-component evidence remain available for review. Full behavioral parity
beyond the recorded inventories is still not asserted, and production acceptance
is not inferred. No optional broad-suite rerun substitutes for the missing gates.
The concrete report is release-gate-availability-audit-0d6d1238.json. This is the
first availability observation. A second consecutive read-only revalidation
confirms the same old HEAD, preserved dirty/untracked native source, unchanged
319 current inputs, local-unpublished artifacts, x86_64 host and required native
ARM/two-platform CI gate. No authorized CI/source-publication environment or new
authorization has arrived, and no local build/test is pending. Passing suites are
not repeated as a substitute. A third consecutive read-only revalidation confirms the same condition,
including unchanged current source/artifact identities, preserved uncommitted
work, required native CI rules and absence of pending local work. The goal tool
returns status blocked; the full objective is retained and not declared complete.
Source/CI publication or an authorized native-CI execution path is needed to
advance the required remaining gates. No new permission is assumed or requested,
and no source publication or supplied credential/endpoint operation occurs.
All local artifacts/results stay available at their source-qualified paths.

The requested replacement includes the API, privileged Oracle worker/runtime,
operator tooling, browser UI compiled to WebAssembly, and the SQL parser.
The Cargo workspace is an in-progress implementation. The existing runtime and
delivery gates remain the reference until native feature parity is established.
Prioritize broad migration coverage and a runnable integrated Rust application.
Use compilation and focused smoke checks during porting; consolidate deeper
logic and compatibility checks after the remaining modules are connected.
Authorization, data integrity, independent approval and HOLD/no-replay remain
required throughout the migration.
No deployment, publication, external infrastructure change, push or merge is
authorized by this rewrite.

- [x] **RUST1 — Native governance kernel:** Rust ports retain approval envelope
  formats 1–4, release manifest formats 1–2, audit/review cursors, Oracle physical
  identity, exact-prefix migration selection, schema SQL scope, catalog
  postconditions and the capability-based coordinator. The reference comparison
  runner passes 1,228 cases, including bounded SQL review, catalog reference context,
  validation envelopes, source alignment, comment references, schema normalization
  and drift. Schema hashes retain ECMAScript number and UTF-16 key semantics,
  with bounded definition depth, node count, arrays, objects and payload bytes.
  Approved history context, pending-to-approved statement labels, retained target
  binding hashes and canonical completion preimages match the reference as well.
  Whole-file three-way draft reconciliation preserves stable IDs, explicit
  overlapping choices, removals, metadata and selected manifest exclusions;
  staged results require a separate CAS save. Filename increments preserve
  arbitrarily large decimal migration versions without floating-point conversion.
  Coordinator tests cover lost ACK, receipt gaps,
  authority/lease loss, immutable dispatch bytes, HOLD and zero-dispatch NOOP.
- [x] **RUST2 — Bounded native metadata workflow:** the Axum/SQLx server builds
  with the existing PostgreSQL schema. Isolated PostgreSQL tests pass bootstrap
  idempotence, explicit membership, immutable audit, token/password browser
  sessions, CSRF, logout and anchor revocation. SQL drafts retain revision CAS,
  immutable history and one release for concurrent exact prepare retries.
  Target fixtures written by the retained operator remain readable. Native
  authored Git commit hashes match Git. This covers these implemented routes;
  it is not full API or Oracle execution parity.
- [ ] **RUST3 — Complete native parser compatibility:** the native parser uses
  the distinct `kelryvo-oracle-rust-v2-antlr-0.34.0` profile and complete native
  recognizers generated from the existing pinned Oracle grammar. It replaces the
  limited v1/sqlparser backend and supports the retained procedure, function,
  package specification/body, trigger, anonymous block and mixed-delimiter cases.
  The application entry point passes all 31 original corpus files, including
  exact source/execution byte ranges and digests, SQL*Plus rejection, malformed
  input, BOM/invalid UTF-8 and complete-input rejection. Native snapshot/Git
  identity tests also pass. Semantic hooks preserve the retained base callbacks;
  unknown semantics and recovered syntax are rejected. Normal builds and runtime
  require no Java, generator or interpreter. The grammar crate retains Apache
  notices, adapted/generated hashes and an explicit pinned native regeneration
  example. Existing ANTLR and Rust-v1 approvals never acquire v2 implicitly.
  The complete native PostgreSQL product workflow passes with v2, including
  PL/SQL draft preview/validation and immutable release persistence. Valid GRANT
  syntax remains administratively blocked, and procedural syntax retains its
  unsupported-semantic policy boundary. A compiled CLI smoke parses a procedure
  and rejects late malformed SQL with no external executable available on PATH.
  Workspace build, formatting, Clippy and pinned source regeneration checks pass.
  Retained-corpus compatibility does not establish complete grammar equivalence,
  live Oracle acceptance, performance qualification or production approval.
- [ ] **RUST4 — Complete browser and API parity:** Rust/WASM compilation, the
  native web build command and a Chromium smoke pass token login through actual
  TLS, draft create/save, immutable release preparation, parser checks, account
  sessions and logout. The native instance credential form now passes register,
  rotation and revocation in Chromium; persisted ciphertext is independently
  opened by the retained Node verifier. Native discovery/test observations and
  history now retain immutable evidence and recheck authority/revision after I/O.
  Targeted tests cover timeout/cancellation capacity, physical identity claims,
  scoped schema/attestation visibility and stale results. Chromium covers durable
  unavailable discovery and provisional schema assignment using a trusted private
  fixture. Operator-managed schema onboarding creates immutable binding revisions
  and rolls back the entire batch on ownership conflicts. Managed credentials
  require a native writer installation before assignment. Target detail,
  currentness, explicit observe/verify and scoped identity evidence now run in
  Rust. PostgreSQL differential checks match the retained implementation for
  forged facts, superseded bindings/observations, changed-and-restored connections,
  source generations and later schema evidence. Chromium covers explicit
  observation, accepted verification and evidence display with private fixtures;
  fixtures never qualify live Oracle operation. Concurrent acceptance appends
  exactly one CAS successor. Native offline review plans now bind complete
  retained statement identities and the current target/source revisions. A
  database scalar preflight bounds payloads before loading SQL. Chromium passes
  author plan creation, reviewer selection, exact snapshot SQL review, independent
  approval and withdrawal with two actual browser identities. The retained Node
  verifier reproduces the native approval envelope byte for byte. PostgreSQL
  tests cover concurrent decisions, self/reviewer denials, damaged plan items and
  statement identities, immutable release/evidence, source changes and withdrawal
  putting waiting jobs on HOLD. Native validation now retains deterministic,
  immutable reports with scoped catalog summaries and explicit unknown semantics.
  Concurrent retries reuse one digest; blocked syntax/scope cannot become a plan.
  PostgreSQL tests cover format-4 approval, report/statement tampering and stale
  catalog evidence after a later restoration. Chromium covers validation creation,
  findings display, format-4 independent approval and withdrawal; the retained Node
  implementation verifies the same native validation/intent binding. Reports name
  the distinct Rust parser and confer no execution authority. Native source
  comparisons retain version/statement alignment in immutable audit evidence;
  duplicate sources and unresolved replacements remain explicitly ambiguous.
  Comparisons bind the plan intent and both verified source snapshots. Decisions
  and review comments reverify attached evidence; source comment references are
  rederived from the pinned parser. PostgreSQL covers wrong-plan/corrupt evidence,
  cross-project reads, terminal decisions and historical comments during restore
  while configuration and approval remain held. Chromium passes comparison
  creation/reopen, escaped comments, statement references and comparison-backed
  independent approval; retained verifiers accept native comparisons and comment
  descriptors. Comment history reads reject payloads above 16 MiB instead of
  silently truncating the existing response. Native plan-record export now checks
  historical decision/revocation integrity, redacts private principal references,
  and collects evidence in a bounded repeatable-read snapshot. Live project/session
  authority is checked before and after that read. The retained verifier matches
  native records for envelope formats 1–4 and all four review phases; Chromium
  verifies the actual JSON download, checksum, authored origin, validation and
  comparison summaries without source SQL or credentials. Native schema history,
  snapshot reads, comparison, baseline capture and plan drift now retain scoped
  immutable observations. PostgreSQL tests cover partial coverage, independent
  snapshot/baseline cursors, stale I/O rejection, immutable audit and unavailable
  runtime. Chromium covers snapshot inspection, escaped baseline names, comparison
  and drift evidence. Missing identity is incomparable; incomplete coverage never
  proves absence. Shared diagnostic capacity remains held until timed-out work
  actually settles. Controls are disabled while asynchronous rendering completes
  so concurrent responses cannot erase newly entered form values. These checks
  use private fixtures and do not qualify live Oracle collection. The native
  Executions tab now reads retained request/event pages and cancels the current
  requester's waiting entry; Chromium confirms cancellation creates no attempt.
  Listing/detail responses and continuation pages match the actual retained HTTP
  handlers on the same PostgreSQL fixtures. Native request creation now rederives
  complete native statement identities. It and diagnostic readiness check protected
  source bytes, approval, target/source revisions, validation, live deploy authority
  and stream conflicts. Only request creation persists WAITING_VALIDATION;
  readiness grants no worker or execution capability. Concurrent exact retries retain
  one job/event/audit; retries after source changes recover the original request
  without bypassing current permission or restore HOLD. The retained API recovers
  that same native request and matches diagnostic readiness. Chromium covers a
  real browser credential queuing a format-4 plan and cancelling it, with no proof,
  attempt or Oracle dispatch. Request keys survive failed UI submissions for exact
  retry. Managed writer eligibility remains tied to native installation support.
  Native execution history now exposes bounded attempt, event and receipt pages,
  independent actor/job/attempt-bound cursors and verified approved-statement
  labels. Explicit projections exclude worker leases, raw facts and credentials.
  PostgreSQL comparisons cover continuation pages, cursor integer boundaries,
  cross-project denials, unavailable context and valid historical proof labels.
  Digest-only HOLD evidence submissions and independent approver decisions retain
  immutable audit and exact retry semantics. Concurrent retries create one record;
  reviewers cannot be the submitter, requester or plan author. Restore HOLD allows
  history reads while blocking these mutations. Review preserves the held job and
  creates no attempt, retry eligibility or execution authority. Chromium covers
  journal/receipt inspection, escaped evidence submission and independent review
  in separate browser sessions using private metadata fixtures.
  The native multi-file editor now selects, renames, adds, removes and restores
  files without changing their retained identities. Legacy single-file revisions
  remain format 1 until file-manifest editing explicitly upgrades them. Saving
  orders files by migration version. Unsaved edits survive rejected saves and
  asynchronous actions; they block release preparation and route changes until
  saved or explicitly discarded. Concurrent revisions retain local content and
  expose whole-file/metadata reconciliation with explicit overlap choices and
  manifest exclusions. Applying stages changes against the latest revision but
  never saves automatically. Chromium covers legacy-to-format-2 conversion,
  numeric ordering, duplicate-version rejection, removal/undo, concurrent edits
  and renames, immutable revision counts and multi-file release/plan approval.
  CRLF and leading newlines survive unedited file selection; SQL and filenames
  remain escaped, and approvers can inspect files with mutation controls disabled.
  Native workspace revision comparisons now reverify both immutable file
  manifests; PostgreSQL responses match the retained HTTP handlers for legacy
  and multi-file revisions, including approver reads and invalid query/revision
  inputs. Revision-bound syntax preview and draft target validation build
  ephemeral native snapshots with bounded parser capacity. They persist no
  release, validation ID, audit or draft revision, and recheck live authority and
  metadata HOLD after CPU work. Invalid or unsupported native syntax returns
  blocked evidence without partial statement identities; strict release
  preparation still rejects it. PostgreSQL covers policy-blocked SQL, late syntax
  errors, stale revisions/targets, parser capacity, explicit membership, archived
  projects and restore HOLD. Chromium covers saved-revision comparison, escaped
  SQL, source-file inspection, draft-only reports and hiding advice during local
  edits. Prepared releases use retained validation IDs; only a current matching
  release/report enables direct creation of a format-4 plan for independent
  approval. Draft-only reports never enable plan creation.
  Authored release attribution and originating-source correction now run in
  Rust. The scoped origin endpoint rechecks immutable revision hashes, release
  bytes/manifests and file identities; PostgreSQL responses match the retained
  HTTP handlers for formats 1–2, historical revisions, archived projects, restore
  HOLD and changed-and-restored source generations. Damaged provenance fails
  closed. The descriptor contains no SQL or credentials. Chromium opens current
  drafts from release/plan source controls, protects unsaved edits before I/O,
  and distinguishes unchanged, renamed, changed and removed files by stable ID.
  Historical selections require matching bytes and a verified statement hash;
  UTF-8 offsets become normalized UTF-16 textarea positions, including Unicode
  and CRLF. Removed identities are never restored implicitly. Separate developer
  and reviewer browser sessions cover read-only inspection, explicit correction,
  a fresh release and a new pending format-4 plan while the prior release and
  approval remain immutable. Corrections create no execution job or authority.
  Consolidated migration history now combines plan creation, decisions,
  candidate outcomes, requests and scoped audits with separately labelled live
  status. Count and page use one READ COMMITTED statement; project/filter-bound
  cursors preserve PostgreSQL microseconds and accept legacy timezone offsets.
  Legacy offset responses remain available. Target binding filters verify
  retained intents in bounded batches rather than trusting envelope text or
  audit facts. PostgreSQL responses match the retained HTTP handlers, including
  timestamp ties, concurrent inserts, status/search filters, scoped reconciliation
  audits, forged target envelopes and restore HOLD. Comparison fixtures align
  session timezones; an additional offset cursor checks cross-timezone continuity.
  Native execution records now verify historical plan/approval bindings and
  approved admission labels, collect the complete journal in a read-only
  repeatable-read snapshot, and recheck live authority before and after reading.
  Scalar preflight enforces 2,000 rows and 1 MiB of allowlisted journal fields
  before materialization; the complete export is capped at 8 MiB. Oversized or
  damaged records fail instead of truncating. Private leases, credentials, raw
  facts and profile facts are excluded. PostgreSQL comparisons cover complete
  multi-page journals, queued/cancelled/HOLD requests, verified statement labels,
  missing trusted proofs, individual/aggregate bounds and restore HOLD. Chromium
  covers filtered/newer/older history pages, escaped evidence, request inspection,
  plan navigation, permalinks with and without an existing session, real checksum
  downloads and exports after approval withdrawal. Denied history reads clear
  cached rows and request details. Initial session discovery settles before
  authentication controls become interactive. None of these reads grants retry,
  worker or execution authority.
  Retained release detail and global source comparison are now native HTTP
  routes. Historical display preserves bounded INVALID/UNAVAILABLE diagnostics
  and original file metadata without asserting source integrity. Comparisons
  preflight both retained payloads before loading either source, verify manifests
  and bytes, require compatible repository/folder/parser identity and create no
  review audit or execution authority. Differential PostgreSQL checks cover
  authored attribution, raw retained bytes, civil year zero/expanded years and
  floor milliseconds, source changes, opaque profiles, tampering, payload bounds,
  project authorization, archived reads and the retained RESTORE_HOLD boundary
  (historical GET allowed; comparison POST vetoed). Rust/WASM now opens a
  release from project overview, plans and migration history; displays retained
  file contents; compares sources; and previews verified statement byte ranges
  with source/execution hashes and originating-file/statement correction links.
  Chromium covers these paths and clears cached source on denied release reads.
  Source allowlist/listing and source-binding updates now have native routes,
  with a protected optional `repositories.json` startup file; responses omit
  local paths. Binding generations advance on changes and remain stable on exact
  repeats, with an audit for each accepted request. Native profile creation and
  configuration detail/update, preflight and lifecycle endpoints are implemented
  for deployment profiles and discovery connections. They preserve revision CAS,
  instance-managed profile restrictions, workspace database management grants,
  active execution guards, retirement and restore vetoes. Configuration controls
  are connected in the Rust project and instance pages. A bounded native Git
  reader lists local branch/tag refs and imports immutable commit blobs without
  fetching, checking out files, invoking a shell or enabling hooks. It snapshots
  all source bytes before native parsing, records format-1 manifests under the
  distinct Rust profile, retains invalid diagnostics and rechecks authority and
  the source-binding generation before persistence. Rust/WASM includes local Git
  selection/import and statement inspection. Workspace and WASM compilation pass;
  Chromium passes source binding, profile creation, offline preflight, local refs,
  Git import and retained statement preview through the actual TLS server.
  Targeted configuration/Git differential checks now pass; they do not prove
  complete compatibility or Oracle execution. Native Git checks use real SHA-1
  and SHA-256 repositories, comparing local branch/lightweight/annotated/nested-tag
  listings and rejection responses with retained handlers. Invalid ref syntax is
  rejected inside the bounded importer, preserving RELEASE_IMPORT_FAILED and the
  earlier source-binding/archive checks. Branch and nested-tag imports retain the
  exact committed paths, normalized large versions, SQL bytes and hashes, matching
  the retained snapshot reader with its parser deliberately disabled. The native
  parser independently validates the imported files and verifies their native
  manifest/profile together. Dirty and untracked worktree SQL is excluded; reads
  and imports leave checkout status and HEAD unchanged. Unsupported symlinks fail
  before any partial release/audit is persisted, moving branches preserve prior
  snapshots, and foreign-project/archived-project boundaries remain enforced.
  Each successful import records one release and audit with zero new jobs or
  attempts. The complete private-PostgreSQL API integration test passes with these
  cases. This is source-import compatibility, not a parser-equivalence or live
  Oracle qualification claim. Identity now has native
  provider creation/update, explicit actor mappings, lookup/test, provider revision
  captures, session revocation and LDAP/OIDC sign-in endpoints. Operator-owned
  `identity-runtime.json` keeps route/IP/issuer/DN/secret allowlists outside public
  metadata; private reads enforce ownership, mode and no-follow checks. Identity
  networking uses pinned TLS, bounded responses/timeouts and no HTTP redirects.
  Native OIDC has sealed five-minute flow cookies, PKCE, nonce/signature/issuer/
  audience checks and one-use attempts bound to the provider revision and metadata
  generation. LDAP searches with the service credential and verifies the user on
  a separate TLS connection. Rust/WASM includes provider/mapping management and
  external sign-in controls; native operator `identity-grant`/`identity-revoke`
  commands retain OS-UID audit and active-metadata checks. Workspace/WASM builds
  and Clippy pass. The local TLS OIDC smoke passes actual provider discovery/JWKS,
  authorization-code exchange, browser session issuance and immediate mapping
  revocation. Native LDAPS wire tests now exercise the actual TLS connector and
  LDAP client against a private loopback BER fixture on an ephemeral port. They
  verify pinned-address routing with hostname/CA verification, literal username
  filters, separate service/user binds, wrong-password rejection, absent/ambiguous
  identities, case-insensitive attributes, binary subjects and provider reachability.
  Missing display names remain JSON null in the adapter, while public lookup
  projects them to an empty string, matching both retained layers;
  failed TLS and out-of-policy provider metadata send no LDAP credentials.
  The public path remains fixed to operator-allowlisted LDAPS/636. These tests do
  not establish OpenLDAP/Active Directory interoperability or full identity/API
  compatibility. Native identity governance also passes direct retained-handler
  comparisons on private PostgreSQL: access and redacted route/actor/provider
  lists, disabled creation, explicit mappings, mapping-required activation,
  revision CAS, immutable source routes, mapping history, public auth methods,
  capability revocation and RESTORE_HOLD reads/mutation denial. Provider updates
  revoke all external roots and browser children; unlinking one mapping preserves
  other identities' sessions. The reference runs in always-rolled-back transactions
  and each comparison verifies unchanged provider/revision/mapping/audit/credential/
  actor snapshots before applying the native request. Identity governance creates
  no project grants or execution jobs. Broader sign-in/race compatibility checks
  and live Oracle discovery remain pending.
  Native compatibility now includes the retained project connection inventory
  endpoint and reason-only profile retirement. Inventory retains UUID pagination,
  case-insensitive search, engine/environment/lifecycle filters, explicit workspace
  management grants, project/assignment visibility and credential-redacted
  readiness/observation projections. The private product test compares empty and
  52-connection pages, filters, malformed/duplicate selectors, approver access and
  foreign-project denial with the retained handler. Retirement preserves the
  profile and immutable revision history, vetoes admitted execution, rechecks live
  credentials/project grants and appends one audit event; repeat retirement is a
  no-op. Differential invalid-input/role/idempotence/audit cases pass in the full
  native product scenario. These ports were found by reusing the actual HTTPS
  governance smoke rather than weakening it for the replacement runtime.
  The retained manual-reference APIs now run in Rust: schema declaration and
  assignment, connection registration from an assigned route, reason-only
  connection retirement, paginated schema references and target-option inventory.
  Declarations retain literal owner/server-reference UUIDs, MANUAL_REFERENCE
  provenance, the initial assignment revision and operator/project audits; they
  do not observe Oracle, create target options or grant execution authority.
  Catalog/schema/lifecycle locks precede publication guards. Duplicate routes,
  foreign/closed assignments, missing database-management grants and invalid input
  roll back the complete transaction. Connections retain their revision archives,
  omit private references from responses, support declared unsupported engines
  without opening a client and refuse retirement while execution is admitted.
  Shared instance projections now include the retained diagnostic readiness.
  The native product scenario passes differential manual inventory/options,
  Unicode owner/route projections, permission/input/duplicate rollback and
  retirement/history checks against the retained API. No execution attempt is
  added. Target-option reads omit private principal references and retain the
  existing assignment scope, pagination and revision fields.
  Self-service POST /api/account/password and the Account Rust/WASM form are
  implemented with confirmation, existing-password verification, HTTPS/origin/
  CSRF guards, bounded hashing and the retained five-request rate limit. A fresh
  serialized credential/account/hash/anchor checkpoint after hashing preserves
  RESTORE_HOLD and concurrent operator revocation. One transaction changes the
  hash, revokes PASSWORD/BROWSER credentials and appends PASSWORD_CHANGED, leaving
  LOCAL anchors, actor roles and grants intact. The response clears the browser
  cookie and the UI requires a fresh sign-in. Request passwords and derivation
  input buffers are zeroed on drop. Native server/WASM Clippy and formatting pass.
  The focused --password-only smoke runs actual HTTPS and Chromium against the
  Rust UI. It passes confirmation/current-password/input/CSRF/HOLD denials,
  replacement login, old-session revocation, one audit event, unchanged LOCAL
  identity/expiry and the retained password verifier opening the new native hash.
  Browser-only acceptance also invokes this focused flow on its own private
  PostgreSQL cluster. It remains separate from routine delivery checks.
  Native POST target-bindings now retains strict input and revision bounds,
  authenticated actor attribution, catalog/schema/lifecycle lock ordering,
  current assignment/option/environment/profile/principal eligibility, immutable
  revisions, head CAS, one audit and the retained redacted currentness response.
  PostgreSQL checks cover stale expectations, first-binding duplicates, concurrent
  updates with one winner, profile changes, archived projects, permissions and
  RESTORE_HOLD without creating execution attempts.
  The actual retained Fastify registration now supplies the route inventory for
  a native-router check of all 169 registered method/path pairs, including HEAD.
  Missing-path and unsupported-method controls prevent fallback responses from
  proving coverage. The inventory performs no metadata writes or listening I/O.
  This exposed the missing migration-analysis route, now implemented natively.
  Its repeatable-read comparison verifies immutable release/intent identities,
  exact UTF-8 source ranges and hashes, profile/target/validation currentness,
  matching completion proofs, pending-prefix ordering, receipts, acknowledgements,
  terminal validity and independently reviewed recovered HOLD evidence. Uncertain
  or overflowing history remains blocked; retained SQL never grants dispatch.
  Statement pages retain the 50-row limit and analysis digest, and a fresh
  credential/project checkpoint precedes returning SQL. Differential PostgreSQL
  checks compare the complete retained JSON, including digests, input/permission
  denials, 53-statement pagination, changed-analysis rejection, historical HOLD
  reads and recovered evidence consumption/revocation. Rust/WASM now exposes the
  incremental migration preview with integrity findings, ordered SQL and hashes,
  completion-plan navigation and further SQL pages. Actual HTTPS/Chromium passes
  preview rendering and clears cached SQL after a denied or changed analysis.
  Server/WASM Clippy, formatting, source and repository hygiene checks pass.
  The focused --browser-product-only mode runs the product UI flow without
  repeating the independent identity/password flows; existing browser-only and
  configured delivery checks retain their behavior. Method/path coverage does
  not establish complete API or browser compatibility.
  The Rust/WASM Targets page now includes the operator-option binding form,
  explicit environment selection, assignment/option/binding pagination, retained
  detail/revision history, identity evidence and target-specific SQL Workspace
  navigation. Form expectations come from loaded server revisions. Conflicts
  preserve the reason and require an explicit refresh/reselection/submission;
  refresh never writes a binding. A fresh session supplies role/access mode,
  since session issuance omits accessMode, and current recovery status keeps
  reviewer, archived-project and RESTORE_HOLD forms read-only. Permission loss
  clears retained target data. Chromium against actual native HTTPS passes first
  creation, concurrent external revision conflict, explicit revision-3 retry,
  unchanged revision-1 bytes, actor audit, HTML escaping, redaction, history and
  preselected workspace navigation. Reviewer/HOLD/archive inspections remain
  available, while binding writes remain disabled and execution jobs stay zero.
  Native Account now shows local sign-in configuration, project/deployment/review
  access and active browser sessions, with independent access/session pagination,
  refresh and self-service revocation of another owned session. The current
  session has no revoke control; Sign out retains its separate behavior. Failed
  account reads clear cached data. Password changes appear only for an enabled
  configured local password in a browser session. Chromium passes actual pages
  beyond 50 projects and sessions, archived/deployment grant projection, escaped
  labels, hidden unassigned projects, a real remote-session revocation under HOLD,
  exactly one account audit and continued current-session access. The focused
  HTTPS/WASM password-change smoke still passes its original password/CSRF/HOLD,
  credential revocation and retained hash-interoperability checks.
  Native Connections now supports project selection from the cross-project
  overview and a project connection tab. Manual reference registration preserves
  literal owners and declared route facts; discovery connection registration uses
  a loaded assignment/route pair and credential references. Server-side search,
  engine/environment/status filtering and connection pagination retain scoped
  results. Configuration detail/preflight, explicit test/discovery, observation
  history/pagination and confirmed permanent retirement use the native APIs.
  Refreshes retain filters. Workspace database grants, actor role, archived state
  and recovery status gate writes; read-only evidence inspection remains available.
  Actual Chromium/HTTPS checks pass declaration/registration, 53-row pagination,
  scoped filters, preflight, durable unavailable test/discovery, history reads
  during HOLD and revision-2 retirement after explicit confirmation. Public
  projections omit private references, and the isolated project creates no
  execution jobs. WASM Clippy, formatting, source and repository hygiene pass.
  Legacy discovery connection cards now select retained historical observations,
  scoped accessible owners and matching assignment/route/owner bindings. Explicit
  record/verify requests use loaded digests and revisions with a required reason.
  Chromium passes historical-observation disablement, fixture verification denial,
  successful observed/verified revisions, actor-attributed audit, CAS conflict
  without replay, scoped owner/reference redaction and cache clearing after denied
  history reads. Synthetic accepted evidence tests server behavior only; it does
  not qualify live Oracle operation or the current image.
  Native Review inbox now supports ALL/MINE/ELIGIBLE scopes, cursor pagination,
  refresh, escaped project/requester labels and opening a pending plan in its
  owning project. Opening rechecks current membership, archive state and pending
  status; subsequent pages also recheck previously retained project access. Actual
  HTTPS/Chromium passes more than 25 plans, developer/reviewer scope differences,
  navigation to a real native plan, stale terminal-plan rejection, failed-page
  cache clearing and membership revocation between pages. Inbox inspection creates
  no approval, assignment audit or execution job. The existing independent review
  and withdrawal flow still passes. WASM Clippy and formatting pass.
  Project Overview now exposes explicit developer archive with a required reason,
  current session/access-mode and metadata-recovery facts. Failed submissions
  retain the escaped reason without retry. Archived projects show a read-only
  banner on every project tab; Overview environment creation is disabled during
  archive/HOLD while retaining the API's existing member role scope. Denied
  project reads clear cached data and show an unavailable screen. The existing
  Connection details lifecycle also retires deployment profiles; profile lists
  now show their actual active/retired state rather than absent revision/status
  fields. Chromium passes native environment creation, HOLD-disabled forms,
  explicit profile-retirement confirmation, actor attribution, immutable initial
  profile revision, archive failure/retry, exactly one archive audit, retained
  read-only configuration and cache clearing on a denied overview read. The
  disposable project creates no execution job. The complete focused product
  browser smoke, WASM Clippy, formatting, source and repository hygiene pass.
  The native Audit tab now reads the dedicated 50-event cursor API rather than
  the project detail's recent-100 snapshot. It exposes all retained action choices,
  filter resets, refresh, older pages, actor/reason summaries and separately
  labelled retained migration states. Arbitrary facts and private references are
  not rendered. Actual HTTPS/Chromium passes 124 ordered events, tied microsecond
  timestamps, actions older than the recent-100 snapshot, filter-bound cursor
  reset, escaped reasons, unchanged metadata during reads, failed-page cache
  clearing and archived/HOLD inspection. Revoked membership clears both audit and
  history caches on the next page request.
  Native Plans now retains the ALL/PENDING_APPROVAL/ASSIGNED_TO_ME/APPROVED/
  REJECTED/REVOKED display filters, filtered counts, empty states and explicit
  refresh. Refresh preserves the current filter. Changing filters clears previous
  SQL previews and review evidence, while retaining execution-request idempotency
  keys. Chromium verifies author/reviewer assignment scope and actual native
  pending, approved and revoked plans without changing plan/audit state. The
  complete focused product browser smoke, WASM Clippy, formatting, source and
  repository hygiene pass. The expanded browser harness paces its author/reviewer
  phases to respect the unchanged 600-request/minute API limit; an earlier run
  reached that limit at logout and was not reported as passing.
  Native Overview now derives recommended navigation from fresh membership,
  recovery, target, plan and execution-request facts, preserving the retained
  archive/access/HOLD/job/reviewer/target/release priority. Delivery metrics label
  partially loaded target counts. Navigation reloads the owning project and
  selects the current plan/status, or retains all plans if facts changed. It does
  not create a decision, request, admission or Oracle capability. Actual native
  HTTPS/Chromium passes no-target instance navigation with project preselection,
  SQL preparation, pending author/reviewer and approved developer plan navigation,
  recovery HOLD and archived-history advice. Plan/job/audit snapshots stay intact.
  Projects now retains multiple creation handoff receipts in session memory across
  navigation and refresh, with native operator grant commands and escaped names.
  Creating a project still grants no membership; its UUID is not an assigned card
  until the OS operator grants access. Account changes, sign-out and authentication
  expiry clear receipts; browser storage is unused. Search filters only loaded assigned
  projects and preserves its text on refresh. Creation is disabled during recovery
  HOLD. Chromium verifies real native creation, 404 before grant, explicit grant,
  two retained handoffs, search/empty states, account separation and zero jobs.
  Mobile overflow in the sidebar grid/form layout is fixed; the 390px handoff
  screen fits without horizontal page overflow. WASM Clippy, formatting, source,
  repository hygiene and the complete focused product browser smoke pass.
  Instances now includes project-scoped deployment-profile inventory, search by
  name/endpoint/principal/environment, environment/status filters, counts and
  empty states. Refresh and successful configuration/lifecycle writes preserve
  filters and the selected project. The shared native configuration form creates
  profiles in place and supports explicit configuration inspection and CAS writes.
  Reason-only profile retirement uses its retained route with explicit permanent
  confirmation, actor attribution and no automatic retry. The project-detail
  profile projection now includes its missing public service-kind, enabled/status,
  revision, description and credential-availability fields through the shared
  redacted projection, plus the existing retirement actor. Exact native HTTPS JSON
  matches the retained publicConnection projection for enabled, disabled, SID and
  retired profiles; private references remain absent.
  Profile reads no longer depend on opening the privileged master-credential
  inventory. Reviewer, archived-project and recovery-HOLD inspection remains
  available while create/retire/configuration controls are read-only. Master
  inventory still requires its original database-management grant; no backend
  credential or execution authority changes. Chromium passes native profile
  creation, combined filters, refresh retention, escaped labels, stale-revision
  conflict without replay, explicit retirement, one PROFILE_RETIRED audit,
  reviewer/HOLD/archive reads, lost-membership cache clearing and zero jobs in the
  isolated project. The full native PostgreSQL product flow and focused browser
  smoke pass, along with server/WASM Clippy, formatting, source and repository
  hygiene. An initial browser run reached an ambiguous old Host locator after the
  new profile form appeared; scoping it to instance registration fixes the harness.
  The native Schema references tab now exposes the dedicated project assignment
  inventory rather than only using it as binding-form input. It groups declared
  schemas in DEV/SIT/UAT/PROD order and under each bounded service reference,
  preserving rows without a declared service and explicit service truncation.
  Schema/database/container reference IDs, assignment revisions and generations
  remain labelled provisional; they confer no physical identity, profile binding
  or approval. Refresh, independent assignment pagination and navigation to Targets
  use the native APIs. Failed continuations clear retained rows; lost membership
  clears the entire project cache. Chromium/HTTPS passes 53 assignments, all four
  environments, a container with 11 services, a no-service assignment, scoped
  unassigned-owner exclusion, escaped labels and literal owners, reviewer access,
  archived/HOLD reads and unchanged assignment/binding/audit/job state during
  browsing. The full focused product browser smoke, WASM Clippy, formatting,
  source and repository hygiene pass. The harness now paces inventory, author and
  reviewer phases against the unchanged API rate limit; an initial expanded run
  reached that limit later in the author workflow and was not reported as passing.
  The standalone native Schema baselines tab now loads scoped target/connection
  inventory, independent snapshot/baseline cursors, immutable snapshot details,
  owner/name/type object filters, baseline capture and structural comparisons.
  Target changes and failed reads clear retained details/comparisons. Navigation
  opens SQL Workspace with the selected target, matching plans or filtered migration
  history; the normal unsaved-draft guard remains enforced. Observation submits
  the loaded binding/assignment revisions and selected authorized connection,
  retaining unavailable collection as evidence rather than claiming live success.
  Focused Chromium/HTTPS checks pass 52 snapshots, 101 existing baselines, independent
  pagination, escaped definitions/names, capture with one audit, comparison equality
  against retained contracts, failed detail clearing, target navigation, unavailable
  observation, reviewer/HOLD read-only controls, lost-membership clearing and zero
  execution jobs. Fixtures do not qualify live Oracle. An initial comparison check
  differed only in JavaScript object prototypes; JSON normalization fixes the
  fixture comparison. A later navigation check now explicitly discards the new
  draft after asserting its target handoff, preserving the data-loss guard.
  The integrated native PostgreSQL/HTTPS product browser smoke, WASM Clippy,
  formatting, source, checklist and repository hygiene checks pass.
  Native workflow URLs now retain the project/tab and selected target, saved
  draft, release or plan, using the retained fragment names. Initial session
  restoration and password/token/LDAP login route through scoped native reads;
  no unsaved SQL, credentials or approval evidence is restored from a URL.
  Saved drafts keep their own target, including a binding outside the first
  inventory page. Schema and target links also resolve a selected binding outside
  that page. History retains profile-ID filters and old query-string permalinks,
  canonicalizing them so later navigation is not pulled back into history.
  Explicit sign-out/password change clears the URL's workflow context.
  Focused native HTTPS/Chromium checks pass saved-draft reload, retained release
  inspection, plan focus, schema/target selection, instance project selection,
  reference/account links, history target/plan/profile filters, uppercase UUIDs,
  login continuation, malformed and cross-project identities, HOLD reads and
  denied reads after membership revocation. Navigation leaves draft revisions,
  plan/approval state, audit, snapshot and job counts unchanged. An initial test
  used same-document fragment navigation without reload; opening a fresh document
  corrects that harness assumption. WASM Clippy and formatting pass.
  The integrated native PostgreSQL/HTTPS product browser smoke also passes with
  workflow URL checks, explicit sign-out context clearing and the existing
  independent reviewer, execution-history and query-permalink scenarios enabled.
  Source, checklist and repository hygiene checks pass for the updated tree.
  The native browser shell now retains the existing light/dark palette, local
  theme controls on login/workspace screens, current-navigation markers, an
  assigned-project selector and route-specific workspace refresh. Mobile sidebar
  navigation closes on selection, backdrop click or Escape; Escape restores
  button focus. Its icon uses inline SVG rather than requiring a font glyph.
  Theme/menu updates patch DOM attributes without replacing password or SQL
  controls or making API requests. Screen changes reset the viewport before any
  explicit plan focus; local display changes preserve the active form and scroll.
  Project selection reloads scoped data and clears prior project details. Sign-out
  and refresh now share the retained unsaved-draft guard with project navigation.
  Project inventory is cleared on account changes and denied project reads remove
  its cached selector row. Theme state remains local to the current page.
  Focused native HTTPS/Chromium checks pass theme colors/metadata, exact form-node
  retention, mobile menu/Escape/backdrop, project switching, rejected unsaved
  refresh/logout/switch attempts before network I/O, cross-account cache isolation,
  lost membership, escaped names and unchanged draft/audit/job counts. The current
  integrated product browser smoke passes with SVG/scroll checks and all existing
  author, independent-reviewer and retained-history scenarios. Desktop/mobile
  screenshots were inspected locally. An initial fixture matched both login and
  setup usernames; its locator now scopes to login. Backdrop clicks target the
  exposed area outside the sidebar. WASM Clippy, formatting, source (517 authored
  files), checklist and repository hygiene checks pass.
  The selector denial check also passes through global Instances refresh, where
  the route itself is not a project route: a scoped project 404 removes its cached
  row before rendering the failed read. The current integrated product smoke
  passes with that case and cross-account isolation enabled.
  Native readiness now shares one unfinished metadata read across concurrent
  callers. HTTP timeout or client cancellation leaves that observation occupied
  until it settles; later requests start a fresh read rather than caching a late
  ACTIVE result. GET/HEAD retain the original ready/unavailable JSON, one-second
  response deadline and independent liveness behavior. ACTIVE and RESTORE_HOLD
  remain ready with targetAvailability UNVERIFIED. Focused unit/HTTP tests pass
  coalescing, timeouts, client cancellation, failed/closed observations and secret
  redaction, without any target work.
  Native lifecycle records now include startup started/ready/failed and shutdown
  started/complete/failed/timeout, with fixed configuration/metadata/web-assets/
  listen failure codes. Readable regular browser assets are required before
  listening. Missing/empty assets, directories, symlinks and FIFOs fail closed
  without exposing paths. Signal handling is registered before startup I/O;
  readiness and the private worker startup gate cannot follow a recorded shutdown.
  The API watchdog retains a 25-second shutdown bound. Actual local HTTPS/WASM
  smoke passes configuration/metadata/assets/listen failures, cancellation during
  startup, normal signal shutdown and read-only restored startup, with exact
  lifecycle records and no credential renewal or metadata activation.
  Native project/environment/draft names and instance, assignment and target
  evidence reasons now use the retained ECMAScript whitespace rules. Rust's
  default trim differed for BOM and U+0085. Private-PostgreSQL differential
  requests reproduce the original mismatch, then pass persisted name comparison
  and normalized exact draft saves without a new revision. Project creation
  retains zero implicit grants. Vault instance names/reasons, assignment/option/
  binding reasons and target-identity evidence reasons pass the corresponding
  runtime API checks. The core target-owner validator also rejects a BOM-only
  owner while retaining literal U+0085, matching the retained envelope encoder
  and verifier. Ten additional differential cases bring the core total to 1,228.
  The current full product integration, core tests, affected Clippy, formatting
  and source checks pass. The matching r7 default-Dockerfile image also passes
  the exact-filesystem namespace runtime smoke described in RUST6. RUST4 remains
  open for the complete browser/API parity audit.
  Native typed JSON requests now distinguish an omitted optional property from
  a supplied null. Project creation rejects a null description; draft create/save
  rejects null fields that previously erased the exclusive sql/files shape or
  allowed expectedRevision on creation. Differential requests reproduce the
  prior unintended project creation, then pass with unchanged project/grant/
  draft/revision/audit/job/attempt counts on every rejection. JSON numeric ports
  in instance registration retain JavaScript Number semantics: integral decimal
  spellings pass validation but still require the database-management grant;
  fractional, out-of-range, string and null ports are rejected. Managed vault
  registration also passes with a decimal-spelled integral port. Draft detail
  and target-identity evidence reads now reject unexpected query fields with the
  retained 404 contract. The full private-PostgreSQL product integration, affected
  Clippy, formatting and source checks pass. The matching r8 artifact passes the
  exact-filesystem namespace runtime smoke and post-smoke source/bundle/archive
  integrity checks described in RUST6.
- [ ] **RUST5 — Protected Oracle runtime and operators:** the public-key-only
  `kelryvo-vault` crate and privileged `kelryvo-runtime` resolver interoperate with
  retained format-1 ciphertext in both directions. Scope/tag/encoding tampering,
  weak/private-key confusion, rotation, revocation, missing-key rollback and HOLD
  vetoes pass targeted tests. The server's production dependency graph excludes
  the private runtime. The new `kelryvo-operator` executable passes actual-process
  tests for schema initialization, seed-once actor credentials, coverage-checked
  membership activation, explicit membership/deployment/database grants and
  revocation audit. Seeding never extends or revives credentials.
  Native `inventory declare|assign|release|target-option|status` now replaces the
  manual inventory operator. `local-inventory ACTION PRIVATE_CONFIG` retains
  the private local configuration and matching loopback URL boundary. Mutations
  read bounded JSON from stdin, reject app/worker OS UIDs and retain catalog/
  schema/lifecycle locking and ACTIVE metadata guards. Manual references preserve
  stable IDs, literal owners, route ownership, immutable declared facts, exact
  retries and OS-UID audit. Assignment/release/transfer retain schema CAS and
  history. Operator target options freeze eligible current profile/route facts,
  container lineage and owner/namespace stream, append one immutable CAS revision,
  and expose the existing redacted projection. The CLI accepts provisional
  metadata only; caller-supplied observation/verification claims are rejected.
  The focused --inventory-only private-PostgreSQL test runs the actual executable
  through declaration/retry/rollback, assignment/transfer/release, stale and
  concurrent option updates, private-reference/forged-field rejection, immutable
  history, HOLD write refusal and historical status reads. Retained Node readers
  agree on native declarations/options. Actual local status additionally passes
  a loopback-only relay to that private PostgreSQL socket, with a matching private
  config/password and read-only test role; socket/query URL overrides are refused.
  Credential snapshots and zero execution jobs/attempts remain unchanged.
  Operator Clippy and formatting pass. No Oracle or external infrastructure is
  contacted by these inventory checks.
  Native `credential-rotate developer|approver` now adopts the desired private
  role-token file, revokes prior credentials/sessions and retains metadata
  revocation audit. Exact active-token retries preserve expiry, while retired,
  expired or foreign tokens cannot be adopted. Root-only `credential-recover`
  requires a witnessed `sf_product_restore_*` database, exact RESTORE_HOLD lineage,
  audit and owner markers; it issues historical-read credentials without clearing
  HOLD. Root-only `password-reset` and `password-disable` preserve the retained
  scrypt-v1 format, LOCAL credential anchor, username ownership and password audit.
  Reset reads bounded private JSON `{username,password}` from stdin; no password
  or token is accepted in argv or printed. Reset/disable retire prior password
  and browser sessions without changing roles or project grants. Native root
  process smoke passes against projected root-owned private fixtures, including
  actual API password login, rotation invalidating the old anchor, username
  conflict, disable, unchanged grants, restore veto and witnessed historical-read
  recovery with stable retry expiry. The complete operator suite, workspace build
  and Clippy pass.
  Native `local-credential-rotate|local-credential-revoke ROLE PRIVATE_CONFIG`
  and `local-credential-recover PRIVATE_CONFIG` preserve the legacy private JSON
  configuration, insertion order, v1 journal and shared nonblocking flock. Actual
  SIGKILL tests cover all four durable checkpoints; native and retained JavaScript
  recover each other's journals. Recovery performs no PostgreSQL credential writes
  or migration replay, preserves committed expired credentials without renewal and retains
  corrupt evidence for inspection. Native CLI smoke covers rotation, derived
  browser revocation, explicit revoke/reissue, lock contention and rejection of
  symlink or nonprivate configuration files.
  Native `local-password-reset|local-password-disable ROLE PRIVATE_CONFIG` reuse
  the container password lifecycle under the invoking local operator's UID. Their
  private metadata URL must retain the legacy loopback host, allowed database,
  permitted username and exact configuration password; query overrides, fragments
  and remote destinations are rejected before connecting. Both local interfaces
  read `KELRYVO_SECRET_DIR/database-url`; password reset reads bounded private
  `{username,password}` JSON from stdin. Container password commands remain
  root-only. The complete operator suite passes, including actual local reset,
  native API password login, disable/session revocation and OS-UID audit through
  a test-owned loopback proxy into private PostgreSQL. Workspace build, operator
  Clippy and repository hygiene pass. The default delivery replacement and live
  Oracle qualification remain pending.
  Native durable
  job ports now retain STARTED/ACK/receipt order, proof-bound validity and atomic
  terminal projections. Scalar receipt checks cover the full persisted statement
  count without loading an unbounded receipt history. PostgreSQL comparisons with
  the retained adapter cover complete/NOOP lifecycles and expiry recovery; tests
  cover receipt gaps, immutable leases/events/receipts, rollback of terminal
  bundles, worker/token/scope mismatch, concurrent expiry and metadata-generation
  changes. This adapter never creates a fresh claim or dispatches Oracle SQL.
  `kelryvo-operator recover-expired JOB_ID METADATA_GENERATION_ID` passes an actual
  process test: it records the OS UID and moves only expired trusted attempts to
  HOLD, including after requester credential loss. It cannot extend/reclaim a
  lease, restore permission or replay SQL, and it refuses metadata restore HOLD.
  Scoped request listing/detail/cancellation APIs preserve the retained HTTP
  projections, actor-bound job/event cursors and pre-admission cancellation CAS;
  they confer no worker authority. Historical completion readers now reverify
  approved source context, exact target-binding digests, central event/receipt
  snapshot hashes and independent
  current reconciliation review. PostgreSQL comparisons accept the same synthetic
  retained completion as the old verifier and invalidate it after review authority
  loss or later central evidence; duplicate resolution records are rejected.
  Reading never changes HOLD or qualifies fresh Oracle effects. Native OCI session,
  nonce-bound same-session target mutex and append-only target ledger modules now
  build under the distinct `kelryvo-oracle-rust-oci-0.6.3` driver profile. They retain
  manifest/receipt chains, complete applied prefixes, unresolved file state,
  head CAS and poison-on-uncertain-commit behavior. The session uses a fixed TCPS
  descriptor with certificate DN and private wallet inputs, no application-level
  reconnect/retry, and explicit commit after approved statement dispatch. Actual
  Direct OCI/TCPS metadata interoperability has the bounded live result below;
  installed worker and Oracle execution qualification remain pending.
  A native supervisor now uses bounded one-invocation child IPC, exact worker/
  scope/invocation receipts, deadline/retirement cancellation, TERM/KILL escalation
  and verified reaping. An unreaped child prevents further work. The new
  `kelryvo-worker` executable supplies protected-config expiry recovery and polling;
  its EXPIRE_ONLY mode can only move expired trusted attempts to HOLD. Smoke tests
  pass a complete ledger lifecycle/reopen and lost-commit ACK in an in-memory port,
  plus actual native child protocol/exit and wrong-worker rejection against private
  PostgreSQL. A native worker library now reads and rechecks waiting requests,
  live local/browser/identity authority, independent approval, source/profile
  revisions, retained release bytes and target/validation currentness. It
  materializes the exact approved native-parser statement sequence, retains
  untrusted history as HOLD, and atomically commits the admission proof, initial
  lease, job projection and audit. Target/container conflicts and retained central
  completion witnesses veto divergent target history. The coordinator adapter
  retains authority/catalog locks through dispatch and final projection, persists
  STARTED before target calls, and never reclaims or retries an unknown ACK.
  Private PostgreSQL/native API smoke passes success with exact bytes/two receipts,
  a second independently approved NOOP, unknown ACK to HOLD without replay,
  deployment-grant revocation after the initial snapshot, and untrusted target
  history retained as HOLD without an admission proof or attempt. Its target is
  explicitly
  synthetic; none of these fixtures qualifies an Oracle installation or client.
  The restricted native Oracle host now binds a single-use installed permit to
  exact job/plan/profile/statement digests, independently reattests writer/ledger
  identity, holds the original target mutex, verifies every ledger mutation against
  its expected model, and claims a unique per-statement dispatch before SQL.
  Same-session cleanup runs once even after poison or callback failure. Wire smoke
  passes two statements through the complete target ledger, receipt chain and
  reopen NOOP, refuses absent-history/empty-schema inference, and proves that lost
  ledger or writer COMMIT ACK never permits replay. Read-only native catalog ports
  now project physical identity and verify compiled NUMBER/VARCHAR2 BYTE table/
  index postconditions; exact grant/account and protected object/source witnesses
  are implemented and compile. Catalog smoke accepts exact compiled effects and
  rejects changed column types and proxy sessions. No actual Oracle connection is
  used by these fixtures, and installation attestation remains unqualified.
  Private native installation configuration now binds exact binary/client/wallet/
  source-identity artifacts, operator review digest, expiry, metadata destination,
  generation, route, separate principals and schema scope. It rejects symlinks,
  mutable/foreign-owned ancestor directories, replaced artifacts, mismatched
  source identity, implicit client initialization and metadata URL endpoint
  overrides. The concrete managed host reattests physical identity, grants,
  protected sources and route/installation journal, verifies Oracle postconditions,
  and requires both central STARTED and target-ledger STARTED before retaining a
  unique fsynced dispatch preimage. Independent observer ledger reads and central
  receipts remain separate witnesses. `execution-service`/`execution-child` now
  connect these capabilities to bounded polling and one-job supervision, alongside
  expiry recovery; job/control messages cannot select credentials or executables.
  Native format-2 installation records select the writer in assignment/profile
  currentness and public runtime projection. Legacy Node records remain ineligible.
  Private smoke passes protected manifest/artifact mutation and URL rejection,
  native-vs-legacy journal, generation/revision/latest-record fences, retained
  dispatch-query schema checks and execution/expiry command-mode isolation.
  These checks use dummy OCI/wallet artifacts and never load or connect Oracle.
  The native worker binary now provides OS-root-only `installation-preflight`
  and `installation-record`. Preflight independently reads the three session
  identities, exact grants and protected sources with no ledger append, mutex
  acquisition or migration dispatch. Recording accepts only an unexpired,
  non-deserializable same-process preflight, rechecks artifacts and the exact
  ACTIVE generation/route under catalog/governance locks, and atomically appends
  the installation journal and project audits. Exact retries reuse the reference;
  admitted/held source jobs veto replacement. Root checks reject worker-writable
  configuration, client/wallet artifacts and ancestor directories before OCI is
  loaded. A bounded private-metadata smoke passes root-vs-worker authorization,
  atomic/idempotent audit projection, expiry and concurrent route change, using
  explicitly synthetic preflight evidence. It confers no Oracle acceptance.
  Native provisioning now validates the retained root installation policy,
  derives the same connection-bound principal names, prechecks accounts/schema
  emptiness/catalog grant options and dangerous triggers/public lock access, and
  executes only the compiled five ledger/mutex DDL units and scoped grants.
  Every DDL has a durable pending checkpoint; lost ACK or persistence failure
  stops without retry, cleanup DDL, ledger reset or automatic continuation.
  `installation-prepare` binds a root policy and native template, resolves the
  current vault credential privately, generates exclusive private credentials,
  performs fresh provisioning and source readback, then runs read-only preflight
  and writes a prepared configuration, service input and redacted journal. It
  neither records runtime authority nor activates/publishes a running service.
  Synthetic workflow smoke passes the complete scoped sequence, ledger session
  separation, checkpoint redaction, protected/injected owner rejection, unknown
  DDL ACK without replay, and failed pending persistence before any effect. Native
  preparation input/journal checks pass exact policy/principal matching, atomic
  private checkpoint replacement and refusal to overwrite retained credentials.
  Native `installation-publish` now preflights the exact prepared credentials,
  translates only their private runtime location, retains a root archive, and
  stages a fixed six-file payload with exclusive temporary files, descriptor-based
  ownership and fsync. The installation configuration is published last under the
  same ACTIVE-generation/route/ADMITTED-or-HOLD veto and metadata journal/audit
  transaction. Unknown metadata outcome retains a pending publication checkpoint;
  no old bytes, attempts or SQL are replayed. Synchronous per-thread filesystem
  identities stage as UID/GID 10002 using existing SETUID/SETGID capabilities,
  without adding DAC_OVERRIDE, and restore the operator's identities afterward.
  Execution service/child commands require UID 10002; operator commands require
  root. Native `installation-refresh` retains passwords, physical target,
  generation, principals, schema/protected-owner scope, protected sources and the
  existing witness directory while independently qualifying a new reviewed
  artifact/template. Old expiry/artifacts constrain scope only and never grant
  fresh authority. Refresh calls no provisioning/admin/ledger-writer path and
  prepares a new archive without automatic recording or activation.
  Private smoke passes fixed-file/last-config staging, symlink replacement without
  following its target, exact filesystem repair, archive round-trip, scope/witness
  vetoes, metadata rollback on staging failure, and command-plane isolation.
  Installed Oracle provisioning and
  full writer/observer qualification, live native recovery evidence production,
  managed backup/restore and historical-archive qualification remain incomplete.
  The native fixed-policy controller is available as root-only
  `kelryvo-worker installation-watch PRIVATE_CONTROLLER`, with
  `installation-init-witness PRIVATE_DIRECTORY` for an empty witness handoff.
  Its private format-1 request contains `stateDirectory`, `databaseUrlFile`,
  `policyFile`, `installationTemplate` and `vaultKeyFile`, all absolute protected
  paths. State uses a separate format-2 journal and an exclusive process lock;
  legacy format-1 state is retained and rejected for operator review. Inputs,
  policy, template, vault key and metadata URL are pinned for the running process.
  One matching INSTANCE_MASTER connection is selected from ACTIVE metadata.
  A durable pending attempt precedes provisioning; an incomplete result cannot
  be replayed even after restart or a connection/source/policy revision change.
  Only a complete native PREPARED archive can repair that pending checkpoint.
  Refresh reuses the existing principals/passwords/history and independently
  qualifies the new template, retaining old expiry/artifacts as scope context
  only. Filesystem repair uses the existing fresh read-only preflight and
  ADMITTED/HOLD publication veto; it cannot repeat provisioning. Writer and
  read-only observer configurations are published separately, with their
  manifests last. Exact observer bytes are retained without repeated writes.
  `--controller-only` private PostgreSQL smoke passes initial installation,
  repeated readiness, filesystem repair, revision refresh, pending recovery,
  durable-write failure and no replay across restart/revision changes using
  explicitly synthetic Oracle ports. Native observer payload/authorization and
  bootstrap library checks pass. The private namespace smoke also runs the real
  root controller, with its reviewed template/key/artifact validation, against
  loopback TCP forwarded only to private PostgreSQL. It waits for an instance,
  excludes a second controller via flock, stops on SIGTERM and preserves the
  populated UID 10002 witness under the existing four bootstrap capabilities.
  No fixture instance is registered and no Oracle session or job is created.
  Actual Oracle controller/provisioning and companion Helm integration remain
  unqualified; the companion chart still uses the retained runtime. The local
  default image recipe is native, while release replacement remains pending.
  Native held completion is now implemented in the privileged runtime/worker.
  Its evidence kernel uses the production target-ledger replay verifier through
  a closed SELECT-only snapshot adapter, verifies every STARTED/ACK/receipt and
  retained dispatch UUID/checkpoint, and preserves the original canonical
  evidence digest. Differential synthetic checks match three accepted snapshots
  and 29 corrupt, incomplete, misbound or failed-gate rejections. The metadata
  adapter reuses the bounded historical snapshot reader, holds catalog/target,
  lifecycle, generation and job locks, and requires a current independent review
  of the exact evidence digest before appending EXECUTION_RECOVERED_APPLIED.
  Private PostgreSQL smoke passes read-only preview, missing-review rejection,
  rollback on target-close failure, idempotent confirmation, reviewer revocation
  and unchanged HOLD job/attempt/receipt state. No new schema or public evidence
  upload route is introduced.
  The consolidated private-PostgreSQL run exposed a recovery-test assertion that
  counted all recovered-completion audit rows, including the earlier API fixture's
  unrelated witness. Its count now binds organization, project and job. No product
  audit rows are removed or reinterpreted. The worker library subsequently passes
  with the earlier API evidence present; admission, installation, process and
  recovery checks also pass on a fresh isolated cluster. An interrupted final
  installation test is rerun through --worker-only rather than reported as passing.
  Remaining workspace doctests, 1,218 native/reference comparisons, native OCI
  contract/assembly checks and schema/backup/managed-fixture compatibility exports
  pass. Local startup smoke passes after the lifecycle update. These checks do not
  qualify Oracle; the native runtime image remains separately checked in RUST6.
  `kelryvo-worker held-preview JOB_ID` and `held-confirm JOB_ID RECONCILIATION_ID`
  require OS UID 10002 and load only the fixed staged native installation.
  The installed path rechecks reviewed artifacts, installation record, route,
  retained native-parser source/statement identities, TCPS sessions, grants,
  protected objects and target postconditions. It holds a nonce-bound native
  mutex through evidence acceptance and requires unchanged ledger preimages.
  Other user sessions in the target PDB or root veto its maintenance-only
  no-other-writers check. Dispatch preimages come only from the protected
  append-only installation journal. Stdout contains bounded digest/status facts,
  with no raw SQL, credential, target diagnostic or dispatch capability. CLI UID
  and caller-selected-path rejection pass. Actual Oracle held-preview/confirm,
  OCI/catalog interoperability and live recovery qualification remain untested;
  synthetic facts and historical installation records cannot qualify them.
  A user-supplied private Oracle configuration was tried on 2026-11-10 using
  the unchanged native OCI discovery driver and a separately verified official
  Instant Client 23.26.4.0.0 archive. The file supplied no port or wallet, so the
  bounded probe used TCP/1521 and required AES256 encryption plus SHA256 integrity.
  The socket opens, but the native driver cannot establish a database session.
  A retained-driver Thick-mode diagnostic with the same client and network
  configuration also fails before login with Oracle error 12547. No SQL, grants,
  migration, provisioning or installation action ran. This is an unresolved
  connection prerequisite at that point. Those failed TCP probes establish no
  Oracle session or query result. The later TCPS probe below supersedes that
  connection diagnosis; certificate validation remains required.
  Credentials and target identifiers remain only in private ignored files and
  are excluded from repository documentation and probe output.
  A subsequent offline driver review found that the OCI adapter rejected
  NUMBER(0, -127), the unconstrained expression metadata documented by the pinned
  oracle 0.6.3 dependency's SELECT-10 fixture. Native discovery's SELECT-1 probe
  and CASE flags can use this metadata. A regression first reproduces the
  rejection, then passes after accepting that NUMBER form alongside scale-zero
  columns. Numeric catalog facts are read as exact decimal text and checked as
  i64; fractional, exponent, nonfinite, overflowing and floating-type inputs are
  rejected without rounding. NULL remains NULL. The two conversion regressions
  and five catalog/discovery/ledger tests pass. These are offline adapter checks,
  not successful Oracle queries. The r8 images predate this driver correction;
  their source-bound results must not qualify the corrected runtime.
  The corrected workspace build, runtime all-target Clippy, formatting, source
  checks and checklist validation also pass; no broader acceptance was repeated.
  Native controller review additionally found that prepare and publish shared
  one process even though OCI initialization deliberately accepts one fresh
  initialization only. The controller now invokes each prepare, refresh and
  publish action in a separate instance of its fixed root-controlled Rust binary.
  Child environments contain only fixed PATH/LANG/TZ, stdin is closed and captured
  output is bounded and validated without forwarding private diagnostics. Stop
  and deadline paths TERM/KILL and confirm reaping before returning; unconfirmed
  disposal retires the controller. Shutdown lets that cleanup finish rather than
  cancelling tick. Existing pending journals remain durable before provisioning;
  neither cancellation nor a failed child grants a fresh DDL attempt. The focused
  controller suite passes four checks, including actual child PID/environment/
  timeout/cancellation behavior and private-PostgreSQL orchestration/replay vetoes.
  Worker all-target Clippy passes. The local r8 checkpoints also predate this
  correction. Successful native Oracle installation remains unverified.
  Native discovery now has an acceptance producer. Root-only
  `installation-observer-scope PRIVATE_PREPARED_DIRECTORY` prints the exact native
  qualification scope without creating a review, contacting Oracle or publishing
  files. A separate protected native review binds source, image, worker/client/
  wallet artifacts, expected physical identity, route/certificate, server version,
  schema/protected-owner scope, authorization and expiry to reviewed evidence.
  `installation-observer PRIVATE_OBSERVER_REQUEST` requires that review and a fresh
  non-deserializable OCI Inspection, then rechecks the already recorded native
  installation under metadata/catalog locks before staging observer-only inputs.
  It cannot provision, register an installation, append another installation audit
  or dispatch a migration. The controller invokes this action in another fresh
  Rust process only when the matching reviewed manifest is missing. Without
  discoveryReviewFile it retains unaccepted format-2 discovery and API readiness.
  Qualified format 3 binds the complete current manifest, connection/revision,
  native installation and explicit review. Legacy liveAcceptance remains rejected;
  format 2 cannot acquire native acceptance. Each OCI discovery child reloads its
  configuration/artifacts after network I/O and rejects a changed or expired
  installation. Only exact observed identity, the observer's visible own schema
  and no critical catalog limitation can produce public verificationAcceptance.
  Fixture provenance, identity gaps and truncated inventory remain unaccepted.
  Approved schema visibility stays scoped; other owners remain unknown. The
  existing IPC and retained Node verifier accept the same public evidence without
  exposing private review/artifact paths. The final private-PostgreSQL worker run
  passes 32 checks, including producer/transaction guards and unchanged audit
  counts, native controller/process tests, admission, installation, recovery and
  no-replay behavior. Five bootstrap checks pass format-2/3 private staging and
  legacy/escape refusal; the initial added fixture failed only because its
  create-new helper was used to replace an existing test file and was corrected.
  Workspace build and worker/launcher all-target Clippy pass. These synthetic and
  private-metadata checks do not qualify actual OCI/catalog/Oracle operation.
  No qualification review was created for the user-supplied endpoint; direct
  read-only interoperation below does not qualify the installed execution path.
  The Helm candidate now optionally projects discovery-review.json from the same
  root-only Secret using oracleRuntime.nativeDiscoveryReview=true. Default and
  retained modes keep their prior keys, mounts, capabilities and PVCs. Fresh
  candidate lint and all retained/native assertions pass against the unchanged
  pinned companion; no chart or cluster was installed or changed. The r8 image
  results do not cover these later worker, bootstrap and patch changes.
  Follow-up on the supplied endpoint confirms an authenticated TLS listener on
  the same port: a credential-free TLS 1.3 handshake passes system-CA and hostname
  verification. The initial TCP transport assumption caused error 12547. A TCPS
  attempt then reports error 28759 because its wallet is missing. A temporary
  trust-only wallet is prepared privately using official Oracle PKI 23.26.4.0.0,
  checked against its Maven repository SHA-256. Its sole trust anchor comes from
  the verified chain and matches the system CA store; it contains no client key
  or database credential. No certificate verification is disabled. The final
  host-built Rust OCI driver connects through its unchanged TCPS descriptor with
  an exact verified certificate DN and Instant Client 23.26.4.0.0 to server
  23.26.4.1.0. A read-only transaction passes fixed SELECT-1/CASE numeric queries,
  session identity, physical identity and the native discovery collector. The
  collector returns PARTIAL with matching identity and null verificationAcceptance;
  incomplete catalog visibility is retained. The transaction is rolled back.
  This verifies direct Linux/amd64 read-only driver/collector interoperability
  under the supplied account, not a configured observer/writer installation,
  migration dispatch, recovery, native review, exact-image Oracle execution or
  other server/architecture qualification. No DDL, grants, provisioning, migration
  or database data changes run. Credentials, identifiers, CA wallet and diagnostic
  inputs remain in private ignored files; the application image gains no Oracle
  client, wallet or PKI tool dependency.
  Direct native components now also pass against a disposable local Oracle Free
  23.26.3.0.0 fixture over certificate-verified TCPS, using new local credentials
  and isolated network/PID/IPC/UTS/mount namespaces. No supplied endpoint is changed.
  The first run completes 45 provisioning steps but rejects trigger readback:
  SF_TARGET_LEDGER_EVENTS_IMMUTABLE has 33 characters and was wrongly checked
  against the 30-character principal limit. Source observation now accepts bounded
  Oracle object identifiers up to 128 bytes as bind values; principal limits,
  source continuity and read-only behavior remain enforced. The regression checks
  the actual trigger name and source digest, rejected oversized/injected names
  and unchanged principal limit. Seven focused runtime/catalog/provisioning tests
  and runtime all-target Clippy pass; worker-only now includes library regressions.
  A fresh schema/principal set passes all 45 compiled provisioning steps, exact
  three-principal grants, protected object/source witnesses, two-session mutex
  exclusion, fixed CREATE TABLE, catalog postconditions, committed ledger readback
  after closing its writer and mutex release/reacquisition. The first fixture and
  journal are retained without replay. Results are in
  .cache/oracle-free-local.ct8i_c09/write-smoke-2/. This host-built component probe
  uses the corrected runtime and a disposable-fixture authority adapter. API
  admission, installed worker publication, metadata authorization and recovery
  remain untested against this Oracle; it confers no production qualification.
  A fresh isolated target directory resolves stale private build-cache failures;
  locked offline build and the actual executable run pass. The earlier private
  source snapshot/debug bundle and r9 OCI checkpoint predate this correction.
  Native `kelryvo-operator metadata-attest PG_DUMP PG_RESTORE OUTPUT` now captures
  the source database OID, owner/role, exact server version and native tool hashes
  in a fresh mode-0600 policy. `metadata-backup NEW_DIRECTORY EXTERNAL_WITNESS`
  and `metadata-restore BACKUP_DIRECTORY EXTERNAL_WITNESS` read that private
  `postgresql-backup-policy` alongside `database-url`; restore additionally reads
  `database-admin-url`. Paths are absolute, output parents are operator-owned
  mode-0700 directories, and the witness stays outside the archive directory.
  Tools must be protected native ELF files matching both their hashes and the
  exact PostgreSQL server version. No credential is passed in command arguments.
  The backend retains the v1 data-only archive/manifest/witness envelope, streamed
  archive hashing, exported repeatable-read snapshot and strict pinned catalog
  fingerprints. Restore verifies the witness and complete archive TOC before
  creating a new database, imports only into an operator-owned unpublished
  schema, restores its evidence guards and installs a new RESTORE_HOLD generation.
  Waiting/admitted jobs and claimed attempts become HOLD without extending leases;
  existing credentials are revoked and receipted history remains unchanged.
  Source metadata is untouched. Failures can leave a private staging directory
  and quarantined destination for inspection; the command never drops/replaces a
  database, publishes a restored instance or resumes execution.
  Actual-process smoke on private PostgreSQL 16.15 passes policy capture, tool-pin
  and witness rejection before output/destination creation, current-schema backup
  and restore, unchanged source data, receipt preservation, HOLD/no-replay and
  credential revocation. A separately pinned native pre-vault reconstruction
  (`19206cc9…`) upgrades into the current schema under HOLD. It differs from the
  retained historical identity fingerprint (`b05328c7…`); no old archive is
  reprofiled or attested implicitly. The exporter retains all fifteen historical
  profile identities/bootstrap candidates. Historical archive interoperability
  was unqualified at that stage; later retained results cover the five exact
  archive/profile cases summarized in the current audit, not production restore. The native managed wrapper now implements the retained
  Kubernetes resource/cluster attestation boundary. `managed-attest OUTPUT`
  captures the existing format-1 cluster CA/API endpoint, StatefulSet, Service,
  Pod, PVC/PV, Secret UIDs and pinned PostgreSQL 17.10 image identity.
  `managed-policy ATTESTATION PG_DUMP PG_RESTORE OUTPUT`, `managed-backup
  ATTESTATION NEW_DIRECTORY EXTERNAL_WITNESS` and `managed-restore ATTESTATION
  BACKUP_DIRECTORY EXTERNAL_WITNESS` use fixed read queries and a Pod-specific
  loopback-only tunnel. Private `kubectl-tool` contains exactly `path` and
  `sha256` for the operator-selected native executable; private `kubeconfig`
  supplies cluster access. Both are mode-0600 files under KELRYVO_SECRET_DIR.
  PostgreSQL client policy remains a separate private file. Database passwords
  come only from the verified Secret, stay outside command arguments and are
  never written to the attestation. Target checks run before/after archive work;
  managed witness compatibility permits Pod/Secret replacement while retaining
  cluster, workload, storage and image identities. Tunnel shutdown requires child
  reaping and reports an unconfirmed cleanup as failure. Cancellation retains
  kill-on-drop, and no path invokes Kubernetes mutations or container execution.
  The native/retained verifier agrees on the shared fake-resource fixture,
  credential extraction and changed Pod/PVC/endpoint/image/CA rejection. Actual
  native CLI attestation and a native fake-kubectl tunnel pass locally, including
  loopback binding, confirmed reaping, overwrite refusal and private-file checks.
  These tests contact no cluster. The full operator checks, workspace build and
  Clippy pass. At that stage managed PostgreSQL 17.10 backup/restore, historical
  archives, external client packaging and production restore were pending. Later
  standalone/archival results keep their exact scopes; actual managed-cluster,
  admitted-job archive restore and production DR acceptance remain separate.
  At that earlier stage native Rust Oracle execution had not been
  qualified. Current exact-source installed qualification is summarized above;
  historical installation records never authorize a new binary implicitly.
  Native read-only discovery collection now uses fixed SYS catalog queries for
  connection testing, physical database/PDB identity, schema visibility, and all
  nine table/column/constraint/view/sequence/index/dependency inventory reads.
  Owners remain bind values. Missing catalogs, foreign-owner visibility, root
  containers, identity mismatch, partitions, expression indexes and incomplete
  definitions retain explicit limitations; incomplete metadata never proves
  absence. The collector cannot connect, execute SQL effects, commit or acquire
  execution locks and never emits verification acceptance. Three catalog fixture
  tests pass; these are not actual Oracle/OCI qualification.
- [ ] **RUST6 — Native delivery and replacement:** finish native dependencies and
  license provenance, container/operator commands and configured CI integration;
  qualify the replacement artifact before retiring the old runtime. Existing CI
  and artifact gates must remain enforced.
  The default Dockerfile now builds the native release binaries, parser and
  Rust/WASM UI; the context allowlist and compiled source inventory include that
  exact recipe and ignore file. The duplicate candidate Dockerfile is removed.
  The existing two-platform containers job retains exact-OCI loading, isolated
  PostgreSQL/HTTPS governance and customer Compose pilot checks. Its smoke now
  calls native operators, checks release/source identity and package inventories,
  and uses system tools instead of requiring Node/JVM inside the image. A worker
  awaiting its first installation must leave the API ready without acquiring
  execution authority. Both platform jobs must still succeed before OCI assembly;
  source/security/publication gates remain unchanged. The customer pilot smoke
  extracts the matching native operator from the tested image, bootstraps through
  private JSON stdin and retains password login, explicit grants and Git import.
  Native Compose commands now preserve a bounded validated COMPOSE_PROJECT_NAME
  while retaining the fixed local Docker socket; clearing that selector would
  address a different project than the caller's isolated installation. Three
  pilot unit tests and the native least-privilege private-PostgreSQL pilot smoke
  pass. Native CLI/operator/server Clippy and formatting pass. The configured
  bounded reference delivery check passes 87 JavaScript and three Python tests,
  source/type/web checks and the 94-package dependency grant closure. The private
  namespace smoke now runs the same HTTPS governance flow against native binaries,
  including credential rotation and reason-only retirement. Its host Node runner
  stays outside the image/root fixture. The debug bundle passes with execution
  enabled before the first installation, one retained cancelled job, zero execution
  attempts, independent approval, exact grants, CSRF/session revocation, native
  PID 1 and controller/UID/capability/socket/repository checks. Controller startup
  has a bounded 20-second fixture allowance because debug artifact hashing exceeds
  five seconds under compilation load; production deadlines are unchanged. Docker Engine
  smoke and remote amd64/arm64 CI are not locally qualified; no daemon is started,
  and no image, chart or deployment is published or changed externally.
  A rootless BuildKit build of the default Dockerfile produced the preceding
  linux/amd64 release checkpoint, including project inventory/profile retirement.
  The local OCI archive is 151,953,408 bytes with seven integrity-verified blobs;
  its application manifest is
  `sha256:1a818d7b7eb7a684640a60d5101d7c6810a8e93ad7ae1c005d468ee9243e1c2c`.
  Config digest is
  `sha256:a59ef460ca785c4fe3f1918cdf3d9ad4d5dfe836cdce532e8f047c066b9755c6`;
  compiled source-tree digest is
  `3576143d82f9ff4227a8d26dcbbeae092cee5e3231c3295d2176f1611df7c1c0`.
  Independent comparison confirms both source membership and bytes for all 269
  build inputs at that checkpoint and recomputes their original-mode fingerprint.
  All five Debian-built release executables report the same identity. The native
  entrypoint, root user, empty CMD, architecture and labels are verified; runtime
  shell checks find no Node/JVM/Python/Cargo/rustc/wasm-bindgen executable. Application
  inventory passes in builder/final image and Debian inventory covers 119 packages.
  The exact exported image filesystem, using its actual libraries, passes the
  private namespace HTTPS governance/rotation/retirement/parser/WASM and native
  PID1/controller/UID/capability/secret/socket/repository/restart checks described
  above. Only the disposable test copy receives the private probe and fixtures.
  The exported filesystem and OCI archive remain unchanged. The artifact remains
  local-unpublished: these checks do not qualify a release source SHA, arm64,
  Docker Engine bridge/Compose interoperability, companion chart controller
  compatibility or live Oracle execution. The private builder is stopped after
  verification; no Docker daemon, registry publication or deployment is started.
  That checkpoint predates the subsequent manual-reference, target-option,
  target-binding, migration-analysis, password/account/connection UI and inventory
  operator ports. It does not qualify the current source; build and smoke
  a fresh final artifact after the remaining runtime migrations.
  A subsequent default-Dockerfile linux/amd64 build now includes the manual
  inventory/operator, target-binding, migration-analysis, password/account,
  connection/profile, schema-reference/baseline, workflow-URL and browser-shell
  ports. Its local unpublished OCI archive contains seven verified blobs and is
  152,374,272 bytes (mode 0600). Application manifest:
  `sha256:92e7ee35267b4a053cb7745d86c58b39a89aa0878009390b7bcab64fdfcfed95`;
  config:
  `sha256:ffe82e39f4ade502562cca3625d2884c69653dca2974e10155d4bba50baea635`.
  Archive SHA-256:
  `960ff69503e2cc82c500518b341aaffba09057c6c8222494b448dc1b1f37d103`.
  Compiled source-tree digest:
  `c685a162d36c9c1c2714f643fec3d6cf8ae07eee5b5e0b5fada97656f68f9919`.
  Independent host hashing reconstructs that fingerprint from all 303 original
  input paths, bytes and modes; the packaged source has exactly the same path
  set and bytes. The host inputs are rechecked after runtime smoke. All five
  Debian-built release binaries report one matching identity. Bundle inventory,
  native entrypoint/root-user/architecture/config labels, interpreter/compiler
  absence and all 119 Debian package copyright notice hashes pass verification.
  The same build's exported filesystem passes the private namespace HTTPS
  governance/parser/Git/WASM, independent approval, credential rotation, PID1,
  API/worker UID/capability/secret/socket boundaries, controller waiting/locking,
  witness preservation, restart and unavailable-discovery checks. Execution is
  enabled before first installation while API readiness remains available; the
  fixture retains one cancelled job, zero attempts and no Oracle connection.
  Only the disposable test copy receives private probes/configuration. Bundle
  inventory still matches afterward. The private rootless builder is stopped.
  The archive is local at
  `.cache/buildkit-overlay.ohRHJ7Bw/kelryvo-native-default-amd64-r3.oci.tar`;
  it remains `local-unpublished`, qualification NOT_RUN and releaseApproved false.
  This current-source checkpoint does not qualify a release source SHA, arm64,
  Docker Engine/Compose networking, companion-chart wiring or live Oracle.
  Further application-source changes require another matching artifact.
  The r8 default-Dockerfile linux/amd64 checkpoint includes the readiness,
  lifecycle, LDAP public projection, Git ref-error, projected-source and native
  controller/init/Helm changes below, plus the Unicode text compatibility fixes
  above and the supplied-null, numeric-port and read-query compatibility fixes.
  Earlier r4/r5/r6/r7 archives are retained as historical checkpoints.
  This archive is 152,435,712 bytes
  with seven integrity-verified blobs and mode 0600:
  `.cache/buildkit-overlay.ohRHJ7Bw/kelryvo-native-default-amd64-r8.oci.tar`.
  Application manifest:
  `sha256:f8af4aea05f53211d25eec921f9636fe2575b715399230f14cdba3e4860a42bd`;
  config:
  `sha256:a1887ce0838721d6653b6a7229c21593e004532d4a9c588c1a39b90fe2cdbcec`.
  Archive SHA-256:
  `1074122d3d387eb8fcdc44c709317cf6d8a8e4975df52102e57f50dd78c43855`.
  Compiled source-tree digest:
  `a2d0f3f5cba727b76cabbc209abc682be10f362d3933192103bdfb493e9d6531`.
  Independent comparison confirms all 311 source inputs, their original modes
  and the exact packaged path/byte set. The five release executables share that
  identity. Bundle inventory, OCI config/process-role checks, compiler/interpreter
  absence and all 119 Debian package notice hashes pass. The same build's exported
  filesystem passes the namespace PID1/UID/capability/socket/secret, controller,
  witness/restart and HTTPS governance/credential-rotation smoke, including the
  protected projected controller inputs, native state initialization and private
  wallet prerequisites. API readiness remains available before first worker
  installation with execution enabled; one job is cancelled, zero attempts are retained and no
  Oracle connection is opened. Post-smoke archive, bundle and source checks pass;
  the private rootless builder is stopped afterward. The preceding API checkpoint
  passed all 11 unit tests and the identity, product and repository integration
  tests together on one private PostgreSQL cluster. R8 passes the current full
  product integration, including supplied-null/port/query contracts, zero-write
  rejections, Unicode persisted names, exact draft retries, assignment/evidence
  reasons, actual retained route inventory and identity/Git comparisons. The
  unchanged core retains its passing 13 tests and 1,228 reference comparisons.
  Relative to r7, production changes are confined to five API modules' supplied
  property, numeric-port and read-query handling, with matching regression
  fixtures. Core, UI, parser, launcher, worker, operator and delivery source inputs
  retain their prior hashes and bounded validation evidence. The Helm patch is unchanged;
  its retained private candidate lint/assertion result still applies to those bytes.
  This remains local-unpublished, qualification NOT_RUN and releaseApproved false;
  the earlier arm64, Docker Engine/Compose, companion-chart and live Oracle
  limitations still apply. No publication, deployment or external mutation occurs.
  A focused exported-image contract is now available through
  `bash scripts/test-rust.sh --image-root-only ABSOLUTE_IMAGE_ROOT [ABSOLUTE_BUILDKIT_QEMU]`.
  It copies only a disposable test filesystem, then uses private mount, PID and
  network namespaces and a read-only image root. Identity/inventory checks drop
  all root capabilities and set no-new-privileges; the missing-mount launcher
  check retains only its required CHOWN/KILL/SETUID/SETGID set. It checks all five release identities against the image's
  source record, verifies the bundle with the actual image executable, checks
  native prerequisites and interpreter absence, confirms both unprivileged role
  UIDs and their operator refusals, and requires the intended worker/launcher
  refusal messages rather than accepting an execution-format error. The original
  exported bundle is checked before and after. The r8 amd64 image passes this
  focused contract. The optional emulator is staged only in the disposable copy;
  no host binfmt registration, Docker daemon, metadata or Oracle connection is
  involved. This check does not qualify TLS/PID1 supervision or a native arm64
  runner. A private arm64 preflight using the existing official BuildKit QEMU
  passes shell/child execution and actual kernel UID/capability/no-new-privileges
  checks. The unchanged default Dockerfile subsequently builds arm64 from the
  same 311 r8 source inputs. Build and follow-up verification both exit zero.
  The local unpublished ARM64 manifest is
  `sha256:5bea72ecb59d058215ad4ab37c9d2b435725e9f5a4a03362557c55c67fe26e6b`;
  the archive contains 151,010,304 bytes and retains source-tree digest
  `a2d0f3f5cba727b76cabbc209abc682be10f362d3933192103bdfb493e9d6531`.
  All five aarch64 release executables report the same r8 identity under QEMU.
  The read-only-root, empty-network namespace contract passes the real kernel
  UID/capability/no-new-privileges checks, intended role refusals, native bundle
  verification and missing-mount startup refusal. All 119 packaged OS notices,
  source bytes and OCI blob/config hashes pass, including the post-smoke check.
  QEMU exists only in the disposable test copy; no emulator is added to the OCI
  image, and no host binfmt, Docker daemon or Oracle session is used. The private
  builder and verification runner have stopped. Native ARM hardware, Docker
  Engine/Compose, full TLS/PID1 supervision on ARM and Oracle remain unqualified.
  The later NUMBER-expression driver correction is outside that frozen r8 input
  set. Image verification still compares every packaged source against the
  pre-build r8 inventory and reports the changed current driver separately;
  it cannot report r8 as the current corrected-source image.
  Default checkout NPM entrypoints now select the native implementation:
  build/build:web compile Rust and WASM, dev/local:prepare build the workspace
  and invoke the native local entrypoint, operator exposes native OS commands,
  worker:service selects the native execution service, and release:local builds
  a fresh native distribution at the supplied output path. Default test/product/
  browser/parser commands select their Rust suites. Retained Node/React/ANTLR
  app and operator commands are explicitly named reference:*. Existing source,
  type, reference web, unit, license and scheduled reference acceptance checks
  still run through their original implementations and test sets; only their
  aliases changed. No gate or required job is removed. The retained reference
  source archive deliberately excludes Cargo: its projection selects reviewed
  reference commands and preserves the original package in source-package.json.
  Actual native NPM build/WASM and all 31 original parser goldens pass; dev,
  local:prepare and operator help resolve to native binaries without starting
  services. The retained delivery check passes 87 JavaScript tests, three Python
  tests, source/type/web/format checks and the 94-package license closure, including
  reproducible reference archive/provenance and command-projection checks.
  These checkout/CI alias changes do not change the 311 compiled Docker inputs.
  The r9 default-Dockerfile linux/amd64 checkpoint includes the later
  NUMBER-expression fix, isolated installer processes, explicit native discovery
  review/acceptance, format-3 bootstrap and optional review-Secret chart patch.
  Its 313 original source inputs, modes and packaged bytes match source-tree digest
  `828d40472c8dbf4c084f19c0875e70c1a5fabbd180c789aef5e053f939d238cd`.
  The five Debian release executables share that identity. The local archive
  `.cache/buildkit-overlay.ohRHJ7Bw/kelryvo-native-default-amd64-r9.oci.tar`
  has 152,538,624 bytes, mode 0600 and seven verified OCI blobs. Manifest digest:
  `sha256:719e25b9159e7da09405849e2b4e9d99ebbae3211db1071766ddcc3d499e66d9`;
  config:
  `sha256:ca39fa9727a2c42fbabe085cca6e236d5cc0e7833ca3774abdd8ad2fbf863eeb`;
  archive SHA-256:
  `655c84f75be17f9ecfd0e4e06411d620baa5576af74b32a1900d071b6dc42f99`.
  Source/bundle integrity, native process role/config, build identities, absence
  of interpreters/compilers and all 119 packaged OS notice hashes pass. The
  focused image contract and exact exported-filesystem namespace smoke both pass:
  actual PID 1, UID/capability/no-new-privileges and Secret separation, projected
  controller inputs, state/witness initialization, cross-UID repositories,
  startup readiness with execution enabled before Oracle installation, TLS/WASM,
  governance, credential rotation, graceful shutdown and restart. Enabled
  discovery refuses a dummy OCI library. One job is cancelled; no attempt or
  Oracle connection is created by that smoke. Final source/bundle/archive checks
  pass, and both the private builder and follow-up runner exit zero and stop.
  This is local-unpublished, qualification NOT_RUN and releaseApproved false.
  The separate live read-only host-driver probe in RUST5 does not qualify this
  image's Oracle execution. Current-source arm64, Docker Engine/Compose, remote
  CI and installed Oracle writer/recovery remain unqualified. No image is
  published, nominated or deployed.
  The companion chart's optional managed Oracle init/controller still invokes
  retained Node commands; this outside-repository source is not migrated or run by
  the native image check. Default offline app wiring uses the native launcher.
  A subsequent native bootstrap fix handles Kubernetes' root-owned sticky
  projected-volume parent when the selected source is its protected `..data`
  generation. Every resolved ancestor must retain trusted ownership; group/world-
  writable non-sticky parents, source roots and descendants remain
  rejected. Binary and output-directory ancestry keeps the original strict rule.
  All six launcher unit tests and launcher Clippy pass. The current debug native
  distribution passes the actual PID1/HTTPS namespace smoke with a mode-03777
  volume root and mode-02755 generation. Both role UIDs cannot read the original
  metadata secret, source modes remain unchanged, and invalid root/ancestor
  restaging attempts fail. The existing controller/secret/rotation/restart and
  one-cancelled-job/zero-attempt checks still pass without an Oracle connection.
  This fix is included in r6 and absent from r5; it does not
  qualify the companion managed Oracle wiring or a live Kubernetes deployment.
  Native managed Oracle wiring is now prepared in
  `deploy/native-oracle-helm.patch`, pinned to companion revision
  `0d11a258302f2011d8952dae530172a8f08525dd`. It adds an explicit native mode,
  native state and read-only client/wallet claim selectors, Rust init/watch
  commands and projected native controller/template inputs. Existing default,
  customer and legacy managed overlays, capabilities, Secret separation, retained
  PostgreSQL/legacy PVC objects and all configured chart checks remain unchanged.
  `--helm-only ABSOLUTE_CHART_CHECKOUT` verifies archived Git blob identities and
  prepares a fresh private candidate; strict lint and every retained/native chart
  assertion pass, without modifying the companion source or contacting a cluster.
  The patch is included in native source identity and distribution packaging.
  Root-only `installation-init-state STATE_VOLUME_ROOT [NATIVE_ORACLE_ROOT]`
  creates only fresh private state/witness directories or validates retained ones.
  It refuses a missing state directory beside an existing witness and rejects
  unsafe wallet ownership/modes before creating state. The read-only prerequisite
  wallet is root:10002 mode 0710 with root:10002 mode-0440 regular single-link files;
  the API cannot read it while the worker can. Native controller input reads now
  reuse the launcher's protected projected-source reader, retaining exact
  mode-0400/0600, ownership, link, size and source-confinement checks. Existing hash
  pins and journal/exclusive-lock semantics remain enforced after I/O.
  The actual debug namespace smoke passes fresh initialization, idempotent witness
  preservation, lost-state refusal, both role-UID denials, wallet isolation,
  executable-policy rejection and controller WAITING_FOR_INSTANCE through sticky
  projected policy/metadata volumes. Its existing runtime/governance/restart checks
  still retain one cancelled job, zero attempts and no Oracle connection. All six
  launcher tests, the private-PostgreSQL no-replay controller test, affected native
  Clippy and formatting pass. These are local implementation checks; applying the
  companion patch, live Kubernetes/Oracle operation and release qualification are
  not performed or inferred from them.
  Native `kelryvo oci inspect`, `verify-platform`, `verify` and `assemble` now
  replace the local OCI archive tool. Inspection streams and hashes every outer
  SHA-256 blob without extracting files or running image contents; it explicitly
  does not verify a source/role or confer qualification. Verification retains the
  exact revision/repository, Linux architecture and root-launcher role checks.
  Multi-platform verification requires one named `kelryvo-app` index with exactly
  amd64 and arm64. Assembly consumes both verified platform archives, preserves
  every referenced child manifest/config/layer digest and size, and discards only
  exporter wrapper annotations. Canonical tar ownership, modes, timestamps and
  explicit blob-directory headers make output deterministic and portable to
  unprivileged Skopeo. Output is private, synced and installed without overwriting
  an existing artifact. Held input file descriptors, bounded metadata/member
  reads and post-read inode/change checks reject changed input, duplicate or
  unsupported members, links, truncation, corrupt blobs, descriptor mismatches
  and nonzero content after the tar terminator. No tar subprocess, registry,
  publication or infrastructure mutation is involved.
  `bash scripts/test-rust.sh --oci-only` passes differential CLI checks against
  the retained verifier, matching index digests, deterministic re-export bytes,
  actual two-platform Skopeo copy and source/role/platform/blob rejection cases.
  It also covers exclusive output, symlink/duplicate/trailing-member refusal and
  independence from TAR_OPTIONS/GZIP. Its tiny layers are synthetic, not image
  execution or arm64 qualification. Native inspection additionally verifies all
  seven blobs in the previously built 149,581,312-byte local amd64 OCI archive;
  its local-unpublished identity cannot pass the release source-revision gate.
  The configured `containers.yml` verification job now builds the pinned native
  CLI and uses its assembler after both existing platform jobs succeed. Trusted
  master artifact conditions and all publication/security gates remain intact.
  The normal Rust check runs OCI compatibility smoke; `--oci-only` needs no
  PostgreSQL. CLI formatting/Clippy and the 21 retained OCI/delivery-gate tests
  pass locally. The changed workflow has not run remotely.
  Native `kelryvo delivery gate [--require]` now implements the retained
  read-only publication policy. It accepts only trusted master dispatch or
  completed source-repository push/dynamic workflow events, checks master before
  and after inspection, requires the latest successful source/image push runs,
  active default CodeQL, all four existing language jobs and no open alerts.
  Optional broad acceptance does not become a new dependency. Pending, failed
  and superseded states return deferred eligibility; `--require` rejects them.
  Successful results retain the exact OCI run/attempt IDs. Decimal IDs, source
  SHA and existing regular Actions output files are checked before appending;
  malformed identities cannot inject outputs. Event/output reads reject links,
  and invalid context/credentials cannot append a successful result.
  The fixed-origin HTTPS client sends GET only, disables redirects and proxies,
  uses TLS verification and bounded request/response sizes/timeouts, marks the
  Authorization header sensitive and never echoes tokens or response bodies.
  Test-only loopback HTTP adapters cannot be selected in the production CLI.
  Five focused native checks pass, including a 13-case differential comparison
  with the retained event/gate policy, real loopback HTTP/redirect/403/response
  bounds, Actions file confinement and actual CLI pre-network rejection.
  `bash scripts/test-rust.sh --delivery-only` runs them without PostgreSQL.
  Delivery and Docker Hub workflows now build the pinned native gate; the
  trusted-default-branch checkout, permissions, gate/job dependencies and all
  required CI/CodeQL conditions are retained. The downloaded archive check in
  delivery also uses native OCI verification. No live GitHub call or remote
  workflow has run for this change.
  Native `kelryvo delivery publish` now replaces the GHCR publication command.
  It snapshots the fixed downloaded archive through a held file descriptor,
  rejects input mutation, verifies both platforms in the private snapshot and
  protects it read-only before Skopeo receives its path. Later replacement of
  the original cannot change the bytes selected for publication. The native
  orchestrator checks all publication gates and the exact OCI run/attempt before
  registry inspection, immediately before a possible copy and after registry
  proof. A matching immutable tag is reused; a replaced/misbound tag is rejected
  without overwrite. Copy/read/verification failure never emits successful
  publication outputs or starts another copy automatically.
  The fixed GHCR reader verifies raw index/child digests, response digest headers,
  descriptor sizes, exact two-platform membership, config bytes and the shared
  source/repository/launcher-role policy. Only an actual HTTP 404 can represent
  an absent tag; authorization failures cannot trigger a first push. Token and
  manifest requests do not redirect. Blob redirects use documented GitHub
  package hosts with TLS verification and send no registry Authorization header
  on the redirected request. Private loopback adapters exist only in test code.
  The write adapter invokes fixed `/usr/bin/skopeo` with all platforms, preserved
  digests, TLS verification and no retries. Its single-registry auth file is
  private and removed on normal completion; credentials never enter argv or the
  child environment. Output is bounded, captured privately and withheld on error.
  Timeout/failure kills the process group and awaits bounded direct-child reaping.
  The GHCR workflow now uses native gate/archive verification/publication, without
  Node or a host Docker login session in those jobs. These commands do not
  replace a published image or running deployment. Local native
  checks pass immutable-tag reuse/refusal, stale or
  unrelated-run vetoes, copy failure, loopback GHCR proof, credential-free blob
  redirect, 404/403 distinction, header corruption, role binding, private auth,
  process timeout/diagnostic containment and frozen-archive independence.
  CLI checks reject invalid identity and missing archive before network access.
  The 16 retained delivery tests still pass. Tests use synthetic registry replies
  and a fake copy adapter; no image has been pushed to GHCR or a local registry,
  and actual GHCR copy/credential interoperability remains unqualified.
  Native `kelryvo delivery dockerhub` now ports the separate Docker Hub path.
  Its seven explicit options retain source/run/attempt, archive, destination,
  private auth file and exclusive report selection. Only the retained
  `docker.io/namespace/repository` form is accepted; credential URLs, tags,
  digest selectors, traversal and duplicate/unknown options are rejected.
  The private regular auth input is read through a held descriptor, checked for
  concurrent changes and projected into a private Docker-Hub-only snapshot.
  Other registry sessions and credential helpers are not forwarded. Every
  inspection instead receives a separate empty auth file plus `--no-creds`;
  anonymous denial cannot fall back to the push credential, even when an error
  also contains a missing-manifest phrase. The shared transport keeps fixed
  Skopeo invocation, TLS verification, bounded output/timeouts and no retries.
  Publication preserves both platform digests and all source/image/security
  gates, reuses matching tags without another copy and rejects mismatched tags.
  Anonymous proof checks the exact index by tag and digest, child sizes/digests,
  raw config hashes/sizes and the shared source/role policy. Only Skopeo's single
  display newline may be removed for digest comparison. A final gate recheck
  precedes the unchanged format-v1 report, which remains private and cannot
  replace an existing report. No chart, Argo CD or cluster action is present.
  The Docker Hub workflow now uses native gate/publication without Node, while
  retaining its explicit manual destination, private password-stdin Skopeo login,
  successful-CI artifact selection and private-session cleanup.
  Native fixture checks pass private auth projection/retention, anonymous proof,
  tag reuse, stale/unrelated-run refusal, denial, replaced tags, copy failure and
  changed config rejection. Actual CLI tests refuse credential URLs/nonprivate
  auth before network access. All 23 retained Docker Hub/delivery checks pass.
  Local Skopeo inspection confirms `--raw --config` preserves both synthetic
  platform configuration digests. Tests perform no registry copy or publication;
  live Docker Hub interoperability and the modified workflow remain unqualified.
  Native `kelryvo delivery promote` now replaces Helm promotion orchestration.
  It verifies the published GHCR digest/tag, exact OCI run/attempt and current
  source/image/security gates, using a separate chart-repository token for chart
  writes. The fixed-origin GitHub adapter retains TLS, redirect/output bounds
  and sensitive-header handling, and explicitly disables automatic retries for
  unknown writes. Optional automation-ref lookup treats only HTTP 404 as absent.
  Source comparisons accept the required `compare/BASE...HEAD` route while path
  traversal and caller-selected origins remain rejected.
  The checkout must be its clean canonical Git root. An opened, regular,
  single-link values file remains bound by inode; replacing its path with a link
  or another file is rejected. Only the exact image digest scalar changes; all
  other bytes are retained. Remote base/contents must match the local checkout.
  Promotion history rejects ambiguous source markers, rollback/divergence and a
  second digest for the same source. Existing strict Helm lint, the companion
  chart's Python security checker and Helm template validation are all retained;
  the external checker has not been removed or bypassed. Child tools receive a
  fixed environment without publication credentials or inherited Git selectors.
  After validation, values, Git HEAD and Git-visible changed/staged/untracked
  paths are checked again before any remote write. Dirty candidates remain for
  inspection rather than being reset or silently repaired.
  Every chart mutation rechecks all source/OCI gates. Created commits have only
  the inspected chart base as parent and change only values.yaml. Unprotected
  master updates use force=false and concurrent failures are never retried.
  Protected master creates a draft PR without merging or granting bypass.
  Existing PRs and orphan refs are reusable only after exact parent, source
  provenance, values and one-file diff verification. Reusing an orphan creates
  no redundant Git tree/commit; changed or unrelated branches are refused.
  Superseded automation PRs are closed only in the fixed chart repository and
  under a fresh gate. Branch identity is checked again before PR creation.
  The promotion workflow now invokes the native CLI without Node while retaining
  checkout/token scope, pinned Helm installation and all configured validators.
  Native checks pass direct/protected promotion, no-op/orphan/PR reuse, source
  advancement, rollback/stale/validation/scope vetoes and concurrent-update
  refusal using synthetic chart API writes. Real Git/Helm/private-checkout smoke
  also passes, with a synthetic required Python checker; its forced failure
  blocks validation. That optional smoke is reported skipped when Helm is absent.
  Loopback HTTP tests verify repository/method/body binding, 403/404 distinction
  and no retry after a dropped write response. CLI tests reject invalid digest,
  credential header or missing checkout before any network request. All 25 CLI
  tests and 16 retained delivery checks pass locally. No GitHub commit, ref, PR,
  registry publication or cluster change has been made; live GitHub/chart
  promotion and full replacement-image qualification remain untested.
  Native checkout commands `kelryvo local-prepare` and `kelryvo dev` build the
  pinned Rust/WASM UI and run native metadata/demo preparation. They retain the
  private local configuration and shared credential lock, refuse pending lifecycle
  journals, seed identities once without refreshing expiry, and validate up to
  eight existing user Git roots without modifying them. Default PostgreSQL uses
  the retained pinned image, local Linux Docker socket, checkout label and local
  volume; `--existing-database --directory PRIVATE_ABSOLUTE_DIRECTORY` reads the
  directory's private `database-url` and existing `config.json` without Docker.
  Each invocation stages fresh private native API inputs. TLS certificate/key
  and identity inputs remain private; `dev` execs the sibling native API with a
  clean environment, loopback bind and direct signal delivery. Restored startup
  requires the retained private descriptor and RESTORE_HOLD, and performs no
  schema initialization, actor seeding, credential issuance or activation.
  Targeted local smoke passes fresh metadata preparation, native HTTPS/API
  authentication, real WASM assets, unchanged source files/credential expiry,
  pending-journal refusal and synthetic held startup. This does not qualify live
  Oracle, Docker-backed local resource creation or a replacement release image.
  Run `bash scripts/test-rust.sh --local-dev-only` for this bounded smoke.
  Root-only `kelryvo pilot init|verify` replaces Python installation preparation
  for the native candidate. Init exclusively creates private TLS/vault keys,
  separate PostgreSQL admin/application passwords and actor tokens, a projected
  Compose file and optional customer Git snapshot. The new PostgreSQL initializer
  is bounded SQL readable only by root/the PostgreSQL group; it creates an owning
  application role without superuser, database/role creation or replication rights.
  Verify checks root ownership/modes, the exact template and environment, matching
  TLS/vault key pairs, credential bindings and the sole allowed initialization
  program. Retained Python-generated installations remain readable unchanged.
  Native `pilot bootstrap|status|grant|database-grant|deploy-grant` address the fixed
  local Linux Docker daemon and existing service, invoking the native operator as
  root. They never start services. Bootstrap validates both distinct accounts
  before commands, then initializes/seeds/activates native metadata and resets
  passwords through private stdin. Terminal input disables echo and confirms
  passwords; bounded JSON stdin is also supported. Membership grants cover both
  actors, while database/deployment grants remain separate developer actions.
  `bash scripts/test-rust.sh --pilot-only` passes actual root init/verify, exclusive
  files, retained installation import, TLS/vault validation, hidden terminal input
  and mismatch/duplicate-account refusal. The generated SQL and native metadata,
  account and explicit grant commands also pass against a private PostgreSQL
  cluster using the nonsuperuser application role, with unchanged LOCAL expiry.
  Actual Compose exec/deployment and final image interoperability remain untested.
  The Compose template is now included in the native source fingerprint/bundle
  and candidate builder context, preserving its compiled-input provenance.
  Native API startup now accepts the retained pilot `{format:1,paths:[...]}`
  repository manifest, retaining its eight-checkout limit and canonical containment
  beneath `/run/kelryvo/repositories`. Bounded read-only Git checks reject mount
  escapes, duplicate roots, non-worktrees and nested directories, matching the
  retained resolver. Exact operator-allowlisted roots are trusted explicitly by
  Git so read-only root-owned mounts remain readable by UID 10001; no global
  ownership override or source mutation is introduced. Native namespace smoke
  passes this actual cross-UID/read-only mount and authenticated repository listing
  without exposing paths. It also rejects API-role `kelryvo-server --initialize`
  even with readable native API database configuration; dedicated API/worker UIDs
  cannot invoke this schema-initialization command.
  The native CLI now provides `build-dist OUTPUT [--debug]` and `verify-dist
  DIRECTORY`. Build uses the locked native/WASM toolchains, a fresh output path,
  and a before/after fingerprint of the Cargo workspace, compiled SQL inputs and
  project license/notices. It stamps all five Linux binaries with declared source
  revision and source-tree digest, verifies those identities before copying, and
  includes the WASM application, exact native sources, source identity and a
  complete file/mode/hash inventory. `KELRYVO_REVISION` accepts a 40-character
  revision or the explicit default `local-unpublished`; declaring a revision does
  not assert a clean checkout, signature, Oracle qualification or release approval.
  Compiled nonlocal source pins constrain API runtime-record selection and native
  worker/discovery artifact acceptance. All entrypoints expose `--build-info`
  without reading secrets or launching a role. Dependency source archives are
  included for the complete locked workspace (including build/dev/other targets),
  with each archive checked against Cargo.lock, preserving their full embedded
  sources/licenses/notices. `licenses/cargo-inventory.json` records license
  expressions and archive digests; it does not assert per-binary linkage closure.
  Integrity tests reject changed, missing, added, symlinked and permission-modified
  files. Runtime smoke now uses the generated debug distribution, rather than
  unrelated target-directory binaries. Native system-library/license inventory,
  final image packaging and artifact/release qualification remain unfinished.
  Local build/verify and namespace smoke pass for the generated x86_64 debug
  bundle with a declared repository revision and compiled source-tree fingerprint.
  The current bundle includes 368 checksum-verified registry source archives.
  Its five binaries report the same build identity; source-pinned discovery also
  requires the matching tree digest in the reviewed source-identity artifact.
  Source inventory tests and workspace Clippy pass. The restrictive-umask run also
  passes with explicit executable/readable package and fixture modes. A native
  x86_64 release bundle now builds and passes the same TLS/WASM/private-metadata
  smoke, including a real nested PID namespace in which the Rust supervisor is
  PID 1. CI now supplies `github.sha`
  to the native runtime bundle build, while preserving existing delivery gates.
  The initial `Dockerfile.rust` candidate used the existing pinned Debian
  base, native release distribution and a runtime without Node/JVM/Python/Rust
  build tools. Its recipe is now the default `Dockerfile`; the duplicate candidate
  recipe is removed. This changes source builds, not a published release.
  `docs/dependencies/rust-toolchain.json` records the exact compiler,
  Cargo, native std and WASM std archive hashes for amd64/arm64 from the installed
  pinned toolchain manifest. The build installer downloads only those HTTPS
  archives, verifies each hash and installs no moving rustup channel. The recipe
  and its pins are now included in the source fingerprint and source bundle.
  Rust `runtime-inventory OUTPUT` queries the image's dpkg database and copies
  complete package copyright notices, preserving package/source versions and
  source access references outside the application inventory. Its fixture tests
  pass, and it exports 88 package notices from an extracted digest-verified Debian
  base in an isolated namespace. This standalone host-built CLI test emits a weak
  glibc-version warning on that older base; it does not qualify Debian-built
  binaries. A rootless private BuildKit build now produces an actual linux/amd64
  release image from the former candidate recipe, with a digest-pinned Dockerfile
  frontend. The following digest identifies that earlier checkpoint.
  Its five release binaries and WASM assets are built inside the pinned Debian
  builder. Bundle inventory passes in both builder and final image, and the final
  Debian inventory contains 119 packages. The local unpublished image manifest is
  `sha256:8706ceb44620af96c17b23fb385bb62693abd21068c5dd1796afe12c20a302e8`;
  compiled source-tree digest is
  `2b131a2e4887a58c4f5dcd497a97a9cfdb2f999897f784a36734b5661b7fe8b5`.
  All referenced OCI blob hashes/sizes, native entrypoint, root user, empty CMD and
  amd64 config are verified. The same cached build's exported filesystem passes
  the private namespace TLS/WASM/PID1/UID/secret/repository/discovery smoke using
  the image's actual Debian libraries rather than copied host libraries. The
  private test probe and configuration fixtures are added only to the test copy;
  the OCI archive and exported image remain unchanged. The local-export wrapper's
  private directory mode is normalized to a traversable fixture root; recursive
  ownership setup does not follow symlinks. Use `KELRYVO_RUST_IMAGE_ROOT` with
  `--runtime-only` for this explicit image-filesystem mode.
  The image is marked `local-unpublished`; it is not a signed or nominated release.
  This artifact predates the subsequent controller and native delivery ports and
  does not qualify the current source tree.
  Docker-engine image contract smoke and the non-publishing amd64/arm64 CI matrix
  remain unrun; the local Docker daemon is unavailable and arm64 is unqualified.
  Runtime source availability/licensing, complete release qualification,
  Oracle/client/wallet acceptance, live native controller qualification and
  replacement of the published runtime remain incomplete.
  The native `kelryvo-runtime` launcher now replaces the C/Node bootstrap logic:
  protected projected-secret reads, bounded fixed-file staging, separate API and
  worker UIDs, sanitized environments, disabled core dumps and privilege dropping.
  PID 1 retains only KILL, uses no-new-privileges, reaps adopted descendants and
  stops both process groups without restarting a role or job. API startup releases
  the worker's private stdin gate only after configuration, PostgreSQL connection,
  socket binding and TLS parsing. This notification grants no execution authority
  and does not initialize or activate metadata. Native `runtime-service` either
  runs the reviewed fixed execution configuration, waits for its first complete
  native installation, or waits for shutdown with Oracle execution disabled.
  Missing installation/discovery inputs permit first-install API startup;
  malformed or partial static writer inputs are still rejected. Enabled waiting
  startup preserves controller-published files and retained nested history;
  disabled discovery still removes its generated secret files. Discovery loads
  and authorizes its current native configuration separately on every request.
  Root staging copies six data files; legacy modules
  and retained operator journals are never executable runtime inputs.
  Local tests pass projected-secret confinement, rotation, private modes, stale
  link cleanup, fixed publication paths and real-process startup/shutdown/reaping.
  The local HTTPS/OIDC operator and Rust/WASM identity smoke also passes after
  the API listener/startup change.
  The explicit `--runtime-only` smoke stages the compiled launcher, API, worker,
  operator and Rust/WASM assets into a private root filesystem and creates new
  Linux mount/PID/network namespaces. It initializes, seeds and activates a fresh
  private PostgreSQL fixture through the native operator. The real API reports
  ready over TLS and serves the WASM artifact even with execution and discovery
  enabled and no first installation. With the existing four bootstrap
  capabilities, the supervisor retains only KILL, the two roles run as UID
  10001/10002 with zero permitted/effective capabilities and no-new-privileges,
  and API access to original/worker secrets and supervisor environment is denied.
  Real peer-UID socket checks, API-only restaging, graceful shutdown and restart
  pass with zero execution jobs. The fixture now places the Rust supervisor in a
  nested PID namespace as actual PID 1; these checks still do not qualify the
  final Docker image or all of its system libraries. No Node, JVM or
  Oracle client is installed in this native runtime fixture. The new native discovery
  transport uses a fixed Unix socket, checks peer UIDs in both directions, accepts
  only TEST/DISCOVER/SCHEMA endpoint facts, bounds frames to 16 KiB/2 MiB and keeps
  at most two active requests until their handlers settle. Retained bigint revisions
  stay decimal strings; schema requests preserve their separately bound owner.
  API runtime startup installs this client. The disabled worker bridge returns
  unavailable without loading Oracle or private credentials. Bridge failure and
  execution shutdown coordinate through a shared stop signal and await disposal.
  Root startup alone cleans the fixed socket; API-only secret rotation leaves it
  intact. Local socket, cancellation, API-adapter and bootstrap fixtures pass.
  Enabled discovery now requires the separate native format-2 `discovery.json`
  and `observer-*` password files. The root bootstrap stages only referenced
  observer data into a separate UID-10002 mode-0700 discovery directory; API
  restaging leaves it intact. The private manifest fixes authorization/expiry,
  source identity, exact retained endpoint/revision, observer username, schema
  owners, pinned addresses, certificate DN and hashed worker/client/wallet
  artifacts. Writer provisioning is not a prerequisite. Unknown/legacy acceptance
  fields, protected/admin observer accounts, stale endpoint facts, unauthorized
  owners, changed artifacts and unreviewed client files are rejected.
  A fixed `discovery-child` receives endpoint facts only, rechecks the installation,
  resolves exactly the pinned address set, reads the observer password privately,
  initializes the reviewed OCI client, checks loaded library paths and session
  user/proxy identity, and invokes the read-only collector. Each request has a
  separate process, sanitized environment, bounded stdout/stderr, correlated reply
  and an 8-second (30-second schema) deadline. Shutdown/timeout requests TERM then
  KILL and confirms child reaping before releasing capacity. Failed disposal
  retires the bridge. There is no retry, writer capability or live-acceptance
  projection. Unit tests cover scope/artifact vetoes, invalid/oversized replies,
  cancellation and actual child termination. The namespace smoke also enables
  discovery with a dummy OCI library and verifies private observer-file ownership,
  API denial, child command isolation and unavailable evidence. That deliberate
  load failure is not successful OCI/TLS/Oracle qualification. Discovery retains
  explicit TCP and TCPS installation transports; TCPS requires a certificate DN,
  while TCP refuses TLS claims. Execution's default connector remains TCPS.
  Native acceptance production is implemented with the separate review and fresh
  preflight described in RUST5; actual Oracle qualification remains unfinished.
  The default Dockerfile now builds the native runtime, as recorded
  in RUST6; its locally verified checkpoint predates later API/UI ports and has
  not replaced published artifacts. No deployment or actual Oracle connection
  was made.

Native development: `cargo build --workspace --locked`,
`cargo clippy --workspace --all-targets --locked -- -D warnings`, and
`bash scripts/test-rust.sh` (private temporary PostgreSQL, then native tests and
reference comparisons). The latter currently requires Node for compatibility
fixtures. Build the UI with `cargo run -p kelryvo-cli -- build-web` after installing
the pinned Rust WASM target and `wasm-bindgen-cli 0.2.130`. The focused browser
flow is explicit: `bash scripts/test-rust.sh --browser-only`; `--browser` runs
both suites with separate private PostgreSQL clusters so retained product HOLD
fixtures cannot contaminate browser request eligibility. The added Rust CI
job leaves all existing source/container/artifact gates intact; remote CI has
not been run by this local work.
The identity-only smoke is `bash scripts/test-rust.sh --identity-only`; the
browser-only flow also runs it after the main product browser scenario.
The native runtime smoke is `bash scripts/test-rust.sh --runtime-only`. It needs
noninteractive sudo, Linux mount/PID/network namespaces, chroot, setpriv, iproute2,
curl, OpenSSL and the pinned WASM build tools. It stages generated files below
`.cache`, uses the runner's new private PostgreSQL socket, and terminates the
isolated processes before stopping that cluster. It does not start a daemon.
Set `KELRYVO_RUST_DISTRIBUTION` to an existing absolute bundle directory to smoke
that exact artifact after `verify-dist`, without rebuilding its application.
The default runtime CI path still builds its own fresh bundle. A release-mode
bundle can be prepared with `cargo build -p kelryvo-cli --locked` followed by
`target/debug/kelryvo build-dist /absolute/new-directory`; add `--debug` only for
the development bundle. `verify-dist` never executes the bundle's programs.
The native image command is `docker buildx build --target app --build-arg
KELRYVO_REVISION=local-unpublished --load -t kelryvo:rust-local .`; native
amd64/arm64 builders are required. This is a local build, not a publication,
deployment or replacement of the existing release gates.

Native discovery installation is separate from the writer archive. A root-owned
`KELRYVO_INSTALLATION_DIR/discovery.json` uses format 2, the native `driverProfile`,
`readOnly: true`, `disposable: true`, `authorizationId`, `expiresAt` (at most 90
days), `sourceCommit`, `clientDirectory`, `walletDirectory`, `secretDirectory`
(`/run/kelryvo/runtime/discovery`), `artifacts` and 1–64 `targets`. Artifact kinds
are the same hashed `WORKER`, `OCI_LIBRARY`, `WALLET` and `SOURCE_IDENTITY` records
as native execution. Each target contains `connection` (the exact id, decimal
revision, endpoint, transport, username and retained credential reference/mode),
`observerUsername`, `secretFile` (an `observer-*` basename), `pinnedIps`,
`serverCertificateDN`, optional `expectedIdentity`, and `schemaOwners`.
TCPS requires a DN; TCP accepts no DN. Password files are root-owned private
regular files, up to 8192 bytes, staged only for the worker. This configuration
does not provision the observer, create metadata approvals or import historical
live acceptance. `KELRYVO_DISCOVERY_ENABLED=true` enables only this native adapter;
execution remains independently controlled by `KELRYVO_EXECUTION_ENABLED`.

Native worker smoke is `bash scripts/test-rust.sh --worker-only`. Its private
PostgreSQL/native child checks do not connect to Oracle. `kelryvo-worker
expiry-service PRIVATE_CONFIG` runs only expiry recovery; `expiry-child` is the
supervisor's single-job entry. Configuration uses format 1, mode `EXPIRE_ONLY`,
`databaseSecretDirectory`, `metadataGenerationId`, `workerId`, `expiresAt`,
`pollMs` (250–60000) and `pageSize` (1–100). The configuration and `database-url`
files must be mode 0600 inside private mode-0700 directories; paths cannot traverse
symlinks. The worker emits no database URL, credentials or SQL in its protocol.
`kelryvo-worker execution-service PRIVATE_CONFIG` uses mode `ORACLE_EXECUTION`
and an additional absolute `oracleInstallation` path; its child command is
`execution-child`; both require effective OS UID 10002. The installation must match the service's worker, generation,
secret directory and expiry. Its format-1 private configuration requires the
distinct native `driverProfile`, reviewed source/image/artifact digests, fixed
metadata destination, TCPS route with exact DNS/IP set and certificate DN,
dedicated client/wallet directories, three principals, schema allowlist and
mutex/trigger source digests. Artifact kinds are `WORKER`, `OCI_LIBRARY`, `WALLET`
and `SOURCE_IDENTITY`; client/wallet directories contain only reviewed regular
files, without symlinks or nested directories. The public journal uses format 2
with `driverProfile`, `workerArtifactDigest` and the redacted retained descriptor;
it contains no executable/wallet paths or passwords and grants no dispatch rights.
Oracle execution remains unqualified until the native installation tooling and
actual OCI/TLS/target checks are completed. Do not reuse a Node installation as
native acceptance.

The same native worker binary supplies `installation-preflight PRIVATE_INSTALLATION`
and `installation-record PRIVATE_INSTALLATION`. Both require effective OS UID 0
and the original operator configuration, all artifact files, and client/wallet
directories with root-controlled ancestry. Runtime secrets may stay in the private
worker-owned directory. Root-owned wallet files can grant read access to the worker
group without granting write access. Preflight only reads Oracle catalogs;
recording repeats preflight and appends the native metadata journal and per-project
audit in one transaction. These commands do not create users, grant privileges,
install ledger objects or execute migrations. The native Oracle provisioning and
artifact qualification paths remain unfinished; no command has been run against
an actual Oracle installation by this rewrite.

`kelryvo-worker installation-prepare PRIVATE_PREPARATION` requires a root-owned
format-1 request with `policyFile`, `installationTemplate`, `vaultKeyFile` and a
new `outputDirectory`. The policy retains the route/identity/schema/table-space/
quota/expiry authorization format; the native template must bind the same facts,
reviewed artifacts and deterministic connection principal names. Only the
Oracle 26 server profile (`23.26.*`) is admitted. Existing principals or owners
declared for creation veto fresh preparation; no refresh/resume/drop path is
provided. Passwords and metadata URL are exclusive mode-0600 files, and pending
stages persist by fsync/atomic rename before DDL. Successful output includes
`installation.json`, `preflight.json`, `worker.json` and `journal.json`, owned by
root in a fresh mode-0700 directory. This is preparation output; native runtime
publication, actual Oracle qualification and deployment remain separate work.
A failed/uncertain preparation retains its journal and must not
be replayed automatically.

`installation-publish PRIVATE_PUBLICATION` accepts a root-owned format-1 request
with `sourceDirectory`, `destinationDirectory` and a fresh `outputDirectory`.
The source must be a complete prepared native archive. The destination must
already be a private mode-0700 directory owned by UID 10002 with root-controlled
ancestry. Publication preflights before staging, publishes configuration last,
and commits its native installation journal only under the live metadata fences.
It retains `publication.json` and the exact root archive, and reports that service
restart is required; it does not restart processes. Failed/unknown publication
does not automatically roll back files or replay Oracle work. All staging uses
the worker's filesystem identity synchronously, followed by operator restoration.

`installation-refresh PRIVATE_REFRESH` accepts root-owned format-1 fields
`previousDirectory`, `installationTemplate` and a fresh `outputDirectory`.
It independently checks the reviewed new template and current Oracle catalogs,
retains existing writer/ledger/observer passwords, and refuses changes to physical
identity, metadata generation, principal/schema scope, protected package/trigger
sources or witness directory. It prepares an archive for separate publication;
it never creates accounts, rotates passwords, resets history, admits attempts or
executes migrations. Native bootstrap and process supervision are implemented;
container wiring and actual Oracle/artifact qualification remain
unfinished. No publication or refresh has
been performed against a real runtime by this rewrite.

Native Linux build prerequisites include OpenSSL development headers and
pkg-config. A new private metadata installation can use
`kelryvo-operator initialize`, `seed-actors`, then `activate` against an empty
organization. The operator reads `database-url`, `developer-token` and
`approver-token` from `KELRYVO_SECRET_DIR`; private inputs must be owned by the
operator (or used by root) and inaccessible to other users. Existing identities
keep their original credentials. Grant access to each new project explicitly
with `kelryvo-operator grant PROJECT_ID ACTOR_ID`; database management and deploy
authority have separate commands. Run `kelryvo-operator --help` for usage. These
commands are implementation artifacts, not authorization to change an installation.

For native local Git intake, create an operator-owned `repositories.json` in
`KELRYVO_SECRET_DIR` (default `/run/kelryvo/secrets`), with mode `0600`:

```json
[{"id":"migrations","name":"Local migrations","path":"/srv/kelryvo/migrations"}]
```

Up to eight existing local repository directories can be configured. The API
publishes their IDs and names; filesystem paths stay in server configuration.
Use **Configuration** to bind the repository and migration folder, then
**Releases** to select a local ref or commit and import its immutable SQL.
The Rust importer requires `/usr/bin/git` and does not fetch remote objects.

Native identity uses an optional operator-owned `identity-runtime.json` in the
same secret directory, with mode `0600`. Its format is compatible with the
existing format-1 runtime: `publicOrigin` is the exact HTTPS application origin,
`key` is 32 random bytes encoded as 64 lowercase hexadecimal characters, and
`secrets` maps operator aliases to client or directory service secrets. Generate
fresh key material with `openssl rand -hex 32`; do not place runtime secrets in
Git or browser provider configuration.

Each route has `id`, `kind`, `pinnedIPs` and `secretRefs`. OIDC routes additionally
set an HTTPS `origin` and `issuerPrefix`; LDAP routes set a DNS `host`, port `636`,
transport `LDAPS`, and allowed `baseDNs`/`bindDNs`. Optional `ca` supplies a PEM
trust bundle. The existing identity runtime format is defined in
[packages/identity/runtime.mjs](packages/identity/runtime.mjs).

Grant identity administration explicitly with
`kelryvo-operator identity-grant ACTOR_ID`, then manage providers and mappings in
**Identity providers**. Providers start disabled and require an explicit mapping
to an existing actor before they can be enabled. Use `identity-revoke ACTOR_ID`
to remove administration. Native identity smoke:
`bash scripts/test-rust.sh --identity-only` (private PostgreSQL and local TLS OIDC
fixture). LDAP live interoperability still needs validation.

### Managed Oracle customer delivery — 2026-11-09

Version `managed-oracle26-2026-11-09` binds runtime source
`b14d9cf0c75ec67b8eb78aff5c7e921dd31ecefa` to OCI index
`sha256:e53cc2111b27a5ca05ec398f2243cfbd6249ff7f339432acc1028257633d1be1`.
The exact linux/amd64 manifest is
`sha256:881eed077c6b59e6abe43d53aa78680d359a88d988e82517538027c86404c72e`.
The customer URL now runs this artifact; the earlier trial remains frozen.

- [x] **CR5 — Managed instance credentials:** actual HTTPS password login,
  write-only ADMIN credential entry and replacement pass in the customer UI.
  AES-256-GCM/RSA-OAEP encryption binds the credential to its organization,
  connection, username, purpose and endpoint. The API receives only the public
  key; the private key/decryption remain in the root operator. Replacement advanced
  connection revision 1 to 2, invalidated the old profile, and retained the same
  instance, assignment, binding and migration stream with a fresh profile.
  Crypto, scoped API, additive-upgrade and revocation tests pass; the retained live
  credential was not revoked. Audit/response checks contain no password.
- [x] **CR6 — Maintainable protected runtime:** the shipped fixed-policy controller
  installs dedicated writer, ledger/mutex and observer accounts and explicit
  schema-only owners. It validates identity, TLS pins, grants, protected native
  objects, source/image identity and metadata generation. Source/credential refresh
  reuses principals and history; no per-migration hash allowlist or private trial
  adapter is needed. ADMIN never dispatches migrations. The initial 30-day Node
  timer overflow was fixed in PR #143; the final artifact remains healthy with
  the original 30-day policy. The Helm first-consumer PVC wave was fixed in chart
  PR #12. Required source, CodeQL and native amd64/arm64 OCI checks passed.
- [x] **CR8 — Live customer handoff:** the actual URL completed credential entry,
  discovery, schema assignment/verification and credential replacement, then
  immutable SQL Workspace V1/V2 releases, distinct approver decisions, browser
  deployment requests and a fresh NOOP. V1 CREATE TABLE and V2 ADD COLUMN/CREATE
  INDEX reached `VERIFIED_SUCCESS`; NOOP dispatched zero statements. Exact retries
  returned the same jobs. All three receipts independently recompute against
  persistent preimages and the 13-event native ledger. Versions 1 and 2 remain
  applied on the same stream. The original 58 jobs, 12 HOLD records and 1,065 audit
  rows are unchanged. Application-quiesced metadata/Secret backups and persistent
  operator/witness state are retained privately. CR7ALLGOALS_APP metadata and
  all-table data fingerprints remain unchanged: 166 objects, 45 tables, 7,785 rows.

The verified native scope is one Autonomous Oracle 26ai `23.26.4.1.0` PDB,
certificate-verified TCPS, node-oracledb 7.0.1 Thin and linux/amd64. The closed
NUMBER/VARCHAR2 BYTE profile supports the three tested additive DDL forms; this is
not general Flyway/Liquibase SQL parity. Discovery remains visibility-limited and
offline catalog validation `UNVERIFIED`. Two incomplete identity observations
remain retained; a later complete native observation enabled verification. A
read-only probe confirmed catalog access; the transient failure cause was not
proven. Oracle 19, arm64 Oracle execution, arbitrary SQL, HA and DR remain
unqualified. Native qualification does not transfer to other source/image or
server versions. See CUSTOMER-GUIDE.md for the ready project and next-change flow.

Local validation also observed that the pre-vault PostgreSQL fixture's schema
fingerprint already differs from the historical identity-backup constant. The
same fingerprint occurs in fresh pre-vault databases and the retained trial
metadata; locale C/C.utf8 does not explain it. Existing fingerprint gates remain
intact. The additive upgrade has its own verified schema fingerprint; historical
backup restore is not newly qualified by these local tests.

### Customer rollout follow-up — 2026-11-08

The customer identified `https://kelryvo.apps.drgdevlab.com/` as the affected
installation and clarified the required result: versioned Oracle migrations with
one instance credential, project-owned schemas and centralized audit. Offline
review and publishing another pilot do not meet that requirement. Customer
databases include 19c and 26; a separate 26 test target has been identified.

Read-only inspection of the URL and `k8s-admin-public` / namespace `kelryvo` found
deployment `kelryvo-app` still using image `afe222f9…` (the `66c4a31` development
artifact), with discovery/execution both disabled and no Oracle installation
mount. HTTPS liveness/readiness pass, with target availability `UNVERIFIED`.
The mounted developer bearer returned HTTP 401; this does not establish the
customer's password-session permissions. That inspection made no deployment or
Oracle writes; the subsequently authorized test-database cleanup and scoped trial
are recorded below.

- [x] **CR1 — Complete the scoped Oracle 26 test workflow:** actual password login,
  project access, operator-managed instance credential, schema assignment and
  identity verification, immutable Git migrations, independent approval, native
  execution and retained audit now pass on the specific installation below.
  This is a test-installation handoff; the customer URL, self-service credential
  vault and Oracle 19 support are not delivered by this result.
- [x] **CR2 — Remove onboarding blockers (merged source):** show the creation UUID that the API
  already returns, route target setup through instance onboarding, and expose
  explicit operator database-management/deployment grants without automatic access
  or approval. Local delivery checks pass (38 Node and three Python setup tests),
  along with one PostgreSQL/Chromium membership workflow and the targeted instance
  master API test. Merged through PR #138 at `7430817338bf1fc248c897c8f0047d827f873699`;
  required source, CodeQL and amd64/arm64 OCI checks passed. The customer URL
  has not been upgraded.

The owner subsequently authorized application-schema cleanup on the supplied
Oracle Autonomous 26ai test PDB. Seventeen named garbage schemas were dropped;
Oracle-maintained users and cloud/admin service accounts were preserved, including
accounts whose `ORACLE_MAINTAINED` flag is `N`. No sessions were killed. Before/after
metadata and all-table content fingerprints prove `CR7ALLGOALS_APP` unchanged
through both cleanup and trial: 166 objects, 45 tables and 7,785 rows.

The fresh trial created exactly five `KRY261108_` accounts: two schema-only owners,
a schema-scoped instance writer, a protected ledger/mutex owner and a read-only
observer. TLS certificate verification remained enabled on TCPS/1521. The native
target reports Autonomous 26ai `23.26.4.1.0`; node-oracledb 7.0.1 Thin was used.
The tested linux/amd64 OCI manifest was
`sha256:a252b0c1e3373e51276dfbf097e22d850f534fcd4d3e4800c341f1ebbd57fe15`,
from source `7430817`. The app and PostgreSQL metadata were isolated local fixtures;
the supplied ADMIN credential was used only for authorized setup/inspection.

- [x] **CR3 — Authorized cleanup and scoped onboarding:** cleanup and protected-schema
  fingerprints pass. Actual API sessions completed project access, one instance
  registration, discovery, two schema assignments/verifications, immutable Git
  releases/plans and independent approval. Discovery was `PARTIAL` with
  `SCHEMA_VISIBILITY_LIMITED`; offline validation remained `UNVERIFIED`. Neither
  result is a full catalog or Oracle semantic-compilation claim.
- [x] **CR4 — Complete the scoped native rollout:** the initial failures below
  remain in history. The first request stopped before SQL because the adapted operator module incorrectly
  expected transport on the profile rather than its route. That HOLD remains.
  The corrected module pinned the route/principal revision and passed native
  identity, TLS, grant and object-integrity preflight. Its V1 request created
  `KRY_PILOT_ITEM (ID NUMBER)`, appended five native ledger events through
  `FILE_APPLIED` and retained one central receipt. Read-only production-ledger
  replay, checksum/receipt recomputation and the V1 object postcondition pass.
  However, the runtime exited before final verification. Its default 300-second
  worker bound is consistent with the observed timing; the exact supervisor fault
  was not logged. Standard expired-lease recovery changed job/attempt to
  `HOLD / LEASE_EXPIRED_UNKNOWN`. Independent reconciliation recorded
  `RETAIN_HOLD`; exact retry returned the same job with no retry/execution authority.
  At that stage V1 was not VERIFIED_SUCCESS and V2/NOOP were unrun. Subsequent
  verified recovery and execution are recorded below. No SQL was replayed, HOLD
  erased, metadata reset or alternate stream used to evade the physical veto.

Selected secret-free evidence, including both failed attempts, native ledger,
receipt preimages, recovery and reconciliation, is retained in the existing
owner evidence store:
`../acceptance-artifacts/customer-adb26-7430817-20261108T173000Z.tar.gz`,
SHA-256 `c5ba76730c04886812cfd2dfdadadfa812a1b976c3474379972342071d7461c7`.
Archive checksum, member round-trip and known-secret scan passed. This is diagnostic
evidence of an incomplete trial, not new Oracle qualification. No customer URL
change, Oracle 19 trial or new Oracle-qualified release occurred.
The owned fixture was stopped after both jobs became terminal HOLD. Its isolated
metadata and private runtime inputs were backed up with checksums to
`../acceptance-artifacts/customer-adb26-private-20261108T173000Z/` (restricted,
credential-bearing; never publish). The backup retains two held jobs, one attempt,
one receipt, one reconciliation, one decision and 51 audit events. This backup
has not been restore-qualified and does not authorize replay.

The owner subsequently delegated the remaining test/recovery decisions, with
`CR7ALLGOALS_APP` protection mandatory. Work now adds a narrowly scoped verified
completion path instead of deleting HOLD or resetting metadata. The implementation
prepares native-chain/receipt evidence, requires an independent exact-digest
`EVIDENCE_REVIEWED` decision, rechecks the target under its mutex and appends one
immutable audit resolution. Original held job/attempt states and exact retries
remain unchanged; a later independently approved plan still needs fresh native
admission. The operator entry point loads a fixed protected module and accepts no
SQL or credentials. The existing schema and backup formats are unchanged.
PR [#139](https://github.com/devsecopslonghn/kelryvo/pull/139) merged as verified
source `58dfae5520c999b49a54f0de48dcbfa0ee77a434`. Source delivery checks (70 Node
and three Python tests), targeted PostgreSQL recovery/restart behavior, one
Chromium recovery flow, CodeQL and both native OCI platform checks passed.
The exact OCI index is
`sha256:3ca9fbea9bfeed123ae7e763702da03e2ec137aa01a31fad5f8ce874077b67cb`;
the tested linux/amd64 manifest is
`sha256:d6140fe7f9b039932916e1dd74e5f8b2dfa89415fb1260a0c87d54818f12e32b`.
[Source CI](https://github.com/devsecopslonghn/kelryvo/actions/runs/42507238490),
[OCI CI](https://github.com/devsecopslonghn/kelryvo/actions/runs/42507238517) and
[CodeQL](https://github.com/devsecopslonghn/kelryvo/actions/runs/42507238108) passed.

The protected C installation uses the same metadata, original stream, native
ledger and trial principals. Its bounded operation and permit are 900 seconds;
the lease remains 300 seconds. Batched read-only attestation retains identity,
TLS, purpose-specific grants and protected-object/source checks. The observer
received only non-grantable `SELECT SYS.GV_$SESSION` for global writer exclusion.
No database-wide write privilege or CR7 authority was added.

Actual native results on that exact image and Autonomous 26ai PDB/TCPS:

- Original V1 remains HOLD. Fresh complete-ledger/receipt verification, independent
  exact-digest review and mutex-protected confirmation added immutable
  `EXECUTION_RECOVERED_APPLIED`. All original job/attempt states remain unchanged.
  V1 SQL was dispatched by source `7430817`; its CREATE TABLE execution
  qualification does not transfer to `58dfae5`.
- A fresh independently approved V2 executed ALTER TABLE/CREATE INDEX and reached
  `VERIFIED_SUCCESS`, with exactly two linked receipts. A fresh subsequent plan
  reached `NOOP`, with zero SQL dispatches and zero receipts. Real password UI
  sessions displayed both outcomes; exact request retries returned the same jobs.
- The production native-ledger reader replays 13 events through versions 1 and 2.
  All three historical/current receipts recompute correctly. Final object/column
  postconditions and all 20 final integrity checks pass; no writer sessions remain.
  `CR7ALLGOALS_APP` still matches its pre-cleanup metadata and all-table data
  fingerprints: 166 objects, 45 tables and 7,785 rows.

Two discovery observations returned incomplete identity before a later real native
observation succeeded. Diagnostic queries succeeded; the transient cause is not
proven. Failed observations remain retained. Offline validation stays UNVERIFIED
and catalog discovery has SCHEMA_VISIBILITY_LIMITED. This does not qualify Oracle
19, arm64 native execution, RAC failover, DR, arbitrary DDL or a generic native
installer. The operator C configuration is narrowly bound and expires at
2026-11-08T22:07:26.774Z; expiry must not be bypassed to continue execution.

The final selected owner evidence archive is
`../acceptance-artifacts/customer-adb26-58dfae5-20261108T190000Z.tar.gz`, SHA-256
`190696f8af1009ab61c800d4ed878bcadcf40ba164aab48f241921f980828962`.
Its 26 members passed known-secret scanning, checksums and member round-trip.
Raw protected-schema business metadata is excluded. The final restricted backup
is `../acceptance-artifacts/customer-adb26-private-20261108T190000Z/`, retaining
four jobs, three attempts, three receipts, two reconciliations, two decisions and
81 audit events, plus private runtime/account inputs. Backup catalog/checksums
pass; restore/DR is not qualified. The owned fixture was restarted after the cold
snapshot. Existing earlier evidence and backups remain unchanged.

The release handoff for source `58dfae5` freezes this exact source/image and reports
the above native scope separately from the default governance-only installer.
Documentation changes after that source do not inherit its Oracle qualification.
At that trial handoff, the customer URL had not been deployed or upgraded.

The current credential UI accepts operator-provisioned references only. A customer
expectation of entering an admin password directly is an implementation gap, not
a completed credential-vault feature. See the live rollout path and prerequisites
in CUSTOMER-GUIDE.md. Keep the original published offline pilot scope below.

Deliver a usable self-hosted pilot for the supported workflow: project and target
setup, SQL/Git release, validation, immutable plan, independent review, governed
execution request, and retained history. Keep the existing Oracle qualification
limits and operator-managed access. The local changes below are a new candidate;
they do not inherit the frozen pilot's native or OCI acceptance.

### Delivery policy — effective 2026-11-08

The owner requested delivery and feature work to proceed together with proportional
verification. There is no separate QC role, sign-off or acceptance phase in routine
delivery. This policy supersedes older process requirements below; historical test
results and the supported Oracle matrix remain evidence with their original scope.

| Lane | When it runs | Effect on delivery |
| --- | --- | --- |
| Delivery essentials | Each PR/master push; locally `npm run check` or `npm run check:delivery` | Required build/typecheck, targeted tests, dependency integrity and notices |
| Exact image and security | Existing OCI smoke on amd64/arm64 and CodeQL | Required source-bound artifacts, startup/governance smoke, secret isolation and security |
| Focused product acceptance | Manual or weekly Wednesday schedule | Advisory; no publish dependency and no per-feature QC sign-off |
| Extended API/browser/parser/install regression | Manual or weekly schedule; `npm run check:full` for full offline coverage | Advisory; failures stay visible and are triaged independently |

Use one relevant build/smoke/targeted check for a change and continue delivery once
it passes. Do not repeat full browser suites or create disposable infrastructure
merely to increase test counts. A missing optional log/fixture, an unrelated test
failure or a dependency-download failure in an advisory run is not a delivery
blocker. Confirmed product failures affecting startup, security, authorization,
data integrity or artifact identity still block the affected artifact or behavior.
The image must actually build and pass its smoke; never relabel a failed gate as
passing. Existing approval and production-execution boundaries remain in force.

`check.yml` and `containers.yml`, together with the existing CodeQL checks, are the
publication prerequisites. `product.yml`, `parser.yml` and `regression.yml` run
independently and are not publication dependencies. Their failed/skipped/cancelled
results remain accurate. Publishing or deployment still needs its own authorization.

- [x] **FLOW — Delivery without a QC dependency:** routine source CI uses the bounded
  delivery checks. Full offline coverage is explicit; focused and broad acceptance
  run on schedule or manually. Publication no longer waits for focused acceptance.
  Global engineering instructions persist the same delivery priorities.
- [x] **DX1 — Guided project workflow:** the overview recommends the next step from
  retained project, role, review and execution facts. Review shortcuts select the
  relevant plan and status; active requests, HOLD, recovery and completed outcomes
  have distinct guidance. Initial project selection shares its existing refresh;
  profile forms enforce developer permissions in the UI, while project and
  environment actions retain the existing membership-based permissions. Empty
  target/draft responses settle their loading indicators. Chromium contract tests
  exercise the actual built web bundle.
- [x] **CI1 — Resilient pinned inputs and source installation:** parser preparation
  retries transient HTTP/network failures up to four attempts within a 180-second
  per-input deadline, reports fixed artifact names and HTTP status without URLs or
  response bodies, checks SHA-256 before installation and removes partial files.
  Server Retry-After delays are honored within that deadline. Exhausted network
  downloads produce redacted GitHub error annotations for diagnosis without logs.
  Corruption and permanent HTTP failures fail closed. Regression runs at most four
  shards concurrently. Docker and source bundles include the downloader; source
  bundles also include the previously omitted JDK platform selector. Fresh public
  ANTLR/JDK preparation, source-bundle checks and local offline checks pass.
- [x] **CI2 — Hosted delivery verification:** PR #135 merged as GitHub-verified
  `6ae30001f72fe659fdf4023cc5634ede9717e0e6`. Source build/targeted checks,
  CodeQL and exact-image amd64/arm64 smoke/index verification passed on master.
  [Source](https://github.com/devsecopslonghn/kelryvo/actions/runs/42491247650),
  [OCI](https://github.com/devsecopslonghn/kelryvo/actions/runs/42491247646),
  [security](https://github.com/devsecopslonghn/kelryvo/actions/runs/42491247339).
  The prior parser-download failure was confirmed from authenticated logs and
  addressed with bounded retries/diagnostics. GitOps remains disabled; this did
  not publish or deploy the new master artifact.
- [x] **SHIP2 — Accept and hand over the new user artifact:** the owner-authorized
  customer pilot below is published from verified master OCI/source artifacts,
  with an installation path, customer Git intake and durable delivery evidence.
  Source, security and both native container/install checks pass. No additional
  QC sign-off or full-browser rerun is required. Execution/discovery remain
  disabled; this handover does not claim new native Oracle acceptance or a
  production/customer infrastructure deployment.


### Customer pilot delivery

The owner authorized a versioned customer pilot release, PR/master delivery and
publication on 2026-11-08. No customer infrastructure deployment is authorized.
The supported initial route is a single Linux Docker Compose host with local Git
checkout intake and offline governance; Oracle execution/discovery stay disabled.

- [x] **CP1 — Customer installation:** ship the isolated Compose definition,
  exclusive root-owned configuration generator, interactive account bootstrap and
  explicit project grants. The app uses a non-superuser metadata role.
- [x] **CP2 — Customer Git:** load operator-owned repository manifests, confine
  checkouts to the read-only repository mount and import the customer's committed
  SQL through the existing release/plan workflow. Keep remote credentials outside.
- [x] **CP3 — Customer operations:** ship CUSTOMER-GUIDE.md with installation,
  login/first project, repository updates, TLS, backup/restore, upgrade and support
  scope. Existing lab Helm defaults are not the customer installation path.
- [x] **CP4 — Published pilot:** publish a dated prerelease from the exact verified
  master OCI, source bundle and matching notices/source access, with checksums and
  release notes. Link the customer guide from the release. No additional QC or
  broad browser rerun is required; targeted checks and the existing OCI smoke apply.

Published [pilot-2026-11-08](https://github.com/devsecopslonghn/kelryvo/releases/tag/pilot-2026-11-08)
contains 17 assets. [PR #136](https://github.com/devsecopslonghn/kelryvo/pull/136)
merged the customer installation and Git intake. The release stays frozen at
GitHub-verified master `d57255b491ce6fe16f660264aa6626f78b88e432` and OCI index
`sha256:fce8082d9c2dc5d74bdd9d5a85137b5a31e00a5e3005f794aceed966bfb80f96`.
[Source checks](https://github.com/devsecopslonghn/kelryvo/actions/runs/42495193505),
[native OCI/install smoke](https://github.com/devsecopslonghn/kelryvo/actions/runs/42495193340)
and [CodeQL](https://github.com/devsecopslonghn/kelryvo/actions/runs/42495193214) pass.
Source checks include 38 targeted Node tests and two Python setup tests. Both
native platforms verify customer Git intake/review and fresh Compose account setup.

Durable [delivery-evidence.json](https://github.com/devsecopslonghn/kelryvo/releases/download/pilot-2026-11-08/delivery-evidence.json)
has SHA-256 `bec3f68feab37fd95c801dfd89c3f5eb9d2eb5ded26febcc4c3e72ef72ab5c44`.
The complete [SHA256SUMS](https://github.com/devsecopslonghn/kelryvo/releases/download/pilot-2026-11-08/SHA256SUMS)
has SHA-256 `7e7f13941830a11613c9af0a27893fdf6d23f7165299d0b98ae8b798de6a1530`.
The release includes the full frozen Git source, exact Debian corresponding sources
for 79 source-package versions, runtime inventories and preserved notices. Its
manifest records the dated owner authorization; embedded older distribution and
pending-work records remain historical. Oracle acceptance and production DR/HA
are not qualified by these offline governance/install checks.


Local verification logs are under ignored `.cache/delivery-20261108/`.
Before the delivery-policy change, the full offline check passed with 497 tests
passing and 154 optional skips; that suite is now `npm run check:full`. Targeted
download, preparation, source-bundle and CI-selection checks passed 17 tests.
After the policy change, `npm run check:delivery` passed build/typecheck, source
hygiene, JSON formatting, dependency closure and 37 targeted tests (zero failures
or skips; test duration 2.14 seconds). The workflow YAML and publication dependency
graph were checked locally. Browser/database suites were not repeated for this
process change. The rule-change logs are in `.cache/delivery-20261108/rule-update/`.
Fresh pinned input preparation and parser build passed, with four ANTLR integration
tests passing using the freshly prepared JDK.

Additional database acceptance uses an owned PostgreSQL 17.10 process and fresh
data directory under `.cache/delivery-20261108/postgres-fixture/`, listening only
on loopback. Official PGDG package checksums were checked against repository
metadata; the ICU dependency was verified against the installed AlmaLinux signing
key. This fixture uses the same loopback trust authentication as CI; Git settings
are isolated in the test subprocesses. No product metadata or service is used.
The focused API run passed 17 tests, and the complete browser suite passed all
64 tests, both with zero failures or skips. A retained source candidate from local
test snapshot `b4acafb4884a6eaee8cdddd5cac5d0c154be310d` passed clean `npm ci`,
license verification, fresh parser/JDK preparation, parser/web build, source
verification and all 27 installed workflow tests, with zero failures or skips.
Its archive is
`.cache/delivery-20261108/candidate/source-bundle/kelryvo-local-b4acafb4884a.tar.gz`,
SHA-256 `25ea9a244e44ced3424c47eb3391df9ae40954ddd11957bb697b42b2356ec490`;
the adjacent `checksums.json` and `candidate/installation-results.json` retain
source, manifest, archive and phase results. This snapshot is local test evidence,
not a published commit or an Oracle-qualified release. Review-branch commits
retain their own source identity; this earlier test snapshot remains unchanged. Earlier fixture authentication/Git-signing failures and the
corrected overbroad UI role restriction remain in their original logs.
The retained candidate predates the delivery-policy change; its historical
acceptance does not claim that the updated workflows have run on GitHub.

At the local-test stage Docker was unavailable; subsequent hosted OCI and source
checks passed and PR #135 was merged as recorded above. New Oracle qualification
and customer deployment were not performed. Historical local results retain their
original scope; they do not describe the later hosted delivery state.

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

**DIST hoàn thành cho artifact frozen `ff239189`.** Ngày 2026-11-02, owner xác nhận
“Phân phối đi...” sau phần giải thích naming/redistribution. Tên phát hành là Kelryvo,
license PolyForm Shield 1.0.0 và Required Notice SchemaForge được giữ nguyên; third-party
grants không đổi. [GitHub Release pilot-2026-11-02-ff239189](https://github.com/devsecopslonghn/kelryvo/releases/tag/pilot-2026-11-02-ff239189)
phân phối đúng OCI CI đã nghiệm thu, source bundle, license/notices, inventories,
acceptance summary và SHA256SUMS. Source đi kèm bao phủ đủ 79 source-package versions
của 115 Debian packages trên mỗi platform, đối chiếu từng `.dsc` và SHA-256. Inventory
OCI giữ 211 runtime files, 115 Debian notices, 38 Temurin legal files, Node license và
hai matching source archives. Metadata clearance trong artifact frozen là lịch sử trước
ủy quyền; `distribution-manifest.json` đi kèm release ghi quyết định mới cho đúng digests.
Chi tiết [distribution-20261102.json](docs/dependencies/distribution-20261102.json).
Nghiệm thu không mở rộng sang production deployment hoặc managed production DR.
Kết quả `bb5c98c` bên dưới giữ đúng phạm vi lịch sử; không rebuild artifact đã thử.

Bằng chứng bền vững [bundle R12](/home/longhn0710/workspace/kelryvo/acceptance-artifacts/acceptance-ff239189-20261102T003404Z-technical-r12.tar.gz)
có 1.824 files, SHA-256 `aa4bd0340b05dd488e00313b6c07de8550867e827d0da20b2a8b48b498496436`.
Đã mở lại và đối chiếu từng member; kiểm tra 216 giá trị bí mật đã biết, zero matches.
URL có credential trong operator return được giữ riêng dưới private storage và redacted
trước khi tạo archive. Original CI OCI được giữ riêng ngoài cache, SHA-256
`e4f35ebf4e4f8602b181ec26a2b10f3a24bc03a7f5e94ed84904af670f1882f0`.
Bundle R12 giữ nguyên trạng thái technical PASS, DIST pending trước ủy quyền. Hồ sơ
distribution mới ở release ghi owner sign-off và public distribution của đúng artifact;
không sửa bằng chứng lịch sử hoặc chứng nhận production deployment.

| Phạm vi hiện hành | Đã kiểm chứng | Giới hạn |
| --- | --- | --- |
| Oracle native | Oracle Free 23.26.3, PDB, TCP loopback, Linux amd64, Thin driver 7.0.1 | Chưa nghiệm thu 19c/21c, non-CDB, TCPS, RAC hoặc Data Guard |
| Metadata | PostgreSQL 17.10; upgrade T32, backup/restore và restart trong lab owned | Chưa nghiệm thu managed production DR hoặc HA |
| OCI | Artifact CI của `ff239189`, kiểm tra amd64/arm64; native acceptance dùng amd64 | Không chuyển kết quả native sang arm64 hoặc image cluster đang triển khai |
| Bàn giao | Public pilot release đúng artifact, kèm source/notices/checksums; bằng chứng lab giữ local | Production deployment và future artifacts cần nghiệm thu/ủy quyền riêng |

- App: `kelryvo`, source runtime được nghiệm thu `ff23918975ba017d523b7a443e4965d5f935dbbf`; mốc native local trước đó `bb5c98c10eaaf779959008aeaeebbc32f1b8bba0` (2026-11-01).
- Helm: `kelryvo-helm-chart`, source hiện hành `9fe32cb` (2026-11-01).
- Image development được ghi nhận đã triển khai: `docker.io/longhn0710t/kelryvo-pilot@sha256:afe222f97fddcf69e91ce0f2127afb55eaadd6a09b85ac8f3098c285f57775ec`.
- Delivery này ghi nhận Helm revision 4, execution/discovery **off**, Argo reconciliation
  của riêng Kelryvo tạm dừng. Image cluster này khác image local bên dưới; không chuyển
  kết quả nghiệm thu local thành kết quả rollout. Đợt QC này đã push/merge PR #132 theo ủy quyền riêng và phân phối frozen artifact qua GitHub Release; chưa deploy mới.
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
  DIST được đóng bằng owner authorization và public pilot release ghi ở đầu checklist.
  Không deploy mới; GitOps delivery mode không thay đổi, promotion vẫn SKIP.
- [x] **DIST — Distribution/naming:** owner ủy quyền “Phân phối đi...” ngày 2026-11-02,
  phát hành Kelryvo dưới license/Required Notice hiện hành cho đúng source `ff239189`
  và OCI index `sha256:f7dcdc1837374a1860fdc5134e5e6aa6be2184450c6591dbff02cdb196afdbe6`.
  Public GitHub pilot release có exact source/OCI, license/notices, inventories,
  SHA256SUMS và đầy đủ source files của 79 Debian source-package versions; từng `.dsc`
  khớp source/version và tất cả SHA-256/size. Temurin source/build-source archives giữ
  trong OCI. Owner sign-off, artifact hashes và đích phân phối ghi ở
  `docs/dependencies/distribution-20261102.json`; không áp dụng blanket clearance cho
  các bản build/artifact tương lai hoặc mở rộng Oracle/production acceptance.

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
`KELRYVO_JAVA_HOME` trỏ tới JDK đã chuẩn bị. PostgreSQL test phải là fixture disposable
riêng qua `KELRYVO_TEST_DATABASE_URL`; không dùng metadata sản phẩm. Native backup fixtures dùng chung Docker daemon chạy tuần tự; các API files còn lại
chạy tối đa hai subprocesses. Product runner
nếu thiếu URL sẽ khởi tạo Docker local; chỉ chạy khi đã xác nhận fixture/environment.

Tên sản phẩm/configuration hiện hành là Kelryvo và `KELRYVO_*`; web build mặc định
hiển thị Kelryvo. Các biến `SCHEMAFORGE_*` cũ và hai biến gõ nhầm
`KELYRVO_DISCOVERY_MANIFEST`/`KELYRVO_DISCOVERY_SECRET_DIRECTORY` vẫn được nhận làm
aliases; giá trị `KELRYVO_*` ưu tiên khi cùng được đặt. Worker chỉ chuyển tiếp các
aliases thuộc allowlist hiện có, giữ tương thích với installation factories cũ.
Database/user/container/volume local, cookie/CSRF, backup/source manifest formats,
worker protocol, parser package/JAR và Oracle mutex namespace giữ định danh cũ để
bảo toàn dữ liệu, session, checksums và loại trừ writer giữa các phiên bản. Các tên
này không phải branding; Required Notice/provenance và bằng chứng frozen không đổi.
Đợt đổi tên source này không kế thừa nghiệm thu Oracle/OCI của artifact `ff239189`.

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
