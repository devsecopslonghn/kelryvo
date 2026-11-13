//! Deterministic immutable validation reports. Offline review retains unknown
//! semantics/privileges and cannot confer execution authority.
use crate::{MAX_PLAN_STATEMENTS, digest, review, schema_scope, sha256};
use serde_json::{Value, json};

pub const MAX_BYTES: usize = 2 * 1024 * 1024;
pub const PROFILE: &str = "kelryvo-schema-review-v1";

// Property order is part of the retained JavaScript protocol.
fn js_equal(a: &Value, b: &Value) -> bool {
    serde_json::to_string(a).ok() == serde_json::to_string(b).ok()
}

pub fn build(
    release: &Value,
    project: &Value,
    target: &Value,
    metadata: &Value,
    units: &[Value],
    syntax_capability: &str,
) -> Result<Value, &'static str> {
    let mut verified_release = release.clone();
    let files = verified_release["files"]
        .as_array_mut()
        .ok_or("RELEASE_INTEGRITY_FAILED")?;
    for f in files {
        f["validationStatus"] = "VALID".into();
    }
    if !crate::release::verify(&verified_release) {
        return Err("RELEASE_INTEGRITY_FAILED");
    }
    if units.len() > MAX_PLAN_STATEMENTS {
        return Err("VALIDATION_TOO_LARGE");
    }
    let owner = target["exactOwner"]
        .as_str()
        .ok_or("VALIDATION_EVIDENCE_UNAVAILABLE")?;
    let engine = target["engine"]
        .as_str()
        .ok_or("VALIDATION_EVIDENCE_UNAVAILABLE")?;
    let reviewed =
        review::statements(&json!(units), owner, engine).ok_or("VALIDATION_TOO_LARGE")?;
    let reviewed = review::catalog_context(
        &reviewed,
        owner,
        &metadata["schemaSnapshot"],
        &metadata["identityDigest"],
    )
    .ok_or("VALIDATION_EVIDENCE_UNAVAILABLE")?;
    let mut metadata = metadata.clone();
    if let Some(snapshot) = metadata["schemaSnapshot"].as_object_mut() {
        snapshot.shift_remove("objects");
    }
    let mut findings = Vec::new();
    for s in units {
        let scope = schema_scope::assess(
            s["sourceSql"]
                .as_str()
                .ok_or("VALIDATION_EVIDENCE_UNAVAILABLE")?,
            owner,
            false,
        );
        if scope["eligible"] != true {
            findings.push(json!({"code":scope["code"],"severity":"BLOCKING","rationale":format!("Statement {} is outside the automatic execution subset. Only scoped scalar CREATE TABLE, ALTER TABLE ADD columns and simple local indexes are supported. Approval cannot override this policy.",s["ordinal"])}));
            break;
        }
    }
    if release["validation_status"] != "VALID" {
        findings.push(json!({"code":"SYNTAX_NOT_VALID","severity":"BLOCKING","rationale":"The retained parser result does not establish valid Oracle syntax."}));
    }
    if metadata["accessible"] != true {
        findings.push(json!({"code":"SCHEMA_VISIBILITY_UNVERIFIED","severity":"UNKNOWN","rationale":"The target schema has no current observed visibility evidence."}));
    }
    findings.push(if metadata["schemaSnapshot"].is_object(){json!({"code":"SCHEMA_STRUCTURE_OBSERVED","severity":"UNKNOWN","rationale":format!("Immutable schema snapshot {} provides structural context ({}). Visibility and collection consistency limitations remain; Oracle compilation and privileges are unverified.",metadata["schemaSnapshot"]["id"].as_str().unwrap_or_default(),metadata["schemaSnapshot"]["provenance"].as_str().unwrap_or_default())})}else{json!({"code":"OBJECT_METADATA_UNAVAILABLE","severity":"UNKNOWN","rationale":"No object snapshot is retained. Existing objects, columns, constraints and privileges were not observed."})});
    let blocking = findings.iter().any(|f| f["severity"] == "BLOCKING")
        || reviewed.as_array().into_iter().flatten().any(|s| {
            s["findings"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|f| f["severity"] == "BLOCKING")
        });
    let target_fields = [
        "bindingId",
        "bindingRevision",
        "assignmentId",
        "assignmentRevision",
        "profileId",
        "environmentId",
        "exactOwner",
        "identityState",
        "observationDigest",
        "policyId",
        "policyRevision",
    ];
    let target_facts: Value = target_fields
        .iter()
        .map(|k| ((*k).to_owned(), target[*k].clone()))
        .collect();
    let statements: Vec<_> = units
        .iter()
        .zip(
            reviewed
                .as_array()
                .ok_or("VALIDATION_EVIDENCE_UNAVAILABLE")?,
        )
        .map(|(unit, s)| {
            let mut row: Value = [
                "ordinal",
                "path",
                "fileOrdinal",
                "startByte",
                "endByte",
                "sourceSha256",
                "executionSha256",
            ]
            .iter()
            .map(|k| ((*k).to_owned(), unit[*k].clone()))
            .collect();
            for (k, v) in s.as_object().expect("review object") {
                row[k] = v.clone();
            }
            row
        })
        .collect();
    let report = json!({"format":1,"profile":PROFILE,"reviewProfile":review::profile(),"projectId":project["id"],"releaseId":release["id"],"sourceBindingGeneration":project["source_binding_generation"],"manifestDigest":release["manifest_digest"],"parserProfile":release["parser_profile"],"target":target_facts,"metadata":metadata,"capabilities":{"engine":engine,"syntax":if engine=="oracle"{syntax_capability}else{"UNSUPPORTED"},"schema":"OWNER_VISIBILITY_AND_BOUNDED_REFERENCE_REVIEW","objects":"UNVERIFIED","semantics":"UNVERIFIED"},"syntax":if release["validation_status"]=="VALID"{"VALID"}else{"INVALID_OR_UNAVAILABLE"},"outcome":if blocking{"BLOCKED"}else{"UNVERIFIED"},"policy":{"id":target["policyId"],"revision":target["policyRevision"],"decision":if blocking{"BLOCKED"}else{"INDEPENDENT_REVIEW_REQUIRED"},"executionAuthority":false},"findings":findings,"statements":statements});
    let envelope = report.to_string();
    if envelope.len() > MAX_BYTES {
        return Err("VALIDATION_TOO_LARGE");
    }
    Ok(json!({"envelope":envelope,"digest":sha256(&envelope),"report":report}))
}

