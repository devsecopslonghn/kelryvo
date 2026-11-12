#!/usr/bin/env bash
# Runs only inside a new private mount/PID/network namespace created by the
# native smoke driver. Every filesystem mutation is inside its generated root.
set -euo pipefail
umask 077
fixture_root=${1:?private root required}
metadata_socket=${2:?private PostgreSQL socket required}
node_bin=${3:?host test runner required}
test -x "${node_bin}"
test "$(id -u)" = 0
test "$$" = 1
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
fixture_root=$(realpath -e "${fixture_root}")
metadata_socket=$(realpath -e "${metadata_socket}")
case "${fixture_root}" in "${repository_root}/.cache/rust-runtime-"*/root) ;; *) exit 1 ;; esac
case "${metadata_socket}" in "${repository_root}/.cache/rust-tests."*/socket/.s.PGSQL.5432) ;; *) exit 1 ;; esac
test -S "${metadata_socket}"
chroot_bin=$(command -v chroot)
test -d "${fixture_root}/opt/kelryvo/bin"
runtime_pid=
namespace_pid=
controller_pid=
proxy_pid=
cleanup() {
  if [ -n "${runtime_pid}" ] && kill -0 "${runtime_pid}" 2>/dev/null; then
    kill -TERM "${runtime_pid}" 2>/dev/null || true
  fi
  if [ -n "${namespace_pid}" ]; then wait "${namespace_pid}" || true; fi
  for child in "${controller_pid}" "${proxy_pid}"; do
    if [ -n "${child}" ]; then kill -TERM "${child}" 2>/dev/null || true; wait "${child}" || true; fi
  done
}
trap cleanup EXIT INT TERM
trap 'printf "Native namespace smoke failed at line %s.\n" "${LINENO}" >&2' ERR
mount --make-rprivate /
chown -Rh 0:0 "${fixture_root}"
mount --bind "${fixture_root}/run/kelryvo/repositories" "${fixture_root}/run/kelryvo/repositories"
mount -o remount,bind,ro "${fixture_root}/run/kelryvo/repositories"
mount --bind "${metadata_socket}" "${fixture_root}/run/kelryvo/postgres/.s.PGSQL.5432"
mount --bind /dev/null "${fixture_root}/dev/null"
mount -t proc proc "${fixture_root}/proc"
ip link set lo up
for command in initialize seed-actors activate; do
  env -i PATH=/usr/bin:/bin LANG=C TZ=UTC "${chroot_bin}" "${fixture_root}" /opt/kelryvo/bin/kelryvo-operator "${command}"
done
! chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-watch /run/kelryvo/controller.json
! chroot --userspec=10002:10002 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-watch /run/kelryvo/controller.json
mkdir -m 700 "${fixture_root}/run/kelryvo/witness"
for volume in input metadata; do
  chmod 3777 "${fixture_root}/run/kelryvo/operator/${volume}"
  chmod 2755 "${fixture_root}/run/kelryvo/operator/${volume}/..2026"
done
# Native initialization validates external wallet privacy before creating state.
! chroot "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-init-state /var/lib/kelryvo/operator /opt/kelryvo/oracle
test ! -e "${fixture_root}/var/lib/kelryvo/operator/state"
chgrp -R 10002 "${fixture_root}/opt/kelryvo/oracle/wallet"
chmod 710 "${fixture_root}/opt/kelryvo/oracle/wallet"
chmod 440 "${fixture_root}/opt/kelryvo/oracle/wallet/cwallet.sso"
! chroot "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-init-state /var/lib/kelryvo/operator /opt/kelryvo/oracle
test ! -e "${fixture_root}/var/lib/kelryvo/operator/state"
chmod 750 "${fixture_root}/opt/kelryvo/oracle/wallet"
! chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-init-state /var/lib/kelryvo/operator /opt/kelryvo/oracle
! chroot --userspec=10002:10002 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-init-state /var/lib/kelryvo/operator /opt/kelryvo/oracle
env -i PATH=/usr/bin:/bin LANG=C "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
  --bounding-set=-all,+chown --no-new-privs \
  /opt/kelryvo/bin/kelryvo-worker installation-init-state /var/lib/kelryvo/operator /opt/kelryvo/oracle
