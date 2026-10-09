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
   `.cache/local-product/config.json` and sign in with `developerToken`. New and upgraded
   metadata databases start read-only in `BOOTSTRAP_REQUIRED`; review existing projects in
   the UI and inspect their IDs and grant coverage with the local operator's `status` command.
2. Before project writes, explicitly grant every existing project to at least one intended
   local actor, then activate membership. On an empty database, explicitly activate without
   grants. For example, use `grant PROJECT_UUID local-developer CONFIG` for each covered
   project, then `activate CONFIG`. The configured fixed actors are `local-developer` and
   `local-approver`; no project creator or audit author is granted automatically.
3. Create a project; it returns a creation receipt only. Find its ID with `status`, grant the
   intended existing actors (for example, both fixed actors), then select **Refresh workspace**
   in the UI and open the assigned project. Only then create a Development environment and
   add an Oracle connection profile with
   host `oracle.example.invalid`, service `DEV`, username `APP`, port 1521 and credential
   reference `vault://local/dev/app`. This records configuration without resolving secrets.
4. Open Releases, select the project and save its source binding to **Local migration demo**
   and folder `migrations`. Retain ref `HEAD`, select a listed branch or commit-resolving tag,
   or enter a manual ref, then import. Imports use the saved binding;
   unbound projects and repository/folder mismatches are rejected before Git/parser work. The server resolves a full commit and retains exact
   UTF-8 bytes, SHA-256 hashes, canonical numeric versions and ANTLR validation observations.
   Open the SQL previews. Release inspection also shows the full stored commit, durable repository ID,
    object format, folder, manifest digest, parser profile and import time. These facts and stored SQL
    remain available when Git is unavailable and for archived projects; a current registered name may
    supplement the retained repository ID. Syntax-invalid releases remain visible and cannot produce plans.
5. Select the profile and prepare an offline candidate. Before creating it, the API checks
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
   For an individual retained SQL file, choose **Preview parsed statements** to recompute an
   offline statement view. The read-only endpoint checks release/file scope and retained JSON
   bounds in PostgreSQL before loading file payloads, verifies the complete format-1 manifest,
   then runs the pinned ANTLR helper against the exact retained UTF-8 bytes. The view shows
   ordered source byte ranges and literal source slices, with separate source and normalized
   execution SHA-256 facts and the parser profile. These are offline review facts only: they
   do not bind an approved worker, verify an Oracle target, or authorize execution. Unsupported,
   corrupt, oversized or unavailable parser inputs show one fixed unavailable message and
   never show a successful partial result. Historical plans, intents and manifests are not
   rewritten or backfilled. When a legacy retained file has a null statement count, the view
   reports the count recomputed for this request without filling the old field; a stored
   numeric count must match the parser result. Project, plan, release, file and session changes
   discard delayed preview responses; current membership is checked when the request is admitted.
   The same review also shows the selected plan's profile and matching environment from
   the currently loaded project configuration. It labels this as current configured metadata,
   not a frozen plan snapshot or observed database identity. A missing or mismatched profile
   or environment displays a fixed unavailable message and the retained reference IDs; it
   never falls back to another profile. Credential references and secrets are not displayed
   or resolved. This read-only view does not connect to a database.
   Each new plan also stores a format-1 offline intent envelope and SHA-256 digest in the
   plan transaction. Format 1 is a UTF-8 JSON array in this fixed order: version `1`,
   organization ID, project ID, authenticated requester ID, release ID, full commit,
   object format, folder, parser profile, manifest digest, profile ID and name, environment
   ID and name, engine, host, port, service, username, opaque credential reference, then
   ordered `[path, version, sha256]` item arrays. The digest hashes the exact UTF-8 array
   bytes; this is a task-specific encoding, not a general canonical JSON implementation.
   Review displays only the digest and captured non-secret target/environment facts. The
   retained credential reference is never returned in the offline-intent view or rendered.
   Approval rechecks the envelope digest and its requester, scope, release provenance and
   ordered items while holding the existing transaction locks. Missing, malformed or
   changed intent fails closed without decision, history or audit writes; legacy plans stay
   inspectable but cannot be approved. Reconfiguring a target affects new plans only.
   These local checks do not observe Oracle identity/history, revalidate at execution, or
   establish tamper resistance against a database administrator.
   A selected rejected plan in an active project with a registered bound source also offers
   **Prepare new plan**. This is read-only navigation into that project's release intake:
   it clears the inspected release and unsent review drafts and restores the All plan filter.
   Commit changed SQL and import that new commit as an immutable release before preparing
   another candidate. The existing release, rejection, comments, decision and history remain
   intact. The new candidate receives its own retained intent digest and requires an
   independent decision. Archived, unbound and stale project selections do not offer the
   action; the existing authenticated release-import and plan APIs remain the write boundary.
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

Local identities are persisted in PostgreSQL with a SHA-256 bearer digest and a fixed
24-hour expiry measured from database issuance time. Startup seeds an identity and its
first credential once; restarting with an old config cannot extend expiry, reactivate a
revoked token or change its fixed role/organization. A changed display name is current
profile data; names already captured on decisions remain historical snapshots. A revoked
credential blocks requests admitted after revocation; it does not cancel an operation that
already passed authentication.

