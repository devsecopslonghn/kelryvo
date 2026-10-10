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

The bounded T31 approval-withdrawal contract keeps the original approval immutable and
appends a linked revocation while projecting the plan lifecycle as REVOKED. New approvals
have a server-issued reference linked to their approval audit; legacy NULL references are
explicit and never inferred from history. Withdrawal requires a current independent
approver, explicit project membership and an active project after lifecycle serialization.
It can remove authority from stale or damaged offline content without rewriting the
release, intent or NOT_EXECUTED/NOT_OBSERVED history. Corrections create a fresh release
and plan. This control-plane contract does not supply queued-job admission, worker HOLD
or rollback of committed effects; those remain execution acceptance requirements.
