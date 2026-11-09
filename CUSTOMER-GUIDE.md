# Kelryvo customer pilot

This guide is the customer installation and operations entry point. The pilot is
for one operator-managed Linux host and a small developer/approver team. Start
with SQL authoring, local Git releases, independent review and audit. Oracle
execution and discovery stay disabled in this installation. See
[CHECKLIST.md](CHECKLIST.md) for supported scope and current engineering status.

## Get the release

Download the assets of the dated pilot from
[GitHub Releases](https://github.com/devsecopslonghn/kelryvo/releases).
Use all files from the same release. Keep `LICENSE`, `NOTICE`, dependency notices
and source-access files with redistributed images. Validate downloads first:

```sh
sha256sum -c SHA256SUMS
```

The source archive contains this guide, `compose.pilot.yaml` and `scripts/pilot.py`.
Extract it into an empty working directory. The OCI archive contains both native
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

Requirements: Docker Engine with Compose v2, skopeo for OCI import, Python 3.11+, OpenSSL (and Git for
customer checkout snapshots), at least two
CPUs, 4 GiB available memory and 5 GiB free storage plus space for retained data.
These are pilot starting values, not a measured capacity guarantee. No Node,
Java, Chromium or application compilation is needed when using the OCI image.
Docker must be able to pull the pinned PostgreSQL image. Keep the installation
private and back it up. Use a new directory; init refuses to overwrite one.

```sh
sudo python3 scripts/pilot.py init --directory /srv/kelryvo-pilot \
  --image kelryvo:pilot-2026-11-08
sudo docker compose --env-file /srv/kelryvo-pilot/pilot.env \
  -f /srv/kelryvo-pilot/compose.yaml up -d
sudo python3 scripts/pilot.py status --directory /srv/kelryvo-pilot
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
sudo python3 scripts/pilot.py bootstrap --directory /srv/kelryvo-pilot
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
sudo python3 scripts/pilot.py grant --directory /srv/kelryvo-pilot \
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

## Managed Oracle runtime (candidate)

The shipped runtime supports a policy-bound Oracle 26ai TCPS instance on
Linux amd64. Installation is an operator action; after it is armed, users enter
and rotate the instance password in the application. The controller has no HTTP
listener. It decrypts the current instance credential privately, validates the
physical database identity, TLS destination and catalog grantability, then creates
three dedicated accounts: a schema-scoped writer, ledger/mutex owner and observer.
Migration dispatch never uses ADMIN. Schema-only owners must be explicitly listed
in the root-owned policy. Existing populated schemas cannot be adopted implicitly.

Run the verified image with `scripts/oracle-runtime-controller.mjs watch`, passing
only protected file paths via `--database-url-file`, `--vault-key-file`, `--policy`,
`--state-directory`, `--witness-directory` and its exact `--image-digest`.
The controller runs as UID 0 with CHOWN and DAC_OVERRIDE, a read-only root filesystem,
no service-account token and no network listener. Mount its private RSA key and
policy only into this process. The API receives the public key. Share the protected
execution directory with the runtime and retain operator state and the UID 10002
witness on persistent storage; never put them in an ephemeral `/tmp` volume.
The companion Helm chart provides these mounts and starts the waiting service.

The policy schema is validated by
`packages/connectivity/oracle-installation-policy.mjs`: exact host, service, IPv4
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

The source checks do not qualify Oracle 19, arm64 Oracle execution, arbitrary SQL,
HA or disaster recovery. The current candidate still requires exact-image native
validation and the live customer walkthrough before handoff.

## Encrypted instance credentials (candidate)

The current candidate adds an encrypted-password option to instance registration
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

This candidate is not yet deployed to the customer URL. Its encrypted credential
entry does not by itself provision Oracle grants or enable execution. The shipped
native runtime and complete live walkthrough are still being completed. Keep the
frozen trial and release limitations below.

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

1. In the protected execution role, run `node apps/worker/held-completion-main.mjs
   preview JOB_UUID`. The fixed installation must provide a protected
   `held-completion.mjs` factory; API input cannot select a module or credential.
2. In the held request's reconciliation panel, retain the returned evidence digest
   as `TARGET_LEDGER`. A different project approver records `EVIDENCE_REVIEWED` for
   that exact digest. Copy the displayed reference ID.
3. The operator runs `node apps/worker/held-completion-main.mjs confirm JOB_UUID
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
sudo python3 scripts/pilot.py database-grant --directory /srv/kelryvo-pilot
sudo python3 scripts/pilot.py deploy-grant --directory /srv/kelryvo-pilot \
  --project REPLACE_WITH_PROJECT_UUID
```

These commands retain operator audit and do not enable Oracle runtimes, create
database users, provision database grants, approve plans or execute SQL. In a
Kubernetes installation, use `node scripts/container-membership.mjs database-grant
kelryvo-developer` and `node scripts/container-membership.mjs deploy-grant
PROJECT_UUID kelryvo-developer` inside the application container through the
authorized operator process.

Once those prerequisites are verified:

1. Sign in as the developer, open the assigned project and add its environment
   under **Project setup**. Select **Connect an Oracle instance** from the overview.
2. Register one instance master using the operator-provisioned credential reference,
   or attach an existing workspace master. A reference field does not accept or
   provision an admin password. Current releases require operator-managed secrets;
   password entry and a self-service credential vault are not implemented.
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
sudo python3 scripts/pilot.py init --directory /srv/kelryvo-pilot \
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

- Inspect status with `pilot.py status`. Read bounded logs with
  `docker compose --env-file /srv/kelryvo-pilot/pilot.env -f /srv/kelryvo-pilot/compose.yaml logs --tail=100 kelryvo`.
  Do not post tokens, passwords, private SQL, raw backups or private configuration
  in support issues. `/api/livez` checks process health; `/api/readyz` checks
  metadata readiness and does not certify target availability.
- If startup fails, check Docker, free disk/memory, PostgreSQL health, TLS validity,
  source-secret ownership and port 8443. Configuration failures use fixed messages
  to avoid exposing secrets. Failed initialization leaves its private directory
  available for inspection; use a different new directory for a retry.
- For password recovery rerun bootstrap. For bearer-token recovery rotate with
  `scripts/container-credentials.mjs` inside the container, following the operator
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
