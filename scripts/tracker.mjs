#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const impl = path.join(root, 'docs/implementation');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const write = (name, value) => fs.writeFileSync(path.join(impl, name), `${JSON.stringify(value, null, 2)}\n`);
const catalogPath = 'docs/inputs/db-research/product-research/feature-catalog.json';
const planPath = 'docs/inputs/db-research/product-research/implementation/implementation-plan.json';
const catalog = read(catalogPath);
const plan = read(planPath);

const DOMAIN_OWNER = {
  'Database Management': 'database', 'Project Management': 'backend', 'Migration Management': 'database',
  'Change Governance': 'backend', 'SQL and Review': 'backend', 'Security and Governance': 'security',
  'GitOps and CI/CD': 'devops', 'Observability and Operations': 'devops', 'Additional Features': 'qa',
};
const PACKAGE_OWNER = { WP0: 'qa', WP1: 'backend', WP2: 'database', WP3: 'devops', WP4: 'security', WP5: 'database', WP6: 'backend', WP7: 'frontend', WP8: 'devops', WP9: 'qa' };
const PRODUCT_TASK = {
  id: 'SF-PRODUCT-T01', package: 'PRODUCT', assigned_agent: 'orchestrator', title: 'Deliver runnable local governance workflow', dependencies: [],
  feature_ids: ['PRJ-001', 'PRJ-003', 'PRJ-008', 'MIG-008', 'GOV-007', 'GOV-012', 'MIG-010', 'SEC-011'],
  acceptance_criteria: [
    'A reproducible local command starts the API, web application, and PostgreSQL-backed metadata store.',
    'Projects, environments, and connection profiles persist; connection secrets never appear in API responses or logs.',
    'A Git migration release can be imported, parsed, validated, and displayed with source references.',
    'The application generates a pending-change plan with approval and rejection transitions and audit history.',
    'Migration history records NOT_EXECUTED when no authorized database execution occurs; no success is fabricated.',
  ], test_references: ['SF-PRODUCT-T01-API', 'SF-PRODUCT-T01-WEB', 'SF-PRODUCT-T01-INTEGRATION'],
};
const PRODUCT_TASK_02 = {
  id: 'SF-PRODUCT-T02', package: 'PRODUCT', assigned_agent: 'backend', title: 'Archive projects and reject new work on archived projects', dependencies: ['SF-PRODUCT-T01'],
  feature_ids: ['PRJ-001'],
  acceptance_criteria: [
    'A project can be archived persistently and its archived state is visible in project list and detail responses.',
    'Archived projects reject new environments, connection profiles, Git releases, and migration plans with a stable conflict response.',
    'Existing project details, audit events, and migration history remain readable after archival.',
  ], test_references: ['SF-PRODUCT-T02-API', 'SF-PRODUCT-T02-WEB'],
};
const PRODUCT_TASK_03 = {
  id: 'SF-PRODUCT-T03', package: 'PRODUCT', assigned_agent: 'devops', title: 'Register local Git repositories for migration imports', dependencies: ['SF-PRODUCT-T02'],
  feature_ids: ['GIT-018', 'GIT-003', 'MIG-006'],
  acceptance_criteria: [
    "The reproducible development CLI uses Node's native parseArgs for one to eight repeatable --repository PATH options, registers existing local Git directories, and displays only repository IDs and names.",
    'Invalid flags, URLs, and non-repository paths are rejected before PostgreSQL or Docker startup with fixed errors that do not disclose supplied paths.',
    'Registration never clones, fetches, or resolves provider credentials; custom releases use the existing parser with an immutable resolved commit, database execution remains NOT_EXECUTED, and no Oracle behavior is claimed.',
  ], test_references: ['SF-PRODUCT-T03-UNIT', 'SF-PRODUCT-T03-API'],
};
const PRODUCT_TASK_04 = {
  id: 'SF-PRODUCT-T04', package: 'PRODUCT', assigned_agent: 'backend', title: 'Bind a registered Git repository and migration folder to projects', dependencies: ['SF-PRODUCT-T03'],
  feature_ids: ['PRJ-008', 'GIT-003'],
  acceptance_criteria: [
    'A project can persist and display its source binding using an allowlisted repository ID and migration folder; API and web views never expose repository paths or credentials.',
    'Imports reject an unbound project or repository/folder mismatch before Git or parser work begins.',
    'Archived projects reject source-binding changes while existing releases, plans, audit history, and migration history remain readable with execution state NOT_EXECUTED.',
  ], test_references: ['SF-PRODUCT-T04-API', 'SF-PRODUCT-T04-WEB'],
};
const PRODUCT_TASK_05 = {
  "id": "SF-PRODUCT-T05",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Audit authenticated review denials without changing migration plans",
  "dependencies": [
    "SF-PRODUCT-T04"
  ],
  "feature_ids": [
    "GOV-023",
    "SEC-011"
  ],
  "acceptance_criteria": [
    "Authenticated plan-decision rejections for role, author, and terminal-state conflicts record a fixed denial reason and server actor/resource metadata without changing the plan or migration history.",
    "Malformed and unauthenticated requests cannot persist arbitrary request data; archived projects reject review requests without appending new project audit events.",
    "The web audit view displays denied decisions; existing approval/rejection transitions remain terminal and all migration execution states remain NOT_EXECUTED."
  ],
  "test_references": [
    "SF-PRODUCT-T05-API",
    "SF-PRODUCT-T05-WEB"
  ]
};
const PRODUCT_TASK_06 = {
  id: 'SF-PRODUCT-T06', package: 'PRODUCT', assigned_agent: 'backend',
  title: 'Add persistent comments to pending plan reviews', dependencies: ['SF-PRODUCT-T05'],
  feature_ids: ['GOV-020'],
  acceptance_criteria: [
    'Authenticated local developers and approvers can append bounded plain-text comments to pending plans; the server supplies actor/time and binds each comment to its organization, project and plan.',
    'The review UI displays the persisted thread; malformed, missing-plan, terminal-plan and archived-project writes are denied, while existing comments remain readable.',
    'Comments cannot attach files or change migration bytes, plan decisions or history; execution remains NOT_EXECUTED and no full catalog or Oracle acceptance is claimed.',
  ], test_references: ['SF-PRODUCT-T06-API', 'SF-PRODUCT-T06-WEB'],
};
const PRODUCT_TASK_07 = {
  id: 'SF-PRODUCT-T07', package: 'PRODUCT', assigned_agent: 'backend',
  title: 'Display retained plan decision provenance in review', dependencies: ['SF-PRODUCT-T06'],
  feature_ids: ['GOV-023'],
  acceptance_criteria: [
    'Authenticated plan reviews display terminal decision reason, server timestamp and reviewer identity; new decisions snapshot the configured reviewer name, while historical records retain their stored actor ID fallback.',
    'Approval and rejection records remain scoped, readable after archival and application restart, and render arbitrary reason text safely without changing decision transitions, plan content, comments or migration history.',
    'Unauthorized reads and invalid or spoofed decision writes remain denied; this bounded provenance view does not certify project transfer, full catalog audit or Oracle execution.',
  ], test_references: ['SF-PRODUCT-T07-API', 'SF-PRODUCT-T07-WEB'],
};
const PRODUCT_TASK_08 = {
  id: 'SF-PRODUCT-T08', package: 'PRODUCT', assigned_agent: 'frontend',
  title: 'Filter project plan reviews by decision status', dependencies: ['SF-PRODUCT-T07'],
  feature_ids: ['GOV-021'],
  acceptance_criteria: [
    'Authenticated project plan reviews offer All, Pending approval, Approved and Rejected filters with a clear empty state, using the existing scoped project data and preserving the current All default.',
    'Changing a filter cannot display a plan outside the selected project or retain another plan\'s unsent comment draft; selected plans still expose their persisted comments and terminal decision records.',
    'Archived projects retain filtered historical read access; approval/rejection, comments, plan bytes and execution/history behavior remain unchanged. Assignment, delegation, notifications and full catalog inbox acceptance are excluded.',
  ], test_references: ['SF-PRODUCT-T08-WEB'],
};
const PRODUCT_TASK_09 = {
  "id": "SF-PRODUCT-T09",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Filter recent project audit events by action",
  "dependencies": [
    "SF-PRODUCT-T08"
  ],
  "feature_ids": [
    "SEC-011"
  ],
  "acceptance_criteria": [
    "Authenticated project audit timelines offer All actions by default and filters for the actions present in the existing scoped recent audit data, preserving server ordering and showing a clear empty state.",
    "Changing projects or signing out resets the audit filter; filtering cannot expose events from another project and archived projects retain filtered historical read access.",
    "Filtering is read only: audit facts, actors, timestamps, decisions, comments, plan bytes and migration history remain unchanged. Full audit search, pagination, retention policy, tamper evidence and Oracle acceptance are excluded."
  ],
  "test_references": [
    "SF-PRODUCT-T09-WEB"
  ]
};
const PRODUCT_TASK_10 = {
  "id": "SF-PRODUCT-T10",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Select local Git branches and tags for immutable release imports",
  "dependencies": [
    "SF-PRODUCT-T09"
  ],
  "feature_ids": [
    "GIT-004"
  ],
  "acceptance_criteria": [
    "Authenticated active project release intake lists bounded, deterministically ordered branches and commit-resolving tags from the project-bound registered local Git repository, without exposing local paths or provider credentials; the existing HEAD/manual immutable-ref workflow remains available.",
    "The API derives repository identity from the scoped project source binding and existing server allowlist, rejects missing/invalid bindings and unavailable repositories with fixed errors, and uses argument-safe Git reads with bounded output; no clone, provider authentication, hooks, checkout or arbitrary caller filesystem paths are introduced.",
    "Selecting a branch or tag reuses the existing importer to resolve and retain a full immutable commit and exact source bytes. Real Git/PostgreSQL/parser/browser tests verify branch/tag selection, moved-ref retention, project isolation, negative refs/bindings and archived read-only behavior; execution/history and Oracle VALIDATION remain unchanged."
  ],
  "test_references": [
    "SF-PRODUCT-T10-API",
    "SF-PRODUCT-T10-WEB"
  ]
};
const PRODUCT_TASK_11 = {
  "id": "SF-PRODUCT-T11",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Inspect retained release provenance",
  "dependencies": [
    "SF-PRODUCT-T10"
  ],
  "feature_ids": [
    "GIT-006"
  ],
  "acceptance_criteria": [
    "Authenticated release inspection displays the stored full immutable commit, repository ID, object format, migration folder, manifest digest, parser profile and import timestamp using the existing API. A current registered repository name may supplement the durable ID; local paths and provider credentials remain private.",
    "Provenance and exact retained SQL remain readable after source ref movement or repository unavailability and for archived projects. Inspection uses stored release facts without new Git reads, mutations, schema changes or worker execution; stale inspection responses cannot expose a previously selected project release.",
    "Real Git/PostgreSQL/parser/API/browser regressions compare rendered provenance with persisted release values, verify authenticated scoped reads and archived access, and preserve audit/history and execution state. This is a partial GIT-006 display increment; repository ID remains a separate stored field and full catalog or Oracle acceptance is not claimed."
  ],
  "test_references": [
    "SF-PRODUCT-T11-WEB"
  ]
};
const PRODUCT_TASK_12 = {
  "id": "SF-PRODUCT-T12",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Verify retained release integrity before offline planning",
  "dependencies": [
    "SF-PRODUCT-T11"
  ],
  "feature_ids": [
    "GIT-007"
  ],
  "acceptance_criteria": [
    "Authenticated offline plan creation verifies the retained UTF-8 file content, byte lengths and SHA-256 values, and reconstructs the existing format-1 manifest digest for the scoped VALID release before creating a plan. Malformed or mismatched retained data returns a fixed integrity error without plan, history or audit writes; existing validation and authorization errors remain intact.",
    "The scoped release read and integrity checks run under a transaction and consistent project/release row locks before persistence, so concurrent stored-release changes cannot leave a checked stale snapshot. Valid retained releases remain plannable when the original repository is unavailable, and archived projects and foreign project references retain their existing boundaries. No Git read, parser replacement, schema change, credential resolution, worker execution or Oracle connection is introduced.",
    "Real Git/PostgreSQL/parser/API/browser regressions cover unchanged retained releases, independent content/length/hash/manifest corruption, malformed metadata, concurrent mutation and fixed UI error feedback, with unchanged plan/history/audit snapshots on failure. This verifies the retained UTF-8 representation only: original arbitrary raw-byte or BOM retention, database tamper-proofing and full GIT-007/Oracle acceptance are excluded."
  ],
  "test_references": [
    "SF-PRODUCT-T12-API",
    "SF-PRODUCT-T12-WEB"
  ]
};
const PRODUCT_TASK_13 = {
  "id": "SF-PRODUCT-T13",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Inspect a plan\u2019s retained source from review",
  "dependencies": [
    "SF-PRODUCT-T12"
  ],
  "feature_ids": [
    "GOV-002",
    "GIT-006"
  ],
  "acceptance_criteria": [
    "Authenticated project plan review offers read-only inspection of the selected plan\u2019s linked retained release through the existing release API and provenance/SQL view. The plan release ID and scoped release metadata bind the displayed source; missing or mismatched source references show a fixed failure instead of another release.",
    "Pending and terminal plans, archived projects and unavailable repository registrations retain inspection access. Project, session and selected-plan changes invalidate delayed inspection results; viewing source does not change decisions, comments, plans, audit or migration history, and introduces no Git reads, schema, authorization or worker changes.",
    "Real Git/PostgreSQL/parser/browser regressions compare two distinct plans and releases against persisted commit/file facts, cover stale responses and project isolation, and verify read-only snapshots. This is a bounded review navigation/display increment; it does not certify post-approval byte revalidation, full GOV-002/GIT-006 or Oracle execution."
  ],
  "test_references": [
    "SF-PRODUCT-T13-WEB"
  ]
};
const PRODUCT_TASK_14 = {
  "id": "SF-PRODUCT-T14",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Show a plan's configured target in review",
  "dependencies": ["SF-PRODUCT-T13"],
  "feature_ids": ["DBM-003", "GOV-002"],
  "acceptance_criteria": [
    "Authenticated project review displays the selected plan's profile ID and its matching configured profile/environment from existing scoped project data: profile and environment names/IDs, engine, host, port, service and username. Label these as current configured metadata, not an immutable plan snapshot or runtime-observed identity; never render or resolve credential references or secrets.",
    "Pending and terminal plans and archived projects retain read access. Missing or mismatched profile/environment references show fixed unavailable feedback and retained IDs rather than another profile. Selected-plan, project and session changes cannot retain another target's details. This view makes no writes or connections and introduces no API, schema, authorization, Git or worker changes.",
    "Real PostgreSQL/Git/parser/browser regressions compare two profiles and plans against persisted scoped configuration, cover missing/foreign references, selection and session/project changes, literal text rendering and credential-reference omission, and prove complete plan/comment/history/audit snapshots unchanged. This bounded display increment does not certify full DBM-003/GOV-002, frozen target attestation or Oracle behavior."
  ],
  "test_references": ["SF-PRODUCT-T14-WEB"]
};
const PRODUCT_TASK_15 = {
  "id": "SF-PRODUCT-T15",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Verify retained source integrity before approving an offline plan",
  "dependencies": ["SF-PRODUCT-T14"],
  "feature_ids": ["GOV-013", "GIT-007"],
  "acceptance_criteria": [
    "An authenticated independent approver can approve a pending offline plan only when its scoped retained VALID release passes the existing bounded UTF-8 content/hash/format-1 manifest verifier and its ordered path/version/SHA256 file facts match the retained plan items. Missing, malformed or mismatched data returns a fixed integrity error before decision/history/audit writes. Existing authorization, self-approval, archived and terminal denial behavior and audit remain intact.",
    "Approval reads and verifies the linked release under a scoped row lock in the existing decision transaction after authorization, with consistent lock order and no stale checked snapshot during concurrent mutation. Rejection remains possible for an otherwise authorized pending plan with damaged source. Valid retained plans remain approvable without Git or a repository registration. No parser rerun, credential resolution, target connection, schema or worker execution is introduced.",
    "Real Git/PostgreSQL/parser/API/browser regressions cover valid approval and source content/hash/manifest corruption after planning, changed or malformed plan items, concurrent stored-release mutation, foreign references and fixed UI feedback. Integrity failures leave complete plan/comment/history/audit snapshots unchanged; authorized rejection and existing audited denials are separately verified. This verifies retained UTF-8 source at approval only, not a tamper-proof database, frozen target attestation, execution-time revalidation, full GOV-013/GIT-007 or Oracle behavior."
  ],
  "test_references": ["SF-PRODUCT-T15-API", "SF-PRODUCT-T15-WEB"]
};
const PRODUCT_TASK_16 = {
  "id": "SF-PRODUCT-T16",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Show retained requester facts and independent reviewer eligibility",
  "dependencies": [
    "SF-PRODUCT-T15"
  ],
  "feature_ids": [
    "GOV-001",
    "GOV-007"
  ],
  "acceptance_criteria": [
    "Selected plan review displays the retained author ID and server creation time from existing scoped plan data as plain text, with a valid time element and fixed unavailable feedback for malformed facts. Do not invent a requester name or substitute the current actor; pending, terminal and archived plans retain read access.",
    "For pending plans, a signed-in approver whose ID equals the retained author ID sees fixed independent-reviewer feedback and disabled approve/reject controls; missing or malformed author IDs also fail closed. Independent approvers retain existing decision controls, developers retain existing role feedback, and pending comments remain available. Project, plan and session changes clear stale requester/eligibility state. The existing API remains the authoritative self-decision denial and audit boundary; no API, schema or authorization changes are introduced.",
    "Real Git/PostgreSQL/parser/browser regressions compare retained requester/time facts for developer- and approver-authored plans, verify literal rendering, independent reviewer decisions, terminal/archive/project/session behavior, and no decision request or plan/comment/history/audit writes from viewing or blocked controls. Direct self-decision requests still return the existing audited denial. This bounded display/feedback increment does not implement editor exclusions, immutable intent revisions, full GOV-001/GOV-007 or Oracle behavior."
  ],
  "test_references": [
    "SF-PRODUCT-T16-WEB"
  ]
};
const PRODUCT_TASK_17 = {
  "id": "SF-PRODUCT-T17",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Freeze and verify the offline plan intent reviewed for approval",
  "dependencies": [
    "SF-PRODUCT-T16"
  ],
  "feature_ids": [
    "GOV-001",
    "GOV-012",
    "GOV-013"
  ],
  "acceptance_criteria": [
    "Creating an offline plan retains a versioned, bounded, server-built intent envelope and SHA-256 digest in the same transaction as the plan/history/audit. Specify an unambiguous format-1 serialization binding organization/project/requester, the verified release ID/commit/object format/folder/parser profile/manifest digest, the ordered path/version/SHA256 plan items, and the scoped profile/environment configuration including opaque credential reference. Lock and validate configured profile/environment facts while capturing them; reject missing or malformed references before writes. No caller-provided envelope, identity or digest is trusted and no secret is resolved or stored.",
    "Independent approval verifies the retained envelope and digest under the existing scoped transaction locks and requires agreement with the plan requester/release/profile IDs, retained source provenance and ordered item facts before any decision/history/audit writes. Missing legacy envelopes, malformed data, digest mismatch or changed bound plan facts fail with fixed integrity feedback; do not silently reconstruct or backfill historical intent. Preserve authorized rejection, authorization/self/archive/terminal audited denials and registry-free retained-source approval. Existing plans remain inspectable. A new configured profile or changed configuration does not alter an already retained envelope; a new plan captures new intent.",
    "Review displays the selected plan's retained offline intent digest and captured target/environment facts, clearly distinguished from current configured metadata and runtime-observed identity, without exposing credential references. Real Git/PostgreSQL/parser/API/browser and focused serialization tests cover distinct intents, restart persistence, scoped and malformed references, source/item/identity/envelope/digest corruption, concurrent configuration capture, legacy no-envelope behavior, literal display and complete no-write snapshots. Preserve project/session/selection guards. This bounded offline intent contract does not certify Oracle target identity/history, execution-time revalidation, authenticated editor provenance, approval expiry, full GOV-001/GOV-012/GOV-013 or a tamper-proof database."
  ],
  "test_references": [
    "SF-PRODUCT-T17-UNIT",
    "SF-PRODUCT-T17-API",
    "SF-PRODUCT-T17-WEB"
  ]
};
const PRODUCT_TASK_18 = {
  "id": "SF-PRODUCT-T18",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Prepare a fresh offline plan after rejection",
  "dependencies": [
    "SF-PRODUCT-T17"
  ],
  "feature_ids": [
    "GOV-010"
  ],
  "acceptance_criteria": [
    "For a selected rejected plan in an active, loaded project, users who can perform existing release intake have a clear Prepare new plan action leading to that project's bound release intake. The action clears the previously inspected release and unsent review drafts, restores the All plan filter, and explains that changed SQL must be committed and imported as a new immutable release. It performs no API write by itself; unavailable bindings, archives and stale project/session selections fail closed.",
    "Reuse the existing scoped release import and plan-creation API and retained T17 intent. Changed SQL is imported from a new commit and produces a distinct release, plan ID and intent digest requiring a new independent decision. The predecessor's rejection, source bytes, comments, decision provenance and existing history/audit rows remain unchanged. No old decision can approve the fresh plan; preserve role/self/terminal/archive denials and execution/history state.",
    "Real Git/PostgreSQL/parser/API/browser regressions reject a plan, commit changed SQL, follow the intake path, create and independently review a fresh plan, and verify immutable predecessor records, fresh pending state and scoped negative requests. Cover project/plan/session changes and archived/unbound action behavior. This bounded GOV-010 increment adds no SQL editor, plan mutation, durable predecessor/supersedes relationship, policy/expiry enforcement, full catalog acceptance or Oracle execution."
  ],
  "test_references": [
    "SF-PRODUCT-T18-API",
    "SF-PRODUCT-T18-WEB"
  ]
};
const PRODUCT_TASK_19 = {
  "id": "SF-PRODUCT-T19",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Protect source binding generations during offline plan approval",
  "dependencies": [
    "SF-PRODUCT-T18"
  ],
  "feature_ids": [
    "GIT-016"
  ],
  "acceptance_criteria": [
    "Protect the current project repository/folder binding with a server-owned monotonic generation. Increment on actual repository/folder changes, retain generation on no-op saves, and never accept client-supplied generations. Idempotent schema initialization establishes current configuration tracking only; leave every historical plan generation missing rather than inferring/backfilling it. Preserve existing binding authorization, archive, scoping and audit behavior.",
    "Under the existing project/source locks, new plan creation validates its retained release repository/folder against the current binding and captures the authoritative positive canonical binding generation. Keep T17 format-1 intent/digest immutable and separate. Reject missing/corrupt current configuration and mismatched release references before any plan/history/audit creation; preserve immutable release/source data and existing authorization.",
    "Before authorized independent APPROVE, compare the retained plan generation and source facts with current protected project configuration inside the existing plan -> project -> scoped source lock transaction. Missing, stale, malformed, corrupt or mismatched evidence fails closed with fixed fresh-plan-required feedback and no protected plan/comment/history/source mutation. Preserve existing role/self/terminal/archive denial precedence and established audit behavior. Binding changes away and back remain stale, no-op changes remain approvable, and locked concurrent updates cannot race approval.",
    "Historical pending plans without verifiable generation remain readable and eligible for existing authorized rejection, but cannot be approved until recreated. Do not rewrite old plans, comments, decision/history/audit rows or reconstruct historical generations. Approved/rejected/archived history stays readable. API/database restart persists captured generations and immutable predecessor records.",
    "The scoped React review UI explains why a fresh plan is needed, disables approval for known missing/stale/malformed binding evidence while preserving rejection, and reuses T18 Prepare new plan navigation for affected pending plans. Clear inspected source and drafts, restore All, perform no API write on navigation, and fail closed after project/plan/session/archive/unbound changes. Server denial remains authoritative for stale client views; fresh bound intake yields a distinct newly capturable plan without reusing the old decision.",
    "Real local Git/PostgreSQL/parser/API/browser regressions cover matching generations, changed and away/back bindings, no-op save, legacy/corrupt generations, concurrent binding update/approval and plan creation, immutable predecessor snapshots, rejected/archive reads, foreign project/organization and role/session boundaries, T18 recovery, and API/PostgreSQL persistence. Run existing build/type/source/tracker/license, standard, product and browser suites. This bounded GIT-016 increment does not claim execution-time invalidation, runner image/worker policy, runtime target or Oracle verification, full catalog acceptance, deployment or historical backfill."
  ],
  "test_references": [
    "SF-PRODUCT-T19-API",
    "SF-PRODUCT-T19-WEB"
  ]
};
const PRODUCT_TASK_20 = {
  "id": "SF-PRODUCT-T20",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Persist expiring and revocable local credentials",
  "dependencies": [
    "SF-PRODUCT-T19"
  ],
  "feature_ids": [
    "SEC-001"
  ],
  "acceptance_criteria": [
    "Persist stable trusted local actor IDs and fixed developer/approver roles, display names, and only server-computed SHA256 bearer digests with issued/expiry/revoked timestamps in PostgreSQL. Initial trusted startup credential seeding is insert-only and binds each principal to its configured organization and fixed role; repeated startup never extends expiry, restores revoked/expired credentials or changes identity/role from stale config. Trusted startup may refresh the current display name while retained decision-name snapshots remain immutable. Preserve input validation and reject duplicate identities/digests and inconsistent role/organization metadata. No caller actor ID is trusted and no application signup/admin/membership privilege is introduced.",
    "Authenticate every existing protected API request against its persisted server-owned principal and nonrevoked credential with database-clock fixed24-hour expiry from issuance. Forged, expired, revoked and unknown credentials receive fixed generic401 before product writes; roles continue to derive from trusted persisted identity. Reopening API/connection pools preserves expiration and revocation without resurrection. Revocation applies to subsequent request admission; do not claim cancellation of operations already admitted or cross-transaction global authorization atomicity.",
    "Provide a trusted local OS operator CLI for revoke and rotation of the existing fixed local developer/approver identities. Generate256-bit random replacement tokens, atomically revoke prior active credentials and insert one replacement digest/expiry in a database transaction without changing actor IDs/roles or historical authorship. Failed, duplicate or concurrent operations cannot reactivate old credentials. Operate only on explicit local private config and owned local metadata; do not resolve target references or mutate actual user credentials during testing.",
    "Protect lifecycle private files with mode0700 directory/mode0600 config, journal and staged file, bounded validation, symlink refusal and exclusive lifecycle lock. Rotation records crash-recoverable stages, commits database replacement then finishes same-filesystem atomic config replacement, with explicit recover/retry handling and fail-closed unknown/corrupt states. Startup must never overwrite or silently resurrect credentials from an interrupted/stale config. Test interruption before/after database commit and before/after file replacement and serialize concurrent operations. Do not claim database/filesystem atomicity. Never print raw tokens, hashes, database URLs/passwords or private journal content in normal command output/errors/audit/evidence.",
    "A401 for the currently active browser session clears actor/token, loaded project/plan/release/source and unsent comment/decision drafts, with clear fixed sign-in-again feedback. Delayed401 responses associated with an old session cannot clear a newly authenticated session. Failed initial sign-in gives generic feedback; current loopback sign-in and fresh-plan/review workflows remain usable with rotated credentials and existing project/role guards.",
    "Use real isolated local PostgreSQL/Git/parser/API/Chromium regressions for authentic/forged/expired/revoked/rotated tokens, no expiry extension or restart resurrection, duplicate/config/role/client-identity negatives, safe private-file modes/symlinks/locks, rotation interruption recovery and secret-free output, session/project/role isolation and existing immutable plans/source/generation/history/comments/decisions/audit. Run standard, full product/browser and source/type/build/tracker/license checks. This is a bounded partialSEC-001 local PRODUCT increment, not full original WP4-T01 browser-disabled CLI acceptance, membership/RBAC/TLS/OIDC/remote authority, Oracle execution/runtime target verification, deployment or database tamper-proofing."
  ],
  "test_references": [
    "SF-PRODUCT-T20-API",
    "SF-PRODUCT-T20-WEB",
    "SF-PRODUCT-T20-OPERATOR"
  ]
};
const PRODUCT_TASK_21 = {
  "id": "SF-PRODUCT-T21",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Enforce explicit local project membership with safe bootstrap and recovery",
  "dependencies": [
    "SF-PRODUCT-T20"
  ],
  "feature_ids": [
    "PRJ-003",
    "SEC-005"
  ],
  "acceptance_criteria": [
    "Add explicit persisted project grants for existing fixed-role local actors and a durable local-organization access mode BOOTSTRAP_REQUIRED -> ENFORCED. Preserve all existing projects, releases, plans, source generations, comments, retained intents/decisions, history and audits. Do not infer owners/members from creation/audit facts or backfill grants; membership cannot create actors, change roles or grant physical endpoint/worker administration.",
    "Provide a trusted local OS operator CLI for safe project/actor identification, explicit grant/revoke, bootstrap readiness and one-way activation, independent of API bearer validity. Validate owned bounded private configuration and fixed local organization, project and actor identities; never expose credentials or source SQL. Grant/revoke operations are transactional, idempotent and preserve auditable operator authority/facts without fabricating an application administrator. Recovery remains available after all project grants or login credentials are revoked; never auto-grant a creator or undo enforcement.",
    "Before activation, authenticated same-organization legacy reads may remain available under the existing fixed-role boundary, with clear bootstrap status. Deny every project-affecting API mutation (including project creation) with fixed bootstrap-required feedback before protected writes/audit. Require every existing project to have at least one explicit usable local grant before atomic activation; hold consistent access-mode/project/actor locks so concurrent project-set/grant changes cannot bypass coverage. Fresh empty metadata may activate through explicit operator action. No automatic membership or history rewrite occurs.",
    "After ENFORCED, scope all project lists/details, refs, source/archive, environments/profiles, release import/read, plan creation/read/decision, comments, audit/history by current server-resolved membership and unchanged global role. Missing/revoked/foreign/guessed project resource IDs return indistinguishable fixed denial without disclosing existence/data. Keep identity-wide session and safe repository metadata authenticated; no filesystem paths or SQL disclosure across denied resources. New project creation returns only a creation receipt and requires explicit operator grant before project access; creator gains no implicit access or administrative privilege.",
    "Check current persisted grants and credentials at each new request admission, preserving role/self/terminal/archive behavior for authorized members and consistent transaction lock order with operator changes. After revoke commits, subsequent admissions deny; already admitted operations may finish, with this limit explicit and no cancellation claim. API/PostgreSQL connection-pool reopen preserves mode/grants/revocation; archived historical data remains readable for current members. Failed/unauthorized operations do not mutate protected project/grant/history/source records; established authorized denial audit behavior remains.",
    "React shows bootstrap/read-only and safe empty/denied-access states. Creation never auto-loads a project without an explicit grant. Revoked selected-project access clears project/plan/release/source/drafts, and delayed project/session responses cannot repopulate them. Real isolated PostgreSQL/Git/parser/API/Chromium tests cover migration preservation with zero implicit grants, bootstrap/recovery/activation races, foreign/direct/guessed IDs, both roles, token expiry/revocation, grant revocation/new admissions, archive history, persistence and full existing regressions with explicit operator test-fixture grants rather than production bypasses. This is partial local PRJ-003/SEC-005, not full original WP4 worker/RBAC/organization transfer, remote IAM or Oracle execution/runtime target acceptance."
  ],
  "test_references": [
    "SF-PRODUCT-T21-API",
    "SF-PRODUCT-T21-WEB",
    "SF-PRODUCT-T21-OPERATOR"
  ]
};

