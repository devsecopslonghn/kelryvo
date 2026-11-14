//! Native governance primitives. These functions do not grant target authority.
pub mod build_identity;
pub mod comment;
pub mod comparison;
pub mod coordinator;
pub mod cursor;
pub mod evidence;
pub mod history;
pub mod intent;
mod js_json;
pub mod migrations;
pub mod plan;
pub mod postconditions;
pub mod record;
pub mod release;
pub mod review;
pub mod schema;
pub mod schema_scope;
pub mod validation;
pub mod workspace;

use regex::Regex;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
};

pub const MAX_INPUT_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_RELEASE_FILES: usize = 128;
pub const MAX_RELEASE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PLAN_STATEMENTS: usize = 4096;
pub const NATIVE_ORACLE_DRIVER_PROFILE: &str = "kelryvo-oracle-rust-oci-0.6.3";
/// Private startup notification; this does not attest metadata activation or
/// grant Oracle execution authority.
pub const RUNTIME_API_READY: &[u8] = b"kelryvo.runtime.api.v1 READY\n";

pub fn sha256(bytes: impl AsRef<[u8]>) -> String {
    format!("{:x}", Sha256::digest(bytes.as_ref()))
}

pub fn evidence_digest(value: &Value) -> String {
    sha256(value.to_string())
}

pub(crate) fn matches(pattern: &'static str, value: &str) -> bool {
    static PATTERNS: LazyLock<Mutex<HashMap<&'static str, Regex>>> = LazyLock::new(Mutex::default);
    let mut patterns = PATTERNS.lock().expect("pattern cache poisoned");
    patterns
        .entry(pattern)
        .or_insert_with(|| Regex::new(pattern).expect("constant regex"))
        .is_match(value)
}

pub(crate) fn string(value: &Value) -> &str {
    value.as_str().unwrap_or_default()
}

pub(crate) fn js_len(value: &str) -> usize {
    value.encode_utf16().count()
}

/// ECMAScript's whitespace class, shared by the retained closed SQL grammars.
pub fn js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

pub(crate) fn text(value: &Value, max: usize) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty() && js_len(s) <= max && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}

pub fn digest(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

pub fn uuid(value: &Value) -> bool {
    matches(
        r"(?i)\A[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\z",
        string(value),
    )
}

pub(crate) fn safe_integer(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= 9_007_199_254_740_991)
}

pub(crate) fn utc_time(value: &str, precision: usize) -> bool {
    if value.len() != 21 + precision || !value.ends_with('Z') || value.starts_with("0000-") {
        return false;
    }
    let pattern = if precision == 3 {
        r"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z\z"
    } else {
        r"\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z\z"
    };
    matches(pattern, value)
        && chrono::DateTime::parse_from_rfc3339(value)
            .is_ok_and(|t| t.timestamp_subsec_nanos() < 1_000_000_000)
}
