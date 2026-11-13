//! Reproducible opt-in offline measurements. No machine-independent latency
//! threshold or Oracle/performance approval is inferred from a successful run.
use kelryvo_core::{MAX_INPUT_BYTES, MAX_PLAN_STATEMENTS, sha256};
use kelryvo_parser::{PROFILE, ParseError, parse};
use serde_json::json;
use std::{hint::black_box, time::Instant};

#[test]
#[ignore = "opt-in offline parser measurements; run with --release --ignored --nocapture"]
fn bounded_offline_workloads() {
    let ddl = "CREATE TABLE item (id NUMBER PRIMARY KEY, label VARCHAR2(100));\n";
    let valid_max_bytes = format!("/*{}*/{ddl}", "x".repeat(MAX_INPUT_BYTES - ddl.len() - 4));
    let workloads = [
        ("small-ddl", ddl.to_owned(), Ok(1)),
        ("ddl-batch-128", ddl.repeat(128), Ok(128)),
        (
            "maximum-statements",
            "SELECT 1 FROM dual;\n".repeat(MAX_PLAN_STATEMENTS),
            Ok(MAX_PLAN_STATEMENTS),
        ),
        ("maximum-bytes", valid_max_bytes, Ok(1)),
        (
            "late-syntax-error",
            format!("{}CREATE TABLE broken (;", ddl.repeat(128)),
            Err(ParseError::ParserRejectedInput),
        ),
        (
            "excessive-statements",
            "SELECT 1 FROM dual;\n".repeat(MAX_PLAN_STATEMENTS + 1),
            Err(ParseError::StatementLimit),
        ),
        (
            "excessive-rule-depth",
            format!("SELECT {}1{} FROM dual;", "(".repeat(300), ")".repeat(300)),
            Err(ParseError::ParserRejectedInput),
        ),
        (
            "maximum-bytes-unterminated-quote",
            format!("'{}", "x".repeat(MAX_INPUT_BYTES - 1)),
            Err(ParseError::InvalidQuotation),
        ),
    ];
    println!(
        "{}",
        json!({"format":1,"profile":PROFILE,"os":std::env::consts::OS,
            "arch":std::env::consts::ARCH,"debugAssertions":cfg!(debug_assertions),
            "samplesPerWorkload":3,"executionApproved":false,"productionApproved":false})
    );
    for (name, input, expected) in workloads {
        let mut samples = Vec::new();
        // Record the first invocation separately; do not hide grammar/cache
        // initialization in an unreported warm-up or mix it with warm samples.
        for _ in 0..4 {
            let start = Instant::now();
            let parsed = parse(black_box(input.as_bytes()));
            let elapsed = start.elapsed().as_secs_f64() * 1000.0;
            match &parsed {
                Ok(parsed) => {
                    assert_eq!(expected, Ok(parsed.statement_count), "{name}");
                    assert!(!parsed.execution_approved && !parsed.production_approved);
                }
                Err(error) => assert_eq!(expected, Err(*error), "{name}"),
            }
            drop(black_box(parsed));
            samples.push(elapsed);
        }
        let first_ms = samples.remove(0);
        samples.sort_by(f64::total_cmp);
        println!(
            "{}",
            json!({"workload":name,"bytes":input.len(),"inputSha256":sha256(&input),
                "expectedStatements":expected.ok(),"expectedError":expected.err(),
                "firstMs":first_ms,"warmMinMs":samples[0],"warmMedianMs":samples[1],
                "warmMaxMs":samples[2]})
        );
    }
}