const PRODUCT_TASK_22 = {
  "id": "SF-PRODUCT-T22",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Inspect parser-derived statement previews in offline release review",
  "dependencies": [
    "SF-PRODUCT-T21",
    "SF-PRODUCT-T17",
    "SF-PRODUCT-T19"
  ],
  "feature_ids": [
    "SQL-015",
    "GOV-013"
  ],
  "acceptance_criteria": [
    "Provide an authenticated project-scoped read-only statement preview for a retained release/file using current explicit membership and fixed roles. Preserve archived authorized reads and fixed indistinguishable resource denials. Scope and SQL size/shape bounds must be checked before materializing payloads; verify retained UTF-8 source/hash/manifest and pinned parser profile before parsing. No Git re-read, credential resolution or target connection.",
    "Reuse the pinned bounded ANTLR helper and its validated byte protocol. Return ordered source byte ranges, exact UTF-8 slices, source and normalized execution SHA256 facts, parser profile and delimiter disposition with explicit offline labels. Validate full coverage, ordered ranges, bytes and digests. Do not split by regex, invent unsupported parser output or claim the preview grants execution authority.",
    "Fail closed with fixed unavailable feedback for malformed, oversized, mismatched, unsupported, corrupt or parser-unavailable data. Produce no successful partial preview and no writes to projects, releases, plans, retained intents, decisions, comments, source generations, history or audit. Preserve existing whole-file source inspection and authorized rejection.",
    "React release/plan source review supports statement preview for the exact selected retained source. Show ordered literal SQL and byte/digest facts, distinguish source bytes from normalized execution facts and retained offline intent from runtime target verification. Project, plan, release, file, session and current credential changes discard delayed responses. Revoked project access clears retained source and drafts under T21 guards.",
    "Real isolated Git/PostgreSQL/pinned-parser/API/browser regressions cover PL/SQL blocks, comments, quoted semicolons, multiple statements and non-ASCII UTF-8 byte offsets; corrupt/malformed/oversized/unavailable data, foreign/missing/revoked membership, archive/read persistence and controlled stale responses. Compare complete retained-row snapshots for no writes and retain existing product/parser/browser regressions with no skipped required cases.",
    "This bounded offline SQL-015/GOV-013 preview does not alter original catalog acceptance, format-1 manifests or historical plans/intents. Recompute from authorized retained UTF-8 bytes without backfilling history. No approved worker digest binding, Oracle execution, runtime identity/history verification, remote CLI authority or full WP7 acceptance claim. Document this safe compatibility default and remaining delivery gaps."
  ],
  "test_references": [
    "SF-PRODUCT-T22-API",
    "SF-PRODUCT-T22-WEB",
    "SF-PRODUCT-T22-PARSER"
  ]
};

