# Continue Kelryvo development

Start with [product requirements, current capabilities and prioritized roadmap](../product/KELYRVO_PRODUCT_REQUIREMENTS.md). That document is the single source of product direction and progress.

**Current architecture:** one master credential reference per registered Oracle PDB/non-CDB,
multiple assigned schemas per project, one exact-schema stream per migration plan,
mandatory independent approval and conservative execution-side SQL scope enforcement.
The primary browser journey is Connect → Discover → Assign → Author → Validate → Plan →
Review → Execute → History. Reuse the current components and preserve legacy evidence.

Acceptance is version, topology, statement and source specific. Consult the product
requirements and retained Oracle acceptance before claiming a new runtime capability.
Existing HOLDs remain retained; never replay uncertain DDL or delete the Oracle lab.

Before changing code, inspect `AGENTS.md`, [architecture/safety contracts](../architecture/KELYRVO_ARCHITECTURE_DECISIONS.md), relevant [API/operator contracts](../development/local-product.md) and [testing guidance](../development/testing.md). Run `npm run status` and `npm run next` for retained tracker context, then follow the selected roadmap criteria. Do not start another target-binding, SQL-workspace or connection-management phase merely because an older catalog task is BACKLOG.

The [tracking guide](tracking.md) explains original catalog acceptance versus bounded product delivery. Historical acceptance and all raw evidence remain available; they do not establish today's deployment or live Oracle support. Stop at missing live authorization, retain NOT_RUN honestly, and continue only independent in-scope preparation. Deployment, infrastructure changes and writer execution require explicit task authority.
