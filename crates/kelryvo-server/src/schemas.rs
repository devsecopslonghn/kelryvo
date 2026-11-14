//! Immutable object observations, baselines and diagnostic drift comparisons.
//! None of these routes grant execution authority or infer unobserved absence.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth::Authenticated, conflict, discovery, instances,
    invalid, not_found, plans, projects, targets,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use chrono::Utc;
use kelryvo_core::{evidence, schema};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;
fn unavailable() -> ApiError {
    conflict("SCHEMA_SNAPSHOT_UNAVAILABLE")
}

async fn load(tx: &mut PgConnection, project: Uuid, id: Uuid) -> Result<Value, ApiError> {
    let row:Value=sqlx::query_scalar("SELECT CASE WHEN octet_length(to_jsonb(s)::text)<=3145728 THEN to_jsonb(s) END FROM sf_schema_snapshots s WHERE id=$1 AND project_id=$2 AND organization_id=$3").bind(id).bind(project).bind(ORG_UUID).fetch_optional(tx).await?.ok_or_else(not_found)?;
    if !row["schema"]["objects"].is_array()
        || !row["schema"]["coverage"].is_object()
        || !row["schema"]["limitations"].is_array()
    {
        return Err(unavailable());
    }
    Ok(row)
}
pub fn public(row: &Value, include_schema: bool) -> Result<Value, ApiError> {
    let count = row["schema"]["objects"]
        .as_array()
        .ok_or_else(unavailable)?
        .len();
    let d = projects::map_row(row);
    let mut result = json!({"id":row["id"],"projectId":row["project_id"],"bindingId":row["binding_id"],"bindingRevision":targets::revision(row,"binding_revision"),"assignmentRevision":targets::revision(row,"assignment_revision"),"streamId":row["stream_id"],"routeId":row["route_id"],"connectionId":row["connection_id"],"connectionRevision":targets::revision(row,"connection_revision"),"owner":row["owner"],"identity":row["identity"],"identityDigest":row["identity_digest"],"contentDigest":row["content_digest"],"provenance":row["provenance"],"liveAccepted":row["live_accepted"],"observedAt":d["observedAt"],"reason":row["reason"],"actorId":row["actor_id"],"coverage":row["schema"]["coverage"],"limitations":row["schema"]["limitations"],"objectCount":count});
    if include_schema {
        result["schema"] = row["schema"].clone();
    }
    Ok(result)
}

