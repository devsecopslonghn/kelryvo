#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="${HOME}/.cargo/bin:${PATH}"
mkdir -p .cache
if [ "${1:-}" = "--installed-oracle-fixture" ]; then
  # Explicit local-only OS-operator action; never part of the default test run.
  # The driver pins its vendor image and refuses initialized fixture roots.
  shift
  exec python3 -B scripts/rust-installed-oracle-fixture.py "$@"
fi
if [ "${1:-}" = "--installed-oracle-only" ]; then
  # Opt-in: an already prepared disposable namespace supplies real installed
  # binaries, Oracle/TCPS and metadata. Never create a second database here.
  shift
  exec python3 scripts/test-rust-installed-oracle.py "$@"
fi
if [ "${1:-}" = "--schema-browser-only" ]; then
  export KELRYVO_RUST_BROWSER_FOCUS=schema
  set -- --browser-product-only
fi
if [ "${1:-}" = "--workflow-browser-only" ]; then
  export KELRYVO_RUST_BROWSER_FOCUS=workflow
  set -- --browser-product-only
fi
if [ "${1:-}" = "--shell-browser-only" ]; then
  export KELRYVO_RUST_BROWSER_FOCUS=shell
  set -- --browser-product-only
fi
if [ "${1:-}" = "--oci-only" ]; then
  cargo build -p kelryvo-cli --locked
  node scripts/test-rust-oci.mjs
  exit
fi
if [ "${1:-}" = "--delivery-only" ]; then
  cargo test -p kelryvo-cli delivery --locked -- --include-ignored
  exit
fi
if [ "${1:-}" = "--helm-only" ]; then
  node scripts/test-rust-helm.mjs "${2:?Pass the absolute companion chart checkout}"
  exit
fi
if [ "${1:-}" = "--image-root-only" ]; then
  if [ -z "${KELRYVO_RUST_CLI:-}" ]; then cargo build -p kelryvo-cli --locked; fi
  node scripts/test-rust-image-root.mjs "${2:?Pass the absolute exported image root}" "${@:3}"
  exit
fi
task_directory=$(mktemp -d "${PWD}/.cache/rust-tests.XXXXXXXX")
cleanup() {
  if [ -f "${task_directory}/postgres/postmaster.pid" ]; then
    pg_ctl -D "${task_directory}/postgres" -m fast stop >/dev/null
  fi
}
trap cleanup EXIT INT TERM
initdb -D "${task_directory}/postgres" -A trust --no-locale --encoding=UTF8 >/dev/null
mkdir "${task_directory}/socket"
pg_ctl -D "${task_directory}/postgres" -l "${task_directory}/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_directories='${task_directory}/socket'" start >/dev/null
createdb -h "${task_directory}/socket" kelryvo_rust_test
export KELRYVO_RUST_TEST_DATABASE_URL="postgresql:///kelryvo_rust_test?host=${task_directory}/socket"
run_isolated_json_objects=0
isolated_json_objects() {
  # All shared-fixture assertions have already completed. This exact database
  # belongs to the cluster created above; no retained/user database is reset.
  test "${KELRYVO_RUST_TEST_DATABASE_URL}" = "postgresql:///kelryvo_rust_test?host=${task_directory}/socket"
  printf '%s\n' 'Running named-object integration in a fresh database in the same private PostgreSQL cluster.'
  dropdb -h "${task_directory}/socket" kelryvo_rust_test
  createdb -h "${task_directory}/socket" kelryvo_rust_test
  cargo test -p kelryvo-server --test json_objects --locked -- --include-ignored
}
if [ "${1:-}" = "--runtime-only" ]; then
  native_cli=${KELRYVO_RUST_CLI:-target/debug/kelryvo}
  if [ -z "${KELRYVO_RUST_CLI:-}" ]; then cargo build -p kelryvo-cli --locked; fi
  if [ -z "${KELRYVO_RUST_RUNTIME_PROBE:-}" ]; then cargo build -p kelryvo-launcher --example runtime-probe --locked; fi
  if [ -n "${KELRYVO_RUST_IMAGE_ROOT:-}" ]; then
    export KELRYVO_RUST_DISTRIBUTION="${KELRYVO_RUST_IMAGE_ROOT}/opt/kelryvo"
  elif [ -z "${KELRYVO_RUST_DISTRIBUTION:-}" ]; then
    "${native_cli}" build-dist "${task_directory}/distribution" --debug
    export KELRYVO_RUST_DISTRIBUTION="${task_directory}/distribution"
  fi
  "${native_cli}" verify-dist "${KELRYVO_RUST_DISTRIBUTION}"
  node scripts/test-rust-runtime.mjs
elif [ "${1:-}" = "--controller-only" ]; then
  cargo test -p kelryvo-worker --lib controller:: --locked -- --include-ignored
elif [ "${1:-}" = "--worker-only" ]; then
  cargo test -p kelryvo-runtime --lib --locked
  cargo test -p kelryvo-runtime --test oracle_ports --locked
  cargo test -p kelryvo-runtime --test oracle_catalog --locked
  cargo test -p kelryvo-runtime --test oracle_discovery --locked
  cargo test -p kelryvo-runtime --test oracle_provision --locked
  cargo test -p kelryvo-worker --lib --locked -- --include-ignored
  cargo test -p kelryvo-worker --test process --locked -- --include-ignored
  cargo test -p kelryvo-worker --test admission --locked -- --include-ignored
  cargo test -p kelryvo-worker --test installation --locked -- --include-ignored
elif [ "${1:-}" = "--recovery-only" ]; then
  cargo test -p kelryvo-runtime --test completion --locked
  cargo test -p kelryvo-worker --lib recovery::tests --locked -- --include-ignored
