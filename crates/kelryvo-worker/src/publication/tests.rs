//! Filesystem publication/scope smoke. Dummy OCI artifacts and fixture reports
//! never become a fresh Inspection or runtime acceptance evidence.
use super::*;
use crate::installation_test_support as support;
use std::os::unix::fs::symlink;
fn source() -> (PathBuf, Snapshot) {
    let (root, raw) = support::fixture();
    let c: Config = serde_json::from_value(raw).expect("native fixture");
    let mut secrets = Vec::new();
    for name in SECRETS {
        if *name != "database-url" {
            support::write(&root.join(name), b"fixture-native-password");
        }
        secrets.push((
            *name,
            installation::private_file(&root.join(name), 16384).expect("private fixture"),
        ));
    }
    (
        root,
        Snapshot {
            config: c,
            journal: json!({"status":"PREPARED","pending":null,"completed":[]}),
            secrets,
        },
    )
}
#[test]
fn observer_publication_is_exact_read_only_and_has_a_separate_fixed_payload() {
    let (root, source) = source();
    let (name, bytes) = observer_manifest(&source.config).expect("native observer manifest");
    let config: crate::discovery::Config = serde_json::from_slice(&bytes).unwrap();
    config.validate().expect("native read-only config");
    let target = &config.targets[0];
    assert_eq!(target.observer_username, source.config.principals.observer);
    assert_eq!(target.connection.id, source.config.connection_id);
    assert_eq!(
        target.connection.revision,
        source.config.connection_revision
    );
    assert_eq!(
        target.connection.credential_ref.as_deref(),
        Some(source.config.master_credential_ref.as_str())
    );
    assert_eq!(
        target.expected_identity.as_ref(),
        Some(&source.config.identity)
    );
    let runtime = root.join("discovery");
    fs::DirBuilder::new().mode(0o700).create(&runtime).unwrap();
    let uid = installation::uid().unwrap();
    let gid = Gid::effective().as_raw();
    let entries = [
        (name.as_str(), b"fixture-observer".as_slice()),
        ("discovery.json", bytes.as_slice()),
    ];
    stage_payload(&runtime, &entries, uid, gid, Payload::Observer(&name))
        .expect("observer-specific publication");
    assert_eq!(fs::read(runtime.join("discovery.json")).unwrap(), bytes);
    assert_eq!(fs::read(runtime.join(&name)).unwrap(), b"fixture-observer");
    assert!(
        stage(&runtime, &entries, uid, gid).is_err(),
        "execution payload stays fixed"
    );
    assert!(
        stage_payload(
            &runtime,
            &entries,
            uid,
            gid,
            Payload::Observer("../outside")
        )
        .is_err()
    );
    let reversed = [entries[1], entries[0]];
    assert!(
        stage_payload(&runtime, &reversed, uid, gid, Payload::Observer(&name)).is_err(),
        "manifest must be published last"
    );
}
#[test]
fn exact_publication_uses_fixed_files_replaces_symlinks_and_retains_root_archive() {
    let (root, source) = source();
    let runtime = root.join("runtime");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&runtime)
        .expect("fixture runtime");
    let outside = root.join("outside");
    support::write(&outside, b"retained outside bytes");
    symlink(&outside, runtime.join("installation.json")).expect("symlink fixture");
    let mut translated = source.config.clone();
    translated.secret_directory = runtime.clone();
    translated
        .reseal()
        .expect("root-bound location translation");
    assert_ne!(
        translated.installation_digest,
        source.config.installation_digest
    );
    let worker = service(&translated, &runtime).to_string();
    let config = serde_json::to_vec(&translated).expect("native config");
    let mut entries = source
        .secrets
        .iter()
        .map(|(n, b)| (*n, b.as_slice()))
        .collect::<Vec<_>>();
    entries.push(("worker.json", worker.as_bytes()));
    entries.push(("installation.json", config.as_slice()));
    stage(
        &runtime,
        &entries,
        installation::uid().expect("test UID"),
        Gid::effective().as_raw(),
    )
    .expect("complete publication");
    assert_eq!(
        fs::read(&outside).expect("outside"),
        b"retained outside bytes",
        "publication never follows an existing destination symlink"
    );
    let observed =
        Config::load(&runtime.join("installation.json")).expect("published native private files");
    assert_eq!(observed.installation_digest, translated.installation_digest);
    for name in SECRETS
        .iter()
        .copied()
        .chain(["worker.json", "installation.json"])
    {
        let stat = fs::symlink_metadata(runtime.join(name)).expect("published file");
        assert!(stat.is_file());
        assert_eq!(stat.mode() & 0o777, 0o600);
        assert_eq!(stat.uid(), installation::uid().expect("UID"));
    }
    stage(
        &runtime,
        &entries,
        installation::uid().expect("UID"),
        Gid::effective().as_raw(),
    )
    .expect("exact filesystem repair");
    let mut bad = entries.clone();
    bad.swap(4, 5);
    assert!(
        stage(
            &runtime,
            &bad,
            installation::uid().expect("UID"),
            Gid::effective().as_raw()
        )
        .is_err(),
        "installation must be the last staged file"
    );
    let mut injected = entries.clone();
    injected[0] = ("../outside", b"replacement");
    assert!(
        stage(
            &runtime,
            &injected,
            installation::uid().expect("UID"),
            Gid::effective().as_raw()
        )
        .is_err()
    );
    assert_eq!(
        fs::read(&outside).expect("outside"),
        b"retained outside bytes"
    );
    let archive_dir = root.join("archive");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&archive_dir)
        .expect("private archive");
    let report = json!({"format":1,"driverProfile":NATIVE_ORACLE_DRIVER_PROFILE,"installationDigest":translated.installation_digest,"readOnly":true,"oracleMigrationExecution":"NOT_RUN","fixture":true});
    archive(&archive_dir, &translated, &source, &report).expect("retained operator archive");
    let retained = snapshot(&archive_dir, false).expect("exact source archive");
    assert_eq!(
        retained.config.installation_digest,
        translated.installation_digest
    );
    assert_eq!(retained.secrets.len(), 4);
    assert!(retained.config.database_url_from(&archive_dir).is_ok());
}
#[test]
fn refresh_preserves_physical_scope_principals_sources_and_witness_directory() {
    let (_root, source) = source();
    let mut old = source.config.clone();
    let fresh = source.config.clone();
    old.expires_at = "2020-01-01T00:00:00.000Z".into();
    assert!(old.validate().is_err());
    refreshed_scope(&old, &fresh)
        .expect("old expiry is context only; new authority must be independently checked");
    let mut changed = fresh.clone();
    changed.metadata_generation_id = Uuid::new_v4();
    assert!(refreshed_scope(&old, &changed).is_err());
    changed = fresh.clone();
    changed.identity["containerGuid"] = "B".repeat(32).into();
    assert!(refreshed_scope(&old, &changed).is_err());
    changed = fresh.clone();
    changed.reader_schemas.push("OTHER".into());
    assert!(refreshed_scope(&old, &changed).is_err());
    changed = fresh.clone();
    changed.principals.writer = "OTHER_WRITER".into();
    assert!(refreshed_scope(&old, &changed).is_err());
    changed = fresh.clone();
    changed.mutex_package_source_digest = "a".repeat(64);
    assert!(refreshed_scope(&old, &changed).is_err());
    changed = fresh.clone();
    changed.witness_directory = changed.witness_directory.join("new");
    assert!(refreshed_scope(&old, &changed).is_err());
}
