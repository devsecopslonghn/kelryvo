# Offline T03 evidence

This run verifies the bounded parser task increment, not Oracle or product acceptance.
31 immutable fixture files pass (14 groups, 30 variants); independent real-helper tests 4/4;
63 local tests pass; two clean offline builds match the pinned helper SHA.

`independent-corpus.json` is the pure machine-readable command result.
`parser-corpus.json` and `parser-build.json` preserve full raw npm stdout, including banners;
parse the final result portion if consuming them. All hashes measure raw output bytes.
`integration.txt` and check logs are sanitized TAP/check output, never SQL logs.
The earlier review stages remain; integration-review.json is the current review summary.

The initial WP0-T03-INTEGRATION.json used harness file references where the tracker only
accepts task case references. Validator rejected it; it remains unindexed history. The
CORRECTED record carries general check scope and no unsupported test/case coverage claim.
After correction, all source/tracker/JSON/tests/dependency checks pass (tracker-checks.txt).
No source SQL, credentials, connections or simulated Oracle success is retained.

Thirteen pure parser unit cells PASS; opaque transaction classification WP0-03-13 is NOT_RUN.
All 124 applicable Oracle cells remain BLOCKED. Every helper/release result denies execution
and production approval. The original Flyway 11-mismatch evidence remains unchanged.
