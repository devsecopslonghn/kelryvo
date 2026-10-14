# Contributing locally

Use Node 22.23.3, matching `.nvmrc`, npm, and Python 3.11+ for the standard-library TOML
configuration check. Tests try `python3.11`, then `python3`. WP0 pins npm 10.9.9,
TypeScript 6.0.2, node-oracledb 7.0.1 Thin and Postgres.js 3.4.9. See the
[actual dependency register](docs/dependencies/LICENSE-EVIDENCE.md) and
[offline checks](docs/development/offline-build.md).

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
npm run check:record
npm run dependencies:offline
```

Start with [product requirements and the selected roadmap acceptance](docs/product/KELYRVO_PRODUCT_REQUIREMENTS.md). Do not use historical phases or catalog BACKLOG as evidence that a delivered workflow must be rebuilt.

`build` checks authored source, TypeScript API/worker types and bundles the React application. `lint` adds graph, tracker and evidence invariants. `format:check` requires two-space JSON with final LF and excludes immutable research/evidence. JavaScript uses two spaces, ESM imports, explicit errors and Node built-ins. `test` uses Node's built-in runner; database-dependent cases skip offline. Full PostgreSQL/API, Chromium and source-installation gates are documented in [testing](docs/development/testing.md). Syntax/unit passes alone do not establish a usable workflow or Oracle support.

`check:record` executes `npm run check` and writes an exclusive timestamped evidence run,
including the command, exit status, full output, log digest and authored-source hashes.
It does not change acceptance statuses; the orchestrator reviews and indexes the run.

Select a bounded roadmap outcome with fulfilled dependencies and its acceptance criteria. Preserve relevant original feature IDs and acceptance contracts; keep path ownership clear. Keep safety-critical contract changes together.
Add meaningful positive/negative tests where behavior changes; use synthetic inputs only
for offline validation. Do not update imported source snapshots or change research IDs.

Run checks before reporting completion and review the diff. Preserve raw sanitized results
under a new `evidence/<scope>/<UTC-run-id>/` directory. Never rewrite a published run, put
secrets in arguments/files/logs, or claim Oracle success from a unit model. Store only
secret references in lab input; offline preflight never resolves them. Product and test
statuses have distinct meanings; the orchestrator owns acceptance review and updates.
Keep local lab profiles in ignored `lab-profile.local.json` files and mirrored inputs in
the ignored `experiments/db-devops-wp0/offline-inputs/` directory. Do not commit lab material.

`.gitattributes` prevents newline conversion of immutable imported inputs and evidence.
Some original documents have CRLF; preserve those exact bytes. Check authored diffs with
`git diff --cached --check -- . ':(exclude)docs/inputs/db-research/**'` rather than rewriting
the imported snapshot to satisfy whitespace style checks.

CI runs the same offline commands using SHA-pinned checkout/setup-node actions and
read-only repository permissions. Installing CI tooling is distinct from mirroring and
certifying all future runtime dependencies. Remote CI results must be checked separately
from local observations.

Independently authored code/documentation uses the owner-selected PolyForm Shield 1.0.0;
preserve LICENSE and NOTICE. Third-party grants remain separate. Public naming and full
distribution packaging remain pending. Do not copy
restricted Bytebase code or assets. Consult the imported compliance requirements before
adding a parser, driver, JRE, UI asset or other dependency.