test "$(stat -c %u:%g:%a "${fixture_root}/var/lib/kelryvo/operator/state")" = 0:0:700
test "$(stat -c %u:%g:%a "${fixture_root}/var/lib/kelryvo/operator/witness")" = 10002:10002:700
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -r /opt/kelryvo/oracle/wallet/cwallet.sso
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -r /opt/kelryvo/oracle/wallet
chroot --userspec=10002:10002 "${fixture_root}" /usr/bin/test -r /opt/kelryvo/oracle/wallet
chroot --userspec=10002:10002 "${fixture_root}" /usr/bin/test -r /opt/kelryvo/oracle/wallet/cwallet.sso
mount --bind "${fixture_root}/var/lib/kelryvo/operator/witness" "${fixture_root}/run/kelryvo/witness"
env -i PATH=/usr/bin:/bin LANG=C "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
  --bounding-set=-all,+chown,+kill,+setuid,+setgid --no-new-privs \
  /opt/kelryvo/bin/kelryvo-worker installation-init-witness /run/kelryvo/witness
test "$(stat -c %u:%g:%a "${fixture_root}/run/kelryvo/witness")" = 10002:10002:700
! chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-init-witness /run/kelryvo/witness
printf 'Retained witness; never erase on bootstrap or handoff.\n' >"${fixture_root}/run/kelryvo/witness/retained"
chown 10002:10002 "${fixture_root}/run/kelryvo/witness/retained"
env -i PATH=/usr/bin:/bin LANG=C "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
  --bounding-set=-all,+chown,+kill,+setuid,+setgid --no-new-privs \
  /opt/kelryvo/bin/kelryvo-worker installation-init-witness /run/kelryvo/witness
test -f "${fixture_root}/run/kelryvo/witness/retained"
# Init retries preserve witness bytes. Lost state beside it cannot be recreated.
chroot "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-init-state /var/lib/kelryvo/operator /opt/kelryvo/oracle
mv "${fixture_root}/var/lib/kelryvo/operator/state" "${fixture_root}/var/lib/kelryvo/operator/saved-state"
! chroot "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-init-state /var/lib/kelryvo/operator /opt/kelryvo/oracle
test ! -e "${fixture_root}/var/lib/kelryvo/operator/state"
mv "${fixture_root}/var/lib/kelryvo/operator/saved-state" "${fixture_root}/var/lib/kelryvo/operator/state"

if [ -f "${fixture_root}/opt/kelryvo/test/real-client-fixture" ]; then
  # Offline client initialization must work with the actual image libraries and
  # bootstrap capabilities, without reading a metadata credential or using OCI
  # from this parent. Every subsequent Oracle action still gets a fresh process.
  mv "${fixture_root}/run/kelryvo/operator/database-url" "${fixture_root}/run/kelryvo/operator/.offline-database-url"
  # Preserve the existing proc, device, witness, repository and socket mounts.
  mount --rbind "${fixture_root}" "${fixture_root}"
  mount -o remount,bind,ro "${fixture_root}"
  mount -t tmpfs -o mode=1777,size=32m tmpfs "${fixture_root}/tmp"
  env -i PATH=/usr/bin:/bin LANG=C DPI_DEBUG_LEVEL=64 KELRYVO_SECRET_DIR=/untrusted-selector \
    "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
    --bounding-set=-all,+chown,+kill,+setuid,+setgid --no-new-privs \
    /opt/kelryvo/bin/kelryvo-worker installation-client-check /run/kelryvo/operator/client-check-private/installation.json \
    >"${fixture_root}/tmp/client-check-result.json"
  "${node_bin}" -e 'const assert=require("node:assert/strict"),fs=require("node:fs");const result=JSON.parse(fs.readFileSync(process.argv[1]));assert.equal(result.status,"CLIENT_READY_NO_DATABASE");assert.equal(result.clientVersion,"23.26.4.0.0");assert.equal(result.oracleRuntimeVerified,false);assert.equal(result.executionAuthority,false);console.log("NATIVE_ORACLE_CLIENT_READY_NO_DATABASE");' "${fixture_root}/tmp/client-check-result.json"
  umount "${fixture_root}/tmp"
  mount -o remount,bind,rw "${fixture_root}"
  mv "${fixture_root}/run/kelryvo/operator/.offline-database-url" "${fixture_root}/run/kelryvo/operator/database-url"
  ! chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-client-check /run/kelryvo/operator/client-check-private/installation.json
  ! chroot --userspec=10002:10002 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker installation-client-check /run/kelryvo/operator/client-check-private/installation.json
