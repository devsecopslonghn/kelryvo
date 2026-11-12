//! Immutable validation reports and their exact binding to approval intents.
use crate::ObjectJson;
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID,
    auth::{self, Authenticated},
    conflict, currentness, instances, invalid, not_found, plans, projects, releases, targets,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use kelryvo_core::validation;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

fn fail(code: &'static str) -> ApiError {
    ApiError(
        match code {
            "VALIDATION_PARSER_UNAVAILABLE" => StatusCode::SERVICE_UNAVAILABLE,
            "VALIDATION_TOO_LARGE" => StatusCode::PAYLOAD_TOO_LARGE,
            _ => StatusCode::CONFLICT,
        },
        code,
    )
}

pub async fn metadata(
    tx: &mut PgConnection,
    project: Uuid,
    target: &Value,
) -> Result<Value, ApiError> {
    let mut m = json!({"observationId":null,"evidenceDigest":null,"identityDigest":null,"provenance":"MANUAL_REFERENCE","observedAt":null,"expiresAt":null,"owner":target["exactOwner"],"accessible":null,"completeness":"NOT_OBSERVED","objects":"NOT_OBSERVED"});
    if !target["observationDigest"].is_null() {
        let e:Value=sqlx::query_scalar("SELECT jsonb_build_object('digest',e.digest,'identity_digest',e.identity_digest,'observation_id',e.observation_id,'exact_owner',e.exact_owner,'provenance',o.provenance,'observed_at',o.observed_at,'expires_at',o.expires_at,'schemas',o.schemas) FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id WHERE e.digest=$1 AND e.project_id=$2").bind(target["observationDigest"].as_str()).bind(project).fetch_optional(&mut *tx).await?.ok_or_else(||fail("VALIDATION_EVIDENCE_UNAVAILABLE"))?;
        if e["exact_owner"] != target["exactOwner"] {
            return Err(fail("VALIDATION_EVIDENCE_UNAVAILABLE"));
        }
        let dates = projects::map_row(&e);
        let accessible = e["schemas"]
            .as_array()
            .and_then(|a| a.iter().find(|s| s["owner"] == e["exact_owner"]))
            .map(|s| s["accessible"].clone())
            .unwrap_or(Value::Null);
        m = json!({"observationId":e["observation_id"],"evidenceDigest":e["digest"],"identityDigest":e["identity_digest"],"provenance":e["provenance"],"observedAt":dates["observedAt"],"expiresAt":dates["expiresAt"],"owner":e["exact_owner"],"accessible":accessible,"completeness":"OWNER_VISIBILITY_ONLY","objects":"NOT_OBSERVED"});
    }
    let s:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'content_digest',content_digest,'identity_digest',identity_digest,'provenance',provenance,'observed_at',observed_at,'live_accepted',live_accepted,'coverage',schema->'coverage','limitations',schema->'limitations','object_count',jsonb_array_length(schema->'objects'),'objects',(SELECT jsonb_agg(jsonb_build_object('owner',o->>'owner','name',o->>'name','type',o->>'type','checksum',o->>'checksum') ORDER BY o->>'type',o->>'name') FROM jsonb_array_elements(schema->'objects') o)) FROM sf_schema_snapshots WHERE project_id=$1 AND binding_id=$2 AND binding_revision=$3::text::bigint AND owner=$4 ORDER BY observed_at DESC,id DESC LIMIT 1").bind(project).bind(plans::id(&target["bindingId"])?).bind(target["bindingRevision"].as_str()).bind(target["exactOwner"].as_str()).fetch_optional(&mut *tx).await?;
    m["schemaSnapshot"]=s.map(|s|{let d=projects::map_row(&s);json!({"id":s["id"],"contentDigest":s["content_digest"],"identityDigest":s["identity_digest"],"provenance":s["provenance"],"observedAt":d["observedAt"],"liveAccepted":s["live_accepted"],"coverage":s["coverage"],"limitations":s["limitations"],"objectCount":s["object_count"],"objects":s["objects"].as_array().cloned().unwrap_or_default()})}).unwrap_or(Value::Null);
    Ok(m)
}

