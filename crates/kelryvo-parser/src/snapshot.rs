//! Deterministic Git snapshot identities for authored SQL. Git objects are
//! hashed directly; no working tree, hooks, attributes or subprocess can alter SQL.
use crate::{PROFILE, parse};
use kelryvo_core::{release, sha256, workspace};
use serde_json::{Value, json};
use sha1::{Digest, Sha1};
use std::collections::BTreeMap;

fn git_hash(kind: &str, bytes: &[u8]) -> [u8; 20] {
    let mut hash = Sha1::new();
    hash.update(format!("{kind} {}\0", bytes.len()));
    hash.update(bytes);
    hash.finalize().into()
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn tree(files: &[Value]) -> Option<[u8; 20]> {
    let mut rows = BTreeMap::new();
    for file in files {
        let path = file["path"].as_str()?;
        let content = file["sql"].as_str()?;
        let mut row = format!("100644 {path}\0").into_bytes();
        row.extend(git_hash("blob", content.as_bytes()));
        rows.insert(path, row);
    }
    Some(git_hash(
        "tree",
        &rows.into_values().flatten().collect::<Vec<_>>(),
    ))
}

pub fn authored(
    folder: &str,
    files: &[Value],
    draft_id: &str,
    revision: i64,
    manifest_version: i16,
) -> Option<Value> {
    build(folder, files, draft_id, revision, manifest_version, false).map(|(release, _)| release)
}

/// Ephemeral workspace review retains invalid native syntax as blocked evidence.
/// It never creates a release or returns partially valid statement identities.
pub fn review(
    folder: &str,
    files: &[Value],
    draft_id: &str,
    revision: i64,
    manifest_version: i16,
) -> Option<(Value, Vec<Value>)> {
    build(folder, files, draft_id, revision, manifest_version, true)
}

fn build(
    folder: &str,
    files: &[Value],
    draft_id: &str,
    revision: i64,
    manifest_version: i16,
    diagnostic: bool,
) -> Option<(Value, Vec<Value>)> {
    if folder.is_empty()
        || folder.len() > 200
        || folder.split('/').any(|p| {
            p.is_empty()
                || !p
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        || uuid_invalid(draft_id)
        || revision < 1
        || ![1, 2].contains(&manifest_version)
        || files.is_empty()
        || files.len() > 128
    {
        return None;
    }
    let normalized = workspace::normalize_files(&json!(files), true)?;
    if normalized != files {
        return None;
    }
    let mut tree_hash = tree(files)?;
    for part in folder.rsplit('/') {
        let mut row = format!("40000 {part}\0").into_bytes();
        row.extend(tree_hash);
        tree_hash = git_hash("tree", &row);
    }
    let commit_bytes = format!(
        "tree {}\nauthor Kelryvo SQL Workspace <sql-workspace@invalid.invalid> 946684800 +0000\ncommitter Kelryvo SQL Workspace <sql-workspace@invalid.invalid> 946684800 +0000\n\nKelryvo SQL snapshot {draft_id} revision {revision}\n",
        hex(&tree_hash)
    );
    let commit = hex(&git_hash("commit", commit_bytes.as_bytes()));
    let mut retained = Vec::new();
    let mut manifest_files = Vec::new();
    let mut units = Vec::new();
    let mut valid = true;
    for (order, file) in files.iter().enumerate() {
        let sql = file["sql"].as_str()?;
        if sql.is_empty() {
            return None;
        }
        let parsed = parse(sql.as_bytes()).ok().filter(|p| p.statement_count > 0);
        if parsed.is_none() && !diagnostic {
            return None;
        }
        valid &= parsed.is_some();
        let path = format!("{folder}/{}", file["path"].as_str()?);
        if let Some(parsed) = &parsed {
            for (index, s) in parsed.statements.iter().enumerate() {
                units.push(json!({"ordinal":units.len()+1,"path":path,"fileOrdinal":index+1,"startByte":s.start_byte,"endByte":s.end_byte,"sourceSha256":s.source_sha256,"executionSha256":s.execution_sha256,"sourceSql":sql.get(s.start_byte..s.end_byte)?}));
            }
        }
        let mut retained_file = json!({"path":path,"version":file["version"],"sha256":sha256(sql),"bytes":sql.len(),"content":sql,"statementCount":parsed.as_ref().map(|p|p.statement_count),"validationStatus":if parsed.is_some(){"VALID"}else{"INVALID"}});
        let manifest_file = if manifest_version == 2 {
            retained_file["draftFileId"] = file["id"].clone();
            retained_file["order"] = order.into();
            json!({"id":file["id"],"path":path,"version":file["version"],"order":order,"sha256":sha256(sql),"bytes":sql.len()})
        } else {
            json!({"path":path,"version":file["version"],"sha256":sha256(sql),"bytes":sql.len()})
        };
        retained.push(retained_file);
        manifest_files.push(manifest_file);
    }
    let manifest = json!({"format":manifest_version,"commit":commit,"objectFormat":"sha1","folder":folder,"parserProfile":PROFILE,"files":manifest_files});
    let result = json!({"commit_id":commit,"object_format":"sha1","folder":folder,"parser_profile":PROFILE,"manifest_digest":sha256(manifest.to_string()),"files":retained,"validation_status":if valid{"VALID"}else{"INVALID"},"validation_code":if valid{Value::Null}else{json!("NATIVE_SYNTAX_NOT_VALID")}});
    let mut verified = result.clone();
    for f in verified["files"].as_array_mut()? {
        f["validationStatus"] = "VALID".into();
    }
    if !valid {
        units.clear();
    }
    release::verify(&verified).then_some((result, units))
}

fn uuid_invalid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() != 36
        || !bytes.iter().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                *b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
        || !(b'1'..=b'8').contains(&bytes[14])
        || !b"89abAB".contains(&bytes[19])
}
