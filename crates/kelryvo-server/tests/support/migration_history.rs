use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference_as, plans::APPROVER, request};
use axum::{Router, http::StatusCode};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
async fn get(app: &Router, token: &str, path: &str) -> (StatusCode, Value) {
    let r = request(app, "GET", path, None, Some(token), None, None).await;
    (r.0, r.2)
}
async fn compare(app: &Router, path: &str, token: &str, actor: &str) -> Value {
    let native = get(app, token, path).await;
    let (path, actor) = (path.to_owned(), actor.to_owned());
    let old = tokio::task::spawn_blocking(move || reference_as("GET", &path, None, &actor))
        .await
        .expect("bounded retained history comparison");
    assert_fixture_eq!(native.0.as_u16(), old["status"], "{}", native.1);
    assert_fixture_eq!(native.1, old["body"], "exact history projection and cursor");
    native.1
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid) {
    let p:Value=sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_plans p WHERE project_id=$1 AND status='APPROVED' ORDER BY created_at DESC,id DESC LIMIT 1").bind(project).fetch_one(pool).await.expect("history plan fixture");
    let intent = kelryvo_core::intent::verify(
        p["offline_intent_envelope"].as_str().expect("envelope"),
        p["offline_intent_digest"].as_str().expect("digest"),
        None,
    )
    .expect("retained intent");
    let plan = Uuid::parse_str(p["id"].as_str().expect("plan")).expect("plan UUID");
    let marker = "native_history_cursor_fixture";
    for (version, id) in crate::fixtures::data("history-cursor-ids")
        .as_object()
        .unwrap()
    {
        sqlx::query("INSERT INTO sf_history(id,project_id,plan_id,version,path,sha256,status,created_at) VALUES($1,$2,$3,$4,$5,repeat('d',64),'NOT_EXECUTED','2020-01-01T00:00:00.123456Z'::timestamptz)").bind(Uuid::parse_str(id.as_str().unwrap()).unwrap()).bind(project).bind(plan).bind(version).bind(format!("migrations/V{version}__native_history_cursor_fixture.sql")).execute(pool).await.expect("fixed tied microsecond history");
    }

    let base = format!("/api/projects/{project}/migration-history");
    let filtered = format!("{base}?q={marker}");
    let first = compare(app, &filtered, TOKEN, "developer").await;
    assert_eq!(first["total"], 31);
    assert_eq!(first["items"].as_array().expect("page").len(), 25);
    assert!(
        first["items"][0]["at"]
            .as_str()
            .expect("timestamp")
            .contains(".123456")
    );
    assert_eq!(first["nextOffset"], 25);
    sqlx::query("INSERT INTO sf_history(project_id,plan_id,version,path,sha256,status,created_at) VALUES($1,$2,'20000','migrations/V20000__native_history_cursor_fixture.sql',repeat('e',64),'NOT_EXECUTED','2040-01-01'::timestamptz)").bind(project).bind(plan).execute(pool).await.expect("newer concurrent history fixture");
    let next = format!(
        "{filtered}&cursor={}",
        first["nextCursor"].as_str().expect("cursor")
    );
    let second = compare(app, &next, APPROVER, "approver").await;
    let filters = json!({"targetId":null,"status":null,"q":marker});
    let mut position = kelryvo_core::cursor::decode_migration(
        first["nextCursor"].as_str().expect("cursor"),
        &project.to_string(),
        &filters,
    )
    .expect("native cursor");
    let at =
        chrono::DateTime::parse_from_rfc3339(position["at"].as_str().expect("cursor timestamp"))
            .expect("instant");
    position["at"] = at
        .with_timezone(&chrono::FixedOffset::east_opt(7 * 3600).expect("legacy timezone"))
        .to_rfc3339_opts(chrono::SecondsFormat::Micros, false)
        .into();
    let legacy_cursor =
        kelryvo_core::cursor::encode_migration(&project.to_string(), &filters, &position);
    assert_eq!(
        compare(
            app,
            &format!("{filtered}&cursor={legacy_cursor}"),
            TOKEN,
            "developer"
        )
        .await,
        second,
        "legacy timezone offsets retain the same microsecond position"
    );
    assert_eq!(second["total"], 32);
    assert_eq!(second["items"].as_array().expect("page").len(), 6);
    assert!(second["nextOffset"].is_null());
    let ids = first["items"]
        .as_array()
        .expect("first")
        .iter()
        .chain(second["items"].as_array().expect("second"))
        .map(|r| r["id"].as_str().expect("id"))
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(ids.len(), 31);
    assert!(!second["items"].to_string().contains("V20000"));
    compare(app, &format!("{filtered}&offset=25"), TOKEN, "developer").await;
    for endpoint in [
        format!("{next}&status=HOLD"),
        format!("{next}&offset=0"),
        format!("{base}?offset=01"),
        format!("{base}?status=bad"),
        format!("{base}?q={}", "x".repeat(121)),
        format!("{base}?cursor=bad"),
        format!("{base}?unexpected=x"),
    ] {
        assert_eq!(
            compare(app, &endpoint, TOKEN, "developer").await["error"],
            "INVALID_REQUEST"
        );
    }
    assert_eq!(get(app, OTHER_TOKEN, &base).await.0, StatusCode::NOT_FOUND);
    assert_eq!(
        get(
            app,
            TOKEN,
            &format!(
                "/api/projects/{}/migration-history?q={marker}&cursor={}",
                Uuid::new_v4(),
                first["nextCursor"].as_str().expect("cursor")
            )
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    compare(app, &base, TOKEN, "developer").await;
    for suffix in [
        format!(
            "targetId={}",
            intent["target"]["bindingId"].as_str().expect("binding")
        ),
        format!("targetId={}", p["profile_id"].as_str().expect("profile")),
        "status=HOLD".into(),
        "q=EXECUTION_RECONCILIATION".into(),
    ] {
        compare(app, &format!("{base}?{suffix}"), TOKEN, "developer").await;
    }
    let forged:Uuid=sqlx::query_scalar("INSERT INTO sf_plans(project_id,organization_id,release_id,profile_id,author_id,status,items,source_binding_generation,offline_intent_envelope,offline_intent_digest) SELECT project_id,organization_id,release_id,profile_id,author_id,'PENDING_APPROVAL',items,source_binding_generation,offline_intent_envelope||' ',offline_intent_digest FROM sf_plans WHERE id=$1 RETURNING id").bind(plan).fetch_one(pool).await.expect("private corrupt target envelope");
    let target = intent["target"]["bindingId"].as_str().expect("target");
    let exact = compare(
        app,
        &format!("{base}?targetId={target}&q={forged}"),
        TOKEN,
        "developer",
    )
    .await;
    assert_eq!(
        exact["total"], 0,
        "unverified target text never acquires a binding"
    );
    let generation: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(pool)
            .await
            .expect("generation");
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("private generation");
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(pool)
        .await
        .expect("private restore HOLD");
    assert_eq!(
        compare(app, &filtered, TOKEN, "developer").await["total"],
        32
    );
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(generation)
        .execute(pool)
        .await
        .expect("restore fixture gate");
}
