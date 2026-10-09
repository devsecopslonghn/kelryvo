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
3. Open Releases, select the project and save its source binding to **Local migration demo**
   and folder `migrations`. Retain ref `HEAD`, select a listed branch or commit-resolving tag,
   or enter a manual ref, then import. Imports use the saved binding;
   unbound projects and repository/folder mismatches are rejected before Git/parser work. The server resolves a full commit and retains exact
   UTF-8 bytes, SHA-256 hashes, canonical numeric versions and ANTLR validation observations.
   Open the SQL previews. Release inspection also shows the full stored commit, durable repository ID,
    object format, folder, manifest digest, parser profile and import time. These facts and stored SQL
    remain available when Git is unavailable and for archived projects; a current registered name may
    supplement the retained repository ID. Syntax-invalid releases remain visible and cannot produce plans.
4. Select the profile and prepare an offline candidate. Before creating it, the API checks
   each retained UTF-8 file's byte length and SHA-256 and rebuilds the format-1 manifest digest.
   A mismatch or malformed retained snapshot returns a fixed integrity error without creating
   plan, history or audit records. This check uses the stored release only and works when Git
   is unavailable. Verification bounds encoded file size and retained metadata before allocations;
   canonical decimal versions preserve arbitrary-precision ordering without numeric conversion.
   Review ordered files/hashes and
   `NOT_OBSERVED` target history. No target history was read, so this is not a reconciled
   execution plan and does not claim that all files are pending on a real database.
5. Sign out, sign in with `approverToken`, and open Plans & review. Record a reason and
   approve or reject. Each selected plan shows its retained author ID as text and its server
   creation timestamp. An approver who authored a pending plan sees fixed independent-review
   feedback and disabled decision controls; a missing or malformed author ID keeps decisions
   disabled and asks the reviewer to refresh the project to retrieve retained facts. Developers
   see the existing awaiting-approver feedback. Pending comments remain available in these
   states. Decisions are serialized, terminal and independent of the author.
   Authenticated requests denied for role, self-approval or an existing terminal decision
   append a `PLAN_DECISION_DENIED` audit event containing only the fixed denial code,
   server-resolved actor and plan resource. The audit timeline renders the denial reason.
   Malformed, unauthenticated and nonexistent-plan requests add no event; archived projects
   reject decisions without appending one. Before approval, the API verifies the linked scoped
   `VALID` release under lock using the retained UTF-8 content and format-1 digest checks, then
   compares ordered path, version and SHA-256 facts with bounded plan items. Integrity failures
   return `PLAN_APPROVAL_INTEGRITY_FAILED` before decision/history/audit writes; authorized
   rejection remains available when source is damaged.
   Approval does not grant execution authority. Prepare another candidate to demonstrate
   rejection as a separate decision.
   Developers and approvers can add review comments while a plan is pending. The timeline
   retains plain text, the server-resolved author name and timestamp in submission order.
   Comments remain readable after approval, rejection or project archival; those states
   close the comment composer. Switching plans or projects clears an unsent comment.
   Approved and rejected plans also show a read-only Decision record with the server-stored
   reviewer name and ID, decision time and plain-text reason. The reviewer name is captured
   with the decision, so later identity configuration changes do not alter attribution;
   older decisions without a stored name display their retained actor ID.
   Use Plan status to filter All (the default), Pending approval, Approved or Rejected.
   Filters preserve project ordering and historical read access for archived projects.
   Changing the filter clears unsent comment and decision drafts; an empty result offers
   another status or All. Selecting a project or signing out restores the All default.
   In Plans & review, use **Inspect source** to open the selected plan's linked retained
   release. The review shows the release ID, full commit, stored repository ID, current
   repository name when registered, object format, migration folder, manifest digest,
   parser profile, import time, file facts and retained SQL. The release ID, scoped project
   summary and plan file checksums must agree before the source is shown. Missing or
   mismatched references use a fixed failure message. Inspection remains available for
   pending and terminal plans, archived projects and removed repository registrations.
   It reads the retained release through the authenticated release endpoint; it does not
   change plan, decision, comment, audit or migration history state. The displayed snapshot
   does not revalidate source bytes after approval.
   The same review also shows the selected plan's profile and matching environment from
   the currently loaded project configuration. It labels this as current configured metadata,
   not a frozen plan snapshot or observed database identity. A missing or mismatched profile
   or environment displays a fixed unavailable message and the retained reference IDs; it
   never falls back to another profile. Credential references and secrets are not displayed
   or resolved. This read-only view does not connect to a database.
