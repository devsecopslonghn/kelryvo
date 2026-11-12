use kelryvo_core::{sha256, workspace};
use serde_json::{Value, json};
const ID: &str = "00000000-0000-4000-8000-000000000001";
const SECOND: &str = "00000000-0000-4000-8000-000000000002";
fn draft(input: Value) -> Value {
    let files = workspace::normalize_files(&input, false).expect("editable files");
    json!({"id":ID,"projectId":ID,"revision":"2","manifestVersion":2,"sha256":workspace::files_digest(&files),"sql":files[0]["sql"],"files":files})
}
#[test]
fn corrections_select_only_unchanged_identities_and_verified_source_bytes() {
    let first = json!({"id":ID,"path":"V1__init.sql","sql":"CREATE TABLE item(id NUMBER);\n"});
    let sql = "-- Tiếng Việt 😀\r\nALTER TABLE item ADD label VARCHAR2(40 BYTE);\r\n";
    let second = json!({"id":SECOND,"path":"V2__change.sql","sql":sql});
    let current = draft(json!([first.clone(), second.clone()]));
    let origin = json!({"projectId":ID,"releaseId":ID,"manifestDigest":"a".repeat(64),"draftId":ID,"draftRevision":"1","draftSha256":"b".repeat(64),"manifestVersion":2,"sourceBindingCurrent":true,"files":[{"draftFileId":SECOND,"draftPath":"V2__change.sql","releasePath":"migrations/V2__change.sql","sha256":sha256(sql)}]});
    let start = sql.find("ALTER").expect("statement");
    let end = sql.find(';').expect("delimiter") + 1;
    let statement = json!({"path":"migrations/V2__change.sql","startByte":start,"endByte":end,"sourceSha256":sha256(&sql[start..end])});
    let resolve = |origin: &Value, current: &Value, s: &Value| {
        workspace::correction(origin, current, "migrations/V2__change.sql", s)
            .expect("bounded correction context")
    };
    let result = resolve(&origin, &current, &statement);
    assert_eq!(result["state"], "UNCHANGED");
    assert_eq!(result["fileId"], SECOND);
    assert_eq!(
        result["selection"]["start"],
        sql[..start].replace("\r\n", "\n").encode_utf16().count()
    );
    assert_eq!(
        result["selection"]["end"],
        sql[..end].replace("\r\n", "\n").encode_utf16().count()
    );
    let mut changed_file = second.clone();
    changed_file["path"] = "V2__renamed.sql".into();
    let renamed = draft(json!([first.clone(), changed_file]));
    let mut rebound = origin.clone();
    rebound["sourceBindingCurrent"] = false.into();
    let result = resolve(&rebound, &renamed, &statement);
    assert_eq!(result["state"], "RENAMED");
    assert_eq!(result["currentPath"], "V2__renamed.sql");
    assert_eq!(result["sourceBindingCurrent"], false);
    assert!(result["selection"].is_object());
    let mut edited = second.clone();
    edited["sql"] = format!("-- New current text\n{sql}").into();
    let result = resolve(&origin, &draft(json!([first.clone(), edited])), &statement);
    assert_eq!(result["state"], "CHANGED");
    assert_eq!(result["selection"], Value::Null);
    let result = resolve(&origin, &draft(json!([first.clone()])), &statement);
    assert_eq!(result["state"], "REMOVED");
    assert_eq!(result["fileId"], Value::Null);
    assert_eq!(result["selection"], Value::Null);
    let mut replacement = second.clone();
    replacement["id"] = "00000000-0000-4000-8000-000000000003".into();
    assert_eq!(
        resolve(&origin, &draft(json!([first, replacement])), &statement)["state"],
        "REMOVED",
        "same filename never revives a removed identity"
    );
    let no_path =
        workspace::correction(&origin, &current, "", &statement).expect("whole draft context");
    assert_eq!(no_path["state"], "DRAFT");
    assert_eq!(no_path["selection"], Value::Null);
    let mut invalid = statement.clone();
    invalid["sourceSha256"] = "0".repeat(64).into();
    assert_eq!(
        resolve(&origin, &current, &invalid)["selection"],
        Value::Null
    );
    let mut invalid = statement.clone();
    let split = sql.find('😀').expect("UTF-8 fixture") + 1;
    invalid["startByte"] = split.into();
    invalid["sourceSha256"] = sha256(&sql.as_bytes()[split..end]).into();
    assert_eq!(
        resolve(&origin, &current, &invalid)["selection"],
        Value::Null,
        "a split UTF-8 code point must not be selected"
    );
    invalid = statement.clone();
    invalid["endByte"] = usize::MAX.into();
    assert_eq!(
        resolve(&origin, &current, &invalid)["selection"],
        Value::Null
    );
    invalid = statement.clone();
    invalid["path"] = "migrations/other.sql".into();
    assert_eq!(
        resolve(&origin, &current, &invalid)["selection"],
        Value::Null
    );
    let mut foreign = current.clone();
    foreign["projectId"] = SECOND.into();
    assert!(workspace::correction(&origin, &foreign, "", &statement).is_none());
    let mut corrupt = current.clone();
    corrupt["files"][1]["sql"] = "ALTER TABLE item ADD wrong NUMBER;".into();
    assert!(workspace::correction(&origin, &corrupt, "", &statement).is_none());
    assert_eq!(
        current["files"].as_array().expect("files").len(),
        2,
        "opening never edits the current draft"
    );
}

#[test]
fn legacy_origin_keeps_its_draft_identity() {
    let sql = "CREATE TABLE item(id NUMBER);\n";
    let current = json!({"id":ID,"projectId":ID,"revision":"1","manifestVersion":1,"sha256":sha256(sql),"sql":sql,"files":workspace::normalize_files(&json!([{"id":ID,"path":"V1__workspace.sql","sql":sql}]),false).expect("legacy projection")});
    let origin = json!({"projectId":ID,"releaseId":ID,"manifestDigest":"a".repeat(64),"draftId":ID,"draftRevision":"1","draftSha256":sha256(sql),"manifestVersion":1,"sourceBindingCurrent":true,"files":[{"draftFileId":ID,"draftPath":"V1__workspace.sql","releasePath":"migrations/V1__workspace.sql","sha256":sha256(sql)}]});
    let context = workspace::correction(
        &origin,
        &current,
        "migrations/V1__workspace.sql",
        &Value::Null,
    )
    .expect("legacy context");
    assert_eq!(context["state"], "UNCHANGED");
    assert_eq!(context["fileId"], ID);
}
