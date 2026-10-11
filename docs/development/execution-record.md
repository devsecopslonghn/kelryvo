# Execution request records

In **Plans & review**, select a plan and choose **Download execution record** for
a deployment request. The download is also available when inspecting events in
**Request history**, including older requests outside the current queue.

`GET /api/execution-jobs/:id/record` returns a non-cacheable JSON attachment named
`kelryvo-execution-REQUEST_UUID.json`. Both fixed roles need current explicit
project membership. Archived projects and metadata under RESTORE_HOLD remain
readable; the download grants no new authority and changes no retained state.

The bundle has `{format: 1, algorithm: "sha256", record: "<JSON string>", sha256}`.
Its single metadata snapshot joins the saved public plan intent, original approval
and any withdrawal with request events, attempts, statement events and receipt
digests. It preserves the recorded request state and admission scope, including
`UNIT_SYNTHETIC`. It excludes SQL, credential references, private admission data,
raw event facts, credential IDs, idempotency keys and worker lease secrets.

Use the Node crypto command in [Plan records](plan-record.md) with the downloaded
filename to check the exact record string. Compare against a separately trusted
digest when assessing authenticity: the checksum is not a signature. The retained
intent digest identifies the private original envelope; the public projection
cannot reconstruct it.

Missing receipts do not prove either success or failure on a target. A retained
success state or receipt digest is metadata, not independent confirmation of
Oracle effects. Withdrawal may happen after export. No file grants permission to
execute, replay, clear HOLD or recover an uncertain attempt.

The server exports at most 2,000 combined request-event, attempt, statement-event
and receipt rows, 1 MiB of estimated projected journal bytes before loading rows,
and 8 MiB of serialized record bytes. Public request/event
reasons are limited to 8,000 UTF-8 bytes each. The server rejects damaged
plan/request bindings and oversized records with
`409 EXECUTION_RECORD_UNAVAILABLE`; it never silently drops history to fit a file.
Use the paginated request/attempt views when a complete download exceeds its
limits. Full SEC-013 signed deployment evidence and Oracle runtime acceptance
remain separate from this retained metadata record.
