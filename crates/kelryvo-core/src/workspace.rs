//! Stable SQL Workspace file identities and revision fingerprints.
use crate::{js_len, matches, sha256, string, uuid};
use serde_json::{Value, json};
use std::{cmp::Ordering, collections::HashSet};

pub const MAX_BYTES: usize = 1_048_576;

/// Resolve a historical source reference against the current editable manifest.
/// Missing files are never recreated. Byte offsets are used only for unchanged
/// content and are converted to the browser textarea's normalized UTF-16 units.
pub fn correction(origin: &Value, draft: &Value, path: &str, statement: &Value) -> Option<Value> {
    if !uuid(&origin["projectId"])
        || !uuid(&origin["releaseId"])
        || !uuid(&origin["draftId"])
        || origin["projectId"] != draft["projectId"]
        || origin["draftId"] != draft["id"]
        || !crate::digest(&origin["manifestDigest"])
        || !crate::digest(&origin["draftSha256"])
        || !origin["sourceBindingCurrent"].is_boolean()
        || ![1, 2].iter().any(|n| origin["manifestVersion"] == *n)
        || !matches(r"\A[1-9][0-9]{0,18}\z", string(&origin["draftRevision"]))
        || !matches(r"\A[1-9][0-9]{0,18}\z", string(&draft["revision"]))
    {
        return None;
    }
    let old = origin["files"].as_array()?;
    if old.is_empty()
        || old.len() > 128
        || old.iter().any(|f| {
            !uuid(&f["draftFileId"])
                || !crate::digest(&f["sha256"])
                || file_version(string(&f["draftPath"])).is_none()
                || f["releasePath"]
                    .as_str()
                    .is_none_or(|s| s.is_empty() || s.len() > 401)
        })
    {
        return None;
    }
    let files = normalize_files(&draft["files"], true)?;
    if files != *draft["files"].as_array()? || files.first()?["sql"] != draft["sql"] {
        return None;
    }
    let valid = match draft["manifestVersion"].as_u64()? {
        1 => {
            files.len() == 1
                && files[0]["id"] == draft["id"]
                && files[0]["path"] == "V1__workspace.sql"
                && draft["sha256"] == sha256(string(&draft["sql"]))
        }
        2 => draft["sha256"] == files_digest(&files),
        _ => false,
    };
    if !valid {
        return None;
    }
    let old_file = old.iter().find(|f| f["releasePath"] == path);
    let file = old_file.and_then(|old| files.iter().find(|f| f["id"] == old["draftFileId"]));
    let state = match (old_file, file) {
        (None, _) => "DRAFT",
        (Some(_), None) => "REMOVED",
        (Some(old), Some(file)) if old["sha256"] != file["sha256"] => "CHANGED",
        (Some(old), Some(file)) if old["draftPath"] != file["path"] => "RENAMED",
        _ => "UNCHANGED",
    };
    let selection = (|| {
        if !["UNCHANGED", "RENAMED"].contains(&state) || statement["path"] != path {
            return None;
        }
        let sql = file?["sql"].as_str()?;
        let (start, end) = (
            usize::try_from(statement["startByte"].as_u64()?).ok()?,
            usize::try_from(statement["endByte"].as_u64()?).ok()?,
        );
        let source = sql.get(start..end)?;
        if source.is_empty() || statement["sourceSha256"] != sha256(source) {
            return None;
        }
        let position = |end| {
            sql.get(..end).map(|s| {
                s.replace("\r\n", "\n")
                    .replace('\r', "\n")
                    .encode_utf16()
                    .count()
            })
        };
        Some(json!({"start":position(start)?,"end":position(end)?}))
    })()
    .unwrap_or(Value::Null);
    Some(
        json!({"releaseId":origin["releaseId"],"draftRevision":origin["draftRevision"],"currentRevision":draft["revision"],"sourceBindingCurrent":origin["sourceBindingCurrent"],"path":path,"currentPath":file.map(|f|&f["path"]),"fileId":file.map(|f|&f["id"]),"state":state,"selection":selection}),
    )
}

pub fn valid_sql(sql: &str) -> bool {
    sql.len() <= MAX_BYTES
        && !sql.chars().any(
            |c| matches!(c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}' | '\u{7f}'),
        )
}

pub fn file_version(path: &str) -> Option<String> {
    if js_len(path) > 200 {
        return None;
    }
    canonical_file_version(path)
}

