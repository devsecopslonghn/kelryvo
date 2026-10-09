# Offline npm dependency evidence

`scripts/dependency-artifacts.mjs` measures the selected npm install from `package-lock.json` and verifies that an offline install can be reproduced from the local npm cache. It does not fetch missing packages or run dependency lifecycle scripts.

## Commands

After `npm ci --ignore-scripts --no-audit --no-fund` has installed the exact lockfile closure, create a deterministic manifest:

```sh
node scripts/dependency-artifacts.mjs manifest
```

The command writes JSON to stdout. To retain a new, non-overwriting evidence record, use a unique run directory under `evidence/db-devops-wp0/`:

```sh
node scripts/dependency-artifacts.mjs manifest \
  --output evidence/db-devops-wp0/npm-20261008T103000Z/npm-closure.json
```

Verify a retained manifest against the current lockfile, installed package bytes, and npm cache:

```sh
node scripts/dependency-artifacts.mjs verify \
  --manifest evidence/db-devops-wp0/npm-20261008T103000Z/npm-closure.json
```

Prove that a clean temporary staging directory can install from cache and run the assigned import/compiler smoke check:

```sh
node scripts/dependency-artifacts.mjs offline-check \
  --smoke experiments/db-devops-wp0/dependencies/smoke.mjs \
  --output evidence/db-devops-wp0/npm-20261008T103000Z/offline-install.json
```

The optional `--cache PATH` selects the npm cache explicitly. `npm ci` always receives `--offline --ignore-scripts --no-audit --no-fund`; an absent or invalid cached tarball fails closed with an install blocker. No registry fallback is allowed. The staging directory is created under the OS temporary directory, receives only `package.json`, `package-lock.json`, and the named smoke script, then is removed after the result is captured.

## What the manifest measures

The manifest records exact `package.json` and lockfile SHA-256 digests, Node/npm versions, platform and architecture, and each installed lock entry's name/version/path. For each package it hashes all installed regular-file paths and bytes into a deterministic package-tree digest, records the package manifest digest, and hashes each license/NOTICE-named file found in that package. It also reads the npm content-addressed cache blob selected by the lockfile SRI value, verifies those bytes against the SRI metadata, and records the actual tarball SHA-256 and byte length. Cache tarball bytes are never copied into the manifest or staging directory.

Packages missing from the current installation are accepted only when their lock entry is marked optional; these are reported as omitted for the current platform. Workspace links, unexpected installed packages, missing required packages, package identity/license metadata mismatches, missing cache blobs, and digest changes fail the check.

The lockfile's package `license` field and installed `package.json` declaration are reported/compared as metadata. License-named files are measured but not interpreted as a grant. Every row remains `REQUIRES_INDEPENDENT_REVIEW`; this tool does not establish license compatibility, NOTICE completeness, source rights, maintenance ownership, or full distribution closure. The security/license reviewer owns that decision. The independently authored product now uses PolyForm Shield 1.0.0; third-party rights and full distribution closure remain separate.

The offline smoke imports node-oracledb Thin, PostgreSQL client, and the pinned TypeScript compiler; it checks positive and negative TypeScript fixtures. It makes no database call, resolves no credential, and does not initialize Thick mode. A successful smoke is local dependency evidence only, not Oracle compatibility, migration-parser acceptance, or WP0 completion.

## Candidate Java build and compatibility

The exact Flyway runtime and seven Maven plugin roots, including 90 build dependencies,
are audited in `docs/dependencies/`. The selected Linux x64 archives are Node 22.23.3
(npm 10.9.9), Temurin 21.0.12.1+1 and Maven 3.9.16. Their public download URLs and measured
checksums are in `third-party-notices.json`. Keep downloaded archives, extracted runtimes
and Maven repository bytes in ignored `.cache/`; none are shipped in this repository.

After downloading and checking these exact archives, extract Temurin to
`.cache/licenses/runtime/temurin` and Maven to `.cache/licenses/runtime/maven/extracted`.
Retain the original archives at the paths used by `scripts/parser-build.mjs`. Hydrate the
helper's dependency/plugin cache from the public, pinned Maven coordinates before going
offline:

```sh
JAVA_HOME="$PWD/.cache/licenses/runtime/temurin" \
  .cache/licenses/runtime/maven/extracted/bin/mvn \
  -f experiments/db-devops-wp0/parser-helper/pom.xml \
  -Dmaven.repo.local="$PWD/.cache/parser/m2" -DskipTests package dependency:resolve-plugins
npm run parser:build:offline
npm run parser:corpus
```

`parser:build:offline` checks the measured plugin/runtime JAR/POM digests and toolchain
archive hashes, then performs two clean Maven builds with `-o`. It requires identical JAR
hashes matching the frozen candidate. Missing artifacts stop the command without a network
fallback. The complete POM cache lock records inherited build metadata as well as JARs.

`parser:corpus` evaluates 14 groups and 30 original variants, including malformed UTF-8,
SQL*Plus commands, comments, PL/SQL, byte-sensitive LF/CRLF and a later malformed release
file. It currently exits **1**, recording 11 compatibility mismatches. Its output includes
fixture digests and denies execution approval for every variant. Successful individual
goldens do not approve this profile. See [parser findings](../architecture/parser-feasibility.md).

## Reviewed ANTLR offline parser

The driver-free successor uses pinned, unchanged licensed grammar sources, ANTLR4 4.13.2,
Temurin 21.0.12.1+1, and direct Java tools. No extra Maven/plugin dependencies are introduced.
For a fresh Linux x64 checkout, explicit public build-input preparation is:

```sh
npm run parser:antlr:prepare
export SCHEMAFORGE_JAVA_HOME="$PWD/.cache/antlr/temurin"
npm run parser:antlr:build
npm run parser:antlr:corpus
npm run parser:antlr:test
```

Preparation downloads only fixed official URLs, verifies hashes before installation and
refuses symlink parents or an existing extracted JDK destination. Reuse an existing verified
external JDK via SCHEMAFORGE_JAVA_HOME. Builds use only cached tool/runtime bytes, verify
source/license/notice pins and exact JDK version, and compare two independent fixed-date JARs.
Changed source hashes or missing caches stop before build; digest mismatch preserves the
installed pinned helper. Runtime and generator are separate, and JDK is never bundled.

The ANTLR corpus exits 0 with 31 exact goldens; four integration tests exercise additional
REM, CRLF slash, supplementary Unicode, numeric/join and late-release failure boundaries.
Only sanitized hashes/ranges/counts are retained. Direct Java helper stdout carries SQL;
use the bounded parent, which returns only digests and generic outcomes. Oracle connectivity,
object validity and crash-safe effects remain untested and blocked.
