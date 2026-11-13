use kelryvo_core::{release, workspace};
use kelryvo_parser::snapshot::authored;
use serde_json::json;
use std::{fs, process::Command};

#[test]
fn authored_review_binds_sql_and_plsql_execution_bytes_independently_of_separators() {
    let draft = "00000000-0000-4000-8000-000000000001";
    for (sql, execution) in [
        ("BEGIN NULL; END;", "BEGIN NULL; END;"),
        ("BEGIN NULL; END;\r\n/", "BEGIN NULL; END;"),
        (
            "CREATE TABLE item(id NUMBER);\n/",
            "CREATE TABLE item(id NUMBER)",
        ),
        (
            "CREATE TABLE item(id NUMBER)\r\n/",
            "CREATE TABLE item(id NUMBER)",
        ),
    ] {
        let files = workspace::normalize_files(
            &json!([{"id":draft,"path":"V1__unit.sql","sql":sql}]),
            true,
        )
        .expect("workspace unit");
        let (snapshot, units) = kelryvo_parser::snapshot::review("migrations", &files, draft, 1, 2)
            .expect("complete authored review");
        assert!(release::verify(&snapshot));
        assert_eq!(units.len(), 1);
        assert_eq!(units[0]["sourceSql"], sql);
        assert_eq!(units[0]["sourceSha256"], kelryvo_core::sha256(sql));
        assert_eq!(units[0]["executionSha256"], kelryvo_core::sha256(execution));
        assert_eq!(snapshot["files"][0]["content"], sql);
        assert_eq!(snapshot["files"][0]["sha256"], kelryvo_core::sha256(sql));
        assert_eq!(
            snapshot,
            authored("migrations", &files, draft, 1, 2).unwrap()
        );
    }
}

#[test]
fn plsql_snapshot_retains_executable_block_bytes_and_native_profile() {
    let draft = "00000000-0000-4000-8000-000000000001";
    let sql = "-- retained procedure 😀\r\nCREATE OR REPLACE PROCEDURE sf_p AS\r\nBEGIN\r\n  NULL;\r\nEND;\r\n/\r\n";
    let files = workspace::normalize_files(
        &json!([{"id":draft,"path":"V1__procedure.sql","sql":sql}]),
        true,
    )
    .expect("PL/SQL workspace");
    let (snapshot, units) = kelryvo_parser::snapshot::review("migrations", &files, draft, 1, 2)
        .expect("native PL/SQL snapshot");
    assert!(release::verify(&snapshot));
    assert_eq!(snapshot["parser_profile"], kelryvo_parser::PROFILE);
    assert_eq!(snapshot["files"][0]["statementCount"], 1);
    assert_eq!(units.len(), 1);
    assert_eq!(units[0]["sourceSql"], sql.trim_end_matches("\r\n"));
    assert_eq!(
        units[0]["executionSha256"],
        kelryvo_core::sha256(sql.strip_suffix("\r\n/\r\n").unwrap())
    );
    let mut reprofiled = snapshot.clone();
    reprofiled["parser_profile"] = "kelryvo-oracle-rust-v1-sqlparser-0.63.0".into();
    assert!(
        !release::verify(&reprofiled),
        "profile changes invalidate the retained manifest"
    );
    assert_eq!(
        snapshot,
        authored("migrations", &files, draft, 1, 2).unwrap()
    );
}

