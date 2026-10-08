# Implementation readiness and execution planning

8 October 2026. Continuation of the completed product research on `research/independent-db-devops-20261008`. **Planning only; no WP0 or platform implementation.** All original research files/evidence/catalog IDs remain unchanged.

**Verdict:** CONDITIONAL GO for a subsequent WP0-only session; production is NO-GO. The immediate task is WP0-T01 preflight. Refined assignment: **74 WS / 17 MVP-Core / 4 MVP-Extended**, preserving all 95 original MVP IDs. The backlog has **64 planned tasks**, including 12 WP0 tasks. WP0 has **63 proposed cases**, all applicable runtime/unit/static results NOT_RUN.

| Deliverable | Purpose |
|---|---|
| [Final readiness decision](IMPLEMENTATION-READINESS.md) | Scope, verdict, gates, dependencies, effort and exact next action |
| [Critical readiness review](READINESS-REVIEW.md) | Major area status, fourteen contradictions/clarifications and shared implementation groups |
| [MVP refinement](MVP-REFINEMENT.md) | Sixteen WS outcomes; every original MVP ID mapped to stage, owner/module/task/dependencies/acceptance/tests |
| [Architecture decisions](ARCHITECTURE-DECISIONS.md) | Component challenges, three execution alternatives and six implementation ADRs |
| [Data contracts](DATA-CONTRACTS.md) | Stable target/migration identities, entity/constraint/ownership/audit contracts, ERD, state machines and reconciliation |
| [WP0 test plan](WP0-TEST-PLAN.md) | All case objectives/preconditions/fixtures/steps/results/evidence/criteria/cleanup/risks |
| [WP0 acceptance matrix](WP0-ACCEPTANCE-MATRIX.md) | G0–G9, ten areas, 124 Oracle and 28 unit/static cells; no invented PASS |
| [Implementation backlog](IMPLEMENTATION-BACKLOG.md) | Package crosswalk, sequenced task DAG, parallel opportunities, estimates and task Definitions of Done |
| [Next Codex prompt](NEXT-CODEX-PROMPT.md) | Ready-to-use WP0-only implementation instructions with lab/license/evidence boundaries |
| [Machine plan](implementation-plan.json) | Original input hashes, 95 refinements, 63 tests, 64 tasks, package effort, verdict and additional primary reference |
| [Validation results](readiness-validation.json) | Documentation/graph/count/arithmetic/preservation checks; no runtime acceptance |
| [Research validation](research-readiness-checks.json) | Original catalog/schema/source/link checks, saved here without replacing historical evidence |
| [Historical artifact checks](historical-readiness-checks.json) | Verification of retained earlier research; historical runtime fields are not new executions |
| [Planning validator](validate_implementation.py) | Reproducible standard-library checks for this planning overlay |

Machine plan schema version 1.0.0: `features` preserve original IDs/purpose/dependencies/acceptance and add tier/module/owner/primary task/AC-ID/regression cases/status; `wp0_tests` hold the ten required test fields plus mode/mandatory/result cells/task ownership; `tasks` hold stable ID/package/tier/title/dependencies/feature IDs/steps/deliverables/acceptance/tests/relative estimate/DoD/status; `packages` hold owner and nonadditive stage effort. `original_research_hashes` covers the complete original 28-file input set. `additional_primary_references` records the JCS contract reference without updating old evidence. Implementation status remains PLANNED_NOT_IMPLEMENTED/DESIGN_PROPOSAL and runtime remains NOT_TESTED/NOT_RUN.

Run from repository root:

```bash
python3 product-research/implementation/validate_implementation.py
python3 product-research/evidence/validate_research.py
python3 tools/verify_research_documents.py
```

Use a temporary isolated jsonschema environment for the original catalog's optional full-schema check, as documented in the original research. Save new verification results in this directory or a new run evidence directory; do not overwrite original reports. Existing source hashes/metadata can be checked offline; this task does not repeat the product survey or claim new upstream runtime verification.
