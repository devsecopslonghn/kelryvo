//! Verify immutable Git and SQL Workspace snapshots without consulting a target.
use crate::{
    MAX_INPUT_BYTES, MAX_RELEASE_BYTES, MAX_RELEASE_FILES, MAX_STDOUT_BYTES, digest, js_len,
    matches, safe_integer, sha256, string, uuid,
    workspace::{canonical_file_version, compare_versions},
};
use serde_json::{Value, json};
use std::{cmp::Ordering, collections::HashSet};

fn canonical_version(path: &str) -> Option<String> {
    canonical_file_version(path.rsplit('/').next()?)
}

pub fn verify(release: &Value) -> bool {
    verify_inner(release).is_some()
}

fn verify_inner(release: &Value) -> Option<()> {
    let object = release.as_object()?;
    if [
        "commit_id",
        "object_format",
        "folder",
        "parser_profile",
        "manifest_digest",
        "files",
    ]
    .iter()
    .any(|k| !object.contains_key(*k))
    {
        return None;
    }
    let commit = release["commit_id"].as_str()?;
    let format = release["object_format"].as_str()?;
    let folder = release["folder"].as_str()?;
    let profile = release["parser_profile"].as_str()?;
    if !["sha1", "sha256"].contains(&format)
        || commit.len() != if format == "sha1" { 40 } else { 64 }
        || !matches(r"\A[a-f0-9]+\z", commit)
        || js_len(folder) > 200
        || !matches(r"\A[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\z", folder)
        || profile.is_empty()
        || js_len(profile) > MAX_INPUT_BYTES
        || !digest(&release["manifest_digest"])
    {
        return None;
    }
    let files = release["files"].as_array()?;
    if files.is_empty() || files.len() > MAX_RELEASE_FILES {
        return None;
    }
    let authored = files
        .iter()
        .any(|f| f.get("draftFileId").is_some() || f.get("order").is_some());
    let (mut identities, mut versions, mut paths) =
        (HashSet::new(), HashSet::new(), HashSet::new());
    let (mut total_bytes, mut metadata_chars) = (0, js_len(folder) + js_len(profile));
    let mut previous: Option<&str> = None;
    let mut manifest_files = Vec::new();
    for (order, file) in files.iter().enumerate() {
        file.as_object()?;
        let path = file["path"].as_str()?;
        let version = file["version"].as_str()?;
        let content = file["content"].as_str()?;
        let bytes = safe_integer(&file["bytes"])? as usize;
        let count = file.get("statementCount")?;
        if js_len(path) > MAX_INPUT_BYTES
            || !path.starts_with(&format!("{folder}/"))
            || !matches(r"\A[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*\z", path)
            || path.split('/').any(|p| p == "." || p == "..")
            || version.len() > path.len()
            || !matches(r"\A[0-9]+(?:\.[0-9]+)*\z", version)
            || !digest(&file["sha256"])
            || bytes == 0
            || bytes > MAX_INPUT_BYTES
            || js_len(content) > bytes
            || !(count.is_null() || safe_integer(count).is_some())
            || file["validationStatus"] != "VALID"
        {
            return None;
        }
        metadata_chars += js_len(path) + js_len(version);
        total_bytes += bytes;
        if metadata_chars > MAX_STDOUT_BYTES
            || total_bytes > MAX_RELEASE_BYTES
            || content.len() != bytes
            || canonical_version(path)?.as_str() != version
            || !versions.insert(version)
            || !paths.insert(path)
            || previous.is_some_and(|p| compare_versions(p, version) != Ordering::Less)
            || sha256(content) != file["sha256"]
        {
            return None;
        }
        previous = Some(version);
        if authored {
            if !uuid(&file["draftFileId"])
                || !identities.insert(file["draftFileId"].as_str()?)
                || file["order"] != order
            {
                return None;
            }
            manifest_files.push(json!({"id":file["draftFileId"],"path":path,"version":version,"order":order,"sha256":file["sha256"],"bytes":bytes}));
        } else {
            manifest_files
                .push(json!({"path":path,"version":version,"sha256":file["sha256"],"bytes":bytes}));
        }
    }
    let manifest = json!({"format":if authored {2} else {1},"commit":commit,"objectFormat":format,"folder":folder,"parserProfile":profile,"files":manifest_files});
    (sha256(manifest.to_string()) == string(&release["manifest_digest"])).then_some(())
}