#[test]
fn diagnostic_snapshots_retain_invalid_bytes_without_partial_identities_or_release_authority() {
    let draft = "00000000-0000-4000-8000-000000000001";
    let good = json!({"id":draft,"path":"V1__good.sql","sql":"CREATE TABLE item(id NUMBER);\r\n"});
    let bad = json!({"id":"00000000-0000-4000-8000-000000000002","path":"V2__bad.sql","sql":"CREATE TABLE valid(id NUMBER);\nCREATE TABLE broken(;\n"});
    let files =
        workspace::normalize_files(&json!([good, bad]), false).expect("invalid syntax is editable");
    assert!(authored("migrations", &files, draft, 1, 2).is_none());
    let (diagnostic, units) = kelryvo_parser::snapshot::review("migrations", &files, draft, 1, 2)
        .expect("bounded diagnostic");
    assert_eq!(diagnostic["validation_status"], "INVALID");
    assert_eq!(diagnostic["files"][0]["validationStatus"], "VALID");
    assert_eq!(diagnostic["files"][1]["content"], files[1]["sql"]);
    assert_eq!(
        diagnostic["files"][1]["statementCount"],
        serde_json::Value::Null
    );
    assert!(
        units.is_empty(),
        "late invalid input never returns a valid prefix"
    );
    assert!(!release::verify(&diagnostic));
    let files = vec![files[0].clone()];
    let (diagnostic, units) = kelryvo_parser::snapshot::review("migrations", &files, draft, 1, 2)
        .expect("valid diagnostic");
    assert_eq!(
        Some(diagnostic.clone()),
        authored("migrations", &files, draft, 1, 2)
    );
    assert_eq!(units.len(), 1);
    assert_eq!(units[0]["sourceSql"], "CREATE TABLE item(id NUMBER);");
    assert_eq!(
        units[0]["sourceSha256"],
        kelryvo_core::sha256("CREATE TABLE item(id NUMBER);")
    );
}

#[test]
fn authored_commit_matches_git_and_preserves_multifile_identity() {
    let draft = "00000000-0000-4000-8000-000000000001";
    let files=workspace::normalize_files(&json!([
        {"id":draft,"path":"V2__index.sql","sql":"CREATE INDEX item_id ON item(id);\n"},
        {"id":"00000000-0000-4000-8000-000000000002","path":"V1__init.sql","sql":"CREATE TABLE item(id NUMBER);\n"}
    ]),false).expect("workspace files");
    let snapshot = authored("nested/migrations", &files, draft, 2, 2).expect("snapshot");
    assert!(release::verify(&snapshot));
    assert_eq!(snapshot["files"][0]["draftFileId"], files[0]["id"]);
    let root = std::env::temp_dir().join(format!("kelryvo-native-git-test-{}", std::process::id()));
    fs::create_dir(&root).expect("own temporary repository");
    let run = |args: &[&str]| {
        let output = Command::new("git")
            .arg("--no-optional-locks")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "core.attributesFile=/dev/null",
                "-c",
                "core.autocrlf=false",
                "-c",
                "core.fsmonitor=false",
                "-c",
                "commit.gpgsign=false",
                "-C",
            ])
            .arg(&root)
            .args(args)
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_AUTHOR_NAME", "Kelryvo SQL Workspace")
            .env("GIT_AUTHOR_EMAIL", "sql-workspace@invalid.invalid")
            .env("GIT_COMMITTER_NAME", "Kelryvo SQL Workspace")
            .env("GIT_COMMITTER_EMAIL", "sql-workspace@invalid.invalid")
            .env("GIT_AUTHOR_DATE", "2000-01-01T00:00:00Z")
            .env("GIT_COMMITTER_DATE", "2000-01-01T00:00:00Z")
            .output()
            .expect("Git reference command");
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout)
            .expect("Git reference output")
            .trim()
            .to_owned()
    };
    run(&[
        "init",
        "--quiet",
        "--template=/dev/null",
        "--object-format=sha1",
    ]);
    fs::create_dir_all(root.join("nested/migrations")).expect("migration directory");
    for file in &files {
        fs::write(
            root.join("nested/migrations")
                .join(file["path"].as_str().expect("path")),
            file["sql"].as_str().expect("sql"),
        )
        .expect("fixture source");
    }
    run(&["add", "--", "nested/migrations"]);
    run(&[
        "commit",
        "--quiet",
        "--no-gpg-sign",
        "-m",
        &format!("Kelryvo SQL snapshot {draft} revision 2"),
    ]);
    assert_eq!(
        snapshot["commit_id"],
        run(&["rev-parse", "--verify", "HEAD"])
    );
    fs::remove_dir_all(root).expect("remove own temporary fixture");
    let mut changed = files.clone();
    changed[1]["sql"] = "CREATE INDEX wrong ON missing(id);\n".into();
    assert!(authored("../escape", &files, draft, 2, 2).is_none());
    assert!(
        authored("migrations", &changed, draft, 2, 2).is_none(),
        "file digests must be normalized before snapshotting"
    );
}
