//! Opt-in, local-only disposable installed-Oracle lab orchestration. All live
//! commands remain behind the selected private namespace and fresh input pins.
//! Source conversion is not task authorization or runtime qualification.
mod namespace;
mod prepare;
mod qualification;
use crate::installed_oracle::{self, Driver};
use kelryvo_test_tools::{Result, api, oracle_guard, process};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs,
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::process::{Child, Command};
use uuid::Uuid;
const ORACLE_IMAGE: &str = "docker://docker.io/gvenzl/oracle-free@sha256:7ed34d0ade89c91a553c9cbe9d42457c758fa29a762aaaa3137541ff30a2d1cb";
const CLIENT_HASH: &str = "cab59aa3b411b3b50898e456fa9aabfe48d67e25cbc1bb23303800390ce7de26";
const PKI_HASH: &str = "c8dd5edc858624295c81c9bc32639e697f8cb3c0d31201fdb02db438e2472e0d";
const P: &str = "/run/kelryvo/operator/private";
const SOURCE: &str = "/run/kelryvo/operator/source-identity.json";
const SCHEMAS: [&str; 2] = ["KRV_ACK", "KRV_APP"];
fn require(value: bool, label: &str) -> Result<()> {
    api::check(&json!(value), &json!(true), label)
}
fn field(value: &Value, name: &str) -> Result<String> {
    Ok(value[name]
        .as_str()
        .ok_or("Missing private Oracle fixture field")?
        .into())
}
fn words(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}
fn environment() -> BTreeMap<OsString, OsString> {
    BTreeMap::from([
        ("PATH".into(), "/usr/sbin:/usr/bin:/sbin:/bin".into()),
        ("LANG".into(), "C.UTF-8".into()),
        ("TZ".into(), "UTC".into()),
    ])
}
fn canonical(value: &Value) -> Value {
    let mut value = value.clone();
    value.sort_all_objects();
    value
}
fn seal(value: &mut Value, key: &str) -> Result<()> {
    let mut copy = value.clone();
    copy.as_object_mut()
        .ok_or("Sealed fixture object")?
        .remove(key);
    value[key] = kelryvo_core::sha256(canonical(&copy).to_string()).into();
    Ok(())
}
fn read(path: &Path) -> Result<Value> {
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    require(
        metadata.is_file() && metadata.nlink() == 1 && metadata.len() <= 4 * 1024 * 1024,
        "bounded regular fixture JSON input",
    )?;
    let mut bytes = vec![];
    Read::by_ref(&mut file)
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    require(
        bytes.len() <= 4 * 1024 * 1024,
        "fixture JSON input read bound",
    )?;
    Ok(serde_json::from_slice(&bytes)?)
}
fn write(path: &Path, bytes: &[u8], mode: u32) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .custom_flags(nix::libc::O_NOFOLLOW)
        .open(path)?;
    file.set_permissions(fs::Permissions::from_mode(mode))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}
