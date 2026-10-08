# Current engineering state

Foundation and the bounded WP0-T01, T02 and T03 offline increments are VERIFIED.
WP0-T04 has offline probe preparation, a read-only Thin candidate and child-process supervision;
it remains BLOCKED for runtime acceptance.
The milestone is offline WP0 feasibility; no Oracle execution, API/UI or product feature is verified.

**Current increment:** `development/wp0-thin-supervision` adds actual child-process
supervision around the existing read-only probe. PR #6 checkpoint is merged at
`6aa97d8db47fb3978fa11b0e59c09c1e9ad538b2`; its three master workflows passed.
The new supervisor/worker protocol uses child-owned privileged ports, a bounded total
deadline, strict result validation, TERM/KILL and confirmed reaping. Malformed output,
crashes and timeouts return HOLD with unknown connection/read counts and required cleanup.
An unreaped child remains owned by a referenced reaper; replacement probes are refused.
The same-UID child is not an OS sandbox; native IPC parsing has no transport memory cap.
The trusted starter has no default implementation or public path/environment selection.
No authority or provider backend is added. PR #7 is open in draft; exact-head review
and remote gates must finish before merge. Evidence is under
`evidence/db-devops-wp0/t04-thin-supervision-20261008T151430Z-fc1518f5/`.

PR #1 merged at `42249826d105d44dbf5d6243f9ebe3748612e1c7`. PR #2 merged after
independent QA/security review, empty code/secret/dependency alerts and all nine exact-head
checks passed, including SonarCloud and CodeQL. Its reviewed head was
`97432efde71ed16ad47d3995731625334000d059`; synchronized master was
`ca232a5a4f4535bb4e6d14954bdba9b5a8ffa9b6`. Initial Sonar failure and subsequent repairs
are retained as append-only evidence. No quality gate was bypassed.

PR #3 merged after independent review and all nine exact-head checks passed. Its reviewed
head is `4299b4d0ce770d0d961a39046ec997bb05cc1446`; synchronized master before this
checkpoint is `87d41da43886306a3a996aa458ced27130de130f`. Its initial SonarCloud duplication
failure was fixed without changing the threshold; the final scan has zero issues, hotspots
and new-code duplication. No implementation PR remains open at this checkpoint.

PR #4 checkpoint merged at `01ff4446e0318d4b7f91a003cf15799ab3b7be11`; its three master
workflows completed successfully. That checkpoint used
`development/wp0-thin-checkpoint`. PR #5 merged at
`de86263e8a8c5faae8af8b18197fe03a7cbf138e` after all nine exact-head gates passed;
its reviewed head is `fe63aebcc911c1b0de89659be253ea0f186ae277`. Final SonarCloud has
zero new/accepted issues, hotspots and duplication; CodeQL has no new alerts. The two
initial CodeQL review threads automatically resolved after repair. Independent QA/security
approved that exact head; code/secret/dependency alert lists are empty. No implementation
PR remains open. Resolve the checkpoint's own PR/merge and current master from Git/GitHub;
literal hashes name the preceding validated implementation master. Earlier read-only evidence is under
`evidence/db-devops-wp0/t04-thin-readonly-20261008T143528Z-0b734360/`.
The continuation record is `session-checkpoint.json` in that directory.

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
This component remains plan-only; it does not invoke the separate Thin candidate.

**T04 read-only candidate:** `createReadOnlyThinProbe(ports)(request)` implements one
strict TCPS connection, one fixed session-identity SELECT and close. It requires trusted
admission, atomic single-use dispatch claim and scoped credential/trust provider ports;
none of these privileged backends or a runnable CLI are supplied. It snapshots bound
grants, pins exact server version and credential revision, checks the approved mTLS
wallet/CA hashes against native TLS context construction, and stops on identity mismatch,
stale authority or unsafe debugger/TLS environment. Read/cleanup errors remain HOLD;
there is no migration SQL, pooling, fallback or retry. Every result keeps acceptance
NOT_EVALUATED/runtime BLOCKED. Identity labels do not establish canonical container identity.

Twenty-one new UNIT tests use fake positive connectors, actual offline TLS contexts and
ephemeral test keys removed from private temporary directories. The real default-driver
test stops at denied admission. No Oracle connection or handshake was performed.
Independent QA/security approve this bounded candidate. Live wiring still requires an
authenticated authority/atomic claim backend, approved client wallet and trust providers,
authorized labs, independent observations and deployed worker isolation. Driver phase and
round-trip timeouts alone do not supply the new supervisor's total provider/call/cleanup watchdog.

**Earlier local evidence:** 72 tests and dependency smoke pass. Independent QA passes
16 focused T01/T04/CLI tests plus ad hoc malformed UTF-8 and argument checks; independent
security approves the input/provenance/redaction boundary. T04 evidence and PR2 merge
records are under `evidence/db-devops-wp0/t04-offline-plan-20261008T134759Z-2e424822/`.
These new records claim no full T04 criterion or Oracle case coverage.

**Earlier read-only evidence:** 93 tests and dependency smoke pass. Independent focused
QA/security each pass 21/21. T04 read-only source hashes, raw checks, review corrections
and limitations are recorded in its read-only evidence run. Initial CodeQL/Sonar failures
for a PEM backtracking regex and fixed UNIT canary are preserved; bounded literal PEM
marker scanning and a generated per-process canary replace them. No full T04 criterion or case
coverage was added; existing parser unit cells and all Oracle cells retain their statuses.

**Current local evidence:** 115 tests and dependency smoke pass; independent QA passes
22/22 supervisor tests. Security approves after both concrete findings were repaired,
without claiming a completed independent test capture. Source hashes, raw full checks,
initial formatting failure and review limitations are preserved in the supervision run.
Remote exact-head gates and final committed-head reviews are still pending.

Thirteen parser unit cells PASS; opaque PL/SQL atomicity `WP0-03-13` unit remains NOT_RUN.
All **124 applicable Oracle cells remain BLOCKED**. No Oracle connection or actual
credential-reference resolution occurred; positive UNIT paths use fake providers only.
No deployment or infrastructure change occurred. No actual authorized disposable 19c/21c
manifest was supplied. Runtime probes also require scoped identities/grants/fault/teardown
permission and approved trust material with peer/target verification. CA digest and
identity labels alone do not establish this behavior. An example or hostname is not authority.

Product license/name and full F31 distribution closure remain pending. Apache-2.0 is
proposed. The reviewed Apache grammar/BSD grants cover the offline candidate boundary;
product distribution still needs its owner decision and final source/notice/artifact closure.
Work: four VERIFIED, one BLOCKED, 60 BACKLOG. Features: 213 BACKLOG, seven DEFERRED,
zero VERIFIED. `npm run next` returns no fully unblocked task.

Next: finish the current supervisor increment's exact-head review and remote gates.
Supply lab/trust/provider authority and deployed isolation before connecting the candidate, then
complete the remaining fault/rotation harness and real T04 acceptance. T05 and
later tasks depend on T04; WP1/API/UI cannot bypass WP0-T12. Follow
[CONTINUE.md](CONTINUE.md) and the existing graph; do not create a replacement roadmap.
