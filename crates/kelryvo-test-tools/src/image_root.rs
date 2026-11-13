//! Exported image contract in a disposable mount/PID/network namespace.
//! Emulation is copied into the fixture; host binfmt registration is untouched.
use kelryvo_test_tools::{Result, api, process};
use serde_json::{Value, json};
use std::{
    ffi::OsString,
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};

async fn host(program: impl AsRef<std::ffi::OsStr>, args: &[OsString]) -> Result<String> {
    let result = process::capture(
        program,
        args,
        &kelryvo_test_tools::root(),
        &process::local_environment(),
        None,
        Duration::from_secs(120),
    )
    .await?;
    if !result.success || result.stdout.len() > 2 * 1024 * 1024 {
        return Err("Exported image command failed its bounded contract".into());
    }
    Ok(String::from_utf8(result.stdout)?.trim().to_owned())
}
fn identity(root: &Path) -> Result<Value> {
    let value: Value =
        serde_json::from_slice(&fs::read(root.join("opt/kelryvo/source-identity.json"))?)?;
    if value["format"] != 2
        || value["implementation"] != "RUST"
        || value["profile"] != "release"
        || !["x86_64", "aarch64"].contains(&value["architecture"].as_str().unwrap_or(""))
        || !regex::Regex::new(r"^[a-f0-9]{64}$")?
            .is_match(value["sourceTreeDigest"].as_str().unwrap_or(""))
    {
        return Err("Exported release source identity unavailable".into());
    }
    Ok(value)
}
struct Chroot<'a> {
    root: &'a Path,
    emulated: bool,
}
impl Chroot<'_> {
    async fn run(
        &self,
        binary: &str,
        args: &[&str],
        uid: u32,
        caps: &str,
        success: bool,
        error: Option<&str>,
    ) -> Result<String> {
        let mut argv = Vec::<OsString>::new();
        if uid != 0 {
            argv.extend([
                format!("--userspec={uid}:{uid}").into(),
                format!("--groups={uid}").into(),
            ]);
        }
        argv.push(self.root.as_os_str().into());
        if self.emulated {
            argv.push("/dev/.buildkit_qemu_emulator".into());
        }
        argv.push("/usr/bin/setpriv".into());
        if uid == 0 {
            argv.push(format!("--bounding-set={caps}").into());
        }
        argv.extend([OsString::from("--no-new-privs"), binary.into()]);
        argv.extend(args.iter().map(OsString::from));
        let output = process::capture(
            "/usr/sbin/chroot",
            &argv,
            &kelryvo_test_tools::root(),
            &process::local_environment(),
            None,
            Duration::from_secs(120),
        )
        .await?;
        if output.code != Some(if success { 0 } else { 1 })
            || error.is_some_and(|text| !String::from_utf8_lossy(&output.stderr).contains(text))
        {
            return Err(format!("Exported image role/command refusal mismatch: {binary}").into());
        }
        Ok(String::from_utf8(output.stdout)?.trim().to_owned())
    }
}
pub async fn namespace(root: &Path, mode: &str) -> Result<()> {
    let cache = kelryvo_test_tools::root().join(".cache");
    if !nix::unistd::geteuid().is_root()
        || std::process::id() != 1
        || root.canonicalize()? != root
        || root.parent().and_then(Path::parent) != Some(cache.as_path())
        || !root
            .parent()
            .and_then(Path::file_name)
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.starts_with("rust-image-contract."))
        || root.file_name().is_none_or(|s| s != "root")
        || !["native", "emulated"].contains(&mode)
    {
        return Err("Private exported-image namespace binding required".into());
    }
    let links = host("/usr/sbin/ip", &["-j".into(), "link".into()]).await?;
    let links: Value = serde_json::from_str(&links)?;
    if links
        .as_array()
        .is_none_or(|v| v.len() != 1 || v[0]["ifname"] != "lo")
    {
        return Err("Exported-image network must remain empty".into());
    }
    let expected = identity(root)?;
    host("/usr/bin/mount", &["--make-rprivate".into(), "/".into()]).await?;
    host(
        "/usr/bin/chown",
        &["-Rh".into(), "0:0".into(), root.as_os_str().into()],
    )
    .await?;
    for argv in [
        vec![
            "--bind".into(),
            root.as_os_str().into(),
            root.as_os_str().into(),
        ],
        vec![
            "--bind".into(),
            "/dev/null".into(),
            root.join("dev/null").into_os_string(),
        ],
        vec![
            "-t".into(),
            "proc".into(),
            "proc".into(),
            root.join("proc").into_os_string(),
        ],
        vec![
            "-o".into(),
            "remount,bind,ro".into(),
            root.as_os_str().into(),
        ],
    ] {
        host("/usr/bin/mount", &argv).await?;
    }
    let fixture = Chroot {
        root,
        emulated: mode == "emulated",
    };
    let architecture = fixture
        .run("/bin/uname", &["-m"], 0, "-all", true, None)
        .await?;
    api::check(
        &json!(architecture),
        &expected["architecture"],
        "image architecture",
    )?;
    let status = fixture
        .run("/bin/cat", &["/proc/self/status"], 0, "-all", true, None)
        .await?;
    for (field, wanted) in [
        ("Uid:", "0\t0\t0\t0"),
        ("CapEff:", "0000000000000000"),
        ("CapBnd:", "0000000000000000"),
        ("NoNewPrivs:", "1"),
    ] {
        if !status
            .lines()
            .any(|l| l.strip_prefix(field).is_some_and(|v| v.trim() == wanted))
        {
            return Err("Image privilege drop mismatch".into());
        }
    }
    let mut common = None;
    for name in [
        "kelryvo",
        "kelryvo-server",
        "kelryvo-worker",
        "kelryvo-operator",
        "kelryvo-runtime",
    ] {
        let info: Value = serde_json::from_str(
            &fixture
                .run(
                    &format!("/opt/kelryvo/bin/{name}"),
                    &["--build-info"],
                    0,
                    "-all",
                    true,
                    None,
                )
                .await?,
        )?;
        if info["implementation"] != "RUST" || info["os"] != "linux" {
            return Err("Image binary is not native Linux Rust".into());
        }
        for field in ["sourceSha", "sourceTreeDigest", "profile", "architecture"] {
            api::check(&info[field], &expected[field], "image binary identity")?;
        }
        if let Some(common) = &common {
            api::check(&info, common, "image common identity")?;
        } else {
            common = Some(info);
        }
    }
    fixture
        .run(
            "/opt/kelryvo/bin/kelryvo",
            &["verify-dist", "/opt/kelryvo"],
            0,
            "-all",
            true,
            None,
        )
        .await?;
    for file in [
        "opt/licenses/os/runtime-inventory.json",
        "opt/kelryvo/licenses/cargo-inventory.json",
        "opt/kelryvo/dist/rust-web/app_bg.wasm",
    ] {
        if root.join(file).metadata()?.len() == 0 {
            return Err("Image runtime inventory/assets missing".into());
        }
    }
    // Resolve actual commands in the selected image. This also catches a
    // symlink to an interpreter outside the expected package inventory.
    for tool in [
        "node",
        "nodejs",
        "npm",
        "java",
        "javac",
        "python3",
        "cargo",
        "rustc",
        "wasm-bindgen",
    ] {
        for directory in ["usr/bin", "bin"] {
            if fs::symlink_metadata(root.join(directory).join(tool)).is_ok() {
                return Err("Development interpreter present in release image".into());
            }
        }
    }
    for uid in [10001, 10002] {
        let actual = fixture
            .run("/usr/bin/id", &["-u"], uid, "-all", true, None)
            .await?;
        if actual != uid.to_string() {
            return Err("Image role UID mismatch".into());
        }
        fixture
            .run(
                "/opt/kelryvo/bin/kelryvo-operator",
                &["initialize"],
                uid,
                "-all",
                false,
                Some("Operator action unavailable."),
            )
            .await?;
    }
    fixture
        .run(
            "/opt/kelryvo/bin/kelryvo-worker",
            &["discovery-child"],
            10001,
            "-all",
            false,
            Some("Worker unavailable"),
        )
        .await?;
    fixture
        .run(
            "/opt/kelryvo/bin/kelryvo-runtime",
            &[],
            0,
            "-all,+chown,+kill,+setuid,+setgid",
            false,
            Some("Kelryvo runtime unavailable."),
        )
        .await?;
    println!(
        "{}",
        json!({"architecture":architecture,"emulated":mode=="emulated","releaseBinaries":5,"sourceTreeDigest":expected["sourceTreeDigest"],"sourceSha":expected["sourceSha"],"qualification":"NOT_RUN"})
    );
    Ok(())
}
pub async fn run(args: &[String]) -> Result<()> {
    let [image, rest @ ..] = args else {
        return Err("An absolute exported image root is required".into());
    };
    if rest.len() > 1 {
        return Err("Expected only an optional absolute BuildKit emulator".into());
    }
    let image = PathBuf::from(image);
    let cache = kelryvo_test_tools::root().join(".cache");
    if !image.is_absolute()
        || image.canonicalize()? != image
        || image.parent().and_then(Path::parent) != Some(cache.as_path())
        || !image
            .parent()
            .and_then(Path::file_name)
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.starts_with("buildkit-overlay."))
    {
        return Err("Private BuildKit export required".into());
    }
    let expected = identity(&image)?;
    let emulator = rest.first().map(PathBuf::from);
    if emulator.is_some() != (expected["architecture"] != std::env::consts::ARCH) {
        return Err("Use an explicit emulator only for a foreign image architecture".into());
    }
    if let Some(path) = &emulator {
        let info = fs::symlink_metadata(path)?;
        if !path.is_absolute() || !info.is_file() || info.permissions().mode() & 0o111 == 0 {
            return Err("Explicit regular executable emulator required".into());
        }
    }
    let cli = std::env::var_os("KELRYVO_RUST_CLI")
        .map(PathBuf::from)
        .unwrap_or_else(|| kelryvo_test_tools::root().join("target/debug/kelryvo"));
    if !cli.is_absolute() {
        return Err("Absolute host verification tool required".into());
    }
    let verify = [
        OsString::from("verify-dist"),
        image.join("opt/kelryvo").into_os_string(),
    ];
    host(&cli, &verify).await?;
    let directory =
        kelryvo_test_tools::process::private_directory("rust-image-contract.", &cache)?.keep();
    let root = directory.join("root");
    fs::create_dir(&root)?;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o755))?;
    host(
        "/usr/bin/cp",
        &[
            "-a".into(),
            "--reflink=auto".into(),
            image.join(".").into_os_string(),
            root.clone().into_os_string(),
        ],
    )
    .await?;
    fs::set_permissions(&root, fs::Permissions::from_mode(0o755))?;
    for name in ["dev", "proc"] {
        fs::create_dir_all(root.join(name))?;
    }
    // These are fixture-owned paths in a validated export copy only.
    fs::write(root.join("dev/null"), [])?;
    if let Some(path) = &emulator {
        let dest = root.join("dev/.buildkit_qemu_emulator");
        fs::copy(path, &dest)?;
        fs::set_permissions(dest, fs::Permissions::from_mode(0o555))?;
    }
    let mode = if emulator.is_some() {
        "emulated"
    } else {
        "native"
    };
    let mut argv: Vec<OsString> = [
        "-n",
        "/usr/bin/unshare",
        "--mount",
        "--pid",
        "--net",
        "--fork",
        "--mount-proc",
        "--kill-child=SIGKILL",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    argv.extend([
        std::env::current_exe()?.into_os_string(),
        "--image-root-namespace".into(),
        root.into_os_string(),
        mode.into(),
    ]);
    let report: Value = serde_json::from_str(&host("/usr/bin/sudo", &argv).await?)?;
    api::check(
        &report["architecture"],
        &expected["architecture"],
        "export architecture",
    )?;
    api::check(
        &report["emulated"],
        &json!(emulator.is_some()),
        "export emulation",
    )?;
    host(&cli, &verify).await?;
    api::private_file(
        &directory.join("result.json"),
        &serde_json::to_vec_pretty(&report)?,
    )?;
    println!(
        "PASS: {mode} exported-image identity, read-only root, empty network, capability drop, role refusals and inventory; Docker/TLS/PID1/Oracle qualification NOT_RUN."
    );
    Ok(())
}
