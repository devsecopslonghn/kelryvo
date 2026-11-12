//! Fixed Linux container roles, private staging and bounded process supervision.
//! No HTTP or job input can select an executable, UID, secret path or restart.
pub mod bootstrap;
pub mod environment;
pub mod supervisor;

pub const ROOT: &str = "/opt/kelryvo";
pub const API_UID: u32 = 10001;
pub const WORKER_UID: u32 = 10002;
pub const RUNTIME: &str = "/run/kelryvo/runtime";
pub use kelryvo_core::RUNTIME_API_READY as API_READY;

#[derive(Clone, Copy, Debug)]
pub struct Unavailable;
pub type Result<T> = std::result::Result<T, Unavailable>;
