use kelryvo_core::{intent, plan};
use serde_json::json;

#[test]
fn retained_approval_displays_evidence_without_restoring_authority_or_leaking_secrets() {
    let id = "00000000-0000-4000-8000-000000000001";
    let item = json!({"path":"migrations/V1__init.sql","version":"1","sha256":"a".repeat(64)});
    let facts = json!({"organizationId":id,"projectId":id,"requesterId":"developer","releaseId":id,"commit":"b".repeat(40),"objectFormat":"sha1","folder":"migrations","parserProfile":"retained-profile","manifestDigest":"c".repeat(64),"profileId":id,"profileName":"Oracle","environmentId":id,"environmentName":"Development","engine":"oracle","host":"oracle.example.invalid","port":1521,"service":"PDB","username":"APP","credentialRef":"secret://private/credential-reference","items":[item]});
    let encoded = intent::encode(&facts).expect("approved intent");
    let mut row = json!({"id":id,"organization_id":id,"project_id":id,"author_id":"developer","release_id":id,"profile_id":id,"status":"APPROVED","offline_intent_envelope":encoded["envelope"],"offline_intent_digest":encoded["digest"],"items":[{"path":item["path"],"version":item["version"],"sha256":item["sha256"],"status":"NOT_EXECUTED"}],"execution":"NOT_EXECUTED"});
    let display = plan::project(&row);
    assert_eq!(display["offlineIntent"]["digest"], encoded["digest"]);
    assert_eq!(display["status"], "APPROVED");
    assert_eq!(display["executionReadiness"]["executionAuthority"], false);
    assert_eq!(display["currentness"]["state"], "LEGACY_UNBOUND");
    assert!(!display.to_string().contains("secret://"));
    row["project_id"] = "00000000-0000-4000-8000-000000000002".into();
    let display = plan::project(&row);
    assert!(display["offlineIntent"].is_null());
    assert_eq!(display["currentness"]["state"], "UNKNOWN");
    assert!(
        display["executionReadiness"]["blockers"]
            .as_array()
            .expect("blockers")
            .contains(&json!("PLAN_INTENT_UNAVAILABLE"))
    );
}
