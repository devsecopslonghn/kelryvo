//! Trusted OS-operator catalog references and provisional target options.
//! No function observes Oracle, installs principals or grants dispatch authority.
mod options;
use crate::OperatorUnavailable;
use kelryvo_server::{ORG_UUID, auth, config, instances, plans};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;
type Result<T> = std::result::Result<T, OperatorUnavailable>;
fn fail() -> OperatorUnavailable {
    OperatorUnavailable
}
fn id(v: &Value) -> Result<Uuid> {
    plans::id(v).map_err(Into::into)
}
fn text(v: &Value, max: usize, trim: bool) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && (!trim || !s.trim_matches(kelryvo_core::js_whitespace).is_empty())
            && s.encode_utf16().count() <= max
            && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}
fn revision(v: &Value) -> Option<i64> {
    let s = v.as_str()?;
    if !(s == "0"
        || (!s.starts_with('0') && s.len() <= 19 && s.bytes().all(|b| b.is_ascii_digit())))
    {
        return None;
    }
    s.parse().ok()
}
fn keys(v: &Value, required: &[&str], optional: &[&str]) -> bool {
    v.as_object().is_some_and(|o| {
        required.iter().all(|k| o.contains_key(*k))
            && o.keys()
                .all(|k| required.contains(&k.as_str()) || optional.contains(&k.as_str()))
    })
}
fn uid() -> Result<i32> {
    let uid = config::process_uid().map_err(|_| fail())?;
    if [10001, 10002].contains(&uid) {
        Err(fail())
    } else {
        Ok(uid)
    }
}
async fn guard(tx: &mut PgConnection) -> Result<()> {
    auth::lifecycle_lock(tx).await?;
    auth::active_metadata(tx).await?;
    Ok(())
}
async fn schema_lock(tx: &mut PgConnection, schema: Uuid) -> Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,29))")
        .bind(schema.to_string())
        .execute(tx)
        .await?;
    Ok(())
}
fn port(v: &Value) -> Option<i32> {
    v.as_f64()
        .filter(|n| n.fract() == 0.0 && (1.0..=65535.0).contains(n))
        .map(|n| n as i32)
}
fn valid_host(s: &str) -> bool {
    if s.len() > 253 {
        return false;
    }
    if let Some(s) = s.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
        return !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit() || b == b':');
    }
    !s.is_empty()
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.as_bytes()[s.len() - 1].is_ascii_alphanumeric()
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
}
pub async fn operate(pool: &PgPool, action: &str, input: &Value) -> Result<Value> {
    let uid = uid()?;
    if action == "status" {
        if !keys(input, &[], &[]) {
            return Err(fail());
        }
        let rows:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(snapshot) FROM(SELECT d.id AS database_id,d.operator_key,d.display_label,d.server_uuid,c.id AS container_id,c.name,c.kind,c.environment,s.id AS service_id,s.host,s.port,s.service,s.transport,r.id AS schema_id,r.exact_owner,r.revision::text,r.generation::text,p.id AS current_project_id,p.name AS current_project_name,a.id AS assignment_id FROM sf_reference_databases d LEFT JOIN sf_reference_containers c ON c.database_id=d.id LEFT JOIN sf_reference_services s ON s.container_id=c.id LEFT JOIN sf_reference_schemas r ON r.container_id=c.id LEFT JOIN sf_reference_assignments a ON a.schema_id=r.id AND a.closed_at IS NULL LEFT JOIN sf_projects p ON p.id=a.project_id WHERE d.organization_id=$1 ORDER BY d.id,c.id,s.id,r.id) snapshot").bind(ORG_UUID).fetch_all(pool).await?;
        return Ok(json!(rows));
    }
    match action {
        "declare" => declare(pool, input, uid).await,
        "assign" | "release" => assign(pool, input, action == "release", uid).await,
        "target-option" => options::configure(pool, input, uid).await,
        _ => Err(fail()),
    }
}
async fn declare(pool: &PgPool, b: &Value, uid: i32) -> Result<Value> {
    let required = [
        "databaseKey",
        "databaseLabel",
        "containerKey",
        "containerName",
        "containerKind",
        "environment",
        "host",
        "port",
        "service",
        "transport",
        "owner",
    ];
    let key = |v: &Value| {
        text(v, 100, false)
            && v.as_str().is_some_and(|s| {
                s.as_bytes()[0].is_ascii_alphanumeric()
                    && s.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
            })
    };
    if !keys(b, &required, &[])
        || !key(&b["databaseKey"])
        || !key(&b["containerKey"])
        || !text(&b["databaseLabel"], 120, false)
        || !text(&b["containerName"], 120, false)
        || !["PDB", "NON_CDB"].contains(&b["containerKind"].as_str().unwrap_or_default())
        || !["DEV", "SIT", "UAT", "PROD"].contains(&b["environment"].as_str().unwrap_or_default())
        || !["TCP", "TCPS"].contains(&b["transport"].as_str().unwrap_or_default())
        || !b["host"].as_str().is_some_and(valid_host)
        || port(&b["port"]).is_none()
        || !b["service"].as_str().is_some_and(|s| {
            (1..=128).contains(&s.len())
                && s.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_$#.-".contains(&c))
        })
        || !b["owner"].as_str().is_some_and(|s| {
            !s.trim_matches(kelryvo_core::js_whitespace).is_empty()
                && s.chars().count() <= 128
                && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        })
    {
        return Err(fail());
    }
    let mut tx = pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    guard(&mut tx).await?;
    let existing:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(d) FROM sf_reference_databases d WHERE organization_id=$1 AND operator_key=$2 FOR UPDATE").bind(ORG_UUID).bind(b["databaseKey"].as_str()).fetch_optional(&mut *tx).await?;
    let database_added = existing.is_none();
    let database = if let Some(d) = existing {
        if d["display_label"] != b["databaseLabel"] {
            return Err(fail());
        }
        d
    } else {
        sqlx::query_scalar("INSERT INTO sf_reference_databases(organization_id,operator_key,display_label) VALUES($1,$2,$3) RETURNING to_jsonb(sf_reference_databases)").bind(ORG_UUID).bind(b["databaseKey"].as_str()).bind(b["databaseLabel"].as_str()).fetch_one(&mut *tx).await?
    };
    let siblings:Vec<Value>=sqlx::query_scalar("SELECT to_jsonb(c) FROM sf_reference_containers c WHERE database_id=$1 ORDER BY id FOR UPDATE").bind(id(&database["id"])?).fetch_all(&mut *tx).await?;
    if siblings.iter().any(|s| {
        s["kind"] != b["containerKind"]
            || b["containerKind"] == "NON_CDB" && s["registration_key"] != b["containerKey"]
    }) {
        return Err(fail());
    }
    let existing = siblings
        .iter()
        .find(|s| s["registration_key"] == b["containerKey"]);
    let container_added = existing.is_none();
    let container = if let Some(c) = existing {
        if c["name"] != b["containerName"]
            || c["kind"] != b["containerKind"]
            || c["environment"] != b["environment"]
        {
            return Err(fail());
        }
        c.clone()
    } else {
        sqlx::query_scalar("INSERT INTO sf_reference_containers(organization_id,database_id,registration_key,name,kind,environment) VALUES($1,$2,$3,$4,$5,$6) RETURNING to_jsonb(sf_reference_containers)").bind(ORG_UUID).bind(id(&database["id"])?).bind(b["containerKey"].as_str()).bind(b["containerName"].as_str()).bind(b["containerKind"].as_str()).bind(b["environment"].as_str()).fetch_one(&mut *tx).await?
    };
    let host = b["host"].as_str().ok_or_else(fail)?.to_ascii_lowercase();
    let route:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_reference_services r WHERE organization_id=$1 AND host=$2 AND port=$3 AND service=$4 AND transport=$5 FOR UPDATE").bind(ORG_UUID).bind(&host).bind(port(&b["port"])).bind(b["service"].as_str()).bind(b["transport"].as_str()).fetch_optional(&mut *tx).await?;
    let route_added = route.is_none();
    let route = if let Some(r) = route {
        if r["container_id"] != container["id"] {
            return Err(fail());
        }
        id(&r["id"])?
    } else {
        sqlx::query_scalar("INSERT INTO sf_reference_services(organization_id,container_id,host,port,service,transport) VALUES($1,$2,$3,$4,$5,$6) RETURNING id").bind(ORG_UUID).bind(id(&container["id"])?).bind(&host).bind(port(&b["port"])).bind(b["service"].as_str()).bind(b["transport"].as_str()).fetch_one(&mut *tx).await?
    };
    let schema:Option<Uuid>=sqlx::query_scalar("SELECT id FROM sf_reference_schemas WHERE container_id=$1 AND exact_owner=$2 AND generation=1 FOR UPDATE").bind(id(&container["id"])?).bind(b["owner"].as_str()).fetch_optional(&mut *tx).await?;
    let schema_added = schema.is_none();
    let schema = if let Some(s) = schema {
        s
    } else {
        sqlx::query_scalar("INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner) VALUES($1,$2,$3) RETURNING id").bind(ORG_UUID).bind(id(&container["id"])?).bind(b["owner"].as_str()).fetch_one(&mut *tx).await?
    };
    if database_added || container_added || route_added || schema_added {
        sqlx::query("INSERT INTO sf_reference_operator_audit(organization_id,schema_id,action,operator_os_uid,facts) VALUES($1,$2,'REGISTER',$3,$4)").bind(ORG_UUID).bind(schema).bind(uid).bind(json!({"databaseId":database["id"],"containerId":container["id"],"serviceId":route,"schemaId":schema,"provenance":"MANUAL_REFERENCE","generation":1})).execute(&mut *tx).await?;
    }
    let out = json!({"databaseId":database["id"],"databaseServerId":database["server_uuid"],"containerId":container["id"],"containerServerId":container["server_uuid"],"serviceId":route,"schemaId":schema,"generation":1,"provenance":"MANUAL_REFERENCE"});
    tx.commit().await?;
    Ok(out)
}
async fn assign(pool: &PgPool, b: &Value, release: bool, uid: i32) -> Result<Value> {
    let required = if release {
        vec!["schemaId", "expectedRevision", "reason"]
    } else {
        vec!["schemaId", "projectId", "expectedRevision", "reason"]
    };
    if !keys(b, &required, &[])
        || !b["reason"].as_str().is_some_and(|s| {
            !s.trim_matches(kelryvo_core::js_whitespace).is_empty()
                && s.encode_utf16().count() <= 500
                && !s.chars().any(
                    |c| matches!(c,'\u{0}'..='\u{8}'|'\u{b}'|'\u{c}'|'\u{e}'..='\u{1f}'|'\u{7f}'),
                )
        })
    {
        return Err(fail());
    }
    let schema = id(&b["schemaId"])?;
    let project = if release {
        None
    } else {
        Some(id(&b["projectId"])?)
    };
    let expected = revision(&b["expectedRevision"]).ok_or_else(fail)?;
    let mut tx = pool.begin().await?;
    instances::catalog_lock(&mut tx).await?;
    schema_lock(&mut tx, schema).await?;
    guard(&mut tx).await?;
    let current_revision: i64 = sqlx::query_scalar(
        "SELECT revision FROM sf_reference_schemas WHERE id=$1 AND organization_id=$2 FOR UPDATE",
    )
    .bind(schema)
    .bind(ORG_UUID)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(fail)?;
    if current_revision != expected {
        return Err(fail());
    }
    let current:Option<Value>=sqlx::query_scalar("SELECT to_jsonb(a) FROM sf_reference_assignments a WHERE schema_id=$1 AND closed_at IS NULL FOR UPDATE").bind(schema).fetch_optional(&mut *tx).await?;
    if let Some(project) = project
        && sqlx::query("SELECT id FROM sf_projects WHERE id=$1 AND organization_id=$2 AND archived_at IS NULL FOR UPDATE").bind(project).bind(ORG_UUID).fetch_optional(&mut *tx).await?.is_none(){return Err(fail());}
    if current.as_ref().map(|a| &a["project_id"]) == project.as_ref().map(|_| &b["projectId"]) {
        tx.commit().await?;
        return Ok(json!({"revision":expected.to_string(),"changed":false}));
    }
    let next = expected.checked_add(1).ok_or_else(fail)?;
    if let Some(a) = &current {
        sqlx::query("UPDATE sf_reference_assignments SET closed_at=clock_timestamp() WHERE id=$1")
            .bind(id(&a["id"])?)
            .execute(&mut *tx)
            .await?;
    }
    if let Some(project) = project {
        sqlx::query("INSERT INTO sf_reference_assignments(organization_id,schema_id,project_id,reason,operator_os_uid) VALUES($1,$2,$3,$4,$5)").bind(ORG_UUID).bind(schema).bind(project).bind(b["reason"].as_str()).bind(uid).execute(&mut *tx).await?;
    }
    let action = if current.is_some() {
        if project.is_some() {
            "TRANSFER"
        } else {
            "RELEASE"
        }
    } else {
        "ASSIGN"
    };
    sqlx::query("UPDATE sf_reference_schemas SET revision=$1 WHERE id=$2")
        .bind(next)
        .bind(schema)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO sf_reference_operator_audit(organization_id,schema_id,action,operator_os_uid,facts) VALUES($1,$2,$3,$4,$5)").bind(ORG_UUID).bind(schema).bind(action).bind(uid).bind(json!({"fromProjectId":current.as_ref().map(|a|&a["project_id"]),"toProjectId":project,"revision":next.to_string(),"reason":b["reason"]})).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(json!({"revision":next.to_string(),"changed":true,"action":action}))
}
