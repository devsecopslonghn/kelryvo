//! Canonical query positions, scoped to the authenticated caller's context.
use crate::{js_len, matches, string, utc_time};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};

pub fn encode_migration(project: &str, filters: &Value, row: &Value) -> String {
    URL_SAFE_NO_PAD.encode(
        json!({"projectId":project,"filters":filters,"at":row["at"],"id":row["id"]}).to_string(),
    )
}
pub fn decode_migration(cursor: &str, project: &str, filters: &Value) -> Option<Value> {
    if cursor.is_empty() || cursor.len() > 2048 || !matches(r"\A[A-Za-z0-9_-]+\z", cursor) {
        return None;
    }
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::URL_SAFE,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::RequireNone),
    );
    let bytes = engine.decode(cursor).ok()?;
    let value: Value = serde_json::from_str(&String::from_utf8_lossy(&bytes)).ok()?;
    let keys = value.as_object()?;
    let f = value["filters"].as_object()?;
    if keys.len() != 4
        || !["projectId", "filters", "at", "id"]
            .iter()
            .all(|k| keys.contains_key(*k))
        || value["projectId"] != project
        || !crate::uuid(&value["projectId"])
        || f.len() != 3
        || !["targetId", "status", "q"]
            .iter()
            .all(|k| f.contains_key(*k))
        || serde_json::to_string(&value["filters"]).ok()? != serde_json::to_string(filters).ok()?
        || !value["filters"]["targetId"].is_null() && !crate::uuid(&value["filters"]["targetId"])
        || !value["filters"]["status"].is_null()
            && !matches(
                r"\A[A-Z][A-Z0-9_]{0,63}\z",
                string(&value["filters"]["status"]),
            )
        || !value["filters"]["q"].is_null()
            && value["filters"]["q"]
                .as_str()
                .is_none_or(|s| js_len(s) > 120)
        || value["id"].as_str().is_none_or(|s| js_len(s) > 80)
        || !matches(
            r"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})\z",
            string(&value["at"]),
        )
        || chrono::DateTime::parse_from_rfc3339(string(&value["at"])).is_err()
    {
        return None;
    }
    Some(value)
}

/// Execution cursors retain the older opaque object shape and caller binding.
pub fn encode_execution(actor: &str, scope: &str, kind: &str, row: &Value) -> Option<String> {
    let value = match kind {
        "jobs" => {
            json!({"actorId":actor,"scopeId":scope,"kind":kind,"id":row["id"],"createdAt":row["cursor_time"]})
        }
        "events" => {
            json!({"actorId":actor,"scopeId":scope,"kind":kind,"revision":row["revision"].as_str().map(str::to_owned).unwrap_or_else(||row["revision"].to_string())})
        }
        _ => return None,
    };
    Some(URL_SAFE_NO_PAD.encode(value.to_string()))
}
pub fn decode_execution(cursor: &str, actor: &str, scope: &str, kind: &str) -> Option<Value> {
    if cursor.is_empty() || cursor.len() > 1024 || !matches(r"\A[A-Za-z0-9_-]+\z", cursor) {
        return None;
    }
    // Retained Buffer decoding accepts aliased trailing bits. The decoded fields
    // are still fully checked and bound to the presenting actor and resource.
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::URL_SAFE,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::RequireNone),
    );
    let value: Value = serde_json::from_slice(&engine.decode(cursor).ok()?).ok()?;
    if value["actorId"] != actor || value["scopeId"] != scope || value["kind"] != kind {
        return None;
    }
    match kind {
        "jobs" => decode_audit(
            &encode_audit(
                &json!({"projectId":scope,"action":null,"id":value["id"],"createdAt":value["createdAt"]}),
            ),
            scope,
            &Value::Null,
        ),
        "events"
            if value["revision"].as_str().is_some_and(|s| {
                matches(r"\A(?:0|[1-9][0-9]{0,18})\z", s) && s.parse::<i64>().is_ok()
            }) =>
        {
            Some(json!({"revision":value["revision"]}))
        }
        _ => None,
    }
}

