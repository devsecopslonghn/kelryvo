//! Private native installation/provenance and journal checks. No Oracle client
//! is loaded; dummy library/wallet fixtures cannot qualify a real installation.
use super::canonical_digest;
use kelryvo_core::sha256;
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
use uuid::Uuid;
pub fn write(path: &Path, bytes: &[u8]) {
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .mode(0o600)
        .open(path)
        .expect("private fixture");
    file.write_all(bytes).expect("fixture bytes");
}
pub fn seal(config: &mut Value) {
    let mut review = config["review"].clone();
    review.as_object_mut().expect("review").remove("digest");
    config["review"]["digest"] = canonical_digest(&review).into();
    let mut unsigned = config.clone();
    unsigned
        .as_object_mut()
        .expect("config")
        .remove("installationDigest");
    config["installationDigest"] = canonical_digest(&unsigned).into();
}
pub fn fixture() -> (PathBuf, Value) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.cache")
        .canonicalize()
        .expect("cache")
        .join(format!("native-installation-{}", Uuid::new_v4()));
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&root)
        .expect("private root");
    for name in ["client", "wallet", "witness"] {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(root.join(name))
            .expect("private directory");
    }
    let client = root.join("client/libclntsh.so");
    let wallet = root.join("wallet/cwallet.sso");
    let identity = root.join("source-identity.json");
    write(&client, b"dummy OCI fixture; never loaded");
    write(&wallet, b"dummy private wallet");
    write(
        &identity,
        json!({"sourceSha":"1".repeat(40)}).to_string().as_bytes(),
    );
    write(
        &root.join("database-url"),
        b"postgresql://worker:private-fixture-value@metadata.invalid:5432/kelryvo",
    );
    let binary =
        fs::canonicalize(std::env::current_exe().expect("test binary")).expect("binary path");
    let artifacts=[("WORKER",binary),("OCI_LIBRARY",client),("WALLET",wallet),("SOURCE_IDENTITY",identity)].into_iter().map(|(kind,path)|json!({"kind":kind,"path":path,"sha256":sha256(fs::read(&path).expect("artifact"))})).collect::<Vec<_>>();
    let expires = (chrono::Utc::now() + chrono::Duration::hours(1))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut config = json!({"format":1,"driverProfile":kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE,"authorizationId":"native-private-smoke","installationDigest":"0".repeat(64),"metadataGenerationId":Uuid::new_v4(),"workerId":"native-installed-smoke","expiresAt":expires,"leaseSeconds":300,"callTimeoutMs":3000,"routeId":Uuid::new_v4(),"connectionId":Uuid::new_v4(),"connectionRevision":"1","masterUsername":"MASTER","masterCredentialRef":format!("vault://kelryvo/{}",Uuid::new_v4()),"sourceCommit":"1".repeat(40),"appImageDigest":format!("sha256:{}","2".repeat(64)),"metadataDatabase":{"host":"metadata.invalid","port":5432,"database":"kelryvo","user":"worker"},"identity":{"engine":"oracle","dbid":"123456","dbUniqueName":"native","resetlogsChange":"1","cdb":true,"containerId":"3","containerGuid":"A".repeat(32),"containerDbid":"123457","containerName":"PDB","serviceName":"native","version":"Oracle Database 26ai Enterprise Edition"},"driverServerVersionString":"23.26.1.0.0","route":{"host":"native.invalid","port":1521,"service":"native","pinnedIPs":["192.0.2.1"],"serverCertificateDN":"CN=native.invalid"},"principals":{"writer":"KRY_WRITER","ledgerOwner":"KRY_LEDGER","observer":"KRY_OBSERVER"},"readerSchemas":["APP"],"protectedOwners":["SYS","SYSTEM"],"targetSchemas":{"APP":{"schemaPrivileges":["ALTER TABLE","CREATE INDEX","CREATE TABLE"]}},"mutexPackageSourceDigest":"3".repeat(64),"ledgerImmutableTriggerSourceDigest":"4".repeat(64),"secretDirectory":root,"witnessDirectory":root.join("witness"),"clientDirectory":root.join("client"),"walletDirectory":root.join("wallet"),"artifacts":artifacts,"review":{"identity":"uid:0","authorizationId":"native-private-smoke","expiresAt":expires,"digest":"0".repeat(64)}});
    config["route"]["host"] = format!("native-{}.invalid", Uuid::new_v4().simple()).into();
    seal(&mut config);
    write(
        &root.join("installation.json"),
        config.to_string().as_bytes(),
    );
    (root, config)
}
/// Unit fixtures bootstrap one shared private catalog. Keep their catalog DDL
/// and retained-generation checks independent of other fixture initializers.
#[allow(dead_code)] // Filesystem-only integration fixtures share this module.
pub async fn metadata_catalog() -> tokio::sync::MutexGuard<'static, ()> {
    static CATALOG: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
    CATALOG.lock().await
}
