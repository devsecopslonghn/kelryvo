//! OS-operator metadata lifecycle. No public HTTP route imports this crate.
#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
#[cfg(test)]
extern crate self as kelryvo_operator;
use kelryvo_server::{ORG_UUID, auth};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool, Row};
use uuid::Uuid;
use zeroize::Zeroizing;
pub mod accounts;
pub mod backup;
pub mod inventory;
pub mod local;
pub mod local_credentials;
pub mod pilot;

#[derive(Clone, Copy, Debug)]
pub struct OperatorUnavailable;
impl From<sqlx::Error> for OperatorUnavailable {
    fn from(_: sqlx::Error) -> Self {
        Self
    }
}
impl From<kelryvo_server::ApiError> for OperatorUnavailable {
    fn from(_: kelryvo_server::ApiError) -> Self {
        Self
    }
}

pub struct ActorSeed {
    pub id: String,
    pub name: String,
    pub role: String,
    pub token: Zeroizing<String>,
}

pub async fn seed(pool: &PgPool, actors: &[ActorSeed]) -> Result<(), OperatorUnavailable> {
    if actors.is_empty()
        || actors.iter().any(|a| {
            a.id.is_empty()
                || a.id.encode_utf16().count() > 200
                || a.name.trim().is_empty()
                || a.name.encode_utf16().count() > 200
                || !["developer", "approver"].contains(&a.role.as_str())
                || a.token.len() != 64
                || !a
                    .token
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
    {
        return Err(OperatorUnavailable);
    }
    for (index, actor) in actors.iter().enumerate() {
        if actors[..index]
            .iter()
            .any(|a| a.id == actor.id || a.token.as_str() == actor.token.as_str())
        {
            return Err(OperatorUnavailable);
        }
    }
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    auth::active_metadata(&mut tx).await?;
    for actor in actors {
        let current =
            sqlx::query("SELECT organization_id,role FROM sf_local_actors WHERE id=$1 FOR UPDATE")
                .bind(&actor.id)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some(current) = current {
            if current.try_get::<Uuid, _>("organization_id")? != ORG_UUID
                || current.try_get::<String, _>("role")? != actor.role
            {
                return Err(OperatorUnavailable);
            }
            sqlx::query("UPDATE sf_local_actors SET display_name=$1 WHERE id=$2")
                .bind(&actor.name)
                .bind(&actor.id)
                .execute(&mut *tx)
                .await?;
        } else {
            sqlx::query("INSERT INTO sf_local_actors(id,organization_id,role,display_name) VALUES($1,$2,$3,$4)").bind(&actor.id).bind(ORG_UUID).bind(&actor.role).bind(&actor.name).execute(&mut *tx).await?;
            sqlx::query("WITH issued AS (SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued").bind(&actor.id).bind(kelryvo_core::sha256(actor.token.as_str())).execute(&mut *tx).await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Copy)]
pub enum ProjectAction {
    Grant,
    Revoke,
    DeployGrant,
    DeployRevoke,
}
pub async fn project_action(
    pool: &PgPool,
    project: Uuid,
    actor: &str,
    action: ProjectAction,
    uid: i32,
) -> Result<(), OperatorUnavailable> {
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    sqlx::query("SELECT mode FROM sf_project_access_mode WHERE organization_id=$1 FOR SHARE")
        .bind(ORG_UUID)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR UPDATE")
        .bind(project)
        .bind(ORG_UUID)
        .fetch_one(&mut *tx)
        .await?;
    sqlx::query("SELECT id FROM sf_local_actors WHERE id=$1 AND organization_id=$2 AND role IN ('developer','approver') FOR UPDATE").bind(actor).bind(ORG_UUID).fetch_one(&mut *tx).await?;
    let current:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_project_grants WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL FOR UPDATE").bind(project).bind(actor).fetch_optional(&mut *tx).await?;
    match action {
        ProjectAction::Grant if current.is_none() => {
            sqlx::query("INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,$3,$4)").bind(ORG_UUID).bind(project).bind(actor).bind(uid).execute(&mut *tx).await?;
            audit(&mut tx, Some(project), Some(actor), "GRANT", uid, json!({})).await?;
        }
        ProjectAction::Revoke if current.is_some() => {
            let retired=sqlx::query("UPDATE sf_project_deploy_grants SET revoked_at=clock_timestamp(),revoke_os_uid=$1 WHERE project_id=$2 AND actor_id=$3 AND revoked_at IS NULL").bind(uid).bind(project).bind(actor).execute(&mut *tx).await?.rows_affected();
            sqlx::query("UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=$1 WHERE id=$2").bind(uid).bind(current).execute(&mut *tx).await?;
            audit(
                &mut tx,
                Some(project),
                Some(actor),
                "REVOKE",
                uid,
                json!({"deploymentGrantsRetired":retired}),
            )
            .await?;
        }
        ProjectAction::DeployGrant | ProjectAction::DeployRevoke => {
            let deploy:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_project_deploy_grants WHERE project_id=$1 AND actor_id=$2 AND revoked_at IS NULL FOR UPDATE").bind(project).bind(actor).fetch_optional(&mut *tx).await?;
            if matches!(action, ProjectAction::DeployGrant) {
                if current.is_none() || sqlx::query("SELECT 1 FROM sf_local_credentials WHERE actor_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() LIMIT 1").bind(actor).fetch_optional(&mut *tx).await?.is_none(){return Err(OperatorUnavailable);}
                if deploy.is_none() {
                    sqlx::query("INSERT INTO sf_project_deploy_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES($1,$2,$3,$4)").bind(ORG_UUID).bind(project).bind(actor).bind(uid).execute(&mut *tx).await?;
                    audit(
                        &mut tx,
                        Some(project),
                        Some(actor),
                        "DEPLOY_GRANT",
                        uid,
                        json!({}),
                    )
                    .await?;
                }
            } else if let Some(deploy) = deploy {
                sqlx::query("UPDATE sf_project_deploy_grants SET revoked_at=clock_timestamp(),revoke_os_uid=$1 WHERE id=$2").bind(uid).bind(deploy).execute(&mut *tx).await?;
                audit(
                    &mut tx,
                    Some(project),
                    Some(actor),
                    "DEPLOY_REVOKE",
                    uid,
                    json!({}),
                )
                .await?;
            }
        }
        _ => {}
    }
    tx.commit().await?;
    Ok(())
}

async fn audit(
    tx: &mut PgConnection,
    project: Option<Uuid>,
    actor: Option<&str>,
    action: &str,
    uid: i32,
    facts: Value,
) -> Result<(), OperatorUnavailable> {
    sqlx::query("INSERT INTO sf_project_operator_audit(organization_id,project_id,actor_id,action,operator_os_uid,facts) VALUES($1,$2,$3,$4,$5,$6)").bind(ORG_UUID).bind(project).bind(actor).bind(action).bind(uid).bind(facts).execute(tx).await?;
    Ok(())
}

pub async fn activate(pool: &PgPool, uid: i32) -> Result<(), OperatorUnavailable> {
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    let mode: String = sqlx::query_scalar(
        "SELECT mode FROM sf_project_access_mode WHERE organization_id=$1 FOR UPDATE",
    )
    .bind(ORG_UUID)
    .fetch_one(&mut *tx)
    .await?;
    if mode != "BOOTSTRAP_REQUIRED" {
        return Err(OperatorUnavailable);
    }
    sqlx::query("SELECT id FROM sf_projects WHERE organization_id=$1 ORDER BY id FOR UPDATE")
        .bind(ORG_UUID)
        .fetch_all(&mut *tx)
        .await?;
    sqlx::query("SELECT id FROM sf_local_actors WHERE organization_id=$1 ORDER BY id FOR UPDATE")
        .bind(ORG_UUID)
        .fetch_all(&mut *tx)
        .await?;
    sqlx::query("SELECT id FROM sf_local_credentials WHERE actor_id IN (SELECT id FROM sf_local_actors WHERE organization_id=$1) ORDER BY actor_id,token_sha256 FOR UPDATE").bind(ORG_UUID).fetch_all(&mut *tx).await?;
    if sqlx::query("SELECT p.id FROM sf_projects p WHERE p.organization_id=$1 AND NOT EXISTS(SELECT 1 FROM sf_project_grants g JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id JOIN sf_local_credentials c ON c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE g.project_id=p.id AND g.organization_id=p.organization_id AND g.revoked_at IS NULL AND a.role IN ('developer','approver')) LIMIT 1").bind(ORG_UUID).fetch_optional(&mut *tx).await?.is_some(){return Err(OperatorUnavailable);}
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM sf_projects WHERE organization_id=$1")
            .bind(ORG_UUID)
            .fetch_one(&mut *tx)
            .await?;
    sqlx::query("UPDATE sf_project_access_mode SET mode='ENFORCED',activated_at=clock_timestamp(),activated_by_os_uid=$1 WHERE organization_id=$2").bind(uid).bind(ORG_UUID).execute(&mut *tx).await?;
    audit(
        &mut tx,
        None,
        None,
        "ACTIVATE",
        uid,
        json!({"projectCount":count}),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn database_access(
    pool: &PgPool,
    actor: &str,
    grant: bool,
    uid: i32,
) -> Result<(), OperatorUnavailable> {
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    sqlx::query("SELECT id FROM sf_local_actors WHERE id=$1 AND organization_id=$2 AND role='developer' FOR UPDATE").bind(actor).bind(ORG_UUID).fetch_one(&mut *tx).await?;
    let current:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_workspace_database_grants WHERE organization_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(ORG_UUID).bind(actor).fetch_optional(&mut *tx).await?;
    if grant && current.is_none() {
        sqlx::query("INSERT INTO sf_workspace_database_grants(organization_id,actor_id,operator_os_uid) VALUES($1,$2,$3)").bind(ORG_UUID).bind(actor).bind(uid).execute(&mut *tx).await?;
    }
    if !grant && current.is_some() {
        sqlx::query(
            "UPDATE sf_workspace_database_grants SET revoked_at=clock_timestamp() WHERE id=$1",
        )
        .bind(current)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("INSERT INTO sf_database_connection_audit(organization_id,actor_id,action,facts) VALUES($1,$2,$3,$4)").bind(ORG_UUID).bind(actor).bind(if grant{"WORKSPACE_DATABASE_GRANTED"}else{"WORKSPACE_DATABASE_REVOKED"}).bind(json!({"operatorOsUid":uid})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub async fn status(pool: &PgPool) -> Result<Value, OperatorUnavailable> {
    let mode: Option<String> =
        sqlx::query_scalar("SELECT mode FROM sf_project_access_mode WHERE organization_id=$1")
            .bind(ORG_UUID)
            .fetch_optional(pool)
            .await?;
    let actors:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',display_name,'role',role) FROM sf_local_actors WHERE organization_id=$1 AND role IN ('developer','approver') ORDER BY id").bind(ORG_UUID).fetch_all(pool).await?;
    let projects:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'name',p.name,'archivedAt',p.archived_at,'usableGrants',(SELECT count(DISTINCT g.actor_id) FROM sf_project_grants g JOIN sf_local_actors a ON a.id=g.actor_id AND a.organization_id=g.organization_id JOIN sf_local_credentials c ON c.actor_id=a.id AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp() WHERE g.project_id=p.id AND g.organization_id=p.organization_id AND g.revoked_at IS NULL AND a.role IN ('developer','approver'))) FROM sf_projects p WHERE p.organization_id=$1 ORDER BY p.created_at,p.id").bind(ORG_UUID).fetch_all(pool).await?;
    Ok(json!({"organizationId":ORG_UUID,"mode":mode,"actors":actors,"projects":projects}))
}

/// OS-operator identity administration is independent of application roles.
pub async fn identity_access(
    pool: &PgPool,
    actor: &str,
    grant: bool,
    uid: i32,
) -> Result<(), OperatorUnavailable> {
    if uid < 0 || [10001, 10002].contains(&uid) {
        return Err(OperatorUnavailable);
    }
    let mut tx = pool.begin().await?;
    auth::lifecycle_lock(&mut tx).await?;
    auth::active_metadata(&mut tx).await?;
    if sqlx::query("SELECT 1 FROM sf_local_actors WHERE id=$1 AND organization_id=$2 AND role IN ('developer','approver')").bind(actor).bind(ORG_UUID).fetch_optional(&mut *tx).await?.is_none(){return Err(OperatorUnavailable);}
    let current: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM sf_identity_admin_grants WHERE actor_id=$1 AND revoked_at IS NULL",
    )
    .bind(actor)
    .fetch_optional(&mut *tx)
    .await?;
    if grant && current.is_none() {
        sqlx::query("INSERT INTO sf_identity_admin_grants(actor_id,grant_os_uid) VALUES($1,$2)")
            .bind(actor)
            .bind(uid)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(id) = current.filter(|_| !grant) {
        sqlx::query("UPDATE sf_identity_admin_grants SET revoked_at=clock_timestamp(),revoke_os_uid=$1 WHERE id=$2").bind(uid).bind(id).execute(&mut *tx).await?;
    }
    if grant && current.is_none() || !grant && current.is_some() {
        sqlx::query(
            "INSERT INTO sf_identity_audit(actor_id,action,operator_os_uid) VALUES($1,$2,$3)",
        )
        .bind(actor)
        .bind(if grant {
            "ADMIN_GRANTED"
        } else {
            "ADMIN_REVOKED"
        })
        .bind(uid)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    Ok(())
}
