use crate::{ApiError, ApiResult, AppState, ORG_UUID, conflict, invalid, not_found};
use axum::{
    Json,
    extract::{FromRequest, FromRequestParts, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header, request::Parts},
    response::{IntoResponse, Response},
};
use kelryvo_core::sha256;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, Row};
use subtle::ConstantTimeEq;
use uuid::Uuid;
mod password_change;
pub use password_change::change as change_password;

const COOKIE: &str = "__Host-schemaforge";
pub(crate) const PARENT_AUTHORITY: &str = "(p.credential_kind='LOCAL' OR (p.credential_kind='PASSWORD' AND EXISTS(SELECT 1 FROM sf_password_accounts password JOIN sf_local_credentials anchor ON anchor.id=password.anchor_credential_id AND anchor.actor_id=password.actor_id WHERE password.actor_id=p.actor_id AND password.disabled_at IS NULL AND anchor.credential_kind='LOCAL' AND anchor.revoked_at IS NULL)) OR (p.credential_kind='EXTERNAL' AND EXISTS(SELECT 1 FROM sf_external_session_roots e JOIN sf_identity_providers provider ON provider.id=e.provider_id AND provider.revision=e.provider_revision AND provider.enabled JOIN sf_external_identities mapping ON mapping.id=e.mapping_id AND mapping.provider_id=e.provider_id AND mapping.actor_id=e.actor_id AND mapping.revoked_at IS NULL JOIN sf_local_credentials anchor ON anchor.id=mapping.anchor_credential_id AND anchor.actor_id=mapping.actor_id AND anchor.credential_kind='LOCAL' AND anchor.revoked_at IS NULL JOIN sf_metadata_current cur ON cur.singleton AND cur.generation_id=e.generation_id JOIN sf_metadata_generations generation ON generation.id=cur.generation_id AND generation.state='ACTIVE' WHERE e.credential_id=p.id AND e.actor_id=p.actor_id)))";
const LIVE_BROWSER: &str = "SELECT c.id,c.actor_id,a.display_name AS name,a.role,c.expires_at,c.absolute_expires_at FROM sf_local_credentials c JOIN sf_local_credentials p ON p.id=c.parent_credential_id AND p.actor_id=c.actor_id JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.token_sha256=$1 AND c.credential_kind='BROWSER' AND p.credential_kind IN ('LOCAL','PASSWORD','EXTERNAL') AND c.revoked_at IS NULL AND p.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND c.absolute_expires_at>clock_timestamp() AND p.expires_at>clock_timestamp() AND a.organization_id=$2 AND a.role IN ('developer','approver') AND ";

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Actor {
    pub id: String,
    pub name: String,
    pub role: String,
}

#[derive(Clone)]
pub struct Authenticated {
    pub actor: Actor,
    pub credential_digest: String,
    pub browser_id: Option<Uuid>,
    pub csrf: Option<String>,
    pub absolute_expires_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub fn unauthenticated() -> ApiError {
    ApiError(StatusCode::UNAUTHORIZED, "UNAUTHENTICATED")
}
fn forbidden(code: &'static str) -> ApiError {
    ApiError(StatusCode::FORBIDDEN, code)
}

pub fn valid_login_name(value: &str) -> bool {
    (3..=64).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"._-".contains(&b))
}
pub fn valid_password(value: &str) -> bool {
    (15..=128).contains(&value.chars().count())
        && value.len() <= 512
        && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
pub(crate) fn random_token() -> String {
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn unhex(text: &str) -> Result<Vec<u8>, ApiError> {
    if !text.len().is_multiple_of(2)
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(forbidden("AUTH_UNAVAILABLE"));
    }
    text.as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| {
            u8::from_str_radix(
                std::str::from_utf8(b).map_err(|_| forbidden("AUTH_UNAVAILABLE"))?,
                16,
            )
            .map_err(|_| forbidden("AUTH_UNAVAILABLE"))
        })
        .collect()
}

async fn derive(state: &AppState, password: String, salt: Vec<u8>) -> Result<Vec<u8>, ApiError> {
    let password = zeroize::Zeroizing::new(password);
    let permit = state
        .password_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "AUTH_BUSY"))?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let params =
            scrypt::Params::new(15, 8, 3, 64).map_err(|_| forbidden("AUTH_UNAVAILABLE"))?;
        let mut output = vec![0u8; 64];
        scrypt::scrypt(password.as_bytes(), &salt, &params, &mut output)
            .map_err(|_| forbidden("AUTH_UNAVAILABLE"))?;
        Ok(output)
    })
    .await
    .map_err(|_| forbidden("AUTH_UNAVAILABLE"))?
}

