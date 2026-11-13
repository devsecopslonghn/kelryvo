# Kelryvo

Self-hosted Database DevOps and governance, with Oracle as the initial target.

Install a customer pilot with [CUSTOMER-GUIDE.md](CUSTOMER-GUIDE.md).
Read [CHECKLIST.md](CHECKLIST.md) for scope, delivery policy and migration status.

The application lives in `crates/`: native Rust API, workers, operators, parser
and Rust/WASM UI. The Dockerfile builds the native runtime. The companion Helm
migration patch is in `deploy/`; release and Oracle qualification remain scoped
as recorded in the checklist.

```sh
cargo build --workspace --locked
cargo run --locked -p kelryvo-test-tools --bin kelryvo-test --
```

Use the pinned Rust toolchain, PostgreSQL tools and Git for native checks.
Run `cargo fetch --locked`, then `cargo check-delivery` for source/contracts/dependency
checks. `cargo native-test --browser-product-only` runs the Rust browser fixture;
install its pinned browser with `cargo native-test --install-browser`.
Development, browser and opt-in lab drivers use Rust; Node/npm/Python are not required.
Frozen migration contracts are in `tests/fixtures/contracts/`; parser fixtures
are in `tests/fixtures/parser/`. No retired Node application is shipped or started.

Checkout startup: `target/debug/kelryvo dev`; use `dev --help` for existing PostgreSQL.
Native pilot and operator commands: `target/debug/kelryvo pilot --help`.
Build a local image with `docker build --target app -t kelryvo:rust-local .`.

Temporary outputs stay in ignored `.cache/`; retain licenses and parser provenance.