// Git release filenames have a different length bound from editable files.
pub(crate) fn canonical_file_version(path: &str) -> Option<String> {
    if !matches(r"\AV[0-9]+(?:[._][0-9]+)*__[A-Za-z0-9_-]+\.sql\z", path) {
        return None;
    }
    let source = path.strip_prefix('V')?.split_once("__")?.0;
    let mut parts: Vec<_> = source
        .split(['.', '_'])
        .map(|s| {
            let trimmed = s.trim_start_matches('0');
            if trimmed.is_empty() { "0" } else { trimmed }
        })
        .collect();
    while parts.len() > 1 && parts.last() == Some(&"0") {
        parts.pop();
    }
    Some(parts.join("."))
}

pub fn compare_versions(a: &str, b: &str) -> Ordering {
    let mut a = a.split('.');
    let mut b = b.split('.');
    loop {
        let (x, y) = match (a.next(), b.next()) {
            (None, None) => return Ordering::Equal,
            (x, y) => (x.unwrap_or("0"), y.unwrap_or("0")),
        };
        let order = x.len().cmp(&y.len()).then_with(|| x.cmp(y));
        if order != Ordering::Equal {
            return order;
        }
    }
}

/// IDs are allocated by the caller for new files before validation. Persisted
/// IDs are required when reading revisions or saving an existing multi-file draft.
pub fn normalize_files(input: &Value, stored: bool) -> Option<Vec<Value>> {
    let input = input.as_array()?;
    if input.is_empty() || input.len() > 128 {
        return None;
    }
    let (mut ids, mut paths, mut versions) = (HashSet::new(), HashSet::new(), HashSet::new());
    let mut bytes = 0;
    let mut files = Vec::new();
    for entry in input {
        let keys = entry.as_object()?;
        let allowed = if stored {
            &["id", "path", "sql", "version", "order", "sha256"][..]
        } else {
            &["id", "path", "sql"][..]
        };
        if keys.keys().any(|k| !allowed.contains(&k.as_str())) || !uuid(&entry["id"]) {
            return None;
        }
        let path = entry["path"].as_str()?;
        let sql = entry["sql"].as_str()?;
        let version = file_version(path)?;
        bytes += sql.len();
        if !valid_sql(sql)
            || bytes > MAX_BYTES
            || !ids.insert(string(&entry["id"]))
            || !paths.insert(path)
            || !versions.insert(version.clone())
        {
            return None;
        }
        files.push(json!({"id":entry["id"],"path":path,"version":version,"order":0,"sql":sql,"sha256":sha256(sql)}));
    }
    files.sort_by(|a, b| compare_versions(string(&a["version"]), string(&b["version"])));
    for (i, file) in files.iter_mut().enumerate() {
        file["order"] = i.into();
    }
    Some(files)
}

pub fn files_digest(files: &[Value]) -> String {
    sha256(Value::Array(files.iter().map(|file| json!({"id":file["id"],"path":file["path"],"version":file["version"],"order":file["order"],"sha256":file["sha256"]})).collect()).to_string())
}

/// Strip derived fields before editing or comparing whole-file identities.
pub fn editable(draft: &Value) -> Value {
    let files = draft["files"].as_array().map(|rows| rows.iter().map(|f|json!({"id":f["id"],"path":f["path"],"sql":f["sql"]})).collect::<Vec<_>>())
        .unwrap_or_else(||vec![json!({"id":draft["id"],"path":"V1__workspace.sql","sql":draft["sql"].as_str().unwrap_or_default()})]);
    json!({"name":draft["name"],"targetBindingId":draft["targetBindingId"],"files":files})
}

