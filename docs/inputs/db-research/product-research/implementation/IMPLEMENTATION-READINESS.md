# Final implementation readiness decision

8 October 2026. **CONDITIONAL GO for a subsequent WP0-only implementation session, starting with WP0-T01. NO-GO for production implementation/rollout today.** Walking Skeleton implementation remains gated by actual WP0 evidence and a later bounded implementation instruction. No platform/harness code, Oracle connections or deployments were created during this planning task.

## Refined scope

| Stage | Assigned original MVP IDs | Cumulative | Exit |
|---|---:|---:|---|
| WS | 74 | 74 | Sixteen actual DEV-only CLI/API outcomes, byte/approval/target/ledger/validity/failure-safety proof |
| MVP-Core | 17 | 91 | Multi-user HTTPS/session lifecycle, live GitLab, full operating/recovery/promotion/offline cluster and required estate-capacity acceptance |
| MVP-Extended | 4 | 95 | Grouped estate, guided resubmission, portable evidence export and dedicated outcome panel |

All 95 original MVP IDs are assigned once in [refinement](MVP-REFINEMENT.md); source catalog/roadmap/220 IDs remain unchanged. The count reflects fine-grained invariants in shared modules. A CLI skeleton does not implement 74 independent components. Completing Core meets the proposed refined operating gate; completing all four Extended IDs is still needed to claim the original 95-row MVP milestone. Full V1/V2/rejected scope is unchanged.

WS uses one attested DEV service/PDB per version fixture, two schemas owned by separate projects in the same environment, independent named actors, a protected immutable local Git mirror, PostgreSQL metadata/artifacts, separate local API/worker and a mature parser/Thin candidate. It performs genuine divergent-history migrations, validity checks, retained audit, zero-effect rerun, changed-checksum rejection and truthful crash/ambiguity HOLD. There is no complete React portal, public browser/remote API, general SQL console, live GitLab provider, nonempty-schema baseline, promotion or restore shortcut in WS.

## Architecture decisions and open questions

Keep modular governance with a restricted independent worker and transactional PostgreSQL admission/evidence as a proposed design. Allow different worker/parser languages. Use original immutable byte/target/history-bound intents, one authoritative local applied-history interpretation plus central approval authority, same-session DDL-safe mutex and independent verification. The proposed data contracts explicitly distinguish executed, baselined and adopted state and retain project-at-execution.

TypeScript/Fastify and Node Thin are conditional candidates; React is deferred. A mature legally usable parser/runner is mandatory, while the parser-only JVM helper's packaging/API isolation remains unproved. A full engine remains an assessed alternative only when its complete required client/license and immutable-plan/recovery semantics meet the original requirement. No required proprietary client exception or custom grammar is silently accepted. See [ADRs](ARCHITECTURE-DECISIONS.md).

Unresolved questions with exact owners/gates:

| Question / dependency | Owner | Gate / current state |
|---|---|---|
| Supplied authorized 19c/21c fixtures, alias/PDB identities, grants, TCPS/fault/cleanup scope | Lab DBA + runtime engineer | WP0-T01; availability UNKNOWN, runtime NOT_RUN |
| Driver-free mature parser closure and exact byte/range behavior | Parser maintainer + license reviewer | WP0-T02/T03/T08; NEEDS_POC |
| Thin transport/authentication versus estate requirements | Oracle DBA + driver maintainer | WP0-01/02; NEEDS_POC; no NNE/Kerberos/Thick capability inference |
| Lock/grant package survives DDL and orphan sessions across required aliases/RAC | DBA + runtime engineer | WP0-06; NEEDS_POC |
| Local receipt/central authority/crash reconstruction correctness | Recovery engineer + DBA | WP0-07/09; NEEDS_POC; no arbitrary DDL exactly-once |
| Object/compiler visibility and actual committed postchecks | Verification engineer + DBA | WP0-05; NEEDS_POC |
| Real product authorization/integration, actual restore/capacity and cluster security | Platform/release/security engineers | WS/Core tasks; BLOCKED production gate until implemented/observed |
| Exact packaged/transitive OSS rights, supported versions and offline maintenance | Release/license maintainer | WP0-10 and Core release closure; CONDITIONAL |
| Production code destination, team skills and operations ownership | Product/platform owner | Required before WP1; no repository or staffing invented |

## WP0 gates and proof

WP0 contains **63 mandatory proposed cases**: 35 Oracle-runtime, 27 unit-plus-Oracle and 1 static case, across all ten requested areas. The result template has **124 Oracle cells across 19c/21c and 28 unit/static cells**. Every applicable cell is currently **NOT_RUN**. [Test plan](WP0-TEST-PLAN.md) defines objective, prerequisites, fixture, steps, expected result, evidence, PASS/FAIL/BLOCKED criteria, cleanup and risk for every case; [matrix](WP0-ACCEPTANCE-MATRIX.md) binds gates G0–G9.

GO for a candidate requires every mandatory applicable cell with reproducible evidence, resolved cleanup and exact accepted support profile. Unsupported required topology/auth/parser/license capability reopens the ADR. Missing labs or privileges block only dependent runtime work while useful offline work may proceed. Logical history rewinds and approval models remain explicitly scoped experiments; they cannot certify physical Oracle restore or future platform authorization. WP0 success alone does not authorize production deployment.

## Security, licensing and effort

Top blockers are parser isolation, required lab/grant/fault inputs, unobserved Thin/mutex compatibility and absence of real crash/validity/approval evidence. Keep uncertain commits held; do not fabricate local receipts, missing human authority or rollback. Restrict target/secret/actor scope and preserve all authenticated current-intent contributors. Source license labels cannot certify package/JRE/native/base-image closure; no Bytebase code reuse, FSL/proprietary mandatory client or quota is accepted. Privileged OS/DBA/manual-tool bypass remains an explicit trust/operating boundary.

| Milestone | Engineer-weeks | Assumptions |
|---|---:|---|
| WP0 | 6–10 | 30–50 engineer-days; two full-time engineers about 3–5 weeks, or 4–7 with 25% reserve, plus DBA help |
| WS including WP0 | 30–46 | Three engineers at 75% availability about 13–21 elapsed weeks |
| Core additional | 40–60 | 70–106 cumulative; actual restore, security, supported profiles and capacity retained |
| Extended additional | 12–20 | 82–126 cumulative for full refined 95-ID MVP |

Full refined MVP with 4–5 engineers at 75% implementation availability is roughly **22–42 weeks (5–10 months)** plus timely DBA/security participation. The original **110–170** estimate is preserved; reduction assumes CLI-first delivery and no mandatory broad portal. These remain expert estimates, not measured velocity. Parser failure or estate incompatibility requires re-estimation rather than treating the lower range as a commitment. Package arithmetic and task/feature dependencies are verified separately.

## Immediate next action

Use [NEXT-CODEX-PROMPT.md](NEXT-CODEX-PROMPT.md) in the next session to implement **WP0 only**. Begin **WP0-T01 — Preflight isolated harness workspace and lab input manifest** without Oracle calls; record supplied/missing disposable target, credential-reference, grant, fault/cleanup and offline dependency inputs. Then execute the dependency-ordered WP0 tasks where prerequisites hold. Stop at WP0-T12 with observed results and the architecture verdict; do not begin WP1 automatically.

[Planning validation](readiness-validation.json) checks IDs, all 95 assignments, feature/task dependencies, test/result coverage, effort arithmetic, links and preservation of original research/unrelated work. These are artifact checks only. They cannot change any WP0 case from NOT_RUN to PASS or close a production gate.
