#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
#[cfg(test)]
#[path = "../../../tests/support/process_program.rs"]
mod process_test_support;
use kelryvo_core::{
    coordinator::Statement, cursor, evidence, intent, migrations, plan, postconditions, release,
    review, schema_scope,
};
use serde_json::{Value, json};
use std::{
    env,
    io::{self, BufRead, Read, Write},
    process::ExitCode,
};

fn execute(request: &Value) -> Option<Value> {
    Some(match request.get("op")?.as_str()? {
        "reconcileDraftConflict" => kelryvo_core::workspace::reconcile(
            &request["base"],
            &request["local"],
            &request["remote"],
            &request["choices"],
            &request["excludedIds"],
        )
        .unwrap_or(Value::Null),
        "nextMigrationFilePath" => json!(kelryvo_core::workspace::next_path(
            request["files"].as_array()?
        )),
        "approvedHistoryContext" => {
            kelryvo_core::history::context(&request["row"]).unwrap_or(Value::Null)
        }
        "approvedStatementLabel" => kelryvo_core::history::label(
            &request["context"],
            &request["ordinal"],
            &request["digest"],
        )
        .unwrap_or(Value::Null),
        "expectedTargetBindingDigests" => {
            kelryvo_core::history::target_digests(&request["intent"], &request["evidence"])
        }
        "completionCentralDigest" => {
            json!(kelryvo_core::history::central_digest(&request["snapshot"]))
        }
        "normalizeSchema" => kelryvo_core::schema::normalize(&request["raw"], &request["owner"]),
        "compareSchemas" => {
            kelryvo_core::schema::compare(&request["expected"], &request["observed"])
                .unwrap_or(Value::Null)
        }
        "validateCommentEvidenceInput" => {
            if kelryvo_core::comment::validate(&request["value"]) {
                request["value"].clone()
            } else {
                Value::Null
            }
        }
        "compareStatements" => kelryvo_core::comparison::statements(
            request["base"].as_array()?,
            request["candidate"].as_array()?,
        )
        .unwrap_or(Value::Null),
        "compareRetainedReleases" => {
            kelryvo_core::comparison::releases(&request["base"], &request["candidate"])
                .unwrap_or(Value::Null)
        }
        "mapPlan" => plan::project(&request["row"]),
        "verifyValidation" => kelryvo_core::validation::verify(
            request["envelope"].as_str()?,
            request["digest"].as_str()?,
            request.get("expected").unwrap_or(&json!({})),
        )
        .unwrap_or(Value::Null),
        "reviewSqlStatements" => review::statements(
            &request["statements"],
            request["owner"].as_str()?,
            request["engine"].as_str().unwrap_or("oracle"),
        )
        .unwrap_or(Value::Null),
        "catalogContext" => review::catalog_context(
            &request["statements"],
            request["owner"].as_str()?,
            &request["snapshot"],
            &request["expectedIdentityDigest"],
        )
        .unwrap_or(Value::Null),
        "parseOracle" => match kelryvo_parser::parse(request["sql"].as_str()?.as_bytes()) {
            Ok(parsed) => serde_json::to_value(parsed).ok()?,
            Err(error) => {
                json!({"ok":false,"code":error,"profile":kelryvo_parser::PROFILE,"executionApproved":false,"productionApproved":false})
            }
        },
        "assessSchemaScope" | "describeSchemaScope" => schema_scope::assess(
            request["sql"].as_str()?,
            request["owner"].as_str()?,
            request["op"] == "describeSchemaScope",
        ),
        "isApplicationOwner" => json!(schema_scope::is_application_owner(
            request["owner"].as_str()?
        )),
        "verifyRetainedRelease" => json!(release::verify(&request["release"])),
        "encodeOfflinePlanIntent" => intent::encode(&request["facts"]).unwrap_or(Value::Null),
        "verifyOfflinePlanIntent" => intent::verify(
            request["envelope"].as_str()?,
            request["digest"].as_str()?,
            request.get("expected").filter(|v| !v.is_null()),
        )
        .unwrap_or(Value::Null),
        "exactOracleIdentity" => {
            evidence::exact_identity(&request["identity"]).unwrap_or(Value::Null)
        }
        "physicalOracleTargetKey" => json!(evidence::physical_target_key(&request["identity"])),
        "oracleIdentityDigest" => json!(evidence::identity_digest(&request["identity"])),
        "normalizeObservation" => evidence::normalize_observation(
            &request["observation"],
            request["operation"].as_str()?,
            chrono::Utc::now(),
        ),
        "approvedMigrationIdentities" => {
            migrations::approved_identities(&request["intent"]).unwrap_or(Value::Null)
        }
        "selectPendingMigrations" => {
            migrations::select_pending(&request["migrations"], &request["observation"])
                .unwrap_or(Value::Null)
        }
        "compileOraclePostconditions" => {
            let statements: Vec<Statement> =
                serde_json::from_value(request["statements"].clone()).ok()?;
            postconditions::compile(
                &request["migrations"],
                &statements,
                request["owner"].as_str()?,
            )
            .unwrap_or(Value::Null)
        }
        "encodeAuditCursor" => json!(cursor::encode_audit(&request["position"])),
        "decodeAuditCursor" => cursor::decode_audit(
            request["cursor"].as_str()?,
            request["projectId"].as_str()?,
            &request["action"],
        )
        .unwrap_or(Value::Null),
        "encodeReviewInboxCursor" => json!(cursor::encode_review(&request["position"])),
        "decodeReviewInboxCursor" => cursor::decode_review(
            request["cursor"].as_str()?,
            request["actor"].as_str()?,
            request["scope"].as_str()?,
        )
        .unwrap_or(Value::Null),
        _ => return None,
    })
}

