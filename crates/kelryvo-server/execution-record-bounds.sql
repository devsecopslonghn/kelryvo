SELECT coalesce(sum(row_bytes),0)::bigint AS projected_bytes,
          coalesce(bool_and(fields_bounded),true) AS fields_bounded FROM (
          SELECT 256+octet_length(id::text)+octet_length(revision::text)
            +CASE WHEN from_state IS NULL THEN 0 ELSE least(octet_length(from_state),128) END
            +least(octet_length(to_state),128)+least(octet_length(actor_id),512)
            +CASE WHEN reason IS NULL THEN 0 ELSE least(octet_length(reason),8000) END
            +CASE WHEN jsonb_typeof(facts->'reasonCode')='string' AND octet_length(facts->>'reasonCode') BETWEEN 1 AND 64
              AND (facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN octet_length(facts->>'reasonCode') ELSE 0 END AS row_bytes,
            (from_state IS NULL OR octet_length(from_state)<=128) AND octet_length(to_state)<=128
              AND octet_length(actor_id)<=512 AND (reason IS NULL OR octet_length(reason)<=8000) AS fields_bounded
            FROM sf_execution_job_events WHERE job_id=$1
          UNION ALL
          SELECT 192+octet_length(id::text)+octet_length(generation::text)+octet_length(state)+32 AS row_bytes,
            octet_length(state)<=128 AS fields_bounded FROM sf_execution_attempts WHERE job_id=$1
          UNION ALL
          SELECT 256+octet_length(e.id::text)+octet_length(e.revision::text)+octet_length(e.phase)
            +coalesce(octet_length(e.ordinal::text),0)+coalesce(octet_length(e.statement_digest),0)
            +CASE WHEN jsonb_typeof(e.facts->'reasonCode')='string' AND octet_length(e.facts->>'reasonCode') BETWEEN 1 AND 64
              AND (e.facts->>'reasonCode') ~ '^[A-Z0-9_]{1,64}$' THEN octet_length(e.facts->>'reasonCode') ELSE 0 END AS row_bytes,
            octet_length(e.phase)<=128 AS fields_bounded
            FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=$1
          UNION ALL
          SELECT 256+octet_length(id::text)+octet_length(generation::text)+octet_length(ordinal::text)
            +octet_length(statement_digest)+octet_length(receipt_digest)+octet_length(central_evidence_digest) AS row_bytes,
            true AS fields_bounded FROM sf_execution_receipts WHERE job_id=$1
        ) projected;
