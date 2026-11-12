#!/usr/bin/env bash
# Native Docker build prerequisite only. No rustup, moving channel or remote
# install script; each component archive is checked against reviewed pins.
set -euo pipefail
architecture=${1:?amd64 or arm64 required}
case "${architecture}" in amd64|arm64) ;; *) exit 1 ;; esac
mode=${2:-install}
case "${mode}" in install|--list) ;; *) exit 1 ;; esac
repository_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
archive_rows=$(python3 - "${repository_root}/docs/dependencies/rust-toolchain.json" "${architecture}" <<'PY'
import json,re,sys
p=json.load(open(sys.argv[1]));platform=p['platforms'][sys.argv[2]]
assert p['format']==1 and p['version']=='1.99.1' and p['wasmBindgenCli']=='0.2.130'
assert len(platform['archives'])==4
for a in platform['archives']:
    assert a['component'] in ['rustc','cargo','rust-std']
    assert a['target'] in [platform['triple'],'wasm32-unknown-unknown']
    assert a['url']==f"https://static.rust-lang.org/dist/{p['date']}/{a['component']}-{p['version']}-{a['target']}.tar.xz"
    assert re.fullmatch('[a-f0-9]{64}',a['sha256'])
    print(a['sha256']+'\t'+a['url'])
PY
)
if [ "${mode}" = --list ]; then
  printf '%s\n' "${archive_rows}"
  exit 0
fi
test "$(id -u)" = 0
test ! -e /opt/rust/bin/rustc
toolchain_stage=$(mktemp -d /tmp/kelryvo-rust.XXXXXXXX)
cleanup() { rm -rf -- "${toolchain_stage}"; }
trap cleanup EXIT INT TERM
while IFS=$'\t' read -r checksum url; do
  archive=${url##*/}
  curl --proto '=https' --tlsv1.2 --fail --location --retry 2 --max-time 300 --output "${toolchain_stage}/${archive}" "${url}"
  printf '%s  %s\n' "${checksum}" "${toolchain_stage}/${archive}" | sha256sum --check --status
  tar -xJf "${toolchain_stage}/${archive}" -C "${toolchain_stage}"
  bash "${toolchain_stage}/${archive%.tar.xz}/install.sh" --prefix=/opt/rust --disable-ldconfig
done <<<"${archive_rows}"
test "$(/opt/rust/bin/rustc --version | cut -d ' ' -f 2)" = 1.99.1
test "$(/opt/rust/bin/cargo --version | cut -d ' ' -f 2)" = 1.99.1
test -d /opt/rust/lib/rustlib/wasm32-unknown-unknown/lib
