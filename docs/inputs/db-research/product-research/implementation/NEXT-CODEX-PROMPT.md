# Next Codex execution prompt — implement WP0 only

Copy the instructions below into a new implementation session. This file is a prompt artifact; creating it does not implement or run the harness in the current planning task.

---

Implement **WP0 Oracle feasibility harness only**, using the completed DB DevOps research and readiness plan in `/home/longhn0710/workspace/DB-Research`, branch `research/independent-db-devops-20261008`. Inspect actual instructions/branch/current changes first; preserve all existing unrelated work. Do not restart the 220-feature survey or regenerate/reclassify the original catalog.

Read these inputs in this order:

1. `product-research/implementation/IMPLEMENTATION-READINESS.md` and `READINESS-REVIEW.md`.
2. `ARCHITECTURE-DECISIONS.md`, `DATA-CONTRACTS.md` and the WS boundaries in `MVP-REFINEMENT.md`.
3. `IMPLEMENTATION-BACKLOG.md`, specifically **WP0-T01 through WP0-T12**.
4. `WP0-TEST-PLAN.md`, `WP0-ACCEPTANCE-MATRIX.md` and `implementation-plan.json`.
5. Relevant original runtime/resource/technology/license/evidence references cited by those files; existing historical Oracle workload/criteria fixtures are read-only regression inputs, not new results.

**First exact task: WP0-T01 — Preflight isolated harness workspace and lab input manifest.** State a short completion checklist, then implement the bounded harness work without creating a production platform. Work only under `experiments/db-devops-wp0/` and new append-only `evidence/db-devops-wp0/<UTC-run-id>/` directories unless a relevant repository instruction requires a reversible verification-tool update. Do not modify current `poc/`, demos, candidate source snapshots, old evidence or the original product catalog/roadmap. Do not push, merge, publish or change existing external infrastructure.

Before Oracle calls, obtain the supplied authorized disposable-lab configuration: real 19c and 21c profiles, TCPS trust/expected PDB identity, allowlisted application schema generations/prefixes, discovery/owner/observer/bootstrap credential references, alias routes, narrow DBMS_LOCK bootstrap grants, fixture fault/session-stop/cleanup authority, PostgreSQL fixture store and required local/offline artifacts. Record a secret-free preflight report. Do not infer disposable authorization from old POC credentials, a “dev” hostname, ALL_USERS visibility or a local configuration file whose scope is unclear. If existing session instructions explicitly supply authorized disposable targets, proceed within that scope without asking for redundant confirmation. Ask only for required missing inputs and keep independent offline work moving.

If labs/grants/fault capabilities are unavailable, implement and run useful independent pure unit/static/license/parser work where possible, then **stop dependent runtime execution** and report exact BLOCKED/NOT_RUN cells. Never invent a PASS, target version, observed grant, successful compile or crash-recovery result. A simulated ledger/approval test is SIMULATED/UNIT evidence, even when its expected result looks correct. Old Bytebase/ODC/Archery outcomes do not prove this harness.

Use the assessed TypeScript/Node Thin candidate and mature Apache parser boundary initially, subject to actual dependency review. A parser-only helper is unproved, not a supported Flyway public API. Audit exact driver/parser/JRE/build/Git/PostgreSQL/transitive artifact rights, content hashes/notices and offline closure before selecting dependencies. No Bytebase source/UI code may be copied; no mandatory proprietary JDBC/Instant Client, FSL component, commercial edition or arbitrary product/user/service limit may enter the required path. Oracle target database rights remain separately supplied by the lab owner. If the mature parser cannot be legally isolated or the required transport/lock contract fails, retain the finding and reopen the ADR; **do not build a custom SQL parser, use `split(';')`/regex splitting, or silently switch to a proprietary client**.

The harness may contain narrowly scoped fixture models for immutable releases/plans/approvals, jobs, target receipts and reconciliation; they are experimental test subjects. It must not become WP1 platform domain/API/authentication implementation or a React portal. The control-plane/worker need not share a language; keep an explicit versioned byte/receipt protocol and original independently authored coordinator. Do not claim experimental fixture authentication proves production API security.

