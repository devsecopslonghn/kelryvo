# Kelryvo

Kelryvo is a self-hosted, Oracle-first Database DevOps platform. The runnable product combines a TypeScript/Fastify API, React browser app and PostgreSQL metadata.

**Start with [product requirements, current capabilities and roadmap](docs/product/KELYRVO_PRODUCT_REQUIREMENTS.md).** It is the authoritative product document, including the instance master credential architecture. The [next-session entry](docs/implementation/CURRENT.md) links the implementation and safety guides.

Connect one Oracle instance credential reference, discover schemas and assign several
of them to a project. Author or import SQL, validate scope, prepare a retained plan,
obtain independent approval, execute through the trusted worker and inspect immutable
history and audit. Credential changes stale old authority without rewriting evidence.

Automatic SQL is restricted to a conservative schema DDL subset; approval cannot
override scope denial. Live Oracle evidence is limited to the explicitly attested
disposable Oracle Free PDB lab and tested statements. Production installation, other
versions/topologies and the full fault/recovery matrix require separate acceptance.
The API alone cannot install execution authority. See the product requirements and
[Oracle acceptance guide](docs/development/oracle-acceptance.md) for exact boundaries.

## Development

Use Node 22.23.3, npm 10.9.9 and Python 3.11+:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
```

Offline checks need no database credentials; optional database/parser cases may skip. [Testing guidance](docs/development/testing.md) explains full PostgreSQL/API, Chromium and source-installation acceptance. Tracker status preserves original catalog acceptance and must not be read as a delivered-feature percentage.

## Run locally

Requires Git, Docker and Linux x64 for the pinned parser preparation:

```sh
npm run local:prepare
npm run dev
```

Open **https://127.0.0.1:4317**. Startup creates an installation-specific local certificate and a random initial `admin` password in the owner-private `.cache/local-product/bootstrap-admin.json`. Trust `.cache/local-product/tls/server.crt`, retrieve the password through your private operator channel, sign in as `admin` and change it. Use **Identity administration** to create users/groups and assign project and environment roles. Projects created by managed administrators explicitly grant them owner access; independent approval remains the default. Preparation obtains pinned parser tools and the PostgreSQL image; target database credentials remain references.

To use your own trusted loopback certificate instead of the generated local certificate, supply its certificate/private key with the private permissions documented in the [local product guide](docs/development/local-product.md):

```sh
npm run dev -- --tls-cert /absolute/private/tls/server-chain.pem --tls-key /absolute/private/tls/server-key.pem
```

Open **https://127.0.0.1:4317**. HTTPS uses revocable Secure/HttpOnly cookies, CSRF protection and expiry. The guide covers operator provisioning, API contracts, workflow, shutdown and current boundaries. No startup command authorizes Oracle access.

## Repository guide

| Path | Purpose |
| --- | --- |
| [Product requirements](docs/product/KELYRVO_PRODUCT_REQUIREMENTS.md) | Current state, stable requirement IDs, remaining backlog, priority and acceptance criteria |
| [Architecture contracts](docs/architecture/KELYRVO_ARCHITECTURE_DECISIONS.md) | Ownership, target identity, migration safety and compatibility decisions |
| [UI conventions](docs/product/KELYRVO_UI_UX_DESIGN_SPECIFICATION.md) | Shared interactions and accessibility requirements |
| `docs/development/` | Concrete API, test, runtime, release and Oracle acceptance guides |
| [Retained tracker](docs/implementation/tracking.md) | Original catalog/task contracts, immutable evidence references and Oracle case gates |
| `apps/api`, `apps/web`, `apps/worker`, `packages/` | Product implementation |
| `scripts/`, `tests/`, `.github/workflows/` | Tooling and local/hosted acceptance |
| `docs/decisions/`, `docs/dependencies/` | Decision history, pinned dependencies, licenses and notices |
| `docs/inputs/`, `experiments/db-devops-wp0/`, `evidence/` | Immutable historical inputs, isolated feasibility harness and append-only observations |

Historical MVP, Phase 1 and design handoff documents are dated references, not active work queues. Git history preserves removed obsolete planning. Keep original evidence and safety contracts intact.

[CONTRIBUTING.md](CONTRIBUTING.md) covers contribution and CI rules. [Controlled execution](docs/development/controlled-execution.md), [runtime operations](docs/development/runtime-readiness.md) and the [disposable Oracle suite](docs/development/oracle-acceptance.md) describe separate live gates. Never automatically replay ambiguous DDL.

Independently authored code uses [PolyForm Shield 1.0.0](LICENSE); third-party grants/notices remain separate. See [license scope and provisional naming](docs/product/license-and-naming.md) and [dependency evidence](docs/dependencies/LICENSE-EVIDENCE.md). Internal behavioral research is not publication material.

Build a reproducible local source bundle with `npm run release:local -- --output /absolute/existing-parent/new-release-directory`; follow the [local release guide](docs/development/local-release.md). Publishing or deploying requires explicit task authorization.
