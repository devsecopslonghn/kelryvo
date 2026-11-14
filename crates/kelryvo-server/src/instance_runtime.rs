//! Public installation metadata. A native record may select a writer profile;
//! it is never authority to connect, admit a job or dispatch Oracle statements.
use crate::{ApiError, ORG_UUID, plans};
use kelryvo_core::workspace::positive_revision;
use kelryvo_core::{NATIVE_ORACLE_DRIVER_PROFILE, evidence, schema_scope};
use serde_json::Value;
use sqlx::PgConnection;
use std::collections::HashSet;
use uuid::Uuid;
pub fn normalize(record: &Value) -> Option<Value> {
    if record.as_object()?.len() != 4
        || record["format"] != 2
        || record["driverProfile"] != NATIVE_ORACLE_DRIVER_PROFILE
        || !kelryvo_core::digest(&record["workerArtifactDigest"])
    {
        return None;
    }
    let d = &record["descriptor"];
    let fields = [
        "sqlProfile",
        "format",
        "connectionId",
        "connectionRevision",
        "metadataGenerationId",
        "sourceSha",
        "imageDigest",
        "installationDigest",
        "identity",
        "writerUsername",
        "writerCredentialRef",
        "schemaOwners",
        "protectedOwners",
        "expiresAt",
        "operatorOsUid",
    ];
    if d.as_object()?.len() != fields.len()
        || fields.iter().any(|k| d.get(*k).is_none())
        || d["format"] != 1
        || d["sqlProfile"] != "ORACLE26_NUMBER_VARCHAR2_BYTE_V1"
        || d["operatorOsUid"] != 0
        || plans::id(&d["connectionId"]).is_err()
        || plans::id(&d["metadataGenerationId"]).is_err()
        || positive_revision(d["connectionRevision"].as_str()?).is_none()
        || !d["sourceSha"].as_str().is_some_and(|s| {
            s.len() == 40
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        || !d["imageDigest"]
            .as_str()?
            .strip_prefix("sha256:")
            .is_some_and(|s| kelryvo_core::digest(&Value::String(s.into())))
        || !kelryvo_core::digest(&d["installationDigest"])
        || evidence::exact_identity(&d["identity"]).as_ref() != Some(&d["identity"])
        || !owner(d["writerUsername"].as_str()?)
        || d["writerCredentialRef"]
            != format!(
                "secret://kelryvo-runtime/{}/writer",
                d["connectionId"].as_str()?
            )
    {
        return None;
    }
    let schemas = d["schemaOwners"].as_array()?;
    let protected = d["protectedOwners"].as_array()?;
    if schemas.is_empty()
        || schemas.len() > 50
        || protected.len() > 500
        || schemas.iter().any(|s| {
            !s.as_str().is_some_and(owner) || *s == d["writerUsername"] || protected.contains(s)
        })
        || schemas
            .iter()
            .filter_map(Value::as_str)
            .collect::<HashSet<_>>()
            .len()
            != schemas.len()
        || protected.iter().any(|v| !kelryvo_core::plan::text(v, 128))
    {
        return None;
    }
    let expiry = chrono::DateTime::parse_from_rfc3339(d["expiresAt"].as_str()?).ok()?;
    if expiry.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) != d["expiresAt"] {
        return None;
    }
    Some(d.clone())
}
fn owner(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 30
        && s.bytes()
            .enumerate()
            .all(|(n, b)| b.is_ascii_uppercase() || n > 0 && (b.is_ascii_digit() || b == b'_'))
        && schema_scope::is_application_owner(s)
        && ![
            "ADMIN",
            "ADBSNMP",
            "ADB_APP_STORE",
            "DCAT_ADMIN",
            "GGADMIN",
            "RMAN$CATALOG",
            "RMAN$VPC",
        ]
        .contains(&s)
}
pub async fn current(
    tx: &mut PgConnection,
    connection: Uuid,
    revision: &Value,
) -> Result<Option<Value>, ApiError> {
    let row:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('facts',CASE WHEN octet_length(a.facts::text)<=262144 THEN a.facts END,'generation_id',g.id,'state',g.state) FROM sf_database_connection_audit a JOIN sf_metadata_current mc ON mc.singleton JOIN sf_metadata_generations g ON g.id=mc.generation_id WHERE a.organization_id=$1 AND a.connection_id=$2 AND a.action='INSTANCE_RUNTIME_INSTALLED' AND a.actor_id IS NULL ORDER BY a.created_at DESC,a.id DESC LIMIT 1").bind(ORG_UUID).bind(connection).fetch_optional(tx).await?;
    let Some(row) = row else { return Ok(None) };
    let Some(d) = normalize(&row["facts"]) else {
        return Ok(None);
    };
    let current = row["state"] == "ACTIVE"
        && d["sourceSha"]
            .as_str()
            .is_some_and(kelryvo_core::build_identity::matches_source)
        && d["metadataGenerationId"] == row["generation_id"]
        && d["connectionId"] == connection.to_string()
        && d["connectionRevision"].as_str()
            == revision
                .as_str()
                .map(str::to_owned)
                .or_else(|| revision.as_i64().map(|n| n.to_string()))
                .as_deref()
        && chrono::DateTime::parse_from_rfc3339(d["expiresAt"].as_str().unwrap_or_default())
            .is_ok_and(|d| d > chrono::Utc::now());
    Ok(current.then_some(d))
}
