/** Standalone target metadata tables. Base product schema must be initialized first. */
export const TARGET_SCHEMA_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_reference_assignments'::regclass AND conname='sf_reference_assignments_target_scope') THEN
    ALTER TABLE sf_reference_assignments ADD CONSTRAINT sf_reference_assignments_target_scope
      UNIQUE(id,organization_id,project_id,schema_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_reference_schemas'::regclass AND conname='sf_reference_schemas_target_container') THEN
    ALTER TABLE sf_reference_schemas ADD CONSTRAINT sf_reference_schemas_target_container
      UNIQUE(id,organization_id,container_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_reference_schemas'::regclass AND conname='sf_reference_schemas_target_owner') THEN
    ALTER TABLE sf_reference_schemas ADD CONSTRAINT sf_reference_schemas_target_owner
      UNIQUE(id,organization_id,container_id,exact_owner);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_reference_services'::regclass AND conname='sf_reference_services_target_container') THEN
    ALTER TABLE sf_reference_services ADD CONSTRAINT sf_reference_services_target_container
      UNIQUE(id,organization_id,container_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_profiles'::regclass AND conname='sf_profiles_target_environment') THEN
    ALTER TABLE sf_profiles ADD CONSTRAINT sf_profiles_target_environment
      UNIQUE(id,project_id,environment_id);
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS sf_target_lineages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  container_id uuid NOT NULL, declared_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  provenance text NOT NULL DEFAULT 'MANUAL_REFERENCE' CHECK(provenance='MANUAL_REFERENCE'),
  UNIQUE(container_id), UNIQUE(id,organization_id,container_id),
  FOREIGN KEY(container_id,organization_id) REFERENCES sf_reference_containers(id,organization_id)
);
CREATE TABLE IF NOT EXISTS sf_target_streams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  lineage_id uuid NOT NULL, container_id uuid NOT NULL, exact_owner text COLLATE "C" NOT NULL,
  migration_namespace text COLLATE "C" NOT NULL CHECK(length(migration_namespace) BETWEEN 1 AND 128),
  state text NOT NULL DEFAULT 'PROVISIONAL' CHECK(state='PROVISIONAL'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(lineage_id,exact_owner,migration_namespace), UNIQUE(id,organization_id,lineage_id,exact_owner,migration_namespace),
  FOREIGN KEY(lineage_id,organization_id,container_id) REFERENCES sf_target_lineages(id,organization_id,container_id)
);
CREATE TABLE IF NOT EXISTS sf_target_options (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, assignment_id uuid NOT NULL,
  project_id uuid NOT NULL, schema_id uuid NOT NULL, container_id uuid NOT NULL,
  current_revision bigint NOT NULL CHECK(current_revision > 0), enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(id,organization_id,project_id),
  FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
  FOREIGN KEY(assignment_id,organization_id,project_id,schema_id) REFERENCES sf_reference_assignments(id,organization_id,project_id,schema_id),
  FOREIGN KEY(schema_id,organization_id,container_id) REFERENCES sf_reference_schemas(id,organization_id,container_id),
  FOREIGN KEY(container_id,organization_id) REFERENCES sf_reference_containers(id,organization_id)
);
CREATE TABLE IF NOT EXISTS sf_target_option_revisions (
  option_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision > 0), organization_id uuid NOT NULL,
  project_id uuid NOT NULL, assignment_id uuid NOT NULL, schema_id uuid NOT NULL, container_id uuid NOT NULL,
  profile_id uuid NOT NULL, profile_name text NOT NULL, environment_id uuid NOT NULL,
  profile_host text NOT NULL, profile_port integer NOT NULL, profile_service text NOT NULL,
  profile_username text NOT NULL, profile_credential_ref text NOT NULL,
  route_id uuid NOT NULL, route_config_revision bigint NOT NULL CHECK(route_config_revision > 0), route_alias text NOT NULL CHECK(length(route_alias) BETWEEN 1 AND 120),
  route_host text NOT NULL, route_port integer NOT NULL, route_service text NOT NULL,
  lineage_id uuid NOT NULL, identity_state text NOT NULL CHECK(identity_state='PROVISIONAL'),
  observation_digest text CHECK(observation_digest IS NULL OR observation_digest ~ '^[a-f0-9]{64}$'), observed_at timestamptz,
  stream_id uuid NOT NULL, stream_state text NOT NULL CHECK(stream_state='PROVISIONAL'), migration_namespace text COLLATE "C" NOT NULL,
  policy_id uuid NOT NULL, policy_revision bigint NOT NULL CHECK(policy_revision > 0), exact_owner text COLLATE "C" NOT NULL,
  deployment_principal_id uuid NOT NULL, principal_purpose text NOT NULL CHECK(principal_purpose='DEPLOY'),
  private_principal_ref text NOT NULL, principal_alias text NOT NULL CHECK(length(principal_alias) BETWEEN 1 AND 120),
  operator_os_uid integer NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(option_id,revision),
  UNIQUE(option_id,revision,organization_id,project_id,assignment_id),
  FOREIGN KEY(option_id,organization_id,project_id) REFERENCES sf_target_options(id,organization_id,project_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(assignment_id,organization_id,project_id,schema_id) REFERENCES sf_reference_assignments(id,organization_id,project_id,schema_id),
  FOREIGN KEY(schema_id,organization_id,container_id,exact_owner) REFERENCES sf_reference_schemas(id,organization_id,container_id,exact_owner),
  FOREIGN KEY(container_id,organization_id) REFERENCES sf_reference_containers(id,organization_id),
  FOREIGN KEY(profile_id,project_id,environment_id) REFERENCES sf_profiles(id,project_id,environment_id),
  FOREIGN KEY(environment_id,project_id) REFERENCES sf_environments(id,project_id),
  FOREIGN KEY(route_id,organization_id,container_id) REFERENCES sf_reference_services(id,organization_id,container_id),
  FOREIGN KEY(lineage_id,organization_id,container_id) REFERENCES sf_target_lineages(id,organization_id,container_id),
  FOREIGN KEY(stream_id,organization_id,lineage_id,exact_owner,migration_namespace) REFERENCES sf_target_streams(id,organization_id,lineage_id,exact_owner,migration_namespace),
  CHECK(observation_digest IS NULL AND observed_at IS NULL),
  CHECK(length(btrim(reason)) BETWEEN 1 AND 2000)
);
CREATE TABLE IF NOT EXISTS sf_target_bindings (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, assignment_id uuid NOT NULL,
  environment_id uuid NOT NULL, current_revision bigint NOT NULL CHECK(current_revision > 0),
  UNIQUE(id,organization_id,project_id,assignment_id,environment_id),
  FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
  FOREIGN KEY(assignment_id,organization_id,project_id) REFERENCES sf_reference_assignments(id,organization_id,project_id),
  FOREIGN KEY(environment_id,project_id) REFERENCES sf_environments(id,project_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sf_target_bindings_active_scope ON sf_target_bindings(project_id,assignment_id,environment_id);
CREATE TABLE IF NOT EXISTS sf_target_binding_revisions (
  binding_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision > 0), organization_id uuid NOT NULL,
  project_id uuid NOT NULL, assignment_id uuid NOT NULL, schema_id uuid NOT NULL, container_id uuid NOT NULL,
  assignment_revision bigint NOT NULL CHECK(assignment_revision >= 0),
  environment_id uuid NOT NULL, environment_name text NOT NULL, target_option_id uuid NOT NULL, target_option_revision bigint NOT NULL,
  profile_id uuid NOT NULL, profile_name text NOT NULL, profile_retired_at timestamptz,
  lineage_id uuid NOT NULL, identity_state text NOT NULL, observation_digest text, observed_at timestamptz,
  stream_id uuid NOT NULL, stream_state text NOT NULL, migration_namespace text COLLATE "C" NOT NULL,
  exact_owner text COLLATE "C" NOT NULL, route_id uuid NOT NULL, route_config_revision bigint NOT NULL, route_alias text NOT NULL,
  policy_id uuid NOT NULL, policy_revision bigint NOT NULL, deployment_principal_id uuid NOT NULL,
  principal_purpose text NOT NULL, private_principal_ref text NOT NULL, principal_alias text NOT NULL,
  actor_id text NOT NULL, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(binding_id,revision),
  FOREIGN KEY(binding_id,organization_id,project_id,assignment_id,environment_id) REFERENCES sf_target_bindings(id,organization_id,project_id,assignment_id,environment_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(assignment_id,organization_id,project_id,schema_id) REFERENCES sf_reference_assignments(id,organization_id,project_id,schema_id),
  FOREIGN KEY(schema_id,organization_id,container_id,exact_owner) REFERENCES sf_reference_schemas(id,organization_id,container_id,exact_owner),
  FOREIGN KEY(environment_id,project_id) REFERENCES sf_environments(id,project_id),
  FOREIGN KEY(profile_id,project_id,environment_id) REFERENCES sf_profiles(id,project_id,environment_id),
  FOREIGN KEY(target_option_id,target_option_revision,organization_id,project_id,assignment_id) REFERENCES sf_target_option_revisions(option_id,revision,organization_id,project_id,assignment_id),
  FOREIGN KEY(stream_id,organization_id,lineage_id,exact_owner,migration_namespace) REFERENCES sf_target_streams(id,organization_id,lineage_id,exact_owner,migration_namespace),
  FOREIGN KEY(actor_id) REFERENCES sf_local_actors(id),
  CHECK(length(btrim(reason)) BETWEEN 1 AND 2000)
);
CREATE INDEX IF NOT EXISTS sf_target_options_project_assignment ON sf_target_options(project_id,assignment_id,id);
CREATE INDEX IF NOT EXISTS sf_target_bindings_project ON sf_target_bindings(project_id,id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sf_target_options_current_revision_fk') THEN
    ALTER TABLE sf_target_options ADD CONSTRAINT sf_target_options_current_revision_fk
      FOREIGN KEY(id,current_revision) REFERENCES sf_target_option_revisions(option_id,revision)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sf_target_bindings_current_revision_fk') THEN
    ALTER TABLE sf_target_bindings ADD CONSTRAINT sf_target_bindings_current_revision_fk
      FOREIGN KEY(id,current_revision) REFERENCES sf_target_binding_revisions(binding_id,revision)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION sf_reject_target_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'target metadata evidence is immutable'; END $$;
CREATE OR REPLACE FUNCTION sf_check_target_binding_option_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE option_revision_row public.sf_target_option_revisions%ROWTYPE;
BEGIN
  SELECT * INTO option_revision_row FROM public.sf_target_option_revisions
    WHERE option_id=NEW.target_option_id AND revision=NEW.target_option_revision;
  IF NOT FOUND OR NEW.project_id IS DISTINCT FROM option_revision_row.project_id
    OR NEW.assignment_id IS DISTINCT FROM option_revision_row.assignment_id
    OR NEW.schema_id IS DISTINCT FROM option_revision_row.schema_id
    OR NEW.container_id IS DISTINCT FROM option_revision_row.container_id
    OR NEW.environment_id IS DISTINCT FROM option_revision_row.environment_id
    OR NEW.profile_id IS DISTINCT FROM option_revision_row.profile_id
    OR NEW.profile_name IS DISTINCT FROM option_revision_row.profile_name
    OR NEW.profile_retired_at IS NOT NULL
    OR NEW.lineage_id IS DISTINCT FROM option_revision_row.lineage_id
    OR NEW.identity_state IS DISTINCT FROM option_revision_row.identity_state
    OR NEW.observation_digest IS DISTINCT FROM option_revision_row.observation_digest
    OR NEW.observed_at IS DISTINCT FROM option_revision_row.observed_at
    OR NEW.stream_id IS DISTINCT FROM option_revision_row.stream_id
    OR NEW.stream_state IS DISTINCT FROM option_revision_row.stream_state
    OR NEW.migration_namespace IS DISTINCT FROM option_revision_row.migration_namespace
    OR NEW.exact_owner IS DISTINCT FROM option_revision_row.exact_owner
    OR NEW.route_id IS DISTINCT FROM option_revision_row.route_id
    OR NEW.route_config_revision IS DISTINCT FROM option_revision_row.route_config_revision
    OR NEW.route_alias IS DISTINCT FROM option_revision_row.route_alias
    OR NEW.policy_id IS DISTINCT FROM option_revision_row.policy_id
    OR NEW.policy_revision IS DISTINCT FROM option_revision_row.policy_revision
    OR NEW.deployment_principal_id IS DISTINCT FROM option_revision_row.deployment_principal_id
    OR NEW.principal_purpose IS DISTINCT FROM option_revision_row.principal_purpose
    OR NEW.private_principal_ref IS DISTINCT FROM option_revision_row.private_principal_ref
    OR NEW.principal_alias IS DISTINCT FROM option_revision_row.principal_alias THEN
    RAISE EXCEPTION 'binding facts do not match the configured target option'
      USING ERRCODE='23503', CONSTRAINT='sf_target_binding_revision_option_match';
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION sf_guard_target_pointer_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id THEN
      RAISE EXCEPTION 'target identity is immutable';
    END IF;
    IF TG_TABLE_NAME='sf_target_options' THEN
      IF NEW.schema_id IS DISTINCT FROM OLD.schema_id OR NEW.container_id IS DISTINCT FROM OLD.container_id THEN
        RAISE EXCEPTION 'target identity is immutable';
      END IF;
    ELSIF TG_TABLE_NAME='sf_target_bindings' THEN
      IF NEW.environment_id IS DISTINCT FROM OLD.environment_id THEN
        RAISE EXCEPTION 'target identity is immutable';
      END IF;
    END IF;
    RETURN NEW;
  END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_target_option_revisions_immutable') THEN
    CREATE TRIGGER sf_target_option_revisions_immutable BEFORE UPDATE OR DELETE ON sf_target_option_revisions
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_target_binding_revisions_immutable') THEN
    CREATE TRIGGER sf_target_binding_revisions_immutable BEFORE UPDATE OR DELETE ON sf_target_binding_revisions
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_target_binding_option_match') THEN
    CREATE TRIGGER sf_target_binding_option_match BEFORE INSERT ON sf_target_binding_revisions
      FOR EACH ROW EXECUTE FUNCTION sf_check_target_binding_option_match();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_target_lineages_immutable') THEN
    CREATE TRIGGER sf_target_lineages_immutable BEFORE UPDATE OR DELETE ON sf_target_lineages
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_target_streams_immutable') THEN
    CREATE TRIGGER sf_target_streams_immutable BEFORE UPDATE OR DELETE ON sf_target_streams
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_target_options_identity_guard') THEN
    CREATE TRIGGER sf_target_options_identity_guard BEFORE UPDATE OR DELETE ON sf_target_options
      FOR EACH ROW EXECUTE FUNCTION sf_guard_target_pointer_mutation();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_target_bindings_identity_guard') THEN
    CREATE TRIGGER sf_target_bindings_identity_guard BEFORE UPDATE OR DELETE ON sf_target_bindings
      FOR EACH ROW EXECUTE FUNCTION sf_guard_target_pointer_mutation();
  END IF;
END $$;
`;

/** Apply target metadata inside the caller's initialization transaction. */
export async function initializeTargetSchema(tx: any): Promise<void> {
  await tx`SELECT pg_advisory_xact_lock(1397112658, 27)`;
  await tx.unsafe(TARGET_SCHEMA_SQL);
}
