# Kelryvo containers

Build either Linux architecture with `docker buildx build --platform linux/amd64
--target app --load --tag kelryvo-app:local .` (use `linux/arm64` on an ARM64
builder), and the corresponding worker target. CI uses native AMD64 and ARM64
runners, checks Node, JDK/parser, HTTPS readiness, governance and worker fail-closed
behavior on each, then assembles the tested OCI artifacts into two-platform indexes.
The pinned Node/Debian base indexes and architecture-specific Temurin archives keep
executables matched to the target. The existing pinned parser is built inside the image;
production npm packages, full Node/JDK notices, matching JDK source archives and
the Debian package/notice inventory are retained. Node/npm dependency pins and
PolyForm Shield 1.0.0 remain unchanged. npm, yarn and corepack are build tools,
excluded from runtime layers. This owner-authorized internal deployment does not
certify general public distribution or Oracle runtime behavior.

The app serves the existing React/Fastify product as Kelryvo. It runs as UID 10001,
uses port 8443 and defaults to `KELRYVO_BIND_HOST=0.0.0.0`. `KELRYVO_PORT` accepts
1–65535. Mount a read-only Secret at `/run/kelryvo/secrets`, or set the absolute
`KELRYVO_SECRET_DIR`. Required files are `database-url`, `tls.crt` and `tls.key`.
Legacy `developer-token` and `approver-token` files are optional as a pair. The database URL must identify external
PostgreSQL with a database, user and password; it is never logged. Actor tokens
must be distinct 64-character lowercase hex values. Projected Kubernetes Secret
links are resolved within their mount; escaping, writable or oversized files are
rejected with fixed errors. TLS is mandatory for container startup.

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
actor's fixed role and do not enable the worker or authorize Oracle execution. All effects
use the existing serialized membership operator and retained audit. Legacy actor startup never
creates project grants or resets revoked credentials. Store and deliver actor tokens
through private operator channels; do not put them in chart values, logs or Git.

Actor credentials retain their existing 24-hour lifetime. To rotate a fixed actor,
the trusted namespace operator first replaces that actor's token in the Kubernetes
Secret with a fresh distinct random 64-character hex value, using resource-version
checks and private input. Wait for the projected Secret to update, then run
`node scripts/container-credentials.mjs rotate developer` (or `approver`) in the app
pod. Only this explicit operator action adopts the desired token. It atomically retires
the actor's previous local/browser credentials, records immutable metadata revocation
evidence/audit and issues a new 24-hour credential. It preserves memberships, roles,
plans and history. Identity-managed accounts use the administration UI; fixed legacy actors retain this operator lifecycle.

If interrupted before the transaction commits, retry with the same projected desired
token; prior database authority remains unchanged. After commit, retry is a no-op and
does not extend expiry. An already expired or revoked desired token is rejected;
choose a fresh token instead. RESTORE_HOLD rejects issuance and revocation. Restart
never adopts a changed token or resurrects a retired credential. Do not distribute
the desired token until the operator succeeds and secure login verifies it. No app
restart is needed after successful rotation. Preserve private operator access for
recovery when an actor's credential has expired.

The separate worker runs as UID 10002. Its existing entrypoint requires an explicitly
installed private trusted service and fails closed when absent. There is no public
worker service. Kubernetes worker replicas must remain disabled until trusted purpose
authority, target isolation and authorized Oracle runtime acceptance are available.

Run `node scripts/test-containers.mjs` after both builds. It uses an owned disposable
PostgreSQL container on an internal network, read-only app filesystem, dropped Linux
capabilities and private mounted test Secrets. It checks secure login, CSRF/Origin
denials, explicit membership, Git/parser import, independent approval, NOT_EXECUTED
history, deployment grant/revoke, queued request cancellation, account/session controls,
profile retirement, graceful restart persistence, runtime notices and worker rejection. It removes
only its own disposable fixtures. No Oracle endpoint is contacted.

The OCI workflow verifies candidate/master builds without publication. Successful
master verification exports both tested images as a short-lived Actions artifact.
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
local image configuration; a partial publication resumes without replacing the
first image. Both platform manifests/configurations and the enclosing OCI index are
SHA-256 verified against the tested artifacts, and
only a complete verified app/worker pair can reach promotion. No mutable latest tag
is written. Assembled platform descriptors use verified media type, digest, size and
architecture; transient exporter layout timestamps are excluded, so re-exporting
identical child images preserves the index digest and permits a no-op promotion.
Source provenance remains verified in each platform's image configuration.
Artifact retention is three days; recovery after expiry requires rerunning
master OCI verification, whose completion event resumes delivery.

