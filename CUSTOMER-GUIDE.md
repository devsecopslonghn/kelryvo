# Kelryvo customer guide

## Managed Oracle customer deployment

Open [Kelryvo](https://kelryvo.apps.drgdevlab.com/). Version
`managed-oracle26-2026-11-09` uses runtime source
`b14d9cf0c75ec67b8eb78aff5c7e921dd31ecefa` and verified OCI index
`sha256:e53cc2111b27a5ca05ec398f2243cfbd6249ff7f339432acc1028257633d1be1`.
The actual linux/amd64 deployment completed the workflow below on one Autonomous
Oracle 26ai `23.26.4.1.0` PDB over certificate-verified TCPS. Oracle 19 and arm64
Oracle execution are not qualified.

The operator supplies separate developer and approver passwords privately.
Existing customer accounts and history were retained. The ready project is
**Oracle 26 managed rollout**, environment **Oracle26 DEV**, schema
**KRV261109_APP_A**. Its saved SQL draft is **Managed Oracle versioned rollout**.
V1 and V2 are applied; the later approved comparison is NOOP. Inspect
**Plans & review**, **Migration history** and **Audit log** for the retained results.
CR7ALLGOALS_APP remains protected and unassigned.

To make the next change:

1. Sign in as the developer and select the ready project. Under **Connections**,
   enter a reason, **Discover schemas**, then refresh the existing schema's
   verification if its evidence has expired. Keep the existing assignment/stream.
2. Open **SQL Workspace** and the saved draft. Keep V1/V2 paths and SQL unchanged.
   Use **Add SQL file** for a new version such as `V3__add_status.sql`, then
   **Save draft**, **Review syntax**, **Validate against target** and
   **Prepare immutable release**. Use **Create immutable plan** when enabled;
   validation may need refreshing for the prepared release/current target.
3. Sign in separately as the approver, inspect the exact plan, SQL and target,
   then approve. The developer cannot approve their own plan.
4. Return as the developer to **Plans & review**, open the approved plan, enter
   a request reason and select **Request deployment**. Wait for `VERIFIED_SUCCESS`
   or NOOP, then inspect its requests, history and audit. Retrying an identical
   request returns its existing job.

The initial execution profile accepts uppercase unquoted names and bounded
NUMBER/VARCHAR2 BYTE CREATE TABLE, ADD COLUMN and CREATE INDEX. Example V3:
`ALTER TABLE ROLLOUT_ITEM ADD STATUS_CODE NUMBER;`. It rejects unsupported forms
before queuing. It does not provide arbitrary SQL or general Flyway/Liquibase
parity. New project access and any expansion of the protected installation scope
remain explicit operator actions. Existing populated owners cannot be adopted
implicitly. A HOLD requires evidence inspection; never delete history, replace
streams or replay ambiguous SQL to get past it.

**Manage saved credential** under Connections replaces the encrypted instance
password or revokes/disables it. Replacement preserves history but invalidates
old target profiles: wait for installation to finish, discover, reassign the same
schema/environment and verify again before preparing a fresh plan. The verified
replacement retained the same instance, assignment, binding and stream. This
updates the saved credential; it does not change the database server's password.
Revocation has scoped crypto/API/PostgreSQL coverage and was not invoked on the
retained live connection. Neither the API nor audit reveals the saved password.

Three native receipts independently recompute; the native ledger has 13 events
for versions 1 and 2. NOOP has zero receipts, dispatches or started statements.
The original 58 customer jobs, 12 HOLD records and 1,065 audit rows are unchanged.
Full CR7ALLGOALS_APP fingerprints match before/after: 166 objects, 45 tables and
7,785 rows. Consistent metadata backups with the app stopped, private Secrets and
the persistent operator/witness state are retained by the owner. These checks do
not qualify disaster recovery. Catalog visibility remains limited, offline
validation is `UNVERIFIED`, and incomplete observations remain in history; retry
read-only discovery when it cannot establish identity. Do not assign from an
incomplete observation. Known runtime dependency advisories remain open.

## Native Rust checkout (unreleased)

The current checkout's default Dockerfile builds the Rust API, worker, operators,
parser and Rust/WASM UI. This does not replace the published images or transfer
the managed Oracle qualification above to the rewrite. Native controller chart
wiring is available as a review patch below; the companion checkout retains its
published wiring until an explicit cutover. See RUST3–RUST6 in [CHECKLIST.md](CHECKLIST.md).

For a locally built native image, extract its matching operator on the same
architecture, then prepare a new private Compose installation:

```sh
docker create --name kelryvo-native-extract --entrypoint /bin/true kelryvo:rust-local
docker cp kelryvo-native-extract:/opt/kelryvo/bin/kelryvo-operator ./kelryvo-operator
docker rm kelryvo-native-extract
sudo ./kelryvo-operator pilot init --directory /srv/kelryvo-native --image kelryvo:rust-local
sudo docker compose --env-file /srv/kelryvo-native/pilot.env \
  -f /srv/kelryvo-native/compose.yaml up -d
sudo ./kelryvo-operator pilot bootstrap --directory /srv/kelryvo-native
```

Bootstrap asks for two distinct account names and hidden passwords. PostgreSQL
must be healthy first. Metadata readiness becomes available after bootstrap;
missing Oracle installation does not block the API. Native pilot `verify`,
`status`, `grant`, `database-grant` and `deploy-grant` replace the Python installer
commands for this image. Keep the operator binary with its matching image.
The native container launcher supervises separate API and worker processes under
different OS users. The API serves the Rust/WASM UI and records execution requests
in PostgreSQL; the worker validates those requests before using its protected
Oracle credentials. Read-only test/discovery uses a private Unix socket. There is
no separate message broker. `/api/readyz` reports metadata readiness, including
historical reads during RESTORE_HOLD; it does not certify Oracle connectivity or
authorize execution. A worker awaiting installation can leave the API ready.
Concurrent readiness probes share one unfinished metadata read. A probe returns
unavailable after one second while that read remains in progress; its eventual
result is not cached for later probes. Liveness remains independent of metadata.

The API and execution worker are processes in the same application container,
supervised by `kelryvo-runtime`; they are not separate worker Deployments.
UID 10001 serves HTTP and has no private Oracle execution credentials. UID 10002
handles execution and the read-only discovery socket. In managed Oracle mode,
the optional root controller runs as the `oracle-operator` sidecar and prepares
the protected installation; it does not dispatch migration jobs.
Each prepare, refresh and publish step runs in a fresh instance of the same
native installer executable so its OCI state is isolated from the controller
and other steps. Shutdown waits for the active installer to terminate. An
unfinished setup remains held for review; restarting does not replay its DDL.

Native discovery stays unaccepted until an operator separately reviews native
qualification evidence. Installation readiness does not create that review.
For an existing prepared native installation, root-only
`kelryvo-worker installation-observer-scope /absolute/prepared-directory` prints
the review scope without contacting Oracle or creating acceptance. The private
review JSON has exactly `format: 1`, `driverProfile`, `sourceCommit`,
`authorizationId`, `expiresAt`, `acceptedAt`, `scopeDigest` and `evidenceDigest`.
Use the emitted native scope and policy expiry, the actual review time and the
digest of the separately reviewed native qualification evidence. Scope output
alone is not a valid review; legacy Node/Thin acceptance cannot be imported.

Root-only `installation-observer PRIVATE_REQUEST` reads a mode-0600 request
containing `format: 1`, `sourceDirectory` and `acceptanceReviewFile`. It requires
the explicit review, fresh Oracle catalog preflight and the current recorded
native installation before publishing format-3 observer data. It does not
provision or register an installation. For the controller, set its optional
`discoveryReviewFile` to that protected review. In the native chart candidate,
`oracleRuntime.nativeDiscoveryReview=true` projects `discovery-review.json` from
the existing root-only operator Secret; the controller path is
`/run/kelryvo/operator/input/..data/discovery-review.json`. The flag only mounts
the file: the controller field, valid review and successful preflight are still
required. Without a review, format-2 read-only discovery remains available and
returns no verification acceptance. These native paths still require actual
Oracle qualification; offline fixtures do not supply it.

| Signal | Meaning | Effect on API readiness |
| --- | --- | --- |
| `/api/livez` reports `alive` | The HTTP process responds | Does not check metadata or Oracle |
| `/api/readyz` reports `ready` | Metadata is ACTIVE or RESTORE_HOLD | The API can serve requests; HOLD still vetoes protected mutations |
| `/api/readyz` reports `unavailable` (503) | Metadata is unavailable, uninitialized or did not respond within the probe deadline | The API is not ready |
| Worker reports `WAITING_FOR_NATIVE_INSTALLATION` | Execution is enabled but no usable private native configuration is available yet | Waiting alone does not block readiness |
| Controller reports `WAITING_FOR_INSTANCE` | No enabled instance matches its fixed Oracle policy | Waiting alone does not block readiness |
| `targetAvailability: UNVERIFIED` | Readiness did not test Oracle | Does not make a ready API unavailable |

The compatibility `/api/health` response retains `oracleValidation: BLOCKED` and
`execution: NOT_EXECUTED`; these fields are not live Oracle measurements. Use
`/api/readyz` for application readiness and the connection or execution views for
their separately scoped checks. Neither a successful readiness probe nor a
controller waiting state grants permission to execute SQL.

For Kubernetes projected credentials, set `KELRYVO_SECRET_DIR` to the protected
generation, for example `/run/kelryvo/secrets/..data`. The writable sticky volume
root is not a valid secret source. Source contents remain private to bootstrap;
the API and worker receive only their separately staged inputs.

The native server checks its browser assets before listening and writes fixed
JSON lifecycle records to stderr. Startup failures distinguish
`configuration_unavailable`, `metadata_unavailable`, `web_assets_unavailable` and
`listen_unavailable`. Records include startup ready and shutdown started/complete;
they omit exception details and credentials. SIGTERM/SIGINT during startup stops
preparation without announcing ready or releasing the worker's startup gate.
This local path is offline governance; live native Oracle operation remains
unqualified. The dated release instructions below describe the retained runtime.

### Native Oracle client prerequisite

A root operator can check a fully sealed, reviewed private native installation
configuration before connecting to either database:

```sh
kelryvo-worker installation-client-check /absolute/private/installation.json
```

The command applies the normal private-file, artifact and source checks, starts
with the verified client directory in the loader search path, and reports the
client version with `CLIENT_READY_NO_DATABASE`. It reads no database credential,
opens no database session and creates no installation or execution authority.
It does not replace the separate catalog preflight or independent qualification.
Native Oracle commands revalidate their inputs after startup replacement; IPC,
checkpoints and metadata effects begin afterward. The API and waiting services
receive no Oracle loader path. Use an absolute client directory without loader
separators (`:` or `;`) or expansion tokens (`$`).

### Native managed Oracle chart candidate

`deploy/native-oracle-helm.patch` adds explicit native init/controller wiring to
companion revision `0d11a258302f2011d8952dae530172a8f08525dd`. Validate a fresh
private candidate without changing that checkout:

```sh
cargo run --locked -p kelryvo-test-tools --bin kelryvo-test -- --helm-only /absolute/kelryvo-helm-chart
```

The command verifies archived files against their Git blob identities, applies
the patch only in `.cache/`, and runs all retained chart checks plus the native
contracts. It does not install a chart, create Secrets/PVCs or qualify Oracle.

For a separately reviewed native cutover, select a matching Rust image containing
`installation-init-state`, set `oracleRuntime.native=true`, and supply explicit
existing `oracleRuntime.nativeStateClaimName` and `nativeRuntimeClaimName` values.
The native state claim supplies the private state/witness root; retained legacy
controller journals and installation authority are not automatically upgraded.
The retained legacy PVC object and PostgreSQL storage contracts remain unchanged.
The prerequisite claim is mounted read-only at `/opt/kelryvo/oracle`, with
root-owned `client/` libraries and a root-owned `wallet/` directory using GID
10002 and mode 0750, allowing the worker to verify the complete wallet file set.
Wallet files must be regular, single-link, root-owned,
GID 10002 and mode 0440. The API UID cannot read this wallet. Initialization checks
these permissions before creating state and never loads OCI or connects to Oracle.

The existing operator Secret additionally needs a reviewed native
`installation-template.json` and `controller.json`, alongside `policy.json` and
`oracle-vault-private.pem`. The controller request contains paths only:

```json
{
  "format": 1,
  "stateDirectory": "/var/lib/kelryvo/operator/state",
  "databaseUrlFile": "/run/kelryvo/operator/metadata/..data/database-url",
  "policyFile": "/run/kelryvo/operator/input/..data/policy.json",
  "installationTemplate": "/run/kelryvo/operator/input/..data/installation-template.json",
  "vaultKeyFile": "/run/kelryvo/operator/input/..data/oracle-vault-private.pem"
}
```

The native installation template binds the exact source/image, worker/client/
wallet hashes, authorization, target and expiry. Its client/wallet paths must
match the prerequisite mount and its witness path is `/run/kelryvo/witness`.
Keep all private payloads in operator-managed Secrets, outside chart values.
The controller retains hash checks after I/O, its exclusive lock and journal,
and refuses unknown setup outcomes rather than provisioning again.

### Native inventory and target bindings

The native operator reads the protected metadata URL from
`KELRYVO_SECRET_DIR/database-url`. Initialize the native metadata schema before
using inventory commands. `inventory status` reads retained reference metadata;
`declare`, `assign`, `release` and `target-option` read a JSON object of at most
32 KiB from stdin and require ACTIVE metadata. Use private input files:

```sh
KELRYVO_SECRET_DIR=/absolute/native-runtime target/debug/kelryvo-operator inventory status
KELRYVO_SECRET_DIR=/absolute/native-runtime target/debug/kelryvo-operator inventory declare < /private/declaration.json
KELRYVO_SECRET_DIR=/absolute/native-runtime target/debug/kelryvo-operator inventory assign < /private/assignment.json
```

A declaration contains `databaseKey`, `databaseLabel`, `containerKey`,
`containerName`, `containerKind` (`PDB` or `NON_CDB`), `environment` (`DEV`, `SIT`,
`UAT` or `PROD`), `host`, numeric `port`, `service`, `transport` (`TCP` or `TCPS`)
and literal `owner`. Exact retries reuse the same server-reference IDs. Existing
labels, container facts and route ownership cannot be overwritten. These are
manual references, with no physical Oracle identity claim.

Assignment input contains `schemaId`, `projectId`, `expectedRevision` and
`reason`; release input omits `projectId`. Revisions are decimal strings, starting
at `"0"` for an unassigned declaration. Assignment changes advance the revision
and retain the previous assignment and operator audit.

Target-option input contains `projectId`, `assignmentId`, `environmentId`,
`profileId`, `routeId`, `routeConfigRevision` (`"1"`), `routeAlias`,
`migrationNamespace`, `policyId`, `policyRevision`, `exactOwner`,
`deploymentPrincipalId`, `principalPurpose` (`DEPLOY`), `principalUsername`,
`privatePrincipalRef`, `principalAlias`, `reason`, `lineageId` and
`expectedOptionRevision`. `optionId` and boolean `enabled` are optional. The
principal username and reference must match the current profile; the profile,
environment, route and exact schema owner must agree. Reuse the container's
existing lineage ID when one is already configured. Creating an option uses
`expectedOptionRevision: "0"`; updates supply its `optionId` and current revision.
The output omits private references. Options configured here remain provisional;
observation and verification require their separate supported paths.

For checkout installations, use `local-inventory ACTION /absolute/config.json`
instead. Point `KELRYVO_SECRET_DIR` at the native runtime directory reported by
`local-prepare`. The local command verifies the private config and matching
loopback database URL, refusing socket/query overrides and remote databases.
In the Rust UI, open **Targets**, choose an assigned schema, configured option
and explicit environment, then give a binding reason. Select an existing binding
to revise it. A revision conflict requires refreshing and reviewing the choices
before submitting again. Reviewer, archived-project and RESTORE_HOLD views allow
inspection without binding writes. Creating a binding grants no execution rights.

The Rust **Account** page shows your local sign-in state, project access and active
browser sessions. It can load further access/session pages and revoke another
session you own; use **Sign out** for the current session. Self-service session
revocation remains available during metadata recovery HOLD.

Use **Connections** to choose a project, or open **Project connections** within a
project. Register a manual reference first, then select its assigned schema/route
to register a discovery connection. The page supports server-side inventory
filters, further pages, configuration/preflight and observation history. Connection
tests and discovery record their actual availability; they do not verify identity
or authorize execution. Permanent retirement requires a reason and explicit
confirmation. Database-management grants and active project/workspace state are
required for these writes. Legacy discovery connection cards let you select a
retained observation, an accessible assigned owner and a matching project target
binding. Enter a reason to **Record observed target** or **Verify target**. Historical
observations cannot establish current identity. Verification requires accepted
Oracle evidence; recording an observation does not authorize execution. A revision
conflict requires refreshing the facts and explicitly submitting again.

Use **Review inbox** for pending plans across projects you can currently access.
Choose all pending plans, your authored plans or plans eligible for your independent
review, then load older pages as needed. **Open pending plan** rechecks its project
and pending status before opening the project's Plans view. A failed page or
changed membership clears the cached inbox; refresh to load current results.

On a project's **Overview**, a developer can enter an **Archive reason** and select
**Archive project**. Archiving preserves existing records and history, and prevents
new project work or review decisions. Metadata recovery HOLD disables the archive
and environment forms. Archived projects remain visible with a read-only banner.
To retire a deployment profile, open **Configuration → Connection details**, enter
a connection management reason, explicitly confirm permanent retirement, then
select **Retire connection**. The profile's previous revisions remain readable.

On **Plans**, filter by pending, assigned to you, approved, rejected or revoked
status. **Assigned to me** includes only pending plans explicitly assigned to your
actor. **Refresh plans** preserves the filter; changing it clears previous SQL
previews and review selections without changing the retained plan.

On **Audit**, choose an **Audit action**, select **Load older audit events** for
further pages or **Refresh audit** for current results. The action list includes
older history beyond the recent project snapshot. Retained migration states appear
separately and do not prove database application. Archived/HOLD history remains
readable, while failed continuations or lost membership clear cached audit rows.

On **Projects**, search the projects assigned to your account or refresh their
current status. Creating a project shows its UUID and a native operator grant
command under **Project access handoff**. Give that UUID to your operator; creation
does not grant membership. Multiple handoffs stay available while you navigate
within the signed-in session. Copy them before reloading or signing out; they are
not saved in browser storage or shown to another account.

The project's **Overview** recommends a next step from current retained facts:
access/recovery setup, held or active requests, independent review, target setup,
release preparation or history inspection. Its button opens the relevant screen
and plan when available. Recommendations are navigation only; approval and worker
admission remain separate requirements for execution.

Use **Active project** in the sidebar to switch between available projects. A
project screen retains its tab while loading the newly selected project's data;
other screens open the project overview. Refresh **Projects** to pick up membership
changes. Switching projects, refreshing the workspace and signing out require
saving or discarding any unsaved SQL draft first.

**Toggle color theme** switches light/dark surfaces on sign-in and workspace
screens. Theme changes preserve active form controls and remain local to the
current page. On mobile, **Open navigation** opens the sidebar; select a screen,
click outside the sidebar or press Escape to close it. Escape returns focus to
the navigation button. Screen navigation returns to the top of the page.

On **Instances**, choose a project and select **Manage instances** to inspect its
deployment profiles. **Search profiles**, environment and status filters narrow
the loaded inventory; **Refresh deployment profiles** retains those filters. A
developer with active project access can add a profile here using an operator
credential reference, then **Configure and inspect** its revisions and offline
preflight. A reference or successful preflight does not prove Oracle connectivity.

To retire a profile from this inventory, enter a **Profile retirement reason**,
confirm permanent retirement and select **Retire deployment profile**. Existing
plans/history remain readable. Reviewer, archived-project and recovery-HOLD views
allow inspection with write controls unavailable. Reading profiles does not grant
access to the separate master credentials. A stale configuration revision requires
refresh and explicit resubmission; failed writes are not automatically retried.

Open **Schema references** in a project to inspect the manual catalog assignments
available to your account. Rows are grouped in DEV/SIT/UAT/PROD order and under
each declared service. An assignment without a service has its own labelled
group. Database/container/schema UUIDs identify reference records, not verified
Oracle physical identity. These declarations do not bind a profile or authorize
a plan.

Use **Load more schema references** for further assignment pages or **Refresh
schema references** to start again. Completeness text distinguishes loaded rows
from the full inventory. Service references are bounded separately; an explicit
note appears when additional services are omitted. Reviewers and archived/HOLD
projects retain read access. Failed continuations or lost membership clear cached
references. **Open project targets and environment bindings** opens the separate
binding workflow without creating or changing a binding.

Open **Schema baselines** to inspect retained schema evidence for a project
target. Snapshot and baseline histories have separate **Load more** controls.
Open a snapshot to inspect its identity, provenance, coverage and definitions;
filter retained objects by owner/name and type. A filtered empty table does not
establish that the schema is empty.

A developer with current database-management access can capture the opened
snapshot as an immutable baseline with a name and reason. Select an **Expected
reference** and **Observed snapshot**, then **Compare** to inspect structural
changes and limitations. Fixture evidence does not establish live drift.

**Collect a schema observation** requires an authorized connection and reason.
Unavailable Oracle collection is retained as an unavailable observation. Reviewer,
archived-project and recovery-HOLD views allow retained reads with write controls
unavailable. The navigation buttons open SQL Workspace, plans or migration history
for the selected target; workspace changes still require saving or discarding
before leaving the draft. These actions do not approve or execute migrations.

The browser address retains the current screen/project and selected target,
saved draft, release or plan. Copy the address to reopen that retained context;
reload and sign-in recheck access through the native API. Saved drafts reopen at
their current retained revision. Unsaved SQL and form secrets are not saved in
the address. Sign-out clears its project/object context. Existing migration
history query-string links remain supported and become fragment links after load.

## Published Compose pilot

The default single-host Compose installer provides offline governance for a small
developer/approver team. Oracle execution and discovery remain disabled by default.
The managed Oracle controller and companion Helm deployment below are a separate
opt-in installation path. See [CHECKLIST.md](CHECKLIST.md) for exact verified scope.

## Get the release

Download the assets of the dated pilot from
[GitHub Releases](https://github.com/devsecopslonghn/kelryvo/releases).
Use all files from the same release. Keep `LICENSE`, `NOTICE`, dependency notices
and source-access files with redistributed images. Validate downloads first:

```sh
sha256sum -c SHA256SUMS
```

Use `bin/kelryvo` from the matching verified native distribution for the pilot
commands below, or build the pinned Rust CLI from the reviewed source. This guide
and `compose.pilot.yaml` describe its generated configuration. The OCI archive contains both native
platforms and is the exact CI-built image, not a locally rebuilt substitute.
Load your platform with skopeo (choose `arm64` on an arm64 host):

```sh
sudo skopeo copy --override-os linux --override-arch amd64 \
  oci-archive:kelryvo-app-oci.tar docker-daemon:kelryvo:pilot-2026-11-08
```

The release manifest records the source commit and OCI digest. The local image
name above is an import alias. With a private registry, use its verified
`repository@sha256:...` reference instead; do not substitute an unverified image.

## Install on a Linux host

Requirements: Docker Engine with Compose v2, skopeo for OCI import, the matching native `kelryvo` CLI, OpenSSL (and Git for
customer checkout snapshots), at least two
CPUs, 4 GiB available memory and 5 GiB free storage plus space for retained data.
These are pilot starting values, not a measured capacity guarantee. No Node,
Java, Chromium or application compilation is needed when using the OCI image.
Docker must be able to pull the pinned PostgreSQL image. Keep the installation
private and back it up. Use a new directory; init refuses to overwrite one.

```sh
sudo kelryvo pilot init --directory /srv/kelryvo-pilot \
  --image kelryvo:pilot-2026-11-08
sudo docker compose --env-file /srv/kelryvo-pilot/pilot.env \
  -f /srv/kelryvo-pilot/compose.yaml up -d
sudo kelryvo pilot status --directory /srv/kelryvo-pilot
```

Init creates root-owned secrets, separate metadata admin/application passwords,
a TLS certificate, a persistent metadata volume configuration and an internal
Docker network. The application database role is not a PostgreSQL superuser.
No target-database credentials are needed. The application is exposed only at
`https://localhost:8443`; PostgreSQL is not published on a host port.

For a certificate from your organization, pass both `--tls-cert /private/tls.crt`
and `--tls-key /private/tls.key` to init. Without these, init creates a 90-day
self-signed localhost certificate. Trust that certificate in the pilot workstation
or install an organizational certificate before using the application. Do not
turn off browser TLS verification. For a remote host use an SSH tunnel:

```sh
ssh -L 8443:127.0.0.1:8443 operator@pilot-host
```

## First login and project

Wait for the app to become ready. Use your trusted certificate to check:

```sh
sudo curl --cacert /srv/kelryvo-pilot/secrets/tls.crt \
  https://localhost:8443/api/readyz
sudo kelryvo pilot bootstrap --directory /srv/kelryvo-pilot
```

Bootstrap asks interactively for distinct developer and approver usernames and
passwords, activates membership and configures password sign-in. Passwords are
entered without echo and sent through stdin, never as command arguments. Use
lowercase usernames of 3-64 characters and passwords of 15-128 characters.
Bootstrap can also reset these two accounts; this revokes their prior password
sessions. Keep recovery tokens in the root-only secrets directory.

Open `https://localhost:8443`, select password sign-in and use the developer
account. Create a project and copy the UUID from **Project access handoff** before
reloading or signing out. The receipt remains visible during workspace refreshes;
it does not grant access. Explicitly grant both pilot actors:

```sh
sudo kelryvo pilot grant --directory /srv/kelryvo-pilot \
  --project REPLACE_WITH_PROJECT_UUID
```

Refresh the project. The overview recommends the next action. A developer prepares
a release and immutable plan; the separate approver account reviews and records a
decision. The audit/history preserve that decision. Creating a project or approving
a plan does not authorize SQL execution.

SQL Workspace target validation/release preparation requires an assigned schema
and configured target option. The operator must configure that target using the
supported installation process. For an immediately usable offline workflow,
configure a reference-only Oracle profile under Project setup and use the Git
release path below; offline syntax validation and review do not connect to Oracle.
Do not enter database passwords into credential-reference fields.

## Protected Oracle runtime installation

The shipped runtime supports a policy-bound Oracle 26ai TCPS instance on
Linux amd64. Installation is an operator action; after it is armed, users enter
and rotate the instance password in the application. The controller has no HTTP
listener. It decrypts the current instance credential privately, validates the
physical database identity, TLS destination and catalog grantability, then creates
three dedicated accounts: a schema-scoped writer, ledger/mutex owner and observer.
Migration dispatch never uses ADMIN. Schema-only owners must be explicitly listed
in the root-owned policy. Existing populated schemas cannot be adopted implicitly.

Run the verified native image with `kelryvo-worker installation-watch`, passing
one protected controller configuration path. The controller runs as UID 0 with
CHOWN and DAC_OVERRIDE, a read-only root filesystem, no service-account token
and no network listener. Mount its private RSA key and policy only into this
process. The API receives the public key. Share the protected execution directory
with the runtime and retain operator state and the UID 10002 witness on persistent
storage. The native companion Helm migration patch provides the matching mounts
and native worker entrypoints; apply the pinned patch as described above before
rendering the chart. Preserve the existing PostgreSQL claim and configure explicit
Oracle egress CIDRs. No executable JavaScript factory is used.

For an authorized policy renewal, update the private policy, restart to load it,
and replace the saved credential to advance its connection revision and trigger
a fresh protected installation. Keep owners/principals/history unchanged. Scope
expansion, failed setup and HOLD handling require operator review; there is no
automatic reset or grant broadening. Use a source-qualified native image and retain the exact artifact's installation evidence.


The policy schema is validated by
`crates/kelryvo-worker/src/preparation.rs`: exact host, service, IPv4
pins, certificate DN, physical identity, allowed and protected owners, tablespace,
quota, explicit new owners, authorization reference and expiry (at most 90 days).
Protect `CR7ALLGOALS_APP`, all existing trial owners and service accounts. The
controller provisions only these explicit new owners and principals. It has no
DROP or migration-dispatch path. Failed or interrupted setup stops for inspection
of its owner-only journal; restarting cannot replay an unknown DDL outcome.
Credential rotation refreshes protected configuration while retaining the same
principals, native ledger, witness, assignment and migration stream.

This first installed SQL profile accepts uppercase unquoted names, NUMBER and
VARCHAR2 BYTE columns, CREATE TABLE, ADD COLUMN and CREATE INDEX. For example:
`CREATE TABLE ROLLOUT_ITEM (ID NUMBER, NAME VARCHAR2(100 BYTE));`.
Unsupported types, table constraints, implicit CHAR semantics and destructive DDL
are rejected before a job is queued. Native postconditions verify exact tables,
columns and indexes after each migration. NOOP uses the retained matching history.
Plan, approval, target binding, immutable migration bytes and checksum rules remain
mandatory; a changed credential invalidates stale target profiles until refreshed.

Qualification above binds only the listed source/image, server and transport.
Other installations require their own native validation. Source CI alone does
not qualify Oracle 19, arm64 Oracle execution, arbitrary SQL, HA or disaster recovery.

## Encrypted instance credentials

Instance registration offers an encrypted-password option
when the operator has installed the vault public key. An authorized database
manager can enter a password once, replace it or revoke it with an audit reason.
The application never returns the saved password. Rotation makes prior target
verification stale; revocation disables the connection. Active or held executions
block credential changes. Operator-managed references remain supported.

New `pilot.py init` installations generate an RSA-3072 key pair: the public key is
staged into API secrets; the private key remains in the root-owned `vault/`
directory and is not mounted into the API. Passwords use a random AES-256-GCM data
key wrapped with RSA-OAEP/SHA-256. Authentication binds organization, instance,
credential ID, username, purpose and endpoint, so copying ciphertext or changing
the endpoint cannot reuse the saved password. Back up the private installation
including `vault/` separately from metadata. Losing that private key requires
re-entering credentials; there is no password-reveal endpoint.

The managed customer deployment above has verified entry and replacement through
the actual HTTPS UI. Private key backup and operator policy ownership remain
necessary; metadata backups alone cannot decrypt the saved credentials.

## Oracle rollout on an existing installation

The customer rollout workflow is **instance → discover → assign schema to project
→ verify target → SQL/Git release → validate → independent approval → request
execution → migration history and audit**. Offline review alone does not complete
a database rollout. The Compose pilot above keeps discovery and execution disabled.
An older running installation is not upgraded by downloading a new release.

Before using the live workflow, the operator must prepare the exact target and
image: an authorized Oracle endpoint and transport, a protected credential source,
purpose-specific grants, the target ledger and mutex, and an installation runtime
qualified for that source/image and database topology. Enabling environment flags
alone does not provide these capabilities. Oracle 19c and Autonomous Database over
TCPS do not inherit the historical Oracle Free/TCP qualification.

The owner-authorized Autonomous 26ai trial completed on the isolated test
installation at source `58dfae5520c999b49a54f0de48dcbfa0ee77a434` (linux/amd64
manifest `sha256:d6140fe7f9b039932916e1dd74e5f8b2dfa89415fb1260a0c87d54818f12e32b`).
V1 had already executed on source `7430817` and entered HOLD before final
verification. The new source verified its complete native ledger, original
receipt and postcondition under a mutex, after an independent exact-digest review.
It recorded `EXECUTION_RECOVERED_APPLIED` without replaying SQL or changing the
original HOLD. A fresh approved V2 reached `VERIFIED_SUCCESS` with two receipts;
a fresh plan then reached `NOOP` with no SQL or receipts. The original two held
jobs, approvals, receipts and all audit remain retained. CR7ALLGOALS_APP metadata
and all-table data fingerprints match the pre-cleanup snapshot.

The tested operator installation is narrowly bound to its exact PDB, principals,
SQL hashes, image and metadata generation. Its authority expires at
2026-11-08T22:07:26.774Z. Do not extend, reset history or switch streams to bypass
an expired binding or HOLD. This result covers recovery plus the V2 ALTER TABLE
and CREATE INDEX suffix on one Autonomous 26ai PDB over verified TCPS. It does not
transfer CREATE TABLE execution qualification from the older image, qualify
Oracle 19, arm64 native execution, RAC failover/DR, arbitrary SQL or a generic
native installer. Validation remains UNVERIFIED; discovery reports limited schema
visibility. Failed/incomplete discovery observations remain in evidence.

The customer URL has not been upgraded. The dated recovery release's ordinary
Compose installation still starts with discovery/execution disabled. Use its
exact source/image and normal installation steps for governance; live execution
additionally requires the qualified protected operator installation. The source
release and CI alone do not install native authority.

For the owner workspace trial, open `https://localhost:38443` on the same host
(or tunnel that loopback port). Trust the generated trial certificate through
your normal workstation trust procedure. Password accounts are `kry26-developer`
and `kry26-approver`; the owner-only account file is
`.cache/customer-rollout-20261108/local-private/browser-accounts.json` relative to
the repository. Do not copy its contents into support messages. The restricted
final backup preserves these credentials and installation inputs.

To inspect the delivered result without issuing more SQL:

1. Sign in as the developer and select the trial project
   `783315d9-f06e-4364-8f19-2fc4ed6ed38f`.
2. Open Migration history and inspect V2 job
   `d1582d03-4631-4690-b5b8-c9cca1b1cb70` (`VERIFIED_SUCCESS`, two receipts).
3. Inspect job `f4df87f7-3684-470a-9230-bed6a7c38444` (`NOOP`, zero receipts).
4. Inspect V1's original HOLD and its independently reviewed recovered-completion
   evidence in reconciliation/Audit & history. Recovery adds a resolution; the
   original job is still HOLD and has no retry authority.

The local fixture is an owner test installation, not a durable customer endpoint.
The evidence archive and cold backup paths/checksums are in CHECKLIST.md. If its
processes are unavailable, retain the backup and evidence; restore only through
the witnessed recovery procedure. Do not initialize replacement metadata against
the existing ledger to get a new executable stream.

For an installation that has qualified the complete-held-execution recovery module,
the operator can verify a fully applied migration without replaying it. This narrow
path requires every original central ACK/receipt and dispatch preimage, a complete
native ledger, fresh target identity/TLS/grant/object checks, an exclusive native
mutex and verified postconditions. Missing receipts or partial/ambiguous files stay
on HOLD. The published offline pilot does not install this capability automatically.

1. In the protected execution role, run `/opt/kelryvo/bin/kelryvo-worker held-preview JOB_UUID`. The fixed installation must provide a protected
   native held-completion configuration; API input cannot select a credential.
2. In the held request's reconciliation panel, retain the returned evidence digest
   as `TARGET_LEDGER`. A different project approver records `EVIDENCE_REVIEWED` for
   that exact digest. Copy the displayed reference ID.
3. The operator runs `/opt/kelryvo/bin/kelryvo-worker held-confirm JOB_UUID
   RECONCILIATION_UUID`. Native checks run again while the mutex is held. A successful
   result appends `EXECUTION_RECOVERED_APPLIED` to the existing immutable audit;
   the original job, attempt, HOLD events and idempotent response stay unchanged.
4. Refresh evidence to see the verified recovery. Create and independently approve
   a new plan for the next version or NOOP. Its installed worker still verifies
   the current target and full ledger before admitting any operation.

Inside the container, these operator commands run as `10002:10002` from
`/opt/kelryvo`, through the authorized OS/operator process. They do not take a
password, SQL text, runtime path or approval override. Recovery supports complete
instance-schema executions with 1–128 pending statements and a qualified native
verifier. UNIT tests and a prepared factory are not Oracle qualification.

Project access, workspace database management and deployment are separate grants.
For an installation created with `pilot.py`, the operator can grant the developer
database management and, separately, deployment to an explicit project:

```sh
sudo kelryvo pilot database-grant --directory /srv/kelryvo-pilot
sudo kelryvo pilot deploy-grant --directory /srv/kelryvo-pilot \
  --project REPLACE_WITH_PROJECT_UUID
```

These commands retain operator audit and do not enable Oracle runtimes, create
database users, provision database grants, approve plans or execute SQL. In a
Kubernetes installation, use `/opt/kelryvo/bin/kelryvo-operator database-grant kelryvo-developer` and `/opt/kelryvo/bin/kelryvo-operator deploy-grant
PROJECT_UUID kelryvo-developer` inside the application container through the
authorized operator process.

Once those prerequisites are verified:

1. Sign in as the developer, open the assigned project and add its environment
   under **Project setup**. Select **Connect an Oracle instance** from the overview.
2. Register one instance master using **Encrypted password** when the vault public
   key and protected runtime are installed, or attach an existing workspace master.
   Operator-managed references remain available for legacy installations. Enter an
   admin password only in its password field; the saved value is never returned.
3. Discover schemas, select the project environment and assign the exact application
   owners. The assignments are provisional until each schema passes accepted live
   identity verification. Attaching an instance to another project never transfers
   schema ownership. IP alone does not identify an Oracle target: service/container
   and transport are also required.
4. Open **SQL Workspace** for the assigned target, save SQL and prepare a release,
   or import committed Git migrations under **Releases**. Validate against the
   verified target and create a fresh immutable plan.
5. Sign in separately as the approver, inspect the SQL, target and findings, and
   approve the plan. Return as the authorized developer and inspect execution
   readiness before submitting the execution request.
6. Verify `VERIFIED_SUCCESS` (or `NOOP` for an already applied version) and the
   retained receipts in **Migration history** and **Audit & history**. `APPROVED`
   and `NOT_EXECUTED` are not successful database rollout results. An ambiguous
   outcome remains `HOLD`; use reconciliation and do not replay it.

## Use your own Git migrations

Init can take an existing local Git checkout. Clone/authenticate it on the host
with your normal Git tooling first. Kelryvo never receives its remote credentials.
Only committed migrations are imported. Use standalone checkouts rather than a
linked Git worktree whose object store is outside its directory.

```sh
sudo kelryvo pilot init --directory /srv/kelryvo-pilot \
  --image kelryvo:pilot-2026-11-08 --repository /absolute/customer-checkout
```

This example is an alternative init command for a new installation, not a command
to rerun over an existing one. It creates an independent snapshot owned by the API
UID and mounts it read-only. The repository appears as `customer` with stable ID
`local-1`, alongside `demo`. Bind the project to `customer` and your migration
folder, choose a branch/tag/commit, import and prepare an offline plan. Files must
follow names such as `migrations/V1__create_table.sql`.

For a first offline review, use this exact route:

1. Under **Project setup**, add an environment such as `Offline DEV`, then add an
   Oracle profile. Reference-only example values are host `oracle.example.invalid`,
   port `1521`, service `DEV`, username `APP` and credential reference
   `secret://unconfigured/oracle`. These values do not provision or connect a database.
2. Import the committed release from **Import a release**. After its syntax
   validation succeeds, expand **Compatibility planning**, then **Legacy unbound
   planning**, choose that profile and select **Prepare offline plan**.
3. Open the retained plan as the separate approver and record a review decision.
   Check its history and project audit. The result remains `NOT_EXECUTED`; this
   unbound review does not establish schema-aware target validation or authorize
   execution. Use configured project targets for the target-bound workflow.

For an existing installation, stop the app, replace only the operator-managed
checkout snapshot under `repositories/customer` using a fresh local clone, retain
UID/GID `10001:10001`, and restart the app. Keep its configured path and ID stable.
Never update a checkout while importing. Old releases retain their original bytes
and checksums. Fetches, GitHub/GitLab authentication and webhooks remain host-side.
The application does not push to customer repositories.

## Operations and support

- Inspect status with `kelryvo pilot status`. Read bounded logs with
  `docker compose --env-file /srv/kelryvo-pilot/pilot.env -f /srv/kelryvo-pilot/compose.yaml logs --tail=100 kelryvo`.
  Do not post tokens, passwords, private SQL, raw backups or private configuration
  in support issues. `/api/livez` checks process health; `/api/readyz` checks
  metadata readiness and does not certify target availability.
- If startup fails, check Docker, free disk/memory, PostgreSQL health, TLS validity,
  source-secret ownership and port 8443. Configuration failures use fixed messages
  to avoid exposing secrets. Failed initialization leaves its private directory
  available for inspection; use a different new directory for a retry.
- For password recovery rerun bootstrap. For bearer-token recovery rotate with
  `/opt/kelryvo/bin/kelryvo-operator credential-rotate` inside the container, following the operator
  command help; retain independent developer/approver roles and project grants.
- Report reproducible problems through
  [GitHub Issues](https://github.com/devsecopslonghn/kelryvo/issues). Include the
  release tag/source SHA, architecture, sanitized error and the affected workflow.
  This pilot has no contractual SLA or HA/managed-DR commitment.

### Backup and restore

For this governance-only pilot, take a **cold backup** before upgrades. Stop both
services, back up the metadata volume and the complete private installation
directory, then restart. Keep backups private/encrypted and retain the image
version and checksum beside them. Example from a root shell:

```sh
umask 077
export KELRYVO_HOME=/srv/kelryvo-pilot
mkdir /private/kelryvo-backup-YYYYMMDD
cd "$KELRYVO_HOME"
docker compose --env-file pilot.env -f compose.yaml stop
# Compose creates this named volume; confirm it with docker volume inspect first.
docker run --rm --network none --entrypoint tar \
  -v kelryvo-pilot_metadata:/data:ro \
  -v /private/kelryvo-backup-YYYYMMDD:/backup \
  postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f \
  -czf /backup/metadata.tar.gz -C /data .
tar -czf /private/kelryvo-backup-YYYYMMDD/installation.tar.gz -C /srv kelryvo-pilot
sha256sum /private/kelryvo-backup-YYYYMMDD/*.tar.gz > /private/kelryvo-backup-YYYYMMDD/SHA256SUMS
docker compose --env-file pilot.env -f compose.yaml up -d
```

Restore only to an isolated host with no existing `kelryvo-pilot_metadata` volume:
verify backup checksums, restore the private installation to the same absolute
path and restore `metadata.tar.gz` into a newly created empty volume. Use the exact
previous image and PostgreSQL version. Never overwrite an existing volume, use
`down -v`, or assume rolling back an image rolls back database changes.

Keep access local and execution/discovery disabled during recovery. Rotate both
operator bearer tokens and rerun bootstrap before reopening access. Retain HOLD
records; do not replay queued requests or reuse approvals for target execution.
If the installation has ever enabled Oracle execution/discovery, use the witnessed
metadata restore/reconciliation operator instead of this pilot cold-copy procedure;
its RESTORE_HOLD and independent reconciliation requirements remain mandatory.
This guide does not claim production DR qualification.

### Upgrade

Read the new release notes and take the cold backup above. Import the new verified
OCI image, update only `KELRYVO_IMAGE` in the private `pilot.env`, then recreate the
app with Compose. Check readiness, login and one project/review workflow. Preserve
the metadata volume, secrets and previous image. For a failed upgrade, stop and
restore the backup on an isolated host; do not downgrade an already migrated
metadata database in place. Certificate renewals and repository snapshots are
operator-managed; restart the app after replacing their protected inputs.

## Supported boundary

This release delivers offline schema-change governance and customer-owned local
Git intake. It does not provide arbitrary SQL querying, public signup, remote Git
webhooks, HA, multi-tenancy or general Oracle-version support. Historical native
qualification covers a frozen Oracle Free 23.26.3 PDB/TCP/Linux-amd64 artifact and
three bounded DDL forms. New release CI verifies the image and governance smoke;
it does not transfer that native qualification to every build or customer database.