6. Inspect Audit & history. Audit action filters list only actions present in the selected
   project's recent events; All actions is the default and preserves server ordering.
   Project changes and sign-out restore that default. Archived project events remain
   readable, and an empty timeline explains that no events are available. Each proposed
   migration records `NOT_EXECUTED`; no applied receipt exists. Stop/restart the API to
   confirm PostgreSQL retains these records.
7. As the developer, return to Projects and archive a completed project with a reason.
   The timestamp and archived state persist. Existing releases (including SQL previews),
   plans, audit and history remain readable; creation and review controls become disabled.
   Repeated archive requests retain the original timestamp and create no duplicate event.

Ctrl-C stops the API and closes its database pool. The local PostgreSQL container remains
available and keeps its named Docker volume `schemaforge-local-product-data`. To stop it
without removing data, use `docker --host unix:///var/run/docker.sock stop schemaforge-local-product-postgres`.
Subsequent startup restarts that owned container. Do not remove the volume to restart.
Private config must be retained alongside this volume; credentials are not printed to logs.

To import your own migrations, pass an existing local Git worktree root:
`npm run dev -- --repository /absolute/path/to/your/repository`. Repeat `--repository PATH`
for up to eight roots. The server validates these paths before local database startup and
adds their names to the Releases repository selector alongside the demo. Choose the desired
ref and migration folder there. Relative paths resolve from the repository root; symlinks
resolve to their canonical target, and duplicate supplied roots are rejected. Traversal (`..`),
control characters, backslashes and option-like path components are rejected; use a direct
absolute root when a repository is outside the current directory. URLs, non-repositories,
subdirectories inside a worktree and unsupported options fail with a fixed startup error.
The command does not clone, fetch or authenticate to a provider. The operator authorizes
only local reads of the supplied repositories. API responses expose binding IDs/names;
paths and Git diagnostics stay out of responses/logs. Reordering startup options changes
the local binding IDs; retained releases still preserve their original commit, files and hashes.

## Interfaces and trust boundary

The API is a single-organization local service with server-configured named developer and
approver identities. Bearer tokens are randomly generated, private at rest, never stored
by the browser, and mapped to identities on the server. Caller actor IDs and unexpected
properties are rejected. Origin checks, fixed error codes and a same-origin CSP apply.
This local authentication does not certify multi-tenant RBAC, production sessions or TLS.

