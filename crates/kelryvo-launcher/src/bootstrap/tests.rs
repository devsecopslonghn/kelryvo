use super::*;
use std::os::fd::AsRawFd;
use std::os::unix::fs::symlink;

fn write(path: &Path, bytes: &[u8]) {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    file.write_all(bytes).unwrap();
}
fn make_dir(path: &Path) {
    fs::DirBuilder::new().mode(0o700).create(path).unwrap();
}
fn fixture() -> (PathBuf, u32) {
    let owner = nix::unistd::getuid().as_raw();
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.cache")
        .canonicalize()
        .unwrap()
        .join(format!("native-launcher-{}", uuid::Uuid::new_v4()));
    make_dir(&root);
    (root, owner)
}
fn owners(owner: u32) -> Owners {
    Owners {
        root: owner,
        api: owner,
        worker: owner,
    }
}
fn environment(source: &Path, installation: &Path, execute: bool, discovery: bool) -> Environment {
    Environment::from_lookup(|name| match name {
        "KELRYVO_SECRET_DIR" => Some(source.as_os_str().to_owned()),
        "KELRYVO_INSTALLATION_DIR" => Some(installation.as_os_str().to_owned()),
        "KELRYVO_EXECUTION_ENABLED" => Some(execute.to_string().into()),
        "KELRYVO_DISCOVERY_ENABLED" => Some(discovery.to_string().into()),
        _ => None,
    })
    .unwrap()
}
#[test]
fn projected_generation_accepts_only_sticky_ancestors_outside_its_protected_source() {
    let (root, owner) = fixture();
    let mount = root.join("projected");
    make_dir(&mount);
    let generation = mount.join("..2026");
    make_dir(&generation);
    write(&generation.join("database-url"), b"private-metadata");
    symlink("..2026", mount.join("..data")).unwrap();
    fs::set_permissions(&mount, fs::Permissions::from_mode(0o3777)).unwrap();
    fs::set_permissions(&generation, fs::Permissions::from_mode(0o2755)).unwrap();
    let selected = mount.join("..data");
    let source = Source::open(&selected, owner).unwrap();
    assert_eq!(
        source
            .read("database-url", 16384, false)
            .unwrap()
            .unwrap()
            .bytes
            .as_slice(),
        b"private-metadata"
    );
    assert!(
        Source::open(&mount, owner).is_err(),
        "a sticky writable source root is never trusted"
    );
    assert!(
        ancestry(&generation, owner).is_err(),
        "binary and output ancestry stays strict"
    );
    fs::set_permissions(&mount, fs::Permissions::from_mode(0o777)).unwrap();
    assert!(
        Source::open(&selected, owner).is_err(),
        "non-sticky writable ancestors remain untrusted"
    );
    fs::set_permissions(&mount, fs::Permissions::from_mode(0o3777)).unwrap();
    let nested = generation.join("nested");
    make_dir(&nested);
    write(&nested.join("secret"), b"outside-protected-generation");
    fs::set_permissions(&nested, fs::Permissions::from_mode(0o1777)).unwrap();
    symlink("nested/secret", generation.join("escaped")).unwrap();
    assert!(
        source.read("escaped", 16384, false).is_err(),
        "sticky directories inside the source do not widen its boundary"
    );
}

