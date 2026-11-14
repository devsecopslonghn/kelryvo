//! Instance registration and credential lifecycle. This API stores only
//! authenticated ciphertext and never receives an Oracle private key.
use crate::ObjectJson;
use crate::{
    ApiError, ApiResult, AppState, ORG, ORG_UUID,
    auth::{self, Authenticated},
    conflict,
    connections::public_connection,
    invalid, not_found, projects,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use kelryvo_core::workspace::positive_revision;
use kelryvo_vault::{Context, endpoint_digest};
use regex::Regex;
use serde::{Deserialize, Deserializer};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use std::sync::LazyLock;
use uuid::Uuid;
use zeroize::Zeroizing;

pub struct Secret(Zeroizing<String>);
impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        String::deserialize(deserializer).map(|s| Self(Zeroizing::new(s)))
    }
}
impl Secret {
    pub(crate) fn value(&self) -> &str {
        self.0.as_str()
    }
}

fn supplied_secret<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Secret>, D::Error> {
    Secret::deserialize(deserializer).map(Some)
}
fn supplied_string<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    String::deserialize(deserializer).map(Some)
}
fn deserialize_port<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i32, D::Error> {
    // JSON numbers have JavaScript Number semantics in the retained API:
    // integral decimal/exponent spellings are valid, strings are not.
    kelryvo_core::port(&Value::deserialize(deserializer)?)
        .ok_or_else(|| serde::de::Error::custom("Invalid port"))
}

fn bounded(value: &str, max: usize) -> bool {
    projects::text(value, max) && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn username(value: &str) -> bool {
    static PATTERN: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\A[A-Za-z][A-Za-z0-9_$#]{0,127}\z").expect("username"));
    PATTERN.is_match(value)
}
fn reference(value: &str) -> bool {
    static PATTERN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\A(?:vault|secret)://[A-Za-z0-9._/-]{1,500}\z").expect("credential reference")
    });
    PATTERN.is_match(value) && !value.starts_with("vault://kelryvo/")
}
fn host(value: &str) -> bool {
    static PATTERN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\A(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])\z")
            .expect("host")
    });
    value.len() <= 253 && PATTERN.is_match(value)
}
fn service(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_$#.-".contains(&b))
}
fn vault_error() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "ORACLE_CREDENTIAL_VAULT_UNAVAILABLE",
    )
}

pub async fn catalog_lock(tx: &mut PgConnection) -> Result<(), ApiError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,31))")
        .bind(ORG)
        .execute(tx)
        .await?;
    Ok(())
}

