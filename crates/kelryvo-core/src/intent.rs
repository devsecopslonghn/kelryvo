//! Persisted format 1–4 approval envelopes. Field order is part of the digest.
use crate::{
    MAX_INPUT_BYTES, MAX_PLAN_STATEMENTS, MAX_RELEASE_FILES, MAX_STDOUT_BYTES, digest, js_len,
    matches, safe_integer, sha256, string, text, utc_time, uuid,
};
use serde_json::{Value, json};
use std::collections::HashSet;

pub const TARGET_FIELDS: &[&str] = &[
    "bindingId",
    "bindingRevision",
    "assignmentId",
    "assignmentRevision",
    "targetOptionId",
    "targetOptionRevision",
    "lineageId",
    "identityState",
    "observationDigest",
    "streamId",
    "streamState",
    "migrationNamespace",
    "exactOwner",
    "routeId",
    "routeConfigRevision",
    "routeAlias",
    "policyId",
    "policyRevision",
    "deploymentPrincipalId",
    "principalPurpose",
    "privatePrincipalRef",
    "principalAlias",
    "createdAt",
    "sourceBindingGeneration",
];
const FACT_FIELDS: &[&str] = &[
    "organizationId",
    "projectId",
    "requesterId",
    "releaseId",
    "commit",
    "objectFormat",
    "folder",
    "parserProfile",
    "manifestDigest",
    "profileId",
    "profileName",
    "environmentId",
    "environmentName",
    "engine",
    "host",
    "port",
    "service",
    "username",
    "credentialRef",
];

fn credential(value: &Value) -> bool {
    text(value, 512)
        && matches(
            r"\A(?:vault|secret)://[A-Za-z0-9._/-]{1,500}\z",
            string(value),
        )
}

fn revision(value: &Value) -> bool {
    let s = string(value);
    matches(r"\A(?:0|[1-9][0-9]*)\z", s)
        && (s.len() < 19 || s.len() == 19 && s <= "9223372036854775807")
}

fn target_tuple(target: &Value) -> Option<Value> {
    let object = target.as_object()?;
    if object.len() != TARGET_FIELDS.len() || TARGET_FIELDS.iter().any(|f| !object.contains_key(*f))
    {
        return None;
    }
    if [
        "bindingId",
        "assignmentId",
        "targetOptionId",
        "lineageId",
        "streamId",
        "routeId",
        "policyId",
        "deploymentPrincipalId",
    ]
    .iter()
    .any(|f| !uuid(&target[f]))
        || [
            "bindingRevision",
            "assignmentRevision",
            "targetOptionRevision",
            "routeConfigRevision",
            "policyRevision",
            "sourceBindingGeneration",
        ]
        .iter()
        .any(|f| !revision(&target[f]))
        || !["PROVISIONAL", "OBSERVED", "VERIFIED"].contains(&string(&target["identityState"]))
        || if target["identityState"] == "PROVISIONAL" {
            !target["observationDigest"].is_null()
        } else {
            !digest(&target["observationDigest"])
        }
        || target["streamState"] != "PROVISIONAL"
        || !text(&target["migrationNamespace"], 128)
        || !text(&target["exactOwner"], 128)
        || string(&target["exactOwner"]).len() > 128
        || string(&target["exactOwner"])
            .trim_matches(crate::js_whitespace)
            .is_empty()
        || !text(&target["routeAlias"], 200)
        || !text(&target["principalAlias"], 200)
        || target["principalPurpose"] != "DEPLOY"
        || !credential(&target["privatePrincipalRef"])
        || !utc_time(string(&target["createdAt"]), 3)
    {
        return None;
    }
    Some(TARGET_FIELDS.iter().map(|f| target[f].clone()).collect())
}

