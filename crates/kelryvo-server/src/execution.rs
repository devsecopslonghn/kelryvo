//! Public request creation and diagnostic readiness. Only the separately
//! installed worker can admit requests and acquire Oracle capabilities.
use crate::{
    ApiError, ApiResult, AppState, ORG, ORG_UUID,
    auth::{self, Authenticated},
    conflict, currentness, execution_jobs, invalid, plans, projects, recovered, releases,
    validations,
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

async fn profile(
    tx: &mut PgConnection,
    project: Uuid,
    p: &Value,
) -> Result<Option<Value>, ApiError> {
    sqlx::query_scalar("SELECT jsonb_build_object('id',p.id,'name',CASE WHEN octet_length(p.name)<=800 THEN p.name END,'environment_id',p.environment_id,'environment_name',CASE WHEN octet_length(e.name)<=800 THEN e.name END,'engine',p.engine,'host',p.host,'port',p.port,'service',p.service,'username',p.username,'credential_ref',CASE WHEN octet_length(p.credential_ref)<=4096 THEN p.credential_ref END,'retired_at',p.retired_at,'managed_vault',EXISTS(SELECT 1 FROM sf_instance_profile_sources s JOIN sf_database_connections c ON c.id=s.connection_id AND c.organization_id=p.organization_id WHERE s.profile_id=p.id AND c.credential_ref LIKE 'vault://kelryvo/%')) FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id WHERE p.id=$1 AND p.project_id=$2 AND p.organization_id=$3 FOR SHARE OF p,e").bind(plans::id(&p["profile_id"])?).bind(project).bind(ORG_UUID).fetch_optional(tx).await.map_err(Into::into)
}
async fn deploy(
    tx: &mut PgConnection,
    project: Uuid,
    auth: &Authenticated,
) -> Result<bool, ApiError> {
    Ok(sqlx::query("SELECT 1 FROM sf_project_deploy_grants WHERE organization_id=$1 AND project_id=$2 AND actor_id=$3 AND revoked_at IS NULL").bind(ORG_UUID).bind(project).bind(&auth.actor.id).fetch_optional(tx).await?.is_some())
}
fn bound_intent(p: &Value) -> Option<Value> {
    let items = p["items"].as_array()?;
    kelryvo_core::intent::verify(
        p["offline_intent_envelope"].as_str()?,
        p["offline_intent_digest"].as_str()?,
        Some(
            &json!({"organizationId":ORG,"projectId":p["project_id"],"requesterId":p["author_id"],"releaseId":p["release_id"],"profileId":p["profile_id"],"items":items.iter().map(|i|json!({"path":i["path"],"version":i["version"],"sha256":i["sha256"]})).collect::<Vec<_>>() }),
        ),
    )
}
fn source_matches(source: &Value, release: &Value, i: &Value) -> bool {
    release["repository_id"] == source["source_repository_id"]
        && release["folder"] == source["source_folder"]
        && [
            ("id", "releaseId"),
            ("commit_id", "commit"),
            ("object_format", "objectFormat"),
            ("manifest_digest", "manifestDigest"),
            ("parser_profile", "parserProfile"),
            ("folder", "folder"),
        ]
        .iter()
        .all(|(a, b)| release[a] == i[b])
        && release["files"].as_array().map(|files| {
            json!(
                files
                    .iter()
                    .map(|f| json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"]}))
                    .collect::<Vec<_>>()
            )
        }) == Some(i["items"].clone())
}
fn profile_matches(profile: &Value, i: &Value, names: bool) -> bool {
    profile["retired_at"].is_null()
        && [
            ("id", "profileId"),
            ("engine", "engine"),
            ("host", "host"),
            ("port", "port"),
            ("service", "service"),
            ("username", "username"),
        ]
        .iter()
        .all(|(a, b)| profile[a] == i[b])
        && (!names
            || [
                ("name", "profileName"),
                ("environment_id", "environmentId"),
                ("environment_name", "environmentName"),
            ]
            .iter()
            .all(|(a, b)| profile[a] == i[b]))
}
fn target(i: &Value) -> Value {
    let mut target = i["target"].clone();
    for k in [
        "profileId",
        "profileName",
        "environmentId",
        "environmentName",
    ] {
        target[k] = i[k].clone();
    }
    target
}

pub async fn request(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(plan): Path<String>,
    Json(body): Json<Value>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let plan = projects::id(&plan)?;
    let empty = body.as_object().is_some_and(|o| o.is_empty());
    let expectations = [
        "expectedIntentDigest",
        "expectedAssignmentRevision",
        "expectedBindingRevision",
    ];
    if !empty
        && (!kelryvo_core::plan::keys(
            &body,
            &[
                "idempotencyKey",
                "reason",
                "expectedIntentDigest",
                "expectedAssignmentRevision",
                "expectedBindingRevision",
            ],
        ) || !body["idempotencyKey"].as_str().is_some_and(|s| {
            (16..=128).contains(&s.len())
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        }) || !kelryvo_core::plan::reason(&body["reason"], 1000)
            || expectations.iter().any(|k| body.get(k).is_some())
                && (!kelryvo_core::digest(&body["expectedIntentDigest"])
                    || !kelryvo_core::plan::revision(&body["expectedAssignmentRevision"])
                    || !kelryvo_core::plan::revision(&body["expectedBindingRevision"])))
    {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    crate::instances::catalog_lock(&mut tx).await?;
    let hint = plans::load(&mut tx, plan, None, false).await?;
    plans::lock(&mut tx, &hint).await?;
    let project = plans::id(&hint["project_id"])?;
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    let p = plans::load(&mut tx, plan, Some(project), true).await?;
    projects::active_project(&mut tx, project).await?;
    if empty {
        projects::append_audit(&mut tx, &auth, project, "EXECUTION_DENIED", plan, json!({}))
            .await?;
        tx.commit().await?;
        return Ok((
            StatusCode::CONFLICT,
            Json(json!({"error":"EXECUTION_UNAVAILABLE","execution":"NOT_EXECUTED"})),
        ));
    }
    if !p["items"].is_array()
        || !p["offline_intent_envelope"].is_string()
        || !kelryvo_core::uuid(&p["approval_reference"])
        || !kelryvo_core::digest(&p["offline_intent_digest"])
    {
        return Err(conflict("PLAN_NOT_REQUESTABLE"));
    }
    if !deploy(&mut tx, project, &auth).await? {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "DEPLOY_PERMISSION_REQUIRED",
        ));
    }
    let body_digest = kelryvo_core::evidence_digest(
        &json!({"projectId":project,"planId":plan,"approvalReference":p["approval_reference"],"intentDigest":p["offline_intent_digest"],"reason":body["reason"]}),
    );
    let old:Option<Value>=sqlx::query_scalar("SELECT jsonb_build_object('id',id,'project_id',project_id,'plan_id',plan_id,'approval_reference',approval_reference,'intent_digest',intent_digest,'requester_id',requester_id,'reason',reason,'state',state,'readiness',readiness,'revision',revision,'created_at',created_at,'updated_at',updated_at,'payload_digest',payload_digest) FROM sf_execution_jobs WHERE organization_id=$1 AND requester_id=$2 AND idempotency_key=$3 FOR UPDATE").bind(ORG_UUID).bind(&auth.actor.id).bind(body["idempotencyKey"].as_str()).fetch_optional(&mut *tx).await?;
    if let Some(old) = old {
        let original = kelryvo_core::plan::retained_intent(&p)
            .ok_or_else(|| conflict("IDEMPOTENCY_CONFLICT"))?;
        if old["payload_digest"] != body_digest
            || original["format"].as_u64().is_some_and(|n| n >= 3)
                && (body["expectedIntentDigest"] != original["digest"]
                    || body["expectedAssignmentRevision"]
                        != original["target"]["assignmentRevision"]
                    || body["expectedBindingRevision"] != original["target"]["bindingRevision"])
        {
            return Err(conflict("IDEMPOTENCY_CONFLICT"));
        }
        auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
        let result = execution_jobs::public(&old)?;
        tx.commit().await?;
        return Ok((StatusCode::OK, Json(json!({"job":result,"repeated":true}))));
    }
    let source = plans::source(&mut tx, project, false).await?;
    let release = releases::load(&mut tx, project, plans::id(&p["release_id"])?)
        .await
        .map_err(|e| {
            if e.1 == "METADATA_UNAVAILABLE" {
                e
            } else {
                conflict("PLAN_NOT_REQUESTABLE")
            }
        })?;
    let profile = profile(&mut tx, project, &p)
        .await?
        .ok_or_else(|| conflict("PLAN_NOT_REQUESTABLE"))?;
    if !profile["retired_at"].is_null() {
        return Err(conflict("PROFILE_RETIRED"));
    }
    if !currentness::captured_profile_current(&mut tx, plans::id(&p["id"])?).await? {
        return Err(conflict("FRESH_PLAN_REQUIRED"));
    }
    let i = bound_intent(&p).ok_or_else(|| conflict("PLAN_NOT_REQUESTABLE"))?;
    if !p["revocation"].is_null() {
        return Err(conflict("APPROVAL_REVOKED"));
    }
    if p["status"] != "APPROVED" || p["decision"] != "APPROVE" {
        return Err(conflict("PLAN_NOT_APPROVED"));
    }
    if i["format"] == 1 {
        return Err(conflict("STATEMENT_APPROVAL_REQUIRED"));
    }
    if !plans::same_items(&p, &release)
        || !source_matches(&source, &release, &i)
        || !profile_matches(&profile, &i, false)
        || p["source_binding_generation"] != source["source_binding_generation"]
        || p["execution"] != "NOT_EXECUTED"
        || p["history_status"] != "NOT_OBSERVED"
        || p["planning_scope"] != "OFFLINE_CANDIDATE"
        || releases::statements(&state, &release).await.map_err(|e| {
            if e.1 == "PARSER_BUSY" {
                e
            } else {
                conflict("PLAN_NOT_REQUESTABLE")
            }
        })? != i["statements"]
    {
        return Err(conflict("PLAN_NOT_REQUESTABLE"));
    }
    if i["format"].as_u64().is_some_and(|n| n >= 3) {
        if currentness::check(&mut tx, project, &target(&i)).await?["state"] != "CURRENT"
            || body["expectedIntentDigest"] != i["digest"]
            || body["expectedAssignmentRevision"] != i["target"]["assignmentRevision"]
            || body["expectedBindingRevision"] != i["target"]["bindingRevision"]
        {
            return Err(conflict("FRESH_PLAN_REQUIRED"));
        }
        validations::for_intent(&mut tx, &i).await?;
        if recovered::conflict(&mut tx, project, &i["target"]["streamId"]).await? {
            return Err(conflict("EXECUTION_ALREADY_PENDING"));
        }
    }
    // profile_current already requires a native installation record for vault
    // sources. Only the private worker may attest it and acquire dispatch rights.
    auth::guard_mutation(&mut tx, &auth, Some(project), None).await?;
    let credential: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_local_credentials WHERE token_sha256=$1 AND actor_id=$2",
    )
    .bind(&auth.credential_digest)
    .bind(&auth.actor.id)
    .fetch_one(&mut *tx)
    .await?;
    let id = Uuid::new_v4();
    let row:Value=sqlx::query_scalar("INSERT INTO sf_execution_jobs(id,organization_id,project_id,plan_id,approval_reference,intent_digest,requester_id,request_credential_id,idempotency_key,payload_digest,reason,state,readiness) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'WAITING_VALIDATION','TARGET_HISTORY_UNAVAILABLE') RETURNING to_jsonb(sf_execution_jobs)").bind(id).bind(ORG_UUID).bind(project).bind(plan).bind(plans::id(&p["approval_reference"])?).bind(p["offline_intent_digest"].as_str()).bind(&auth.actor.id).bind(credential).bind(body["idempotencyKey"].as_str()).bind(body_digest).bind(body["reason"].as_str()).fetch_one(&mut *tx).await?;
    sqlx::query("INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts) VALUES($1,$2,0,NULL,'WAITING_VALIDATION',$3,$4,'{}'::jsonb)").bind(Uuid::new_v4()).bind(id).bind(&auth.actor.id).bind(body["reason"].as_str()).execute(&mut *tx).await?;
    projects::append_audit(&mut tx,&auth,project,"EXECUTION_REQUESTED",id,json!({"planId":plan,"approvalReference":p["approval_reference"],"intentDigest":p["offline_intent_digest"]})).await?;
    let result = execution_jobs::public(&row)?;
    tx.commit().await?;
    Ok((
        StatusCode::CREATED,
        Json(json!({"job":result,"repeated":false})),
    ))
}

