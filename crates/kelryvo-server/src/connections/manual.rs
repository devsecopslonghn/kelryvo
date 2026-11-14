//! Retained manual-reference APIs. Registration records declared metadata only;
//! it never observes Oracle, installs a principal or grants execution authority.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth::Authenticated, conflict, discovery, instances,
    invalid, not_found, projects,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use regex::Regex;
use serde_json::{Value, json};
use std::sync::LazyLock;
use uuid::Uuid;

fn text(v: &Value, limit: usize) -> bool {
    v.as_str().is_some_and(|s| {
        !s.trim_matches(kelryvo_core::js_whitespace).is_empty()
            && s.encode_utf16().count() <= limit
            && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}
fn trim(v: &Value) -> &str {
    v.as_str()
        .unwrap_or_default()
        .trim_matches(kelryvo_core::js_whitespace)
}
fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}
fn id(v: &Value) -> Result<Uuid, ApiError> {
    projects::id(v.as_str().ok_or_else(invalid)?)
}
use kelryvo_core::port;
static HOST: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\A(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])\z")
        .expect("host")
});
static SERVICE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\A[A-Za-z0-9_$#.-]{1,128}\z").expect("service"));
static USER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\A[A-Za-z][A-Za-z0-9_$#]{0,127}\z").expect("username"));
static REFERENCE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\A(?:vault|secret)://[A-Za-z0-9._/-]{1,500}\z").expect("reference")
});
fn matches(pattern: &LazyLock<Regex>, v: &Value) -> bool {
    v.as_str().is_some_and(|s| pattern.is_match(s))
}