The full delivery workflow is serialized without cancelling active writes. Before
promotion it independently revalidates both registry digests, source labels, the
verified tags and all source gates. The chart checkout must match Helm master.
Only `app.image.digest` and `worker.image.digest` in `values.yaml` change to the
`linux/amd64` + `linux/arm64` OCI index digests; the worker
remains at zero replicas. Run `helm lint --strict .`,
`python3 scripts/check-chart.py`, and
`helm template kelryvo . --namespace kelryvo` before any chart commit. Helm commits
record `Kelryvo-Source-SHA`, `Kelryvo-App-Digest` and `Kelryvo-Worker-Digest` trailers.
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
3. Ensure the source `GITHUB_TOKEN` has GHCR package write access for both images.
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

## Authentication and identity

Fresh installations bootstrap a local `admin` account. Mount a private writable
volume at `/var/lib/kelryvo/identity` owned by UID 10001 with mode 0700. The API
writes a random initial password to `bootstrap-admin.json` with mode 0600 and
never prints it. An authorized namespace/OS operator retrieves that file through
a private channel. Login uses HTTPS; the first session permits only password
change and sign-out. The initial password stops working after that change.
`KELRYVO_BOOTSTRAP_PASSWORD_FILE` may select another absolute private path.
Startup preserves an existing administrator, credentials and authorization data.

Only `database-url`, `tls.crt` and `tls.key` are required in the application Secret.
The legacy `developer-token` and `approver-token` files are optional as a pair and
retain their existing lifecycle when supplied. Normal users need no bearer token.
New workspaces activate project membership enforcement during administrator
bootstrap. Administrators create users/groups and assign project roles through
Identity administration; creating a project explicitly assigns its creator owner
access. Environment-scoped assignments restrict deployment permissions to that
environment. Every environment defaults to independent approval, regardless of
its name. Direct deployment requires an explicit environment policy change and a
retained authorization decision; changing policy back blocks queued self-authorized
execution. Existing schema scope, target validation and runtime gates still apply.

Mount LDAP service passwords and OIDC client secrets in a **separate** read-only
Secret directory `/run/kelryvo/identity-secrets` (override with
`KELRYVO_IDENTITY_SECRET_DIR`). Provider configuration accepts `secret://filename`
references and never returns secret values. Do not put metadata, Oracle writer or
TLS private keys in that mount. Configure trusted corporate CAs using
`NODE_EXTRA_CA_CERTS`; certificate verification remains enabled. LDAP requires
LDAPS or StartTLS, a bounded single-user search, stable entryUUID/objectGUID and
an explicit group mapping. OIDC uses discovery, authorization code with PKCE,
state and nonce checks, and the configured HTTPS callback on the application
origin. New-provider callback configuration may use
`https://YOUR_HOST/api/auth/oidc/{id}/callback`; save the provider, then register its
resolved callback in the provider. Auto-provisioning is off unless explicitly
configured; external subjects never auto-link to local accounts by email/name.
Workspace administrator status is assigned locally, never by provider claims.

For emergency administrator recovery, an authorized OS operator with access to
the metadata Secret runs `node scripts/identity-recovery.mjs ABSOLUTE_NEW_FILE
"reason for emergency recovery"`. The output path must be new, in a directory
owned by that operator with mode 0700. Recovery generates a new random password,
revokes all administrator credentials/sessions, records immutable operator audit,
and requires password change. It rejects RESTORE_HOLD. It never grants worker or
Oracle authority. Retain the private identity volume and provider Secret mount
through restart; application state lives in PostgreSQL.

Local `npm run dev` generates a private installation-specific HTTPS certificate
and bootstrap password under `.cache/local-product`. Trust
`.cache/local-product/tls/server.crt` for local development, or supply the existing
`--tls-cert` / `--tls-key` options. Production uses its managed TLS certificate.

For the local development installation, use the same recovery command with `--local`
(and optional `--config ABSOLUTE_PRIVATE_CONFIG`). It validates the existing private
local configuration and loopback metadata URL without starting services or creating
credentials. After changing the initial password, the bootstrap file contains an
invalid credential; the operator may remove it from the private identity volume.
Keep project-wide viewer access explicit when adding narrower environment roles: shared
project/source pages require a project-wide role, while environment roles authorize
only resources with that persisted environment.