pub async fn readiness(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(plan): Path<String>,
    Query(_): Query<crate::comparisons::EmptyQuery>,
) -> ApiResult<Value> {
    let plan = projects::id(&plan)?;
    let mut tx = state.pool.begin().await?;
    crate::instances::catalog_lock(&mut tx).await?;
    let hint = plans::load(&mut tx, plan, None, false).await?;
    plans::lock(&mut tx, &hint).await?;
    let project = plans::id(&hint["project_id"])?;
    projects::guard_read(&mut tx, &auth, project).await?;
    let p = plans::load(&mut tx, plan, Some(project), false).await?;
    let source = plans::source(&mut tx, project, false).await?;
    let i = bound_intent(&p);
    let mut checks = Vec::new();
    let mut check = |code: &str, status: &str| checks.push(json!({"code":code,"status":status}));
    let gate:Option<String>=sqlx::query_scalar("SELECT g.state FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton").fetch_optional(&mut *tx).await?;
    check(
        "METADATA_ACTIVE",
        if gate.as_deref() == Some("ACTIVE") {
            "PASS"
        } else {
            "BLOCKED"
        },
    );
    check(
        "IMMUTABLE_INTENT_VERIFIED",
        if i.is_some() { "PASS" } else { "BLOCKED" },
    );
    let i = i.unwrap_or(Value::Null);
    check(
        "STATEMENT_BOUND_PLAN",
        if i["format"].as_u64().is_some_and(|n| n >= 2) {
            "PASS"
        } else {
            "BLOCKED"
        },
    );
    let approved = !i.is_null()
        && p["status"] == "APPROVED"
        && p["decision"] == "APPROVE"
        && kelryvo_core::uuid(&p["approval_reference"])
        && p["decided_by"].is_string()
        && p["decided_by"] != p["author_id"]
        && p["revocation"].is_null();
    check(
        "INDEPENDENT_APPROVAL_CURRENT",
        if approved { "PASS" } else { "BLOCKED" },
    );
    check(
        "PLAN_EXECUTION_STATE",
        if p["execution"] == "NOT_EXECUTED"
            && p["history_status"] == "NOT_OBSERVED"
            && p["planning_scope"] == "OFFLINE_CANDIDATE"
        {
            "PASS"
        } else {
            "BLOCKED"
        },
    );
    let project_current = source["archived_at"].is_null()
        && kelryvo_core::plan::source_valid(&source)
        && p["source_binding_generation"] == source["source_binding_generation"]
        && (i["format"].as_u64().is_some_and(|n| n < 3)
            || i["target"]["sourceBindingGeneration"] == source["source_binding_generation"]);
    let retained = if !i.is_null() && project_current {
        match releases::load(&mut tx, project, plans::id(&p["release_id"])?).await {
            Ok(r) => Some(r),
            Err(e) if e.1 == "METADATA_UNAVAILABLE" => return Err(e),
            _ => None,
        }
    } else {
        None
    };
    let source_current = retained
        .as_ref()
        .is_some_and(|r| source_matches(&source, r, &i));
    check(
        "PROTECTED_SOURCE_CURRENT",
        if source_current { "PASS" } else { "BLOCKED" },
    );
    let profile = if !i.is_null() {
        profile(&mut tx, project, &p).await?
    } else {
        None
    };
    let private: Value =
        serde_json::from_str(p["offline_intent_envelope"].as_str().unwrap_or("null"))
            .unwrap_or(Value::Null);
    let profile_current = currentness::captured_profile_current(&mut tx, plans::id(&p["id"])?)
        .await?
        && profile
            .as_ref()
            .is_some_and(|p| profile_matches(p, &i, true) && private[19] == p["credential_ref"]);
    check(
        "PROFILE_CURRENT",
        if profile_current { "PASS" } else { "BLOCKED" },
    );
    let mut target_status = if i["format"] == 2 {
        "UNVERIFIED"
    } else {
        "BLOCKED"
    };
    if i["format"].as_u64().is_some_and(|n| n >= 3)
        && profile_current
        && project_current
        && currentness::check(&mut tx, project, &target(&i)).await?["state"] == "CURRENT"
    {
        target_status = "PASS";
    }
    check("TARGET_CONFIGURATION_CURRENT", target_status);
    let mut validation_status = if i["validation"].is_object() {
        "BLOCKED"
    } else {
        "UNVERIFIED"
    };
    if i["validation"].is_object() {
        match validations::for_intent(&mut tx, &i).await {
            Ok(Some(v)) => {
                let c = validations::currentness(&mut tx, &v).await?;
                validation_status = if c["state"] == "CURRENT" {
                    "PASS"
                } else if c["state"] == "STALE" {
                    "BLOCKED"
                } else {
                    "UNVERIFIED"
                };
            }
            Err(e) if e.1 == "METADATA_UNAVAILABLE" => return Err(e),
            _ => {}
        }
    }
    check("SCHEMA_VALIDATION_CURRENT", validation_status);
    check(
        "DEPLOY_AUTHORIZATION",
        if deploy(&mut tx, project, &auth).await? {
            "PASS"
        } else {
            "BLOCKED"
        },
    );
    let active:Vec<String>=sqlx::query_scalar("SELECT state FROM sf_execution_jobs WHERE organization_id=$1 AND project_id=$2 AND plan_id=$3 AND state IN('WAITING_VALIDATION','ADMITTED','HOLD') ORDER BY created_at DESC,id DESC LIMIT 10").bind(ORG_UUID).bind(project).bind(plan).fetch_all(&mut *tx).await?;
    let conflict = if i["format"].as_u64().is_some_and(|n| n >= 3) {
        if recovered::conflict(&mut tx, project, &i["target"]["streamId"]).await? {
            "BLOCKED"
        } else {
            "PASS"
        }
    } else if active.is_empty() {
        "PASS"
    } else {
        "UNVERIFIED"
    };
    check("NO_ACTIVE_OR_HELD_REQUEST", conflict);
    for code in [
        "TARGET_HISTORY_AVAILABLE",
        "TRUSTED_WORKER_ADMISSION",
        "CANONICAL_TARGET_MUTEX",
        "DISPATCH_PERMIT",
        "ORACLE_RUNTIME_ACCEPTANCE",
    ] {
        check(code, "UNVERIFIED");
    }
    let result = json!({"requestEligible":!checks.iter().any(|c|c["status"]=="BLOCKED"),"checks":checks,"executionAuthority":false,"oracleAcceptance":"NOT_RUN","executable":false,"activeJobs":active});
    tx.commit().await?;
    Ok(Json(result))
}
