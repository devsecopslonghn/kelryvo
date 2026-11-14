//! Read-only comparison of immutable source with retained completion evidence.
//! Neither pending SQL nor a completed prefix grants execution authority.
mod history;
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth, auth::Authenticated, conflict, currentness,
    invalid, not_found, plans, projects, releases, validations,
};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::StatusCode,
};
use kelryvo_core::{evidence_digest, intent, migrations, review, sha256};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Page {
    intent_digest: String,
    after: Option<String>,
    analysis_digest: Option<String>,
}
fn unavailable() -> ApiError {
    ApiError(
        StatusCode::SERVICE_UNAVAILABLE,
        "MIGRATION_ANALYSIS_UNAVAILABLE",
    )
}
fn finding(findings: &mut Vec<Value>, code: &str, status: &str, message: &str) {
    findings.push(json!({"code":code,"status":status,"message":message}));
}
fn check(findings: &mut Vec<Value>, code: &str, valid: bool, yes: &str, no: &str) {
    finding(
        findings,
        code,
        if valid { "PASS" } else { "BLOCKED" },
        if valid { yes } else { no },
    );
}
fn answer(base: &Value, findings: &[Value], rows: &[Value], count: usize, digest: String) -> Value {
    let decision = if findings
        .iter()
        .chain(rows)
        .any(|r| r["status"] == "BLOCKED")
    {
        "BLOCKED"
    } else if findings.iter().any(|r| r["status"] == "UNVERIFIED") {
        "UNVERIFIABLE"
    } else if !rows.is_empty() && rows.iter().all(|r| r["status"] == "COMPLETED") {
        "NOOP_CANDIDATE"
    } else {
        "PENDING"
    };
    let mut out = json!({"format":1});
    out.as_object_mut()
        .expect("object")
        .extend(base.as_object().expect("base").clone());
    for (k,v) in json!({"executionAuthority":false,"oracleAcceptance":"NOT_RUN","liveTargetState":"UNVERIFIED",
        "decision":decision,"findings":findings,"migrations":rows,"statementCount":count,"analysisDigest":digest}).as_object().expect("answer") {
        out[k]=v.clone();
    }
    out
}
fn source_statements(files: &Value, identities: &Value) -> Option<Value> {
    identities
        .as_array()?
        .iter()
        .map(|s| {
            let raw =
                files.as_array()?.iter().find(|f| f["path"] == s["path"])?["content"].as_str()?;
            let start = usize::try_from(s["startByte"].as_u64()?).ok()?;
            let end = usize::try_from(s["endByte"].as_u64()?).ok()?;
            if end <= start {
                return None;
            }
            let sql = raw.get(start..end)?;
            if sha256(sql) != s["sourceSha256"] {
                return None;
            }
            let mut s = s.clone();
            s["sourceSql"] = sql.into();
            Some(s)
        })
        .collect::<Option<Vec<_>>>()
        .map(Value::Array)
}
pub(super) async fn target_proof(tx: &mut PgConnection, i: &Value) -> Result<Vec<Value>, ApiError> {
    let t = &i["target"];
    if !t.is_object() {
        return Ok(Vec::new());
    }
    sqlx::query_scalar("SELECT jsonb_build_object('identity',e.identity,'identity_digest',e.identity_digest,'provenance',o.provenance,'verification_acceptance',o.verification_acceptance,'source_connection_id',source.connection_id,'credential_mode',c.credential_mode) FROM sf_target_identity_evidence e JOIN sf_database_observations o ON o.id=e.observation_id LEFT JOIN sf_instance_profile_sources source ON source.profile_id=$1 LEFT JOIN sf_database_connections c ON c.id=source.connection_id WHERE e.digest=$2 AND e.organization_id=$3 AND e.project_id=$4 AND e.assignment_id=$5 AND e.assignment_revision::text=$6 AND e.route_id=$7 AND e.exact_owner=$8 LIMIT 2")
        .bind(plans::id(&i["profileId"])?).bind(t["observationDigest"].as_str()).bind(ORG_UUID)
        .bind(plans::id(&i["projectId"])?).bind(plans::id(&t["assignmentId"])?).bind(t["assignmentRevision"].as_str())
        .bind(plans::id(&t["routeId"])?).bind(t["exactOwner"].as_str()).fetch_all(tx).await.map_err(Into::into)
}
async fn profile_current(tx: &mut PgConnection, p: &Value, i: &Value) -> Result<bool, ApiError> {
    let row:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(snapshot) FROM(SELECT p.id,p.name,p.environment_id,p.engine,p.host,p.port,p.service,p.username,p.retired_at,e.name AS environment_name,p.enabled,p.service_kind,p.revision,s.revision AS captured_revision FROM sf_profiles p JOIN sf_environments e ON e.id=p.environment_id AND e.project_id=p.project_id LEFT JOIN sf_connection_plan_revisions s ON s.profile_id=p.id AND s.plan_id=$1 WHERE p.id=$2 AND p.project_id=$3 AND p.organization_id=$4) snapshot")
        .bind(plans::id(&p["id"])?).bind(plans::id(&p["profile_id"])?).bind(plans::id(&p["project_id"])?).bind(ORG_UUID).fetch_optional(&mut *tx).await?;
    let Some(r) = row else {
        return Ok(false);
    };
    let captured = !r["captured_revision"].is_null()
        && (r["enabled"] == true
            && r["service_kind"] == "SERVICE_NAME"
            && r["revision"] == r["captured_revision"]);
    Ok(captured
        && r["retired_at"].is_null()
        && [
            ("id", "profileId"),
            ("name", "profileName"),
            ("environment_id", "environmentId"),
            ("environment_name", "environmentName"),
            ("engine", "engine"),
            ("host", "host"),
            ("port", "port"),
            ("service", "service"),
            ("username", "username"),
        ]
        .iter()
        .all(|(a, b)| r[a] == i[b])
        && currentness::profile_current(tx, plans::id(&r["id"])?).await?)
}
pub async fn read(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, plan)): Path<(String, String)>,
    query: Result<Query<Page>, QueryRejection>,
) -> ApiResult<Value> {
    let project = projects::id(&project).map_err(|_| invalid())?;
    let plan = projects::id(&plan).map_err(|_| invalid())?;
    let Query(q) = query.map_err(|_| invalid())?;
    if !kelryvo_core::digest(&json!(q.intent_digest))
        || q.analysis_digest
            .as_ref()
            .is_some_and(|d| !kelryvo_core::digest(&json!(d)))
    {
        return Err(invalid());
    }
    let after = q.after.as_deref().unwrap_or("0");
    if !(after == "0"
        || (after.len() <= 4
            && !after.starts_with('0')
            && after.bytes().all(|b| b.is_ascii_digit())))
    {
        return Err(invalid());
    }
    let after = after.parse::<usize>().map_err(|_| invalid())?;
    if (after > 0) != q.analysis_digest.is_some() {
        return Err(invalid());
    }
    let mut tx = state.pool.begin().await?;
    sqlx::query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *tx)
        .await?;
    if auth::access_mode_connection(&mut tx).await? != "ENFORCED" {
        return Err(not_found());
    }
    projects::guard_read(&mut tx, &auth, project).await?;
    let p: Value = sqlx::query_scalar(include_str!("../migration-analysis-plan.sql"))
        .bind(plan)
        .bind(project)
        .bind(ORG_UUID)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(not_found)?;
    let items = p["items"].as_array().map(|items| {
        items
            .iter()
            .map(|m| json!({"path":m["path"],"version":m["version"],"sha256":m["sha256"]}))
            .collect::<Vec<_>>()
    });
    let i=intent::verify(p["envelope"].as_str().unwrap_or_default(),p["offline_intent_digest"].as_str().unwrap_or_default(),
        Some(&json!({"organizationId":ORG_UUID,"projectId":project,"requesterId":p["author_id"],"releaseId":p["release_id"],"profileId":p["profile_id"],"items":items}))).ok_or_else(||conflict("FRESH_PLAN_REQUIRED"))?;
    if i["digest"] != q.intent_digest {
        return Err(conflict("FRESH_PLAN_REQUIRED"));
    }
    let mut target = i["target"].clone();
    if let Some(t) = target.as_object_mut() {
        t.shift_remove("privatePrincipalRef");
        t.shift_remove("credentialRef");
    }
    let base = json!({"projectId":project,"planId":plan,"releaseId":p["release_id"],"intentDigest":i["digest"],"manifestDigest":i["manifestDigest"],"target":target});
    let mut findings = Vec::new();
    let source_ok=match releases::load(&mut tx,project,plans::id(&p["release_id"])?).await {
        Ok(r)=>r["commit_id"]==i["commit"] && r["object_format"]==i["objectFormat"] && r["manifest_digest"]==i["manifestDigest"] && r["parser_profile"]==i["parserProfile"]
            && r["files"].as_array().map(|f|json!(f.iter().map(|f|json!({"path":f["path"],"version":f["version"],"sha256":f["sha256"]})).collect::<Vec<_>>())).as_ref()==Some(&i["items"]),
        Err(e) if e.1=="METADATA_UNAVAILABLE"=>return Err(e),Err(_)=>false,
    };
    check(
        &mut findings,
        "IMMUTABLE_SOURCE_VERIFIED",
        source_ok,
        "The retained release matches the plan source identity.",
        "The retained source or plan identity could not be verified.",
    );
    let source_current = p["archived_at"].is_null()
        && p["source_repository_id"] == p["repository_id"]
        && p["source_folder"] == p["folder"]
        && p["source_binding_generation"] == p["project_source_generation"]
        && (i["format"].as_u64().is_some_and(|n| n < 3)
            || i["target"]["sourceBindingGeneration"] == p["project_source_generation"]);
    check(
        &mut findings,
        "PROTECTED_SOURCE_CURRENT",
        source_current,
        "The project still points to this protected source binding.",
        "The project source binding changed or the project was archived.",
    );
    let out = if i["format"] == 1 || !i["statements"].is_array() {
        finding(
            &mut findings,
            "LEGACY_INTENT_FORMAT",
            if source_ok { "UNVERIFIED" } else { "BLOCKED" },
            if source_ok {
                "Statement identities are unavailable; retained file integrity was verified."
            } else {
                "Statement identities and retained source integrity could not be verified."
            },
        );
        let rows:Vec<_>=i["items"].as_array().ok_or_else(unavailable)?.iter().enumerate().map(|(n,m)|json!({"order":n+1,"path":m["path"],"version":m["version"],"sha256":m["sha256"],"status":if source_ok{"UNVERIFIABLE"}else{"BLOCKED"},"reason":if source_ok{"LEGACY_INTENT_FORMAT"}else{"SOURCE_INTEGRITY_FAILED"},"statementCount":null,"evidence":[]})).collect();
        let d = evidence_digest(
            &json!({"base":base,"findings":findings,"rows":rows,"source":p["manifest_digest"]}),
        );
        let mut out = answer(&base, &findings, &rows, 0, d);
        out["sqlAvailable"] = false.into();
        out["statements"] = json!([]);
        out["nextOrdinal"] = Value::Null;
        out
    } else {
        let profile_current = profile_current(&mut tx, &p, &i).await?;
        check(
            &mut findings,
            "PROFILE_CURRENT",
            profile_current,
            "The approved profile configuration is still current.",
            "The approved profile changed or was retired.",
        );
        if i["validation"].is_object() {
            let status = match validations::for_intent(&mut tx, &i).await {
                Ok(Some(v)) => match validations::currentness(&mut tx, &v).await {
                    Ok(c) if c["state"] == "CURRENT" => "PASS",
                    Ok(c) if c["state"] == "STALE" => "BLOCKED",
                    _ => "UNVERIFIED",
                },
                Ok(None) => "BLOCKED",
                Err(_) => "UNVERIFIED",
            };
            finding(
                &mut findings,
                "SCHEMA_VALIDATION_CURRENT",
                status,
                if status == "PASS" {
                    "The approved schema validation is still current."
                } else {
                    "The approved schema validation is stale or unavailable."
                },
            );
        }
        let migrations = migrations::approved_identities(&i).ok_or_else(unavailable)?;
        let migrations = migrations.as_array().ok_or_else(unavailable)?;
        if !source_ok {
            let rows:Vec<_>=migrations.iter().enumerate().map(|(n,m)|json!({"order":n+1,"path":m["path"],"version":m["version"],"sha256":m["sha256"],"status":"BLOCKED","reason":"SOURCE_INTEGRITY_FAILED","statementCount":m["statementDigests"].as_array().map(Vec::len),"evidence":[]})).collect();
            let d = evidence_digest(
                &json!({"base":base,"findings":findings,"rows":rows,"statementCount":0,"source":p["manifest_digest"]}),
            );
            let mut out = answer(&base, &findings, &rows, 0, d);
            out["approvedStatementCount"] = json!(i["statements"].as_array().map(Vec::len));
            out["sqlAvailable"] = false.into();
            out["statements"] = json!([]);
            out["nextOrdinal"] = Value::Null;
            out
        } else {
            let statements =
                source_statements(&p["files"], &i["statements"]).ok_or_else(unavailable)?;
            let reviews = review::statements(
                &statements,
                i["target"]["exactOwner"]
                    .as_str()
                    .or(i["username"].as_str())
                    .unwrap_or_default(),
                "oracle",
            )
            .ok_or_else(unavailable)?;
            let proofs = target_proof(&mut tx, &i).await?;
            let target_verified = proofs.len() == 1
                && kelryvo_core::history::target_digests(&i, &proofs[0])
                    .as_array()
                    .is_some_and(|a| !a.is_empty());
            let mut full = i["target"].clone();
            if full.is_object() {
                for k in [
                    "profileId",
                    "profileName",
                    "environmentId",
                    "environmentName",
                ] {
                    full[k] = i[k].clone();
                }
            }
            let target_current = target_verified
                && currentness::check(&mut tx, project, &full)
                    .await
                    .is_ok_and(|c| c["state"] == "CURRENT");
            if i["target"].is_object() {
                check(
                    &mut findings,
                    "TARGET_CONFIGURATION_CURRENT",
                    target_current,
                    "The approved target configuration is still current.",
                    "The target binding or its retained identity evidence changed.",
                );
            }
            let (completed, uncertain, holds) = history::completed(
                &mut tx,
                project,
                &i,
                migrations,
                if target_verified && target_current && profile_current {
                    Some(&proofs[0])
                } else {
                    None
                },
            )
            .await?;
            if !i["target"].is_object() {
                finding(
                    &mut findings,
                    "TARGET_BINDING_UNAVAILABLE",
                    "UNVERIFIED",
                    "Format 2 has statement identities but no exact target binding; comparison is metadata only.",
                );
            }
            if uncertain {
                finding(
                    &mut findings,
                    if holds {
                        "RETAINED_HOLD_PRESENT"
                    } else {
                        "RETAINED_HISTORY_UNCERTAIN"
                    },
                    "BLOCKED",
                    if holds {
                        "A retained HOLD exists for this migration stream."
                    } else {
                        "Retained history is incomplete, divergent, or exceeds the bounded comparison."
                    },
                );
            }
            if uncertain {
                finding(
                    &mut findings,
                    "RETAINED_HISTORY_UNCERTAIN",
                    "BLOCKED",
                    "Retained history is incomplete, divergent, or exceeds the bounded comparison.",
                );
            }
            let verified = target_verified
                && (i["format"].as_u64().is_some_and(|n| n < 3)
                    || target_current && profile_current);
            if !verified {
                finding(
                    &mut findings,
                    "TARGET_EVIDENCE_UNVERIFIED",
                    "UNVERIFIED",
                    "The retained target binding evidence could not be verified.",
                );
            }
            let rows:Vec<_>=migrations.iter().enumerate().map(|(n,m)|{
                let evidence=completed.get(&history::key(m));
                let status=if uncertain{"BLOCKED"}else if !verified{"UNVERIFIABLE"}else if evidence.is_some(){"COMPLETED"}else{"PENDING"};
                json!({"order":n+1,"path":m["path"],"version":m["version"],"sha256":m["sha256"],"status":status,"reason":match status{"COMPLETED"=>"RETAINED_COMPLETION_EVIDENCE","PENDING"=>"NO_RETAINED_COMPLETION",_=>status},"statementCount":m["statementDigests"].as_array().map(Vec::len),"evidence":evidence.into_iter().collect::<Vec<_>>()})
            }).collect();
            let statements = statements.as_array().ok_or_else(unavailable)?;
            let d = evidence_digest(
                &json!({"base":base,"findings":findings,"migrations":rows,"statementCount":statements.len()}),
            );
            if after > statements.len() {
                return Err(invalid());
            }
            if after > 0 && q.analysis_digest.as_deref() != Some(&d) {
                return Err(conflict("ANALYSIS_CHANGED"));
            }
            let page:Vec<_>=statements.iter().skip(after).take(50).map(|s|json!({"ordinal":s["ordinal"],"path":s["path"],"fileOrdinal":s["fileOrdinal"],"sourceSha256":s["sourceSha256"],"executionSha256":s["executionSha256"],"sourceSql":s["sourceSql"],"migrationStatus":rows.iter().find(|r|r["path"]==s["path"]).map(|r|&r["status"]),"review":reviews.as_array().and_then(|rs|rs.iter().find(|r|r["ordinal"]==s["ordinal"]))})).collect();
            let mut out = answer(&base, &findings, &rows, statements.len(), d);
            out["nextOrdinal"] = if after + page.len() < statements.len() {
                json!(after + page.len())
            } else {
                Value::Null
            };
            out["statements"] = json!(page);
            out
        }
    };
    tx.commit().await?;
    // Do not return retained SQL after credential or membership revocation that
    // committed while the repeatable-read comparison was in progress.
    let mut check = state.pool.begin().await?;
    projects::guard_read(&mut check, &auth, project).await?;
    check.commit().await?;
    Ok(Json(out))
}
