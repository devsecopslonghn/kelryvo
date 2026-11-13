//! Insert captured synthetic metadata through normal constraints in the caller's
//! private PostgreSQL fixture. No live Oracle, installation or target witness.
use crate::{Result, root};
use serde_json::{Value, json};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub async fn seed(mode: &str) -> Result<Value> {
    let name = match mode {
        "target" => "seed-target-bound",
        "option" => "seed-target-option",
        "completion" => "seed-completion",
        _ => return Err("Unsupported private fixture".into()),
    };
    let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL")?;
    if !url.starts_with("postgresql:///kelryvo_rust_test?host=") {
        return Err("Private native test database required".into());
    }
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await?;
    let result = seed_in(&pool, name, mode).await;
    pool.close().await;
    result
}
async fn seed_in(pool: &PgPool, name: &str, mode: &str) -> Result<Value> {
    let fixture: Value = serde_json::from_slice(&std::fs::read(
        root().join(format!("tests/fixtures/contracts/{name}.json")),
    )?)?;
    let mut rows = fixture["rows"].clone();
    if mode != "completion" {
        let project = std::env::var("KELRYVO_RUST_TEST_PROJECT_ID")?;
        let project_id = Uuid::parse_str(&project)?;
        let (environment, environment_name): (Uuid, String) = sqlx::query_as(
            "SELECT id,name FROM sf_environments WHERE project_id=$1 ORDER BY created_at LIMIT 1",
        )
        .bind(project_id)
        .fetch_one(pool)
        .await?;
        let profile = &rows["sf_profiles"][0];
        let original = profile["project_id"].as_str().ok_or("Fixture project")?;
        let original_environment = profile["environment_id"]
            .as_str()
            .ok_or("Fixture environment")?;
        let mut replacements = HashMap::from([
            (original.to_owned(), project.clone()),
            (original_environment.to_owned(), environment.to_string()),
            (
                "00000000-0000-4000-8000-000000000001".into(),
                "00000000-0000-4000-8000-000000000001".into(),
            ),
        ]);
        let wire = rows
            .to_string()
            .replace(&original.replace('-', ""), &project.replace('-', ""));
        let pattern = regex::Regex::new(r"(?i)[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")?;
        let wire = pattern.replace_all(&wire, |captures: &regex::Captures<'_>| {
            replacements
                .entry(captures[0].to_owned())
                .or_insert_with(|| Uuid::new_v4().to_string())
                .clone()
        });
        rows = serde_json::from_str(&wire)?;
        for records in rows.as_object_mut().ok_or("Fixture rows")?.values_mut() {
            for row in records.as_array_mut().ok_or("Fixture records")? {
                if row.get("environment_name").is_some() {
                    row["environment_name"] = environment_name.clone().into();
                }
            }
        }
    }
    let mut tx = pool.begin().await?;
    sqlx::query("SET CONSTRAINTS ALL DEFERRED")
        .execute(&mut *tx)
        .await?;
    let mut pending: HashSet<String> = rows
        .as_object()
        .ok_or("Fixture tables")?
        .keys()
        .cloned()
        .collect();
    let identifier = regex::Regex::new(r"^[a-z_][a-z0-9_]*$")?;
    while !pending.is_empty() {
        // Preserve captured table insertion order, including self/deferred
        // option/binding revision cycles. Never disable triggers or constraints.
        let table = rows
            .as_object()
            .unwrap()
            .keys()
            .find(|table| {
                pending.contains(*table)
                    && fixture["dependencies"].as_array().is_some_and(|deps| {
                        deps.iter().all(|d| {
                            d["child"] != table.as_str()
                                || !pending.contains(d["parent"].as_str().unwrap_or(""))
                                || d["parent"] == table.as_str()
                                || matches!(
                                    (table.as_str(), d["parent"].as_str()),
                                    ("sf_target_options", Some("sf_target_option_revisions"))
                                        | (
                                            "sf_target_bindings",
                                            Some("sf_target_binding_revisions")
                                        )
                                )
                        })
                    })
            })
            .cloned()
            .ok_or("Fixture dependency cycle")?;
        if !table.starts_with("sf_") || !identifier.is_match(&table) {
            return Err("Invalid fixture table".into());
        }
        for row in rows[&table].as_array_mut().ok_or("Fixture records")? {
            if table == "sf_local_credentials" {
                let now = chrono::Utc::now();
                row["issued_at"] = now
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                    .into();
                row["expires_at"] = (now + chrono::Duration::days(1))
                    .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                    .into();
            }
            let fields: Vec<_> = row
                .as_object()
                .ok_or("Fixture row")?
                .keys()
                .map(String::as_str)
                .collect();
            if !fields.iter().all(|name| identifier.is_match(name)) {
                return Err("Invalid fixture field".into());
            }
            let fields = fields.join(",");
            let query = format!(
                "INSERT INTO {table}({fields}) SELECT {fields} FROM json_populate_record(NULL::{table},$1::json)"
            );
            sqlx::query(&query)
                .bind(row.to_string())
                .execute(&mut *tx)
                .await?;
        }
        pending.remove(&table);
    }
    tx.commit().await?;
    Ok(match mode {
        "completion" => fixture["output"].clone(),
        "target" => {
            json!({"binding":{"bindingId":rows["sf_target_bindings"][0]["id"],"bindingRevision":rows["sf_target_bindings"][0]["current_revision"].to_string().trim_matches('"'),"assignmentRevision":rows["sf_target_binding_revisions"][0]["assignment_revision"].to_string().trim_matches('"')}})
        }
        _ => {
            json!({"assignmentId":rows["sf_target_options"][0]["assignment_id"],"expectedAssignmentRevision":"1","environmentId":rows["sf_profiles"][0]["environment_id"],"targetOptionId":rows["sf_target_options"][0]["id"],"expectedTargetOptionRevision":"1","expectedBindingRevision":"0","reason":"Bind native compatibility fixture"})
        }
    })
}
