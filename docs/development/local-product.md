# Local SchemaForge product

## HTTP request limits

The API uses the pinned Fastify rate-limit plugin before authentication and metadata
work. Each client address may make 600 requests per minute, shared across registered
routes. Excess requests receive HTTP 429, `RATE_LIMITED` and a `Retry-After` header.
There is no loopback exemption. Forwarded address headers are not trusted; IPv6 clients
share a /64 subnet quota. Counters are bounded and local to one API process, so each
replica and restart has its own counters. Multi-replica installations also need request
limits at their trusted ingress. These limits protect product HTTP endpoints and do not
change migration authorization or execution gates.

## Provisional schema references

The **Schema references** project view shows only current schema ownership for the selected
project. These are trusted local operator declarations labelled `MANUAL_REFERENCE` and
`PROVISIONAL`; they do not report observed Oracle identity or grant profile, plan, approval,
or execution authority. Declared environment belongs to the container and applies to each
schema reference in it.

The trusted OS operator uses `node scripts/local-inventory-operator.mjs` with the private
local config and `SCHEMAFORGE_LOCAL_DATABASE_URL`. `declare` accepts bounded flags for the
database key/label, container key/name/kind, environment, host, port, service, transport and
exact owner. `status` lists declarations and current ownership. `assign --schemaId UUID
--projectId UUID --expectedRevision 0 --reason TEXT` assigns or transfers ownership;
`release --schemaId UUID --expectedRevision 1 --reason TEXT` releases it. Supply
`--config .cache/local-product/config.json` for each command. Revisions use canonical
decimal strings. The operator rejects immutable fact conflicts and stale revisions. It does
not connect to Oracle, resolve credentials or probe routes.

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
   Statement preview, offline plan creation, evidence-linked comments and approval first run a
   database-side scalar preflight under their existing scoped row locks. It caps a release at
   128 files, 2 MiB per file and 16 MiB total SQL, and limits the complete encoded non-content
   metadata—including unknown nested extension fields, array overhead and release identity—to
   4 MiB. Known byte and statement-count fields are type-checked with bounded numeric parsing.
   Small historical extensions, Unicode SQL and null statement counts remain readable; malformed
   or over-budget metadata returns the route's existing fixed integrity response before SQL file
   payloads are copied into the API process. No retained record is rewritten or backfilled.
   Review ordered files/hashes and
   `NOT_OBSERVED` target history. No target history was read, so this is not a reconciled
   execution plan and does not claim that all files are pending on a real database.
6. Open **Review inbox** to see pending plans across active projects with current explicit grants. Use
   All pending, Authored by me, or Eligible for my review; refresh after project access changes.
   Eligible means the fixed approver role with requester exclusion only; it does not attest to
   source integrity or execution readiness. Open a row to review that exact plan in Plans & review. The inbox is read-only and excludes
   archived projects.
7. Sign out, sign in with `approverToken`, and open Plans & review. Record a reason and
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
   Pending plans can be routed to a current project member with the fixed approver role.
   The requester or current assignee can choose another reviewer or clear the assignment;
   an eligible approver can claim an unassigned plan for themselves. Reviewer choices are
   scoped to the plan's project, exclude its requester, require a current grant and active
   credential, and return at most 50 names; the UI reports when more choices exist. A strict
   decimal revision accompanies each change. Stale writes fail, same-target requests leave
   the revision and audit unchanged, and real changes append one `PLAN_REVIEWER_ASSIGNED`
   event. Once assigned, only that independent current approver can decide the plan; unassigned
   legacy plans retain independent approver review. The Assigned to me filter shows pending
   plans routed to the signed-in actor. Assignment changes do not alter source, intent, comment,
   decision or history facts and do not authorize execution.
   Developers and approvers can add review comments while a plan is pending. The timeline
   retains plain text, the server-resolved author name and timestamp in submission order.
   Comments remain readable after approval, rejection or project archival; those states
   close the comment composer. Switching plans or projects clears an unsent comment.
   From the exact retained plan-source statement preview, select up to eight statements to
   attach as supplemental evidence to a plain-text comment. Each submitted tuple contains
   only a retained file path (at most 4096 UTF-8 bytes), source byte range, source digest
   and normalized execution digest; the serialized tuple array and persisted facts are each
   capped at 48 KiB. The API resolves release, file, parser profile and retained format-1
   intent digest from the locked plan and release, recomputes the pinned preview once per
   distinct file, and saves references with the comment and audit event in one transaction.
   Reference and audit metadata store no SQL text, arbitrary title, URL, upload or credential
   reference. Existing plain-text comment bodies can still contain SQL as ordinary text.
   Format 1 does not contain statement digests: these are supplemental facts recomputed from
   retained UTF-8 bytes and do not grant execution authority. Legacy comments read with an
   empty reference list and remain unchanged. Body-only comments remain usable on pending
   legacy plans even when the retained intent or binding generation is unavailable; adding
   references requires a current protected binding and intact eligible plan, otherwise
   refresh or prepare a fresh plan and submit again. Invalid or stale attachments write no
   comment or audit record. Explicit selections can span files of the same verified immutable
   plan release; changing the preview file discards late previews while preserving those
   selections. Project, plan, release, session or invalidated source changes clear unsent references;
   reopening a saved reference requests the exact scoped retained-source preview and checks
   its saved range and digests. This local workflow does not connect to Oracle or change
   executable migration bytes, historical intents, decisions or history.
   Approved, rejected and revoked plans show the original read-only Decision record with the server-stored
   reviewer name and ID, decision time and plain-text reason. The reviewer name is captured
   with the decision, so later identity configuration changes do not alter attribution;
   older decisions without a stored name display their retained actor ID.
   New approvals carry a stable approval reference linked to their `PLAN_APPROVED` audit UUID.
   An independent currently granted approver can withdraw an approved offline candidate by
   submitting that exact reference (or explicit `null` for an older approval) and a nonempty
   reason of at most 2,000 characters. Ordinary tabs and line breaks are supported; malformed
   Unicode and other control characters are rejected.
   Withdrawal appends one immutable scoped revocation record and audit event, changes only the
   plan status to `REVOKED`, and preserves the original decision, actor, reason, time, source,
   intent, comments and history. It remains available when retained SQL or intent is damaged;
   it never claims to stop or roll back execution. Execution is unavailable and plans remain
   `NOT_EXECUTED`. A revoked plan cannot be approved again; prepare a fresh plan to seek approval.
   Use Plan status to filter All (the default), Pending approval, Approved, Rejected or Revoked.
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
   Each new plan stores a format-2 offline intent envelope and SHA-256 digest in the
   plan transaction. Historical format 1 remains a UTF-8 JSON array in this fixed order: version `1`,
   organization ID, project ID, authenticated requester ID, release ID, full commit,
   object format, folder, parser profile, manifest digest, profile ID and name, environment
   ID and name, engine, host, port, service, username, opaque credential reference, then
   ordered `[path, version, sha256]` item arrays. The digest hashes the exact UTF-8 array
   bytes; this is a task-specific encoding, not a general canonical JSON implementation.
   Format 2 changes the version to `2` and appends the complete ordered statement array:
   `[ordinal, path, fileOrdinal, startByte, endByte, sourceSha256, executionSha256]`.
   The pinned parser derives every statement from one verified immutable retained-release
   snapshot, in numeric migration order. The complete stream is capped at 4,096 statements
   and the whole envelope at 4 MiB; empty, incomplete or oversized streams fail planning.
   Review pages through this bound sequence in 50-row pages using the exact intent digest.
   The read-only scoped endpoint returns identity metadata, without SQL or authority;
   delayed responses after plan/project/session changes cannot replace the selected view.
   Review also displays the digest and captured non-secret target/environment facts. The
   retained credential reference is never returned in the offline-intent view or rendered.
   Approval rechecks the envelope digest and its requester, scope, release provenance and
   ordered items while holding the existing transaction locks. Format-2 approval and
   deployment requests rederive the entire statement stream and require exact equality.
   Missing, malformed or changed intent fails closed without decision, history or audit
   writes. Historical format-1 intents remain readable and retain their file-only approval
   behavior; their requests return `STATEMENT_APPROVAL_REQUIRED` without creating a job.
   Prepare a fresh format-2 plan and obtain a fresh independent approval; never rewrite
   or silently upgrade historical approval bytes. Plans lacking an intact intent remain
   inspectable and cannot be approved. Reconfiguring a target affects new plans only.
   These local checks do not observe Oracle identity/history or
   establish tamper resistance against a database administrator.
   A selected rejected or revoked plan in an active project with a registered bound source also offers
   **Prepare new plan**. This is read-only navigation into that project's release intake:
   it clears the inspected release and unsent review drafts and restores the All plan filter.
   Commit changed SQL and import that new commit as an immutable release before preparing
   another candidate. The existing release, rejection, comments, decision and history remain
   intact. The new candidate receives its own retained intent digest and requires an
   independent decision. Archived, unbound and stale project selections do not offer the
   action; the existing authenticated release-import and plan APIs remain the write boundary.