const PRODUCT_TASK_23 = {
  "id": "SF-PRODUCT-T23",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Attach retained statement evidence references to pending plan discussions",
  "dependencies": [
    "SF-PRODUCT-T22",
    "SF-PRODUCT-T21",
    "SF-PRODUCT-T17",
    "SF-PRODUCT-T19",
    "SF-PRODUCT-T06"
  ],
  "feature_ids": [
    "GOV-020"
  ],
  "acceptance_criteria": [
    "Extend existing pending-plan plain-text comments with optional capped structured statement references resolved from the same scoped retained release. Accept at most eight references with strictly bounded fields; fixed developer/approver roles and current explicit project membership remain authoritative. Preserve body-only comments, terminal/archive reads and fixed indistinguishable resource denials. No arbitrary upload, SQL payload, external URL or credential reference.",
    "Validate references before writes under the existing plan/project/source lock order: require a valid retained format-1 intent and digest, matching current protected binding generation, plan file facts and scoped retained release manifest. Apply database scalar size/shape bounds before payload loading and reuse T22 pinned-parser verification once per distinct file. Require exact source byte range and source/execution SHA facts; derive release/file/profile/intent facts server-side. Legacy or stale plans remain readable and body-only comment behavior remains unchanged; references require a fresh eligible plan rather than inferred or backfilled intent/generation.",
    "Persist a comment and validated supplemental reference facts atomically with existing comment audit; evidence cannot change plan items, source, intent envelope/digest, decisions, generations or execution/history. Store no SQL in reference/audit records and no arbitrary client title. Existing comments expose an empty reference list without rewriting their historical body/author/time/audit facts. Attachments cannot be edited/deleted or added after a terminal decision. A concurrent decision either follows the committed comment or causes attachment to fail without writes.",
    "React pending-plan review can select statements from the exact verified T22 plan-source preview and attach compact descriptors to a comment. Saved references display exact path/range/digests and retained intent digest as supplemental evidence; do not claim format 1 contains statement digests. Reopening resolves the exact tuple through the authenticated scoped preview API. Plan/project/release/session/current credential or invalidated source-context changes discard drafts and delayed results. Switching the displayed preview file discards late preview responses while explicit selected descriptors may span files of the same verified immutable plan release; the server revalidates all references on submission. Revoked access clears source and drafts under existing T21 guards.",
    "Real isolated Git/PostgreSQL/pinned-parser/API/Chromium tests prove valid multi-reference persistence after API/connection-pool reopen, legacy body-only compatibility, malformed/oversized/unknown fields, wrong release/path/range/digests/intent/source generation, foreign/revoked membership, archived/terminal history, and an exact-lock attachment-versus-decision race. Compare populated complete immutable-row snapshots and failed comment/audit snapshots. Retain standard, product, parser and browser regressions without skipped required cases.",
    "This bounded partial GOV-020 increment attaches supplemental read-only review evidence to existing format-1 intent; it does not alter original 220-feature acceptance, re-encode historical intent, bind statement execution authority, add arbitrary file storage, worker/dispatch, target connection or Oracle runtime verification. Document safe compatibility defaults and recovery; keep Oracle VALIDATION independently BLOCKED and Sonar unavailable never PASS."
  ],
  "test_references": [
    "SF-PRODUCT-T23-API",
    "SF-PRODUCT-T23-WEB",
    "SF-PRODUCT-T23-PERSISTENCE"
  ]
};

const PRODUCT_TASK_24 = {
  "id": "SF-PRODUCT-T24",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Page through retained project audit events",
  "dependencies": [
    "SF-PRODUCT-T23",
    "SF-PRODUCT-T21",
    "SF-PRODUCT-T09",
    "SF-PRODUCT-T05"
  ],
  "feature_ids": [
    "SEC-011"
  ],
  "acceptance_criteria": [
    "Add an authenticated project-scoped read-only audit page endpoint while preserving the existing project-detail recent-100 contract. Fixed developer/approver roles and current explicit membership remain authoritative on every page; missing/foreign/revoked projects retain fixed indistinguishable denials. Authorized archived reads remain available.",
    "Return bounded fixed-size pages in stable descending PostgreSQL (created_at,id) order using exclusive keyset pagination and limit-plus-one. Preserve exact PostgreSQL timestamp microsecond precision in cursor facts; do not round through JavaScript Date. Support a strictly bounded exact-action filter with server-owned scoped historical action choices, including actions absent from the recent 100. An additive scoped ordering index is allowed; no counter cache or historical record rewrite.",
    "Cursors have strict bounded canonical version/project/action/time/id fields and represent only untrusted query positions, never access authority. Reject malformed, oversized, unknown-field, cross-project or filter-mismatched cursors with fixed feedback before unsafe query processing. Parameterize all SQL and recheck current authorization; no external token signing service or credentials are required.",
    "React Records starts from the latest project audit page, offers Load older, appends stable deduplicated results and resets the cursor on project/filter/session/current credential/refresh changes. Discard delayed responses from prior contexts. Membership revocation clears prior scoped records under existing T21 recovery. Historical action filters work beyond the initial recent window; preserve immutable event labels/facts and existing offline history semantics.",
    "Real isolated PostgreSQL/API/Chromium tests with more than 100 populated events and tied microsecond timestamps prove concatenated pages equal the exact descending server ordering without duplicates/skips; older-only action filtering, empty/final pages, malformed/oversized/cross-project/action-mismatch cursors, membership revoke between pages, archived reads, API recreation/persistence and controlled delayed responses. Compare complete retained source/plan/intent/comment/history/audit rows for no writes; keep standard/product/parser/browser regressions without skipped required cases.",
    "This is partial SEC-011 retrieval only: original event-coverage, search, retention, export, tamper evidence and Oracle/runtime acceptance remain unchanged and unverified. No new audit actions, assignment/delegation, deployment, worker dispatch, target/credential access or execution authority. Document safe reversible cursor/migration defaults under standing autonomy; preserve Sonar unavailable never PASS and independent Oracle VALIDATION BLOCKED."
  ],
  "test_references": [
    "SF-PRODUCT-T24-API",
    "SF-PRODUCT-T24-WEB",
    "SF-PRODUCT-T24-PERSISTENCE"
  ]
};

const PRODUCT_TASK_25 = {
  "id": "SF-PRODUCT-T25",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Compare retained migration release sources",
  "dependencies": [
    "SF-PRODUCT-T24",
    "SF-PRODUCT-T12",
    "SF-PRODUCT-T11",
    "SF-PRODUCT-T21"
  ],
  "feature_ids": [
    "MIG-008",
    "MIG-009"
  ],
  "acceptance_criteria": [
    "Add authenticated same-project read-only comparison of two selected retained migration releases. Reuse fixed roles and current explicit project membership; missing, foreign or revoked resources retain indistinguishable denials. Authorized archived reads and repository-unavailable retained reads remain available. Existing release and plan APIs remain compatible; comparison confers no planning, approval or execution authority.",
    "Under consistent scoped project/release read locks, apply PostgreSQL scalar size/shape/metadata preflight to both releases before loading file payloads. Require VALID retained releases, bounded verified UTF-8 content and reproduced format-1 manifests using existing verification. Require matching retained repository ID, folder and parser profile for a comparable pair. Reject malformed, oversized, corrupt or incompatible references with fixed feedback and no writes; never infer or backfill old generations, intent, raw bytes or applied history.",
    "Align files by existing canonical arbitrary-precision migration version and produce deterministic ordered ADDED, REMOVED, CHANGED and UNCHANGED source facts, including both paths and retained SHA256/byte metadata. A path/name change at the same version is CHANGED even when content is equal. Detect exact content changes and preserve literal source bytes; do not convert versions through JavaScript Number or infer deployment/schema/target drift. Comparing a release with itself is a valid unchanged source view.",
    "React release review lets both fixed roles explicitly select base and candidate retained releases, see both immutable commit/manifest identities and ordered comparison facts, and inspect retained SQL with existing escaped rendering. Label the result as source comparison only. Project/pair/session/current credential/refresh changes discard results and delayed responses; revoked access clears scoped records using current recovery. Failed comparisons leave existing records intact and can be retried with fresh scoped reads.",
    "Real temporary Git commits, isolated PostgreSQL/API and Chromium prove added, removed, one-byte content edit, same-version rename and unchanged files; deterministic arbitrary-precision ordering; self comparison; invalid duplicate-version imports; corrupt/malformed/oversized/incompatible or cross-project pairs; unauthorized/revoked reads, archived history, removed repository registration, controlled delayed pair/project/session responses and API/connection-pool recreation persistence. Compare complete populated retained source/plan/intent/comment/decision/history/audit snapshots for no writes and preserve all standard/product/parser/browser regressions without skipped required cases.",
    "This is a bounded retained-source review extension supporting MIG-008/MIG-009, not full original catalog acceptance, MIG-013 applied checksum enforcement, MIG-014/MIG-033 schema drift/comparison, or GIT-015 deployed provenance. Preserve original 220-feature requirements and separate Oracle VALIDATION BLOCKED. No target connection, credentials, parser rerun for comparisons, Git reread, external source, schema snapshot fabrication, history rewrite, worker/dispatch or deployment. Document safe compatibility/recovery defaults and preserve Sonar unavailable never PASS."
  ],
  "test_references": [
    "SF-PRODUCT-T25-API",
    "SF-PRODUCT-T25-WEB",
    "SF-PRODUCT-T25-PERSISTENCE"
  ]
};

const PRODUCT_TASK_26 = {
  "id": "SF-PRODUCT-T26",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Bound retained-source metadata before protected payload reads",
  "dependencies": [
    "SF-PRODUCT-T25",
    "SF-PRODUCT-T23",
    "SF-PRODUCT-T22",
    "SF-PRODUCT-T19",
    "SF-PRODUCT-T17",
    "SF-PRODUCT-T15"
  ],
  "feature_ids": [
    "MIG-008",
    "GIT-016",
    "GOV-023"
  ],
  "acceptance_criteria": [
    "Apply complete bounded PostgreSQL scalar preflight before loading retained files in statement preview, offline plan creation, source-linked comments and approval. Reuse scoped existing locks, VALID source verification and fixed endpoint errors. Bound encoded non-content metadata including unknown nested fields/array overhead and identity facts; type/range known scalar fields with guarded safe numeric processing. Preserve current content budgets and arbitrary-precision supported versions.",
    "Preserve historical retained releases and plans without rewriting or backfilling. Valid Unicode content, null/nonnegative safe statement counts and bounded historical extension metadata remain supported. Malformed or excessive metadata fails before payload materialization; retain legacy readable/rejection behavior and existing generation/intent/fresh-plan boundaries.",
    "Preserve existing authorization, explicit memberships, fixed roles, requester exclusion, archival and terminal protections. Authorized integrity failures cause no new plan/comment/decision/history/audit mutations; existing audited authorization-denial behavior remains unchanged. No new execution authority, target credentials, Oracle calls or schema migration without concrete necessity.",
    "Use one reusable bounded PostgreSQL preflight implementation where practical without changing importer manifests or historical verification semantics. Keep exact transaction lock ordering for project/release/plan/profile and prevent concurrent retained mutation from bypassing checks. Reuse T18 fresh-plan recovery and existing fixed UI integrity feedback.",
    "Real isolated PostgreSQL and local Git fixtures cover each of four readers with legitimate Unicode/arbitrary versions/null counts/bounded extras; oversized flat/nested extras, malformed known metadata, aggregate content and counts; both roles/project isolation/archive/rejection/no Git registration; exact locking concurrent mutation and API/pool recreation persistence. Compare complete populated source/plan/intent/comment/decision/history/audit snapshots immediately around failures before restoration; preserve all full standard/Git/parser/product/browser regressions with zero skipped required cases.",
    "This is bounded security hardening for retained-source reads, not full original catalog, database tamper-proofing, deployed/schema or Oracle validation. Preserve original220 requirements/dependencies, immutable failed evidence, license/grants/locks/grammar/scanners and normal exact-head QA/security/CI gates. Sonar unavailable never PASS; Oracle VALIDATION independently BLOCKED; no history rewrite/target connection/deployment."
  ],
  "test_references": [
    "SF-PRODUCT-T26-API",
    "SF-PRODUCT-T26-PERSISTENCE",
    "SF-PRODUCT-T26-WEB"
  ]
};

const PRODUCT_TASK_27 = {
  "id": "SF-PRODUCT-T27",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Bound retained release detail reads before payload materialization",
  "dependencies": [
    "SF-PRODUCT-T26",
    "SF-PRODUCT-T25",
    "SF-PRODUCT-T13",
    "SF-PRODUCT-T11",
    "SF-PRODUCT-T21"
  ],
  "feature_ids": [
    "GIT-006",
    "MIG-008",
    "MIG-009"
  ],
  "acceptance_criteria": [
    "GET /api/releases/:id uses scoped transaction and database scalar bounds before selecting retained files or raw identity/status/code metadata. Reject malformed/oversized retained records with fixed non-sensitive unavailable response; never transfer unknown unbounded fields through SELECT *. Preserve existing authenticated membership and project archive read boundaries.",
    "Keep bounded legitimate retained VALID, INVALID and UNAVAILABLE imports readable, including per-file VALID/INVALID/UNAVAILABLE/NOT_VALIDATED observations, null statement counts, bounded unknown nested metadata, Unicode and arbitrary-precision versions. This reader is historical display; do not promote invalid/unavailable release to VALID, rewrite historical source/hash/manifest, backfill intent/generation or authorize planning/approval.",
    "Reuse T26 scoped scalar bounds where practical with explicit protected versus historical-read policy, preserving 128files/2MiBper/16MiBtotal content and4MiB complete encoded non-content metadata budget. Bound validationCode and every returned identity/status field before Node allocation; shared helper changes preserve strict protected-reader validity. No parser/Git re-read/target connection or schema migration without concrete necessity.",
    "Under existing scoped source locks prove concurrent mutation cannot bypass preflight and later payload selection. Every authorized read failure/success leaves complete populated source/project/plan/intent/comment/decision/history/audit records unchanged. Preserve current roles/grants/session/bootstrap/archive and API restart/PostgreSQL persistence; no denial audit mutation added to reads.",
    "Real local Git and isolated PostgreSQL produce legitimate valid and invalid/offline-unavailable releases and exercise oversized flat/nested metadata, bad known fields/arraycounts/aggregatecontent/huge status and code. Query instrumentation proves no raw payload or unbounded status projection before rejection; snapshots surround request before fixture restoration. Browser existing source/provenance/review inspection displays bounded valid/invalid historical facts and fixed unavailable error; stale project/session responses stay hidden. Run full standard/Git/parser/product/browser regressions with zero required skips.",
    "Bounded resource hardening closes only independently reviewed residual detail-read finding, not all original220 features or runtime attestation. Preserve license/notices/grants/dependencies/locks/grammar/scanners/immutable failures. Normal exact-head independent QA/security/CI and eligible merge gates remain; unmerged prerequisites can support documented local verification only. Sonar unavailable never PASS; Oracle independently BLOCKED; no public history rewrite/deployment/credential resolution."
  ],
  "test_references": [
    "SF-PRODUCT-T27-API",
    "SF-PRODUCT-T27-PERSISTENCE",
    "SF-PRODUCT-T27-WEB"
  ]
};

const PRODUCT_TASK_28 = {
  "id": "SF-PRODUCT-T28",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Find pending reviews across authorized active projects",
  "dependencies": [
    "SF-PRODUCT-T16",
    "SF-PRODUCT-T21",
    "SF-PRODUCT-T08"
  ],
  "feature_ids": [
    "GOV-021"
  ],
  "acceptance_criteria": [
    "Authenticated developers and approvers can list pending plans across only their currently explicitly granted active projects. Bootstrap-required access returns an empty inbox. Support All pending, Authored by me and Eligible for my review scopes; eligibility means fixed approver role plus requester exclusion only, not source integrity or execution attestation. Preserve organization isolation and existing project-detail/review contracts.",
    "Return a fixed bounded page of safe plan/project/requester/time/status identifiers and role eligibility; exclude SQL/items, source files, target profiles, credential references and private repository paths. Stable descending PostgreSQL (created_at,id) limit-plus-one pagination preserves exact timestamp precision. Strict bounded canonical scope/actor/time/id cursors are untrusted query positions; recheck current access on every page and reject malformed, oversized or context-mismatched input with fixed feedback. Add only a scoped ordering index if useful; no history rewrite.",
    "Provide a discoverable React inbox with role/authorship filters, empty/loading/error states, refresh and Load older. A row opens that exact project and plan in the existing review workflow without retaining another plan comment/decision drafts. Switching scope, refreshing, sign-out/session/current credential or membership changes discards old pages and delayed responses; navigation denial clears revoked data. The inbox makes no decisions or writes.",
    "Real isolated PostgreSQL/API/browser tests cover multiple authorized/foreign/revoked/archived projects, both roles, requester exclusion, all three scopes, more than one page with tied microsecond timestamps and exact order, final/empty/malformed/cross-actor/filter cursor cases, membership revocation between pages, API recreation/persistence, exact row navigation and controlled stale responses. Compare complete populated retained source/plan/intent/comment/decision/history/audit state for read-only behavior. Required standard/product/parser/browser regressions pass without required skips.",
    "This is a bounded GOV-021 inbox facet; assignment/delegation/notifications, full catalog acceptance, Oracle execution and worker dispatch remain unverified. Use only merged T16/T21/T08 prerequisites from master0fd6980, not the unmerged T24-T27 stack. Preserve original220 contracts, immutable failures, license/notices/pins and required security gates. Sonar unavailable never PASS; no deployment/target connection/credential resolution."
  ],
  "test_references": [
    "SF-PRODUCT-T28-API",
    "SF-PRODUCT-T28-WEB",
    "SF-PRODUCT-T28-PERSISTENCE"
  ]
};

