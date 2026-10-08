# WP0 offline preflight

Run `npm run preflight -- [--profile PATH] [--output evidence/db-devops-wp0/RUN-ID]` with Node.js 22. The default empty manifest reports `BLOCKED`. Exit codes: 0 means offline inputs validate (`PREFLIGHT_VALID`), 1 means required authority or other prerequisites are missing (`BLOCKED`), and 2 means malformed/rejected input or command/output error. Repeated report runs create unique files with exclusive creation; output directories must be under `evidence/db-devops-wp0/` and existing files are never replaced.

`lab-profile.example.json` documents the shape and is rejected as authority. A real input must identify separate exact Oracle 19c and 21c routes, each with a TCPS endpoint whose path exactly names the service, CA SHA-256 and server identity. It also records separate Oracle entitlement and disposable-lab authorization attestations, explicit disposable status, versioned target authorization, exact A/B/C fixture footprint and allowed actions. A and B must use distinct owners and project labels in the same DEV PDB/container for each version. C must identify a distinct PDB in the same container for each version. C's connection routes live in a separate negative-probe allowlist limited to connect and observe actions; C is excluded from the writer target allowlist and A/B teardown authority. Alias routes declare version, service, endpoint, CA, server identity and expected container/PDB, then match that version's target profile. The profile also requires distinct opaque references for discovery, owner A, owner B, observer and bootstrap, nonempty grants, narrow DBMS_LOCK scope, named fault-proxy/session-stop authority, an offline PostgreSQL metadata fixture, teardown authority and offline artifact categories.

Credential references are identifiers only. Preflight never opens or resolves them. Unknown fields are rejected; errors contain fixed field names and do not echo supplied values or paths. TCPS endpoints reject userinfo, query strings and fragments. A rejected or invalid JSON profile has no profile digest in its report. Valid secret-free profiles record their measured raw profile digest; the no-profile BLOCKED report hashes its empty canonical manifest. Artifact records include version, source reference, NOTICE hash and maintenance reference. Artifact and NOTICE bytes must be regular files within `experiments/db-devops-wp0/offline-inputs/`; symlinks, `.git`, `.env` and private-key formats are refused. SHA-256 values are checked against the local bytes. The report records measured profile, preflight source and artifact digests separately from declared harness/build/fixture digests.

The artifact, NOTICE, source and maintenance references are declarations; digest checks establish only that declared local bytes match their hashes. They do not assess license validity, distribution rights, dependency completeness, maintenance quality, Oracle runtime behavior or entitlement. A valid offline profile has `preflight.logic: PASS` while `preflight.runtime` remains `BLOCKED`; it is not WP0 acceptance and does not itself authorize a connection. The full dependency/license audit and runtime evidence remain outstanding.

Run focused tests with `node --test tests/preflight.test.mjs`.

WP0-T02 adds actual pinned dependency imports, clean offline npm installation and a
driver-free Flyway parser feasibility helper. Use `npm run dependencies:smoke`,
`npm run dependencies:offline` and the [offline build instructions](../../docs/development/offline-build.md).
The original F07–F20 corpus has 14 fixture groups and 30 variants with immutable byte
digests and executable goldens. The bounded parent envelope validates candidate output
and the `parser:corpus` command exposes 11 compatibility failures. All candidate results
remain unapproved; no parser or database execution is admitted by these tools.

## T04 offline Thin probe preparation

`npm run probes:thin:plan -- [--profile PATH]` runs the existing offline preflight and
prepares the six T04 cases across Oracle 19c and 21c. It reads at most 1 MiB of UTF-8 JSON.
Exit 0 means valid offline inputs produced a plan; 1 means missing prerequisites; 2 means
rejected input or a command error. All twelve entries remain NOT_RUN/BLOCKED and
non-executable even on exit 0. No Oracle runner, trust-chain verification, credential
resolution or network call is included. The output omits endpoints, refs and submitted
blocker text; errors use a fixed message. The reusable entry is
`prepareThinProbePlan(profile)` in `thin-probe-plan.mjs`, which calls actual preflight.

