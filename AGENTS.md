# SchemaForge engineering instructions

SchemaForge is an independent Oracle-first Database DevOps product. Read the user request,
this file, and the bounded task's inputs before editing. Preserve unrelated work.

## Current scope and source of truth

- This session covers Phase 0 and offline WP0 only. Do not start WP1, API/portal delivery,
  deployment, remote creation, push, merge, or Oracle connections without a new request.
- `docs/inputs/db-research/` is an immutable design snapshot, not implementation evidence.
  `docs/inputs/provenance.json` identifies exact bytes, source HEAD and uncommitted inputs.
- Product state lives in `docs/implementation/`. Use the tracker CLI and validated dependencies
  to select work. Follow the original feature and WP0 IDs; never renumber them.
- Review only relevant contracts and code. Never copy Bytebase code/assets, restricted source,
  or existing POC code. No custom Oracle grammar, regex splitter, or automatic ambiguous replay.
- Keep modular governance and a separately restricted execution worker. API credentials must
  never include application writer secrets. PostgreSQL is the proposed metadata store;
  parser, driver, and framework selection remain gated by WP0.

## Work and evidence

- Implement bounded increments with meaningful positive/negative tests. Run `npm run check`.
- Record actual commands, hashes, outcomes and limitations under append-only evidence runs.
  UNIT/STATIC observations never certify Oracle 19c/21c behavior. Missing evidence stays explicit.
- States: BACKLOG -> READY -> IN_PROGRESS -> IMPLEMENTED -> VERIFIED; also BLOCKED and
  DEFERRED. Verification needs complete acceptance evidence; a stub is not implementation.
- Imported research and candidate license observations do not approve distribution.
  Apache-2.0 is proposed; the product license remains undecided.
- At each session boundary update CURRENT.md, milestone state, blockers and evidence index.

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
No image download, infrastructure modification, DBA bootstrap or cleanup is authorized by
this task. Record exact blockers and continue independent offline work.
