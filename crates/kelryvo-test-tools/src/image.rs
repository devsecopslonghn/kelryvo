//! Exact local Docker image checks. No publication or Oracle access.
use crate::runner::Context;
use kelryvo_test_tools::{Result, process};
use serde_json::{Value, json};
use std::{ffi::OsString, time::Duration};
async fn docker(context: &Context, args: &[&str], success: bool) -> Result<String> {
    let mut argv: Vec<OsString> = vec!["--host".into(), "unix:///var/run/docker.sock".into()];
    argv.extend(args.iter().map(OsString::from));
    let result = process::capture(
        "/usr/bin/docker",
        &argv,
        &context.root,
        &process::local_environment(),
        None,
        Duration::from_secs(120),
    )
    .await?;
    if result.success != success {
        return Err("Native image command did not meet its expected result".into());
    }
    if result.stdout.len() > 2 * 1024 * 1024 {
        return Err("Unbounded image fixture output".into());
    }
    Ok(String::from_utf8(result.stdout)?.trim().to_owned())
}
pub async fn container(
    context: &Context,
    image: &str,
    architecture: &str,
    revision: &str,
) -> Result<()> {
    if !regex::Regex::new(r"^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$")?.is_match(image)
        || !["amd64", "arm64"].contains(&architecture)
        || !regex::Regex::new(r"^[a-f0-9]{40}$")?.is_match(revision)
    {
        return Err("Expected local image, native architecture and exact source revision".into());
    }
    let config: Value =
        serde_json::from_str(&docker(context, &["image", "inspect", image], true).await?)?;
    let config = &config[0];
    if config["Architecture"] != architecture
        || config["Os"] != "linux"
        || config["Config"]["User"] != "0:0"
        || config["Config"]["Entrypoint"] != json!(["/opt/kelryvo/bin/kelryvo-runtime"])
        || config["Config"]["Labels"]["dev.kelryvo.implementation"] != "rust"
        || config["Config"]["Labels"]["org.opencontainers.image.revision"] != revision
    {
        return Err("Native image architecture, revision or process-role mismatch".into());
    }
    let selected = config["Id"]
        .as_str()
        .ok_or("Inspected native image id")?
        .to_owned();
    if !selected
        .strip_prefix("sha256:")
        .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return Err("Invalid immutable image id".into());
    }
    let image = selected.as_str();
    let security = [
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
    ];
    let mut common = None;
    for binary in [
        "kelryvo",
        "kelryvo-server",
        "kelryvo-worker",
        "kelryvo-operator",
        "kelryvo-runtime",
    ] {
        let entrypoint = format!("/opt/kelryvo/bin/{binary}");
        let args = [
            security.as_slice(),
            &["--entrypoint", &entrypoint, image, "--build-info"],
        ]
        .concat();
        let info: Value = serde_json::from_str(&docker(context, &args, true).await?)?;
        if info["sourceSha"] != revision
            || info["profile"] != "release"
            || info["implementation"] != "RUST"
            || info["architecture"]
                != if architecture == "amd64" {
                    "x86_64"
                } else {
                    "aarch64"
                }
            || !info["sourceTreeDigest"].as_str().is_some_and(|s| {
                s.len() == 64
                    && s.bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
        {
            return Err("Packaged native executable identity mismatch".into());
        }
        if common.as_ref().is_some_and(|previous| previous != &info) {
            return Err("Packaged native executables have different identities".into());
        }
        common = Some(info);
    }
    docker(
        context,
        &[
            security.as_slice(),
            &[
                "--entrypoint",
                "/opt/kelryvo/bin/kelryvo",
                image,
                "verify-dist",
                "/opt/kelryvo",
            ],
        ]
        .concat(),
        true,
    )
    .await?;
    let probe =
        crate::docker::probe(common.as_ref().ok_or("Native image executable identity")?).await?;
    let mount = format!(
        "type=bind,src={},dst=/kelryvo-test-probe,readonly",
        probe.display()
    );
    docker(
        context,
        &[
            security.as_slice(),
            &[
                "--entrypoint",
                "/kelryvo-test-probe",
                "--mount",
                &mount,
                image,
                "--container-probe",
                "image-inventory",
            ],
        ]
        .concat(),
        true,
    )
    .await?;
    docker(
        context,
        &[
            security.as_slice(),
            &[
                "--user",
                "10001:10001",
                "--entrypoint",
                "/opt/kelryvo/bin/kelryvo-worker",
                image,
                "discovery-child",
            ],
        ]
        .concat(),
        false,
    )
    .await?;
    docker(
        context,
        &[
            security.as_slice(),
            &[
                "--user",
                "10001:10001",
                "--entrypoint",
                "/opt/kelryvo/bin/kelryvo-operator",
                image,
                "initialize",
            ],
        ]
        .concat(),
        false,
    )
    .await?;
    docker(context, &[security.as_slice(), &[image]].concat(), false).await?;
    println!(
        "PASS: native image architecture, release source identity, exact bundle inventory, prerequisites, unprivileged role guards and missing-secret rejection. TLS/PID1/Oracle qualification remains separate."
    );
    Ok(())
}