Projects contain environments and reference-only connection profiles. Composite foreign keys
and scoped lookups reject cross-project references. The metadata database password is solely
for PostgreSQL; the API has no application writer secret, Oracle provider or executor.
Local repository bindings are configured server-side by startup options. The first startup
supplies the registered demo repository; projects remain unbound until a developer saves
a repository/folder binding. The web displays only names, IDs and folders. Rebinding affects
new imports; retained releases keep their immutable commit and source bytes. Imports recheck
the current binding under a project lock after parsing, so a concurrent rebind cannot save
a stale release. Remote clone/provider credentials and arbitrary request paths are not exposed.
The authenticated `GET /api/projects/:id/git-refs` returns only local branches and tags from
that project's saved repository binding. It sorts refs deterministically, resolves nested
annotated tags to commits, excludes tags that do not peel to commits, and fails with a fixed
`GIT_REF_LIMIT` response rather than truncating when more than 200 refs exist. Tag peeling is
bounded to three seconds per request. No remote refs or filesystem paths are returned.
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
| `GET /api/projects/:id/git-refs` | Authenticated local branches and commit-resolving tags from the project's saved registered repository |
| `PUT /api/projects/:id/source` | Developer persists registered `repositoryId`, relative `folder`; changes are audited |
| `POST /api/projects/:id/archive` | Developer archives with `reason`; preserves all records |
| `POST /api/projects/:id/environments` | Create environment (`name`) |
| `POST /api/projects/:id/profiles` | Store `name`, `environmentId`, `engine=oracle`, `host`, `port`, `service`, `username`, `credentialRef` |
| `POST /api/projects/:id/releases` | Import `repositoryId`, `commit`, `folder` |
| `GET /api/releases/:id` | Retained source, hashes and parser observations |
| `POST /api/projects/:id/plans` | Freeze candidate from `releaseId`, `profileId` |
| `GET /api/projects/:projectId/plans/:id/comments` | Authenticated, ordered historical comment timeline within the project/plan scope |
| `POST /api/projects/:projectId/plans/:id/comments` | Append plain-text `body` to a pending plan in an active project; developer or approver |
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

Comments are append-only through the API and never modify migration bytes, plans, decisions
or migration history. Only `body` is accepted: nonblank valid Unicode, up to 4,000 UTF-16
code units, with tabs and newlines permitted; other control characters are rejected.
Actor IDs, author names, timestamps, attachments and other extra properties are rejected.
The server snapshots the authenticated author's name and supplies the timestamp. PostgreSQL
assigns the timeline sequence; plan locks serialize comments with review decisions, and the
project lock rechecks archival before persistence. A comment and its `PLAN_COMMENT_ADDED`
audit event commit together; audit facts contain only `commentId`. Invalid, unauthenticated,
out-of-scope, terminal or archived writes add neither. Terminal plans return HTTP 409
`PLAN_NOT_PENDING`; archived projects return HTTP 409 `PROJECT_ARCHIVED`. Project detail
includes its ordered `comments` array. Local identities share the configured organization;
this adds no production membership or RBAC policy.

## Verification

`npm run check` checks source/types/web build, all standard unit/regression tests, tracking,
immutable provenance and existing dependency smoke. `npm run test:product` uses a separate
local PostgreSQL test service (or `SCHEMAFORGE_TEST_DATABASE_URL` on a disposable
service with a role allowed to create databases). Each API/browser workflow owns a
unique temporary database and drops only that database after closing its pools; this
keeps concurrent schema initialization from interfering with row-lock and restart tests,
actual temporary Git objects and the pinned parser. `node node_modules/playwright/cli.js install chromium`, then
`npm run test:browser` exercises the real browser/API/parser/PostgreSQL flow, approvals,
rejection, execution denial, archival and restart persistence. PostgreSQL integration also
tests comment validation/scope, concurrent comments, decision/archive races and audit rollback.
Browser comments acceptance covers both roles, literal HTML rendered as text, timeline order,
plan isolation, historical read-only states and persistence after the server/pool restart.
The plan requester browser case checks retained author IDs and valid creation times for
developer- and approver-authored plans, unavailable feedback for malformed facts, disabled
self-review controls with no decision request or record mutation, independent approval and
rejection, and read access to terminal plans in archived projects. The API self-decision check
continues to verify its audited `SELF_APPROVAL_DENIED` response.
Browser downloads are separate test tools.

The PRODUCT CI job supplies disposable PostgreSQL, prepares the exact helper and runs these
tests with no skips allowed for required product prerequisites. The existing WP0 regression,
parser corpus, security, license and quality gates remain in force. Required failures are
repaired in source without changing thresholds. Independently authored code/documentation
uses PolyForm Shield 1.0.0; product naming and F31 packaging/distribution remain pending.
This is local development, not a packaged production distribution.

Fastify request handling follows its [official reference](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/);
the web bundle uses [React createRoot](https://react.dev/reference/react-dom/client/createRoot).
Exact third-party grants and notices are recorded separately from the immutable WP0 audit.
