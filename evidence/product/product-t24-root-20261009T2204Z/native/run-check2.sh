#!/usr/bin/env bash
set -uo pipefail
name=check-retry
command='SCHEMAFORGE_JAVA_HOME=/home/longhn0710/workspace/schemaforge/.cache/licenses/runtime/temurin SCHEMAFORGE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:32768/schemaforge_tests SCHEMAFORGE_REQUIRE_PRODUCT_TESTS=1 taskset -c 0,1 npm run check'
printf '%s\n' "$PWD" > "/tmp/schemaforge-t24-native-20261010/${name}.cwd"
printf '%s\n' "$command" > "/tmp/schemaforge-t24-native-20261010/${name}.command"
date -u +'%Y-%m-%dT%H:%M:%SZ' > "/tmp/schemaforge-t24-native-20261010/${name}.start.utc"
set +e
eval "$command" > "/tmp/schemaforge-t24-native-20261010/${name}.raw.log" 2>&1
result=$?
set -e
printf '%s\n' "$result" > "/tmp/schemaforge-t24-native-20261010/${name}.exit"
date -u +'%Y-%m-%dT%H:%M:%SZ' > "/tmp/schemaforge-t24-native-20261010/${name}.end.utc"
sha256sum "/tmp/schemaforge-t24-native-20261010/${name}.raw.log" > "/tmp/schemaforge-t24-native-20261010/${name}.raw.sha256"
wc -c < "/tmp/schemaforge-t24-native-20261010/${name}.raw.log" > "/tmp/schemaforge-t24-native-20261010/${name}.raw.bytes"
cat "/tmp/schemaforge-t24-native-20261010/${name}.raw.log"
exit "$result"
