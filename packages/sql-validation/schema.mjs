export const VALIDATION_TABLES = ['sf_sql_validations'];
export const VALIDATION_TRIGGERS = ['sf_sql_validations_immutable'];

export async function initializeValidationSchema(tx) {
  await tx.unsafe(`CREATE TABLE IF NOT EXISTS sf_sql_validations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
    project_id uuid NOT NULL, release_id uuid NOT NULL, binding_id uuid NOT NULL,
    digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
    envelope text NOT NULL CHECK(octet_length(envelope) BETWEEN 1 AND 2097152),
    actor_id text NOT NULL REFERENCES sf_local_actors(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(organization_id,project_id,digest),
    FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
    FOREIGN KEY(release_id,project_id) REFERENCES sf_releases(id,project_id),
    FOREIGN KEY(binding_id) REFERENCES sf_target_bindings(id)
  );
  CREATE INDEX IF NOT EXISTS sf_sql_validations_release ON sf_sql_validations(project_id,release_id,created_at DESC,id DESC);
  DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_sql_validations_immutable') THEN
    CREATE TRIGGER sf_sql_validations_immutable BEFORE UPDATE OR DELETE ON sf_sql_validations
    FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
  END IF; END $$;`);
}