async fn compare_rows(expected: &Value, observed: &Value) -> Result<Value, ApiError> {
    schema::compare(&public(expected, true)?, &public(observed, true)?).ok_or_else(unavailable)
}
pub async fn drift(
    tx: &mut PgConnection,
    project: Uuid,
    binding: Uuid,
    plan: Option<Uuid>,
) -> Result<Value, ApiError> {
    let latest:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_schema_snapshots WHERE project_id=$1 AND organization_id=$2 AND binding_id=$3 ORDER BY observed_at DESC,id DESC LIMIT 1").bind(project).bind(ORG_UUID).bind(binding).fetch_optional(&mut *tx).await?;
    let latest = match latest {
        Some(id) => Some(load(tx, project, id).await?),
        None => None,
    };
    let baseline:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',b.id,'name',b.name,'snapshot_id',s.id) FROM sf_schema_baselines b JOIN sf_schema_snapshots s ON s.id=b.snapshot_id AND s.organization_id=b.organization_id AND s.project_id=b.project_id WHERE b.project_id=$1 AND b.organization_id=$2 AND s.binding_id=$3 ORDER BY b.created_at DESC,b.id DESC LIMIT 1").bind(project).bind(ORG_UUID).bind(binding).fetch_optional(&mut *tx).await?;
    let mut comparison = Value::Null;
    let baseline = if let Some(b) = baseline {
        if let Some(latest) = &latest {
            comparison = compare_rows(
                &load(tx, project, plans::id(&b["snapshot_id"])?).await?,
                latest,
            )
            .await?;
        }
        json!({"id":b["id"],"name":b["name"],"snapshotId":b["snapshot_id"]})
    } else {
        Value::Null
    };
    let mut retained = Value::Null;
    if let Some(plan) = plan {
        let e:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',snapshot_id,'digest',snapshot_digest) FROM sf_plan_schema_evidence WHERE plan_id=$1 AND project_id=$2 AND organization_id=$3").bind(plan).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
        if let Some(e) = e
            && !e["id"].is_null()
        {
            retained = public(&load(tx, project, plans::id(&e["id"])?).await?, false)?;
            retained["digest"] = e["digest"].clone();
        }
    }
    Ok(
        json!({"latest":latest.as_ref().map(|r|public(r,false)).transpose()?,"baseline":baseline,"comparison":comparison,"retainedSnapshot":retained,"executionAuthority":false}),
    )
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HistoryQuery {
    after: Option<String>,
    baseline_after: Option<String>,
}
pub async fn history(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, binding)): Path<(String, String)>,
    Query(q): Query<HistoryQuery>,
) -> ApiResult<Value> {
    let (project, binding) = (projects::id(&project)?, projects::id(&binding)?);
    let mut tx = state.pool.begin().await?;
    targets::lock(&mut tx, binding).await?;
    let can_manage = discovery::read_guard(&mut tx, &auth, project).await?;
    let detail = targets::detail(&mut tx, project, binding).await?;
    let cursor = q
        .after
        .as_deref()
        .map(projects::id)
        .transpose()
        .map_err(|_| invalid())?;
    if let Some(cursor) = cursor
        && load(&mut tx, project, cursor).await?["binding_id"] != binding.to_string()
    {
        return Err(invalid());
    }
    // Select only identities first. Each bounded row is projected without SQL
    // definitions, so a history page cannot multiply full snapshot payloads.
    let ids:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM sf_schema_snapshots WHERE project_id=$1 AND organization_id=$2 AND binding_id=$3 AND ($4::uuid IS NULL OR (observed_at,id)<(SELECT observed_at,id FROM sf_schema_snapshots WHERE id=$4)) ORDER BY observed_at DESC,id DESC LIMIT 51").bind(project).bind(ORG_UUID).bind(binding).bind(cursor).fetch_all(&mut *tx).await?;
    let mut snapshots = Vec::new();
    let mut bytes = 0;
    for id in ids.iter().take(50) {
        let snapshot = public(&load(&mut tx, project, *id).await?, false)?;
        bytes += snapshot.to_string().len();
        if bytes > kelryvo_core::MAX_STDOUT_BYTES {
            return Err(unavailable());
        }
        snapshots.push(snapshot);
    }
    let baseline_cursor = q
        .baseline_after
        .as_deref()
        .map(projects::id)
        .transpose()
        .map_err(|_| invalid())?;
    if let Some(id) = baseline_cursor {
        let found:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_schema_baselines b JOIN sf_schema_snapshots s ON s.id=b.snapshot_id AND s.organization_id=b.organization_id AND s.project_id=b.project_id WHERE b.id=$1 AND b.project_id=$2 AND b.organization_id=$3 AND s.binding_id=$4)").bind(id).bind(project).bind(ORG_UUID).bind(binding).fetch_one(&mut *tx).await?;
        if !found {
            return Err(invalid());
        }
    }
    let baselines:Vec<Value>=sqlx::query_scalar("SELECT CASE WHEN octet_length(snapshot::text)<=65536 THEN snapshot END FROM (SELECT b.id,b.created_at,jsonb_build_object('id',b.id,'name',b.name,'reason',b.reason,'snapshotId',b.snapshot_id,'created_at',b.created_at,'contentDigest',s.content_digest,'provenance',s.provenance,'coverage',s.schema->'coverage') snapshot FROM sf_schema_baselines b JOIN sf_schema_snapshots s ON s.id=b.snapshot_id AND s.organization_id=b.organization_id AND s.project_id=b.project_id WHERE b.project_id=$1 AND b.organization_id=$2 AND s.binding_id=$3 AND ($4::uuid IS NULL OR (b.created_at,b.id)<(SELECT created_at,id FROM sf_schema_baselines WHERE id=$4)) ORDER BY b.created_at DESC,b.id DESC LIMIT 101) b ORDER BY created_at DESC,id DESC").bind(project).bind(ORG_UUID).bind(binding).bind(baseline_cursor).fetch_all(&mut *tx).await?;
    if baselines.iter().any(|b| !b.is_object()) {
        return Err(unavailable());
    }
    let result = json!({"binding":detail["binding"],"currentness":detail["currentness"],"canManage":can_manage,"snapshots":snapshots,"nextCursor":if ids.len()>50{Some(ids[49])}else{None},"baselines":baselines.iter().take(100).map(projects::map_row).collect::<Vec<_>>(),"baselinesTruncated":baselines.len()>100,"baselineNextCursor":if baselines.len()>100{baselines[99]["id"].clone()}else{Value::Null},"drift":drift(&mut tx,project,binding,None).await?});
    tx.commit().await?;
    Ok(Json(result))
}
pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, snapshot)): Path<(String, String)>,
    Query(_): Query<crate::comparisons::EmptyQuery>,
) -> ApiResult<Value> {
    let (project, snapshot) = (projects::id(&project)?, projects::id(&snapshot)?);
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let snapshot = public(&load(&mut tx, project, snapshot).await?, true)?;
    tx.commit().await?;
    Ok(Json(json!({"snapshot":snapshot})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComparisonQuery {
    expected: String,
    observed: String,
}
pub async fn compare(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Query(q): Query<ComparisonQuery>,
) -> ApiResult<Value> {
    let (project, expected, observed) = (
        projects::id(&project)?,
        projects::id(&q.expected)?,
        projects::id(&q.observed)?,
    );
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let (expected, observed) = (
        load(&mut tx, project, expected).await?,
        load(&mut tx, project, observed).await?,
    );
    if expected["stream_id"] != observed["stream_id"]
        || expected["route_id"] != observed["route_id"]
    {
        return Err(conflict("SCHEMA_TARGET_MISMATCH"));
    }
    let result = json!({"expected":public(&expected,false)?,"observed":public(&observed,false)?,"comparison":compare_rows(&expected,&observed).await?,"executionAuthority":false});
    tx.commit().await?;
    Ok(Json(result))
}
pub async fn baseline(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let project = projects::id(&project)?;
    if !kelryvo_core::plan::keys(&body, &["snapshotId", "name", "reason"])
        || !kelryvo_core::plan::text(&body["name"], 120)
        || !kelryvo_core::plan::text(&body["reason"], 2000)
    {
        return Err(invalid());
    }
    let snapshot = plans::id(&body["snapshotId"])?;
    let mut tx = state.pool.begin().await?;
    instances::guard(&mut tx, &auth, project).await?;
    let s = load(&mut tx, project, snapshot).await?;
    let row:Value=sqlx::query_scalar("INSERT INTO sf_schema_baselines(organization_id,project_id,snapshot_id,name,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING jsonb_build_object('id',id,'name',name,'snapshotId',snapshot_id,'created_at',created_at)").bind(ORG_UUID).bind(project).bind(snapshot).bind(body["name"].as_str().map(|s|s.trim_matches(kelryvo_core::js_whitespace))).bind(body["reason"].as_str().map(|s|s.trim_matches(kelryvo_core::js_whitespace))).bind(&auth.actor.id).fetch_one(&mut *tx).await?;
    instances::audited(
        &mut tx,
        &auth,
        project,
        plans::id(&s["connection_id"])?,
        "SCHEMA_BASELINE_CAPTURED",
        json!({"baselineId":row["id"],"snapshotId":snapshot,"contentDigest":s["content_digest"]}),
    )
    .await?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"baseline":projects::map_row(&row)})),
    ))
}

