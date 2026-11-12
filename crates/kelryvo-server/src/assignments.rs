//! Schema onboarding appends provisional options/bindings. Discovery cannot
//! manufacture verified identity or revive an earlier binding revision.
use crate::ObjectJson;
use crate::{
    ApiError, AppState, ORG_UUID, auth::Authenticated, conflict, discovery, instances, invalid,
    not_found, projects, targets, workspace::positive_revision,
};
use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use kelryvo_core::schema_scope::is_application_owner;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Assignment {
    observation_id: String,
    expected_connection_revision: String,
    owners: Vec<String>,
    environment_id: String,
    reason: String,
}
fn text(value: &str, max: usize) -> bool {
    projects::text(value, max) && !value.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn id(row: &Value, field: &str) -> Result<Uuid, ApiError> {
    projects::id(row[field].as_str().ok_or_else(invalid)?)
}

pub async fn assign(
    State(state): State<AppState>,
    auth: Authenticated,
    Path((project, connection)): Path<(String, String)>,
    ObjectJson(body): ObjectJson<Assignment>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let revision = positive_revision(&body.expected_connection_revision).ok_or_else(invalid)?;
    let observation = projects::id(&body.observation_id).map_err(|_| invalid())?;
    let environment = projects::id(&body.environment_id).map_err(|_| invalid())?;
    if !text(&body.reason, 500)
        || body.owners.is_empty()
        || body.owners.len() > 50
        || body.owners.iter().collect::<HashSet<_>>().len() != body.owners.len()
        || body
            .owners
            .iter()
            .any(|o| !text(o, 128) || !is_application_owner(o))
    {
        return Err(invalid());
    }
    let (project, connection) = (projects::id(&project)?, projects::id(&connection)?);
    let mut tx = state.pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    // Existing assignment operators take the schema advisory lock before
    // locking its project. Acquire the whole existing batch in UUID order
    // before the authority checkpoint takes project/credential locks.
    let schemas:Vec<Uuid>=sqlx::query_scalar("SELECT s.id FROM sf_reference_schemas s JOIN sf_database_connections c ON c.container_id=s.container_id AND c.organization_id=s.organization_id WHERE c.id=$1 AND c.organization_id=$2 AND s.exact_owner=ANY($3) AND s.generation=1 ORDER BY s.id").bind(connection).bind(ORG_UUID).bind(&body.owners).fetch_all(&mut *tx).await?;
    for schema in schemas {
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
            .bind(schema.to_string())
            .execute(&mut *tx)
            .await?;
    }
    instances::guard(&mut tx, &auth, project).await?;
    let c = discovery::scoped_connection(&mut tx, &auth, project, connection).await?;
    if c["credential_mode"] != "INSTANCE_MASTER"
        || !c["retired_at"].is_null()
        || c["enabled"] != true
        || c["service_kind"] != "SERVICE_NAME"
        || c["revision"].as_i64() != Some(revision)
    {
        return Err(conflict("CONNECTION_REVISION_CONFLICT"));
    }
    let managed = c["credential_ref"]
        .as_str()
        .is_some_and(|s| s.starts_with("vault://kelryvo/"));
    let runtime = if managed {
        crate::instance_runtime::current(&mut tx, connection, &c["revision"]).await?
    } else {
        None
    };
    if managed && runtime.is_none() {
        return Err(conflict("INSTANCE_RUNTIME_REQUIRED"));
    }
    if let Some(r) = &runtime
        && body.owners.iter().any(|owner| {
            !r["schemaOwners"]
                .as_array()
                .is_some_and(|a| a.iter().any(|s| s == owner))
        })
    {
        return Err(conflict("ORACLE_SQL_PROFILE_UNSUPPORTED"));
    }
    let username = runtime
        .as_ref()
        .map(|r| r["writerUsername"].clone())
        .unwrap_or_else(|| c["username"].clone());
    let credential = runtime
        .as_ref()
        .map(|r| r["writerCredentialRef"].clone())
        .unwrap_or_else(|| c["credential_ref"].clone());
    let env: Value = sqlx::query_scalar(
        "SELECT to_jsonb(e) FROM sf_environments e WHERE id=$1 AND project_id=$2 FOR UPDATE",
    )
    .bind(environment)
    .bind(project)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(not_found)?;
    let o:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(o)||jsonb_build_object('fresh',expires_at>clock_timestamp()) FROM sf_database_observations o WHERE id=$1 AND connection_id=$2 AND operation='DISCOVER'").bind(observation).bind(connection).fetch_optional(&mut *tx).await?;
    let latest:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_database_observations WHERE connection_id=$1 AND operation='DISCOVER' ORDER BY observed_at DESC,id DESC LIMIT 1").bind(connection).fetch_optional(&mut *tx).await?;
    let o = o.ok_or_else(|| conflict("DISCOVERY_STALE"))?;
    if o["fresh"] != true
        || latest != Some(observation)
        || o["connection_revision"] != c["revision"]
    {
        return Err(conflict("DISCOVERY_STALE"));
    }
    let container = id(&c, "container_id")?;
    if o["identity"].is_null()
        || !discovery::identity_current(&mut tx, container, &o["identity"]).await?
    {
        return Err(conflict("INSTANCE_PHYSICAL_IDENTITY_CONFLICT"));
    }
    if o["identity_digest"].is_null()
        || o["limitations"]
            .as_array()
            .is_none_or(|l| l.iter().any(|c| c == "IDENTITY_MISMATCH"))
        || body.owners.iter().any(|owner| {
            !o["schemas"].as_array().is_some_and(|schemas| {
                schemas
                    .iter()
                    .any(|s| s["owner"] == *owner && s["accessible"] == true)
            })
        })
    {
        return Err(conflict("SCHEMA_ACCESS_UNVERIFIED"));
    }
    let route:Value=sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_reference_services r WHERE id=$1 AND organization_id=$2 AND container_id=$3 FOR UPDATE").bind(id(&c,"route_id")?).bind(ORG_UUID).bind(container).fetch_optional(&mut *tx).await?.ok_or_else(||conflict("TARGET_OPTION_INELIGIBLE"))?;
    let mut profile:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(p) FROM sf_instance_profile_sources s JOIN sf_profiles p ON p.id=s.profile_id WHERE s.connection_id=$1 AND s.connection_revision=$2 AND p.project_id=$3 AND p.environment_id=$4 AND p.retired_at IS NULL AND p.enabled ORDER BY p.created_at DESC LIMIT 1 FOR UPDATE OF p").bind(connection).bind(revision).bind(project).bind(environment).fetch_optional(&mut *tx).await?;
    if profile.is_none() {
        let p:Value=sqlx::query_scalar("INSERT INTO sf_profiles(project_id,organization_id,environment_id,name,engine,host,port,service,username,credential_ref) VALUES($1,$2,$3,$4,'oracle',$5,$6,$7,$8,$9) RETURNING to_jsonb(sf_profiles)").bind(project).bind(ORG_UUID).bind(environment).bind(c["name"].as_str()).bind(c["host"].as_str()).bind(c["port"].as_i64().and_then(|p|i32::try_from(p).ok())).bind(c["service"].as_str()).bind(username.as_str()).bind(credential.as_str()).fetch_one(&mut *tx).await?;
        sqlx::query("INSERT INTO sf_instance_profile_sources(profile_id,connection_id,connection_revision) VALUES($1,$2,$3)").bind(id(&p,"id")?).bind(connection).bind(revision).execute(&mut *tx).await?;
        profile = Some(p);
    }
    let profile = profile.ok_or_else(|| conflict("TARGET_OPTION_INELIGIBLE"))?;
    if profile["service_kind"] != "SERVICE_NAME"
        || profile["host"] != c["host"]
        || profile["port"] != c["port"]
        || profile["service"] != c["service"]
        || profile["username"] != username
        || profile["credential_ref"] != credential
        || profile["engine"] != "oracle"
        || profile["host"].as_str().map(str::to_ascii_lowercase)
            != route["host"].as_str().map(str::to_ascii_lowercase)
        || profile["port"] != route["port"]
        || profile["service"] != route["service"]
    {
        return Err(conflict("TARGET_OPTION_INELIGIBLE"));
    }
    sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR UPDATE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.ok_or_else(||conflict("PROJECT_ARCHIVED"))?;
    // Match the established audit provenance: effective OS uid of the API
    // process, never a uid selected by a browser request.
    let uid = crate::config::process_uid().map_err(|_| {
        ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "OPERATOR_IDENTITY_UNAVAILABLE",
        )
    })?;
    let mut bindings = Vec::new();
    for owner in &body.owners {
        let schema:Value=sqlx::query_scalar("SELECT to_jsonb(s) FROM sf_reference_schemas s WHERE organization_id=$1 AND container_id=$2 AND exact_owner=$3 AND generation=1").bind(ORG_UUID).bind(container).bind(owner).fetch_optional(&mut *tx).await?.unwrap_or(Value::Null);
        let schema = if schema.is_null() {
            sqlx::query_scalar("INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) VALUES($1,$2,$3) RETURNING to_jsonb(sf_reference_schemas)").bind(ORG_UUID).bind(container).bind(owner).fetch_one(&mut *tx).await?
        } else {
            schema
        };
        let schema_id = id(&schema, "id")?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
            .bind(schema_id.to_string())
            .execute(&mut *tx)
            .await?;
        let schema: Value = sqlx::query_scalar(
            "SELECT to_jsonb(s) FROM sf_reference_schemas s WHERE id=$1 FOR UPDATE",
        )
        .bind(schema_id)
        .fetch_one(&mut *tx)
        .await?;
        let previous:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(a) FROM sf_reference_assignments a WHERE schema_id=$1 AND closed_at IS NULL FOR UPDATE").bind(schema_id).fetch_optional(&mut *tx).await?;
        let assignment = if let Some(previous) = previous {
            if previous["project_id"] != project.to_string() {
                return Err(conflict("SCHEMA_ALREADY_ASSIGNED"));
            }
            id(&previous, "id")?
        } else {
            let next = schema["revision"]
                .as_i64()
                .and_then(|r| r.checked_add(1))
                .ok_or_else(|| conflict("TARGET_REVISION_CONFLICT"))?;
            let assignment:Uuid=sqlx::query_scalar("INSERT INTO sf_reference_assignments(organization_id,schema_id,project_id,reason,operator_os_uid) VALUES($1,$2,$3,$4,$5) RETURNING id").bind(ORG_UUID).bind(schema_id).bind(project).bind(body.reason.trim_matches(kelryvo_core::js_whitespace)).bind(uid).fetch_one(&mut *tx).await?;
            sqlx::query("UPDATE sf_reference_schemas SET revision=$1 WHERE id=$2")
                .bind(next)
                .bind(schema_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query("INSERT INTO sf_reference_operator_audit(organization_id,schema_id,action,operator_os_uid,facts) VALUES($1,$2,'ASSIGN',$3,$4)").bind(ORG_UUID).bind(schema_id).bind(uid).bind(json!({"fromProjectId":null,"toProjectId":project,"revision":next.to_string(),"reason":body.reason.trim_matches(kelryvo_core::js_whitespace)})).execute(&mut *tx).await?;
            assignment
        };
        bindings.push(
            append_binding(
                &mut tx,
                &auth,
                &c,
                &profile,
                &env,
                schema_id,
                assignment,
                &body.reason,
                uid,
            )
            .await?,
        );
    }
    instances::audited(&mut tx,&auth,project,connection,"INSTANCE_SCHEMAS_ASSIGNED",json!({"owners":body.owners,"environmentId":environment,"revision":body.expected_connection_revision})).await?;
    tx.commit().await?;
    Ok((StatusCode::CREATED, Json(json!({"bindings":bindings}))))
}

#[allow(clippy::too_many_arguments)]
async fn append_binding(
    tx: &mut PgConnection,
    auth: &Authenticated,
    c: &Value,
    profile: &Value,
    env: &Value,
    schema: Uuid,
    assignment: Uuid,
    reason: &str,
    uid: i32,
) -> Result<Value, ApiError> {
    let (project, connection, container, environment, profile) = (
        id(env, "project_id")?,
        id(c, "id")?,
        id(c, "container_id")?,
        id(env, "id")?,
        id(profile, "id")?,
    );
    let lineage:Uuid=match sqlx::query_scalar("SELECT id FROM sf_target_lineages WHERE container_id=$1 AND organization_id=$2 FOR UPDATE").bind(container).bind(ORG_UUID).fetch_optional(&mut *tx).await? {
        Some(id)=>id,
        None=>sqlx::query_scalar("INSERT INTO sf_target_lineages(organization_id,container_id) VALUES($1,$2) RETURNING id").bind(ORG_UUID).bind(container).fetch_one(&mut *tx).await?,
    };
    let owner: String =
        sqlx::query_scalar("SELECT exact_owner FROM sf_reference_schemas WHERE id=$1")
            .bind(schema)
            .fetch_one(&mut *tx)
            .await?;
    let stream:Uuid=match sqlx::query_scalar("SELECT id FROM sf_target_streams WHERE lineage_id=$1 AND exact_owner=$2 AND migration_namespace='KELRYVO' FOR UPDATE").bind(lineage).bind(&owner).fetch_optional(&mut *tx).await? {
        Some(id)=>id,
        None=>sqlx::query_scalar("INSERT INTO sf_target_streams(organization_id,lineage_id,container_id,exact_owner,migration_namespace) VALUES($1,$2,$3,$4,'KELRYVO') RETURNING id").bind(ORG_UUID).bind(lineage).bind(container).bind(&owner).fetch_one(&mut *tx).await?,
    };
    let option = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_target_options(id,organization_id,assignment_id,project_id,schema_id,container_id,current_revision,enabled) VALUES($1,$2,$3,$4,$5,$6,1,true)").bind(option).bind(ORG_UUID).bind(assignment).bind(project).bind(schema).bind(container).execute(&mut *tx).await?;
    // The columns and joins are code-owned. Captured private facts stay in the
    // immutable revision, and the database's option/binding match trigger stays
    // active. No dynamically selected table or request-provided fact envelope.
    let inserted=sqlx::query("INSERT INTO sf_target_option_revisions(option_id,revision,organization_id,project_id,assignment_id,schema_id,container_id,profile_id,profile_name,environment_id,profile_host,profile_port,profile_service,profile_username,profile_credential_ref,profile_revision,route_id,route_config_revision,route_alias,route_host,route_port,route_service,lineage_id,identity_state,observation_digest,observed_at,stream_id,stream_state,migration_namespace,policy_id,policy_revision,exact_owner,deployment_principal_id,principal_purpose,private_principal_ref,principal_alias,operator_os_uid,reason) SELECT $1,1,$2,p.project_id,$3,s.id,s.container_id,p.id,p.name,p.environment_id,p.host,p.port,p.service,p.username,p.credential_ref,p.revision,c.route_id,1,c.name,r.host,r.port,r.service,$4,'PROVISIONAL',NULL,NULL,$5,'PROVISIONAL','KELRYVO',c.id,1,s.exact_owner,c.id,'DEPLOY',p.credential_ref,'Instance migration principal',$6,$7 FROM sf_profiles p JOIN sf_database_connections c ON c.id=$8 JOIN sf_reference_services r ON r.id=c.route_id JOIN sf_reference_schemas s ON s.id=$9 WHERE p.id=$10")
        .bind(option).bind(ORG_UUID).bind(assignment).bind(lineage).bind(stream).bind(uid).bind(reason.trim_matches(kelryvo_core::js_whitespace)).bind(connection).bind(schema).bind(profile).execute(&mut *tx).await?;
    if inserted.rows_affected() != 1 {
        return Err(conflict("TARGET_OPTION_INELIGIBLE"));
    }
    let current:Option<(Uuid,i64)>=sqlx::query_as("SELECT id,current_revision FROM sf_target_bindings WHERE project_id=$1 AND assignment_id=$2 AND environment_id=$3 FOR UPDATE").bind(project).bind(assignment).bind(environment).fetch_optional(&mut *tx).await?;
    let (binding, revision) = if let Some((binding, revision)) = current {
        (
            binding,
            revision
                .checked_add(1)
                .ok_or_else(|| conflict("TARGET_REVISION_CONFLICT"))?,
        )
    } else {
        let binding = Uuid::new_v4();
        sqlx::query("INSERT INTO sf_target_bindings(id,organization_id,project_id,assignment_id,environment_id,current_revision) VALUES($1,$2,$3,$4,$5,1)").bind(binding).bind(ORG_UUID).bind(project).bind(assignment).bind(environment).execute(&mut *tx).await?;
        (binding, 1)
    };
    let row:Value=sqlx::query_scalar("INSERT INTO sf_target_binding_revisions(binding_id,revision,organization_id,project_id,assignment_id,schema_id,container_id,assignment_revision,environment_id,environment_name,target_option_id,target_option_revision,profile_id,profile_name,profile_retired_at,lineage_id,identity_state,observation_digest,observed_at,stream_id,stream_state,migration_namespace,exact_owner,route_id,route_config_revision,route_alias,policy_id,policy_revision,deployment_principal_id,principal_purpose,private_principal_ref,principal_alias,actor_id,reason) SELECT $1,$2,o.organization_id,o.project_id,o.assignment_id,o.schema_id,o.container_id,s.revision,o.environment_id,e.name,o.option_id,o.revision,o.profile_id,o.profile_name,NULL,o.lineage_id,o.identity_state,o.observation_digest,o.observed_at,o.stream_id,'PROVISIONAL',o.migration_namespace,o.exact_owner,o.route_id,o.route_config_revision,o.route_alias,o.policy_id,o.policy_revision,o.deployment_principal_id,'DEPLOY',o.private_principal_ref,o.principal_alias,$3,$4 FROM sf_target_option_revisions o JOIN sf_reference_schemas s ON s.id=o.schema_id JOIN sf_environments e ON e.id=o.environment_id WHERE o.option_id=$5 AND o.revision=1 RETURNING to_jsonb(sf_target_binding_revisions)").bind(binding).bind(revision).bind(&auth.actor.id).bind(reason.trim_matches(kelryvo_core::js_whitespace)).bind(option).fetch_one(&mut *tx).await?;
    if current.is_some() {
        sqlx::query("UPDATE sf_target_bindings SET current_revision=$1 WHERE id=$2")
            .bind(revision)
            .bind(binding)
            .execute(&mut *tx)
            .await?;
    }
    projects::append_audit(tx,auth,project,"TARGET_BINDING_CREATED",binding,json!({"bindingId":binding,"bindingRevision":revision.to_string(),"assignmentId":assignment,"assignmentRevision":targets::revision(&row,"assignment_revision"),"environmentId":environment,"targetOptionId":option,"targetOptionRevision":"1","reason":reason.trim_matches(kelryvo_core::js_whitespace)})).await?;
    let mut row = row;
    row["binding_revision"] = revision.to_string().into();
    row["instance_connection_revision"] = targets::revision(c, "revision");
    Ok(targets::public_binding(&row))
}
