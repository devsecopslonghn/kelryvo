# Kelryvo containers

Build the unified Linux application image with `docker buildx build --platform
linux/amd64 --target app --load --tag kelryvo-app:local .` (use `linux/arm64` on an
ARM64 builder). CI uses native AMD64 and ARM64 runners, checks Node, JDK/parser,
HTTPS readiness, governance and runtime isolation on each, then assembles the tested
app artifacts into one two-platform index.
The pinned Node/Debian base indexes and architecture-specific Temurin archives keep
executables matched to the target. The existing pinned parser is built inside the image;
production npm packages, full Node/JDK notices, matching JDK source archives and
the Debian package/notice inventory are retained. Node/npm dependency pins and
PolyForm Shield 1.0.0 remain unchanged. npm, yarn and corepack are build tools,
excluded from runtime layers. This owner-authorized internal deployment does not
certify general public distribution or Oracle runtime behavior.

The image runs `/opt/kelryvo/bin/kelryvo-runtime` as `0:0` for a short bootstrap.
The native PID 1 stages private inputs, starts the API as UID 10001 and the internal
execution/discovery process as UID 10002, then keeps only `CAP_KILL` to stop those
process groups. Both children have empty effective capabilities. The container is
read-only, drops all capabilities before adding `CHOWN`, `SETUID`, `SETGID` and
`KILL`, and uses private tmpfs mounts for runtime state and `/tmp`. Essential child
failure stops the container; there is no child restart loop. The same image,
entrypoint, flags and filesystem contract are used by Compose and Helm.

The API serves the existing React/Fastify product as Kelryvo on port 8443 and
defaults to `KELRYVO_BIND_HOST=0.0.0.0`. `KELRYVO_PORT` accepts 1–65535. Mount a
read-only source Secret at `/run/kelryvo/secrets`, or set the absolute
`KELRYVO_SECRET_DIR`. The source directory must be root-owned and not writable by
group/other; each required source file must be a regular root-owned file with mode
`0400` and one hard link. Required files are `database-url`, `developer-token`,
`approver-token`, `tls.crt` and `tls.key`. The database URL must identify external
PostgreSQL with a database, user and password; it is never logged. Actor tokens
must be distinct 64-character lowercase hex values. Projected Kubernetes Secret
mounts use `KELRYVO_SECRET_DIR=/run/kelryvo/secrets/..data`: bootstrap resolves that
protected projection directory, then opens its regular files without following
file symlinks. Escaping, writable or oversized files are rejected. Bootstrap stages only
the five API inputs under
`/run/kelryvo/runtime/api/secrets`, owned by UID 10001. TLS is mandatory for startup.

`compose.yaml` runs one application container and connects it to external PostgreSQL
over the `kelryvo` Docker network (override with `KELRYVO_NETWORK`). Set
`KELRYVO_IMAGE` to `ghcr.io/devsecopslonghn/kelryvo-app@sha256:<verified-index-digest>`
and `KELRYVO_SECRET_DIRECTORY` to the existing root-owned Secret directory before
`docker compose up -d`. The published HTTPS port binds to loopback by default; set
`KELRYVO_HOST_PORT` to change its host port. Attach an external PostgreSQL container
to that network or use a reachable PostgreSQL hostname in `database-url`. Compose
does not create a database, secret directory or persistent metadata volume. It has
no automatic restart policy, so inspect retained metadata and execution history
before restarting after an essential process failure.

Terminate public HTTPS at the existing ingress and use HTTPS to the backend too.
Preserve the public Host header. The API does not trust forwarded protocol headers;
its encrypted-socket, Origin, secure cookie and CSRF checks remain enforced. The
app includes an allowlisted immutable Git demo with two synthetic Oracle migrations.
Importing and approving them establishes offline governance only. It does not connect
to Oracle or imply target availability.

Use HTTPS `/api/livez` for process liveness and startup, and `/api/readyz` for current
metadata read availability. A RESTORE_HOLD database can be ready for historical reads;
mutation and execution HOLD checks remain intact. SIGTERM/SIGINT drain Fastify and the
PostgreSQL pool; shutdown exceeding 25 seconds exits unsuccessfully.

