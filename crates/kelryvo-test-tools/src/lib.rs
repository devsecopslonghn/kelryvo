//! Development-only fixtures and test drivers. Never part of an installed
//! application or a source of execution, installation or release authority.
pub mod ack_proxy;
pub mod api;
pub mod browser;
pub mod fixture;
pub mod oracle_guard;
pub mod oracle_witness;
pub mod process;
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub fn root() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("source checkout")
}
