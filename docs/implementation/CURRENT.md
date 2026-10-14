# Continue Kelryvo development

Start with [product requirements, current capabilities and prioritized roadmap](../product/KELYRVO_PRODUCT_REQUIREMENTS.md). That document is the single source of product direction and progress, reconciled through master `975dea5` / PR #94 and R1 product integration on 2026-10-14.

**Current milestone: R1 — live read-only Oracle acceptance.** Product connection/discovery/target-binding integration and local acceptance are delivered. Demonstrate the integrated browser journey against a separately authorized disposable Oracle target. Its exit criteria and external entry gate are in the product document. No live Oracle acceptance has been recorded; an offline/fixture pass cannot close this milestone.

Before changing code, inspect `AGENTS.md`, [architecture/safety contracts](../architecture/KELYRVO_ARCHITECTURE_DECISIONS.md), relevant [API/operator contracts](../development/local-product.md) and [testing guidance](../development/testing.md). Run `npm run status` and `npm run next` for retained tracker context, then follow the selected roadmap criteria. Do not start another target-binding, SQL-workspace or connection-management phase merely because an older catalog task is BACKLOG.

The [tracking guide](tracking.md) explains original catalog acceptance versus bounded product delivery. Historical acceptance and all raw evidence remain available; they do not establish today's deployment or live Oracle support. Stop at missing live authorization, retain NOT_RUN honestly, and continue only independent in-scope preparation. Deployment, infrastructure changes and writer execution require explicit task authority.