Membership remains deny by default. An authorized pod/OS operator may run
`node scripts/container-membership.mjs activate` for a fresh empty organization,
then `grant PROJECT_UUID kelryvo-developer` and `grant PROJECT_UUID kelryvo-approver`
for an explicitly selected project. The same command supports `revoke`. Separately
authorize durable deployment requests with `deploy-grant PROJECT_UUID kelryvo-developer`,
and withdraw that capability with `deploy-revoke PROJECT_UUID kelryvo-developer`.
Project access alone does not permit deployment requests; these commands preserve the
actor's fixed role and do not enable execution or authorize Oracle execution. All effects
use the existing serialized membership operator and retained audit. Startup never
creates implicit grants or resets revoked credentials. Store and deliver actor tokens
through private operator channels; do not put them in chart values, logs or Git.

Actor credentials retain their existing 24-hour lifetime. To rotate a fixed actor,
the trusted operator first replaces that actor's token in the source Secret with a
fresh distinct random 64-character hex value, using private input (and Kubernetes
resource-version checks when applicable). For Compose, update the root-owned source
file while preserving `root:root` mode `0400`. Then restage API inputs with
`docker compose exec --user 0:0 kelryvo /opt/kelryvo/bin/kelryvo-runtime --prepare`
and run `docker compose exec --user 0:0 kelryvo node scripts/container-credentials.mjs
rotate developer` (or `approver`). In Kubernetes, wait for the projected Secret update,
run the same `--prepare` command in the app pod, then invoke the credential operator.
Only this explicit operator action adopts the desired token. It atomically retires
the actor's previous local/browser credentials, records immutable metadata revocation
evidence/audit and issues a new 24-hour credential. It preserves memberships, roles,
plans and history. The API has no credential-management route.

If interrupted before the transaction commits, retry with the same projected desired
token; prior database authority remains unchanged. After commit, retry is a no-op and
does not extend expiry. An already expired or revoked desired token is rejected;
choose a fresh token instead. RESTORE_HOLD rejects issuance and revocation. Restart
never adopts a changed token or resurrects a retired credential. Do not distribute
the desired token until the operator succeeds and secure login verifies it. No app
restart is needed after successful rotation. Preserve private operator access for
recovery when an actor's credential has expired.

Execution and discovery remain disabled by default through
`KELRYVO_EXECUTION_ENABLED=false` and `KELRYVO_DISCOVERY_ENABLED=false`. When either
is enabled, bootstrap requires a root-owned private installation directory mounted at
`/run/kelryvo/installation`; it stages files into the UID 10002-only runtime area.
Execution requires `execution-service.mjs`; discovery requires
`discovery-manifest.json`. For a local Compose run, stop the offline app and supply
the separately reviewed installation explicitly:

```sh
docker compose run --rm --service-ports \
  --volume "${KELRYVO_INSTALLATION_DIRECTORY:?Set the private installation directory}:/run/kelryvo/installation:ro" \
  --env KELRYVO_EXECUTION_ENABLED=true kelryvo
```

Enabling a feature without its required installation fails closed. No approved
Oracle runtime acceptance is recorded for this unified image. Do not enable Oracle
execution or contact an Oracle target without explicit authorization and the
reviewed secret-free lab manifest required by the acceptance procedure.

Run `node scripts/test-containers.mjs kelryvo-app:local linux/amd64` after building
the app image (use `linux/arm64` for an ARM64 image). It uses an owned disposable
PostgreSQL container, read-only application filesystem, dropped Linux capabilities
and root-owned private test Secrets. It checks secure login, CSRF/Origin
denials, explicit membership, Git/parser import, independent approval, NOT_EXECUTED
history, deployment grant/revoke, queued request cancellation, account/session controls,
profile retirement, graceful restart persistence, source-secret restaging, API and
execution process isolation, fail-closed installation checks, runtime notices and
container termination on essential child loss. It removes only its own disposable
fixtures. No Oracle endpoint is contacted.

The OCI workflow verifies candidate/master builds without publication. Successful
master verification exports the tested app index as a short-lived Actions artifact.
`Kelryvo verified GitOps delivery` (`delivery.yml`) runs on `workflow_run: completed`
for Foundation, focused PRODUCT, OCI verification and default CodeQL, restricted to
source master. Each event takes one gate snapshot. Pending/failed gates defer
publication; the final completion event reevaluates every gate. No sleeps, polling,
PR artifacts or privileged PR checkout are used. A master `workflow_dispatch` remains
available for recovery, including promotion after credentials have been repaired.