8. Inspect Audit & history. Audit action filters list only actions present in the selected
   project's recent events; All actions is the default and preserves server ordering.
   Project changes and sign-out restore that default. Archived project events remain
   readable, and an empty timeline explains that no events are available. Each proposed
   migration records `NOT_EXECUTED`; no applied receipt exists. Stop/restart the API to
   confirm PostgreSQL retains these records.
9. As the developer, return to Projects and archive a completed project with a reason.
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
HTTP mode retains local bearer authentication. HTTPS mode adds the bounded browser session lifecycle described below; multi-tenant/provider login and deployed worker transport remain unverified.

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
`deploy-grant PROJECT_UUID ACTOR_ID CONFIG`, `deploy-revoke PROJECT_UUID ACTOR_ID CONFIG`,
and `activate CONFIG`. Deployment permission is an explicit operator grant separate from fixed
developer/approver roles. It requires current membership and a usable credential. Membership
revocation atomically retires deployment permission; restoring membership never restores it.
The config must be the existing local 0700-directory/0600-file config;
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
All other API reads/writes require an explicit bearer credential or, in HTTPS mode, a current browser cookie session with its CSRF proof:

| Endpoint | Behavior |
| --- | --- |
| `GET /api/session`, `/api/repositories`, `/api/projects` | Authenticated identity, allowlisted binding names and bootstrap/enforced project visibility |
| `POST /api/projects` | During bootstrap, fixed denial; when enforced, create project (`name`, optional `description`) and return a receipt without an implicit grant |
| `GET /api/projects/:id` | Project, environments, profiles, releases, plans, audit, history |
| `GET /api/projects/:id/audit` | Read-only project audit page (`50` events) with optional exact `action` and opaque bounded `cursor`; current membership is checked on every request |
| `GET /api/projects/:id/git-refs` | Authenticated local branches and commit-resolving tags from the project's saved registered repository |
| `PUT /api/projects/:id/source` | Developer persists registered `repositoryId`, relative `folder`; changes are audited |
| `POST /api/projects/:id/archive` | Developer archives with `reason`; preserves all records |
| `POST /api/projects/:id/environments` | Create environment (`name`) |
| `POST /api/projects/:id/profiles` | Store `name`, `environmentId`, `engine=oracle`, `host`, `port`, `service`, `username`, `credentialRef` |
| `POST /api/projects/:id/releases` | Import `repositoryId`, `commit`, `folder` |
| `POST /api/projects/:id/releases/compare` | Read-only `baseReleaseId`, `candidateReleaseId` comparison |
| `GET /api/releases/:id` | Authenticated, scoped read-only historical source detail; scalar bounds are checked under project/release locks before file or diagnostic text projection. Malformed or oversized retained detail returns fixed HTTP 409 `RELEASE_UNAVAILABLE`. The historical view preserves bounded `VALID`, `INVALID` and `UNAVAILABLE` diagnostics and does not attest current Git or parser state. |
| `POST /api/projects/:id/plans` | Freeze candidate from `releaseId`, `profileId` |
| `GET /api/projects/:projectId/plans/:id/comments` | Authenticated, ordered historical comment timeline within the project/plan scope |
| `POST /api/projects/:projectId/plans/:id/comments` | Append plain-text `body` to a pending plan in an active project; developer or approver |
| `POST /api/plans/:id/decision` | Independent `APPROVE`/`REJECT` with `reason` |
| `GET /api/projects/:projectId/plans/:id/reviewers` | Up to 50 current eligible reviewer IDs/names; `hasMore` reports truncation |
| `PUT /api/projects/:projectId/plans/:id/reviewer` | Assign or clear with `reviewerId` (nullable) and canonical decimal `expectedRevision` |
| `POST /api/plans/:id/approval-revocation` | Withdraw with `expectedApprovalReference` (UUID or explicit `null`) and `reason` |
| `POST /api/plans/:id/execution` | Request a deployment job using only `idempotencyKey` and `reason`; creates a durable `WAITING_VALIDATION` job |
| `GET /api/projects/:projectId/execution-jobs` | Read up to 50 current-project jobs |
| `GET /api/execution-jobs/:id` | Read a scoped job and immutable events |
| `GET /api/execution-jobs/:id/attempts?cursor=...` | Read 50 retained attempts in descending generation order |
| `GET /api/execution-jobs/:id/attempts/:attemptId?eventsCursor=...&receiptsCursor=...` | Read 50 statement events and 50 receipts; cursors are bound to actor, job, attempt and stream |
| `GET /api/projects/:projectId/plans/:id/statement-envelope?intentDigest=...&after=...` | Inspect 50 statement identities bound to an exact format-2 intent; stale digest returns `FRESH_PLAN_REQUIRED`, format 1 returns `STATEMENT_APPROVAL_REQUIRED` |
| `POST /api/execution-jobs/:id/cancel` | Cancel the requester's undispatched job with `expectedRevision` |

