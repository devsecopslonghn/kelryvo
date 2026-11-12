use super::*;
use crate::installation_test_support::{fixture, write};
use kelryvo_discovery::Operation;
use serde_json::{Value, json};
pub(super) fn manifest(original: &Value) -> Value {
    json!({"format":2,"driverProfile":kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE,"readOnly":true,"disposable":true,"authorizationId":"native-discovery-fixture","expiresAt":original["expiresAt"],"sourceCommit":original["sourceCommit"],"clientDirectory":original["clientDirectory"],"walletDirectory":original["walletDirectory"],"secretDirectory":DIRECTORY,"artifacts":original["artifacts"],"targets":[{"connection":{"id":original["connectionId"],"revision":"1","engine":"oracle","host":"127.0.0.1","port":2484,"service":"APP","transport":"TCPS","username":"MASTER","credentialRef":original["masterCredentialRef"],"credentialMode":"INSTANCE_MASTER"},"observerUsername":"KRY_OBSERVER","secretFile":"observer-fixture","pinnedIps":["127.0.0.1"],"serverCertificateDN":"CN=fixture","expectedIdentity":original["identity"],"schemaOwners":["APP"]}]})
}
#[tokio::test]
async fn discovery_manifest_binds_exact_retained_endpoint_owner_and_native_artifacts() {
    let (root, original) = fixture();
    let file = root.join("discovery.json");
    let manifest = manifest(&original);
    write(&file, manifest.to_string().as_bytes());
    let config = Config::load(&file).unwrap();
    let target = &config.targets[0];
    let mut connection = serde_json::to_value(&target.connection).unwrap();
    connection["owner"] = json!("APP");
    let request = Request::new(connection.clone(), Operation::Schema).unwrap();
    assert_eq!(
        config.authorize(&request).unwrap().observer_username,
        "KRY_OBSERVER"
    );
    assert_eq!(target.address().await.unwrap().to_string(), "127.0.0.1");
    for (field, value) in [
        ("revision", json!("2")),
        ("host", json!("127.0.0.2")),
        ("username", json!("OTHER")),
        ("credentialRef", json!("vault://kelryvo/other")),
        ("owner", json!("OTHER")),
    ] {
        let mut invalid = connection.clone();
        invalid[field] = value;
        let request = Request::new(invalid, Operation::Schema).unwrap();
        assert!(config.authorize(&request).is_err());
    }
    let mut raw = manifest.clone();
    raw["targets"][0]["pinnedIps"] = json!(["192.0.2.1"]);
    let config: Config = serde_json::from_value(raw).unwrap();
    config.validate().unwrap();
    assert!(config.targets[0].address().await.is_err());
    let mut tcp = manifest.clone();
    tcp["targets"][0]["connection"]["transport"] = json!("TCP");
    let c: Config = serde_json::from_value(tcp.clone()).unwrap();
    assert!(c.validate().is_err());
    tcp["targets"][0]["serverCertificateDN"] = Value::Null;
    let c: Config = serde_json::from_value(tcp).unwrap();
    c.validate().unwrap();
    let options = c.targets[0]
        .options(
            &c,
            "127.0.0.1".parse().unwrap(),
            zeroize::Zeroizing::new("fixture".into()),
        )
        .unwrap();
    let descriptor = options.discovery_descriptor("TCP").unwrap();
    assert!(descriptor.contains("(PROTOCOL=TCP)"));
    assert!(!descriptor.contains("SECURITY="));
    assert!(
        options.descriptor().unwrap().contains("(PROTOCOL=TCPS)"),
        "execution's default remains TCPS"
    );
    for (field, value) in [
        ("format", json!(1)),
        ("driverProfile", json!("node-driver")),
        ("readOnly", json!(false)),
        ("secretDirectory", json!("/chosen/by/request")),
        ("liveAcceptance", json!({"acceptedAt":"2000-01-01"})),
    ] {
        let mut invalid = manifest.clone();
        invalid[field] = value;
        write(&file, invalid.to_string().as_bytes());
        assert!(Config::load(&file).is_err());
    }
    for (field, value) in [
        ("observerUsername", json!("SYS")),
        ("secretFile", json!("../password")),
        ("schemaOwners", json!([])),
        ("pinnedIps", json!([])),
        ("serverCertificateDN", json!("CN=x)(HOST=attacker")),
        ("liveAcceptance", json!({"evidenceDigest":"untrusted"})),
    ] {
        let mut invalid = manifest.clone();
        invalid["targets"][0][field] = value;
        write(&file, invalid.to_string().as_bytes());
        assert!(Config::load(&file).is_err());
    }
    write(&file, manifest.to_string().as_bytes());
    let client = root.join("client/libclntsh.so");
    write(&client, b"replaced library");
    assert!(Config::load(&file).is_err());
    write(&client, b"dummy OCI fixture; never loaded");
    Config::load(&file).unwrap();
    write(
        &root.join("client/unreviewed.so"),
        b"not part of artifact manifest",
    );
    assert!(Config::load(&file).is_err());
}
