//! Provider governance and external identities anchored to local actor authority.
mod network;
pub mod runtime;
mod signin;
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, not_found, plans, projects,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use runtime::{s, text};
use serde_json::{Value, json};
pub use signin::{ldap_session, oidc_callback, oidc_start};
use sqlx::PgConnection;
use uuid::Uuid;
pub(super) fn unavailable() -> ApiError {
    ApiError(StatusCode::SERVICE_UNAVAILABLE, "AUTH_UNAVAILABLE")
}
fn config_invalid() -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, "INVALID_IDENTITY_CONFIG")
}
fn revision(v: &Value) -> Option<i64> {
    let s = v.as_str()?;
    if s.len() > 19 || s.starts_with('0') || !s.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    s.parse::<i64>().ok().filter(|v| *v > 0)
}
pub(super) fn id(v: &str) -> Result<Uuid, ApiError> {
    if v.len() != 36 {
        return Err(not_found());
    }
    Uuid::parse_str(v).map_err(|_| not_found())
}
async fn can_manage(tx: &mut PgConnection, actor: &str) -> Result<bool, ApiError> {
    Ok(sqlx::query("SELECT 1 FROM sf_identity_admin_grants g JOIN sf_local_actors a ON a.id=g.actor_id WHERE g.actor_id=$1 AND g.revoked_at IS NULL AND a.organization_id=$2").bind(actor).bind(ORG_UUID).fetch_optional(tx).await?.is_some())
}
async fn admin(tx: &mut PgConnection, auth: &Authenticated, write: bool) -> Result<(), ApiError> {
    if write {
        auth::guard_mutation(tx, auth, None, None).await?;
        active(tx).await?;
    } else {
        auth::guard_credential(tx, auth).await?;
    }
    if !can_manage(tx, &auth.actor.id).await? {
        return Err(ApiError(StatusCode::FORBIDDEN, "IDENTITY_ADMIN_REQUIRED"));
    }
    Ok(())
}
pub(super) async fn active(tx: &mut PgConnection) -> Result<Uuid, ApiError> {
    sqlx::query_scalar("SELECT g.id FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE' FOR SHARE OF c,g").fetch_optional(tx).await?.ok_or_else(unavailable)
}
pub(super) async fn provider(tx: &mut PgConnection, id: Uuid) -> Result<Value, ApiError> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'kind',kind,'enabled',enabled,'revision',revision::text,'config',config) FROM sf_identity_providers WHERE id=$1").bind(id).fetch_optional(tx).await?.ok_or_else(not_found)
}
async fn audit(
    tx: &mut PgConnection,
    actor: &str,
    provider: Uuid,
    action: &str,
    facts: Value,
) -> Result<(), ApiError> {
    sqlx::query(
        "INSERT INTO sf_identity_audit(actor_id,provider_id,action,facts) VALUES($1,$2,$3,$4)",
    )
    .bind(actor)
    .bind(provider)
    .bind(action)
    .bind(facts)
    .execute(tx)
    .await?;
    Ok(())
}
async fn capture(
    tx: &mut PgConnection,
    auth: &Authenticated,
    p: &Value,
    reason: &str,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO sf_identity_provider_revisions(provider_id,revision,name,kind,enabled,config,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)").bind(id(s(&p["id"]))?).bind(revision(&p["revision"]).ok_or_else(config_invalid)?).bind(s(&p["name"])).bind(s(&p["kind"])).bind(p["enabled"].as_bool()).bind(&p["config"]).bind(&auth.actor.id).bind(reason).execute(tx).await?;
    Ok(())
}
async fn revoke(
    tx: &mut PgConnection,
    provider: Uuid,
    mapping: Option<Uuid>,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND (id IN(SELECT credential_id FROM sf_external_session_roots WHERE provider_id=$1 AND ($2::uuid IS NULL OR mapping_id=$2)) OR parent_credential_id IN(SELECT credential_id FROM sf_external_session_roots WHERE provider_id=$1 AND ($2::uuid IS NULL OR mapping_id=$2)))").bind(provider).bind(mapping).execute(tx).await?;
    Ok(())
}
fn database(e: sqlx::Error) -> ApiError {
    match e.as_database_error().and_then(|e| e.code()).as_deref() {
        Some("23505") => conflict("CONFLICT"),
        Some("23503") => ApiError(StatusCode::BAD_REQUEST, "INVALID_REFERENCE"),
        _ => e.into(),
    }
}
fn ready(state: &AppState, p: &Value) -> bool {
    state
        .identity
        .as_ref()
        .is_some_and(|r| r.valid_provider(s(&p["kind"]), &p["config"]))
}
fn lookup_projection(identity: Value) -> Value {
    json!({"subject":identity["subject"],"displayName":identity["displayName"].as_str().unwrap_or_default()})
}
pub async fn methods(State(state): State<AppState>) -> ApiResult<Value> {
    let mut tx = state.pool.begin().await?;
    let active=sqlx::query("SELECT 1 FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE'").fetch_optional(&mut *tx).await?.is_some();
    let mut providers = Vec::new();
    if state.tls && state.identity.is_some() && active {
        let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'kind',kind,'config',config) FROM sf_identity_providers p WHERE enabled AND EXISTS(SELECT 1 FROM sf_external_identities m JOIN sf_local_credentials a ON a.id=m.anchor_credential_id AND a.actor_id=m.actor_id AND a.credential_kind='LOCAL' AND a.revoked_at IS NULL WHERE m.provider_id=p.id AND m.revoked_at IS NULL) ORDER BY name,id LIMIT 21").fetch_all(&mut *tx).await?;
        providers = rows
            .into_iter()
            .filter(|p| ready(&state, p))
            .take(20)
            .map(|p| json!({"id":p["id"],"name":p["name"],"kind":p["kind"]}))
            .collect();
    }
    tx.commit().await?;
    Ok(Json(
        json!({"password":state.tls,"accessToken":true,"firstSetup":state.tls,"sso":providers.iter().any(|p|p["kind"]=="OIDC"),"providers":providers}),
    ))
}
pub async fn access(State(state): State<AppState>, auth: Authenticated) -> ApiResult<Value> {
    let mut tx = state.pool.begin().await?;
    auth::guard_credential(&mut tx, &auth).await?;
    let can_manage = can_manage(&mut tx, &auth.actor.id).await?;
    tx.commit().await?;
    Ok(Json(json!({"canManage":can_manage})))
}
pub async fn list(State(state): State<AppState>, auth: Authenticated) -> ApiResult<Value> {
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, false).await?;
    let providers:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name,'kind',kind,'enabled',enabled,'revision',revision::text,'config',config) FROM sf_identity_providers ORDER BY name,id LIMIT 21").fetch_all(&mut *tx).await?;
    let actors:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',display_name,'role',role) FROM sf_local_actors WHERE organization_id=$1 AND role IN ('developer','approver') ORDER BY display_name,id LIMIT 201").bind(ORG_UUID).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"providers":providers,"actors":actors,"routes":state.identity.as_ref().map(|r|r.public_routes()).unwrap_or_default()}),
    ))
}
pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    Json(b): Json<Value>,
) -> Result<Response, ApiError> {
    if !plans::keys(&b, &["name", "kind", "enabled", "config", "reason"])
        || !text(&b["name"], 100)
        || !["OIDC", "LDAP"].contains(&s(&b["kind"]))
        || b["enabled"] != false
        || !text(&b["reason"], 2000)
        || !state
            .identity
            .as_ref()
            .is_some_and(|r| r.valid_provider(s(&b["kind"]), &b["config"]))
    {
        return Err(config_invalid());
    }
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, true).await?;
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_identity_providers")
        .fetch_one(&mut *tx)
        .await?;
    if count >= 20 {
        return Err(conflict("IDENTITY_PROVIDER_LIMIT"));
    }
    let provider_id:Uuid=sqlx::query_scalar("INSERT INTO sf_identity_providers(name,kind,config,created_by,updated_by) VALUES($1,$2,$3,$4,$4) RETURNING id").bind(s(&b["name"]).trim_matches(kelryvo_core::js_whitespace)).bind(s(&b["kind"])).bind(&b["config"]).bind(&auth.actor.id).fetch_one(&mut *tx).await.map_err(database)?;
    let p = provider(&mut tx, provider_id).await?;
    capture(&mut tx, &auth, &p, s(&b["reason"])).await?;
    audit(
        &mut tx,
        &auth.actor.id,
        provider_id,
        "PROVIDER_CREATED",
        json!({"revision":"1","kind":p["kind"]}),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"provider":p}))).into_response())
}
pub async fn update(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(provider_id): Path<String>,
    Json(b): Json<Value>,
) -> ApiResult<Value> {
    let provider_id = id(&provider_id).map_err(|_| config_invalid())?;
    if !plans::keys(
        &b,
        &[
            "expectedRevision",
            "name",
            "kind",
            "enabled",
            "config",
            "reason",
        ],
    ) || revision(&b["expectedRevision"]).is_none()
        || !text(&b["name"], 100)
        || !b["enabled"].is_boolean()
        || !text(&b["reason"], 2000)
    {
        return Err(config_invalid());
    }
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, true).await?;
    sqlx::query("SELECT id FROM sf_identity_providers WHERE id=$1 FOR UPDATE")
        .bind(provider_id)
        .execute(&mut *tx)
        .await?;
    let p = provider(&mut tx, provider_id).await?;
    if p["revision"] != b["expectedRevision"] {
        return Err(conflict("IDENTITY_REVISION_CONFLICT"));
    }
    if b.get("kind").is_some_and(|k| *k != p["kind"])
        || !state
            .identity
            .as_ref()
            .is_some_and(|r| r.valid_provider(s(&p["kind"]), &b["config"]))
    {
        return Err(config_invalid());
    }
    if b["config"]["routeId"] != p["config"]["routeId"]
        || p["kind"] == "OIDC" && b["config"]["issuer"] != p["config"]["issuer"]
    {
        return Err(conflict("IDENTITY_SOURCE_IMMUTABLE"));
    }
    if b["enabled"]==true&&sqlx::query("SELECT 1 FROM sf_external_identities m JOIN sf_local_credentials c ON c.id=m.anchor_credential_id AND c.actor_id=m.actor_id AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL WHERE m.provider_id=$1 AND m.revoked_at IS NULL LIMIT 1").bind(provider_id).fetch_optional(&mut *tx).await?.is_none(){return Err(conflict("IDENTITY_MAPPING_REQUIRED"));}
    if revision(&p["revision"]) == Some(i64::MAX) {
        return Err(conflict("IDENTITY_REVISION_CONFLICT"));
    }
    sqlx::query("UPDATE sf_identity_providers SET name=$1,enabled=$2,config=$3,revision=revision+1,updated_by=$4,updated_at=clock_timestamp() WHERE id=$5").bind(s(&b["name"]).trim_matches(kelryvo_core::js_whitespace)).bind(b["enabled"].as_bool()).bind(&b["config"]).bind(&auth.actor.id).bind(provider_id).execute(&mut *tx).await.map_err(database)?;
    let p = provider(&mut tx, provider_id).await?;
    capture(&mut tx, &auth, &p, s(&b["reason"])).await?;
    revoke(&mut tx, provider_id, None).await?;
    audit(
        &mut tx,
        &auth.actor.id,
        provider_id,
        "PROVIDER_UPDATED",
        json!({"revision":p["revision"],"enabled":p["enabled"]}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"provider":p})))
}
pub async fn mappings(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(provider_id): Path<String>,
) -> ApiResult<Value> {
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, false).await?;
    let provider_id = id(&provider_id)?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',m.id,'subject',m.subject,'actorId',m.actor_id,'actorName',a.display_name,'role',a.role,'revoked_at',m.revoked_at) FROM sf_external_identities m JOIN sf_local_actors a ON a.id=m.actor_id WHERE m.provider_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 201").bind(provider_id).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"mappings":rows.iter().map(projects::map_row).collect::<Vec<_>>()}),
    ))
}
pub async fn link(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(provider_id): Path<String>,
    Json(b): Json<Value>,
) -> Result<Response, ApiError> {
    let provider_id = id(&provider_id).map_err(|_| invalid())?;
    if !plans::keys(
        &b,
        &["expectedProviderRevision", "subject", "actorId", "reason"],
    ) || revision(&b["expectedProviderRevision"]).is_none()
        || !text(&b["subject"], 512)
        || !text(&b["actorId"], 200)
        || !text(&b["reason"], 2000)
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, true).await?;
    let p = provider(&mut tx, provider_id).await?;
    if p["revision"] != b["expectedProviderRevision"] {
        return Err(conflict("IDENTITY_REVISION_CONFLICT"));
    }
    let anchor:Uuid=sqlx::query_scalar("SELECT c.id FROM sf_local_actors a JOIN sf_local_credentials c ON c.actor_id=a.id AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL WHERE a.id=$1 AND a.organization_id=$2 AND a.role IN ('developer','approver') ORDER BY c.issued_at DESC,c.id LIMIT 1").bind(s(&b["actorId"])).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(||conflict("IDENTITY_ACTOR_UNAVAILABLE"))?;
    let mapping:Uuid=sqlx::query_scalar("INSERT INTO sf_external_identities(provider_id,subject,actor_id,anchor_credential_id,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id").bind(provider_id).bind(s(&b["subject"])).bind(s(&b["actorId"])).bind(anchor).bind(&auth.actor.id).fetch_one(&mut *tx).await.map_err(database)?;
    audit(
        &mut tx,
        &auth.actor.id,
        provider_id,
        "IDENTITY_LINKED",
        json!({"mappingId":mapping,"actorId":b["actorId"],"reason":b["reason"]}),
    )
    .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"mapping":{"id":mapping}}))).into_response())
}
pub async fn unlink(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((provider_id, mapping)): Path<(String, String)>,
    Json(b): Json<Value>,
) -> Result<StatusCode, ApiError> {
    let (provider_id, mapping) = (
        id(&provider_id).map_err(|_| invalid())?,
        id(&mapping).map_err(|_| invalid())?,
    );
    if !plans::keys(&b, &["reason"]) || !text(&b["reason"], 2000) {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, true).await?;
    let changed=sqlx::query("UPDATE sf_external_identities SET revoked_at=COALESCE(revoked_at,clock_timestamp()),revoked_by=COALESCE(revoked_by,$1) WHERE id=$2 AND provider_id=$3").bind(&auth.actor.id).bind(mapping).bind(provider_id).execute(&mut *tx).await?.rows_affected();
    if changed == 0 {
        return Err(not_found());
    }
    revoke(&mut tx, provider_id, Some(mapping)).await?;
    audit(
        &mut tx,
        &auth.actor.id,
        provider_id,
        "IDENTITY_UNLINKED",
        json!({"mappingId":mapping,"reason":b["reason"]}),
    )
    .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn operation(
    state: AppState,
    auth: Authenticated,
    provider_id: String,
    b: Value,
    lookup: bool,
) -> ApiResult<Value> {
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, false).await?;
    let provider_id = id(&provider_id).map_err(|_| invalid())?;
    if !plans::keys(
        &b,
        if lookup {
            &["expectedRevision", "username"]
        } else {
            &["expectedRevision"]
        },
    ) || revision(&b["expectedRevision"]).is_none()
        || lookup && !text(&b["username"], 256)
    {
        return Err(invalid());
    }
    let p = provider(&mut tx, provider_id).await?;
    if p["revision"] != b["expectedRevision"] {
        return Err(conflict("IDENTITY_REVISION_CONFLICT"));
    }
    if !ready(&state, &p) || lookup && p["kind"] != "LDAP" {
        return Err(unavailable());
    }
    admin(&mut tx, &auth, true).await?;
    let generation = active(&mut tx).await?;
    tx.commit().await?;
    let runtime = state.identity.clone().ok_or_else(unavailable)?;
    let _slot = state
        .identity_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "AUTH_BUSY"))?;
    let result = if lookup {
        network::ldap(runtime, &p["config"], Some(s(&b["username"])), None)
            .await
            .map_err(|_| unavailable())?
    } else {
        Some(json!({"passed":network::test(runtime,s(&p["kind"]),&p["config"]).await}))
    };
    let mut tx = state.pool.begin().await?;
    admin(&mut tx, &auth, true).await?;
    if active(&mut tx).await? != generation {
        return Err(unavailable());
    }
    if provider(&mut tx, provider_id).await?["revision"] != p["revision"] {
        return Err(conflict("IDENTITY_REVISION_CONFLICT"));
    }
    let passed = result.as_ref().is_some_and(|r| r["passed"] == true);
    let code = if passed {
        "PROVIDER_REACHABLE"
    } else {
        "IDENTITY_PROVIDER_UNAVAILABLE"
    };
    audit(&mut tx,&auth.actor.id,provider_id,if lookup{"IDENTITY_LOOKUP"}else{"PROVIDER_TESTED"},json!({"revision":p["revision"],"result":if lookup{if result.is_some(){"FOUND"}else{"NOT_FOUND"}}else{code}})).await?;
    tx.commit().await?;
    if lookup {
        Ok(Json(lookup_projection(result.ok_or(ApiError(
            StatusCode::NOT_FOUND,
            "IDENTITY_NOT_FOUND",
        ))?)))
    } else {
        Ok(Json(
            json!({"status":if passed{"PASS"}else{"FAIL"},"code":code}),
        ))
    }
}
pub async fn test(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(id): Path<String>,
    Json(b): Json<Value>,
) -> ApiResult<Value> {
    operation(state, auth, id, b, false).await
}
pub async fn lookup(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(id): Path<String>,
    Json(b): Json<Value>,
) -> ApiResult<Value> {
    operation(state, auth, id, b, true).await
}
