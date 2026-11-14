//! Revisioned configuration; offline preflight never opens an Oracle session.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict,
    connections::public_connection,
    instances, invalid, not_found, projects, targets,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use regex::Regex;
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::sync::LazyLock;
use uuid::Uuid;
#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Deploy,
    Discovery,
}
impl Kind {
    fn name(self) -> &'static str {
        if self == Self::Deploy {
            "DEPLOY"
        } else {
            "DISCOVERY"
        }
    }
}
fn text(v: &Value) -> &str {
    v.as_str().unwrap_or_default()
}
fn trim(v: &Value) -> &str {
    text(v).trim_matches(kelryvo_core::js_whitespace)
}
fn safe(v: &Value, max: usize, empty: bool) -> bool {
    v.as_str().is_some_and(|s| {
        s.encode_utf16().count() <= max
            && (empty || !trim(v).is_empty())
            && !s
                .chars()
                .any(|c| c <= '\u{1f}' || ('\u{7f}'..='\u{9f}').contains(&c))
    })
}
fn matches(pattern: &LazyLock<Regex>, v: &Value) -> bool {
    v.as_str().is_some_and(|s| pattern.is_match(s))
}
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
fn port(v: &Value) -> Option<i32> {
    v.as_f64()
        .filter(|n| n.is_finite() && n.fract() == 0.0 && (1.0..=65535.0).contains(n))
        .map(|n| n as i32)
}
fn endpoint(b: &Value, host_limit: usize) -> bool {
    text(&b["host"]).len() <= host_limit
        && matches(&HOST, &b["host"])
        && port(&b["port"]).is_some()
        && matches(&SERVICE, &b["service"])
        && matches(&USER, &b["username"])
        && ["SERVICE_NAME", "SID"].contains(&text(&b["serviceKind"]))
}
fn revision(v: &Value) -> Option<i64> {
    let s = v.as_str()?;
    if !s.starts_with(|c: char| c.is_ascii_digit() && c != '0')
        || s.len() > 19
        || !s.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    s.parse::<i64>().ok().filter(|n| *n < i64::MAX)
}
fn database(e: sqlx::Error) -> ApiError {
    if e.as_database_error()
        .is_some_and(|e| matches!(e.code().as_deref(), Some("23503" | "23505")))
    {
        conflict("CONNECTION_REFERENCE_CONFLICT")
    } else {
        e.into()
    }
}
async fn guard(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    id: Uuid,
    kind: Kind,
    manage: bool,
) -> Result<(Value, bool, Value), ApiError> {
    instances::catalog_lock(tx).await?;
    if manage {
        auth::guard_mutation(tx, auth, Some(project), Some("developer")).await?;
    } else {
        projects::guard_read(tx, auth, project).await?;
    }
    let p:Value=sqlx::query_scalar("SELECT jsonb_build_object('name',name,'archived_at',archived_at) FROM sf_projects WHERE id=$1 AND organization_id=$2 FOR UPDATE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    let workspace=kind==Kind::Deploy || sqlx::query("SELECT 1 FROM sf_workspace_database_grants WHERE organization_id=$1 AND actor_id=$2 AND revoked_at IS NULL").bind(ORG_UUID).bind(&auth.actor.id).fetch_optional(&mut *tx).await?.is_some();
    let can_manage = auth.actor.role == "developer" && workspace && p["archived_at"].is_null();
    if manage {
        if !workspace {
            return Err(ApiError(
                StatusCode::FORBIDDEN,
                "DATABASE_MANAGEMENT_REQUIRED",
            ));
        }
        if !p["archived_at"].is_null() {
            return Err(conflict("PROJECT_ARCHIVED"));
        }
    }
    let row: Option<Value> = if kind == Kind::Deploy {
        sqlx::query_scalar("SELECT to_jsonb(p)||jsonb_build_object('revision',revision::text) FROM sf_profiles p WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR UPDATE").bind(id).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?
    } else {
        sqlx::query_scalar("SELECT to_jsonb(c)||jsonb_build_object('revision',c.revision::text) FROM sf_database_connections c JOIN sf_database_connection_projects p ON p.connection_id=c.id WHERE c.id=$1 AND c.organization_id=$3 AND p.project_id=$2 AND (c.credential_mode='INSTANCE_MASTER' AND $4 OR EXISTS(SELECT 1 FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id WHERE s.container_id=c.container_id AND a.project_id=p.project_id AND a.closed_at IS NULL)) FOR UPDATE OF c").bind(id).bind(project).bind(ORG_UUID).bind(workspace).fetch_optional(&mut *tx).await?
    };
    let mut c = row.ok_or_else(not_found)?;
    if manage
        && kind == Kind::Deploy
        && sqlx::query("SELECT 1 FROM sf_instance_profile_sources WHERE profile_id=$1")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?
            .is_some()
    {
        return Err(conflict("INSTANCE_PROFILE_MANAGED"));
    }
    if kind == Kind::Discovery {
        c["environment"] = sqlx::query_scalar::<_, Value>(
            "SELECT to_jsonb(environment) FROM sf_reference_containers WHERE id=$1",
        )
        .bind(projects::id(text(&c["container_id"]))?)
        .fetch_optional(&mut *tx)
        .await?
        .unwrap_or(Value::Null);
    }
    Ok((c, can_manage, p))
}
pub(crate) async fn discovery_readiness(
    tx: &mut PgConnection,
    c: &Value,
    project: Uuid,
) -> Result<Value, ApiError> {
    readiness(tx, c, Kind::Discovery, project).await
}
async fn readiness(
    tx: &mut PgConnection,
    c: &Value,
    kind: Kind,
    project: Uuid,
) -> Result<Value, ApiError> {
    let id = projects::id(text(&c["id"]))?;
    let metadata = if kind == Kind::Deploy {
        sqlx::query("SELECT 1 FROM sf_target_options o JOIN sf_target_option_revisions r ON r.option_id=o.id AND r.revision=o.current_revision WHERE r.profile_id=$1 AND r.profile_revision=$2 AND o.enabled").bind(id).bind(revision(&c["revision"]).unwrap_or(i64::MAX)).fetch_optional(&mut *tx).await?.is_some()
    } else {
        sqlx::query("SELECT 1 FROM sf_reference_services r JOIN sf_reference_containers t ON t.id=r.container_id WHERE r.id=$1 AND t.id=$2 AND t.kind IN ('PDB','NON_CDB')").bind(projects::id(text(&c["route_id"]))?).bind(projects::id(text(&c["container_id"]))?).fetch_optional(&mut *tx).await?.is_some()
    };
    let checks = json!([
        {"code":"CONFIGURATION_COMPLETE","passed":!text(&c["name"]).is_empty()&&!text(&c["host"]).is_empty()&&c["port"].as_i64().is_some_and(|p|(1..=65535).contains(&p))&&!text(&c["service"]).is_empty()&&!text(&c["username"]).is_empty()},
        {"code":"CREDENTIAL_REFERENCE_PRESENT","passed":matches(&REFERENCE,&c["credential_ref"])},
        {"code":"ENGINE_SUPPORTED","passed":c["engine"]=="oracle"},
        {"code":"TOPOLOGY_SUPPORTED","passed":c["service_kind"]=="SERVICE_NAME"},
        {"code":"TARGET_METADATA_PRESENT","passed":metadata},
        {"code":"REVISION_CURRENT","passed":text(&c["revision"]).parse::<i64>().is_ok_and(|n|n>0)},
        {"code":"LIFECYCLE_ELIGIBLE","passed":c["enabled"]==true&&c["retired_at"].is_null()}
    ]);
    let eligible = checks
        .as_array()
        .expect("checks")
        .iter()
        .all(|c| c["passed"] == true);
    let stored:Option<String>=sqlx::query_scalar("SELECT state FROM sf_connection_preflights WHERE kind=$1 AND resource_id=$2 AND revision=$3 ORDER BY created_at DESC,id DESC LIMIT 1").bind(kind.name()).bind(id).bind(text(&c["revision"]).parse::<i64>().map_err(|_|invalid())?).fetch_optional(&mut *tx).await?;
    let (mut observed, mut discovery) = (Value::Null, Value::Null);
    let mut accepted = false;
    if kind == Kind::Discovery {
        observed=sqlx::query_scalar("SELECT jsonb_build_object('status',status,'provenance',provenance,'observed_at',observed_at,'limitations',limitations,'fresh',expires_at>clock_timestamp()) FROM sf_database_observations WHERE connection_id=$1 AND connection_revision=$2 ORDER BY observed_at DESC,id DESC LIMIT 1").bind(id).bind(text(&c["revision"]).parse::<i64>().map_err(|_|invalid())?).fetch_optional(&mut *tx).await?.unwrap_or(Value::Null);
        discovery=sqlx::query_scalar("SELECT jsonb_build_object('identity',identity,'schemas',schemas,'verification_acceptance',verification_acceptance,'limitations',limitations,'provenance',provenance,'fresh',expires_at>clock_timestamp()) FROM sf_database_observations WHERE connection_id=$1 AND connection_revision=$2 AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1").bind(id).bind(text(&c["revision"]).parse::<i64>().map_err(|_|invalid())?).fetch_optional(&mut *tx).await?.unwrap_or(Value::Null);
        let owners:Vec<String>=sqlx::query_scalar("SELECT s.exact_owner FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id WHERE s.container_id=$1 AND a.project_id=$2 AND a.closed_at IS NULL").bind(projects::id(text(&c["container_id"]))?).bind(project).fetch_all(&mut *tx).await?;
        accepted = discovery["provenance"] == "ORACLE_READ_ONLY"
            && discovery["limitations"]
                .as_array()
                .is_some_and(|l| l.iter().all(|c| c == "SCHEMA_VISIBILITY_LIMITED"))
            && owners.iter().any(|owner| {
                kelryvo_core::evidence::accepted_observation(
                    &discovery["identity"],
                    &discovery["verification_acceptance"],
                    Some(owner),
                    chrono::Utc::now(),
                ) && discovery["schemas"].as_array().is_some_and(|schemas| {
                    schemas
                        .iter()
                        .any(|s| s["owner"] == *owner && s["accessible"] == true)
                })
            });
    }
    let connected = eligible
        && observed["fresh"] == true
        && observed["provenance"] == "ORACLE_READ_ONLY"
        && ["CONNECTED", "OBSERVED", "PARTIAL"].contains(&text(&observed["status"]));
    let verified = connected && discovery["fresh"] == true && accepted;
    let failed = observed["fresh"] == true
        && ["UNREACHABLE", "UNAUTHORIZED", "MISCONFIGURED", "TIMEOUT"]
            .contains(&text(&observed["status"]));
    let state = if verified {
        "CONNECTED_VERIFIED"
    } else if !eligible || failed {
        "FAILED"
    } else if connected {
        "CONNECTED"
    } else if observed.is_object()
        && !["CONNECTED", "OBSERVED", "PARTIAL"].contains(&text(&observed["status"]))
    {
        "UNVERIFIED"
    } else if stored.as_deref() == Some("PREFLIGHT_PASSED") {
        "PREFLIGHT_PASSED"
    } else {
        "CONFIGURED"
    };
    let limitations = observed["limitations"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut limitations = limitations;
    if !metadata {
        limitations.push(json!("TARGET_METADATA_REQUIRES_OPERATOR_CONFIGURATION"));
    }
    if c["service_kind"] == "SID" {
        limitations.push(json!("SID_RUNTIME_UNSUPPORTED"));
    }
    limitations.push(json!("PREFLIGHT_DOES_NOT_CONNECT_TO_ORACLE"));
    if !verified {
        limitations.extend([
            json!("ORACLE_ACCESS_UNVERIFIED"),
            json!("CREDENTIAL_REFERENCE_REQUIRES_TRUSTED_OPERATOR"),
        ]);
    }
    let identity = if !discovery.is_object() {
        "NOT_OBSERVED"
    } else if discovery["limitations"]
        .as_array()
        .is_some_and(|l| l.contains(&json!("IDENTITY_MISMATCH")))
    {
        "CONFLICT"
    } else if !eligible || discovery["fresh"] != true {
        "STALE"
    } else if discovery["identity"].is_null() {
        "UNKNOWN"
    } else if accepted {
        "VERIFIED"
    } else {
        "OBSERVED"
    };
    Ok(
        json!({"state":state,"configurationValid":eligible,"connectivityStatus":if observed.is_object(){if observed["fresh"]==true{observed["status"].clone()}else{json!("STALE")}}else{json!("NOT_RUN")},"lastCheckedAt":projects::date(&observed["observed_at"]),"identityState":identity,"checks":checks,"limitations":limitations}),
    )
}
async fn read(
    state: AppState,
    auth: Authenticated,
    project: String,
    id: String,
    kind: Kind,
) -> ApiResult<Value> {
    let (project, id) = (projects::id(&project)?, projects::id(&id)?);
    let mut tx = state.pool.begin().await?;
    let (c, can_manage, p) = guard(&mut tx, &auth, project, id, kind, false).await?;
    let revisions:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('configuration',configuration,'created_at',created_at) FROM sf_connection_revisions WHERE kind=$1 AND resource_id=$2 ORDER BY revision DESC LIMIT 100").bind(kind.name()).bind(id).fetch_all(&mut *tx).await?;
    let revisions: Vec<Value> = revisions
        .iter()
        .map(|r| {
            let mut public = public_connection(&r["configuration"], kind.name());
            public["createdAt"] = projects::date(&r["created_at"]);
            if let Some(retired) = r["configuration"].get("retired_at") {
                public["retiredAt"] = retired.clone();
            }
            public
        })
        .collect();
    let (schemas, environments): (Vec<Value>, Vec<Value>) = if kind == Kind::Deploy {
        (sqlx::query_scalar("SELECT DISTINCT jsonb_build_object('owner',exact_owner,'assignmentId',assignment_id) FROM sf_target_option_revisions WHERE profile_id=$1 AND project_id=$2").bind(id).bind(project).fetch_all(&mut *tx).await?,sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',name) FROM sf_environments WHERE project_id=$1").bind(project).fetch_all(&mut *tx).await?)
    } else {
        let container = projects::id(text(&c["container_id"]))?;
        (sqlx::query_scalar("SELECT jsonb_build_object('owner',s.exact_owner,'assignmentId',a.id) FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id WHERE s.container_id=$1 AND a.project_id=$2 AND a.closed_at IS NULL").bind(container).bind(project).fetch_all(&mut *tx).await?,sqlx::query_scalar("SELECT jsonb_build_object('id',id,'name',environment) FROM sf_reference_containers WHERE id=$1").bind(container).fetch_all(&mut *tx).await?)
    };
    let ready = readiness(&mut tx, &c, kind, project).await?;
    let result = json!({"connection":public_connection(&c,kind.name()),"revisions":revisions,"readiness":ready,"canManage":can_manage,"related":{"projects":[{"id":project,"name":p["name"]}],"schemas":schemas,"environments":environments}});
    tx.commit().await?;
    Ok(Json(result))
}
async fn audit(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    c: &Value,
    kind: Kind,
    action: &str,
    mut facts: Value,
) -> Result<(), ApiError> {
    facts["revision"] = targets::revision(c, "revision");
    let discovery_facts = facts.clone();
    facts["purpose"] = kind.name().into();
    let id = projects::id(text(&c["id"]))?;
    projects::append_audit(tx, auth, project, action, id, facts).await?;
    if kind == Kind::Discovery {
        sqlx::query("INSERT INTO sf_database_connection_audit(organization_id,project_id,connection_id,actor_id,action,facts) VALUES($1,$2,$3,$4,$5,$6)").bind(ORG_UUID).bind(project).bind(id).bind(&auth.actor.id).bind(action).bind(discovery_facts).execute(tx).await?;
    }
    Ok(())
}
async fn mutate(
    state: AppState,
    auth: Authenticated,
    project: String,
    id: String,
    kind: Kind,
    operation: &str,
    b: Value,
) -> ApiResult<Value> {
    let keys = match operation {
        "configuration" => &[
            "expectedRevision",
            "name",
            "description",
            "environmentId",
            "host",
            "port",
            "service",
            "serviceKind",
            "username",
            "credentialRef",
            "reason",
        ][..],
        "lifecycle" => &["expectedRevision", "action", "reason"][..],
        _ => &["expectedRevision", "reason"][..],
    };
    if !kelryvo_core::plan::keys(&b, keys)
        || revision(&b["expectedRevision"]).is_none()
        || !safe(&b["reason"], 2000, false)
    {
        return Err(invalid());
    }
    let (project, id) = (projects::id(&project)?, projects::id(&id)?);
    let mut tx = state.pool.begin().await?;
    let (c, _, _) = guard(&mut tx, &auth, project, id, kind, true).await?;
    if c["revision"] != b["expectedRevision"] {
        return Err(conflict("CONNECTION_REVISION_CONFLICT"));
    }
    if operation == "preflight" {
        let mut r = readiness(&mut tx, &c, kind, project).await?;
        let passed = r["checks"]
            .as_array()
            .is_some_and(|c| c.iter().all(|c| c["passed"] == true));
        let status = if passed { "PREFLIGHT_PASSED" } else { "FAILED" };
        sqlx::query("INSERT INTO sf_connection_preflights(kind,resource_id,revision,state,checks,actor_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)").bind(kind.name()).bind(id).bind(revision(&c["revision"]).ok_or_else(invalid)?).bind(status).bind(&r["checks"]).bind(&auth.actor.id).bind(trim(&b["reason"])).execute(&mut *tx).await.map_err(database)?;
        audit(
            &mut tx,
            &auth,
            project,
            &c,
            kind,
            "CONNECTION_PREFLIGHT_CHECKED",
            json!({"state":status,"reason":b["reason"]}),
        )
        .await?;
        r["state"] = status.into();
        tx.commit().await?;
        return Ok(Json(
            json!({"connection":public_connection(&c,kind.name()),"readiness":r}),
        ));
    }
    if !c["retired_at"].is_null() {
        return Err(conflict("CONNECTION_RETIRED"));
    }
    let hold = b["action"] != "RETIRE";
    let active = if kind == Kind::Deploy {
        sqlx::query("SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id WHERE p.profile_id=$1 AND (j.state='ADMITTED' OR j.state='HOLD' AND $2) LIMIT 1").bind(id).bind(hold).fetch_optional(&mut *tx).await?.is_some()
    } else {
        sqlx::query("SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id JOIN sf_target_option_revisions r ON r.profile_id=p.profile_id JOIN sf_target_identity_evidence e ON e.digest=r.observation_digest WHERE e.connection_id=$1 AND (j.state='ADMITTED' OR j.state='HOLD' AND $2) LIMIT 1").bind(id).bind(hold).fetch_optional(&mut *tx).await?.is_some()
    };
    if active {
        return Err(conflict("CONNECTION_EXECUTION_ACTIVE"));
    }
    let (mut updated, action) = if operation == "configuration" {
        if text(&b["credentialRef"]).starts_with("vault://kelryvo/")
            && b["credentialRef"] != c["credential_ref"]
        {
            return Err(ApiError(
                StatusCode::BAD_REQUEST,
                "MANAGED_CREDENTIAL_REQUIRED",
            ));
        }
        if !safe(
            &b["name"],
            if kind == Kind::Deploy { 200 } else { 120 },
            false,
        ) || !safe(&b["description"], 2000, true)
            || !endpoint(&b, 253)
            || !b["credentialRef"].is_null() && !matches(&REFERENCE, &b["credentialRef"])
            || b.get("credentialRef").is_none()
            || kind == Kind::Deploy && !kelryvo_core::uuid(&b["environmentId"])
            || kind == Kind::Discovery && b.get("environmentId").is_some()
        {
            return Err(invalid());
        }
        let reference = if b["credentialRef"].is_null() {
            text(&c["credential_ref"])
        } else {
            text(&b["credentialRef"])
        };
        let row: Value = if kind == Kind::Deploy {
            let environment = projects::id(text(&b["environmentId"]))?;
            if sqlx::query("SELECT 1 FROM sf_environments WHERE id=$1 AND project_id=$2")
                .bind(environment)
                .bind(project)
                .fetch_optional(&mut *tx)
                .await?
                .is_none()
            {
                return Err(not_found());
            }
            sqlx::query_scalar("UPDATE sf_profiles SET name=$1,description=$2,environment_id=$3,host=$4,port=$5,service=$6,service_kind=$7,username=$8,credential_ref=$9 WHERE id=$10 RETURNING to_jsonb(sf_profiles)||jsonb_build_object('revision',revision::text)").bind(trim(&b["name"])).bind(text(&b["description"])).bind(environment).bind(text(&b["host"]).to_ascii_lowercase()).bind(port(&b["port"])).bind(text(&b["service"])).bind(text(&b["serviceKind"])).bind(text(&b["username"])).bind(reference).bind(id).fetch_one(&mut *tx).await.map_err(database)?
        } else {
            let existing:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_reference_services r WHERE organization_id=$1 AND host=$2 AND port=$3 AND service=$4 AND transport=$5").bind(ORG_UUID).bind(text(&b["host"]).to_ascii_lowercase()).bind(port(&b["port"])).bind(text(&b["service"])).bind(text(&c["transport"])).fetch_optional(&mut *tx).await?;
            let route = if let Some(route) = existing {
                if route["container_id"] != c["container_id"] {
                    return Err(conflict("CONNECTION_REFERENCE_CONFLICT"));
                }
                route
            } else {
                sqlx::query_scalar("INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(sf_reference_services)").bind(ORG_UUID).bind(projects::id(text(&c["container_id"]))?).bind(text(&b["host"]).to_ascii_lowercase()).bind(port(&b["port"])).bind(text(&b["service"])).bind(text(&c["transport"])).fetch_one(&mut *tx).await.map_err(database)?
            };
            sqlx::query_scalar("UPDATE sf_database_connections SET name=$1,description=$2,route_id=$3,host=$4,port=$5,service=$6,service_kind=$7,username=$8,credential_ref=$9,revision=revision+1 WHERE id=$10 RETURNING to_jsonb(sf_database_connections)||jsonb_build_object('revision',revision::text)").bind(trim(&b["name"])).bind(text(&b["description"])).bind(projects::id(text(&route["id"]))?).bind(text(&route["host"])).bind(route["port"].as_i64()).bind(text(&route["service"])).bind(text(&b["serviceKind"])).bind(text(&b["username"])).bind(reference).bind(id).fetch_one(&mut *tx).await.map_err(database)?
        };
        (row, "CONNECTION_CONFIGURATION_UPDATED")
    } else {
        if !["ENABLE", "DISABLE", "RETIRE"].contains(&text(&b["action"])) {
            return Err(invalid());
        }
        let retire = b["action"] == "RETIRE";
        let enabled = b["action"] == "ENABLE";
        if !retire && c["enabled"] == enabled {
            return Err(conflict("CONNECTION_STATUS_UNCHANGED"));
        }
        let row: Value = if kind == Kind::Deploy {
            sqlx::query_scalar("UPDATE sf_profiles SET enabled=$1,revision=revision+1,retired_at=CASE WHEN $2 THEN clock_timestamp() ELSE retired_at END,retired_by=CASE WHEN $2 THEN $3 ELSE retired_by END,retirement_reason=CASE WHEN $2 THEN $4 ELSE retirement_reason END WHERE id=$5 RETURNING to_jsonb(sf_profiles)||jsonb_build_object('revision',revision::text)").bind(enabled).bind(retire).bind(&auth.actor.id).bind(trim(&b["reason"])).bind(id).fetch_one(&mut *tx).await.map_err(database)?
        } else {
            sqlx::query_scalar("UPDATE sf_database_connections SET enabled=$1,revision=revision+1,retired_at=CASE WHEN $2 THEN clock_timestamp() ELSE retired_at END,retirement_reason=CASE WHEN $2 THEN $3 ELSE retirement_reason END WHERE id=$4 RETURNING to_jsonb(sf_database_connections)||jsonb_build_object('revision',revision::text)").bind(enabled).bind(retire).bind(trim(&b["reason"])).bind(id).fetch_one(&mut *tx).await.map_err(database)?
        };
        (
            row,
            if retire {
                "CONNECTION_RETIRED"
            } else if enabled {
                "CONNECTION_ENABLED"
            } else {
                "CONNECTION_DISABLED"
            },
        )
    };
    if kind == Kind::Discovery {
        updated["environment"] = c["environment"].clone();
    }
    audit(
        &mut tx,
        &auth,
        project,
        &updated,
        kind,
        action,
        json!({"previousRevision":c["revision"],"reason":b["reason"]}),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        json!({"connection":public_connection(&updated,kind.name())}),
    ))
}
/// Retained reason-only endpoint. Retirement is idempotent and never drops a
/// profile, removes HOLD history or dispatches a job. The existing database
/// trigger advances its revision once; repeating retirement changes nothing.
pub async fn retire_profile(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, id)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<StatusCode, ApiError> {
    let (project, id) = (projects::id(&project)?, projects::id(&id)?);
    if !body
        .as_object()
        .is_some_and(|o| o.len() == 1 && o.contains_key("reason"))
        || !safe(&body["reason"], 2000, false)
    {
        return Err(invalid());
    }
    if auth.actor.role != "developer" {
        return Err(ApiError(StatusCode::FORBIDDEN, "DEVELOPER_REQUIRED"));
    }
    let mut tx = state.pool.begin().await?;
    let role = projects::guard_read(&mut tx, &auth, project).await?;
    if role != "developer" {
        return Err(ApiError(StatusCode::FORBIDDEN, "DEVELOPER_REQUIRED"));
    }
    projects::active_project(&mut tx, project).await?;
    let retired: bool = sqlx::query_scalar("SELECT retired_at IS NOT NULL FROM sf_profiles WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR UPDATE")
        .bind(id).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(not_found)?;
    if !retired {
        let active: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_execution_jobs j JOIN sf_plans p ON p.id=j.plan_id AND p.project_id=j.project_id WHERE p.profile_id=$1 AND j.project_id=$2 AND j.organization_id=$3 AND j.state='ADMITTED')")
            .bind(id).bind(project).bind(ORG_UUID).fetch_one(&mut *tx).await?;
        if active {
            return Err(conflict("PROFILE_EXECUTION_ACTIVE"));
        }
        sqlx::query("UPDATE sf_profiles SET retired_at=clock_timestamp(),retired_by=$1,retirement_reason=$2 WHERE id=$3")
            .bind(&auth.actor.id).bind(trim(&body["reason"])).bind(id).execute(&mut *tx).await?;
        projects::append_audit(
            &mut tx,
            &auth,
            project,
            "PROFILE_RETIRED",
            id,
            json!({"reason":trim(&body["reason"])}),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}
macro_rules! handlers {
    ($read:ident,$update:ident,$lifecycle:ident,$preflight:ident,$kind:expr) => {
        pub async fn $read(
            State(state): State<AppState>,
            auth: Authenticated,
            Path((project, id)): Path<(String, String)>,
            Query(query): Query<std::collections::HashMap<String, String>>,
        ) -> ApiResult<Value> {
            if !query.is_empty() {
                return Err(invalid());
            }
            read(state, auth, project, id, $kind).await
        }
        pub async fn $update(
            State(state): State<AppState>,
            auth: Authenticated,
            Path((project, id)): Path<(String, String)>,
            Json(b): Json<Value>,
        ) -> ApiResult<Value> {
            mutate(state, auth, project, id, $kind, "configuration", b).await
        }
        pub async fn $lifecycle(
            State(state): State<AppState>,
            auth: Authenticated,
            Path((project, id)): Path<(String, String)>,
            Json(b): Json<Value>,
        ) -> ApiResult<Value> {
            mutate(state, auth, project, id, $kind, "lifecycle", b).await
        }
        pub async fn $preflight(
            State(state): State<AppState>,
            auth: Authenticated,
            Path((project, id)): Path<(String, String)>,
            Json(b): Json<Value>,
        ) -> ApiResult<Value> {
            mutate(state, auth, project, id, $kind, "preflight", b).await
        }
    };
}
handlers!(
    profile,
    update_profile,
    profile_lifecycle,
    profile_preflight,
    Kind::Deploy
);
handlers!(
    discovery,
    update_discovery,
    discovery_lifecycle,
    discovery_preflight,
    Kind::Discovery
);

pub async fn create_profile(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Json(mut b): Json<Value>,
) -> Result<Response, ApiError> {
    let project = projects::id(&project).map_err(|_| invalid())?;
    if !kelryvo_core::plan::keys(
        &b,
        &[
            "name",
            "environmentId",
            "engine",
            "host",
            "port",
            "service",
            "username",
            "credentialRef",
            "description",
            "serviceKind",
            "purpose",
            "reason",
        ],
    ) || !projects::text(text(&b["name"]), 200)
        || !safe(&b["name"], 2000, true)
        || !kelryvo_core::uuid(&b["environmentId"])
        || b["engine"] != "oracle"
        || b.get("description").is_some_and(|v| !safe(v, 2000, true))
        || b.get("purpose").is_some_and(|v| v != "DEPLOY")
        || b.get("reason")
            .is_some_and(|v| !kelryvo_core::plan::reason(v, 2000))
        || !matches(&REFERENCE, &b["credentialRef"])
    {
        return Err(invalid());
    }
    if b.get("serviceKind").is_none() {
        b["serviceKind"] = "SERVICE_NAME".into();
    }
    if !endpoint(&b, 255) {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    projects::active_project(&mut tx, project).await?;
    let environment = projects::id(text(&b["environmentId"]))?;
    if sqlx::query("SELECT 1 FROM sf_environments WHERE id=$1 AND project_id=$2")
        .bind(environment)
        .bind(project)
        .fetch_optional(&mut *tx)
        .await?
        .is_none()
    {
        return Err(ApiError(StatusCode::BAD_REQUEST, "INVALID_REFERENCE"));
    }
    let row:Value=sqlx::query_scalar("INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref,description,service_kind) VALUES($1,$2,$3,$4,'oracle',$5,$6,$7,$8,$9,$10,$11) RETURNING to_jsonb(sf_profiles)||jsonb_build_object('revision',revision::text)").bind(project).bind(ORG_UUID).bind(environment).bind(trim(&b["name"])).bind(text(&b["host"])).bind(port(&b["port"])).bind(text(&b["service"])).bind(text(&b["username"])).bind(text(&b["credentialRef"])).bind(text(&b["description"])).bind(text(&b["serviceKind"])).fetch_one(&mut *tx).await.map_err(database)?;
    projects::append_audit(
        &mut tx,
        &auth,
        project,
        "PROFILE_CREATED",
        projects::id(text(&row["id"]))?,
        json!({"revision":"1","purpose":"DEPLOY","reason":b["reason"]}),
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"profile":public_connection(&row,"DEPLOY")})),
    )
        .into_response())
}
