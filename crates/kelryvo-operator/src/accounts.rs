//! OS-only account lifecycle; roles and project grants never change here.
use crate::OperatorUnavailable;
use kelryvo_core::sha256;
use kelryvo_server::{AppState, ORG_UUID, auth};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
type Result<T> = std::result::Result<T, OperatorUnavailable>;
fn reject() -> OperatorUnavailable {
    OperatorUnavailable
}
fn actor(identity: &str) -> Result<String> {
    if !["developer", "approver"].contains(&identity) {
        return Err(reject());
    }
    Ok(format!("kelryvo-{identity}"))
}
fn operator(uid: i32) -> Result<()> {
    if uid < 0 || [10001, 10002].contains(&uid) {
        return Err(reject());
    }
    Ok(())
}

/// Adopt a new desired mounted LOCAL token. Existing active tokens are an exact
/// no-op: neither expiry nor browser sessions are refreshed on repeat requests.
pub async fn credential(
    pool: &PgPool,
    identity: &str,
    token: &str,
    uid: i32,
    restored: bool,
) -> Result<&'static str> {
    operator(uid)?;
    let actor = actor(identity)?;
    if token.len() != 64
        || !token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || restored && uid != 0
    {
        return Err(reject());
    }
    let digest = sha256(token);
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    let metadata:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',g.id,'state',g.state,'predecessor_id',g.predecessor_id,'witness_id',g.witness_id,'created_at',g.created_at,'operator_os_uid',g.operator_os_uid) FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g").fetch_one(&mut *tx).await?;
    let generation =
        Uuid::parse_str(metadata["id"].as_str().ok_or_else(reject)?).map_err(|_| reject())?;
    if restored {
        let name: String = sqlx::query_scalar("SELECT current_database()")
            .fetch_one(&mut *tx)
            .await?;
        let valid_name = name.strip_prefix("sf_product_restore_").is_some_and(|n| {
            n.len() == 32
                && n.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        });
        if !valid_name
            || metadata["state"] != "RESTORE_HOLD"
            || metadata["predecessor_id"].is_null()
            || metadata["witness_id"].is_null()
        {
            return Err(reject());
        }
        let previous = Uuid::parse_str(metadata["predecessor_id"].as_str().ok_or_else(reject)?)
            .map_err(|_| reject())?;
        if !sqlx::query_scalar::<_, bool>(
            "SELECT EXISTS(SELECT 1 FROM sf_metadata_generations WHERE id=$1)",
        )
        .bind(previous)
        .fetch_one(&mut *tx)
        .await?
        {
            return Err(reject());
        }
        let audit:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('witness_id',witness_id,'operator_os_uid',operator_os_uid) FROM sf_metadata_operator_audit WHERE action='RESTORE_HOLD' AND generation_id=$1 LIMIT 2").bind(generation).fetch_all(&mut *tx).await?;
        let owners: Vec<i32> =
            sqlx::query_scalar("SELECT operator_os_uid FROM sf_metadata_restore_owners LIMIT 2")
                .fetch_all(&mut *tx)
                .await?;
        if audit.len() != 1
            || owners.len() != 1
            || owners[0] < 0
            || json!(owners[0]) != metadata["operator_os_uid"]
            || audit[0]["operator_os_uid"] != metadata["operator_os_uid"]
            || audit[0]["witness_id"] != metadata["witness_id"]
        {
            return Err(reject());
        }
        if sqlx::query(
            "SELECT 1 FROM sf_metadata_credentials_revoked WHERE token_sha256=$1 LIMIT 1",
        )
        .bind(&digest)
        .fetch_optional(&mut *tx)
        .await?
        .is_some()
        {
            return Err(reject());
        }
    } else if metadata["state"] != "ACTIVE" {
        return Err(reject());
    }
    sqlx::query(
        "SELECT id FROM sf_local_actors WHERE id=$1 AND organization_id=$2 AND role=$3 FOR UPDATE",
    )
    .bind(&actor)
    .bind(ORG_UUID)
    .bind(identity)
    .fetch_one(&mut *tx)
    .await?;
    let prior:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('actor_id',actor_id,'kind',credential_kind,'revoked',revoked_at IS NOT NULL,'live',expires_at>clock_timestamp(),'since_restore',issued_at>=(SELECT created_at FROM sf_metadata_generations WHERE id=$2)) FROM sf_local_credentials WHERE token_sha256=$1 FOR UPDATE").bind(&digest).bind(generation).fetch_optional(&mut *tx).await?;
    if let Some(prior) = prior {
        if prior["actor_id"] != actor
            || prior["kind"] != "LOCAL"
            || prior["revoked"] != false
            || prior["live"] != true
            || restored && prior["since_restore"] != true
        {
            return Err(reject());
        }
        tx.commit().await?;
        return Ok("ALREADY_ACTIVE");
    }
    let retiring:Vec<(Uuid,String)>=sqlx::query_as("SELECT id,token_sha256 FROM sf_local_credentials WHERE actor_id=$1 AND credential_kind='LOCAL' AND revoked_at IS NULL ORDER BY id FOR UPDATE").bind(&actor).fetch_all(&mut *tx).await?;
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=$1 AND revoked_at IS NULL").bind(&actor).execute(&mut *tx).await?;
    for (id, hash) in retiring {
        sqlx::query("INSERT INTO sf_metadata_credentials_revoked(credential_id,token_sha256,generation_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING").bind(id).bind(&hash).bind(generation).execute(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_metadata_operator_audit(id,action,generation_id,credential_id,credential_digest,operator_os_uid) VALUES($1,'CREDENTIAL_REVOKE',$2,$3,$4,$5)").bind(Uuid::new_v4()).bind(generation).bind(id).bind(hash).bind(uid).execute(&mut *tx).await?;
    }
    sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued").bind(&actor).bind(digest).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(if restored { "RECOVERED" } else { "ROTATED" })
}

