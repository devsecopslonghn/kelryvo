export const IDENTITY_TABLES = ['sf_identity_admin_grants','sf_identity_providers','sf_identity_provider_revisions','sf_external_identities','sf_external_session_roots','sf_identity_audit','sf_oidc_attempts'];
export const IDENTITY_TRIGGERS = ['sf_identity_provider_revisions_immutable','sf_external_session_roots_immutable','sf_identity_audit_immutable'];
export async function initializeIdentitySchema(tx: any) {
  await tx.unsafe(`
    DO $$ BEGIN IF position('EXTERNAL' in (SELECT pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid='sf_local_credentials'::regclass AND conname='sf_local_credentials_lifetime'))=0 THEN
      ALTER TABLE sf_local_credentials DROP CONSTRAINT sf_local_credentials_lifetime;
      ALTER TABLE sf_local_credentials ADD CONSTRAINT sf_local_credentials_lifetime CHECK (
        (credential_kind IN ('LOCAL','PASSWORD','EXTERNAL') AND parent_credential_id IS NULL AND absolute_expires_at IS NULL
          AND expires_at=issued_at+interval '24 hours') OR
        (credential_kind='BROWSER' AND parent_credential_id IS NOT NULL AND absolute_expires_at IS NOT NULL
          AND absolute_expires_at>issued_at AND absolute_expires_at<=issued_at+interval '8 hours'
          AND expires_at>issued_at AND expires_at<=absolute_expires_at));
    END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_identity_admin_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id text NOT NULL REFERENCES sf_local_actors(id),
      granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz,
      grant_os_uid integer NOT NULL CHECK(grant_os_uid>=0),revoke_os_uid integer,
      CHECK((revoked_at IS NULL AND revoke_os_uid IS NULL) OR (revoked_at IS NOT NULL AND revoke_os_uid>=0))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_identity_admin_active ON sf_identity_admin_grants(actor_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_identity_providers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
      kind text NOT NULL CHECK(kind IN ('OIDC','LDAP')),enabled boolean NOT NULL DEFAULT false,
      revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),config jsonb NOT NULL,
      created_by text NOT NULL REFERENCES sf_local_actors(id),updated_by text NOT NULL REFERENCES sf_local_actors(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS sf_identity_provider_revisions (
      provider_id uuid NOT NULL REFERENCES sf_identity_providers(id),revision bigint NOT NULL CHECK(revision>0),
      name text NOT NULL,kind text NOT NULL CHECK(kind IN ('OIDC','LDAP')),enabled boolean NOT NULL,config jsonb NOT NULL,
      actor_id text NOT NULL REFERENCES sf_local_actors(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(provider_id,revision)
    );
    CREATE TABLE IF NOT EXISTS sf_external_identities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),provider_id uuid NOT NULL REFERENCES sf_identity_providers(id),
      subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 512),actor_id text NOT NULL REFERENCES sf_local_actors(id),
      anchor_credential_id uuid NOT NULL,created_by text NOT NULL REFERENCES sf_local_actors(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),revoked_at timestamptz,revoked_by text REFERENCES sf_local_actors(id),
      FOREIGN KEY(anchor_credential_id,actor_id) REFERENCES sf_local_credentials(id,actor_id),
      UNIQUE(id,actor_id),UNIQUE(id,provider_id),CHECK((revoked_at IS NULL)=(revoked_by IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_external_identity_active ON sf_external_identities(provider_id,subject) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_external_session_roots (
      credential_id uuid PRIMARY KEY,actor_id text NOT NULL,provider_id uuid NOT NULL,provider_revision bigint NOT NULL,
      mapping_id uuid NOT NULL,generation_id uuid NOT NULL REFERENCES sf_metadata_generations(id),
      FOREIGN KEY(credential_id,actor_id) REFERENCES sf_local_credentials(id,actor_id),
      FOREIGN KEY(mapping_id,actor_id) REFERENCES sf_external_identities(id,actor_id),
      FOREIGN KEY(mapping_id,provider_id) REFERENCES sf_external_identities(id,provider_id),
      FOREIGN KEY(provider_id,provider_revision) REFERENCES sf_identity_provider_revisions(provider_id,revision)
    );
    CREATE TABLE IF NOT EXISTS sf_identity_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id text REFERENCES sf_local_actors(id),
      action text NOT NULL,provider_id uuid REFERENCES sf_identity_providers(id),facts jsonb NOT NULL DEFAULT '{}'::jsonb,
      operator_os_uid integer,occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS sf_oidc_attempts (
      state_sha256 text PRIMARY KEY CHECK(state_sha256 ~ '^[a-f0-9]{64}$'),
      provider_id uuid NOT NULL,provider_revision bigint NOT NULL,generation_id uuid NOT NULL REFERENCES sf_metadata_generations(id),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,consumed_at timestamptz,
      FOREIGN KEY(provider_id,provider_revision) REFERENCES sf_identity_provider_revisions(provider_id,revision),
      CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes')
    );
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_identity_provider_revisions_immutable') THEN
        CREATE TRIGGER sf_identity_provider_revisions_immutable BEFORE UPDATE OR DELETE ON sf_identity_provider_revisions
          FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_external_session_roots_immutable') THEN
        CREATE TRIGGER sf_external_session_roots_immutable BEFORE UPDATE OR DELETE ON sf_external_session_roots
          FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
      END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_identity_audit_immutable') THEN
        CREATE TRIGGER sf_identity_audit_immutable BEFORE UPDATE OR DELETE ON sf_identity_audit
          FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
      END IF;
    END $$;
  `);
}
