# Non-production runtime and Phase 6 acceptance

Use the existing [source installation](local-release.md) or
[app/worker containers](containers.md). No external deployment or infrastructure
change is part of Phase 6. Authorized live Oracle execution remains **NOT_RUN**
under the [Oracle acceptance suite](oracle-acceptance.md).

## Reproduce the runtime

Use the pinned Node/npm versions, install with `npm ci --ignore-scripts --no-audit
--no-fund`, then run `npm run local:prepare` and `npm run build`. Preparation obtains
the pinned parser tools and PostgreSQL image and preserves existing destinations.
Run `npm run dev -- --tls-cert /absolute/private/server-chain.pem --tls-key
/absolute/private/server-key.pem` with a client-trusted loopback certificate and
private files following [local-product.md](local-product.md). This starts the real
HTTPS server, initializes metadata, and preserves its owned PostgreSQL volume.
Never remove an existing metadata volume to resolve startup failure.

For deployment-equivalent container validation:

```sh
docker build --platform linux/amd64 --target app --tag kelryvo-app:local .
docker build --platform linux/amd64 --target worker --tag kelryvo-worker:local .
node scripts/test-containers.mjs kelryvo-app:local kelryvo-worker:local
```

The existing harness creates owned disposable Docker fixtures, uses TLS,
read-only app storage, non-root users, dropped capabilities and private secret
mounts, then verifies governed API operations and app restart persistence. It
rejects a worker without its private installation. Application writer secrets
and live Oracle hosts are absent. A completed test removes its owned fixtures;
normal local runtime persistence uses the existing local volume.

Container configuration uses the private Secret references documented in
[containers.md](containers.md). Do not put tokens, database URLs, TLS keys or
Oracle writer references in command output, Git, image layers or browser storage.
Startup does not grant project access or deployment permission. Activate and
grant actors through the existing trusted membership operator. Independent approval
and a separate deploy grant remain required. Changes to secret files alone do
not rotate or revive retained credentials; use the explicit credential operator.

## Diagnose startup and restart

Container stderr emits JSON lifecycle records with only fixed `event`, `state`
and optional `code` fields. For example:

```json
{"event":"startup","state":"failed","code":"metadata_unavailable"}
```

| Code | Operator action |
| --- | --- |
| configuration_unavailable | Check Secret mount confinement, ownership/read permissions, database URL format, distinct tokens, TLS key/certificate, numeric bind address and port |
| metadata_unavailable | Check PostgreSQL reachability, credentials, schema initialization privileges and matching backup/schema version; preserve existing data |
| web_assets_unavailable | Rebuild or reinstall matching artifact; verify bundled web assets are readable |
| listen_unavailable | Check bind address, occupied port and process permissions |
| startup_unavailable | Inspect matching software/configuration privately; retain the fixed event and source SHA for diagnosis |
| shutdown_unavailable | Confirm owned process exit, preserve journals and check recovery HOLD before dispatching new work |

Lifecycle states are startup `started`, `ready`, `failed` and shutdown `started`,
`complete`, `failed`, `timeout`. SIGINT/SIGTERM drain the app and PostgreSQL pool;
failed shutdown or expiration of the existing 25-second deadline exits nonzero.
Arbitrary exception messages, SQL, paths and secrets are excluded. API request
logging stays disabled to avoid recording bearer/session credentials.

`GET /api/livez` is process liveness. `GET`/`HEAD /api/readyz` checks bounded metadata
read availability and returns 503 when unavailable. A restored database can report
RESTORE_HOLD as ready for historical reads while writes and execution remain
blocked. `targetAvailability: UNVERIFIED` is not evidence of Oracle connectivity.
After interruption, the existing expiry recovery and generation-bound worker
supervisor preserve ambiguity; they do not replay DDL. Keep workers disabled until
the private trusted installation and separately authorized Oracle acceptance exist.

## Reproduce acceptance

The commands below run from the engineering checkout. An extracted source bundle
uses `npm run release:acceptance` after installation and verification, as documented
in [local-release.md](local-release.md); it excludes engineering check/test scripts.
Run `npm run check` first; its parser unit cases may rebuild helper artifacts.
Then run product/browser suites against a dedicated disposable loopback PostgreSQL
service, with permission to create/drop test-owned databases. Set these process
environment variables privately:

- `SCHEMAFORGE_TEST_DATABASE_URL`: dedicated PostgreSQL test URL, never a product or
  production metadata database. Existing legacy cases reset their supplied fixture.
- `SCHEMAFORGE_JAVA_HOME`: absolute pinned prepared JDK directory.
- `SCHEMAFORGE_REQUIRE_PRODUCT_TESTS=1`: requires native backup/product cases.

```sh
npm run test:product
npm run test:browser
npm run test:release
```

`tests/product-phase6-workflow-browser.integration.mjs` is included in browser CI
and fresh-source release acceptance. To repeat just the new continuous journey:

```sh
node --test tests/product-phase6-workflow-browser.integration.mjs
```

It starts the real TLS product server, uses HTTP browser requests, the pinned
Git/parser and durable PostgreSQL, and registers a new manual instance and
connection in the UI. A trusted operator configures the purpose/route option;
the user selects its binding, discovers fixture metadata, validates retained SQL,
creates a format-4 plan, signs in as an independent approver, checks readiness,
requests execution and inspects history/audit after restart. It checks secure
cookies/CSRF, missing deployment permission, same-stream request prevention,
record checksums, mobile layout and revoked reads. Oracle discovery is FIXTURE,
target identity is OBSERVED, the request remains WAITING_VALIDATION and no execution
attempt occurs. These limits are asserted, not inferred from screenshots.

Screenshots for all journey stages plus restart/mobile evidence and a sanitized
result are saved under `.cache/phase6-acceptance/`; GitHub retains them with browser
artifacts. Phase 5 browser acceptance separately covers synthetic statement HOLD,
independent reconciliation and restart persistence. Product suites cover supervision,
lost ownership, metadata recovery, permission boundaries and native backup/restore.
A restore retains RESTORE_HOLD and immutable evidence.

The source bundle includes these operating guides and continuous journey. Build
only committed source with `npm run release:local -- --output
/absolute/existing-parent/new-release-directory`, verify its trusted checksum,
then follow the fresh installation guide. No image publication or external
deployment is performed by these commands.