fn core() -> Result<(), ()> {
    const LIMIT: u64 =
        6 * (kelryvo_core::MAX_RELEASE_BYTES + kelryvo_core::MAX_STDOUT_BYTES) as u64 + 128 * 1024;
    let input = io::stdin();
    let mut input = input.lock();
    let output = io::stdout();
    let mut output = io::BufWriter::new(output.lock());
    loop {
        let mut line = Vec::new();
        let count = input
            .by_ref()
            .take(LIMIT + 1)
            .read_until(b'\n', &mut line)
            .map_err(|_| ())?;
        if count == 0 {
            return Ok(());
        }
        if count as u64 > LIMIT {
            return Err(());
        }
        let request: Value = serde_json::from_slice(&line).map_err(|_| ())?;
        let result = execute(&request).ok_or(())?;
        serde_json::to_writer(&mut output, &result).map_err(|_| ())?;
        output.write_all(b"\n").map_err(|_| ())?;
        output.flush().map_err(|_| ())?;
    }
}

/// Run the native CLI after its executable has selected its compiled identity.
pub fn run() -> ExitCode {
    let args: Vec<_> = env::args().skip(1).collect();
    match args.as_slice() {
        [mode, rest @ ..] if mode == "delivery" => delivery::command(rest),
        [mode, directory, flags @ ..]
            if mode == "chart-check" && (flags.is_empty() || flags == ["--native"]) =>
        {
            match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|e| e.to_string())
                .and_then(|rt| {
                    rt.block_on(chart::validate(
                        std::path::Path::new(directory),
                        !flags.is_empty(),
                    ))
                }) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("{error}");
                    ExitCode::FAILURE
                }
            }
        }
        [mode, rest @ ..] if mode == "oci" => oci::command(rest),
        [mode, rest @ ..] if mode == "pilot" => local::pilot(rest),
        [mode, rest @ ..] if mode == "dev" || mode == "local-prepare" => local::run(mode, rest),
        [arg] if arg == "--build-info" => {
            println!("{}", kelryvo_core::build_identity::info());
            ExitCode::SUCCESS
        }
        [arg] if arg == "source-tree-digest" => distribution::source_tree_digest(),
        [arg, output] if arg == "build-dist" => distribution::build(output, false),
        [arg, output, flag] if arg == "build-dist" && flag == "--debug" => {
            distribution::build(output, true)
        }
        [arg, output] if arg == "verify-dist" => distribution::verify(output),
        [arg, output] if arg == "runtime-inventory" => runtime_inventory::inventory(output),
        [arg] if arg == "build-web" => match web_build::build() {
            Ok(()) => ExitCode::SUCCESS,
            Err(()) => {
                eprintln!(
                    "Web build unavailable. Check the pinned Rust/WASM toolchain and wasm-bindgen-cli 0.2.130."
                );
                ExitCode::FAILURE
            }
        },
        [arg] if arg == "--version" => {
            println!("kelryvo {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        args if args.is_empty() || args == ["--help"] => {
            println!(
                "Usage: kelryvo pilot ACTION [OPTIONS] | dev [OPTIONS] | local-prepare [OPTIONS] | core | build-web | build-dist OUTPUT [--debug] | verify-dist DIRECTORY | runtime-inventory OUTPUT | chart-check CHECKOUT [--native] | oci ACTION [ARGS] | delivery ACTION [ARGS] | --build-info | --help | --version\n\npilot: root-owned installation preparation and native account/grant commands; use kelryvo pilot --help.\ndev/local-prepare: native checkout startup; use kelryvo dev --help for private local inputs.\ncore: bounded JSON-lines interface to native offline governance checks.\nbuild-dist: builds a fresh native application and WASM bundle with pinned Cargo source archives; no deployment or runtime qualification.\nverify-dist: checks exact bundle files against its inventory; hashes are not signatures or approval.\ndelivery: source/image/security gates, verified registry publication and protected Helm promotion; use kelryvo delivery --help.\noci: local archive inspection, source/role verification and deterministic two-platform assembly; use kelryvo oci --help.\nchart-check: read-only Helm rendering and retained storage/security/Argo checks; --native requires explicit native prerequisite claims.\nruntime-inventory: records installed Debian package versions and notices in a fresh absolute directory."
            );
            ExitCode::SUCCESS
        }
        [arg] if arg == "core" => match core() {
            Ok(()) => ExitCode::SUCCESS,
            Err(()) => {
                eprintln!("Invalid core request or unavailable input/output.");
                ExitCode::FAILURE
            }
        },
        _ => {
            eprintln!("Invalid command. Use kelryvo --help.");
            ExitCode::FAILURE
        }
    }
}

