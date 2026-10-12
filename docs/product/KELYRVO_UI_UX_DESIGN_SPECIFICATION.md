# Kelryvo UI/UX Design Specification

**Status:** Final written design baseline, 2026-10-12. **Scope:** Existing private governance MVP and the proposed target-binding MVP screens. No application code or visual assets were changed. No Google Stitch mockup was found or reviewed; this is not a claim of visual acceptance.

## Design intent

Kelryvo should feel like a calm enterprise developer platform for reviewing database change work. It should help a developer understand what is configured, what is waiting for review, what is blocked, and what evidence is retained. It should not look or behave like a live Oracle monitoring console.

Use a light-first layout with a compact dark navigation rail, generous white content surfaces, quiet borders, and blue for primary actions. Use typography, labels, and status text before decoration. Keep exact SQL, Oracle identifiers, checksums, and actor IDs monospace and unlocalized. Current UI colors and structure are a useful starting point; the tokens below are the target system. Any Stitch mockup supplied later is a visual reference only; it does not define product behavior, security, or API scope.

## Product navigation and scope

### Initial product navigation

Use one persistent workspace shell with a selected project context. Keep the current single-page application behavior and selected-project flow.

1. **Projects** — project list and project settings.
2. **Database instances** — selected project's reference-only connection profiles and assigned instance context.
3. **Schema references** — only schemas currently assigned to the selected project.
4. **Releases** — source binding, release intake, retained release inspection, and comparison.
5. **Plans & review** — project plan list, plan detail, comments, decisions, and request status.
6. **Review inbox** — cross-project rows limited to the actor's current project grants.
7. **Audit & history** — project-scoped retained events, offline history, and record downloads.
8. **Account & access** — own project/deployment grants and browser sessions.

The shell always shows the product name, selected workspace, selected project where relevant, actor role, refresh, and sign out. Project switching clears project-scoped drafts, comparisons, and loaded records before data for the new project appears.

Do not add an overview dashboard that aggregates deployments, Oracle health, or cross-project counts until those facts and a scoped summary API exist. Do not add a global workspace inventory link to ordinary project navigation.

### Proposed target-binding screens

- Add a **Project targets** view within the selected project's context, initially adjacent to Schema references. It lists only currently assigned schemas for that project and shows each binding's environment, revision, route alias, target identity state, and whether a new plan can use it.
- The workspace-wide inventory remains an operator-managed CLI concern in the initial design. A global inventory UI is deferred until the trusted local OS operator can be represented safely in the web identity boundary. No normal project user receives a cross-project inventory view.
- Keep **Operations** within the selected plan's request/history panel. A separate Oracle operations console is deferred; worker count, locks, database health, and target metrics are not available facts today.
- Show restore and metadata recovery through a persistent shell banner and the affected record detail. The browser cannot clear a restore hold or release an Oracle HOLD.

## Page frame and shared interaction model

### Desktop shell

- At wide desktop (1280 px and above), use a 232–248 px left navigation rail and a flexible main area.
- The main area has a 56–64 px top bar, a page heading, an optional page-level action row, then content panels. Keep primary actions beside the heading or at the end of the form they affect.
- Keep the content width around 1280 px. Use two columns only when panels have independent content; stack them when comparison or reading order is important.
- Use breadcrumbs for project and plan detail context, not for every nested panel.

### Shared components