elif [ "${1:-}" = "--local-credentials-only" ]; then
  cargo test -p kelryvo-operator --lib local_credentials::tests --locked -- --include-ignored
  cargo test -p kelryvo-operator --test local_credentials --locked -- --include-ignored
elif [ "${1:-}" = "--local-dev-only" ]; then
  cargo build -p kelryvo-cli -p kelryvo-operator -p kelryvo-server --locked
  target/debug/kelryvo build-web
  node scripts/test-rust-local.mjs
elif [ "${1:-}" = "--pilot-only" ]; then
  cargo build -p kelryvo-cli -p kelryvo-operator --locked
  cargo test -p kelryvo-operator --lib pilot:: --locked
  node scripts/test-rust-pilot.mjs
elif [ "${1:-}" = "--password-only" ]; then
  if [ -z "${KELRYVO_RUST_DISTRIBUTION:-}" ]; then
    cargo build -p kelryvo-cli -p kelryvo-server --locked
    target/debug/kelryvo build-web
  fi
  node scripts/test-rust-password.mjs
elif [ "${1:-}" = "--quota-only" ]; then
  if [ -z "${KELRYVO_RUST_DISTRIBUTION:-}" ]; then
    cargo build -p kelryvo-server --locked
    if [ -z "${KELRYVO_RUST_WEB_DIRECTORY:-}" ]; then
      cargo build -p kelryvo-cli --locked
      target/debug/kelryvo build-web
    fi
  fi
  sudo -n env "KELRYVO_RUST_QUOTA_RESULT_FILE=${KELRYVO_RUST_QUOTA_RESULT_FILE:-}" \
    "KELRYVO_RUST_WEB_DIRECTORY=${KELRYVO_RUST_WEB_DIRECTORY:-}" \
    timeout --signal=TERM --kill-after=10s 120s unshare --net --mount --pid --fork --mount-proc --kill-child=SIGKILL \
    python3 scripts/rust-quota-namespace.py "${PWD}" "$(command -v node)" "${KELRYVO_RUST_DISTRIBUTION:--}" "${KELRYVO_RUST_TEST_DATABASE_URL}"
elif [ "${1:-}" = "--http-only" ]; then
  if [ -z "${KELRYVO_RUST_DISTRIBUTION:-}" ]; then
    cargo build -p kelryvo-server -p kelryvo-cli --locked
    target/debug/kelryvo build-web
  fi
  node scripts/test-rust-http.mjs
elif [ "${1:-}" = "--public-auth-only" ]; then
  if [ -z "${KELRYVO_RUST_DISTRIBUTION:-}" ]; then
    cargo build -p kelryvo-server --locked
    if [ -z "${KELRYVO_RUST_WEB_DIRECTORY:-}" ]; then
      cargo build -p kelryvo-cli --locked
      target/debug/kelryvo build-web
    fi
  fi
  node scripts/test-rust-public-auth.mjs
elif [ "${1:-}" = "--json-objects-only" ]; then
  cargo test -p kelryvo-server --test json_objects --locked -- --include-ignored
elif [ "${1:-}" = "--product-only" ]; then
  cargo test -p kelryvo-server --test product --locked -- --include-ignored
elif [ "${1:-}" = "--product-and-json-objects-only" ]; then
  cargo test -p kelryvo-server --test product --locked -- --include-ignored
  run_isolated_json_objects=1
elif [ "${1:-}" = "--identity-api-only" ]; then
  cargo test -p kelryvo-server --test identity --locked -- --include-ignored
elif [ "${1:-}" = "--inventory-only" ]; then
  cargo test -p kelryvo-operator --test inventory --locked -- --include-ignored
elif [ "${1:-}" = "--operator-only" ]; then
  cargo build -p kelryvo-operator --example managed-probe --locked
  cargo test -p kelryvo-operator --locked -- --include-ignored
elif [ "${1:-}" != "--browser-only" ] && [ "${1:-}" != "--browser-product-only" ] && [ "${1:-}" != "--identity-only" ]; then
  cargo build -p kelryvo-operator --example managed-probe --locked
  # This fresh-fixture case seeds the same retained actors as product.rs. It
  # still runs below as a mandatory check, after an explicit fixture boundary.
  cargo test --workspace --locked -- --include-ignored --skip typed_api_requests_reject_positional_arrays_without_metadata_mutation
  run_isolated_json_objects=1
  cargo build -p kelryvo-cli --locked
  node scripts/test-rust-parity.mjs
  node scripts/test-rust-oci.mjs
fi
if [ "${run_isolated_json_objects}" = 1 ]; then
  isolated_json_objects
fi
if [ "${1:-}" = "--browser" ]; then
  # Product fixtures deliberately retain held/corrupt global stream evidence.
  # Browser scenarios need a fresh private cluster, with all guards still active.
  bash scripts/test-rust.sh --browser-only
elif [ "${1:-}" = "--browser-only" ] || [ "${1:-}" = "--browser-product-only" ] || [ "${1:-}" = "--identity-only" ]; then
  if [ "${1:-}" != "--browser-product-only" ] || [ -z "${KELRYVO_RUST_DISTRIBUTION:-}" ]; then
    cargo build -p kelryvo-server --locked
    cargo build -p kelryvo-cli -p kelryvo-operator --locked
    target/debug/kelryvo build-web
  fi
  if [ "${1:-}" = "--browser-only" ] || [ "${1:-}" = "--browser-product-only" ]; then
    node scripts/test-rust-browser.mjs
  fi
  if [ "${1:-}" = "--browser-only" ]; then
    bash scripts/test-rust.sh --password-only
  fi
  if [ "${1:-}" != "--browser-product-only" ]; then
    node scripts/test-rust-identity.mjs
  fi
fi
