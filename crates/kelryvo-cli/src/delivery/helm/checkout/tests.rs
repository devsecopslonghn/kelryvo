use super::*;
use std::process::Command;
fn git(root: &Path, args: &[&str]) {
    let status = Command::new("/usr/bin/git")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "user.name=Native fixture",
            "-c",
            "user.email=fixture@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "-C",
        ])
        .arg(root)
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
}
#[tokio::test]
async fn real_checkout_detects_unrelated_staged_untracked_or_replaced_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let value = super::super::tests::before();
    fs::write(root.join("values.yaml"), &value).unwrap();
    git(&root, &["init", "--quiet"]);
    git(&root, &["add", "values.yaml"]);
    git(&root, &["commit", "-qm", "Native chart fixture"]);
    let mut checkout = Native::load(&root).await.unwrap();
    assert!(sha(&checkout.head().await.unwrap()));
    assert_eq!(checkout.values().unwrap(), value);
    let after = super::super::update_values(&value, &super::super::tests::digest()).unwrap();
    checkout.replace(&value, &after).unwrap();
    assert!(checkout.exact_change().await.unwrap());
    fs::write(root.join("unexpected"), b"untracked validator output").unwrap();
    assert!(!checkout.exact_change().await.unwrap());
    git(&root, &["add", "unexpected"]);
    assert!(!checkout.exact_change().await.unwrap());
    let old = root.join("retained-values");
    fs::rename(root.join("values.yaml"), &old).unwrap();
    std::os::unix::fs::symlink(&old, root.join("values.yaml")).unwrap();
    assert!(checkout.values().is_err());
    assert!(Native::load(&root).await.is_err());
}

#[tokio::test]
async fn real_helm_policy_refuses_missing_storage_before_any_chart_publication() {
    if !Path::new("/usr/local/bin/helm").is_file() && !Path::new("/usr/bin/helm").is_file() {
        eprintln!(
            "SKIP optional real Helm integration: Helm is not installed; kernel and Git checks still run."
        );
        return;
    }
    use crate::delivery::{
        publication::Identity,
        tests::{Fake, responses},
    };
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    fs::create_dir(root.join("scripts")).unwrap();
    fs::create_dir(root.join("templates")).unwrap();
    fs::write(root.join("Chart.yaml"),"apiVersion: v2\nname: native-fixture\nversion: 0.1.0\ndescription: Private native promotion fixture\nicon: https://example.invalid/icon.svg\n").unwrap();
    fs::write(root.join("values.yaml"), super::super::tests::before()).unwrap();
    fs::write(root.join("templates/config.yaml"),"apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: native-fixture\ndata:\n  imageDigest: {{ .Values.image.digest | quote }}\n").unwrap();
    fs::write(root.join("README.md"), "Native fixture; see CHECKLIST.md\n").unwrap();
    fs::write(root.join(".gitignore"), ".cache/\ncoverage/\nreports/\nscreenshots/\ntest-results/\nplaywright-report/\nblob-report/\nevidence/\n*.log\n").unwrap();
    git(&root, &["init", "--quiet"]);
    git(&root, &["add", "."]);
    git(
        &root,
        &["commit", "-qm", "Private native Helm validation fixture"],
    );
    let mut checkout = Native::load(&root).await.unwrap();
    let base = checkout.head().await.unwrap();
    let mut api = super::super::tests::ChartFixture::with_base(base);
    let id = Identity::new("a".repeat(40), "4".into(), "2".into()).unwrap();
    let result = super::super::promote(
        &mut Fake::new(&responses()),
        &mut api,
        &mut checkout,
        &id,
        &super::super::tests::digest(),
    )
    .await;
    assert!(
        result.is_err(),
        "a lintable chart missing its persistent storage policy must be refused"
    );
    assert!(
        api.writes().is_empty(),
        "policy rejection must precede publication"
    );
    assert!(checkout.exact_change().await.unwrap());
    assert!(
        checkout.validate().await.is_err(),
        "the required native chart security checker cannot be skipped"
    );
}
