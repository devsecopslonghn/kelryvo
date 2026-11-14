//! One-use OIDC flows and LDAP sessions inherit live provider/mapping authority.
use super::{
    active, id, network, provider, ready, revision,
    runtime::{Runtime, s, text},
    unavailable,
};
use crate::ObjectJson;
use crate::{ApiError, AppState, ORG_UUID, auth, invalid};
use axum::{
    Json,
    extract::{OriginalUri, Path, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::sync::Arc;
use uuid::Uuid;
const FLOW: &str = "__Host-kelryvo-oidc";
const CLEAR: &str = "__Host-kelryvo-oidc=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0";
fn transport(state: &AppState, headers: &HeaderMap) -> Result<Arc<Runtime>, ApiError> {
    let runtime = state
        .identity
        .clone()
        .filter(|_| state.tls)
        .ok_or_else(unavailable)?;
    let u = url::Url::parse(&runtime.origin).map_err(|_| unavailable())?;
    if headers.get(header::HOST).and_then(|v| v.to_str().ok())
        != Some(&u[url::Position::BeforeHost..url::Position::AfterPort])
    {
        return Err(unavailable());
    }
    Ok(runtime)
}
async fn public_provider(
    state: &AppState,
    headers: &HeaderMap,
    provider_id: &str,
    kind: &str,
) -> Result<(Arc<Runtime>, Value, Uuid), ApiError> {
    let runtime = transport(state, headers)?;
    let mut tx = state.pool.begin().await?;
    let p = provider(&mut tx, id(provider_id).map_err(|_| unavailable())?)
        .await
        .map_err(|e| if e.1 == "NOT_FOUND" { unavailable() } else { e })?;
    if p["kind"] != kind || p["enabled"] != true || !ready(state, &p) {
        return Err(unavailable());
    }
    auth::lifecycle_lock(&mut tx).await?;
    let generation = active(&mut tx).await?;
    tx.commit().await?;
    Ok((runtime, p, generation))
}
async fn issue(
    tx: &mut PgConnection,
    headers: &HeaderMap,
    p: &Value,
    subject: &str,
    generation: Uuid,
) -> Result<Response, ApiError> {
    auth::lifecycle_lock(tx).await?;
    if active(tx).await? != generation {
        return Err(unavailable());
    }
    let provider_id = id(s(&p["id"]))?;
    if sqlx::query("SELECT 1 FROM sf_identity_providers WHERE id=$1 AND revision=$2 AND enabled")
        .bind(provider_id)
        .bind(revision(&p["revision"]).ok_or_else(unavailable)?)
        .fetch_optional(&mut *tx)
        .await?
        .is_none()
    {
        return Err(auth::unauthenticated());
    }
    let mapping:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',m.id,'actor',m.actor_id) FROM sf_external_identities m JOIN sf_local_actors a ON a.id=m.actor_id JOIN sf_local_credentials c ON c.id=m.anchor_credential_id AND c.actor_id=m.actor_id AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL WHERE m.provider_id=$1 AND m.subject=$2 AND m.revoked_at IS NULL AND a.organization_id=$3 AND a.role IN ('developer','approver')").bind(provider_id).bind(subject).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(auth::unauthenticated)?;
    let root=sqlx::query("WITH issued AS(SELECT clock_timestamp() ts),root AS(INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind) SELECT $1,$2,ts,ts+interval '24 hours','EXTERNAL' FROM issued RETURNING id,expires_at,actor_id) SELECT root.id,root.expires_at,root.actor_id,a.display_name AS name,a.role FROM root JOIN sf_local_actors a ON a.id=root.actor_id").bind(s(&mapping["actor"])).bind(kelryvo_core::sha256(auth::random_token())).fetch_one(&mut *tx).await?;
    let root_id: Uuid = sqlx::Row::try_get(&root, "id")?;
    sqlx::query("INSERT INTO sf_external_session_roots(credential_id,actor_id,provider_id,provider_revision,mapping_id,generation_id) VALUES($1,$2,$3,$4,$5,$6)").bind(root_id).bind(s(&mapping["actor"])).bind(provider_id).bind(revision(&p["revision"])).bind(id(s(&mapping["id"]))?).bind(generation).execute(&mut *tx).await?;
    auth::issue(tx, headers, &root).await
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LdapLogin {
    username: String,
    password: crate::instances::Secret,
}
pub async fn ldap_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(provider_id): Path<String>,
    ObjectJson(b): ObjectJson<LdapLogin>,
) -> Result<Response, ApiError> {
    if !auth::same_origin(&headers, state.tls) {
        return Err(ApiError(StatusCode::FORBIDDEN, "ORIGIN_REJECTED"));
    }
    if !text(&json!(b.username), 256)
        || b.password.value().is_empty()
        || b.password.value().len() > 4096
        || b.password.value().contains('\0')
    {
        return Err(invalid());
    }
    let (runtime, p, generation) = public_provider(&state, &headers, &provider_id, "LDAP").await?;
    let _slot = state
        .identity_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "AUTH_BUSY"))?;
    let result = network::ldap(
        runtime,
        &p["config"],
        Some(&b.username),
        Some(b.password.value()),
    )
    .await
    .ok()
    .flatten()
    .filter(|v| text(&v["subject"], 512))
    .ok_or_else(auth::unauthenticated)?;
    let mut tx = state.pool.begin().await?;
    let response = issue(&mut tx, &headers, &p, s(&result["subject"]), generation).await?;
    tx.commit().await?;
    Ok(response)
}
pub async fn oidc_start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(provider_id): Path<String>,
    Json(body): Json<Value>,
) -> Result<Response, ApiError> {
    if !auth::same_origin(&headers, state.tls) {
        return Err(ApiError(StatusCode::FORBIDDEN, "ORIGIN_REJECTED"));
    }
    if !kelryvo_core::plan::keys(&body, &[]) {
        return Err(invalid());
    }
    let (runtime, p, generation) = public_provider(&state, &headers, &provider_id, "OIDC").await?;
    let flow = json!({"providerId":p["id"],"revision":p["revision"],"generation":generation,"state":auth::random_token(),"nonce":auth::random_token(),"verifier":auth::random_token(),"expiresAt":chrono::Utc::now().timestamp_millis()+300000});
    let _slot = state
        .identity_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "AUTH_BUSY"))?;
    let authorization = network::authorization(&runtime, &p["config"], &flow)
        .await
        .map_err(|_| unavailable())?;
    let mut tx = state.pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    if active(&mut tx).await? != generation {
        return Err(unavailable());
    }
    let latest = provider(&mut tx, id(s(&p["id"]))?).await?;
    if latest["revision"] != p["revision"] || latest["enabled"] != true {
        return Err(unavailable());
    }
    sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_oidc_attempts(state_sha256,provider_id,provider_revision,generation_id,created_at,expires_at) SELECT $1,$2,$3,$4,ts,ts+interval '5 minutes' FROM issued").bind(kelryvo_core::sha256(s(&flow["state"]))).bind(id(s(&p["id"]))?).bind(revision(&p["revision"])).bind(generation).execute(&mut *tx).await?;
    tx.commit().await?;
    // The start handler returns the flow cookie separately from the JSON body.
    let cookie = format!(
        "{FLOW}={}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=300",
        runtime.seal(&flow).ok_or_else(unavailable)?
    );
    let mut response = Json(json!({"authorizationUrl":authorization})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        axum::http::HeaderValue::from_str(&cookie).map_err(|_| unavailable())?,
    );
    Ok(response)
}
async fn callback_inner(
    state: &AppState,
    headers: &HeaderMap,
    uri: &axum::http::Uri,
) -> Result<Response, ApiError> {
    let runtime = transport(state, headers)?;
    let relative = uri
        .path_and_query()
        .map(|v| v.as_str())
        .ok_or_else(unavailable)?;
    if relative.len() > 8192 {
        return Err(unavailable());
    }
    let cookies: Vec<_> = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .map(str::trim)
        .filter_map(|s| s.strip_prefix("__Host-kelryvo-oidc="))
        .collect();
    if cookies.len() != 1 {
        return Err(unavailable());
    }
    let flow = runtime.unseal(cookies[0]).ok_or_else(unavailable)?;
    let provider_id = id(s(&flow["providerId"]))?;
    let generation = id(s(&flow["generation"]))?;
    let now = chrono::Utc::now().timestamp_millis();
    if revision(&flow["revision"]).is_none()
        || !text(&flow["state"], 128)
        || !flow["expiresAt"]
            .as_i64()
            .is_some_and(|t| t >= now && t <= now + 300000)
    {
        return Err(unavailable());
    }
    let url =
        url::Url::parse(&format!("{}{}", runtime.origin, relative)).map_err(|_| unavailable())?;
    let param = |key: &str| {
        let values: Vec<_> = url
            .query_pairs()
            .filter(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
            .collect();
        (values.len() == 1).then(|| values[0].clone())
    };
    if param("state").as_deref() != Some(s(&flow["state"]))
        || url.query_pairs().any(|(k, _)| k == "error")
    {
        return Err(unavailable());
    }
    let code = param("code")
        .filter(|s| !s.is_empty())
        .ok_or_else(unavailable)?;
    let mut tx = state.pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    if active(&mut tx).await? != generation {
        return Err(unavailable());
    }
    let p = provider(&mut tx, provider_id).await?;
    if p["kind"] != "OIDC"
        || p["revision"] != flow["revision"]
        || p["enabled"] != true
        || !ready(state, &p)
    {
        return Err(unavailable());
    }
    let consumed=sqlx::query("UPDATE sf_oidc_attempts SET consumed_at=clock_timestamp() WHERE state_sha256=$1 AND provider_id=$2 AND provider_revision=$3 AND generation_id=$4 AND consumed_at IS NULL AND expires_at>clock_timestamp()").bind(kelryvo_core::sha256(s(&flow["state"]))).bind(provider_id).bind(revision(&p["revision"])).bind(generation).execute(&mut *tx).await?.rows_affected();
    if consumed != 1 {
        return Err(unavailable());
    }
    tx.commit().await?;
    let _slot = state
        .identity_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "AUTH_BUSY"))?;
    let subject = network::callback(&runtime, &p["config"], &code, &flow)
        .await
        .map_err(|_| unavailable())?;
    let mut tx = state.pool.begin().await?;
    let response = issue(&mut tx, headers, &p, &subject, generation).await?;
    tx.commit().await?;
    Ok(response)
}
pub async fn oidc_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    OriginalUri(uri): OriginalUri,
) -> Response {
    let result = callback_inner(&state, &headers, &uri).await;
    let mut response = if let Ok(mut response) = result {
        *response.status_mut() = StatusCode::SEE_OTHER;
        *response.body_mut() = axum::body::Body::empty();
        response.headers_mut().remove(header::CONTENT_TYPE);
        response.headers_mut().remove(header::CONTENT_LENGTH);
        response.headers_mut().insert(
            header::LOCATION,
            axum::http::HeaderValue::from_static("/#page=workspace"),
        );
        response
    } else {
        let mut response = StatusCode::SEE_OTHER.into_response();
        response.headers_mut().insert(
            header::LOCATION,
            axum::http::HeaderValue::from_static("/#page=workspace&identityError=SIGN_IN_FAILED"),
        );
        response
    };
    response.headers_mut().append(
        header::SET_COOKIE,
        axum::http::HeaderValue::from_static(CLEAR),
    );
    response
}
