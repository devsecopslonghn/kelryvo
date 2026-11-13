//! Retained original Oracle parser corpus, checked without a Java process.
use kelryvo_oracle_grammar::parse;
use std::{fs, path::Path};
#[test]
fn native_grammar_matches_retained_acceptance_and_every_source_execution_digest() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/parser");
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).unwrap()).unwrap();
    let mut count = 0;
    for group in manifest["groups"].as_array().unwrap() {
        for variant in group["variants"].as_array().unwrap() {
            for file in variant["files"].as_array().unwrap() {
                let name = file["path"].as_str().unwrap();
                let raw = fs::read(root.join(name)).unwrap();
                assert_eq!(
                    kelryvo_core::sha256(&raw),
                    file["sha256"],
                    "retained bytes: {name}"
                );
                let Ok(source) = std::str::from_utf8(&raw) else {
                    continue;
                };
                if source.starts_with('\u{feff}') {
                    continue;
                }
                let expected = file["statements"].as_array().unwrap();
                let parsed = parse(source);
                if expected.is_empty() {
                    assert!(parsed.is_err(), "must stop: {name}");
                } else {
                    let parsed =
                        parsed.unwrap_or_else(|error| panic!("native grammar {name}: {error:?}"));
                    assert_eq!(parsed.len(), expected.len(), "statement count {name}");
                    for (range, golden) in parsed.iter().zip(expected) {
                        assert_eq!(
                            range.start as u64,
                            golden["start_byte"].as_u64().unwrap(),
                            "start {name}"
                        );
                        assert_eq!(
                            range.end as u64,
                            golden["end_byte"].as_u64().unwrap(),
                            "end {name}"
                        );
                        assert_eq!(
                            kelryvo_core::sha256(&raw[range.start..range.end]),
                            golden["source_sha256"],
                            "source {name}"
                        );
                        assert_eq!(
                            kelryvo_core::sha256(&raw[range.start..range.execution_end]),
                            golden["execution_sha256"],
                            "execution {name}"
                        );
                    }
                }
                count += 1;
            }
        }
    }
    assert_eq!(count, 29);
}
