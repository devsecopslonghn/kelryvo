# schemaForge (SchemaForge, provisional)

SchemaForge is intended to be a free, open-source, self-hosted Database DevOps platform
for centralized database management, Git-driven schema migrations, approvals, audit and
reliable execution. Oracle-first, multi-database-ready is the product goal.

The repository implements the engineering foundation and offline WP0 dependency,
preflight and candidate-parser experiments. It does not yet register services or execute
migrations. Apache-2.0 is proposed;
the license remains undecided. See [license and naming status](docs/product/license-and-naming.md).

## Development

Install Node 22.23.3 and Python 3.11+ (for native TOML validation), then:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm run status
npm run next
```

After dependency installation, no database credentials or network are needed for checks.
They verify authored source, JSON formatting, immutable input digests, tracker invariants,
offline preflight, dependency imports/compiler behavior and candidate protocol contracts.
The build command currently validates source; it does not build an application binary.
[CONTRIBUTING.md](CONTRIBUTING.md) documents conventions and CI limits.

## Repository

| Path | Purpose |
| --- | --- |
| `docs/inputs/` | Hashed, immutable design snapshot from DB-Research |
| `docs/product/`, `docs/architecture/`, `docs/decisions/` | Product decisions and boundaries |
| `docs/implementation/` | 220-feature tracker, backlog, ownership, acceptance and session state |
| `.codex/agents/` | Six native specialist TOML definitions |
| `experiments/db-devops-wp0/` | Isolated offline feasibility code and lab contract |
| `scripts/`, `tests/` | Working local tooling and regression checks |
| `evidence/` | Actual sanitized append-only local observations |
| `.github/workflows/` | Offline checks; no publishing or deployment |

Future application/package/deployment directories are created when they contain an accepted
implementation. [Architecture boundaries](docs/architecture/boundaries.md) records their
intended locations. DB-Research stays the source of original research; this repository is
the source of product implementation. No upstream source or UI asset was imported.

## Continue development

Read [current state](docs/implementation/CURRENT.md), [tracking rules](docs/implementation/tracking.md)
and [agent configuration](docs/implementation/agents.md), then select the next unblocked
bounded task. Phase 0 precedes WP0 acceptance; all 63 Oracle feasibility cases remain
separate from product features. Walking Skeleton/API/UI/deployment work is gated by WP0
and is outside this session's scope.

The [WP0 preflight](experiments/db-devops-wp0/README.md) reports missing lab inputs without
connecting to a database. Disposable 19c and 21c targets require explicit authorization,
entitlement, identities, grants, fault permissions, scoped credential references and
offline artifact review. An example profile is not authority to use any database.
