SELECT
          (SELECT count(*) FROM sf_execution_job_events WHERE job_id=$1)::integer AS job_events,
          (SELECT count(*) FROM sf_execution_attempts WHERE job_id=$1)::integer AS attempts,
          (SELECT count(*) FROM sf_execution_attempt_events e JOIN sf_execution_attempts a ON a.id=e.attempt_id WHERE a.job_id=$1)::integer AS attempt_events,
          (SELECT count(*) FROM sf_execution_receipts WHERE job_id=$1)::integer AS receipts;
