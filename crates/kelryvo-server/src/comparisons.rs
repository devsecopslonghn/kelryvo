//! Immutable, plan-bound offline comparisons stored in the existing audit log.
use crate::{
    ApiError, ApiResult, AppState, ORG, ORG_UUID,
    auth::{self, Authenticated},
    conflict, invalid, plans, projects, releases,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use kelryvo_core::comparison;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EmptyQuery {}

pub(crate) async fn plan_source(
    tx: &mut PgConnection,
    project: Uuid,
    plan: Uuid,
) -> Result<(Value, Value, Value), ApiError> {
    // A decision takes an exclusive row lock; a comparison cannot race a decision.
    sqlx::query(
        "SELECT id FROM sf_plans WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE",
    )
    .bind(plan)
    .bind(project)
    .bind(ORG_UUID)
    .execute(&mut *tx)
    .await?;
    let p = plans::load(tx, plan, Some(project), false).await?;
    let release = releases::load(tx, project, plans::id(&p["release_id"])?)
        .await
        .map_err(|e| {
            if e.1 == "METADATA_UNAVAILABLE" {
                e
            } else {
                conflict("COMPARISON_UNAVAILABLE")
            }
        })?;
    let files = release["files"]
        .as_array()
        .ok_or_else(|| conflict("COMPARISON_UNAVAILABLE"))?;
    let expected = json!({"organizationId":ORG,"projectId":project,"requesterId":p["author_id"],"releaseId":p["release_id"],"profileId":p["profile_id"],"commit":release["commit_id"],"objectFormat":release["object_format"],"folder":release["folder"],"parserProfile":release["parser_profile"],"manifestDigest":release["manifest_digest"],"items":files.iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"]})).collect::<Vec<_>>()});
    let facts = kelryvo_core::intent::verify(
        p["offline_intent_envelope"].as_str().unwrap_or_default(),
        p["offline_intent_digest"].as_str().unwrap_or_default(),
        Some(&expected),
    )
    .ok_or_else(|| conflict("FRESH_PLAN_REQUIRED"))?;
    Ok((p, release, facts))
}

/// Callers hold live scoped authority and the plan lock before attaching evidence.
pub async fn read(
    tx: &mut PgConnection,
    project: Uuid,
    plan: Uuid,
    id: Uuid,
) -> Result<Value, ApiError> {
    let stale = || conflict("COMPARISON_STALE");
    let row:Value=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'actor_id',actor_id,'created_at',created_at,'facts',CASE WHEN octet_length(facts::text)<=1048576 THEN facts END) FROM sf_audit WHERE id=$1 AND project_id=$2 AND organization_id=$3 AND resource_id=$4 AND action='PLAN_SOURCE_COMPARED'").bind(id).bind(project).bind(ORG_UUID).bind(plan).fetch_optional(&mut *tx).await?.ok_or_else(stale)?;
    let (p, candidate, intent) = plan_source(tx, project, plan).await?;
    let e = &row["facts"]["evidence"];
    if !e.is_object()
        || e["planId"] != p["id"]
        || e["intentDigest"] != intent["digest"]
        || !kelryvo_core::uuid(&e["base"]["id"])
        || comparison::canonical_digest(e) != row["facts"]["digest"].as_str().unwrap_or_default()
        || comparison::canonical_digest(&e["candidate"])
            != comparison::canonical_digest(&comparison::identity(&candidate))
    {
        return Err(stale());
    }
    let base = releases::load(tx, project, plans::id(&e["base"]["id"])?).await?;
    if comparison::canonical_digest(&e["base"])
        != comparison::canonical_digest(&comparison::identity(&base))
    {
        return Err(stale());
    }
    let facts = comparison::releases(&base, &candidate).ok_or_else(stale)?;
    Ok(
        json!({"id":id,"digest":row["facts"]["digest"],"evidence":e,"createdBy":row["actor_id"],"createdAt":projects::map_row(&row)["createdAt"],"facts":facts,"offline":true,"executionAuthority":false}),
    )
}

pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    if !kelryvo_core::plan::keys(&body, &["baseReleaseId", "expectedIntentDigest"])
        || !kelryvo_core::digest(&body["expectedIntentDigest"])
    {
        return Err(invalid());
    }
    let base_id = plans::id(&body["baseReleaseId"])?;
    let mut tx = state.pool.begin().await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    projects::active_project(&mut tx, project).await?;
    let (p, candidate, intent) = plan_source(&mut tx, project, plan).await?;
    if intent["digest"] != body["expectedIntentDigest"] {
        return Err(conflict("COMPARISON_STALE"));
    }
    if p["status"] != "PENDING_APPROVAL" {
        return Err(conflict("PLAN_NOT_PENDING"));
    }
    let base = releases::load(&mut tx, project, base_id).await?;
    if ["repository_id", "folder", "parser_profile"]
        .iter()
        .any(|k| base[k] != candidate[k])
    {
        return Err(crate::not_found());
    }
    let facts = comparison::releases(&base, &candidate)
        .ok_or_else(|| conflict("COMPARISON_UNAVAILABLE"))?;
    // Unsupported historic parser profiles retain file comparisons, with no
    // invented statement identities. Parse each native snapshot only once.
    let changed = facts
        .as_array()
        .ok_or_else(invalid)?
        .iter()
        .any(|f| f["change"] != "UNCHANGED");
    let parsed = if changed && candidate["parser_profile"] == kelryvo_parser::PROFILE {
        Some((
            releases::statements(&state, &base).await?,
            releases::statements(&state, &candidate).await?,
        ))
    } else {
        None
    };
    let mut files = Vec::new();
    let mut bytes = 0;
    for fact in facts.as_array().ok_or_else(invalid)? {
        let statements = if fact["change"] == "UNCHANGED" {
            Value::Null
        } else if let Some((left, right)) = &parsed {
            let extract = |all: &Value, path: &Value| {
                all.as_array()
                    .map(|all| {
                        all.iter()
                            .filter(|s| !path.is_null() && s["path"] == *path)
                            .cloned()
                            .collect::<Vec<_>>()
                    })
                    .ok_or_else(invalid)
            };
            comparison::statements(
                &extract(left, &fact["base"]["path"])?,
                &extract(right, &fact["candidate"]["path"])?,
            )
            .ok_or_else(|| conflict("COMPARISON_UNAVAILABLE"))?
        } else {
            Value::Null
        };
        let file = json!({"version":fact["version"],"change":fact["change"],"basePath":fact["base"]["path"],"candidatePath":fact["candidate"]["path"],"statements":statements});
        bytes += file.to_string().len();
        if bytes > 900000 {
            return Err(conflict("COMPARISON_UNAVAILABLE"));
        }
        files.push(file);
    }
    let evidence = json!({"format":2,"planId":plan,"intentDigest":intent["digest"],"base":comparison::identity(&base),"candidate":comparison::identity(&candidate),"alignment":"VERSION_AND_STATEMENT_SOURCE","files":files});
    if evidence.to_string().len() > 900000 {
        return Err(conflict("COMPARISON_UNAVAILABLE"));
    }
    let digest = comparison::canonical_digest(&evidence);
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    let row:Value=sqlx::query_scalar("INSERT INTO sf_audit(project_id,organization_id,actor_id,action,resource_id,facts) VALUES($1,$2,$3,'PLAN_SOURCE_COMPARED',$4,$5) RETURNING jsonb_build_object('id',id,'created_at',created_at)").bind(project).bind(ORG_UUID).bind(&auth.actor.id).bind(plan).bind(json!({"digest":digest,"evidence":evidence})).fetch_one(&mut *tx).await?;
    let result = json!({"comparison":{"id":row["id"],"digest":digest,"evidence":evidence,"facts":facts,"createdBy":auth.actor.id,"createdAt":projects::map_row(&row)["createdAt"],"offline":true,"executionAuthority":false}});
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(result)))
}

pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Query(_): Query<EmptyQuery>,
) -> ApiResult<Value> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    plan_source(&mut tx, project, plan).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'created_at',created_at,'created_by',actor_id,'digest',CASE WHEN octet_length(facts->>'digest')=64 THEN facts->>'digest' END,'base_release_id',CASE WHEN octet_length(facts->'evidence'->'base'->>'id')=36 THEN facts->'evidence'->'base'->>'id' END) FROM sf_audit WHERE project_id=$1 AND organization_id=$2 AND resource_id=$3 AND action='PLAN_SOURCE_COMPARED' ORDER BY created_at DESC,id DESC LIMIT 50").bind(project).bind(ORG_UUID).bind(plan).fetch_all(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(
        json!({"comparisons":rows.iter().map(projects::map_row).collect::<Vec<_>>()}),
    ))
}

pub async fn detail(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan, id)): Path<(String, String, String)>,
    Query(_): Query<EmptyQuery>,
) -> ApiResult<Value> {
    let (project, plan, id) = (
        projects::id(&project)?,
        projects::id(&plan)?,
        projects::id(&id).map_err(|_| invalid())?,
    );
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let result = read(&mut tx, project, plan, id).await?;
    tx.commit().await?;
    Ok(Json(json!({"comparison":result})))
}
