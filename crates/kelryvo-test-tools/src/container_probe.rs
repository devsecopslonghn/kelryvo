//! Fixed native probes mounted only into disposable test containers. This
//! executable is a test input, never a member of the installed distribution.
use kelryvo_test_tools::Result;
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt, symlink},
    path::Path,
    process::{Command, Stdio},
};

fn require(valid: bool, message: &str) -> Result<()> {
    if valid {
        Ok(())
    } else {
        Err(message.to_owned().into())
    }
}
fn source_files(directory: &Path) -> Result<Vec<std::path::PathBuf>> {
    require(
        fs::symlink_metadata(directory)?.is_dir(),
        "regular fixture source directory",
    )?;
    let mut files = vec![];
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        require(
            entry.file_type()?.is_file() && entry.metadata()?.nlink() == 1,
            "only regular single-link fixture source files",
        )?;
        files.push(entry.path());
    }
    require(
        !files.is_empty() && files.len() <= 20,
        "bounded source secret fixture",
    )?;
    Ok(files)
}
fn owner(path: &Path, uid: u32, gid: u32, mode: u32) -> Result<()> {
    nix::unistd::chown(
        path,
        Some(nix::unistd::Uid::from_raw(uid)),
        Some(nix::unistd::Gid::from_raw(gid)),
    )?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}
