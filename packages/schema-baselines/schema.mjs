export const SCHEMA_BASELINE_TABLES = ['sf_schema_snapshots','sf_schema_baselines','sf_plan_schema_evidence'];
export const SCHEMA_BASELINE_TRIGGERS = [...SCHEMA_BASELINE_TABLES.map(t=>`${t}_immutable`),'sf_schema_snapshots_scope'];
export const SCHEMA_BASELINE_FUNCTIONS = ['sf_check_schema_snapshot_scope'];
export async function initializeSchemaBaselines(tx) {
  await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS sf_schema_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
      binding_id uuid NOT NULL, binding_revision bigint NOT NULL, assignment_revision bigint NOT NULL,
      stream_id uuid NOT NULL, route_id uuid NOT NULL, connection_id uuid NOT NULL, connection_revision bigint NOT NULL,
      owner text COLLATE "C" NOT NULL, identity jsonb, identity_digest text, schema jsonb NOT NULL,
      content_digest text NOT NULL CHECK(content_digest ~ '^[a-f0-9]{64}$'),
      provenance text NOT NULL CHECK(provenance IN ('ORACLE_READ_ONLY','FIXTURE','UNAVAILABLE')),
      live_accepted boolean NOT NULL DEFAULT false, verification_acceptance jsonb,
      actor_id text NOT NULL REFERENCES sf_local_actors(id), reason text NOT NULL,
      observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(id,organization_id,project_id),
      FOREIGN KEY(binding_id,binding_revision) REFERENCES sf_target_binding_revisions(binding_id,revision),
      FOREIGN KEY(connection_id,organization_id) REFERENCES sf_database_connections(id,organization_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      CHECK(octet_length(schema::text)<=2097152 AND jsonb_typeof(schema)='object')
    );
    CREATE INDEX IF NOT EXISTS sf_schema_snapshots_history ON sf_schema_snapshots(project_id,binding_id,observed_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS sf_schema_baselines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, project_id uuid NOT NULL,
      snapshot_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      reason text NOT NULL, actor_id text NOT NULL REFERENCES sf_local_actors(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(snapshot_id,organization_id,project_id) REFERENCES sf_schema_snapshots(id,organization_id,project_id)
    );
    CREATE TABLE IF NOT EXISTS sf_plan_schema_evidence (
      plan_id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL,
      binding_id uuid NOT NULL, target_created_at text NOT NULL,
      snapshot_id uuid, snapshot_digest text,
      FOREIGN KEY(snapshot_id,organization_id,project_id) REFERENCES sf_schema_snapshots(id,organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id),
      CHECK((snapshot_id IS NULL)=(snapshot_digest IS NULL))
    );
    CREATE OR REPLACE FUNCTION sf_check_schema_snapshot_scope() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
    BEGIN
      IF NOT EXISTS(SELECT 1 FROM sf_target_binding_revisions r JOIN sf_database_connections c
        ON c.id=NEW.connection_id AND c.organization_id=r.organization_id AND c.route_id=r.route_id AND c.container_id=r.container_id
        JOIN sf_database_connection_projects p ON p.connection_id=c.id AND p.project_id=r.project_id
        WHERE r.binding_id=NEW.binding_id AND r.revision=NEW.binding_revision AND r.organization_id=NEW.organization_id
        AND r.project_id=NEW.project_id AND r.stream_id=NEW.stream_id AND r.route_id=NEW.route_id
        AND r.exact_owner=NEW.owner AND r.assignment_revision=NEW.assignment_revision) THEN
        RAISE EXCEPTION 'schema snapshot target scope mismatch';
      END IF;
      RETURN NEW;
    END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_schema_snapshots_scope') THEN
      CREATE TRIGGER sf_schema_snapshots_scope BEFORE INSERT ON sf_schema_snapshots
      FOR EACH ROW EXECUTE FUNCTION sf_check_schema_snapshot_scope(); END IF; END $$;
    CREATE INDEX IF NOT EXISTS sf_plan_schema_evidence_target ON sf_plan_schema_evidence(project_id,binding_id,target_created_at);
  `);
  for(const table of SCHEMA_BASELINE_TABLES) await tx.unsafe(`DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='${table}_immutable') THEN
      CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
    END IF; END $$;`);
}