pub async fn declare_instance(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Json(b): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if !exact(
        &b,
        &[
            "name",
            "containerName",
            "kind",
            "environment",
            "host",
            "port",
            "service",
            "transport",
            "owner",
            "reason",
        ],
    ) || !text(&b["reason"], 2000)
    {
        return Err(invalid());
    }
    let project = projects::id(&project)?;
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    instances::guard(&mut tx, &auth, project).await?;
    let owner = b["owner"].as_str().ok_or_else(invalid)?;
    if !b["name"].as_str().is_some_and(|s| {
        !s.is_empty()
            && s.encode_utf16().count() <= 120
            && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    }) || !b["containerName"].as_str().is_some_and(|s| {
        !s.is_empty()
            && s.encode_utf16().count() <= 120
            && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    }) || !["PDB", "NON_CDB"].contains(&b["kind"].as_str().unwrap_or_default())
        || !["DEV", "SIT", "UAT", "PROD"].contains(&b["environment"].as_str().unwrap_or_default())
        || !["TCP", "TCPS"].contains(&b["transport"].as_str().unwrap_or_default())
        || !matches(&HOST, &b["host"])
        || b["host"].as_str().is_none_or(|s| s.len() > 253)
        || port(&b["port"]).is_none()
        || !matches(&SERVICE, &b["service"])
        || owner.trim_matches(kelryvo_core::js_whitespace).is_empty()
        || owner.chars().count() > 128
        || owner.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return Err(invalid());
    }
    let key = format!("api-{}", Uuid::new_v4());
    let database:Value=sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,$2,$3) RETURNING to_jsonb(sf_reference_databases)")
        .bind(ORG_UUID).bind(&key).bind(b["name"].as_str()).fetch_one(&mut *tx).await?;
    let container:Value=sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(sf_reference_containers)")
        .bind(ORG_UUID).bind(id(&database["id"])?).bind(&key).bind(b["containerName"].as_str()).bind(b["kind"].as_str()).bind(b["environment"].as_str()).fetch_one(&mut *tx).await?;
    let host = b["host"].as_str().ok_or_else(invalid)?.to_ascii_lowercase();
    if sqlx::query("SELECT 1 FROM sf_reference_services WHERE organization_id=$1 AND host=$2 AND port=$3 AND service=$4 AND transport=$5 FOR UPDATE")
        .bind(ORG_UUID).bind(&host).bind(port(&b["port"])).bind(b["service"].as_str()).bind(b["transport"].as_str()).fetch_optional(&mut *tx).await?.is_some() {
        return Err(conflict("INSTANCE_REFERENCE_CONFLICT"));
    }
    let route:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport) VALUES($1,$2,$3,$4,$5,$6) RETURNING id")
        .bind(ORG_UUID).bind(id(&container["id"])?).bind(&host).bind(port(&b["port"])).bind(b["service"].as_str()).bind(b["transport"].as_str()).fetch_one(&mut *tx).await?;
    let schema:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) VALUES($1,$2,$3) RETURNING id")
        .bind(ORG_UUID).bind(id(&container["id"])?).bind(owner).fetch_one(&mut *tx).await?;
    let uid = crate::config::process_uid().map_err(|_| invalid())?;
    let instance = json!({"databaseId":database["id"],"databaseServerId":database["server_uuid"],"containerId":container["id"],"containerServerId":container["server_uuid"],"serviceId":route,"schemaId":schema,"generation":1,"provenance":"MANUAL_REFERENCE"});
    sqlx::query("INSERT INTO sf_reference_operator_audit(organization_id,schema_id,action,operator_os_uid,facts) VALUES($1,$2,'REGISTER',$3,$4)")
        .bind(ORG_UUID).bind(schema).bind(uid).bind(json!({"databaseId":database["id"],"containerId":container["id"],"serviceId":route,"schemaId":schema,"provenance":"MANUAL_REFERENCE","generation":1})).execute(&mut *tx).await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
        .bind(schema.to_string())
        .execute(&mut *tx)
        .await?;
    let reason = b["reason"]
        .as_str()
        .ok_or_else(invalid)?
        .encode_utf16()
        .take(500)
        .collect::<Vec<_>>();
    // The retained API slices JavaScript UTF-16. A split surrogate cannot become
    // a valid PostgreSQL reason and must roll back the complete declaration.
    let reason = String::from_utf16(&reason).map_err(|_| invalid())?;
    sqlx::query("INSERT INTO sf_reference_assignments(organization_id,schema_id,project_id,reason,operator_os_uid) VALUES($1,$2,$3,$4,$5)").bind(ORG_UUID).bind(schema).bind(project).bind(&reason).bind(uid).execute(&mut *tx).await?;
    sqlx::query("UPDATE sf_reference_schemas SET revision=1 WHERE id=$1")
        .bind(schema)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO sf_reference_operator_audit(organization_id,schema_id,action,operator_os_uid,facts) VALUES($1,$2,'ASSIGN',$3,$4)").bind(ORG_UUID).bind(schema).bind(uid).bind(json!({"fromProjectId":Value::Null,"toProjectId":project,"revision":"1","reason":reason})).execute(&mut *tx).await?;
    instances::audited_optional(
        &mut tx,
        &auth,
        project,
        None,
        "INSTANCE_REGISTERED",
        json!({"schemaId":schema,"containerId":container["id"],"provenance":"MANUAL_REFERENCE"}),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"instance":instance}))))
}

