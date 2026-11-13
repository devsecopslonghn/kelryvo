//! Privileged worker orchestration. Public API binaries do not depend on this
//! crate. Control messages carry only job identifiers, never host capabilities.
#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
pub mod admission;
pub mod controller;
pub mod discovery;
pub mod host;
pub mod installation;
pub mod loader;
pub mod managed;
pub mod operator;
pub mod oracle_host;
pub mod preparation;
pub mod publication;
pub mod recovery;
pub mod run;
#[cfg(test)]
use installation::canonical_digest;
#[cfg(test)]
#[path = "../tests/support/installation.rs"]
pub(crate) mod installation_test_support;
#[cfg(test)]
#[path = "../../../tests/support/process_program.rs"]
pub(crate) mod process_test_support;
