//! Small, byte-exact review references. Clients cannot supply retained facts.
use serde_json::{Value, json};
use std::collections::HashSet;

pub fn validate(value: &Value) -> bool {
    let Some(items) = value.as_array() else {
        return false;
    };
    if items.len() > 8 || value.to_string().len() > 48 * 1024 {
        return false;
    }
    let mut seen = HashSet::new();
    items.iter().all(|item| {
        let Some(keys) = item.as_object() else {
            return false;
        };
        let path = crate::string(&item["filePath"]);
        keys.len() == 5
            && keys.keys().all(|k| {
                [
                    "filePath",
                    "startByte",
                    "endByte",
                    "sourceSha256",
                    "executionSha256",
                ]
                .contains(&k.as_str())
            })
            && !path.is_empty()
            && path.len() <= 4096
            && crate::matches(r"\A[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\z", path)
            && !path.split('/').any(|part| part == "." || part == "..")
            && crate::safe_integer(&item["startByte"]).is_some()
            && crate::safe_integer(&item["endByte"])
                .is_some_and(|end| end > item["startByte"].as_u64().unwrap_or(u64::MAX))
            && crate::digest(&item["sourceSha256"])
            && crate::digest(&item["executionSha256"])
            && seen.insert(
                json!([
                    item["filePath"],
                    item["startByte"],
                    item["endByte"],
                    item["sourceSha256"],
                    item["executionSha256"]
                ])
                .to_string(),
            )
    })
}

/// `statements` are rederived by the pinned parser from a verified release.
pub fn resolve(refs: &Value, release: &Value, digest: &Value, statements: &Value) -> Option<Value> {
    if !validate(refs) || !crate::digest(digest) {
        return None;
    }
    let files = release["files"].as_array()?;
    let statements = statements.as_array()?;
    let mut result = Vec::new();
    for reference in refs.as_array()? {
        let matches: Vec<_> = files
            .iter()
            .filter(|f| f["path"] == reference["filePath"])
            .collect();
        if matches.len() != 1
            || !statements.iter().any(|s| {
                s["path"] == reference["filePath"]
                    && ["startByte", "endByte", "sourceSha256", "executionSha256"]
                        .iter()
                        .all(|k| s[k] == reference[k])
            })
        {
            return None;
        }
        result.push(json!({"releaseId":release["id"],"filePath":reference["filePath"],"startByte":reference["startByte"],"endByte":reference["endByte"],"sourceSha256":reference["sourceSha256"],"executionSha256":reference["executionSha256"],"sourceFileSha256":matches[0]["sha256"],"parserProfile":release["parser_profile"],"intentDigest":digest}));
    }
    let result = json!(result);
    (result.to_string().len() <= 48 * 1024).then_some(result)
}
