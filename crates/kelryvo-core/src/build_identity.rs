//! Compiled artifact identity. This describes a build, not approval or runtime
//! qualification. Local builds remain explicitly unpublished.
use serde_json::{Value, json};
use std::sync::OnceLock;

/// Only an executable's compiled constants select its identity. Libraries can
/// be reused across revisions without embedding a stale library-build revision.
pub struct CompiledIdentity {
    source: &'static str,
    tree: Option<&'static str>,
}
impl CompiledIdentity {
    pub const fn new(source: &'static str, tree: Option<&'static str>) -> Self {
        assert!(valid_source(source), "invalid native source revision");
        if let Some(tree) = tree {
            assert!(hex(tree, 64), "invalid native source tree digest");
        }
        Self { source, tree }
    }
}
struct IdentitySlot(OnceLock<&'static CompiledIdentity>);
impl IdentitySlot {
    const fn new() -> Self {
        Self(OnceLock::new())
    }
    fn initialize(&self, identity: &'static CompiledIdentity) -> bool {
        let selected = self.0.get_or_init(|| identity);
        selected.source == identity.source && selected.tree == identity.tree
    }
    fn get(&self) -> Option<&'static CompiledIdentity> {
        self.0.get().copied()
    }
}
static IDENTITY: IdentitySlot = IdentitySlot::new();
static LOCAL: CompiledIdentity = CompiledIdentity::new("local-unpublished", None);

/// Entry points call the macro before handling application inputs or requests.
/// A second initializer can never replace the selected compiled identity.
#[doc(hidden)]
pub fn initialize(identity: &'static CompiledIdentity) {
    assert!(
        IDENTITY.initialize(identity),
        "compiled identity already selected"
    );
}

#[macro_export]
macro_rules! initialize_build_identity {
    () => {{
        static COMPILED: $crate::build_identity::CompiledIdentity =
            $crate::build_identity::CompiledIdentity::new(
                match option_env!("KELRYVO_SOURCE_SHA") {
                    Some(source) => source,
                    None => "local-unpublished",
                },
                option_env!("KELRYVO_SOURCE_TREE_DIGEST"),
            );
        $crate::build_identity::initialize(&COMPILED);
    }};
}

fn selected() -> Option<&'static CompiledIdentity> {
    IDENTITY
        .get()
        .or_else(|| cfg!(debug_assertions).then_some(&LOCAL))
}
pub fn source_sha() -> Option<&'static str> {
    selected().map(|identity| identity.source)
}
pub fn source_tree_digest() -> Option<&'static str> {
    selected().and_then(|identity| identity.tree)
}
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
pub fn matches_source(source: &str) -> bool {
    selected()
        .is_some_and(|identity| identity.source == "local-unpublished" || identity.source == source)
}
pub fn info() -> Value {
    let identity = selected().expect("compiled artifact identity must be initialized");
    json!({"format":1,"implementation":"RUST","version":env!("CARGO_PKG_VERSION"),"sourceSha":identity.source,"sourceTreeDigest":identity.tree,
        "architecture":std::env::consts::ARCH,"os":std::env::consts::OS,"profile":if cfg!(debug_assertions){"debug"}else{"release"},"driverProfile":crate::NATIVE_ORACLE_DRIVER_PROFILE})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_cannot_be_replaced_by_a_different_revision_or_tree() {
        static FIRST: CompiledIdentity = CompiledIdentity::new(
            "1111111111111111111111111111111111111111",
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        );
        static OTHER_SOURCE: CompiledIdentity =
            CompiledIdentity::new("2222222222222222222222222222222222222222", FIRST.tree);
        static OTHER_TREE: CompiledIdentity = CompiledIdentity::new(
            FIRST.source,
            Some("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
        );
        let slot = IdentitySlot::new();
        assert!(slot.get().is_none());
        assert!(slot.initialize(&FIRST));
        assert!(slot.initialize(&FIRST));
        assert!(!slot.initialize(&OTHER_SOURCE));
        assert!(!slot.initialize(&OTHER_TREE));
        assert_eq!(slot.get().unwrap().source, FIRST.source);
        assert_eq!(slot.get().unwrap().tree, FIRST.tree);
    }
    #[test]
    fn malformed_compiled_identities_are_rejected() {
        for source in ["", "main", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"] {
            assert!(std::panic::catch_unwind(|| CompiledIdentity::new(source, None)).is_err());
        }
        for tree in [
            "",
            "short",
            "GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
        ] {
            assert!(
                std::panic::catch_unwind(|| CompiledIdentity::new(LOCAL.source, Some(tree)))
                    .is_err()
            );
        }
    }
}
