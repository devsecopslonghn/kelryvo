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
master with `git rev-parse origin/master`. PR #3 is merged at
`87d41da43886306a3a996aa458ced27130de130f` after all nine gates passed; final Sonar scan
has zero new issues, hotspots and duplication. No implementation PR remains open in
this snapshot; inspect any checkpoint PR before new work. The checkpoint's own merge SHA is derived from
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

PR #4 merged at `01ff4446e0318d4b7f91a003cf15799ab3b7be11`. This increment implements
`createReadOnlyThinProbe(ports)(request)` as a read-only Thin candidate. PR #5 merged at
`de86263e8a8c5faae8af8b18197fe03a7cbf138e` after all nine exact-head gates passed;
reviewed head is `fe63aebcc911c1b0de89659be253ea0f186ae277`. SonarCloud has zero new
issues, hotspots and duplication, CodeQL has no new alerts, and both old finding threads
automatically resolved. Resolve this checkpoint's own PR/head/merge from Git/GitHub.
It has 21 focused UNIT tests and 93 full tests passing, with
independent QA/security approval. Evidence is under
`evidence/db-devops-wp0/t04-thin-readonly-20261008T143528Z-0b734360/`.

The graph still has no fully unblocked task. Queue emptiness alone does not prevent safe
offline work inside T04; this candidate is substantive progress, with T04 still BLOCKED.
There is no CLI, authenticated authority/atomic claim backend or supervised live worker.
Before connecting, require explicit attested disposable 19c/21c lab authority, approved
PEM client wallet/CA material, scoped versioned refs, independent target/container identity
and session observations, and supervised provider/call/cleanup timeout handling. The module
implements a fixed read only; fault/DDL/rotation probes are absent. Session identity matches
do not pass the Oracle cases or establish T05 canonical identity.

Database's next bounded assignment is completing supervised runtime wiring and remaining
T04 probes with supplied authority inputs; QA/Security independently review. Reassess other
safe offline work before declaring an impasse. Keep T04 and all 124 Oracle cells BLOCKED
until real acceptance evidence passes. Do not resolve credentials or connect now.
Resolve pending owner license/name and F31 packaging decisions before distribution.
If inputs are still absent, report that precise boundary and preserve this checkpoint;
do not mark a blocked task VERIFIED or advance API/UI around WP0 dependencies.
