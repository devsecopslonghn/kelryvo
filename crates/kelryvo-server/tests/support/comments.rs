use super::{OTHER_TOKEN, TOKEN, plans::APPROVER, request, target_reference};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn call(
    app: &Router,
    token: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let r = request(app, method, path, body, Some(token), None, None).await;
    (r.0, r.2)
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid, plan: &Value, comparison: &Value) {
    let id = plan["id"].as_str().expect("plan");
    let path = format!("/api/projects/{project}/plans/{id}/comments");
    let file_path = plan["items"][0]["path"].as_str().expect("file path");
    let preview = call(
        app,
        APPROVER,
        "GET",
        &format!(
            "/api/releases/{}/statement-preview?path={file_path}",
            plan["releaseId"].as_str().expect("release")
        ),
        None,
    )
    .await;
    assert_eq!(preview.0, StatusCode::OK, "{}", preview.1);
    let statement = &preview.1["preview"]["statements"][0];
    let reference = json!({"filePath":file_path,"startByte":statement["startByte"],"endByte":statement["endByte"],"sourceSha256":statement["sourceSha256"],"executionSha256":statement["executionSha256"]});
    let body = json!({"body":"Review Tiếng Việt 😀\n<script>source remains text</script>","evidenceRefs":[reference],"comparisonId":comparison["id"]});
    assert_eq!(
        call(app, OTHER_TOKEN, "POST", &path, Some(body.clone()))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let mut forged = body.clone();
    forged["evidenceRefs"][0]["sourceSha256"] = "f".repeat(64).into();
    assert_eq!(
        call(app, APPROVER, "POST", &path, Some(forged)).await.1["error"],
        "COMMENT_EVIDENCE_UNAVAILABLE"
    );
    let mut duplicate = body.clone();
    duplicate["evidenceRefs"] = json!([reference, reference]);
    assert_eq!(
        call(app, TOKEN, "POST", &path, Some(duplicate)).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut spoofed = body.clone();
    spoofed["evidenceRefs"][0]["parserProfile"] = "client-supplied".into();
    assert_eq!(
        call(app, TOKEN, "POST", &path, Some(spoofed)).await.0,
        StatusCode::BAD_REQUEST
    );
    let comment = call(app, APPROVER, "POST", &path, Some(body.clone())).await;
    assert_eq!(comment.0, StatusCode::CREATED, "{}", comment.1);
    assert_eq!(comment.1["comment"]["body"], body["body"]);
    assert_eq!(comment.1["comment"]["comparisonId"], comparison["id"]);
    let retained = &comment.1["comment"]["evidenceRefs"][0];
    assert_eq!(retained["intentDigest"], plan["offlineIntent"]["digest"]);
    assert_eq!(retained["parserProfile"], kelryvo_parser::PROFILE);
    assert_eq!(retained["releaseId"], plan["releaseId"]);
    assert_eq!(
        retained["sourceFileSha256"],
        preview.1["preview"]["sourceSha256"]
    );
    let audit:Value=sqlx::query_scalar("SELECT facts FROM sf_audit WHERE resource_id=$1::text::uuid AND action='PLAN_COMMENT_ADDED' AND facts->>'commentId'=$2").bind(id).bind(comment.1["comment"]["id"].as_str()).fetch_one(pool).await.expect("comment audit");
    assert_eq!(audit["comparisonId"], comparison["id"]);
    assert_eq!(audit["comparisonDigest"], comparison["digest"]);
    assert_eq!(audit["evidenceRefCount"], 1);
    assert_eq!(
        call(app, OTHER_TOKEN, "GET", &path, None).await.0,
        StatusCode::NOT_FOUND
    );
    let listed = call(app, TOKEN, "GET", &path, None).await;
    assert_eq!(listed.1["comments"][0], comment.1["comment"]);

    // A retained source changed in a private fixture: file facts and parsed
    // statement facts must both survive the immutable comparison round trip.
    let raw = "CREATE TABLE review_comparison(id NUMBER);\n";
    let file = json!({"path":file_path,"version":plan["items"][0]["version"],"sha256":kelryvo_core::sha256(raw),"bytes":raw.len(),"content":raw,"statementCount":1,"validationStatus":"VALID"});
    let manifest = json!({"format":1,"commit":"d".repeat(40),"objectFormat":"sha1","folder":"migrations","parserProfile":kelryvo_parser::PROFILE,"files":[{"path":file["path"],"version":file["version"],"sha256":file["sha256"],"bytes":file["bytes"]}]});
    let base:Uuid=sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,parser_profile,files) SELECT id,organization_id,source_repository_id,$2,'sha1','migrations',$3,'VALID',$4,$5 FROM sf_projects WHERE id=$1 RETURNING id").bind(project).bind("d".repeat(40)).bind(kelryvo_core::evidence_digest(&manifest)).bind(kelryvo_parser::PROFILE).bind(json!([file])).fetch_one(pool).await.expect("changed comparison fixture");
    let comparisons = format!("/api/projects/{project}/plans/{id}/comparisons");
    let compared = call(
        app,
        TOKEN,
        "POST",
        &comparisons,
        Some(json!({"baseReleaseId":base,"expectedIntentDigest":plan["offlineIntent"]["digest"]})),
    )
    .await;
    assert_eq!(compared.0, StatusCode::CREATED, "{}", compared.1);
    let compared = &compared.1["comparison"];
    assert_eq!(compared["evidence"]["files"][0]["change"], "CHANGED");
    assert_eq!(
        compared["evidence"]["files"][0]["statements"][0]["change"], "AMBIGUOUS",
        "different SQL never becomes an inferred replacement"
    );
    assert_fixture_eq!(
        target_reference(json!({"projectId":project,"planId":id,"comparisonId":compared["id"]})),
        *compared
    );

    // The trusted historical-review exception must not open approval or config.
    let active: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("active generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,operator_os_uid) VALUES($1,$2,'RESTORE_HOLD',$3,1000)").bind(hold).bind(active).bind("a".repeat(64)).execute(pool).await.expect("private restore fixture");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("enter private hold");
    assert_eq!(call(app,TOKEN,"POST",&path,Some(json!({"body":"Historical review during restore","evidenceRefs":[reference],"comparisonId":comparison["id"]}))).await.0,StatusCode::CREATED);
    assert_eq!(
        call(
            app,
            APPROVER,
            "GET",
            &format!(
                "{comparisons}/{}",
                comparison["id"].as_str().expect("comparison")
            ),
            None
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        call(
            app,
            TOKEN,
            "POST",
            &comparisons,
            Some(
                json!({"baseReleaseId":base,"expectedIntentDigest":plan["offlineIntent"]["digest"]})
            )
        )
        .await
        .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    assert_eq!(
        call(
            app,
            APPROVER,
            "POST",
            &format!("/api/plans/{id}/decision"),
            Some(json!({"decision":"APPROVE","reason":"Must remain held"}))
        )
        .await
        .1["error"],
        "METADATA_RESTORE_HOLD"
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(active)
        .execute(pool)
        .await
        .expect("restore private fixture");
}
