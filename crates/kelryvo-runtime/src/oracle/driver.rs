//! Dedicated OCI-backed sessions; private installation owns client/wallet inputs.
use super::{Bind, Result, Session, Unavailable, bounded};
use ::oracle::{
    Connection,
    sql_type::{OracleType, ToSql},
};
use kelryvo_core::MAX_INPUT_BYTES;
use regex::Regex;
use serde_json::{Value, json};
use std::{
    net::IpAddr,
    path::{Component, Path},
    sync::LazyLock,
    time::Duration,
};
use uuid::Uuid;
use zeroize::Zeroizing;
pub const PROFILE: &str = kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE;
/// Initialize once in a fresh supervised child using reviewed private paths.
pub fn initialize_client(libraries: &Path, configuration: &Path) -> Result<()> {
    if !libraries.is_absolute()
        || !configuration.is_absolute()
        || ::oracle::InitParams::is_initialized()
    {
        return Err(Unavailable);
    }
    if !::oracle::InitParams::new()
        .oracle_client_lib_dir(libraries)?
        .oracle_client_config_dir(configuration)?
        .init()?
    {
        return Err(Unavailable);
    }
    Ok(())
}
/// Report only an explicitly initialized client; never initialize implicitly.
pub fn client_version() -> Result<String> {
    if !::oracle::InitParams::is_initialized() {
        return Err(Unavailable);
    }
    Ok(::oracle::Version::client()?.to_string())
}
pub const IDENTITY_SQL: &str = "SELECT SYS_CONTEXT('USERENV','SESSION_USER') AS session_user, SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AS schema_name, SYS_CONTEXT('USERENV','DB_UNIQUE_NAME') AS database_name, SYS_CONTEXT('USERENV','CON_NAME') AS container_name, SYS_CONTEXT('USERENV','CON_ID') AS container_id, SYS_CONTEXT('USERENV','SERVICE_NAME') AS service_name, SYS_CONTEXT('USERENV','SESSIONID') AS session_id, SYS_CONTEXT('USERENV','PROXY_USER') AS proxy_user FROM SYS.DUAL";
/// Only the private installation supplies credentials and certificate/wallet scope.
/// This type grants no admission or dispatch authority.
pub struct ConnectOptions {
    pub user: String,
    pub password: Zeroizing<String>,
    pub address: IpAddr,
    pub port: u16,
    pub service: String,
    pub certificate_dn: String,
    pub wallet_directory: String,
    pub timeout_ms: u64,
}
impl ConnectOptions {
    pub fn descriptor(&self) -> Result<String> {
        static USER: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"\A[A-Za-z][A-Za-z0-9_$#]{0,127}\z").expect("Oracle principal")
        });
        static SERVICE: LazyLock<Regex> =
            LazyLock::new(|| Regex::new(r"\A[A-Za-z0-9_$#.-]{1,128}\z").expect("Oracle service"));
        let wallet = Path::new(&self.wallet_directory);
        let safe = |s: &str| {
            !s.is_empty()
                && !s
                    .chars()
                    .any(|c| c <= '\u{1f}' || c == '\u{7f}' || ['(', ')', '"', '\\'].contains(&c))
        };
        if !USER.is_match(&self.user)
            || !SERVICE.is_match(&self.service)
            || self.password.is_empty()
            || self.password.len() > 4096
            || self.password.contains(['\0', '\r', '\n'])
            || self.port == 0
            || !(1..=30000).contains(&self.timeout_ms)
            || !safe(&self.certificate_dn)
            || self.certificate_dn.len() > 2048
            || !safe(&self.wallet_directory)
            || self.wallet_directory.len() > 4096
            || !wallet.is_absolute()
            || wallet
                .components()
                .any(|c| matches!(c, Component::ParentDir))
        {
            return Err(Unavailable);
        }
        Ok(format!(
            "(DESCRIPTION=(CONNECT_TIMEOUT=5)(TRANSPORT_CONNECT_TIMEOUT=5)(RETRY_COUNT=0)(ADDRESS=(PROTOCOL=TCPS)(HOST={})(PORT={}))(CONNECT_DATA=(SERVICE_NAME={}))(SECURITY=(SSL_SERVER_DN_MATCH=YES)(SSL_SERVER_CERT_DN=\"{}\")(MY_WALLET_DIRECTORY=\"{}\")))",
            self.address, self.port, self.service, self.certificate_dn, self.wallet_directory
        ))
    }
    /// Discovery retains explicit legacy TCP support. Execution callers always
    /// use descriptor(), which still requires TCPS and an exact certificate DN.
    pub fn discovery_descriptor(&self, transport: &str) -> Result<String> {
        let tls = self.descriptor()?;
        match transport {
            "TCPS" => Ok(tls),
            "TCP" => Ok(format!(
                "(DESCRIPTION=(CONNECT_TIMEOUT=5)(TRANSPORT_CONNECT_TIMEOUT=5)(RETRY_COUNT=0)(ADDRESS=(PROTOCOL=TCP)(HOST={})(PORT={}))(CONNECT_DATA=(SERVICE_NAME={})))",
                self.address, self.port, self.service
            )),
            _ => Err(Unavailable),
        }
    }
}
pub struct OciSession {
    connection: Connection,
    id: Uuid,
    timeout_ms: u64,
}
enum Input {
    Text(Option<String>),
    Number(Option<i64>),
}
impl Input {
    fn sql(&self) -> &dyn ToSql {
        match self {
            Self::Text(s) => s,
            Self::Number(n) => n,
        }
    }
}
fn inputs(binds: &[Bind]) -> Result<Vec<Input>> {
    binds
        .iter()
        .map(|b| match &b.value {
            Value::Null => Ok(Input::Text(None)),
            Value::String(s) => Ok(Input::Text(Some(s.clone()))),
            Value::Number(n) => Ok(Input::Number(Some(n.as_i64().ok_or(Unavailable)?))),
            _ => Err(Unavailable),
        })
        .collect()
}

