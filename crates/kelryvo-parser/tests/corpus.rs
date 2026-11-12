//! Exercise the application entry point against the original Oracle goldens.
use kelryvo_core::sha256;
use kelryvo_parser::{PROFILE, parse};
use serde_json::Value;
use std::{fs, path::Path};

#[test]
fn application_parser_preserves_every_original_corpus_statement_and_stop() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/parser");
    let manifest: Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    let mut checked = 0;
    for group in manifest["groups"].as_array().unwrap() {
        for variant in group["variants"].as_array().unwrap() {
            for file in variant["files"].as_array().unwrap() {
                let name = file["path"].as_str().unwrap();
                let raw = fs::read(root.join(name)).unwrap();
                assert_eq!(sha256(&raw), file["sha256"], "retained source: {name}");
                let expected = file["statements"].as_array().unwrap();
                let parsed = parse(&raw);
                if expected.is_empty() {
                    assert!(parsed.is_err(), "must reject entire input: {name}");
                } else {
                    let parsed = parsed.unwrap_or_else(|e| panic!("{name}: {e:?}"));
                    assert_eq!(parsed.profile, PROFILE);
                    assert_eq!(parsed.raw_sha256, file["sha256"]);
                    assert!(!parsed.execution_approved && !parsed.production_approved);
                    assert_eq!(parsed.statement_count, expected.len(), "count: {name}");
                    for (actual, golden) in parsed.statements.iter().zip(expected) {
                        assert_eq!(
                            actual.start_byte as u64,
                            golden["start_byte"].as_u64().unwrap(),
                            "start: {name}"
                        );
                        assert_eq!(
                            actual.end_byte as u64,
                            golden["end_byte"].as_u64().unwrap(),
                            "end: {name}"
                        );
                        assert_eq!(
                            actual.source_sha256, golden["source_sha256"],
                            "source: {name}"
                        );
                        assert_eq!(
                            actual.execution_sha256, golden["execution_sha256"],
                            "execution: {name}"
                        );
                        assert_eq!(sha256(&actual.execution_sql), actual.execution_sha256);
                    }
                }
                checked += 1;
            }
        }
    }
    assert_eq!(checked, 31);
}
