# Kelryvo — current checklist

Updated 2026-11-13 (Asia/Saigon). Keep only unfinished work here; remove completed
entries and their run journals. Preserve pending IDs and completion criteria.

The application is Rust under `crates/`, including the API, Oracle runtime,
operators, parser and WASM UI. Authored development, browser, namespace, container
and Oracle-lab drivers also run in Rust. Cargo aliases and native CI entrypoints
replace the retired JavaScript, Python and shell tooling. Historical initializer
bytes and Node dependency records remain non-executable compatibility/provenance
data. SQL, HTML/CSS, grammar inputs, configuration and licenses remain required.
The rewrite is not release-qualified. Published customer deployments retain their
own source/image scope; see [CUSTOMER-GUIDE.md](CUSTOMER-GUIDE.md).

Current task scope: finish the local Rust application migration first. Oracle
lab qualification, hosted CI, release nomination and publication are deferred
under the user's 2026-11-12 instruction. The pending qualification criteria below
remain required before claiming a fully qualified replacement or release.

## Remaining work

- [ ] **RUST3 — Complete native parser compatibility:** qualify grammar and
  semantic compatibility beyond the retained 31-file corpus, and establish the
  required performance scope. Keep the distinct native-v2 parser profile,
  fail-closed unknown semantics/recovered syntax, exact source ranges and digests,
  and pinned grammar provenance. Existing ANTLR/Rust-v1 approvals must never
  acquire v2 authority implicitly. Corpus success alone does not establish full
  grammar equivalence, Oracle acceptance or production approval.
- [ ] **RUST4 — Complete browser and API parity:** finish the behavioral parity
  audit across the retained product contracts and supported browser workflows.
  Route registration, fixed fixtures and focused browser checks alone do not
  establish complete parity. Retain independent approval, revision/CAS checks,
  scoped access, immutable evidence/history, credential isolation, bounded reads
  and HOLD behavior throughout the workflow. Live LDAP interoperability remains
  unqualified. Apply affected build/smoke/targeted checks to changes; broader
  regression remains opt-in or scheduled under the delivery policy below.
- [ ] **RUST5 — Protected Oracle runtime and operators:** complete replacement
  qualification for the protected native worker, discovery, installation,
  credential lifecycle, recovery and backup/restore paths on the selected
  source/artifact. Existing local installed-Oracle results are bounded evidence;
  a metadata-projection failure is not proof of actual lost Oracle COMMIT ACK
  recovery. Actual lost-ACK recovery, admitted-job archive restoration and managed
  cluster backup/restore remain unqualified. Keep production DR and additional
  Oracle versions/topologies outside the supported scope until separately
  qualified. Synthetic fixtures, standalone component checks and historical
  installations cannot authorize a new runtime or transfer Oracle acceptance.
- [ ] **RUST6 — Native delivery and replacement:** qualify a release nominated
  from the actual Rust source commit through the configured source, security and
  exact-image gates. Require native amd64 and arm64 image/startup/governance/pilot
  checks and verified two-platform OCI assembly. QEMU and host-browser checks do
  not establish native ARM server or Oracle acceptance. Recheck dependency/license
  provenance, packaged source identity, runtime inventories and companion Helm
  compatibility for that artifact. The native Helm candidate remains in
  `deploy/native-oracle-helm.patch`; customer cutover and publication require
  separate authorization. Earlier local-unpublished `0d6d1238` artifacts predate
  the Rust-only cleanup and cannot qualify this checkout. Do not bypass CI,
  relabel historical artifacts or inherit an earlier deployment's acceptance.

## Delivery policy and operating boundaries

Deliver the supported project/target → SQL/Git release → validation → immutable
plan → independent review → execution request → retained-history workflow.
There is no separate QC role, sign-off or acceptance phase for routine delivery.
Use the smallest relevant build, smoke and targeted checks; stop repeating them
once they pass unless a new change or unresolved concern justifies another run.

Keep configured CI and approval gates. `check.yml`, `containers.yml` and the
existing CodeQL checks remain publication prerequisites. `product.yml`,
`parser.yml` and `regression.yml` remain independent advisory runs. Missing
optional fixtures/logs or environment failures do not block unrelated delivery;
confirmed security, authorization, data-integrity, startup or artifact-provenance
failures block the affected behavior. Report failed, skipped and unrun checks
accurately.

