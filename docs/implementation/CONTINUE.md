# Resume SchemaForge

Read AGENTS.md and CURRENT.md. The owner authorizes dependency-ordered implementation,
verified branches/PRs and ordinary eligible merges. Preserve DB-Research and WP0 gates.

```sh
cd /home/longhn0710/workspace/schemaforge
git status --short
git fetch origin
git log -5 --oneline
gh pr list --repo devsecopslonghn/schemaForge --state open
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
```

PR #1 is merged at `42249826d105d44dbf5d6243f9ebe3748612e1c7`; PR #2 is merged at
`ca232a5a4f4535bb4e6d14954bdba9b5a8ffa9b6` after all nine checks passed. Resolve latest
master with `git rev-parse origin/master`. The checkpoint's own merge SHA is derived from
Git; literal hashes identify the validated preceding master. Inspect remaining PRs' exact
head/base, complete CI, security alerts and reviews before merging or resuming edits.

T03 reproduces with `npm run parser:antlr:build`, `npm run parser:antlr:corpus` and
`npm run parser:antlr:test` once exact external inputs are available. On fresh Linux x64,
`npm run parser:antlr:prepare` explicitly downloads/checks public inputs; then set
`SCHEMAFORGE_JAVA_HOME="$PWD/.cache/antlr/temurin"`. Preparation refuses an existing
extracted JDK destination. Builds never download; the original Flyway corpus retains its
negative result. Never hide or reclassify a required failing CI check.

T04 offline preparation is implemented. `npm run probes:thin:plan` reports missing inputs
(exit 1). Supply a secret-free profile with `-- --profile PATH` to validate local inputs and
prepare twelve fixed descriptors. Exit 0 only means offline planning completed; every
Oracle case remains NOT_RUN/BLOCKED and execution remains unauthorized. The public entry
runs actual preflight; it accepts no report or raw-byte attestation from a caller.

No fully unblocked engineering task remains in the graph until runtime inputs arrive.
Database's next bounded assignment is the actual Thin/TCPS/fault runner after explicit
attested disposable 19c/21c lab authority, scoped refs, trust material and observation
permission exist. QA/Security independently review. Keep T04 and all 124 Oracle cells
BLOCKED until real acceptance evidence passes. Do not resolve credentials or connect now.
Resolve pending owner license/name and F31 packaging decisions before distribution.
If inputs are still absent, report that precise boundary and preserve this checkpoint;
do not mark a blocked task VERIFIED or advance API/UI around WP0 dependencies.