Historical release detail reads enforce the retained limits of 128 files, 2 MiB per
file, 16 MiB aggregate source content and 4 MiB of complete encoded non-content metadata
before PostgreSQL returns retained files, identity strings or validation diagnostics.
This is a display allocation bound; protected planning, comparison, preview and review
readers retain their separate strict integrity checks.

Writes and their audit/history events share PostgreSQL transactions. Approved items are
immutable through the API; terminal decisions cannot be overwritten. Local startup adds nullable
`reviewer_id` and nonnegative `reviewer_revision` columns idempotently; existing plans remain
unassigned at revision zero. Historical terminal and archived assignment metadata stays readable.
Additional eligible reviewers beyond the directory bound can be assigned by their known actor ID
through the same scoped API. Expiring temporary delegation remains unavailable. Metadata administrators
remain outside this protection. Offline plans have no observed target history, so requests
remain `WAITING_VALIDATION` and cannot be admitted by API or operator grant. Plan readiness
explicitly lists missing target history, trusted host, target mutex and dispatch permit;
format-1 approvals additionally require a fresh statement-bound approval. The restricted
coordinator accepts only an admitted immutable job through injected trusted ports; synthetic
ports are UNIT evidence only. No production Oracle adapter, automatic retry, installed trusted target ledger,
runtime authority, Oracle connections, Kubernetes deployment or production compatibility
claim is included. Archival retains records and transactionally rejects further project
writes with HTTP 409 `PROJECT_ARCHIVED`, including in-flight writes that were waiting
on the project lock. No restore or deletion endpoint is provided. Edit/resubmit and broader
catalog workflows are incremental work.

The review screen's **View execution history** opens retained claim/terminal states,
statement events, HOLD reason codes and receipt/evidence digests. Each API page contains
at most50rows per stream; attempt generations and event revisions remain decimal strings
without JavaScript rounding. Active project membership and the presenting credential are
rechecked through a consistent read transaction. Archived projects and RESTORE_HOLD metadata remain
readable with current authority; reads never claim, recover, release HOLD or replay SQL.
Lease tokens, credential references and arbitrary event payloads are excluded. Synthetic
records are explicitly labelled **UNIT_SYNTHETIC**, with no Oracle execution validation.
Claim deadlines and missing receipts do not establish current authority or prove whether
SQL was applied. These endpoints project central retained metadata, not a reconciled
Oracle target ledger; runtime admission and reconciliation remain separate gates.

When a retained admission proof matches the job, approved plan, release manifest and
format-2 immutable intent, event and receipt rows also show their original approved
migration path/version, file-local statement ordinal and full approved statement ordinal.
The journal's existing ordinal remains the attempt's pending-work ordinal. The projection
checks that ordinal against the corresponding approved pending statement digest, so repeated
digests do not redirect migration attribution. Counts distinguish the retained approved
prefix from pending work, while making no claim that those statements changed the target.
Legacy envelopes, missing proofs and mismatched bindings remain readable with approved
migration context marked unavailable. This provenance display does not consult current Git,
target state, mutable profiles or cross-project approval history.

The immutable PostgreSQL proof row stores expected bindings; it does not independently grant
execution authority or establish live target identity, history, mutex ownership, validity or
central evidence. The restricted worker bridge requires a separately installed trusted host; default local
startup has no host or Oracle adapter.
The coordinator rechecks those injected live checks before each statement and before success;
the PostgreSQL adapter persists matching expected digests, ordered acknowledgments, receipts
and terminal projections. The synthetic PostgreSQL integration exercises this contract only
with explicitly labeled UNIT evidence.

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

### Compare retained release sources

In **Release intake**, choose a base release and a candidate release, then select **Compare source**.
The read-only result shows both retained commit and manifest identities plus files aligned by the
canonical migration version. Each ordered fact labels added, removed, changed or unchanged source
and displays the retained path, SHA256, byte count and literal SQL for each side. A rename at the
same version is shown as changed. Comparing one release with itself is supported.

The API requires current project membership and rechecks both releases under project and release
read locks. It checks database-side payload bounds for both retained manifests before loading either,
including a four MiB total encoded budget for all non-content file metadata and repository, folder and
parser-profile identity fields. Unknown extension fields remain readable inside that budget; the
known `statementCount` field must be null or a bounded nonnegative safe integer. It then verifies the
stored format-1 manifests and UTF-8 bytes. Releases must share retained repository ID, folder and parser
profile. An archived project remains readable; removed local repository
registration does not prevent reviewing retained data. Missing, foreign, revoked, invalid or
incompatible comparisons use fixed unavailable feedback. Refresh, project, session or either pair
selection change clears an in-flight result. The comparison never reads Git, reruns the parser,
creates a plan, writes history, or reports whether SQL was applied or changed a database.

### Combined local review workflow

Import and compare retained Git releases, prepare an offline plan, add review comments,
and assign a currently granted independent approver. **Review inbox** lists pending
plans across accessible projects; **Eligible** respects the assigned reviewer. After
approval, select **All** or **Approved** to inspect the terminal plan. Any currently
granted independent approver can withdraw approval, including an approver other than
the assigned reviewer. Preserve the original approval and create a fresh release and
plan for recovery. **Audit & history** retains assignment, approval and withdrawal
events with action filters and older-page navigation. Manual schema references remain
provisional reference metadata. The combined API and browser tests use local Git, the
pinned parser and disposable PostgreSQL; they do not connect to Oracle or execute SQL.

### Private metadata backup and restored-instance recovery

The trusted local OS operator can take a consistent metadata snapshot and retain its
archive separately from an external witness. Keep both locations private, protect the
witness independently, and retain the local operator config beside the PostgreSQL volume.
The CLI builds its loopback connection from that mode-0600 config; passwords and bearer
tokens are not command arguments or diagnostics. It accepts only the pinned local
PostgreSQL 17.10 image on its explicit loopback port and known product schema.
The restored-instance CLI uses the existing default local config, `schemaforge` database,
`schemaforge` user and port 55432. It rejects overrides on restore/start. The library API
accepts separately authorized loopback fixtures; it does not expose an HTTP operation.

