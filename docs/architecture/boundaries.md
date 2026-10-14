# Product module boundaries

[Architecture and safety contracts](KELYRVO_ARCHITECTURE_DECISIONS.md) defines the domain and execution invariants. [Product requirements and roadmap](../product/KELYRVO_PRODUCT_REQUIREMENTS.md) defines current capability and remaining work. This map replaces the initial proposed module layout; historical details remain in Git and the decision log.

| Area | Current responsibility |
| --- | --- |
| `apps/api` | Same-origin Fastify API, current human/project authority and workflow composition. No Oracle deployment-writer secrets. |
| `apps/web` | React project workflow and truthful offline/observed/synthetic/runtime evidence states. |
| `apps/worker` | Separately installed execution service, supervisor, private provider/host and metadata-only expiry recovery. Live Oracle behavior is not accepted. |
| `packages/database`, `packages/targets`, `packages/catalog-reference` | PostgreSQL metadata, identity/grants, workspace references, assignment intervals, versioned target bindings and currentness. |
| `packages/connectivity` | Revisioned connection management and bounded, purpose-separated opt-in read-only discovery. Default runtime unavailable; fixtures never certify identity. |
| `packages/migrations`, `packages/sql-workspace`, `packages/sql-validation` | Retained Git/authored source, pinned parser, immutable intent, SQL revisions and bounded offline scope/risk evidence. |
| `packages/governance`, `packages/execution`, `packages/migration-history`, `packages/audit` | Independent review, durable requests/attempts/receipts/reconciliation and retained evidence projections. |
| `packages/backup`, `packages/runtime`, `packages/observability` | Exact-schema backup/restore generation hold, private startup configuration and bounded runtime diagnostics. |
| `experiments/db-devops-wp0` | Isolated feasibility harness and stricter Oracle validation contracts; not a second product runtime. |

The API may dispatch only the separately authorized read-only discovery capability. Only the trusted worker can receive deployment-writer capabilities after the independent runtime gates. Manual references and local checks cannot cross that boundary. [Local product contracts](../development/local-product.md) describes the concrete APIs and operator installation paths.
