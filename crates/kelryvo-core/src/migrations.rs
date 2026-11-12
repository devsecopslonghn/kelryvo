//! Exact-prefix migration selection; central metadata cannot attest target history.
use crate::{MAX_RELEASE_FILES, digest, evidence_digest, matches, string};
use serde_json::{Value, json};

pub fn approved_identities(intent: &Value) -> Option<Value> {
    let statements = intent["statements"].as_array()?;
    let items = intent["items"].as_array()?;
    items
        .iter()
        .map(|item| {
            let matching: Vec<_> = statements
                .iter()
                .filter(|s| s["path"] == item["path"])
                .collect();
            let rows = Value::Array(
                matching
                    .iter()
                    .map(|s| {
                        json!([
                            s["fileOrdinal"],
                            s["startByte"],
                            s["endByte"],
                            s["sourceSha256"],
                            s["executionSha256"]
                        ])
                    })
                    .collect(),
            );
            let mut result = Value::Object(item.as_object()?.clone());
            result["statementManifestDigest"] = evidence_digest(&rows).into();
            result["statementDigests"] = matching
                .iter()
                .map(|s| s["executionSha256"].clone())
                .collect();
            Some(result)
        })
        .collect::<Option<Vec<_>>>()
        .map(Value::Array)
}

pub fn select_pending(migrations: &Value, observation: &Value) -> Option<Value> {
    let migrations = migrations.as_array()?;
    let applied = observation["appliedMigrations"].as_array()?;
    if observation["historyFormat"] != 1
        || applied.len() > MAX_RELEASE_FILES
        || applied.len() > migrations.len()
    {
        return None;
    }
    let mut accepted = Vec::new();
    for (row, expected) in applied.iter().zip(migrations) {
        if row["outcome"] != "APPLIED"
            || !matches(
                r"(?i)\A[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\z",
                string(&row["approvalReference"]),
            )
            || !digest(&row["intentDigest"])
            || ["path", "version", "sha256", "statementManifestDigest"]
                .iter()
                .any(|k| row[k] != expected[k])
            || row["statementDigests"].as_array()? != expected["statementDigests"].as_array()?
        {
            return None;
        }
        let mut result = Value::Object(expected.as_object()?.clone());
        result["outcome"] = "APPLIED".into();
        result["approvalReference"] = row["approvalReference"].clone();
        result["intentDigest"] = row["intentDigest"].clone();
        accepted.push(result);
    }
    let count = applied.len();
    let state = if count == 0 {
        "EMPTY"
    } else if count == migrations.len() {
        "EXACT_APPLIED"
    } else {
        "APPLIED_PREFIX"
    };
    if observation["historyState"] != state {
        return None;
    }
    let mut pending = Vec::new();
    for migration in &migrations[count..] {
        pending.extend_from_slice(migration["statementDigests"].as_array()?);
    }
    if observation["pendingStatementDigests"].as_array()? != &pending {
        return None;
    }
    let mut statement_count = 0;
    for migration in &migrations[..count] {
        statement_count += migration["statementDigests"].as_array()?.len();
    }
    Some(
        json!({"appliedMigrations":accepted,"appliedMigrationCount":count,"appliedStatementCount":statement_count,
        "pendingStatementDigests":pending,"pendingManifestDigest":evidence_digest(&json!(&migrations[count..]))}),
    )
}
