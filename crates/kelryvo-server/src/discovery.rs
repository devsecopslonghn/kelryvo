//! Durable read-only observations. Runtime output is evidence, never execution
//! authority. A timed-out task keeps its slot until the underlying work settles.
use crate::ObjectJson;
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth::Authenticated, conflict, instances, invalid,
    not_found, projects,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::{DateTime, Utc};
use kelryvo_core::evidence::{normalize_observation, physical_target_key};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::{
    collections::HashSet,
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
    time::Duration,
};
use uuid::Uuid;

#[derive(Clone, Copy)]
pub enum Operation {
    Test,
    Discover,
    Schema,
}
impl Operation {
    fn name(self) -> &'static str {
        match self {
            Self::Test => "TEST",
            Self::Discover => "DISCOVER",
            Self::Schema => "SCHEMA",
        }
    }
}

pub type RuntimeResult = Pin<Box<dyn Future<Output = Result<Value, ()>> + Send>>;

/// Trusted operator wiring only. Request JSON cannot choose an adapter, supply
/// identities, credentials or attestation. The public API holds no private key.
pub trait DiscoveryRuntime: Send + Sync {
    fn run(&self, connection: Value, operation: Operation) -> RuntimeResult;
}
impl DiscoveryRuntime for kelryvo_discovery::Client {
    fn run(&self, connection: Value, operation: Operation) -> RuntimeResult {
        let client = self.clone();
        let operation = match operation {
            Operation::Test => kelryvo_discovery::Operation::Test,
            Operation::Discover => kelryvo_discovery::Operation::Discover,
            Operation::Schema => kelryvo_discovery::Operation::Schema,
        };
        Box::pin(async move {
            let request = kelryvo_discovery::Request::new(connection, operation).map_err(|_| ())?;
            client.run(request).await.map_err(|_| ())
        })
    }
}
/// Fixed private container socket. No HTTP input can select a runtime path or
/// substitute the expected worker UID. Socket evidence never grants dispatch.
pub fn installed() -> Discovery {
    Discovery {
        schema_deadline: Duration::from_secs(35),
        ..Discovery::new(
            Arc::new(kelryvo_discovery::Client::installed()),
            Duration::from_secs(10),
        )
    }
}

#[derive(Clone)]
pub struct Discovery {
    runtime: Option<Arc<dyn DiscoveryRuntime>>,
    running: Arc<Mutex<HashSet<Uuid>>>,
    deadline: Duration,
    schema_deadline: Duration,
}
impl Default for Discovery {
    fn default() -> Self {
        Self {
            runtime: None,
            running: Arc::default(),
            deadline: Duration::from_secs(10),
            schema_deadline: Duration::from_secs(10),
        }
    }
}
impl Discovery {
    pub fn new(runtime: Arc<dyn DiscoveryRuntime>, deadline: Duration) -> Self {
        Self {
            runtime: Some(runtime),
            deadline: deadline.clamp(Duration::from_millis(25), Duration::from_secs(10)),
            schema_deadline: deadline.clamp(Duration::from_millis(25), Duration::from_secs(35)),
            ..Self::default()
        }
    }

    async fn run(&self, c: &Value, operation: Operation) -> Result<Value, ApiError> {
        self.run_owned(c, operation, None).await
    }

    pub(crate) async fn schema(&self, c: &Value, owner: &str) -> Result<Value, ApiError> {
        self.run_owned(c, Operation::Schema, Some(owner)).await
    }