/// Fixed catalog queries expose integers only. Read NUMBER as decimal text so
/// OCI cannot round a fractional value into a trusted integer fact.
fn integer_number(kind: &OracleType, text: Option<String>) -> Result<Value> {
    if !matches!(kind, OracleType::Number(_, 0) | OracleType::Number(0, -127)) {
        return Err(Unavailable);
    }
    let Some(text) = text else {
        return Ok(Value::Null);
    };
    if text.is_empty()
        || text.len() > 20
        || text
            .bytes()
            .enumerate()
            .any(|(i, b)| !b.is_ascii_digit() && !(i == 0 && b == b'-'))
    {
        return Err(Unavailable);
    }
    text.parse::<i64>()
        .map(|n| json!(n))
        .map_err(|_| Unavailable)
}
impl OciSession {
    pub fn connect(options: &ConnectOptions) -> Result<Self> {
        let descriptor = options.descriptor()?;
        Self::connect_descriptor(options, &descriptor)
    }
    pub fn connect_discovery(options: &ConnectOptions, transport: &str) -> Result<Self> {
        let descriptor = options.discovery_descriptor(transport)?;
        Self::connect_descriptor(options, &descriptor)
    }
    fn connect_descriptor(options: &ConnectOptions, descriptor: &str) -> Result<Self> {
        let mut connection =
            Connection::connect(&options.user, options.password.as_str(), descriptor)?;
        connection.set_autocommit(false);
        connection.set_call_timeout(Some(Duration::from_millis(options.timeout_ms)))?;
        connection.set_stmt_cache_size(0)?;
        Ok(Self {
            connection,
            id: Uuid::new_v4(),
            timeout_ms: options.timeout_ms,
        })
    }
}
impl Session for OciSession {
    fn instance(&self) -> Uuid {
        self.id
    }
    fn call_timeout_ms(&self) -> u64 {
        self.timeout_ms
    }
    fn server_version(&mut self) -> Result<String> {
        Ok(self.connection.server_version()?.0.to_string())
    }
    fn query(&mut self, sql: &str, binds: &[Bind], max_rows: usize) -> Result<Vec<Value>> {
        if max_rows == 0
            || max_rows
                > 3 * kelryvo_core::MAX_PLAN_STATEMENTS + 2 * kelryvo_core::MAX_RELEASE_FILES + 1
        {
            return Err(Unavailable);
        }
        let values = inputs(binds)?;
        let params: Vec<_> = binds
            .iter()
            .zip(&values)
            .map(|(b, v)| (b.name.as_str(), v.sql()))
            .collect();
        let mut statement = self
            .connection
            .statement(sql)
            .fetch_array_size(max_rows.min(100) as u32)
            .build()?;
        let results = statement.query_named(&params)?;
        let columns = results.column_info().to_vec();
        let mut rows = Vec::new();
        let mut bytes = 0;
        for row in results {
            if rows.len() >= max_rows {
                return Err(Unavailable);
            }
            let row = row?;
            let mut value = json!({});
            for (index, column) in columns.iter().enumerate() {
                let value_column = match column.oracle_type() {
                    OracleType::Number(_, _) => {
                        integer_number(column.oracle_type(), row.get::<_, Option<String>>(index)?)?
                    }
                    OracleType::Varchar2(_)
                    | OracleType::NVarchar2(_)
                    | OracleType::Char(_)
                    | OracleType::NChar(_)
                    | OracleType::Long => row
                        .get::<_, Option<String>>(index)?
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                    _ => return Err(Unavailable),
                };
                value[column.name().to_ascii_lowercase()] = value_column;
            }
            bytes += value.to_string().len();
            if bytes > 64 * 1024 * 1024 {
                return Err(Unavailable);
            }
            rows.push(value);
        }
        Ok(rows)
    }
    fn execute(&mut self, sql: &str, binds: &[Bind]) -> Result<u64> {
        let values = inputs(binds)?;
        let params: Vec<_> = binds
            .iter()
            .zip(&values)
            .map(|(b, v)| (b.name.as_str(), v.sql()))
            .collect();
        Ok(self.connection.execute_named(sql, &params)?.row_count()?)
    }
    fn commit(&mut self) -> Result<()> {
        Ok(self.connection.commit()?)
    }
    fn rollback(&mut self) -> Result<()> {
        Ok(self.connection.rollback()?)
    }
    fn mutex_call(&mut self, owner: &str, operation: &str, name: &str, nonce: &str) -> Result<i64> {
        if !super::mutex::owner_valid(owner)
            || !["ACQUIRE_LOCK", "CURRENT_LOCK", "RELEASE_LOCK"].contains(&operation)
        {
            return Err(Unavailable);
        }
        let sql =
            format!("BEGIN {owner}.SF_TARGET_MUTEX.{operation}(:lockName,:nonce,:result); END;");
        let statement = self.connection.execute_named(
            &sql,
            &[
                ("lockName", &name),
                ("nonce", &nonce),
                ("result", &OracleType::Number(10, 0)),
            ],
        )?;
        Ok(statement.bind_value("result")?)
    }
}
pub fn set_schema(session: &mut impl Session, owner: &str) -> Result<()> {
    if !bounded(session)
        || owner.is_empty()
        || owner.len() > 128
        || owner.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return Err(Unavailable);
    }
    session.execute(
        &format!(
            "ALTER SESSION SET CURRENT_SCHEMA = \"{}\"",
            owner.replace('"', "\"\"")
        ),
        &[],
    )?;
    Ok(())
}
pub fn statement_scope(session: &mut impl Session, sql: &str, owner: &str) -> Result<bool> {
    if !bounded(session) {
        return Ok(false);
    }
    let assessed = kelryvo_core::schema_scope::assess(sql, owner, false);
    if assessed["eligible"] != true {
        return Ok(false);
    }
    if assessed["existingTable"].is_object() {
        let table = &assessed["existingTable"];
        let rows=session.query("SELECT OBJECT_TYPE FROM SYS.ALL_OBJECTS WHERE OWNER=:owner AND OBJECT_NAME=:name AND SUBOBJECT_NAME IS NULL",&[Bind::new("owner",table["owner"].clone()),Bind::new("name",table["name"].clone())],2)?;
        return Ok(rows.len() == 1 && rows[0]["object_type"] == "TABLE");
    }
    Ok(true)
}
pub fn session_identity(
    session: &mut impl Session,
    owner: &str,
    schema: &str,
    expected: &Value,
) -> Result<Option<Value>> {
    if !bounded(session)
        || session.server_version()? != expected["serverVersionString"].as_str().unwrap_or_default()
    {
        return Ok(None);
    }
    let rows = session.query(IDENTITY_SQL, &[], 2)?;
    if rows.len() != 1 {
        return Ok(None);
    }
    let row = &rows[0];
    let fields = [
        "session_user",
        "schema_name",
        "database_name",
        "container_name",
        "container_id",
        "service_name",
        "session_id",
        "proxy_user",
    ];
    if fields.iter().any(|f| row.get(*f).is_none())
        || row["session_user"] != owner
        || row["schema_name"] != schema
        || !row["proxy_user"].is_null()
        || !row["session_id"].as_str().is_some_and(|s| {
            !s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())
        })
        || row["database_name"] != expected["databaseUniqueName"]
        || row["container_name"] != expected["containerName"]
        || row["container_id"] != expected["containerId"]
        || row["service_name"] != expected["serviceName"]
    {
        return Ok(None);
    }
    Ok(Some(json!(
        fields.iter().map(|f| row[*f].clone()).collect::<Vec<_>>()
    )))
}
/// The caller must already hold verified admission, mutex and per-statement permit.
/// Neither execute nor commit is retried. Any error is an unknown target outcome.
pub fn execute_approved(session: &mut impl Session, bytes: &[u8]) -> Result<()> {
    if !bounded(session) || bytes.is_empty() || bytes.len() > MAX_INPUT_BYTES {
        return Err(Unavailable);
    }
    let sql = std::str::from_utf8(bytes).map_err(|_| Unavailable)?;
    session.execute(sql, &[])?;
    session.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unqualified_number_expression_retains_its_exact_integer_value() {
        // oracle 0.6.3's string_from_sql fixture describes `SELECT 10 FROM DUAL`
        // as NUMBER(0, -127). The discovery SELECT 1 and CASE flags use the same
        // unconstrained expression metadata, rather than NUMBER(p, 0).
        let kind = OracleType::Number(0, -127);
        for n in [0, 1, 10, -1, i64::MIN, i64::MAX] {
            assert_eq!(
                integer_number(&kind, Some(n.to_string())).unwrap(),
                json!(n)
            );
        }
        assert_eq!(integer_number(&kind, None).unwrap(), Value::Null);
    }

    #[test]
    fn numeric_catalog_facts_cannot_be_rounded_or_overflow() {
        for kind in [OracleType::Number(0, -127), OracleType::Number(38, 0)] {
            for invalid in [
                "1.5",
                "0.0001",
                "-0.5",
                "1e2",
                "NaN",
                "Infinity",
                "",
                " 1",
                "+1",
                "-",
                "9223372036854775808",
                "-9223372036854775809",
            ] {
                assert!(integer_number(&kind, Some(invalid.into())).is_err());
            }
        }
        for kind in [
            OracleType::Number(38, 2),
            OracleType::Float(126),
            OracleType::BinaryDouble,
            OracleType::Varchar2(20),
        ] {
            assert!(integer_number(&kind, Some("1".into())).is_err());
            assert!(integer_number(&kind, None).is_err());
        }
    }
}
