//! Retained catalog queries and signature profiles; no archive supplies SQL.
use super::{Result, unavailable};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use std::sync::OnceLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub signature: String,
    pub tables: Vec<String>,
    pub relations: Vec<String>,
    pub functions: Vec<String>,
    pub triggers: Vec<String>,
    pub sequences: Vec<String>,
    pub managed: bool,
    pub schema_baselines: bool,
    pub reconciliation: bool,
    pub bootstrap: String,
}
pub fn profiles() -> &'static [Profile] {
    static PROFILES: OnceLock<Vec<Profile>> = OnceLock::new();
    PROFILES.get_or_init(|| {
        let v: Value =
            serde_json::from_str(include_str!("profiles.json")).expect("exported backup profiles");
        serde_json::from_value(v["profiles"].clone()).expect("exported profile types")
    })
}
async fn rows(c: &mut PgConnection, sql: &str) -> Result<Value> {
    Ok(sqlx::query_scalar(&format!(
        "SELECT coalesce(json_agg(row_to_json(r)),'[]'::json) FROM ({sql}) r"
    ))
    .fetch_one(c)
    .await?)
}
pub fn digest(s: &Value) -> String {
    kelryvo_core::sha256(json!({"schemas":["public"],"tables":s["tables"],"relations":s["relations"],"functions":s["functions"],"triggers":s["triggers"],"columns":s["columns"],"constraints":s["constraints"],"indexes":s["indexes"],"routines":s["routines"],"triggerDefinitions":s["triggerDefinitions"],"sequenceDefinitions":s["sequenceDefinitions"],"ownership":s["ownership"]}).to_string())
}
fn matching_profile(s: &Value) -> Option<&'static Profile> {
    let actual = digest(s);
    profiles().iter().find(|p| {
        s["signature"] == p.signature
            && actual == p.signature
            && s["tables"] == json!(p.tables)
            && s["relations"] == json!(p.relations)
            && s["functions"] == json!(p.functions)
            && s["triggers"] == json!(p.triggers)
    })
}
pub fn profile(s: &Value) -> Result<&'static Profile> {
    let expected = [
        "tables",
        "relations",
        "functions",
        "triggers",
        "columns",
        "constraints",
        "indexes",
        "routines",
        "triggerDefinitions",
        "sequenceDefinitions",
        "ownership",
        "signature",
    ];
    let object = s.as_object().ok_or_else(unavailable)?;
    if object.len() != expected.len()
        || expected.iter().any(|k| !object.contains_key(*k))
        || expected[..11].iter().any(|k| !s[*k].is_array())
    {
        return Err(unavailable());
    }
    matching_profile(s).ok_or_else(|| {
        eprintln!("Unsupported backup schema signature: {}", digest(s));
        unavailable()
    })
}
async fn catalog(c: &mut PgConnection) -> Result<Value> {
    let schemas=rows(c,"SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname !~ '^pg_toast' ORDER BY nspname").await?;
    if schemas != json!([{"nspname":"public"}]) {
        return Err(unavailable());
    }
    let relations=rows(c,"SELECT c.relkind,n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') ORDER BY c.relkind,c.relname").await?;
    let mut tables = relations
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .filter(|v| v["relkind"] == "r" || v["relkind"] == "p")
        .map(|v| {
            v["relname"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(unavailable)
        })
        .collect::<Result<Vec<_>>>()?;
    tables.sort();
    let relations = relations
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .map(|v| {
            Ok(format!(
                "{}:{}",
                v["relkind"].as_str().ok_or_else(unavailable)?,
                v["relname"].as_str().ok_or_else(unavailable)?
            ))
        })
        .collect::<Result<Vec<_>>>()?;
    let functions=rows(c,"SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' ORDER BY p.proname").await?;
    let functions = functions
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .map(|v| v["proname"].clone())
        .collect::<Vec<_>>();
    let triggers=rows(c,"SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY t.tgname").await?;
    let triggers = triggers
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .map(|v| v["tgname"].clone())
        .collect::<Vec<_>>();
    let columns=rows(c,"SELECT table_name,column_name,ordinal_position::int AS ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position").await?;
    // regclass::text inherits the database locale; signatures retain catalog C order.
    let constraints=rows(c,"SELECT c.conname,c.contype,c.conrelid::regclass::text AS table_name,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname='public' ORDER BY c.conrelid::regclass::text COLLATE \"C\",c.conname").await?;
    let indexes=rows(c,"SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname").await?;
    let mut routines=rows(c,"SELECT p.proname,p.prokind,p.prosecdef,p.provolatile,p.proacl::text AS acl,(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned,pg_get_function_identity_arguments(p.oid) AS arguments,l.lanname AS language,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' ORDER BY p.proname,arguments").await?;
    let mut trigger_definitions=rows(c,"SELECT t.tgname,c.relname AS table_name,t.tgenabled,p.proname AS routine_name,pn.nspname AS routine_schema,pg_get_function_identity_arguments(p.oid) AS routine_arguments,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY t.tgname").await?;
    for rows in [&mut routines, &mut trigger_definitions] {
        for row in rows.as_array_mut().ok_or_else(unavailable)? {
            let row = row.as_object_mut().ok_or_else(unavailable)?;
            let definition = row.remove("definition").ok_or_else(unavailable)?;
            row.insert(
                "definitionSha256".into(),
                json!(kelryvo_core::sha256(
                    definition.as_str().ok_or_else(unavailable)?
                )),
            );
        }
    }
    let sequence_definitions=rows(c,"SELECT s.relname AS sequence_name,q.seqtypid::regtype::text AS type,q.seqstart::text AS start,q.seqincrement::text AS increment,q.seqmax::text AS maximum,q.seqmin::text AS minimum,q.seqcache::text AS cache,q.seqcycle AS cycle,d.deptype AS dependency_type,r.relname AS table_name,a.attname AS column_name FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_sequence q ON q.seqrelid=s.oid LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i') LEFT JOIN pg_class r ON r.oid=d.refobjid LEFT JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=d.refobjsubid WHERE n.nspname='public' ORDER BY s.relname").await?;
    let ownership=rows(c,"SELECT c.relname,c.relkind,(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned,c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','S') ORDER BY c.relname").await?;
    if ownership
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .chain(routines.as_array().ok_or_else(unavailable)?)
        .any(|v| v["owned"] != true || !v["acl"].is_null())
    {
        return Err(unavailable());
    }
    let mut s = json!({"tables":tables,"relations":relations,"functions":functions,"triggers":triggers,"columns":columns,"constraints":constraints,"indexes":indexes,"routines":routines,"triggerDefinitions":trigger_definitions,"sequenceDefinitions":sequence_definitions,"ownership":ownership});
    s["signature"] = json!(digest(&s));
    Ok(s)
}

fn legacy_constraint_order(s: &mut Value) -> Result<()> {
    let constraints = s["constraints"].as_array_mut().ok_or_else(unavailable)?;
    if constraints
        .iter()
        .any(|row| row["table_name"].as_str().is_none() || row["conname"].as_str().is_none())
    {
        return Err(unavailable());
    }
    // Preserve the English primary order in four frozen ASCII catalog profiles.
    // The complete unchanged record set must still match its original hash.
    constraints.sort_by_cached_key(|row| {
        let table = row["table_name"].as_str().unwrap();
        (
            table.replace('_', ""),
            table.to_owned(),
            row["conname"].as_str().unwrap().to_owned(),
        )
    });
    s["signature"] = json!(digest(s));
    Ok(())
}

pub async fn inventory(c: &mut PgConnection) -> Result<Value> {
    let current = catalog(c).await?;
    let mut legacy = current.clone();
    legacy_constraint_order(&mut legacy)?;
    let selected = if matching_profile(&legacy).is_some_and(|p| {
        ["preInstanceSchema", "instance", "password", "identity"].contains(&p.name.as_str())
    }) {
        legacy
    } else {
        current
    };
    profile(&selected)?;
    Ok(selected)
}

pub async fn inventory_for_profile(c: &mut PgConnection, expected: &Profile) -> Result<Value> {
    let mut current = catalog(c).await?;
    if current["signature"] != expected.signature {
        legacy_constraint_order(&mut current)?;
    }
    let actual = profile(&current)?;
    if actual.signature != expected.signature {
        return Err(unavailable());
    }
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    use kelryvo_server::connect;
    use uuid::Uuid;

    #[tokio::test]
    #[ignore = "requires kelryvo-test --operator-only private PostgreSQL fixture"]
    async fn all_declared_bootstraps_reproduce_exact_trusted_catalog_profiles() {
        let base = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").expect("private fixture");
        assert!(base.starts_with("postgresql:///kelryvo_rust_test?host="));
        let admin = connect(&base).await.unwrap();
        for expected in profiles() {
            let name = format!("sf_rust_profile_{}", Uuid::new_v4().simple());
            sqlx::query(&format!("CREATE DATABASE {name}"))
                .execute(&admin)
                .await
                .unwrap();
            let url = base.replacen("/kelryvo_rust_test?", &format!("/{name}?"), 1);
            let source = connect(&url).await.unwrap();
            sqlx::raw_sql(&expected.bootstrap)
                .execute(&source)
                .await
                .unwrap();
            {
                let mut c = source.acquire().await.unwrap();
                let actual = inventory_for_profile(&mut c, expected)
                    .await
                    .unwrap_or_else(|_| {
                        panic!("{} must reproduce its frozen signature", expected.name)
                    });
                assert_eq!(actual["signature"], expected.signature);
                let fresh = inventory(&mut c).await.unwrap();
                let original = if expected.name == "native-pre-vault-v1" {
                    profiles().iter().find(|p| p.name == "identity").unwrap()
                } else {
                    expected
                };
                assert_eq!(fresh["signature"], original.signature);
                eprintln!("Verified backup catalog profile {}.", expected.name);
                if expected.name == "identity" {
                    sqlx::raw_sql("ALTER TABLE sf_organizations ADD CONSTRAINT profile_regression_extra CHECK (name <> 'never-a-fixture')")
                        .execute(&mut *c).await.unwrap();
                    assert!(
                        inventory(&mut c).await.is_err(),
                        "changed constraints stay unsupported"
                    );
                    assert!(inventory_for_profile(&mut c, expected).await.is_err());
                }
            }
            source.close().await;
            sqlx::query(&format!("DROP DATABASE {name}"))
                .execute(&admin)
                .await
                .unwrap();
        }
        admin.close().await;
    }
}