    async fn run_owned(
        &self,
        c: &Value,
        operation: Operation,
        owner: Option<&str>,
    ) -> Result<Value, ApiError> {
        let id = row_id(c, "id")?;
        let runtime = {
            let mut running = self
                .running
                .lock()
                .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "RUNTIME_UNAVAILABLE"))?;
            if running.contains(&id) || running.len() >= 2 {
                return Err(ApiError(StatusCode::TOO_MANY_REQUESTS, "DISCOVERY_BUSY"));
            }
            if c["engine"] != "oracle" {
                return Ok(
                    json!({"status":"UNAVAILABLE","provenance":"UNAVAILABLE","limitations":["ENGINE_UNSUPPORTED"]}),
                );
            }
            let Some(runtime) = self.runtime.clone() else {
                return Ok(
                    json!({"status":"UNAVAILABLE","provenance":"UNAVAILABLE","limitations":["RUNTIME_UNAVAILABLE"]}),
                );
            };
            running.insert(id);
            runtime
        };
        let permit = Running {
            id,
            running: self.running.clone(),
        };
        let mut connection = json!({"id":c["id"],"revision":crate::targets::revision(c,"revision"),"engine":c["engine"],"host":c["host"],"port":c["port"],"service":c["service"],"transport":c["transport"],"username":c["username"],"credentialRef":c["credential_ref"],"credentialMode":c["credential_mode"]});
        if let Some(owner) = owner {
            connection["owner"] = owner.into();
        }
        // Detaching on timeout/request cancellation is intentional: releasing
        // this permit early would allow unbounded abandoned Oracle work.
        let mut work = tokio::spawn(async move {
            let _permit = permit;
            runtime.run(connection, operation).await
        });
        let deadline = if matches!(operation, Operation::Schema) {
            self.schema_deadline
        } else {
            self.deadline
        };
        Ok(match tokio::time::timeout(deadline, &mut work).await {
            Ok(Ok(Ok(raw))) => raw,
            Err(_) => json!({"status":"TIMEOUT","provenance":"UNAVAILABLE"}),
            _ => json!({"status":"UNAVAILABLE","provenance":"UNAVAILABLE"}),
        })
    }
}
struct Running {
    id: Uuid,
    running: Arc<Mutex<HashSet<Uuid>>>,
}
impl Drop for Running {
    fn drop(&mut self) {
        if let Ok(mut running) = self.running.lock() {
            running.remove(&self.id);
        }
    }
}

fn row_id(row: &Value, field: &str) -> Result<Uuid, ApiError> {
    projects::id(row[field].as_str().ok_or_else(invalid)?)
}

pub(crate) async fn read_guard(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
) -> Result<bool, ApiError> {
    let role = projects::guard_read(tx, auth, project).await?;
    let archived: bool = sqlx::query_scalar(
        "SELECT archived_at IS NOT NULL FROM sf_projects WHERE id=$1 AND organization_id=$2",
    )
    .bind(project)
    .bind(ORG_UUID)
    .fetch_one(&mut *tx)
    .await?;
    let workspace_grant: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_workspace_database_grants WHERE organization_id=$1 AND actor_id=$2 AND revoked_at IS NULL)").bind(ORG_UUID).bind(&auth.actor.id).fetch_one(&mut *tx).await?;
    Ok(role == "developer" && workspace_grant && !archived)
}

pub(crate) async fn scoped_connection(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    connection: Uuid,
) -> Result<Value, ApiError> {
    sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_database_connections c JOIN sf_database_connection_projects p ON p.connection_id=c.id AND p.organization_id=c.organization_id WHERE c.id=$1 AND c.organization_id=$2 AND p.project_id=$3 AND ((c.credential_mode='INSTANCE_MASTER' AND EXISTS(SELECT 1 FROM sf_workspace_database_grants g WHERE g.organization_id=c.organization_id AND g.actor_id=$4 AND g.revoked_at IS NULL)) OR EXISTS(SELECT 1 FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id WHERE a.project_id=p.project_id AND a.closed_at IS NULL AND s.container_id=c.container_id))")
        .bind(connection).bind(ORG_UUID).bind(project).bind(&auth.actor.id).fetch_optional(tx).await?.ok_or_else(not_found)
}

