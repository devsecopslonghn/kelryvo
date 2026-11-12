//! Explicit developer operation; the application never invokes the generator.
use kelryvo_core::sha256;
use serde_json::{Value, json};
use std::{fs, path::Path, process::Command, time::SystemTime};

const OUTPUTS: &[&str] = &["pl_sql_lexer.rs", "pl_sql_parser.rs", "semantics.json"];
const RENAMES: &[(&str, &str)] = &[
    (
        "this.isLastUnitSql() && this.isSolidusSeparator()",
        "this.is_last_sql_solidus()",
    ),
    ("setLastUnitPlsql", "set_last_unit_plsql"),
    ("setLastUnitSql", "set_last_unit_sql"),
    ("isSolidusSeparator", "is_solidus_separator"),
    ("isVersion10", "is_version_10"),
    ("isVersion11", "is_version_11"),
    ("isVersion12", "is_version_12"),
    ("IsNotNumericFunction", "is_not_numeric_function"),
    ("isNotStartOfJoin", "is_not_start_of_join"),
    ("IsNewlineAtPos(-4)", "is_newline_at_pos(-4)"),
];

fn publish(path: &Path, content: &[u8], write: bool) {
    if write {
        fs::write(path, content).expect("write explicit generated output");
    } else {
        assert_eq!(
            fs::read(path).expect("committed output"),
            content,
            "{} differs",
            path.display()
        );
    }
}

fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    assert!(
        args.len() == 2 && matches!(args[1].as_str(), "--check" | "--write"),
        "Usage: cargo run --locked -p kelryvo-oracle-grammar --example regenerate -- /absolute/path/antlr4-rust-gen --check|--write"
    );
    let generator = fs::canonicalize(&args[0]).expect("installed pinned generator");
    let version = Command::new(&generator)
        .arg("--version")
        .output()
        .expect("generator version");
    assert!(version.status.success());
    assert_eq!(
        String::from_utf8_lossy(&version.stdout).trim(),
        "antlr4-rust-gen 0.34.0"
    );
    let write = args[1] == "--write";
    let package = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = package.join("../..");
    let lock: Value = serde_json::from_slice(
        &fs::read(root.join("docs/dependencies/antlr-parser-lock.json")).unwrap(),
    )
    .unwrap();
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let scratch = root.join(format!(
        ".cache/native-grammar-regenerate-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir(&scratch).expect("fresh private regeneration directory");
    let mut inputs = Vec::new();
    for file in lock["grammar_files"].as_array().unwrap() {
        let original = root.join(file["path"].as_str().unwrap());
        let raw = fs::read(&original).unwrap();
        assert_eq!(sha256(&raw), file["sha256"], "pinned original grammar");
        let mut adapted = String::from_utf8(raw).unwrap();
        for (from, to) in RENAMES {
            adapted = adapted.replace(from, to);
        }
        let name = original.file_name().unwrap();
        fs::write(scratch.join(name), &adapted).unwrap();
        publish(
            &package.join("grammar").join(name),
            adapted.as_bytes(),
            write,
        );
        inputs.push(json!({"original":file["path"],"originalSha256":file["sha256"],
            "adapted":format!("grammar/{}",name.to_str().unwrap()),"adaptedSha256":sha256(&adapted)}));
    }
    let patterns = fs::read(package.join("grammar/semantics.toml")).unwrap();
    fs::write(scratch.join("semantics.toml"), &patterns).unwrap();
    let result = Command::new(&generator)
        .current_dir(&scratch)
        .args([
            "PlSqlLexer.g4",
            "PlSqlParser.g4",
            "--lib",
            ".",
            "--out-dir",
            "generated",
            "--sem-unknown",
            "error",
            "--sem-patterns",
            "semantics.toml",
            "--require-full-semantics",
            "--option-hook",
            "superClass=PlSqlLexerBase",
            "--option-hook",
            "superClass=PlSqlParserBase",
            "--no-listener",
        ])
        .output()
        .expect("run pinned native generator");
    assert!(
        result.status.success(),
        "generation failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    let semantics: Value =
        serde_json::from_slice(&fs::read(scratch.join("generated/semantics.json")).unwrap())
            .unwrap();
    assert_eq!(semantics["policy"], "error");
    for grammar in semantics["grammars"].as_array().unwrap() {
        for coordinate in grammar["coordinates"].as_array().unwrap() {
            assert!(
                matches!(
                    coordinate["disposition"].as_str(),
                    Some("hooked" | "synthetic")
                ),
                "unhandled semantics: {coordinate}"
            );
        }
    }
    let mut outputs = Vec::new();
    for name in OUTPUTS {
        let mut content = fs::read_to_string(scratch.join("generated").join(name)).unwrap();
        if name.ends_with(".rs") {
            // Codegen 0.34.0 collides with Oracle's METADATA token constant.
            // Rename only the grammar metadata static and its two references.
            for (from, to) in [
                (
                    "pub static METADATA: GrammarMetadata",
                    "pub static GRAMMAR_METADATA: GrammarMetadata",
                ),
                ("&METADATA\n", "&GRAMMAR_METADATA\n"),
                ("METADATA.rule_names()", "GRAMMAR_METADATA.rule_names()"),
            ] {
                assert_eq!(
                    content.matches(from).count(),
                    1,
                    "guarded generator repair: {name}"
                );
                content = content.replace(from, to);
            }
        }
        publish(
            &package.join("src/generated").join(name),
            content.as_bytes(),
            write,
        );
        outputs.push(json!({"path":format!("src/generated/{name}"),"sha256":sha256(&content)}));
    }
    let provenance = json!({"format":1,"profile":"kelryvo-oracle-rust-v2-antlr-0.34.0",
        "upstreamGrammarCommit":lock["grammar_commit"],"generator":{"package":"antlr-rust-codegen","version":"0.34.0","scope":"DEVELOPER_REGENERATION_ONLY"},
        "runtime":{"package":"antlr-rust-runtime","version":"0.34.0","license":"BSD-3-Clause","checksumSource":"Cargo.lock"},
        "inputs":inputs,"semanticPatternsSha256":sha256(patterns),"unknownSemantics":"ERROR",
        "repairs":["Rename generated grammar metadata static to GRAMMAR_METADATA and its two references; preserve Oracle METADATA token."],
        "outputs":outputs,"executionApproved":false,"productionApproved":false});
    let mut encoded = serde_json::to_vec_pretty(&provenance).unwrap();
    encoded.push(b'\n');
    publish(&package.join("grammar/provenance.json"), &encoded, write);
    fs::remove_dir_all(&scratch).expect("remove only this invocation's scratch directory");
    println!(
        "Native Oracle grammar {} matches pinned inputs and full semantic hooks.",
        if write { "regenerated" } else { "reproduction" }
    );
}
