# Current engineering state

Foundation and the bounded WP0-T01, T02 and T03 offline increments are VERIFIED.
WP0-T04 has working offline probe preparation and remains BLOCKED for runtime acceptance.
The milestone is offline WP0 feasibility; no Oracle execution, API/UI or product feature is verified.

PR #1 merged at `42249826d105d44dbf5d6243f9ebe3748612e1c7`. PR #2 merged after
independent QA/security review, empty code/secret/dependency alerts and all nine exact-head
checks passed, including SonarCloud and CodeQL. Its reviewed head was
`97432efde71ed16ad47d3995731625334000d059`; synchronized master was
`ca232a5a4f4535bb4e6d14954bdba9b5a8ffa9b6`. Initial Sonar failure and subsequent repairs
are retained as append-only evidence. No quality gate was bypassed.

The current increment uses `development/wp0-thin-probe-plan`. Its PR requires fresh
exact-head CI and final review before merge. Resolve current master and PR state from
Git/GitHub when resuming; checkpoint hashes name the preceding validated master because
a checkpoint cannot contain its own resulting commit or merge hash.

T03 uses unchanged licensed grammars-v4 PL/SQL sources at
`7df52be94698550d219d299d04105c6bafadd9c3`, ANTLR 4.13.2 and reviewed authored callbacks.
No custom grammar/splitter or headerless upstream support class is included. Exact pins
and prior source exposure are recorded in [provenance](../dependencies/antlr-provenance.md)
and [lock](../dependencies/antlr-parser-lock.json). The byte adapter preserves comments,
UTF-8 and LF/CRLF delimiters, rejects SQL*Plus commands and uncovered source bytes, and
checks bounded helper output without logging SQL. Whole-release prevalidation snapshots
all files and stops the release if a later file fails, without partial execution approval.

The original corpus passes all 31 files across 14 groups/30 variants; four real-helper
integration tests pass. Two isolated builds reproduce helper SHA-256
`a8aa930fd0a17aee5d74a5d65dc91bcc7e166fca99ac6aca4a4d8bc995351f38`.
Generator/runtime/JDK remain separate; source drift stops before compilation and a
mismatched build preserves the installed reviewed artifact. T03 evidence is under
`evidence/db-devops-wp0/t03-antlr-20261008T130643Z-98b033db/` and its quality repair under
`evidence/db-devops-wp0/pr2-quality-20261008T133102Z-1646ac2e/`.
The old Flyway corpus still exposes its 11 documented mismatches; historical evidence
and all 43 immutable inputs remain preserved.

**T04 offline implementation:** `prepareThinProbePlan(profile)` always runs the existing
preflight. It produces twelve frozen descriptors for the six connectivity/fault/security
cases across Oracle 19c and 21c, with a pinned canonical acceptance projection. Caller
report-shaped objects cannot supply a successful preflight result. No input endpoints,
credential references or submitted blocker text enter the plan. The CLI caps JSON input
at 1 MiB and emits fixed errors. Run `npm run probes:thin:plan -- [--profile PATH]`.
Exit 0 means a plan was prepared from valid offline inputs; it grants no runtime authority.
Exit 1 means missing prerequisites; exit 2 means rejected inputs or a command error.
Every descriptor remains NOT_RUN/BLOCKED and non-executable, with false authority flags.
This component is preparation for the future runner; it does not implement Thin execution.

**Current local evidence:** 72 tests and dependency smoke pass. Independent QA passes
16 focused T01/T04/CLI tests plus ad hoc malformed UTF-8 and argument checks; independent
security approves the input/provenance/redaction boundary. T04 evidence and PR2 merge
records are under `evidence/db-devops-wp0/t04-offline-plan-20261008T134759Z-2e424822/`.
These new records claim no full T04 criterion or Oracle case coverage.

Thirteen parser unit cells PASS; opaque PL/SQL atomicity `WP0-03-13` unit remains NOT_RUN.
All **124 applicable Oracle cells remain BLOCKED**. No connection, credential resolution,
deployment or infrastructure change occurred. No actual authorized disposable 19c/21c
manifest was supplied. Runtime probes also require scoped identities/grants/fault/teardown
permission and approved trust material with peer/target verification. CA digest and
identity labels alone do not establish this behavior. An example or hostname is not authority.

Product license/name and full F31 distribution closure remain pending. Apache-2.0 is
proposed. The reviewed Apache grammar/BSD grants cover the offline candidate boundary;
product distribution still needs its owner decision and final source/notice/artifact closure.
Work: four VERIFIED, one BLOCKED, 60 BACKLOG. Features: 213 BACKLOG, seven DEFERRED,
zero VERIFIED. `npm run next` returns no fully unblocked task.

Next: finish this increment's remote gates and merge if eligible, then persist the final
checkpoint. Actual T04 runner work resumes with the required lab/trust inputs. T05 and
later tasks depend on T04; WP1/API/UI cannot bypass WP0-T12. Follow
[CONTINUE.md](CONTINUE.md) and the existing graph; do not create a replacement roadmap.
