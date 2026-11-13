use kelryvo_core::{release, sha256, workspace};
use serde_json::{Value, json};
use std::cmp::Ordering;

#[test]
fn migration_versions_preserve_numeric_order_and_distinct_filename_bounds() {
    for (left, right, expected) in [
        ("1", "1.0.0", Ordering::Equal),
        ("0.0", "0", Ordering::Equal),
        ("1.2", "1.10", Ordering::Less),
        ("2", "1.99", Ordering::Greater),
        ("1.0.1", "1", Ordering::Greater),
        (
            "999999999999999999999999",
            "1000000000000000000000000",
            Ordering::Less,
        ),
    ] {
        assert_eq!(workspace::compare_versions(left, right), expected);
        assert_eq!(workspace::compare_versions(right, left), expected.reverse());
    }
    assert_eq!(
        workspace::file_version("V0001_02.000__init.sql").as_deref(),
        Some("1.2")
    );
    assert_eq!(
        workspace::file_version("V000_0__init.sql").as_deref(),
        Some("0")
    );
    for invalid in [
        "V1__init.sql\n",
        "V1..2__init.sql",
        "nested/V1__init.sql",
        "V1__😀.sql",
    ] {
        assert!(workspace::file_version(invalid).is_none());
    }

    // Editable files stop at 200 characters; Git releases retain longer names.
    let filename = format!("V0001_02_0__{}.sql", "a".repeat(200));
    assert!(workspace::file_version(&filename).is_none());
    let path = format!("migrations/{filename}");
    let content = "SELECT 1 FROM dual;\n";
    let file = json!({"path":path,"version":"1.2","sha256":sha256(content),"bytes":content.len()});
    let manifest = json!({"format":1,"commit":"a".repeat(40),"objectFormat":"sha1","folder":"migrations","parserProfile":"test-profile","files":[file]});
    let mut retained = json!({"commit_id":manifest["commit"],"object_format":"sha1","folder":"migrations","parser_profile":"test-profile","manifest_digest":sha256(manifest.to_string()),"files":[manifest["files"][0].clone()]});
    retained["files"][0]["content"] = content.into();
    retained["files"][0]["statementCount"] = Value::Null;
    retained["files"][0]["validationStatus"] = "VALID".into();
    assert!(release::verify(&retained));
    retained["files"][0]["version"] = "1.2.0".into();
    let mut noncanonical_manifest = manifest;
    noncanonical_manifest["files"][0]["version"] = "1.2.0".into();
    retained["manifest_digest"] = sha256(noncanonical_manifest.to_string()).into();
    assert!(
        !release::verify(&retained),
        "release versions remain canonical"
    );
}