pub async fn hash_password(state: &AppState, password: &str) -> Result<String, ApiError> {
    if !valid_password(password) {
        return Err(invalid());
    }
    let mut salt = [0u8; 16];
    rand::rngs::OsRng.fill_bytes(&mut salt);
    Ok(format!(
        "scrypt-v1${}${}",
        hex(&salt),
        hex(&derive(state, password.into(), salt.to_vec()).await?)
    ))
}
async fn verify_password(
    state: &AppState,
    password: &str,
    stored: Option<&str>,
) -> Result<bool, ApiError> {
    let dummy = format!("scrypt-v1${}${}", "0".repeat(32), "0".repeat(128));
    let parts: Vec<_> = stored.unwrap_or(&dummy).split('$').collect();
    if parts.len() != 3 || parts[0] != "scrypt-v1" || parts[1].len() != 32 || parts[2].len() != 128
    {
        return Err(forbidden("AUTH_UNAVAILABLE"));
    }
    let actual = derive(state, password.into(), unhex(parts[1])?).await?;
    Ok(bool::from(actual.ct_eq(&unhex(parts[2])?)))
}

pub fn same_origin(headers: &HeaderMap, tls: bool) -> bool {
    if !tls {
        return false;
    }
    let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(host) = headers.get(header::HOST).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    url::Url::parse(origin).is_ok_and(|u| {
        u.origin().ascii_serialization() == origin
            && u.scheme() == "https"
            && origin == format!("https://{host}")
    })
}
fn cookie_token(headers: &HeaderMap) -> Option<String> {
    let mut matches = headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|h| h.to_str().ok())
        .flat_map(|s| s.split(';'))
        .map(str::trim)
        .filter_map(|s| s.strip_prefix(&format!("{COOKIE}=")));
    let token = matches.next()?;
    if matches.next().is_some()
        || token.len() != 64
        || !token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return None;
    }
    Some(token.into())
}
fn csrf(token: &str) -> String {
    sha256(format!("schemaforge-browser-csrf-v1\0{token}"))
}
fn actor(row: &sqlx::postgres::PgRow) -> Result<Actor, sqlx::Error> {
    Ok(Actor {
        id: row.try_get("actor_id")?,
        name: row.try_get("name")?,
        role: row.try_get("role")?,
    })
}
pub async fn lifecycle_lock(tx: &mut PgConnection) -> Result<(), ApiError> {
    sqlx::query("SELECT pg_advisory_xact_lock(1397112658,2)")
        .execute(tx)
        .await?;
    Ok(())
}
pub async fn active_metadata(tx: &mut PgConnection) -> Result<(), ApiError> {
    if sqlx::query("SELECT 1 FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.state='ACTIVE' FOR SHARE OF c,g").fetch_optional(tx).await?.is_none() { return Err(conflict("METADATA_RESTORE_HOLD")); }
    Ok(())
}

