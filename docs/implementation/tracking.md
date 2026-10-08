# Product tracking

The tracking records preserve all 220 feature IDs from the immutable research catalog and
all 64 imported tasks plus `SF-P0-FOUNDATION`. Catalog dependencies and acceptance criteria
remain exact. The 95 refined features use their implementation-plan tier as `phase` and retain
the catalog release in `original_phase`. Seven rejected catalog features start as `DEFERRED`
with a source-based reason; other features start as `BACKLOG`.

Feature ownership follows domain charters; work ownership follows package, with named WP0
owners and QA review on WP0-T12. The ownership policies follow `apps/api`, `apps/web`,
`apps/worker`, `packages`, tests, experiments, and shared tracking docs. `ownership.json`
records responsibilities and allowed path patterns.

`acceptance.json` contains feature and work acceptance criteria plus 63 distinct WP0 cases.
Each case has separate unit, Oracle 19c, and Oracle 21c cells. Source `NOT_APPLICABLE` values
are preserved; applicable Oracle cells are `BLOCKED` while lab authorization is absent, and
unit cells start as `NOT_RUN`. A unit cell may become `BLOCKED` for an explicit offline
blocker independent of Oracle authorization. `BLOCKED` and `DEFERRED` work items require a
specific reason.

The tracker is pure Node.js ESM and uses no dependencies. `validateState(s)` accepts the
tracking objects `features`, `tasks`, `acceptance`, `graph`, `ownership`, `evidence`,
`milestone`, and `tests: { cases }`, and returns error strings (empty means valid). The CLI
commands are:

```sh
node scripts/tracker.mjs validate
node scripts/tracker.mjs status
node scripts/tracker.mjs next
node scripts/tracker.mjs graph
node scripts/tracker.mjs graph dot
```

`next` selects READY or BACKLOG work inside `milestone.json`'s allowed packages whose
dependencies are VERIFIED. Initialization limits selection to WP0. Verification requires
every acceptance criterion index and named test reference to have passing evidence. A WP0
task also requires explicit case coverage for each referenced case. WP0-T01 through WP0-T03
may record a task increment with `scope: TASK_INCREMENT`, `full_case_pass: false`, the actual
covered cells, and a description. This can verify that bounded task's own acceptance while
the shared case remains NOT_RUN or BLOCKED. WP0-T04 through WP0-T12 are completion gates and
require `scope: FULL_CASE`, `full_case_pass: true`, all applicable cells PASS, and complete
case evidence. A STATIC case uses `kind: STATIC` for its unit result. Partial task evidence
cannot set a case PASS or verify a product feature. Product feature verification requires
product-scope evidence and every related implementation task to be VERIFIED.

Evidence outcomes `PASS`, `FAIL`, `BLOCKED`, and `NOT_RUN` are retained as history. PASS
requires exit code zero; FAIL and BLOCKED require a nonzero exit code; NOT_RUN uses a null
exit code. Only PASS evidence can support verification or a PASS result cell. The item/case
`evidence` array refers to evidence-index entries by `index_id`. Each index entry mirrors a
JSON record under `evidence/` and includes a hashed raw output:

```json
{
  "id": "run-id-record-id",
  "subject_id": "WP0-T01",
  "kind": "STATIC",
  "scope": "HARNESS",
  "outcome": "BLOCKED",
  "command": "node experiments/db-devops-wp0/preflight.mjs",
  "exit_code": 1,
  "criterion_indexes": [],
  "test_references": [],
  "case_coverage": [
    {
      "case_id": "WP0-10-01",
      "scope": "TASK_INCREMENT",
      "full_case_pass": false,
      "cells": ["unit"],
      "description": "Offline report subrun; shared case remains NOT_RUN."
    }
  ],
  "raw_output": {
    "path": "evidence/run-id/checks.log",
    "sha256": "64 lowercase hexadecimal characters"
  },
  "path": "evidence/run-id/record.json",
  "sha256": "64 lowercase hexadecimal characters"
}
```

The JSON record repeats every field except its own `path` and `sha256`. Both files must resolve
inside the repository `evidence/` directory, with symlink escapes rejected, and their bytes
must match the indexed hashes. Record metadata must match the index exactly. Product feature evidence uses
`scope: PRODUCT`; task/case evidence uses `scope: HARNESS`. Oracle cells remain BLOCKED until
`milestone.json` sets `oracle_lab_authorized` after manifest preflight. Research observations
cannot count as product evidence. `init` refuses to overwrite existing tracking state.

## Development tracks

Development scheduling is independent from acceptance requirements. `milestone.json` selects an
active track: PRODUCT admits bounded runnable application work, while VALIDATION admits WP0
parser/driver/runtime and Oracle acceptance work. `dependency-graph.json` preserves `edges` as
the immutable catalog/task acceptance dependencies and adds `scheduling` for track-specific
selection dependencies. The selector uses scheduling edges only to decide what work can start;
`validateState` continues to require the original item dependencies before any imported feature or
task can become VERIFIED. An implementation milestone may have its own acceptance and evidence,
but cannot set a catalog feature VERIFIED or change any WP0 result cell. Oracle 19c/21c cells
remain BLOCKED until authorized real evidence exists.

`SF-PRODUCT-T01` is the first local-governance vertical slice and references existing project,
Git, migration, governance, and security feature IDs. `SF-PRODUCT-T02` follows it to implement
project archival and reject new work on archived projects, with a partial local criterion linked
to PRJ-001. Both milestone acceptances are tracked under `acceptance.work`; they are not a
substitute for the catalog acceptance contracts for those IDs. Keep selecting the next bounded
PRODUCT increment after T02 from the existing catalog; do not infer an Oracle prerequisite for
independent application behavior.
