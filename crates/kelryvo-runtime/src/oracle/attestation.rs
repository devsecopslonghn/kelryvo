//! Exact grant/object/source witnesses from the private observer. Installation
//! authority must independently bind these to reviewed native artifacts and TLS.
use super::{Bind, Result, Session, Unavailable, bounded, mutex::owner_valid};
use kelryvo_core::{evidence_digest, sha256};
use serde_json::{Value, json};
use std::collections::HashSet;

pub struct Principals<'a> {
    pub writer: &'a str,
    pub ledger_owner: &'a str,
    pub observer: &'a str,
    pub schemas: &'a [String],
}
fn projected(rows: Vec<Value>, fields: &[&str]) -> Option<Vec<Value>> {
    rows.into_iter()
        .map(|r| {
            fields
                .iter()
                .map(|k| Some((k.to_ascii_uppercase(), r.get(*k)?.clone())))
                .collect()
        })
        .collect()
}
fn sort(rows: &mut [Value], fields: &[&str]) {
    rows.sort_by_cached_key(|r| {
        fields
            .iter()
            .map(|k| r[*k].as_str().unwrap_or_default())
            .collect::<Vec<_>>()
            .join(":")
    });
}
pub fn grant_digest(session: &mut impl Session, p: &Principals<'_>) -> Result<Option<String>> {
    let names = [p.writer, p.ledger_owner, p.observer];
    if !bounded(session)
        || names.iter().any(|n| !owner_valid(n))
        || names.iter().collect::<HashSet<_>>().len() != 3
        || p.schemas.is_empty()
        || p.schemas.len() > 50
        || p.schemas
            .iter()
            .any(|s| !owner_valid(s) || names.contains(&s.as_str()))
        || p.schemas.iter().collect::<HashSet<_>>().len() != p.schemas.len()
    {
        return Ok(None);
    }
    let binds = [
        Bind::new("w", p.writer),
        Bind::new("l", p.ledger_owner),
        Bind::new("o", p.observer),
    ];
    let sys=session.query("SELECT GRANTEE,PRIVILEGE,ADMIN_OPTION,COMMON,INHERITED FROM SYS.DBA_SYS_PRIVS WHERE GRANTEE IN (:w,:l,:o) ORDER BY GRANTEE,PRIVILEGE",&binds,129)?;
    let roles=session.query("SELECT GRANTEE,GRANTED_ROLE,ADMIN_OPTION,DEFAULT_ROLE,COMMON,INHERITED FROM SYS.DBA_ROLE_PRIVS WHERE GRANTEE IN (:w,:l,:o) ORDER BY GRANTEE,GRANTED_ROLE",&binds,129)?;
    let schema=session.query("SELECT GRANTEE,SCHEMA AS SCHEMA_NAME,PRIVILEGE,ADMIN_OPTION,COMMON,INHERITED FROM SYS.DBA_SCHEMA_PRIVS WHERE GRANTEE IN (:w,:l,:o) ORDER BY GRANTEE,SCHEMA,PRIVILEGE",&binds,513)?;
    let Some(mut sys) = projected(
        sys,
        &[
            "grantee",
            "privilege",
            "admin_option",
            "common",
            "inherited",
        ],
    ) else {
        return Ok(None);
    };
    let mut expected_sys=names.iter().map(|name|json!({"GRANTEE":name,"PRIVILEGE":"CREATE SESSION","ADMIN_OPTION":"NO","COMMON":"NO","INHERITED":"NO"})).collect::<Vec<_>>();
    sort(&mut sys, &["GRANTEE", "PRIVILEGE"]);
    sort(&mut expected_sys, &["GRANTEE", "PRIVILEGE"]);
    if sys != expected_sys || !roles.is_empty() {
        return Ok(None);
    }
    let Some(mut schema) = projected(
        schema,
        &[
            "grantee",
            "schema_name",
            "privilege",
            "admin_option",
            "common",
            "inherited",
        ],
    ) else {
        return Ok(None);
    };
    let mut expected_schema = Vec::new();
    for owner in p.schemas {
        for (grantee, privilege) in [
            (p.observer, "READ ANY TABLE"),
            (p.writer, "READ ANY TABLE"),
            (p.writer, "ALTER ANY TABLE"),
            (p.writer, "CREATE ANY INDEX"),
            (p.writer, "CREATE ANY TABLE"),
        ] {
            expected_schema.push(json!({"GRANTEE":grantee,"SCHEMA_NAME":owner,"PRIVILEGE":privilege,"ADMIN_OPTION":"NO","COMMON":"NO","INHERITED":"NO"}));
        }
    }
    sort(&mut schema, &["GRANTEE", "SCHEMA_NAME", "PRIVILEGE"]);
    sort(
        &mut expected_schema,
        &["GRANTEE", "SCHEMA_NAME", "PRIVILEGE"],
    );
    if schema != expected_schema {
        return Ok(None);
    }
    let objects=session.query("SELECT GRANTEE,OWNER,TABLE_NAME,PRIVILEGE,GRANTABLE,COMMON,INHERITED FROM SYS.DBA_TAB_PRIVS WHERE GRANTEE IN (:w,:l,:o) OR (GRANTEE='PUBLIC' AND OWNER='SYS' AND TABLE_NAME='DBMS_LOCK') ORDER BY GRANTEE,OWNER,TABLE_NAME,PRIVILEGE",&binds,2049)?;
    let Some(mut objects) = projected(
        objects,
        &[
            "grantee",
            "owner",
            "table_name",
            "privilege",
            "grantable",
            "common",
            "inherited",
        ],
    ) else {
        return Ok(None);
    };
    let mut expected_objects = Vec::new();
    let mut add = |grantee: &str, owner: &str, name: &str, privilege: &str| {
        expected_objects.push(json!({"GRANTEE":grantee,"OWNER":owner,"TABLE_NAME":name,"PRIVILEGE":privilege,"GRANTABLE":"NO","COMMON":"NO","INHERITED":"NO"}))
    };
    for principal in [p.writer, p.ledger_owner] {
        for name in ["V_$CONTAINERS", "V_$DATABASE", "V_$VERSION"] {
            add(
                principal,
                "SYS",
                name,
                if name == "V_$VERSION" {
                    "READ"
                } else {
                    "SELECT"
                },
            )
        }
    }
    add(p.writer, p.ledger_owner, "SF_TARGET_MUTEX", "EXECUTE");
    add(p.ledger_owner, "SYS", "DBMS_LOCK", "EXECUTE");
    for name in ["SF_TARGET_LEDGER_EVENTS", "SF_TARGET_LEDGER_HEAD"] {
        add(p.observer, p.ledger_owner, name, "SELECT")
    }
    for name in [
        "DBA_CONSTRAINTS",
        "DBA_CONS_COLUMNS",
        "DBA_INDEXES",
        "DBA_IND_COLUMNS",
        "DBA_OBJECTS",
        "DBA_ROLE_PRIVS",
        "DBA_SCHEMA_PRIVS",
        "DBA_SOURCE",
        "DBA_SYS_PRIVS",
        "DBA_TAB_COLUMNS",
        "DBA_TAB_PRIVS",
        "DBA_TRIGGERS",
        "DBA_USERS",
        "V_$CONTAINERS",
        "V_$DATABASE",
        "V_$LOCK",
        "V_$SESSION",
        "V_$VERSION",
        "GV_$SESSION",
    ] {
        add(
            p.observer,
            "SYS",
            name,
            if name == "V_$VERSION" {
                "READ"
            } else {
                "SELECT"
            },
        )
    }
    sort(
        &mut objects,
        &["GRANTEE", "OWNER", "TABLE_NAME", "PRIVILEGE"],
    );
    sort(
        &mut expected_objects,
        &["GRANTEE", "OWNER", "TABLE_NAME", "PRIVILEGE"],
    );
    if objects != expected_objects {
        return Ok(None);
    }
    let mut users = names
        .iter()
        .map(|s| s.to_string())
        .chain(p.schemas.iter().cloned())
        .collect::<Vec<_>>();
    users.sort();
    users.dedup();
    let user_binds = users
        .iter()
        .enumerate()
        .map(|(n, s)| Bind::new(&format!("u{n}"), s.clone()))
        .collect::<Vec<_>>();
    let list = (0..users.len())
        .map(|n| format!(":u{n}"))
        .collect::<Vec<_>>()
        .join(",");
    let accounts=session.query(&format!("SELECT USERNAME,ACCOUNT_STATUS,ORACLE_MAINTAINED,AUTHENTICATION_TYPE FROM SYS.DBA_USERS WHERE USERNAME IN ({list}) ORDER BY USERNAME"),&user_binds,65)?;
    let Some(mut accounts) = projected(
        accounts,
        &[
            "username",
            "account_status",
            "oracle_maintained",
            "authentication_type",
        ],
    ) else {
        return Ok(None);
    };
    sort(&mut accounts, &["USERNAME"]);
    if accounts.len() != users.len()
        || accounts.iter().zip(&users).any(|(a, name)| {
            a["USERNAME"] != *name
                || a["ACCOUNT_STATUS"] != "OPEN"
                || a["ORACLE_MAINTAINED"] != "N"
                || a["AUTHENTICATION_TYPE"]
                    != if names.contains(&name.as_str()) {
                        "PASSWORD"
                    } else {
                        "NONE"
                    }
        })
    {
        return Ok(None);
    }
    let public=session.query("SELECT GRANTEE,OWNER,TABLE_NAME,PRIVILEGE FROM SYS.DBA_TAB_PRIVS WHERE GRANTEE='PUBLIC' AND OWNER='SYS' AND TABLE_NAME='DBMS_LOCK' AND PRIVILEGE='EXECUTE'",&[],2)?;
    if !public.is_empty() {
        return Ok(None);
    }
    Ok(Some(evidence_digest(
        &json!({"sys":sys,"roles":roles,"schema":schema,"objects":objects,"accounts":accounts,"publicLock":public}),
    )))
}
fn source_hash(rows: &[Value], name: &str, kind: &str) -> Option<String> {
    let group = rows
        .iter()
        .filter(|r| r["name"] == name && r["type"] == kind)
        .collect::<Vec<_>>();
    if group.is_empty() || group.len() > 4000 {
        return None;
    }
    let mut source = String::new();
    for (n, row) in group.into_iter().enumerate() {
        if row["line"].as_str()?.parse::<usize>().ok()? != n + 1 {
            return None;
        }
        source.push_str(row["text"].as_str()?);
        if source.len() > 4 * 1024 * 1024 {
            return None;
        }
    }
    Some(sha256(source))
}
/// Read back the exact compiled source after trusted provisioning. A digest is
/// an observation, not authorization to replace an existing protected object.
pub fn installed_source_hash(
    session: &mut impl Session,
    owner: &str,
    name: &str,
    kind: &str,
) -> Result<Option<String>> {
    if !super::mutex::owner_valid(owner)
        || name.is_empty()
        || name.len() > 128
        || !name.bytes().enumerate().all(|(i, b)| {
            b.is_ascii_uppercase() || i > 0 && (b.is_ascii_digit() || b"_$#".contains(&b))
        })
        || !["PACKAGE", "PACKAGE BODY", "TRIGGER"].contains(&kind)
        || !bounded(session)
    {
        return Ok(None);
    }
    let rows=session.query("SELECT s.NAME,s.TYPE,TO_CHAR(s.LINE) AS LINE,s.TEXT FROM SYS.DBA_SOURCE s WHERE s.OWNER=:owner AND s.NAME=:name AND s.TYPE=:kind ORDER BY s.LINE",&[Bind::new("owner",owner),Bind::new("name",name),Bind::new("kind",kind)],4001)?;
    if rows.len() > 4000 {
        return Ok(None);
    }
    Ok(source_hash(&rows, name, kind))
}

