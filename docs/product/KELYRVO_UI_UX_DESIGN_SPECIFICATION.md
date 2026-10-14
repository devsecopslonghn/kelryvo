# Kelryvo UI conventions

[Product requirements, capability status and roadmap](KELYRVO_PRODUCT_REQUIREMENTS.md) is authoritative. This document specifies shared interaction and accessibility requirements, not another feature backlog. Current implementation lives in `apps/web/src/` and `apps/web/styles.css`; the historical Stitch handoff records visual provenance, not interactive acceptance.

## Product surfaces

| Surface | Scope and purpose |
| --- | --- |
| Projects, Account and access | Current project grants, environments/source configuration, archive/read-only state, own credentials/sessions. Operator provisioning stays out of ordinary project authority. |
| Database instances & connections, assigned schemas and targets | Scoped deployment profiles/discovery connections, revisions/lifecycle/preflight, observations, explicit assignment/binding/environment. Manual facts remain provisional; offline readiness is distinct from live verification. |
| Releases and SQL Workspace | Retained Git/authored SQL, drafts/revisions, comparisons, parser/scope/risk findings and immutable release preparation. No arbitrary query execution. |
| Plans, review inbox and statement evidence | Exact retained source and target intent, currentness, independent reviewer routing/comments/decisions and withdrawal. |
| Request readiness, history and reconciliation | Actual durable request/attempt/receipt/evidence state. Requests, synthetic effects and verified Oracle effects must remain distinguishable. |
| Audit and migration history | Scoped filters, stable paging, retained-source/statement links and checksummed record downloads; historical event facts are separate from current status. |

## Shared interaction requirements

- Keep project, environment, selected object and evidence scope legible. Preserve safe selected IDs in URLs for refresh/deep links; never put SQL, secrets, bearer tokens or private credential references in URL/browser storage.
- Every async read must reject responses for an obsolete session, project or object selection. Clear protected content on logout/revocation. A late old-session failure must not log out a new session.
- Use explicit loading, empty, denied, stale/conflict, unavailable and retryable-failure states. A timeout is not evidence that a mutation failed; reuse the retained idempotency key and inspect current state.
- Preserve unsaved SQL/review context across ordinary tabs. Save or explicit discard protects replacement/project changes; failed saves preserve editor contents. Job status refresh must not reset review drafts.
- Destructive lifecycle actions need a reason and confirmation where the existing contract requires it. Show retained history and optimistic revision conflicts; never silently overwrite newer configuration.
- Show saved target facts and current configuration separately. CURRENT + PROVISIONAL means offline-review eligible only. Preflight/configuration success, FIXTURE, OBSERVED, accepted identity and executable admission are distinct states.
- Use truthful action labels such as Request deployment. WAITING_VALIDATION and NOT_EXECUTED are not success. HOLD/RESTORE_HOLD shows the actual reason and operator boundary; no automatic retry, replay or clear-HOLD convenience action.
- Render SQL, IDs, comments, reasons and external labels as literal text. A checksum proves record consistency, not signed authenticity or a database effect.

## Visual and responsive conventions

Reuse the current light interface, semantic CSS properties, restrained blue primary actions, neutral surfaces/borders and monospace SQL/identifiers. Keep status labels in addition to color, readable SQL/diffs and visible provenance. Reuse established components rather than introducing a second design system.

The older design proposed dark mode and alternative tokens; neither is a delivered-product claim. Any appearance change must use actual bundled fonts and pass contrast/interaction checks rather than relying on static mockups.

- Keep forms and detail panels usable on narrow screens and at 200% zoom. Tables may scroll inside a labeled region; core actions, target identity and HOLD warnings remain visible.
- Provide semantic headings, labels, tables and buttons, keyboard access, visible focus and dialog focus return.
- Announce asynchronous results with appropriate status/alert semantics without moving focus; offer explicit refresh and timestamps for stale values.
- Never rely only on color, hover or motion. Respect reduced-motion preference and keep evidence panes keyboard scrollable/copyable.
- Validate changed UI with the real API/PostgreSQL/parser browser suite, including delayed responses, denied access and persistence. Do not infer responsive, contrast or Oracle acceptance from screenshots.
