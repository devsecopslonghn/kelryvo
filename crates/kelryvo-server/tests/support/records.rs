use super::{OTHER_TOKEN, TOKEN, request, target_reference};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

pub async fn check(app: &Router, project: Uuid, plan: &Value) -> Value {
    let id = plan["id"].as_str().expect("plan");
    let path = format!("/api/projects/{project}/plans/{id}/record");
    let (status, headers, body) = request(app, "GET", &path, None, Some(TOKEN), None, None).await;
    assert_eq!(status, StatusCode::OK, "{}", body);
    assert_eq!(headers["cache-control"], "no-store");
    assert_eq!(
        headers["content-disposition"],
        format!("attachment; filename=\"kelryvo-plan-{id}.json\"")
    );
    assert_eq!(body["algorithm"], "sha256");
    let raw = body["record"].as_str().expect("record text");
    assert_eq!(body["sha256"], kelryvo_core::sha256(raw));
    let record: Value = serde_json::from_str(raw).expect("record JSON");
    assert_eq!(record["kind"], "KELRYVO_PLAN_RECORD");
    assert_eq!(record["scope"], "OFFLINE_GOVERNANCE");
    assert_eq!(record["executionAuthority"], false);
    assert_eq!(record["targetEffects"], "NOT_ATTESTED");
    assert_eq!(
        record["format"],
        if record["retainedIntent"]["format"].as_u64().expect("format") >= 3 {
            2
        } else {
            1
        }
    );
    assert_eq!(record["plan"]["status"], plan["status"]);
    assert!(!raw.contains("secret://"));
    assert!(!raw.contains("vault://"));
    assert!(!raw.contains("privatePrincipalRef"));
    assert!(!raw.contains("credentialRef"));
    assert!(!raw.contains("CREATE TABLE item"));
    let reference = target_reference(json!({"projectId":project,"planId":id}));
    assert_fixture_eq!(
        record["plan"],
        reference["plan"],
        "record governance phase matches retained verifier"
    );
    assert_fixture_eq!(
        record["retainedIntent"],
        reference["retainedIntent"],
        "record historical evidence matches retained verifier"
    );
    assert_eq!(
        request(app, "GET", &path, None, Some(OTHER_TOKEN), None, None)
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            app,
            "GET",
            &format!("{path}?extra=1"),
            None,
            Some(TOKEN),
            None,
            None
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    record
}

pub async fn legacy(pool: &PgPool, app: &Router, project: Uuid, plan: &Value) {
    let id = Uuid::parse_str(plan["id"].as_str().expect("plan")).expect("UUID");
    let mut tx = pool.begin().await.expect("legacy fixture");
    let row = kelryvo_server::plans::load(&mut tx, id, Some(project), false)
        .await
        .expect("retained intent");
    tx.commit().await.expect("read fixture");
    let mut facts = kelryvo_server::plans::intent(&row).expect("verified facts");
    let envelope: Value =
        serde_json::from_str(row["offline_intent_envelope"].as_str().expect("envelope"))
            .expect("array envelope");
    facts["credentialRef"] = envelope[19].clone();
    facts.as_object_mut().expect("facts").shift_remove("target");
    for version in [2, 1] {
        if version == 1 {
            facts
                .as_object_mut()
                .expect("facts")
                .shift_remove("statements");
        }
        let encoded = kelryvo_core::intent::encode(&facts).expect("legacy envelope");
        let legacy:Uuid=sqlx::query_scalar("INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items,source_binding_generation,offline_intent_envelope,offline_intent_digest) SELECT project_id,organization_id,release_id,profile_id,author_id,'PENDING_APPROVAL',items,source_binding_generation,$2,$3 FROM sf_plans WHERE id=$1 RETURNING id").bind(id).bind(encoded["envelope"].as_str()).bind(encoded["digest"].as_str()).fetch_one(pool).await.expect("private legacy plan");
        let record = check(
            app,
            project,
            &json!({"id":legacy,"status":"PENDING_APPROVAL"}),
        )
        .await;
        assert_eq!(record["retainedIntent"]["format"], version);
        assert_eq!(record["format"], 1);
    }
}