const PRODUCT_TASK_29 = {
  "id": "SF-PRODUCT-T29",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Assign and reassign independent reviewers for pending project plans",
  "dependencies": [
    "SF-PRODUCT-T16",
    "SF-PRODUCT-T21",
    "SF-PRODUCT-T19",
    "SF-PRODUCT-T05"
  ],
  "feature_ids": [
    "GOV-021"
  ],
  "acceptance_criteria": [
    "Persist nullable reviewer assignment and monotonic bigint revision for pending plans using an additive idempotent PostgreSQL migration. Existing unassigned plans retain independent fixed-role review behavior; no author, retained source, intent, decision, comment or history rewrite. Survive API restart. Assignment metadata remains readable on historical terminal or archived plans without making them editable.",
    "Expose scoped safe assignment and bounded current-reviewer choices with authenticated explicit current project grants, organization isolation, active credentials and fixed approver role; exclude requester. Bootstrap exposes no new reviewer directory. Only the current granted requester or current assigned eligible reviewer may assign/reassign/clear; an eligible nonauthor approver may claim an unassigned plan for themselves. Never grant project access or roles. Strict expected revision rejects stale competing edits. Same-target no-op preserves revision/audit; actual changes create one atomic safe audit event. Terminal/archive/malformed/foreign/revoked/expired and self-assignment cases fail closed without protected mutation.",
    "Enforce assignment at the decision API inside existing plan/project locking and source-integrity workflow: assigned plans admit only the assigned independent current approver for approval or rejection; unassigned plans preserve established role/self/status checks. Recheck current caller grants/credential/role in the transaction and serialize membership changes under existing project lock order. Preserve strict fresh-plan/source/intent checks, denial auditing and execution NOT_EXECUTED. Assignment does not attest source integrity or authorize worker/Oracle access.",
    "Add usable React review assignment controls, current assigned identity or unassigned explanation, bounded candidate choices, explicit clear and self-claim where authorized, conflict/empty/error feedback, and an Assigned to me filter in the existing project review list. Disable other approver decision controls for assigned plans. Expected revision accompanies writes; project/plan/session/credential/membership/refresh changes discard pending choices and delayed responses, clear revoked data and never submit stale writes. Existing review drafts and navigation isolation remain intact.",
    "Real isolated PostgreSQL/API/Chromium tests prove requester selection, self-claim and reassignment, assigned/unassigned decisions, requester exclusion even for approver authors, role and grant/credential revocation, unauthorized/foreign/bootstrap/archived/terminal/malformed cases, concurrent assignment conflict and decision/assignment serialization, no-op audit, persistence/idempotent migration, assigned filter and controlled delayed UI responses. Compare complete protected source/intent/comment/history state and assert atomic assignment/audit outcomes. Run standard/product/parser/browser regressions without skipped required cases. This bounded GOV021 assignment facet leaves expiring temporary delegation, notifications, worker/API full catalog acceptance and Oracle validation unverified. Preserve all original220 contracts, dependencies, license/notices/pins and draft security gates; no dependency on unmerged T24-T28."
  ],
  "test_references": [
    "SF-PRODUCT-T29-API",
    "SF-PRODUCT-T29-WEB",
    "SF-PRODUCT-T29-PERSISTENCE"
  ]
};

const PRODUCT_TASK_30 = {
  "id": "SF-PRODUCT-T30",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Register shared provisional target references and assign schemas to projects",
  "dependencies": [
    "SF-PRODUCT-T21",
    "SF-PRODUCT-T20",
    "SF-PRODUCT-T02"
  ],
  "feature_ids": [
    "DBM-001",
    "DBM-004",
    "DBM-007"
  ],
  "acceptance_criteria": [
    "Persist organization-owned provisional physical database registrations, containers, normalized service-route references and exact-case schema references using additive idempotent PostgreSQL tables and same-organization constraints. Stable server UUIDs and generation1 record manual reference provenance only, never VERIFIED/discovered/observed Oracle identity. Repeating identical declarations returns existing IDs without duplicate endpoint/schema or audit rows; conflicting existing immutable registration/container/route facts fail atomically. Exact-case owners stay distinct. Existing project profiles, releases, plans, source/intent/decision/comment/history remain unchanged; restart and repeated initialization preserve catalog and legacy data.",
    "Provide a trusted local OS operator command using the existing private local configuration and loopback PostgreSQL authority protections, no bearer/API inventory administration. Strict bounded secret-free declarations register one database/container/route/schema hierarchy; no passwords, credential resolution, Oracle calls, containers/images or endpoint probes. Explicit assign/reassign/unassign requires schema ID, nullable target project, canonical bigint expected revision and reason. Enforce one active owning project per schema, serialized competing edits and archived/foreign/missing guards. Same-target no-op preserves revision/audit; actual transfer closes previous assignment and creates immutable history, increments revision and atomically records safe local-operator audit. Preserve schema identity and all former project records; no automatic historical profile migration or grants.",
    "Expose a bounded read-only current schema-reference list for an authenticated actor with current explicit project grant in ENFORCED mode. Bootstrap returns an empty directory; ungranted/foreign project scopes fail closed. Return only currently assigned schema plus its required shared database/container/service reference summaries, inherited declared container environment and assignment revision; no other project schemas/assignment histories/operator reasons/UIDs/credential refs or physical route host details. Stable project-scoped UUID keyset pages at50 rows plus next cursor; current grants and ownership rechecked for every read. Reads do not add audits, mutate assignments/history or confer execution readiness. Archived projects retain only their own current-reference reads.",
    "Add usable React project schema-reference navigation with provisional/reference-only identity labels, inherited declared environment, exact owner, stable IDs and revision, bounded next-page/refresh and empty/error feedback. Clear references/page state on project/session/grant/credential changes and discard delayed old context responses. Explain trusted local operator registration/ownership without adding application administrator or writer permissions. References do not become profile/plan/approval/execution targets; existing offline plan/history state remains NOT_OBSERVED/NOT_EXECUTED.",
    "Real isolated PostgreSQL/operator/API/Chromium tests prove shared endpoint/container deduplication for two projects and schemas, exact owner semantics, atomic conflict/no-op/transfer/release history, concurrent stale revision rejection, archive/foreign/malformed/private-config/secret/unsupported operation denial, restart/idempotent migration, safe project isolation and pagination, revocation and controlled delayed UI reads. Compare complete protected project/source/plan/intent/release/decision/comment/history records. Run required standard/product/parser/browser regressions without skipped required cases and proportionate independent review. Keep full DBM001/004/007, Oracle discovery/attestation, profile-purpose bindings, lifecycle restore, plan target binding and schema baseline acceptance unverified; original220 contracts/dependencies, license/notices/pins and existing draft gates unchanged. Independent merged-master branch; no dependency on unmerged T24-T29."
  ],
  "test_references": [
    "SF-PRODUCT-T30-OPERATOR",
    "SF-PRODUCT-T30-API",
    "SF-PRODUCT-T30-WEB",
    "SF-PRODUCT-T30-PERSISTENCE"
  ]
};

const PRODUCT_TASK_31 = {
  "id": "SF-PRODUCT-T31",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Withdraw approved offline plans with linked immutable revocation history",
  "dependencies": [
    "SF-PRODUCT-T07",
    "SF-PRODUCT-T19",
    "SF-PRODUCT-T20",
    "SF-PRODUCT-T21",
    "SF-PRODUCT-T23"
  ],
  "feature_ids": [
    "GOV-011",
    "GOV-013",
    "GOV-023"
  ],
  "acceptance_criteria": [
    "Add a stable server-generated approval reference for new APPROVE decisions and a same-project/organization append-only linked approval-revocation record unique per plan. New approval reference and existing PLAN_APPROVED audit commit atomically. Legacy approved plans retain NULL approval reference without backfill and remain explicitly distinguishable. Revocation changes only lifecycle projection to REVOKED and adds its linked record/audit; preserve original APPROVE decision, reason, principal/name/time, source binding, retained release/files/items, intent envelope/digest, profile, comments and NOT_EXECUTED/NOT_OBSERVED history. Repeated initialization/restart preserves old and new records.",
    "Implement authenticated POST /api/plans/:id/approval-revocation with exactly mandatory expectedApprovalReference (UUID or explicit NULL) and bounded nonempty Unicode-safe reason, no extra fields. Require ENFORCED membership, current exact credential and live approver role/grant rechecked after credential lifecycle serialization and scoped plan/project locks; exclude request author and fail closed on unavailable author facts. Only active same-organization approved APPROVE offline candidate plans with NOT_EXECUTED/NOT_OBSERVED are withdrawable. Match expected reference, including explicit legacy NULL. Missing/foreign/ungranted scopes remain hidden; malformed/archived/developer/self/stale/pending/rejected/revoked/observed-or-executed cases fail without lifecycle/history mutation. Serialize competing withdrawals to one revocation and one success audit. Do not require intact SQL/source/intent to remove approval authority; corrupted or stale approved content may still be withdrawn by an eligible independent actor. Preserve safe fixed denial auditing for authenticated authorized attempts.",
    "Expose safe approval reference and historical revocation attribution/reason/time in existing scoped project plan responses. Add REVOKED status filtering while keeping original decision record visible and immutable. Revoked plans cannot be approved again; correction uses the existing fresh release/new-plan workflow. Retained release/source/comments/history reads remain project-scoped and available under existing archive/read policies. No target credential resolution, real execution, jobs, queued-dispatch or HOLD claim; execution endpoint remains unavailable and all existing execution/history states remain unchanged.",
    "Add React withdrawal reason/action for a current independent approver on an approved selected plan; disabled/hidden controls and clear conflict/permission feedback for other states, archives and bootstrap. Display original approval separately from linked withdrawal, safe text, current REVOKED status/filter, and fresh-plan recovery for revoked plans. Clear withdrawal drafts and discard delayed success/failure on session/project/plan changes and A-to-B-to-A, using context epochs rather than only ID comparison. Preserve selected project/filter context when refreshing and never present withdrawal as rollback of committed database effects.",
    "Real isolated PostgreSQL/API and Chromium tests cover new/legacy approvals, linking, immutable protected-state snapshots, repeated initialization/restart, strict/malformed/foreign/ungranted/archive/role/self/stale/state/executed negatives, corrupted-content withdrawal, one-event concurrent races, queued credential/grant/role rechecks, filtering/read privacy, fresh recovery and controlled delayed UI responses. Preserve focused failures with honest capture limits. Run required frozen standard/product/pinned-parser/browser regressions with no skipped required cases and proportionate independent review. Keep full GOV011 queued-job admission/worker controlled stop/HOLD/committed-effects acceptance and Oracle19c/21c unverified. Original220 contracts/dependencies, licenses/notices/pins and draft gates unchanged; independent merged-master branch without unmerged T24-T30 source prerequisites."
  ],
  "test_references": [
    "SF-PRODUCT-T31-API",
    "SF-PRODUCT-T31-WEB",
    "SF-PRODUCT-T31-PERSISTENCE"
  ]
};

const PRODUCT_TASK_32 = {
  "id": "SF-PRODUCT-T32",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Integrate the reviewed MVP Git-to-plan-to-review backlog into one usable offline workflow",
  "dependencies": [
    "SF-PRODUCT-T27",
    "SF-PRODUCT-T28",
    "SF-PRODUCT-T29",
    "SF-PRODUCT-T30",
    "SF-PRODUCT-T31"
  ],
  "feature_ids": [
    "MIG-006",
    "GOV-011",
    "GOV-021",
    "GOV-023",
    "DBM-019"
  ],
  "acceptance_criteria": [
    "Combine reviewed draft37 through44 source heads using ordinary isolated local merge commits; preserve every original branch, PR, source SHA, immutable evidence and original220 catalog/dependency contracts. Reconcile existing tasks/acceptance/graph/ownership/evidence by stable identity without losing independently verified records. Resolve API/UI/schema and test-runner conflicts as one coherent product; no false claim that this candidate is integrated master or externally merge eligible.",
    "A real registered local Git repository supplies independently imported releases through the pinned parser. In one running metadata product, a granted requester binds source, inspects retained release metadata and exact source, compares releases, creates an offline plan and comment, assigns an independent reviewer, and reaches that exact plan through the cross-project inbox. Inbox ALL stays project scoped, while eligibility/ELIGIBLE respects current author/role and reviewer assignment; other assigned reviewers cannot decide. Existing revoked membership/credential/session/project/archive controls remain enforced.",
    "The assigned reviewer records a real approval with stable audit-linked reference. Any currently granted independent approver may withdraw it, including an approver different from the assigned reviewer. Original approval, reviewer assignment, source/intent/release/comment and NOT_EXECUTED/NOT_OBSERVED history remain intact; inbox excludes decided/revoked candidates. Fresh release/new pending-plan recovery never reapproves the old revoked plan. Paged/filterable audit exposes assignment/approval/revocation history, including older events. Manual schema references remain provisional operator-controlled project ownership, not target identity attestation or execution binding.",
    "Chromium proves the combined intake/reviewer/inbox/approval/withdrawal/fresh-plan/audit workflow through the integrated UI with safe text, exact plan/project navigation and current role restrictions. Combined response handlers preserve previous tested ABA/refresh/session guards and ownership of newer writes; no external screen callback references App-only lexical state. Durable restart/idempotent additive migration preserves combined records and explicit legacy NULL approval references.",
    "Focused real PostgreSQL/API/pinned-parser/Chromium integration tests cover the new cross-feature interactions and protected-state snapshots. After source freezes, run required standard/product/parser/browser suites without skipped required cases, review the exact combined source independently, inspect changed publication content/history and dependencies/licenses. Publish one reviewed draft against actual master; merge/verify exact master only if all actual external gates pass. Record unavailable security/Sonar/Oracle evidence honestly; no queue/worker/Oracle/execution/HOLD or full catalog acceptance claims."
  ],
  "test_references": [
    "SF-PRODUCT-T32-API",
    "SF-PRODUCT-T32-WEB",
    "SF-PRODUCT-T32-PERSISTENCE"
  ]
};

