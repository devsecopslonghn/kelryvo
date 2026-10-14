export const MANAGEMENT_TABLES = ['sf_connection_revisions','sf_connection_preflights','sf_connection_plan_revisions'];
export const MANAGEMENT_FUNCTIONS = ['sf_capture_connection_revision','sf_advance_connection_revision','sf_capture_plan_connection_revision'];
export const MANAGEMENT_TRIGGERS = ['sf_profiles_revision_guard','sf_profiles_revision_capture','sf_database_connections_revision_capture',
  'sf_plans_connection_revision_capture','sf_connection_revisions_immutable','sf_connection_preflights_immutable','sf_connection_plan_revisions_immutable'];

/** Additive migration. Old backup schemas can still be initialized before upgrade. */
export async function initializeConnectionManagement(tx) {
  for (const table of ['sf_profiles','sf_database_connections']) {
    await tx.unsafe(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK(length(description)<=2000);
      ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS service_kind text NOT NULL DEFAULT 'SERVICE_NAME' CHECK(service_kind IN ('SERVICE_NAME','SID'));`);
  }
  await tx.unsafe(`
    ALTER TABLE sf_target_option_revisions ADD COLUMN IF NOT EXISTS profile_revision bigint NOT NULL DEFAULT 1 CHECK(profile_revision>0);
    ALTER TABLE sf_database_observations ADD COLUMN IF NOT EXISTS connection_revision bigint NOT NULL DEFAULT 1 CHECK(connection_revision>0);
    CREATE TABLE IF NOT EXISTS sf_connection_revisions (
      kind text NOT NULL CHECK(kind IN ('DEPLOY','DISCOVERY')), resource_id uuid NOT NULL,
      revision bigint NOT NULL CHECK(revision>0), configuration jsonb NOT NULL CHECK(jsonb_typeof(configuration)='object'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(kind,resource_id,revision)
    );
    CREATE TABLE IF NOT EXISTS sf_connection_preflights (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),kind text NOT NULL,resource_id uuid NOT NULL,revision bigint NOT NULL,
      state text NOT NULL CHECK(state IN ('PREFLIGHT_PASSED','FAILED')),checks jsonb NOT NULL,
      actor_id text NOT NULL REFERENCES sf_local_actors(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(kind,resource_id,revision) REFERENCES sf_connection_revisions(kind,resource_id,revision)
    );
    CREATE TABLE IF NOT EXISTS sf_connection_plan_revisions (
      plan_id uuid PRIMARY KEY REFERENCES sf_plans(id),profile_id uuid NOT NULL,revision bigint NOT NULL,
      kind text NOT NULL DEFAULT 'DEPLOY' CHECK(kind='DEPLOY'),
      FOREIGN KEY(kind,profile_id,revision) REFERENCES sf_connection_revisions(kind,resource_id,revision)
    );
    CREATE OR REPLACE FUNCTION sf_advance_connection_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' THEN RAISE EXCEPTION 'connection history must be retained'; END IF;
      IF OLD.retired_at IS NOT NULL THEN RAISE EXCEPTION 'retired connection is immutable'; END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'connection ownership is immutable'; END IF;
      NEW.revision := OLD.revision+1;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION sf_guard_database_connection_config() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP='DELETE' OR OLD.retired_at IS NOT NULL THEN RAISE EXCEPTION 'retired connection is immutable'; END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
        OR NEW.container_id IS DISTINCT FROM OLD.container_id OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.revision IS DISTINCT FROM OLD.revision+1 THEN
        -- Compatibility retirement still advances the revision through the established endpoint.
        IF NEW.retired_at IS NOT NULL AND NEW.retirement_reason IS NOT NULL
          AND (to_jsonb(NEW)-'retired_at'-'retirement_reason')=(to_jsonb(OLD)-'retired_at'-'retirement_reason') THEN
          NEW.revision := OLD.revision+1;
        ELSE RAISE EXCEPTION 'connection revision required'; END IF;
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION sf_capture_connection_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO sf_connection_revisions(kind,resource_id,revision,configuration)
        VALUES(CASE WHEN TG_TABLE_NAME='sf_profiles' THEN 'DEPLOY' ELSE 'DISCOVERY' END,NEW.id,NEW.revision,
          to_jsonb(NEW)||jsonb_build_object('revision',NEW.revision::text));
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION sf_capture_plan_connection_revision() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO sf_connection_plan_revisions(plan_id,profile_id,revision)
        SELECT NEW.id,p.id,p.revision FROM sf_profiles p WHERE p.id=NEW.profile_id;
      RETURN NEW;
    END $$;
    INSERT INTO sf_connection_revisions(kind,resource_id,revision,configuration)
      SELECT 'DEPLOY',id,revision,to_jsonb(p)||jsonb_build_object('revision',revision::text) FROM sf_profiles p ON CONFLICT DO NOTHING;
    INSERT INTO sf_connection_revisions(kind,resource_id,revision,configuration)
      SELECT 'DISCOVERY',id,revision,to_jsonb(c)||jsonb_build_object('revision',revision::text) FROM sf_database_connections c ON CONFLICT DO NOTHING;
    INSERT INTO sf_connection_plan_revisions(plan_id,profile_id,revision)
      SELECT p.id,c.id,c.revision FROM sf_plans p JOIN sf_profiles c ON c.id=p.profile_id ON CONFLICT DO NOTHING;
  `);
  for (const [name,table,event,fn] of [
    ['sf_profiles_revision_guard','sf_profiles','BEFORE UPDATE OR DELETE','sf_advance_connection_revision'],
    ['sf_profiles_revision_capture','sf_profiles','AFTER INSERT OR UPDATE','sf_capture_connection_revision'],
    ['sf_database_connections_revision_capture','sf_database_connections','AFTER INSERT OR UPDATE','sf_capture_connection_revision'],
    ['sf_plans_connection_revision_capture','sf_plans','AFTER INSERT','sf_capture_plan_connection_revision'],
  ]) await tx.unsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='${name}') THEN
    CREATE TRIGGER ${name} ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}(); END IF; END $$;`);
  for (const table of MANAGEMENT_TABLES) await tx.unsafe(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='${table}_immutable') THEN
    CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;`);
}