fi

start() {
  discovery_enabled=${1:-false}
  execution_enabled=${2:-false}
  installation_directory=${3:-/run/kelryvo/installation}
  secret_directory=${4:-/run/kelryvo/secrets}
  env -i PATH=/usr/bin:/bin LANG=C TZ=UTC KELRYVO_UNUSED_SECRET=must-not-survive KELRYVO_PORT=8443 \
    KELRYVO_EXECUTION_ENABLED="${execution_enabled}" KELRYVO_DISCOVERY_ENABLED="${discovery_enabled}" \
    KELRYVO_INSTALLATION_DIR="${installation_directory}" \
    KELRYVO_SECRET_DIR="${secret_directory}" \
    unshare --mount --pid --fork --mount-proc="${fixture_root}/proc" --kill-child=SIGKILL \
    "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
    --bounding-set=-all,+chown,+kill,+setuid,+setgid --no-new-privs \
    /opt/kelryvo/bin/kelryvo-runtime &
  namespace_pid=$!
  runtime_pid=
  for ((attempt=0;attempt<100;attempt++)); do
    kill -0 "${namespace_pid}"
    if [ -r "/proc/${namespace_pid}/task/${namespace_pid}/children" ]; then
      read -r runtime_pid _ <"/proc/${namespace_pid}/task/${namespace_pid}/children" || true
      if [ -n "${runtime_pid}" ]; then return; fi
    fi
    sleep 0.01
  done
  return 1
}
stop_runtime() {
  kill -TERM "${runtime_pid}"
  wait "${namespace_pid}"
  runtime_pid=
  namespace_pid=
}
ready() {
  for ((attempt=0;attempt<100;attempt++)); do
    kill -0 "${runtime_pid}"
    if curl --silent --show-error --fail --max-time 1 --cacert "${fixture_root}/run/kelryvo/secrets/tls.crt" https://127.0.0.1:8443/api/readyz >"${fixture_root}/tmp/ready.json" 2>/dev/null; then
      grep -q '"status":"ready"' "${fixture_root}/tmp/ready.json"
      grep -q '"metadata":"ACTIVE"' "${fixture_root}/tmp/ready.json"
      return
    fi
    sleep 0.05
  done
  return 1
}
bridge_ready() {
  for ((attempt=0;attempt<100;attempt++)); do
    kill -0 "${runtime_pid}"
    if [ -S "${fixture_root}/run/kelryvo/runtime/bridge/discovery.sock" ] && [ "$(stat -c %a "${fixture_root}/run/kelryvo/runtime/bridge/discovery.sock")" = 666 ]; then return; fi
    sleep 0.05
  done
  return 1
}
chmod 3777 "${fixture_root}/run/kelryvo/projected-secrets"
chmod 2755 "${fixture_root}/run/kelryvo/projected-secrets/..2026"
start false false /run/kelryvo/not-yet-installed /run/kelryvo/projected-secrets/..data
ready
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -r /run/kelryvo/projected-secrets/..data/database-url
! chroot --userspec=10002:10002 "${fixture_root}" /usr/bin/test -r /run/kelryvo/projected-secrets/..data/database-url
test "$(stat -c %a "${fixture_root}/run/kelryvo/projected-secrets")" = 3777
test "$(stat -c %a "${fixture_root}/run/kelryvo/projected-secrets/..2026")" = 2755
stop_runtime
# The volume root itself never becomes a trusted source, and a writable
# non-sticky ancestor must still fail before any runtime restaging.
! env -i PATH=/usr/bin:/bin LANG=C KELRYVO_SECRET_DIR=/run/kelryvo/projected-secrets \
  "${chroot_bin}" "${fixture_root}" /opt/kelryvo/bin/kelryvo-runtime --prepare
