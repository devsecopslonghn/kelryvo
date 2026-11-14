//! Fresh native application bundles with compiled source identity, complete
//! pinned Cargo source archives and an inventory. No deployment or publication.
use kelryvo_core::sha256;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, ExitCode},
};
const BINARIES: &[&str] = &[
    "kelryvo",
    "kelryvo-server",
    "kelryvo-worker",
    "kelryvo-operator",
    "kelryvo-runtime",
];
const INPUTS: &[&str] = &[
    "Cargo.toml",
    "Cargo.lock",
    "rust-toolchain.toml",
    ".cargo/config.toml",
    "LICENSE",
    "NOTICE",
    "crates",
    "tools/oracle-codegen",
    "tools/prepare-dependencies.py",
    "tools/dependency_source.rs",
    "dependencies/antlr-rust-runtime",
    ".deps/antlr-rust-runtime",
    ".deps/antlr-rust-runtime-0.34.0.crate",
    "Dockerfile",
    ".dockerignore",
    "compose.pilot.yaml",
    "deploy/native-oracle-helm.patch",
    "docs/dependencies/rust-toolchain.json",
];
const LIMIT: u64 = 1024 * 1024 * 1024;
type Result<T> = std::result::Result<T, ()>;
pub(super) fn bytes(path: &Path, max: u64) -> Result<Vec<u8>> {
    let stat = fs::symlink_metadata(path).map_err(|_| ())?;
    if !stat.is_file() || stat.is_symlink() || stat.len() > max {
        return Err(());
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| ())?;
    let stat = file.metadata().map_err(|_| ())?;
    if !stat.is_file() || stat.len() > max {
        return Err(());
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() as u64 > max {
        return Err(());
    }
    Ok(bytes)
}
fn files(root: &Path, relative: &Path, output: &mut BTreeMap<String, Value>) -> Result<()> {
    if relative.components().count() > 64 || output.len() >= 32768 {
        return Err(());
    }
    let path = root.join(relative);
    let stat = fs::symlink_metadata(&path).map_err(|_| ())?;
    if stat.is_symlink() {
        return Err(());
    }
    if stat.is_dir() {
        for entry in fs::read_dir(&path).map_err(|_| ())? {
            let entry = entry.map_err(|_| ())?;
            files(root, &relative.join(entry.file_name()), output)?;
        }
    } else {
        let data = bytes(&path, LIMIT)?;
        output.insert(
            relative.to_str().ok_or(())?.into(),
            json!({"sha256":sha256(&data),"bytes":data.len(),"mode":stat.mode() & 0o777}),
        );
    }
    Ok(())
}
fn sources(root: &Path) -> Result<BTreeMap<String, Value>> {
    crate::dependency_source::verify(root, |bytes| kelryvo_core::sha256(bytes))
        .map_err(|error| eprintln!("{error}"))?;
    let mut inputs = BTreeMap::new();
    for input in INPUTS {
        source_files(root, Path::new(input), &mut inputs)?;
    }
    Ok(inputs)
}
// A developer can run the isolated generator with Cargo's default target dir.
// Keep those ignored compiler outputs out of source identity and distributions.
// The generic distribution inventory above remains strict about every file.
fn source_files(root: &Path, relative: &Path, output: &mut BTreeMap<String, Value>) -> Result<()> {
    if relative.components().count() > 64 || output.len() >= 32768 {
        return Err(());
    }
    let path = root.join(relative);
    let stat = fs::symlink_metadata(&path).map_err(|_| ())?;
    if stat.is_dir() {
        if ["target", ".cache"]
            .iter()
            .any(|name| relative.file_name().is_some_and(|n| n == *name))
        {
            return Ok(());
        }
        for entry in fs::read_dir(path).map_err(|_| ())? {
            source_files(
                root,
                &relative.join(entry.map_err(|_| ())?.file_name()),
                output,
            )?;
        }
        Ok(())
    } else {
        files(root, relative, output)
    }
}
/// Read-only optimization hint for a container build. Packaging independently
/// recomputes this inventory and probes every compiled executable as before.
pub fn source_tree_digest() -> ExitCode {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    match sources(&root).and_then(|inputs| serde_json::to_vec(&inputs).map_err(|_| ())) {
        Ok(bytes) => {
            println!("{}", sha256(bytes));
            ExitCode::SUCCESS
        }
        Err(()) => {
            eprintln!("Native source inventory unavailable");
            ExitCode::FAILURE
        }
    }
}
pub(super) fn put(root: &Path, relative: &Path, data: &[u8], mode: u32) -> Result<()> {
    let path = root.join(relative);
    let mut parent = root.to_path_buf();
    for component in relative.parent().ok_or(())?.components() {
        let std::path::Component::Normal(name) = component else {
            return Err(());
        };
        parent.push(name);
        match fs::DirBuilder::new().mode(0o755).create(&parent) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(()),
        }
        let stat = fs::symlink_metadata(&parent).map_err(|_| ())?;
        if !stat.is_dir() || stat.is_symlink() {
            return Err(());
        }
        fs::set_permissions(&parent, fs::Permissions::from_mode(0o755)).map_err(|_| ())?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(path)
        .map_err(|_| ())?;
    file.write_all(data).map_err(|_| ())?;
    file.set_permissions(fs::Permissions::from_mode(mode))
        .map_err(|_| ())?;
    file.sync_all().map_err(|_| ())
}
pub(super) fn json_file(root: &Path, name: &str, value: &Value) -> Result<()> {
    put(
        root,
        Path::new(name),
        &serde_json::to_vec_pretty(value).map_err(|_| ())?,
        0o444,
    )
}
fn cargo(root: &Path, args: &[&str], revision: &str, tree: &str) -> Result<()> {
    if !Command::new("cargo")
        .args(args)
        .current_dir(root)
        .env("KELRYVO_SOURCE_SHA", revision)
        .env("KELRYVO_SOURCE_TREE_DIGEST", tree)
        .status()
        .map_err(|_| ())?
        .success()
    {
        return Err(());
    }
    Ok(())
}
fn package_sources(root: &Path, destination: &Path) -> Result<()> {
    eprintln!("Collecting locked Cargo source archives.");
    let mut inventory = BTreeMap::<(String, String), Value>::new();
    for manifest_root in [root.to_path_buf(), root.join("tools/oracle-codegen")] {
        let (_, sources) = crate::cargo_sources::inventory(&manifest_root).map_err(|error| {
            eprintln!("{error}");
        })?;
        for source in sources {
            let package = &source.facts;
            let name = package["name"].as_str().ok_or(())?;
            let version = package["version"].as_str().ok_or(())?;
            let checksum = package["sha256"].as_str().ok_or(())?;
            let license_file = &package["licenseFile"];
            // Copy only the bytes verified against the exact locked checksum.
            let data =
                crate::cargo_sources::read_archive(&source.path, checksum).map_err(|error| {
                    eprintln!("{error}");
                })?;
            let key = (name.to_owned(), version.to_owned());
            if let Some(previous) = inventory.get(&key) {
                if previous["sha256"] != checksum
                    || previous["licenseExpression"] != package["licenseExpression"]
                    || &previous["licenseFile"] != license_file
                {
                    return Err(());
                }
                continue;
            }
            let relative = format!("licenses/sources/{name}-{version}.crate");
            put(destination, Path::new(&relative), &data, 0o444)?;
            inventory.insert(key, json!({"name":name,"version":version,"licenseExpression":package["licenseExpression"],"licenseFile":license_file,"repository":package["repository"],"source":package["source"],"archive":relative,"sha256":checksum,"scope":"LOCKED_WORKSPACE_SOURCE_ARCHIVE"}));
        }
    }
    let inventory = inventory.into_values().collect::<Vec<_>>();
    json_file(
        destination,
        "licenses/cargo-inventory.json",
        &json!({"format":1,"scope":"COMPLETE_LOCKED_WORKSPACE_AND_HOST_GENERATOR","packages":inventory,"note":"Source archives preserve dependency-specific license, notice and bundled-source files. This inventory does not assert that every listed package is linked into each binary, nor grant execution or release approval."}),
    )
}
fn run(output: &str, debug: bool) -> Result<()> {
    if std::env::consts::OS != "linux" {
        return Err(());
    }
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .map_err(|_| ())?;
    let output = PathBuf::from(output);
    let destination = if output.is_absolute() {
        output
    } else {
        std::env::current_dir().map_err(|_| ())?.join(output)
    };
    if fs::symlink_metadata(&destination).is_ok() {
        return Err(());
    }
    let revision = std::env::var("KELRYVO_REVISION").unwrap_or_else(|_| "local-unpublished".into());
    if revision != "local-unpublished"
        && !(revision.len() == 40
            && revision
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
    {
        return Err(());
    }
    let inputs = sources(&root)?;
    let tree = sha256(serde_json::to_vec(&inputs).map_err(|_| ())?);
    let mut args = vec![
        "build",
        "--locked",
        "-p",
        "kelryvo-cli",
        "-p",
        "kelryvo-server",
        "-p",
        "kelryvo-worker",
        "-p",
        "kelryvo-operator",
        "-p",
        "kelryvo-launcher",
    ];
    if !debug {
        args.push("--release");
    }
    cargo(&root, &args, &revision, &tree)?;
    crate::web_build::build_with_identity(Some((&revision, &tree)))?;
    cargo(&root, &["fetch", "--locked"], &revision, &tree)?;
    cargo(
        &root,
        &[
            "fetch",
            "--locked",
            "--manifest-path",
            "tools/oracle-codegen/Cargo.toml",
        ],
        &revision,
        &tree,
    )?;
    if sources(&root)? != inputs {
        return Err(());
    }
    fs::DirBuilder::new()
        .mode(0o755)
        .create(&destination)
        .map_err(|_| ())?;
    fs::set_permissions(&destination, fs::Permissions::from_mode(0o755)).map_err(|_| ())?;
    let profile = if debug { "debug" } else { "release" };
    for binary in BINARIES {
        let source = root.join("target").join(profile).join(binary);
        let probe = Command::new(&source)
            .arg("--build-info")
            .output()
            .map_err(|_| ())?;
        if !probe.status.success() {
            return Err(());
        }
        let info: Value = serde_json::from_slice(&probe.stdout).map_err(|_| ())?;
        if info["sourceSha"] != revision
            || info["sourceTreeDigest"] != tree
            || info["profile"] != profile
            || info["architecture"] != std::env::consts::ARCH
            || info["os"] != "linux"
        {
            return Err(());
        }
        put(
            &destination,
            &Path::new("bin").join(binary),
            &bytes(&source, LIMIT)?,
            0o555,
        )?;
    }
    for name in [
        "index.html",
        "styles.css",
        "bootstrap.js",
        "app.js",
        "app_bg.wasm",
    ] {
        put(
            &destination,
            &Path::new("dist/rust-web").join(name),
            &bytes(&root.join("dist/rust-web").join(name), 32 * 1024 * 1024)?,
            0o444,
        )?;
    }
    for (name, info) in &inputs {
        let data = bytes(&root.join(name), LIMIT)?;
        if sha256(&data) != info["sha256"].as_str().ok_or(())? {
            return Err(());
        }
        put(&destination, &Path::new("source").join(name), &data, 0o444)?;
    }
    for name in ["LICENSE", "NOTICE"] {
        put(
            &destination,
            Path::new(name),
            &bytes(&root.join(name), 1024 * 1024)?,
            0o444,
        )?;
    }
    package_sources(&root, &destination)?;
    json_file(
        &destination,
        "source-identity.json",
        &json!({"format":2,"implementation":"RUST","sourceSha":revision,"sourceTreeDigest":tree,"cargoLockSha256":sha256(bytes(&root.join("Cargo.lock"),8*1024*1024)?),"parserProfile":kelryvo_parser::PROFILE,"driverProfile":kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE,"profile":profile,"architecture":std::env::consts::ARCH,"qualification":"NOT_RUN","releaseApproved":false}),
    )?;
    let mut inventory = BTreeMap::new();
    for entry in fs::read_dir(&destination).map_err(|_| ())? {
        files(
            &destination,
            Path::new(&entry.map_err(|_| ())?.file_name()),
            &mut inventory,
        )?;
    }
    json_file(
        &destination,
        "distribution.json",
        &json!({"format":1,"kind":"KELRYVO_NATIVE_DISTRIBUTION","sourceTreeDigest":tree,"files":inventory,"limitations":["Hashes provide integrity against a separately trusted manifest, not a signature or qualification.","Host native system libraries and an explicitly reviewed Oracle client/wallet are external prerequisites.","No deployment, image publication, metadata activation or Oracle execution is performed."]}),
    )?;
    println!(
        "Native distribution built at {} ({profile}); runtime and Oracle qualification remain separate.",
        destination.display()
    );
    Ok(())
}
pub fn build(output: &str, debug: bool) -> ExitCode {
    match run(output, debug) {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => {
            eprintln!(
                "Native distribution unavailable. Use a fresh output directory and the pinned native/WASM toolchains; inspect local build output."
            );
            ExitCode::FAILURE
        }
    }
}
fn verify_files(root: &Path) -> Result<()> {
    let manifest: Value =
        serde_json::from_slice(&bytes(&root.join("distribution.json"), 16 * 1024 * 1024)?)
            .map_err(|_| ())?;
    if manifest["format"] != 1
        || manifest["kind"] != "KELRYVO_NATIVE_DISTRIBUTION"
        || !manifest["files"].is_object()
    {
        return Err(());
    }
    let mut actual = BTreeMap::new();
    for entry in fs::read_dir(root).map_err(|_| ())? {
        let entry = entry.map_err(|_| ())?;
        if entry.file_name() != "distribution.json" {
            files(root, Path::new(&entry.file_name()), &mut actual)?;
        }
    }
    if serde_json::to_value(actual).map_err(|_| ())? != manifest["files"] {
        return Err(());
    }
    Ok(())
}
pub fn verify(directory: &str) -> ExitCode {
    match verify_files(Path::new(directory)) {
        Ok(()) => {
            println!(
                "Native distribution inventory matches. This is integrity verification, not a signature or runtime qualification."
            );
            ExitCode::SUCCESS
        }
        Err(()) => {
            eprintln!("Native distribution inventory is unavailable or does not match its files.");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn isolated_compiler_outputs_do_not_enter_the_source_inventory() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::create_dir_all(root.join("tools/target/debug")).unwrap();
        fs::write(root.join("tools/target/debug/compiler-output"), b"output").unwrap();
        fs::write(root.join("tools/source.rs"), b"source").unwrap();
        let mut inputs = BTreeMap::new();
        source_files(root, Path::new("tools"), &mut inputs).unwrap();
        assert_eq!(inputs.keys().collect::<Vec<_>>(), vec!["tools/source.rs"]);
        let mut complete = BTreeMap::new();
        files(root, Path::new("tools"), &mut complete).unwrap();
        assert_eq!(complete.len(), 2);
    }
    #[test]
    fn inventory_rejects_changed_missing_added_symlinked_and_writable_artifacts() {
        let root = std::env::temp_dir().join(format!(
            "kelryvo-dist-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        put(&root, Path::new("bin/fixed"), b"reviewed bytes", 0o555).unwrap();
        let mut expected = BTreeMap::new();
        files(&root, Path::new("bin"), &mut expected).unwrap();
        json_file(
            &root,
            "distribution.json",
            &json!({"format":1,"kind":"KELRYVO_NATIVE_DISTRIBUTION","files":expected}),
        )
        .unwrap();
        verify_files(&root).unwrap();
        fs::set_permissions(root.join("bin/fixed"), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(verify_files(&root).is_err());
        fs::write(root.join("bin/fixed"), b"changed bytes").unwrap();
        fs::set_permissions(root.join("bin/fixed"), fs::Permissions::from_mode(0o555)).unwrap();
        assert!(verify_files(&root).is_err());
        fs::remove_file(root.join("bin/fixed")).unwrap();
        assert!(verify_files(&root).is_err());
        std::os::unix::fs::symlink("/etc/passwd", root.join("bin/fixed")).unwrap();
        assert!(verify_files(&root).is_err());
        fs::remove_file(root.join("bin/fixed")).unwrap();
        put(&root, Path::new("bin/fixed"), b"reviewed bytes", 0o555).unwrap();
        verify_files(&root).unwrap();
        put(&root, Path::new("bin/extra"), b"unlisted", 0o555).unwrap();
        assert!(verify_files(&root).is_err());
        fs::remove_file(root.join("bin/extra")).unwrap();
        verify_files(&root).unwrap();
    }
}
