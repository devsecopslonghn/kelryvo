# Initial architecture boundaries

The imported ADR-I01 through ADR-I14 and data contracts are design inputs. Phase 0 accepts
their safety boundaries; it does not accept an execution architecture or certify a driver.

The proposed control plane is a modular TypeScript API with PostgreSQL metadata. A separate
worker owns admitted Oracle execution and owner-scoped credential resolution. The API must
not possess application writer secrets. A React UI uses the same-origin API and working PostgreSQL-backed flows.
The owner-approved local PRODUCT slice uses TypeScript/Fastify, React, existing Postgres.js
and pinned ANTLR offline validation; it carries no Oracle execution entry point. Kubernetes/OpenShift delivery follows later operating acceptance.

WP0 experiments live under `experiments/db-devops-wp0/`. Foundation tooling uses Node's
standard library and carries no third-party runtime dependency. This is a tooling choice,
not selection of the product's Oracle worker language or framework. Create API/web/database code with working product slices and local acceptance.
Worker and Helm deployment stay behind their actual runtime/operating acceptance.

Later code locations are `apps/api`, `apps/web`, `apps/worker`, `packages/contracts`,
`packages/database`, `packages/oracle` and `deploy/helm`. Create each only with working code
and appropriate acceptance checks. Shared immutable release/approval/target identity
contracts remain owned by the orchestrator.

Candidate Node Thin connectivity and a driver-free mature Flyway Apache parser helper
remain WP0-T02/T03 proof targets. No custom Oracle grammar or semicolon/regex splitter is
permitted. Oracle DDL result ambiguity always requires HOLD and observation; no receipt
absence, timeout, central lease or parser success proves safe automatic replay.

Disposable Oracle targets require explicit identity, entitlement, scoped actions and
teardown authority. Offline tests cannot prove grants, locks, compiler state, target
effects, restoration, API authorization or production capacity.

Development scheduling and original acceptance dependencies are separate (SF-D008).
The local product uses one server-owned organization, private named local bearer identities,
allowlisted read-only local Git repositories and loopback binding. It stores only target
credential references; no target credentials are resolved. Offline candidate plans retain
NOT_OBSERVED target history and NOT_EXECUTED migration states. They are reviewable proposals,
not reconciled executable plans or verified Oracle compatibility. See
[local product operation](../development/local-product.md).

Shared target references use a separate organization-owned metadata catalog. Only the
trusted local OS operator registers manual database/container/service/schema references
and changes their project ownership; project credentials provide scoped read access.
These references retain manual provenance and provisional identity. Registration UUIDs,
declared environments and exact owner names are not observed Oracle identities or DBA
attestations. Ownership changes preserve assignment history and existing project facts.
Legacy connection profiles and offline plans remain separate; attaching a reference to
an executable target requires verified identity, scoped credentials, assignment revisions
and the worker's actual authorization and history checks.