pub async fn load(
    tx: &mut PgConnection,
    project: Uuid,
    id: Uuid,
    expected: Option<&str>,
) -> Result<Option<Value>, ApiError> {
    let row:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'release_id',release_id,'binding_id',binding_id,'digest',digest,'actor_id',actor_id,'created_at',created_at,'envelope',CASE WHEN octet_length(envelope)<=2097152 THEN envelope END) FROM sf_sql_validations WHERE id=$1 AND project_id=$2 AND organization_id=$3").bind(id).bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let Some(row) = row else {
        return Ok(None);
    };
    if expected.is_some_and(|d| row["digest"] != d) {
        return Ok(None);
    }
    let Some(report) = validation::verify(
        row["envelope"].as_str().unwrap_or_default(),
        row["digest"].as_str().unwrap_or_default(),
        &json!({"projectId":project}),
    ) else {
        return Ok(None);
    };
    if report["releaseId"] != row["release_id"]
        || report["target"]["bindingId"] != row["binding_id"]
    {
        return Ok(None);
    }
    let dates = projects::map_row(&row);
    Ok(Some(
        json!({"id":row["id"],"digest":row["digest"],"actorId":row["actor_id"],"createdAt":dates["createdAt"],"report":report}),
    ))
}
pub async fn for_intent(tx: &mut PgConnection, intent: &Value) -> Result<Option<Value>, ApiError> {
    if !intent["validation"].is_object() {
        return Ok(None);
    }
    let result = load(
        tx,
        plans::id(&intent["projectId"])?,
        plans::id(&intent["validation"]["id"])?,
        intent["validation"]["digest"].as_str(),
    )
    .await?
    .ok_or_else(|| fail("VALIDATION_EVIDENCE_UNAVAILABLE"))?;
    if !validation::for_intent(&result["report"], intent) {
        return Err(fail("VALIDATION_EVIDENCE_UNAVAILABLE"));
    }
    Ok(Some(result))
}
pub async fn currentness(tx: &mut PgConnection, result: &Value) -> Result<Value, ApiError> {
    let r = &result["report"];
    let project = plans::id(&r["projectId"])?;
    let binding = plans::id(&r["target"]["bindingId"])?;
    let row = match targets::load(tx, project, binding).await {
        Ok(v) => v,
        Err(e) if e.1 == "NOT_FOUND" => {
            return Ok(json!({"state":"UNKNOWN","reasons":["TARGET_UNAVAILABLE"]}));
        }
        Err(e) => return Err(e),
    };
    let target = targets::loaded(&row);
    if target["bindingRevision"] != r["target"]["bindingRevision"] {
        return Ok(json!({"state":"STALE","reasons":["BINDING_SUPERSEDED"]}));
    }
    if target["sourceBindingGeneration"] != r["sourceBindingGeneration"] {
        return Ok(json!({"state":"STALE","reasons":["SOURCE_CHANGED"]}));
    }
    if r["metadata"].get("schemaSnapshot").is_some() {
        let s = &r["metadata"]["schemaSnapshot"];
        let sid = if s["id"].is_null() {
            None
        } else {
            Some(plans::id(&s["id"])?)
        };
        let changed:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_schema_snapshots s WHERE s.project_id=$1 AND s.binding_id=$2 AND s.binding_revision=$3::text::bigint AND (($4::uuid IS NULL AND s.observed_at>$5::text::timestamptz) OR ($4::uuid IS NOT NULL AND (s.observed_at,s.id)>(SELECT observed_at,id FROM sf_schema_snapshots WHERE id=$4))) AND (s.content_digest IS DISTINCT FROM $6 OR s.identity_digest IS DISTINCT FROM $7))").bind(project).bind(binding).bind(r["target"]["bindingRevision"].as_str()).bind(sid).bind(result["createdAt"].as_str()).bind(s["contentDigest"].as_str()).bind(s["identityDigest"].as_str()).fetch_one(&mut *tx).await?;
        if changed {
            return Ok(json!({"state":"STALE","reasons":["SCHEMA_OBSERVATION_CHANGED"]}));
        }
    }
    currentness::check(tx, project, &target).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    target_binding_id: String,
    expected_binding_revision: String,
    expected_assignment_revision: String,
}
pub async fn create(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, release)): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Request>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (project, release, binding) = (
        projects::id(&project).map_err(|_| invalid())?,
        projects::id(&release).map_err(|_| invalid())?,
        projects::id(&body.target_binding_id).map_err(|_| invalid())?,
    );
    if !plans::revision(&json!(body.expected_binding_revision))
        || !plans::revision(&json!(body.expected_assignment_revision))
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    targets::lock(&mut tx, binding).await?;
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    projects::active_project(&mut tx, project).await?;
    let source = plans::source(&mut tx, project, false).await?;
    let row = targets::load(&mut tx, project, binding).await?;
    let mut target = targets::loaded(&row);
    target["engine"] = row["profile_engine"].clone();
    if target["bindingRevision"] != body.expected_binding_revision
        || target["assignmentRevision"] != body.expected_assignment_revision
    {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let release = releases::historical(&mut tx, project, release).await?;
    if release["repository_id"] != source["source_repository_id"]
        || release["folder"] != source["source_folder"]
    {
        return Err(conflict("SOURCE_BINDING_MISMATCH"));
    }
    let metadata = metadata(&mut tx, project, &target).await?;
    let mut units = Vec::new();
    if release["validation_status"] == "VALID" {
        let ids = releases::statements(&state, &release).await.map_err(|e| {
            if e.1 == "RELEASE_NOT_PLANNABLE" {
                fail("VALIDATION_PARSER_UNAVAILABLE")
            } else {
                e
            }
        })?;
        for s in ids.as_array().ok_or_else(invalid)? {
            let file = release["files"]
                .as_array()
                .and_then(|a| a.iter().find(|f| f["path"] == s["path"]))
                .ok_or_else(|| fail("RELEASE_INTEGRITY_FAILED"))?;
            let (start, end) = (
                s["startByte"].as_u64().ok_or_else(invalid)? as usize,
                s["endByte"].as_u64().ok_or_else(invalid)? as usize,
            );
            let sql = file["content"]
                .as_str()
                .and_then(|sql| sql.get(start..end))
                .ok_or_else(|| fail("RELEASE_INTEGRITY_FAILED"))?;
            let mut s = s.clone();
            s["sourceSql"] = sql.into();
            units.push(s);
        }
    }
    let permit = state
        .parser_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "PARSER_BUSY"))?;
    let built = tokio::task::spawn_blocking({
        let release = release.clone();
        let source = source.clone();
        let target = target.clone();
        move || {
            let _permit = permit;
            let capability = if release["parser_profile"] == kelryvo_parser::PROFILE {
                "PINNED_RUST_ORACLE"
            } else {
                "UNSUPPORTED"
            };
            validation::build(&release, &source, &target, &metadata, &units, capability)
        }
    })
    .await
    .map_err(|_| fail("VALIDATION_PARSER_UNAVAILABLE"))?
    .map_err(fail)?;
    auth::guard_mutation(&mut tx, &auth, Some(project), Some("developer")).await?;
    let checked = currentness::check(&mut tx, project, &target).await?;
    if checked["state"] != "CURRENT" {
        return Err(conflict("TARGET_REVISION_CONFLICT"));
    }
    let inserted:Option<Uuid>=sqlx::query_scalar("INSERT INTO sf_sql_validations(organization_id,project_id,release_id,binding_id,digest,envelope,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(organization_id,project_id,digest) DO NOTHING RETURNING id").bind(ORG_UUID).bind(project).bind(plans::id(&release["id"])?).bind(binding).bind(built["digest"].as_str()).bind(built["envelope"].as_str()).bind(&auth.actor.id).fetch_optional(&mut *tx).await?;
    let id = if let Some(id) = inserted {
        id
    } else {
        sqlx::query_scalar("SELECT id FROM sf_sql_validations WHERE organization_id=$1 AND project_id=$2 AND digest=$3").bind(ORG_UUID).bind(project).bind(built["digest"].as_str()).fetch_one(&mut *tx).await?
    };
    if inserted.is_some() {
        projects::append_audit(&mut tx,&auth,project,"SQL_VALIDATED",id,json!({"releaseId":release["id"],"bindingId":binding,"validationDigest":built["digest"],"outcome":built["report"]["outcome"]})).await?;
    }
    let mut result = load(&mut tx, project, id, None)
        .await?
        .ok_or_else(|| fail("VALIDATION_EVIDENCE_UNAVAILABLE"))?;
    result["currentness"] = checked;
    result["repeated"] = json!(inserted.is_none());
    tx.commit().await?;
    Ok((
        if inserted.is_some() {
            StatusCode::CREATED
        } else {
            StatusCode::OK
        },
        Json(json!({"validation":result})),
    ))
}

pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, id)): Path<(String, String)>,
    Query(_): Query<targets::EmptyQuery>,
) -> ApiResult<Value> {
    let (project, id) = (projects::id(&project)?, projects::id(&id)?);
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    let mut result = load(&mut tx, project, id, None)
        .await?
        .ok_or_else(not_found)?;
    targets::lock(
        &mut tx,
        plans::id(&result["report"]["target"]["bindingId"])?,
    )
    .await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    result["currentness"] = currentness(&mut tx, &result).await?;
    tx.commit().await?;
    Ok(Json(json!({"validation":result})))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    after: Option<String>,
}
pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, release)): Path<(String, String)>,
    Query(page): Query<Page>,
) -> ApiResult<Value> {
    let (project, release) = (
        projects::id(&project).map_err(|_| invalid())?,
        projects::id(&release).map_err(|_| invalid())?,
    );
    let after = page
        .after
        .as_deref()
        .map(projects::id)
        .transpose()
        .map_err(|_| invalid())?;
    let mut tx = state.pool.begin().await?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let rows:Vec<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'digest',digest,'actor_id',actor_id,'created_at',created_at) FROM sf_sql_validations WHERE project_id=$1 AND release_id=$2 AND organization_id=$3 AND ($4::uuid IS NULL OR (created_at,id)<(SELECT created_at,id FROM sf_sql_validations WHERE id=$4 AND project_id=$1 AND release_id=$2)) ORDER BY created_at DESC,id DESC LIMIT 51").bind(project).bind(release).bind(ORG_UUID).bind(after).fetch_all(&mut *tx).await?;
    let next = if rows.len() > 50 {
        rows[49]["id"].clone()
    } else {
        Value::Null
    };
    tx.commit().await?;
    Ok(Json(
        json!({"validations":rows.iter().take(50).map(projects::map_row).collect::<Vec<_>>(),"nextCursor":next}),
    ))
}