/// Whole-file three-way reconciliation. SQL text is never merged and the result
/// carries no persistence or execution authority. Callers must explicitly save
/// against the remote revision and recheck current target access.
pub fn reconcile(
    base: &Value,
    local: &Value,
    remote: &Value,
    choices: &Value,
    excluded: &Value,
) -> Option<Value> {
    let rows = [base, local, remote].map(|v| v["files"].as_array());
    if rows.iter().any(|r| r.is_none_or(|r| r.len() > 128)) {
        return None;
    }
    let rows = rows.map(|r| r.expect("checked file arrays"));
    let mut ids = Vec::new();
    for row in rows.iter().flat_map(|r| r.iter()) {
        if !uuid(&row["id"]) || !row["path"].is_string() || !row["sql"].is_string() {
            return None;
        }
        if !ids.contains(&row["id"]) {
            ids.push(row["id"].clone());
        }
    }
    let mut conflicts = Vec::new();
    let mut pick = |key: &str, label: &str, b: &Value, l: &Value, r: &Value| -> Option<Value> {
        if l == r {
            return Some(l.clone());
        }
        if l == b {
            return Some(r.clone());
        }
        if r == b {
            return Some(l.clone());
        }
        conflicts.push(json!({"key":key,"label":label,"base":b,"local":l,"remote":r}));
        match choices[key].as_str() {
            Some("local") => Some(l.clone()),
            Some("remote") => Some(r.clone()),
            _ => None,
        }
    };
    let mut files = Vec::new();
    for id in ids {
        let row = rows.map(|r| {
            r.iter()
                .find(|f| f["id"] == id)
                .map(|f| json!({"id":f["id"],"path":f["path"],"sql":f["sql"]}))
                .unwrap_or(Value::Null)
        });
        let label = [&row[1], &row[2], &row[0]]
            .iter()
            .find_map(|f| f["path"].as_str())
            .unwrap_or_default();
        if let Some(file) = pick(
            &format!("file:{}", string(&id)),
            label,
            &row[0],
            &row[1],
            &row[2],
        )
        .filter(|f| !f.is_null())
        {
            files.push(file);
        }
    }
    let name = pick(
        "name",
        "Draft name",
        &base["name"],
        &local["name"],
        &remote["name"],
    );
    let target = pick(
        "target",
        "Database target",
        &base["targetBindingId"],
        &local["targetBindingId"],
        &remote["targetBindingId"],
    );
    let mut selected: Vec<_> = files
        .iter()
        .filter(|f| {
            !excluded
                .as_array()
                .is_some_and(|ids| ids.contains(&f["id"]))
        })
        .cloned()
        .collect();
    let (mut issues, mut paths, mut versions, mut bytes) =
        (Vec::new(), HashSet::new(), HashSet::new(), 0);
    for file in &selected {
        let path = string(&file["path"]);
        let version = file_version(path);
        if version.is_none() {
            issues.push(format!("Invalid migration filename: {path}"));
        }
        if !paths.insert(path) {
            issues.push(format!("Duplicate migration filename: {path}"));
        }
        if let Some(version) = version
            && !versions.insert(version.clone())
        {
            issues.push(format!("Duplicate migration version: {version}"));
        }
        bytes += string(&file["sql"]).len();
    }
    if selected.is_empty() || selected.len() > 128 {
        issues.push("A draft must contain 1–128 files.".into());
    }
    if bytes > MAX_BYTES {
        issues.push("Combined SQL exceeds the 1 MiB draft limit.".into());
    }
    if name.as_ref().is_some_and(|v| {
        v.as_str().is_none_or(|s| {
            s.trim_matches(crate::js_whitespace).is_empty()
                || js_len(s) > 200
                || s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        })
    }) {
        issues.push("Enter a valid draft name.".into());
    }
    if target.as_ref().is_some_and(|v| !uuid(v)) {
        issues.push("Choose an authorized database target.".into());
    }
    selected.sort_by(|a, b| {
        compare_versions(
            &file_version(string(&a["path"])).unwrap_or_else(|| "0".into()),
            &file_version(string(&b["path"])).unwrap_or_else(|| "0".into()),
        )
        .then_with(|| string(&a["path"]).cmp(string(&b["path"])))
    });
    let ready = issues.is_empty()
        && conflicts.iter().all(|c| {
            matches!(
                choices[string(&c["key"])].as_str(),
                Some("local" | "remote")
            )
        });
    let mut result = json!({"files":selected,"candidates":files,"conflicts":conflicts,"issues":issues,"ready":ready});
    if let Some(name) = name {
        result["name"] = name;
    }
    if let Some(target) = target {
        result["targetBindingId"] = target;
    }
    Some(result)
}

/// Increment a decimal version without losing precision on large filenames.
pub fn next_path(files: &[Value]) -> String {
    let max = files
        .iter()
        .filter_map(|f| {
            let s = string(&f["path"]).strip_prefix('V')?;
            let digits = s.chars().take_while(char::is_ascii_digit).count();
            let s = s[..digits].trim_start_matches('0');
            (!s.is_empty()).then_some(s)
        })
        .max_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)))
        .unwrap_or("0");
    let mut digits = max.as_bytes().to_vec();
    let mut carry = true;
    for d in digits.iter_mut().rev() {
        if *d == b'9' {
            *d = b'0';
        } else {
            *d += 1;
            carry = false;
            break;
        }
    }
    if carry {
        digits.insert(0, b'1');
    }
    format!(
        "V{}__migration.sql",
        String::from_utf8(digits).expect("decimal digits")
    )
}

pub fn positive_revision(value: &str) -> Option<i64> {
    if value.starts_with('0') {
        None
    } else {
        value
            .parse::<i64>()
            .ok()
            .filter(|n| *n > 0 && n.to_string() == value)
    }
}