```sh
npm run local:backup-restore -- backup --destination /absolute/private/backups/run-01 --witness /absolute/private/witnesses/run-01.json
npm run local:backup-restore -- restore --backup /absolute/private/backups/run-01 --witness /absolute/private/witnesses/run-01.json
npm run local:backup-restore -- start
```

Backup destinations and witness files must be new, mode-0700 directories and mode-0600
files respectively. Store the witness outside the backup directory and outside its custody
failure domain. The custom-format archive is data-only; the versioned manifest binds its
digest, the exported PostgreSQL snapshot's metadata generation/checkpoint and the complete
registered public schema inventory, including function definition digests, trigger bindings,
sequence definitions/column ownership and object owner/privilege checks. The comment identity
sequence value is restored separately from its controlled definition. Source organization
metadata must exactly match the fixed local singleton; unsupported organization/schema state
is rejected. Fixed organization metadata is recreated by initialization;
the current-generation pointer and per-destination ownership marker are not copied. The
external witness binds the exact manifest bytes and archive digest. Do not move or edit any
of these files after creation.

Restore checks the witness, archive digest, path permissions, known schema, pinned tool image,
source container and loopback port before it creates a randomly named destination database.
It copies the verified archive bytes to a new private staging directory and mounts that
copy read-only, preserving the original archive, manifest and witness. It imports only registered table data and sequence values into the initialized controlled
schema. The fixed organization seed is recreated and the one bootstrap access-mode row is
removed only in that invocation-owned new database before its backed-up mode is restored.
The archive omits the active-generation pointer: restore installs a new generation in
`RESTORE_HOLD` as the pointer in the same transaction that records the restore audit.
Initialization refuses to seed an ACTIVE generation while an invocation ownership marker
exists, so an interrupted restore remains inaccessible. Failed cleanup drops a database only
when its private ownership marker, database OID and database owner still prove that this
invocation created it. An inaccessible destination without that proof is retained for
trusted operator inspection; no source or existing destination is overwritten.

The restore preserves historical generations, catalog, explicit memberships, approvals,
retained release bytes, comments, receipts, jobs, events and terminal states. Waiting and
admitted jobs and claimed attempts move to HOLD with appended events; existing history is
retained. Previously active local credentials are revoked with digest-only lifecycle evidence.
The operator rotates the existing developer and approver credentials in the private config,
retaining actor roles and explicit project/deploy grants. Old bearer tokens remain denied.
The recovery banner leaves historical pages available and disables request/cancel controls.
There is no HTTP restore or hold-clear route. Starting the restored app is local only:

```sh
npm run local:backup-restore -- start
```

This creates no target observation or Oracle evidence. RESTORE_HOLD remains until an
independent operator reconciliation outside the application; this product slice has no
hold-release interface.

## HTTPS browser sessions

Start the existing local product with operator-provided TLS material:

```sh
npm run dev -- --tls-cert /absolute/private/tls/server-chain.pem --tls-key /absolute/private/tls/server-key.pem
```

Use the same options with `--restored` to open a restored instance. The listener remains
`https://127.0.0.1:4317`; no remote listener or trusted proxy mode is enabled. Both files
must be regular, singly linked, owned by the current OS user, mode 0600, beneath an owned
0700 directory, with no symlink components. Certificates must contain the correct address
SAN and a chain trusted by the client. Provision and renew them through your authorized
certificate authority. Startup validates TLS material before starting metadata services;
invalid material fails with fixed diagnostics. Native TLS requires version 1.2 or newer.
Do not bypass client certificate validation. Existing HTTP loopback startup remains a
local bearer mode; cookie login cannot be enabled by forwarding headers or plaintext.

In HTTPS mode, the sign-in form exchanges the private named LOCAL credential through
`POST /api/session` for a random BROWSER child credential. Only its digest is retained in
PostgreSQL. The original access token is cleared from application state. The browser
stores the session in a `__Host-schemaforge` Secure, HttpOnly, SameSite=Strict cookie,
with Path=/ and no Domain. The application retains only a CSRF proof in tab memory;
localStorage/sessionStorage never store either credential. `GET /api/session` resumes
this cookie session after reload and supplies the current fixed actor and CSRF proof.

Cookie requests use `X-CSRF-Token`; state-changing requests also require an exact HTTPS
Origin. Cookie tokens cannot be used as bearer credentials to bypass these checks.
Explicit bearer API/CLI requests retain their existing nonambient authorization and
same-origin checks. A stale tab's proof cannot silently read data under a replacement
cookie identity. Replacement sign-in revokes the old cookie session. Logout calls
`POST /api/session/logout`, revokes the session on the server and expires the cookie;
failed requests show a retry message instead of claiming success. Logging out one session
does not revoke the named operator credential or other browser sessions.

The idle limit is 30 minutes, and absolute lifetime is at most eight hours and never
later than the parent LOCAL credential's expiry. User activity can refresh the idle
deadline; background polling alone cannot. Expired sessions cannot be renewed. Each
request checks child and parent revocation/expiry, fixed organization and role; mutation
checkpoints serialize with logout and operator credential lifecycle operations. Existing
`local:credentials` rotation/revocation invalidates every child credential for that
identity. Reopening the application never reseeds revoked credentials. Witnessed metadata
restore imports credentials as retained history and revokes old LOCAL and BROWSER
credentials; strict backup schema compatibility rejects snapshots from another schema
version. Keep old binaries and their witnesses for old-schema snapshots; do not bypass
inventory validation. Fresh operator credentials permit historical reads while the
restored instance stays in RESTORE_HOLD.

Local acceptance uses disposable certificates and normal Node HTTPS CA/hostname checks,
including untrusted-chain and wrong-hostname rejection. Chromium trusts only the generated
fixture public-key pin; no-pin and unrelated-key cases reject TLS. This is explicit test
key trust, not browser CA-chain validation or deployed worker-transport acceptance.
No global trust store is modified, and no external/Oracle deployment is certified.

Credential operator recovery journals contain only independent `LOCAL` credentials.
Derived browser sessions do not consume the existing 32-entry journal bound. Rotation
and revocation still revoke every credential for the actor, including browser sessions,
under the shared transaction lock; session history remains retained. Recovery before a
database commit preserves access, and recovery after a commit completes the private
config transition without restoring old access. Browser sign-in/logout while an operator
operation is interrupted does not change its LOCAL credential recovery witness.


## Restricted execution bridge