async fn inspect(
    tx: &mut PgConnection,
    auth: &Authenticated,
    project: Uuid,
    binding: Uuid,
    body: &Value,
) -> Result<(Value, Value), ApiError> {
    targets::lock(tx, binding).await?;
    instances::guard(tx, auth, project).await?;
    let detail = targets::detail(tx, project, binding).await?;
    let t = &detail["binding"];
    if t["bindingRevision"] != body["expectedBindingRevision"]
        || t["assignmentRevision"] != body["expectedAssignmentRevision"]
    {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let c =
        discovery::scoped_connection(tx, auth, project, plans::id(&body["connectionId"])?).await?;
    if c["route_id"] != t["routeId"] {
        return Err(conflict("SCHEMA_TARGET_MISMATCH"));
    }
    if !c["retired_at"].is_null() || c["enabled"] != true || c["service_kind"] != "SERVICE_NAME" {
        return Err(conflict("CONNECTION_INELIGIBLE"));
    }
    if detail["currentness"]["state"] != "CURRENT"
        && !detail["currentness"]["reasons"]
            .as_array()
            .is_some_and(|reasons| {
                reasons.iter().all(|r| {
                    r.as_str().is_some_and(|s| {
                        s.starts_with("OBSERVATION_") || s == "LIVE_VERIFICATION_UNACCEPTED"
                    })
                })
            })
    {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    Ok((c, t.clone()))
}
pub async fn observe(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, binding)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (project, binding) = (projects::id(&project)?, projects::id(&binding)?);
    if !kelryvo_core::plan::keys(
        &body,
        &[
            "connectionId",
            "expectedBindingRevision",
            "expectedAssignmentRevision",
            "reason",
        ],
    ) || !kelryvo_core::uuid(&body["connectionId"])
        || !kelryvo_core::plan::text(&body["reason"], 2000)
        || !["expectedBindingRevision", "expectedAssignmentRevision"]
            .iter()
            .all(|k| {
                body[k]
                    .as_str()
                    .and_then(kelryvo_core::workspace::positive_revision)
                    .is_some()
            })
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    let (c, t) = inspect(&mut tx, &auth, project, binding, &body).await?;
    tx.commit().await?;
    let raw = state
        .discovery
        .schema(&c, t["exactOwner"].as_str().ok_or_else(invalid)?)
        .await?;
    let observation = evidence::normalize_observation(&raw, "DISCOVER", Utc::now());
    let metadata = if observation["identity"].is_null()
        || observation["provenance"] == "UNAVAILABLE"
        || observation["limitations"]
            .as_array()
            .is_some_and(|l| l.iter().any(|l| l == "IDENTITY_MISMATCH"))
    {
        Value::Null
    } else {
        raw["schema"].clone()
    };
    let mut normalized = schema::normalize(&metadata, &t["exactOwner"]);
    if metadata.is_null() {
        let limitations = normalized["limitations"]
            .as_array_mut()
            .ok_or_else(unavailable)?;
        if !limitations.iter().any(|l| l == "IDENTITY_INCOMPLETE") {
            limitations.push("IDENTITY_INCOMPLETE".into());
        }
    }
    let normalized = schema::normalize(&normalized, &t["exactOwner"]);
    let mut tx = state.pool.begin().await?;
    let (current, _) = inspect(&mut tx, &auth, project, binding, &body).await?;
    if current["revision"] != c["revision"] {
        return Err(conflict("CONNECTION_REVISION_CONFLICT"));
    }
    let accepted = observation["provenance"] == "ORACLE_READ_ONLY"
        && evidence::accepted_observation(
            &observation["identity"],
            &observation["verificationAcceptance"],
            t["exactOwner"].as_str(),
            Utc::now(),
        );
    let row:Value=sqlx::query_scalar("INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,verification_acceptance,actor_id,reason) VALUES($1,$2,$3,$4::text::bigint,$5::text::bigint,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING to_jsonb(sf_schema_snapshots)").bind(ORG_UUID).bind(project).bind(binding).bind(t["bindingRevision"].as_str()).bind(t["assignmentRevision"].as_str()).bind(plans::id(&t["streamId"])?).bind(plans::id(&t["routeId"])?).bind(plans::id(&c["id"])?).bind(c["revision"].as_i64().ok_or_else(invalid)?).bind(t["exactOwner"].as_str()).bind((!observation["identity"].is_null()).then(||observation["identity"].clone())).bind(observation["identityDigest"].as_str()).bind(&normalized).bind(normalized["contentDigest"].as_str()).bind(observation["provenance"].as_str()).bind(accepted).bind((!observation["verificationAcceptance"].is_null()).then(||observation["verificationAcceptance"].clone())).bind(&auth.actor.id).bind(body["reason"].as_str().map(|s|s.trim_matches(kelryvo_core::js_whitespace))).fetch_one(&mut *tx).await?;
    instances::audited(&mut tx,&auth,project,plans::id(&c["id"])?,"SCHEMA_OBSERVED",json!({"snapshotId":row["id"],"bindingId":binding,"bindingRevision":t["bindingRevision"],"contentDigest":row["content_digest"],"provenance":row["provenance"]})).await?;
    let result = public(&row, true)?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"snapshot":result}))))
}
pub async fn plan_drift(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Query(_): Query<crate::comparisons::EmptyQuery>,
) -> ApiResult<Value> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    plans::load(&mut tx, plan, Some(project), false).await?;
    let binding:Option<Uuid>=sqlx::query_scalar("SELECT binding_id FROM sf_plan_schema_evidence WHERE plan_id=$1 AND project_id=$2 AND organization_id=$3").bind(plan).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let result = if let Some(binding) = binding {
        drift(&mut tx, project, binding, Some(plan)).await?
    } else {
        json!({"latest":null,"baseline":null,"comparison":null,"retainedSnapshot":null,"executionAuthority":false})
    };
    tx.commit().await?;
    Ok(Json(result))
}