Project membership starts in `BOOTSTRAP_REQUIRED`, including when the metadata database is
upgraded. Existing projects and their retained records remain unchanged; no membership is
inferred from project creation or audit history. Authenticated actors can read legacy project
data during bootstrap, while all project writes return `MEMBERSHIP_BOOTSTRAP_REQUIRED` before
writing project, audit, source, release, plan, comment, or history rows. The web displays this
read-only state.

The local OS operator manages explicit grants independently of API bearer credentials using
`npm run local:membership -- <action> ... /absolute/private/config.json`. Supported forms are
`status CONFIG`, `grant PROJECT_UUID ACTOR_ID CONFIG`, `revoke PROJECT_UUID ACTOR_ID CONFIG`,
and `activate CONFIG`. The config must be the existing local 0700-directory/0600-file config;
the database URL comes from `SCHEMAFORGE_LOCAL_DATABASE_URL`, must target the loopback local
metadata database, contain no query overrides, and carry that config's database password.
`status` reports project and existing actor identifiers/names, fixed roles, explicit assigned
project IDs, coverage readiness and usable grant counts without printing tokens or SQL. Grant
and revoke accept only a persisted local `developer` or `approver`
actor and an existing local project. They preserve fixed roles and retain revoked grant periods
plus operator UID audit facts. Repeating a grant or revoke is idempotent.

Grant each existing project to at least one actor with a current local credential, then run
`activate CONFIG`. Activation serializes with credential issuance/revocation, locks the access
mode, projects, actors and credentials in stable order, then checks full coverage immediately
before changing mode. It records the local OS UID and is one-way. Usability is evaluated against
the PostgreSQL clock; expiry can occur after activation and is still enforced at admission. An empty metadata database may be explicitly
activated. A failed coverage check leaves bootstrap mode unchanged. Recovery remains available
through the same CLI after all grants or API credentials are revoked; access mode is never reset
by startup. In `ENFORCED`, lists and project resources are limited to current explicit grants;
revoked or guessed IDs return the same `NOT_FOUND`. Project creation returns only an ID receipt
and does not grant the creator access. Run `grant` before opening that project. A request already
admitted before a committed revoke may finish; later admissions are denied. Grant/mode state
persists across API instance and PostgreSQL connection-pool reopen.

Rotate or revoke only an existing local identity with the trusted OS operator. It accepts
an explicit private config path and reads `SCHEMAFORGE_LOCAL_DATABASE_URL` from the process
environment so the database URL is not placed in command arguments. For example,
`npm run local:credentials -- rotate developer /absolute/private/config.json` writes the
new random credential into that mode-0600 config without printing it. The config directory
must be private (0700). `revoke` disables that identity's saved token in PostgreSQL while
keeping the private config shape valid; that value remains denied, and a later `rotate`
writes a new one. `recover /absolute/private/config.json` completes an interrupted DB/config replacement; local
startup fails closed while its private journal is pending. The journal and staged config
are private, bounded files protected by a persistent mode-0600 Linux `flock` lock and
same-filesystem rename. The local operator requires `/usr/bin/flock` from util-linux.
If a process dies after staging but before its journal is durable, `recover` verifies that
the staged file changes exactly one local token, preserves the other identity and database
password, and that the candidate digest was never inserted. It then discards only that
uncommitted stage. Ambiguous or malformed states remain fail-closed for manual review.
PostgreSQL and filesystem updates are not one atomic transaction. An operator must not
delete or edit an interrupted journal by hand; retry `recover` and inspect the fixed error
if state is corrupt. The command accepts only the documented exact arguments and rejects
unknown options before reading the config or connecting to PostgreSQL. Testing uses disposable
credentials and databases only; it closes and reopens a PostgreSQL client pool but does not
restart the API daemon or prove behavior across an operating-system UID boundary.

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
| `GET /api/session`, `/api/repositories`, `/api/projects` | Authenticated identity, allowlisted binding names and bootstrap/enforced project visibility |
| `POST /api/projects` | During bootstrap, fixed denial; when enforced, create project (`name`, optional `description`) and return a receipt without an implicit grant |
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
The plan-resubmission API and browser cases commit changed SQL in task-owned temporary Git
repositories, import a distinct immutable release, create a fresh plan and retain the
rejected predecessor. They verify the fresh intent digest and independent decision, preserve
the predecessor's source, comments, decision, history and prior audit records, reject scoped
cross-project/self/terminal requests, and confirm that navigation itself issues no API write.
The browser case also checks the cleared inspection state, All filter, intake guidance, and
archived/unbound action visibility.

Protected source-binding generations are server-owned positive decimal strings. Saving the
same repository and migration folder leaves the generation unchanged; changing either value
advances it. Plans capture the current generation when created, and approval checks that value
and the retained release source under database locks. A pending legacy plan with no captured
generation, or one whose source binding has changed, remains readable and rejectable but cannot
be approved. Use **Prepare fresh plan** to return to the existing release intake and create a
new candidate against the current binding; unchanged SQL can be imported from the bound commit.
This compatibility check protects review against source-binding changes and does not verify an
Oracle runtime target or execute migrations.

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
