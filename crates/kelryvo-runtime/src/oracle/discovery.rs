//! Fixed read-only inventory queries. No connection, SQL, credential, native
//! acceptance or dispatch authority is supplied by a discovery request.
use super::{Bind, Result, Session, Unavailable, bounded};
use kelryvo_discovery::Operation;
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
pub const TEST: &str = "SELECT 1 AS ok FROM SYS.DUAL";
pub const DATABASE: &str = "SELECT TO_CHAR(DBID) AS dbid, DB_UNIQUE_NAME AS db_unique_name, TO_CHAR(RESETLOGS_CHANGE#) AS resetlogs_change, CDB AS cdb FROM SYS.V_$DATABASE";
pub const SESSION: &str = "SELECT SYS_CONTEXT('USERENV','CON_ID') AS container_id, SYS_CONTEXT('USERENV','CON_NAME') AS container_name, SYS_CONTEXT('USERENV','SERVICE_NAME') AS service_name, SYS_CONTEXT('USERENV','SESSION_USER') AS session_user, SYS_CONTEXT('USERENV','PROXY_USER') AS proxy_user FROM SYS.DUAL";
pub const CONTAINER: &str = "SELECT TO_CHAR(CON_ID) AS container_id, TO_CHAR(DBID) AS container_dbid, RAWTOHEX(GUID) AS container_guid, NAME AS container_name FROM SYS.V_$CONTAINERS WHERE CON_ID = SYS_CONTEXT('USERENV','CON_ID')";
pub const VERSION: &str = "SELECT BANNER AS version FROM SYS.V_$VERSION WHERE ROWNUM = 1";
pub const SCHEMAS: &str = "SELECT * FROM (SELECT U.USERNAME AS owner, CASE WHEN EXISTS (SELECT 1 FROM SYS.ALL_OBJECTS O WHERE O.OWNER = U.USERNAME) THEN 1 ELSE 0 END AS has_visible_object FROM SYS.ALL_USERS U ORDER BY U.USERNAME) WHERE ROWNUM <= 501";
pub const SCHEMA_SQL: &[(&str, &str)] = &[
    (
        "tables",
        "SELECT OWNER, TABLE_NAME AS NAME, TABLESPACE_NAME, TEMPORARY, PARTITIONED FROM SYS.ALL_TABLES WHERE OWNER = :owner AND ROWNUM <= 2001 ORDER BY TABLE_NAME",
    ),
    (
        "columns",
        "SELECT OWNER, TABLE_NAME AS NAME, COLUMN_NAME, TO_CHAR(COLUMN_ID) AS COLUMN_ID, DATA_TYPE, DATA_TYPE_OWNER, TO_CHAR(DATA_LENGTH) AS DATA_LENGTH, TO_CHAR(DATA_PRECISION) AS DATA_PRECISION, TO_CHAR(DATA_SCALE) AS DATA_SCALE, TO_CHAR(CHAR_LENGTH) AS CHAR_LENGTH, CHAR_USED, NULLABLE, DATA_DEFAULT FROM SYS.ALL_TAB_COLUMNS WHERE OWNER = :owner AND ROWNUM <= 2001 ORDER BY TABLE_NAME, COLUMN_ID",
    ),
    (
        "constraints",
        "SELECT OWNER, TABLE_NAME AS NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE, STATUS, DEFERRABLE, DEFERRED, R_OWNER, R_CONSTRAINT_NAME, SEARCH_CONDITION, DELETE_RULE, VALIDATED, RELY FROM SYS.ALL_CONSTRAINTS WHERE OWNER = :owner AND ROWNUM <= 2001 ORDER BY TABLE_NAME, CONSTRAINT_NAME",
    ),
    (
        "constraintColumns",
        "SELECT X.OWNER, X.TABLE_NAME AS NAME, X.CONSTRAINT_NAME, X.COLUMN_NAME, X.POSITION, F.R_OWNER AS REFERENCED_OWNER, R.TABLE_NAME AS REFERENCED_TABLE, R.COLUMN_NAME AS REFERENCED_COLUMN FROM SYS.ALL_CONS_COLUMNS X JOIN SYS.ALL_CONSTRAINTS F ON F.OWNER=X.OWNER AND F.CONSTRAINT_NAME=X.CONSTRAINT_NAME LEFT JOIN SYS.ALL_CONS_COLUMNS R ON R.OWNER=F.R_OWNER AND R.CONSTRAINT_NAME=F.R_CONSTRAINT_NAME AND R.POSITION=X.POSITION WHERE X.OWNER = :owner AND ROWNUM <= 2001 ORDER BY X.TABLE_NAME, X.CONSTRAINT_NAME, X.POSITION",
    ),
    (
        "views",
        "SELECT OWNER, VIEW_NAME AS NAME, TEXT FROM SYS.ALL_VIEWS WHERE OWNER = :owner AND ROWNUM <= 2001 ORDER BY VIEW_NAME",
    ),
    (
        "sequences",
        "SELECT SEQUENCE_OWNER AS OWNER, SEQUENCE_NAME AS NAME, TO_CHAR(MIN_VALUE) AS MIN_VALUE, TO_CHAR(MAX_VALUE) AS MAX_VALUE, TO_CHAR(INCREMENT_BY) AS INCREMENT_BY, CYCLE_FLAG, ORDER_FLAG, TO_CHAR(CACHE_SIZE) AS CACHE_SIZE, SCALE_FLAG, EXTEND_FLAG FROM SYS.ALL_SEQUENCES WHERE SEQUENCE_OWNER = :owner AND ROWNUM <= 2001 ORDER BY SEQUENCE_NAME",
    ),
    (
        "indexes",
        "SELECT OWNER, TABLE_NAME, INDEX_NAME AS NAME, INDEX_TYPE, UNIQUENESS, STATUS, PARTITIONED FROM SYS.ALL_INDEXES WHERE OWNER = :owner AND ROWNUM <= 2001 ORDER BY INDEX_NAME",
    ),
    (
        "indexColumns",
        "SELECT INDEX_OWNER AS OWNER, TABLE_NAME, INDEX_NAME AS NAME, COLUMN_NAME, COLUMN_POSITION, DESCEND FROM SYS.ALL_IND_COLUMNS WHERE INDEX_OWNER = :owner AND ROWNUM <= 2001 ORDER BY INDEX_NAME, COLUMN_POSITION",
    ),
    (
        "dependencies",
        "SELECT OWNER, NAME, TYPE, REFERENCED_OWNER, REFERENCED_NAME, REFERENCED_TYPE, REFERENCED_LINK_NAME, DEPENDENCY_TYPE FROM SYS.ALL_DEPENDENCIES WHERE OWNER = :owner AND ROWNUM <= 2001 ORDER BY NAME, REFERENCED_OWNER, REFERENCED_NAME",
    ),
];
#[derive(Clone, Copy)]
pub enum Provenance {
    OracleReadOnly,
    Fixture,
}
impl Provenance {
    fn name(self) -> &'static str {
        match self {
            Self::OracleReadOnly => "ORACLE_READ_ONLY",
            Self::Fixture => "FIXTURE",
        }
    }
}
fn clean(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn one(rows: &Option<Vec<Value>>) -> Value {
    rows.as_ref()
        .filter(|r| r.len() == 1)
        .map_or(Value::Null, |r| r[0].clone())
}
fn identity(
    db: &Value,
    session: &Value,
    container: &Value,
    version: &Value,
) -> (Option<Value>, bool) {
    if !session["proxy_user"].is_null() {
        return (None, false);
    }
    let cdb = match db["cdb"].as_str() {
        Some("YES" | "Y" | "TRUE" | "1") => true,
        Some("NO" | "N" | "FALSE" | "0") => false,
        _ => return (None, false),
    };
    if cdb && session["container_id"] == "1" {
        return (None, true);
    }
    if cdb
        && (container["container_id"] != session["container_id"]
            || container["container_name"] != session["container_name"])
    {
        return (None, false);
    }
    let guid = container["container_guid"]
        .as_str()
        .map(str::to_ascii_uppercase);
    let raw = json!({"engine":"oracle","dbid":db["dbid"],"dbUniqueName":db["db_unique_name"],"resetlogsChange":db["resetlogs_change"],"cdb":cdb,
        "containerId":session["container_id"],"containerGuid":if cdb {json!(guid)} else {Value::Null},"containerDbid":if cdb {&container["container_dbid"]} else {&db["dbid"]},
        "containerName":session["container_name"],"serviceName":session["service_name"],"version":version["version"]});
    (kelryvo_core::evidence::exact_identity(&raw), false)
}
fn output(
    status: &str,
    limitations: Vec<Value>,
    schemas: Vec<Value>,
    identity: Option<Value>,
    provenance: Provenance,
) -> Value {
    json!({"status":status,"limitations":limitations,"schemas":schemas,"identity":identity,"provenance":provenance.name(),"verificationAcceptance":null})
}
/// Caller owns a fresh, deadline-bounded observer session. This collector only
/// calls Session::query with compiled SQL and bound owners. It never supplies
/// live acceptance: the separately reviewed native host must qualify that fact.
pub fn observe(
    session: &mut impl Session,
    operation: Operation,
    owner: Option<&str>,
    expected: Option<&Value>,
    provenance: Provenance,
) -> Result<Value> {
    if !bounded(session)
        || (operation == Operation::Schema) != owner.is_some()
        || owner.is_some_and(|s| !clean(s))
        || expected.is_some_and(|v| kelryvo_core::evidence::exact_identity(v).as_ref() != Some(v))
    {
        return Err(Unavailable);
    }
    let test = session.query(TEST, &[], 1)?;
    if test.len() != 1 || test[0]["ok"] != 1 {
        return Err(Unavailable);
    }
    if operation == Operation::Test {
        return Ok(output("CONNECTED", vec![], vec![], None, provenance));
    }
    let db = session.query(DATABASE, &[], 1).ok();
    let current = session.query(SESSION, &[], 1).ok();
    let db_row = one(&db);
    let current_row = one(&current);
    let cdb = matches!(db_row["cdb"].as_str(), Some("YES" | "Y" | "TRUE" | "1"));
    let container = if cdb {
        session.query(CONTAINER, &[], 1).ok()
    } else {
        None
    };
    let version = session.query(VERSION, &[], 1).ok();
    let schemas = session.query(SCHEMAS, &[], 501).ok();
    let (identity, root) = identity(&db_row, &current_row, &one(&container), &one(&version));
    let mut limitations = Vec::new();
    if db.is_none() || current.is_none() || version.is_none() {
        limitations.push(json!("INSUFFICIENT_METADATA_PRIVILEGES"));
    }
    if identity.is_none() {
        limitations.push(json!(if root {
            "ROOT_CONTAINER_UNSUPPORTED"
        } else {
            "IDENTITY_INCOMPLETE"
        }));
    }
    if identity.as_ref().zip(expected).is_some_and(|(a, b)| a != b) {
        limitations.push(json!("IDENTITY_MISMATCH"));
    }
    let session_user = current_row["session_user"].as_str().filter(|s| clean(s));
    let mut schema_rows = schemas
        .as_ref()
        .map(|rows| {
            rows.iter().take(501).filter(|r| r["owner"].as_str().is_some_and(clean)).map(|r| {
        let visible = r["owner"].as_str() == session_user || r["has_visible_object"] == 1;
        json!({"owner":r["owner"],"accessible":if visible {json!(true)} else {Value::Null}})
    }).collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if schemas.is_none() || schema_rows.iter().any(|r| r["accessible"].is_null()) {
        limitations.push(json!("SCHEMA_VISIBILITY_LIMITED"));
    }
    if schema_rows.len() > 500 {
        schema_rows.truncate(500);
        limitations.push(json!("INVENTORY_TRUNCATED"));
    }
    let status = if identity.is_some() && limitations.is_empty() {
        "OBSERVED"
    } else {
        "PARTIAL"
    };
    let mut result = output(
        status,
        limitations,
        schema_rows,
        identity.clone(),
        provenance,
    );
    if let Some(owner) = owner {
        result["schema"] = inventory(session, owner, session_user, identity.is_some());
        // Sequential Oracle catalog reads do not provide a consistent snapshot.
        result["status"] = json!("PARTIAL");
    }
    Ok(result)
}
struct Rows {
    rows: Vec<Value>,
    ok: bool,
    truncated: bool,
}
fn groups(rows: &[Value], key: &str) -> HashMap<String, Vec<Value>> {
    let mut groups = HashMap::<String, Vec<Value>>::new();
    for row in rows {
        if let Some(key) = row[key].as_str() {
            groups.entry(key.into()).or_default().push(row.clone());
        }
    }
    groups
}
fn without(row: &Value, fields: &[&str]) -> Value {
    row.as_object()
        .map(|o| {
            o.iter()
                .filter(|(k, _)| !fields.contains(&k.as_str()))
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect::<serde_json::Map<_, _>>()
                .into()
        })
        .unwrap_or(Value::Null)
}
fn inventory(
    session: &mut impl Session,
    owner: &str,
    user: Option<&str>,
    identity_available: bool,
) -> Value {
    let mut all = HashMap::new();
    let mut remaining = 16 * 1024 * 1024;
    for &(name, sql) in SCHEMA_SQL {
        let rows = session
            .query(sql, &[Bind::new("owner", owner)], 2001)
            .ok()
            .filter(|r| {
                let bytes = r.iter().map(|v| v.to_string().len()).sum::<usize>();
                if bytes > 4 * 1024 * 1024 || bytes > remaining {
                    false
                } else {
                    remaining -= bytes;
                    true
                }
            });
        let ok = rows.is_some();
        let mut rows = rows.unwrap_or_default();
        let truncated = rows.len() > 2000;
        rows.truncate(2000);
        all.insert(
            name,
            Rows {
                rows,
                ok,
                truncated,
            },
        );
    }
    let mut coverage = json!({});
    let mut limitations = vec![json!("MULTI_QUERY_CONSISTENCY_UNGUARANTEED")];
    if !identity_available {
        limitations.push(json!("IDENTITY_INCOMPLETE"));
    }
    if Some(owner) != user {
        limitations.push(json!("FOREIGN_OWNER_VISIBILITY_PARTIAL"));
    }
    for (kind, names) in [
        (
            "TABLE",
            vec!["tables", "columns", "constraints", "constraintColumns"],
        ),
        ("VIEW", vec!["views"]),
        ("SEQUENCE", vec!["sequences"]),
        ("INDEX", vec!["indexes", "indexColumns"]),
        ("DEPENDENCY", vec!["dependencies"]),
    ] {
        let ok = names.iter().all(|n| all[n].ok);
        let truncated = names.iter().any(|n| all[n].truncated);
        coverage[kind] = json!(
            if ok && !truncated && Some(owner) == user && identity_available {
                "COMPLETE"
            } else if ok {
                "PARTIAL"
            } else {
                "UNAVAILABLE"
            }
        );
        if truncated {
            limitations.push(json!(format!("{kind}_ROW_LIMIT_EXCEEDED")));
        }
        if !ok {
            limitations.push(json!(format!("{kind}_QUERY_UNAVAILABLE")));
        }
    }
    let constraints = &all["constraints"].rows;
    if constraints
        .iter()
        .any(|r| r["constraint_type"] == "C" && !r["search_condition"].is_string())
    {
        coverage["TABLE"] = json!("PARTIAL");
        limitations.push(json!("CONSTRAINT_PREDICATE_UNAVAILABLE"));
    }
    for (name, kind) in [("tables", "TABLE"), ("indexes", "INDEX")] {
        if all[name].rows.iter().any(|r| r["partitioned"] == "YES") {
            coverage[kind] = json!("PARTIAL");
            limitations.push(json!("PARTITION_DEFINITIONS_UNAVAILABLE"));
        }
    }
    if coverage["VIEW"] != "UNAVAILABLE"
        && ["constraints", "constraintColumns"]
            .iter()
            .any(|n| !all[n].ok || all[n].truncated)
    {
        coverage["VIEW"] = json!("PARTIAL");
    }
    let columns = groups(&all["columns"].rows, "name");
    let cons = groups(constraints, "name");
    let con_cols = groups(&all["constraintColumns"].rows, "constraint_name");
    let constraints_for = |name: &str| {
        cons.get(name)
            .into_iter()
            .flatten()
            .map(|r| {
                let mut r = r.clone();
                r["columns"] = json!(
                    con_cols
                        .get(r["constraint_name"].as_str().unwrap_or(""))
                        .into_iter()
                        .flatten()
                        .map(|c| {
                            let mut col = json!({"name":c["column_name"],"position":c["position"]});
                            if r["constraint_type"] == "R" {
                                col["referencedOwner"] = c
                                    .get("referenced_owner")
                                    .filter(|v| !v.is_null())
                                    .unwrap_or(&r["r_owner"])
                                    .clone();
                                col["referencedTable"] = c["referenced_table"].clone();
                                col["referencedColumn"] = c["referenced_column"].clone();
                            }
                            col
                        })
                        .collect::<Vec<_>>()
                );
                r
            })
            .collect::<Vec<_>>()
    };
    if constraints
        .iter()
        .filter(|r| r["constraint_type"] == "R")
        .any(|r| {
            con_cols
                .get(r["constraint_name"].as_str().unwrap_or(""))
                .is_none_or(|cols| {
                    cols.is_empty()
                        || cols.iter().any(|c| {
                            !c["referenced_table"].is_string()
                                || !c["referenced_column"].is_string()
                        })
                })
        })
    {
        coverage["TABLE"] = json!("PARTIAL");
        limitations.push(json!("FK_REFERENCE_UNAVAILABLE"));
    }
    let mut objects = Vec::new();
    let mut tables = HashSet::new();
    for table in &all["tables"].rows {
        if let Some(name) = table["name"]
            .as_str()
            .filter(|n| tables.insert((*n).to_owned()))
        {
            let mut definition = table.clone();
            definition["columns"] = json!(
                columns
                    .get(name)
                    .into_iter()
                    .flatten()
                    .map(|c| without(c, &["owner", "name"]))
                    .collect::<Vec<_>>()
            );
            definition["constraints"] = json!(constraints_for(name));
            objects.push(json!({"owner":owner,"type":"TABLE","name":name,"definition":definition}));
        }
    }
    for view in &all["views"].rows {
        if let Some(name) = view["name"].as_str() {
            let text = view["text"].as_str();
            let complete = text.is_some_and(|s| s.encode_utf16().count() <= 65536);
            let text = text.map(|s| {
                String::from_utf16_lossy(&s.encode_utf16().take(65536).collect::<Vec<_>>())
            });
            objects.push(json!({"owner":owner,"type":"VIEW","name":name,"definition":{"text":text,"textComplete":complete,"constraints":constraints_for(name)}}));
            if !complete {
                coverage["VIEW"] = json!("PARTIAL");
                limitations.push(json!(if text.is_none() {
                    "VIEW_TEXT_UNAVAILABLE"
                } else {
                    "VIEW_TEXT_TRUNCATED"
                }));
            }
        }
    }
    for sequence in &all["sequences"].rows {
        if sequence["name"].is_string() {
            objects.push(json!({"owner":owner,"type":"SEQUENCE","name":sequence["name"],"definition":without(sequence, &["last_number"])}));
        }
    }
    let index_columns = groups(&all["indexColumns"].rows, "name");
    for index in &all["indexes"].rows {
        if let Some(name) = index["name"].as_str() {
            let cols = index_columns.get(name).cloned().unwrap_or_default();
            let expression = cols.iter().any(|c| {
                c["column_name"]
                    .as_str()
                    .is_some_and(|s| s.starts_with("SYS_NC"))
            }) || index["index_type"]
                .as_str()
                .is_some_and(|s| s.contains("FUNCTION-BASED"));
            let mut definition = index.clone();
            definition["columns"] = if expression {
                Value::Null
            } else {
                json!(
                    cols.iter()
                        .map(|c| without(c, &["owner", "name"]))
                        .collect::<Vec<_>>()
                )
            };
            definition["expressionKnown"] = json!(!expression);
            objects.push(json!({"owner":owner,"type":"INDEX","name":name,"definition":definition}));
            if expression && coverage["INDEX"] == "COMPLETE" {
                coverage["INDEX"] = json!("PARTIAL");
                limitations.push(json!("INDEX_EXPRESSION_UNAVAILABLE"));
            }
        }
    }
    for dependency in &all["dependencies"].rows {
        if dependency["name"].is_string() {
            let name = json!([
                dependency["name"],
                dependency["type"],
                dependency["referenced_owner"],
                dependency["referenced_name"],
                dependency["referenced_type"],
                dependency["referenced_link_name"],
                dependency["dependency_type"]
            ])
            .to_string();
            objects.push(
                json!({"owner":owner,"type":"DEPENDENCY","name":name,"definition":dependency}),
            );
        }
    }
    kelryvo_core::schema::normalize(
        &json!({"owner":owner,"objects":objects,"coverage":coverage,"limitations":limitations}),
        &json!(owner),
    )
}
