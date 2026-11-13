//! Privileged Oracle capabilities. The public server never imports this module.
pub mod attestation;
pub mod catalog;
pub mod completion;
pub mod discovery;
pub mod driver;
pub mod ledger;
pub mod mutex;
pub mod provision;
use serde_json::Value;
use uuid::Uuid;
#[derive(Clone, Copy, Debug)]
pub struct Unavailable;
impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Oracle runtime unavailable")
    }
}
impl std::error::Error for Unavailable {}
impl From<::oracle::Error> for Unavailable {
    fn from(_: ::oracle::Error) -> Self {
        Self
    }
}
pub type Result<T> = std::result::Result<T, Unavailable>;
pub struct Bind {
    pub name: String,
    pub value: Value,
}
impl Bind {
    pub fn new(name: &str, value: impl Into<Value>) -> Self {
        Self {
            name: name.into(),
            value: value.into(),
        }
    }
}
/// One dedicated physical session, with no pool, reconnect, retry or recursive I/O.
/// Capability owners serialize use; the supervisor bounds the containing process.
pub trait Session {
    fn instance(&self) -> Uuid;
    fn call_timeout_ms(&self) -> u64;
    fn server_version(&mut self) -> Result<String>;
    fn query(&mut self, sql: &str, binds: &[Bind], max_rows: usize) -> Result<Vec<Value>>;
    fn execute(&mut self, sql: &str, binds: &[Bind]) -> Result<u64>;
    fn commit(&mut self) -> Result<()>;
    fn rollback(&mut self) -> Result<()>;
    fn mutex_call(&mut self, owner: &str, operation: &str, name: &str, nonce: &str) -> Result<i64>;
}
pub fn bounded(session: &impl Session) -> bool {
    (1..=30000).contains(&session.call_timeout_ms())
}
pub(crate) fn digest(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        s.len() == 64
            && s.bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}
pub(crate) fn uuid(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.len() == 36 && Uuid::parse_str(s).is_ok())
}
pub(crate) fn hash(v: &Value) -> String {
    kelryvo_core::sha256(v.to_string())
}
