/** Idempotent schema for the local, single-organization product slice. */
export async function initializeDatabase(sql: any): Promise<void> {
  await sql.begin(async (tx: any) => {
    // Test files and local startup callers can initialize the same schema at once.
    // IF NOT EXISTS still races while PostgreSQL creates the backing catalog type.
    await tx`SELECT pg_advisory_xact_lock(1397112658, 1)`;
    await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS sf_organizations (id uuid PRIMARY KEY, name text NOT NULL);
    INSERT INTO sf_organizations (id,name) VALUES ('00000000-0000-4000-8000-000000000001','Local organization') ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS sf_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      name text NOT NULL, description text,
      source_repository_id text, source_folder text, source_updated_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id)
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
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_projects'::regclass AND conname='sf_projects_source_binding_complete') THEN
        ALTER TABLE sf_projects ADD CONSTRAINT sf_projects_source_binding_complete
          CHECK ((source_repository_id IS NULL AND source_folder IS NULL AND source_updated_at IS NULL)
            OR (source_repository_id IS NOT NULL AND source_folder IS NOT NULL AND source_updated_at IS NOT NULL));
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS sf_audit_project_time ON sf_audit(project_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS sf_history_project_time ON sf_history(project_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS sf_comments_project_position ON sf_plan_comments(project_id,position);
    CREATE INDEX IF NOT EXISTS sf_comments_plan_position ON sf_plan_comments(plan_id,position);
    `);
  });
}