fn statement_rows(statements: &Value, items: &[Value]) -> Option<Value> {
    let statements = statements.as_array()?;
    if statements.is_empty() || statements.len() > MAX_PLAN_STATEMENTS {
        return None;
    }
    let (mut file_index, mut file_ordinal, mut previous_end, mut approximate) = (0, 0, 0, 0);
    let mut rows = Vec::new();
    for (index, s) in statements.iter().enumerate() {
        if s["path"] != items.get(file_index)?["path"] {
            if file_ordinal == 0 {
                return None;
            }
            file_index += 1;
            if s["path"] != items.get(file_index)?["path"] {
                return None;
            }
            file_ordinal = 0;
            previous_end = 0;
        }
        file_ordinal += 1;
        let start = safe_integer(&s["startByte"])?;
        let end = safe_integer(&s["endByte"])?;
        if s["ordinal"] != index + 1
            || s["fileOrdinal"] != file_ordinal
            || start < previous_end
            || end <= start
            || end > MAX_INPUT_BYTES as u64
            || !digest(&s["sourceSha256"])
            || !digest(&s["executionSha256"])
        {
            return None;
        }
        approximate += js_len(string(&s["path"])) * 6 + 220;
        if approximate > MAX_STDOUT_BYTES {
            return None;
        }
        rows.push(json!([
            s["ordinal"],
            s["path"],
            s["fileOrdinal"],
            start,
            end,
            s["sourceSha256"],
            s["executionSha256"]
        ]));
        previous_end = end;
    }
    (file_index == items.len() - 1).then(|| Value::Array(rows))
}

pub fn encode(facts: &Value) -> Option<Value> {
    let object = facts.as_object()?;
    if [
        "organizationId",
        "projectId",
        "releaseId",
        "profileId",
        "environmentId",
    ]
    .iter()
    .any(|f| !uuid(&facts[f]))
        || !text(&facts["requesterId"], 200)
        || !["sha1", "sha256"].contains(&string(&facts["objectFormat"]))
        || !matches(r"\A[a-f0-9]+\z", string(&facts["commit"]))
        || string(&facts["commit"]).len()
            != if facts["objectFormat"] == "sha1" {
                40
            } else {
                64
            }
        || !text(&facts["folder"], 200)
        || !text(&facts["parserProfile"], MAX_INPUT_BYTES)
        || !digest(&facts["manifestDigest"])
        || !text(&facts["profileName"], 200)
        || facts["engine"] != "oracle"
        || !text(&facts["host"], 255)
        || !matches(
            r"\A(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])\z",
            string(&facts["host"]),
        )
        || !matches(r"\A[A-Za-z0-9_$#.-]{1,128}\z", string(&facts["service"]))
        || !matches(
            r"\A[A-Za-z][A-Za-z0-9_$#]{0,127}\z",
            string(&facts["username"]),
        )
        || !credential(&facts["credentialRef"])
        || !text(&facts["environmentName"], 200)
        || !(1..=65535).contains(&facts["port"].as_u64()?)
    {
        return None;
    }
    let items = facts["items"].as_array()?;
    if items.is_empty() || items.len() > MAX_RELEASE_FILES {
        return None;
    }
    let mut seen = HashSet::new();
    let mut approximate = 512;
    let mut encoded_items = Vec::new();
    for item in items {
        if !item.is_object()
            || !text(&item["path"], MAX_INPUT_BYTES)
            || !seen.insert(string(&item["path"]))
            || !text(&item["version"], MAX_INPUT_BYTES)
            || !digest(&item["sha256"])
        {
            return None;
        }
        approximate += (js_len(string(&item["path"])) + js_len(string(&item["version"]))) * 6 + 160;
        if approximate > MAX_STDOUT_BYTES {
            return None;
        }
        encoded_items.push(json!([item["path"], item["version"], item["sha256"]]));
    }
    approximate += FACT_FIELDS
        .iter()
        .filter(|f| **f != "port")
        .map(|f| js_len(string(&facts[f])) * 6 + 8)
        .sum::<usize>();
    if approximate > MAX_STDOUT_BYTES {
        return None;
    }
    let mut row = vec![json!(1)];
    row.extend(FACT_FIELDS.iter().map(|f| facts[f].clone()));
    row.push(Value::Array(encoded_items));
    if object.contains_key("statements") {
        row[0] = json!(2);
        row.push(statement_rows(&facts["statements"], items)?);
    }
    if object.contains_key("target") {
        if row[0] != 2 {
            return None;
        }
        row[0] = json!(3);
        row.push(target_tuple(&facts["target"])?);
    }
    if object.contains_key("validation") {
        let validation = facts["validation"].as_object()?;
        if row[0] != 3
            || validation.len() != 2
            || !uuid(&facts["validation"]["id"])
            || !digest(&facts["validation"]["digest"])
        {
            return None;
        }
        row[0] = json!(4);
        row.push(json!([
            facts["validation"]["id"],
            facts["validation"]["digest"]
        ]));
    }
    let envelope = Value::Array(row).to_string();
    if envelope.len() > MAX_STDOUT_BYTES {
        return None;
    }
    Some(json!({"envelope":envelope,"digest":sha256(&envelope)}))
}