/// Caller holds the catalog/identity advisory lock. Claims persist across
/// credential rotation, retirement, route aliases and RESETLOGS generations.
pub async fn identity_current(
    tx: &mut PgConnection,
    container: Uuid,
    identity: &Value,
) -> Result<bool, ApiError> {
    let Some(candidate) = physical_target_key(identity) else {
        return Ok(false);
    };
    let claims: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(claim) FROM (SELECT DISTINCT ON (c.container_id) c.container_id,o.identity FROM sf_database_connections c JOIN sf_database_observations o ON o.connection_id=c.id WHERE c.organization_id=$1 AND c.credential_mode='INSTANCE_MASTER' AND o.operation='DISCOVER' AND o.status IN ('OBSERVED','PARTIAL') AND o.identity IS NOT NULL AND NOT (o.limitations @> '[\"IDENTITY_MISMATCH\"]'::jsonb) ORDER BY c.container_id,o.observed_at ASC,o.id ASC LIMIT 1001) claim").bind(ORG_UUID).fetch_all(&mut *tx).await?;
    if claims.len() > 1000 {
        return Ok(false);
    }
    for claim in claims {
        let same_container = claim["container_id"] == container.to_string();
        let same_identity = physical_target_key(&claim["identity"]).as_ref() == Some(&candidate);
        if same_container != same_identity {
            return Ok(false);
        }
    }
    let history: Vec<Value> = sqlx::query_scalar("SELECT DISTINCT ON (o.identity->>'engine',o.identity->>'dbUniqueName',o.identity->>'dbid',o.identity->>'cdb',CASE WHEN o.identity->>'cdb'='true' THEN o.identity->>'containerGuid' ELSE o.identity->>'containerDbid' END) o.identity FROM sf_database_connections c JOIN sf_database_observations o ON o.connection_id=c.id WHERE c.organization_id=$1 AND c.container_id=$2 AND c.credential_mode='INSTANCE_MASTER' AND o.operation='DISCOVER' AND o.status IN ('OBSERVED','PARTIAL') AND o.identity IS NOT NULL AND NOT (o.limitations @> '[\"IDENTITY_MISMATCH\"]'::jsonb) ORDER BY o.identity->>'engine',o.identity->>'dbUniqueName',o.identity->>'dbid',o.identity->>'cdb',CASE WHEN o.identity->>'cdb'='true' THEN o.identity->>'containerGuid' ELSE o.identity->>'containerDbid' END,o.observed_at ASC,o.id ASC LIMIT 2").bind(ORG_UUID).bind(container).fetch_all(tx).await?;
    Ok(history
        .iter()
        .all(|i| physical_target_key(i).as_ref() == Some(&candidate)))
}

