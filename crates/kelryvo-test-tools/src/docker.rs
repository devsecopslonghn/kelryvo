//! Local-daemon fixture transport. No inherited daemon/context, credentials,
//! registry write or shell expansion can choose an external destination.
use kelryvo_test_tools::{Result, api, process};
use std::{collections::BTreeMap, ffi::OsString, time::Duration};
pub fn require(valid: bool, label: &str) -> Result<()> {
    api::check(&serde_json::json!(valid), &serde_json::json!(true), label)
}
pub fn valid_image(image: &str) -> bool {
    image.len() <= 255
        && image
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphanumeric())
        && image
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._/:@-".contains(&b))
}
pub fn arguments(args: &[OsString]) -> Vec<OsString> {
    let mut argv = vec!["--host".into(), "unix:///var/run/docker.sock".into()];
    argv.extend_from_slice(args);
    argv
}
pub async fn invoke(args: &[OsString], input: Option<&[u8]>) -> Result<process::Output> {
    process::capture(
        "/usr/bin/docker",
        &arguments(args),
        &kelryvo_test_tools::root(),
        &process::local_environment(),
        input,
        Duration::from_secs(60),
    )
    .await
}
pub async fn run(args: &[OsString], input: Option<&[u8]>) -> Result<Vec<u8>> {
    let output = invoke(args, input).await?;
    require(output.success, "local Docker fixture command")?;
    Ok(output.stdout)
}
pub async fn text(args: &[&str]) -> Result<String> {
    Ok(
        String::from_utf8(run(&args.iter().map(OsString::from).collect::<Vec<_>>(), None).await?)?
            .trim()
            .to_owned(),
    )
}
pub fn cleanup(args: &[OsString], environment: &BTreeMap<OsString, OsString>) -> Option<Vec<u8>> {
    // Drop paths use the system deadline utility because async work may already
    // be cancelled. Only fixed, owned fixture cleanup arguments reach here.
    let output = std::process::Command::new("/usr/bin/timeout")
        .args(["--signal=TERM", "--kill-after=2s", "10s", "/usr/bin/docker"])
        .args(arguments(args))
        .env_clear()
        .envs(environment)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()?;
    (output.status.success() && output.stdout.len() <= 1024 * 1024).then_some(output.stdout)
}
pub async fn sudo(
    args: &[OsString],
    environment: &BTreeMap<OsString, OsString>,
    input: Option<&[u8]>,
) -> Result<Vec<u8>> {
    let mut argv = vec![OsString::from("-n")];
    argv.extend_from_slice(args);
    let output = process::capture(
        "/usr/bin/sudo",
        &argv,
        &kelryvo_test_tools::root(),
        environment,
        input,
        Duration::from_secs(120),
    )
    .await?;
    require(output.success, "private local root fixture action")?;
    Ok(output.stdout)
}
pub fn words(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}
pub async fn probe(info: &serde_json::Value) -> Result<std::path::PathBuf> {
    use std::os::unix::fs::MetadataExt;
    let path = std::path::PathBuf::from(
        std::env::var_os("KELRYVO_CONTAINER_PROBE")
            .ok_or("Build the container-test-tools target and select KELRYVO_CONTAINER_PROBE")?,
    );
    let metadata = std::fs::symlink_metadata(&path)?;
    require(
        path.is_absolute()
            && metadata.is_file()
            && metadata.nlink() == 1
            && metadata.mode() & 0o002 == 0
            && metadata.len() <= 128 * 1024 * 1024,
        "bounded regular native probe executable",
    )?;
    let path = path.canonicalize()?;
    let output = process::capture(
        &path,
        &["--build-info".into()],
        &kelryvo_test_tools::root(),
        &process::local_environment(),
        None,
        Duration::from_secs(10),
    )
    .await?;
    require(output.success, "native probe identity command")?;
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)?;
    for (key, expected) in [
        ("kind", serde_json::json!("CONTAINER_TEST_PROBE")),
        ("implementation", serde_json::json!("RUST")),
        ("sourceSha", info["sourceSha"].clone()),
        ("architecture", info["architecture"].clone()),
        (
            "probeSourceSha256",
            serde_json::json!(kelryvo_core::sha256(include_bytes!("container_probe.rs"))),
        ),
    ] {
        api::check(
            &value[key],
            &expected,
            "probe matches native image/source identity",
        )?;
    }
    Ok(path)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_daemon_and_image_selection_are_fixed_and_bounded() {
        assert_eq!(
            arguments(&words(&["image", "inspect", "local:test"])),
            words(&[
                "--host",
                "unix:///var/run/docker.sock",
                "image",
                "inspect",
                "local:test"
            ])
        );
        assert!(valid_image("registry.example.invalid/team/app@sha256:abc"));
        for value in ["--host=remote", "image;id", "$(private)", "", "a\nb"] {
            assert!(!valid_image(value));
        }
        assert!(!valid_image(&"a".repeat(256)));
    }
}
