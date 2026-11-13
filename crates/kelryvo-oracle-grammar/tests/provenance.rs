//! Verify retained inputs/outputs without invoking or downloading a generator.
use kelryvo_core::sha256;
use serde_json::Value;
use std::{fs, path::Path};

fn read_json(path: &Path) -> Value {
    serde_json::from_slice(&fs::read(path).expect("retained provenance")).expect("provenance JSON")
}

#[test]
fn pinned_grammar_and_generated_bytes_match_their_provenance() {
    let package = Path::new(env!("CARGO_MANIFEST_DIR"));
    let root = package.join("../..");
    let provenance = read_json(&package.join("grammar/provenance.json"));
    let lock = read_json(&root.join("docs/dependencies/antlr-parser-lock.json"));
    assert_eq!(provenance["format"], 1);
    assert_eq!(provenance["upstreamGrammarCommit"], lock["grammar_commit"]);
    assert_eq!(provenance["unknownSemantics"], "ERROR");
    assert_eq!(provenance["executionApproved"], false);
    assert_eq!(provenance["productionApproved"], false);
    let inputs = provenance["inputs"].as_array().expect("grammar inputs");
    let locked = lock["grammar_files"].as_array().expect("locked grammars");
    assert_eq!(inputs.len(), 2);
    assert_eq!(inputs.len(), locked.len());
    for (input, name) in inputs.iter().zip(["PlSqlLexer.g4", "PlSqlParser.g4"]) {
        let original = format!("crates/kelryvo-oracle-grammar/upstream/{name}");
        let adapted = format!("grammar/{name}");
        assert_eq!(input["original"], original);
        assert_eq!(input["adapted"], adapted);
        let pinned = locked
            .iter()
            .find(|file| file["path"] == original)
            .expect("locked original");
        assert_eq!(input["originalSha256"], pinned["sha256"]);
        assert_eq!(
            sha256(fs::read(root.join(original)).unwrap()),
            input["originalSha256"]
        );
        assert_eq!(
            sha256(fs::read(package.join(adapted)).unwrap()),
            input["adaptedSha256"]
        );
    }
    assert_eq!(
        sha256(fs::read(package.join("grammar/semantics.toml")).unwrap()),
        provenance["semanticPatternsSha256"]
    );
    let outputs = provenance["outputs"].as_array().expect("generated outputs");
    assert_eq!(outputs.len(), 3);
    for (output, name) in
        outputs
            .iter()
            .zip(["pl_sql_lexer.rs", "pl_sql_parser.rs", "semantics.json"])
    {
        let path = format!("src/generated/{name}");
        assert_eq!(output["path"], path);
        assert_eq!(
            sha256(fs::read(package.join(path)).unwrap()),
            output["sha256"]
        );
    }
}

#[test]
fn generated_semantics_have_no_assumed_or_unhandled_coordinates() {
    let package = Path::new(env!("CARGO_MANIFEST_DIR"));
    let semantics = read_json(&package.join("src/generated/semantics.json"));
    assert_eq!(semantics["policy"], "error");
    let grammars = semantics["grammars"]
        .as_array()
        .expect("semantic grammar inventory");
    assert_eq!(grammars.len(), 2);
    for (grammar, kind) in grammars.iter().zip(["lexer", "parser"]) {
        assert_eq!(grammar["kind"], kind);
        let coordinates = grammar["coordinates"]
            .as_array()
            .expect("semantic coordinates");
        assert!(!coordinates.is_empty());
        for coordinate in coordinates {
            assert!(
                matches!(
                    coordinate["disposition"].as_str(),
                    Some("hooked" | "synthetic")
                ),
                "unhandled semantics: {coordinate}"
            );
        }
    }
    for option in semantics["options"].as_array().expect("grammar options") {
        assert!(
            matches!(option["disposition"].as_str(), Some("metadata" | "hooked")),
            "unhandled option: {option}"
        );
    }
}