pub(crate) async fn public_observation(
    tx: &mut PgConnection,
    o: &Value,
    project: Uuid,
    manage: bool,
) -> Result<Value, ApiError> {
    let connection = row_id(o, "connection_id")?;
    let owners: Vec<String> = sqlx::query_scalar("SELECT s.exact_owner FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id JOIN sf_database_connections c ON c.container_id=s.container_id WHERE c.id=$1 AND a.project_id=$2 AND a.closed_at IS NULL").bind(connection).bind(project).fetch_all(&mut *tx).await?;
    let latest: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('id',id,'identity_digest',identity_digest) FROM sf_database_observations WHERE connection_id=$1 AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1").bind(connection).fetch_optional(&mut *tx).await?;
    let config: Value =
        sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_database_connections c WHERE id=$1")
            .bind(connection)
            .fetch_one(&mut *tx)
            .await?;
    let accepted: Option<String> = sqlx::query_scalar("SELECT identity_digest FROM sf_target_identity_evidence WHERE connection_id=$1 AND project_id=$2 ORDER BY created_at DESC,digest DESC LIMIT 1").bind(connection).bind(project).fetch_optional(tx).await?;
    let latest = latest.unwrap_or(Value::Null);
    let digest = o["identity_digest"].as_str();
    let conflict = o["limitations"]
        .as_array()
        .is_some_and(|a| a.iter().any(|s| s == "IDENTITY_MISMATCH"))
        || digest.is_some_and(|d| {
            latest["identity_digest"].as_str().is_some_and(|l| l != d)
                || accepted.as_deref().is_some_and(|a| a != d)
        });
    let expires = o["expires_at"]
        .as_str()
        .and_then(|s| s.parse::<DateTime<Utc>>().ok());
    let expired = expires.is_none_or(|t| t <= Utc::now())
        || crate::targets::revision(&config, "revision")
            != crate::targets::revision(o, "connection_revision")
        || config["enabled"] != true
        || !config["retired_at"].is_null();
    let superseded = o["operation"] == "DISCOVER" && latest["id"] != o["id"];
    let unavailable = digest.is_some() && !latest.is_null() && latest["identity_digest"].is_null();
    let full_scope = manage && config["credential_mode"] == "INSTANCE_MASTER";
    let allowed = |owner: &Value| {
        full_scope
            || owner
                .as_str()
                .is_some_and(|s| owners.iter().any(|o| o == s))
    };
    let schemas: Vec<_> = o["schemas"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|s| allowed(&s["owner"]))
        .cloned()
        .collect();
    let mut verification = o["verification_acceptance"].clone();
    if let Some(owners) = verification["schemaOwners"].as_array() {
        verification["schemaOwners"] =
            json!(owners.iter().filter(|o| allowed(o)).collect::<Vec<_>>());
    }
    let mapped = projects::map_row(o);
    Ok(
        json!({"id":o["id"],"operation":o["operation"],"status":o["status"],"identity":o["identity"],"identityDigest":o["identity_digest"],
        "identityState":if conflict {"CONFLICT"} else if expired || superseded {"STALE"} else if digest.is_some() {"OBSERVED"} else {"UNKNOWN"},
        "schemas":schemas,"limitations":o["limitations"],"provenance":o["provenance"],"verificationAcceptance":verification,
        "observedAt":mapped["observedAt"],"expiresAt":mapped["expiresAt"],
        "currentness":if conflict {"CONFLICT"} else if expired || superseded {"STALE"} else if unavailable {"UNKNOWN"} else if digest.is_some() {"CURRENT"} else {"UNKNOWN"}}),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reason {
    reason: String,
}

async fn run(
    state: AppState,
    auth: Authenticated,
    path: (String, String),
    body: Reason,
    operation: Operation,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    if !projects::text(&body.reason, 2000)
        || body.reason.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return Err(invalid());
    }
    let (project, connection) = (projects::id(&path.0)?, projects::id(&path.1)?);
    let mut tx = state.pool.begin().await?;
    instances::guard(&mut tx, &auth, project).await?;
    let captured = scoped_connection(&mut tx, &auth, project, connection).await?;
    if !captured["retired_at"].is_null() {
        return Err(conflict("CONNECTION_RETIRED"));
    }
    if captured["enabled"] != true || captured["service_kind"] != "SERVICE_NAME" {
        return Err(conflict("CONNECTION_INELIGIBLE"));
    }
    tx.commit().await?;
    let raw = state.discovery.run(&captured, operation).await?;
    let mut normalized = normalize_observation(&raw, operation.name(), Utc::now());
    let mut tx = state.pool.begin().await?;
    if matches!(operation, Operation::Discover) {
        instances::catalog_lock(&mut tx).await?;
    }
    instances::guard(&mut tx, &auth, project).await?;
    let current = scoped_connection(&mut tx, &auth, project, connection).await?;
    if !current["retired_at"].is_null() {
        return Err(conflict("CONNECTION_RETIRED"));
    }
    if current["revision"] != captured["revision"] || current["enabled"] != true {
        return Err(conflict("CONNECTION_REVISION_CONFLICT"));
    }
    if !normalized["identity"].is_null() {
        let container = row_id(&current, "container_id")?;
        let kind: String =
            sqlx::query_scalar("SELECT kind FROM sf_reference_containers WHERE id=$1")
                .bind(container)
                .fetch_one(&mut *tx)
                .await?;
        let topology_matches = if normalized["identity"]["cdb"] == true {
            kind == "PDB"
        } else {
            kind == "NON_CDB"
        };
        let identity_matches = !matches!(operation, Operation::Discover)
            || current["credential_mode"] != "INSTANCE_MASTER"
            || identity_current(&mut tx, container, &normalized["identity"]).await?;
        if !topology_matches || !identity_matches {
            normalized["status"] = "PARTIAL".into();
            let codes = normalized["limitations"]
                .as_array_mut()
                .expect("normalized limitations");
            if !codes.iter().any(|c| c == "IDENTITY_MISMATCH") {
                codes.push("IDENTITY_MISMATCH".into());
            }
            normalized["verificationAcceptance"] = Value::Null;
        }
    }
    let identity = (!normalized["identity"].is_null()).then(|| normalized["identity"].clone());
    let verification = (!normalized["verificationAcceptance"].is_null())
        .then(|| normalized["verificationAcceptance"].clone());
    let o: Value = sqlx::query_scalar("INSERT INTO sf_database_observations(organization_id,connection_id,operation,status,identity,identity_digest,schemas,limitations,provenance,verification_acceptance,actor_id,connection_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING to_jsonb(sf_database_observations)")
        .bind(ORG_UUID).bind(connection).bind(operation.name()).bind(normalized["status"].as_str()).bind(identity).bind(normalized["identityDigest"].as_str()).bind(&normalized["schemas"]).bind(&normalized["limitations"]).bind(normalized["provenance"].as_str()).bind(verification).bind(&auth.actor.id).bind(current["revision"].as_i64().ok_or_else(invalid)?).fetch_one(&mut *tx).await?;
    instances::audited(
        &mut tx,
        &auth,
        project,
        connection,
        match operation {
            Operation::Test => "CONNECTIVITY_TESTED",
            Operation::Discover => "DATABASE_DISCOVERED",
            Operation::Schema => return Err(invalid()),
        },
        json!({"observationId":o["id"],"status":o["status"],"identityDigest":o["identity_digest"]}),
    )
    .await?;
    let public = public_observation(&mut tx, &o, project, true).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"observation":public}))))
}

