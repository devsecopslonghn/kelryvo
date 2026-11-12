//! Git source compatibility with real local SHA-1/SHA-256 repositories. The
//! retained importer is used only for byte snapshots, with its parser disabled.
use super::{OTHER_TOKEN, TOKEN, request};
use axum::{Router, http::StatusCode};
use kelryvo_server::{AppState, ORG_UUID, repositories, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
    process::Command,
    sync::Arc,
};
use uuid::Uuid;

fn git(root: &Path, args: &[&str]) -> String {
    let out = Command::new("/usr/bin/git")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args([
            "--no-optional-locks",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "user.name=Native Git fixture",
            "-c",
            "user.email=fixture@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "-C",
        ])
        .arg(root)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "fixture Git failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8(out.stdout).unwrap().trim().into()
}
fn reference(_root: &Path, method: &str, path: &str, body: Option<Value>) -> Value {
    let mut input = json!({"method":method,"path":path,"actor":"developer"});
    if let Some(body) = body {
        input["body"] = body;
    }
    crate::fixtures::read("configuration-api", &input)
}
fn files(_root: &Path, _commit: &str) -> Value {
    crate::fixtures::data("git-files")
}
async fn counts(pool: &PgPool, project: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_releases WHERE project_id=$1),(SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT count(*) FROM sf_execution_jobs WHERE project_id=$1),(SELECT count(*) FROM sf_execution_attempts))").bind(project).fetch_one(pool).await.unwrap()
}
async fn native(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let r = request(app, method, path, body, Some(TOKEN), None, None).await;
    (r.0, r.2)
}
async fn compare(
    pool: &PgPool,
    project: Uuid,
    app: &Router,
    root: &Path,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> Value {
    let before = counts(pool, project).await;
    let r = native(app, method, path, body.clone()).await;
    let (root, method, path) = (root.to_path_buf(), method.to_owned(), path.to_owned());
    let expected = tokio::task::spawn_blocking(move || reference(&root, &method, &path, body))
        .await
        .unwrap();
    let actual = json!({"status":r.0.as_u16(),"body":r.1});
    assert_fixture_eq!(actual, expected, "Git handler compatibility");
    assert_eq!(
        counts(pool, project).await,
        before,
        "reads and failed imports cannot persist releases, audit or jobs"
    );
    actual
}
fn import(commit: &str) -> Value {
    json!({"repositoryId":"native-reference","commit":commit,"folder":"migrations"})
}
fn put(root: &Path, path: &str, content: &[u8]) {
    let path = root.join(path);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, content).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o644)).unwrap();
}
fn identities(files: &Value) -> Value {
    json!(files.as_array().unwrap().iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"],"bytes":f["bytes"],"content":f["content"]})).collect::<Vec<_>>())
}
pub async fn run(pool: &PgPool, parent: Uuid) {
    for format in ["sha1", "sha256"] {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap()
            .join(".cache")
            .join(format!("native-git-{}", Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        let root = directory.join("repository");
        fs::create_dir(&root).unwrap();
        git(
            &root,
            &[
                "init",
                "--initial-branch=main",
                &format!("--object-format={format}"),
            ],
        );
        put(
            &root,
            "migrations/V001__base.sql",
            b"CREATE TABLE native_git_item(id NUMBER);\n",
        );
        put(
            &root,
            "migrations/nested/V001_02__alter.sql",
            b"ALTER TABLE native_git_item ADD(label VARCHAR2(80));\n",
        );
        put(
            &root,
            "migrations/V900719925474099312345__large_version.sql",
            b"CREATE TABLE native_git_other(id NUMBER);\n",
        );
        put(&root, "README.md", b"Local source fixture\n");
        git(&root, &["add", "--", "."]);
        git(&root, &["commit", "-m", "Immutable source fixture"]);
        let commit = git(&root, &["rev-parse", "HEAD"]);
        git(&root, &["branch", "release/qa"]);
        git(&root, &["tag", "v1"]);
        git(&root, &["tag", "-a", "v2", "-m", "Annotated fixture"]);
        git(
            &root,
            &["tag", "-a", "v3", "v2", "-m", "Nested annotated fixture"],
        );
        let blob = git(&root, &["rev-parse", "HEAD:README.md"]);
        git(&root, &["tag", "blob-fixture", &blob]);
        git(
            &root,
            &["update-ref", "refs/remotes/origin/ignored", &commit],
        );
        // Dirty/untracked worktree bytes must not become an imported release.
        put(
            &root,
            "migrations/V001__base.sql",
            b"DROP TABLE worktree_only_canary;\n",
        );
        put(
            &root,
            "migrations/V4__untracked.sql",
            b"DROP TABLE untracked_canary;\n",
        );
        let before = git(&root, &["status", "--porcelain"]);
        let project = Uuid::new_v4();
        sqlx::query("INSERT INTO sf_projects(id,organization_id,name) VALUES($1,$2,$3)")
            .bind(project)
            .bind(ORG_UUID)
            .bind(format!("Native Git {format}"))
            .execute(pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) SELECT organization_id,$1,actor_id,grant_os_uid FROM sf_project_grants WHERE project_id=$2 AND revoked_at IS NULL").bind(project).bind(parent).execute(pool).await.unwrap();
        let mut state = AppState::new(pool.clone(), true);
        state.repositories = Arc::new(
            repositories::parse(
                json!([{"id":"native-reference","name":"Native configured source","path":root}])
                    .to_string()
                    .as_bytes(),
            )
            .unwrap(),
        );
        let app = router(state, ".cache/nonexistent-rust-web".into());
        let base = format!("/api/projects/{project}");
        let releases = format!("{base}/releases");
        let refs = format!("{base}/git-refs");
        assert_eq!(
            compare(pool, project, &app, &root, "GET", &refs, None).await["body"]["error"],
            "SOURCE_NOT_BOUND"
        );
        for commit in ["refs/heads/main", "--upload-pack=evil"] {
            assert_eq!(
                compare(
                    pool,
                    project,
                    &app,
                    &root,
                    "POST",
                    &releases,
                    Some(import(commit))
                )
                .await["body"]["error"],
                "SOURCE_NOT_BOUND"
            );
        }
        sqlx::query("UPDATE sf_projects SET source_repository_id='native-reference',source_folder='migrations',source_updated_at=clock_timestamp() WHERE id=$1").bind(project).execute(pool).await.unwrap();
        let listed = compare(pool, project, &app, &root, "GET", &refs, None).await;
        assert_eq!(listed["body"]["branches"].as_array().unwrap().len(), 2);
        assert_eq!(listed["body"]["tags"].as_array().unwrap().len(), 3);
        for bad in [
            "--upload-pack=evil",
            "HEAD~1",
            "HEAD..main",
            "refs/tags/blob-fixture",
            "missing",
        ] {
            assert_eq!(
                compare(
                    pool,
                    project,
                    &app,
                    &root,
                    "POST",
                    &releases,
                    Some(import(bad))
                )
                .await["body"]["error"],
                "RELEASE_IMPORT_FAILED"
            );
        }
        let expected = tokio::task::spawn_blocking({
            let root = root.clone();
            let commit = commit.clone();
            move || files(&root, &commit)
        })
        .await
        .unwrap();
        let mut retained = vec![];
        for git_ref in ["refs/heads/release/qa", "refs/tags/v2", "refs/tags/v3"] {
            let before = counts(pool, project).await;
            let made = native(&app, "POST", &releases, Some(import(git_ref))).await;
            assert_eq!(made.0, StatusCode::CREATED, "{}", made.1);
            assert_eq!(made.1["release"]["commit"], commit);
            assert_eq!(made.1["release"]["parserProfile"], kelryvo_parser::PROFILE);
            assert_eq!(made.1["release"]["validationStatus"], "VALID");
            let release = Uuid::parse_str(made.1["release"]["id"].as_str().unwrap()).unwrap();
            let row: Value =
                sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_releases r WHERE id=$1")
                    .bind(release)
                    .fetch_one(pool)
                    .await
                    .unwrap();
            assert_eq!(row["object_format"], format);
            assert_fixture_eq!(identities(&row["files"]), expected);
            assert!(
                kelryvo_core::release::verify(&row),
                "native snapshot and manifest must verify together"
            );
            let after = counts(pool, project).await;
            assert_eq!(
                after,
                json!([
                    before[0].as_i64().unwrap() + 1,
                    before[1].as_i64().unwrap() + 1,
                    before[2],
                    before[3]
                ])
            );
            retained.push((release, row["files"].clone()));
        }
        assert_eq!(git(&root, &["status", "--porcelain"]), before);
        assert_eq!(git(&root, &["rev-parse", "HEAD"]), commit);
        // A later unsupported tree must not yield a partial snapshot or replace
        // the immutable releases imported through now-movable refs.
        symlink("../README.md", root.join("migrations/unsupported-link")).unwrap();
        git(&root, &["add", "--", "migrations/unsupported-link"]);
        git(&root, &["commit", "-m", "Unsupported tree fixture"]);
        assert_eq!(
            compare(
                pool,
                project,
                &app,
                &root,
                "POST",
                &releases,
                Some(import("main"))
            )
            .await["status"],
            400
        );
        for (id, expected) in retained {
            let files: Value = sqlx::query_scalar("SELECT files FROM sf_releases WHERE id=$1")
                .bind(id)
                .fetch_one(pool)
                .await
                .unwrap();
            assert_fixture_eq!(files, expected);
        }
        assert_eq!(
            request(&app, "GET", &refs, None, Some(OTHER_TOKEN), None, None)
                .await
                .0,
            StatusCode::NOT_FOUND
        );
        sqlx::query("UPDATE sf_projects SET archived_at=clock_timestamp() WHERE id=$1")
            .bind(project)
            .execute(pool)
            .await
            .unwrap();
        compare(pool, project, &app, &root, "GET", &refs, None).await;
        assert_eq!(
            compare(
                pool,
                project,
                &app,
                &root,
                "POST",
                &releases,
                Some(import("main"))
            )
            .await["body"]["error"],
            "PROJECT_ARCHIVED"
        );
    }
}
