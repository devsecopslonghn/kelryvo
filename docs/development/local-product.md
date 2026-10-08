# Local SchemaForge product

PRODUCT is runnable governance; VALIDATION is Oracle compatibility, runtime acceptance and
production hardening. T04 and all 124 applicable Oracle cells stay BLOCKED. Product delivery
does not require the owner to provide an Oracle lab. The original 220 feature IDs and original
acceptance dependencies remain intact. SF-PRODUCT tasks verify bounded local behavior only.

## Startup and demonstration

From the repository root, run `npm ci --ignore-scripts --no-audit --no-fund`,
`npm run local:prepare`, then `npm run dev`. Preparation downloads exact pinned public
parser/JDK artifacts and the pinned PostgreSQL 17.10 image. It does not download Oracle.
Linux x64, Node 22.23.3, Docker and Git are required. Docker's local Unix socket
`/var/run/docker.sock` must be reachable by your user; the tools force this endpoint,
ignore remote Docker environment/context selection, and do not change saved contexts.
ports 4317 and 55432 must be free. PostgreSQL binds only 127.0.0.1, as does the API/web server.

1. Open `http://127.0.0.1:4317`. Read the private local
   `.cache/local-product/config.json` and sign in with `developerToken`.
2. Create a project and a Development environment. Add an Oracle connection profile with
   host `oracle.example.invalid`, service `DEV`, username `APP`, port 1521 and credential
   reference `vault://local/dev/app`. This records configuration without resolving secrets.
3. Open Releases, select the project and **Local migration demo**, retain ref `HEAD` and
   folder `migrations`, then import. The server resolves a full commit and retains exact
   UTF-8 bytes, SHA-256 hashes, canonical numeric versions and ANTLR validation observations.
   Open the SQL previews. Syntax-invalid releases remain visible and cannot produce plans.
4. Select the profile and prepare an offline candidate. Review ordered files/hashes and
   `NOT_OBSERVED` target history. No target history was read, so this is not a reconciled
   execution plan and does not claim that all files are pending on a real database.
5. Sign out, sign in with `approverToken`, and open Plans & review. Record a reason and
   approve or reject. Decisions are serialized, terminal and independent of the author.
   Approval does not grant execution authority. Prepare another candidate to demonstrate
   rejection as a separate decision.
6. Inspect Audit & history. Each proposed migration records `NOT_EXECUTED`; no applied
   receipt exists. Stop/restart the API to confirm PostgreSQL retains these records.
7. As the developer, return to Projects and archive a completed project with a reason.
   The timestamp and archived state persist. Existing releases (including SQL previews),
   plans, audit and history remain readable; creation and review controls become disabled.
   Repeated archive requests retain the original timestamp and create no duplicate event.

Ctrl-C stops the API and closes its database pool. The local PostgreSQL container remains
available and keeps its named Docker volume `schemaforge-local-product-data`. To stop it
without removing data, use `docker --host unix:///var/run/docker.sock stop schemaforge-local-product-postgres`.
Subsequent startup restarts that owned container. Do not remove the volume to restart.
Private config must be retained alongside this volume; credentials are not printed to logs.

## Interfaces and trust boundary

The API is a single-organization local service with server-configured named developer and
approver identities. Bearer tokens are randomly generated, private at rest, never stored
by the browser, and mapped to identities on the server. Caller actor IDs and unexpected
properties are rejected. Origin checks, fixed error codes and a same-origin CSP apply.
This local authentication does not certify multi-tenant RBAC, production sessions or TLS.

Projects contain environments and reference-only connection profiles. Composite foreign keys
and scoped lookups reject cross-project references. The metadata database password is solely
for PostgreSQL; the API has no application writer secret, Oracle provider or executor.
Local repository bindings are configured server-side. The first startup supplies the demo
binding; remote clone/provider credentials and arbitrary request paths are not exposed.
The importer reads Git objects without checkout/hooks, bounds ref/path/file/byte counts,
rejects symlinks/submodules and equivalent duplicate numeric versions, and validates the
whole release before planning. Source SQL is visible only after local authentication.

`GET /api/health` probes PostgreSQL and reports `NOT_EXECUTED`/Oracle `BLOCKED`.
All other API reads/writes require a bearer token:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/session`, `/api/repositories`, `/api/projects` | Authenticated identity, allowlisted binding names and projects |
| `POST /api/projects` | Create project (`name`, optional `description`) |
| `GET /api/projects/:id` | Project, environments, profiles, releases, plans, audit, history |
| `POST /api/projects/:id/archive` | Developer archives with `reason`; preserves all records |
| `POST /api/projects/:id/environments` | Create environment (`name`) |
| `POST /api/projects/:id/profiles` | Store `name`, `environmentId`, `engine=oracle`, `host`, `port`, `service`, `username`, `credentialRef` |
| `POST /api/projects/:id/releases` | Import `repositoryId`, `commit`, `folder` |
| `GET /api/releases/:id` | Retained source, hashes and parser observations |
| `POST /api/projects/:id/plans` | Freeze candidate from `releaseId`, `profileId` |
| `POST /api/plans/:id/decision` | Independent `APPROVE`/`REJECT` with `reason` |
| `POST /api/plans/:id/execution` | Audit denial; HTTP 409 `EXECUTION_UNAVAILABLE`, `NOT_EXECUTED` |

Writes and their audit/history events share PostgreSQL transactions. Approved items are
immutable through the API; terminal decisions cannot be overwritten. Metadata administrators
remain outside this protection. No simulated execution, automatic retry, target ledger,
runtime authority, Oracle connections, Kubernetes deployment or production compatibility
claim is included. Archival retains records and transactionally rejects further project
writes with HTTP 409 `PROJECT_ARCHIVED`, including in-flight writes that were waiting
on the project lock. No restore or deletion endpoint is provided. Edit/resubmit and broader
catalog workflows are incremental work.

## Verification

`npm run check` checks source/types/web build, all standard unit/regression tests, tracking,
immutable provenance and existing dependency smoke. `npm run test:product` uses a separate
local PostgreSQL test database (or `SCHEMAFORGE_TEST_DATABASE_URL` on a dedicated service),
actual temporary Git objects and the pinned parser. `node node_modules/playwright/cli.js install chromium`, then
`npm run test:browser` exercises the real browser/API/parser/PostgreSQL flow, approvals,
rejection, execution denial, archival and restart persistence. PostgreSQL integration also
tests the archive-versus-write lock race. Browser downloads are separate test tools.

The PRODUCT CI job supplies disposable PostgreSQL, prepares the exact helper and runs these
tests with no skips allowed for required product prerequisites. The existing WP0 regression,
parser corpus, security, license and quality gates remain in force. Required failures are
repaired in source without changing thresholds. Product license/name and F31 distribution
decisions remain pending; this is local development, not a packaged production distribution.

Fastify request handling follows its [official reference](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/);
the web bundle uses [React createRoot](https://react.dev/reference/react-dom/client/createRoot).
Exact third-party grants and notices are recorded separately from the immutable WP0 audit.
