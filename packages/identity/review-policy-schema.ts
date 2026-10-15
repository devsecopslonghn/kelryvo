/** Immutable environment review policy and plan-time binding. No execution authority. */
export const REVIEW_POLICY_TABLES=['sf_environment_policy_revisions','sf_plan_review_policies'];
export const REVIEW_POLICY_FUNCTIONS=['sf_guard_environment_review_policy','sf_record_environment_review_policy','sf_capture_plan_review_policy','sf_plan_review_policy_current'];
export const REVIEW_POLICY_TRIGGERS=['sf_environments_review_policy_guard','sf_environments_review_policy_capture','sf_environment_policy_revisions_immutable','sf_plans_review_policy_capture','sf_plan_review_policies_immutable'];

export async function initializeReviewPolicies(tx: any) {
  await tx.unsafe(`
    ALTER TABLE sf_environments ADD COLUMN IF NOT EXISTS approval_stage text NOT NULL DEFAULT 'UNCLASSIFIED';
    ALTER TABLE sf_environments ADD COLUMN IF NOT EXISTS review_policy_revision bigint NOT NULL DEFAULT 1;
    DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='sf_environments_review_policy') THEN
      ALTER TABLE sf_environments ADD CONSTRAINT sf_environments_review_policy CHECK (
        review_policy_revision>0 AND approval_stage IN ('UNCLASSIFIED','DEV','SIT','CONTROLLED')
        AND (approval_stage<>'CONTROLLED' OR approval_required AND independent_approval));
    END IF; END $$;
    CREATE TABLE IF NOT EXISTS sf_environment_policy_revisions (
      environment_id uuid NOT NULL REFERENCES sf_environments(id), revision bigint NOT NULL CHECK(revision>0),
      stage text NOT NULL CHECK(stage IN ('UNCLASSIFIED','DEV','SIT','CONTROLLED')),
      approval_required boolean NOT NULL, independent_approval boolean NOT NULL,
      actor_id text, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(environment_id,revision), CHECK(stage<>'CONTROLLED' OR approval_required AND independent_approval)
    );
    CREATE TABLE IF NOT EXISTS sf_plan_review_policies (
      plan_id uuid PRIMARY KEY REFERENCES sf_plans(id), environment_id uuid NOT NULL, revision bigint NOT NULL,
      stage text NOT NULL, approval_required boolean NOT NULL, independent_approval boolean NOT NULL,
      intent_digest text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      FOREIGN KEY(environment_id,revision) REFERENCES sf_environment_policy_revisions(environment_id,revision)
    );
    INSERT INTO sf_environment_policy_revisions(environment_id,revision,stage,approval_required,independent_approval,reason)
      SELECT id,review_policy_revision,approval_stage,approval_required,independent_approval,'Imported configuration; classification not inferred'
        FROM sf_environments ON CONFLICT(environment_id,revision) DO NOTHING;
    CREATE OR REPLACE FUNCTION sf_guard_environment_review_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.review_policy_revision IS DISTINCT FROM OLD.review_policy_revision THEN RAISE EXCEPTION 'review policy revision is server owned'; END IF;
      IF ROW(NEW.approval_stage,NEW.approval_required,NEW.independent_approval) IS DISTINCT FROM ROW(OLD.approval_stage,OLD.approval_required,OLD.independent_approval) THEN
        NEW.review_policy_revision=OLD.review_policy_revision+1;
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION sf_record_environment_review_policy() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF TG_OP='INSERT' OR NEW.review_policy_revision<>OLD.review_policy_revision THEN
        INSERT INTO sf_environment_policy_revisions(environment_id,revision,stage,approval_required,independent_approval,actor_id,reason)
          VALUES(NEW.id,NEW.review_policy_revision,NEW.approval_stage,NEW.approval_required,NEW.independent_approval,
            nullif(current_setting('kelryvo.review_policy_actor',true),''),
            coalesce(nullif(current_setting('kelryvo.review_policy_reason',true),''),'Trusted database operator update'));
      END IF;
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION sf_capture_plan_review_policy() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE e sf_environments%ROWTYPE; raw jsonb; policy jsonb; required boolean; independent boolean;
    BEGIN
      SELECT env.* INTO STRICT e FROM sf_environments env JOIN sf_profiles p ON p.environment_id=env.id AND p.project_id=env.project_id WHERE p.id=NEW.profile_id FOR SHARE OF env;
      -- Historical formats cannot inherit a new policy waiver they never bound.
      required=true; independent=true;
      IF NEW.offline_intent_envelope IS NOT NULL THEN
        raw=NEW.offline_intent_envelope::jsonb;
        IF raw->>0='5' THEN
          required=CASE WHEN e.approval_stage='UNCLASSIFIED' THEN true ELSE e.approval_required END;
          independent=CASE WHEN e.approval_stage='UNCLASSIFIED' THEN true ELSE e.independent_approval END;
          policy=raw->(jsonb_array_length(raw)-1);
          IF policy->>1 IS DISTINCT FROM e.review_policy_revision::text OR policy->>2 IS DISTINCT FROM e.approval_stage
            OR policy->3 IS DISTINCT FROM to_jsonb(required) OR policy->4 IS DISTINCT FROM to_jsonb(independent)
            OR raw->>12 IS DISTINCT FROM e.id::text THEN RAISE EXCEPTION 'review policy intent mismatch'; END IF;
        END IF;
      END IF;
      INSERT INTO sf_plan_review_policies(plan_id,environment_id,revision,stage,approval_required,independent_approval,intent_digest)
        VALUES(NEW.id,e.id,e.review_policy_revision,e.approval_stage,required,independent,NEW.offline_intent_digest);
      RETURN NEW;
    END $$;
    CREATE OR REPLACE FUNCTION sf_plan_review_policy_current(plan uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM sf_plans p JOIN sf_profiles profile ON profile.id=p.profile_id
        JOIN sf_environments e ON e.id=profile.environment_id AND e.project_id=p.project_id
        LEFT JOIN sf_plan_review_policies s ON s.plan_id=p.id
        WHERE p.id=plan AND ((s.plan_id IS NOT NULL AND s.environment_id=e.id AND s.revision=e.review_policy_revision
          AND s.intent_digest IS NOT DISTINCT FROM p.offline_intent_digest)
          OR (s.plan_id IS NULL AND e.review_policy_revision=1 AND e.approval_stage='UNCLASSIFIED'
            AND (p.decided_by IS NULL OR p.decided_by<>p.author_id))))
    $$;
    CREATE OR REPLACE FUNCTION sf_plan_approval_satisfied(plan uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT EXISTS(SELECT 1 FROM sf_plans p JOIN sf_profiles profile ON profile.id=p.profile_id
        JOIN sf_environments e ON e.id=profile.environment_id
        LEFT JOIN sf_plan_review_policies s ON s.plan_id=p.id
        LEFT JOIN sf_plan_policy_decisions d ON d.plan_id=p.id AND d.approval_reference=p.approval_reference AND d.environment_id=e.id
        WHERE p.id=plan AND p.status='APPROVED' AND p.decision='APPROVE' AND p.approval_reference IS NOT NULL AND p.decided_by IS NOT NULL
          AND sf_plan_review_policy_current(p.id)
          AND (p.decided_by<>p.author_id OR (s.plan_id IS NOT NULL AND d.plan_id IS NOT NULL
            AND NOT(s.approval_required AND s.independent_approval)
            AND d.approval_required=s.approval_required AND d.independent_approval=s.independent_approval))
          AND NOT EXISTS(SELECT 1 FROM sf_plan_approval_revocations r WHERE r.plan_id=p.id))
    $$;
    DO $$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='sf_environments_review_policy_guard') THEN
        CREATE TRIGGER sf_environments_review_policy_guard BEFORE UPDATE ON sf_environments FOR EACH ROW EXECUTE FUNCTION sf_guard_environment_review_policy();
        CREATE TRIGGER sf_environments_review_policy_capture AFTER INSERT OR UPDATE ON sf_environments FOR EACH ROW EXECUTE FUNCTION sf_record_environment_review_policy();
        CREATE TRIGGER sf_environment_policy_revisions_immutable BEFORE UPDATE OR DELETE ON sf_environment_policy_revisions FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
        CREATE TRIGGER sf_plans_review_policy_capture AFTER INSERT ON sf_plans FOR EACH ROW EXECUTE FUNCTION sf_capture_plan_review_policy();
        CREATE TRIGGER sf_plan_review_policies_immutable BEFORE UPDATE OR DELETE ON sf_plan_review_policies FOR EACH ROW EXECUTE FUNCTION sf_reject_metadata_evidence_mutation();
      END IF;
    END $$;
  `);
}
