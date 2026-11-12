//! Bounded schema snapshots. Incomplete metadata never proves object absence.
use crate::js_json::{self, cmp};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};
pub const TYPES: [&str; 5] = ["TABLE", "VIEW", "SEQUENCE", "INDEX", "DEPENDENCY"];
const LIMITATIONS: [&str; 27] = [
    "OBJECT_LIMIT_EXCEEDED",
    "BYTE_LIMIT_EXCEEDED",
    "INVALID_OBJECT",
    "INVALID_DEFINITION",
    "DUPLICATE_OBJECT",
    "INVALID_OWNER",
    "INVALID_LIMITATION",
    "OBJECT_ABSENCE_UNVERIFIED",
    "MULTI_QUERY_CONSISTENCY_UNGUARANTEED",
    "TABLE_ROW_LIMIT_EXCEEDED",
    "VIEW_ROW_LIMIT_EXCEEDED",
    "SEQUENCE_ROW_LIMIT_EXCEEDED",
    "INDEX_ROW_LIMIT_EXCEEDED",
    "DEPENDENCY_ROW_LIMIT_EXCEEDED",
    "TABLE_QUERY_UNAVAILABLE",
    "VIEW_QUERY_UNAVAILABLE",
    "SEQUENCE_QUERY_UNAVAILABLE",
    "INDEX_QUERY_UNAVAILABLE",
    "DEPENDENCY_QUERY_UNAVAILABLE",
    "VIEW_TEXT_TRUNCATED",
    "PARTITION_DEFINITIONS_UNAVAILABLE",
    "FK_REFERENCE_UNAVAILABLE",
    "CONSTRAINT_PREDICATE_UNAVAILABLE",
    "VIEW_TEXT_UNAVAILABLE",
    "INDEX_EXPRESSION_UNAVAILABLE",
    "FOREIGN_OWNER_VISIBILITY_PARTIAL",
    "IDENTITY_INCOMPLETE",
];
fn name(value: &Value, max: usize) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty() && s.len() <= max && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}
fn hash(value: &Value) -> String {
    crate::sha256(js_json::stringify(value, true))
}
fn canonical(v: &Value, depth: usize, nodes: &mut usize) -> Option<Value> {
    *nodes += 1;
    if *nodes > 20000 || depth > 16 {
        return None;
    }
    match v {
        Value::String(s) => {
            if s.len() > 65536
                || s.chars().any(
                    |c| matches!(c,'\u{0}'..='\u{8}'|'\u{b}'|'\u{c}'|'\u{e}'..='\u{1f}'|'\u{7f}'),
                )
            {
                None
            } else {
                Some(v.clone())
            }
        }
        Value::Array(a) => {
            if a.len() > 2048 {
                return None;
            }
            Some(Value::Array(
                a.iter()
                    .map(|v| canonical(v, depth + 1, nodes))
                    .collect::<Option<_>>()?,
            ))
        }
        Value::Object(object) => {
            let mut keys: Vec<_> = object.keys().collect();
            keys.sort_by(|a, b| cmp(a, b));
            let mut out = serde_json::Map::new();
            for k in keys {
                if k.len() > 128 || k.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}') {
                    return None;
                }
                out.insert(k.clone(), canonical(&object[k], depth + 1, nodes)?);
            }
            Some(Value::Object(out))
        }
        Value::Number(_) => serde_json::from_str(&js_json::stringify(v, false)).ok(),
        _ => Some(v.clone()),
    }
}
fn downgrade(coverage: &mut Value) {
    for t in TYPES {
        if coverage[t] != "UNAVAILABLE" {
            coverage[t] = "PARTIAL".into();
        }
    }
}
fn order(a: &Value, b: &Value) -> std::cmp::Ordering {
    for k in ["owner", "type", "name"] {
        let order = cmp(crate::string(&a[k]), crate::string(&b[k]));
        if !order.is_eq() {
            return order;
        }
    }
    std::cmp::Ordering::Equal
}
pub fn normalize(raw: &Value, owner: &Value) -> Value {
    let mut limitations: HashSet<&str> = HashSet::new();
    if let Some(items) = raw["limitations"].as_array() {
        for item in items.iter().take(64) {
            let item = crate::string(item);
            limitations.insert(if LIMITATIONS.contains(&item) {
                item
            } else {
                "INVALID_LIMITATION"
            });
        }
    }
    let valid_owner = name(owner, 128);
    if !valid_owner {
        limitations.insert("INVALID_OWNER");
    }
    let mut coverage = json!({});
    for t in TYPES {
        coverage[t] = if ["COMPLETE", "PARTIAL", "UNAVAILABLE"]
            .iter()
            .any(|s| raw["coverage"][t] == *s)
        {
            raw["coverage"][t].clone()
        } else {
            "UNAVAILABLE".into()
        };
    }
    let input = raw["objects"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    if !raw["objects"].is_array() || limitations.contains("INVALID_LIMITATION") {
        limitations.insert("INVALID_OBJECT");
        downgrade(&mut coverage);
    }
    let overflow = input.len() > 1000;
    if overflow {
        limitations.insert("OBJECT_LIMIT_EXCEEDED");
    }
    let mut objects = Vec::new();
    let mut seen = HashSet::new();
    let (mut bytes, mut nodes) = (0, 0);
    for item in input.iter().take(1000) {
        let kind = crate::string(&item["type"]);
        if !item.is_object()
            || !TYPES.contains(&kind)
            || !name(&item["name"], if kind == "DEPENDENCY" { 1024 } else { 128 })
            || !name(&item["owner"], 128)
            || item["owner"] != *owner
        {
            limitations.insert("INVALID_OBJECT");
            downgrade(&mut coverage);
            continue;
        }
        let id = json!([item["owner"], item["type"], item["name"]]).to_string();
        if !seen.insert(id) {
            limitations.insert("DUPLICATE_OBJECT");
            coverage[kind] = "PARTIAL".into();
            continue;
        }
        let mut budget = 0;
        let empty = json!({});
        let definition = if item["definition"].is_null() {
            &empty
        } else {
            &item["definition"]
        };
        let Some(definition) = canonical(definition, 0, &mut budget) else {
            limitations.insert("INVALID_DEFINITION");
            coverage[kind] = "PARTIAL".into();
            continue;
        };
        nodes += budget + 8;
        let mut object = json!({"owner":item["owner"],"type":item["type"],"name":item["name"],"definition":definition});
        let size = js_json::stringify(&object, false).len() + 80;
        if nodes > 20000 || size > 1024 * 1024 - bytes {
            limitations.insert("BYTE_LIMIT_EXCEEDED");
            downgrade(&mut coverage);
            break;
        }
        bytes += size;
        object["checksum"] = hash(&object).into();
        objects.push(object);
    }
    if overflow {
        downgrade(&mut coverage);
    }
    objects.sort_by(order);
    let mut limitations: Vec<_> = limitations.into_iter().collect();
    limitations.sort_by(|a, b| cmp(a, b));
    let mut payload = json!({"owner":if valid_owner{owner.clone()}else{Value::Null},"objects":objects,"coverage":coverage,"limitations":limitations});
    payload["contentDigest"] = hash(&payload).into();
    payload
}

fn consistent(schema: &Value) -> bool {
    !schema["limitations"].as_array().is_some_and(|a| {
        a.iter()
            .any(|l| l == "MULTI_QUERY_CONSISTENCY_UNGUARANTEED")
    })
}
fn type_complete(schema: &Value, kind: &str) -> bool {
    schema["coverage"][kind] == "COMPLETE" && consistent(schema)
}
fn complete(schema: &Value) -> bool {
    TYPES.iter().all(|t| type_complete(schema, t))
}
fn paths(before: Option<&Value>, after: Option<&Value>, base: &str) -> Vec<String> {
    if before.map(|v| js_json::stringify(v, false)) == after.map(|v| js_json::stringify(v, false)) {
        return Vec::new();
    }
    if let (Some(Value::Object(b)), Some(Value::Object(a))) = (before, after) {
        let mut keys: Vec<_> = b.keys().chain(a.keys()).collect();
        keys.sort_by(|a, b| cmp(a, b));
        keys.dedup();
        return keys
            .into_iter()
            .flat_map(|k| paths(b.get(k), a.get(k), &format!("{base}.{k}")))
            .collect();
    }
    if let (Some(Value::Array(b)), Some(Value::Array(a))) = (before, after) {
        return (0..b.len().max(a.len()))
            .flat_map(|i| paths(b.get(i), a.get(i), &format!("{base}[{i}]")))
            .collect();
    }
    vec![base.into()]
}
pub fn compare(expected: &Value, observed: &Value) -> Option<Value> {
    let blank = json!({"added":0,"removed":0,"modified":0,"unverified":0});
    if expected["schema"].is_null() || observed["schema"].is_null() {
        return Some(
            json!({"state":"UNVERIFIED","changes":[],"summary":blank,"limitations":["SNAPSHOT_SCHEMA_UNAVAILABLE"]}),
        );
    }
    if !name(&expected["owner"], 128)
        || !name(&observed["owner"], 128)
        || expected["owner"] != observed["owner"]
        || expected["schema"]["owner"] != observed["schema"]["owner"]
        || !crate::matches(
            r"(?i)\A[a-f0-9]{64}\z",
            crate::string(&expected["identityDigest"]),
        )
        || expected["identityDigest"] != observed["identityDigest"]
    {
        return Some(
            json!({"state":"INCOMPARABLE","changes":[],"summary":blank,"limitations":["IDENTITY_OR_OWNER_MISMATCH"]}),
        );
    }
    let key = |o: &Value| json!([o["owner"], o["type"], o["name"]]).to_string();
    let collect = |schema: &Value| -> Option<HashMap<String, Value>> {
        if schema["objects"].is_null() {
            return Some(HashMap::new());
        }
        let objects = schema["objects"].as_array()?;
        if objects.len() > 1000 {
            return None;
        }
        Some(objects.iter().map(|o| (key(o), o.clone())).collect())
    };
    let before = collect(&expected["schema"])?;
    let after = collect(&observed["schema"])?;
    let mut changes = Vec::new();
    for k in before.keys().chain(after.keys()).collect::<HashSet<_>>() {
        let b = before.get(k);
        let a = after.get(k);
        let sample = a.or(b)?;
        let (kind, details) = match (b, a) {
            (None, Some(_)) => {
                if type_complete(&expected["schema"], crate::string(&sample["type"])) {
                    ("ADDED", Vec::new())
                } else {
                    ("UNVERIFIED", vec!["OBJECT_ABSENCE_UNVERIFIED".into()])
                }
            }
            (Some(_), None) => {
                if type_complete(&expected["schema"], crate::string(&sample["type"]))
                    && type_complete(&observed["schema"], crate::string(&sample["type"]))
                {
                    ("REMOVED", Vec::new())
                } else {
                    ("UNVERIFIED", vec!["OBJECT_ABSENCE_UNVERIFIED".into()])
                }
            }
            (Some(b), Some(a)) if b["checksum"] != a["checksum"] => (
                "MODIFIED",
                paths(b.get("definition"), a.get("definition"), "$"),
            ),
            _ => continue,
        };
        changes.push(json!({"owner":sample["owner"],"type":sample["type"],"name":sample["name"],"before":b,"after":a,"kind":kind,"details":details}));
    }
    changes.sort_by(order);
    let mut summary = blank;
    for (field, kind) in [
        ("added", "ADDED"),
        ("removed", "REMOVED"),
        ("modified", "MODIFIED"),
        ("unverified", "UNVERIFIED"),
    ] {
        summary[field] = json!(changes.iter().filter(|c| c["kind"] == kind).count());
    }
    let mut limitations = Vec::new();
    let incomplete = !complete(&expected["schema"]) || !complete(&observed["schema"]);
    if incomplete {
        limitations.push("INCOMPLETE_METADATA_COVERAGE");
    }
    if !consistent(&expected["schema"]) || !consistent(&observed["schema"]) {
        limitations.push("MULTI_QUERY_CONSISTENCY_UNGUARANTEED");
    }
    let unverified = summary["unverified"].as_u64()? > 0;
    if unverified {
        limitations.push("OBJECT_ABSENCE_UNVERIFIED");
    }
    Some(
        json!({"state":if unverified || incomplete{"UNVERIFIED"}else if changes.is_empty(){"NO_DRIFT"}else{"DRIFT"},"changes":changes,"summary":summary,"limitations":limitations}),
    )
}
