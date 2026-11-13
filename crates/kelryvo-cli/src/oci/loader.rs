//! Exact local OCI import. Verification of private frozen bytes precedes every
//! daemon mutation; Docker must preserve the verified manifest and config.
use super::*;
trait Docker {
    async fn run(&mut self, args: &[String]) -> Result<String>;
}
struct Local;
impl Docker for Local {
    async fn run(&mut self, args: &[String]) -> Result<String> {
        let mut argv = vec!["--host".into(), "unix:///var/run/docker.sock".into()];
        argv.extend(args.iter().map(Into::into));
        let output = crate::delivery::copy::capture_at(
            Path::new("/usr/bin/docker"),
            &argv,
            std::time::Duration::from_secs(120),
            None,
        )
        .await
        .map_err(|_| "Local Docker command unavailable")?;
        if !output.success || output.stdout.len() > 2 * 1024 * 1024 {
            return Err("Exact OCI loading requires the local Docker containerd image store");
        }
        String::from_utf8(output.stdout.to_vec()).map_err(|_| "Invalid local Docker output")
    }
}
fn inspect(actual: &Value, expected: &Value, arch: &str) -> Result<()> {
    let actual = &actual[0];
    let descriptor = actual["Descriptor"]["digest"]
        .as_str()
        .or_else(|| actual["Id"].as_str());
    if descriptor != expected["descriptor"]["digest"].as_str()
        || !(actual["Id"] == expected["descriptor"]["digest"]
            || actual["Id"] == expected["configDigest"])
        || actual["Architecture"] != arch
        || actual["Os"] != "linux"
        || actual["RootFS"]["Layers"] != expected["config"]["rootfs"]["diff_ids"]
    {
        return Err("Docker changed the verified OCI manifest, config, platform or layers");
    }
    for field in ["Labels", "Entrypoint", "User", "Env"] {
        if actual["Config"].get(field) != expected["config"]["config"].get(field) {
            return Err("Docker changed the verified OCI role configuration");
        }
    }
    let empty = json!([]);
    if actual["Config"]
        .get("Cmd")
        .filter(|v| !v.is_null())
        .unwrap_or(&empty)
        != expected["config"]["config"]
            .get("Cmd")
            .filter(|v| !v.is_null())
            .unwrap_or(&empty)
    {
        return Err("Docker changed the verified OCI command");
    }
    Ok(())
}
async fn load(archive: &Path, source: &str, arch: &str, docker: &mut impl Docker) -> Result<Value> {
    if !hex(source, 40) || !ARCHES.contains(&arch) {
        return Err("Expected exact source revision and supported native architecture");
    }
    let frozen = freeze(archive)?;
    let expected = Layout::open(frozen.path())?
        .single(source, arch)?
        .report(arch);
    let layers = expected["config"]["rootfs"]["diff_ids"]
        .as_array()
        .ok_or("Missing OCI layer diff IDs")?;
    if expected["config"]["rootfs"]["type"] != "layers"
        || layers.len()
            != expected["manifest"]["layers"]
                .as_array()
                .ok_or("Missing OCI layers")?
                .len()
    {
        return Err("Invalid OCI layer configuration");
    }
    docker
        .run(&[
            "image".into(),
            "load".into(),
            "--input".into(),
            frozen
                .path()
                .to_str()
                .ok_or("Invalid private archive path")?
                .into(),
        ])
        .await?;
    let digest = expected["descriptor"]["digest"]
        .as_str()
        .ok_or("Missing verified platform digest")?;
    let actual = docker
        .run(&["image".into(), "inspect".into(), digest.into()])
        .await?;
    inspect(&json(actual.as_bytes())?, &expected, arch)?;
    docker
        .run(&[
            "image".into(),
            "tag".into(),
            digest.into(),
            "kelryvo-app:test".into(),
        ])
        .await?;
    let actual = docker
        .run(&["image".into(), "inspect".into(), "kelryvo-app:test".into()])
        .await?;
    inspect(&json(actual.as_bytes())?, &expected, arch)?;
    Ok(json!({"architecture":arch,"manifestDigest":digest,"configDigest":expected["configDigest"]}))
}
pub(super) fn command(archive: &Path, source: &str, arch: &str) -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(_) => return ExitCode::FAILURE,
    };
    match runtime.block_on(load(archive, source, arch, &mut Local)) {
        Ok(report) => {
            println!("{report}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    struct Recording(usize);
    impl Docker for Recording {
        async fn run(&mut self, _: &[String]) -> Result<String> {
            self.0 += 1;
            Err("An unverified archive cannot reach Docker")
        }
    }
    #[tokio::test]
    async fn unverified_archives_never_reach_the_image_loader() {
        let mut recording = Recording(0);
        assert!(
            load(
                Path::new("/nonexistent-kelryvo-fixture.tar"),
                &"a".repeat(40),
                "amd64",
                &mut recording
            )
            .await
            .is_err()
        );
        let file = tempfile::NamedTempFile::new().unwrap();
        fs::write(file.path(), b"not an OCI archive").unwrap();
        assert!(
            load(file.path(), &"a".repeat(40), "amd64", &mut recording)
                .await
                .is_err()
        );
        assert!(
            load(file.path(), "not-a-source", "amd64", &mut recording)
                .await
                .is_err()
        );
        assert_eq!(recording.0, 0);
    }
    #[test]
    fn converted_or_mutated_docker_inspection_is_refused() {
        let expected = json!({"descriptor":{"digest":"sha256:manifest"},"configDigest":"sha256:config","config":{"rootfs":{"diff_ids":["sha256:layer"]},"config":{"User":"0:0","Entrypoint":["/opt/kelryvo/bin/kelryvo-runtime"],"Labels":{"source":"fixture"},"Env":["LANG=C"]}}});
        let actual = json!([{"Descriptor":{"digest":"sha256:manifest"},"Id":"sha256:config","Architecture":"amd64","Os":"linux","RootFS":{"Layers":["sha256:layer"]},"Config":expected["config"]["config"]}]);
        inspect(&actual, &expected, "amd64").unwrap();
        for field in ["User", "Entrypoint", "Labels", "Env"] {
            let mut changed = actual.clone();
            changed[0]["Config"][field] = Value::Null;
            assert!(inspect(&changed, &expected, "amd64").is_err());
        }
        let mut changed = actual.clone();
        changed[0]["Descriptor"]["digest"] = "converted".into();
        assert!(inspect(&changed, &expected, "amd64").is_err());
        let mut changed = actual;
        changed[0]["RootFS"]["Layers"] = json!(["changed"]);
        assert!(inspect(&changed, &expected, "amd64").is_err());
    }
}