Run focused checks with
`node --test tests/preflight.test.mjs tests/thin-probe-plan.test.mjs tests/thin-probe-cli.test.mjs`.
Synthetic fixture tests exercise local artifact validation only. Authoritative T04 runtime
acceptance and all 124 applicable Oracle cells remain BLOCKED.

## T04 read-only Thin candidate

`thin-readonly-probe.mjs` exports `createReadOnlyThinProbe(ports)`, returning an async
probe for `WP0-01-01`/`WP0-01-02`. It has no CLI, authority backend or deployed wiring.
The real default driver is the existing pinned node-oracledb 7.0.1. Unit tests inject a
fake driver; the default-driver test stops at denied admission before any connection.

Trusted restricted-worker ports are required: `admit`, `claimDispatch`,
`resolveCredentials` and `resolveTrust`. `admit` must authenticate explicit disposable-lab
authority, completed T01 inputs, approved profile/build/fixture hashes and the exact
run/case/version/role/intent. It returns the bound permit, expiry, TCPS route, trust hashes,
credential reference/revision/principal, expected session facts/exact server version and
finite phase timeouts. A preflight result or caller boolean cannot supply these ports.
The module snapshots the grant, checks credential revision, rechecks admission, then
requires a bound dispatch receipt from `claimDispatch`. That port must atomically consume
a single-use permit with current authority checks, serialize consumption against revocation,
and refuse reuse across workers/restarts. These privileged backends are **not implemented**;
the unit fixture's in-memory claim models the contract only.

This candidate supports an explicitly approved PEM mTLS wallet. `resolveTrust` returns
`{pem, caPem, walletPassword}`: exact wallet and CA bytes must match their separate permit
hashes. The CA bundle contains CA certificates only; the wallet contains matching approved
CAs, a client certificate and one PKCS#8 key. The module validates the same native TLS
context used by the pinned driver. CA-only `walletContent` fails closed. There is no
SYSTEM trust, file/environment credential fallback or automatic wallet generation.
Wallet/password material stays inside the restricted worker and never enters results.

The probe permits one standalone TCPS connection and one fixed `SYS_CONTEXT` SELECT,
checks Thin mode, exact database version, principal, service, PDB, CON_ID and DB_UNIQUE_NAME,
then closes. It exposes no connection or supplied SQL, uses strict peer matching, disables
retry and external authentication, and rejects debugger/disabled-TLS environment settings.
Identity mismatch rejects the probe; read errors or failed close return HOLD, with explicit
cleanup requirements. Results always say `acceptance: NOT_EVALUATED`. Session labels do
not establish canonical container identity or pass either Oracle acceptance case.

Before live wiring, require authorized 19c/21c manifests, approved client wallets and trust,
scoped credential/provider grants, independent target/container observations, authenticated
atomic permit backends, and a supervised isolated worker with a sanitized environment.
Driver connection timeouts bound connection phases and `callTimeout` bounds each round trip;
they do not bound providers, all calls or cleanup. A process watchdog and independent session
inventory/cleanup remain required. Fault injection, DDL and rotation probes remain absent.

Run `node --test tests/thin-readonly-probe.test.mjs` with Node 22.23.3 and
`/usr/bin/openssl` available. Tests create ephemeral UNIT-only certificates/keys in a private
temporary directory and remove the files in `finally`; no wallet or private key is tracked.
Native TLS-context checks are offline code evidence, with no TLS handshake or Oracle call.
Relevant primary references: [driver 7.0.1 API](https://node-oracledb.readthedocs.io/en/v7.0.1/api_manual/oracledb.html),
[connection properties](https://node-oracledb.readthedocs.io/en/v7.0.1/api_manual/connection.html),
and [Oracle SYS_CONTEXT](https://docs.oracle.com/en/database/oracle/oracle-database/21/sqlrf/SYS_CONTEXT.html).
