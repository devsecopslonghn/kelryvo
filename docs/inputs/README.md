# Versioned research inputs

The 43 files under `db-research/` were copied byte-for-byte from DB-Research's authored
product research, implementation documents and evidence-reference registers. Upstream
source snapshots, POC implementations, validation scripts and UI assets were excluded.

`provenance.json` records the source repository, branch, HEAD, pre-existing Git status,
relative source and destination paths, byte sizes and SHA-256 digests. The product research
was uncommitted at import; source HEAD alone does not identify this snapshot. These inputs
are the user-supplied baseline; no independent approval or runtime acceptance is inferred.

Start with:

- [Feature catalog](db-research/product-research/feature-catalog.json): 220 stable IDs.
- [Refined MVP and Walking Skeleton](db-research/product-research/implementation/MVP-REFINEMENT.md).
- [Architecture decisions](db-research/product-research/implementation/ARCHITECTURE-DECISIONS.md).
- [Data contracts](db-research/product-research/implementation/DATA-CONTRACTS.md).
- [Implementation backlog](db-research/product-research/implementation/implementation-plan.json):
  64 tasks, 63 WP0 cases, and the 95 refined MVP feature assignments.
- [WP0 test plan](db-research/product-research/implementation/WP0-TEST-PLAN.md) and
  [acceptance matrix](db-research/product-research/implementation/WP0-ACCEPTANCE-MATRIX.md).
- [Evidence references](db-research/product-research/evidence/source-references.json) and
  [license restrictions](db-research/product-research/LICENSE-COMPLIANCE.md).

Links within original documents preserve their original provenance. References to excluded
validation scripts or upstream snapshots are resolved in DB-Research, not product code.
Never rewrite the snapshot to make a status look current. Product state and actual new
evidence belong in `docs/implementation/` and `evidence/` respectively.