| Component | Behavior |
|---|---|
| Workspace shell | Persistent navigation, role, project context, refresh, sign out, global bootstrap/restore banners. The current SPA can keep its existing navigation state model. |
| Project selector | Shows only currently granted projects. Archived projects are labeled and read-only. Switching projects resets project-specific filters/drafts. |
| Page heading | One H1, short plain-language purpose, optional primary action, and a compact context/status label. |
| Data table/list | Named columns, stable ID available in a detail panel, sort/filter only when backed by the API, pagination for large history, and explicit empty state. |
| Status badge | Text plus optional icon; never color alone. Distinguish `PROVISIONAL`, `UNVERIFIED`, `STALE`, `BLOCKED`, `WAITING_VALIDATION`, `NOT_EXECUTED`, `NOT_OBSERVED`, and `HOLD`. |
| Target summary | Project environment, exact schema owner, safe route alias, assignment revision, binding revision, identity observation state/time, and policy status. Hide raw credential references from ordinary project views. |
| Source evidence viewer | Retained file/path, commit, manifest/file/statement digests, parser profile/result, byte ranges, and source text. Label it offline; no “executed” affordance. |
| Confirmation form | Require a reason for archive, profile retirement, approval withdrawal, assignment transfer, and any future operator action. Show the immutable consequence before submit. |
| Record download | Show record kind, scope, checksum, and a clear statement that the checksum is not a signature and does not prove Oracle effects. |
| Inline feedback | Use `role=status` for loading/success and `role=alert` for blocking errors. Preserve current input only when its scope and authorization are still valid. |

### Common page states

| State | Required presentation and action |
|---|---|
| Loading | Keep the page title and selected context visible. Use a small skeleton for stable rows or a concise “Loading…” line. Set the affected region `aria-busy`; do not blank the entire shell. |
| Empty | State exactly what is absent: no projects, no assignment, no release, no plans, no audit events, or no requests. Show only an action the current role can take. Do not represent an unobserved database as an empty database. |
| Error | Keep the last authorized context, identify which request failed, provide a safe retry, and retain a non-sensitive request/reference ID when available. Never replace an unknown count with zero. |
| Stale | Show which revision changed and when it was last read. Disable approve/request actions and offer refresh or “Prepare a new plan.” Never retarget a saved plan in place. |
| Blocked | Name the unmet prerequisite and whether it is an operator action, missing configuration, unavailable source, unverified parser result, or an external acceptance gate. Do not show a submit button that cannot succeed. |
| HOLD | Use a persistent high-severity callout with the reason, request/attempt IDs, last retained event, and review-evidence action. No Retry, Resume, Clear, or Dismiss action is available. |
| Restore hold | Persistent shell banner says metadata is readable but new mutation/request and cancellation are disabled pending external operator recovery. No browser clear action. |
| Archived project | Read-only label and explanation. Keep retained records navigable; disable new source, environment, profile, plan, review, and request mutations as defined by the API. |
| Access revoked/expired | Clear project data and drafts, return to sign-in or the authorized project list, and avoid revealing whether a foreign resource still exists. |

## Screen specifications

The **Current** column describes the repository baseline. “Proposed” behavior is a written target requirement, not a claim that the route, endpoint, or UI is implemented.

### UI-01 — Sign in and browser session

**Current:** Local-token sign-in; HTTPS sessions use a Secure/HttpOnly cookie with CSRF and expiry. Tokens are held in browser memory in HTTP development.

**Layout:** Centered sign-in card with product mark, one-line value statement, password-masked token field, Continue button, and session-handling explanation. Keep any decorative illustration low contrast and non-interactive.

**Inputs/outputs:** Local access token → current human actor and authorized project list. Do not persist bearer/session secrets in local storage, URLs, or error messages.

**Permissions/states:** Invalid token is a generic authentication error. Loading disables duplicate submission. Network failure keeps the token field available. Bootstrap-required access shows a read-only notice after sign-in.

**Acceptance:** Keyboard can submit; focus lands on the token field; errors are announced; signing out clears protected page state; secure-session expiration returns to sign-in without retaining drafts.

### UI-02 — Workspace shell and project navigation

**Current:** Left sidebar with eight pages, workspace crumb, actor role, refresh, and sign out. Bootstrap and metadata restore-hold banners are global.

**Layout:** Persistent desktop rail; top bar with page title and selected project; mobile navigation drawer. Use one active nav treatment and a visible keyboard focus ring.

**Inputs/outputs:** Navigation selection, project selection, refresh, sign out. The shell consumes current actor, project list, recovery state, and per-page loading state.

**Permissions/states:** Navigation visibility never substitutes for API authorization. If access is revoked while a screen is open, clear its content and return to an authorized scope. A `RESTORE_HOLD` banner remains visible across pages.

**Acceptance:** Project changes clear drafts, source comparisons, plan selections, and request events before loading the new project. Refresh does not reset a reviewer draft that still belongs to the same current plan.

