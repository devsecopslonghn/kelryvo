-- Native bootstrap with retained historical metadata compatibility.
-- Keep additive changes aligned with backup profiles and schema contract tests.
SELECT pg_advisory_xact_lock(1397112658, 1);

CREATE TABLE IF NOT EXISTS sf_metadata_generations (
      id uuid PRIMARY KEY, predecessor_id uuid REFERENCES sf_metadata_generations(id),
      state text NOT NULL CHECK(state IN ('ACTIVE','RESTORE_HOLD')),
      checkpoint text NOT NULL CHECK(checkpoint ~ '^[a-f0-9]{64}$'),
      witness_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      operator_os_uid integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sf_metadata_current (
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      generation_id uuid NOT NULL REFERENCES sf_metadata_generations(id)
    );
    CREATE TABLE IF NOT EXISTS sf_metadata_operator_audit (
      id uuid PRIMARY KEY, action text NOT NULL CHECK(action IN ('INITIALIZE','RESTORE_HOLD','CREDENTIAL_REVOKE')),
      generation_id uuid NOT NULL REFERENCES sf_metadata_generations(id),
      witness_id uuid, credential_id uuid, credential_digest text,
      operator_os_uid integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS sf_metadata_credentials_revoked (
      credential_id uuid PRIMARY KEY, token_sha256 text NOT NULL CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
      generation_id uuid NOT NULL REFERENCES sf_metadata_generations(id), revoked_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS sf_metadata_restore_owners (
      id uuid PRIMARY KEY, operator_os_uid integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE OR REPLACE FUNCTION sf_reject_metadata_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'metadata recovery evidence is immutable'; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_metadata_generations_immutable') THEN
      CREATE TRIGGER sf_metadata_generations_immutable BEFORE UPDATE OR DELETE ON sf_metadata_generations
      FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_metadata_operator_audit_immutable') THEN
      CREATE TRIGGER sf_metadata_operator_audit_immutable BEFORE UPDATE OR DELETE ON sf_metadata_operator_audit
      FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_metadata_credentials_revoked_immutable') THEN
      CREATE TRIGGER sf_metadata_credentials_revoked_immutable BEFORE UPDATE OR DELETE ON sf_metadata_credentials_revoked
      FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_metadata_restore_owners_immutable') THEN
      CREATE TRIGGER sf_metadata_restore_owners_immutable BEFORE UPDATE OR DELETE ON sf_metadata_restore_owners
      FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation(); END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_organizations (id uuid PRIMARY KEY, name text NOT NULL);
    INSERT INTO sf_organizations (id,name) VALUES ('00000000-0000-4000-8000-000000000001','Local organization') ON CONFLICT (id) DO NOTHING;
    CREATE TABLE IF NOT EXISTS sf_local_actors (
      id text PRIMARY KEY, organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      role text NOT NULL CHECK(role IN ('developer','approver')), display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_local_actors_org_identity ON sf_local_actors(id,organization_id);
    CREATE TABLE IF NOT EXISTS sf_local_credentials (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL REFERENCES sf_local_actors(id),
      token_sha256 text NOT NULL UNIQUE CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
      issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz,
      CHECK(expires_at = issued_at + interval '24 hours')
    );
    ALTER TABLE sf_local_credentials ADD COLUMN IF NOT EXISTS credential_kind text NOT NULL DEFAULT 'LOCAL';
    ALTER TABLE sf_local_credentials ADD COLUMN IF NOT EXISTS parent_credential_id uuid;
    ALTER TABLE sf_local_credentials ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;
    ALTER TABLE sf_local_credentials DROP CONSTRAINT IF EXISTS sf_local_credentials_check;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sf_local_credentials_lifetime') THEN
      ALTER TABLE sf_local_credentials ADD CONSTRAINT sf_local_credentials_lifetime CHECK (
        (credential_kind='LOCAL' AND parent_credential_id IS NULL AND absolute_expires_at IS NULL
          AND expires_at=issued_at+interval '24 hours') OR
        (credential_kind='BROWSER' AND parent_credential_id IS NOT NULL AND absolute_expires_at IS NOT NULL
          AND absolute_expires_at>issued_at AND absolute_expires_at<=issued_at+interval '8 hours'
          AND expires_at>issued_at AND expires_at<=absolute_expires_at));
    END IF; END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS sf_local_credentials_id_actor ON sf_local_credentials(id,actor_id);
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sf_local_credentials_parent') THEN
      ALTER TABLE sf_local_credentials ADD CONSTRAINT sf_local_credentials_parent
        FOREIGN KEY(parent_credential_id,actor_id) REFERENCES sf_local_credentials(id,actor_id);
    END IF; END $$;
    CREATE INDEX IF NOT EXISTS sf_local_credentials_actor_active ON sf_local_credentials(actor_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_account_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      actor_id text NOT NULL, session_id uuid NOT NULL REFERENCES sf_local_credentials(id),
      action text NOT NULL CHECK(action='SESSION_REVOKED'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_account_audit_immutable') THEN
      CREATE TRIGGER sf_account_audit_immutable BEFORE UPDATE OR DELETE ON sf_account_audit
      FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation(); END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      name text NOT NULL, description text,
      source_repository_id text, source_folder text, source_updated_at timestamptz,
      source_binding_generation bigint NOT NULL DEFAULT 1,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_project_access_mode (
      organization_id uuid PRIMARY KEY REFERENCES sf_organizations(id),
      mode text NOT NULL CHECK (mode IN ('BOOTSTRAP_REQUIRED','ENFORCED')),
      activated_at timestamptz, activated_by_os_uid integer,
      CHECK ((mode='BOOTSTRAP_REQUIRED' AND activated_at IS NULL AND activated_by_os_uid IS NULL)
        OR (mode='ENFORCED' AND activated_at IS NOT NULL AND activated_by_os_uid IS NOT NULL))
    );
    INSERT INTO sf_project_access_mode(organization_id,mode) VALUES
      ('00000000-0000-4000-8000-000000000001','BOOTSTRAP_REQUIRED') ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS sf_project_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      project_id uuid NOT NULL, actor_id text NOT NULL,
      granted_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz,
      grant_os_uid integer NOT NULL, revoke_os_uid integer,
      CHECK ((revoked_at IS NULL AND revoke_os_uid IS NULL) OR (revoked_at IS NOT NULL AND revoke_os_uid IS NOT NULL)),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_project_grants_active ON sf_project_grants(project_id,actor_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_project_operator_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      project_id uuid, actor_id text,
      action text NOT NULL CHECK(action IN ('GRANT','REVOKE','ACTIVATE','DEPLOY_GRANT','DEPLOY_REVOKE')),
      operator_os_uid integer NOT NULL, facts jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
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
    ALTER TABLE sf_profiles ADD COLUMN IF NOT EXISTS retired_at timestamptz;
    ALTER TABLE sf_profiles ADD COLUMN IF NOT EXISTS retired_by text;
    ALTER TABLE sf_profiles ADD COLUMN IF NOT EXISTS retirement_reason text;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sf_profiles_retirement') THEN
      ALTER TABLE sf_profiles ADD CONSTRAINT sf_profiles_retirement CHECK (
        (retired_at IS NULL AND retired_by IS NULL AND retirement_reason IS NULL) OR
        (retired_at IS NOT NULL AND retired_by IS NOT NULL AND retirement_reason IS NOT NULL
          AND char_length(btrim(retirement_reason)) BETWEEN 1 AND 2000));
    END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_plans (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, organization_id uuid NOT NULL,
      release_id uuid NOT NULL, profile_id uuid NOT NULL, author_id text NOT NULL, status text NOT NULL DEFAULT 'PENDING_APPROVAL',
      decision text, decision_reason text, decided_by text, created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
      items jsonb NOT NULL, execution text NOT NULL DEFAULT 'NOT_EXECUTED', history_status text NOT NULL DEFAULT 'NOT_OBSERVED',
      planning_scope text NOT NULL DEFAULT 'OFFLINE_CANDIDATE',
      offline_intent_envelope text,
      offline_intent_digest text CHECK (offline_intent_digest IS NULL OR offline_intent_digest ~ '^[a-f0-9]{64}$'),
      approval_reference uuid,
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(release_id,project_id) REFERENCES sf_releases(id,project_id),
      FOREIGN KEY(profile_id,project_id) REFERENCES sf_profiles(id,project_id), UNIQUE(id,project_id)
    );
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS approval_reference uuid;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_plans'::regclass AND conname='sf_plans_approval_reference_scope') THEN
        ALTER TABLE sf_plans ADD CONSTRAINT sf_plans_approval_reference_scope UNIQUE(id,organization_id,approval_reference);
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS sf_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, organization_id uuid NOT NULL,
      actor_id text NOT NULL, action text NOT NULL, resource_id uuid, facts jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_plan_approval_revocations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      project_id uuid NOT NULL, plan_id uuid NOT NULL, approval_reference uuid,
      actor_id text NOT NULL, actor_name text NOT NULL,
      reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000 AND octet_length(reason) <= 8000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id),
      UNIQUE(plan_id,organization_id)
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_plan_approval_revocations'::regclass AND conname='sf_revocations_approval_reference_link') THEN
        ALTER TABLE sf_plan_approval_revocations ADD CONSTRAINT sf_revocations_approval_reference_link
          FOREIGN KEY(plan_id,organization_id,approval_reference) REFERENCES sf_plans(id,organization_id,approval_reference);
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_plan_approval_revocations'::regclass AND conname='sf_revocations_actor_scope') THEN
        ALTER TABLE sf_plan_approval_revocations ADD CONSTRAINT sf_revocations_actor_scope
          FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id);
      END IF;
    END $$;
    CREATE OR REPLACE FUNCTION sf_check_approval_revocation_reference() RETURNS trigger LANGUAGE plpgsql AS $function$
      DECLARE current_reference uuid;
      BEGIN
        SELECT approval_reference INTO current_reference FROM sf_plans
          WHERE id=NEW.plan_id AND organization_id=NEW.organization_id;
        IF current_reference IS DISTINCT FROM NEW.approval_reference THEN
          RAISE EXCEPTION 'approval revocation reference does not match its plan';
        END IF;
        RETURN NEW;
      END
    $function$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_plan_approval_revocations_reference_match') THEN
        CREATE TRIGGER sf_plan_approval_revocations_reference_match BEFORE INSERT
          ON sf_plan_approval_revocations FOR EACH ROW EXECUTE FUNCTION sf_check_approval_revocation_reference();
      END IF;
    END $$;
    DO $ddl$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_plan_approval_revocations_immutable') THEN
        CREATE OR REPLACE FUNCTION sf_reject_approval_revocation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'approval revocations are immutable'; END $$;
        CREATE TRIGGER sf_plan_approval_revocations_immutable BEFORE UPDATE OR DELETE
          ON sf_plan_approval_revocations FOR EACH ROW EXECUTE FUNCTION sf_reject_approval_revocation_mutation();
      END IF;
    END $ddl$;
    CREATE TABLE IF NOT EXISTS sf_plan_comments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), position bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
      project_id uuid NOT NULL, organization_id uuid NOT NULL, plan_id uuid NOT NULL,
      author_id text NOT NULL, author_name text NOT NULL,
      body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000 AND octet_length(body) <= 16000),
      evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (CASE WHEN jsonb_typeof(evidence_refs) = 'array' THEN jsonb_array_length(evidence_refs) <= 8 AND octet_length(evidence_refs::text) <= 49152 ELSE false END),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id)
    );
    CREATE TABLE IF NOT EXISTS sf_history (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id uuid NOT NULL, plan_id uuid NOT NULL, version text NOT NULL,
      path text NOT NULL, sha256 text NOT NULL, status text NOT NULL CHECK(status='NOT_EXECUTED'), created_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id)
    );
    CREATE TABLE IF NOT EXISTS sf_reference_databases (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES sf_organizations(id),
      operator_key text COLLATE "C" NOT NULL CHECK(length(operator_key) BETWEEN 1 AND 100), display_label text NOT NULL CHECK(length(display_label) BETWEEN 1 AND 120), server_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
      generation bigint NOT NULL DEFAULT 1 CHECK(generation=1), provenance text NOT NULL DEFAULT 'MANUAL_REFERENCE' CHECK(provenance='MANUAL_REFERENCE'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(organization_id,operator_key), UNIQUE(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_reference_containers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, database_id uuid NOT NULL,
      registration_key text COLLATE "C" NOT NULL CHECK(length(registration_key) BETWEEN 1 AND 100), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), kind text NOT NULL CHECK(kind IN ('PDB','NON_CDB')),
      environment text NOT NULL CHECK(environment IN ('DEV','SIT','UAT','PROD')), server_uuid uuid NOT NULL DEFAULT gen_random_uuid(),
      generation bigint NOT NULL DEFAULT 1 CHECK(generation=1), provenance text NOT NULL DEFAULT 'MANUAL_REFERENCE' CHECK(provenance='MANUAL_REFERENCE'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(database_id,registration_key), UNIQUE(id,organization_id),
      FOREIGN KEY(database_id,organization_id) REFERENCES sf_reference_databases(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_reference_services (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, container_id uuid NOT NULL,
      host text NOT NULL CHECK(length(host) BETWEEN 1 AND 253 AND host=lower(host)), port integer NOT NULL CHECK(port BETWEEN 1 AND 65535), service text COLLATE "C" NOT NULL CHECK(length(service) BETWEEN 1 AND 128), transport text NOT NULL CHECK(transport IN ('TCP','TCPS')),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(organization_id,host,port,service,transport),
      UNIQUE(id,organization_id), FOREIGN KEY(container_id,organization_id) REFERENCES sf_reference_containers(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_reference_schemas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, container_id uuid NOT NULL,
      exact_owner text COLLATE "C" NOT NULL CHECK(length(exact_owner) BETWEEN 1 AND 128 AND btrim(exact_owner)<>''), generation bigint NOT NULL DEFAULT 1 CHECK(generation=1),
      provenance text NOT NULL DEFAULT 'MANUAL_REFERENCE' CHECK(provenance='MANUAL_REFERENCE'),
      revision bigint NOT NULL DEFAULT 0 CHECK(revision>=0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(container_id,exact_owner,generation), UNIQUE(id,organization_id),
      FOREIGN KEY(container_id,organization_id) REFERENCES sf_reference_containers(id,organization_id)
    );
    CREATE TABLE IF NOT EXISTS sf_reference_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, schema_id uuid NOT NULL,
      project_id uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT clock_timestamp(), closed_at timestamptz,
      reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), operator_os_uid integer NOT NULL,
      FOREIGN KEY(schema_id,organization_id) REFERENCES sf_reference_schemas(id,organization_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      CONSTRAINT sf_reference_assignments_identity_scope UNIQUE(id,organization_id,project_id)
    );
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_reference_assignments'::regclass AND conname='sf_reference_assignments_identity_scope') THEN
        ALTER TABLE sf_reference_assignments ADD CONSTRAINT sf_reference_assignments_identity_scope UNIQUE(id,organization_id,project_id);
      END IF;
    END $$;
    CREATE UNIQUE INDEX IF NOT EXISTS sf_reference_assignments_active ON sf_reference_assignments(schema_id) WHERE closed_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_reference_operator_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, schema_id uuid NOT NULL,
      action text NOT NULL CHECK(action IN ('REGISTER','ASSIGN','TRANSFER','RELEASE')), operator_os_uid integer NOT NULL,
      facts jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(schema_id,organization_id) REFERENCES sf_reference_schemas(id,organization_id)
    );
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_repository_id text;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_folder text;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_updated_at timestamptz;
    ALTER TABLE sf_projects ADD COLUMN IF NOT EXISTS source_binding_generation bigint NOT NULL DEFAULT 1;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS decided_by_name text;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS approval_reference uuid;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS offline_intent_envelope text;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS offline_intent_digest text;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS source_binding_generation bigint;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS reviewer_id text;
    ALTER TABLE sf_plans ADD COLUMN IF NOT EXISTS reviewer_revision bigint NOT NULL DEFAULT 0 CHECK (reviewer_revision >= 0);
    ALTER TABLE sf_plan_comments ADD COLUMN IF NOT EXISTS evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_plan_comments'::regclass AND conname='sf_plan_comments_evidence_refs_bounded') THEN
        ALTER TABLE sf_plan_comments ADD CONSTRAINT sf_plan_comments_evidence_refs_bounded
          CHECK (CASE WHEN jsonb_typeof(evidence_refs) = 'array' THEN jsonb_array_length(evidence_refs) <= 8 AND octet_length(evidence_refs::text) <= 49152 ELSE false END);
      END IF;
    END $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_projects'::regclass AND conname='sf_projects_source_binding_complete') THEN
        ALTER TABLE sf_projects ADD CONSTRAINT sf_projects_source_binding_complete
          CHECK ((source_repository_id IS NULL AND source_folder IS NULL AND source_updated_at IS NULL)
            OR (source_repository_id IS NOT NULL AND source_folder IS NOT NULL AND source_updated_at IS NOT NULL));
      END IF;
    END $$;
    CREATE INDEX IF NOT EXISTS sf_audit_project_time ON sf_audit(project_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS sf_audit_project_time_id ON sf_audit(project_id,created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS sf_history_project_time ON sf_history(project_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS sf_comments_project_position ON sf_plan_comments(project_id,position);
    CREATE INDEX IF NOT EXISTS sf_comments_plan_position ON sf_plan_comments(plan_id,position);
    ALTER TABLE sf_project_operator_audit DROP CONSTRAINT IF EXISTS sf_project_operator_audit_action_check;
    ALTER TABLE sf_project_operator_audit ADD CONSTRAINT sf_project_operator_audit_action_check
      CHECK(action IN ('GRANT','REVOKE','ACTIVATE','DEPLOY_GRANT','DEPLOY_REVOKE'));
    CREATE TABLE IF NOT EXISTS sf_project_deploy_grants (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
      project_id uuid NOT NULL, actor_id text NOT NULL, granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      revoked_at timestamptz, grant_os_uid integer NOT NULL, revoke_os_uid integer,
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id),
      CHECK ((revoked_at IS NULL AND revoke_os_uid IS NULL) OR (revoked_at IS NOT NULL AND revoke_os_uid IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS sf_project_deploy_grants_active ON sf_project_deploy_grants(project_id,actor_id) WHERE revoked_at IS NULL;
    CREATE TABLE IF NOT EXISTS sf_execution_jobs (
      id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, plan_id uuid NOT NULL,
      approval_reference uuid NOT NULL, intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
      requester_id text NOT NULL, idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
      payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'), reason text NOT NULL,
      state text NOT NULL CHECK(state IN ('WAITING_VALIDATION','ADMITTED','CANCELLED','HOLD','NOOP','VERIFIED_SUCCESS')),
      admission_scope text NOT NULL DEFAULT 'PRODUCT_REQUEST' CHECK(admission_scope IN ('PRODUCT_REQUEST','TRUSTED_VALIDATED','UNIT_SYNTHETIC')),
      admission_statement_count integer CHECK(admission_statement_count IS NULL OR admission_statement_count BETWEEN 0 AND 100000),
      readiness text NOT NULL CHECK(readiness='TARGET_HISTORY_UNAVAILABLE'), revision bigint NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(organization_id,requester_id,idempotency_key), UNIQUE(id,project_id), UNIQUE(id,organization_id,project_id),
      FOREIGN KEY(project_id,organization_id) REFERENCES sf_projects(id,organization_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id),
      FOREIGN KEY(requester_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE OR REPLACE FUNCTION sf_check_execution_job_projection() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
          OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
          OR NEW.approval_reference IS DISTINCT FROM OLD.approval_reference OR NEW.intent_digest IS DISTINCT FROM OLD.intent_digest
          OR NEW.requester_id IS DISTINCT FROM OLD.requester_id OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
          OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest OR NEW.reason IS DISTINCT FROM OLD.reason
          OR NEW.request_credential_id IS DISTINCT FROM OLD.request_credential_id
          OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
          RAISE EXCEPTION 'execution job identity is immutable';
        END IF;
        IF OLD.state='WAITING_VALIDATION' AND NEW.state='ADMITTED' THEN
          IF OLD.admission_scope<>'PRODUCT_REQUEST' OR OLD.admission_statement_count IS NOT NULL
            OR OLD.request_credential_id IS NULL OR NEW.admission_scope NOT IN ('TRUSTED_VALIDATED','UNIT_SYNTHETIC')
            OR NEW.admission_statement_count IS NULL OR NEW.readiness<>'ADMISSION_VALIDATED'
            OR NOT EXISTS(SELECT 1 FROM sf_execution_admission_proofs p
              WHERE p.job_id=OLD.id AND p.scope=NEW.admission_scope AND p.approval_reference=OLD.approval_reference
                AND p.intent_digest=OLD.intent_digest AND p.authorized_credential_id=OLD.request_credential_id
                AND p.host_binding->>'statementCount'=NEW.admission_statement_count::text) THEN
            RAISE EXCEPTION 'execution admission proof required';
          END IF;
        ELSIF NEW.admission_scope IS DISTINCT FROM OLD.admission_scope
          OR NEW.admission_statement_count IS DISTINCT FROM OLD.admission_statement_count
          OR NEW.readiness IS DISTINCT FROM OLD.readiness THEN
          RAISE EXCEPTION 'execution job identity is immutable';
        END IF;
        IF NEW.revision <> OLD.revision+1 OR NOT (
          (OLD.state='WAITING_VALIDATION' AND NEW.state IN ('ADMITTED','CANCELLED','HOLD')) OR
          (OLD.state='ADMITTED' AND NEW.state IN ('HOLD','NOOP','VERIFIED_SUCCESS'))
        ) THEN RAISE EXCEPTION 'illegal execution job projection transition'; END IF;
        RETURN NEW;
      END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_jobs_projection_guard') THEN
      CREATE TRIGGER sf_execution_jobs_projection_guard BEFORE UPDATE ON sf_execution_jobs
      FOR EACH ROW EXECUTE FUNCTION sf_check_execution_job_projection(); END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_execution_admission_proofs (
      job_id uuid PRIMARY KEY, organization_id uuid NOT NULL, project_id uuid NOT NULL, plan_id uuid NOT NULL, scope text NOT NULL CHECK(scope IN ('TRUSTED_VALIDATED','UNIT_SYNTHETIC')),
      approval_reference uuid NOT NULL, intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
      source_manifest_digest text NOT NULL CHECK(source_manifest_digest ~ '^[a-f0-9]{64}$'),
      source_binding_generation bigint NOT NULL CHECK(source_binding_generation>0), profile_id uuid NOT NULL,
      profile_facts_digest text NOT NULL CHECK(profile_facts_digest ~ '^[a-f0-9]{64}$'), profile_facts jsonb NOT NULL,
      target_assignment_id uuid, target_identity_digest text NOT NULL CHECK(target_identity_digest ~ '^[a-f0-9]{64}$'),
      history_snapshot_digest text NOT NULL CHECK(history_snapshot_digest ~ '^[a-f0-9]{64}$'),
      mutex_authority_digest text NOT NULL CHECK(mutex_authority_digest ~ '^[a-f0-9]{64}$'),
      validity_digest text NOT NULL CHECK(validity_digest ~ '^[a-f0-9]{64}$'),
      central_evidence_digest text NOT NULL CHECK(central_evidence_digest ~ '^[a-f0-9]{64}$'),
      authorized_actor_id text NOT NULL, authorized_actor_role text NOT NULL CHECK(authorized_actor_role IN ('developer','approver')),
      authorized_credential_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(job_id,organization_id,project_id) REFERENCES sf_execution_jobs(id,organization_id,project_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id),
      FOREIGN KEY(profile_id,project_id) REFERENCES sf_profiles(id,project_id),
      FOREIGN KEY(authorized_actor_id,organization_id) REFERENCES sf_local_actors(id,organization_id),
      FOREIGN KEY(authorized_credential_id,authorized_actor_id) REFERENCES sf_local_credentials(id,actor_id),
      FOREIGN KEY(target_assignment_id,organization_id,project_id) REFERENCES sf_reference_assignments(id,organization_id,project_id),
      CHECK(scope='UNIT_SYNTHETIC' OR target_assignment_id IS NOT NULL)
    );
    ALTER TABLE sf_execution_jobs ADD COLUMN IF NOT EXISTS request_credential_id uuid;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sf_execution_request_credential') THEN
      ALTER TABLE sf_execution_jobs ADD CONSTRAINT sf_execution_request_credential
        FOREIGN KEY(request_credential_id,requester_id) REFERENCES sf_local_credentials(id,actor_id);
    END IF; END $$;
    ALTER TABLE sf_execution_jobs DROP CONSTRAINT IF EXISTS sf_execution_jobs_readiness_check;
    ALTER TABLE sf_execution_jobs ADD CONSTRAINT sf_execution_jobs_readiness_check
      CHECK(readiness IN ('TARGET_HISTORY_UNAVAILABLE','ADMISSION_VALIDATED'));
    ALTER TABLE sf_execution_admission_proofs ADD COLUMN IF NOT EXISTS host_binding jsonb;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sf_execution_host_binding_bounded') THEN
      ALTER TABLE sf_execution_admission_proofs ADD CONSTRAINT sf_execution_host_binding_bounded
        CHECK(host_binding IS NULL OR (jsonb_typeof(host_binding)='object' AND octet_length(host_binding::text)<=8192));
    END IF; END $$;
    CREATE OR REPLACE FUNCTION sf_reject_execution_proof_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'execution admission proofs are immutable'; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_admission_proofs_immutable') THEN
      CREATE TRIGGER sf_execution_admission_proofs_immutable BEFORE UPDATE OR DELETE ON sf_execution_admission_proofs
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_proof_mutation(); END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_execution_job_events (
      id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES sf_execution_jobs(id), revision bigint NOT NULL,
      from_state text, to_state text NOT NULL, actor_id text NOT NULL, reason text,
      facts jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(job_id,revision)
    );
    CREATE OR REPLACE FUNCTION sf_reject_execution_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'execution job events are immutable'; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_job_events_immutable') THEN
      CREATE TRIGGER sf_execution_job_events_immutable BEFORE UPDATE OR DELETE ON sf_execution_job_events
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_event_mutation(); END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_execution_attempts (
      id uuid PRIMARY KEY, job_id uuid NOT NULL REFERENCES sf_execution_jobs(id), generation bigint NOT NULL,
      state text NOT NULL CHECK(state IN ('CLAIMED','STARTED','HOLD','NOOP','VERIFIED_SUCCESS')),
      lease_token uuid NOT NULL,
      lease_owner text NOT NULL, lease_until timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(job_id,generation), UNIQUE(id,job_id,generation)
    );
    CREATE TABLE IF NOT EXISTS sf_execution_attempt_events (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES sf_execution_attempts(id), revision bigint NOT NULL,
      phase text NOT NULL CHECK(phase IN ('CLAIMED','STARTED','ACKNOWLEDGED','VALIDITY_VERIFIED','HOLD','NOOP','VERIFIED_SUCCESS')),
      ordinal integer, statement_digest text CHECK(statement_digest IS NULL OR statement_digest ~ '^[a-f0-9]{64}$'),
      facts jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(attempt_id,revision)
    );
    CREATE INDEX IF NOT EXISTS sf_execution_jobs_waiting_queue ON sf_execution_jobs(organization_id,created_at,id)
      WHERE state='WAITING_VALIDATION';
    CREATE INDEX IF NOT EXISTS sf_execution_attempts_expiry_queue ON sf_execution_attempts(lease_until,job_id)
      WHERE state='CLAIMED';
    CREATE OR REPLACE FUNCTION sf_reject_execution_attempt_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'execution attempts cannot be deleted'; END IF;
        IF NEW.id IS DISTINCT FROM OLD.id OR NEW.job_id IS DISTINCT FROM OLD.job_id OR NEW.generation IS DISTINCT FROM OLD.generation
          OR NEW.lease_owner IS DISTINCT FROM OLD.lease_owner OR NEW.lease_token IS DISTINCT FROM OLD.lease_token
          OR NEW.lease_until IS DISTINCT FROM OLD.lease_until OR NEW.created_at IS DISTINCT FROM OLD.created_at
          OR OLD.state IS DISTINCT FROM 'CLAIMED' OR NEW.state NOT IN ('HOLD','NOOP','VERIFIED_SUCCESS') THEN
          RAISE EXCEPTION 'execution attempt identity is immutable and terminal state is one-way';
        END IF;
        RETURN NEW;
      END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_attempts_immutable') THEN
      CREATE TRIGGER sf_execution_attempts_immutable BEFORE UPDATE OR DELETE ON sf_execution_attempts
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_attempt_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_attempt_events_immutable') THEN
      CREATE TRIGGER sf_execution_attempt_events_immutable BEFORE UPDATE OR DELETE ON sf_execution_attempt_events
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_event_mutation(); END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_execution_receipts (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES sf_execution_attempts(id), job_id uuid NOT NULL REFERENCES sf_execution_jobs(id),
      generation bigint NOT NULL, ordinal integer NOT NULL CHECK(ordinal>0), statement_digest text NOT NULL CHECK(statement_digest ~ '^[a-f0-9]{64}$'),
      receipt_digest text NOT NULL CHECK(receipt_digest ~ '^[a-f0-9]{64}$'), central_evidence_digest text NOT NULL CHECK(central_evidence_digest ~ '^[a-f0-9]{64}$'),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(job_id,generation,ordinal),
      FOREIGN KEY(attempt_id,job_id,generation) REFERENCES sf_execution_attempts(id,job_id,generation)
    );
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_execution_attempts'::regclass AND conname='sf_execution_attempts_identity_scope') THEN
      ALTER TABLE sf_execution_attempts ADD CONSTRAINT sf_execution_attempts_identity_scope UNIQUE(id,job_id,generation); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='sf_execution_receipts'::regclass AND conname='sf_execution_receipts_attempt_scope') THEN
      ALTER TABLE sf_execution_receipts ADD CONSTRAINT sf_execution_receipts_attempt_scope
        FOREIGN KEY(attempt_id,job_id,generation) REFERENCES sf_execution_attempts(id,job_id,generation); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_receipts_immutable') THEN
      CREATE TRIGGER sf_execution_receipts_immutable BEFORE UPDATE OR DELETE ON sf_execution_receipts
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_event_mutation(); END IF; END $$;

CREATE TABLE IF NOT EXISTS sf_execution_reconciliations (
      id uuid PRIMARY KEY, job_id uuid NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL, plan_id uuid NOT NULL,
      approval_reference uuid NOT NULL, intent_digest text NOT NULL CHECK(intent_digest ~ '^[a-f0-9]{64}$'),
      job_revision bigint NOT NULL CHECK(job_revision>=0), admission_scope text NOT NULL CHECK(admission_scope IN ('PRODUCT_REQUEST','TRUSTED_VALIDATED','UNIT_SYNTHETIC')),
      target_identity_digest text CHECK(target_identity_digest IS NULL OR target_identity_digest ~ '^[a-f0-9]{64}$'),
      submitter_id text NOT NULL, evidence_kind text NOT NULL CHECK(evidence_kind IN ('TARGET_LEDGER','TARGET_OBSERVATION','OPERATOR_REPORT')),
      evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'), reason text NOT NULL CHECK(octet_length(reason)<=1000),
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(job_id,evidence_digest), UNIQUE(id,job_id,organization_id,project_id),
      FOREIGN KEY(job_id,organization_id,project_id) REFERENCES sf_execution_jobs(id,organization_id,project_id),
      FOREIGN KEY(plan_id,project_id) REFERENCES sf_plans(id,project_id),
      FOREIGN KEY(submitter_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE INDEX IF NOT EXISTS sf_execution_reconciliations_job ON sf_execution_reconciliations(job_id,created_at,id);
    CREATE TABLE IF NOT EXISTS sf_execution_reconciliation_decisions (
      id uuid PRIMARY KEY, reconciliation_id uuid NOT NULL, job_id uuid NOT NULL, organization_id uuid NOT NULL, project_id uuid NOT NULL,
      reviewer_id text NOT NULL, job_revision bigint NOT NULL CHECK(job_revision>=0), decision text NOT NULL CHECK(decision IN ('RETAIN_HOLD','EVIDENCE_REVIEWED')),
      reason text NOT NULL CHECK(octet_length(reason)<=1000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      UNIQUE(reconciliation_id),
      FOREIGN KEY(reconciliation_id,job_id,organization_id,project_id) REFERENCES sf_execution_reconciliations(id,job_id,organization_id,project_id),
      FOREIGN KEY(reviewer_id,organization_id) REFERENCES sf_local_actors(id,organization_id)
    );
    CREATE OR REPLACE FUNCTION sf_check_execution_reconciliation_binding() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_plan sf_plans%ROWTYPE; v_project sf_projects%ROWTYPE; v_job sf_execution_jobs%ROWTYPE;
        v_proof sf_execution_admission_proofs%ROWTYPE;
      BEGIN
        -- Match API lock order (plan, project, job) for direct inserts too.
        SELECT * INTO v_plan FROM sf_plans WHERE id=NEW.plan_id FOR SHARE;
        SELECT * INTO v_project FROM sf_projects WHERE id=NEW.project_id FOR SHARE;
        SELECT * INTO v_job FROM sf_execution_jobs WHERE id=NEW.job_id FOR SHARE;
        IF v_plan.id IS NULL OR v_project.id IS NULL OR v_job.id IS NULL
          OR v_plan.project_id IS DISTINCT FROM NEW.project_id OR v_plan.organization_id IS DISTINCT FROM NEW.organization_id
          OR v_project.organization_id IS DISTINCT FROM NEW.organization_id OR v_project.archived_at IS NOT NULL
          OR v_job.organization_id IS DISTINCT FROM NEW.organization_id OR v_job.project_id IS DISTINCT FROM NEW.project_id
          OR v_job.plan_id IS DISTINCT FROM NEW.plan_id OR v_job.approval_reference IS DISTINCT FROM NEW.approval_reference
          OR v_job.intent_digest IS DISTINCT FROM NEW.intent_digest OR v_job.revision IS DISTINCT FROM NEW.job_revision
          OR v_job.admission_scope IS DISTINCT FROM NEW.admission_scope OR v_job.state IS DISTINCT FROM 'HOLD'
          OR v_plan.approval_reference IS DISTINCT FROM NEW.approval_reference
          OR v_plan.offline_intent_digest IS DISTINCT FROM NEW.intent_digest THEN
          RAISE EXCEPTION 'execution reconciliation must match the current held job and approved plan';
        END IF;
        SELECT * INTO v_proof FROM sf_execution_admission_proofs WHERE job_id=NEW.job_id FOR SHARE;
        IF FOUND THEN
          IF v_proof.organization_id IS DISTINCT FROM NEW.organization_id OR v_proof.project_id IS DISTINCT FROM NEW.project_id
            OR v_proof.plan_id IS DISTINCT FROM NEW.plan_id OR v_proof.approval_reference IS DISTINCT FROM NEW.approval_reference
            OR v_proof.intent_digest IS DISTINCT FROM NEW.intent_digest OR v_proof.scope IS DISTINCT FROM NEW.admission_scope
            OR v_proof.target_identity_digest IS DISTINCT FROM NEW.target_identity_digest THEN
            RAISE EXCEPTION 'execution reconciliation target binding does not match admission proof';
          END IF;
        ELSIF NEW.admission_scope IS DISTINCT FROM 'PRODUCT_REQUEST' OR NEW.target_identity_digest IS NOT NULL THEN
          RAISE EXCEPTION 'execution reconciliation admission proof required';
        END IF;
        RETURN NEW;
      END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_reconciliations_binding_insert') THEN
      CREATE TRIGGER sf_execution_reconciliations_binding_insert BEFORE INSERT ON sf_execution_reconciliations
      FOR EACH ROW EXECUTE FUNCTION sf_check_execution_reconciliation_binding(); END IF; END $$;
    CREATE OR REPLACE FUNCTION sf_check_execution_reconciliation_decision_binding() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE v_submission sf_execution_reconciliations%ROWTYPE; v_plan sf_plans%ROWTYPE; v_project sf_projects%ROWTYPE;
        v_job sf_execution_jobs%ROWTYPE; v_actor sf_local_actors%ROWTYPE; v_grant sf_project_grants%ROWTYPE;
      BEGIN
        SELECT * INTO v_submission FROM sf_execution_reconciliations WHERE id=NEW.reconciliation_id;
        IF v_submission.id IS NULL THEN RAISE EXCEPTION 'execution reconciliation submission required'; END IF;
        -- Match API lock order (plan, project, job, submission).
        SELECT * INTO v_plan FROM sf_plans WHERE id=v_submission.plan_id FOR SHARE;
        SELECT * INTO v_project FROM sf_projects WHERE id=v_submission.project_id FOR SHARE;
        SELECT * INTO v_job FROM sf_execution_jobs WHERE id=NEW.job_id FOR SHARE;
        SELECT * INTO v_submission FROM sf_execution_reconciliations WHERE id=NEW.reconciliation_id FOR SHARE;
        SELECT * INTO v_actor FROM sf_local_actors WHERE id=NEW.reviewer_id AND organization_id=NEW.organization_id FOR SHARE;
        SELECT * INTO v_grant FROM sf_project_grants WHERE organization_id=NEW.organization_id
          AND project_id=NEW.project_id AND actor_id=NEW.reviewer_id AND revoked_at IS NULL FOR SHARE;
        IF v_submission.id IS NULL OR v_plan.id IS NULL OR v_project.id IS NULL OR v_job.id IS NULL OR v_actor.id IS NULL
          OR v_submission.job_id IS DISTINCT FROM NEW.job_id OR v_submission.organization_id IS DISTINCT FROM NEW.organization_id
          OR v_submission.project_id IS DISTINCT FROM NEW.project_id OR v_job.organization_id IS DISTINCT FROM NEW.organization_id
          OR v_job.project_id IS DISTINCT FROM NEW.project_id OR v_job.plan_id IS DISTINCT FROM v_submission.plan_id
          OR v_job.approval_reference IS DISTINCT FROM v_submission.approval_reference OR v_job.intent_digest IS DISTINCT FROM v_submission.intent_digest
          OR v_plan.project_id IS DISTINCT FROM NEW.project_id OR v_plan.organization_id IS DISTINCT FROM NEW.organization_id
          OR v_plan.approval_reference IS DISTINCT FROM v_submission.approval_reference
          OR v_plan.offline_intent_digest IS DISTINCT FROM v_submission.intent_digest
          OR v_project.organization_id IS DISTINCT FROM NEW.organization_id OR v_project.archived_at IS NOT NULL
          OR v_job.state IS DISTINCT FROM 'HOLD' OR v_job.revision IS DISTINCT FROM NEW.job_revision
          OR v_submission.job_revision IS DISTINCT FROM NEW.job_revision
          OR v_actor.role IS DISTINCT FROM 'approver'
          OR NEW.reviewer_id IN (v_submission.submitter_id,v_job.requester_id,v_plan.author_id)
          OR v_grant.id IS NULL THEN
          RAISE EXCEPTION 'execution reconciliation decision must independently review the current held submission';
        END IF;
        RETURN NEW;
      END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_reconciliation_decisions_binding_insert') THEN
      CREATE TRIGGER sf_execution_reconciliation_decisions_binding_insert BEFORE INSERT ON sf_execution_reconciliation_decisions
      FOR EACH ROW EXECUTE FUNCTION sf_check_execution_reconciliation_decision_binding(); END IF; END $$;
    CREATE OR REPLACE FUNCTION sf_reject_execution_reconciliation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'execution reconciliation evidence is immutable'; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_reconciliations_immutable') THEN
      CREATE TRIGGER sf_execution_reconciliations_immutable BEFORE UPDATE OR DELETE ON sf_execution_reconciliations
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_reconciliation_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_execution_reconciliation_decisions_immutable') THEN
      CREATE TRIGGER sf_execution_reconciliation_decisions_immutable BEFORE UPDATE OR DELETE ON sf_execution_reconciliation_decisions
      FOR EACH ROW EXECUTE FUNCTION sf_reject_execution_reconciliation_mutation(); END IF; END $$;

SELECT pg_advisory_xact_lock(1397112658, 27);

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
    IF NEW.current_revision <> OLD.current_revision + 1 THEN
      RAISE EXCEPTION 'target revisions must advance by one';
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

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_database_observations_immutable') THEN
      CREATE TRIGGER sf_database_observations_immutable BEFORE UPDATE OR DELETE ON sf_database_observations
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_target_identity_evidence_immutable') THEN
      CREATE TRIGGER sf_target_identity_evidence_immutable BEFORE UPDATE OR DELETE ON sf_target_identity_evidence
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_database_connection_projects_immutable') THEN
      CREATE TRIGGER sf_database_connection_projects_immutable BEFORE UPDATE OR DELETE ON sf_database_connection_projects
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_database_connection_audit_immutable') THEN
      CREATE TRIGGER sf_database_connection_audit_immutable BEFORE UPDATE OR DELETE ON sf_database_connection_audit
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;

ALTER TABLE sf_target_option_revisions DROP CONSTRAINT IF EXISTS sf_target_option_revisions_identity_state_check;
    ALTER TABLE sf_target_option_revisions ADD CONSTRAINT sf_target_option_revisions_identity_state_check CHECK(identity_state IN ('PROVISIONAL','OBSERVED','VERIFIED'));
    ALTER TABLE sf_target_option_revisions DROP CONSTRAINT IF EXISTS sf_target_option_revisions_check;
    ALTER TABLE sf_target_option_revisions DROP CONSTRAINT IF EXISTS sf_target_option_revisions_observation_check;
    ALTER TABLE sf_target_option_revisions ADD CONSTRAINT sf_target_option_revisions_observation_check CHECK(
      (identity_state='PROVISIONAL' AND observation_digest IS NULL AND observed_at IS NULL) OR
      (identity_state IN ('OBSERVED','VERIFIED') AND observation_digest IS NOT NULL AND observed_at IS NOT NULL));

CREATE TABLE IF NOT EXISTS sf_sql_validations (
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
  END IF; END $$;

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

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_releases_immutable') THEN
      CREATE TRIGGER sf_releases_immutable BEFORE UPDATE OR DELETE ON sf_releases
      FOR EACH ROW EXECUTE FUNCTION sf_reject_sql_workspace_evidence_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_history_immutable') THEN
      CREATE TRIGGER sf_history_immutable BEFORE UPDATE OR DELETE ON sf_history
      FOR EACH ROW EXECUTE FUNCTION sf_reject_sql_workspace_evidence_mutation(); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_audit_immutable') THEN
      CREATE TRIGGER sf_audit_immutable BEFORE UPDATE OR DELETE ON sf_audit
      FOR EACH ROW EXECUTE FUNCTION sf_reject_sql_workspace_evidence_mutation(); END IF; END $$;

ALTER TABLE sf_sql_draft_revisions ADD COLUMN IF NOT EXISTS manifest_version smallint NOT NULL DEFAULT 1;
    ALTER TABLE sf_sql_draft_revisions ADD COLUMN IF NOT EXISTS files jsonb NOT NULL DEFAULT '[]'::jsonb;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sf_sql_draft_revisions'::regclass AND conname='sf_sql_draft_revisions_manifest_version_check') THEN
      ALTER TABLE sf_sql_draft_revisions ADD CONSTRAINT sf_sql_draft_revisions_manifest_version_check CHECK(manifest_version IN (1,2)); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sf_sql_draft_revisions'::regclass AND conname='sf_sql_draft_revisions_files_check') THEN
      ALTER TABLE sf_sql_draft_revisions ADD CONSTRAINT sf_sql_draft_revisions_files_check CHECK(jsonb_typeof(files)='array'); END IF; END $$;
    ALTER TABLE sf_sql_workspace_releases ADD COLUMN IF NOT EXISTS draft_manifest_version smallint NOT NULL DEFAULT 1;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='sf_sql_workspace_releases'::regclass AND conname='sf_sql_workspace_releases_draft_manifest_version_check') THEN
      ALTER TABLE sf_sql_workspace_releases ADD CONSTRAINT sf_sql_workspace_releases_draft_manifest_version_check CHECK(draft_manifest_version IN (1,2)); END IF; END $$;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_plan_source_comparison_immutable') THEN
      CREATE TRIGGER sf_plan_source_comparison_immutable BEFORE UPDATE OR DELETE ON sf_audit
      FOR EACH ROW WHEN (OLD.action='PLAN_SOURCE_COMPARED' OR OLD.facts ? 'comparisonId')
      EXECUTE FUNCTION sf_reject_sql_workspace_evidence_mutation(); END IF; END $$;

ALTER TABLE sf_profiles ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
      ALTER TABLE sf_profiles ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE sf_profiles ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK(length(description)<=2000);
      ALTER TABLE sf_profiles ADD COLUMN IF NOT EXISTS service_kind text NOT NULL DEFAULT 'SERVICE_NAME' CHECK(service_kind IN ('SERVICE_NAME','SID'));

ALTER TABLE sf_database_connections ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 1 CHECK(revision>0);
      ALTER TABLE sf_database_connections ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
      ALTER TABLE sf_database_connections ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '' CHECK(length(description)<=2000);
      ALTER TABLE sf_database_connections ADD COLUMN IF NOT EXISTS service_kind text NOT NULL DEFAULT 'SERVICE_NAME' CHECK(service_kind IN ('SERVICE_NAME','SID'));

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

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_profiles_revision_guard') THEN
    CREATE TRIGGER sf_profiles_revision_guard BEFORE UPDATE OR DELETE ON sf_profiles FOR EACH ROW EXECUTE FUNCTION sf_advance_connection_revision(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_profiles_revision_capture') THEN
    CREATE TRIGGER sf_profiles_revision_capture AFTER INSERT OR UPDATE ON sf_profiles FOR EACH ROW EXECUTE FUNCTION sf_capture_connection_revision(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_database_connections_revision_capture') THEN
    CREATE TRIGGER sf_database_connections_revision_capture AFTER INSERT OR UPDATE ON sf_database_connections FOR EACH ROW EXECUTE FUNCTION sf_capture_connection_revision(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_plans_connection_revision_capture') THEN
    CREATE TRIGGER sf_plans_connection_revision_capture AFTER INSERT ON sf_plans FOR EACH ROW EXECUTE FUNCTION sf_capture_plan_connection_revision(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_connection_revisions_immutable') THEN
    CREATE TRIGGER sf_connection_revisions_immutable BEFORE UPDATE OR DELETE ON sf_connection_revisions FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_connection_preflights_immutable') THEN
    CREATE TRIGGER sf_connection_preflights_immutable BEFORE UPDATE OR DELETE ON sf_connection_preflights FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;

DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_connection_plan_revisions_immutable') THEN
    CREATE TRIGGER sf_connection_plan_revisions_immutable BEFORE UPDATE OR DELETE ON sf_connection_plan_revisions FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation(); END IF; END $$;

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

DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_schema_snapshots_immutable') THEN
      CREATE TRIGGER sf_schema_snapshots_immutable BEFORE UPDATE OR DELETE ON sf_schema_snapshots
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
    END IF; END $$;

DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_schema_baselines_immutable') THEN
      CREATE TRIGGER sf_schema_baselines_immutable BEFORE UPDATE OR DELETE ON sf_schema_baselines
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
    END IF; END $$;

DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_plan_schema_evidence_immutable') THEN
      CREATE TRIGGER sf_plan_schema_evidence_immutable BEFORE UPDATE OR DELETE ON sf_plan_schema_evidence
      FOR EACH ROW EXECUTE FUNCTION sf_reject_target_evidence_mutation();
    END IF; END $$;

INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid)
        SELECT gen_random_uuid(),'ACTIVE',md5(clock_timestamp()::text || random()::text) || md5(random()::text),0
        WHERE NOT EXISTS (SELECT 1 FROM sf_metadata_generations)
          AND NOT EXISTS (SELECT 1 FROM sf_metadata_restore_owners)
        ON CONFLICT DO NOTHING;
      INSERT INTO sf_metadata_current(singleton,generation_id)
        SELECT true,id FROM sf_metadata_generations
        WHERE (SELECT count(*) FROM sf_metadata_generations)=1
          AND NOT EXISTS (SELECT 1 FROM sf_metadata_restore_owners)
        ORDER BY created_at,id LIMIT 1 ON CONFLICT DO NOTHING;
      DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM sf_metadata_current WHERE singleton) THEN
        RAISE EXCEPTION 'metadata generation recovery is incomplete'; END IF; END $$;
      INSERT INTO sf_metadata_operator_audit(id,action,generation_id,operator_os_uid)
        SELECT gen_random_uuid(),'INITIALIZE',generation_id,0 FROM sf_metadata_current
        WHERE NOT EXISTS (SELECT 1 FROM sf_metadata_operator_audit WHERE action='INITIALIZE') ON CONFLICT DO NOTHING;

DO $$ BEGIN
      IF position('PASSWORD' in (SELECT pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conrelid='sf_local_credentials'::regclass AND conname='sf_local_credentials_lifetime'))=0 THEN
        ALTER TABLE sf_local_credentials DROP CONSTRAINT sf_local_credentials_lifetime;
        ALTER TABLE sf_local_credentials ADD CONSTRAINT sf_local_credentials_lifetime CHECK (
          (credential_kind IN ('LOCAL','PASSWORD') AND parent_credential_id IS NULL AND absolute_expires_at IS NULL
            AND expires_at=issued_at+interval '24 hours') OR
          (credential_kind='BROWSER' AND parent_credential_id IS NOT NULL AND absolute_expires_at IS NOT NULL
            AND absolute_expires_at>issued_at AND absolute_expires_at<=issued_at+interval '8 hours'
            AND expires_at>issued_at AND expires_at<=absolute_expires_at));
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS sf_password_accounts (
      actor_id text PRIMARY KEY REFERENCES sf_local_actors(id),
      username text NOT NULL UNIQUE CHECK(username ~ '^[a-z][a-z0-9._-]{2,63}$'),
      password_hash text NOT NULL CHECK(password_hash ~ '^scrypt-v1[$][a-f0-9]{32}[$][a-f0-9]{128}$'),
      anchor_credential_id uuid NOT NULL,
      disabled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(anchor_credential_id,actor_id) REFERENCES sf_local_credentials(id,actor_id)
    );
    CREATE TABLE IF NOT EXISTS sf_password_audit (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL REFERENCES sf_local_actors(id),
      action text NOT NULL CHECK(action IN ('SETUP','PASSWORD_CHANGED','OPERATOR_RESET','OPERATOR_DISABLED')),
      occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(), operator_os_uid integer
    );
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_password_audit_immutable') THEN
      CREATE TRIGGER sf_password_audit_immutable BEFORE UPDATE OR DELETE ON sf_password_audit
        FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
    END IF; END $$;

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
