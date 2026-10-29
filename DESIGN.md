# Design System: Kelryvo

## 1. Visual Theme & Atmosphere

A calm, structured database workspace. Prioritize clarity over decoration: balanced
density (5/10), predictable layout (3/10), restrained motion (2/10). Each screen has
one title, a short purpose, one main work area and one primary next action.
Preserve explicit target identity, independent approval and immutable history.
This document guides Stitch concepts; generated screens are design references,
not evidence that a capability exists or has passed acceptance.

## 2. Color Palette & Roles

- **Canvas** (#F6F7FA): quiet page background.
- **Surface** (#FFFFFF): forms and primary work areas.
- **Inset** (#F1F5F9): secondary content and section headers.
- **Ink** (#0F172A): headings and body copy.
- **Secondary ink** (#475569): descriptions; avoid faint essential text.
- **Divider** (#E2E8F0): structure without stacks of outlined cards.
- **Muted indigo** (#405DAD): the single interactive accent, selected navigation,
  primary action and focus indication; no neon or glow.
- Semantic success, caution and error colors communicate actual state only and
  always include a text label. They are not decorative accents.
- Dark mode reuses the existing surface and semantic tokens with readable contrast.

## 3. Typography Rules

Use Geist for design concepts with the application's local sans-serif fallbacks;
use JetBrains Mono with ui-monospace fallbacks for SQL, identifiers and checksums.
Do not add remote font requests. Headings: 24–28px/1.25, weight 600, -0.025em
tracking. Section headings: 16px/1.4, weight 600. Body and form labels: at least
14px/1.5. Supporting metadata: 12–13px; keep full values selectable and accessible.
Limit explanatory prose to 65ch. No serif, oversized slogans or uppercase paragraphs.

## 4. Component Stylings

- Buttons: 6–8px radius, at least 44px touch height. One filled primary action per
  task region; secondary actions use a border or plain text. Disabled controls
  remain legible. Visible keyboard focus and native button semantics.
- Forms: persistent labels above fields, 8px label-to-field spacing, 20px between
  fields. Errors appear beside their relevant form; live status uses accessible
  announcements. Password fields retain native autocomplete.
- Sign-in: local username/password first. Organization methods appear below a
  simple divider as a compact group, only when configured. Setup and recovery are
  secondary. Opening LDAP reveals its own labeled form, preserves local login and
  supports Cancel. No public signup, fake providers or decorative trust metrics.
- Tables/lists: clear header, aligned columns and row dividers. Avoid card-per-row
  layouts. Empty states explain one useful next step.
- Disclosures: technical identifiers, audit detail, revisions and advanced setup
  are expandable. Keep warnings, target selection and current status visible.
- Loading: reserve the final layout's space; no indefinite decorative motion.

## 5. Layout Principles

Desktop uses a 240px sidebar, a 64px page header and a bounded main area up to
1400px. Navigation is grouped into Work, Database, History and Settings. Use one
project switcher and one selected destination. Avoid repeating breadcrumbs and
screen titles inside every nested panel.

SQL Workspace has a narrow saved-draft rail and a wide editor. Put draft name and
explicit target before the editor. Group Save, Review syntax, Validate against
target and Prepare release into a comprehensible toolbar. Saving is secondary to
the next valid workflow step; do not style two competing actions as primary.
Show actual validation evidence below the editor. Preparing a release does not
execute SQL; a plan still needs independent approval and governed execution.

Use a 4/8/12/16/24/32px spacing scale and grid for page composition. Prefer one
surface with section dividers over nested bordered panels. Collapse columns below
768px; navigation becomes a dismissible drawer. Use min-height: 100dvh for sign-in.
No page-level horizontal overflow at 390px; code/table scrolling stays contained.
Long names and hashes wrap without pushing adjacent controls off screen.

## 6. Motion & Interaction

Use 120–180ms ease-out opacity or transform transitions for a drawer and tactile
button feedback. Respect prefers-reduced-motion. Because the owner prioritizes a
quiet, clear interface, omit perpetual pulses, animated decoration and staggered
content entrances. Layout, readable status and keyboard access take precedence.

## 7. Anti-Patterns (Banned)

No emoji navigation, neon gradients, glow shadows, pure-black surfaces, ornamental
charts, stock photography, floating decoration, fabricated metrics or generic
marketing slogans. No equal three-card feature rows, repeated help paragraphs,
multiple competing primary buttons, unlabelled icons or overlapping content.
Never hide a blocking warning or imply execution success from approval or offline
validation. Use fictional project data in Stitch; never upload credentials,
private infrastructure details, SQL from customers or production audit records.

## Stitch References

Private project `2022083557388209049`, design system
`assets/4591b299058246868306aa49c9e64896`:

- Sign-in concept: `b9cf45ae02134a33805aa73b55b98de1`.
- SQL Workspace concept: `caf479539255408f9523e2683bf0b8ed`.
- Schema baselines concept: `c8562142720f4696b0ea51f4173d9fed`.

Use their composition and spacing as references. Generated cluster status,
attestation claims, notifications, node names, validation results and footer
links are fictional and must not be imported as product behavior or evidence.
The implementation uses existing React/CSS; generated source and assets are not
runtime dependencies.

Schema evidence uses separated history, inspection and comparison sections. Keep
owner, database/container names, provenance, coverage and warnings visible; reveal
full identifiers/revisions, collection/capture forms and retained comparison values
on demand. Snapshot times and named baselines lead their rows. The schema concept's
coverage percentages, AST claims, canonical/approval labels, cluster telemetry and
notifications are fictional; the application renders only its existing API fields.