impl FromRequestParts<AppState> for Authenticated {
    type Rejection = ApiError;
    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if parts.headers.contains_key(header::ORIGIN) {
            let origin = parts
                .headers
                .get(header::ORIGIN)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| forbidden("ORIGIN_REJECTED"))?;
            let host = parts
                .headers
                .get(header::HOST)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| forbidden("ORIGIN_REJECTED"))?;
            let scheme = if state.tls { "https" } else { "http" };
            if origin != format!("{scheme}://{host}") {
                return Err(forbidden("ORIGIN_REJECTED"));
            }
        }
        if let Some(auth) = parts.headers.get(header::AUTHORIZATION) {
            let token = auth
                .to_str()
                .ok()
                .and_then(|a| a.strip_prefix("Bearer "))
                .filter(|t| (32..=4096).contains(&t.len()))
                .ok_or_else(unauthenticated)?;
            let digest = sha256(token);
            let row = sqlx::query("SELECT a.id AS actor_id,a.display_name AS name,a.role FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.token_sha256=$1 AND a.organization_id=$2 AND a.role IN ('developer','approver') AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()")
                .bind(&digest).bind(ORG_UUID).fetch_optional(&state.pool).await?.ok_or_else(unauthenticated)?;
            return Ok(Self {
                actor: actor(&row)?,
                credential_digest: digest,
                browser_id: None,
                csrf: None,
                absolute_expires_at: None,
            });
        }
        if !state.tls {
            return Err(unauthenticated());
        }
        let token = cookie_token(&parts.headers).ok_or_else(unauthenticated)?;
        let expected = csrf(&token);
        let supplied = parts
            .headers
            .get("x-csrf-token")
            .and_then(|s| s.to_str().ok());
        let safe = [Method::GET, Method::HEAD, Method::OPTIONS].contains(&parts.method);
        let equal = supplied.is_some_and(|s| bool::from(s.as_bytes().ct_eq(expected.as_bytes())));
        if !safe && (!same_origin(&parts.headers, state.tls) || !equal) {
            return Err(forbidden("CSRF_REJECTED"));
        }
        if safe && (supplied.is_some() || parts.uri.path() != "/api/session") && !equal {
            return Err(unauthenticated());
        }
        let digest = sha256(&token);
        let mut tx = state.pool.begin().await?;
        lifecycle_lock(&mut tx).await?;
        let row = sqlx::query(&format!(
            "{LIVE_BROWSER}{PARENT_AUTHORITY} FOR SHARE OF c,p,a"
        ))
        .bind(&digest)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(unauthenticated)?;
        let id: Uuid = row.try_get("id")?;
        if !safe
            || parts
                .headers
                .get("x-session-activity")
                .is_some_and(|v| v == "1")
        {
            sqlx::query("UPDATE sf_local_credentials SET expires_at=LEAST(absolute_expires_at,clock_timestamp()+interval '30 minutes') WHERE id=$1").bind(id).execute(&mut *tx).await?;
        }
        let result = Self {
            actor: actor(&row)?,
            credential_digest: digest,
            browser_id: Some(id),
            csrf: Some(expected),
            absolute_expires_at: Some(row.try_get("absolute_expires_at")?),
        };
        tx.commit().await?;
        Ok(result)
    }
}

pub async fn guard_credential(
    tx: &mut PgConnection,
    auth: &Authenticated,
) -> Result<String, ApiError> {
    lifecycle_lock(tx).await?;
    if auth.browser_id.is_some()
        && sqlx::query(&format!(
            "{LIVE_BROWSER}{PARENT_AUTHORITY} FOR SHARE OF c,p,a"
        ))
        .bind(&auth.credential_digest)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?
        .is_none()
    {
        return Err(unauthenticated());
    }
    let role: String = sqlx::query_scalar("SELECT a.role FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.token_sha256=$1 AND c.actor_id=$2 AND c.credential_kind=$3 AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND a.organization_id=$4 AND a.role IN ('developer','approver')")
        .bind(&auth.credential_digest).bind(&auth.actor.id).bind(if auth.browser_id.is_some() {"BROWSER"} else {"LOCAL"}).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(unauthenticated)?;
    Ok(role)
}

pub async fn guard_mutation(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Option<Uuid>,
    required_role: Option<&str>,
) -> Result<(), ApiError> {
    let role = guard_credential(tx, auth).await?;
    if required_role.is_some_and(|required| required != role) {
        return Err(forbidden("DEVELOPER_REQUIRED"));
    }
    if let Some(project) = project {
        if access_mode_connection(tx).await? != "ENFORCED" {
            return Err(conflict("MEMBERSHIP_BOOTSTRAP_REQUIRED"));
        }
        if sqlx::query("SELECT 1 FROM sf_project_grants WHERE organization_id=$1 AND project_id=$2 AND actor_id=$3 AND revoked_at IS NULL").bind(ORG_UUID).bind(project).bind(&auth.actor.id).fetch_optional(&mut *tx).await?.is_none() { return Err(not_found()); }
    }
    active_metadata(tx).await
}

