//! Private preparation inputs and journal smoke, without loading OCI.
use super::*;
use crate::installation_test_support as support;
use std::os::unix::fs::MetadataExt;
#[test]
fn preparation_requires_the_exact_policy_and_retains_private_atomic_checkpoints() {
    let (root, raw) = support::fixture();
    let mut c: Config = serde_json::from_value(raw).expect("native template");
    let principals = Principals::for_connection(c.connection_id);
    c.principals.writer = principals.writer;
    c.principals.ledger_owner = principals.ledger_owner;
    c.principals.observer = principals.observer;
    let policy:Policy=serde_json::from_value(json!({"format":1,"route":{"host":c.route.host,"port":c.route.port,"service":c.route.service,"transport":"TCPS","pinnedIPs":c.route.pinned_ips,"serverCertificateDN":c.route.server_certificate_dn},"expectedIdentity":c.identity,"schemaOwners":c.reader_schemas,"protectedOwners":c.protected_owners,"createSchemaOwners":["APP"],"tablespace":"DATA","quotaMiB":20,"expiresAt":c.expires_at,"authorizationId":c.authorization_id})).expect("root policy");
    match_policy(&c, &policy).expect("exact root-bound preparation");
    let mut changed = policy.clone();
    changed.route.host = "other.invalid".into();
    assert!(match_policy(&c, &changed).is_err());
    changed = policy.clone();
    changed.protected_owners.push("APP".into());
    assert!(match_policy(&c, &changed).is_err());
    c.principals.writer = "OTHER_WRITER".into();
    assert!(
        match_policy(&c, &policy).is_err(),
        "principal identities derive from the retained connection"
    );
    let out = root.join("output");
    fs::DirBuilder::new()
        .mode(0o700)
        .create(&out)
        .expect("fresh private output");
    let pending = json!({"status":"PREPARING","pending":"create-schema:APP","completed":[]});
    persist(&out, &pending).expect("durable pending checkpoint");
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(out.join("journal.json")).expect("journal"))
            .expect("JSON"),
        pending
    );
    assert_eq!(
        fs::metadata(out.join("journal.json"))
            .expect("private mode")
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(
        fs::read_dir(&out).expect("private output").count(),
        1,
        "atomic rename leaves a single current checkpoint"
    );
    exclusive(&out.join("writer-password"), b"fixture-only").expect("new private secret");
    assert!(
        exclusive(&out.join("writer-password"), b"replacement").is_err(),
        "preparation cannot replace retained credentials"
    );
    assert_eq!(
        fs::read(out.join("writer-password")).expect("retained credential"),
        b"fixture-only"
    );
}
