#!/usr/bin/env bash
set -euo pipefail
run_capture() {
  local name="$1"
  shift
  printf '%s\n' "$PWD" > "/tmp/schemaforge-t24-native-20261010/${name}.cwd"
  printf '%s ' "$@" > "/tmp/schemaforge-t24-native-20261010/${name}.command"
  printf '\n' >> "/tmp/schemaforge-t24-native-20261010/${name}.command"
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "/tmp/schemaforge-t24-native-20261010/${name}.start.utc"
  if "$@" > "/tmp/schemaforge-t24-native-20261010/${name}.raw.log" 2>&1; then result=0; else result=$?; fi
  printf '%s\n' "$result" > "/tmp/schemaforge-t24-native-20261010/${name}.exit"
  date -u +'%Y-%m-%dT%H:%M:%SZ' > "/tmp/schemaforge-t24-native-20261010/${name}.end.utc"
  sha256sum "/tmp/schemaforge-t24-native-20261010/${name}.raw.log" > "/tmp/schemaforge-t24-native-20261010/${name}.raw.sha256"
  wc -c < "/tmp/schemaforge-t24-native-20261010/${name}.raw.log" > "/tmp/schemaforge-t24-native-20261010/${name}.raw.bytes"
  printf '%s exit=%s start=%s end=%s raw=%s bytes=%s\n' "$name" "$result" "$(cat "/tmp/schemaforge-t24-native-20261010/${name}.start.utc")" "$(cat "/tmp/schemaforge-t24-native-20261010/${name}.end.utc")" "$(cut -d ' ' -f 1 "/tmp/schemaforge-t24-native-20261010/${name}.raw.sha256")" "$(cat "/tmp/schemaforge-t24-native-20261010/${name}.raw.bytes")"
  if [ "$result" -ne 0 ]; then exit "$result"; fi
}
source_files=(apps/api/index.ts packages/database/index.ts packages/audit/cursor.mjs apps/web/src/app.jsx tests/audit-cursor.test.mjs tests/product-audit-pages.test.mjs tests/product-audit-pages-browser.integration.mjs scripts/test-product.mjs docs/development/local-product.md)
date -u +'%Y-%m-%dT%H:%M:%SZ' > /tmp/schemaforge-t24-native-20261010/source-before.utc
sha256sum "${source_files[@]}" > /tmp/schemaforge-t24-native-20261010/source-before.sha256
run_capture final-check env SCHEMAFORGE_JAVA_HOME=/home/longhn0710/workspace/schemaforge/.cache/licenses/runtime/temurin SCHEMAFORGE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:32768/schemaforge_tests SCHEMAFORGE_REQUIRE_PRODUCT_TESTS=1 taskset -c 0,1 npm run check
run_capture final-product env SCHEMAFORGE_JAVA_HOME=/home/longhn0710/workspace/schemaforge/.cache/licenses/runtime/temurin SCHEMAFORGE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:32768/schemaforge_tests SCHEMAFORGE_REQUIRE_PRODUCT_TESTS=1 taskset -c 0,1 npm run test:product
run_capture final-browser env SCHEMAFORGE_JAVA_HOME=/home/longhn0710/workspace/schemaforge/.cache/licenses/runtime/temurin SCHEMAFORGE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:32768/schemaforge_tests SCHEMAFORGE_REQUIRE_PRODUCT_TESTS=1 taskset -c 0,1 npm run test:browser
date -u +'%Y-%m-%dT%H:%M:%SZ' > /tmp/schemaforge-t24-native-20261010/source-after.utc
sha256sum "${source_files[@]}" > /tmp/schemaforge-t24-native-20261010/source-after.sha256
