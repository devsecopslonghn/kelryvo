use super::{OTHER_TOKEN, TOKEN, execution_jobs::reference_as, plans::APPROVER, request};
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
    let result = request(app, method, path, body, Some(token), None, None).await;
    (result.0, result.2)
}
async fn compare(app: &Router, path: &str, token: &str, actor: &str) -> Value {
    let native = call(app, token, "GET", path, None).await;
    let (path, actor) = (path.to_owned(), actor.to_owned());
    let old = tokio::task::spawn_blocking(move || reference_as("GET", &path, None, &actor))
        .await
        .expect("private retained origin read");
    assert_fixture_eq!(native.0.as_u16(), old["status"]);
    assert_fixture_eq!(native.1, old["body"], "exact historical origin projection");
    native.1
}
async fn counter(pool: &PgPool, project: Uuid) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT count(*) FROM sf_releases WHERE project_id=$1),(SELECT count(*) FROM sf_sql_draft_revisions WHERE project_id=$1),(SELECT count(*) FROM sf_audit WHERE project_id=$1),(SELECT count(*) FROM sf_execution_attempts a JOIN sf_execution_jobs j ON j.id=a.job_id WHERE j.project_id=$1))").bind(project).fetch_one(pool).await.expect("origin read side effects")
}
pub async fn run(pool: &PgPool, app: &Router, project: Uuid) {
    let base = format!("/api/projects/{project}");
    let targets = call(app, TOKEN, "GET", &format!("{base}/target-bindings"), None).await;
    let target = &targets.1["bindings"][0];
    let body = json!({"expectedRevision":"1","targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"expectedAssignmentRevision":target["assignmentRevision"]});
    for multi in [false, true] {
        let mut input = json!({"name":"Native historical origin fixture","targetBindingId":target["bindingId"]});
        if multi {
            input["files"] = json!([{"id":Uuid::new_v4(),"path":"V1__first.sql","sql":"CREATE TABLE origin_a(id NUMBER);\n"},{"id":Uuid::new_v4(),"path":"V2__second.sql","sql":"-- 😀\r\nALTER TABLE origin_a ADD label VARCHAR2(40 BYTE);\r\n"}]);
        } else {
            input["sql"] = "CREATE TABLE origin_legacy(id NUMBER);\n".into();
        }
        let created = call(
            app,
            TOKEN,
            "POST",
            &format!("{base}/sql-drafts"),
            Some(input),
        )
        .await;
        assert_eq!(created.0, StatusCode::CREATED, "{}", created.1);
        let draft = &created.1["draft"];
        let path = format!("{base}/sql-drafts/{}", draft["id"].as_str().expect("draft"));
        let prepared = call(
            app,
            TOKEN,
            "POST",
            &format!("{path}/prepare-release"),
            Some(body.clone()),
        )
        .await;
        assert_eq!(prepared.0, StatusCode::CREATED, "{}", prepared.1);
        let release = &prepared.1["release"];
        let release_id = release["id"].as_str().expect("release ID");
        let descriptor = format!("{base}/releases/{release_id}/draft-origin");
        let detail = super::release_details::compare(
            app,
            "GET",
            &format!("/api/releases/{release_id}"),
            None,
            TOKEN,
            "developer",
        )
        .await;
        assert_eq!(detail.0, StatusCode::OK);
        assert_eq!(detail.1["release"]["draftId"], draft["id"]);
        let before = counter(pool, project).await;
        for (token, actor) in [(TOKEN, "developer"), (APPROVER, "approver")] {
            let result = compare(app, &descriptor, token, actor).await;
            assert_eq!(result["origin"]["draftId"], draft["id"]);
            assert_eq!(
                result["origin"]["manifestVersion"],
                if multi { 2 } else { 1 }
            );
            assert_eq!(result["origin"]["sourceBindingCurrent"], true);
            assert_eq!(
                result["origin"]["files"][0]["draftFileId"],
                draft["files"][0]["id"]
            );
            assert!(!result.to_string().contains("CREATE TABLE"));
            assert!(!result.to_string().contains("secret://"));
        }
        assert_eq!(counter(pool, project).await, before);
        assert_eq!(
            call(app, OTHER_TOKEN, "GET", &descriptor, None).await.0,
            StatusCode::NOT_FOUND
        );
        let foreign = format!(
            "/api/projects/{}/releases/{release_id}/draft-origin",
            Uuid::new_v4()
        );
        assert_eq!(
            compare(app, &foreign, TOKEN, "developer").await["error"],
            "NOT_FOUND"
        );
        assert_eq!(
            compare(
                app,
                &format!("{descriptor}?unexpected=x"),
                TOKEN,
                "developer"
            )
            .await["error"],
            "NOT_FOUND"
        );
        if !multi {
            continue;
        }
        let updated_files:Vec<Value>=draft["files"].as_array().expect("files").iter().map(|f|json!({"id":f["id"],"path":f["path"],"sql":format!("-- Current edited revision\n{}",f["sql"].as_str().expect("SQL"))})).collect();
        assert_eq!(call(app,TOKEN,"PUT",&path,Some(json!({"name":draft["name"],"targetBindingId":target["bindingId"],"expectedRevision":"1","files":updated_files}))).await.0,StatusCode::OK);
        let result = compare(app, &descriptor, TOKEN, "developer").await;
        assert_eq!(result["origin"]["currentRevision"], "2");
        assert_eq!(result["origin"]["draftRevision"], "1");
        assert_eq!(result["origin"]["draftSha256"], draft["sha256"]);
        let detail = call(app, TOKEN, "GET", &base, None).await;
        let listed = detail.1["releases"]
            .as_array()
            .expect("release list")
            .iter()
            .find(|r| r["id"] == release["id"])
            .expect("authored attribution");
        assert_eq!(listed["sourceKind"], "AUTHORED_SQL_WORKSPACE");
        assert_eq!(listed["draftRevision"], "1");
        assert_eq!(listed["draftId"], draft["id"]);
        let generation: Uuid =
            sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
                .fetch_one(pool)
                .await
                .expect("generation");
        let hold = Uuid::new_v4();
        sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(pool).await.expect("private restore generation");
        sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
            .bind(hold)
            .execute(pool)
            .await
            .expect("private restore HOLD");
        assert_eq!(
            compare(app, &descriptor, TOKEN, "developer").await["origin"]["draftRevision"],
            "1"
        );
        assert_eq!(
            super::release_details::compare(
                app,
                "GET",
                &format!("/api/releases/{release_id}"),
                None,
                TOKEN,
                "developer"
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            super::release_details::compare(
                app,
                "POST",
                &format!("{base}/releases/compare"),
                Some(json!({"baseReleaseId":release_id,"candidateReleaseId":release_id})),
                TOKEN,
                "developer"
            )
            .await
            .0,
            StatusCode::CONFLICT
        );
        sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
            .bind(generation)
            .execute(pool)
            .await
            .expect("restore fixture gate");
        let source:Value=sqlx::query_scalar("SELECT jsonb_build_object('repository',source_repository_id,'folder',source_folder) FROM sf_projects WHERE id=$1").bind(project).fetch_one(pool).await.expect("current source");
        sqlx::query("UPDATE sf_projects SET source_folder='new_origin_folder',source_binding_generation=source_binding_generation+1,archived_at=clock_timestamp() WHERE id=$1").bind(project).execute(pool).await.expect("private source/archive fixture");
        assert_eq!(
            super::release_details::compare(
                app,
                "GET",
                &format!("/api/releases/{release_id}"),
                None,
                TOKEN,
                "developer"
            )
            .await
            .0,
            StatusCode::OK
        );
        assert_eq!(
            super::release_details::compare(
                app,
                "POST",
                &format!("{base}/releases/compare"),
                Some(json!({"baseReleaseId":release_id,"candidateReleaseId":release_id})),
                TOKEN,
                "developer"
            )
            .await
            .0,
            StatusCode::OK
        );

        assert_eq!(
            compare(app, &descriptor, APPROVER, "approver").await["origin"]["sourceBindingCurrent"],
            false
        );
        sqlx::query("UPDATE sf_projects SET source_repository_id=$2,source_folder=$3,source_binding_generation=source_binding_generation+1,archived_at=NULL WHERE id=$1").bind(project).bind(source["repository"].as_str()).bind(source["folder"].as_str()).execute(pool).await.expect("restore source fields, keeping new generation");
        assert_fixture_eq!(
            compare(app, &descriptor, TOKEN, "developer").await["origin"]["sourceBindingCurrent"],
            false,
            "changing back cannot qualify an old source generation"
        );
        let clone:Uuid=sqlx::query_scalar("INSERT INTO sf_releases(project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files) SELECT project_id,organization_id,repository_id,commit_id,object_format,folder,manifest_digest,validation_status,validation_code,parser_profile,files FROM sf_releases WHERE id=$1::text::uuid RETURNING id").bind(release_id).fetch_one(pool).await.expect("private clone without origin");
        let clone_path = format!("{base}/releases/{clone}/draft-origin");
        assert_eq!(
            compare(app, &clone_path, TOKEN, "developer").await["error"],
            "NOT_FOUND",
            "a release without authored provenance is not editable"
        );
        sqlx::query("INSERT INTO sf_sql_workspace_releases(release_id,project_id,organization_id,draft_id,draft_revision,draft_sha256,draft_manifest_version,source_binding_generation,created_by) SELECT $1,project_id,organization_id,draft_id,draft_revision,$2,draft_manifest_version,source_binding_generation,created_by FROM sf_sql_workspace_releases WHERE release_id=$3::text::uuid").bind(clone).bind("0".repeat(64)).bind(release_id).execute(pool).await.expect("private damaged provenance fixture");
        assert_eq!(
            compare(app, &clone_path, TOKEN, "developer").await["error"],
            "RELEASE_INTEGRITY_FAILED"
        );
        assert!(
            sqlx::query("UPDATE sf_sql_workspace_releases SET draft_sha256=$1 WHERE release_id=$2")
                .bind("f".repeat(64))
                .bind(clone)
                .execute(pool)
                .await
                .is_err(),
            "origin remains immutable"
        );
        assert!(
            sqlx::query("UPDATE sf_releases SET manifest_digest=$1 WHERE id=$2::text::uuid")
                .bind("f".repeat(64))
                .bind(release_id)
                .execute(pool)
                .await
                .is_err(),
            "source remains immutable"
        );
    }
}
