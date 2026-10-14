import { initializeSqlWorkspaceSchema } from '../sql-workspace/schema.mjs';
import { initializeTargetSchema } from '../targets/schema.ts';
import { initializeConnectivitySchema } from '../connectivity/schema.mjs';
import { initializeConnectionManagement } from '../connectivity/management-schema.mjs';
import { initializeValidationSchema } from '../sql-validation/schema.mjs';
import { initializeExecutionReconciliation } from '../execution/reconciliation.ts';
/** Idempotent schema for the local, single-organization product slice. */
export async function initializeDatabase(sql: any, options: { initializeConnectionManagement?: boolean; initializeMetadata?: boolean; initializeTargets?: boolean; initializeConnectivity?: boolean; initializeValidation?: boolean; initializeSqlWorkspace?: boolean; sqlWorkspaceVersion?: 1 | 2; initializeReconciliation?: boolean; installRetainedEvidenceGuards?: boolean; installReconciliationBindingGuards?: boolean } = {}): Promise<void> {
  await sql.begin(async (tx: any) => {
    // Test files and local startup callers can initialize the same schema at once.
    // IF NOT EXISTS still races while PostgreSQL creates the backing catalog type.
    await tx`SELECT pg_advisory_xact_lock(1397112658, 1)`;
    await tx.unsafe(`
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
    `);
    if (options.initializeReconciliation !== false) await initializeExecutionReconciliation(tx, { installBindingGuards: options.installReconciliationBindingGuards !== false });
    if (options.initializeTargets !== false) await initializeTargetSchema(tx);
    if (options.initializeTargets !== false && options.initializeConnectivity !== false) await initializeConnectivitySchema(tx);
    if (options.initializeTargets !== false && options.initializeConnectivity !== false && options.initializeValidation !== false) await initializeValidationSchema(tx);
    if (options.initializeSqlWorkspace !== false && options.initializeTargets !== false && options.initializeConnectivity !== false
        && options.initializeValidation !== false && options.initializeReconciliation !== false)
      await initializeSqlWorkspaceSchema(tx,{version:options.sqlWorkspaceVersion ?? 2,
        installRetainedEvidenceGuards:options.installRetainedEvidenceGuards !== false});
    if (options.initializeConnectionManagement !== false && options.initializeTargets !== false && options.initializeConnectivity !== false)
      await initializeConnectionManagement(tx);
    if (options.initializeMetadata !== false) await tx.unsafe(`
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
    `);
  });
}