pub fn verify(envelope: &str, hash: &str, expected: &Value) -> Option<Value> {
    if envelope.len() > MAX_BYTES || !digest(&json!(hash)) || sha256(envelope) != hash {
        return None;
    }
    let report: Value = serde_json::from_str(envelope).ok()?;
    if report["format"] != 1
        || report["profile"] != PROFILE
        || !js_equal(&report["reviewProfile"], &review::profile())
        || !["BLOCKED", "UNVERIFIED"]
            .iter()
            .any(|v| report["outcome"] == *v)
        || report["statements"].as_array()?.len() > MAX_PLAN_STATEMENTS
        || report["policy"]["executionAuthority"] != false
        || expected
            .as_object()?
            .iter()
            .any(|(key, value)| report.get(key).is_none_or(|v| !js_equal(v, value)))
    {
        return None;
    }
    Some(report)
}

pub fn for_intent(report: &Value, intent: &Value) -> bool {
    if !report.is_object()
        || !intent["target"].is_object()
        || report["policy"]["decision"] != "INDEPENDENT_REVIEW_REQUIRED"
        || report["outcome"] != "UNVERIFIED"
    {
        return false;
    }
    for key in ["projectId", "releaseId", "manifestDigest", "parserProfile"] {
        if report[key] != intent[key] {
            return false;
        }
    }
    if report["capabilities"]["engine"] != intent["engine"]
        || report["sourceBindingGeneration"] != intent["target"]["sourceBindingGeneration"]
        || report["metadata"]["evidenceDigest"] != intent["target"]["observationDigest"]
    {
        return false;
    }
    for key in ["profileId", "environmentId"] {
        if report["target"][key] != intent[key] {
            return false;
        }
    }
    for key in [
        "bindingId",
        "bindingRevision",
        "assignmentId",
        "assignmentRevision",
        "observationDigest",
        "exactOwner",
        "policyId",
        "policyRevision",
    ] {
        if report["target"][key] != intent["target"][key] {
            return false;
        }
    }
    let Some(rows) = report["statements"].as_array() else {
        return false;
    };
    let identities: Value = rows
        .iter()
        .map(|s| {
            [
                "ordinal",
                "path",
                "fileOrdinal",
                "startByte",
                "endByte",
                "sourceSha256",
                "executionSha256",
            ]
            .iter()
            .map(|k| ((*k).to_owned(), s[*k].clone()))
            .collect::<Value>()
        })
        .collect();
    js_equal(&identities, &intent["statements"])
}
