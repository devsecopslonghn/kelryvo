# SchemaForge engineering instructions

SchemaForge is an independent Oracle-first Database DevOps product. Read the user request,
this file, and the bounded task's inputs before editing. Preserve unrelated work.

## Current scope and source of truth

- The owner authorized autonomous dependency-ordered development and eligible PR merges
  into the existing `origin/master` on 2026-10-08. Follow
  `docs/implementation/github-sync.md`; do not bypass required checks or safety gates.
  The owner clarified on 2026-10-08 that runnable PRODUCT delivery proceeds independently
  of Oracle VALIDATION. WP0 remains an execution/compatibility acceptance gate, not a
  development scheduling gate for API/web/governance work. Local PostgreSQL test containers
  and local startup are authorized; deployment and Oracle connections require separate authority.
- `docs/inputs/db-research/` is an immutable design snapshot, not implementation evidence.
  `docs/inputs/provenance.json` identifies exact bytes, source HEAD and uncommitted inputs.
- Product state lives in `docs/implementation/`. Use the tracker CLI and validated dependencies
  to select work in PRODUCT or VALIDATION. Original acceptance dependencies stay exact;
  graph.scheduling records development dependencies only. Bounded SF-PRODUCT tasks record
  local delivery evidence without certifying full catalog features or Oracle behavior.
  Follow original feature/WP0 IDs; never renumber them. Select the next missing catalog
  workflow after a milestone and register its bounded product task rather than returning
  to the Oracle lab deadlock.
- Review only relevant contracts and code. Never copy Bytebase code/assets, restricted source,
  or unrelated external POC code. Reuse this repository
  and license-compatible mature OSS capabilities before adding product logic. No custom Oracle grammar, regex splitter, or automatic ambiguous replay.
- Keep modular governance and a separately restricted execution worker. API credentials must
  never include application writer secrets. PostgreSQL stores product metadata. The modular local API/web stack may be
  selected and verified without Oracle acceptance. Reuse the pinned parser for offline
  validation; driver/worker deployment and production execution remain VALIDATION gates.

## Work and evidence

- Implement bounded increments with meaningful positive/negative tests. Run `npm run check`.
- Record actual commands, hashes, outcomes and limitations under append-only evidence runs.
  UNIT/STATIC observations never certify Oracle 19c/21c behavior. Missing evidence stays explicit.
- States: BACKLOG -> READY -> IN_PROGRESS -> IMPLEMENTED -> VERIFIED; also BLOCKED and
  DEFERRED. Verification needs complete acceptance evidence; a stub is not implementation.
- Imported research and candidate license observations do not approve distribution.
  Apache-2.0 is proposed; the product license remains undecided.
- At each session boundary update CURRENT.md, CONTINUE.md, milestone state and evidence index.
  Keep implementation, local product verification and Oracle acceptance separate. The owner
  has no 19c/21c lab: do not repeatedly request one or stop independent PRODUCT delivery.

## Delegation and ownership

- Native subagents are supported in this session; actual tool availability determines later
  sessions. Standalone specialist definitions live in `.codex/agents/*.toml`.
- The orchestrator owns shared contracts, tracking state, integration and final verification.
  Delegation must specify task ID, dependencies, acceptance checks, exclusive paths and authority.
- Delegate substantial independent tasks only. Keep coupled contracts in one context.
  Shared filesystem edits are visible immediately: never assign the same file concurrently.
  Use isolated worktrees when edits would overlap; review every delegated diff before acceptance.
- Specialist instructions are workflow constraints, not access-control guarantees in an
  unrestricted shared harness. Reviewers default to read-only; no external orchestration.
- Never imply indefinite background operation. Persist results before the current session ends.

## Lab boundary

Only an explicit secret-free attested lab manifest can authorize disposable Oracle targets.
Credentials are references, never literals. Do not resolve references during offline preflight.
No Oracle image download, infrastructure modification, DBA bootstrap or cleanup is authorized.
The isolated local PostgreSQL metadata container is allowed for PRODUCT development. Record exact blockers and continue independent offline work.
