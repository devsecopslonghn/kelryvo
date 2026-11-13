//! Oracle evidence validation and stable physical-container identity.
use crate::{digest, evidence_digest, matches, string, text};
use chrono::{DateTime, NaiveDate, SecondsFormat, Utc};
use serde_json::{Value, json};
use std::collections::HashSet;

fn number(value: &Value) -> bool {
    matches(r"\A[1-9][0-9]{0,19}\z", string(value))
}

pub fn exact_identity(raw: &Value) -> Option<Value> {
    if raw["engine"] != "oracle"
        || !number(&raw["dbid"])
        || !text(&raw["dbUniqueName"], 128)
        || !number(&raw["resetlogsChange"])
        || !number(&raw["containerDbid"])
        || !matches(r"\A(?:0|[1-9][0-9]{0,9})\z", string(&raw["containerId"]))
        || ["containerName", "serviceName", "version"]
            .iter()
            .any(|f| !text(&raw[f], 128))
    {
        return None;
    }
    let cdb = raw["cdb"].as_bool()?;
    if cdb {
        if !matches(r"\A[A-F0-9]{32}\z", string(&raw["containerGuid"]))
            || raw["containerId"].as_str()?.parse::<u64>().ok()? < 3
        {
            return None;
        }
    } else if raw.get("containerGuid")? != &Value::Null
        || raw["containerId"] != "0"
        || raw["containerDbid"] != raw["dbid"]
    {
        return None;
    }
    Some(
        json!({"engine":"oracle","dbid":raw["dbid"],"dbUniqueName":raw["dbUniqueName"],"resetlogsChange":raw["resetlogsChange"],
        "cdb":cdb,"containerId":raw["containerId"],"containerGuid":raw["containerGuid"],"containerDbid":raw["containerDbid"],
        "containerName":raw["containerName"],"serviceName":raw["serviceName"],"version":raw["version"]}),
    )
}

pub fn identity_digest(identity: &Value) -> String {
    evidence_digest(
        &json!({"engine":identity["engine"],"dbid":identity["dbid"],"dbUniqueName":identity["dbUniqueName"],
        "resetlogsChange":identity["resetlogsChange"],"cdb":identity["cdb"],"containerGuid":identity["containerGuid"],"containerDbid":identity["containerDbid"]}),
    )
}

pub fn physical_target_key(identity: &Value) -> Option<String> {
    let exact = exact_identity(identity)?;
    let cdb = exact["cdb"].as_bool()?;
    Some(format!(
        "oracle-container-v1:{}",
        evidence_digest(&json!([
            exact["engine"],
            exact["dbUniqueName"],
            exact["dbid"],
            if cdb { "CDB_PDB" } else { "NON_CDB" },
            if cdb {
                &exact["containerGuid"]
            } else {
                &exact["containerDbid"]
            }
        ]))
    ))
}

fn parse_time(source: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(source)
        .map(|t| t.with_timezone(&Utc))
        .ok()
        .or_else(|| {
            NaiveDate::parse_from_str(source, "%Y-%m-%d")
                .ok()?
                .and_hms_opt(0, 0, 0)
                .map(|t| t.and_utc())
        })
}

pub fn accepted_observation(
    identity: &Value,
    attestation: &Value,
    owner: Option<&str>,
    now: DateTime<Utc>,
) -> bool {
    let Some(exact) = exact_identity(identity) else {
        return false;
    };
    let Some(accepted_at) = parse_time(string(&attestation["acceptedAt"])) else {
        return false;
    };
    let Some(owners) = attestation["schemaOwners"].as_array() else {
        return false;
    };
    matches(
        r"\A[A-Za-z0-9._:-]{1,128}\z",
        string(&attestation["authorizedLabId"]),
    ) && accepted_at <= now
        && ["evidenceDigest", "manifestDigest", "targetConfigDigest"]
            .iter()
            .all(|f| digest(&attestation[f]))
        && !owners.is_empty()
        && owners.len() <= 500
        && owners.iter().all(|v| text(v, 128))
        && owners.iter().map(string).collect::<HashSet<_>>().len() == owners.len()
        && owner.is_none_or(|o| owners.iter().any(|v| v == o))
        && attestation["expectedIdentityDigest"] == evidence_digest(&exact)
}

