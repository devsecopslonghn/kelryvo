//! Offline source alignment. Ambiguous replacements never become inferred edits.
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

pub fn canonical_digest(value: &Value) -> String {
    let mut value = value.clone();
    value.sort_all_objects();
    crate::sha256(value.to_string())
}

pub fn identity(release: &Value) -> Value {
    json!({"id":release["id"],"commit":release["commit_id"],"objectFormat":release["object_format"],"repositoryId":release["repository_id"],"folder":release["folder"],"parserProfile":release["parser_profile"],"manifestDigest":release["manifest_digest"]})
}

pub fn releases(base: &Value, candidate: &Value) -> Option<Value> {
    let left = base["files"].as_array()?;
    let right = candidate["files"].as_array()?;
    if left.len() > crate::MAX_RELEASE_FILES || right.len() > crate::MAX_RELEASE_FILES {
        return None;
    }
    let mut versions: Vec<_> = left
        .iter()
        .chain(right)
        .map(|f| f["version"].as_str())
        .collect::<Option<_>>()?;
    let mut seen = HashSet::new();
    versions.retain(|v| seen.insert(*v));
    versions.sort_by(|a, b| {
        let a: Vec<_> = a.split('.').collect();
        let b: Vec<_> = b.split('.').collect();
        for i in 0..a.len().max(b.len()) {
            let x = a.get(i).copied().unwrap_or("0");
            let y = b.get(i).copied().unwrap_or("0");
            let order = x.len().cmp(&y.len()).then_with(|| x.cmp(y));
            if !order.is_eq() {
                return order;
            }
        }
        std::cmp::Ordering::Equal
    });
    let reference = |f: Option<&Value>| {
        f.map(|f|json!({"path":f["path"],"sha256":f["sha256"],"bytes":f["bytes"],"content":f["content"]}))
    };
    Some(json!(versions.into_iter().map(|version| {
        let before = left.iter().rev().find(|f| f["version"] == version);
        let after = right.iter().rev().find(|f| f["version"] == version);
        let change = match (before,after) {
            (None,_) => "ADDED", (_,None) => "REMOVED",
            (Some(a),Some(b)) => if ["path","sha256","bytes","content"].iter().any(|k| a[k]!=b[k]) {"CHANGED"} else {"UNCHANGED"},
        };
        json!({"version":version,"change":change,"base":reference(before),"candidate":reference(after)})
    }).collect::<Vec<_>>()))
}

pub fn statements(base: &[Value], candidate: &[Value]) -> Option<Value> {
    if base.len() > crate::MAX_PLAN_STATEMENTS || candidate.len() > crate::MAX_PLAN_STATEMENTS {
        return None;
    }
    let collect = |items: &[Value]| -> Option<HashMap<String, Vec<usize>>> {
        let mut into: HashMap<String, Vec<usize>> = HashMap::new();
        for (i, item) in items.iter().enumerate() {
            if !crate::digest(&item["sourceSha256"])
                || !crate::digest(&item["executionSha256"])
                || crate::safe_integer(&item["startByte"]).is_none()
                || crate::safe_integer(&item["endByte"]).is_none()
            {
                return None;
            }
            into.entry(item["sourceSha256"].as_str()?.into())
                .or_default()
                .push(i);
        }
        Some(into)
    };
    let left = collect(base)?;
    let right = collect(candidate)?;
    let mut matched = HashMap::new();
    let mut matched_right = HashSet::new();
    let mut duplicate_left: HashSet<usize> = HashSet::new();
    let mut duplicate_right: HashSet<usize> = HashSet::new();
    for (hash, a) in &left {
        let b = right.get(hash).map(Vec::as_slice).unwrap_or_default();
        if a.len() == 1 && b.len() == 1 {
            matched.insert(a[0], b[0]);
            matched_right.insert(b[0]);
        } else if !b.is_empty() {
            duplicate_left.extend(a);
            duplicate_right.extend(b);
        }
    }
    let mut pairs: Vec<_> = matched.iter().map(|(a, b)| (*a, *b)).collect();
    pairs.sort_unstable();
    let mut moved = HashSet::new();
    let mut max = None;
    for (i, j) in &pairs {
        if max.is_some_and(|max| *j < max) {
            moved.insert(*i);
        }
        max = Some(max.unwrap_or(0).max(*j));
    }
    let mut min = candidate.len();
    for (i, j) in pairs.iter().rev() {
        if *j > min {
            moved.insert(*i);
        }
        min = min.min(*j);
    }
    let unmatched_left: Vec<_> = (0..base.len())
        .filter(|i| !matched.contains_key(i))
        .collect();
    let unmatched_right: Vec<_> = (0..candidate.len())
        .filter(|i| !matched_right.contains(i))
        .collect();
    let paired = unmatched_left.len() == 1
        && unmatched_right.len() == 1
        && base[unmatched_left[0]]["executionSha256"]
            == candidate[unmatched_right[0]]["executionSha256"];
    let reference = |s: &Value| json!({"startByte":s["startByte"],"endByte":s["endByte"],"sourceSha256":s["sourceSha256"],"executionSha256":s["executionSha256"]});
    let mut facts = Vec::new();
    for (i, item) in base.iter().enumerate() {
        let mut fact = if let Some(j) = matched.get(&i) {
            json!({"ordinal":i+1,"change":if moved.contains(&i){"MOVED"}else{"UNCHANGED"},"base":reference(item),"candidate":reference(&candidate[*j])})
        } else if paired && unmatched_left[0] == i {
            let j = unmatched_right[0];
            matched_right.insert(j);
            json!({"ordinal":i+1,"change":"CHANGED","base":reference(item),"candidate":reference(&candidate[j])})
        } else {
            json!({"ordinal":i+1,"change":"REMOVED","base":reference(item),"candidate":null})
        };
        if !matched.contains_key(&i)
            && !paired
            && (duplicate_left.contains(&i) || !unmatched_right.is_empty())
        {
            fact["change"] = "AMBIGUOUS".into();
            fact["ambiguity"] = if duplicate_left.contains(&i) {
                "DUPLICATE_SOURCE"
            } else {
                "MULTIPLE_MODIFICATION_CANDIDATES"
            }
            .into();
        }
        facts.push(fact);
    }
    for j in unmatched_right {
        if matched_right.contains(&j) {
            continue;
        }
        let mut fact = json!({"ordinal":j+1,"change":"ADDED","base":null,"candidate":reference(&candidate[j])});
        if duplicate_right.contains(&j) || !unmatched_left.is_empty() {
            fact["change"] = "AMBIGUOUS".into();
            fact["ambiguity"] = if duplicate_right.contains(&j) {
                "DUPLICATE_SOURCE"
            } else {
                "MULTIPLE_MODIFICATION_CANDIDATES"
            }
            .into();
        }
        facts.push(fact);
    }
    Some(json!(facts))
}
