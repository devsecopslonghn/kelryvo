/** Additive identity migration: actor IDs and historical grants are retained. */
export async function initializeIdentity(tx: any) {
  await tx.unsafe(`
    ALTER TABLE sf_local_actors ADD COLUMN IF NOT EXISTS disabled boolean NOT NULL DEFAULT false;
    ALTER TABLE sf_local_credentials ADD COLUMN IF NOT EXISTS auth_method text NOT NULL DEFAULT 'TOKEN';
    CREATE TABLE IF NOT EXISTS sf_identity_users (
      actor_id text PRIMARY KEY REFERENCES sf_local_actors(id),
      username text UNIQUE NOT NULL CHECK(username=lower(username)),
      workspace_role text NOT NULL DEFAULT 'member' CHECK(workspace_role IN ('admin','member')),
      password_hash text, must_change_password boolean NOT NULL DEFAULT false,
      version bigint NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS sf_identity_groups (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sf_identity_group_members (
      group_id uuid NOT NULL REFERENCES sf_identity_groups(id), actor_id text NOT NULL REFERENCES sf_local_actors(id),
      source text NOT NULL DEFAULT 'MANUAL', PRIMARY KEY(group_id,actor_id,source)
    );
    CREATE TABLE IF NOT EXISTS sf_identity_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_type text NOT NULL CHECK(subject_type IN ('USER','GROUP')),
      subject_id text NOT NULL, project_id uuid NOT NULL REFERENCES sf_projects(id),
      role text NOT NULL CHECK(role IN ('viewer','developer','approver','deployer','owner')),
      environment_id uuid, FOREIGN KEY(environment_id,project_id) REFERENCES sf_environments(id,project_id)
    );
    ALTER TABLE sf_identity_assignments ADD COLUMN IF NOT EXISTS environment_id uuid;
    ALTER TABLE sf_identity_assignments DROP CONSTRAINT IF EXISTS sf_identity_assignments_subject_type_subject_id_project_id_role_key;
    CREATE UNIQUE INDEX IF NOT EXISTS sf_identity_assignments_scope ON sf_identity_assignments(subject_type,subject_id,project_id,role,environment_id) NULLS NOT DISTINCT;
    ALTER TABLE sf_project_grants ADD COLUMN IF NOT EXISTS identity_managed boolean NOT NULL DEFAULT false;
    ALTER TABLE sf_project_deploy_grants ADD COLUMN IF NOT EXISTS identity_managed boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS sf_identity_providers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, type text NOT NULL CHECK(type IN ('LDAP','OIDC')),
      enabled boolean NOT NULL DEFAULT false, config jsonb NOT NULL, secret_ref text,
      version bigint NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sf_external_identities (
      provider_id uuid NOT NULL REFERENCES sf_identity_providers(id), subject text NOT NULL,
      actor_id text NOT NULL REFERENCES sf_identity_users(actor_id), PRIMARY KEY(provider_id,subject),
      UNIQUE(provider_id,actor_id)
    );
    ALTER TABLE sf_local_credentials ADD COLUMN IF NOT EXISTS identity_provider_id uuid REFERENCES sf_identity_providers(id);
    CREATE TABLE IF NOT EXISTS sf_identity_audit (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor_id text, action text NOT NULL,
      subject_id text, facts jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_identity_audit_immutable') THEN
      CREATE TRIGGER sf_identity_audit_immutable BEFORE UPDATE OR DELETE ON sf_identity_audit
        FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation(); END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_identity_login_limits (
      key text PRIMARY KEY, failures integer NOT NULL DEFAULT 0, window_start timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS sf_oidc_flows (
      state_digest text PRIMARY KEY, browser_digest text NOT NULL, provider_id uuid NOT NULL REFERENCES sf_identity_providers(id),
      provider_version bigint NOT NULL, verifier text NOT NULL, nonce text NOT NULL,
      expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
    );
    ALTER TABLE sf_environments ADD COLUMN IF NOT EXISTS approval_required boolean NOT NULL DEFAULT true;
    ALTER TABLE sf_environments ADD COLUMN IF NOT EXISTS independent_approval boolean NOT NULL DEFAULT true;
    CREATE UNIQUE INDEX IF NOT EXISTS sf_plans_identity_approval_reference ON sf_plans(id,approval_reference);
    CREATE TABLE IF NOT EXISTS sf_plan_policy_decisions (
      plan_id uuid PRIMARY KEY REFERENCES sf_plans(id), approval_reference uuid NOT NULL,
      environment_id uuid NOT NULL REFERENCES sf_environments(id), approval_required boolean NOT NULL, independent_approval boolean NOT NULL,
      FOREIGN KEY(plan_id,approval_reference) REFERENCES sf_plans(id,approval_reference)
    );
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_plan_policy_decisions_immutable') THEN
      CREATE TRIGGER sf_plan_policy_decisions_immutable BEFORE UPDATE OR DELETE ON sf_plan_policy_decisions
        FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation(); END IF; END $$;
    CREATE OR REPLACE FUNCTION sf_plan_approval_satisfied(plan uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM sf_plans p JOIN sf_profiles profile ON profile.id=p.profile_id
        JOIN sf_environments e ON e.id=profile.environment_id
        LEFT JOIN sf_plan_policy_decisions d ON d.plan_id=p.id AND d.approval_reference=p.approval_reference AND d.environment_id=e.id
        WHERE p.id=plan AND p.status='APPROVED' AND p.decision='APPROVE' AND p.approval_reference IS NOT NULL AND p.decided_by IS NOT NULL
          AND (p.decided_by<>p.author_id OR (d.plan_id IS NOT NULL
            AND NOT (d.approval_required AND d.independent_approval) AND NOT (e.approval_required AND e.independent_approval)))
          AND NOT EXISTS(SELECT 1 FROM sf_plan_approval_revocations r WHERE r.plan_id=p.id))
    $$;
    DROP FUNCTION IF EXISTS sf_identity_can_review(text,uuid);
    CREATE OR REPLACE FUNCTION sf_identity_can_review(actor text,project uuid,environment uuid DEFAULT NULL) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN EXISTS(SELECT 1 FROM sf_identity_users u WHERE u.actor_id=actor)
      THEN EXISTS(SELECT 1 FROM sf_identity_assignments a WHERE a.project_id=project AND a.role IN ('approver','owner') AND (a.environment_id IS NULL OR a.environment_id=environment)
        AND ((a.subject_type='USER' AND a.subject_id=actor) OR (a.subject_type='GROUP' AND EXISTS(
          SELECT 1 FROM sf_identity_group_members m WHERE m.actor_id=actor AND m.group_id::text=a.subject_id))))
      ELSE EXISTS(SELECT 1 FROM sf_local_actors a WHERE a.id=actor AND a.role='approver' AND NOT a.disabled) END
    $$;
    CREATE OR REPLACE FUNCTION sf_identity_can_deploy(actor text,project uuid,environment uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT NOT EXISTS(SELECT 1 FROM sf_identity_users u WHERE u.actor_id=actor) OR EXISTS(
        SELECT 1 FROM sf_identity_assignments a WHERE a.project_id=project AND a.role IN ('deployer','owner')
          AND (a.environment_id IS NULL OR a.environment_id=environment)
          AND ((a.subject_type='USER' AND a.subject_id=actor) OR (a.subject_type='GROUP' AND EXISTS(
            SELECT 1 FROM sf_identity_group_members m WHERE m.actor_id=actor AND m.group_id::text=a.subject_id))))
    $$;
    CREATE OR REPLACE FUNCTION sf_identity_actor_enabled(actor text) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM sf_local_actors a WHERE a.id=actor AND NOT a.disabled)
    $$;
  `);
}