### UI-03 — Projects and project settings

**Current:** Project list and selected project context; create/archive; project environments and reference-only profiles; source binding is also available from Release intake.

**Layout:** Project list on the left and selected-project overview on the right at desktop; stacked sections on mobile. Project overview shows description, archive status, environment list, legacy profile list, source binding summary, and safe next steps.

**Inputs/outputs:** Create project name/description; add environment name; create profile fields as a reference-only compatibility setup; archive reason. Profile secrets are references only. After saving, ordinary project views show a safe credential alias rather than the raw reference string; they cannot resolve it.

**Permissions/states:** Only current project grant can read. Developer can make the existing allowed project changes; archived projects are read-only. Bootstrap mode explains operator grant steps and prevents writes. Duplicate/conflicting names show a field-level error.

**API/data:** Current project list/detail and project create/archive/environment/profile operations. Preserve existing IDs and profile history. Do not infer target binding from profile host/service.

**Acceptance:** Archive asks for a reason and preserves all records. Environment and profile creation never runs a connectivity check. Raw credential-reference values do not appear in ordinary project output when the M1 visibility change is implemented.

### UI-04 — Database instances and project target references

**Current:** `Database instances` shows project profiles marked `CONFIGURED · UNVERIFIED`; `Schema references` shows manual assignments grouped by declared environment and service.

**Proposed target layout:** Start with a compact profile compatibility panel, then a project-assigned schema table. Each row shows exact owner, database/container label, safe service alias, explicitly bound project environment or “Environment not mapped,” assignment revision, target-binding revision, identity state, and last observation time when one exists. A legacy container environment label is shown separately and marked “reference only.” Selecting a row opens a detail drawer with provenance and retained changes.

**Actions:** Refresh the authorized project view. Assignment/transfer/release remains an operator-controlled workflow outside the browser in the initial product. Do not show edit controls that the authenticated actor cannot use. The local operator workflow should preview affected plans/requests before a transfer is committed.

**Permissions/states:** Read only current project's active assignments. No assignment says “No schemas are assigned to this project,” not “The database is empty.” `MANUAL_REFERENCE` is labeled “Provisional · operator declared.” `UNOBSERVED`, `STALE`, `DRIFT`, `CONFLICT`, and `VERIFIED` are distinct. A missing or conflicted identity blocks execution; a provisional target may support only an explicitly offline review plan.

**API/data:** Existing project schema-reference read, plus additive assignment and target-binding fields or project-scoped read endpoints. The page never reads a workspace-wide inventory for a normal project user.

**Acceptance:** Shared PDBs appear as separate schema rows in each authorized project view. Foreign assignment IDs do not reveal a row or metadata. Service route edits and assignment transfer create new revisions and stale affected plans.

### UI-05 — Project source binding and release intake

**Current:** Allowlisted local repository/folder binding, Git branch/tag or commit selection, immutable release import, parser validation, retained source detail, and source-only comparison.

**Layout:** Source binding summary; release intake form; recent retained releases; comparison selector and side-by-side retained file evidence. Keep source metadata before controls: repository, folder, full commit, manifest digest, parser profile, and file count.

**Inputs/outputs:** Select registered local repository, allowed migration folder, branch/tag/commit, then import and validate. The server resolves refs to a full commit. Comparison is read-only and never implies deployment state.

**Permissions/states:** Developer grant required to change binding/import. Archived projects are read-only. No source binding or unavailable repository provides a direct explanation. Integrity failure blocks plan creation and prompts a fresh import; unknown parser results remain blocked.

**API/data:** Existing repository/project source binding and release import/read/compare/preview APIs. Keep exact retained file bytes and parser facts.

**Acceptance:** Re-importing changed source creates a new immutable release. A failed compare does not replace source facts. Parser result, source range, and digest are shown together. No Oracle connection occurs.

### UI-06 — Review inbox

**Current:** Cross-project pending-plan inbox with All, Authored by me, and Eligible for my review scopes; rows show project, requester, creation time, and eligibility.