pub fn normalize_observation(raw: &Value, operation: &str, now: DateTime<Utc>) -> Value {
    const STATUSES: &[&str] = &[
        "CONNECTED",
        "OBSERVED",
        "PARTIAL",
        "UNREACHABLE",
        "UNAUTHORIZED",
        "MISCONFIGURED",
        "TIMEOUT",
        "UNAVAILABLE",
    ];
    if !STATUSES.contains(&string(&raw["status"])) {
        return json!({"status":"UNAVAILABLE","identity":null,"identityDigest":null,"schemas":[],"limitations":["INVALID_ENGINE_EVIDENCE"],"provenance":"UNAVAILABLE"});
    }
    let provenance = if ["ORACLE_READ_ONLY", "FIXTURE"].contains(&string(&raw["provenance"])) {
        string(&raw["provenance"])
    } else {
        "UNAVAILABLE"
    };
    let discover =
        operation == "DISCOVER" && ["OBSERVED", "PARTIAL"].contains(&string(&raw["status"]));
    let identity = if discover {
        exact_identity(&raw["identity"])
    } else {
        None
    };
    let schemas: Vec<_> = if discover {
        raw["schemas"]
            .as_array()
            .map(|schemas| {
                schemas
                    .iter()
                    .take(500)
                    .filter(|s| {
                        text(&s["owner"], 128)
                            && s.get("accessible")
                                .is_some_and(|a| a.is_boolean() || a.is_null())
                    })
                    .map(|s| json!({"owner":s["owner"],"accessible":s["accessible"]}))
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    const CODES: &[&str] = &[
        "INSUFFICIENT_METADATA_PRIVILEGES",
        "SCHEMA_VISIBILITY_LIMITED",
        "INVENTORY_TRUNCATED",
        "IDENTITY_INCOMPLETE",
        "LIVE_VERIFICATION_UNACCEPTED",
        "ENGINE_UNSUPPORTED",
        "RUNTIME_UNAVAILABLE",
        "ENDPOINT_NOT_AUTHORIZED",
        "SECRET_UNAVAILABLE",
        "ROOT_CONTAINER_UNSUPPORTED",
        "IDENTITY_MISMATCH",
    ];
    let mut limitations: Vec<&str> = Vec::new();
    if let Some(codes) = raw["limitations"].as_array() {
        for value in codes {
            let code = string(value);
            if CODES.contains(&code) && !limitations.contains(&code) && limitations.len() < 10 {
                limitations.push(code);
            }
        }
    }
    if discover && identity.is_none() && !limitations.contains(&"IDENTITY_INCOMPLETE") {
        limitations.push("IDENTITY_INCOMPLETE");
    }
    if provenance == "FIXTURE" && !limitations.contains(&"LIVE_VERIFICATION_UNACCEPTED") {
        limitations.push("LIVE_VERIFICATION_UNACCEPTED");
    }
    let attestation = &raw["verificationAcceptance"];
    let verification = if provenance == "ORACLE_READ_ONLY"
        && accepted_observation(
            identity.as_ref().unwrap_or(&Value::Null),
            attestation,
            None,
            now,
        )
        && limitations
            .iter()
            .all(|c| *c == "SCHEMA_VISIBILITY_LIMITED")
    {
        json!({"authorizedLabId":attestation["authorizedLabId"],"acceptedAt":parse_time(string(&attestation["acceptedAt"])).expect("validated time").to_rfc3339_opts(SecondsFormat::Millis, true),
            "evidenceDigest":attestation["evidenceDigest"],"manifestDigest":attestation["manifestDigest"],"targetConfigDigest":attestation["targetConfigDigest"],
            "expectedIdentityDigest":attestation["expectedIdentityDigest"],"schemaOwners":attestation["schemaOwners"]})
    } else {
        Value::Null
    };
    json!({"status":if discover && raw["status"] == "OBSERVED" && identity.is_none() {"PARTIAL"} else {string(&raw["status"])},
        "identity":identity,"identityDigest":identity.as_ref().map(identity_digest),"schemas":schemas,"limitations":limitations,"provenance":provenance,"verificationAcceptance":verification})
}
