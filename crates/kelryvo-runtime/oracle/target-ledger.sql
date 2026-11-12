-- Install manually as a dedicated target-ledger owner, separate from the application writer.
-- Do not execute from the app account or expose these objects through grants/synonyms.
CREATE TABLE sf_target_ledger_head (
  target_id VARCHAR2(64 CHAR) NOT NULL,
  sequence_no NUMBER(12) DEFAULT 0 NOT NULL,
  checksum VARCHAR2(64 CHAR) NOT NULL,
  CONSTRAINT sf_target_ledger_head_pk PRIMARY KEY (target_id),
  CONSTRAINT sf_target_ledger_head_seq_ck CHECK (sequence_no >= 0),
  CONSTRAINT sf_target_ledger_head_target_ck CHECK (LENGTH(target_id) = 64),
  CONSTRAINT sf_target_ledger_head_hash_ck CHECK (LENGTH(checksum) = 64)
);

CREATE TABLE sf_target_ledger_events (
  target_id VARCHAR2(64 CHAR) NOT NULL,
  sequence_no NUMBER(12) NOT NULL,
  event_type VARCHAR2(32 CHAR) NOT NULL,
  file_ordinal NUMBER(6) NOT NULL,
  statement_ordinal NUMBER(6),
  path VARCHAR2(512 CHAR),
  migration_version VARCHAR2(128 CHAR),
  source_digest VARCHAR2(64 CHAR),
  manifest_digest VARCHAR2(64 CHAR),
  approval_reference VARCHAR2(128 CHAR),
  intent_digest VARCHAR2(64 CHAR),
  planned_count NUMBER(4),
  planned_digest VARCHAR2(64 CHAR),
  statement_digest VARCHAR2(64 CHAR),
  receipt_digest VARCHAR2(64 CHAR),
  previous_checksum VARCHAR2(64 CHAR) NOT NULL,
  checksum VARCHAR2(64 CHAR) NOT NULL,
  CONSTRAINT sf_target_ledger_events_pk PRIMARY KEY (target_id, sequence_no),
  CONSTRAINT sf_target_ledger_events_target_fk FOREIGN KEY (target_id) REFERENCES sf_target_ledger_head(target_id),
  CONSTRAINT sf_target_ledger_events_type_ck CHECK (event_type IN
    ('FILE_STARTED', 'STATEMENT_PLANNED', 'STATEMENT_STARTED', 'STATEMENT_ACKNOWLEDGED', 'FILE_APPLIED')),
  CONSTRAINT sf_target_ledger_events_ord_ck CHECK (file_ordinal BETWEEN 1 AND 128
    AND (statement_ordinal IS NULL OR statement_ordinal BETWEEN 1 AND 4096)),
  CONSTRAINT sf_target_ledger_events_plan_ck CHECK (planned_count IS NULL OR planned_count BETWEEN 1 AND 4096),
  CONSTRAINT sf_target_ledger_events_hash_ck CHECK (LENGTH(previous_checksum) = 64 AND LENGTH(checksum) = 64)
);

-- The append-only event chain is protected from accidental mutation. The ledger owner itself
-- remains a trusted boundary; application writer accounts must have no object privilege here.
CREATE OR REPLACE TRIGGER sf_target_ledger_events_immutable
  BEFORE UPDATE OR DELETE ON sf_target_ledger_events
BEGIN
  RAISE_APPLICATION_ERROR(-20091, 'SchemaForge target ledger events are immutable');
END;
/
