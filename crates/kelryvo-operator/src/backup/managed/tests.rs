use super::*;
use std::{fs, os::unix::fs::PermissionsExt};
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/managed.json")).unwrap()
}
fn native(f: &Value, credentials: bool) -> Result<Live> {
    let c = &f["config"];
    let cluster = &f["clusterConfig"];
    let facts = facts(
        cluster["server"].as_str().unwrap(),
        cluster["caData"].as_str().unwrap(),
        cluster["caPath"].as_str().unwrap(),
        cluster["insecure"].as_str().unwrap(),
    )?;
    let r = &f["resources"];
    let resources = Resources {
        sts: r[format!("statefulset/{STS}")].clone(),
        svc: r[format!("service/{STS}")].clone(),
        pod: r[format!("pod/{POD}")].clone(),
        pvc: r[format!("pvc/{PVC}")].clone(),
        pv: r[format!("pv/{}", c["pv"].as_str().unwrap())].clone(),
        endpoints: r[format!("endpoints/{STS}")].clone(),
        secret_uid: r[format!("secret/{STS}")]["metadata"]["uid"]
            .as_str()
            .unwrap()
            .into(),
        secret: Some(r[format!("secret/{STS}")].clone()),
    };
    verify(c, &facts, &resources, credentials)
}
fn reference(v: Value) -> Value {
    crate::fixtures::read("managed-backup", &v)
}
#[test]
fn exact_managed_resource_and_secret_contract_matches_retained_verifier() {
    for credentials in [false, true] {
        let mut f = fixture();
        f["credentials"] = json!(credentials);
        let old = reference(f.clone());
        let live = native(&f, credentials).unwrap();
        assert_fixture_eq!(old["ok"], true);
        assert_fixture_eq!(old["target"], live.identity);
        assert_fixture_eq!(
            old["appDigest"],
            live.secrets
                .as_ref()
                .map(|s| json!(kelryvo_core::sha256(s.app.as_str())))
                .unwrap_or(Value::Null)
        );
        assert_fixture_eq!(
            old["adminDigest"],
            live.secrets
                .as_ref()
                .map(|s| json!(kelryvo_core::sha256(s.admin.as_str())))
                .unwrap_or(Value::Null)
        );
    }
    for change in ["pod", "pvc", "endpoint", "image", "ca", "extra"] {
        let mut f = fixture();
        match change {
            "pod" => {
                f["resources"][format!("pod/{POD}")]["metadata"]["uid"] = json!(Uuid::new_v4())
            }
            "pvc" => f["resources"][format!("pvc/{PVC}")]["spec"]["volumeName"] = "wrong-pv".into(),
            "endpoint" => {
                f["resources"][format!("endpoints/{STS}")]["subsets"][0]["addresses"][0]["ip"] =
                    "10.0.0.99".into()
            }
            "image" => {
                f["resources"][format!("pod/{POD}")]["status"]["containerStatuses"][0]["imageID"] =
                    "wrong-image".into()
            }
            "ca" => f["clusterConfig"]["insecure"] = "true".into(),
            _ => f["config"]["executionAuthority"] = true.into(),
        }
        assert!(native(&f, true).is_err(), "{change}");
        f["credentials"] = true.into();
        assert_fixture_eq!(reference(f)["ok"], false, "retained rejection: {change}");
    }
}
#[test]
fn restored_witness_allows_only_pod_and_secret_identity_rotation() {
    let identity = native(&fixture(), false).unwrap().identity;
    let mut rotated = identity.clone();
    rotated["podUid"] = json!(Uuid::new_v4());
    rotated["secretUid"] = json!(Uuid::new_v4());
    assert!(compatible(&identity, &rotated).unwrap());
    assert_fixture_eq!(
        reference(json!({"op":"compatible","source":identity,"target":rotated}))["compatible"],
        true
    );
    rotated["pvUid"] = json!(Uuid::new_v4());
    assert!(!compatible(&identity, &rotated).unwrap());
    assert_fixture_eq!(
        reference(json!({"op":"compatible","source":identity,"target":rotated}))["compatible"],
        false
    );
}
#[tokio::test]
async fn owned_native_tunnel_is_loopback_only_and_confirmed_reaped() {
    let binary = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("examples/managed-probe");
    assert!(
        binary.is_file(),
        "build --example managed-probe before operator tests"
    );
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join(".cache")
        .join(format!("managed-native-{}", Uuid::new_v4()));
    fs::create_dir(&root).unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    let pin = tool::snapshot(&binary).unwrap();
    files::write(
        &root.join("kubectl-tool"),
        &serde_json::to_vec(&pin).unwrap(),
    )
    .unwrap();
    files::write(
        &root.join("kubeconfig"),
        b"private in-memory fixture; no cluster credentials\n",
    )
    .unwrap();
    let output = root.join("attestation.json");
    let result = attest(&root, &output).await.unwrap();
    assert_eq!(result["executionAuthority"], false);
    let captured: Value = serde_json::from_slice(&files::read(&output, 16384).unwrap()).unwrap();
    assert_eq!(captured, fixture()["config"]);
    let k = Kube::read(&root).unwrap();
    let mut forward = tunnel::Tunnel::start(&k).await.unwrap();
    assert!(forward.port > 0);
    live(&k, &captured, false).await.unwrap();
    forward.stop().await.unwrap();
    forward.stop().await.unwrap();
}