**Layout:** Page title, scope selector, refresh, newest-first list, and “Load older” pagination. Each row has project and plan context, requester, submitted time, and eligibility label.

**Permissions/states:** The inbox includes only currently granted projects. “Eligible” means role and authorship rules permit review, not that SQL or target is ready. Empty state varies by selected scope. If access changes during load, clear results and request refresh.

**API/data:** Existing review inbox API and subsequent current project/plan detail read.

**Acceptance:** Opening a row rechecks project access and pending status. A removed or decided plan gets a non-disclosing “no longer available” message. Pagination does not duplicate rows.

### UI-07 — Plan list and target-bound plan review

**Current:** Project plan filters, immutable source/intent, reviewer assignment, comments/evidence references, approve/reject, approval withdrawal, readiness explanation, execution requests and records.

**Layout:** Plan list with status filter and author/reviewer/date. Detail uses a fixed reading order: plan status; source/release identity; target summary; assignment and binding revisions; scope/policy findings; comments; approval/decision; execution readiness; requests/history. The target summary appears before approval controls.

**Proposed target inputs:** Choose one current project schema assignment and one current binding revision from server-listed records. The form accepts identifiers/revisions only; it does not allow free-text target owner, service, host, or database identity. Provisional binding can create an offline review plan, visibly marked “Offline only · target unverified.”

**Review actions:** Add comment and retained statement reference; assign an eligible reviewer; approve or reject with reason; withdraw an existing approval with reason where allowed. The author cannot approve. The approval preview displays the immutable envelope and digest before decision.

**Stale/blocked behavior:** If source, assignment, binding, identity, route, scope policy, approval reference, project membership, or profile lifecycle changed, disable decision/request action and explain the changed revision. Preserve the old plan and decision; offer “Prepare a new plan” only when the actor is eligible.

**API/data:** Existing plan/review/comment/revocation/source APIs; target-bound `intentVersion: 2` body and read data are additive. Every request rechecks grant and revision on the server.

**Acceptance:** Reviewer sees the same target facts that approval digest covers. Editing or transferring a target never edits an old plan. An approval of a provisional target remains an offline governance decision and cannot authorize Oracle execution.

### UI-08 — Execution request and retained attempt detail

**Current:** Approved-plan request action, request status, cancellation of eligible undispatched work, bounded refresh, current events, attempt/receipt detail, and older request history. Request feedback can report `WAITING_VALIDATION`; this does not claim a worker is running.

**Layout:** Request summary with ID/revision/state/readiness, reason, requester/time, followed by an event timeline and separate attempts/receipts. Put target identity and approved plan digest in a read-only context panel. Label every synthetic/test scope plainly when present.

**Inputs/outputs:** Actor with separate deploy grant enters a request reason and idempotency context. Cancel is offered only if server state says no dispatch occurred. Refresh does not reset unsent comments or change plan selection.

**Permissions/states:** A restored metadata hold disables request and cancel. A stale plan or target binding blocks request. `HOLD` has no retry, resume, or clear control. Unknown status remains unknown and is not summarized as success.

**API/data:** Current project execution-job list, job detail/events, request and cancel APIs, execution records/history APIs. All data remains project-scoped and authorization is rechecked on read.

**Acceptance:** Request creation records durable intent but does not invoke Oracle. Missing receipt, timeout, or uncertain state is visibly held. Downloads include retained plan/request/attempt/receipt facts and a checksum, with no assertion of target effect.

### UI-09 — Audit and migration history

**Current:** Project audit filter and keyset paging; plan/request history; bounded downloadable plan and execution records. Historical migration states are explicitly not evidence that Oracle applied them.

**Layout:** Audit event timeline with action filter and older-page control; separate migration-history table with version/path, recorded time, and state. Keep project and plan context visible. Future target-bound rows include assignment/binding/stream references and provenance.

**Permissions/states:** Current project grant is required for all reads. Empty history says there is no recorded history; `NOT_OBSERVED` does not mean missing migration. Expired/revoked access clears data. Download failures preserve the current page and explain the retry.

**API/data:** Current audit pages, history, plan record, execution record, and request history reads/downloads. General cross-workspace audit explorer and export policies are deferred.

