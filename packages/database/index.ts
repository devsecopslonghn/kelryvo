/** Idempotent schema for the local, single-organization product slice. */
export async function initializeDatabase(sql: any): Promise<void> {
  await sql.begin(async (tx: any) => {
    // Test files and local startup callers can initialize the same schema at once.
    // IF NOT EXISTS still races while PostgreSQL creates the backing catalog type.
    await tx`SELECT pg_advisory_xact_lock(1397112658, 1)`;
    await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS sf_organizations (id uuid PRIMARY KEY, name text NOT NULL);
    INSERT INTO sf_organizations (id,name) VALUES ('00000000-0000-4000-8000-000000000001','Local organization') ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS sf_local_actors (
      id text PRIMARY KEY, organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      role text NOT NULL CHECK(role IN ('developer','approver')), display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_local_actors_org_identity ON sf_local_actors(id,organization_id);
    CREATE TABLE IF NOT EXISTS sf_local_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL REFERENCES sf_local_actors(id),
      token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
      issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
      CHECK(expires_at = issued_at + interval '24 hours')
    );
    CREATE INDEX IF NOT EXISTS sf_local_credentials_actor_active ON sf_local_credentials(actor_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      name text NOT NULL, description text,
      source_repository_id text, source_folder text, source_updated_at timestamptz,
      source_binding_generation bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_project_access_mode (
      organization_id uuid PRIMARY KEY REFERENCES sf_organizations(id),
      mode text NOT NULL CHECK (mode IN ('BOOTSTRAP_REQUIRED','ENFORCED')),
      activated_at timestamptz, activated_by_os_uid integer,
      CHECK ((mode='BOOTSTRAP_REQUIRED' AND activated_at IS NULL AND activated_by_os_uid IS NULL)
        OR (mode='ENFORCED' AND activated_at IS NOT NULL AND activated_by_os_uid IS NOT NULL))
    );
    INSERT INTO sf_project_access_mode(organization_id,mode) VALUES
      ('00000000-0000-4000-8000-000000000001','BOOTSTRAP_REQUIRED') ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS sf_project_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      project_id uuid NOT NULL, actor_id text NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz,
      grant_os_uid integer NOT NULL, revoke_os_uid integer,
      CHECK ((revoked_at IS NULL AND revoke_os_uid IS NULL) OR (revoked_at IS NOT NULL AND revoke_os_uid IS NOT NULL)),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_project_grants_active ON sf_project_grants(project_id,actor_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_project_operator_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      project_id uuid, actor_id text,
      action text NOT NULL CHECK(action IN ('GRANT','REVOKE','ACTIVATE')),
      operator_os_uid integer NOT NULL, facts jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_environments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, organization_id uuid NOT NULL,
      name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, organization_id uuid NOT NULL, environment_id uuid NOT NULL,
      name text NOT NULL, engine text NOT NULL CHECK(engine='oracle'), host text NOT NULL, port integer NOT NULL CHECK(port BETWEEN 1 AND 65535),
      service text NOT NULL, username text NOT NULL, credential_ref text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(environment_id,project_id) REFERENCES sf_environments(id,project_id), UNIQUE(id,project_id)
    );
    CREATE TABLE IF NOT EXISTS sf_releases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, organization_id uuid NOT NULL,
      repository_id text NOT NULL, commit_id text NOT NULL, object_format text NOT NULL, folder text NOT NULL,
      manifest_digest text NOT NULL, validation_status text NOT NULL, validation_code text, parser_profile text,
      files jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id), UNIQUE(id,project_id)
    );
    CREATE TABLE IF NOT EXISTS sf_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, organization_id uuid NOT NULL,
      release_id uuid NOT NULL, profile_id uuid NOT NULL, author_id text NOT NULL, status text NOT NULL DEFAULT 'PENDING_APPROVAL',
      decision text, decision_reason text, decided_by text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
      items jsonb NOT NULL, execution text NOT NULL DEFAULT 'NOT_EXECUTED', history_status text NOT NULL DEFAULT 'NOT_OBSERVED',
      planning_scope text NOT NULL DEFAULT 'OFFLINE_CANDIDATE',
      offline_intent_envelope text,
      offline_intent_digest text CHECK (offline_intent_digest IS NULL OR offline_intent_digest ~ '^[a-f0-9]{64}$'),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(release_id,project_id) REFERENCES sf_releases(id,project_id),
      FOREIGN KEY(profile_id,project_id) REFERENCES sf_profiles(id,project_id), UNIQUE(id,project_id)
    );
    CREATE TABLE IF NOT EXISTS sf_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, organization_id uuid NOT NULL,
      actor_id text NOT NULL, action text NOT NULL, resource_id uuid, facts jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_plan_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      project_id uuid NOT NULL, organization_id uuid NOT NULL, plan_id uuid NOT NULL,
      author_id text NOT NULL, author_name text NOT NULL,
      body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000 AND octet_length(body) <= 16000),
      evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (CASE WHEN jsonb_typeof(evidence_refs) = 'array' THEN jsonb_array_length(evidence_refs) <= 8 AND octet_length(evidence_refs::text) <= 49152 ELSE false END),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id)
    );
    CREATE TABLE IF NOT EXISTS sf_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, plan_id uuid NOT NULL, version text NOT NULL,
      path text NOT NULL, sha256 text NOT NULL, status text NOT NULL CHECK(status='NOT_EXECUTED'), created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id)
    );
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_repository_id text;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_folder text;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_binding_generation bigint NOT NULL DEFAULT 1;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS decided_by_name text;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS offline_intent_envelope text;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS offline_intent_digest text;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS source_binding_generation bigint;
    ALTER TABLE sf_plan_comments ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_plan_comments'::regclass AND conname='sf_plan_comments_evidence_refs_bounded') THEN
        ALTER TABLE sf_plan_comments ADD CONSTRAINT sf_plan_comments_evidence_refs_bounded
          CHECK (CASE WHEN jsonb_typeof(evidence_refs) = 'array' THEN jsonb_array_length(evidence_refs) <= 8 AND octet_length(evidence_refs::text) <= 49152 ELSE false END);
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_projects'::regclass AND conname='sf_projects_source_binding_complete') THEN
        ALTER TABLE sf_projects ADD CONSTRAINT sf_projects_source_binding_complete
          CHECK ((source_repository_id IS NULL AND source_folder IS NULL AND source_updated_at IS NULL)
            OR (source_repository_id IS NOT NULL AND source_folder IS NOT NULL AND source_updated_at IS NOT NULL));
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS sf_audit_project_time ON sf_audit(project_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS sf_audit_project_time_id ON sf_audit(project_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS sf_history_project_time ON sf_history(project_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS sf_comments_project_position ON sf_plan_comments(project_id,position);
    CREATE INDEX IF NOT EXISTS sf_comments_plan_position ON sf_plan_comments(plan_id,position);
    `);
  });
}
