export const CONNECTIVITY_TABLES = ['sf_workspace_database_grants','sf_database_connections','sf_database_connection_projects',
  'sf_database_observations','sf_target_identity_evidence','sf_database_connection_audit'];
export const CONNECTIVITY_TRIGGERS = ['sf_database_connections_config_guard','sf_database_observations_immutable',
  'sf_target_identity_evidence_immutable','sf_database_connection_projects_immutable','sf_database_connection_audit_immutable'];
export const CONNECTIVITY_FUNCTIONS = ['sf_guard_database_connection_config'];

export async function initializeConnectivitySchema(tx) {
  await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS sf_workspace_database_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
      actor_id text NOT NULL, granted_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz,
      operator_os_uid integer NOT NULL,
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_workspace_database_grants_active ON sf_workspace_database_grants(organization_id,actor_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_database_connections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
      container_id uuid NOT NULL, route_id uuid NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
      engine text NOT NULL CHECK(engine IN ('oracle','postgresql','mysql')),
      host text NOT NULL, port integer NOT NULL CHECK(port BETWEEN 1 AND 65535), service text NOT NULL,
      transport text NOT NULL CHECK(transport IN ('TCP','TCPS')), username text NOT NULL,
      credential_ref text NOT NULL CHECK(length(credential_ref)<=512 AND credential_ref ~ '^(vault|secret)://[A-Za-z0-9._/-]+$'),
      actor_id text NOT NULL REFERENCES sf_local_actors(id), reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), retired_at timestamptz, retirement_reason text,
      UNIQUE(id,organization_id),
      FOREIGN KEY(container_id,organization_id) REFERENCES sf_reference_containers(id,organization_id),
      FOREIGN KEY(route_id,organization_id,container_id) REFERENCES sf_reference_services(id,organization_id,container_id)
    );
    CREATE TABLE IF NOT EXISTS sf_database_connection_projects (
      connection_id uuid NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL,
      PRIMARY KEY(connection_id,project_id),
      FOREIGN KEY(connection_id,organization_id) REFERENCES sf_database_connections(id,organization_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_database_observations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL, organization_id uuid NOT NULL,
      operation text NOT NULL CHECK(operation IN ('TEST','DISCOVER')), status text NOT NULL,
      identity jsonb, identity_digest text CHECK(identity_digest IS NULL OR identity_digest ~ '^[a-f0-9]{64}$'),
      schemas jsonb NOT NULL CHECK(jsonb_typeof(schemas)='array' AND jsonb_array_length(schemas)<=500),
      limitations jsonb NOT NULL, provenance text NOT NULL CHECK(provenance IN ('ORACLE_READ_ONLY','FIXTURE','UNAVAILABLE')), verification_acceptance jsonb,
      actor_id text NOT NULL REFERENCES sf_local_actors(id), observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
      UNIQUE(id,organization_id,connection_id),
      FOREIGN KEY(connection_id,organization_id) REFERENCES sf_database_connections(id,organization_id),
      CHECK(expires_at>observed_at AND expires_at<=observed_at+interval '15 minutes 1 second')
    );
    CREATE INDEX IF NOT EXISTS sf_database_observations_connection ON sf_database_observations(connection_id,observed_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS sf_target_identity_evidence (
      digest text PRIMARY KEY CHECK(digest ~ '^[a-f0-9]{64}$'), organization_id uuid NOT NULL, project_id uuid NOT NULL,
      connection_id uuid NOT NULL, observation_id uuid NOT NULL, assignment_id uuid NOT NULL,
      schema_id uuid NOT NULL, assignment_revision bigint NOT NULL, route_id uuid NOT NULL,
      identity_digest text NOT NULL, identity jsonb NOT NULL, exact_owner text COLLATE "C" NOT NULL,
      identity_state text NOT NULL CHECK(identity_state IN ('OBSERVED','VERIFIED')),
      actor_id text NOT NULL REFERENCES sf_local_actors(id), reason text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(observation_id,organization_id,connection_id) REFERENCES sf_database_observations(id,organization_id,connection_id),
      FOREIGN KEY(assignment_id,organization_id,project_id,schema_id) REFERENCES sf_reference_assignments(id,organization_id,project_id,schema_id)
    );
    CREATE TABLE IF NOT EXISTS sf_database_connection_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      project_id uuid REFERENCES sf_projects(id), connection_id uuid REFERENCES sf_database_connections(id),
      actor_id text REFERENCES sf_local_actors(id), action text NOT NULL, facts jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE OR REPLACE FUNCTION sf_guard_database_connection_config() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL OR NEW.retirement_reason IS NULL
        OR (to_jsonb(NEW)-'retired_at'-'retirement_reason') IS DISTINCT FROM (to_jsonb(OLD)-'retired_at'-'retirement_reason') THEN
        RAISE EXCEPTION 'connection configuration is immutable; register a replacement';
      END IF;
      RETURN NEW;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_database_connections_config_guard') THEN
        CREATE TRIGGER sf_database_connections_config_guard BEFORE UPDATE OR DELETE ON sf_database_connections
          FOR EACH ROW EXECUTE FUNCTION sf_guard_database_connection_config();
      END IF;
    END $$;
  `);
  for (const table of ['sf_database_observations','sf_target_identity_evidence','sf_database_connection_projects','sf_database_connection_audit']) {
    await tx.unsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='${table}_immutable') THEN
      CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;`);
  }
  // The original initializer remains available for strict Phase 2 backup restoration.
  await tx.unsafe(`ALTER TABLE sf_target_option_revisions DROP CONSTRAINT IF EXISTS sf_target_option_revisions_identity_state_check;
    ALTER TABLE sf_target_option_revisions ADD CONSTRAINT sf_target_option_revisions_identity_state_check CHECK(identity_state IN ('PROVISIONAL','OBSERVED','VERIFIED'));
    ALTER TABLE sf_target_option_revisions DROP CONSTRAINT IF EXISTS sf_target_option_revisions_check;
    ALTER TABLE sf_target_option_revisions DROP CONSTRAINT IF EXISTS sf_target_option_revisions_observation_check;
    ALTER TABLE sf_target_option_revisions ADD CONSTRAINT sf_target_option_revisions_observation_check CHECK(
      (identity_state='PROVISIONAL' AND observation_digest IS NULL AND observed_at IS NULL) OR
      (identity_state IN ('OBSERVED','VERIFIED') AND observation_digest IS NOT NULL AND observed_at IS NOT NULL));`);
}
