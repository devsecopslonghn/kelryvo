//! Compare the complete evidence and rejection behavior to retained production
//! code using its existing synthetic ledger fixture, with no external database.
#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
use kelryvo_runtime::oracle::completion::prepare;
use serde_json::Value;

#[test]
fn native_completion_rechecks_chain_preimages_and_every_central_checkpoint() {
    let cases = fixtures::data("completion");
    let mut valid = 0;
    let mut rejected = 0;
    for case in cases.as_array().unwrap() {
        let before = case["input"].clone();
        let prepared = prepare(&case["input"]);
        assert_eq!(
            prepared.clone().unwrap_or(Value::Null),
            case["expected"],
            "{}",
            case["name"]
        );
        assert_eq!(
            case["input"], before,
            "evidence preparation cannot mutate snapshots"
        );
        if let Some(result) = prepared {
            valid += 1;
            assert_eq!(result["evidence"]["statementCount"], 2);
            assert_eq!(
                result["evidence"]["kind"],
                "KELRYVO_COMPLETE_HELD_EXECUTION"
            );
            assert_eq!(prepare(&case["input"]), Some(result));
        } else {
            rejected += 1;
        }
    }
    assert_eq!(valid, 3);
    assert_eq!(rejected, 29);
}