The delivery gate requires successful exact-source `Analyze (rust)` and
`Analyze (actions)` jobs from the active default CodeQL workflow, and refuses
open code-scanning findings. Retired Node/JVM/Python analysis cannot qualify the
Rust replacement. Verify that default setup selects both current languages for
the nominated source; missing analysis blocks publication. The migration branch
also runs the source and native-image checks on push without publishing images.

Workspace owns infrastructure; projects own releases, plans, reviews and schema
assignments. Preserve immutable sources, revisions, decisions, history/audit,
compatibility formats and literal Oracle identities. Configuration restoration
must not revive old authority. Execution requires an explicit deploy grant and
current trusted installation. API/web expose secret references only; writer
secrets stay in the purpose-restricted runtime. Ambiguous DDL remains HOLD with
no automatic replay. Restores retain RESTORE_HOLD; recovery requires a target
witness and two independent actors.

A checklist does not authorize Oracle connections, live migrations, fault
injection, cluster changes, deployment, publication, push, merge or history
rewrites. Oracle/lab work requires task authorization and a current secret-free
disposable-lab attestation. Never remove product data, HOLD records or audit
history as checklist cleanup. Never put secrets in Git, logs, image layers,
browser storage or command arguments.

## Local commands and evidence

Use the pinned Rust toolchain, PostgreSQL tools and Git. WASM builds
also require `wasm32-unknown-unknown` and `wasm-bindgen-cli 0.2.130`.
Node/npm/Python and authored JavaScript or shell test drivers are no longer
required. All lab entrypoints are native and remain opt-in under separate
authorization and disposable-lab preparation.
Oracle's reviewed PKI Java utility and vendor container bootstrap remain
third-party lab prerequisites; their vendor code is not authored test tooling.
The current Docker bootstrap/probe exports and installed-Oracle/lost-ACK flows
remain unrun locally. Their configured CI checks and qualification requirements
remain intact; the tooling migration transfers no earlier artifact's acceptance.

```sh
cargo fetch --locked
cargo repository status
cargo repository next
cargo check-delivery
cargo build --workspace --locked
cargo build-web
cargo parser-compatibility
```

`cargo parser-compatibility` covers the frozen corpus, authored SQL/PLSQL
cases and pinned grammar/semantic provenance. `cargo parser-performance`
explicitly measures eight offline workloads in release mode: small/batched DDL,
the 4,096-statement and 2 MiB limits, late syntax errors, excessive statements/rule
depth and unterminated quotes. Each workload reports its input hash, first
invocation and three repeated timings. Keep output in `.cache/` and record the
source revision, Rust version, CPU and OS alongside it. This is a reproducible
workload scope, not a latency SLA, full grammar equivalence or Oracle acceptance.

Native development: `target/debug/kelryvo dev`. Operator/pilot usage:
`target/debug/kelryvo-operator --help` and `target/debug/kelryvo pilot --help`.
Opt-in native integration uses `cargo run --locked -p kelryvo-test-tools --bin
kelryvo-test --`. Add `--browser-product-only` for focused product browser checks.
Integration runners create private PostgreSQL fixtures; use an appropriate
disposable local environment.
Installed Oracle checks require a separately authorized, prepared fixture.

Keep temporary logs, screenshots, reports and build outputs in ignored `.cache/`
or output directories. Keep one reusable build target and bounded fixtures.
Retain reproducible tests, dependency/license metadata, LICENSE/NOTICE and parser
provenance in Git. Independently authored code remains PolyForm Shield 1.0.0.
Retain legacy `SCHEMAFORGE_*` compatibility aliases and existing persistent format,
protocol and mutex identities; they protect data and cross-version compatibility.

Historical run details and artifact identities remain in Git:
`git show 7809efa63a07d18c34c1c09a3cc123b0eec6f57d:CHECKLIST.md`.
The customer guide's historical trial evidence is
`../acceptance-artifacts/customer-adb26-58dfae5-20261108T190000Z.tar.gz`, SHA-256
`190696f8af1009ab61c800d4ed878bcadcf40ba164aab48f241921f980828962`.
Its restricted cold backup is
`../acceptance-artifacts/customer-adb26-private-20261108T190000Z/`, with checksums
in its backup catalog. These references retain their historical scope; backup
restore/DR is not qualified. Keep credential-bearing backups private.

For an authorized release, retain selected secret-free evidence durably with the
source SHA, image digest, scope/topology/tool versions, timestamp, results,
limitations, checksums and reproduction steps. Expiring cache/CI artifacts are
not durable acceptance evidence. Historical failures and product history remain
preserved; this cleanup removes checklist text only.