**Acceptance:** Paging is stable and deduplicated. Each download is scoped, immutable, and accompanied by checksum limitations. No client-generated or synthetic record is labeled Oracle-applied.

### UI-10 — Account and access

**Current:** Own role/actor ID, granted projects and capability summary, bootstrap guidance, active browser sessions, and other-session revocation.

**Layout:** Account summary first, project access list second, browser sessions third. Explain that identity provisioning and project/deploy grants are controlled by the trusted local OS operator.

**Inputs/outputs:** Refresh, page through access/session records, revoke another session. Current session ends through Sign out; there is no self-service role or token management.

**Permissions/states:** Only the current actor sees their own account and sessions. Account lookup failure is isolated and retryable. No project grant shows the operator contact instruction, not an open invitation flow.

**API/data:** Existing account access/session list and revoke endpoints.

**Acceptance:** Session times include the configured local timezone in display and retain machine-readable timestamps. Revocation removes the session from the list after refresh. Secret values never appear.

### UI-11 — Workspace-wide infrastructure inventory (deferred)

**Disposition:** Not in the initial web MVP. The trusted local OS operator keeps the documented inventory CLI. This page is specified for a later phase only after a safe web representation of that same operator authority exists; it must not add an application administrator or grant ordinary users cross-project access.

**Future layout:** Searchable database/CDB/container/service list with provenance and identity state; detail tabs for observations, routes, schemas, assignments, and operator audit. A shared PDB appears once and links to multiple schema assignments. Credentials are represented only by purpose and safe alias.

**Future states/acceptance:** Empty means no references registered, not no Oracle databases. Discovery incomplete is separate from zero visible schemas. Mutations require operator authorization, expected revision, reason, and audit. Never expose resolved secrets or show a manual registration as verified.

**Dependency:** Explicitly approved operator web-authentication boundary and workspace inventory read/write API. No API or role is assumed to exist today.

### UI-12 — Operations and recovery (deferred as a separate screen)

**Disposition:** The current MVP shows requests and attempts in plan detail and surfaces `RESTORE_HOLD` globally. A general cross-project operations console and Oracle recovery UI are out of scope. Do not invent target health, worker metrics, or DBA controls.

**Future layout:** If separately approved, list only authorized job states and oldest unresolved holds. A HOLD detail shows target identity digest, exact attempt/event sequence, ledger/receipt evidence, and the next authorized human role. It contains no automatic retry or one-click clear action.

**Acceptance:** At least two distinct authorized actors review evidence and append a resolution. Until then, the page is read-only and execution stays disabled. Metadata restore and Oracle execution recovery remain separate cases.

## Interaction and content rules

- Prefer “Prepare plan,” “Request deployment,” “Review plan,” and “View retained record” to generic “Run,” “Sync,” or “Deploy” when no Oracle action occurs.
- Show “Offline candidate,” “Provisional,” and “Not observed” at the point of decision, not only in help text.
- A success banner reports the exact product action completed (for example, “Plan created for review”), never a downstream Oracle effect.
- Confirmation copy names the affected project/schema/plan and the irreversible record effect. Ask for a reason where the API retains one.
- Show times in the user's configured local timezone and include an accessible exact timestamp. Show checksums, actor IDs, schema owners, and SQL in monospace.
- Do not use color alone for severity or status. Use icon plus text and, for severe state, an explanatory sentence.
- Keep tables readable at narrow widths with horizontal scrolling or a card transformation. Do not hide schema owner, request state, stale state, or HOLD reason.
- Externalize UI copy for localization. Do not translate SQL, checksums, resource IDs, enum values in exports, or Oracle object identifiers.

## Design tokens

Use semantic CSS custom properties. The current code provides a useful blue/nav/light-surface starting point; these target values improve contrast and define dark mode. Validate final text and control contrast during implementation against WCAG 2.2 AA.

