# Kelryvo

Self-hosted database DevOps and governance, initially for Oracle. This Rust
checkout is unreleased; see [CHECKLIST.md](CHECKLIST.md) for qualification gaps
and [CUSTOMER-GUIDE.md](CUSTOMER-GUIDE.md) for supported customer installations.

## Build and run

Use Linux, the pinned Rust toolchain, Git, OpenSSL and libffi development headers.
Checkout development uses Docker for its default PostgreSQL instance.
The local integration checks also need PostgreSQL's `initdb`, `pg_ctl`, `createdb`
and `dropdb` on `PATH`. The UI needs `wasm32-unknown-unknown` and
`wasm-bindgen-cli 0.2.130` (also pinned in the CI action).

```sh
cargo fetch --locked
cargo fetch --locked --manifest-path tools/oracle-codegen/Cargo.toml
cargo build --workspace --locked
cargo build-web
target/debug/kelryvo dev --tls-cert /absolute/localhost.crt --tls-key /absolute/localhost.key
```

Browser sign-in requires HTTPS. Supply a localhost certificate/key trusted by
your browser; loopback HTTP is available for health/API diagnostics. Keep the
private key outside Git with mode 0600.

`dev` prepares a private local configuration and PostgreSQL Docker volume, then
starts the API. Use `target/debug/kelryvo dev --help` for an existing database,
custom port, TLS and repository inputs. It does not install an Oracle executor.
`target/debug/kelryvo pilot --help` lists installed-pilot operator commands.
`docker build --target app -t kelryvo:rust-local .` builds the native image.

## How the application fits together

A browser action is decoded into `web::browser::actions::Action`, dispatched to
its feature module and sent to an HTTP route in `server::router`. Handlers check
credentials/project grants and write PostgreSQL metadata in transactions. They
retain a release, validation, immutable plan and independent review before
recording an execution request. The worker independently rechecks that request,
locks the target and calls the protected Oracle runtime. Uncertain outcomes stay
in HOLD; an HTTP success or a stored approval never grants fresh execution
or replay authority.

| Crate | Responsibility and reason for the boundary |
|---|---|
| `kelryvo-core` | Pure governance, validation, digests and retained formats; shared by native code and WASM, without database or privileged runtime dependencies. |
| `kelryvo-parser` | SQL source boundaries, statement metadata and parser profile. |
| `kelryvo-oracle-grammar` | Pinned upstream grammar, generated parser and provenance verification; isolates generated code from the authored parser adapter. |
| `kelryvo-server` | HTTP API and transactional metadata rules. Worker/operator reuse its catalog, authority and locking functions rather than maintaining a second implementation. HTTP-only modules are internal. |
| `kelryvo-web` | WASM UI; feature modules own actions, rendering and form state. Shared API/DOM startup lives in `browser.rs`. |
| `kelryvo-worker` | Admits and orchestrates execution, installation and recovery; does not trust queued requests as authority. |
| `kelryvo-runtime` | Oracle driver, mutex/ledger, privileged credential access and execution ports. The API must not depend on it. |
| `kelryvo-launcher` | Builds the `kelryvo-runtime` **binary**: OS-user separation, secret projection and API/worker supervision. This process boundary is intentional. |
| `kelryvo-discovery` | Bounded discovery protocol/transport shared by API and worker without exposing Oracle writer capabilities. |
| `kelryvo-vault` | Shared encrypted-credential format and cryptography. |
| `kelryvo-operator` | Explicit local administration, installation, accounts, backup and restore. |
| `kelryvo-cli` | User CLI, native bundle/OCI verification and guarded delivery. The repository binary is opt-in through the `repository` Cargo feature. |
| `kelryvo-fixtures` | Small shared reader for independently captured, hash-verified contracts; development dependencies stay out of the default application CLI graph. |
| `kelryvo-test-tools` | Disposable PostgreSQL setup, captured metadata seeding and exact-image/pilot release checks; never shipped as the application. |

No new crate is needed for metadata rules: shared transactions remain next to
their schema in `kelryvo-server`; pure validators belong in `kelryvo-core`.
The isolated `tools/oracle-codegen` Cargo workspace pins generator dependencies
separately so application dependency updates cannot change parser bytes.

## Verification and debugging

```sh
cargo fmt --all --check
cargo native-test --ci-tests core-parser
cargo native-test --ci-tests server
cargo native-test --ci-tests worker
cargo native-test --ci-tests operator
cargo native-test --ci-tests tools
cargo check-delivery
```

Use only the affected group during development. `cargo native-test` runs all
five groups. Database groups create private, socket-only PostgreSQL clusters and
stop/delete only their own fixtures. The server's positional-JSON contract runs
in a fresh database. Tests marked ignored require these disposable fixtures;
plain `cargo test` does not run them. No source group connects to Oracle.

Retained checks cover public API shape and scopes, independent review and grant
revocation, transaction/mutex ownership, HOLD/no-replay, immutable evidence,
backup restoration across supported historical catalogs, and source/image
identity. Frozen expected outputs are never regenerated from current behavior.
The former browser framework, host/chroot smoke copies and Oracle-lab automation
were removed: they duplicated contract checks or supported unqualified lab
scenarios. Live browser interoperability, Oracle fault/recovery qualification
and two-platform release evidence must be established separately when needed.

Start with the smallest failing group; use `RUST_BACKTRACE=1` for a panic and
`cargo test -p CRATE TEST_NAME -- --nocapture` for a pure test. For a database
failure, keep the fixture running within the test until inspection is complete;
its PostgreSQL log is under `.cache/rust-tests.*/postgres.log`. Debug binaries are
under `target/debug/`. Build logs, screenshots and temporary diagnostics belong
in ignored `.cache/`, not Git. Do not log tokens, SQL credentials or private
response bodies. There is no checked-in browser driver or lab environment DSL.

`check.yml`, `containers.yml` and CodeQL remain required release gates. Container
checks use the exact verified image on native amd64 and arm64. Publication,
deployment and customer cutover still require explicit authorization.

## Compatibility that must survive cleanup

Keep `SCHEMAFORGE_*` aliases, persisted `sf_*` schema/catalog signatures, protocol
and mutex identities, retained digest/JSON serialization rules, parser profiles,
licenses/provenance and all supported backup bootstraps. The 16 historical
backup profiles and compressed contract fixtures are compatibility data.
They are not generated from current application output. Existing approval or
installation evidence cannot silently acquire a new parser/runtime's authority.
Restoration retains RESTORE_HOLD and recovery requires a target witness and two
independent actors. See the customer guide for the precise supported scope.