The local web/API stack creates requests and displays history. An OS-installed worker can
use `createExecutionWorker(sql, host)` from `apps/worker/run-request.ts`; the host is a set
of callable capabilities, never a browser payload or JSON setting. Its fixed worker identity
and evidence scope cannot be replaced by request fields. Production hosts require
`TRUSTED_VALIDATED`; tests opt into `UNIT_SYNTHETIC` explicitly with `allowUnitSynthetic:true`.
No deployable validated Oracle host or worker deployment is supplied. The protected ledger
foundation below uses the already pinned driver through a private connection capability.
The restricted adapter described below connects those capabilities to the existing worker;
it does not install a production authority/credential provider or certify runtime behavior.
Do not turn the UNIT fixture
into a production configuration or resolve writer credentials in the API.

The host's `withTarget` owns its physical connection, canonical target mutex and dispatch
permit for the entire callback. `observe` provides current target identity, explicit catalog
assignment, history, validity and evidence witnesses. `current` must attest that the held
identity/permit and history progression still match that observation and dispatched receipts;
postcondition and central evidence checks must attest actual target facts. Digest strings
alone confer no authority. The worker gives the host the immutable approval reference,
intent digest and complete per-file migration identities. `observe` must return
`historyFormat:1`, an ordered `appliedMigrations` ledger and the exact pending statement
digests. Every applied file records APPLIED outcome, its original approval reference and
intent digest, path/version/source checksum, per-file statement manifest and ordered
execution digests. The host must attest the ledger's authenticity and target binding;
central job/receipt history cannot establish these target facts. `centralEvidenceComplete`
must confirm all known prior target effects have complete witnesses before admission,
including for EMPTY and APPLIED_PREFIX, then confirm new receipts before final success.
A prior ADMITTED/HOLD job with the same canonical target key is an independent metadata
veto; catalog reassignment cannot erase it. Before admission, the worker also reconciles
bounded retained completions for that canonical target. Every original approval/intent,
complete ordered receipt sequence and validity/postcondition witness must agree with the
separately attested applied prefix. A central VERIFIED_SUCCESS or NOOP sets a minimum
prefix requirement; it never proves target effects. An EMPTY/shorter ledger after a
recorded completion, changed original approval or intent, changed physical identity,
missing central witnesses or incompatible evidence scope records HOLD with no attempt.
Applied files without their original retained successful completion are also held. More
than 128 distinct successful effect-producing intents requires explicit operator reconciliation
outside this bridge; routine NOOP approvals do not consume that effect-history bound.
NOOP evidence retains its minimum-prefix and scope/identity veto. Lookup currently uses
the retained proof table under governance locks; large history requires operational sizing.
No automatic truncation, history repair or replay occurs.

EMPTY requires an empty witnessed ledger and selects all approved statements.
APPLIED_PREFIX requires complete files forming an exact prefix and selects only the
approved suffix. An applied V1 followed by independently approved V1+V2 executes V2 only;
V1 retains its original approval/history. EXACT_APPLIED requires every file and permits
only a witnessed zero-statement NOOP with postconditions and central evidence. File edits,
reordering, missing/unknown/partial entries, inconsistent pending digests or lost witnesses
record terminal HOLD without admission or an attempt. There is no automatic retry or HOLD
release. Old host observations without protocol1 are held; retained historical metadata
and immutable approvals are preserved. A trusted host must reconcile unknown effects
outside this bridge before a new request can be considered.

The admission proof binds the applied file/statement counts and pending manifest. The
journal's contiguous ordinals describe the selected pending sequence. The original full
approval envelope remains unchanged and is rechecked through dispatch. The pinned parser
reconstructs exactly the reviewed delimiter-free execution bytes; no second splitter is used.

Admission commits its immutable proof, ADMITTED job and first claimed attempt together,
before any dispatch. Before every statement the worker checks the original requesting
credential/session, membership/deploy grant, approval, source/profile/content, metadata
generation and held host permit. Final authority checks retain catalog/schema/global/row locks throughout each target call and the
successful terminal commit; revocation that starts during a call waits, then prevents the
next statement. Host calls must be bounded and must not wait on governance mutations they
serialize against. STARTED is committed before calling the target; matching
acknowledgments and receipts are retained before success. Lease duration is bounded to 1–300
seconds (default300); a slow/expired attempt stops and requires recovery rather than renewal.
An uncertain result, missing receipt, failed postcondition or lost authority yields HOLD.
`recoverExpired(jobId)` only projects an expired claimed attempt to HOLD, including after
credential/approval revocation. It cannot create a claim, renew, execute SQL or release HOLD.
A lost admission COMMIT acknowledgment returns HOLD_PERSISTENCE_PENDING; recover expiry
before reconciliation. A failed HOLD commit or RESTORE_HOLD generation also stays pending.

Startup adds nullable request-credential and bounded immutable host-binding columns without
backfilling old authority. Old jobs/proofs/history remain readable; an old waiting request
without presenting credential identity needs a fresh request, not automatic admission.
Backup inventory now pins this schema. Keep old binaries and witnessed backups for older
schema snapshots; cross-schema restore remains rejected. Existing witnessed restore still
revokes credentials, holds unfinished attempts and preserves history.

Focused metadata acceptance:
`SCHEMAFORGE_TEST_DATABASE_URL=<disposable-postgres-url> SCHEMAFORGE_JAVA_HOME=<pinned-jdk> node --test --test-concurrency=1 tests/product-controlled-execution.test.mjs tests/product-incremental-migrations.test.mjs`.
Build the web bundle and pinned parser first. This exercises Git→approval→request→worker→history
with synthetic host ports only; it never certifies Oracle effects, target ledger reconciliation
or production isolation. Actual execution/recovery acceptance remains blocked on an explicitly
authorized Oracle runtime and host attestation.

## Protected target-ledger foundation

`packages/execution/oracle-target-ledger.mjs` exports `createOracleTargetLedger(connection)`
for a separately installed restricted host. It accepts a dedicated physical ledger-owner
connection using the existing pinned node-oracledb 7.0.1; it opens no connection, resolves
no credential, executes no migration SQL and installs no API or worker entry point.
`apps/worker/oracle/target-ledger.sql` is an unexecuted installation artifact for an
authorized operator. Its owner must be separate from the application writer. The writer
must have no direct, role-derived, public or ANY-object privilege that can mutate this
ledger or disable its immutable-event trigger. Checking grants, object identity and owner
integrity is a trusted-host/runtime requirement; the JavaScript factory cannot attest it.

The callable methods are `read(targetId)`, `startFile(targetId, approvedIdentity)`,
`startStatement`, `acknowledgeStatement` and `completeFile`. The last three take the
one-based file ordinal; statement methods also take the one-based per-file ordinal and
approved execution digest. `startFile` accepts path/version/sha256/statementManifestDigest,
original approval UUID and intent digest, and the complete ordered statement digest list.
It snapshots that identity before awaiting I/O and atomically commits the header, expected
count/list digest and all planned statements. STARTED precedes the separate writer call;
the restricted host records ACK only after that call returns ACKNOWLEDGED. Every planned
statement must have its exact ordered ACK before FILE_APPLIED. Receipt checksums link
records and are not independent proof of effects. No automatic replay or reconciliation
is provided. Any ambiguous commit/error poisons this capability, including subsequent
reads; it never retries or reopens a connection. The host must stop dispatch and HOLD.

