//! Read-only physical identity and catalog verification on an independently
//! installed observer session. A catalog match alone is no dispatch authority.
use super::{Bind, Result, Session, Unavailable, bounded};
use kelryvo_core::{evidence, js_whitespace};
use serde_json::{Value, json};
use std::collections::HashSet;

pub const PHYSICAL_IDENTITY_SQL: &str = "SELECT TO_CHAR(d.DBID) AS DBID,d.DB_UNIQUE_NAME,TO_CHAR(d.RESETLOGS_CHANGE#) AS RESETLOGS_CHANGE,d.CDB,TO_CHAR(c.CON_ID) AS CONTAINER_ID,TO_CHAR(c.DBID) AS CONTAINER_DBID,RAWTOHEX(c.GUID) AS CONTAINER_GUID,c.NAME AS CONTAINER_NAME,v.BANNER AS VERSION,SYS_CONTEXT('USERENV','CON_NAME') AS SESSION_CONTAINER_NAME,SYS_CONTEXT('USERENV','SERVICE_NAME') AS SERVICE_NAME,SYS_CONTEXT('USERENV','SESSION_USER') AS SESSION_USER,SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS SCHEMA_NAME,SYS_CONTEXT('USERENV','PROXY_USER') AS PROXY_USER,TO_CHAR(SYS_CONTEXT('USERENV','SID')) AS SID,TO_CHAR(SYS_CONTEXT('USERENV','SESSIONID')) AS AUDIT_SESSION_ID,TO_CHAR(SYS_CONTEXT('USERENV','INSTANCE')) AS INSTANCE_ID,(SELECT VALUE FROM SYS.NLS_SESSION_PARAMETERS WHERE PARAMETER='NLS_LENGTH_SEMANTICS') AS NLS_LENGTH_SEMANTICS FROM SYS.V_$DATABASE d CROSS JOIN SYS.V_$CONTAINERS c CROSS JOIN (SELECT BANNER FROM SYS.V_$VERSION WHERE ROWNUM=1) v WHERE c.CON_ID=SYS_CONTEXT('USERENV','CON_ID')";
pub const COLUMNS_SQL: &str = "SELECT COLUMN_NAME,DATA_TYPE,TO_CHAR(DATA_LENGTH) AS DATA_LENGTH,TO_CHAR(DATA_PRECISION) AS DATA_PRECISION,TO_CHAR(DATA_SCALE) AS DATA_SCALE,NULLABLE,TO_CHAR(CHAR_LENGTH) AS CHAR_LENGTH,CHAR_USED,DATA_DEFAULT FROM SYS.DBA_TAB_COLUMNS WHERE OWNER=:owner AND TABLE_NAME=:tableName ORDER BY COLUMN_ID";
pub const INDEXES_SQL: &str = "SELECT i.INDEX_NAME AS name,i.UNIQUENESS AS uniqueness,i.STATUS AS status,c.COLUMN_NAME AS column_name,TO_CHAR(c.COLUMN_POSITION) AS column_position FROM SYS.DBA_INDEXES i JOIN SYS.DBA_IND_COLUMNS c ON c.INDEX_OWNER=i.OWNER AND c.INDEX_NAME=i.INDEX_NAME WHERE i.OWNER=:owner AND i.TABLE_NAME=:tableName ORDER BY i.INDEX_NAME,c.COLUMN_POSITION";
pub const TABLE_STATUS_SQL: &str = "SELECT STATUS FROM SYS.DBA_OBJECTS WHERE OWNER=:owner AND OBJECT_NAME=:tableName AND OBJECT_TYPE='TABLE' AND SUBOBJECT_NAME IS NULL";
pub const EMPTY_SQL: &str = "SELECT TO_CHAR(COUNT(*)) AS N FROM SYS.DBA_OBJECTS WHERE OWNER=:owner";
fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes().enumerate().all(|(i, b)| {
            b.is_ascii_uppercase() || i > 0 && (b.is_ascii_digit() || b"_$#".contains(&b))
        })
}
fn text(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty() && s.len() <= max && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}
fn decimal(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 20
            && s.bytes().all(|b| b.is_ascii_digit())
            && (s == "0" || !s.starts_with('0'))
    })
}
pub fn physical_identity(session: &mut impl Session) -> Result<Option<Value>> {
    if !bounded(session) {
        return Ok(None);
    }
    let rows = session.query(PHYSICAL_IDENTITY_SQL, &[], 2)?;
    if rows.len() != 1 {
        return Ok(None);
    }
    let r = &rows[0];
    if !text(&r["session_user"], 128)
        || !text(&r["schema_name"], 128)
        || !r["proxy_user"].is_null()
        || !["sid", "audit_session_id", "instance_id"]
            .iter()
            .all(|k| decimal(&r[*k]))
        || !matches!(r["cdb"].as_str(), Some("YES" | "NO"))
        || !matches!(r["nls_length_semantics"].as_str(), Some("BYTE" | "CHAR"))
    {
        return Ok(None);
    }
    let raw = json!({"engine":"oracle","dbid":r["dbid"],"dbUniqueName":r["db_unique_name"],"resetlogsChange":r["resetlogs_change"],"cdb":r["cdb"]=="YES","containerId":r["container_id"],"containerGuid":r["container_guid"],"containerDbid":r["container_dbid"],"containerName":r["container_name"],"serviceName":r["service_name"],"version":r["version"]});
    let Some(identity) = evidence::exact_identity(&raw) else {
        return Ok(None);
    };
    if r["session_container_name"] != identity["containerName"] {
        return Ok(None);
    }
    let session = json!({"container_id":r["container_id"],"container_name":r["session_container_name"],"service_name":r["service_name"],"session_user":r["session_user"],"schema_name":r["schema_name"],"proxy_user":r["proxy_user"],"sid":r["sid"],"audit_session_id":r["audit_session_id"],"instance_id":r["instance_id"],"nls_length_semantics":r["nls_length_semantics"]});
    Ok(Some(json!({"identity":identity,"session":session})))
}
pub fn verify_identity(
    session: &mut impl Session,
    identity: &Value,
    version: &str,
    user: &str,
    schema: &str,
) -> Result<Option<Value>> {
    if evidence::exact_identity(identity).as_ref() != Some(identity)
        || session.server_version()? != version
    {
        return Ok(None);
    }
    let Some(found) = physical_identity(session)? else {
        return Ok(None);
    };
    if found["identity"] != *identity
        || found["session"]["session_user"] != user
        || found["session"]["schema_name"] != schema
    {
        return Ok(None);
    }
    Ok(Some(found))
}
pub fn empty_target(session: &mut impl Session, owner: &str) -> Result<bool> {
    if !bounded(session) || !identifier(owner) {
        return Ok(false);
    }
    let rows = session.query(EMPTY_SQL, &[Bind::new("owner", owner)], 2)?;
    Ok(rows.len() == 1 && rows[0]["n"] == "0")
}
fn nullable_integer(v: &Value) -> Option<Value> {
    if v.is_null() {
        return Some(Value::Null);
    }
    let s = v.as_str()?;
    if s.is_empty()
        || s.len() > 8
        || s.bytes()
            .enumerate()
            .any(|(i, b)| !b.is_ascii_digit() && !(i == 0 && b == b'-'))
    {
        return None;
    }
    s.parse::<i64>().ok().map(|n| json!(n))
}
fn normalize_default(s: &str) -> String {
    let s = s.trim_matches(js_whitespace);
    if s.starts_with('\'') {
        s.into()
    } else {
        s.chars()
            .filter(|c| !js_whitespace(*c))
            .collect::<String>()
            .to_uppercase()
    }
}
fn column(row: &Value) -> Option<Value> {
    if !identifier(row["column_name"].as_str()?)
        || !text(&row["data_type"], 128)
        || !matches!(row["nullable"].as_str(), Some("Y" | "N"))
    {
        return None;
    }
    let default = if row["data_default"].is_null() {
        Value::Null
    } else {
        let s = row["data_default"].as_str()?;
        if s.len() > 65536 {
            return None;
        }
        normalize_default(s).into()
    };
    Some(
        json!({"name":row["column_name"],"dataType":row["data_type"],"dataLength":nullable_integer(&row["data_length"] )?,"dataPrecision":nullable_integer(&row["data_precision"] )?,"dataScale":nullable_integer(&row["data_scale"] )?,"nullable":row["nullable"],"charLength":nullable_integer(&row["char_length"] )?,"charUsed":row["char_used"],"defaultExpression":default}),
    )
}
pub fn check_postconditions(
    session: &mut impl Session,
    owner: &str,
    conditions: &Value,
) -> Result<bool> {
    let Some(conditions) = conditions.as_array() else {
        return Ok(false);
    };
    if !bounded(session)
        || !identifier(owner)
        || conditions.is_empty()
        || conditions.len() > 128
        || conditions
            .iter()
            .map(|v| v.to_string().len())
            .sum::<usize>()
            > 8 * 1024 * 1024
    {
        return Ok(false);
    }
    let mut seen = HashSet::new();
    for expected in conditions {
        let Some(table) = expected["table"].as_str().filter(|t| identifier(t)) else {
            return Ok(false);
        };
        let Some(columns) = expected["columns"]
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 256)
        else {
            return Ok(false);
        };
        if !seen.insert(table) {
            return Ok(false);
        }
        let binds = [Bind::new("owner", owner), Bind::new("tableName", table)];
        let actual = session.query(COLUMNS_SQL, &binds, 257)?;
        if actual.len() != columns.len() {
            return Ok(false);
        }
        for (actual, expected) in actual.iter().zip(columns) {
            let Some(actual) = column(actual) else {
                return Ok(false);
            };
            if expected
                .as_object()
                .is_none_or(|o| o.is_empty() || o.iter().any(|(k, v)| actual.get(k) != Some(v)))
            {
                return Ok(false);
            }
        }
        let object = session.query(TABLE_STATUS_SQL, &binds, 2)?;
        if object.len() != 1 || object[0]["status"] != "VALID" {
            return Ok(false);
        }
        let indexes = session.query(INDEXES_SQL, &binds, 257)?;
        if indexes.len() > 256 {
            return Ok(false);
        }
        let mut grouped: Vec<Value> = Vec::new();
        let mut names = HashSet::new();
        for row in indexes {
            if row["status"] != "VALID"
                || !row["name"].as_str().is_some_and(identifier)
                || !row["column_name"].as_str().is_some_and(identifier)
                || !matches!(row["uniqueness"].as_str(), Some("UNIQUE" | "NONUNIQUE"))
            {
                return Ok(false);
            }
            if grouped.last().is_none_or(|g| g["name"] != row["name"]) {
                if !names.insert(row["name"].clone().to_string()) {
                    return Ok(false);
                }
                grouped
                    .push(json!({"name":row["name"],"uniqueness":row["uniqueness"],"columns":[]}));
            }
            let group = grouped.last_mut().ok_or(Unavailable)?;
            let values = group["columns"].as_array_mut().ok_or(Unavailable)?;
            if nullable_integer(&row["column_position"]) != Some(json!(values.len() + 1)) {
                return Ok(false);
            }
            values.push(row["column_name"].clone());
        }
        if expected
            .get("indexes")
            .is_some_and(|e| *e != json!(grouped))
        {
            return Ok(false);
        }
    }
    Ok(true)
}
