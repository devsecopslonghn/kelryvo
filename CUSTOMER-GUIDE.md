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
skopeo copy --override-os linux --override-arch amd64 \
  oci-archive:kelryvo-app-oci.tar docker-daemon:kelryvo:pilot-2026-11-08
```

The release manifest records the source commit and OCI digest. The local image
name above is an import alias. With a private registry, use its verified
`repository@sha256:...` reference instead; do not substitute an unverified image.

## Install on a Linux host

Requirements: Docker Engine with Compose v2, Python 3.11+, OpenSSL (and Git for
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
account. Create a project, copy its UUID, then explicitly grant both pilot actors:

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
2. Import the committed release from **Git migrations**. After its syntax
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
