# Plan records

In **Plans & review**, choose **Download plan record** to save the selected plan's
retained public intent, migration and statement identities, and current decision
and approval withdrawal. Both fixed roles require explicit project membership.
Archived projects remain readable. Missing membership, revoked membership or an
unfinished membership bootstrap cannot export a record.

`GET /api/projects/:projectId/plans/:id/record` returns a non-cacheable JSON attachment:
`{format: 1 | 2, algorithm: "sha256", record: "<serialized JSON>", sha256: "<hex>"}`.
Format 1 covers profile-only intent; format 2 includes retained target binding facts.
New format-5 intent retains its environment review policy in either record format,
including the policy revision and explicit decision method. Formats 1–4 remain readable.
The record is an `OFFLINE_GOVERNANCE` snapshot with its export time. Its target
configuration comes from the saved intent, not current editable settings. The API
uses one read-only repeatable-read metadata transaction and rejects damaged intent,
mismatched plan items or oversized records with `409 PLAN_RECORD_UNAVAILABLE`.
Downloads do not change plans, approvals, audit history, jobs or target data.

Verify the exact record string with the standard Node.js crypto implementation:

```sh
node --input-type=module -e '
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const b=JSON.parse(readFileSync(process.argv[1],"utf8"));
const digest=createHash("sha256").update(b.record,"utf8").digest("hex");
if(![1,2].includes(b.format) || b.algorithm!=="sha256" || digest!==b.sha256) process.exit(1);
console.log(digest);
' kelryvo-plan-PLAN_UUID.json
```

Compare that digest against a separately trusted copy when checking authenticity
of the received bytes. Someone who can replace the file can replace its checksum;
this is not a signature or a tamper-proof attestation. The original intent digest
is retained only as a reference: the exported public projection omits its private
credential reference and cannot reconstruct the original envelope.

Source SQL, credential references, secrets, execution jobs/receipts and observed
Live Oracle target queries are excluded; retained target observations, when present, remain historical metadata. A saved approval is historical metadata, and a
later withdrawal may occur after export. The file grants no execution authority
and does not certify SQL effects, target availability or full SEC-013 acceptance.
