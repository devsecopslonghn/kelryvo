use antlr_rust_codegen::{Builder, UnknownSemanticPolicy};
use serde_json::Value;
use std::{env, fs, path::PathBuf};

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

fn digest(bytes: impl AsRef<[u8]>) -> String {
    hmac_sha256::Hash::hash(bytes.as_ref())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn main() {
    let mut args = env::args_os().skip(1);
    let package = PathBuf::from(args.next().expect("grammar package path"));
    let out = PathBuf::from(args.next().expect("Cargo output path"));
    assert!(args.next().is_none(), "unexpected generator arguments");
    let expected: Value =
        serde_json::from_slice(&fs::read(package.join("grammar/lock.json")).unwrap()).unwrap();
    assert_eq!(antlr_rust_codegen::VERSION, "0.34.0");
    for input in expected["inputs"].as_array().unwrap() {
        let name = std::path::Path::new(input["original"].as_str().unwrap())
            .file_name()
            .unwrap();
        let raw = fs::read(package.join("upstream").join(name)).unwrap();
        assert_eq!(digest(&raw), input["originalSha256"]);
        let mut adapted = String::from_utf8(raw).unwrap();
        for (from, to) in RENAMES {
            adapted = adapted.replace(from, to);
        }
        assert_eq!(digest(&adapted), input["adaptedSha256"]);
        fs::write(out.join(name), adapted).unwrap();
    }
    let patterns = fs::read(package.join("grammar/semantics.toml")).unwrap();
    assert_eq!(digest(&patterns), expected["semanticPatternsSha256"]);
    fs::write(out.join("semantics.toml"), patterns).unwrap();
    // Relative grammar paths keep output bytes independent of the checkout.
    env::set_current_dir(&out).unwrap();
    Builder::new()
        .grammars(["PlSqlLexer.g4", "PlSqlParser.g4"])
        .library_directory(".")
        .out_dir("generated")
        .unknown_semantics(UnknownSemanticPolicy::Error)
        .semantic_patterns("semantics.toml")
        .require_full_semantics(true)
        .option_hook("superClass=PlSqlLexerBase")
        .option_hook("superClass=PlSqlParserBase")
        .generate_listener(false)
        .generate()
        .expect("generate the pinned Oracle recognizers");
    for output in expected["outputs"].as_array().unwrap() {
        let path = out.join(output["path"].as_str().unwrap());
        let mut content = fs::read_to_string(&path).unwrap();
        if path.extension().is_some_and(|extension| extension == "rs") {
            for (from, to) in [
                (
                    "pub static METADATA: GrammarMetadata",
                    "pub static GRAMMAR_METADATA: GrammarMetadata",
                ),
                ("&METADATA\n", "&GRAMMAR_METADATA\n"),
                ("METADATA.rule_names()", "GRAMMAR_METADATA.rule_names()"),
            ] {
                assert_eq!(content.matches(from).count(), 1, "guarded generator repair");
                content = content.replace(from, to);
            }
        }
        assert_eq!(
            digest(&content),
            output["sha256"],
            "generated output drift: {}",
            path.display()
        );
        fs::write(path, content).unwrap();
    }
}
