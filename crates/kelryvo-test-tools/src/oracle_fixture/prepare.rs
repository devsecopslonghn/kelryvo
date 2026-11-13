//! Exact public artifact preparation before any disposable database starts.
//! Only content-addressed public downloads may retry; product jobs never retry.
use super::*;
fn rust_inputs(directory: &Path, repo: &Path, output: &mut BTreeMap<String, Value>) -> Result<()> {
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        require(!kind.is_symlink(), "harness sources cannot follow links")?;
        if kind.is_dir() {
            rust_inputs(&entry.path(), repo, output)?;
        } else if entry.path().extension().is_some_and(|s| s == "rs") {
            output.insert(
                entry
                    .path()
                    .strip_prefix(repo)?
                    .to_str()
                    .ok_or("Harness input path")?
                    .into(),
                hash(&entry.path())?.into(),
            );
        }
    }
    Ok(())
}
impl Fixture {
    fn inputs(&self) -> Result<Value> {
        let mut inputs = BTreeMap::new();
        for name in [
            "target/debug/kelryvo-test",
            "Cargo.lock",
            "Cargo.toml",
            ".cargo/config.toml",
            "crates/kelryvo-test-tools/Cargo.toml",
        ] {
            inputs.insert(name.into(), hash(&self.repo.join(name))?.into());
        }
        rust_inputs(
            &self.repo.join("crates/kelryvo-test-tools/src"),
            &self.repo,
            &mut inputs,
        )?;
        Ok(json!(inputs))
    }
    pub(super) async fn prepare(&self, args: &[String]) -> Result<()> {
        let mut image = None;
        let mut java = None;
        let mut test = self.repo.join("target/debug/kelryvo-test");
        let mut index = 0;
        while index < args.len() {
            match args[index].as_str() {
                "--java"|"--test-binary"=>{
                    let value=args.get(index+1).ok_or("Fixture option value")?;
                    if args[index]=="--java" {require(java.is_none(),"one PKI Java tool")?;java=Some(PathBuf::from(value));}else {test=PathBuf::from(value);}
                    index+=2;
                }
                value if !value.starts_with('-')&&image.is_none()=>{image=Some(PathBuf::from(value));index+=1;}
                _=>return Err("Usage: --installed-oracle-fixture IMAGE --java JAVA [--test-binary TEST] | --prepared".into()),
            }
        }
        let image = image
            .ok_or("Exact exported image root required")?
            .canonicalize()?;
        let java = java
            .ok_or("Explicit reviewed PKI Java tool required")?
            .canonicalize()?;
        let test = test.canonicalize()?;
        require(
            nix::unistd::getuid().is_root() && !self.root.try_exists()?,
            "fresh OS-root fixture required; never resume partial Oracle DDL",
        )?;
        let space = nix::sys::statvfs::statvfs(&self.repo)?;
        require(
            space
                .blocks_available()
                .saturating_mul(space.fragment_size())
                >= 12 * 1024 * 1024 * 1024,
            "12 GiB free disposable fixture storage",
        )?;
        require(
            image
                == self
                    .repo
                    .join(".cache/buildkit-overlay.current-amd64/rootfs"),
            "selected exact exported amd64 image",
        )?;
        require(
            test == self.repo.join("target/debug/kelryvo-test")
                && [&test, &java]
                    .iter()
                    .all(|p| fs::metadata(p).is_ok_and(|m| m.is_file() && m.mode() & 0o111 != 0)),
            "exact native test and executable PKI tool",
        )?;
        let report = read(
            &self
                .repo
                .join(".cache/native-image-build/amd64-independent-verification.json"),
        )?;
        let identity = read(&image.join("opt/kelryvo/source-identity.json"))?;
        api::check(
            &report["sourceTreeDigest"],
            &identity["sourceTreeDigest"],
            "selected report/image source identity",
        )?;
        require(
            !self.result_path(&report)?.try_exists()?,
            "previous source-qualified result must be retained separately",
        )?;
        api::check(
            &report["archiveSha256"],
            &json!(hash(&self.repo.join(
                ".cache/native-image-build/kelryvo-current-amd64.oci.tar"
            ))?),
            "selected image archive exact checksum",
        )?;
        require(
            report["sourceComparison"] == "CURRENT_WORKTREE"
                && identity["architecture"] == "x86_64",
            "current worktree and native amd64 fixture scope",
        )?;
        let client = self
            .repo
            .join(".cache/native-client-loader-check/basic.zip");
        require(
            hash(&client)? == CLIENT_HASH,
            "reviewed exact Oracle client ZIP",
        )?;
        fs::DirBuilder::new().mode(0o711).create(&self.root)?;
        fs::DirBuilder::new().mode(0o700).create(&self.private)?;
        json_file(&self.private.join("fixture-artifact.json"), &report, 0o600)?;
        json_file(
            &self.private.join("harness-inputs.json"),
            &self.inputs()?,
            0o600,
        )?;
        json_file(
            &self.private.join("tools.json"),
            &json!({"test":test,"java":java}),
            0o600,
        )?;
        json_file(
            &self.private.join("containers-auth.json"),
            &json!({"auths":{}}),
            0o600,
        )?;
        stage("fetch pinned public vendor image into one private root");
        let mut fetched = false;
        for attempt in 0..3 {
            let argv = [
                words(&["/usr/bin/skopeo", "copy", "--authfile"]),
                vec![self.private.join("containers-auth.json").into_os_string()],
                words(&[
                    "--override-os",
                    "linux",
                    "--override-arch",
                    "amd64",
                    ORACLE_IMAGE,
                    &format!("oci:{}:oracle", self.root.join("vendor-layout").display()),
                ]),
            ]
            .concat();
            if self
                .run(
                    &argv,
                    None,
                    &environment(),
                    Duration::from_secs(900),
                    "vendor-download",
                )
                .await
                .is_ok()
            {
                fetched = true;
                break;
            }
            if attempt < 2 {
                stage("retry public vendor download; no database has started");
                tokio::time::sleep(Duration::from_secs(2 * (attempt + 1))).await;
            }
        }
        require(fetched, "pinned vendor download completed")?;
        let layout = self.root.join("vendor-layout");
        for entry in fs::read_dir(layout.join("blobs/sha256"))? {
            let entry = entry?;
            require(
                entry.file_name().to_str() == Some(hash(&entry.path())?.as_str()),
                "vendor OCI blob checksum",
            )?;
        }
        let index = read(&layout.join("index.json"))?;
        let blob = |digest: &Value| -> Result<PathBuf> {
            let digest = digest.as_str().ok_or("Vendor OCI digest")?;
            let hash = digest.strip_prefix("sha256:").ok_or("Vendor OCI SHA256")?;
            require(
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
                "closed vendor OCI digest",
            )?;
            Ok(layout.join("blobs/sha256").join(hash))
        };
        let manifest = read(&blob(&index["manifests"][0]["digest"])?)?;
        let config = read(&blob(&manifest["config"]["digest"])?)?;
        require(
            config["architecture"] == "amd64"
                && config["os"] == "linux"
                && config["config"]["User"] == "oracle"
                && config["config"]["Entrypoint"] == json!(["container-entrypoint.sh"]),
            "pinned vendor Oracle native image contract",
        )?;
        json_file(&self.private.join("vendor-config.json"), &config, 0o600)?;
        self.run(
            &[
                vec![
                    self.repo
                        .join(".cache/native-image-build/bin/umoci")
                        .into_os_string(),
                ],
                words(&["unpack", "--image", &format!("{}:oracle", layout.display())]),
                vec![self.root.join("oracle-root").into_os_string()],
            ]
            .concat(),
            None,
            &environment(),
            Duration::from_secs(300),
            "vendor-unpack",
        )
        .await?;
        fs::remove_dir_all(&layout)?;
        self.command(
            &[
                words(&["/usr/bin/cp", "--archive", "--"]),
                vec![image.into_os_string(), self.app.as_os_str().into()],
            ]
            .concat(),
            "private-image-copy",
        )
        .await?;
        chmod(&self.app, 0o755)?;
        let destination = self.app.join("opt/kelryvo/oracle/client");
        fs::create_dir_all(&destination)?;
        chmod(&destination, 0o755)?;
        let client = crate::runtime_prepare::freeze_client(&client, &self.private)?;
        crate::runtime_prepare::extract_client(client, &destination)?;
        let tools = self.root.join("pki-tools");
        fs::DirBuilder::new().mode(0o700).create(&tools)?;
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(60))
            .build()?;
        let mut response=client.get("https://repo.maven.apache.org/maven2/com/oracle/database/security/oraclepki/23.26.0.0.0/oraclepki-23.26.0.0.0.jar").send().await?;
        require(
            response.status().is_success(),
            "pinned public PKI artifact download",
        )?;
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            require(
                bytes.len() + chunk.len() <= 1024 * 1024,
                "bounded PKI artifact",
            )?;
            bytes.extend_from_slice(&chunk);
        }
        require(
            kelryvo_core::sha256(&bytes) == PKI_HASH,
            "reviewed exact PKI JAR checksum",
        )?;
        write(&tools.join("oraclepki.jar"), &bytes, 0o600)?;
        fs::copy(
            self.app.join("usr/lib/x86_64-linux-gnu/libaio.so.1.0.2"),
            tools.join("libaio.so.1"),
        )?;
        json_file(
            &self.private.join("fixture-prepared.json"),
            &json!({"format":1,"phase":"BEFORE_ORACLE_START"}),
            0o600,
        )?;
        self.run_prepared().await
    }
    pub(super) async fn run_prepared(&self) -> Result<()> {
        require(
            nix::unistd::getuid().is_root()
                && self.root.canonicalize()? == self.root
                && fs::symlink_metadata(&self.root)?.is_dir(),
            "OS-root canonical prepared fixture",
        )?;
        api::check(
            &read(&self.private.join("fixture-prepared.json"))?,
            &json!({"format":1,"phase":"BEFORE_ORACLE_START"}),
            "fixture has not started a database",
        )?;
        // Exact current membership prevents missing/extra/old Python harness
        // pins from transferring earlier acceptance to this Rust rewrite.
        api::check(
            &read(&self.private.join("harness-inputs.json"))?,
            &self.inputs()?,
            "prepared native harness and binary unchanged",
        )?;
        require(
            read(&self.private.join("tools.json"))?["test"]
                == self
                    .repo
                    .join("target/debug/kelryvo-test")
                    .to_str()
                    .ok_or("Native test path")?,
            "prepared fixture exact native tool",
        )?;
        require(
            !self.private.join("oracle.log").try_exists()?
                && !self.root.join("postgres").try_exists()?,
            "never resume an initialized fixture database",
        )?;
        let output = self.result_path(&read(&self.private.join("fixture-artifact.json"))?)?;
        require(
            !output.try_exists()?,
            "never overwrite a source-qualified fixture result",
        )?;
        let previous = self.private.join("namespace.log");
        if previous.try_exists()? {
            fs::rename(
                &previous,
                self.private
                    .join(format!("namespace-before-start-{}.log", Uuid::new_v4())),
            )?;
        }
        let unused = self.oracle.join("run/fixture/oracle-password");
        if unused.try_exists()? {
            require(
                fs::symlink_metadata(&unused)?.is_file(),
                "unused before-start password is regular",
            )?;
            fs::remove_file(unused)?;
        }
        stage("download checksums verified; enter isolated local namespaces");
        let args = [
            words(&[
                "/usr/bin/unshare",
                "--mount",
                "--pid",
                "--fork",
                "--net",
                "--ipc",
                "--uts",
                "--mount-proc",
                "--kill-child=SIGKILL",
            ]),
            vec![std::env::current_exe()?.into_os_string()],
            words(&["--installed-oracle-fixture", "--namespace"]),
        ]
        .concat();
        let mut child = self.log_child(&args, &environment(), "namespace.log")?;
        require(
            child.child.wait().await?.success(),
            "fixture failed; inspect private namespace.log; never replay its jobs",
        )?;
        let result = read(&self.private.join("fixture-result.json"))?;
        require(
            result["status"] == "PASS" && result["runtimeCleanShutdown"] == true,
            "product checks and runtime teardown both required",
        )?;
        json_file(&output, &result, 0o600)?;
        let repo = fs::metadata(&self.repo)?;
        chown(&output, repo.uid(), repo.gid())?;
        require(
            self.root.canonicalize()? == self.root
                && !fs::read_to_string("/proc/self/mountinfo")?
                    .lines()
                    .any(|line| {
                        line.split(" - ")
                            .next()
                            .is_some_and(|s| s.contains(self.root.to_str().unwrap_or("invalid")))
                    }),
            "owned fixture has no remaining mounts after namespace exit",
        )?;
        fs::remove_dir_all(&self.root)?;
        stage("PASS; private databases, keys, wallet and vendor root removed");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn prepared_harness_inventory_binds_membership_bytes_and_refuses_linked_sources() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("src");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("one.rs"), "native source one").unwrap();
        fs::write(source.join("fixture.json"), "data").unwrap();
        let mut first = BTreeMap::new();
        rust_inputs(&source, directory.path(), &mut first).unwrap();
        assert_eq!(first.len(), 1);
        let mut value = BTreeMap::new();
        rust_inputs(&source, directory.path(), &mut value).unwrap();
        assert_eq!(first, value);
        fs::write(source.join("one.rs"), "changed native source").unwrap();
        value.clear();
        rust_inputs(&source, directory.path(), &mut value).unwrap();
        assert_ne!(first, value);
        fs::write(source.join("two.rs"), "new native source").unwrap();
        value.clear();
        rust_inputs(&source, directory.path(), &mut value).unwrap();
        assert_eq!(value.len(), 2);
        std::os::unix::fs::symlink(source.join("one.rs"), source.join("alias.rs")).unwrap();
        value.clear();
        assert!(rust_inputs(&source, directory.path(), &mut value).is_err());
    }
}
