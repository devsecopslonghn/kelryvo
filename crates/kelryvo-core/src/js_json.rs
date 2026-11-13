//! JSON stringification for retained ECMAScript hashes. Object index keys come
//! first; other keys follow insertion order or UTF-16 order for canonical hashes.
use serde_json::Value;
use std::cmp::Ordering;

pub fn cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}
fn index(s: &str) -> Option<u32> {
    let n = s.parse::<u32>().ok()?;
    (n < u32::MAX && n.to_string() == s).then_some(n)
}
pub fn stringify(value: &Value, canonical: bool) -> String {
    fn write(value: &Value, canonical: bool, out: &mut String) {
        match value {
            Value::Number(n) => {
                let number = n.as_f64().expect("finite JSON number");
                out.push_str(ryu_js::Buffer::new().format_finite(number));
            }
            Value::Array(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write(item, canonical, out);
                }
                out.push(']');
            }
            Value::Object(object) => {
                let mut keys: Vec<_> = object.keys().collect();
                keys.sort_by(|a, b| match (index(a), index(b)) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    (Some(_), None) => Ordering::Less,
                    (None, Some(_)) => Ordering::Greater,
                    _ => {
                        if canonical {
                            cmp(a, b)
                        } else {
                            Ordering::Equal
                        }
                    }
                });
                out.push('{');
                for (i, key) in keys.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    out.push_str(&serde_json::to_string(key).expect("JSON string"));
                    out.push(':');
                    write(&object[*key], canonical, out);
                }
                out.push('}');
            }
            _ => out.push_str(&value.to_string()),
        }
    }
    let mut result = String::new();
    write(value, canonical, &mut result);
    result
}
