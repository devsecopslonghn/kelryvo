//! Public retained-plan projection. It never treats stored approval as fresh
//! target authority and never exposes credential references from the envelope.
use crate::{MAX_INPUT_BYTES, MAX_RELEASE_FILES, digest, intent, js_len};
use serde_json::{Value, json};

fn public_target(value: &Value) -> Value {
    let mut target = value.clone();
    if let Some(object) = target.as_object_mut() {
        object.shift_remove("privatePrincipalRef");
        object.shift_remove("credentialRef");
    }
    target
}

pub fn project(row: &Value) -> Value {
    let items = row["items"]
        .as_array()
        .filter(|items| {
            !items.is_empty()
                && items.len() <= MAX_RELEASE_FILES
                && items.iter().all(|item| {
                    item.as_object().is_some_and(|o| {
                        o.len() == 4
                            && ["path", "version", "sha256", "status"]
                                .iter()
                                .all(|k| o.contains_key(*k))
                    }) && item["path"]
                        .as_str()
                        .is_some_and(|s| js_len(s) <= MAX_INPUT_BYTES)
                        && item["version"]
                            .as_str()
                            .is_some_and(|s| js_len(s) <= MAX_INPUT_BYTES)
                        && digest(&item["sha256"])
                        && item["status"] == "NOT_EXECUTED"
                })
        })
        .cloned()
        .unwrap_or_default();
    let facts = intent::verify(
        row["offline_intent_envelope"].as_str().unwrap_or_default(),
        row["offline_intent_digest"].as_str().unwrap_or_default(),
        Some(&json!({
            "organizationId":row["organization_id"],"projectId":row["project_id"],"requesterId":row["author_id"],"releaseId":row["release_id"],"profileId":row["profile_id"],
            "items":items.iter().map(|i|json!({"path":i["path"],"version":i["version"],"sha256":i["sha256"]})).collect::<Vec<_>>()
        })),
    );
    let mut result = json!({});
    for (raw, field) in [
        ("id", "id"),
        ("release_id", "releaseId"),
        ("profile_id", "profileId"),
        ("source_binding_generation", "sourceBindingGeneration"),
        ("author_id", "authorId"),
        ("reviewer_id", "reviewerId"),
        ("reviewer_name", "reviewerName"),
        ("reviewer_revision", "reviewerRevision"),
        ("status", "status"),
        ("decision", "decision"),
        ("decision_reason", "decisionReason"),
        ("decided_by", "decidedBy"),
        ("decided_by_name", "decidedByName"),
        ("created_at", "createdAt"),
        ("decided_at", "decidedAt"),
        ("execution", "execution"),
        ("history_status", "historyStatus"),
        ("planning_scope", "planningScope"),
        ("approval_reference", "approvalReference"),
        ("revocation", "revocation"),
    ] {
        result[field] = row[raw].clone();
    }
    if result["reviewerRevision"].is_null() {
        result["reviewerRevision"] = "0".into();
    }
    result["items"] = items.into();
    let mut blockers = Vec::new();
    if row["status"] != "APPROVED" {
        blockers.push("PLAN_APPROVAL_REQUIRED");
    }
    if facts.is_none() {
        blockers.push("PLAN_INTENT_UNAVAILABLE");
    }
    let legacy = facts
        .as_ref()
        .is_some_and(|i| i["format"].as_u64().is_some_and(|f| f < 3));
    result["currentness"] = json!({"state":if legacy{"LEGACY_UNBOUND"}else{"UNKNOWN"},"reasons":if legacy{Vec::<&str>::new()}else{vec!["INTEGRITY_UNAVAILABLE"]},"checkedAt":if facts.as_ref().is_some_and(|i|i["format"].as_u64().is_some_and(|f|f>=3)){json!(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis,true))}else{Value::Null}});
    if let Some(facts) = facts {
        if facts["format"] == 1 {
            blockers.push("STATEMENT_APPROVAL_REQUIRED");
        }
        let mut public = json!({});
        for field in [
            "format",
            "digest",
            "profileId",
            "profileName",
            "environmentId",
            "environmentName",
            "engine",
            "host",
            "port",
            "service",
            "username",
        ] {
            public[field] = facts[field].clone();
        }
        public["statementCount"] = facts["statements"]
            .as_array()
            .map(|s| json!(s.len()))
            .unwrap_or(Value::Null);
        if facts["target"].is_object() {
            let target = public_target(&facts["target"]);
            public["target"] = target.clone();
            let mut retained = target;
            for field in ["profileId", "environmentId", "environmentName"] {
                retained[field] = facts[field].clone();
            }
            result["retainedTarget"] = retained;
        } else {
            result["retainedTarget"] = Value::Null;
        }
        if let Some(validation) = facts.get("validation") {
            public["validation"] = validation.clone();
        }
        result["offlineIntent"] = public;
    } else {
        result["offlineIntent"] = Value::Null;
        result["retainedTarget"] = Value::Null;
    }
    blockers.extend([
        "TARGET_HISTORY_UNAVAILABLE",
        "TRUSTED_HOST_UNAVAILABLE",
        "TARGET_MUTEX_UNAVAILABLE",
        "DISPATCH_PERMIT_UNAVAILABLE",
    ]);
    result["executionReadiness"] =
        json!({"state":"WAITING_VALIDATION","executionAuthority":false,"blockers":blockers});
    result
}
