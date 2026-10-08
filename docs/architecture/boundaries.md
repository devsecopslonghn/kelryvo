# Initial architecture boundaries

The imported ADR-I01 through ADR-I14 and data contracts are design inputs. Phase 0 accepts
their safety boundaries; it does not accept an execution architecture or certify a driver.

The proposed control plane is a modular TypeScript API with PostgreSQL metadata. A separate
worker owns admitted Oracle execution and owner-scoped credential resolution. The API must
not possess application writer secrets. A React UI follows stable contracts and working
CLI/API flows. Kubernetes/OpenShift delivery follows later operating acceptance.

WP0 experiments live under `experiments/db-devops-wp0/`. Foundation tooling uses Node's
standard library and carries no third-party runtime dependency. This is a tooling choice,
not selection of the product's Oracle worker language or framework. No API, worker, web,
database or Helm placeholders are created before there is an accepted implementation slice.

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