const PRODUCT_TASK_33 = {
  "id": "SF-PRODUCT-T33",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Deliver durable deployment requests and restricted execution coordination",
  "dependencies": [
    "SF-PRODUCT-T32"
  ],
  "feature_ids": [
    "GOV-018",
    "GOV-011",
    "OPS-002",
    "OPS-005",
    "MIG-012"
  ],
  "acceptance_criteria": [
    "Deliver a durable PostgreSQL deployment request/job/event workflow tied to one project, immutable approved plan/reference and intent digest. Authenticated request input accepts only server-resolved identities, bounded idempotency and reason; no submitted SQL, DSN, credential, status or executable target. Create job, first immutable event and audit atomically; same principal/action idempotency key repeats the same payload without new job/event, while a different payload conflicts. Current exact credential/role/membership/deployer permission and project/plan state are rechecked under lifecycle locks; cross-project, self-authorized role escalation, archive, revocation, stale reference/intent and malformed requests cannot create jobs.",
    "Trusted local OS operator explicitly grants/revokes project deployment permission independently of developer/approver roles and ordinary membership. Require current explicit project membership and usable identity; preserve operator audit. Ordinary membership revocation removes deployment capability without implicit restoration on regrant. API never exposes operator or writer secrets. An approver without explicit deploy permission cannot request execution; read access remains current-project scoped.",
    "Current offline plans lack observed target/history/ledger/mutex/validity evidence, so valid requests persist WAITING_VALIDATION with explicit unavailable readiness; no API transition can infer admission from manual schema references, grant status, approval or parser success. Requester cancellation before dispatch appends a revision-checked terminal event, without erasing approval, source, request or migration history. Approval withdrawal invalidates waiting requests atomically; later claim/dispatch must reject withdrawn authority. Durable job detail/list/events expose state and origin, not applied SQL or invented effects.",
    "Implement a separate restricted execution coordinator kernel and PostgreSQL job/attempt/event adapters with scoped trusted ports. Only admitted immutable jobs may be claimed; use durable claims/generations, no automatic replay after expiry or unknown outcomes. Recheck current authorization and exact retained content/history before dispatch and each statement, require held canonical target mutex and exact bytes/digests, persist STARTED before calls and immutable ordered acknowledgments/receipts. Loss of acknowledgment, cancellation/revocation after possible effects, central evidence gap or failed/unknown validity yields HOLD. Receipt absence and driver success alone never prove no effect or deployed success. A complete authorized receipt plus validity/postconditions and durable central evidence is required for VERIFIED_SUCCESS; known zero pending records NOOP with zero migration calls. Trusted test ports may simulate these outcomes only with explicit UNIT/synthetic scope; no production Oracle adapter or runtime acceptance is inferred.",
    "Integrated UI lets a granted deployer request an approved plan, see waiting readiness/history, retry idempotently after a lost response, inspect job events and cancel undispatched work; actor without deploy permission sees fixed denied/unavailable controls. Stale project/session/refresh/ABA responses and older writes cannot replace current context or clear a newer busy operation. Preserve all T32 review/source/assignment/withdrawal flows. Additive idempotent migration and real database/app reopen preserve job identity/events/grants, existing legacy NULL approvals and historical records.",
    "Exercise real local Git/pinned-parser approved plans, real PostgreSQL API/operator persistence and Chromium request-to-job/cancel/withdrawal flows, plus meaningful independent coordinator tests for multiple contenders, stale authority/content, lost acknowledgment/lease, receipt gap, invalid verification and no replay/noop. Run focused tests during implementation; freeze once for mandatory standard/product/browser regressions and exact independent review, then scoped scans/license checks and one draft from the verified T32 checkpoint. Preserve original220 acceptance contracts, source heads, worktrees and unavailable external gates; no Oracle connection/deployment, production target attestation, actual worker isolation or complete catalog certification."
  ],
  "test_references": [
    "SF-PRODUCT-T33-API",
    "SF-PRODUCT-T33-WEB",
    "SF-PRODUCT-T33-COORDINATOR",
    "SF-PRODUCT-T33-PERSISTENCE"
  ]
};
const PRODUCT_TASK_34 = {
  "id": "SF-PRODUCT-T34",
  "package": "PRODUCT",
  "assigned_agent": "devops",
  "title": "Deliver private metadata and artifact backup with safe restore into execution hold",
  "dependencies": [
    "SF-PRODUCT-T33"
  ],
  "feature_ids": [
    "OPS-012",
    "MIG-034",
    "OPS-005"
  ],
  "acceptance_criteria": [
    "Trusted local OS operator backs up an explicitly authorized loopback PostgreSQL metadata database through the existing private config boundary, using pinned mature PostgreSQL tooling and a consistent snapshot. A new private directory/file set preserves approval/catalog/artifact/receipt/job/audit/credential lifecycle records with a strict versioned manifest, archive digest, source metadata generation/checkpoint and complete known schema inventory. Existing paths, unsafe permissions, symlinks/hardlinks, unknown schema/tool/remote Docker context and excessive payloads fail closed. Backup data remains private; no bearer token, password, DSN, SQL contents or target credential is printed in diagnostics. Keep an independently operator-held witness outside the backup directory tied to the exact snapshot/digests.",
    "Restore requires exact archive/manifest/schema compatibility and matching private external witness before creating a destination. Restore only into a freshly generated owned local metadata database; never overwrite, clean, delete, truncate or restore into the source or another existing database. Restrict native restore payload to registered product data/current controlled schema; reject unknown or executable archive objects. Failure keeps the new instance inaccessible or in recovery hold; cleanup may touch only objects created and positively owned by this invocation. Preserve original source and private backup bytes.",
    "Before any restored queue is eligible, persist a new metadata generation with RESTORE_HOLD, retained predecessor/witness references and operator audit. Initialization/restart cannot reset this state. Both production and explicitly UNIT coordinator stores reject claims while hold is active; API cannot grant execution, release hold or infer target agreement. Retain immutable identities, approval/source/history/receipts and terminal states. Project waiting/admitted requests and active attempts into HOLD with appended events where needed, revoke restored old local credentials with retained lifecycle evidence, and never reset attempts or automatically replay SQL. Target history/Oracle generation remain unobserved; this does not certify Oracle restore detection or reconciliation.",
    "Deliver a usable operator restart path for the restored instance, reusing loopback API/web and existing private credential lifecycle without rewriting fixed actor roles or inferring memberships. Freshly rotated credentials and retained explicit membership permit historical reads; old tokens remain denied. UI exposes a fixed metadata-recovery hold state and disables execution request/cancel writes as appropriate while preserving T33/T32 historical flows and current actor/project/session/refresh guards. No HTTP backup, restore, credential administration or unilateral recovery-clear endpoint is exposed. Document backup custody, fresh destination/start/recovery and failure boundaries.",
    "Exercise actual native PostgreSQL snapshot/restore plus real local Git/pinned-parser approved plans, durable jobs/grants/events, historical NULL approval/assignment values, audit/comment/source/receipt preservation and app/database reopen. Prove original database remains unchanged; wrong/absent witness, damaged artifact/manifest, incompatible/unknown schema, path/permission/remote-tool overrides and interrupted restore cannot admit work. Verify restored claim denial including synthetic admitted fixtures, old-token denial and meaningful Chromium historical-read/recovery-hold controls. Synthetic attempts/targets are UNIT-only; no Oracle connection/deployment or real effect witness.",
    "Run focused checks while implementing, then freeze for mandatory serial standard/product/browser suites and proportionate exact independent source review. Preserve historical failures and existing IDs/acceptance contracts/worktrees/drafts. Complete scoped publication scans/license review and one substantial draft from the verified T33 checkpoint; observe available exact-head CI without weakening missing security/protection/Oracle gates. No full catalog or production distribution/restore certification."
  ],
  "test_references": [
    "SF-PRODUCT-T34-OPERATOR",
    "SF-PRODUCT-T34-PERSISTENCE",
    "SF-PRODUCT-T34-WEB",
    "SF-PRODUCT-T34-RESTORE_GATE"
  ]
};
const PRODUCT_TASK_35 = {
  "id": "SF-PRODUCT-T35",
  "package": "PRODUCT",
  "assigned_agent": "orchestrator",
  "title": "Deliver HTTPS browser sign-in and revocable session lifecycle",
  "dependencies": [
    "SF-PRODUCT-T34"
  ],
  "feature_ids": [
    "SEC-018",
    "SEC-019"
  ],
  "acceptance_criteria": [
    "Trusted OS startup accepts paired private certificate/key files before database startup and serves native TLS 1.2 or newer on loopback, with no forwarding-header trust or HTTP downgrade. Invalid private paths, permission modes, keys and certificates fail with fixed diagnostics. Existing explicit bearer CLI and local HTTP compatibility remain; browser cookie endpoints require actual encrypted sockets and exact HTTPS Origin.",
    "Browser sign-in exchanges a currently usable fixed-role LOCAL credential for a random hashed BROWSER child credential capped at its parent expiry and eight-hour absolute expiry. The __Host cookie is Secure, HttpOnly, SameSite=Strict and root-only. No bearer credential remains in browser storage or application state after exchange. Explicit cookie session requests carry a separate CSRF proof; missing or incorrect proof and cross-origin writes are denied. Replacement sign-in revokes the previous cookie session, preserving roles and explicit grants.",
    "Persist a thirty-minute sliding idle deadline without extending the absolute deadline. Background polling alone does not renew idle time. Session reads recheck the exact live child and parent credentials, fixed organization and role. Logout immediately revokes the session on the server; operator credential rotation/revocation and metadata restore invalidate derived browser access. Mutation checkpoints serialize with logout and operator revocation, so already-revoked sessions cannot approve or queue work.",
    "Deliver reload/resume, sign-out and expired-session user flows using cookie transport on HTTPS, preserving existing project/actor/session guards, review/source/plan/job history and fixed membership/deploy controls. A tab holding an obsolete CSRF proof cannot silently read another replacement session identity. Failed logout reports failure without claiming revocation. Historical restored data remains readable only after fresh operator credentials; RESTORE_HOLD never becomes execution authority.",
    "Exercise actual PostgreSQL and native HTTPS with explicit fixture CA trust and negative untrusted-chain/hostname/plaintext cases; Chromium uses only one ephemeral fixture public-key pin, paired with no-pin and unrelated-key rejection, never blanket certificate bypass or global trust changes. Verify real cookie flags, login/reload/CSRF/logout/expiry/revocation and the backup schema migration with restored sessions denied. Meaningful barrier tests cover logout/revocation before a queued write checkpoint. No external deployment, worker transport or Oracle runtime certification is inferred.",
    "Freeze final source for serial required standard/product/browser regressions and exact independent review, review final diff and scoped publication scans/license closure, then one substantial draft and actual available CI. Preserve original IDs, source/evidence/worktrees/drafts and security gate boundaries. Update operating instructions, catalog coverage and concise checkpoint honestly; SEC018 remains partial pending authorized network/worker transport acceptance."
  ],
  "test_references": [
    "SF-PRODUCT-T35-HTTPS",
    "SF-PRODUCT-T35-SESSION",
    "SF-PRODUCT-T35-WEB",
    "SF-PRODUCT-T35-RESTORE"
  ]
};
const PRODUCT_TASK_36 = {
  "id": "SF-PRODUCT-T36",
  "package": "PRODUCT",
  "assigned_agent": "orchestrator",
  "title": "Deliver metadata-only expired-attempt recovery for the local operator",
  "dependencies": [
    "SF-PRODUCT-T35"
  ],
  "feature_ids": [
    "OPS-002",
    "OPS-005",
    "MIG-011"
  ],
  "acceptance_criteria": [
    "Install expiry recovery using fixed metadata URL, worker identity and scope without Oracle capabilities; preserve the prior installed binding, reject mixed or caller-selected execution bindings, and retain one-operation ownership with awaited cleanup.",
    "Provide a local OS operator command for bounded read-only discovery and selected expired-attempt recovery. Require existing private configuration and loopback metadata authorization before connecting, reject malformed input with fixed secret-free output, and expose no HTTP recovery or Oracle capability.",
    "Recovery uses the existing durable store to append LEASE_EXPIRED_UNKNOWN HOLD exactly once, preserving attempts, leases, receipts, approval and earlier events. Live leases, terminal jobs, UNIT scope in the trusted operator and inactive metadata generations cannot advance. Recovery never renews, retries, dispatches SQL or releases HOLD.",
    "Verify actual isolated PostgreSQL and supervised child recovery, bounded keyset discovery, CLI use and private-route failures, history preservation and required Foundation/parser/PRODUCT GitHub Actions. Record synthetic metadata scope honestly; Oracle runtime and deployed worker isolation remain unverified."
  ],
  "test_references": [
    "SF-PRODUCT-T36-FACTORY",
    "SF-PRODUCT-T36-OPERATOR",
    "SF-PRODUCT-T36-RECOVERY"
  ]
};
const PRODUCT_TASK_37 = {
  "id": "SF-PRODUCT-T37",
  "package": "PRODUCT",
  "assigned_agent": "orchestrator",
  "title": "Connect the durable queue to a generation-bound installed execution service",
  "dependencies": [
    "SF-PRODUCT-T36"
  ],
  "feature_ids": [
    "OPS-002",
    "OPS-003",
    "OPS-019",
    "MIG-011"
  ],
  "acceptance_criteria": [
    "Install a fixed execution service with one PostgreSQL session leader and one active supervised child per metadata database. Snapshot reviewed factory/environment/limits before metadata startup; reject mixed UNIT/trusted capabilities and request-selected routes. Keep API credentials and target writer capability separate.",
    "Discover bounded FIFO waiting requests with exact keyset timestamps, pass ineligible requests without starving later work, and recover expired CLAIMED attempts before dispatch. Preserve original history and wait on unresolved admitted jobs. Never renew, reclaim, replay or release HOLD.",
    "Pin service children and every durable attempt write to the exact active metadata generation. Connection, leader-session or generation loss stops dispatch without reconnect. Transport, cleanup or projection uncertainty retires the service without overwriting committed terminal facts.",
    "Provide a private OS-installed CLI with fixed diagnostics and SIGTERM/SIGINT drain. Stop scheduling new work, await active operations and confirmed child exit before releasing metadata leadership. Unknown termination retains ownership and prevents replacement while the process lives; no OS sandbox or deployed orphan containment is inferred.",
    "Verify actual isolated PostgreSQL, real supervised children and Git/parser/approval/request/history integration with UNIT target ports: V1 then pending-only V2 and NOOP; expiry/live leases, bounded fairness, generation races, private CLI and unconfirmed child drain. Preserve backup compatibility and existing required Foundation/parser/PRODUCT/CodeQL GitHub Actions; no Oracle runtime certification."
  ],
  "test_references": [
    "SF-PRODUCT-T37-QUEUE",
    "SF-PRODUCT-T37-GENERATION",
    "SF-PRODUCT-T37-DRAIN"
  ]
};
const PRODUCT_TASK_38 = {
  "id": "SF-PRODUCT-T38",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Show current deployment status without resetting review context",
  "dependencies": [
    "SF-PRODUCT-T37"
  ],
  "feature_ids": [
    "OPS-005",
    "OPS-003"
  ],
  "acceptance_criteria": [
    "Use existing scoped execution-job list and detail reads to show current job state, readiness and revision. Refresh shown nonterminal work at a modest non-overlapping interval and provide explicit refresh. View job events merges the matching current job summary and events together. No new endpoint, deployment capability or execution authority.",
    "Preserve review, comment and request drafts and selected project/plan/filter during job-only refresh. Fence delayed reads by current project, plan, token/session epoch and refresh context; never replace newer job revision with older data. Stop background reads when hidden or terminal. Fail closed on missing/revoked access using existing scoped recovery and discard late success/error after navigation or sign-out.",
    "Replace obsolete cannot-execute feedback with truthful queued validation and installed-worker progress. Display retained waiting/admitted/terminal states without inferring SQL effects, replay permission, target credential availability or Oracle certification. Preserve request/cancellation guards, original idempotency and history/receipt scope.",
    "Actual isolated PostgreSQL and Chromium verify installed UNIT worker transitions visible without project navigation, current job events, preserved drafts, and controlled stale read responses across cancellation, project/plan/session changes and loss of access. Preserve complete required Foundation/parser/PRODUCT/CodeQL checks and existing source/license/security gates. No Oracle environment, credentials, deployment or full catalog acceptance is claimed."
  ],
  "test_references": [
    "SF-PRODUCT-T38-STATUS",
    "SF-PRODUCT-T38-FRESHNESS",
    "SF-PRODUCT-T38-INTEGRATION"
  ]
};
const PRODUCT_TASK_39 = {
  "id": "SF-PRODUCT-T39",
  "package": "PRODUCT",
  "assigned_agent": "frontend",
  "title": "Browse older execution requests and retained audit history within the selected plan",
  "dependencies": [
    "SF-PRODUCT-T38"
  ],
  "feature_ids": [
    "OPS-005",
    "MIG-012"
  ],
  "acceptance_criteria": [
    "Use the existing actor/project-scoped execution-job cursor API to reach older requests without knowing a job ID. Preserve server project-global order and cursor, filter displayed rows by the selected plan, allow advancing through pages with no matching plan, and keep only a bounded current page separate from live queue state. No new execution or recovery capability.",
    "Expose retained job events and existing attempt, statement-event and receipt inspection for older requests. Preserve evidence scope, missing-receipt uncertainty and immutable original plan/approval provenance; do not infer target effects, hold release, replay permission or Oracle acceptance.",
    "Preserve selected project/plan and review drafts during history reads and live status updates. Fence pagination and detail results across navigation, session/token, refresh and visibility changes; reject overlapping reads and fail closed on actual revoked-access reads. Never let older history displace or regress the current queue.",
    "Use actual isolated PostgreSQL and Chromium to browse more than50 interleaved requests, traverse a page with no selected-plan matches, open older events/attempts/receipts, and reject delayed responses after plan/session changes. Preserve existing history/status tests and complete required Foundation/parser/PRODUCT/CodeQL, independent review, source security and license gates. No Oracle runtime or deployment certification."
  ],
  "test_references": [
    "SF-PRODUCT-T39-PAGES",
    "SF-PRODUCT-T39-HISTORY",
    "SF-PRODUCT-T39-FRESHNESS"
  ]
};
const PRODUCT_TASK_40 = {
  "id": "SF-PRODUCT-T40",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Separate control-plane liveness from bounded metadata readiness",
  "dependencies": [
    "SF-PRODUCT-T39"
  ],
  "feature_ids": [
    "OPS-011"
  ],
  "acceptance_criteria": [
    "Provide cheap process liveness independently of metadata SQL, Oracle availability and exhausted business API quota. Preserve the existing health endpoint and normal startup requirements; no target or execution capability.",
    "Report current ACTIVE and RESTORE_HOLD metadata read availability separately from target availability. Missing or unknown metadata, failures and a one-second response deadline return fixed unavailable results without resource identities, connection errors, secrets or execution-authority claims.",
    "Share one unfinished metadata query across concurrent readiness checks until actual settlement, including after HTTP timeout, without stale result caching. Bound readiness separately to 120 GET/HEAD requests per client per minute while preserving existing business quotas, authentication and cheap liveness.",
    "Use meaningful timeout/outage/quota unit cases and actual isolated PostgreSQL to verify ACTIVE/HOLD/missing metadata, error redaction, GET/HEAD shared quotas and installed source probe availability. Preserve full required Foundation/parser/PRODUCT/CodeQL, independent review, source security and license gates. No Oracle runtime or deployment certification."
  ],
  "test_references": [
    "SF-PRODUCT-T40-LIVENESS",
    "SF-PRODUCT-T40-METADATA",
    "SF-PRODUCT-T40-BOUNDARY"
  ]
};
const PRODUCT_TASK_41 = {
  "id": "SF-PRODUCT-T41",
  "package": "PRODUCT",
  "assigned_agent": "devops",
  "title": "Package Kelryvo app and restricted worker for verified container delivery",
  "dependencies": [
    "SF-PRODUCT-T40"
  ],
  "feature_ids": [
    "OPS-011"
  ],
  "acceptance_criteria": [
    "Run the existing API and Kelryvo web assets as a non-root container with configurable bind address, external PostgreSQL, mandatory backend TLS, mounted Secrets, probes and graceful shutdown. Preserve session, authorization, migration, audit, HOLD and no-replay controls.",
    "Build separate app and worker OCI images without bundled PostgreSQL or credentials. Keep worker startup fail-closed without private trusted installation and Oracle runtime authority. Preserve pinned dependencies, product license, runtime notices and corresponding JDK source material.",
    "Verify projected Secret confinement, distinct fixed roles, unsafe input rejection and the actual OCI Git import, offline validation, approval, history, security denials and restart persistence against dedicated disposable PostgreSQL. No Oracle runtime acceptance.",
    "Require exact candidate and master Foundation/parser/full PRODUCT/CodeQL and OCI verification before controlled master-dispatch publication of the tested images. Record immutable source tags and registry digests; actual Kubernetes deployment remains a subsequent verified milestone."
  ],
  "test_references": [
    "SF-PRODUCT-T41-CONFIG",
    "SF-PRODUCT-T41-OCI",
    "SF-PRODUCT-T41-PUBLICATION"
  ]
};
const PRODUCT_TASK_42 = {
  "id": "SF-PRODUCT-T42",
  "package": "PRODUCT",
  "assigned_agent": "backend",
  "title": "Download scoped redacted offline plan governance records",
  "dependencies": [
    "SF-PRODUCT-T41"
  ],
  "feature_ids": [
    "SEC-013"
  ],
  "acceptance_criteria": [
    "Download a bounded versioned record for an explicitly authorized project member, containing saved public intent, migration/statement identities and the current decision and approval withdrawal from one metadata snapshot. Preserve archived reads; deny unknown, foreign, revoked and bootstrap scopes.",
    "Verify retained intent and plan-item binding before export; reject malformed or oversized metadata. Never expose the private envelope, credential references, SQL content or execution capability. Clearly distinguish a redacted governance snapshot from full joined execution evidence or authentic signed proof.",
    "Offer a plan-review download with a SHA-256 checksum of its exact serialized record. Fence delayed downloads across plan/project/session navigation and logout; keep governance and target state unchanged. Document offline verification with standard Node crypto and the need for a separately trusted digest.",
    "Verify authorized roles, denial and tamper/bounds cases against isolated PostgreSQL and actual Chromium download/navigation/logout behavior. Register both tests in required PRODUCT lists and preserve required CI, independent security/QA review and licensing gates."
  ],
  "test_references": [
    "SF-PRODUCT-T42-SCOPE",
    "SF-PRODUCT-T42-INTEGRITY",
    "SF-PRODUCT-T42-BROWSER"
  ]
};
const PRODUCT_TASKS = [PRODUCT_TASK, PRODUCT_TASK_02, PRODUCT_TASK_03, PRODUCT_TASK_04, PRODUCT_TASK_05, PRODUCT_TASK_06, PRODUCT_TASK_07, PRODUCT_TASK_08, PRODUCT_TASK_09, PRODUCT_TASK_10, PRODUCT_TASK_11, PRODUCT_TASK_12, PRODUCT_TASK_13, PRODUCT_TASK_14, PRODUCT_TASK_15, PRODUCT_TASK_16, PRODUCT_TASK_17, PRODUCT_TASK_18, PRODUCT_TASK_19, PRODUCT_TASK_20, PRODUCT_TASK_21, PRODUCT_TASK_22, PRODUCT_TASK_23, PRODUCT_TASK_24, PRODUCT_TASK_25, PRODUCT_TASK_26, PRODUCT_TASK_27, PRODUCT_TASK_28, PRODUCT_TASK_29, PRODUCT_TASK_30, PRODUCT_TASK_31, PRODUCT_TASK_32, PRODUCT_TASK_33, PRODUCT_TASK_34, PRODUCT_TASK_35, PRODUCT_TASK_36, PRODUCT_TASK_37, PRODUCT_TASK_38, PRODUCT_TASK_39, PRODUCT_TASK_40, PRODUCT_TASK_41, PRODUCT_TASK_42];
const PRODUCT_SCHEDULE = Object.fromEntries(PRODUCT_TASKS.map((task) => [task.id, task.dependencies]));
const OWNER_ROLES = {
  database: 'Oracle data model, database behavior, migration execution, and database contracts',
  backend: 'Application services, governance workflows, APIs, and durable state contracts',
  frontend: 'User-facing workflows, accessible views, and client integration',
  security: 'Identity, authorization, secret handling, threat boundaries, and security evidence',
  qa: 'Acceptance traceability, test design, evidence quality, and release gates',
  devops: 'Build, Git/provider integration, operations, packaging, and deployment contracts',
  orchestrator: 'Cross-domain integration, shared contracts, and milestone coordination',
};
const OWNER_PATH_POLICY = {
  database: ['apps/worker/**', 'packages/**', 'experiments/**'],
  backend: ['apps/api/**', 'packages/**'], frontend: ['apps/web/**', 'packages/**'],
  security: ['apps/api/**', 'apps/worker/**', 'packages/**'], qa: ['tests/**', 'experiments/**', 'docs/implementation/**'],
  devops: ['scripts/**', 'experiments/**', '.github/**'], orchestrator: ['docs/implementation/**'],
};
const workByFeature = new Map();
for (const t of plan.tasks) for (const featureId of t.feature_ids) workByFeature.set(featureId, [...(workByFeature.get(featureId) ?? []), t]);