pub mod cargo_sources;
mod chart;
mod delivery;
mod distribution;
mod hygiene;
mod local;
mod oci;
mod runtime_inventory;
mod source_license;
mod web_build;

#[cfg(test)]
mod native_kernel_contracts {
    use super::*;
    fn expand(value: &Value) -> Value {
        match value {
            Value::Array(items) => Value::Array(items.iter().map(expand).collect()),
            Value::Object(object) if object.contains_key("$repeat") => {
                json!(
                    object["$repeat"]
                        .as_str()
                        .unwrap()
                        .repeat(object["count"].as_u64().unwrap() as usize)
                )
            }
            Value::Object(object) => Value::Object(
                object
                    .iter()
                    .map(|(key, value)| (key.clone(), expand(value)))
                    .collect(),
            ),
            _ => value.clone(),
        }
    }
    fn wire_equal(actual: &Value, expected: &Value) -> bool {
        match (actual, expected) {
            (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
            (Value::Array(a), Value::Array(b)) => {
                a.len() == b.len() && a.iter().zip(b).all(|(a, b)| wire_equal(a, b))
            }
            (Value::Object(a), Value::Object(b)) => {
                a.len() == b.len()
                    && a.iter()
                        .all(|(key, value)| b.get(key).is_some_and(|b| wire_equal(value, b)))
            }
            _ => actual == expected,
        }
    }
    #[test]
    fn every_retained_kernel_request_matches_its_independent_wire_contract() {
        let cases = expand(&fixtures::data("core"));
        let cases = cases.as_array().unwrap();
        assert_eq!(cases.len(), 1228);
        for (index, case) in cases.iter().enumerate() {
            let request = case["serialized"]
                .as_str()
                .map(|s| serde_json::from_str::<Value>(s).unwrap())
                .unwrap_or_else(|| case["request"].clone());
            let actual =
                execute(&request).unwrap_or_else(|| panic!("retained kernel request {index}"));
            assert!(
                wire_equal(&actual, &case["expected"]),
                "native/frozen kernel mismatch {index}: {}",
                request["op"]
            );
        }
    }
}

#[path = "../../../tools/dependency_source.rs"]
pub mod dependency_source;
