Adds read-only comparison of two retained releases in one project, showing added, removed, changed and unchanged SQL files with explicit immutable source identities. Both sources pass scoped locked integrity checks and complete PostgreSQL metadata bounds before either payload is loaded. Pair/project/session changes discard delayed results.

This is a **draft stacked on unmerged PR #37**, reviewed head `2f3147fd57cfa726bfe7253f4947e321c1c747ef`. Local verification: standard 162/162, real PostgreSQL/Git/parser product 37/37, browser 22/22; independent QA API 2/2, browser 1/1, integrity 1/1, all zero skips. Independent security and license review approves this corrected comparison scope. Native tests ran with corrected working files at earlier HEAD; all seven frozen source hashes match this committed head. Original failed attempts and blocked pre-correction head remain preserved.

**Open follow-up SEC-RETAINED-METADATA-02 (medium)** affects four existing adjacent retained-source readers under privileged database corruption. T26 complete metadata preflight hardening takes priority before inbox work; this PR does not close that finding.

Publication scan: 741 paths, exit 1/102 findings; all-refs history exit 1/217. Exact provenance independently classified benign recorded prose and recomputed source/artifact digests; no actual credential observed or rotation indicated. These are findings-bearing scans, not clean PASS. No scanner exceptions or public history rewrite.

Required GitHub code scanning (403), secret scanning (404) and protection inspection (403) remain unavailable in fresh observation. No readiness, merge or gate bypass is authorized by these local results. Existing Sonar quota exception remains Sonar-only: unavailable never PASS. Oracle VALIDATION remains separate and BLOCKED. No execution, target connection or full catalog acceptance claim.

Local evidence: `evidence/product/product-t25-corrected-root-20261010T0107Z/integration-record.json`. Exact-head review and publication proof will be preserved in the continuation record.
