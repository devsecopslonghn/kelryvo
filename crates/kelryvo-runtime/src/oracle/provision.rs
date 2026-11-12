//! Trusted operator provisioning. It cannot execute release SQL, clear history,
//! drop accounts, retry an uncertain statement or resume a partial installation.
use super::{Bind, Result, Session, Unavailable, bounded, catalog};
use kelryvo_core::{evidence, schema_scope, sha256};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    net::Ipv4Addr,
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub const IDENTITY_CATALOG: &[&str] = &["V_$CONTAINERS", "V_$DATABASE", "V_$VERSION"];
pub const OBSERVER_CATALOG: &[&str] = &[
    "DBA_CONSTRAINTS",
    "DBA_CONS_COLUMNS",
    "DBA_INDEXES",
    "DBA_IND_COLUMNS",
    "DBA_OBJECTS",
    "DBA_ROLE_PRIVS",
    "DBA_SCHEMA_PRIVS",
    "DBA_SOURCE",
    "DBA_SYS_PRIVS",
    "DBA_TAB_COLUMNS",
    "DBA_TAB_PRIVS",
    "DBA_TRIGGERS",
    "DBA_USERS",
    "V_$CONTAINERS",
    "V_$DATABASE",
    "V_$LOCK",
    "V_$SESSION",
    "V_$VERSION",
    "GV_$SESSION",
];
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Route {
    pub host: String,
    pub port: u16,
    pub service: String,
    pub transport: String,
    #[serde(rename = "pinnedIPs")]
    pub pinned_ips: Vec<Ipv4Addr>,
    #[serde(rename = "serverCertificateDN")]
    pub server_certificate_dn: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Policy {
    pub format: u8,
    pub route: Route,
    pub expected_identity: Value,
    pub schema_owners: Vec<String>,
    pub protected_owners: Vec<String>,
    pub create_schema_owners: Vec<String>,
    pub tablespace: String,
    #[serde(rename = "quotaMiB")]
    pub quota_mib: u16,
    pub expires_at: String,
    pub authorization_id: String,
}
pub fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 30
        && s.bytes()
            .enumerate()
            .all(|(i, b)| b.is_ascii_uppercase() || i > 0 && (b.is_ascii_digit() || b == b'_'))
}
fn owner(s: &str) -> bool {
    identifier(s)
        && schema_scope::is_application_owner(s)
        && !["ADMIN", "ADBSNMP", "ADB_APP_STORE", "DCAT_ADMIN", "GGADMIN"].contains(&s)
}
fn text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn canonical(v: &Value) -> Value {
    match v {
        Value::Array(a) => json!(a.iter().map(canonical).collect::<Vec<_>>()),
        Value::Object(o) => o
            .iter()
            .map(|(k, v)| (k.clone(), canonical(v)))
            .collect::<BTreeMap<_, _>>()
            .into_iter()
            .collect(),
        _ => v.clone(),
    }
}
impl Policy {
    pub fn validate(&self, now_ms: i64) -> Result<()> {
        let r = &self.route;
        let expiry = chrono_time(&self.expires_at).ok_or(Unavailable)?;
        if self.format != 1
            || r.host.is_empty()
            || r.host.len() > 253
            || !r
                .host
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b".-".contains(&b))
            || r.port == 0
            || r.transport != "TCPS"
            || r.service.is_empty()
            || r.service.len() > 128
            || !r
                .service
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
            || r.pinned_ips.is_empty()
            || r.pinned_ips.len() > 16
            || r.pinned_ips.iter().collect::<HashSet<_>>().len() != r.pinned_ips.len()
            || !text(&r.server_certificate_dn, 2048)
            || evidence::exact_identity(&self.expected_identity).as_ref()
                != Some(&self.expected_identity)
            || r.service.to_lowercase()
                != self.expected_identity["serviceName"]
                    .as_str()
                    .unwrap_or_default()
                    .to_lowercase()
            || self.schema_owners.is_empty()
            || self.schema_owners.len() > 50
            || self
                .schema_owners
                .iter()
                .any(|s| !owner(s) || self.protected_owners.contains(s))
            || self.schema_owners.iter().collect::<HashSet<_>>().len() != self.schema_owners.len()
            || self.protected_owners.len() > 500
            || self.protected_owners.iter().any(|s| !text(s, 128))
            || self
                .create_schema_owners
                .iter()
                .any(|s| !self.schema_owners.contains(s))
            || self
                .create_schema_owners
                .iter()
                .collect::<HashSet<_>>()
                .len()
                != self.create_schema_owners.len()
            || !identifier(&self.tablespace)
            || !(1..=1024).contains(&self.quota_mib)
            || expiry <= now_ms
            || expiry > now_ms.saturating_add(90 * 86400000)
            || !text(&self.authorization_id, 128)
            || !self
                .authorization_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        {
            return Err(Unavailable);
        }
        Ok(())
    }
    pub fn digest(&self) -> Result<String> {
        Ok(sha256(
            canonical(&serde_json::to_value(self).map_err(|_| Unavailable)?).to_string(),
        ))
    }
}
fn chrono_time(s: &str) -> Option<i64> {
    let d = chrono::DateTime::parse_from_rfc3339(s).ok()?;
    (d.to_rfc3339_opts(chrono::SecondsFormat::Millis, true) == s).then_some(d.timestamp_millis())
}
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Principals {
    pub writer: String,
    pub ledger_owner: String,
    pub observer: String,
    pub password_files: Value,
}
impl Principals {
    pub fn for_connection(id: Uuid) -> Self {
        let hash = sha256(id.to_string());
        let prefix = format!("KRV_{}", hash[..12].to_uppercase());
        Self {
            writer: format!("{prefix}_W"),
            ledger_owner: format!("{prefix}_L"),
            observer: format!("{prefix}_O"),
            password_files: json!({"writer":"writer-password","ledgerOwner":"ledger-password","observer":"observer-password"}),
        }
    }
    fn names(&self) -> [(&'static str, &str); 3] {
        [
            ("writer", &self.writer),
            ("ledgerOwner", &self.ledger_owner),
            ("observer", &self.observer),
        ]
    }
}
/// Credentials are generated and retained privately by the OS operator before
/// the first DDL. No Debug/Serialize implementation can leak them into a journal.
pub struct Passwords {
    pub writer: Zeroizing<String>,
    pub ledger_owner: Zeroizing<String>,
    pub observer: Zeroizing<String>,
}
impl Passwords {
    fn valid(&self) -> bool {
        [&self.writer, &self.ledger_owner, &self.observer]
            .iter()
            .all(|s| {
                s.starts_with("KrvA1!")
                    && s.len() == 54
                    && s[6..]
                        .bytes()
                        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            })
    }
    fn get(&self, role: &str) -> Result<&str> {
        match role {
            "writer" => Ok(&self.writer),
            "ledgerOwner" => Ok(&self.ledger_owner),
            "observer" => Ok(&self.observer),
            _ => Err(Unavailable),
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub format: u8,
    pub connection_id: Uuid,
    pub metadata_generation_id: Uuid,
    pub policy_digest: String,
    pub status: String,
    pub pending: Option<String>,
    pub completed: Vec<String>,
}
#[derive(Clone, Copy)]
pub enum Purpose {
    Admin,
    Ledger,
}
pub struct Step {
    pub stage: String,
    pub purpose: Purpose,
    pub sql: Zeroizing<String>,
}
fn step(stage: impl Into<String>, purpose: Purpose, sql: impl Into<String>) -> Step {
    Step {
        stage: stage.into(),
        purpose,
        sql: Zeroizing::new(sql.into()),
    }
}
/// Only compiled, repository-owned DDL sources are accepted. This is not a SQL
/// parser and no policy/request can substitute its contents.
pub fn setup_statements() -> Result<Vec<&'static str>> {
    const LEDGER: &str =
        include_str!("../../../../crates/kelryvo-runtime/oracle/target-ledger.sql");
    const MUTEX: &str = include_str!("../../../../crates/kelryvo-runtime/oracle/target-mutex.sql");
    let start = LEDGER
        .find("CREATE OR REPLACE TRIGGER")
        .ok_or(Unavailable)?;
    let mut result = LEDGER[..start]
        .split(';')
        .map(str::trim)
        .filter(|s| s.contains("CREATE TABLE"))
        .collect::<Vec<_>>();
    let trigger = LEDGER[start..]
        .trim()
        .strip_suffix('/')
        .ok_or(Unavailable)?
        .trim();
    let packages = MUTEX
        .split("\n/")
        .map(str::trim)
        .filter(|s| s.contains("CREATE OR REPLACE PACKAGE"))
        .collect::<Vec<_>>();
    if result.len() != 2
        || packages.len() != 2
        || !result[0].contains("CREATE TABLE sf_target_ledger_head")
        || !result[1].contains("CREATE TABLE sf_target_ledger_events")
    {
        return Err(Unavailable);
    }
    result.push(trigger);
    result.extend(packages);
    Ok(result)
}
pub fn grants(policy: &Policy, p: &Principals, now_ms: i64) -> Result<Vec<Step>> {
    policy.validate(now_ms)?;
    let names = p.names();
    if names
        .iter()
        .any(|(_, n)| !owner(n) || policy.schema_owners.iter().any(|s| s == n))
        || names.iter().map(|(_, n)| n).collect::<HashSet<_>>().len() != 3
    {
        return Err(Unavailable);
    }
    let mut steps = names
        .iter()
        .map(|(role, name)| {
            step(
                format!("session:{role}"),
                Purpose::Admin,
                format!("GRANT CREATE SESSION TO {name}"),
            )
        })
        .collect::<Vec<_>>();
    steps.push(step(
        "ledger-setup",
        Purpose::Admin,
        format!(
            "GRANT CREATE TABLE, CREATE PROCEDURE, CREATE TRIGGER TO {}",
            p.ledger_owner
        ),
    ));
    steps.push(step(
        "ledger-lock",
        Purpose::Admin,
        format!("GRANT EXECUTE ON SYS.DBMS_LOCK TO {}", p.ledger_owner),
    ));
    for owner in &policy.schema_owners {
        steps.push(step(format!("writer-schema:{owner}"),Purpose::Admin,format!("GRANT CREATE ANY TABLE, ALTER ANY TABLE, CREATE ANY INDEX, READ ANY TABLE ON SCHEMA {owner} TO {}",p.writer)));
        steps.push(step(
            format!("observer-schema:{owner}"),
            Purpose::Admin,
            format!("GRANT READ ANY TABLE ON SCHEMA {owner} TO {}", p.observer),
        ));
    }
    for (role, name) in names {
        for view in if role == "observer" {
            OBSERVER_CATALOG
        } else {
            IDENTITY_CATALOG
        } {
            steps.push(step(
                format!("catalog:{role}:{view}"),
                Purpose::Admin,
                format!(
                    "GRANT {} ON SYS.{view} TO {name}",
                    if *view == "V_$VERSION" {
                        "READ"
                    } else {
                        "SELECT"
                    }
                ),
            ));
        }
    }
    Ok(steps)
}
fn plan(policy: &Policy, p: &Principals, passwords: &Passwords, now_ms: i64) -> Result<Vec<Step>> {
    if !passwords.valid() {
        return Err(Unavailable);
    }
    let mut steps = Vec::new();
    for owner in &policy.create_schema_owners {
        steps.push(step(
            format!("create-schema:{owner}"),
            Purpose::Admin,
            format!(
                "CREATE USER {owner} NO AUTHENTICATION DEFAULT TABLESPACE {} QUOTA {}M ON {}",
                policy.tablespace, policy.quota_mib, policy.tablespace
            ),
        ));
    }
    for (role, name) in p.names() {
        steps.push(step(
            format!("create-principal:{role}"),
            Purpose::Admin,
            format!(
                "CREATE USER {name} IDENTIFIED BY \"{}\" DEFAULT TABLESPACE {}{}",
                passwords.get(role)?,
                policy.tablespace,
                if role == "ledgerOwner" {
                    format!(" QUOTA {}M ON {}", policy.quota_mib, policy.tablespace)
                } else {
                    String::new()
                }
            ),
        ));
    }
    steps.extend(grants(policy, p, now_ms)?);
    for (n, sql) in setup_statements()?.into_iter().enumerate() {
        steps.push(step(
            format!("install-ledger-object:{n}"),
            Purpose::Ledger,
            sql,
        ));
    }
    steps.push(step(
        "writer-mutex",
        Purpose::Admin,
        format!(
            "GRANT EXECUTE ON {}.SF_TARGET_MUTEX TO {}",
            p.ledger_owner, p.writer
        ),
    ));
    for table in ["SF_TARGET_LEDGER_HEAD", "SF_TARGET_LEDGER_EVENTS"] {
        steps.push(step(
            format!("observer-ledger:{table}"),
            Purpose::Admin,
            format!(
                "GRANT SELECT ON {}.{table} TO {}",
                p.ledger_owner, p.observer
            ),
        ));
    }
    steps.push(step(
        "revoke-ledger-setup",
        Purpose::Admin,
        format!(
            "REVOKE CREATE TABLE, CREATE PROCEDURE, CREATE TRIGGER FROM {}",
            p.ledger_owner
        ),
    ));
    Ok(steps)
}
#[allow(async_fn_in_trait)]
pub trait Ports {
    type Ledger: Session;
    /// Exact ACTIVE metadata generation, unchanged connection and live root policy.
    async fn authority_current(&mut self) -> Result<bool>;
    /// Durable private journal only: never include SQL, passwords or bind values.
    async fn persist(&mut self, journal: &Journal) -> Result<()>;
    /// Open once after the scoped setup grants. Never reconnect or retry it.
    async fn open_ledger(&mut self) -> Result<Self::Ledger>;
}
fn precheck(admin: &mut impl Session, policy: &Policy, p: &Principals) -> Result<()> {
    if !bounded(admin) {
        return Err(Unavailable);
    }
    let dangerous=admin.query("SELECT OWNER,TRIGGER_NAME FROM SYS.DBA_TRIGGERS WHERE BASE_OBJECT_TYPE IN ('DATABASE','SCHEMA') AND OWNER NOT IN ('SYS','SYSTEM') AND REGEXP_LIKE(TRIGGERING_EVENT,'(^| OR )(CREATE|ALTER|DROP)( |$)')",&[],129)?;
    let public=admin.query("SELECT 1 AS N FROM SYS.DBA_TAB_PRIVS WHERE GRANTEE='PUBLIC' AND OWNER='SYS' AND TABLE_NAME='DBMS_LOCK' AND PRIVILEGE='EXECUTE'",&[],2)?;
    if !dangerous.is_empty() || !public.is_empty() {
        return Err(Unavailable);
    }
    for (_, name) in p.names() {
        if !admin
            .query(
                "SELECT USERNAME FROM SYS.DBA_USERS WHERE USERNAME=:name",
                &[Bind::new("name", name)],
                2,
            )?
            .is_empty()
        {
            return Err(Unavailable);
        }
    }
    for owner in &policy.schema_owners {
        let users=admin.query("SELECT USERNAME,AUTHENTICATION_TYPE,ORACLE_MAINTAINED,ACCOUNT_STATUS FROM SYS.DBA_USERS WHERE USERNAME=:name",&[Bind::new("name",owner.clone())],2)?;
        if policy.create_schema_owners.contains(owner) {
            if !users.is_empty() {
                return Err(Unavailable);
            }
        } else if users.len() != 1
            || users[0]["username"] != *owner
            || users[0]["authentication_type"] != "NONE"
            || users[0]["oracle_maintained"] != "N"
            || users[0]["account_status"] != "OPEN"
            || !catalog::empty_target(admin, owner)?
        {
            return Err(Unavailable);
        }
    }
    for view in IDENTITY_CATALOG
        .iter()
        .chain(OBSERVER_CATALOG)
        .copied()
        .chain(["DBMS_LOCK"])
        .collect::<HashSet<_>>()
    {
        let required = if view == "DBMS_LOCK" {
            "EXECUTE"
        } else if view == "V_$VERSION" {
            "READ"
        } else {
            "SELECT"
        };
        let grants=admin.query("SELECT PRIVILEGE,GRANTABLE FROM SYS.DBA_TAB_PRIVS WHERE GRANTEE=SYS_CONTEXT('USERENV','SESSION_USER') AND OWNER='SYS' AND TABLE_NAME=:name",&[Bind::new("name",view)],129)?;
        if !grants
            .iter()
            .any(|g| g["privilege"] == required && g["grantable"] == "YES")
        {
            return Err(Unavailable);
        }
    }
    Ok(())
}
/// Consumes the complete one-use preparation. Every DDL is preceded by a
/// durable pending marker. An ACK/persistence error stops without cleanup DDL.
pub struct Context<'a> {
    pub connection_id: Uuid,
    pub metadata_generation_id: Uuid,
    pub admin_user: &'a str,
    pub server_version: &'a str,
}
pub async fn prepare(
    admin: &mut impl Session,
    ports: &mut impl Ports,
    policy: &Policy,
    context: &Context<'_>,
    passwords: &Passwords,
) -> Result<Journal> {
    let Context {
        connection_id: connection,
        metadata_generation_id: generation,
        admin_user,
        server_version,
    } = *context;
    policy.validate(chrono::Utc::now().timestamp_millis())?;
    let principals = Principals::for_connection(connection);
    let steps = plan(
        policy,
        &principals,
        passwords,
        chrono::Utc::now().timestamp_millis(),
    )?;
    if !server_version.starts_with("23.26.")
        || !ports.authority_current().await?
        || catalog::verify_identity(
            admin,
            &policy.expected_identity,
            server_version,
            admin_user,
            admin_user,
        )?
        .is_none()
    {
        return Err(Unavailable);
    }
    let mut journal = Journal {
        format: 1,
        connection_id: connection,
        metadata_generation_id: generation,
        policy_digest: policy.digest()?,
        status: "CHECKING".into(),
        pending: None,
        completed: Vec::new(),
    };
    ports.persist(&journal).await?;
    precheck(admin, policy, &principals)?;
    let mut ledger = None;
    journal.status = "PREPARING".into();
    ports.persist(&journal).await?;
    for step in steps {
        policy.validate(chrono::Utc::now().timestamp_millis())?;
        if !ports.authority_current().await? {
            return Err(Unavailable);
        }
        journal.pending = Some(step.stage.clone());
        ports.persist(&journal).await?;
        match step.purpose {
            Purpose::Admin => {
                admin.execute(&step.sql, &[])?;
            }
            Purpose::Ledger => {
                if ledger.is_none() {
                    let mut opened = ports.open_ledger().await?;
                    if opened.instance() == admin.instance()
                        || catalog::verify_identity(
                            &mut opened,
                            &policy.expected_identity,
                            server_version,
                            &principals.ledger_owner,
                            &principals.ledger_owner,
                        )?
                        .is_none()
                    {
                        return Err(Unavailable);
                    }
                    ledger = Some(opened);
                }
                ledger
                    .as_mut()
                    .ok_or(Unavailable)?
                    .execute(&step.sql, &[])?;
                if step.stage=="install-ledger-object:4"&&!ledger.as_mut().ok_or(Unavailable)?.query("SELECT NAME,TYPE,TO_CHAR(LINE) AS LINE,TO_CHAR(POSITION) AS POSITION FROM SYS.USER_ERRORS",&[],129)?.is_empty(){return Err(Unavailable)}
            }
        }
        journal.completed.push(step.stage);
        journal.pending = None;
        ports.persist(&journal).await?;
    }
    journal.status = "PROVISIONED_UNVERIFIED".into();
    ports.persist(&journal).await?;
    Ok(journal)
}
