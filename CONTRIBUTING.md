# Contributing locally

Use Node 22.23.3, matching `.nvmrc`, npm, and Python 3.11+ for the standard-library TOML
configuration check. Tests try `python3.11`, then `python3`. Foundation tooling has no
third-party packages.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
npm run check:record
```

`build` checks authored JavaScript syntax and text/JSON validity; this repository does not
yet produce a deployable application. `lint` adds graph, tracker and evidence invariants.
`format:check` requires two-space JSON with final LF and excludes immutable research and
evidence. `format` rewrites authored JSON only. JavaScript uses two spaces, ESM imports,
explicit errors and Node built-ins; lint also enforces final LF and no trailing whitespace.
`test` runs Node's built-in test runner. API-specific lint/typecheck/build tooling will be
selected when an accepted API slice exists. Do not count syntax checks as a product build.

`check:record` executes `npm run check` and writes an exclusive timestamped evidence run,
including the command, exit status, full output, log digest and authored-source hashes.
It does not change acceptance statuses; the orchestrator reviews and indexes the run.

Select a bounded task with fulfilled dependencies and record its original feature IDs,
criteria, exclusive paths and test commands. Keep safety-critical contract changes together.
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
certifying all future runtime dependencies. No remote CI run occurred in this local session.

The proposed Apache-2.0 license and public product name await owner decisions. Do not copy
restricted Bytebase code or assets. Consult the imported compliance requirements before
adding a parser, driver, JRE, UI asset or other dependency.
