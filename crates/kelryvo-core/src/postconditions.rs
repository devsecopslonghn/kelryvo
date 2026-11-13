//! Catalog projections for the installed NUMBER/VARCHAR2 BYTE profile.
use crate::coordinator::Statement;
use crate::{matches, schema_scope, sha256, string};
use serde_json::{Value, json};

fn identifier(value: &Value) -> bool {
    matches(r"\A[A-Z][A-Z0-9_$#]{0,127}\z", string(value))
}

fn column_expected(column: &Value) -> Option<Value> {
    let tokens = column["typeTokens"].as_array()?;
    let datatype = tokens.first()?.as_str()?;
    let precision = if tokens.get(1).is_some_and(|t| t == "(") {
        Some(tokens.get(2)?.as_str()?.parse::<u64>().ok()?)
    } else {
        None
    };
    if !identifier(&column["name"]) {
        return None;
    }
    let mut result = json!({"name":column["name"],"dataType":datatype,"nullable":if column["nullable"].as_bool()? {"Y"} else {"N"},"dataPrecision":null,"dataScale":null,"defaultExpression":null});
    if datatype == "NUMBER" {
        if precision.is_some_and(|p| !(1..=38).contains(&p)) {
            return None;
        }
        let scale = if precision.is_none() {
            None
        } else if tokens.get(3).is_some_and(|v| v == ",") {
            Some(tokens.get(4)?.as_str()?.parse::<u64>().ok()?)
        } else {
            Some(0)
        };
        if scale.is_some_and(|s| s > 127) {
            return None;
        }
        result["dataLength"] = 22.into();
        result["dataPrecision"] = json!(precision);
        result["dataScale"] = json!(scale);
    } else if datatype == "VARCHAR2" {
        let precision = precision?;
        if !(1..=4000).contains(&precision) || tokens.iter().any(|t| t == "CHAR") {
            return None;
        }
        result["dataLength"] = precision.into();
        result["charLength"] = precision.into();
        result["charUsed"] = "B".into();
    } else {
        return None;
    }
    if let Some(defaults) = column["defaultTokens"].as_array() {
        let literal = defaults.first()?;
        result["defaultExpression"] = if literal["type"] == "string" {
            format!("'{}'", string(&literal["value"]).replace('\'', "''")).into()
        } else if literal["value"] == "-" {
            format!("-{}", defaults.get(1)?["value"].as_str()?).into()
        } else {
            literal["value"].clone()
        };
    }
    Some(result)
}

pub fn compile(migrations: &Value, statements: &[Statement], owner: &str) -> Option<Value> {
    let migrations = migrations.as_array()?;
    if migrations.is_empty()
        || migrations.len() > 128
        || statements.is_empty()
        || statements.len() > 4096
    {
        return None;
    }
    let mut tables: Vec<Value> = Vec::new();
    let mut by_version = json!({});
    let mut ordinal = 0;
    let mut projection_bytes = 0;
    for migration in migrations {
        let digests = migration["statementDigests"].as_array()?;
        let version = migration["version"].as_str()?;
        if digests.is_empty()
            || !matches(r"\A[0-9]+(?:\.[0-9]+)*\z", version)
            || by_version.get(version).is_some()
        {
            return None;
        }
        for digest in digests {
            let statement = statements.get(ordinal)?;
            ordinal += 1;
            if digest != &statement.digest || sha256(&statement.bytes) != statement.digest {
                return None;
            }
            let sql = std::str::from_utf8(&statement.bytes).ok()?;
            let parsed = schema_scope::assess(sql, owner, true);
            if parsed["eligible"] != true || !identifier(&parsed["target"]["name"]) {
                return None;
            }
            let target = &parsed["target"];
            let description = &parsed["description"];
            if target["objectType"] == "INDEX" {
                let index_columns = description["indexColumns"].as_array()?;
                let table_index = tables
                    .iter()
                    .position(|t| t["table"] == parsed["existingTable"]["name"])?;
                if index_columns.is_empty()
                    || index_columns.iter().enumerate().any(|(i, c)| {
                        !identifier(c)
                            || !tables[table_index]["columns"]
                                .as_array()
                                .is_some_and(|columns| {
                                    columns.iter().any(|column| &column["name"] == c)
                                })
                            || index_columns[..i].contains(c)
                    })
                    || tables.iter().any(|t| {
                        t["indexes"].as_array().is_some_and(|indexes| {
                            indexes.iter().any(|index| index["name"] == target["name"])
                        })
                    })
                {
                    return None;
                }
                let indexes = tables[table_index]["indexes"].as_array_mut()?;
                indexes.push(json!({"name":target["name"],"uniqueness":if description["unique"] == true {"UNIQUE"} else {"NONUNIQUE"},"columns":index_columns}));
                if indexes
                    .iter()
                    .map(|i| i["columns"].as_array().map_or(0, Vec::len))
                    .sum::<usize>()
                    > 256
                {
                    return None;
                }
                indexes.sort_by(|a, b| string(&a["name"]).cmp(string(&b["name"])));
            } else {
                let columns: Vec<Value> = description["columns"]
                    .as_array()?
                    .iter()
                    .map(column_expected)
                    .collect::<Option<_>>()?;
                if columns.is_empty() {
                    return None;
                }
                if target["operation"] == "CREATE" {
                    if tables.iter().any(|t| t["table"] == target["name"]) || tables.len() >= 128 {
                        return None;
                    }
                    tables.push(json!({"table":target["name"],"columns":columns,"indexes":[]}));
                } else {
                    let table = tables.iter_mut().find(|t| t["table"] == target["name"])?;
                    let old = table["columns"].as_array_mut()?;
                    if old.len() + columns.len() > 256
                        || columns
                            .iter()
                            .any(|c| old.iter().any(|o| c["name"] == o["name"]))
                    {
                        return None;
                    }
                    old.extend(columns);
                }
            }
        }
        let snapshot = json!(tables);
        projection_bytes += snapshot.to_string().len();
        if projection_bytes > 8 * 1024 * 1024 {
            return None;
        }
        by_version[version] = snapshot;
    }
    (ordinal == statements.len()).then(|| json!({"byVersion":by_version,"final":tables}))
}