#[test]
fn protected_projected_secrets_stage_rotate_and_refuse_escapes() {
    let (root, owner) = fixture();
    let source = root.join("source");
    make_dir(&source);
    let projected = source.join("..2026");
    make_dir(&projected);
    for name in [
        "database-url",
        "developer-token",
        "approver-token",
        "tls.crt",
        "tls.key",
    ] {
        write(&projected.join(name), format!("private-{name}").as_bytes());
        symlink(Path::new("..data").join(name), source.join(name)).unwrap();
    }
    symlink("..2026", source.join("..data")).unwrap();
    let runtime = root.join("runtime");
    let env = environment(&source, &root.join("missing-installation"), false, false);
    prepare_at(&env, false, &runtime, owners(owner)).unwrap();
    let api = runtime.join("api/secrets");
    assert_eq!(fs::metadata(&api).unwrap().mode() & 0o777, 0o500);
    assert_eq!(
        fs::metadata(runtime.join("execution")).unwrap().mode() & 0o777,
        0o700
    );
    let bridge = runtime.join("bridge");
    assert_eq!(fs::metadata(&bridge).unwrap().mode() & 0o777, 0o711);
    // Linux sockaddr_un is short; the protected workspace fixture may have a
    // longer path than production's fixed /run/kelryvo/runtime/bridge socket.
    let bridge_fd = File::open(&bridge).unwrap();
    let listener = std::os::unix::net::UnixListener::bind(format!(
        "/proc/self/fd/{}/discovery.sock",
        bridge_fd.as_raw_fd()
    ))
    .unwrap();
    drop(listener);
    prepare_at(&env, true, &runtime, owners(owner)).unwrap();
    assert!(bridge.join("discovery.sock").exists());
    prepare_at(&env, false, &runtime, owners(owner)).unwrap();
    assert!(!bridge.join("discovery.sock").exists());
    assert_eq!(
        fs::metadata(api.join("tls.key")).unwrap().mode() & 0o777,
        0o600
    );
    assert!(
        !fs::symlink_metadata(api.join("tls.key"))
            .unwrap()
            .is_symlink()
    );
    assert_eq!(fs::read(api.join("tls.key")).unwrap(), b"private-tls.key");
    write(
        &runtime.join("execution/keep-private"),
        b"kept on API-only restage",
    );
    fs::set_permissions(&api, fs::Permissions::from_mode(0o700)).unwrap();
    symlink(root.join("outside"), api.join("stale-link")).unwrap();
    write(&root.join("outside"), b"untouched");
    fs::write(projected.join("developer-token"), b"rotated-token").unwrap();
    prepare_at(&env, true, &runtime, owners(owner)).unwrap();
    assert_eq!(
        fs::read(api.join("developer-token")).unwrap(),
        b"rotated-token"
    );
    assert!(!api.join("stale-link").exists());
    assert_eq!(fs::read(root.join("outside")).unwrap(), b"untouched");
    assert!(runtime.join("execution/keep-private").exists());

    let original = projected.join("developer-token");
    fs::set_permissions(&original, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(prepare_at(&env, true, &runtime, owners(owner)).is_err());
    fs::set_permissions(&original, fs::Permissions::from_mode(0o600)).unwrap();
    fs::hard_link(&original, root.join("extra-link")).unwrap();
    assert!(prepare_at(&env, true, &runtime, owners(owner)).is_err());
    fs::remove_file(root.join("extra-link")).unwrap();
    fs::remove_file(source.join("developer-token")).unwrap();
    symlink(root.join("outside"), source.join("developer-token")).unwrap();
    assert!(prepare_at(&env, true, &runtime, owners(owner)).is_err());
    fs::remove_file(source.join("developer-token")).unwrap();
    symlink("..data/developer-token", source.join("developer-token")).unwrap();
    symlink("missing", source.join("identity-runtime.json")).unwrap();
    assert!(prepare_at(&env, true, &runtime, owners(owner)).is_err());
    fs::remove_file(source.join("identity-runtime.json")).unwrap();
    let target = root.join("unsafe-runtime");
    symlink(&source, &target).unwrap();
    assert!(prepare_at(&env, false, &target, owners(owner)).is_err());
    assert_eq!(fs::metadata(&source).unwrap().mode() & 0o777, 0o700);
    let enabled = environment(&source, &root, false, true);
    prepare_at(&enabled, false, &runtime, owners(owner)).unwrap();
    prepare_at(&enabled, true, &runtime, owners(owner)).unwrap();
}

#[test]
fn first_install_waits_without_erasing_controller_published_inputs() {
    let (root, owner) = fixture();
    let source = root.join("source");
    make_dir(&source);
    for name in [
        "database-url",
        "developer-token",
        "approver-token",
        "tls.crt",
        "tls.key",
    ] {
        write(&source.join(name), b"private-fixture");
    }
    let installation = root.join("not-yet-installed");
    let runtime = root.join("runtime");
    let env = environment(&source, &installation, true, true);
    prepare_at(&env, false, &runtime, owners(owner)).unwrap();
    let execution = runtime.join("execution");
    assert_eq!(fs::read_dir(&execution).unwrap().count(), 0);
    write(&execution.join("worker.json"), b"retained controller bytes");
    let witness = execution.join("retained-context");
    make_dir(&witness);
    write(&witness.join("receipt"), b"never erased");
    prepare_at(&env, false, &runtime, owners(owner)).unwrap();
    assert_eq!(
        fs::read(execution.join("worker.json")).unwrap(),
        b"retained controller bytes"
    );
    assert_eq!(fs::read(witness.join("receipt")).unwrap(), b"never erased");
    make_dir(&installation);
    write(
        &installation.join("writer-password"),
        b"partial static publication",
    );
    assert!(prepare_at(&env, false, &runtime, owners(owner)).is_err());
    assert_eq!(fs::read(witness.join("receipt")).unwrap(), b"never erased");
}

#[test]
fn execution_stages_only_fixed_data_and_requires_published_runtime_paths() {
    let (root, owner) = fixture();
    let source = root.join("source");
    make_dir(&source);
    for name in [
        "database-url",
        "developer-token",
        "approver-token",
        "tls.crt",
        "tls.key",
    ] {
        write(&source.join(name), b"dummy");
    }
    let installation = root.join("installation");
    make_dir(&installation);
    let runtime = root.join("runtime");
    let target = runtime.join("execution");
    for &(name, _) in &INSTALLATION[..4] {
        write(&installation.join(name), b"dummy-private");
    }
    let worker = serde_json::json!({"format":1,"mode":"ORACLE_EXECUTION","databaseSecretDirectory":target,"oracleInstallation":target.join("installation.json")});
    write(
        &installation.join("worker.json"),
        worker.to_string().as_bytes(),
    );
    write(
        &installation.join("installation.json"),
        serde_json::json!({"secretDirectory":target})
            .to_string()
            .as_bytes(),
    );
    write(
        &installation.join("execution-service.mjs"),
        b"never executed or staged",
    );
    write(
        &installation.join("journal.json"),
        b"retained root context only",
    );
    let env = environment(&source, &installation, true, false);
    prepare_at(&env, false, &runtime, owners(owner)).unwrap();
    assert_eq!(fs::read_dir(&target).unwrap().count(), 6);
    assert!(!target.join("execution-service.mjs").exists());
    assert!(!target.join("journal.json").exists());
    fs::write(
        installation.join("worker.json"),
        b"{\"format\":1,\"mode\":\"EXPIRE_ONLY\"}",
    )
    .unwrap();
    assert!(prepare_at(&env, false, &runtime, owners(owner)).is_err());
    assert_eq!(fs::read_dir(&target).unwrap().count(), 6);
    fs::write(installation.join("worker.json"), worker.to_string()).unwrap();
    fs::write(
        installation.join("installation.json"),
        b"{\"secretDirectory\":\"/wrong\"}",
    )
    .unwrap();
    assert!(prepare_at(&env, false, &runtime, owners(owner)).is_err());
}

#[test]
fn discovery_has_a_separate_private_directory_and_only_stages_reviewed_observer_inputs() {
    let (root, owner) = fixture();
    let source = root.join("source");
    make_dir(&source);
    for name in [
        "database-url",
        "developer-token",
        "approver-token",
        "tls.crt",
        "tls.key",
    ] {
        write(&source.join(name), b"api-private");
    }
    let installation = root.join("installation");
    make_dir(&installation);
    write(
        &installation.join("observer-demo"),
        b"private-observer-password",
    );
    write(
        &installation.join("writer-password"),
        b"never copied into discovery",
    );
    let runtime = root.join("runtime");
    let config = serde_json::json!({"format":2,"driverProfile":kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE,"readOnly":true,"disposable":true,"secretDirectory":runtime.join("discovery"),"targets":[{"secretFile":"observer-demo"}]});
    write(
        &installation.join("discovery.json"),
        config.to_string().as_bytes(),
    );
    let env = environment(&source, &installation, false, true);
    prepare_at(&env, false, &runtime, owners(owner)).unwrap();
    assert_eq!(fs::read_dir(runtime.join("discovery")).unwrap().count(), 2);
    assert_eq!(
        fs::metadata(runtime.join("discovery")).unwrap().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::read(runtime.join("discovery/observer-demo")).unwrap(),
        b"private-observer-password"
    );
    assert_eq!(fs::read_dir(runtime.join("execution")).unwrap().count(), 0);
    assert!(!runtime.join("api/secrets/observer-demo").exists());
    let mut accepted = config.clone();
    accepted["format"] = serde_json::json!(3);
    accepted["nativeInstallationDigest"] = serde_json::json!("f".repeat(64));
    // Bootstrap stages protected data only. The worker separately verifies all
    // native acceptance fields; staging never creates verification authority.
    fs::write(installation.join("discovery.json"), accepted.to_string()).unwrap();
    prepare_at(&env, false, &runtime, owners(owner)).unwrap();
    let staged: serde_json::Value =
        serde_json::from_slice(&fs::read(runtime.join("discovery/discovery.json")).unwrap())
            .unwrap();
    assert_eq!(staged, accepted);
    assert!(!runtime.join("api/secrets/observer-demo").exists());
    let mut legacy = config.clone();
    legacy["format"] = serde_json::json!(1);
    fs::write(installation.join("discovery.json"), legacy.to_string()).unwrap();
    assert!(prepare_at(&env, false, &runtime, owners(owner)).is_err());
    let mut invalid = config.clone();
    invalid["targets"][0]["secretFile"] = "../writer-password".into();
    fs::write(installation.join("discovery.json"), invalid.to_string()).unwrap();
    assert!(prepare_at(&env, false, &runtime, owners(owner)).is_err());
    assert_eq!(fs::read_dir(runtime.join("discovery")).unwrap().count(), 2);
    prepare_at(&env, true, &runtime, owners(owner)).unwrap();
    assert!(runtime.join("discovery/observer-demo").exists());
    let disabled = environment(&source, &installation, false, false);
    prepare_at(&disabled, false, &runtime, owners(owner)).unwrap();
    assert_eq!(fs::read_dir(runtime.join("discovery")).unwrap().count(), 0);
}
