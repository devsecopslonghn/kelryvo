//! Historical review discussion, with optional server-rederived source evidence.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth::Authenticated, conflict, invalid, plans,
    projects, releases,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

// Only this trusted route context may add review discussion during restore.
// This grants no configuration, approval or execution authority.
async fn guard(tx: &mut PgConnection, auth: &Authenticated, project: Uuid) -> Result<(), ApiError> {
    projects::guard_read(tx, auth, project).await?;
    let state:Option<String>=sqlx::query_scalar("SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton FOR SHARE OF c,g").fetch_optional(tx).await?;
    if !state
        .as_deref()
        .is_some_and(|s| s == "ACTIVE" || s == "RESTORE_HOLD")
    {
        return Err(conflict("METADATA_RESTORE_HOLD"));
    }
    Ok(())
}

pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    if !kelryvo_core::plan::keys(&body, &["body", "evidenceRefs", "comparisonId"])
        || !body["body"].as_str().is_some_and(|s| {
            !s.trim_matches(kelryvo_core::js_whitespace).is_empty()
                && s.encode_utf16().count() <= 4000
                && !s.chars().any(
                    |c| matches!(c,'\u{0}'..='\u{8}'|'\u{b}'|'\u{c}'|'\u{e}'..='\u{1f}'|'\u{7f}'),
                )
        })
        || body
            .get("comparisonId")
            .is_some_and(|id| !kelryvo_core::uuid(id))
    {
        return Err(invalid());
    }
    let input = body
        .get("evidenceRefs")
        .cloned()
        .unwrap_or_else(|| json!([]));
    if !kelryvo_core::comment::validate(&input) {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    guard(&mut tx, &auth, project).await?;
    let p = plans::load(&mut tx, plan, Some(project), true).await?;
    projects::active_project(&mut tx, project).await?;
    if p["status"] != "PENDING_APPROVAL" {
        return Err(conflict("PLAN_NOT_PENDING"));
    }
    let refs = if input.as_array().is_some_and(|refs| !refs.is_empty()) {
        let source = plans::source(&mut tx, project, false).await?;
        if !kelryvo_core::plan::source_valid(&source)
            || p["source_binding_generation"] != source["source_binding_generation"]
        {
            return Err(conflict("FRESH_PLAN_REQUIRED"));
        }
        let (_, release, intent) = crate::comparisons::plan_source(&mut tx, project, plan).await?;
        if !plans::same_items(&p, &release)
            || release["repository_id"] != source["source_repository_id"]
            || release["folder"] != source["source_folder"]
        {
            return Err(conflict("FRESH_PLAN_REQUIRED"));
        }
        let unavailable = || {
            ApiError(
                StatusCode::UNPROCESSABLE_ENTITY,
                "COMMENT_EVIDENCE_UNAVAILABLE",
            )
        };
        let statements = releases::statements(&state, &release).await.map_err(|e| {
            if e.1 == "PARSER_BUSY" {
                e
            } else {
                unavailable()
            }
        })?;
        kelryvo_core::comment::resolve(&input, &release, &intent["digest"], &statements)
            .ok_or_else(unavailable)?
    } else {
        json!([])
    };
    let comparison = if let Some(id) = body.get("comparisonId") {
        Some(crate::comparisons::read(&mut tx, project, plan, plans::id(id)?).await?)
    } else {
        None
    };
    guard(&mut tx, &auth, project).await?;
    let row:Value=sqlx::query_scalar("INSERT INTO sf_plan_comments(project_id,organization_id,plan_id,author_id,author_name,body,evidence_refs) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING jsonb_build_object('id',id,'project_id',project_id,'plan_id',plan_id,'author_id',author_id,'author_name',author_name,'body',body,'evidence_refs',evidence_refs,'created_at',created_at)").bind(project).bind(ORG_UUID).bind(plan).bind(&auth.actor.id).bind(&auth.actor.name).bind(body["body"].as_str()).bind(&refs).fetch_one(&mut *tx).await?;
    let mut facts = json!({"commentId":row["id"]});
    if input.as_array().is_some_and(|a| !a.is_empty()) {
        facts["evidenceRefCount"] = json!(input.as_array().map(Vec::len));
    }
    let mut mapped = projects::map_row(&row);
    if let Some(c) = comparison {
        facts["comparisonId"] = c["id"].clone();
        facts["comparisonDigest"] = c["digest"].clone();
        facts["intentDigest"] = c["evidence"]["intentDigest"].clone();
        mapped["comparisonId"] = c["id"].clone();
    }
    projects::append_audit(&mut tx, &auth, project, "PLAN_COMMENT_ADDED", plan, facts).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"comment":mapped}))))
}

pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    Query(_): Query<crate::comparisons::EmptyQuery>,
) -> ApiResult<Value> {
    let (project, plan) = (projects::id(&project)?, projects::id(&plan)?);
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    plans::load(&mut tx, plan, Some(project), false).await?;
    let rows = retained(&mut tx, project, Some(plan)).await?;
    tx.commit().await?;
    Ok(Json(json!({"comments":rows})))
}

pub(crate) async fn retained(
    tx: &mut PgConnection,
    project: Uuid,
    plan: Option<Uuid>,
) -> Result<Vec<Value>, ApiError> {
    let bytes:i64=sqlx::query_scalar("SELECT coalesce(sum(octet_length(body)+octet_length(author_id)+octet_length(author_name)+octet_length(evidence_refs::text)+1024),0)::bigint FROM sf_plan_comments WHERE project_id=$1 AND organization_id=$2 AND ($3::uuid IS NULL OR plan_id=$3)").bind(project).bind(ORG_UUID).bind(plan).fetch_one(&mut *tx).await?;
    if bytes > kelryvo_core::MAX_RELEASE_BYTES as i64 {
        return Err(conflict("COMMENT_HISTORY_UNAVAILABLE"));
    }
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',c.id,'project_id',c.project_id,'plan_id',c.plan_id,'author_id',c.author_id,'author_name',c.author_name,'body',c.body,'evidence_refs',c.evidence_refs,'created_at',c.created_at)||coalesce((SELECT jsonb_build_object('comparison_id',a.facts->>'comparisonId') FROM sf_audit a WHERE a.project_id=c.project_id AND a.organization_id=c.organization_id AND a.resource_id=c.plan_id AND a.action='PLAN_COMMENT_ADDED' AND a.facts->>'commentId'=c.id::text AND octet_length(a.facts->>'comparisonId')=36 LIMIT 1),'{}'::jsonb) FROM sf_plan_comments c WHERE c.project_id=$1 AND c.organization_id=$2 AND ($3::uuid IS NULL OR c.plan_id=$3) ORDER BY c.position").bind(project).bind(ORG_UUID).bind(plan).fetch_all(&mut *tx).await?;
    Ok(rows
        .iter()
        .map(|row| {
            let mut mapped = projects::map_row(row);
            if mapped
                .get("comparisonId")
                .is_some_and(|id| !kelryvo_core::uuid(id))
            {
                mapped
                    .as_object_mut()
                    .expect("object projection")
                    .remove("comparisonId");
            }
            mapped
        })
        .collect())
}

pub(crate) async fn for_project(
    state: &AppState,
    auth: &Authenticated,
    project: Uuid,
) -> Result<Vec<Value>, ApiError> {
    let mut tx = state.pool.begin().await?;
    if crate::auth::access_mode_connection(&mut tx).await? == "ENFORCED" {
        projects::guard_read(&mut tx, auth, project).await?;
    } else {
        crate::auth::guard_credential(&mut tx, auth).await?;
    }
    let rows = retained(&mut tx, project, None).await?;
    tx.commit().await?;
    Ok(rows)
}