pub async fn create_connection(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Json(b): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let required = [
        "assignmentId",
        "routeId",
        "name",
        "engine",
        "username",
        "credentialRef",
        "reason",
    ];
    if !b.as_object().is_some_and(|o| {
        required.iter().all(|k| o.contains_key(*k))
            && o.keys().all(|k| {
                required.contains(&k.as_str())
                    || ["description", "serviceKind", "purpose"].contains(&k.as_str())
            })
    }) || !kelryvo_core::uuid(&b["assignmentId"])
        || !kelryvo_core::uuid(&b["routeId"])
        || !text(&b["name"], 120)
        || !text(&b["reason"], 2000)
        || !matches(&USER, &b["username"])
        || !matches(&REFERENCE, &b["credentialRef"])
        || !["oracle", "postgresql", "mysql"].contains(&b["engine"].as_str().unwrap_or_default())
        || b.get("purpose").is_some_and(|v| v != "DISCOVERY")
        || b.get("serviceKind").is_some_and(|v| {
            !v.as_str()
                .is_some_and(|s| ["SERVICE_NAME", "SID"].contains(&s))
        })
        || b.get("description").is_some_and(|v| {
            !v.as_str().is_some_and(|s| {
                s.encode_utf16().count() <= 2000
                    && !s
                        .chars()
                        .any(|c| c <= '\u{1f}' || ('\u{7f}'..='\u{9f}').contains(&c))
            })
        })
    {
        return Err(invalid());
    }
    let project = projects::id(&project)?;
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    if let Some(schema) = sqlx::query_scalar::<_, Uuid>(
        "SELECT schema_id FROM sf_reference_assignments WHERE id=$1 AND organization_id=$2",
    )
    .bind(id(&b["assignmentId"])?)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
            .bind(schema.to_string())
            .execute(&mut *tx)
            .await?;
    }
    instances::guard(&mut tx, &auth, project).await?;
    let route:Value=sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id AND s.organization_id=a.organization_id JOIN sf_reference_services r ON r.container_id=s.container_id AND r.organization_id=s.organization_id WHERE a.id=$1 AND a.project_id=$2 AND a.organization_id=$3 AND a.closed_at IS NULL AND r.id=$4")
        .bind(id(&b["assignmentId"])?).bind(project).bind(ORG_UUID).bind(id(&b["routeId"])?).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let row:Value=sqlx::query_scalar("INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason,description,service_kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING to_jsonb(sf_database_connections)")
        .bind(ORG_UUID).bind(id(&route["container_id"])?).bind(id(&route["id"])?).bind(trim(&b["name"])).bind(b["engine"].as_str()).bind(route["host"].as_str()).bind(route["port"].as_i64()).bind(route["service"].as_str()).bind(route["transport"].as_str()).bind(b["username"].as_str()).bind(b["credentialRef"].as_str()).bind(&auth.actor.id).bind(trim(&b["reason"])).bind(b.get("description").and_then(Value::as_str).unwrap_or_default()).bind(b.get("serviceKind").and_then(Value::as_str).unwrap_or("SERVICE_NAME")).fetch_one(&mut *tx).await?;
    let connection = id(&row["id"])?;
    sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES($1,$2,$3)").bind(connection).bind(ORG_UUID).bind(project).execute(&mut *tx).await?;
    instances::audited(
        &mut tx,
        &auth,
        project,
        connection,
        "CONNECTION_REGISTERED",
        json!({"engine":row["engine"],"containerId":row["container_id"]}),
    )
    .await?;
    let public = instances::scoped_projection(&mut tx, &row, project, false).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"connection":public}))))
}

pub async fn retire_connection(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, connection)): Path<(String, String)>,
    Json(b): Json<Value>,
) -> ApiResult<Value> {
    if !exact(&b, &["reason"]) || !text(&b["reason"], 2000) {
        return Err(invalid());
    }
    let (project, connection) = (projects::id(&project)?, projects::id(&connection)?);
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    instances::guard(&mut tx, &auth, project).await?;
    let row = discovery::scoped_connection(&mut tx, &auth, project, connection).await?;
    if !row["retired_at"].is_null() {
        return Err(conflict("CONNECTION_RETIRED"));
    }
    let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id JOIN sf_target_option_revisions r ON r.profile_id=p.profile_id JOIN sf_target_identity_evidence e ON e.digest=r.observation_digest WHERE e.connection_id=$1 AND j.state='ADMITTED')").bind(connection).fetch_one(&mut *tx).await?;
    if active {
        return Err(conflict("CONNECTION_EXECUTION_ACTIVE"));
    }
    sqlx::query("UPDATE sf_database_connections SET retired_at=clock_timestamp(),retirement_reason=$1 WHERE id=$2").bind(trim(&b["reason"])).bind(connection).execute(&mut *tx).await?;
    instances::audited(
        &mut tx,
        &auth,
        project,
        connection,
        "CONNECTION_RETIRED",
        json!({}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"retired":true})))
}