pub async fn test(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(path): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Reason>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    run(state, auth, path, body, Operation::Test).await
}
pub async fn discover(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(path): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Reason>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    run(state, auth, path, body, Operation::Discover).await
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    after: Option<String>,
}
pub async fn observations(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(path): Path<(String, String)>,
    Query(page): Query<Page>,
) -> ApiResult<Value> {
    let (project, connection) = (projects::id(&path.0)?, projects::id(&path.1)?);
    let after = page
        .after
        .as_deref()
        .map(projects::id)
        .transpose()
        .map_err(|_| invalid())?;
    let mut tx = state.pool.begin().await?;
    let manage = read_guard(&mut tx, &auth, project).await?;
    scoped_connection(&mut tx, &auth, project, connection).await?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(o) FROM sf_database_observations o WHERE connection_id=$1 AND ($2::uuid IS NULL OR id<$2) ORDER BY id DESC LIMIT 51").bind(connection).bind(after).fetch_all(&mut *tx).await?;
    let next = if rows.len() > 50 {
        rows[49]["id"].clone()
    } else {
        Value::Null
    };
    let mut public = Vec::new();
    for o in rows.iter().take(50) {
        public.push(public_observation(&mut tx, o, project, manage).await?);
    }
    tx.commit().await?;
    Ok(Json(json!({"observations":public,"nextCursor":next})))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::Semaphore;

    struct Blocking {
        entered: Arc<Semaphore>,
        release: Arc<Semaphore>,
    }
    impl DiscoveryRuntime for Blocking {
        fn run(&self, _: Value, _: Operation) -> RuntimeResult {
            let entered = self.entered.clone();
            let release = self.release.clone();
            Box::pin(async move {
                entered.add_permits(1);
                release.acquire().await.expect("release").forget();
                Err(())
            })
        }
    }
    fn connection() -> Value {
        json!({"id":Uuid::new_v4(),"engine":"oracle","revision":1})
    }
    async fn idle(discovery: &Discovery) {
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                if discovery.running.lock().expect("running").is_empty() {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("adapter settled");
    }
    #[tokio::test]
    async fn native_socket_adapter_preserves_retained_revision_and_schema_owner() {
        use std::os::unix::fs::MetadataExt;
        struct Fixture(Arc<Mutex<Option<kelryvo_discovery::Request>>>);
        impl kelryvo_discovery::Handler for Fixture {
            fn run(
                &self,
                request: kelryvo_discovery::Request,
                _: tokio::sync::watch::Receiver<bool>,
            ) -> kelryvo_discovery::HandlerResult {
                *self.0.lock().unwrap() = Some(request);
                Box::pin(async {
                    Ok(
                        json!({"status":"PARTIAL","provenance":"FIXTURE","schema":{"owner":"APP","objects":[],"coverage":{},"limitations":[]}}),
                    )
                })
            }
        }
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.cache")
            .canonicalize()
            .unwrap()
            .join(format!("dc-{}.sock", Uuid::new_v4()));
        let uid = std::fs::metadata("/proc/self").unwrap().uid();
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let seen = Arc::new(Mutex::new(None));
        let (stop, stopped) = tokio::sync::watch::channel(false);
        let server = tokio::spawn(kelryvo_discovery::serve(
            listener,
            uid,
            Arc::new(Fixture(seen.clone())),
            stopped,
            kelryvo_discovery::Limits::default(),
        ));
        let client = kelryvo_discovery::Client::new(path, uid, Duration::from_secs(1)).unwrap();
        let discovery = Discovery::new(Arc::new(client), Duration::from_secs(1));
        let c = json!({"id":Uuid::new_v4(),"revision":9223372036854775807_i64,"engine":"oracle","host":"127.0.0.1","port":2484,"service":"APP","transport":"TCPS","username":"APP","credential_ref":"vault://kelryvo/retained","credential_mode":"INSTANCE_MASTER"});
        let result = discovery.schema(&c, "APP").await.unwrap();
        assert_eq!(result["schema"]["owner"], "APP");
        let observed = seen.lock().unwrap().clone().unwrap();
        assert_eq!(observed.connection.revision, "9223372036854775807");
        assert_eq!(observed.owner.as_deref(), Some("APP"));
        assert_eq!(observed.operation, kelryvo_discovery::Operation::Schema);
        assert!(result["verificationAcceptance"].is_null());
        stop.send(true).unwrap();
        server.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn timeouts_keep_per_connection_and_global_capacity_until_work_settles() {
        let release = Arc::new(Semaphore::new(0));
        let discovery = Discovery::new(
            Arc::new(Blocking {
                entered: Arc::new(Semaphore::new(0)),
                release: release.clone(),
            }),
            Duration::from_millis(25),
        );
        let first = connection();
        assert_eq!(
            discovery
                .run(&first, Operation::Discover)
                .await
                .expect("timeout")["status"],
            "TIMEOUT"
        );
        assert_eq!(
            discovery
                .run(&first, Operation::Test)
                .await
                .expect_err("per connection busy")
                .1,
            "DISCOVERY_BUSY"
        );
        assert_eq!(
            discovery
                .run(&connection(), Operation::Test)
                .await
                .expect("second timeout")["status"],
            "TIMEOUT"
        );
        assert_eq!(
            discovery
                .run(&connection(), Operation::Discover)
                .await
                .expect_err("global busy")
                .0,
            StatusCode::TOO_MANY_REQUESTS
        );
        release.add_permits(2);
        idle(&discovery).await;
        release.add_permits(1);
        assert_eq!(
            discovery
                .run(&first, Operation::Test)
                .await
                .expect("capacity restored")["status"],
            "UNAVAILABLE"
        );
    }

    #[tokio::test]
    async fn cancelling_the_http_future_does_not_release_running_adapter_capacity() {
        let entered = Arc::new(Semaphore::new(0));
        let release = Arc::new(Semaphore::new(0));
        let discovery = Discovery::new(
            Arc::new(Blocking {
                entered: entered.clone(),
                release: release.clone(),
            }),
            Duration::from_secs(10),
        );
        let first = connection();
        let request = tokio::spawn({
            let discovery = discovery.clone();
            let first = first.clone();
            async move { discovery.run(&first, Operation::Discover).await }
        });
        tokio::time::timeout(Duration::from_secs(2), entered.acquire())
            .await
            .expect("entered")
            .expect("permit")
            .forget();
        request.abort();
        assert!(request.await.expect_err("cancelled").is_cancelled());
        assert_eq!(
            discovery
                .run(&first, Operation::Discover)
                .await
                .expect_err("adapter still running")
                .1,
            "DISCOVERY_BUSY"
        );
        release.add_permits(1);
        idle(&discovery).await;
    }
}