pub fn protected_object_witness(
    session: &mut impl Session,
    owner: &str,
    trigger_digest: &str,
    package_digest: &str,
) -> Result<Option<String>> {
    if !bounded(session)
        || !owner_valid(owner)
        || !super::digest(&json!(trigger_digest))
        || !super::digest(&json!(package_digest))
    {
        return Ok(None);
    }
    let binds = [Bind::new("owner", owner)];
    let objects=session.query("SELECT OBJECT_NAME,OBJECT_TYPE,STATUS,TO_CHAR(OBJECT_ID) AS OBJECT_ID FROM SYS.DBA_OBJECTS WHERE OWNER=:owner AND SUBOBJECT_NAME IS NULL AND ((OBJECT_NAME IN ('SF_TARGET_LEDGER_HEAD','SF_TARGET_LEDGER_EVENTS') AND OBJECT_TYPE='TABLE') OR (OBJECT_NAME='SF_TARGET_LEDGER_EVENTS_IMMUTABLE' AND OBJECT_TYPE='TRIGGER') OR (OBJECT_NAME='SF_TARGET_MUTEX' AND OBJECT_TYPE IN ('PACKAGE','PACKAGE BODY')))",&binds,6)?;
    if objects.len() != 5 {
        return Ok(None);
    }
    let mut protected = Vec::new();
    for (name, kind) in [
        ("SF_TARGET_LEDGER_HEAD", "TABLE"),
        ("SF_TARGET_LEDGER_EVENTS", "TABLE"),
        ("SF_TARGET_LEDGER_EVENTS_IMMUTABLE", "TRIGGER"),
        ("SF_TARGET_MUTEX", "PACKAGE"),
        ("SF_TARGET_MUTEX", "PACKAGE BODY"),
    ] {
        let found = objects
            .iter()
            .filter(|r| r["object_name"] == name && r["object_type"] == kind)
            .collect::<Vec<_>>();
        if found.len() != 1
            || found[0]["status"] != "VALID"
            || !found[0]["object_id"].as_str().is_some_and(|s| {
                !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
            })
        {
            return Ok(None);
        }
        protected
            .push(json!({"OBJECT_TYPE":kind,"STATUS":"VALID","OBJECT_ID":found[0]["object_id"]}));
    }
    let sources=session.query("SELECT s.NAME,s.TYPE,TO_CHAR(s.LINE) AS LINE,s.TEXT FROM SYS.DBA_SOURCE s WHERE s.OWNER=:owner AND ((s.NAME='SF_TARGET_LEDGER_EVENTS_IMMUTABLE' AND s.TYPE='TRIGGER') OR (s.NAME='SF_TARGET_MUTEX' AND s.TYPE IN ('PACKAGE','PACKAGE BODY'))) ORDER BY s.NAME,s.TYPE,s.LINE",&binds,12001)?;
    if sources.len() > 12000 {
        return Ok(None);
    }
    let Some(trigger) = source_hash(&sources, "SF_TARGET_LEDGER_EVENTS_IMMUTABLE", "TRIGGER")
    else {
        return Ok(None);
    };
    let Some(spec) = source_hash(&sources, "SF_TARGET_MUTEX", "PACKAGE") else {
        return Ok(None);
    };
    let Some(body) = source_hash(&sources, "SF_TARGET_MUTEX", "PACKAGE BODY") else {
        return Ok(None);
    };
    let package = sha256(format!("{spec}{body}"));
    if trigger != trigger_digest || package != package_digest {
        return Ok(None);
    }
    let triggers=session.query("SELECT OWNER,TRIGGER_NAME,STATUS,TRIGGERING_EVENT FROM SYS.DBA_TRIGGERS WHERE TABLE_OWNER=:owner AND TABLE_NAME IN ('SF_TARGET_LEDGER_HEAD','SF_TARGET_LEDGER_EVENTS') ORDER BY OWNER,TRIGGER_NAME",&binds,33)?;
    if triggers.len() != 1
        || triggers[0]["owner"] != owner
        || triggers[0]["trigger_name"] != "SF_TARGET_LEDGER_EVENTS_IMMUTABLE"
        || triggers[0]["status"] != "ENABLED"
    {
        return Ok(None);
    }
    let split = regex::Regex::new(r"\s+OR\s+").expect("constant event grammar");
    let mut events = split
        .split(triggers[0]["triggering_event"].as_str().unwrap_or_default())
        .collect::<Vec<_>>();
    events.sort_unstable();
    if events != ["DELETE", "UPDATE"] {
        return Ok(None);
    }
    let ddl=session.query("SELECT OWNER,TRIGGER_NAME,STATUS,BASE_OBJECT_TYPE,TRIGGERING_EVENT FROM SYS.DBA_TRIGGERS WHERE BASE_OBJECT_TYPE IN ('DATABASE','SCHEMA') AND OWNER NOT IN ('SYS','SYSTEM') AND REGEXP_LIKE(TRIGGERING_EVENT,'(^| OR )(CREATE|ALTER|DROP)( |$)') ORDER BY OWNER,TRIGGER_NAME",&[],101)?;
    if !ddl.is_empty() {
        return Ok(None);
    }
    let triggers = projected(
        triggers,
        &["owner", "trigger_name", "status", "triggering_event"],
    )
    .ok_or(Unavailable)?;
    protected.push(json!(triggers));
    protected.push(json!(trigger));
    protected.push(json!(package));
    protected.push(json!(ddl));
    Ok(Some(evidence_digest(&json!(protected))))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    struct SourceReader {
        reads: usize,
    }
    impl Session for SourceReader {
        fn instance(&self) -> Uuid {
            Uuid::nil()
        }
        fn call_timeout_ms(&self) -> u64 {
            5000
        }
        fn server_version(&mut self) -> Result<String> {
            panic!("source read does not need another server query")
        }
        fn query(&mut self, sql: &str, binds: &[Bind], max: usize) -> Result<Vec<Value>> {
            self.reads += 1;
            assert!(sql.contains("s.NAME=:name AND s.TYPE=:kind"));
            assert_eq!(binds[0].value, "KRV_FIXTURE_L");
            assert_eq!(max, 4001);
            Ok(vec![
                json!({"name":binds[1].value,"type":binds[2].value,"line":"1","text":"TRIGGER fixture\n"}),
                json!({"name":binds[1].value,"type":binds[2].value,"line":"2","text":"BEGIN NULL; END;\n"}),
            ])
        }
        fn execute(&mut self, _: &str, _: &[Bind]) -> Result<u64> {
            panic!("source observation must remain read only")
        }
        fn commit(&mut self) -> Result<()> {
            panic!("source observation cannot commit")
        }
        fn rollback(&mut self) -> Result<()> {
            panic!("source observation cannot roll back")
        }
        fn mutex_call(&mut self, _: &str, _: &str, _: &str, _: &str) -> Result<i64> {
            panic!("source observation cannot acquire a mutex")
        }
    }

    #[test]
    fn installed_trigger_source_accepts_object_names_beyond_the_principal_limit() {
        let mut reader = SourceReader { reads: 0 };
        let name = "SF_TARGET_LEDGER_EVENTS_IMMUTABLE";
        assert!(name.len() > 30);
        assert_eq!(
            installed_source_hash(&mut reader, "KRV_FIXTURE_L", name, "TRIGGER")
                .expect("read installed trigger"),
            Some(sha256("TRIGGER fixture\nBEGIN NULL; END;\n"))
        );
        assert_eq!(reader.reads, 1);
        for invalid in [String::new(), "X".repeat(129), "T' OR 1=1".into()] {
            assert!(
                installed_source_hash(&mut reader, "KRV_FIXTURE_L", &invalid, "TRIGGER")
                    .expect("invalid object name")
                    .is_none()
            );
        }
        assert!(
            installed_source_hash(&mut reader, name, name, "TRIGGER")
                .expect("principal limit stays unchanged")
                .is_none()
        );
        assert_eq!(reader.reads, 1);
    }
}
