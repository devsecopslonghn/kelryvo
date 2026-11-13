//! Bounded structural SQL review, independent of syntax or execution authority.
use crate::{MAX_PLAN_STATEMENTS, js_len, js_whitespace as whitespace};
use serde_json::{Value, json};

pub fn profile() -> Value {
    json!({"engines":["oracle"],"maxSourceChars":200000,"maxTokens":20000,"maxReferences":100,"maxBatchStatements":4096,"maxFindings":20,"objectCheck":"UNKNOWN"})
}

#[derive(Clone)]
struct Token {
    kind: &'static str,
    value: String,
}

fn tokenize(sql: &str) -> Option<Vec<Token>> {
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if whitespace(c) {
            i += 1;
            continue;
        }
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 >= chars.len() {
                return None;
            }
            i += 2;
            continue;
        }
        let prefix = if matches!(c, 'q' | 'Q') {
            1
        } else if matches!(c, 'n' | 'N') && chars.get(i + 1).is_some_and(|c| matches!(c, 'q' | 'Q'))
        {
            2
        } else {
            0
        };
        if prefix > 0
            && chars.get(i + prefix) == Some(&'\'')
            && chars.get(i + prefix + 1).is_some_and(|c| !whitespace(*c))
        {
            let open = chars[i + prefix + 1];
            if open.len_utf16() != 1 {
                return None;
            }
            let close = match open {
                '[' => ']',
                '(' => ')',
                '{' => '}',
                '<' => '>',
                c => c,
            };
            i += prefix + 2;
            while i + 1 < chars.len() && !(chars[i] == close && chars[i + 1] == '\'') {
                i += 1;
            }
            if i + 1 >= chars.len() {
                return None;
            }
            i += 2;
            out.push(Token {
                kind: "literal",
                value: String::new(),
            });
        } else if matches!(c, 'n' | 'N') && chars.get(i + 1) == Some(&'\'') {
            i += 1;
            continue;
        } else if c == '\'' || c == '"' {
            i += 1;
            let mut value = String::new();
            let mut closed = false;
            while i < chars.len() {
                if chars[i] == c && chars.get(i + 1) == Some(&c) {
                    value.push(c);
                    i += 2;
                } else if chars[i] == c {
                    i += 1;
                    closed = true;
                    break;
                } else {
                    value.push(chars[i]);
                    i += 1;
                }
            }
            if !closed {
                return None;
            }
            out.push(Token {
                kind: if c == '\'' { "literal" } else { "quoted" },
                value,
            });
        } else if c.is_ascii_alphabetic() || "_$#".contains(c) {
            let start = i;
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || "_$#".contains(chars[i]))
            {
                i += 1;
            }
            out.push(Token {
                kind: "word",
                value: chars[start..i]
                    .iter()
                    .collect::<String>()
                    .to_ascii_uppercase(),
            });
        } else if c.is_ascii_digit() {
            let start = i;
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            out.push(Token {
                kind: "number",
                value: chars[start..i].iter().collect(),
            });
        } else {
            for _ in 0..c.len_utf16() {
                out.push(Token {
                    kind: "punct",
                    value: c.to_string(),
                });
            }
            i += 1;
        }
        if out.len() > 20000 {
            return None;
        }
    }
    Some(out)
}
fn word(tokens: &[Token], i: usize, w: &str) -> bool {
    tokens
        .get(i)
        .is_some_and(|t| t.kind == "word" && t.value == w)
}
fn value(tokens: &[Token], i: usize, w: &str) -> bool {
    tokens.get(i).is_some_and(|t| t.value == w)
}
fn ident(tokens: &[Token], i: usize) -> bool {
    tokens
        .get(i)
        .is_some_and(|t| matches!(t.kind, "word" | "quoted"))
}
struct Object {
    owner: Option<String>,
    name: String,
    end: usize,
    link: bool,
}
fn object_at(tokens: &[Token], i: usize) -> Option<Object> {
    if !ident(tokens, i) {
        return None;
    }
    let first = tokens[i].value.clone();
    let (owner, name, mut end) = if value(tokens, i + 1, ".") && ident(tokens, i + 2) {
        (Some(first), tokens[i + 2].value.clone(), i + 3)
    } else {
        (None, first, i + 1)
    };
    let link = value(tokens, end, "@");
    if link {
        end += if ident(tokens, end + 1) { 2 } else { 1 };
    }
    Some(Object {
        owner,
        name,
        end,
        link,
    })
}
fn finding(out: &mut Vec<Value>, code: &str, severity: &str, rationale: &str) {
    if out.len() < 20 && !out.iter().any(|f| f["code"] == code) {
        out.push(json!({"code":code,"severity":severity,"rationale":rationale}));
    }
}
fn reference(out: &mut Vec<Value>, object: &Object, role: &str, dedup: bool) {
    if !dedup
        || !out
            .iter()
            .any(|r| r["name"] == object.name && r["owner"] == json!(object.owner))
    {
        out.push(json!({"owner":object.owner,"name":object.name,"role":role}));
    }
}
fn inspect(statement: &Value, owner: &str, engine: &str) -> Value {
    let mut findings = Vec::new();
    let mut references = Vec::new();
    let mut class = "UNSUPPORTED".to_owned();
    let mut schema = "UNVERIFIED";
    let early = if engine != "oracle" {
        Some((
            "UNSUPPORTED_ENGINE",
            "Offline review supports Oracle syntax only.",
        ))
    } else if statement["sourceSql"]
        .as_str()
        .is_none_or(|s| js_len(s) > 200000)
    {
        Some((
            "REVIEW_LIMIT",
            "Statement exceeds the bounded offline review input limit.",
        ))
    } else {
        None
    };
    if let Some((code, why)) = early {
        finding(&mut findings, code, "UNKNOWN", why);
        return json!({"classification":class,"references":references,"schemaCheck":schema,"findings":findings});
    }
    let tokens = match tokenize(statement["sourceSql"].as_str().expect("source checked")) {
        Some(t) => t,
        None => {
            finding(
                &mut findings,
                "TOKENIZATION_UNVERIFIED",
                "UNKNOWN",
                "Comments or quoting could not be bounded and tokenized safely.",
            );
            return json!({"classification":class,"references":references,"schemaCheck":schema,"findings":findings});
        }
    };
    if tokens.is_empty() {
        finding(
            &mut findings,
            "EMPTY_STATEMENT",
            "UNKNOWN",
            "No statement tokens were available for review.",
        );
        return json!({"classification":class,"references":references,"schemaCheck":schema,"findings":findings});
    }
    let mut depth = 0usize;
    let depths: Vec<_> = tokens
        .iter()
        .map(|t| {
            if t.value == ")" {
                depth = depth.saturating_sub(1);
            }
            let at = depth;
            if t.value == "(" {
                depth += 1;
            }
            at
        })
        .collect();
    let first = tokens
        .first()
        .filter(|t| t.kind == "word")
        .map(|t| t.value.as_str())
        .unwrap_or("");
    let second = tokens
        .get(1)
        .filter(|t| t.kind == "word")
        .map(|t| t.value.as_str())
        .unwrap_or("");
    let admin = [
        "USER",
        "ROLE",
        "DATABASE",
        "PROFILE",
        "TABLESPACE",
        "DIRECTORY",
        "SYNONYM",
        "PUBLIC",
        "SYSTEM",
        "SESSION",
    ]
    .contains(&second);
    if [
        "GRANT",
        "REVOKE",
        "AUDIT",
        "NOAUDIT",
        "PURGE",
        "FLASHBACK",
        "ANALYZE",
    ]
    .contains(&first)
        || ["CREATE", "DROP", "ALTER"].contains(&first) && admin
    {
        finding(
            &mut findings,
            "ADMIN_OR_PRIVILEGE_OPERATION",
            "BLOCKING",
            "Database, system, user, or privilege operations are outside the supported review policy.",
        );
        return json!({"classification":"ADMINISTRATIVE","references":references,"schemaCheck":schema,"findings":findings});
    }
    let mut delete_from = None;
    if ["CREATE", "ALTER", "DROP", "TRUNCATE"].contains(&first) {
        let mut pos = 1;
        if word(&tokens, pos, "OR") && word(&tokens, pos + 1, "REPLACE") {
            pos += 2;
        }
        if word(&tokens, pos, "UNIQUE") || word(&tokens, pos, "BITMAP") {
            pos += 1;
        }
        let kind = tokens
            .get(pos)
            .filter(|t| t.kind == "word")
            .map(|t| t.value.as_str())
            .unwrap_or("");
        if !["TABLE", "INDEX"].contains(&kind) {
            class = "UNSUPPORTED_DDL".into();
            finding(
                &mut findings,
                "UNSUPPORTED_DDL",
                "UNKNOWN",
                "DDL type is outside the bounded structural review profile.",
            );
        } else {
            class = format!("{first}_{kind}");
            if let Some(obj) = object_at(&tokens, pos + 1) {
                reference(&mut references, &obj, "TARGET", false);
            } else {
                finding(
                    &mut findings,
                    "TARGET_UNVERIFIED",
                    "UNKNOWN",
                    "DDL target could not be identified structurally.",
                );
            }
            if kind == "INDEX" {
                if let Some(obj) = tokens
                    .iter()
                    .position(|t| t.kind == "word" && t.value == "ON")
                    .and_then(|i| object_at(&tokens, i + 1))
                {
                    reference(&mut references, &obj, "READ", false);
                } else {
                    finding(
                        &mut findings,
                        "INDEX_TARGET_UNVERIFIED",
                        "UNKNOWN",
                        "Index base table could not be identified structurally.",
                    );
                }
            }
            if ["DROP", "TRUNCATE", "ALTER"].contains(&first) {
                finding(
                    &mut findings,
                    "DESTRUCTIVE_DDL",
                    "HIGH",
                    "This statement changes or removes existing database objects.",
                );
            }
        }
    } else if ["INSERT", "UPDATE", "DELETE", "MERGE"].contains(&first) {
        class = first.into();
        let target = match first {
            "INSERT" => tokens
                .iter()
                .position(|t| t.kind == "word" && t.value == "INTO")
                .and_then(|i| object_at(&tokens, i + 1)),
            "UPDATE" => object_at(&tokens, 1),
            "DELETE" => {
                let i = if word(&tokens, 1, "FROM") {
                    delete_from = Some(1);
                    2
                } else {
                    1
                };
                object_at(&tokens, i)
            }
            _ => None,
        };
        if first == "MERGE" {
            finding(
                &mut findings,
                "MERGE_SEMANTICS_UNVERIFIED",
                "UNKNOWN",
                "MERGE source and write behavior are outside this structural review.",
            );
        } else if let Some(obj) = target {
            reference(&mut references, &obj, "WRITE", false);
        } else {
            finding(
                &mut findings,
                "TARGET_UNVERIFIED",
                "UNKNOWN",
                "DML target could not be identified structurally.",
            );
        }
        if ["UPDATE", "DELETE"].contains(&first)
            && !tokens
                .iter()
                .enumerate()
                .any(|(i, _)| word(&tokens, i, "WHERE") && depths[i] == 0)
        {
            finding(
                &mut findings,
                "UNRESTRICTED_DML",
                "HIGH",
                &format!("{first} has no top-level WHERE clause."),
            );
        }
    } else if first == "SELECT"
        || first == "WITH"
            && tokens
                .iter()
                .any(|t| t.kind == "word" && t.value == "SELECT")
    {
        class = "SELECT".into();
        if first == "WITH" {
            finding(
                &mut findings,
                "WITH_SHAPE_UNVERIFIED",
                "UNKNOWN",
                "Common table expression scope is not fully modeled by the bounded reviewer.",
            );
        }
    } else {
        finding(
            &mut findings,
            "UNSUPPORTED_STATEMENT",
            "UNKNOWN",
            "Statement form is outside the bounded structural review profile.",
        );
    }
    if tokens.iter().any(|t| {
        t.kind == "word" && ["EXECUTE", "BEGIN", "DECLARE", "CALL"].contains(&t.value.as_str())
    }) {
        finding(
            &mut findings,
            "DYNAMIC_OR_PROCEDURAL_SQL",
            "UNKNOWN",
            "Procedural or dynamic SQL cannot be fully reviewed offline.",
        );
        return json!({"classification":"UNSUPPORTED_PROCEDURAL_OR_DYNAMIC","references":[],"schemaCheck":"UNVERIFIED","findings":findings});
    }
    let mut missed = false;
    let mut linked = false;
    let mut qualified = false;
    for (i, t) in tokens.iter().enumerate() {
        if t.kind != "word"
            || !["FROM", "JOIN", "REFERENCES", "INTO", "UPDATE"].contains(&t.value.as_str())
            || class == "DELETE" && delete_from == Some(i)
        {
            continue;
        }
        let Some(obj) = object_at(&tokens, i + 1) else {
            missed = true;
            continue;
        };
        if value(&tokens, obj.end, "(") {
            missed = true;
            continue;
        }
        linked |= obj.link;
        reference(
            &mut references,
            &obj,
            if ["FROM", "JOIN", "REFERENCES"].contains(&t.value.as_str()) {
                "READ"
            } else {
                "WRITE"
            },
            true,
        );
        if t.value == "FROM" {
            let base = depths[i];
            let mut j = obj.end;
            while j < tokens.len() {
                let d = depths[j];
                if d < base
                    || d == base
                        && tokens[j].kind == "word"
                        && [
                            "WHERE",
                            "GROUP",
                            "ORDER",
                            "CONNECT",
                            "START",
                            "MODEL",
                            "UNION",
                            "MINUS",
                            "INTERSECT",
                            "FETCH",
                            "OFFSET",
                        ]
                        .contains(&tokens[j].value.as_str())
                {
                    break;
                }
                if d == base && tokens[j].value == "," {
                    let Some(next) = object_at(&tokens, j + 1) else {
                        missed = true;
                        j += 1;
                        continue;
                    };
                    if value(&tokens, next.end, "(") {
                        missed = true;
                        j = next.end + 1;
                        continue;
                    }
                    linked |= next.link;
                    reference(&mut references, &next, "READ", true);
                    j = next.end;
                } else {
                    j += 1;
                }
            }
        }
    }
    for i in 0..tokens.len().saturating_sub(3) {
        if ident(&tokens, i) && value(&tokens, i + 1, ".") && ident(&tokens, i + 2) {
            let mut j = i + 3;
            while value(&tokens, j, ".") && ident(&tokens, j + 1) {
                j += 2;
            }
            qualified |= value(&tokens, j, "(");
        }
    }
    linked |= tokens.iter().any(|t| t.kind == "punct" && t.value == "@");
    if linked {
        finding(
            &mut findings,
            "DATABASE_LINK_REFERENCE",
            "BLOCKING",
            "Database-link references are outside the assigned local target policy.",
        );
    }
    if missed {
        finding(
            &mut findings,
            "REFERENCE_UNVERIFIED",
            "UNKNOWN",
            "One or more object references could not be identified structurally.",
        );
    }
    if qualified {
        finding(
            &mut findings,
            "QUALIFIED_CALL_UNVERIFIED",
            "UNKNOWN",
            "Qualified function and package dependencies cannot be resolved by the bounded reviewer.",
        );
    }
    if class == "SELECT" && references.is_empty() {
        finding(
            &mut findings,
            "NO_REFERENCES_IDENTIFIED",
            "UNKNOWN",
            "No source object was identified for this query.",
        );
    }
    if references.len() > 100 {
        references.clear();
        class = "UNVERIFIED".into();
        finding(
            &mut findings,
            "REFERENCE_LIMIT",
            "UNKNOWN",
            "Reference count exceeded the bounded review limit.",
        );
    }
    let mut mismatch = false;
    for r in &mut references {
        if !r["owner"].is_null() && r["owner"] != owner {
            mismatch = true;
        } else if r["owner"].is_null() {
            r["owner"] = owner.into();
        }
    }
    if mismatch {
        schema = "MISMATCH";
        finding(
            &mut findings,
            "CROSS_SCHEMA_REFERENCE",
            "BLOCKING",
            "An explicit object owner differs from the exact assigned owner.",
        );
    } else if !findings.iter().any(|f| f["severity"] == "UNKNOWN")
        && !["UNSUPPORTED", "UNSUPPORTED_DDL"].contains(&class.as_str())
    {
        schema = "MATCH";
    }
    if linked || (missed || qualified) && schema != "MISMATCH" {
        schema = "UNVERIFIED";
    }
    json!({"classification":class,"references":references,"schemaCheck":schema,"findings":findings})
}