export function buildTrackingData() {
  const refinements = new Map(plan.features.map((f) => [f.id, f]));
  const casesByTask = new Map();
  for (const test of plan.wp0_tests) for (const task of test.task_ids) {
    casesByTask.set(task, [...(casesByTask.get(task) ?? []), test.id]);
  }
  const features = catalog.features.map((f) => {
    const refined = refinements.get(f.id);
    const referencingTasks = workByFeature.get(f.id) ?? [];
    const taskIds = referencingTasks.map((t) => t.id);
    return {
      id: f.id,
      name: f.name,
      description: f.description,
      domain: f.domain,
      phase: refined?.tier ?? f.recommended_release,
      original_phase: f.recommended_release,
      priority: f.priority,
      dependencies: [...f.dependencies],
      status: f.recommended_release === 'REJECTED' ? 'DEFERRED' : 'BACKLOG',
      assigned_agent: DOMAIN_OWNER[f.domain] ?? 'orchestrator',
      related_work_packages: [...new Set(referencingTasks.map((t) => t.package))],
      related_work_items: [...taskIds],
      source_paths: [catalogPath, ...(refined ? [planPath] : [])],
      test_references: [...new Set([...taskIds.flatMap((id) => casesByTask.get(id) ?? []), ...referencingTasks.flatMap((t) => t.test_cases), ...(refined?.feature_acceptance_id ? [refined.feature_acceptance_id] : [])])],
      acceptance_reference: refined?.feature_acceptance_id ?? null,
      evidence: [],
      blockers: f.recommended_release === 'REJECTED' ? [`Deferred per source catalog: ${f.expected_behavior}`] : [],
      acceptance_criteria: [...f.acceptance_criteria],
      refined_acceptance_criteria: refined ? [...refined.original_acceptance] : null,
      refined_tier: refined?.tier ?? null,
      refined_reason: refined?.reason ?? null,
    };
  });
  const wp0Agents = { 'WP0-T01': 'devops', 'WP0-T02': 'security', 'WP0-T03': 'database', 'WP0-T04': 'database', 'WP0-T05': 'database', 'WP0-T06': 'database', 'WP0-T07': 'backend', 'WP0-T08': 'database', 'WP0-T09': 'database', 'WP0-T10': 'database', 'WP0-T11': 'security', 'WP0-T12': 'orchestrator' };
  const tasks = plan.tasks.map((t) => ({
    id: t.id, package: t.package, title: t.title, dependencies: [...t.dependencies],
    feature_ids: [...t.feature_ids], acceptance_criteria: [...t.acceptance_criteria],
    test_references: [...t.test_cases], source_paths: [planPath], status: t.id === 'WP0-T01' ? 'READY' : 'BACKLOG',
    assigned_agent: wp0Agents[t.id] ?? PACKAGE_OWNER[t.package] ?? 'orchestrator',
    ...(t.id === 'WP0-T12' ? { review_agent: 'qa' } : {}), evidence: [], blockers: [],
  }));
  const foundation = {
    id: 'SF-P0-FOUNDATION', package: 'WP0', title: 'Establish independently checkable product tracking foundation',
    dependencies: [], feature_ids: [], acceptance_criteria: [
      'All 220 stable catalog feature IDs are tracked with source acceptance criteria and original dependencies.',
      'All 63 WP0 cases have separate unit, Oracle 19c, and Oracle 21c result cells initialized without PASS.',
      'Tracker validation rejects unknown or cyclic dependencies, premature verification, and research presented as product evidence.',
      'Tracker status, next, and graph commands work offline and preserve scope boundaries.',
    ], test_references: [], source_paths: [catalogPath, planPath],
    status: 'IN_PROGRESS', assigned_agent: 'orchestrator', evidence: [], blockers: [],
  };
  tasks.unshift(foundation);
  tasks.push(...PRODUCT_TASKS.map((task) => ({ ...task, status: task.id === PRODUCT_TASK.id ? 'READY' : 'BACKLOG', source_paths: ['docs/implementation/backlog.json'], evidence: [], blockers: [] })));
  const acceptance = Object.fromEntries(features.map((f) => [f.id, { feature_id: f.id, criteria: f.acceptance_criteria }]));
  const workAcceptance = Object.fromEntries(tasks.map((t) => [t.id, { task_id: t.id, criteria: t.acceptance_criteria, test_references: t.test_references }]));
  const tests = plan.wp0_tests.map((t) => ({
    id: t.id, area: t.area, objective: t.objective, mode: t.mode,
    results: Object.fromEntries(['unit', 'oracle_19c', 'oracle_21c'].map((cell) => {
      const original = t.results[cell];
      return [cell, original === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : (cell !== 'unit' ? 'BLOCKED' : 'NOT_RUN')];
    })),
    blockers: (t.results.oracle_19c === 'NOT_APPLICABLE' && t.results.oracle_21c === 'NOT_APPLICABLE') ? [] : ['Oracle lab authorization and attested disposable-target profile are missing.'],
    evidence: [], source_paths: [planPath], task_ids: [...t.task_ids],
    acceptance: { expected_result: t.expected_result, evidence_required: [...t.evidence_required], pass_criteria: t.pass_criteria },
  }));
  const dependencies = Object.fromEntries(features.map((f) => [f.id, [...f.dependencies]]));
  for (const t of tasks) dependencies[t.id] = [...t.dependencies];
  for (const task of PRODUCT_TASKS) dependencies[task.id] = [...task.dependencies];
  return { features, tasks, acceptance: { features: acceptance, work: workAcceptance }, tests, dependencies };
}

export function buildInitialState() {
  const d = buildTrackingData();
  const items = [...d.features, ...d.tasks];
  return {
    features: { features: d.features }, tasks: { tasks: d.tasks }, acceptance: { ...d.acceptance, test_cases: d.tests },
    graph: { nodes: items.map((x) => x.id), edges: d.dependencies, scheduling: { PRODUCT: PRODUCT_SCHEDULE, VALIDATION: {} } },
    ownership: {
      agents: Object.fromEntries(Object.entries(OWNER_ROLES).map(([id, responsibilities]) => [id, { responsibilities, path_policy: OWNER_PATH_POLICY[id] }])),
      items: Object.fromEntries(items.map((x) => [x.id, { assigned_agent: x.assigned_agent, ...(x.review_agent ? { review_agent: x.review_agent } : {}), status: x.status }])),
    },
    evidence: { entries: [] }, milestone: { active_track: 'PRODUCT', tracks: { PRODUCT: { allowed_packages: ['PRODUCT'] }, VALIDATION: { allowed_packages: ['WP0'] } }, oracle_lab_authorized: false }, tests: { cases: d.tests },
  };
}

function paths() {
  return {
    features: 'features.json', tasks: 'backlog.json', acceptance: 'acceptance.json',
    graph: 'dependency-graph.json', ownership: 'ownership.json', evidence: 'evidence-index.json', milestone: 'milestone.json',
  };
}
function loadState() {
  const p = paths();
  const state = Object.fromEntries(Object.entries(p).map(([key, file]) => [key, read(`docs/implementation/${file}`)]));
  state.tests = { cases: state.acceptance.test_cases };
  return state;
}
const VALID = new Set(['BACKLOG', 'READY', 'IN_PROGRESS', 'IMPLEMENTED', 'VERIFIED', 'BLOCKED', 'DEFERRED']);
const PRODUCT_EVIDENCE = new Set(['UNIT', 'STATIC', 'INTEGRATION', 'ORACLE_19C', 'ORACLE_21C']);
const OUTCOMES = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']);
const CELL_RESULTS = new Set(['NOT_RUN', 'NOT_APPLICABLE', 'BLOCKED', 'PASS', 'FAIL']);
const WP0_PARTIAL_TASKS = new Set(['WP0-T01', 'WP0-T02', 'WP0-T03']);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const compareStrings = (left, right) => String(left).localeCompare(String(right), 'en');
function expectedPhase(feature) { return new Map(plan.features.map((f) => [f.id, f.tier])).get(feature.id) ?? feature.recommended_release; }
function evidenceRefsFor(item, label, errors) {
  if (item.evidence == null) return [];
  if (!Array.isArray(item.evidence)) { errors.push(`${label} evidence references must be an array`); return []; }
  for (const ref of item.evidence) if (!ref || typeof ref !== 'object' || typeof ref.index_id !== 'string') errors.push(`${label} evidence reference is malformed`);
  return item.evidence.filter((ref) => ref && typeof ref.index_id === 'string');
}

function validateEvidence(s, importedCases, errors) {
  const indexEntries = Array.isArray(s.evidence?.entries) ? s.evidence.entries : [];
  if (!Array.isArray(s.evidence?.entries)) errors.push('evidence index entries must be an array');
  const evidenceIds = new Set();
  const validEvidence = new Map();
  const subjectRefs = new Map([...s.features.features, ...s.tasks.tasks].map((item) => [item.id, item]));
  for (const c of s.tests.cases) subjectRefs.set(c.id, c);
  for (const rawEntry of indexEntries) {
    const entry = rawEntry && typeof rawEntry === 'object' && !Array.isArray(rawEntry) ? rawEntry : {};
    if (typeof entry.id !== 'string' || !entry.id || evidenceIds.has(entry.id)) { errors.push(`evidence index contains missing or duplicate ID ${entry.id ?? ''}`); continue; }
    evidenceIds.add(entry.id);
    const { valid: metadataValid, pathsReady } = validateEvidenceMetadata(s, entry, subjectRefs, importedCases, errors);
    if (!pathsReady) continue;
    if (validateEvidenceRecord(entry, errors) && metadataValid) validEvidence.set(entry.id, entry);
  }
  return validEvidence;
}

function validateEvidenceMetadata(s, entry, subjectRefs, importedCases, errors) {
  let valid = true;
  const reject = (message) => { errors.push(message); valid = false; };
  const pathsReady = validateEvidenceShape(entry, reject);
  if (!pathsReady) return { valid, pathsReady };
  validateEvidenceSubject(s, entry, subjectRefs, importedCases, reject);
  return { valid, pathsReady };
}

function validateEvidenceShape(entry, reject) {
  validateEvidenceClassification(entry, reject);
  validateEvidenceCommand(entry, reject);
  return validateEvidencePaths(entry, reject);
}

function validateEvidenceClassification(entry, reject) {
  const valid = PRODUCT_EVIDENCE.has(entry.kind) && OUTCOMES.has(entry.outcome) && Array.isArray(entry.criterion_indexes) &&
    Array.isArray(entry.test_references) && Array.isArray(entry.case_coverage) && entry.subject_id && ['HARNESS', 'PRODUCT'].includes(entry.scope);
  if (!valid) reject(`evidence ${entry.id} has invalid kind, outcome, subject, scope, or coverage`);
  if (entry.kind === 'INTEGRATION' && entry.scope !== 'PRODUCT') reject(`evidence ${entry.id} local integration must use PRODUCT scope`);
}

function validateEvidenceCommand(entry, reject) {
  if (typeof entry.command !== 'string' || !entry.command.trim() ||
    !(entry.outcome === 'NOT_RUN' ? entry.exit_code === null : Number.isInteger(entry.exit_code) && entry.exit_code >= 0) ||
    (entry.outcome === 'PASS' && entry.exit_code !== 0) || (['FAIL', 'BLOCKED'].includes(entry.outcome) && entry.exit_code === 0)) reject(`evidence ${entry.id} has invalid command or exit status`);
}

function validateEvidencePaths(entry, reject) {
  if (!entry.path || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !entry.raw_output || typeof entry.raw_output !== 'object' ||
      !entry.raw_output.path || !/^[a-f0-9]{64}$/.test(entry.raw_output.sha256 ?? '')) {
    reject(`evidence ${entry.id} must name hashed record and raw output files`);
    return false;
  }
  return true;
}

function validateEvidenceSubject(s, entry, subjectRefs, importedCases, reject) {
  const subject = subjectRefs.get(entry.subject_id);
  if (!subject) { reject(`evidence ${entry.id} names unknown subject ${entry.subject_id}`); return; }
  const criteria = subject.acceptance_criteria ?? [];
  if (Array.isArray(entry.criterion_indexes) && entry.criterion_indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= criteria.length)) reject(`evidence ${entry.id} has out-of-range acceptance criterion indexes`);
  const allowedRefs = subject.test_references ?? [subject.id];
  if (Array.isArray(entry.test_references) && entry.test_references.some((ref) => !allowedRefs.includes(ref))) reject(`evidence ${entry.id} names unknown test references for ${entry.subject_id}`);
  const subjectTask = s.tasks.tasks.find((task) => task.id === entry.subject_id);
  for (const coverage of Array.isArray(entry.case_coverage) ? entry.case_coverage : []) {
    validateEvidenceCoverage(s, entry, coverage, subjectTask, importedCases, reject);
  }
  validateEvidenceScope(s, entry, reject);
}