| Token | Light value | Dark value | Use |
|---|---|---|---|
| `--color-canvas` | `#F5F7FA` | `#101720` | Page background |
| `--color-surface` | `#FFFFFF` | `#182331` | Panels, dialogs, forms |
| `--color-surface-raised` | `#F0F3F7` | `#202D3D` | Subsections, hover |
| `--color-text` | `#182534` | `#F2F5F9` | Primary text |
| `--color-text-muted` | `#5F6D7D` | `#AAB7C5` | Supporting text |
| `--color-border` | `#D8E0E9` | `#344456` | Dividers and inputs |
| `--color-primary` | `#1F5FBF` | `#8AB4FF` | Primary action/link |
| `--color-primary-pressed` | `#174B99` | `#B1CCFF` | Pressed/focused action |
| `--color-nav` | `#182536` | `#0D141D` | Navigation rail |
| `--color-nav-text` | `#F4F7FB` | `#F4F7FB` | Navigation labels |
| `--color-success` | `#176B45` | `#6FD39A` | Positive state |
| `--color-warning` | `#805600` | `#F1C56A` | Caution/blocking prerequisite |
| `--color-danger` | `#B42318` | `#FF8C82` | Error/HOLD |
| `--color-focus` | `#0B63CE` | `#9BC2FF` | Visible keyboard focus |
| `--shadow-panel` | `0 8px 24px rgba(29,45,65,.045)` | `0 8px 24px rgba(0,0,0,.24)` | Panel elevation |

Typography uses a sans-serif UI family with the current DM Sans/Manrope treatment where bundled and a system sans fallback. Use 14–16 px body text, 12–13 px secondary labels, 28–36 px page title, and 20–24 px section headings. Use monospace for source and identifiers.

Spacing uses 4, 8, 12, 16, 24, 32, 48, and 64 px. Input/control height is at least 40 px on desktop and 44 px on touch layouts. Use 6–8 px small control radius and 10–12 px panel radius. Keep elevation subtle; use borders and spacing for hierarchy.

Dark mode follows system preference by default and offers an explicit in-app toggle. Store only the appearance preference in browser-local settings; never store credentials or project data there. Ensure status fills, code panes, tables, dialogs, and focus rings have distinct dark-mode values.

## Responsive behavior

| Width | Layout |
|---|---|
| `>= 1280 px` | Full navigation rail; two-column project/summary panels where useful; data tables show all defined columns. Content max width about 1280 px. |
| `768–1279 px` | Narrow or collapsible rail; single main column for detail; forms use two columns only for short independent fields. |
| `<= 767 px` | Navigation becomes a labeled drawer with a persistent menu button; single-column panels and forms; primary action remains visible near the relevant section. |
| `320–430 px` | No page-level horizontal overflow. Tables use a contained horizontal scroller or labeled cards. Buttons have 44 px touch targets; destructive/primary actions stack. |

At every width keep project name, plan state, identity state, and HOLD reason visible. Do not hide warnings behind hover-only tooltips.

## Accessibility and responsive acceptance

- All functions are usable by keyboard; focus order follows visual reading order; dialogs return focus to the invoking control.
- Use semantic headings, labels, buttons, tables, `aria-live`, `role=status`, and `role=alert` consistently. Status text is not conveyed by color or icon alone.
- Preserve visible focus at AA contrast; do not remove outlines without a replacement.
- Support browser zoom to 200% and narrow widths without losing core actions or data.
- Respect `prefers-reduced-motion`. Avoid auto-refresh animation that conveys status only by movement.
- Announce asynchronous refresh/result changes without moving focus. Provide a refresh button and timestamp for values that can become stale.
- Keep SQL/evidence panes scrollable and copyable by keyboard; never use color-only syntax highlighting as the sole distinction.

## Design readiness and limitations

The written specification covers every current top-level application page and the proposed project target-binding view. It also records two explicitly deferred pages: global infrastructure inventory and a cross-project operations/recovery console. Visual tokens and interaction rules are implementation-ready. Six Kelryvo Stitch screen revisions and a light-first design-system asset are recorded in the [Stitch design handoff](KELYRVO_STITCH_DESIGN_HANDOFF.md). The revised screen resources were visually reviewed, but Stitch did not attach them to the visible project canvas or promote the new light asset to the project-level default; see the handoff for direct screen references and remaining limitations. No product-owner visual acceptance is claimed.