Implement the twelve WP0 task outputs and all **63 proposed mandatory test cases**. Required runtime coverage includes:

- Real Thin connectivity/discovery/identity/grants on 19c and 21c, separate owner/discovery/observer credentials and known TCPS trust.
- Mature parsing plus actual execution of table/alter/index/view, procedure/function/package/spec/body/trigger/anonymous block, internal semicolons/quotes/comments/q-quotes/slashes, malformed/encoding/directive rejection and prevalidation of the entire release.
- Genuine prior executions creating A=V001–V003/B=V001, then pending A=V004/V005 and B=V002–V005, exact ordered execution, zero-pending rerun and modified V002 rejection. Do not seed fabricated APPLIED rows to claim migration success.
- Owner/name/type-specific validity and compiler diagnostics, including VALID package specification with INVALID body, wrong principal/invisible errors and independent committed-state postchecks.
- Same-session DDL-persistent target mutex across aliases, central admission/idempotency conflicts, two real contenders, central lease expiry with surviving session and worker crash. A lease is not an Oracle lock TTL. Test RAC only within an authorized required RAC profile; do not claim single-instance aliases prove it.
- Every named failure/commit/receipt/central-update barrier, network response loss, restart and duplicate retry. Preserve execution/commit knowledge/history/verification separately; AMBIGUOUS work remains held without automatic SQL replay.
- Exact Git SHA/raw/execution digest/target route/schema/generation/order/manifest/options/policy/history approval integrity and independent actor eligibility. No caller-supplied actor or target substitution. Exercise revocation barriers before and after the serialized per-statement dispatch-permit checkpoint; later revocation stops new permits but cannot atomically recall the already-permitted Oracle call.
- Local/central/hybrid gap comparison, missing authorization, independently reviewed recovery and logical rewind. Label logical rewind as fault injection; it does not certify actual RMAN/PDB restore.
- Secrets canaries, least privilege, API/worker secret separation, reviewed OSS closure, no internet/SaaS at offline build/runtime and reproducible retained evidence.

Define and implement reproducible harness commands for preflight, pure parser/unit tests, one case/version, full matrix, evidence verification and allowlisted cleanup. Use commands that actually exist after implementation; document their exact versions/configuration. Store only opaque credential references in inputs/results; read secret bytes from authorized private environment/files/providers, never command-line flags or logged DSNs. Use deterministic barriers and independent target/session observations rather than sleep timing as proof of a crash window.

Every result includes case/run ID, source/fixture/build/dependency hashes, exact Oracle version/driver mode/profile, unit and 19c/21c statuses, sanitized observations/call counts/state transitions, evidence-file hashes, FAIL/BLOCKED reason and cleanup status. There are **124 applicable Oracle result cells and 28 unit/static cells**; all named subruns are required. Expected safe HOLD can make a test PASS while the migration remains unresolved—record both separately.

Cleanup is a separate scoped capability: observe/resolve fixture sessions first, preserve evidence, then drop only attested allowlisted disposable resources using authorized bootstrap credentials. Never drop a shared PDB, non-fixture schema or unrelated object. If safe cleanup cannot be proved, leave it BLOCKED and report the exact live session/resource for the authorized owner.

Run relevant existing local documentation checks and the new harness tests. Keep any planning-validator outputs in a new evidence directory rather than overwriting historical reports. Review final diffs and unrelated-file preservation. Do not label WP0 passed until actual applicable runtime evidence exists; required FAIL/BLOCKED/NOT_RUN cells prevent GO.

At **WP0-T12**, report implemented files, real commands, dependency/license findings, per-version case results, failed/blocked/untested conditions, cleanup and the accepted/rejected driver/parser/lock/ledger architecture. Record GO only for the exact observed supported profile when every mandatory gate passes. **Stop after WP0; do not begin WP1, production platform code, React UI, production deployment, push or merge.**