fn mode(path: &Path, uid: u32, gid: u32, permissions: u32) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    require(
        metadata.uid() == uid && metadata.gid() == gid && metadata.mode() & 0o7777 == permissions,
        "container path owner and permissions",
    )
}
fn prepare(source: &str, success: bool) -> Result<()> {
    let output = Command::new("/opt/kelryvo/bin/kelryvo-runtime")
        .arg("--prepare")
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("KELRYVO_SECRET_DIR", source)
        .stdin(Stdio::null())
        .output()?;
    require(
        output.status.success() == success,
        "projected secret preparation result",
    )
}
pub fn run(args: &[String]) -> Result<()> {
    require(
        std::env::current_exe()? == Path::new("/kelryvo-test-probe")
            && Path::new("/.dockerenv").is_file()
            && Path::new("/opt/kelryvo/bin/kelryvo-runtime").is_file(),
        "native probes require the disposable image and fixed read-only test mount",
    )?;
    let action = args
        .first()
        .map(String::as_str)
        .ok_or("Container probe action")?;
    match (action, &args[1..]) {
        ("claim-source", []) => {
            // CAP_CHOWN permits taking ownership without CAP_DAC_OVERRIDE.
            // The fresh host directory starts private to its creating user.
            owner(Path::new("/secrets"), 0, 0, 0o700)?;
            for path in source_files(Path::new("/secrets"))? {
                owner(&path, 0, 0, 0o400)?;
            }
        }
        ("release-source", [uid, gid]) => {
            let uid = uid.parse()?;
            let gid = gid.parse()?;
            for path in source_files(Path::new("/secrets"))? {
                fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
                owner(&path, uid, gid, 0o600)?;
            }
            owner(Path::new("/secrets"), uid, gid, 0o700)?;
        }
        ("check-source", []) => {
            for path in source_files(Path::new("/secrets"))? {
                mode(&path, 0, 0, 0o400)?;
            }
        }
        ("rotate-source", [role]) if ["developer", "approver"].contains(&role.as_str()) => {
            let path = Path::new("/secrets").join(format!("{role}-token"));
            mode(&path, 0, 0, 0o400)?;
            let mut token = Vec::new();
            std::io::stdin().take(65).read_to_end(&mut token)?;
            require(
                token.len() == 64 && token.iter().all(u8::is_ascii_hexdigit),
                "bounded private rotation input",
            )?;
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
            let mut file = fs::OpenOptions::new()
                .write(true)
                .custom_flags(nix::libc::O_NOFOLLOW)
                .open(&path)?;
            require(
                file.metadata()?.is_file() && file.metadata()?.nlink() == 1,
                "regular fixture rotation target",
            )?;
            file.set_len(0)?;
            file.write_all(&token)?;
            file.sync_all()?;
            use zeroize::Zeroize;
            token.zeroize();
            owner(&path, 0, 0, 0o400)?;
        }
        ("projected", []) => {
            let revision = Path::new("/projected/..revision");
            fs::create_dir(revision)?;
            fs::set_permissions(revision, fs::Permissions::from_mode(0o700))?;
            for path in source_files(Path::new("/inputs"))? {
                let name = path.file_name().ok_or("Projected source name")?;
                let copy = revision.join(name);
                fs::copy(&path, &copy)?;
                fs::set_permissions(&copy, fs::Permissions::from_mode(0o400))?;
                symlink(
                    Path::new("..data").join(name),
                    Path::new("/projected").join(name),
                )?;
            }
            symlink("..revision", "/projected/..data")?;
            prepare("/projected/..data", true)?;
            mode(
                Path::new("/run/kelryvo/runtime/api/secrets"),
                10001,
                10001,
                0o500,
            )?;
            let output = Command::new("/usr/bin/setpriv")
                .args([
                    "--reuid=10001",
                    "--regid=10001",
                    "--clear-groups",
                    "/kelryvo-test-probe",
                    "--container-probe",
                    "api-token-mode",
                ])
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .stdin(Stdio::null())
                .output()?;
            require(
                output.status.success(),
                "API principal can stat only its staged credential",
            )?;
            symlink("/inputs/developer-token", revision.join("escape"))?;
            fs::rename(revision.join("escape"), revision.join("developer-token"))?;
            prepare("/projected/..data", false)?;
        }
        ("api-token-mode", []) => mode(
            Path::new("/run/kelryvo/runtime/api/secrets/developer-token"),
            10001,
            10001,
            0o600,
        )?,
        ("no-worker-config", []) => require(
            !Path::new("/run/kelryvo/runtime/execution/worker.json").try_exists()?,
            "dormant worker has no execution configuration",
        )?,
        ("api-owner", []) => {
            let metadata = fs::metadata("/run/kelryvo/runtime/api/secrets")?;
            println!("{}", json!({"uid":metadata.uid(),"gid":metadata.gid()}));
        }
        ("read-source", []) => {
            let _ = fs::read("/run/kelryvo/secrets/developer-token")?;
            return Err("protected source unexpectedly readable".into());
        }
        ("list-execution", []) => {
            let _ = fs::read_dir("/run/kelryvo/runtime/execution")?;
            return Err("execution state unexpectedly readable".into());
        }
        ("read-supervisor-environment", []) => {
            let _ = fs::read("/proc/1/environ")?;
            return Err("supervisor environment unexpectedly readable".into());
        }
        ("processes", []) => println!("{}", json!(processes()?)),
        ("os-inventory", []) => {
            let bytes = fs::read("/opt/licenses/os/runtime-inventory.json")?;
            require(
                bytes.len() <= 2 * 1024 * 1024,
                "bounded OS license inventory",
            )?;
            let value: Value = serde_json::from_slice(&bytes)?;
            println!("{value}");
        }
        ("image-inventory", []) => {
            for path in [
                "/opt/licenses/os/runtime-inventory.json",
                "/opt/kelryvo/licenses/cargo-inventory.json",
                "/opt/kelryvo/dist/rust-web/app_bg.wasm",
            ] {
                let metadata = fs::metadata(path)?;
                require(
                    metadata.is_file() && metadata.len() > 0,
                    "nonempty native runtime inventory/WASM artifact",
                )?;
            }
            let path = std::env::var_os("PATH").ok_or("Image PATH")?;
            interpreter_free(&std::env::split_paths(&path).collect::<Vec<_>>())?;
        }
        ("kill-api", [pid]) => {
            let pid: i32 = pid.parse()?;
            require(
                pid > 1
                    && processes()?.iter().any(|v| {
                        v["pid"] == pid
                            && v["uid"] == 10001
                            && v["cmd"]
                                .as_str()
                                .is_some_and(|s| s.contains("/bin/kelryvo-server"))
                    }),
                "only the disposable image API child may be killed",
            )?;
            nix::sys::signal::kill(
                nix::unistd::Pid::from_raw(pid),
                nix::sys::signal::Signal::SIGKILL,
            )?;
        }
        _ => return Err("Unknown native container probe".into()),
    }
    Ok(())
}
fn interpreter_free(directories: &[std::path::PathBuf]) -> Result<()> {
    require(
        directories.len() <= 32 && directories.iter().all(|p| p.is_absolute()),
        "bounded absolute image search path",
    )?;
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
        for directory in directories {
            match fs::metadata(directory.join(tool)) {
                Ok(metadata) => require(
                    !metadata.is_file() || metadata.mode() & 0o111 == 0,
                    "runtime image must not contain a callable build/test interpreter",
                )?,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(())
}
fn processes() -> Result<Vec<Value>> {
    let mut result = vec![];
    for entry in fs::read_dir("/proc")? {
        let entry = entry?;
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|s| s.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(status) = fs::read_to_string(entry.path().join("status")) else {
            continue;
        };
        let uid = status
            .lines()
            .find_map(|l| l.strip_prefix("Uid:"))
            .and_then(|s| s.split_whitespace().next())
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or("Proc UID")?;
        if pid != 1 && ![10001, 10002].contains(&uid) {
            continue;
        }
        let cap = status
            .lines()
            .find_map(|l| l.strip_prefix("CapEff:"))
            .ok_or("Proc capabilities")?
            .trim();
        let cmd =
            String::from_utf8_lossy(&fs::read(entry.path().join("cmdline"))?).replace('\0', " ");
        result.push(json!({"pid":pid,"uid":uid,"cap":cap,"cmd":cmd}));
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn image_inventory_refuses_executable_interpreters_aliases_and_ambiguous_paths() {
        let directory = tempfile::tempdir().unwrap();
        let paths = [directory.path().to_path_buf()];
        interpreter_free(&paths).unwrap();
        let executable = directory.path().join("node");
        fs::write(&executable, "ordinary retained text").unwrap();
        interpreter_free(&paths).unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(interpreter_free(&paths).is_err());
        fs::rename(&executable, directory.path().join("other")).unwrap();
        symlink("other", directory.path().join("python3")).unwrap();
        assert!(interpreter_free(&paths).is_err());
        fs::remove_file(directory.path().join("python3")).unwrap();
        symlink("python3", directory.path().join("python3")).unwrap();
        assert!(interpreter_free(&paths).is_err());
        assert!(interpreter_free(&["relative".into()]).is_err());
        assert!(interpreter_free(&vec![directory.path().to_path_buf(); 33]).is_err());
    }
    #[test]
    fn probe_refuses_host_mutations_and_source_aliases() {
        assert!(run(&["release-source".into(), "0".into(), "0".into()]).is_err());
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("developer-token");
        fs::write(&first, "private synthetic fixture").unwrap();
        assert_eq!(source_files(directory.path()).unwrap(), vec![first.clone()]);
        let alias = directory.path().join("alias");
        symlink(&first, &alias).unwrap();
        assert!(source_files(directory.path()).is_err());
        fs::remove_file(&alias).unwrap();
        fs::hard_link(&first, &alias).unwrap();
        assert!(source_files(directory.path()).is_err());
        fs::remove_file(&alias).unwrap();
        fs::create_dir(&alias).unwrap();
        assert!(source_files(directory.path()).is_err());
    }
}