/// Root-only container password reset/disable. Passwords must come from private
/// stdin at the CLI boundary; this never creates actors or changes their grants.
pub async fn password(
    pool: &PgPool,
    identity: &str,
    input: Option<(&str, &str)>,
    uid: i32,
) -> Result<()> {
    if uid != 0 {
        return Err(reject());
    }
    let actor = actor(identity)?;
    password_for_actor(pool, &actor, input, uid).await
}

/// Local-development identities belong to the invoking OS operator. The CLI
/// additionally authorizes the loopback metadata URL against its private config.
pub async fn local_password(
    pool: &PgPool,
    identity: &str,
    input: Option<(&str, &str)>,
    uid: i32,
) -> Result<()> {
    operator(uid)?;
    actor(identity)?;
    password_for_actor(pool, &format!("local-{identity}"), input, uid).await
}

async fn password_for_actor(
    pool: &PgPool,
    actor: &str,
    input: Option<(&str, &str)>,
    uid: i32,
) -> Result<()> {
    let encoded = if let Some((name, password)) = input {
        if !auth::valid_login_name(name) {
            return Err(reject());
        }
        Some(auth::hash_password(&AppState::new(pool.clone(), true), password).await?)
    } else {
        None
    };
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    auth::active_metadata(&mut tx).await?;
    sqlx::query("SELECT id FROM sf_local_actors WHERE id=$1 AND organization_id=$2 AND role IN ('developer','approver') FOR SHARE").bind(actor).bind(ORG_UUID).fetch_one(&mut *tx).await?;
    if let Some((name,_))=input {
        let anchor:Uuid=sqlx::query_scalar("SELECT id FROM sf_local_credentials WHERE actor_id=$1 AND credential_kind='LOCAL' AND revoked_at IS NULL AND expires_at>clock_timestamp() ORDER BY issued_at DESC,id LIMIT 1 FOR SHARE").bind(actor).fetch_one(&mut *tx).await?;
        let owner:Option<String>=sqlx::query_scalar("SELECT actor_id FROM sf_password_accounts WHERE username=$1").bind(name).fetch_optional(&mut *tx).await?;
        if owner.is_some_and(|id|id!=actor){return Err(reject());}
        sqlx::query("INSERT INTO sf_password_accounts(actor_id,username,password_hash,anchor_credential_id) VALUES($1,$2,$3,$4) ON CONFLICT(actor_id) DO UPDATE SET username=EXCLUDED.username,password_hash=EXCLUDED.password_hash,anchor_credential_id=EXCLUDED.anchor_credential_id,disabled_at=NULL,updated_at=clock_timestamp()").bind(actor).bind(name).bind(encoded).bind(anchor).execute(&mut *tx).await?;
    }else if sqlx::query("UPDATE sf_password_accounts SET disabled_at=coalesce(disabled_at,clock_timestamp()),updated_at=clock_timestamp() WHERE actor_id=$1").bind(actor).execute(&mut *tx).await?.rows_affected()!=1 {return Err(reject());}
    sqlx::query("UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE actor_id=$1 AND credential_kind IN ('PASSWORD','BROWSER') AND revoked_at IS NULL").bind(actor).execute(&mut *tx).await?;
    sqlx::query("INSERT INTO sf_password_audit(actor_id,action,operator_os_uid) VALUES($1,$2,$3)")
        .bind(actor)
        .bind(if input.is_some() {
            "OPERATOR_RESET"
        } else {
            "OPERATOR_DISABLED"
        })
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}