pub(crate) async fn guard(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
) -> Result<(), ApiError> {
    auth::guard_mutation(tx, auth, Some(project), Some("developer")).await?;
    if sqlx::query("SELECT 1 FROM sf_workspace_database_grants WHERE organization_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(ORG_UUID).bind(&auth.actor.id).fetch_optional(&mut *tx).await?.is_none(){return Err(ApiError(StatusCode::FORBIDDEN,"DATABASE_MANAGEMENT_REQUIRED"));}
    projects::active_project(tx, project).await
}

pub(crate) async fn audited(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    connection: Uuid,
    action: &str,
    facts: Value,
) -> Result<(), ApiError> {
    audited_optional(tx, auth, project, Some(connection), action, facts).await
}
pub(crate) async fn audited_optional(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    connection: Option<Uuid>,
    action: &str,
    facts: Value,
) -> Result<(), ApiError> {
    sqlx::query("INSERT INTO sf_database_connection_audit(organization_id,project_id,connection_id,actor_id,action,facts) VALUES($1,$2,$3,$4,$5,$6)").bind(ORG_UUID).bind(project).bind(connection).bind(&auth.actor.id).bind(action).bind(&facts).execute(&mut *tx).await?;
    projects::append_audit(
        tx,
        auth,
        project,
        action,
        connection.unwrap_or(project),
        facts,
    )
    .await
}

async fn seal(
    tx: &mut PgConnection,
    state: &AppState,
    auth: &Authenticated,
    connection: &Value,
    password: &str,
    credential: Uuid,
) -> Result<String, ApiError> {
    let connection_id = projects::id(connection["id"].as_str().ok_or_else(invalid)?)?;
    let endpoint = endpoint_digest(connection).map_err(|_| vault_error())?;
    let context = Context {
        organization_id: ORG.into(),
        connection_id: connection_id.to_string(),
        credential_id: credential.to_string(),
        username: connection["username"].as_str().ok_or_else(invalid)?.into(),
        purpose: "INSTANCE_MASTER".into(),
        endpoint_digest: endpoint.clone(),
    };
    let key = state.vault_public_key.as_ref().ok_or_else(vault_error)?;
    let envelope = key.seal(password, &context).map_err(|_| vault_error())?;
    sqlx::query("INSERT INTO sf_oracle_credentials(id,organization_id,connection_id,username,purpose,key_id,envelope,endpoint_digest,actor_id) VALUES($1,$2,$3,$4,'INSTANCE_MASTER',$5,$6,$7,$8)")
        .bind(credential).bind(ORG_UUID).bind(connection_id).bind(&context.username).bind(&envelope.key_id).bind(serde_json::to_value(&envelope).map_err(|_|vault_error())?).bind(endpoint).bind(&auth.actor.id).execute(tx).await?;
    Ok(envelope.key_id)
}

async fn projection(tx: &mut PgConnection, row: &Value, project: Uuid) -> Result<Value, ApiError> {
    scoped_projection(tx, row, project, true).await
}
pub(crate) async fn scoped_projection(
    tx: &mut PgConnection,
    row: &Value,
    project: Uuid,
    manage: bool,
) -> Result<Value, ApiError> {
    let container = projects::id(row["container_id"].as_str().ok_or_else(invalid)?)?;
    let environment: Option<String> = sqlx::query_scalar(
        "SELECT environment FROM sf_reference_containers WHERE id=$1 AND organization_id=$2",
    )
    .bind(container)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?;
    let mut source = row.clone();
    source["environment"] = json!(environment);
    let mut public = public_connection(&source, "DISCOVERY");
    // A native runtime must install/attest this source before it can grant any
    // discovery or execution capability. Historical installation records alone
    // are not portable authority for a replacement binary.
    public["runtimeState"] = if row["credential_ref"]
        .as_str()
        .is_some_and(|r| r.starts_with("vault://kelryvo/"))
    {
        "SETUP_REQUIRED"
    } else {
        "OPERATOR_MANAGED"
    }
    .into();
    let runtime = crate::instance_runtime::current(
        tx,
        projects::id(row["id"].as_str().ok_or_else(invalid)?)?,
        &row["revision"],
    )
    .await?;
    if let Some(r) = runtime {
        public["runtimeState"] = "READY".into();
        public["runtimeSqlProfile"] = r["sqlProfile"].clone();
        public["runtimeSchemaOwners"] = r["schemaOwners"].clone();
        public["protectedSchemaOwners"] = r["protectedOwners"].clone();
    } else {
        public["runtimeSqlProfile"] = Value::Null;
        public["runtimeSchemaOwners"] = json!([]);
        public["protectedSchemaOwners"] = json!([]);
    }
    let connection = projects::id(row["id"].as_str().ok_or_else(invalid)?)?;
    let latest: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(o) FROM sf_database_observations o WHERE connection_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1").bind(connection).fetch_optional(&mut *tx).await?;
    public["latestObservation"] = match latest {
        Some(o) => crate::discovery::public_observation(tx, &o, project, manage).await?,
        None => Value::Null,
    };
    let mut current = row.clone();
    current["revision"] = crate::targets::revision(row, "revision");
    public["readiness"] =
        crate::connection_management::discovery_readiness(tx, &current, project).await?;
    Ok(public)
}

pub async fn masters(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
) -> ApiResult<Value> {
    let project = projects::id(&project)?;
    let mut tx = state.pool.begin().await?;
    guard(&mut tx, &auth, project).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_database_connections c WHERE organization_id=$1 AND credential_mode='INSTANCE_MASTER' AND retired_at IS NULL ORDER BY name,id LIMIT 101").bind(ORG_UUID).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"instances":rows.iter().take(100).map(|r|public_connection(r,"DISCOVERY")).collect::<Vec<_>>(),"truncated":rows.len()>100,"credentialEntryAvailable":state.vault_public_key.is_some()}),
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Registration {
    name: String,
    container_name: String,
    kind: String,
    environment: String,
    host: String,
    #[serde(deserialize_with = "deserialize_port")]
    port: i32,
    service: String,
    transport: String,
    username: String,
    #[serde(default, deserialize_with = "supplied_secret")]
    password: Option<Secret>,
    #[serde(default, deserialize_with = "supplied_string")]
    credential_ref: Option<String>,
    reason: String,
}
impl Registration {
    fn valid(&self) -> bool {
        let credential = match (&self.password, &self.credential_ref) {
            (Some(password), None) => kelryvo_vault::valid_password(password.value()),
            (None, Some(r)) => reference(r),
            _ => false,
        };
        credential
            && bounded(&self.name, 120)
            && bounded(&self.container_name, 120)
            && bounded(&self.reason, 2000)
            && ["PDB", "NON_CDB"].contains(&self.kind.as_str())
            && ["DEV", "SIT", "UAT", "PROD"].contains(&self.environment.as_str())
            && ["TCP", "TCPS"].contains(&self.transport.as_str())
            && host(&self.host)
            && (1..=65535).contains(&self.port)
            && service(&self.service)
            && username(&self.username)
            && kelryvo_core::schema_scope::is_application_owner(&self.username)
    }
}

pub async fn register(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    ObjectJson(body): ObjectJson<Registration>,
) -> Result<Response, ApiError> {
    if !body.valid() {
        return Err(invalid());
    }
    let project = projects::id(&project)?;
    let mut tx = state.pool.begin().await?;
    catalog_lock(&mut tx).await?;
    guard(&mut tx, &auth, project).await?;
    let normalized_host = body.host.to_ascii_lowercase();
    let mut route:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(r)||jsonb_build_object('kind',c.kind) FROM sf_reference_services r JOIN sf_reference_containers c ON c.id=r.container_id WHERE r.organization_id=$1 AND r.host=$2 AND r.port=$3 AND r.service=$4 AND r.transport=$5 FOR UPDATE OF r")
        .bind(ORG_UUID).bind(&normalized_host).bind(body.port).bind(&body.service).bind(&body.transport).fetch_optional(&mut *tx).await?;
    if route.as_ref().is_some_and(|r| r["kind"] != body.kind) {
        return Err(conflict("INSTANCE_REFERENCE_CONFLICT"));
    }
    if route.is_none() {
        let key = Uuid::new_v4().to_string();
        let database:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,$2,$3) RETURNING id").bind(ORG_UUID).bind(&key).bind(&body.name).fetch_one(&mut *tx).await?;
        let container:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,$3,$4,$5,$6) RETURNING id").bind(ORG_UUID).bind(database).bind(key).bind(&body.container_name).bind(&body.kind).bind(&body.environment).fetch_one(&mut *tx).await?;
        route=Some(sqlx::query_scalar("INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(sf_reference_services)").bind(ORG_UUID).bind(container).bind(&normalized_host).bind(body.port).bind(&body.service).bind(&body.transport).fetch_one(&mut *tx).await?);
    }
    let route = route.ok_or_else(invalid)?;
    let container = projects::id(route["container_id"].as_str().ok_or_else(invalid)?)?;
    let route_id = projects::id(route["id"].as_str().ok_or_else(invalid)?)?;
    if sqlx::query("SELECT 1 FROM sf_database_connections WHERE organization_id=$1 AND container_id=$2 AND credential_mode='INSTANCE_MASTER' AND retired_at IS NULL").bind(ORG_UUID).bind(container).fetch_optional(&mut *tx).await?.is_some(){return Err(conflict("INSTANCE_MASTER_ALREADY_CONFIGURED"));}
    let credential = Uuid::new_v4();
    let reference = body
        .credential_ref
        .clone()
        .unwrap_or_else(|| format!("vault://kelryvo/{credential}"));
    let connection:Value=sqlx::query_scalar("INSERT INTO sf_database_connections(organization_id,container_id,route_id,name,engine,host,port,service,transport,username,credential_ref,actor_id,reason,credential_mode) VALUES($1,$2,$3,$4,'oracle',$5,$6,$7,$8,$9,$10,$11,$12,'INSTANCE_MASTER') RETURNING to_jsonb(sf_database_connections)")
        .bind(ORG_UUID).bind(container).bind(route_id).bind(body.name.trim_matches(kelryvo_core::js_whitespace)).bind(normalized_host).bind(body.port).bind(&body.service).bind(&body.transport).bind(&body.username).bind(reference).bind(&auth.actor.id).bind(body.reason.trim_matches(kelryvo_core::js_whitespace)).fetch_one(&mut *tx).await?;
    let connection_id = projects::id(connection["id"].as_str().ok_or_else(invalid)?)?;
    if let Some(password) = &body.password {
        let key_id = seal(
            &mut tx,
            &state,
            &auth,
            &connection,
            password.value(),
            credential,
        )
        .await?;
        audited(
            &mut tx,
            &auth,
            project,
            connection_id,
            "INSTANCE_CREDENTIAL_STORED",
            json!({"credentialId":credential,"keyId":key_id}),
        )
        .await?;
    }
    sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES($1,$2,$3)").bind(connection_id).bind(ORG_UUID).bind(project).execute(&mut *tx).await?;
    audited(&mut tx,&auth,project,connection_id,"INSTANCE_MASTER_REGISTERED",json!({"containerId":container,"revision":crate::targets::revision(&connection,"revision")})).await?;
    let result = projection(&mut tx, &connection, project).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"connection":result}))).into_response())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attach {
    connection_id: String,
    reason: String,
}
pub async fn attach(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    ObjectJson(body): ObjectJson<Attach>,
) -> ApiResult<Value> {
    if !bounded(&body.reason, 2000) {
        return Err(invalid());
    }
    let (project, connection) = (
        projects::id(&project)?,
        projects::id(&body.connection_id).map_err(|_| invalid())?,
    );
    let mut tx = state.pool.begin().await?;
    catalog_lock(&mut tx).await?;
    guard(&mut tx, &auth, project).await?;
    let row:Value=sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_database_connections c WHERE id=$1 AND organization_id=$2 AND credential_mode='INSTANCE_MASTER' AND retired_at IS NULL FOR UPDATE").bind(connection).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    sqlx::query("INSERT INTO sf_database_connection_projects(connection_id,organization_id,project_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING").bind(connection).bind(ORG_UUID).bind(project).execute(&mut *tx).await?;
    audited(
        &mut tx,
        &auth,
        project,
        connection,
        "INSTANCE_ATTACHED",
        json!({"reason":body.reason.trim_matches(kelryvo_core::js_whitespace)}),
    )
    .await?;
    let result = projection(&mut tx, &row, project).await?;
    tx.commit().await?;
    Ok(Json(json!({"connection":result})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CredentialAction {
    action: String,
    expected_revision: String,
    #[serde(default, deserialize_with = "supplied_secret")]
    password: Option<Secret>,
    reason: String,
}
pub async fn credentials(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, connection)): Path<(String, String)>,
    ObjectJson(body): ObjectJson<CredentialAction>,
) -> ApiResult<Value> {
    let rotate = body.action == "ROTATE";
    if !["ROTATE", "REVOKE"].contains(&body.action.as_str())
        || positive_revision(&body.expected_revision).is_none()
        || !bounded(&body.reason, 500)
        || if rotate {
            body.password
                .as_ref()
                .is_none_or(|p| !kelryvo_vault::valid_password(p.value()))
        } else {
            body.password.is_some()
        }
    {
        return Err(invalid());
    }
    let (project, connection) = (projects::id(&project)?, projects::id(&connection)?);
    let mut tx = state.pool.begin().await?;
    catalog_lock(&mut tx).await?;
    guard(&mut tx, &auth, project).await?;
    let row:Value=sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_database_connections c JOIN sf_database_connection_projects p ON p.connection_id=c.id AND p.organization_id=c.organization_id WHERE c.id=$1 AND c.organization_id=$2 AND p.project_id=$3 FOR UPDATE OF c").bind(connection).bind(ORG_UUID).bind(project).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if row["credential_mode"] != "INSTANCE_MASTER"
        || !row["retired_at"].is_null()
        || crate::targets::revision(&row, "revision") != body.expected_revision
    {
        return Err(conflict("CONNECTION_REVISION_CONFLICT"));
    }
    if sqlx::query("SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id JOIN sf_instance_profile_sources s ON s.profile_id=p.profile_id WHERE s.connection_id=$1 AND j.state IN ('ADMITTED','HOLD') LIMIT 1").bind(connection).fetch_optional(&mut *tx).await?.is_some(){return Err(conflict("CONNECTION_EXECUTION_ACTIVE"));}
    let old:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_oracle_credentials WHERE connection_id=$1 AND organization_id=$2 AND $3::text='vault://kelryvo/'||id::text FOR UPDATE").bind(connection).bind(ORG_UUID).bind(row["credential_ref"].as_str()).fetch_optional(&mut *tx).await?;
    if !rotate && old.is_none() {
        return Err(conflict("MANAGED_CREDENTIAL_REQUIRED"));
    }
    if let Some(old) = old {
        sqlx::query("INSERT INTO sf_oracle_credential_revocations(credential_id,organization_id,actor_id,reason) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING").bind(old).bind(ORG_UUID).bind(&auth.actor.id).bind(body.reason.trim_matches(kelryvo_core::js_whitespace)).execute(&mut *tx).await?;
    }
    let replacement = if let Some(password) = body.password {
        let credential = Uuid::new_v4();
        seal(&mut tx, &state, &auth, &row, password.value(), credential).await?;
        Some(credential)
    } else {
        None
    };
    let reference = replacement
        .map(|id| format!("vault://kelryvo/{id}"))
        .unwrap_or_else(|| row["credential_ref"].as_str().unwrap_or_default().into());
    let updated:Value=sqlx::query_scalar("UPDATE sf_database_connections SET credential_ref=$1,enabled=$2,revision=revision+1 WHERE id=$3 RETURNING to_jsonb(sf_database_connections)").bind(reference).bind(rotate && row["enabled"]==true).bind(connection).fetch_one(&mut *tx).await?;
    audited(&mut tx,&auth,project,connection,if rotate{"INSTANCE_CREDENTIAL_ROTATED"}else{"INSTANCE_CREDENTIAL_REVOKED"},json!({"previousRevision":body.expected_revision,"revision":crate::targets::revision(&updated,"revision"),"credentialId":replacement.or(old),"reason":body.reason.trim_matches(kelryvo_core::js_whitespace)})).await?;
    let result = projection(&mut tx, &updated, project).await?;
    tx.commit().await?;
    Ok(Json(json!({"connection":result})))
}

// Used by operator lifecycle and focused tests to check the persisted lineage.
pub async fn connection_snapshot(pool: &PgPool, connection: Uuid) -> Result<Value, ApiError> {
    sqlx::query_scalar(
        "SELECT to_jsonb(c) FROM sf_database_connections c WHERE id=$1 AND organization_id=$2",
    )
    .bind(connection)
    .bind(ORG_UUID)
    .fetch_optional(pool)
    .await?
    .ok_or_else(not_found)
}