chmod 777 "${fixture_root}/run/kelryvo/projected-secrets"
! env -i PATH=/usr/bin:/bin LANG=C KELRYVO_SECRET_DIR=/run/kelryvo/projected-secrets/..data \
  "${chroot_bin}" "${fixture_root}" /opt/kelryvo/bin/kelryvo-runtime --prepare
chmod 3777 "${fixture_root}/run/kelryvo/projected-secrets"
start true true /run/kelryvo/not-yet-installed
ready
bridge_ready
env -i PATH=/usr/bin:/bin LANG=C "${chroot_bin}" "${fixture_root}" /opt/kelryvo/test/runtime-probe metadata-proxy &
proxy_pid=$!
for ((attempt=0;attempt<100;attempt++)); do
  kill -0 "${proxy_pid}"
  if (echo >/dev/tcp/127.0.0.1/15432) 2>/dev/null; then break; fi
  sleep 0.02
done
chmod 700 "${fixture_root}/run/kelryvo/operator/input/..2026/policy.json"
! env -i PATH=/usr/bin:/bin LANG=C "${chroot_bin}" "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker \
  installation-watch /run/kelryvo/operator/input/..data/controller.json
chmod 400 "${fixture_root}/run/kelryvo/operator/input/..2026/policy.json"
env -i PATH=/usr/bin:/bin LANG=C "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
  --bounding-set=-all,+chown,+kill,+setuid,+setgid --no-new-privs \
  /opt/kelryvo/bin/kelryvo-worker installation-watch /run/kelryvo/operator/input/..data/controller.json \
  >"${fixture_root}/tmp/controller.log" 2>&1 &
controller_pid=$!
controller_ready=false
# Debug workers include a large grammar and symbols; controller startup hashes
# those artifacts before reporting status. Keep a bounded allowance under load.
for ((attempt=0;attempt<400;attempt++)); do
  kill -0 "${controller_pid}"
  if grep -q '"status":"WAITING_FOR_INSTANCE"' "${fixture_root}/tmp/controller.log"; then controller_ready=true; break; fi
  sleep 0.05
done
test "${controller_ready}" = true
! env -i PATH=/usr/bin:/bin LANG=C "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
  --bounding-set=-all,+chown,+kill,+setuid,+setgid --no-new-privs \
  /opt/kelryvo/bin/kelryvo-worker installation-watch /run/kelryvo/operator/input/..data/controller.json
test ! -e "${fixture_root}/run/kelryvo/operator/state/controller.json"
test -f "${fixture_root}/run/kelryvo/witness/retained"
ready
kill -TERM "${controller_pid}"
wait "${controller_pid}"
controller_pid=
kill -TERM "${proxy_pid}"
wait "${proxy_pid}" || true
proxy_pid=
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -w /run/kelryvo/repositories/customer/V001__customer.sql
chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/git --no-optional-locks \
  -c safe.directory=/run/kelryvo/repositories/customer -C /run/kelryvo/repositories/customer \
  rev-parse --verify HEAD >/dev/null
awk '{printf "header = \"Authorization: Bearer %s\"\n",$0}' "${fixture_root}/run/kelryvo/secrets/developer-token" | \
  curl --config - --silent --show-error --fail --cacert "${fixture_root}/run/kelryvo/secrets/tls.crt" \
  https://127.0.0.1:8443/api/repositories >"${fixture_root}/tmp/repositories.json"
