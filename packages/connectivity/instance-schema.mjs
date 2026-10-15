/** Additive instance master credential metadata. */
export const INSTANCE_TABLES = ['sf_instance_profile_sources'];
export const INSTANCE_FUNCTIONS = ['sf_reject_instance_profile_source_mutation','sf_reject_connection_credential_mode_change'];
export const INSTANCE_TRIGGERS = ['sf_database_connections_credential_mode_immutable','sf_instance_profile_sources_immutable'];

export async function initializeInstanceSchema(tx) {
  await tx.unsafe(`
    ALTER TABLE sf_database_connections ADD COLUMN IF NOT EXISTS credential_mode text NOT NULL DEFAULT 'LEGACY_SEPARATE';
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sf_database_connections_credential_mode') THEN
        ALTER TABLE sf_database_connections ADD CONSTRAINT sf_database_connections_credential_mode
          CHECK(credential_mode IN ('LEGACY_SEPARATE','INSTANCE_MASTER'));
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS sf_database_connections_one_instance_master
      ON sf_database_connections(organization_id,container_id)
      WHERE retired_at IS NULL AND credential_mode='INSTANCE_MASTER';
    CREATE TABLE IF NOT EXISTS sf_instance_profile_sources (
      profile_id uuid PRIMARY KEY REFERENCES sf_profiles(id),
      connection_id uuid NOT NULL REFERENCES sf_database_connections(id),
      connection_revision bigint NOT NULL,
      kind text NOT NULL DEFAULT 'DISCOVERY' CHECK(kind='DISCOVERY'),
      FOREIGN KEY(kind,connection_id,connection_revision)
        REFERENCES sf_connection_revisions(kind,resource_id,revision)
    );
    CREATE OR REPLACE FUNCTION sf_reject_instance_profile_source_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'instance profile source evidence is immutable'; END $$;
    CREATE OR REPLACE FUNCTION sf_reject_connection_credential_mode_change() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.credential_mode IS DISTINCT FROM OLD.credential_mode THEN
          RAISE EXCEPTION 'connection credential mode is immutable';
        END IF;
        RETURN NEW;
      END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_instance_profile_sources_immutable') THEN
      CREATE TRIGGER sf_instance_profile_sources_immutable BEFORE UPDATE OR DELETE ON sf_instance_profile_sources
        FOR EACH ROW EXECUTE FUNCTION sf_reject_instance_profile_source_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_database_connections_credential_mode_immutable') THEN
      CREATE TRIGGER sf_database_connections_credential_mode_immutable BEFORE UPDATE OF credential_mode ON sf_database_connections
        FOR EACH ROW EXECUTE FUNCTION sf_reject_connection_credential_mode_change(); END IF; END $$;
  `);
}
