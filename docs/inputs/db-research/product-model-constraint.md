## IMPORTANT: Product-model constraint

Do not interpret this research primarily as:

> "Find a migration engine with a UI"

or:

> "Find an SQL approval/execution portal"

or:

> "Find something that can be combined with Flyway."

Those are secondary possibilities only.

The primary objective is to find an existing FREE, OPEN-SOURCE, SELF-HOSTED product whose PRODUCT MODEL is similar to Bytebase.

Use Bytebase as a reference architecture and UX model, NOT as a mandatory implementation.

The desired product should feel like a database management/change platform:

```text
                    Platform
                       |
        +--------------+--------------+
        |              |              |
    Projects       Databases      Environments
        |              |              |
        +--------------+--------------+
                       |
                    Changes
                       |
               Review / Approval
                       |
                    Rollout
                       |
              DEV -> SIT -> UAT -> PROD
                       |
                    History
```

A user should ideally be able to open the web application and see:

- applications/projects;
- registered database instances;
- databases/schemas;
- environments;
- pending database changes;
- previous deployments;
- execution status;
- who requested a change;
- who approved it;
- where it was deployed;
- deployment logs/history.

Bytebase is the reference for this product model.

Study Bytebase's publicly documented workflow and UI concepts first so that the search understands what class of product is required.

---

# Distinguish three product categories

Every candidate MUST be classified into one of these categories.

## Category A — Database Change Management Platform

Example product model:

```text
Projects
   |
Database estate
   |
Changes / Releases
   |
Review
   |
Deployment pipeline
   |
Environment promotion
   |
History / Audit
```

This is the TARGET category.

Prefer these candidates.

---

## Category B — SQL Governance / SQL Approval Portal

Typical model:

```text
Submit SQL
    |
SQL review
    |
Approval
    |
Execute SQL
    |
Result
```

Examples may include SQL auditing/governance systems.

These are useful but are NOT automatically equivalent to Bytebase.

Explicitly identify what they lack compared with Category A.

---

## Category C — Migration Engine / Migration UI

Typical model:

```text
Migration files
      |
Flyway / Liquibase / custom engine
      |
Database
      |
Migration history
```

These solve execution/versioning but are NOT automatically centralized database management platforms.

Do not recommend Category C alone as the final solution.

---

# Bytebase similarity analysis

For every serious candidate, compare its PRODUCT MODEL with Bytebase.

Produce:

| Capability | Bytebase reference | Candidate |
|---|---|---|
| Central web console | YES | |
| Project/application model | YES | |
| Database instance inventory | YES | |
| Environment model | YES | |
| Schema/database inventory | YES | |
| Change request | YES | |
| Change version/release | YES | |
| Review | YES | |
| Approval | YES | |
| Deployment/rollout | YES | |
| Multi-environment promotion | YES | |
| Deployment history | YES | |
| Audit | YES | |
| RBAC | YES | |
| Git integration | YES | |
| CI/CD integration | YES | |
| Oracle | YES | |
| Migration state | investigate | |

The objective is NOT to find something with the same visual design.

The objective is to find something with a similar operating model.

---

# UI evidence requirement

Do not classify a candidate as a platform merely because its README says "Web UI".

Inspect the actual frontend.

For every shortlisted candidate provide:

1. Screenshots from official documentation, repository, demo, or release documentation if available.

2. Frontend source structure.

3. Main navigation/menu structure.

4. Important pages/routes.

Specifically determine whether pages exist for:

- Projects
- Database Instances
- Databases
- Environments
- Changes/Releases
- Review/Approval
- Deployment/Rollout
- History
- Audit
- Users/Roles

Provide source paths for the corresponding frontend components/routes where possible.

---

# Reject misleading matches

A project MUST NOT be described as "Bytebase-like" merely because it has:

- Web UI;
- Oracle support;
- SQL execution;
- approval;
- audit logs.

For example:

```text
Web UI
   |
Paste SQL
   |
Approve
   |
Execute
```

is fundamentally different from:

```text
Application
   |
Release
   |
Versioned DB Change
   |
Environment rollout
   |
Target database state
   |
Deployment history
```

Explicitly identify this distinction.

---

# Search specifically for Bytebase-like projects

In addition to generic searches, search for:

"Bytebase alternative open source"

"Bytebase open source alternative"

"Bytebase alternative self hosted"

"database DevOps platform open source"

"database change management platform open source"

"database release management web UI open source"

"database deployment control plane open source"

"database lifecycle management open source"

"database CI/CD platform open source"

"database migration management server open source"

"schema change management platform open source"

"database governance platform open source"

Also search:

GitHub topics:
- database-devops
- database-governance
- database-migration
- schema-migration
- database-ci-cd
- database-change-management

Search GitHub README text for comparisons such as:

"alternative to Bytebase"

"similar to Bytebase"

"Bytebase alternative"

"database DevOps"

"database change management"

"database release management"

---

# Search Bytebase forks and historical ecosystem

This is important.

Investigate:

1. Bytebase forks.
2. Old Bytebase forks.
3. Projects derived from older Apache/MIT Bytebase versions.
4. Projects inspired by Bytebase.
5. Abandoned forks that may have evolved independently.
6. Chinese database DevOps / SQL audit ecosystems.
7. GitHub/Gitee projects that may not rank well in Google search.

For each fork determine whether it is merely synchronized with upstream or contains meaningful independent development.

Do NOT assume a fork is legally reusable.

Record its license and the upstream commit it originated from.

---

# Final shortlist rule

The final shortlist should prioritize:

1. Free/open-source/self-hosted.
2. Bytebase-like product model.
3. Oracle support.
4. Central database estate/inventory.
5. Database change/release workflow.
6. Reliable execution/history.
7. RBAC/audit/approval.
8. Active development.

A candidate missing target-side migration state MAY remain in the shortlist if the rest of the platform is genuinely Bytebase-like.

In that case clearly label:

PLATFORM FIT: HIGH
MIGRATION ENGINE FIT: LOW

This is preferable to rejecting a strong platform too early.

Conversely, a perfect Flyway wrapper with no estate/project/environment/workflow model should be labeled:

PLATFORM FIT: LOW
MIGRATION ENGINE FIT: HIGH

---

# Final output

For each shortlisted project provide two independent scores:

Platform Fit:
HIGH / MEDIUM / LOW

Migration Engine Fit:
HIGH / MEDIUM / LOW

Do NOT combine them into one score.

The key research question is:

> Does a genuinely free/open-source/self-hosted Bytebase-like database change management platform already exist, especially one capable of managing Oracle?

Only after answering that question should we consider composing a platform from Flyway + another tool.