grep -q '"id":"local-1"' "${fixture_root}/tmp/repositories.json"
grep -q '"name":"customer"' "${fixture_root}/tmp/repositories.json"
! grep -q '"path"' "${fixture_root}/tmp/repositories.json"
children=$(cat "/proc/${runtime_pid}/task/${runtime_pid}/children")
test "$(wc -w <<<"${children}")" = 2
for child in ${children}; do
  child_uid=$(awk '/^Uid:/{print $2}' "/proc/${child}/status")
  test "${child_uid}" = 10001 || test "${child_uid}" = 10002
  grep -q '^CapEff:[[:space:]]*0000000000000000$' "/proc/${child}/status"
  grep -q '^CapPrm:[[:space:]]*0000000000000000$' "/proc/${child}/status"
  grep -q '^NoNewPrivs:[[:space:]]*1$' "/proc/${child}/status"
done
test "$(awk '/^Uid:/{print $2}' "/proc/${runtime_pid}/status")" = 0
test "$(awk '/^NSpid:/{print $NF}' "/proc/${runtime_pid}/status")" = 1
grep -q '^CapEff:[[:space:]]*0000000000000020$' "/proc/${runtime_pid}/status"
grep -q '^CapPrm:[[:space:]]*0000000000000020$' "/proc/${runtime_pid}/status"
grep -q '^NoNewPrivs:[[:space:]]*1$' "/proc/${runtime_pid}/status"
! tr '\0' '\n' <"/proc/${runtime_pid}/environ" | grep -q 'KELRYVO_UNUSED_SECRET='
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -r /run/kelryvo/secrets/database-url
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -x /run/kelryvo/runtime/execution
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -r "/proc/${runtime_pid}/environ"
chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -r /run/kelryvo/runtime/api/secrets/database-url
! env -i PATH=/usr/bin:/bin LANG=C KELRYVO_SECRET_DIR=/run/kelryvo/runtime/api/secrets \
  "${chroot_bin}" --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/bin/kelryvo-server --initialize
chroot --userspec=10002:10002 "${fixture_root}" /usr/bin/test -x /run/kelryvo/runtime/execution
chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/test/runtime-probe socket-allowed
chroot --userspec=10003:10003 "${fixture_root}" /opt/kelryvo/test/runtime-probe socket-denied
curl --silent --show-error --fail --cacert "${fixture_root}/run/kelryvo/secrets/tls.crt" https://127.0.0.1:8443/ >"${fixture_root}/tmp/index.html"
grep -q 'bootstrap.js' "${fixture_root}/tmp/index.html"
curl --silent --show-error --fail --cacert "${fixture_root}/run/kelryvo/secrets/tls.crt" https://127.0.0.1:8443/app_bg.wasm >"${fixture_root}/tmp/app.wasm"
test "$(od -An -N4 -tx1 "${fixture_root}/tmp/app.wasm" | tr -d ' \n')" = 0061736d
env -i PATH=/usr/bin:/bin LANG=C TZ=UTC "${node_bin}" "${repository_root}/scripts/test-rust-governance.mjs" "${fixture_root}"
env -i PATH=/usr/bin:/bin LANG=C TZ=UTC "${chroot_bin}" "${fixture_root}" /usr/bin/setpriv \
  --bounding-set=-all,+chown,+kill,+setuid,+setgid --no-new-privs \
  /opt/kelryvo/bin/kelryvo-runtime --prepare
chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/test/runtime-probe socket-allowed
stop_runtime
for child in ${children}; do test ! -d "/proc/${child}"; done
start true
ready
bridge_ready
chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/test/runtime-probe socket-allowed
test "$(stat -c %u "${fixture_root}/run/kelryvo/runtime/discovery/observer-fixture")" = 10002
test "$(stat -c %a "${fixture_root}/run/kelryvo/runtime/discovery/observer-fixture")" = 600
! chroot --userspec=10001:10001 "${fixture_root}" /usr/bin/test -r /run/kelryvo/runtime/discovery/observer-fixture
chroot --userspec=10002:10002 "${fixture_root}" /usr/bin/test -r /run/kelryvo/runtime/discovery/observer-fixture
! chroot --userspec=10001:10001 "${fixture_root}" /opt/kelryvo/bin/kelryvo-worker discovery-child
stop_runtime
printf 'NATIVE_RUNTIME_PASS\n'
