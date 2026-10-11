# Kelryvo containers

Build native amd64 images with `docker build --platform linux/amd64 --target app
--tag kelryvo-app:local .` and the corresponding `--target worker --tag
kelryvo-worker:local`. The existing pinned parser is built inside the image;
production npm packages, full Node/JDK notices, matching JDK source archives and
the Debian package/notice inventory are retained. Node/npm dependency pins and
PolyForm Shield 1.0.0 remain unchanged. npm, yarn and corepack are build tools,
excluded from runtime layers. This owner-authorized internal deployment does not
certify general public distribution or Oracle runtime behavior.

The app serves the existing React/Fastify product as Kelryvo. It runs as UID 10001,
uses port 8443 and defaults to `KELRYVO_BIND_HOST=0.0.0.0`. `KELRYVO_PORT` accepts
1–65535. Mount a read-only Secret at `/run/kelryvo/secrets`, or set the absolute
`KELRYVO_SECRET_DIR`. Required files are `database-url`, `developer-token`,
`approver-token`, `tls.crt` and `tls.key`. The database URL must identify external
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
for an explicitly selected project. The same command supports `revoke`. All effects
use the existing serialized membership operator and retained audit. Startup never
creates implicit grants or resets revoked credentials. Store and deliver actor tokens
through private operator channels; do not put them in chart values, logs or Git.

The separate worker runs as UID 10002. Its existing entrypoint requires an explicitly
installed private trusted service and fails closed when absent. There is no public
worker service. Kubernetes worker replicas must remain disabled until trusted purpose
authority, target isolation and authorized Oracle runtime acceptance are available.

Run `node scripts/test-containers.mjs` after both builds. It uses an owned disposable
PostgreSQL container on an internal network, read-only app filesystem, dropped Linux
capabilities and private mounted test Secrets. It checks secure login, CSRF/Origin
denials, explicit membership, Git/parser import, independent approval, NOT_EXECUTED
history, graceful restart persistence, runtime notices and worker rejection. It removes
only its own disposable fixtures. No Oracle endpoint is contacted.

The OCI workflow verifies candidate/master builds without publication. Dispatch on
current master to publish the same images tested by that run to GHCR with immutable
source SHA/run ID/attempt tags and revision labels, avoiding replacement during reruns.
Publication checks the exact current master, successful Foundation,
parser, full PRODUCT and all CodeQL languages, and open code-scanning findings before
build and again before push. Required integration reviews/security gates also apply.
The dedicated `kelryvo-helm-chart` repository owns deployment configuration and pinned
published image digests. Kubernetes/PVC/public browser verification remains separate
from container verification.