pub fn verify(envelope: &str, expected_digest: &str, expected: Option<&Value>) -> Option<Value> {
    if envelope.len() > MAX_STDOUT_BYTES
        || !digest(&json!(expected_digest))
        || sha256(envelope) != expected_digest
    {
        return None;
    }
    let row: Value = serde_json::from_str(envelope).ok()?;
    let values = row.as_array()?;
    let version = values.first()?.as_u64()?;
    if !(1..=4).contains(&version)
        || values.len() != 20 + version as usize
        || serde_json::to_string(&row).ok()? != envelope
    {
        return None;
    }
    let mut facts = json!({});
    for (index, field) in FACT_FIELDS.iter().enumerate() {
        facts[field] = values[index + 1].clone();
    }
    facts["items"] = values[20]
        .as_array()?
        .iter()
        .map(|v| {
            let item = v.as_array()?;
            (item.len() == 3).then(|| json!({"path":item[0],"version":item[1],"sha256":item[2]}))
        })
        .collect::<Option<Vec<_>>>()?
        .into();
    if version >= 2 {
        facts["statements"] = values[21].as_array()?.iter().map(|v| {
            let s = v.as_array()?;
            (s.len() == 7).then(|| json!({"ordinal":s[0],"path":s[1],"fileOrdinal":s[2],"startByte":s[3],"endByte":s[4],"sourceSha256":s[5],"executionSha256":s[6]}))
        }).collect::<Option<Vec<_>>>()?.into();
    }
    if version >= 3 {
        let target = values[22].as_array()?;
        if target.len() != TARGET_FIELDS.len() {
            return None;
        }
        facts["target"] = TARGET_FIELDS
            .iter()
            .zip(target)
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect();
    }
    if version == 4 {
        let validation = values[23].as_array()?;
        if validation.len() != 2 {
            return None;
        }
        facts["validation"] = json!({"id":validation[0],"digest":validation[1]});
    }
    if encode(&facts)?["envelope"] != envelope {
        return None;
    }
    let mut public = json!({"format":version,"digest":expected_digest});
    for field in [
        "organizationId",
        "projectId",
        "releaseId",
        "commit",
        "objectFormat",
        "folder",
        "parserProfile",
        "manifestDigest",
        "requesterId",
        "profileId",
        "profileName",
        "environmentId",
        "environmentName",
        "engine",
        "host",
        "port",
        "service",
        "username",
        "items",
        "statements",
        "target",
        "validation",
    ] {
        if let Some(value) = facts.get(field) {
            public[field] = value.clone();
        }
    }
    if let Some(expected) = expected
        && expected.as_object()?.iter().any(|(k, v)| {
            public.get(k).is_none_or(|actual| {
                serde_json::to_string(actual).ok() != serde_json::to_string(v).ok()
            })
        })
    {
        return None;
    }
    Some(public)
}
