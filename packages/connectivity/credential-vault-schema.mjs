export const ORACLE_VAULT_TABLES = ['sf_oracle_credentials', 'sf_oracle_credential_revocations'];
export const ORACLE_VAULT_TRIGGERS = ['sf_oracle_credentials_immutable', 'sf_oracle_credential_revocations_immutable'];
export async function initializeOracleVaultSchema(tx) {
  await tx.unsafe(`
    CREATE TABLE IF NOT EXISTS sf_oracle_credentials (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      connection_id uuid NOT NULL REFERENCES sf_database_connections(id),
      username text NOT NULL CHECK(username ~ '^[A-Za-z][A-Za-z0-9_$#]{0,127}$'),
      purpose text NOT NULL CHECK(purpose IN ('INSTANCE_MASTER','DEPLOY','OBSERVER','LEDGER')),
      key_id text NOT NULL CHECK(key_id ~ '^[a-f0-9]{64}$'), envelope jsonb NOT NULL,
      endpoint_digest text NOT NULL CHECK(endpoint_digest ~ '^[a-f0-9]{64}$'),
      actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CHECK(jsonb_typeof(envelope)='object' AND octet_length(envelope::text) <= 16384),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id),
      UNIQUE(id,organization_id,connection_id), UNIQUE(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_oracle_credential_revocations (
      credential_id uuid PRIMARY KEY REFERENCES sf_oracle_credentials(id),
      organization_id uuid NOT NULL, actor_id text NOT NULL,
      FOREIGN KEY(credential_id,organization_id) REFERENCES sf_oracle_credentials(id,organization_id),
      reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 1 AND 500),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_oracle_credentials_immutable') THEN
        CREATE TRIGGER sf_oracle_credentials_immutable BEFORE UPDATE OR DELETE ON sf_oracle_credentials
          FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_oracle_credential_revocations_immutable') THEN
        CREATE TRIGGER sf_oracle_credential_revocations_immutable BEFORE UPDATE OR DELETE ON sf_oracle_credential_revocations
          FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
      END IF;
    END $$;
  `);
}
