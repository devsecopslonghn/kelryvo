//! Project-scoped connection inventory. Observation schema visibility follows
//! the reader's assignments; listing never installs a runtime or opens Oracle.
use crate::{
    ApiError, ApiResult, AppState, ORG_UUID, auth::Authenticated, discovery, instances, invalid,
    projects,
};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::QueryRejection},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Filters {
    after: Option<String>,
    search: Option<String>,
    engine: Option<String>,
    environment: Option<String>,
    status: Option<String>,
}
impl Filters {
    fn validate(&self) -> Result<Option<Uuid>, ApiError> {
        if self
            .search
            .as_ref()
            .is_some_and(|s| s.encode_utf16().count() > 120)
            || self
                .engine
                .as_deref()
                .is_some_and(|s| !["oracle", "postgresql", "mysql"].contains(&s))
            || self
                .environment
                .as_deref()
                .is_some_and(|s| !["DEV", "SIT", "UAT", "PROD"].contains(&s))
            || self
                .status
                .as_deref()
                .is_some_and(|s| !["ENABLED", "DISABLED", "RETIRED"].contains(&s))
        {
            return Err(invalid());
        }
        self.after
            .as_ref()
            .map(|s| {
                if !kelryvo_core::uuid(&json!(s)) {
                    return Err(invalid());
                }
                Uuid::parse_str(s).map_err(|_| invalid())
            })
            .transpose()
    }
}

pub async fn list(
    State(state): State<AppState>,
    auth: Authenticated,
    Path(project): Path<String>,
    filters: Result<Query<Filters>, QueryRejection>,
) -> ApiResult<Value> {
    let project = projects::id(&project)?;
    let mut tx = state.pool.begin().await?;
    let manage = discovery::read_guard(&mut tx, &auth, project).await?;
    let Query(filters) = filters.map_err(|_| invalid())?;
    let after = filters.validate()?;
    let rows: Vec<Value> = sqlx::query_scalar("SELECT CASE WHEN octet_length(to_jsonb(c)::text)<=262144 THEN to_jsonb(c)||jsonb_build_object('revision',c.revision::text) END FROM sf_database_connections c JOIN sf_database_connection_projects p ON p.connection_id=c.id AND p.organization_id=c.organization_id JOIN sf_reference_containers t ON t.id=c.container_id AND t.organization_id=c.organization_id WHERE c.organization_id=$1 AND p.project_id=$2 AND ($3::uuid IS NULL OR c.id>$3) AND ($4::text IS NULL OR position(lower($4) in lower(c.name))>0) AND ($5::text IS NULL OR c.engine=$5) AND ($6::text IS NULL OR t.environment=$6) AND ($7::text IS NULL OR CASE WHEN c.retired_at IS NOT NULL THEN 'RETIRED' WHEN c.enabled THEN 'ENABLED' ELSE 'DISABLED' END=$7) AND (c.credential_mode='INSTANCE_MASTER' AND $8 OR EXISTS(SELECT 1 FROM sf_reference_schemas s JOIN sf_reference_assignments a ON a.schema_id=s.id AND a.organization_id=s.organization_id WHERE s.container_id=c.container_id AND s.organization_id=c.organization_id AND a.project_id=p.project_id AND a.closed_at IS NULL)) ORDER BY c.id LIMIT 51")
        .bind(ORG_UUID).bind(project).bind(after).bind(&filters.search).bind(&filters.engine)
        .bind(&filters.environment).bind(&filters.status).bind(manage).fetch_all(&mut *tx).await?;
    let mut connections = Vec::new();
    for row in rows.iter().take(50) {
        connections.push(instances::scoped_projection(&mut tx, row, project, manage).await?);
    }
    let infrastructure: Vec<Value> = sqlx::query_scalar("SELECT jsonb_build_object('assignmentId',a.id,'owner',s.exact_owner,'containerId',c.id,'containerName',c.name,'routeId',r.id,'host',r.host,'port',r.port,'service',r.service,'transport',r.transport) FROM sf_reference_assignments a JOIN sf_reference_schemas s ON s.id=a.schema_id AND s.organization_id=a.organization_id JOIN sf_reference_containers c ON c.id=s.container_id AND c.organization_id=s.organization_id JOIN sf_reference_services r ON r.container_id=c.id AND r.organization_id=c.organization_id WHERE a.organization_id=$1 AND a.project_id=$2 AND a.closed_at IS NULL ORDER BY a.id,r.id LIMIT 501")
        .bind(ORG_UUID).bind(project).fetch_all(&mut *tx).await?;
    let result = json!({"connections":connections,"nextCursor":if rows.len()>50 {rows[49]["id"].clone()} else {Value::Null},"canManage":manage,
        "infrastructure":infrastructure.iter().take(500).collect::<Vec<_>>(),"infrastructureTruncated":infrastructure.len()>500,
        "engineCapabilities":[{"engine":"oracle","supported":true},{"engine":"postgresql","supported":false},{"engine":"mysql","supported":false}]});
    if result.to_string().len() > kelryvo_core::MAX_STDOUT_BYTES {
        return Err(crate::conflict("CONNECTION_INVENTORY_LIMIT"));
    }
    tx.commit().await?;
    Ok(Json(result))
}
