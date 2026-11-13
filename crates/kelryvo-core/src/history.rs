//! Approved source labels and immutable recovery preimages. Historical evidence
//! is never a fresh dispatch capability and cannot clear or replay a HOLD job.
use crate::{
    digest, evidence, evidence_digest, intent, matches, migrations, safe_integer, string, uuid,
};
use serde_json::{Value, json};

pub fn context(row: &Value) -> Option<Value> {
    let b = &row["host_binding"];
    if b["historyFormat"] != 1
        || ![
            "appliedMigrationCount",
            "appliedStatementCount",
            "statementCount",
        ]
        .iter()
        .all(|k| safe_integer(&b[k]).is_some())
        || ![
            &b["statementManifestDigest"],
            &b["pendingManifestDigest"],
            &row["intent_digest"],
            &row["source_manifest_digest"],
        ]
        .iter()
        .all(|v| digest(v))
    {
        return None;
    }
    for (a, b) in [
        ("approval_reference", "plan_approval_reference"),
        ("intent_digest", "plan_intent_digest"),
        ("intent_digest", "job_intent_digest"),
        ("approval_reference", "job_approval_reference"),
        ("organization_id", "job_organization_id"),
        ("project_id", "job_project_id"),
        ("plan_id", "job_plan_id"),
        ("scope", "job_scope"),
        ("profile_id", "plan_profile_id"),
        ("source_manifest_digest", "plan_manifest_digest"),
    ] {
        if row[a] != row[b] {
            return None;
        }
    }
    if row["job_admission_statement_count"] != b["statementCount"] {
        return None;
    }
    let i = intent::verify(
        row["envelope"].as_str()?,
        row["intent_digest"].as_str()?,
        Some(
            &json!({"organizationId":row["organization_id"],"projectId":row["project_id"],"releaseId":row["plan_release_id"],"manifestDigest":row["source_manifest_digest"],"profileId":row["profile_id"]}),
        ),
    )?;
    if i["format"].as_u64()? < 2 {
        return None;
    }
    if i["target"].is_object()
        && ([
            ("targetBindingId", "bindingId"),
            ("targetBindingRevision", "bindingRevision"),
            ("streamId", "streamId"),
            ("migrationNamespace", "migrationNamespace"),
        ]
        .iter()
        .any(|(a, z)| b[a] != i["target"][z])
            || !digest(&b["targetBindingDigest"]))
    {
        return None;
    }
    let m = migrations::approved_identities(&i)?;
    let m = m.as_array()?;
    let applied = usize::try_from(safe_integer(&b["appliedMigrationCount"])?).ok()?;
    if applied > m.len() {
        return None;
    }
    let applied_statements = m[..applied]
        .iter()
        .map(|m| m["statementDigests"].as_array().map(Vec::len))
        .sum::<Option<usize>>()?;
    let pending: Vec<_> = m[applied..]
        .iter()
        .flat_map(|m| {
            m["statementDigests"]
                .as_array()
                .into_iter()
                .flatten()
                .cloned()
        })
        .collect();
    if b["appliedStatementCount"] != applied_statements
        || b["statementCount"] != pending.len()
        || b["statementManifestDigest"] != evidence_digest(&i["statements"])
        || b["pendingManifestDigest"] != evidence_digest(&json!(&m[applied..]))
    {
        return None;
    }
    Some(
        json!({"totalApprovedMigrations":m.len(),"totalApprovedStatements":i["statements"].as_array()?.len(),"appliedMigrationCount":applied,"appliedStatementCount":applied_statements,"pendingMigrationCount":m.len()-applied,"pendingStatementCount":pending.len(),"statements":i["statements"],"pendingStatementDigests":pending,"items":i["items"].as_array()?.iter().map(|i|json!({"path":i["path"],"version":i["version"]})).collect::<Vec<_>>()}),
    )
}
pub fn label(context: &Value, ordinal: &Value, hash: &Value) -> Option<Value> {
    let n = safe_integer(ordinal)?;
    if n == 0 || n > safe_integer(&context["pendingStatementCount"])? || !digest(hash) {
        return None;
    }
    let full = safe_integer(&context["appliedStatementCount"])? + n;
    let statement = context["statements"]
        .as_array()?
        .get(usize::try_from(full - 1).ok()?)?;
    if statement["ordinal"] != full || statement["executionSha256"] != *hash {
        return None;
    }
    let items = context["items"].as_array()?;
    let file = items.iter().position(|i| i["path"] == statement["path"])?;
    Some(
        json!({"approvedPath":items[file]["path"],"approvedVersion":items[file]["version"],"approvedStatementOrdinal":full,"approvedFileOrdinal":file+1,"approvedFileStatementOrdinal":statement["fileOrdinal"],"totalApprovedStatements":context["totalApprovedStatements"],"totalApprovedMigrations":context["totalApprovedMigrations"]}),
    )
}
pub fn target_digests(i: &Value, e: &Value) -> Value {
    let source = !e["source_connection_id"].is_null();
    let mode = &e["credential_mode"];
    if source && mode != "INSTANCE_MASTER" || !source && !mode.is_null() {
        return json!([]);
    }
    let physical = evidence::physical_target_key(&e["identity"]);
    if source && physical.is_none() {
        return json!([]);
    }
    let Some(mut target) = i["target"].as_object().cloned() else {
        return json!([]);
    };
    if source {
        target.insert("credentialMode".into(), mode.clone());
    }
    let mut result = Vec::new();
    for key in [None, physical.as_deref()]
        .into_iter()
        .take(if physical.is_some() { 2 } else { 1 })
    {
        let mut t = Value::Object(target.clone());
        if let Some(key) = key {
            t["physicalTargetKey"] = key.into();
        }
        t["expectedIdentityDigest"] = e["identity_digest"].clone();
        t["evidenceProvenance"] = e["provenance"].clone();
        t["liveVerificationAccepted"] = json!(truthy(&e["verification_acceptance"]));
        result.push(evidence_digest(&t));
    }
    json!(result)
}
fn truthy(v: &Value) -> bool {
    match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64().is_some_and(|n| n != 0.0),
        _ => true,
    }
}
// This canonical format sorts property names lexicographically even when they
// look like array indices; it differs from ECMAScript object enumeration.
pub fn completion_digest(v: &Value) -> String {
    fn write(v: &Value) -> String {
        match v {
            Value::Array(a) => format!("[{}]", a.iter().map(write).collect::<Vec<_>>().join(",")),
            Value::Object(o) => {
                let mut keys: Vec<_> = o.keys().collect();
                keys.sort_by(|a, b| crate::js_json::cmp(a, b));
                format!(
                    "{{{}}}",
                    keys.into_iter()
                        .map(|k| format!("{}:{}", json!(k), write(&o[k])))
                        .collect::<Vec<_>>()
                        .join(",")
                )
            }
            _ => crate::js_json::stringify(v, false),
        }
    }
    crate::sha256(write(v))
}
pub fn central_digest(s: &Value) -> Option<String> {
    let r = &s["row"];
    let a = &s["attempt"];
    let text = |v: &Value| {
        v.as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| v.to_string())
    };
    let receipts: Vec<_> = s["receipts"]
        .as_array()?
        .iter()
        .map(|r| {
            json!([
                r["job_id"],
                r["attempt_id"],
                text(&r["generation"]),
                r["ordinal"],
                r["statement_digest"],
                r["receipt_digest"],
                r["central_evidence_digest"]
            ])
        })
        .collect();
    let events: Vec<_> = s["events"]
        .as_array()?
        .iter()
        .map(|e| {
            json!([
                e["attempt_id"],
                e["phase"],
                e["ordinal"],
                e["statement_digest"]
            ])
        })
        .collect();
    Some(completion_digest(&json!([
        r["job_id"],
        text(&r["job_revision"]),
        r["plan_id"],
        r["intent_digest"],
        r["approval_reference"],
        r["target_identity_digest"],
        r["history_snapshot_digest"],
        r["mutex_authority_digest"],
        r["validity_digest"],
        r["central_evidence_digest"],
        r["host_binding"],
        a["id"],
        text(&a["generation"]),
        a["state"],
        receipts,
        events
    ])))
}
/// Recheck the persisted central resolution. Independent live review and scope
/// are verified by the metadata adapter separately; target effects stay historic.
pub fn recovered_evidence(snapshot: &Value, audit: &Value) -> Option<Value> {
    let r = &snapshot["row"];
    let a = &snapshot["attempt"];
    let f = &audit["facts"];
    let e = &f["evidence"];
    let c = context(r)?;
    let i = intent::verify(r["envelope"].as_str()?, r["intent_digest"].as_str()?, None)?;
    if f.as_object()?.len() != 4
        || ![
            "decisionId",
            "evidence",
            "evidenceDigest",
            "reconciliationId",
        ]
        .iter()
        .all(|k| f.get(k).is_some())
        || !uuid(&f["reconciliationId"])
        || !e.is_object()
        || e["format"] != 1
        || e["kind"] != "KELRYVO_COMPLETE_HELD_EXECUTION"
    {
        return None;
    }
    for (field, value) in [
        ("jobId", &r["job_id"]),
        ("scope", &r["scope"]),
        ("jobRevision", &r["job_revision"]),
        ("projectId", &r["project_id"]),
        ("planId", &r["plan_id"]),
        ("intentDigest", &r["intent_digest"]),
        ("approvalReference", &r["approval_reference"]),
        ("attemptId", &a["id"]),
        ("generation", &a["generation"]),
        ("targetKey", &r["host_binding"]["targetKey"]),
        ("targetIdentityDigest", &r["target_identity_digest"]),
        ("streamId", &i["target"]["streamId"]),
        ("exactOwner", &i["target"]["exactOwner"]),
        ("statementCount", &c["pendingStatementCount"]),
    ] {
        if e[field] != *value {
            return None;
        }
    }
    if !matches(
        r"\A[A-Za-z0-9._:/-]{1,512}\z",
        string(&r["host_binding"]["targetKey"]),
    ) || !digest(&r["target_identity_digest"])
        || !uuid(&i["target"]["streamId"])
        || e["targetId"]
            != evidence_digest(&json!([
                "INSTANCE_SCHEMA_STREAM_V2",
                i["target"]["streamId"]
            ]))
        || !safe_integer(&e["ledgerSequence"]).is_some_and(|n| n > 0)
        || ![
            "ledgerChecksum",
            "postconditionDigest",
            "integrityDigest",
            "receiptSetDigest",
            "admissionProofDigest",
        ]
        .iter()
        .all(|k| digest(&e[k]))
        || !matches(r"\A[a-f0-9]{40}\z", string(&e["sourceCommit"]))
        || !matches(r"\Asha256:[a-f0-9]{64}\z", string(&e["imageDigest"]))
        || e["centralSnapshotDigest"] != central_digest(snapshot)?
        || f["evidenceDigest"] != completion_digest(e)
        || !matches(
            r"\Ainstalled-recovery:[A-Za-z0-9._:-]{1,100}\z",
            string(&audit["actor_id"]),
        )
    {
        return None;
    }
    Some(e.clone())
}
