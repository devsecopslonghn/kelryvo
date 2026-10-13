export const SQL_WORKSPACE_TABLES = ['sf_sql_drafts', 'sf_sql_draft_revisions', 'sf_sql_workspace_releases'];
export const SQL_WORKSPACE_FUNCTIONS = ['sf_reject_sql_workspace_evidence_mutation', 'sf_guard_sql_draft_pointer'];
export const SQL_WORKSPACE_TRIGGERS = ['sf_sql_drafts_pointer_guard', 'sf_sql_draft_revisions_immutable', 'sf_sql_workspace_releases_immutable'];

/** Additive durable schema for project-owned SQL drafts and authored release provenance. */
export async function initializeSqlWorkspaceSchema(tx) {
  await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS sf_sql_drafts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
      name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200), target_binding_id uuid NOT NULL,
      current_revision bigint NOT NULL CHECK(current_revision > 0), created_by text NOT NULL REFERENCES sf_local_actors(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id)
    );
    CREATE INDEX IF NOT EXISTS sf_sql_drafts_project_updated ON sf_sql_drafts(project_id,updated_at DESC,id);
    CREATE TABLE IF NOT EXISTS sf_sql_draft_revisions (
      draft_id uuid NOT NULL, project_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision > 0),
      sql text NOT NULL CHECK(octet_length(sql) <= 1048576), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
      created_by text NOT NULL REFERENCES sf_local_actors(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(draft_id,revision), UNIQUE(draft_id,revision,project_id),
      FOREIGN KEY(draft_id,project_id) REFERENCES sf_sql_drafts(id,project_id)
    );
    CREATE INDEX IF NOT EXISTS sf_sql_draft_revisions_project ON sf_sql_draft_revisions(project_id,draft_id,revision DESC);
    CREATE TABLE IF NOT EXISTS sf_sql_workspace_releases (
      release_id uuid PRIMARY KEY, project_id uuid NOT NULL, organization_id uuid NOT NULL,
      draft_id uuid NOT NULL, draft_revision bigint NOT NULL CHECK(draft_revision > 0),
      draft_sha256 text NOT NULL CHECK(draft_sha256 ~ '^[a-f0-9]{64}$'),
      source_binding_generation bigint NOT NULL CHECK(source_binding_generation > 0),
      created_by text NOT NULL REFERENCES sf_local_actors(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(release_id,project_id),
      FOREIGN KEY(release_id,project_id) REFERENCES sf_releases(id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(draft_id,draft_revision,project_id) REFERENCES sf_sql_draft_revisions(draft_id,revision,project_id)
    );
    CREATE INDEX IF NOT EXISTS sf_sql_workspace_releases_draft ON sf_sql_workspace_releases(project_id,draft_id,draft_revision DESC);
    CREATE OR REPLACE FUNCTION sf_reject_sql_workspace_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'SQL workspace evidence is immutable'; END $$;
    CREATE OR REPLACE FUNCTION sf_guard_sql_draft_pointer() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SQL drafts are retained'; END IF;
        IF NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.project_id<>OLD.project_id
          OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.current_revision<OLD.current_revision
          OR NEW.current_revision>OLD.current_revision+1 THEN
          RAISE EXCEPTION 'invalid SQL draft update';
        END IF;
        RETURN NEW;
      END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_sql_drafts_pointer_guard') THEN
      CREATE TRIGGER sf_sql_drafts_pointer_guard BEFORE UPDATE OR DELETE ON sf_sql_drafts
      FOR EACH ROW EXECUTE FUNCTION sf_guard_sql_draft_pointer(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_sql_draft_revisions_immutable') THEN
      CREATE TRIGGER sf_sql_draft_revisions_immutable BEFORE UPDATE OR DELETE ON sf_sql_draft_revisions
      FOR EACH ROW EXECUTE FUNCTION sf_reject_sql_workspace_evidence_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_sql_workspace_releases_immutable') THEN
      CREATE TRIGGER sf_sql_workspace_releases_immutable BEFORE UPDATE OR DELETE ON sf_sql_workspace_releases
      FOR EACH ROW EXECUTE FUNCTION sf_reject_sql_workspace_evidence_mutation(); END IF; END $$;
  `);
}