function validateEvidenceCoverage(s, entry, coverage, subjectTask, importedCases, reject) {
  if (!validEvidenceCoverageShape(s, coverage, subjectTask, reject, entry)) return;
  if (coverage.scope === 'TASK_INCREMENT' && !WP0_PARTIAL_TASKS.has(subjectTask.id)) reject(`evidence ${entry.id} uses partial case coverage for gate task ${subjectTask.id}`);
  const caseId = coverage?.case_id;
  const srcCase = importedCases.get(caseId);
  if (!srcCase) { reject(`evidence ${entry.id} names unknown source case ${caseId}`); return; }
  validateEvidenceCoveredCells(entry, coverage, srcCase, reject);
}

function validEvidenceCoverageShape(s, coverage, subjectTask, reject, entry) {
  const caseId = coverage?.case_id;
  const hasTestCase = s.tests.cases.some((c) => c.id === caseId);
  const full = coverage?.scope === 'FULL_CASE' && coverage.full_case_pass === true;
  const partial = coverage?.scope === 'TASK_INCREMENT' && coverage.full_case_pass === false;
  const taskOwnsCase = subjectTask?.package === 'WP0' && subjectTask.test_references.includes(caseId);
  const hasDescription = typeof coverage?.description === 'string' && coverage.description.trim();
  if (!taskOwnsCase || !hasTestCase || !Array.isArray(coverage?.cells) || !coverage.cells.length || !hasDescription || (!full && !partial)) {
    reject(`evidence ${entry.id} has invalid WP0 case coverage`);
    return false;
  }
  return true;
}

function validateEvidenceCoveredCells(entry, coverage, srcCase, reject) {
  const applicable = ['unit', 'oracle_19c', 'oracle_21c'].filter((cell) => srcCase.results[cell] !== 'NOT_APPLICABLE');
  if (coverage.cells.some((cell) => !applicable.includes(cell))) reject(`evidence ${entry.id} case coverage names an inapplicable cell`);
  if (new Set(coverage.cells).size !== coverage.cells.length) reject(`evidence ${entry.id} case coverage repeats a cell`);
  if (coverage.scope === 'FULL_CASE' && !equal([...coverage.cells].sort(compareStrings), [...applicable].sort(compareStrings))) reject(`evidence ${entry.id} full-case coverage omits applicable cells`);
  if (coverage.scope === 'TASK_INCREMENT' && coverage.cells.some((cell) => cell !== 'unit' || entry.kind !== (srcCase.mode === 'STATIC' ? 'STATIC' : 'UNIT'))) reject(`evidence ${entry.id} task-increment evidence kind does not match its unit subrun`);
}

function validateEvidenceScope(s, entry, reject) {
  if (s.features.features.some((f) => f.id === entry.subject_id) && entry.scope !== 'PRODUCT') reject(`feature evidence ${entry.id} must have PRODUCT scope`);
  if (s.tests.cases.some((c) => c.id === entry.subject_id) && (entry.scope !== 'HARNESS' || !Array.isArray(entry.test_references) || !entry.test_references.includes(entry.subject_id))) reject(`case evidence ${entry.id} must have HARNESS scope and name its case`);
}

function validateEvidenceRecord(entry, errors) {
  const reject = (message) => errors.push(message);
  const evidenceRoot = path.join(root, 'evidence');
  let recordAbs; let logAbs;
  try {
    const realEvidenceRoot = fs.realpathSync(evidenceRoot);
    if (realEvidenceRoot !== evidenceRoot) throw new Error('evidence root is a symlink');
    recordAbs = fs.realpathSync(path.resolve(root, entry.path));
    logAbs = fs.realpathSync(path.resolve(root, entry.raw_output.path));
    if (!recordAbs.startsWith(`${realEvidenceRoot}${path.sep}`) || !logAbs.startsWith(`${realEvidenceRoot}${path.sep}`)) throw new Error('outside evidence root');
    if (!fs.statSync(recordAbs).isFile() || !fs.statSync(logAbs).isFile()) throw new Error('not a file');
  } catch {
    reject(`evidence ${entry.id} record or raw log is missing or outside evidence root`);
    return false;
  }
  return validateEvidenceFileContents(entry, recordAbs, logAbs, reject);
}

function validateEvidenceFileContents(entry, recordAbs, logAbs, reject) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(recordAbs)).digest('hex');
  const logHash = crypto.createHash('sha256').update(fs.readFileSync(logAbs)).digest('hex');
  if (actual !== entry.sha256) reject(`evidence ${entry.id} file hash does not match`);
  if (logHash !== entry.raw_output.sha256) reject(`evidence ${entry.id} raw output hash does not match`);
  let record;
  try { record = JSON.parse(fs.readFileSync(recordAbs, 'utf8')); } catch { reject(`evidence ${entry.id} record is not valid JSON`); return false; }
  if (!record || typeof record !== 'object' || Array.isArray(record)) { reject(`evidence ${entry.id} record must be a JSON object`); return false; }
  const matchesMetadata = recordMatchesEvidenceIndex(record, entry);
  if (!matchesMetadata) reject(`evidence ${entry.id} record does not match its index metadata`);
  return matchesMetadata && actual === entry.sha256 && logHash === entry.raw_output.sha256;
}

function recordMatchesEvidenceIndex(record, entry) {
  const fields = ['id', 'subject_id', 'kind', 'scope', 'outcome', 'command', 'exit_code', 'criterion_indexes', 'test_references', 'case_coverage', 'raw_output'];
  return fields.every((field) => equal(record[field], entry[field]));
}

function validateGraphAndScheduling(s, all, errors) {
  validateAcceptanceCycles(all, errors);
  const tracks = s.milestone.tracks ?? {};
  if (!tracks.PRODUCT || !tracks.VALIDATION || Object.keys(tracks).some(id => !['PRODUCT', 'VALIDATION'].includes(id))) errors.push('milestone must define only PRODUCT and VALIDATION tracks');
  if (!equal(tracks.PRODUCT?.allowed_packages, ['PRODUCT']) || !equal(tracks.VALIDATION?.allowed_packages, ['WP0'])) errors.push('track package scopes differ from PRODUCT/VALIDATION policy');
  const schedule = s.graph.scheduling ?? {};
  if (Object.keys(schedule).some(id => !['PRODUCT', 'VALIDATION'].includes(id))) errors.push('scheduling graph has an unknown track');
  const expectedProductSchedule = Object.fromEntries(PRODUCT_TASKS.map(task => [task.id, task.dependencies]));
  if (!equal(schedule.PRODUCT, expectedProductSchedule)) errors.push('PRODUCT scheduling dependencies differ from bounded product task contracts');
  if (Object.keys(schedule.VALIDATION ?? {}).length) errors.push('VALIDATION cannot override original acceptance dependencies');
  validateSchedulingEntries(schedule, all, errors);
  validateSchedulingCycles(schedule, all, errors);
  if (!tracks[s.milestone.active_track]) errors.push('milestone active track is unknown');
}

function validateAcceptanceCycles(all, errors) {
  const visiting = new Set(); const done = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`dependency cycle includes ${id}`); return; }
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of all.get(id)?.dependencies ?? []) {
      if (!all.has(dep)) errors.push(`${id} has unknown dependency ${dep}`);
      else visit(dep);
    }
    visiting.delete(id); done.add(id);
  }
  for (const id of all.keys()) visit(id);
}

function validateSchedulingEntries(schedule, all, errors) {
  for (const [trackId, edges] of Object.entries(schedule)) {
    validateSchedulingTrackEntries(trackId, edges, all, errors);
  }
}

function validateSchedulingTrackEntries(trackId, edges, all, errors) {
  if (!edges || typeof edges !== 'object' || Array.isArray(edges)) {
    errors.push(`scheduling graph ${trackId} must be an edge map`);
    return;
  }
  for (const [id, deps] of Object.entries(edges)) validateSchedulingEdge(trackId, id, deps, all, errors);
}

function validateSchedulingEdge(trackId, id, deps, all, errors) {
  if (!all.has(id)) errors.push(`scheduling graph ${trackId} has unknown item ${id}`);
  if (!Array.isArray(deps)) {
    errors.push(`scheduling graph ${trackId} dependencies for ${id} must be an array`);
    return;
  }
  if (trackId !== 'PRODUCT' || !PRODUCT_TASKS.some((task) => task.id === id)) errors.push(`scheduling graph cannot override acceptance dependencies for ${id}`);
  for (const dep of deps) if (!all.has(dep)) errors.push(`scheduling graph ${trackId} has unknown dependency ${dep}`);
}

function validateSchedulingCycles(schedule, all, errors) {
  for (const trackId of ['PRODUCT', 'VALIDATION']) validateScheduleTrack(trackId, schedule, all, errors);
}

function validateScheduleTrack(trackId, schedule, all, errors) {
  const edges = schedule[trackId] ?? {};
  const visiting = new Set(); const done = new Set();
  function visit(id) {
    if (visiting.has(id)) { errors.push(`scheduling dependency cycle in ${trackId} includes ${id}`); return; }
    if (done.has(id) || !all.has(id)) return;
    visiting.add(id);
    for (const dep of (edges[id] ?? all.get(id)?.dependencies ?? [])) visit(dep);
    visiting.delete(id); done.add(id);
  }
  for (const id of all.keys()) visit(id);
}

function validateItemEvidenceAndStatus(s, all, features, tasks, validEvidence, errors) {
  for (const item of all.values()) validateItemStatus(s, item, all, features, tasks, validEvidence, errors);
}

function validateItemStatus(s, item, all, features, tasks, validEvidence, errors) {
  if (!VALID.has(item.status)) errors.push(`${item.id} has invalid status ${item.status}`);
  if (!OWNER_ROLES[item.assigned_agent]) errors.push(`${item.id} has unknown assigned agent ${item.assigned_agent}`);
  validateBlockedStatus(item, errors);
  if (item.status === 'VERIFIED') validateVerifiedItem(s, item, all, features, tasks, validEvidence, errors);
  validateItemEvidenceReferences(item, validEvidence, errors);
}

function validateBlockedStatus(item, errors) {
  if (!['BLOCKED', 'DEFERRED'].includes(item.status)) return;
  const hasReason = Array.isArray(item.blockers) && item.blockers.some((reason) => typeof reason === 'string' && reason.trim());
  if (!hasReason) errors.push(`${item.id} ${item.status} status requires a specific blocker or deferral reason`);
}

function validateItemEvidenceReferences(item, validEvidence, errors) {
  for (const ref of evidenceRefsFor(item, item.id, errors)) {
    if (!validEvidence.has(ref.index_id)) errors.push(`${item.id} references missing or invalid evidence index ${ref.index_id}`);
  }
}

function validateVerifiedItem(s, item, all, features, tasks, validEvidence, errors) {
  const accept = s.acceptance.features[item.id]?.criteria ?? s.acceptance.work[item.id]?.criteria ?? [];
  if (!accept.length) errors.push(`${item.id} cannot be VERIFIED without acceptance criteria`);
  const itemRefs = evidenceRefsFor(item, item.id, errors);
  const evidence = itemRefs.map((ref) => validEvidence.get(ref.index_id)).filter((entry) => entry?.outcome === 'PASS');
  if (!evidence.length || evidence.length !== itemRefs.length) errors.push(`${item.id} cannot be VERIFIED without passing indexed product evidence`);
  for (const e of itemRefs) if (!validEvidence.has(e.index_id)) errors.push(`${item.id} references missing or invalid evidence index ${e.index_id}`);
  for (const e of evidence) if (e.subject_id !== item.id) errors.push(`${item.id} evidence ${e.id} is recorded for a different subject`);
  validateVerificationCoverage(item, accept, evidence, errors);
  validateVerificationDependencies(s, item, all, features, tasks, evidence, errors);
}

function validateVerificationCoverage(item, accept, evidence, errors) {
  const covered = new Set(evidence.flatMap((e) => e.criterion_indexes));
  for (let i = 0; i < accept.length; i++) if (!covered.has(i)) errors.push(`${item.id} verification evidence does not cover acceptance criterion ${i}`);
  const refs = item.test_references ?? [];
  const coveredRefs = new Set(evidence.flatMap((e) => [...e.test_references, ...e.case_coverage.map((coverage) => coverage.case_id)]));
  for (const ref of refs) if (!coveredRefs.has(ref)) errors.push(`${item.id} verification evidence does not cover test reference ${ref}`);
}

function validateVerificationDependencies(s, item, all, features, tasks, evidence, errors) {
  if (item.package === 'WP0') validateWp0Verification(s, item, evidence, errors);
  if (features.has(item.id)) validateFeatureVerification(item, tasks, evidence, errors);
  for (const dep of item.dependencies ?? []) if (all.has(dep) && all.get(dep).status !== 'VERIFIED') errors.push(`${item.id} cannot be VERIFIED before dependency ${dep}`);
}

function validateWp0Verification(s, item, evidence, errors) {
  for (const ref of item.test_references ?? []) validateWp0Reference(s, item, ref, evidence, errors);
}

function validateWp0Reference(s, item, ref, evidence, errors) {
  const testCase = s.tests.cases.find((c) => c.id === ref);
  if (!testCase) return;
  const coverage = evidence.flatMap((entry) => entry.case_coverage).find((entry) => entry.case_id === ref);
  if (!coverage) { errors.push(`${item.id} verification lacks explicit case coverage for ${ref}`); return; }
  if (WP0_PARTIAL_TASKS.has(item.id)) return validateWp0PartialCoverage(item, ref, coverage, errors);
  validateWp0FullCoverage(item, ref, testCase, coverage, errors);
}

function validateWp0PartialCoverage(item, ref, coverage, errors) {
  if (coverage.scope !== 'TASK_INCREMENT' || coverage.full_case_pass !== false) errors.push(`${item.id} requires task-increment coverage for shared case ${ref}`);
}

function validateWp0FullCoverage(item, ref, testCase, coverage, errors) {
  if (coverage.scope !== 'FULL_CASE' || coverage.full_case_pass !== true) errors.push(`${item.id} requires full-case coverage for ${ref}`);
  for (const cell of coverage.cells) {
    if (testCase.results[cell] !== 'PASS') errors.push(`${item.id} cannot be VERIFIED before test ${ref} ${cell} PASS`);
  }
}

function validateFeatureVerification(item, tasks, evidence, errors) {
  if (!evidence.some((e) => e.scope === 'PRODUCT')) errors.push(`${item.id} product verification requires product-scope evidence`);
  for (const taskId of item.related_work_items ?? []) if (tasks.get(taskId)?.status !== 'VERIFIED') errors.push(`${item.id} cannot be VERIFIED before supporting task ${taskId}`);
  if (!(item.related_work_items ?? []).length) errors.push(`${item.id} has no verified implementation task gate`);
}

const WP0_OWNERS = { 'WP0-T01': 'devops', 'WP0-T02': 'security', 'WP0-T03': 'database', 'WP0-T04': 'database', 'WP0-T05': 'database', 'WP0-T06': 'database', 'WP0-T07': 'backend', 'WP0-T08': 'database', 'WP0-T09': 'database', 'WP0-T10': 'database', 'WP0-T11': 'security', 'WP0-T12': 'orchestrator' };

function validateOwnershipContracts(s, all, features, tasks, importedFeatures, importedTasks, errors) {
  validateOwnershipCharter(s, errors);
  validateTrackerIndexes(s, all, features, tasks, errors);
  for (const item of all.values()) validateOwnershipItem(s, item, features, importedFeatures, importedTasks, errors);
  validateItemCounts(s, errors);
}

function validateOwnershipCharter(s, errors) {
  if (!equal(Object.keys(s.ownership.agents).sort(compareStrings), Object.keys(OWNER_ROLES).sort(compareStrings))) errors.push('ownership charter set is incomplete');
  for (const [agentId, responsibilities] of Object.entries(OWNER_ROLES)) {
    const role = s.ownership.agents[agentId];
    if (!role || role.responsibilities !== responsibilities || !equal(role.path_policy, OWNER_PATH_POLICY[agentId])) errors.push(`ownership role ${agentId} responsibilities/path policy differ from charter`);
  }
}

function validateTrackerIndexes(s, all, features, tasks, errors) {
  if (!equal([...s.graph.nodes].sort(compareStrings), [...all.keys()].sort(compareStrings))) errors.push('dependency graph node IDs are inconsistent');
  if (!equal(Object.keys(s.ownership.items).sort(compareStrings), [...all.keys()].sort(compareStrings))) errors.push('ownership map IDs are inconsistent');
  if (!equal(Object.keys(s.acceptance.features).sort(compareStrings), [...features.keys()].sort(compareStrings))) errors.push('feature acceptance IDs are inconsistent');
  if (!equal(Object.keys(s.acceptance.work).sort(compareStrings), [...tasks.keys()].sort(compareStrings))) errors.push('work acceptance IDs are inconsistent');
}

function validateOwnershipItem(s, item, features, importedFeatures, importedTasks, errors) {
  const owner = s.ownership.items[item.id];
  if (!owner || owner.status !== item.status || owner.assigned_agent !== item.assigned_agent || owner.review_agent !== item.review_agent) errors.push(`${item.id} ownership/status record is inconsistent`);
  if (item.assigned_agent !== expectedOwner(item, features, importedFeatures, importedTasks)) errors.push(`${item.id} ownership role does not match its domain/package`);
  if (item.review_agent !== (item.id === 'WP0-T12' ? 'qa' : undefined)) errors.push(`${item.id} review ownership is inconsistent`);
  validateItemAcceptanceRecord(s, item, features, errors);
  validateItemGraphRecord(s, item, errors);
}

