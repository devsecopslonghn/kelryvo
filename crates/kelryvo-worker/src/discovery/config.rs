//! Native read-only installation, independent of writer account provisioning.
use crate::installation::{self, Artifact};
use kelryvo_discovery::{Connection, Request, Result, Unavailable};
use kelryvo_runtime::oracle::driver::{self, ConnectOptions};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashSet,
    net::IpAddr,
    path::{Path, PathBuf},
    time::Duration,
};
use zeroize::Zeroizing;
pub const DIRECTORY: &str = "/run/kelryvo/runtime/discovery";
pub const MANIFEST: &str = "/run/kelryvo/runtime/discovery/discovery.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub format: u8,
    pub driver_profile: String,
    pub read_only: bool,
    pub disposable: bool,
    pub authorization_id: String,
    pub expires_at: chrono::DateTime<chrono::Utc>,
    pub source_commit: String,
    pub client_directory: PathBuf,
    pub wallet_directory: PathBuf,
    pub secret_directory: PathBuf,
    pub artifacts: Vec<Artifact>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_installation_digest: Option<String>,
    pub targets: Vec<Target>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub connection: Connection,
    pub observer_username: String,
    pub secret_file: String,
    pub pinned_ips: Vec<IpAddr>,
    #[serde(rename = "serverCertificateDN")]
    pub certificate_dn: Option<String>,
    pub expected_identity: Option<Value>,
    pub schema_owners: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_acceptance: Option<super::acceptance::Acceptance>,
}
impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = installation::private_file(path, 262144).map_err(|_| Unavailable)?;
        let config: Self = serde_json::from_slice(&raw).map_err(|_| Unavailable)?;
        config.validate()?;
        installation::verify_artifacts(
            &config.artifacts,
            &config.client_directory,
            &config.wallet_directory,
            &config.source_commit,
        )
        .map_err(|_| Unavailable)?;
        Ok(config)
    }
    pub fn validate(&self) -> Result<()> {
        let now = chrono::Utc::now();
        if ![2, 3].contains(&self.format)
            || self.driver_profile != driver::PROFILE
            || !self.read_only
            || !self.disposable
            || self.expires_at <= now
            || self.expires_at > now + chrono::Duration::days(90)
            || self.authorization_id.is_empty()
            || self.authorization_id.len() > 128
            || !self
                .authorization_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
            || self.source_commit.len() != 40
            || !self
                .source_commit
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || self.secret_directory != Path::new(DIRECTORY)
            || self.targets.is_empty()
            || self.targets.len() > 64
        {
            return Err(Unavailable);
        }
        for path in [&self.client_directory, &self.wallet_directory] {
            if path == &self.secret_directory || path.starts_with(&self.secret_directory) {
                return Err(Unavailable);
            }
            installation::no_symlinks(path).map_err(|_| Unavailable)?;
            if !path.is_dir() {
                return Err(Unavailable);
            }
        }
        let mut connections = HashSet::new();
        for target in &self.targets {
            target.connection.validate()?;
            if !connections.insert(target.connection.id)
                || match target.connection.transport.as_str() {
                    "TCPS" => target.certificate_dn.is_none(),
                    "TCP" => target.certificate_dn.is_some(),
                    _ => true,
                }
                || !secret_name(&target.secret_file)
                || !kelryvo_core::schema_scope::is_application_owner(&target.observer_username)
                || ["ADMIN", "ADBSNMP", "GGADMIN"].contains(&target.observer_username.as_str())
                || target.schema_owners.is_empty()
                || target.schema_owners.len() > 500
                || target.schema_owners.iter().any(|s| !clean(s, 128))
                || target.schema_owners.iter().collect::<HashSet<_>>().len()
                    != target.schema_owners.len()
                || target.pinned_ips.is_empty()
                || target.pinned_ips.len() > 16
                || target.pinned_ips.iter().collect::<HashSet<_>>().len() != target.pinned_ips.len()
                || target
                    .expected_identity
                    .as_ref()
                    .is_some_and(|v| kelryvo_core::evidence::exact_identity(v).as_ref() != Some(v))
            {
                return Err(Unavailable);
            }
            target
                .options(
                    self,
                    target.pinned_ips[0],
                    Zeroizing::new("descriptor-validation".into()),
                )?
                .descriptor()
                .map_err(|_| Unavailable)?;
        }
        self.validate_acceptance()
    }
    pub fn authorize(&self, request: &Request) -> Result<&Target> {
        request.validate()?;
        if self.expires_at <= chrono::Utc::now() {
            return Err(Unavailable);
        }
        let selected = self
            .targets
            .iter()
            .find(|t| t.connection.id == request.connection.id)
            .ok_or(Unavailable)?;
        if serde_json::to_value(&selected.connection).map_err(|_| Unavailable)?
            != serde_json::to_value(&request.connection).map_err(|_| Unavailable)?
            || request
                .owner
                .as_ref()
                .is_some_and(|s| !selected.schema_owners.contains(s))
        {
            return Err(Unavailable);
        }
        Ok(selected)
    }
}
fn clean(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn secret_name(s: &str) -> bool {
    s.starts_with("observer-")
        && s.len() <= 128
        && s.len() > 9
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
impl Target {
    pub async fn address(&self) -> Result<IpAddr> {
        let resolved = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::lookup_host((self.connection.host.as_str(), self.connection.port)),
        )
        .await
        .map_err(|_| Unavailable)?
        .map_err(|_| Unavailable)?;
        let actual = resolved.map(|s| s.ip()).collect::<HashSet<_>>();
        let expected = self.pinned_ips.iter().copied().collect::<HashSet<_>>();
        if actual.is_empty() || actual != expected {
            return Err(Unavailable);
        }
        self.pinned_ips.iter().min().copied().ok_or(Unavailable)
    }
    pub fn password(&self, config: &Config) -> Result<Zeroizing<String>> {
        let raw =
            installation::private_file(&config.secret_directory.join(&self.secret_file), 8192)
                .map_err(|_| Unavailable)?;
        let raw = std::str::from_utf8(&raw)
            .map_err(|_| Unavailable)?
            .trim_end_matches(['\r', '\n']);
        if raw.is_empty() || raw.len() > 4096 || raw.contains(['\0', '\r', '\n']) {
            return Err(Unavailable);
        }
        Ok(Zeroizing::new(raw.to_owned()))
    }
    pub fn options(
        &self,
        config: &Config,
        address: IpAddr,
        password: Zeroizing<String>,
    ) -> Result<ConnectOptions> {
        Ok(ConnectOptions {
            user: self.observer_username.clone(),
            password,
            address,
            port: self.connection.port,
            service: self.connection.service.clone(),
            certificate_dn: self
                .certificate_dn
                .clone()
                .unwrap_or_else(|| "CN=unused-for-explicit-TCP-discovery".into()),
            wallet_directory: config.wallet_directory.to_str().ok_or(Unavailable)?.into(),
            timeout_ms: 2000,
        })
    }
}
