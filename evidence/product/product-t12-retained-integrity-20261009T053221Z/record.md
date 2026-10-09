# SF-PRODUCT-T12 retained release integrity

Run date: 2026-10-09 UTC  
Worktree: `/home/longhn0710/workspace/schemaforge-product-release-integrity`  
Branch: `development/product-release-integrity`  
Base: `a81f8b7a2e66b2693e1775386fa1624dab3749c9`  
Scope: offline retained UTF-8 release verification before plan persistence.

## Outcome

Plan creation now reads the scoped project, release, and profile inside one PostgreSQL transaction. It locks the project row first and the release row second, checks the retained UTF-8 bytes and format-1 manifest, then creates plan, history, and audit rows. Verification failures return `RELEASE_INTEGRITY_FAILED`; the browser shows fixed integrity guidance. The existing format-1 file property order is retained. The checker does not read Git or call the parser.

The test harness imports a real local Git release and verifies content, byte length, SHA-256, manifest digest, malformed metadata, unchanged full plan/history/audit snapshots, authenticated and foreign-project references, archived-project behavior, a deterministic release-row lock race, and valid planning after removing repository registration. Browser coverage verifies the fixed feedback and unchanged database snapshots. Two API and two browser legacy fixtures now contain valid format-1 releases so their preexisting plan assertions remain representative.

## Commands and results

Commands were run in sequence with the supplied PostgreSQL test service and the Temurin runtime.

- `SCHEMAFORGE_JAVA_HOME=/home/longhn0710/workspace/schemaforge/.cache/licenses/runtime/temurin SCHEMAFORGE_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:32768/schemaforge_tests npm run check` — PASS. Build, typecheck, source checks, lint/tracker validation, formatting, all 142 tests (142 passed, zero skipped), dependency smoke, and product dependency closure passed. Raw output: `npm-check-final.txt`.
- Same environment, `npm run test:product` — PASS, 22 passed, zero skipped. Raw output: `product-final.txt`.
- Same environment, `npm run test:browser` — PASS, 10 passed, zero skipped. Raw output: `browser-final.txt`.
- Same environment, `node --test --test-concurrency=1 tests/product-release-integrity-browser.integration.mjs` — PASS, 1 passed, zero skipped; this focused run confirmed the browser’s complete plan/history/audit snapshots. Its exact result appeared in the session output; the full browser output including this case is retained in `browser-final.txt`.
- `git diff --check` — PASS.

`scripts/test-product.mjs` initializes the disposable demo repository before starting Node’s parallel-capable runner and runs each test file serially. Serial execution avoids concurrent parser/browser pressure and makes the existing cold fixture behavior deterministic; it does not alter parser limits or semantics.

## Captured failures and limitations

Several early attempts failed while implementation and fixtures were still being repaired. Those commands were not tee'd to persistent raw logs: the first log destination did not yet exist, and a later check without `SCHEMAFORGE_TEST_DATABASE_URL` was stopped after product tests began skipping. An early parser test attempt also ran before the ignored ANTLR runtime dependency had been copied from the designated cache. After cache reuse, old synthetic VALID release fixtures failed the new integrity contract; these were updated to valid retained snapshots. An initial parallel browser run exposed the same invalid-fixture incompatibility and parser contention; the final browser run uses serial files and passed. These initial failures are disclosed here, but no exact raw failure transcript is claimed or reconstructed.

The check covers retained UTF-8 text only. It does not claim arbitrary original raw-byte or BOM provenance, database tamper-proofing, Oracle behavior, worker execution, or complete GIT-007 acceptance. No Oracle connection, production service, or external infrastructure was used.

## SHA-256

Final source hashes:

```text
91bae252e75dbc8c11fccb04ea8360460c0955e9ed55ab1acc97e0612952d97f  apps/api/index.ts
4193359c82b6920bab70b07409ceff954b0f77631c058cf3d6656839b394e567  apps/web/src/app.jsx
8c51289e01eb0040ca03385bac6d3c0fac04999fb13b8dd89da713dc0371e525  docs/development/local-product.md
d1e71f19eb993dc0087084c1b7514ab09df0e2e5c51693755bd0e44362b4f700  packages/migrations/verify-retained-release.mjs
57971269dd60115c97eb998b55d4278452768284c7c9acf801557c5a0f78d789  scripts/test-product.mjs
0639aab4de337133e5002e8cd9240847bf953adbea3adc1d94b512057f903265  tests/product-archive.test.mjs
6772758aa8e9ca46e596d16c550e7046ae09bf925aad4367a9e1701638c02bfe  tests/product-audit-action-filters-browser.integration.mjs
74842c469c98d49be5a085af13b47d3fbd320c09d63395c949c44a2063617c30  tests/product-release-integrity-browser.integration.mjs
67e471cda8616eee875f8db4d40766b9e87a03ce14fb96d11bac4b6d78afba8c  tests/product-release-integrity.test.mjs
1c3c1e0c36090775a25eb1123d9f32624ff4bd12943a0b4e4c4d14d50b58220c  tests/product-review-audit.test.mjs
34a1dc7c82875d09a3951cc9f1f3e997480016339513c541f33c347675ba34d1  tests/product-status-filters-browser.integration.mjs
```

Captured final logs:

```text
45c0bfbbdc9acf340af740c11a7c418f72f68611afa3b3fc100e16d5b829454c  npm-check-final.txt
23cc97556343b44d324ef0bf471681399cfa53ba35b40d9fc7194051a480cbb7  product-final.txt
f1e1c34235251c20823aa12ac47669c68626e1eb69172f3bb3d3e5d84e4b0618  browser-final.txt
```