Delivery checks the exact current master, successful push runs for all three required
workflows, the latest master CodeQL run and all four language jobs, and open
code-scanning findings. It consumes only the successful OCI run/attempt's images;
there is no second build. Images retain immutable
`SOURCE_SHA-OCI_RUN_ID-OCI_RUN_ATTEMPT` tags and source labels. Before each registry
write it rechecks all gates and current master. Existing tags must match the tested
local image configuration; publication resumes without replacing an existing image.
Both platform manifests/configurations and the enclosing OCI index are
SHA-256 verified against the tested artifacts, and
only the complete verified app image can reach promotion. No mutable latest tag
is written. Assembled platform descriptors use verified media type, digest, size and
architecture; transient exporter layout timestamps are excluded, so re-exporting
identical child images preserves the index digest and permits a no-op promotion.
Source provenance remains verified in each platform's image configuration.
Artifact retention is three days; recovery after expiry requires rerunning
master OCI verification, whose completion event resumes delivery.

The full delivery workflow is serialized without cancelling active writes. Before
promotion it independently revalidates the registry digest and source labels, the
verified tags and all source gates. The chart checkout must match Helm master.
Only top-level `image.digest` in `values.yaml` changes to the unified app's
`linux/amd64` + `linux/arm64` OCI index digest. The chart uses the same repository
and image configuration as Compose. Run `helm lint --strict .`,
`python3 scripts/check-chart.py`, and
`helm template kelryvo . --namespace kelryvo` before any chart commit. Helm commits
record `Kelryvo-Source-SHA` and `Kelryvo-App-Digest` trailers. Existing promotion
history containing the prior app/worker digest trailers remains readable.
An older/divergent source cannot supersede a promoted source; the same source and
digests are a no-op. The source is checked again immediately before the branch write.
A non-forced Git ref update with the inspected Helm master as its sole parent rejects
concurrent chart updates; delivery fails for a safe rerun instead of blindly rebasing.
Cross-repository source reads and Helm writes cannot be one atomic transaction, so
a merge arriving after the final source check is handled by the newer source's own
completion events. Serialization and the Helm ref update prevent an older run from
overwriting a newer promotion.

If Helm master is protected, delivery creates a narrowly scoped
`automation/kelryvo-images-SOURCE_SHA` draft promotion PR instead, reusing an identical
open PR. It closes superseded automation PRs and recovers an exact orphan branch
when a prior PR creation failed. Normal chart CI/review must pass before an owner
marks the draft ready and merges it. Do not grant a
branch-protection bypass. Review source currency before merging a promotion PR;
protected-chart PRs require the repository's normal integration process. GitHub
reports master protection in its branch API; policy/permission denials remain explicit
failures and never trigger a forced update.

Owner setup for cross-repository authentication:

1. Create a fine-grained personal access token for **only**
   `devsecopslonghn/kelryvo-helm-chart`, with repository **Contents: read/write**
   and **Pull requests: read/write** (for the protected-branch PR fallback).
   Metadata read is implicit. No organization, Administration, Actions, Workflows,
   Secrets or cluster permissions are needed.
2. In `devsecopslonghn/kelryvo` → Settings → Secrets and variables → Actions,
   add the repository secret `GITOPS_TOKEN`. The workflow uses it only for Helm
   checkout and promotion; checkout does not persist it. Store the token through
   GitHub's secret input or `gh secret set GITOPS_TOKEN --repo
   devsecopslonghn/kelryvo` with private stdin. Keep it out of chat, Git, logs
   and command arguments. GitHub's secret API returns metadata, not secret values;
   a secret in another repository cannot be read back and copied by this agent.
3. Ensure the source `GITHUB_TOKEN` has GHCR package write access for the app image.
   Delivery requests source Contents/Actions/security-events read and Packages
   write only in publication (Packages read in promotion). Missing `GITOPS_TOKEN`
   and HTTP permission failures fail
   with fixed actionable diagnostics. After setup, rerun a failed delivery run or
   use the master recovery dispatch; routine merges need no manual publication.

Targeted delivery tests: `node --test tests/container-delivery.test.mjs`.
The dedicated `kelryvo-helm-chart` repository owns deployment configuration and
pinned published image digests. Kubernetes/PVC/public browser verification remains
separate from container verification. This delivery work changes no Argo CD or
Kubernetes resources and authorizes no Oracle execution.