pub fn statements(input: &Value, owner: &str, engine: &str) -> Option<Value> {
    let input = input.as_array()?;
    if input.len() > MAX_PLAN_STATEMENTS {
        return None;
    }
    Some(
        input
            .iter()
            .map(|s| {
                let result = inspect(s, owner, engine);
                let mut out = json!({});
                for key in ["ordinal", "path"] {
                    if let Some(v) = s.get(key) {
                        out[key] = v.clone();
                    }
                }
                for key in ["classification", "references", "schemaCheck"] {
                    out[key] = result[key].clone();
                }
                out["objectCheck"] = "UNKNOWN".into();
                out["findings"] = result["findings"].clone();
                out
            })
            .collect(),
    )
}

pub fn catalog_context(
    statements: &Value,
    owner: &str,
    snapshot: &Value,
    expected_identity: &Value,
) -> Option<Value> {
    let mismatch = snapshot.is_object()
        && !expected_identity.is_null()
        && snapshot["identityDigest"] != *expected_identity;
    let input = statements.as_array()?;
    Some(
        input
            .iter()
            .map(|s| {
                let mut s = s.clone();
                let linked = s["findings"]
                    .as_array()
                    .is_some_and(|a| a.iter().any(|f| f["code"] == "DATABASE_LINK_REFERENCE"));
                let refs: Vec<_> = s["references"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|r| {
                        let matches: Vec<_> = snapshot["objects"]
                            .as_array()
                            .into_iter()
                            .flatten()
                            .filter(|o| {
                                !mismatch
                                    && !linked
                                    && r["owner"] == owner
                                    && o["owner"] == owner
                                    && o["type"] != "DEPENDENCY"
                                    && o["name"] == r["name"]
                            })
                            .map(|o| json!({"type":o["type"],"checksum":o["checksum"]}))
                            .collect();
                        let mut r = r.clone();
                        r["snapshotId"] = snapshot["id"].clone();
                        r["state"] = if r["owner"] != owner {
                            "OUT_OF_SCOPE"
                        } else if linked {
                            "LINK_SCOPE_UNVERIFIED"
                        } else if mismatch {
                            "IDENTITY_MISMATCH"
                        } else if !matches.is_empty() {
                            "OBSERVED"
                        } else {
                            "UNKNOWN"
                        }
                        .into();
                        r["matches"] = json!(matches);
                        r
                    })
                    .collect();
                s["catalogReferences"] = json!(refs);
                s
            })
            .collect(),
    )
}
