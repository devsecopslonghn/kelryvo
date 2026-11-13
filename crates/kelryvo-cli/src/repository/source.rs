use super::{Result, read_json};
use serde_json::Value;
use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
};

pub(super) use crate::hygiene::{check as hygiene, git};

const EXCLUDED: &[&str] = &[
    ".git",
    "node_modules",
    ".cache",
    "coverage",
    "dist",
    "target",
];
fn walk(directory: &Path, files: &mut Vec<PathBuf>) -> Result<()> {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink()
            || EXCLUDED
                .iter()
                .any(|name| entry.file_name() == OsStr::new(name))
        {
            continue;
        }
        if kind.is_dir() {
            walk(&entry.path(), files)?;
        } else if kind.is_file() {
            files.push(entry.path());
        }
    }
    Ok(())
}
fn owned(root: &Path) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    walk(root, &mut paths)?;
    paths.sort();
    Ok(paths)
}

pub(super) fn check(root: &Path) -> Result<()> {
    let mut count = 0;
    let mut errors = Vec::new();
    for path in owned(root)? {
        let extension = path.extension().and_then(OsStr::to_str).unwrap_or("");
        if [
            "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "sh", "bash", "zsh",
        ]
        .contains(&extension)
        {
            return Err(format!(
                "{}: authored interpreter tooling must use native Rust",
                path.strip_prefix(root).unwrap().display()
            ));
        }
        if !["json", "md", "toml", "yml", "yaml", "html", "css"].contains(&extension) {
            continue;
        }
        count += 1;
        let source = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let name = path.strip_prefix(root).unwrap().display();
        if !source.ends_with('\n') {
            errors.push(format!("{name}: missing final newline"));
        }
        if source.contains('\r') {
            errors.push(format!("{name}: use LF line endings"));
        }
        if source.split('\n').any(|line| line.ends_with([' ', '\t'])) {
            errors.push(format!("{name}: trailing whitespace"));
        }
        if extension == "json" && serde_json::from_str::<Value>(&source).is_err() {
            errors.push(format!("{name}: invalid JSON"));
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    println!("Source checks passed for {count} authored files.");
    Ok(())
}

fn formatted(value: &Value) -> String {
    fn write(value: &Value, depth: usize, out: &mut String) {
        let indent = |n: usize| "  ".repeat(n);
        match value {
            Value::Number(number) => {
                out.push_str(ryu_js::Buffer::new().format_finite(number.as_f64().unwrap()))
            }
            Value::Array(items) if !items.is_empty() => {
                out.push_str("[\n");
                for (i, item) in items.iter().enumerate() {
                    out.push_str(&indent(depth + 1));
                    write(item, depth + 1, out);
                    out.push_str(if i + 1 == items.len() { "\n" } else { ",\n" });
                }
                out.push_str(&indent(depth));
                out.push(']');
            }
            Value::Object(object) if !object.is_empty() => {
                let index = |key: &str| {
                    key.parse::<u32>()
                        .ok()
                        .filter(|n| *n < u32::MAX && n.to_string() == key)
                };
                let mut keys: Vec<_> = object.keys().collect();
                keys.sort_by(|a, b| match (index(a), index(b)) {
                    (Some(a), Some(b)) => a.cmp(&b),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    _ => std::cmp::Ordering::Equal,
                });
                out.push_str("{\n");
                for (i, key) in keys.iter().enumerate() {
                    out.push_str(&indent(depth + 1));
                    out.push_str(&serde_json::to_string(key).unwrap());
                    out.push_str(": ");
                    write(&object[*key], depth + 1, out);
                    out.push_str(if i + 1 == keys.len() { "\n" } else { ",\n" });
                }
                out.push_str(&indent(depth));
                out.push('}');
            }
            _ => out.push_str(&value.to_string()),
        }
    }
    let mut output = String::new();
    write(value, 0, &mut output);
    output.push('\n');
    output
}
pub(super) fn format(root: &Path, write: bool) -> Result<()> {
    let mut mismatches = Vec::new();
    for path in owned(root)? {
        if path.extension() != Some(OsStr::new("json")) {
            continue;
        }
        let output = formatted(&read_json(&path)?);
        if fs::read_to_string(&path).map_err(|e| e.to_string())? != output {
            if write {
                fs::write(&path, output).map_err(|e| e.to_string())?;
            } else {
                mismatches.push(path.strip_prefix(root).unwrap().display().to_string());
            }
        }
    }
    if !mismatches.is_empty() {
        return Err(format!(
            "JSON formatting differs: {}",
            mismatches.join(", ")
        ));
    }
    println!("Source JSON formatting passed; generated caches excluded.");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn source_requires_native_tooling_and_ignores_generated_browser_glue() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join(".cache")).unwrap();
        fs::write(
            directory.path().join(".cache/generated.js"),
            "generated external glue",
        )
        .unwrap();
        fs::write(
            directory.path().join("fixture.html"),
            "<main>Native WASM fixture</main>\n",
        )
        .unwrap();
        check(directory.path()).unwrap();
        for extension in [
            "js", "mjs", "cjs", "ts", "tsx", "jsx", "py", "sh", "bash", "zsh",
        ] {
            let script = directory.path().join(format!("tool.{extension}"));
            fs::write(&script, "legacy tooling\n").unwrap();
            assert!(
                check(directory.path())
                    .unwrap_err()
                    .contains("must use native Rust")
            );
            fs::remove_file(script).unwrap();
        }
        check(directory.path()).unwrap();
    }
    #[test]
    fn json_format_preserves_legacy_numeric_and_object_ordering() {
        let value: Value =
            serde_json::from_str(r#"{"z":1.0,"10":-0.0,"2":1e21,"text":"Việt 😀","empty":[]}"#)
                .unwrap();
        assert_eq!(
            formatted(&value),
            "{\n  \"2\": 1e+21,\n  \"10\": 0,\n  \"z\": 1,\n  \"text\": \"Việt 😀\",\n  \"empty\": []\n}\n"
        );
    }
    #[test]
    fn walking_never_formats_generated_outputs_or_follows_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        fs::create_dir(directory.path().join(".cache")).unwrap();
        fs::write(
            directory.path().join(".cache/private.json"),
            "unreadable JSON",
        )
        .unwrap();
        fs::write(directory.path().join("source.json"), "{\"x\":1}").unwrap();
        std::os::unix::fs::symlink("source.json", directory.path().join("link.json")).unwrap();
        assert_eq!(owned(directory.path()).unwrap().len(), 1);
        assert!(format(directory.path(), false).is_err());
        format(directory.path(), true).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join("source.json")).unwrap(),
            "{\n  \"x\": 1\n}\n"
        );
        assert_eq!(
            fs::read_to_string(directory.path().join(".cache/private.json")).unwrap(),
            "unreadable JSON"
        );
    }
}