/// Recheck the credential retained on an execution request. This metadata-only
/// reader grants no dispatch capability and never refreshes browser expiry.
/// Callers hold the lifecycle advisory lock before acquiring these row locks.
pub async fn execution_request_authority(
    tx: &mut PgConnection,
    project: Uuid,
    actor: &str,
    credential: Uuid,
) -> Result<Option<String>, ApiError> {
    let query = format!(
        "SELECT a.role,c.credential_kind,c.parent_credential_id FROM sf_local_credentials c
         JOIN sf_local_actors a ON a.id=c.actor_id
         JOIN sf_project_access_mode mode ON mode.organization_id=a.organization_id AND mode.mode='ENFORCED'
         JOIN sf_project_grants member ON member.organization_id=a.organization_id AND member.actor_id=a.id AND member.project_id=$1 AND member.revoked_at IS NULL
         JOIN sf_project_deploy_grants deployer ON deployer.organization_id=a.organization_id AND deployer.actor_id=a.id AND deployer.project_id=$1 AND deployer.revoked_at IS NULL
         WHERE c.id=$2 AND c.actor_id=$3 AND a.organization_id=$4
           AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
           AND (c.credential_kind='LOCAL' OR (c.credential_kind='BROWSER' AND c.absolute_expires_at>clock_timestamp()
             AND EXISTS(SELECT 1 FROM sf_local_credentials p WHERE p.id=c.parent_credential_id
               AND p.actor_id=c.actor_id AND p.credential_kind IN ('LOCAL','PASSWORD','EXTERNAL')
               AND p.revoked_at IS NULL AND p.expires_at>clock_timestamp() AND {PARENT_AUTHORITY})))
         FOR SHARE OF a,c,member,deployer,mode"
    );
    let row: Option<(String, String, Option<Uuid>)> = sqlx::query_as(&query)
        .bind(project)
        .bind(credential)
        .bind(actor)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?;
    let Some((role, kind, parent)) = row else {
        return Ok(None);
    };
    if kind == "BROWSER" {
        let locked = sqlx::query(&format!(
            "SELECT 1 FROM sf_local_credentials p WHERE p.id=$1 AND p.actor_id=$2
             AND p.credential_kind IN ('LOCAL','PASSWORD','EXTERNAL') AND p.revoked_at IS NULL
             AND p.expires_at>clock_timestamp() AND {PARENT_AUTHORITY} FOR SHARE OF p"
        ))
        .bind(parent)
        .bind(actor)
        .fetch_optional(tx)
        .await?;
        if locked.is_none() {
            return Ok(None);
        }
    }
    Ok(Some(role))
}

pub async fn access_mode_connection(tx: &mut PgConnection) -> Result<String, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT mode FROM sf_project_access_mode WHERE organization_id=$1")
            .bind(ORG_UUID)
            .fetch_optional(tx)
            .await?
            .unwrap_or_else(|| "BOOTSTRAP_REQUIRED".into()),
    )
}

pub async fn session(State(state): State<AppState>, auth: Authenticated) -> ApiResult<Value> {
    let mut connection = state.pool.acquire().await?;
    let mut body =
        json!({"actor":auth.actor,"accessMode":access_mode_connection(&mut connection).await?});
    if let Some(csrf) = auth.csrf {
        body["csrfToken"] = csrf.into();
        body["absoluteExpiresAt"] = json!(auth.absolute_expires_at);
        body["idleTimeoutSeconds"] = 1800.into();
    }
    Ok(Json(body))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Login {
    pub username: String,
    pub password: String,
}

pub(crate) async fn issue(
    tx: &mut PgConnection,
    headers: &HeaderMap,
    parent: &sqlx::postgres::PgRow,
) -> Result<Response, ApiError> {
    let token = random_token();
    if let Some(old) = cookie_token(headers) {
        sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE token_sha256=$1 AND credential_kind='BROWSER' AND revoked_at IS NULL").bind(sha256(old)).execute(&mut *tx).await?;
    }
    let actor_id: String = parent.try_get("actor_id")?;
    let expires: chrono::DateTime<chrono::Utc> = parent.try_get("expires_at")?;
    let id: Uuid = parent.try_get("id")?;
    let absolute: chrono::DateTime<chrono::Utc> = sqlx::query_scalar("WITH issued AS (SELECT clock_timestamp() AS ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at) SELECT $1,$2,ts,LEAST($3,ts+interval '30 minutes'),'BROWSER',$4,LEAST($3,ts+interval '8 hours') FROM issued RETURNING absolute_expires_at")
        .bind(&actor_id).bind(sha256(&token)).bind(expires).bind(id).fetch_one(&mut *tx).await?;
    let mut response = Json(json!({"actor":actor(parent)?,"absoluteExpiresAt":absolute,"csrfToken":csrf(&token),"idleTimeoutSeconds":1800})).into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&format!(
            "{COOKIE}={token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800"
        ))
        .map_err(|_| invalid())?,
    );
    Ok(response)
}

