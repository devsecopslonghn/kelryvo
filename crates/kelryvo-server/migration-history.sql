WITH plan_rows AS (
        SELECT p.id AS plan_id,p.release_id,p.profile_id,p.author_id,
          $3::jsonb->>p.id::text AS binding_id,
          p.status,p.decision,p.decision_reason,p.decided_by,p.decided_by_name,p.created_at,p.decided_at,
          p.execution,p.history_status,p.approval_reference,r.commit_id,r.folder
        FROM sf_plans p JOIN sf_releases r ON r.id=p.release_id AND r.project_id=p.project_id
        WHERE p.project_id=$1 AND p.organization_id=$2
      ), rows AS (
        SELECT 'plan:'||p.plan_id::text AS id,'plan' AS kind,p.created_at AS at,p.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text) AS target_id,'CREATED'::text AS status,p.author_id AS actor_id,NULL::text AS actor_name,
          'Migration plan' AS title,('Release '||p.commit_id||' · '||p.folder) AS detail,
          NULL::uuid AS job_id,NULL::jsonb AS evidence,
          jsonb_build_object('status',p.status,'execution',COALESCE(p.execution,'UNKNOWN'),
            'targetHistory',COALESCE(p.history_status,'UNKNOWN')) AS live_status
        FROM plan_rows p
        UNION ALL
        SELECT 'approval:'||p.plan_id::text,'approval',COALESCE(p.decided_at,p.created_at),p.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),COALESCE(p.decision,p.status),p.decided_by,p.decided_by_name,
          'Approval decision',COALESCE(p.decision_reason,'Decision recorded without a reason.'),NULL::uuid,NULL::jsonb,NULL::jsonb
        FROM plan_rows p WHERE p.decision IS NOT NULL OR p.decided_at IS NOT NULL
        UNION ALL
        SELECT 'migration:'||h.id::text,'migration',h.created_at,h.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),h.status,p.author_id,NULL::text,'Migration record',
          ('Version '||h.version||' · '||h.path||' · SHA '||h.sha256),NULL::uuid,NULL::jsonb,NULL::jsonb
        FROM sf_history h JOIN plan_rows p ON p.plan_id=h.plan_id WHERE h.project_id=$1
        UNION ALL
        SELECT 'request:'||j.id::text,'request',j.created_at,j.plan_id,p.release_id,
          COALESCE(p.binding_id,p.profile_id::text),'REQUESTED',j.requester_id,NULL::text,'Execution request',
          j.reason,j.id,
          jsonb_build_object('readiness',j.readiness,'revision',j.revision,
            'latestTransition',(SELECT jsonb_build_object('revision',e.revision,'fromState',e.from_state,'toState',e.to_state,
              'actorId',CASE WHEN octet_length(e.actor_id)<=512 THEN e.actor_id END,
              'reason',CASE WHEN octet_length(e.reason)<=8000 THEN e.reason END,
              'reasonCode',CASE WHEN jsonb_typeof(e.facts->'reasonCode')='string' AND (e.facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN e.facts->>'reasonCode' END,
              'at',e.created_at) FROM sf_execution_job_events e WHERE e.job_id=j.id ORDER BY e.revision DESC LIMIT 1),
            'attemptCount',(SELECT count(*) FROM sf_execution_attempts a WHERE a.job_id=j.id),
            'latestAttempt',(SELECT jsonb_build_object('generation',a.generation,'state',a.state,
              'latestPhase',ev.phase,'reasonCode',CASE WHEN jsonb_typeof(ev.facts->'reasonCode')='string' AND (ev.facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN ev.facts->>'reasonCode' END)
              FROM sf_execution_attempts a LEFT JOIN LATERAL (SELECT phase,facts FROM sf_execution_attempt_events
                WHERE attempt_id=a.id ORDER BY revision DESC LIMIT 1) ev ON true
              WHERE a.job_id=j.id ORDER BY a.generation DESC LIMIT 1),
            'receiptCount',(SELECT count(*) FROM sf_execution_receipts r WHERE r.job_id=j.id)),
          jsonb_build_object('state',j.state,'readiness',j.readiness,'revision',j.revision)
        FROM sf_execution_jobs j JOIN plan_rows p ON p.plan_id=j.plan_id
        WHERE j.project_id=$1 AND j.organization_id=$2
        UNION ALL
        SELECT 'audit:'||a.id::text,'audit',a.created_at,COALESCE(p.plan_id,j.plan_id),COALESCE(p.release_id,jp.release_id,release.id),
          COALESCE(p.binding_id,p.profile_id::text,jp.binding_id,jp.profile_id::text),a.action,a.actor_id,
          actor.display_name,a.action,COALESCE(a.resource_id::text,'No resource reference'),j.id,
          CASE WHEN jsonb_typeof(a.facts)='object' AND octet_length(a.facts::text)<=4096 THEN a.facts END,NULL::jsonb
        FROM sf_audit a
        LEFT JOIN plan_rows p ON p.plan_id=a.resource_id
        -- Reconciliation audits reference the immutable submission, not the job.
        -- Resolve through retained scoped rows rather than trusting audit facts.
        LEFT JOIN sf_execution_reconciliations reconciliation ON reconciliation.id=a.resource_id
          AND reconciliation.project_id=a.project_id AND reconciliation.organization_id=a.organization_id
          AND a.action IN ('EXECUTION_RECONCILIATION_SUBMITTED','EXECUTION_RECONCILIATION_REVIEWED')
        LEFT JOIN sf_execution_jobs j ON j.id=COALESCE(reconciliation.job_id,a.resource_id)
          AND j.project_id=a.project_id AND j.organization_id=a.organization_id
        LEFT JOIN plan_rows jp ON jp.plan_id=j.plan_id
        LEFT JOIN sf_releases release ON release.id=a.resource_id AND release.project_id=a.project_id
          AND release.organization_id=a.organization_id
        LEFT JOIN sf_local_actors actor ON actor.id=a.actor_id AND actor.organization_id=a.organization_id
        WHERE a.project_id=$1 AND a.organization_id=$2
      ), matched AS (
        SELECT * FROM rows WHERE ($4::text IS NULL OR target_id=$4::text)
          AND ($5::text IS NULL OR status=$5::text OR live_status->>'status'=$5::text
            OR live_status->>'state'=$5::text OR live_status->>'readiness'=$5::text
            OR live_status->>'execution'=$5::text OR live_status->>'targetHistory'=$5::text)
          AND ($6::text IS NULL OR concat_ws(' ',title,detail,status,live_status::text,actor_id,actor_name,plan_id,release_id,job_id) ILIKE ('%'||$6::text||'%'))
      )
      SELECT (SELECT count(*)::int FROM matched) AS total,
        COALESCE(jsonb_agg(jsonb_build_object('id',page.id,'kind',page.kind,'at',page.at,'planId',page.plan_id,
          'releaseId',page.release_id,'targetId',page.target_id,'status',page.status,'actorId',page.actor_id,
          'actorName',page.actor_name,'title',page.title,'detail',page.detail,'jobId',page.job_id,'evidence',page.evidence,
          'liveStatus',page.live_status)
          ORDER BY page.at DESC,page.id DESC),'[]'::jsonb) AS items
      -- Bind cursor timestamps as text before casting: the driver's timestamp serializer truncates microseconds.
      FROM (SELECT * FROM matched WHERE ($7::text::timestamptz IS NULL
        OR (at,id)<($7::text::timestamptz,$8::text))
        ORDER BY at DESC,id DESC LIMIT 26 OFFSET $9) page;
