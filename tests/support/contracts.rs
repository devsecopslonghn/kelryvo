use base64::Engine as _;
// Frozen migration contracts captured before retiring the Node implementation.
// Identifiers are alpha-renamed consistently; volatile clock values are ignored.
// Exact cryptographic vectors live in core.json and vault.json.
#[allow(unused_imports)]
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{LazyLock, Mutex},
};

#[allow(dead_code)]
pub fn canonical(value: &Value) -> Value {
    static TOKENS: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(
        r"(?i)Credential [0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{64}|[0-9a-f]{40}|[0-9a-f]{32}|[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+(?:Z|[+-][0-9]{2}:[0-9]{2})"
    ).unwrap()
    });
    static ENCODED: LazyLock<regex::Regex> =
        LazyLock::new(|| regex::Regex::new(r"[A-Za-z0-9_-]{40,}").unwrap());
    fn decoded(s: &str) -> Option<Value> {
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(s)
            .ok()?;
        let value: Value = serde_json::from_slice(&bytes).ok()?;
        (value.is_object() || value.is_array()).then_some(value)
    }
    fn walk(v: &Value, aliases: &mut HashMap<String, String>) -> Value {
        match v {
            Value::Object(o) => {
                let sorted: BTreeMap<_, _> = o.iter().collect();
                Value::Object(
                    sorted
                        .into_iter()
                        .map(|(k, v)| (k.clone(), walk(v, aliases)))
                        .collect(),
                )
            }
            Value::Array(a) => Value::Array(a.iter().map(|v| walk(v, aliases)).collect()),
            Value::String(s) => {
                if let Ok(nested) = serde_json::from_str::<Value>(s)
                    && (nested.is_array() || nested.is_object())
                {
                    return json!(walk(&nested, aliases).to_string());
                }
                let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("../..")
                    .canonicalize()
                    .unwrap();
                let s = s.replace(root.to_str().unwrap(), "__TEST_REPOSITORY__");
                let s = ENCODED.replace_all(&s, |c: &regex::Captures<'_>| {
                    decoded(&c[0])
                        .map(|v| format!("__ENCODED_JSON__{}", walk(&v, aliases)))
                        .unwrap_or_else(|| c[0].to_owned())
                });
                let result = TOKENS.replace_all(&s, |c: &regex::Captures<'_>| {
                    let token = &c[0];
                    if token.contains('T') {
                        return "__CLOCK__".to_string();
                    }
                    if !token.contains('-') && token.bytes().all(|b| b == token.as_bytes()[0]) {
                        return token.into();
                    }
                    let index = aliases.len();
                    aliases
                        .entry(token.to_owned())
                        .or_insert_with(|| format!("__ID_{index}__"))
                        .clone()
                });
                json!(result)
            }
            Value::Number(n)
                if n.is_f64()
                    && n.as_f64().unwrap().fract() == 0.0
                    && n.as_f64().unwrap().abs() <= 9_007_199_254_740_991.0 =>
            {
                json!(n.as_f64().unwrap() as i64)
            }
            _ => v.clone(),
        }
    }
    walk(value, &mut HashMap::new())
}

#[allow(dead_code)]
pub fn read(name: &str, input: &Value) -> Value {
    assert!(name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'));
    let root =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/contracts");
    let cases: Vec<Value> =
        serde_json::from_slice(&std::fs::read(root.join(format!("{name}.json"))).unwrap()).unwrap();
    let key = canonical(input);
    let matches: Vec<_> = cases
        .iter()
        .filter(|c| canonical(&c["input"]) == key)
        .collect();
    assert!(!matches.is_empty(), "Missing frozen {name} request: {key}");
    static POSITIONS: LazyLock<Mutex<HashMap<String, usize>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    let mut positions = POSITIONS.lock().unwrap();
    let index = positions.entry(format!("{name}:{key}")).or_default();
    let case = matches
        .get(*index)
        .unwrap_or_else(|| panic!("Exhausted frozen {name} request at {}: {key}", *index));
    *index += 1;
    case["output"].clone()
}

#[allow(unused_macros)]
macro_rules! assert_fixture_eq {
    ($left:expr, $right:expr $(, $($message:tt)+)?) => {{
        let (left,right) = (serde_json::json!($left),serde_json::json!($right));
        let (actual,expected)=($crate::fixtures::canonical(&left),$crate::fixtures::canonical(&right));
        if actual!=expected {
            let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../.cache");
            let _=std::fs::create_dir_all(&root);
            let _=std::fs::write(root.join("native-contract-failure.json"),serde_json::to_vec_pretty(&serde_json::json!({"at":concat!(file!(),":",line!()),"actual":actual,"expected":expected})).unwrap());
        }
        assert_eq!(actual,expected $(, $($message)+)?);
    }};
}

#[allow(dead_code)]
pub fn data(name: &str) -> Value {
    assert!(name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'));
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("../../tests/fixtures/contracts/{name}.json"));
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}