`oracleTargetLedgerId({targetKey,targetIdentityDigest})` derives a storage partition from
independently attested physical target facts; catalog assignment changes do not reset it.
Hashing caller data authenticates no target. `read` returns raw `ledgerFormat:1` and
`UNINITIALIZED`, `EMPTY`, `COMPLETE`, `IN_FLIGHT` or `UNTRUSTED` state, complete applied
identities and unresolved file facts. This is not a worker `TargetObservation`.
UNINITIALIZED means the partition is absent, never that the application schema is empty.
Before the first file, host must verify empty-target adoption or an explicit reviewed
baseline. Missing tables/access, null, IN_FLIGHT, UNTRUSTED or any unresolved file must
HOLD; never discard an unresolved suffix and use its completed prefix. The host compares
complete identities with the immutable approval before selecting pending migrations.
It separately attests canonical identity, protected ledger ownership, continuously held
target mutex, dispatch permit, central reconciliation and final target validity.

Fixed SQL uses bind variables, object-row format and a limit-plus-one overflow witness.
The bounds are 128 files, 4,096 total planned statements and 12,544 events; exceeding them
requires explicit reconciliation, not truncation into trusted history. Head-row locks
serialize ledger appends only and end at commit; they do not hold the execution mutex
across application DDL. Keep the ledger connection exclusive to the adapter, with no
external transaction, auto-commit or application DDL. Overlapping adapter calls fail closed.
The [pinned driver transaction documentation](https://node-oracledb.readthedocs.io/en/v7.0.1/user_guide/txn_management.html)
describes explicit commit/rollback and Oracle DDL commits; the
[connection API](https://node-oracledb.readthedocs.io/en/v7.0.1/api_manual/connection.html)
documents execution options. Fake-driver unit checks cover these storage contracts and
pending-suffix compatibility; static SQL is not Oracle installation/runtime acceptance.

## Restricted Oracle host adapter

`createRestrictedOracleHost(installed)` in `apps/worker/oracle-host.ts` supplies the
existing `createExecutionWorker` host interface. The privileged installation provides
`authorize` and `withTarget` functions; requests, API configuration and digest strings
cannot install them. UNIT fixtures require `allowUnitSynthetic:true` and retain
`UNIT_SYNTHETIC` scope. The adapter never assigns a validated scope to its unit results.
No local command, API route, credential resolver or production provider activates it.

`authorize` must return a live `EXECUTE_APPROVED_MIGRATIONS` permit bound to the exact
worker, job, plan, original approval, intent, canonical profile digest and complete ordered
statement digest list. Read-only `CONNECT_AND_READ_IDENTITY` probe permits are rejected
before opening the target. `oracleExecutionProfileDigest` provides the adapter's explicit
profile projection. The installation must retain TLS/route, credential revision and live
writer authority through the entire callback, atomically consume every `claimDispatch`
once, and enforce a whole-operation deadline; driver `callTimeout` only bounds individual
round trips. Both dedicated physical sessions require a finite 1–30000ms call timeout.
Never pool/reconnect/retry these sessions within a callback.

The supplied writer and protected ledger-owner sessions must be separate principals.
The adapter reads session user/current schema, database/container/service, session ID,
proxy identity and server version on both sessions and checks them repeatedly. The
installed `attest` capability additionally verifies physical database/PDB GUIDs, canonical
target key, approved route/TLS, owner/object integrity, complete effective privileges,
assignment, current permit and validity/central witnesses. A name or checksum alone
does not authenticate those facts. Witnesses are stable for this callback; any changed
authority or physical session makes it fail closed.

`apps/worker/oracle/target-mutex.sql` is a manual, unexecuted install artifact. Install its
definer-rights cover under the protected owner, with direct EXECUTE on `SYS.DBMS_LOCK`
for that owner and EXECUTE on the cover only for the exact application writer. No PUBLIC
or role grant, direct/inherited writer access to DBMS_LOCK, ANY-object privilege, protected
owner object mutation or SQL bind/session inspection privilege is acceptable. Application
migration SQL must not be able to inspect the private nonce or replace the cover package.
The adapter uses the same writer session for mutex acquisition and exact parser-produced
SQL. The cover allocates autonomously, requests X_MODE with `release_on_commit=FALSE`,
and authenticates its private nonce for continuity and release. `REQUEST=4` is not adopted;
continuity uses CONVERT on the existing handle, so a reset/lost lock cannot be reacquired.
The lock key derives from the canonical physical target key, excluding mutable assignment,
approval and credential identities. No separate connection's lock is treated as protecting
writer SQL after the writer session ends.

Before dispatch, observe the complete protected ledger. UNINITIALIZED and EMPTY both
require independently verified empty-target adoption. Existing nonempty schemas require
a future explicit reviewed baseline workflow; this adapter does not infer a baseline.
IN_FLIGHT, UNTRUSTED, unreadable or divergent history holds before admission. Complete
applied files must match the approved stream exactly through the existing suffix selector;
retain original V1 approval/history when approved V2 is appended. The existing central
completion reconciliation independently vetoes rewound or missing target history.

The adapter commits a complete pending file plan and its target STARTED before consuming
the one-use writer claim. It passes exact UTF-8 parser-produced bytes without splitting
or rewriting and explicitly commits DML; Oracle DDL may already have committed. Either
lost execute/commit acknowledgment leaves STARTED unresolved and returns UNKNOWN.
Only the matching ordered central receipt can record target ACK; a file becomes APPLIED
after all of its statements are acknowledged. Final postconditions and central completion
must be independently verified, with live identity/mutex/authority throughout. Interrupted
tails, mismatched receipts, callback/cleanup ambiguity and overlapping operations stop
dispatch. Drain outstanding calls before mutex release and provider session retirement.
Never discard a partial tail, infer SQL effects from a checksum, or automatically replay.

Tests combine the real PostgreSQL/Git/pinned parser/approval/worker/history pipeline with
an explicit fake Oracle transport. They verify V1/V2/NOOP, original approvals, restart,
reassignment, durable central and target STARTED, withheld receipts on uncertain effects,
adoption and write-purpose denial, and rewind veto. They do not verify actual Oracle DDL,
cover-package compilation, privileges, TLS, runtime recovery or deployed-worker isolation.
Oracle semantics are based on the official
[DBMS_LOCK reference](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html)
and [node-oracledb connection API](https://node-oracledb.readthedocs.io/en/v7.0.1/api_manual/connection.html).

## Supervised execution worker process

`createSupervisedExecutionWorker` in `apps/worker/supervisor.mjs` wraps the complete
`runWaitingRequest(jobId)` operation in a separate Node child. Its deadline includes
fixed child bootstrap, metadata admission and locking, target dispatch/receipts, and
mandatory awaited cleanup. The API still installs no worker or writer capability.

Privileged installation code selects a reviewed file URL exporting an asynchronous
`createExecutionWorker` factory. The factory resolves its private capabilities inside
the child, constructs the existing execution worker, and returns its actual immutable
`scope`, `workerId`, `runWaitingRequest` and an awaited `close` hook for its resources.
`createExecutionWorkerStarter({ factoryUrl, env })` freezes that fixed URL and a small
allowlisted environment, with no shell or inherited Node execution arguments. Do not
resolve application writer credentials in the parent API or accept factory URLs,
environment variables, target capabilities or worker scope from requests.

Installation also binds the supervisor's expected worker ID and scope. Production
requires `TRUSTED_VALIDATED`; `UNIT_SYNTHETIC` requires an explicit test opt-in and
cannot satisfy a trusted binding. The request contains only the job UUID and a fresh
invocation challenge. One READY and one exact matching RESULT are accepted; duplicate,
stale, malformed, oversized or mismatched messages hold. IPC results are bounded and
labelled with their evidence scope. The parent accepts a result only after clean child
exit and acknowledged resource cleanup.

The default whole-operation deadline is five minutes, followed by bounded TERM/KILL
escalation and confirmed process exit. Operator-selected bounds remain privileged.
Uncertain cleanup, protocol, startup or exit returns HOLD. An unreaped or unknown child
bars replacement; a retained child is reaped continuously until its actual exit. The
supervisor does not reconnect, retry SQL, redispatch a terminal job or overwrite an
already committed worker outcome when transport or cleanup acknowledgment is uncertain.
Use the durable journal and explicit target reconciliation to investigate HOLD.

The fixed starter must return its actual ChildProcess, remain synchronous and prompt,
and create no descendants. This library is a process lifecycle boundary. It supplies
no OS sandbox, installed production binding, secret resolver, service deployment or
independently validated Oracle provider. Real target access and deployed isolation
remain unvalidated.

`tests/product-worker-supervision.test.mjs` is mandatory in the PRODUCT API acceptance
list and runs serially with its shard's disposable PostgreSQL service. It runs the real
worker in a child, retains durable success after cleanup uncertainty, refuses terminal
redispatch, then approves and executes only new V2 after V1. The synthetic target and
process fault tests are UNIT evidence; no Oracle SQL is executed.

### Installation factory composition

`createInstalledExecutionWorkerFactory` in `apps/worker/installed-worker-factory.mjs`
composes the existing metadata worker, private Oracle provider and restricted host.
An independently reviewed installation module binds its private `databaseUrl` and
`installedOracle` closures, then exports the returned asynchronous function as
`createExecutionWorker` for the fixed child entry. These bindings are installation
code, never API/IPC input. The database URL belongs to product metadata; application
writer and ledger-owner routes remain inside the private Oracle resolver.
The source release verifies its shipped files; the separate private installation
module and its authority bindings require their own review before trusted execution.

The factory snapshots its scope, worker ID and authority/resolver/target-binding
functions. It creates one owned PostgreSQL client and permits one worker operation.
`close()` drains that operation, closes metadata once and reports cleanup failure;
the supervisor accepts success only after this hook and clean child exit. Reuse,
overlap, malformed requests and missing capabilities fail closed. Lease bounds remain
privileged installation options, validated before metadata acquisition.

Production bindings require `TRUSTED_VALIDATED` and the existing independently
installed purpose authority, private routes and truthful target attestations.
`UNIT_SYNTHETIC` requires explicit opt-in and a fake Oracle connector. The optional
`openMetadata` test port is accepted only in that synthetic scope; neither test port
may enter a trusted binding. Importing this builder does not authorize Oracle access
or supply credentials. Its unbound direct child export rejects startup. A deployed
service, verified installation authority and Oracle/isolation acceptance remain
separate requirements.

### Expired-attempt recovery installation

A fixed private installation module may export the function returned by
`createInstalledExpiryRecoveryWorkerFactory` as the supervised child's
`createExecutionWorker`. It accepts a fixed metadata-only binding with `databaseUrl`,
`scope` and `workerId`, and shares the execution factory's one-operation client ownership
and cleanup. The previous metadata and Oracle capability binding remains supported.
Recovery constructs no Oracle provider or host. UNIT installation requires explicit
`allowUnitSynthetic`; a custom `openMetadata` is permitted only for UNIT tests. Execution
installation still requires its full reviewed Oracle capability binding.
The privileged export selects recovery; requests cannot supply an operation selector
or change routes, scope, target capabilities or options. The existing supervised wire
hook still accepts only the job and invocation IDs.

This factory invokes the existing metadata worker's `recoverExpired`. A previously
admitted CLAIMED attempt whose lease expired moves to HOLD with the existing
`LEASE_EXPIRED_UNKNOWN` event. The transaction preserves the original attempt identity,
lease, receipts, approval and earlier events. Recovery creates no new attempt, renews
no lease, opens no Oracle session and dispatches no target SQL. Current leases, terminal jobs,
missing attempts and inactive metadata generations do not advance. Approval withdrawal
or grant revocation cannot prevent a safety HOLD after expiry.

Successful durable recovery reports HOLD after metadata cleanup and clean child exit.
An ineligible request reports admission declined. Database, run or cleanup uncertainty
fails through the supervisor boundary; it cannot erase an already committed HOLD or
claim target application. This operation supplies no reconciliation verdict, HOLD
release, execution authority or automatic retry. Investigate the retained journal and
protected target history before any separately authorized recovery or execution.

The trusted local OS operator can inspect and recover expired attempts without installing
Oracle capabilities. Using the private configuration and metadata URL already used by
the membership operator:

```sh
npm run local:execution-recovery -- status /absolute/private/config.json
npm run local:execution-recovery -- recover JOB_UUID /absolute/private/config.json
```

Supply `SCHEMAFORGE_LOCAL_DATABASE_URL` through the private operator environment. The
existing configuration must belong to the current OS user, with directory mode 0700 and
file mode 0600; the URL must identify an allowed loopback metadata database with the
matching private password. The command does not initialize or migrate the database.
`status` returns at most 50 expired trusted attempts with job/project/plan IDs and lease
deadlines, without SQL, credentials or receipt payloads. If `nextAfter` is present, use
`status /absolute/private/config.json JOB_UUID` to read the next page. Discovery does not
lock or recover attempts; recovery rechecks eligibility transactionally.

`recover` returns `HOLD` only after the selected expired claim is durably held and the
owned metadata client closes. `NOT_RECOVERED` means the job was ineligible, including a
live lease, a terminal state, a UNIT fixture or inactive metadata generation. Connection,
persistence and cleanup failures return a fixed error; inspect retained execution history
before retrying because HOLD may already have committed. Repeated recovery adds no
second HOLD. This command supplies no effect verdict, replay or HOLD release and adds no
HTTP endpoint. Real Oracle recovery and deployed worker isolation remain unverified.

### Installed durable queue service

`createInstalledExecutionService` in `apps/worker/execution-service.mjs` connects the
durable waiting queue to the fixed execution and metadata-only recovery factories.
Privileged installation code supplies its metadata URL, scope, reviewed factory module
URLs and worker identities. It snapshots those bindings, the allowlisted child environment
and bounded supervisor limits before opening metadata. Requests supply no routes, module
selection, credentials or execution/recovery selector; the API retains no writer capability.

An installation module exports `createExecutionService`, returning the installed service
in `TRUSTED_VALIDATED` scope. For example, after installing a separately reviewed private
Oracle factory that reads `SCHEMAFORGE_DATABASE_URL` and passes
`SCHEMAFORGE_METADATA_GENERATION_ID` as `expectedMetadataGenerationId` to
`createInstalledExecutionWorkerFactory`:

```js
import { createInstalledExecutionService } from '/absolute/schemaforge/apps/worker/execution-service.mjs';

export const createExecutionService = () => createInstalledExecutionService({
  databaseUrl: process.env.SCHEMAFORGE_DATABASE_URL,
  scope: 'TRUSTED_VALIDATED',
  executionFactory: {
    factoryUrl: 'file:///absolute/private/oracle-worker.mjs',
    workerId: 'your-installed-worker',
  },
  recoveryFactory: {
    factoryUrl: 'file:///absolute/schemaforge/apps/worker/expiry-recovery-factory.mjs',
    workerId: 'installed-expiry-recovery',
  },
});
```

The private installation must belong to the current OS user, with directory mode 0700,
file mode 0600 and no symlink path components. Start it with:

```sh
npm run worker:service -- /absolute/private/service.mjs
```

The CLI accepts one reviewed `.mjs` installation file, uses fixed diagnostics, and handles
SIGTERM/SIGINT by stopping new scheduling and draining active work. Installation modules
are privileged executable code. File permissions and process separation provide no OS
sandbox or deployment attestation. The Oracle factory still needs separately authorized
private credentials, purpose authorization and truthful target binding; this service
does not provide them or authorize an Oracle connection.

The service reserves one physical PostgreSQL session and takes a nonblocking advisory
leader lock. A second service for that metadata database cannot start while ownership
remains held. It requires the current metadata generation to be ACTIVE and passes that
exact generation through the fixed child environment. A child must expose the matching
`expectedMetadataGenerationId` before its operation runs. Initial admission and all
durable attempt writes recheck the bound generation; write transactions hold shared locks
on the generation and its pointer until commit. RESTORE_HOLD and replaced generations
cannot become execution authority through an old service or child.

Each cycle first recovers up to 50 expired CLAIMED attempts into the existing uncertainty
HOLD. Any remaining admitted job of the installed scope pauses new dispatch. Otherwise,
the service selects up to 50 waiting PRODUCT_REQUEST jobs in `(created_at,id)` order and
executes one supervised child at a time. Keyset cursors retain PostgreSQL timestamp
precision; reaching the end wraps the next poll. Declined requests retain their facts and
are reconsidered on later passes without starving newer requests. Installation may lower
`pageSize` to 1–50 and set `pollMs` to 250–60000 (default 5000); these settings do not grant
authority. Queue indexes are added by normal metadata initialization, preserving rows and
history. Restore older witnessed backups with their matching source bundle first, then
upgrade the retained instance; cross-schema restore remains rejected and upgrade never
clears RESTORE_HOLD.

A clean child result must match its installed scope and committed job projection.
Connection loss, loss of leader ownership, generation replacement, uncertain transport,
cleanup or projection retire this service and its supervisors. Detected authority loss
requests termination of an active child, escalating to SIGKILL and awaiting actual exit.
Retirement never starts a replacement child. It does not reconnect, infer effects, overwrite
terminal facts or resume dispatch. Shutdown keeps metadata ownership until the active
child actually exits, including after an operation deadline reports unconfirmed
termination. Forced parent death or loss of its metadata connection can release the
session lock while a child remains alive: deployment must supply separate process/session
containment before claiming safe unattended recovery. Existing target mutex and durable
attempt guards remain required; the service adds no automatic replay, lease renewal,
replacement attempt or HOLD release.

`tests/product-execution-service.test.mjs` exercises actual PostgreSQL, Git, pinned parser,
approval, requests, separate worker children and retained history with explicit UNIT target
ports. It covers V1→V2→NOOP, recovery before dispatch, live-claim pause, bounded FIFO fairness,
generation races, active leader-connection loss before a second statement, private CLI
startup/SIGTERM/restart and leadership retention until an
unconfirmed child is reaped. This is local orchestration acceptance; Oracle target effects,
installed writer credentials and deployed isolation/recovery remain unverified.

`createPrivateOracleProvider` in `apps/worker/oracle-provider.mjs` supplies the
restricted host's installed connection lifecycle. Privileged child installation code
must supply its purpose authority, a fixed private route resolver, and independent
target attestation capabilities. Request data cannot select routes or install these
capabilities. This module does not supply credentials, a deployed factory, target
attestations or Oracle runtime acceptance.

The provider authorizes one exact immutable request and write-purpose permit before
resolving routes or opening dedicated writer and distinct ledger-owner sessions. It
uses the pinned Thin driver, installs a bounded call timeout before session use, and
rejects pooled routes. Each provider instance serves one child operation. Reuse,
overlap, an owned operation failure, a callback returning with operations still pending,
or cleanup uncertainty retires it and fails closed. Owned driver and target capability
operations drain before both sessions close; it never reconnects or retries SQL.
The permit must remain live after private route resolution, each session acquisition
and target binding, before callback entry and each owned operation, and after operation
settlement and cleanup. Expiry retires the provider, prevents further work and withholds
success. A call already in flight drains before its acquired handles close once;
expiry does not cancel it or establish whether its SQL effects occurred.
The explicit UNIT connection port cannot satisfy a trusted installation. The fifteen
provider tests verify synthetic lifecycle behavior; production authority, physical
identity, TLS, grants, protected object integrity and adoption remain separate gates.