fn json_file(path: &Path, value: &Value, mode: u32) -> Result<()> {
    write(path, canonical(value).to_string().as_bytes(), mode)
}
fn chmod(path: &Path, mode: u32) -> Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}
fn chown(path: &Path, uid: u32, gid: u32) -> Result<()> {
    nix::unistd::chown(
        path,
        Some(nix::unistd::Uid::from_raw(uid)),
        Some(nix::unistd::Gid::from_raw(gid)),
    )?;
    Ok(())
}
fn hash(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    require(
        metadata.is_file() && metadata.len() <= 16 * 1024 * 1024 * 1024,
        "bounded regular fixture artifact",
    )?;
    let mut digest = Sha256::new();
    let mut size = 0;
    let mut buffer = [0; 65536];
    loop {
        let n = file.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        size += n as u64;
        require(
            size <= metadata.len(),
            "fixture artifact grew while hashing",
        )?;
        digest.update(&buffer[..n]);
    }
    require(size == metadata.len(), "complete fixture artifact hash")?;
    Ok(format!("{:x}", digest.finalize()))
}
fn stage(value: &str) {
    println!("Oracle fixture: {value}");
}
struct Fixture {
    repo: PathBuf,
    root: PathBuf,
    private: PathBuf,
    app: PathBuf,
    oracle: PathBuf,
}
impl Fixture {
    fn fixed() -> Result<Self> {
        let repo = kelryvo_test_tools::root();
        let root = repo.join(".cache/native-oracle-fixture");
        Ok(Self {
            private: root.join("private"),
            app: root.join("app-root"),
            oracle: root.join("oracle-root/rootfs"),
            repo,
            root,
        })
    }
    async fn run(
        &self,
        args: &[OsString],
        input: Option<&[u8]>,
        env: &BTreeMap<OsString, OsString>,
        timeout: Duration,
        name: &str,
    ) -> Result<Vec<u8>> {
        let (program, args) = args.split_first().ok_or("Private fixture command")?;
        let output = process::capture(program, args, &self.repo, env, input, timeout).await?;
        if !output.success {
            json_file(
                &self.private.join(format!("{name}-{}.json", Uuid::new_v4())),
                &json!({"exitCode":output.code,"stdout":String::from_utf8_lossy(&output.stdout),"stderr":String::from_utf8_lossy(&output.stderr)}),
                0o600,
            )?;
            return Err(format!("{name} failed; inspect private fixture diagnostics").into());
        }
        Ok(output.stdout)
    }
    async fn command(&self, args: &[OsString], name: &str) -> Result<Vec<u8>> {
        self.run(args, None, &environment(), Duration::from_secs(180), name)
            .await
    }
    async fn mount(&self, args: &[OsString]) -> Result<()> {
        self.command(
            &[words(&["/usr/bin/mount"]), args.to_vec()].concat(),
            "private-mount",
        )
        .await?;
        Ok(())
    }
    async fn native(
        &self,
        binary: &str,
        args: &[&str],
        input: Option<&[u8]>,
        uid: Option<u32>,
    ) -> Result<Value> {
        require(
            ["kelryvo-worker", "kelryvo-operator"].contains(&binary),
            "closed native fixture binary",
        )?;
        let mut argv = words(&["/usr/sbin/chroot"]);
        argv.extend([self.app.as_os_str().into(), "/usr/bin/setpriv".into()]);
        if let Some(uid) = uid {
            require([10001, 10002].contains(&uid), "fixed native fixture UID")?;
            argv.extend(words(&[
                "--bounding-set=-all",
                &format!("--reuid={uid}"),
                &format!("--regid={uid}"),
                "--clear-groups",
            ]));
        } else {
            argv.push("--bounding-set=-all,+chown,+kill,+setuid,+setgid".into());
        }
        argv.extend(words(&[
            "--no-new-privs",
            &format!("/opt/kelryvo/bin/{binary}"),
        ]));
        argv.extend(words(args));
        let bytes = self
            .run(
                &argv,
                input,
                &environment(),
                Duration::from_secs(180),
                "native-fixture-command",
            )
            .await?;
        if bytes.is_empty() || binary == "kelryvo-operator" {
            Ok(Value::Null)
        } else {
            Ok(serde_json::from_slice(&bytes)?)
        }
    }
    fn log_child(
        &self,
        args: &[OsString],
        env: &BTreeMap<OsString, OsString>,
        name: &str,
    ) -> Result<OwnedChild> {
        use std::os::unix::process::CommandExt;
        let (program, args) = args.split_first().ok_or("Private fixture child command")?;
        let log = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(self.private.join(name))?;
        let mut command = Command::new(program);
        command
            .args(args)
            .current_dir(&self.repo)
            .env_clear()
            .envs(env)
            .stdin(std::process::Stdio::null())
            .stdout(log.try_clone()?)
            .stderr(log)
            .kill_on_drop(true);
        command.as_std_mut().process_group(0);
        Ok(OwnedChild {
            child: command.spawn()?,
        })
    }
    fn result_path(&self, report: &Value) -> Result<PathBuf> {
        let source = field(report, "sourceTreeDigest")?;
        require(
            source.len() == 64
                && source
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)),
            "exact source-qualified result identity",
        )?;
        Ok(self.repo.join(format!(
            ".cache/native-image-build/amd64-{}-oracle-result.json",
            &source[..8]
        )))
    }
    fn host(&self, path: &str) -> PathBuf {
        self.app.join(path.trim_start_matches('/'))
    }
}
struct OwnedChild {
    child: Child,
}
impl Drop for OwnedChild {
    fn drop(&mut self) {
        if let Some(pid) = self.child.id() {
            let _ = nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            );
        }
        let _ = self.child.start_kill();
    }
}
impl OwnedChild {
    async fn stop(&mut self, deadline: Duration) -> Result<bool> {
        if let Some(status) = self.child.try_wait()? {
            return Ok(status.success());
        }
        if let Some(pid) = self.child.id() {
            let _ = nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid as i32),
                nix::sys::signal::Signal::SIGTERM,
            );
        }
        match tokio::time::timeout(deadline, self.child.wait()).await {
            Ok(status) => Ok(status?.success()),
            Err(_) => {
                self.child.start_kill()?;
                tokio::time::timeout(Duration::from_secs(10), self.child.wait()).await??;
                Ok(false)
            }
        }
    }
}
pub(crate) async fn run(args: &[String]) -> Result<()> {
    let fixture = Fixture::fixed()?;
    // Vendor/API roots remain traversable by their fixed UIDs. Every secret
    // file/directory still receives an explicit private mode before writing.
    require(
        nix::unistd::getuid().is_root(),
        "Oracle fixture orchestration requires its OS operator",
    )?;
    nix::sys::stat::umask(nix::sys::stat::Mode::from_bits_truncate(0o022));
    if args == ["--namespace"] {
        return fixture.namespace().await;
    }
    if args == ["--prepared"] {
        return fixture.run_prepared().await;
    }
    fixture.prepare(args).await
}
pub(crate) fn child(action: &str) -> Result<()> {
    Fixture::fixed()?.child(action)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_fixture_json_is_exclusive_bounded_and_never_follows_links() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("private.json");
        let value = json!({"native":"Việt 😀","phase":"BEFORE_ORACLE_START"});
        json_file(&path, &value, 0o600).unwrap();
        assert_eq!(read(&path).unwrap(), value);
        assert_eq!(fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert!(json_file(&path, &json!({"overwritten":true}), 0o600).is_err());
        let alias = directory.path().join("alias");
        std::os::unix::fs::symlink(&path, &alias).unwrap();
        assert!(read(&alias).is_err());
        assert!(write(&alias, b"replace", 0o600).is_err());
        fs::remove_file(&alias).unwrap();
        fs::hard_link(&path, &alias).unwrap();
        assert!(read(&path).is_err());
        fs::remove_file(alias).unwrap();
        let oversized = directory.path().join("oversized.json");
        let file = fs::File::create(&oversized).unwrap();
        file.set_len(4 * 1024 * 1024 + 1).unwrap();
        assert!(read(&oversized).is_err());
        assert_eq!(read(&path).unwrap(), value);
    }
    #[test]
    fn fixture_seals_are_canonical_and_bind_every_nonseal_field() {
        let mut first = json!({"z":1,"nested":{"b":2,"a":1},"digest":"previous"});
        let mut second = json!({"nested":{"a":1,"b":2},"digest":"different","z":1});
        seal(&mut first, "digest").unwrap();
        seal(&mut second, "digest").unwrap();
        assert_eq!(first["digest"], second["digest"]);
        assert_eq!(
            first["digest"],
            kelryvo_core::sha256(r#"{"nested":{"a":1,"b":2},"z":1}"#)
        );
        second["nested"]["a"] = 3.into();
        seal(&mut second, "digest").unwrap();
        assert_ne!(first["digest"], second["digest"]);
        assert!(seal(&mut json!([]), "digest").is_err());
    }
    #[tokio::test]
    async fn closed_lab_actions_refuse_host_namespace_and_unrecognized_inputs() {
        let fixture = Fixture::fixed().unwrap();
        assert!(fixture.child("unrecognized").is_err());
        assert!(fixture.namespace().await.is_err());
        assert!(
            fixture
                .prepare(&["--external-endpoint".into()])
                .await
                .is_err()
        );
        assert!(
            fixture
                .result_path(&json!({"sourceTreeDigest":"../../overwrite"}))
                .is_err()
        );
        let path = fixture
            .result_path(&json!({"sourceTreeDigest":"a".repeat(64)}))
            .unwrap();
        assert_eq!(
            path,
            fixture
                .repo
                .join(".cache/native-image-build/amd64-aaaaaaaa-oracle-result.json")
        );
    }
}