pub fn encode_attempt(
    actor: &str,
    job: &str,
    attempt: &Value,
    kind: &str,
    position: &str,
) -> String {
    URL_SAFE_NO_PAD.encode(
        json!({"actorId":actor,"jobId":job,"attemptId":attempt,"kind":kind,"position":position})
            .to_string(),
    )
}
pub fn decode_attempt(
    cursor: &str,
    actor: &str,
    job: &str,
    attempt: &Value,
    kind: &str,
) -> Option<i64> {
    if cursor.is_empty() || cursor.len() > 1024 || !matches(r"\A[A-Za-z0-9_-]+\z", cursor) {
        return None;
    }
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::URL_SAFE,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::RequireNone),
    );
    let row: Value = serde_json::from_slice(&engine.decode(cursor).ok()?).ok()?;
    if row.as_object()?.len() != 5
        || row["actorId"] != actor
        || row["jobId"] != job
        || row["attemptId"] != *attempt
        || row["kind"] != kind
        || !["attempts", "events", "receipts"].contains(&kind)
    {
        return None;
    }
    let text = row["position"].as_str()?;
    if !matches(r"\A(?:0|[1-9][0-9]{0,18})\z", text) {
        return None;
    }
    let n = text.parse::<i64>().ok()?;
    if kind != "events" && n == 0 || kind == "receipts" && n > i64::from(i32::MAX) {
        return None;
    }
    Some(n)
}

fn decode(value: &str, limit: usize) -> Option<(String, Value)> {
    if value.is_empty() || value.len() > limit || !matches(r"\A[A-Za-z0-9_-]+\z", value) {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
    if URL_SAFE_NO_PAD.encode(&bytes) != value {
        return None;
    }
    let source = String::from_utf8(bytes).ok()?;
    let parsed = serde_json::from_str(&source).ok()?;
    Some((source, parsed))
}

fn lower_uuid(value: &Value) -> bool {
    matches(
        r"\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z",
        string(value),
    )
}

pub fn encode_audit(position: &Value) -> String {
    URL_SAFE_NO_PAD.encode(json!({"v":1,"p":position["projectId"],"a":position["action"],"t":position["createdAt"],"i":position["id"]}).to_string())
}

pub fn decode_audit(cursor: &str, project_id: &str, action: &Value) -> Option<Value> {
    let (source, value) = decode(cursor, 1024)?;
    if value
        .as_object()?
        .keys()
        .map(String::as_str)
        .collect::<Vec<_>>()
        != ["v", "p", "a", "t", "i"]
        || serde_json::to_string(&value).ok()? != source
        || value["v"] != 1
        || value["p"] != project_id
        || &value["a"] != action
        || !(value["a"].is_null() || matches(r"\A[A-Z][A-Z0-9_]{0,63}\z", string(&value["a"])))
        || !utc_time(string(&value["t"]), 6)
        || !lower_uuid(&value["i"])
    {
        return None;
    }
    Some(json!({"createdAt":value["t"],"id":value["i"]}))
}

pub const REVIEW_SCOPES: &[&str] = &["ALL", "MINE", "ELIGIBLE"];

pub fn encode_review(position: &Value) -> Option<String> {
    if !lower_uuid(&position["id"])
        || !utc_time(string(&position["createdAt"]), 6)
        || !REVIEW_SCOPES.contains(&string(&position["scope"]))
        || position["actor"]
            .as_str()
            .is_none_or(|s| s.is_empty() || js_len(s) > 200)
    {
        return None;
    }
    Some(URL_SAFE_NO_PAD.encode(json!({"v":1,"actor":position["actor"],"scope":position["scope"],"createdAt":position["createdAt"],"id":position["id"]}).to_string()))
}

pub fn decode_review(cursor: &str, actor: &str, scope: &str) -> Option<Value> {
    let (source, value) = decode(cursor, 2048)?;
    if value.as_object()?.len() != 5 || value["v"] != 1 || value["actor"] != actor || value["scope"] != scope
        || value["actor"].as_str().is_none_or(|s| js_len(s) > 200)
        || serde_json::to_string(&json!({"v":value["v"],"actor":value["actor"],"scope":value["scope"],"createdAt":value["createdAt"],"id":value["id"]})).ok()? != source
        || !utc_time(string(&value["createdAt"]), 6) || !lower_uuid(&value["id"]) { return None; }
    Some(json!({"createdAt":value["createdAt"],"id":value["id"]}))
}
