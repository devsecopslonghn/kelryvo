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

/// Worker metadata connections share acquisition and per-session SQL timeouts.
pub fn metadata_pool_options(max_connections: u32) -> sqlx::postgres::PgPoolOptions {
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout='10s'")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("SET lock_timeout='5s'").execute(conn).await?;
                Ok(())
            })
        })
}
#[cfg(test)]
use installation::canonical_digest;
#[cfg(test)]
#[path = "../tests/support/installation.rs"]
pub(crate) mod installation_test_support;
#[cfg(test)]
#[path = "../../../tests/support/process_program.rs"]
pub(crate) mod process_test_support;
