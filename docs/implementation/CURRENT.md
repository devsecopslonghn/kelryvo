# Continue Kelryvo development

Start with [product requirements, current capabilities and prioritized roadmap](../product/KELYRVO_PRODUCT_REQUIREMENTS.md). That document is the single source of product direction and progress.

**Current product architecture:** one master credential reference per registered Oracle
PDB/non-CDB, multiple assigned schemas per project, one exact-schema stream per migration
plan and mandatory independent approval. Keep the current browser journey and components:
Connect → Discover → Assign → Author → Validate → Plan → Review → Execute → History.
Improve context, blocked-state explanations and next steps within the existing interface;
do not redesign the workflow.

**Runtime candidate:** package the API, discovery and execution roles in one OCI image. A
minimal-capability root PID 1 stages root-owned source credentials, then runs the API as
UID 10001 and internal execution/discovery as UID 10002. The children have no effective
capabilities; discovery uses a fixed internal Unix socket contract. Essential child loss
stops the container. Lease expiry continues to project HOLD; no child restart or SQL
replay is allowed. Docker Compose and Helm use the same image and runtime configuration,
with PostgreSQL outside the application container. This candidate is not yet an accepted
Oracle runtime or completed pilot.

The [2026-10-23 unified runtime acceptance](../../evidence/product/unified-runtime-20261023/acceptance.json)
records source `3ea8859`: 199 PostgreSQL/API tests, 55 Chromium tests, fresh-source
installation, AMD64 container isolation and owner-authorized public deployment acceptance.
The development image passed role login, review/downloads, mobile layout and app restart;
original metadata and PostgreSQL/PVC identities were preserved. Argo automatic sync is
paused in both live configuration and the chart source. The accepted development overlay
is `values.development.yaml` in the chart repository; it is separate from gated release
publication. Do not re-enable sync against the old master/image while the pilot is incomplete.

Remaining external inputs: the current owner-attested Oracle lab manifest and reviewed
private installation for the new runtime, including explicit CREATE/ALTER ADD/INDEX and
fault scopes. No current private manifest was found in this checkout. Keep execution and
discovery disabled, all new-runtime Oracle cases NOT_RUN, and retain the historical lab.

[PR #112](https://github.com/devsecopslonghn/kelryvo/pull/112) and [its bounded real
Oracle acceptance](../../evidence/product/instance-master-workflow-20261015/acceptance.json)
remain historical source-specific evidence: two schema V1 executions, a V2 suffix, a
browser-authored no-op and independent history/audit verification. That evidence covers
the recorded CREATE TABLE statements only. The current source policy also recognizes
scalar ALTER TABLE ADD and simple CREATE INDEX, but those forms have no live acceptance;
all Oracle acceptance for the unified runtime source remains **NOT_RUN**.

For an owner-authorized development image test, use a temporary Docker Hub tag tied to
the exact source revision while Argo CD auto-sync for the Kelryvo application is paused.
Keep that direct test separate from the existing source-gated, immutable GHCR publication
and product-release path. Do not merge or waive required CI/review checks to perform the
test. Resume the saved Argo behavior only after the pilot is complete and the desired
source/image have been reconciled through review.

Acceptance is version, topology, statement and source specific. Consult the product
requirements and retained Oracle acceptance before claiming a new runtime capability.
Existing HOLDs remain retained; never replay uncertain DDL or delete the Oracle lab.

Before changing code, inspect `AGENTS.md`, [architecture/safety contracts](../architecture/KELYRVO_ARCHITECTURE_DECISIONS.md), relevant [API/operator contracts](../development/local-product.md) and [testing guidance](../development/testing.md). Run `npm run status` and `npm run next` for retained tracker context, then follow the selected roadmap criteria. Do not start another target-binding, SQL-workspace or connection-management phase merely because an older catalog task is BACKLOG.

The [tracking guide](tracking.md) explains original catalog acceptance versus bounded product delivery. Historical acceptance and all raw evidence remain available; they do not establish today's deployment or live Oracle support. Stop at missing live authorization, retain NOT_RUN honestly, and continue only independent in-scope preparation. Deployment, infrastructure changes and writer execution require explicit task authority.
