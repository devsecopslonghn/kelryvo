//! Retained container manifest compatibility using real local Git worktrees.
use kelryvo_server::repositories;
use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
    process::Command,
};
use uuid::Uuid;

fn git(path: &Path, args: &[&str]) -> String {
    let out = Command::new("/usr/bin/git")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .args([
            "--no-optional-locks",
            "-c",
            "core.hooksPath=/dev/null",
            "-C",
        ])
        .arg(path)
        .args(args)
        .output()
        .unwrap();
    assert!(out.status.success());
    String::from_utf8(out.stdout).unwrap().trim().into()
}
#[tokio::test]
async fn retained_container_allowlist_matches_native_without_source_writes_or_mount_escape() {
    let project = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let root = project
        .join(".cache")
        .join(format!("native-repositories-{}", Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    let mount = root.join("mounted");
    let checkout = mount.join("customer");
    fs::create_dir(&mount).unwrap();
    fs::create_dir(&checkout).unwrap();
    git(&checkout, &["init", "--initial-branch=main"]);
    fs::write(
        checkout.join("V001__customer.sql"),
        b"CREATE TABLE customer(id NUMBER);\n",
    )
    .unwrap();
    git(&checkout, &["add", "--", "V001__customer.sql"]);
    git(
        &checkout,
        &[
            "-c",
            "user.name=Native fixture",
            "-c",
            "user.email=fixture@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "Customer fixture",
        ],
    );
    let nested = checkout.join("subdirectory");
    fs::create_dir(&nested).unwrap();
    let outside = root.join("outside");
    fs::create_dir(&outside).unwrap();
    git(&outside, &["init"]);
    let link = mount.join("escape");
    symlink(&outside, &link).unwrap();
    let not_git = mount.join("not-a-worktree");
    fs::create_dir(&not_git).unwrap();
    let before = git(&checkout, &["status", "--porcelain"]);
    let head = git(&checkout, &["rev-parse", "HEAD"]);
    let cases = vec![
        json!({"format":1,"paths":[checkout]}),
        json!({"format":1,"paths":[]}),
        Value::Null,
        json!([]),
        json!({"format":2,"paths":[checkout]}),
        json!({"format":1,"paths":[checkout],"extra":true}),
        json!({"format":1,"paths":["https://credential-canary@example.invalid/repo"]}),
        json!({"format":1,"paths":[mount]}),
        json!({"format":1,"paths":[checkout,checkout]}),
        json!({"format":1,"paths":vec![checkout.clone();9]}),
        json!({"format":1,"paths":[link]}),
        json!({"format":1,"paths":[nested]}),
        json!({"format":1,"paths":[not_git]}),
        json!({"format":1,"paths":[format!("{}/../outside",mount.display())]}),
    ];
    let expected: Vec<Value> = (0..cases.len())
        .map(|i| match i {
            0 => json!([{"id":"local-1","name":"customer","path":checkout}]),
            1 => json!([]),
            _ => Value::Null,
        })
        .collect();
    for (i, (case, expected)) in cases.iter().zip(expected).enumerate() {
        let actual = match repositories::container(case.to_string().as_bytes(), &mount).await {
            Ok(entries) => Value::Array(
                entries
                    .into_iter()
                    .map(|r| json!({"id":r.id,"name":r.name,"path":r.path}))
                    .collect(),
            ),
            Err(_) => Value::Null,
        };
        assert_eq!(actual, expected, "manifest case {i}");
    }
    assert_eq!(git(&checkout, &["status", "--porcelain"]), before);
    assert_eq!(git(&checkout, &["rev-parse", "HEAD"]), head);
}
