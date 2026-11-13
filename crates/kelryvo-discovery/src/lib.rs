//! Credential-free discovery IPC. This crate has no Oracle client, metadata
//! access, installation loader, executable selection or execution capability.
mod protocol;
mod transport;
pub use protocol::{Connection, Operation, Request, Response, unavailable};
pub use transport::{Client, Handler, HandlerResult, Limits, serve};
pub const SOCKET: &str = "/run/kelryvo/runtime/bridge/discovery.sock";
pub const REQUEST_BYTES: usize = 16 * 1024;
pub const RESPONSE_BYTES: usize = 2 * 1024 * 1024;
#[derive(Clone, Copy, Debug)]
pub struct Unavailable;
pub type Result<T> = std::result::Result<T, Unavailable>;
