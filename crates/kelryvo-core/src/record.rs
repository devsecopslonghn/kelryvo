//! A redacted governance snapshot is neither a signature nor an execution receipt.
use serde_json::{Value, json};

pub fn verified_plan(p: &Value, revocation: Option<&Value>) -> Option<(Value, Value)> {
    let items = p["items"].as_array()?;
    if items.iter().any(|i| i["status"] != "NOT_EXECUTED") {
        return None;
    }
    let mut intent = crate::intent::verify(
        p["envelope"].as_str()?,
        p["digest"].as_str()?,
        Some(
            &json!({"organizationId":p["organizationId"],"projectId":p["projectId"],"requesterId":p["authorId"],"releaseId":p["releaseId"],"profileId":p["profileId"],"items":items.iter().map(|i|json!({"path":i["path"],"version":i["version"],"sha256":i["sha256"]})).collect::<Vec<_>>()}),
        ),
    )?;
    if !["PENDING_APPROVAL", "APPROVED", "REJECTED", "REVOKED"]
        .iter()
        .any(|s| p["status"] == *s)
    {
        return None;
    }
    let decided = p["status"] != "PENDING_APPROVAL";
    let approved = p["status"] == "APPROVED" || p["status"] == "REVOKED";
    if decided {
        if p["decision"] != if approved { "APPROVE" } else { "REJECT" }
            || !p["decidedBy"].is_string()
            || p["decidedBy"] == p["authorId"]
            || !p["decidedAt"].as_str().is_some_and(|s| !s.is_empty())
            || !p["decisionReason"]
                .as_str()
                .is_some_and(|s| !s.trim_matches(crate::js_whitespace).is_empty())
            || approved && !crate::uuid(&p["approvalReference"])
        {
            return None;
        }
    } else if [
        "decision",
        "decisionReason",
        "decidedBy",
        "decidedAt",
        "approvalReference",
    ]
    .iter()
    .any(|k| !p[k].is_null())
    {
        return None;
    }
    if (p["status"] == "REVOKED") != revocation.is_some()
        || revocation
            .is_some_and(|r| !r.is_object() || r["approvalReference"] != p["approvalReference"])
    {
        return None;
    }
    let mut plan = json!({});
    for key in [
        "id",
        "projectId",
        "authorId",
        "createdAt",
        "sourceBindingGeneration",
        "status",
        "decision",
        "decisionReason",
        "decidedBy",
        "decidedByName",
        "decidedAt",
        "approvalReference",
    ] {
        plan[key] = p[key].clone();
    }
    plan["revocation"] = revocation.cloned().unwrap_or(Value::Null);
    if let Some(t) = intent.get_mut("target").and_then(Value::as_object_mut) {
        t.shift_remove("privatePrincipalRef");
        t.shift_remove("credentialRef");
    }
    Some((plan, intent))
}

pub fn export(plan: Value, intent: Value, now: &str) -> Option<Value> {
    let format = if intent["format"].as_u64()? >= 3 {
        2
    } else {
        1
    };
    let record=json!({"format":format,"kind":"KELRYVO_PLAN_RECORD","scope":"OFFLINE_GOVERNANCE","exportedAt":now,"executionAuthority":false,"targetEffects":"NOT_ATTESTED","plan":plan,"retainedIntent":intent,"limitations":["Checksum detects changes only against a separately trusted digest; it is not a signature.","Intent digest references the private retained envelope; this redacted export cannot reconstruct it.","Source SQL, credentials, execution jobs and receipts are not included.","Target observations are retained metadata at the recorded time; they do not attest current connectivity or database effects."]}).to_string();
    if record.len() > 2 * crate::MAX_STDOUT_BYTES {
        return None;
    }
    Some(
        json!({"format":format,"algorithm":"sha256","sha256":crate::sha256(&record),"record":record}),
    )
}
