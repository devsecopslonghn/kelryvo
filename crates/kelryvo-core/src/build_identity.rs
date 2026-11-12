//! Compiled artifact identity. This describes a build, not approval or runtime
//! qualification. Local builds remain explicitly unpublished.
use serde_json::{Value, json};
pub const SOURCE_SHA: &str = match option_env!("KELRYVO_SOURCE_SHA") {
    Some(s) => s,
    None => "local-unpublished",
};
pub const SOURCE_TREE_DIGEST: Option<&str> = option_env!("KELRYVO_SOURCE_TREE_DIGEST");
const fn hex(s: &str, len: usize) -> bool {
    if s.len() != len {
        return false;
    }
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !(bytes[i] >= b'0' && bytes[i] <= b'9' || bytes[i] >= b'a' && bytes[i] <= b'f') {
            return false;
        }
        i += 1;
    }
    true
}
const fn valid_source(s: &str) -> bool {
    if hex(s, 40) {
        return true;
    }
    let local = b"local-unpublished";
    let bytes = s.as_bytes();
    if bytes.len() != local.len() {
        return false;
    }
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != local[i] {
            return false;
        }
        i += 1;
    }
    true
}
const _: () = assert!(valid_source(SOURCE_SHA), "invalid native source revision");
const _: () = if let Some(d) = SOURCE_TREE_DIGEST {
    assert!(hex(d, 64), "invalid native source tree digest")
};
pub fn matches_source(source: &str) -> bool {
    SOURCE_SHA == "local-unpublished" || SOURCE_SHA == source
}
pub fn info() -> Value {
    json!({"format":1,"implementation":"RUST","version":env!("CARGO_PKG_VERSION"),"sourceSha":SOURCE_SHA,"sourceTreeDigest":SOURCE_TREE_DIGEST,
        "architecture":std::env::consts::ARCH,"os":std::env::consts::OS,"profile":if cfg!(debug_assertions){"debug"}else{"release"},"driverProfile":crate::NATIVE_ORACLE_DRIVER_PROFILE})
}
