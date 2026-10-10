# schemaForge (SchemaForge, provisional)

SchemaForge is a source-available, self-hosted Database DevOps platform, free for internal use,
for centralized database management, Git-driven schema migrations, approvals, audit and
reliable execution. Oracle-first, multi-database-ready is the product goal.

The repository contains a runnable local governance application: a TypeScript/Fastify API,
React web app and persistent PostgreSQL metadata. Manage projects/environments and
credential-reference profiles, import local Git releases, validate SQL with the existing
ANTLR parser, prepare offline candidate plans, approve/reject independently, and inspect
audit and migration history. Approved plans can create durable deployment requests;
the coordinator safety kernel is tested with UNIT adapters. Oracle migration execution
remains `NOT_EXECUTED` without an authorized target and trusted worker.
The engineering foundation and all WP0 experiments/evidence remain preserved.
Independently authored code is licensed under [PolyForm Shield 1.0.0](LICENSE): internal
use is permitted; using it to provide competing products/services is restricted by the
license. Noncompeting paid consulting/support is not categorically prohibited.
Third-party components retain their own grants and notices. See
[license scope and provisional naming](docs/product/license-and-naming.md).

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
The build checks authored source and API types, and bundles the React application.
[CONTRIBUTING.md](CONTRIBUTING.md) documents conventions and CI limits.

## Run locally

Requires Node 22.23.3, Git, Docker and Linux x64 (the pinned parser preparation target).
From the repository root:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run local:prepare
npm run dev
```

Open **http://127.0.0.1:4317**. The API serves the built web app at the same origin.
Preparation explicitly obtains pinned public parser tools and the PostgreSQL image;
repeat preparation preserves existing parser inputs. Startup creates an isolated local
metadata container on port 55432 and persistent Docker volume, a two-file demo Git
repository, and private local tokens in `.cache/local-product/config.json` (mode 0600).
Explicitly activate project membership and grant the intended actors before project writes;
follow the operator steps in the guide below. Use `developerToken` to prepare a candidate,
then sign out and use `approverToken` to approve or reject it. HTTP mode retains the bearer
in browser memory. Target credentials are references only.

For HTTPS browser sessions, provide a client-trusted certificate for the loopback address
and its private key using the documented private file permissions:

```sh
npm run dev -- --tls-cert /absolute/private/tls/server-chain.pem --tls-key /absolute/private/tls/server-key.pem
```

Open **https://127.0.0.1:4317**. Sign-in exchanges the named local credential for a
revocable Secure/HttpOnly cookie with CSRF protection and idle/absolute expiry. The bearer
is then cleared from browser state. OS credential rotation/revocation invalidates derived
sessions, and metadata restore retains a persistent execution hold.

[The demonstration and API guide](docs/development/local-product.md) walks through the
workflow, persistence, tests, local shutdown and current product boundaries.

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

Working product modules live in `apps/api`, `apps/web`, `packages/database` and
`packages/migrations`; deployment packages follow their operating acceptance. [Architecture boundaries](docs/architecture/boundaries.md) records their
intended locations. DB-Research stays the source of original research; this repository is
the source of product implementation. Only the pinned Apache-2.0 PL/SQL grammar sources are vendored; restricted vendor code,
branding and UI assets are excluded.

## Continue development

Read [current state](docs/implementation/CURRENT.md), [tracking rules](docs/implementation/tracking.md)
and [agent configuration](docs/implementation/agents.md), then select the next unblocked
bounded task. Phase 0 precedes WP0 acceptance; all 63 Oracle feasibility cases remain
separate from product features. PRODUCT scheduling proceeds independently of Oracle VALIDATION. Original feature/WP0
acceptance dependencies remain unchanged; local product evidence does not pass Oracle gates.

The [WP0 preflight](experiments/db-devops-wp0/README.md) reports missing lab inputs without
connecting to a database. Disposable 19c and 21c targets require explicit authorization,
entitlement, identities, grants, fault permissions, scoped credential references and
offline artifact review. An example profile is not authority to use any database.
