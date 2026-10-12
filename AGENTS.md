# Kelryvo

Oracle-first Database DevOps and Governance Platform.
Kelryvo is independently implemented. External behavioral research remains internal-only.

## Domain rules
- Workspaces own database infrastructure; projects own Git releases, plans, and reviews.
- Schema assignments and target identity must be explicit; preserve immutable plans, decisions, migration history, and audit records.
- Require independent approval for governed execution.
- Never replay ambiguous Oracle DDL automatically or claim Oracle acceptance from offline checks.
- Do not connect to Oracle, execute live migrations, or change lab infrastructure without explicit task authorization and a secret-free attested disposable-lab manifest.
- Treat credentials as references; never commit credentials or expose application writer secrets to API services.
- Do not copy restricted external code or assets. Preserve mandatory licenses, copyright notices and attribution.
- Keep third-party comparison/source research outside publication: tracked product documents, PR titles/bodies, branch names and commit messages must describe Kelryvo. Historical deletion is not Git-history removal; never rewrite history or force-push without explicit authorization.

## Development
- Follow the canonical product specification and treat research snapshots as design input, not implementation evidence.
- Reuse validated code where practical; deliver complete vertical slices with browser acceptance.
- Run `npm run check` for implementation changes.
- Preserve existing data and security constraints; keep documentation and agent configuration minimal.