function expectedOwner(item, features, importedFeatures, importedTasks) {
  if (features.has(item.id)) return DOMAIN_OWNER[importedFeatures.get(item.id)?.domain] ?? 'orchestrator';
  if (item.id === 'SF-P0-FOUNDATION') return 'orchestrator';
  return PRODUCT_TASKS.find((task) => task.id === item.id)?.assigned_agent ??
    WP0_OWNERS[item.id] ?? PACKAGE_OWNER[importedTasks.get(item.id)?.package] ?? 'orchestrator';
}

function validateItemAcceptanceRecord(s, item, features, errors) {
  const record = features.has(item.id) ? s.acceptance.features[item.id] : s.acceptance.work[item.id];
  if (!equal(record?.criteria, item.acceptance_criteria)) errors.push(`${item.id} acceptance record differs from its work item`);
  if (!features.has(item.id) && !equal(record?.test_references, item.test_references)) errors.push(`${item.id} acceptance test references differ from its work item`);
}

function validateItemGraphRecord(s, item, errors) {
  const graphDeps = s.graph.edges[item.id];
  const itemDeps = item.dependencies ?? [];
  if (!graphDeps || JSON.stringify([...graphDeps].sort(compareStrings)) !== JSON.stringify([...itemDeps].sort(compareStrings))) errors.push(`${item.id} dependency graph is inconsistent`);
}

function validateItemCounts(s, errors) {
  if (s.features.features.length !== 220) errors.push(`expected 220 features, found ${s.features.features.length}`);
  const expectedTaskCount = plan.tasks.length + 1 + PRODUCT_TASKS.length;
  if (s.tasks.tasks.length !== expectedTaskCount) errors.push(`expected ${plan.tasks.length} imported tasks plus foundation and ${PRODUCT_TASKS.length} product tasks, found ${s.tasks.tasks.length}`);
  if (s.tests.cases.length !== 63) errors.push(`expected 63 WP0 cases, found ${s.tests.cases.length}`);
}

function validateFeatureContracts(s, importedFeatures, errors) {
  for (const feature of s.features.features) validateFeatureContract(s, feature, importedFeatures, errors);
}

function validateFeatureContract(s, feature, importedFeatures, errors) {
  const src = importedFeatures.get(feature.id);
  if (!src) return;
  validateFeatureSourceReferences(s, feature, src, errors);
  validateFeatureRelations(feature, errors);
  validateFeaturePaths(feature, errors);
}

function validateFeatureSourceReferences(s, feature, src, errors) {
  if (!equal(feature.dependencies, src.dependencies)) errors.push(`${feature.id} source dependencies were changed`);
  if (!equal(feature.acceptance_criteria, src.acceptance_criteria)) errors.push(`${feature.id} source acceptance criteria were changed`);
  if (!equal(s.acceptance.features[feature.id]?.criteria, src.acceptance_criteria)) errors.push(`${feature.id} acceptance contract differs from source`);
  if (feature.original_phase !== src.recommended_release || feature.phase !== expectedPhase(src)) errors.push(`${feature.id} source/refined phase is inconsistent`);
}

function validateFeatureRelations(feature, errors) {
  const expectedTasks = workByFeature.get(feature.id) ?? [];
  if (!equal(feature.related_work_items, expectedTasks.map((task) => task.id))) errors.push(`${feature.id} related work items are incomplete`);
  const expectedPackages = [...new Set(expectedTasks.map((task) => task.package))].sort(compareStrings);
  if (!equal([...(feature.related_work_packages ?? [])].sort(compareStrings), expectedPackages)) errors.push(`${feature.id} related work packages are incomplete`);
  const refinementId = plan.features.find((item) => item.id === feature.id)?.feature_acceptance_id;
  const expectedRefs = [...new Set([...expectedTasks.flatMap((task) => task.test_cases), ...(refinementId ? [refinementId] : [])])].sort(compareStrings);
  if (!equal([...(feature.test_references ?? [])].sort(compareStrings), expectedRefs)) errors.push(`${feature.id} test references are incomplete`);
}

function validateFeaturePaths(feature, errors) {
  const expectedSources = [catalogPath, ...(plan.features.some((item) => item.id === feature.id) ? [planPath] : [])];
  if (!equal(feature.source_paths, expectedSources)) errors.push(`${feature.id} source paths are incomplete`);
}

function validateTaskContracts(s, importedTasks, validEvidence, errors) {
  for (const task of s.tasks.tasks) validateTaskContract(s, task, importedTasks, validEvidence, errors);
}

function validateTaskContract(s, task, importedTasks, validEvidence, errors) {
  if (task.id === 'SF-P0-FOUNDATION') return;
  const productTask = PRODUCT_TASKS.find((item) => item.id === task.id);
  if (productTask) return validateProductTaskContract(task, productTask, validEvidence, errors);
  const src = importedTasks.get(task.id);
  if (src) validateImportedTaskContract(s, task, src, errors);
}

function validateProductTaskContract(task, productTask, validEvidence, errors) {
  const keys = ['package', 'title', 'dependencies', 'feature_ids', 'acceptance_criteria', 'test_references'];
  for (const key of keys) if (!equal(task[key], productTask[key])) errors.push(`${task.id} product task contract ${key} was changed`);
  const invalidScope = task.evidence?.some((ref) => validEvidence.get(ref.index_id)?.scope !== 'PRODUCT');
  if (task.status === 'VERIFIED' && invalidScope) errors.push(`${task.id} requires product-scope evidence`);
}

function validateImportedTaskContract(s, task, src, errors) {
  if (!equal(task.dependencies, src.dependencies)) errors.push(`${task.id} source dependencies were changed`);
  if (!equal(task.acceptance_criteria, src.acceptance_criteria)) errors.push(`${task.id} source acceptance criteria were changed`);
  if (!equal(s.acceptance.work[task.id]?.criteria, src.acceptance_criteria)) errors.push(`${task.id} acceptance contract differs from source`);
  if (!equal(task.feature_ids, src.feature_ids) || !equal(task.test_references, src.test_cases)) errors.push(`${task.id} source feature/test references were changed`);
}

function validateCaseContracts(s, importedCases, validEvidence, errors) {
  for (const testCase of s.tests.cases) validateCaseContract(s, testCase, importedCases, validEvidence, errors);
}

function validateCaseContract(s, testCase, importedCases, validEvidence, errors) {
  const src = importedCases.get(testCase.id);
  if (!src) return;
  validateCaseReferences(testCase, src, errors);
  const evidenceRefs = evidenceRefsFor(testCase, testCase.id, errors);
  validateCaseEvidenceRefs(testCase, evidenceRefs, validEvidence, errors);
  for (const cell of ['unit', 'oracle_19c', 'oracle_21c']) validateCaseCell(s, testCase, src, cell, evidenceRefs, validEvidence, errors);
}

function validateCaseReferences(testCase, src, errors) {
  const acceptance = { expected_result: src.expected_result, evidence_required: src.evidence_required, pass_criteria: src.pass_criteria };
  if (!equal(testCase.source_paths, [planPath]) || !equal(testCase.task_ids, src.task_ids) || testCase.mode !== src.mode || testCase.objective !== src.objective || !equal(testCase.acceptance, acceptance)) errors.push(`${testCase.id} source/task/acceptance references are inconsistent`);
  if (!equal(Object.keys(testCase.results ?? {}).sort(compareStrings), ['oracle_19c', 'oracle_21c', 'unit'].sort(compareStrings))) errors.push(`${testCase.id} must have exactly the three separate result cells`);
}

function validateCaseEvidenceRefs(testCase, evidenceRefs, validEvidence, errors) {
  for (const ref of evidenceRefs) if (!validEvidence.has(ref.index_id)) errors.push(`${testCase.id} references missing or invalid evidence index ${ref.index_id}`);
}

function validateCaseCell(s, testCase, src, cell, evidenceRefs, validEvidence, errors) {
  const result = testCase.results?.[cell];
  if (!CELL_RESULTS.has(result)) errors.push(`${testCase.id} ${cell} has invalid result ${result}`);
  validateCellApplicability(testCase, src, cell, result, errors);
  validateCellBlockers(s, testCase, src, cell, result, errors);
  if (result === 'PASS') validateCellPassEvidence(testCase, cell, evidenceRefs, validEvidence, errors);
}

function validateCellApplicability(testCase, src, cell, result, errors) {
  if (src.results[cell] === 'NOT_APPLICABLE' && result !== 'NOT_APPLICABLE') errors.push(`${testCase.id} ${cell} must preserve NOT_APPLICABLE`);
}

function validateCellBlockers(s, testCase, src, cell, result, errors) {
  if (cell === 'unit' && result === 'BLOCKED' && !testCase.blockers?.some((b) => typeof b === 'string' && b.trim() && !/oracle|lab\s+(authorization|profile|target)/i.test(b))) errors.push(`${testCase.id} unit BLOCKED requires an explicit offline blocker independent of Oracle lab authorization`);
  if (cell !== 'unit' && src.results[cell] !== 'NOT_APPLICABLE' && !s.milestone.oracle_lab_authorized && result !== 'BLOCKED') errors.push(`${testCase.id} ${cell} must remain BLOCKED until lab authorization`);
  if (cell !== 'unit' && src.results[cell] !== 'NOT_APPLICABLE' && !s.milestone.oracle_lab_authorized && !testCase.blockers?.some((b) => /authorization/i.test(b) && /profile/i.test(b))) errors.push(`${testCase.id} ${cell} blocker must name missing lab authorization and profile`);
}

function validateCellPassEvidence(testCase, cell, evidenceRefs, validEvidence, errors) {
  const evidence = evidenceRefs.map((ref) => validEvidence.get(ref.index_id)).filter((entry) => entry?.outcome === 'PASS');
  const kind = cell === 'unit' && testCase.mode === 'STATIC' ? 'STATIC' : { unit: 'UNIT', oracle_19c: 'ORACLE_19C', oracle_21c: 'ORACLE_21C' }[cell];
  const matches = evidence.some((entry) => entry.subject_id === testCase.id && entry.scope === 'HARNESS' && entry.test_references.includes(testCase.id) && entry.kind === kind);
  if (!matches) errors.push(`${testCase.id} ${cell} PASS lacks matching indexed evidence`);
}

function validateImportedIds(s, importedFeatures, importedTasks, importedCases, errors) {
  const checkIds = (label, items, expected, extras = []) => {
    const ids = items.map((x) => x.id);
    if (new Set(ids).size !== ids.length) errors.push(`${label} contains duplicate IDs`);
    for (const id of expected.keys()) if (!ids.includes(id)) errors.push(`${label} is missing imported ID ${id}`);
    for (const id of ids) if (!expected.has(id) && !extras.includes(id)) errors.push(`${label} has unexpected ID ${id}`);
  };
  checkIds('features', s.features.features, importedFeatures);
  checkIds('tasks', s.tasks.tasks, new Map([...importedTasks, ['SF-P0-FOUNDATION', {}], ...PRODUCT_TASKS.map((t) => [t.id, {}])]));
  checkIds('WP0 cases', s.tests.cases, importedCases);
}

export function validateState(s) {
  const errors = [];
  s.acceptance ??= { features: {}, work: {}, test_cases: [] };
  s.acceptance.features ??= {};
  s.acceptance.work ??= {};
  s.ownership ??= { items: {}, agents: {} };
  s.ownership.items ??= {};
  s.ownership.agents ??= {};
  s.graph ??= { nodes: [], edges: {} };
  s.graph.edges ??= {};
  s.evidence ??= { entries: [] };
  s.tests ??= { cases: [] };
  s.milestone ??= { allowed_packages: [] };
  const importedFeatures = new Map(catalog.features.map((x) => [x.id, x]));
  const importedTasks = new Map(plan.tasks.map((x) => [x.id, x]));
  const importedCases = new Map(plan.wp0_tests.map((x) => [x.id, x]));
  validateImportedIds(s, importedFeatures, importedTasks, importedCases, errors);
  const features = new Map(s.features.features.map((x) => [x.id, x]));
  const tasks = new Map(s.tasks.tasks.map((x) => [x.id, x]));
  const all = new Map([...features, ...tasks]);
  if (!s.acceptance?.features || !s.acceptance?.work) errors.push('acceptance contracts are missing');
  const validEvidence = validateEvidence(s, importedCases, errors);
  validateGraphAndScheduling(s, all, errors);
  validateItemEvidenceAndStatus(s, all, features, tasks, validEvidence, errors);
  validateOwnershipContracts(s, all, features, tasks, importedFeatures, importedTasks, errors);
  validateFeatureContracts(s, importedFeatures, errors);
  validateTaskContracts(s, importedTasks, validEvidence, errors);
  validateCaseContracts(s, importedCases, validEvidence, errors);
  return errors;
}

function formatStatus(s) {
  const counts = (items) => Object.fromEntries([...new Set(items.map((x) => x.status))].sort(compareStrings).map((status) => [status, items.filter((x) => x.status === status).length]));
  return { features: s.features.features.length, feature_status: counts(s.features.features), work_items: s.tasks.tasks.length, work_status: counts(s.tasks.tasks), wp0_cases: s.tests.cases.length, oracle_cells: 'BLOCKED pending authorized lab manifest' };
}
export function selectNext(s) {
  const all = [...s.tasks.tasks, ...s.features.features];
  const track = s.milestone.tracks?.[s.milestone.active_track];
  const allowed = new Set(track?.allowed_packages ?? s.milestone.allowed_packages ?? []);
  const scheduling = s.graph.scheduling?.[s.milestone.active_track] ?? {};
  return all.filter((x) => (x.status === 'READY' || x.status === 'BACKLOG') && x.package && allowed.has(x.package) &&
    (scheduling[x.id] ?? x.dependencies).every((id) => all.some((d) => d.id === id && d.status === 'VERIFIED')));
}
function initializeTracking() {
  const existing = Object.values(paths()).filter((file) => fs.existsSync(path.join(impl, file)));
  if (existing.length) {
    console.error(`Refusing to initialize over existing tracking state: ${existing.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const d = buildTrackingData();
  write('features.json', { schema_version: '1.0.0', source: catalogPath, phase_policy: 'For the 95 refined items, phase is the implementation-plan tier; original_phase preserves catalog recommended_release. Other features retain recommended_release.', features: d.features });
  write('backlog.json', { schema_version: '1.0.0', source: planPath, tasks: d.tasks });
  write('acceptance.json', { schema_version: '1.0.0', ...d.acceptance, test_cases: d.tests });
  write('dependency-graph.json', { schema_version: '1.0.0', nodes: [...d.features, ...d.tasks].map((x) => x.id), edges: d.dependencies, scheduling: { PRODUCT: PRODUCT_SCHEDULE, VALIDATION: {} } });
  write('ownership.json', { schema_version: '1.0.0', agents: Object.fromEntries(Object.entries(OWNER_ROLES).map(([id, responsibilities]) => [id, { responsibilities, path_policy: OWNER_PATH_POLICY[id] }])), items: Object.fromEntries([...d.features, ...d.tasks].map((x) => [x.id, { assigned_agent: x.assigned_agent, ...(x.review_agent ? { review_agent: x.review_agent } : {}), status: x.status }])) });
  write('evidence-index.json', { schema_version: '1.0.0', note: 'Initialized empty: research sources are not product evidence.', entries: [] });
  write('milestone.json', { schema_version: '1.0.0', milestone: 'PRODUCT runnable local governance / VALIDATION Oracle acceptance', status: 'IN_PROGRESS', active_track: 'PRODUCT', tracks: { PRODUCT: { allowed_packages: ['PRODUCT'] }, VALIDATION: { allowed_packages: ['WP0'] } }, oracle_lab_authorized: false, foundation_task: 'SF-P0-FOUNDATION', blockers: ['Oracle lab authorization and attested disposable-target profile are missing for VALIDATION only.'], evidence: [] });
  console.log('Initialized product tracking data.');
}
function runValidation(s) {
  const errors = validateState(s);
  if (errors.length) { console.error(errors.map((e) => `ERROR ${e}`).join('\n')); process.exitCode = 1; }
  else console.log(`Tracker data valid: 220 features, ${plan.tasks.length} imported tasks plus foundation and ${PRODUCT_TASKS.length} product tasks, 63 cases; no Oracle verification claims.`);
}
function printNext(s) {
  const eligible = selectNext(s);
  console.log(JSON.stringify(eligible.map(({ id, title, name, package: pkg }) => ({ id, title: title ?? name, package: pkg })), null, 2));
}
function printGraph(s, format) {
  if (format !== 'dot') { console.log(JSON.stringify(s.graph, null, 2)); return; }
  console.log('digraph SchemaForge {');
  for (const [id, deps] of Object.entries(s.graph.edges)) for (const dep of deps) console.log(`  "${dep}" -> "${id}";`);
  console.log('}');
}
function unknownCommand() {
  console.error('Usage: node scripts/tracker.mjs init|validate|status|next|graph [dot]');
  process.exitCode = 2;
}
function main() {
  const [command, arg] = process.argv.slice(2);
  if (command === 'init') return initializeTracking();
  const s = loadState();
  if (command === 'validate') return runValidation(s);
  if (command === 'status') return console.log(JSON.stringify(formatStatus(s), null, 2));
  if (command === 'next') return printNext(s);
  if (command === 'graph') return printGraph(s, arg);
  return unknownCommand();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
