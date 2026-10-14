# Retained implementation and acceptance tracker

[Product requirements, state and roadmap](../product/KELYRVO_PRODUCT_REQUIREMENTS.md) is the single source for current product delivery and next work. The tracker preserves essential original traceability and acceptance safeguards; it is not a second product roadmap.

## What the records mean

- `features.json` preserves all 220 original catalog IDs, descriptions, acceptance criteria and dependencies. BACKLOG means the full original contract has not been verified, even when bounded product facets work. Seven rejected catalog items remain DEFERRED. Do not treat old phase labels as development order.
- `backlog.json`, `acceptance.json`, `dependency-graph.json` and `ownership.json` retain 64 imported tasks, foundation and 44 bounded PRODUCT task contracts. A task's VERIFIED status applies only to its own evidenced criteria. Later product delivery is assessed in the product document; do not manufacture new task copies for already completed workflows.
- `acceptance.json` also preserves 63 distinct WP0 cases with independent unit, Oracle 19c and Oracle 21c cells. No unit/fixture pass may certify an Oracle cell. Original NOT_APPLICABLE values and dependency gates stay intact.
- `evidence-index.json` and all raw `evidence/` records remain retained acceptance history. Indexed paths/digests are immutable. Add new evidence rather than editing a published run.
- `feature-coverage.json` is the dated 2026-10-11 catalog assessment, not current capability counts; `final-review.json` is the dated WP0 review. They remain historical references, not maintained parallel progress reports. `MVP.md` records the 2026-10-12 deployed snapshot only.
- `milestone.json` retains PRODUCT/VALIDATION selection policy and points to the current product priority. Stale session checkpoints were removed; Git history and indexed evidence preserve their historical basis.

## Commands and gates

```sh
npm run status
npm run next
node scripts/tracker.mjs validate
node scripts/tracker.mjs graph
```

`status` reports original contract acceptance, not a delivered-feature percentage. `next` selects READY/BACKLOG tasks within the active track whose scheduling dependencies are VERIFIED. When no historical task is selectable, it reports the product roadmap priority and its evidence gate; it does not invent an eligible task or silently authorize Oracle access.

PRODUCT and VALIDATION scheduling remain separate. Original acceptance dependencies still govern verification; scheduling overrides cannot waive them. BLOCKED/DEFERRED items need explicit reasons. Full catalog VERIFIED requires its complete original criteria, dependencies and real PRODUCT evidence; narrower milestone acceptance cannot substitute for it.

The pure Node ESM tracker validates imported IDs/contracts, graph, ownership, evidence hashes/statuses and result cells. `validateState` accepts the existing `features`, `tasks`, `acceptance`, `graph`, `ownership`, `evidence`, `milestone` and `tests: { cases }` objects. `init` refuses to overwrite existing records. Keep the validator and immutable source contracts intact when updating actual acceptance.

For new work, define the bounded acceptance in the selected product milestone and reuse established source/tests. Add original feature IDs when relevant, but do not keep another session plan, status matrix or per-phase continuation document. Follow [testing](../development/testing.md) and [GitHub integration gates](github-sync.md).
