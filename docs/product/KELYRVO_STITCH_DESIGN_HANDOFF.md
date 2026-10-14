# Historical Kelryvo Stitch design handoff

This 2026-10-12 visual-review record is retained for design provenance. Its implementation statuses are historical. Use [Product requirements](KELYRVO_PRODUCT_REQUIREMENTS.md) for current functionality; target binding and offline schema-aware review have since been implemented.

**Repository baseline:** 2026-10-12 product requirements and UI/UX specification<br>
**Stitch project:** `projects/14912123519289853449` (Kelryvo)<br>
**Revised design-system asset:** `assets/12737833176170594836` — Kelryvo Enterprise Developer Platform

## Design system

The revised screens use Inter for interface text and JetBrains Mono for SQL and exact technical identifiers. The visual system is light-first: `#F5F7FA` canvas, white surfaces, neutral borders, restrained blue (`#1F5FBF`), 14px body text and 13px table text. Statuses use semantic color plus labels, including Provisional, Not observed, Not bound, WAITING_VALIDATION and NOT_EXECUTED. Code and SQL diffs use a light surface.

Reusable patterns appear across the screens: project navigation, breadcrumbs, searchable tables, a project-scoped schema drawer, forms, state badges, retained-source summaries, SQL review, independent-approval evidence and request/audit timelines.

All people, project records, IDs, releases and timestamps in the screens are illustrative sample data. They are not observations of a live environment.

## Screen-to-feature mapping

| Workflow | Stitch screen resource | Product mapping and status represented |
|---|---|---|
| Infrastructure inventory | `projects/14912123519289853449/screens/42e1be19ddfd4f9e867f92b61e594d6a` — Infrastructure Inventory (Project Scoped) | UI-04; FR-004, FR-007; AS-02–04, AS-07. Shows only the selected project's manually declared schema assignments. Manual references are provisional; identity is not observed. Read-only in the web app. Inventory mutations remain with the trusted local operator workflow. |
| Project overview | `projects/14912123519289853449/screens/813d0265db0841fcb1c6ea386ce7468f` — Payments Service — Project Overview | UI-03, UI-05; FR-010–012, FR-026. Summarizes project-owned environments, local source binding, assigned schema references, plans and product activity. It contains no live health or database telemetry. |
| Migration plan creation | `projects/14912123519289853449/screens/24d89c1d7b1f434491a85cf0e967871b` — Create Migration Plan — Final Polish | UI-07; FR-012, FR-014, FR-015, FR-017. The current release/profile-based form creates an offline plan. Target binding is shown as a disabled proposal because assignment/binding selection is not implemented in the current plan API. |
| Plan detail and SQL review | `projects/14912123519289853449/screens/db018d478ea0499a8cf4ebd02600cd7b` — Migration Plan Detail and SQL Review (PLAN-208) | UI-05, UI-07; FR-014, FR-016, FR-017, FR-034. Shows retained release facts and parser output. The target owner remains unbound and schema-aware scope is not verified. Parser recognition is not target validation. |
| Independent approval review | `projects/14912123519289853449/screens/0c8f5f7784884c5390034199168f1fb0` — Review Migration Plan (PLAN-208) — Independent Approval | UI-06, UI-07; FR-018; AS-12–13. Shows author/reviewer separation, immutable review evidence and an offline governance decision. Approval does not verify a target or authorize execution. |
| Execution request and history | `projects/14912123519289853449/screens/710a62392d7349908822717e2918386e` — Execution Request and History (PLAN-204) — Compact Viewport | UI-08, UI-09; FR-019–020, FR-022–026. Shows durable request creation and retained history. WAITING_VALIDATION, zero attempts and NOT_EXECUTED remain explicit; no Oracle worker or effect is claimed. |

The six final screen resources were retrieved with Stitch `get_screen` and visually reviewed. The most recent revisions compacted plan creation and request history into one viewport and constrained SQL review to a centered 900px content area.

## Existing artifacts retained

The original screens remain available and were not overwritten:

| Existing screen | Disposition |
|---|---|
| `5fc3bf76bbed40b0a89dcca03a9e6729` — Concept A: Technical Console | Preserve as historical concept only. Dark fleet, monitoring and telemetry assumptions are superseded. |
| `b9ecca0ad6bd4e5babdad6d86b642358` — Concept B: Premium Enterprise Platform | Preserve as historical concept only. Do not reuse invented health, fleet or telemetry content. |
| `bfb04b3927934237ae3d4ffb7a25fb8f` — Concept C: Modern Database Operations Workspace | Preserve as historical concept only. Its dark operational-console model is superseded. |
| `a40609a18eef4122b7e822eb13454fc5` — Infrastructure Inventory: Drawer Closed | Useful table structure, but its workspace-wide inventory, discovery sync and registration actions are outside the current web authority. |
| `e1d46d7dd1c141fd826d0df4fd115bde` — Infrastructure Inventory: Inspector Open | Useful table-plus-drawer layout. Global inventory scope and assignment controls are not accepted for project members. |
| `838b67dc244f475c8db7bf37269fec82` — Infrastructure: Database DevOps & Governance | Preserve as a light visual reference only; its discovery-sync and workspace-inventory actions are not current product capabilities. |

The original dark design-system asset `assets/07f302e1936f41cf9992699880156d1a` remains preserved. A duplicate is also labeled `assets/6265241648303718621` — “Kelryvo Enterprise — Legacy Dark (Preserved).”

## Product boundary and design limitations

- A standalone `FUNCTIONAL_SPECIFICATION.md` is not present in this checkout. The screen mapping follows the reconciled product requirements, UI/UX specification, architecture decisions and implementation status recorded in the repository.
- The requested inventory workflow is intentionally project-scoped. A workspace-wide in-app inventory and mutation console is deferred; schema assignment and transfer remain in the trusted local operator workflow.
- Target-binding selection, observed Oracle identity, schema-aware scope policy and target-aware plan staleness are proposed work, not current functionality. The design marks these fields unavailable or unbound.
- Oracle discovery and execution are unavailable. Requests remain non-executable; WAITING_VALIDATION and NOT_EXECUTED are not success states. The screens make no live Oracle, health, drift or worker claim.
- The examples are static design data, not interactive prototypes or current customer data. Tablet/mobile breakpoints and WCAG contrast were not separately validated in this design pass.
- Stitch's current `list_screens` and `get_project.screenInstances` still return the six original canvas screens, and `get_project` still reports the legacy DARK project theme. The six revised resources above are individually retrievable by their direct screen references and use the new light design-system asset, but Stitch did not attach them to the visible project canvas or promote the light asset to the project-level default. The original screens and theme therefore remain the visible project defaults until Stitch supports that association.
- Visual review was performed for this handoff; product-owner visual acceptance has not occurred.

