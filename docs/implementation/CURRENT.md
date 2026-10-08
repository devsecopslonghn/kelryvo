# Current engineering state

Foundation, WP0-T01 offline preflight, WP0-T02 candidate dependency audit and
**WP0-T03 offline parser increment are VERIFIED**. The current milestone remains offline
WP0 feasibility. No Oracle runtime, execution architecture, API/UI or product feature is verified.

PR #1 merged on 2026-10-08 after independent QA/security review and successful exact-head
foundation/CodeQL checks. Its reviewed head is `0e5b2e93dcce33bdae5f57afbc50fb538e6b86fe`;
local and remote master were synchronized at `42249826d105d44dbf5d6243f9ebe3748612e1c7`.
The current engineering branch is `development/wp0-antlr-parser`; PR #2 is open at https://github.com/devsecopslonghn/schemaForge/pull/2.
Its initial foundation/parser/CodeQL checks passed, but SonarCloud failed. The repaired
head must pass fresh exact-head CI/security/review checks before merging. Eligible ordinary merges are authorized;
see [synchronization policy](github-sync.md). Resolve the latest master SHA from Git refs
when resuming; a checkpoint cannot contain its own resulting commit hash.

T03 replaces the failing Flyway profile for offline evaluation with the unchanged licensed
PL/SQL grammars-v4 sources at `7df52be94698550d219d299d04105c6bafadd9c3`, ANTLR 4.13.2 and
reviewed project-authored support callbacks. No custom grammar/splitter or headerless
upstream Java support class is included. Source provenance, exact tool/runtime/notice pins
and prior-source-exposure limits are in [provenance](../dependencies/antlr-provenance.md)
and [lock](../dependencies/antlr-parser-lock.json).

The bounded helper uses parser contexts and hidden comment tokens to derive exact UTF-8
source/execution byte ranges. It rejects SQL*Plus commands (including REM), malformed
input, missing delimiters and uncovered non-whitespace bytes; LF/CRLF and supplementary
Unicode remain literal bytes. The parent enforces source coverage, digests, protocol,
5-second timeout, 256 MiB heap, 1 MiB stack and output limits without logging SQL.
Whole-release prevalidation snapshots every file and checks all hashes before parsing;
a later failure returns an unapproved STOP with no partial execution plan.

**Actual local evidence:** 64 local tests and dependency smoke pass. Independent QA passes
31/31 fixture files across 14 groups/30 variants plus four real-helper integration tests.
Two isolated offline builds, including the explicitly prepared CI JDK, reproduce helper
SHA-256 `a8aa930fd0a17aee5d74a5d65dc91bcc7e166fca99ac6aca4a4d8bc995351f38`.
The helper JAR contains local/generated classes and notices; runtime, generator and JDK
remain separate. Authored source drift stops before compilation; unpinned builds preserve
the installed reviewed artifact. Evidence is append-only under
`evidence/db-devops-wp0/t03-antlr-20261008T130643Z-98b033db/`.
The subsequent quality repair preserves the exact helper digest and adds full download-pin
prevalidation plus safe dependent filesystem ordering. Its append-only record is
`evidence/db-devops-wp0/pr2-quality-20261008T133102Z-1646ac2e/`; remote repair checks remain pending.

Thirteen parser unit cells PASS; opaque PL/SQL atomicity `WP0-03-13` unit remains NOT_RUN.
All **124 applicable Oracle cells remain BLOCKED**. These unit outcomes do not verify
objects, effects, grants, atomicity, locks, recovery or any complete Oracle case. No database
connection, credential resolution, deployment or infrastructure change occurred.
The original Flyway corpus still exits 1 with its 11 historical mismatches; the new ANTLR
command exits 0. Original evidence and the 43 immutable inputs are preserved.

WP0-T04 remains BLOCKED: no explicit disposable 19c/21c lab manifest was found. A real
Thin runner also needs scoped identities/credentials/grants/fault/teardown authority,
approved trust material and peer-verification behavior. CA digest/identity labels alone
are insufficient. Missing authority never becomes permission from a hostname or example.

Product license/name and full F31 distribution closure remain pending. Apache-2.0 is
proposed; final bundled source/notices and Git/metadata artifacts still need closure.
The candidate's Apache grammar/BSD runtime grants permit this reviewed offline boundary,
not general product distribution approval. Work counts: four VERIFIED, one BLOCKED,
60 BACKLOG. Features: 213 BACKLOG, seven DEFERRED, zero VERIFIED.

Next: finish current PR quality gates and merge; assess the bounded offline T04
probe-plan/observation slice without advancing runtime cells. Then continue the existing
graph only when dependencies are VERIFIED. WP0-T05 and every later task require T04;
WP1/API/UI cannot bypass WP0-T12. Supply the lab/trust inputs to unlock actual probes.
See [exact continuation instructions](CONTINUE.md).
