# Install the local source bundle

This source bundle runs SchemaForge's local governance UI/API and restricted worker
modules on Linux x64. Independently authored material uses PolyForm Shield 1.0.0;
third-party grants and notices are included separately. The provisional product name
and public distribution clearance remain pending. This is a local installation candidate.

Use Node 22.23.3/npm 10.9.9, Git, Docker on the local Unix socket and GNU tar. The API
uses loopback port 4317; metadata PostgreSQL uses loopback port 55432 and a persistent
volume. Preparation obtains pinned public npm/parser/JDK/PostgreSQL inputs. External
binaries, installed dependencies, credentials and existing metadata are not bundled.

Receive the archive and `checksums.json` through a trusted channel. Check the archive's
SHA-256 against that trusted checksum before extracting into a new directory. The
internal manifest verifies source bytes; it is not a signature or independent origin proof.

```sh
sha256sum schemaforge-local-COMMIT.tar.gz
mkdir schemaforge-install
tar -xzf schemaforge-local-COMMIT.tar.gz -C schemaforge-install
cd schemaforge-install
node scripts/local-release.mjs verify
npm ci --ignore-scripts --no-audit --no-fund
npm run dependencies:product
npm run local:prepare
npm run build
npm run dev
```

Open `http://127.0.0.1:4317`. For revocable HTTPS browser sessions, provide a client-trusted
loopback certificate and private key using the permissions and command in
`docs/development/local-product.md`. That guide also covers private credential issuance,
explicit project membership/deploy grants, Git binding, release import, planning, review,
approval, history, rotation/revocation and witnessed metadata backup/restore. Do not remove
an existing volume to install or restart. Existing containers are checked for ownership;
another installation's container is rejected. An old-schema backup needs its matching
prior software and witnesses; restore retains a persistent execution hold.

The bundle retains the repository's exact package lock and grants. Its npm commands are
projected to installation/operator/acceptance commands; `release/source-package.json`
retains the original package metadata. Research, tracker/evidence files, Git history,
private local state and build outputs are excluded. Source and checksums are reproducible
for the same committed revision. Modified or untracked working-tree files are not packaged.

To build from the development repository, commit the intended source first:

```sh
npm run release:local -- --output /absolute/existing-parent/new-release-directory
```

The output directory must be new and its parents must be regular directories. An existing
artifact or installation is preserved. The output contains the tar archive and checksum
record, both private to the local operator by default. No upload or deployment occurs.

For end-to-end acceptance, use an explicitly disposable loopback PostgreSQL service with
permission to create test databases. Install Chromium with the pinned Playwright CLI,
prepare parser tools and build the web app, then set `SCHEMAFORGE_TEST_DATABASE_URL` and
`SCHEMAFORGE_JAVA_HOME` in the process environment and run `npm run release:acceptance`.
It creates and drops only UUID-named test databases and temporary Git/TLS fixtures. It
tests Git import, offline review/approval/withdrawal, restart history, HTTPS sessions and
controlled worker dispatch through explicitly UNIT_SYNTHETIC host ports. It does not use
the installed product's private configuration or change an existing metadata database.

The default local API creates requests and displays history; it supplies no Oracle worker
host, writer secret or execution authority. Actual Oracle identity/history/mutex/dispatch,
target reconciliation and deployed-worker isolation remain unvalidated until an authorized
host and runtime are supplied. A passing local acceptance run does not certify Oracle
execution or full production release readiness.
