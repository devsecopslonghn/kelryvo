# Resume SchemaForge

Read AGENTS.md and CURRENT.md. The owner authorizes dependency-ordered implementation,
verified branches/PRs and ordinary eligible merges; never bypass checks or WP0 safety gates.
Do not use DB-Research as mutable implementation state.

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

Inspect outstanding PR head/base/required checks/security/reviews before resuming edits or
merging. PR #1 is MERGED at `42249826d105d44dbf5d6243f9ebe3748612e1c7`; derive the latest
master SHA from `git rev-parse origin/master` and remote PR state. Checkpoint hashes name
the validated preceding master; the checkpoint's own commit/merge is resolved from Git.

T03 offline candidate is verified; reproduce with `npm run parser:antlr:build`,
`npm run parser:antlr:corpus` and `npm run parser:antlr:test` once exact external inputs are
available. For a fresh Linux x64 checkout, `npm run parser:antlr:prepare` explicitly downloads
and checks public inputs; then set `SCHEMAFORGE_JAVA_HOME="$PWD/.cache/antlr/temurin"`.
Preparation refuses an existing extracted destination; reuse a verified installation instead
of rerunning downloads. The build never downloads. The old Flyway `parser:corpus` command
still exits 1 with documented negative evidence; never hide a required CI failure.

Next engineering assignment: Database owns bounded offline WP0-T04 probe planning and
sanitized observations; QA/Security independently review. Preserve its BLOCKED status and
all 124 Oracle cells until explicit attested disposable 19c/21c authority, scoped refs,
trust material and runtime observations exist. No connection/credential resolution is
currently authorized. Resolve pending owner product-license and F31 packaging decisions
before distribution. Resume the existing graph, not a new roadmap or API/UI workaround.