pub async fn login(State(state): State<AppState>, request: Request) -> Response {
    let ip = crate::rate_limit::peer(&request);
    let headers = request.headers().clone();
    let parsed_budget = request
        .extensions()
        .get::<crate::input_json::ParsedBodyTruthiness>()
        .copied();
    let body = Option::<Json<Value>>::from_request(request, &state)
        .await
        .map(|body| body.map(|Json(value)| value));
    let password = parsed_budget.map(|value| value.0).unwrap_or_else(|| {
        body.as_ref()
            .ok()
            .and_then(Option::as_ref)
            .is_some_and(crate::input_json::truthy)
    });
    let budget = match crate::rate_limit::consume(
        &state,
        ip,
        crate::rate_limit::Scope::Session,
        password,
        if password { 20 } else { 600 },
    ) {
        Ok(budget) => budget,
        Err(error) => return error.into_response(),
    };
    if let Some(response) = budget.blocked() {
        return response;
    }
    let result = match body {
        Ok(body) => login_parsed(&state, &headers, body.filter(|v| !v.is_null())).await,
        // Parsing syntax/media/size is handled before this preHandler quota.
        // A supported plain-text or unrepresentable JSON value is a semantic
        // shape refusal, after the retained transport and origin guards.
        Err(_) if !state.tls => Err(forbidden("HTTPS_REQUIRED")),
        Err(_) if !same_origin(&headers, state.tls) => Err(forbidden("ORIGIN_REJECTED")),
        Err(_) => Err(invalid()),
    };
    budget.apply(result.into_response())
}
async fn login_parsed(
    state: &AppState,
    headers: &HeaderMap,
    body: Option<Value>,
) -> Result<Response, ApiError> {
    if !state.tls {
        return Err(forbidden("HTTPS_REQUIRED"));
    }
    if !same_origin(headers, state.tls) {
        return Err(forbidden("ORIGIN_REJECTED"));
    }
    let verified = if let Some(body) = body {
        if !body.is_object() {
            return Err(invalid());
        }
        let body: Login = serde_json::from_value(body).map_err(|_| invalid())?;
        if !valid_login_name(&body.username)
            || body.password.len() > 512
            || headers.contains_key(header::AUTHORIZATION)
        {
            return Err(invalid());
        }
        let account = sqlx::query("SELECT p.actor_id,p.password_hash FROM sf_password_accounts p JOIN sf_local_actors a ON a.id=p.actor_id WHERE p.username=$1 AND a.organization_id=$2 AND p.disabled_at IS NULL").bind(&body.username).bind(ORG_UUID).fetch_optional(&state.pool).await?;
        let stored = account
            .as_ref()
            .map(|a| a.try_get::<String, _>("password_hash"))
            .transpose()?;
        if !verify_password(state, &body.password, stored.as_deref()).await? {
            return Err(unauthenticated());
        }
        Some((
            account
                .ok_or_else(unauthenticated)?
                .try_get::<String, _>("actor_id")?,
            stored.ok_or_else(unauthenticated)?,
        ))
    } else {
        None
    };
    let token = if verified.is_none() {
        Some(
            headers
                .get(header::AUTHORIZATION)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.strip_prefix("Bearer "))
                .filter(|s| (32..=4096).contains(&s.len()))
                .ok_or_else(unauthenticated)?,
        )
    } else {
        None
    };
    let mut tx = state.pool.begin().await?;
    lifecycle_lock(&mut tx).await?;
    let parent = if let Some((actor_id, stored)) = verified {
        active_metadata(&mut tx).await?;
        let current = sqlx::query("SELECT a.id AS actor_id,a.display_name AS name,a.role FROM sf_password_accounts p JOIN sf_local_actors a ON a.id=p.actor_id JOIN sf_local_credentials c ON c.id=p.anchor_credential_id AND c.actor_id=a.id WHERE p.actor_id=$1 AND p.password_hash=$2 AND p.disabled_at IS NULL AND a.organization_id=$3 AND a.role IN ('developer','approver') AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL FOR SHARE OF p,a,c")
            .bind(&actor_id).bind(stored).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(unauthenticated)?;
        let credential = sqlx::query("WITH issued AS (SELECT clock_timestamp() AS ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind) SELECT $1,$2,ts,ts+interval '24 hours','PASSWORD' FROM issued RETURNING id,expires_at").bind(&actor_id).bind(sha256(random_token())).fetch_one(&mut *tx).await?;
        // Requery a typed row with the same shape as local parent issuance.
        sqlx::query("SELECT $1::uuid AS id,$2::timestamptz AS expires_at,$3::text AS actor_id,$4::text AS name,$5::text AS role")
            .bind(credential.try_get::<Uuid,_>("id")?).bind(credential.try_get::<chrono::DateTime<chrono::Utc>,_>("expires_at")?).bind(&actor_id).bind(current.try_get::<String,_>("name")?).bind(current.try_get::<String,_>("role")?).fetch_one(&mut *tx).await?
    } else {
        let token = token.ok_or_else(unauthenticated)?;
        sqlx::query("SELECT c.id,c.expires_at,a.id AS actor_id,a.display_name AS name,a.role FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.token_sha256=$1 AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND a.organization_id=$2 AND a.role IN ('developer','approver') FOR SHARE OF c,a")
            .bind(sha256(token)).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(unauthenticated)?
    };
    let response = issue(&mut tx, headers, &parent).await?;
    tx.commit().await?;
    Ok(response)
}

