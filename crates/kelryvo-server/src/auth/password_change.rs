//! Self-service password replacement preserves the LOCAL anchor and grants,
//! while atomically retiring all existing password and browser credentials.
use super::*;
use crate::ObjectJson;
use zeroize::Zeroize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PasswordChange {
    current_password: String,
    new_password: String,
}
impl Drop for PasswordChange {
    fn drop(&mut self) {
        self.current_password.zeroize();
        self.new_password.zeroize();
    }
}

pub async fn change(
    State(state): State<AppState>,
    auth: Authenticated,
    headers: HeaderMap,
    body: Result<ObjectJson<PasswordChange>, Response>,
) -> Result<Response, ApiError> {
    if !state.tls {
        return Err(forbidden("HTTPS_REQUIRED"));
    }
    if !same_origin(&headers, state.tls) {
        return Err(forbidden("ORIGIN_REJECTED"));
    }
    let ObjectJson(body) =
        body.map_err(|_| ApiError(StatusCode::BAD_REQUEST, "INVALID_PASSWORD"))?;
    if body.current_password.encode_utf16().count() > 512 || !valid_password(&body.new_password) {
        return Err(ApiError(StatusCode::BAD_REQUEST, "INVALID_PASSWORD"));
    }
    let account: Option<String> =
        sqlx::query_scalar("SELECT password_hash FROM sf_password_accounts WHERE actor_id=$1")
            .bind(&auth.actor.id)
            .fetch_optional(&state.pool)
            .await?;
    let accepted = verify_password(&state, &body.current_password, account.as_deref())
        .await
        .map_err(|e| {
            if e.1 == "AUTH_UNAVAILABLE" {
                ApiError(StatusCode::SERVICE_UNAVAILABLE, e.1)
            } else {
                e
            }
        })?;
    if !accepted || account.is_none() {
        return Err(ApiError(StatusCode::BAD_REQUEST, "PASSWORD_NOT_ACCEPTED"));
    }
    let encoded = hash_password(&state, &body.new_password).await?;
    let mut tx = state.pool.begin().await?;
    // This checkpoint rechecks the exact browser/parent or token after hashing,
    // serializes with operators/admission and retains RESTORE_HOLD's veto.
    guard_mutation(&mut tx, &auth, None, None).await?;
    let current=sqlx::query("SELECT p.actor_id FROM sf_password_accounts p JOIN sf_local_credentials c ON c.id=p.anchor_credential_id AND c.actor_id=p.actor_id WHERE p.actor_id=$1 AND p.password_hash=$2 AND p.disabled_at IS NULL AND c.credential_kind='LOCAL' AND c.revoked_at IS NULL FOR UPDATE OF p")
        .bind(&auth.actor.id).bind(account.as_deref()).fetch_optional(&mut *tx).await?;
    if current.is_none() {
        return Err(unauthenticated());
    }
    sqlx::query("UPDATE sf_password_accounts SET password_hash=$1,updated_at=clock_timestamp() WHERE actor_id=$2")
        .bind(encoded).bind(&auth.actor.id).execute(&mut *tx).await?;
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=$1 AND credential_kind IN ('PASSWORD','BROWSER') AND revoked_at IS NULL")
        .bind(&auth.actor.id).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO sf_password_audit(actor_id,action) VALUES($1,'PASSWORD_CHANGED')")
        .bind(&auth.actor.id)
        .execute(&mut *tx)
        .await?;
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