pub async fn logout(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Response, ApiError> {
    let id = auth.browser_id.ok_or(ApiError(
        StatusCode::BAD_REQUEST,
        "BROWSER_SESSION_REQUIRED",
    ))?;
    let mut tx = state.pool.begin().await?;
    lifecycle_lock(&mut tx).await?;
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE id=$1 AND revoked_at IS NULL").bind(id).execute(&mut *tx).await?;
    tx.commit().await?;
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(
        header::SET_COOKIE,
        HeaderValue::from_static(
            "__Host-schemaforge=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0",
        ),
    );
    Ok(response)
}

pub async fn setup(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Response, ApiError> {
    if !state.tls {
        return Err(forbidden("HTTPS_REQUIRED"));
    }
    if !same_origin(&headers, state.tls) {
        return Err(forbidden("ORIGIN_REJECTED"));
    }
    let Json(body) =
        body.map_err(|_| ApiError(StatusCode::BAD_REQUEST, "INVALID_PASSWORD_SETUP"))?;
    if !body.is_object() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "INVALID_PASSWORD_SETUP"));
    }
    let body: Login = serde_json::from_value(body)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "INVALID_PASSWORD_SETUP"))?;
    if !valid_login_name(&body.username) || !valid_password(&body.password) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "INVALID_PASSWORD_SETUP"));
    }
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .filter(|s| (32..=4096).contains(&s.len()))
        .ok_or_else(unauthenticated)?;
    let digest = sha256(token);
    if sqlx::query("SELECT 1 FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.token_sha256=$1 AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND a.organization_id=$2").bind(&digest).bind(ORG_UUID).fetch_optional(&state.pool).await?.is_none() { return Err(unauthenticated()); }
    let encoded = hash_password(&state, &body.password).await?;
    let mut tx = state.pool.begin().await?;
    lifecycle_lock(&mut tx).await?;
    active_metadata(&mut tx).await?;
    let current = sqlx::query("SELECT c.id,c.actor_id FROM sf_local_credentials c JOIN sf_local_actors a ON a.id=c.actor_id WHERE c.token_sha256=$1 AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() AND a.organization_id=$2 AND a.role IN ('developer','approver') FOR SHARE OF c,a").bind(digest).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(unauthenticated)?;
    let actor_id: String = current.try_get("actor_id")?;
    if sqlx::query("SELECT 1 FROM sf_password_accounts WHERE actor_id=$1 OR username=$2")
        .bind(&actor_id)
        .bind(&body.username)
        .fetch_optional(&mut *tx)
        .await?
        .is_some()
    {
        return Err(conflict("PASSWORD_SETUP_UNAVAILABLE"));
    }
    sqlx::query("INSERT INTO sf_password_accounts(actor_id,username,password_hash,anchor_credential_id) VALUES($1,$2,$3,$4)").bind(actor_id).bind(body.username).bind(encoded).bind(current.try_get::<Uuid,_>("id")?).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO sf_password_audit(actor_id,action) VALUES($1,'SETUP')")
        .bind(current.try_get::<String, _>("actor_id")?)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"created":true}))).into_response())
}
