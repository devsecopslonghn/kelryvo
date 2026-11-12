//! Private native installation inputs. They are staged by the OS operator,
//! never accepted from an HTTP body, job payload or worker control message.
use crate::admission::{Result, Unavailable};
use kelryvo_core::{evidence, sha256};
use kelryvo_runtime::oracle::driver;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, OpenOptions},
    io::Read,
    net::IpAddr,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub fn uid() -> Result<u32> {
    fs::metadata("/proc/self")
        .map(|m| m.uid())
        .map_err(|_| Unavailable)
}
fn trusted_owner(owner: u32, user: u32) -> bool {
    owner == 0 || owner == user || user == 0 && owner == 10002
}
pub fn no_symlinks(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        return Err(Unavailable);
    }
    let user = uid()?;
    let mut cursor = PathBuf::new();
    for part in path.components() {
        match part {
            Component::RootDir => cursor.push("/"),
            Component::Normal(p) => cursor.push(p),
            _ => return Err(Unavailable),
        }
        let stat = fs::symlink_metadata(&cursor).map_err(|_| Unavailable)?;
        if stat.is_symlink()
            || stat.is_dir() && (!trusted_owner(stat.uid(), user) || stat.mode() & 0o022 != 0)
        {
            return Err(Unavailable);
        }
    }
    Ok(())
}
pub fn private_file(path: &Path, max: u64) -> Result<Zeroizing<Vec<u8>>> {
    no_symlinks(path)?;
    let parent = fs::metadata(path.parent().ok_or(Unavailable)?).map_err(|_| Unavailable)?;
    let user = uid()?;
    if !parent.is_dir() || !trusted_owner(parent.uid(), user) || parent.mode() & 0o777 != 0o700 {
        return Err(Unavailable);
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| Unavailable)?;
    let stat = file.metadata().map_err(|_| Unavailable)?;
    if !stat.is_file()
        || !trusted_owner(stat.uid(), user)
        || stat.nlink() != 1
        || stat.mode() & 0o777 != 0o600
        || stat.len() == 0
        || stat.len() > max
    {
        return Err(Unavailable);
    }
    let mut bytes = Zeroizing::new(Vec::new());
    file.by_ref()
        .take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Unavailable)?;
    if bytes.len() as u64 > max {
        return Err(Unavailable);
    }
    Ok(bytes)
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
pub fn canonical_digest(v: &Value) -> String {
    sha256(canonical(v).to_string())
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Route {
    pub host: String,
    pub port: u16,
    pub service: String,
    #[serde(rename = "pinnedIPs")]
    pub pinned_ips: Vec<IpAddr>,
    #[serde(rename = "serverCertificateDN")]
    pub server_certificate_dn: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Principals {
    pub writer: String,
    pub ledger_owner: String,
    pub observer: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub user: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Artifact {
    pub path: PathBuf,
    pub sha256: String,
    pub kind: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Review {
    pub identity: String,
    pub authorization_id: String,
    pub expires_at: String,
    pub digest: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub format: u8,
    pub driver_profile: String,
    pub authorization_id: String,
    pub installation_digest: String,
    pub metadata_generation_id: Uuid,
    pub worker_id: String,
    pub expires_at: String,
    pub lease_seconds: u32,
    pub call_timeout_ms: u64,
    pub route_id: Uuid,
    pub connection_id: Uuid,
    pub connection_revision: String,
    pub master_username: String,
    pub master_credential_ref: String,
    pub source_commit: String,
    pub app_image_digest: String,
    pub metadata_database: Metadata,
    pub identity: Value,
    pub driver_server_version_string: String,
    pub route: Route,
    pub principals: Principals,
    pub reader_schemas: Vec<String>,
    pub protected_owners: Vec<String>,
    pub target_schemas: BTreeMap<String, Value>,
    pub mutex_package_source_digest: String,
    pub ledger_immutable_trigger_source_digest: String,
    pub secret_directory: PathBuf,
    pub witness_directory: PathBuf,
    pub client_directory: PathBuf,
    pub wallet_directory: PathBuf,
    pub artifacts: Vec<Artifact>,
    pub review: Review,
}
fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn text(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn tag(s: &str, max: usize) -> bool {
    text(s, max)
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
}
fn owner(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 30
        && s.bytes()
            .enumerate()
            .all(|(i, b)| b.is_ascii_uppercase() || i > 0 && (b.is_ascii_digit() || b == b'_'))
        && kelryvo_core::schema_scope::is_application_owner(s)
        && ![
            "ADMIN",
            "ADBSNMP",
            "ADB_APP_STORE",
            "DCAT_ADMIN",
            "GGADMIN",
            "RMAN$CATALOG",
            "RMAN$VPC",
        ]
        .contains(&s)
}
impl Config {
    pub(crate) fn reseal(&mut self) -> Result<()> {
        let mut value = serde_json::to_value(&*self).map_err(|_| Unavailable)?;
        value
            .as_object_mut()
            .ok_or(Unavailable)?
            .remove("installationDigest");
        self.installation_digest = canonical_digest(&value);
        Ok(())
    }
    pub fn load(path: &Path) -> Result<Self> {
        let bytes = private_file(path, 262144)?;
        let c: Self = serde_json::from_slice(&bytes).map_err(|_| Unavailable)?;
        c.validate()?;
        c.verify_artifacts()?;
        Ok(c)
    }
    pub fn expires(&self) -> Result<chrono::DateTime<chrono::Utc>> {
        chrono::DateTime::parse_from_rfc3339(&self.expires_at)
            .map(|d| d.with_timezone(&chrono::Utc))
            .map_err(|_| Unavailable)
    }
    pub fn validate(&self) -> Result<()> {
        let now = chrono::Utc::now();
        let expiry = self.expires()?;
        let p = &self.principals;
        let names = [
            p.writer.as_str(),
            p.ledger_owner.as_str(),
            p.observer.as_str(),
        ];
        if self.format != 1
            || self.driver_profile != driver::PROFILE
            || !tag(&self.authorization_id, 128)
            || !tag(&self.worker_id, 100)
            || expiry <= now
            || expiry > now + chrono::Duration::days(90)
            || !(1..=300).contains(&self.lease_seconds)
            || !(1000..=30000).contains(&self.call_timeout_ms)
            || self.expires_at != expiry.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            || !self.connection_revision.bytes().all(|b| b.is_ascii_digit())
            || self.connection_revision.starts_with('0')
            || self.connection_revision.len() > 19
            || self.connection_revision.is_empty()
            || self.source_commit.len() != 40
            || !self
                .source_commit
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || !self
                .app_image_digest
                .strip_prefix("sha256:")
                .is_some_and(digest)
            || !text(&self.driver_server_version_string, 128)
            || !self
                .driver_server_version_string
                .strip_prefix("23.26.")
                .is_some_and(|s| {
                    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit() || b == b'.')
                })
            || evidence::exact_identity(&self.identity).as_ref() != Some(&self.identity)
            || names.iter().any(|n| !owner(n))
            || names.iter().collect::<HashSet<_>>().len() != 3
            || self.reader_schemas.is_empty()
            || self.reader_schemas.len() > 50
            || self.reader_schemas.iter().any(|s| {
                !owner(s) || names.contains(&s.as_str()) || self.protected_owners.contains(s)
            })
            || self.reader_schemas.iter().collect::<HashSet<_>>().len() != self.reader_schemas.len()
            || self.protected_owners.len() > 500
            || self.protected_owners.iter().any(|s| !text(s, 128))
            || self.target_schemas.keys().collect::<HashSet<_>>()
                != self.reader_schemas.iter().collect::<HashSet<_>>()
            || self.target_schemas.values().any(|v| {
                v.as_object().is_none_or(|o| o.len() != 1)
                    || v["schemaPrivileges"].as_array().is_none_or(|a| {
                        a.len() != 3
                            || a.iter().filter_map(Value::as_str).collect::<HashSet<_>>()
                                != HashSet::from(["ALTER TABLE", "CREATE INDEX", "CREATE TABLE"])
                    })
            })
            || !digest(&self.mutex_package_source_digest)
            || !digest(&self.ledger_immutable_trigger_source_digest)
            || self.route.port == 0
            || !text(&self.route.host, 253)
            || self.route.host != self.route.host.to_lowercase()
            || !self
                .route
                .host
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b".-".contains(&b))
            || self.route.service.to_lowercase()
                != self.identity["serviceName"]
                    .as_str()
                    .unwrap_or_default()
                    .to_lowercase()
            || self.route.pinned_ips.is_empty()
            || self.route.pinned_ips.len() > 16
            || self.route.pinned_ips.iter().collect::<HashSet<_>>().len()
                != self.route.pinned_ips.len()
            || self.metadata_database.port == 0
            || !text(&self.metadata_database.host, 253)
            || !tag(&self.metadata_database.database, 63)
            || !tag(&self.metadata_database.user, 63)
            || !text(&self.master_username, 128)
            || self
                .master_credential_ref
                .strip_prefix("vault://kelryvo/")
                .and_then(|s| s.parse::<Uuid>().ok())
                .is_none()
            || !digest(&self.installation_digest)
            || self.review.identity != "uid:0"
            || self.review.authorization_id != self.authorization_id
            || self.review.expires_at != self.expires_at
        {
            return Err(Unavailable);
        }
        let mut unsigned = serde_json::to_value(self).map_err(|_| Unavailable)?;
        unsigned
            .as_object_mut()
            .ok_or(Unavailable)?
            .remove("installationDigest");
        let mut review = serde_json::to_value(&self.review).map_err(|_| Unavailable)?;
        review.as_object_mut().ok_or(Unavailable)?.remove("digest");
        if canonical_digest(&unsigned) != self.installation_digest
            || canonical_digest(&review) != self.review.digest
        {
            return Err(Unavailable);
        }
        for path in [
            &self.secret_directory,
            &self.witness_directory,
            &self.client_directory,
            &self.wallet_directory,
        ] {
            no_symlinks(path)?;
        }
        let options = driver::ConnectOptions {
            user: p.writer.clone(),
            password: Zeroizing::new("validation-only".into()),
            address: self.route.pinned_ips[0],
            port: self.route.port,
            service: self.route.service.clone(),
            certificate_dn: self.route.server_certificate_dn.clone(),
            wallet_directory: self.wallet_directory.to_str().ok_or(Unavailable)?.into(),
            timeout_ms: self.call_timeout_ms,
        };
        options.descriptor()?;
        Ok(())
    }
    pub fn verify_artifacts(&self) -> Result<()> {
        verify_artifacts(
            &self.artifacts,
            &self.client_directory,
            &self.wallet_directory,
            &self.source_commit,
        )
    }
    pub fn database_url(&self) -> Result<Zeroizing<String>> {
        self.database_url_from(&self.secret_directory)
    }
    pub(crate) fn database_url_from(&self, directory: &Path) -> Result<Zeroizing<String>> {
        let bytes = private_file(&directory.join("database-url"), 16384)?;
        let text = std::str::from_utf8(&bytes).map_err(|_| Unavailable)?.trim();
        let url = url::Url::parse(text).map_err(|_| Unavailable)?;
        if !["postgres", "postgresql"].contains(&url.scheme())
            || url.host_str() != Some(&self.metadata_database.host)
            || url.port().unwrap_or(5432) != self.metadata_database.port
            || url.path() != format!("/{}", self.metadata_database.database)
            || url.username() != self.metadata_database.user
            || text.chars().any(|c| c <= '\u{20}' || c == '\u{7f}')
        {
            return Err(Unavailable);
        }
        if url.query_pairs().any(|(k, _)| {
            [
                "host",
                "hostaddr",
                "port",
                "user",
                "dbname",
                "service",
                "servicefile",
            ]
            .contains(&k.as_ref())
        }) {
            return Err(Unavailable);
        }
        Ok(Zeroizing::new(text.into()))
    }
    pub fn descriptor(&self) -> Value {
        json!({"sqlProfile":"ORACLE26_NUMBER_VARCHAR2_BYTE_V1","format":1,"connectionId":self.connection_id,"connectionRevision":self.connection_revision,"metadataGenerationId":self.metadata_generation_id,"sourceSha":self.source_commit,"imageDigest":self.app_image_digest,"installationDigest":self.installation_digest,"identity":self.identity,"writerUsername":self.principals.writer,"writerCredentialRef":format!("secret://kelryvo-runtime/{}/writer",self.connection_id),"schemaOwners":self.reader_schemas,"protectedOwners":self.protected_owners,"expiresAt":self.expires_at,"operatorOsUid":0})
    }
    pub fn public_record(&self) -> Value {
        json!({"format":2,"driverProfile":driver::PROFILE,"workerArtifactDigest":self.artifacts.iter().find(|a|a.kind=="WORKER").map(|a|&a.sha256),"descriptor":self.descriptor()})
    }
    pub async fn pinned_address(&self) -> Result<IpAddr> {
        let resolved = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            tokio::net::lookup_host((self.route.host.as_str(), self.route.port)),
        )
        .await
        .map_err(|_| Unavailable)?
        .map_err(|_| Unavailable)?;
        let actual = resolved.map(|a| a.ip()).collect::<HashSet<_>>();
        let expected = self
            .route
            .pinned_ips
            .iter()
            .copied()
            .collect::<HashSet<_>>();
        if actual != expected || actual.is_empty() {
            return Err(Unavailable);
        }
        Ok(*self.route.pinned_ips.iter().min().ok_or(Unavailable)?)
    }
}

/// Shared immutable native client/wallet/worker/source provenance. Discovery
/// qualifies its own reviewed bundle without requiring writer provisioning.
pub(crate) fn verify_artifacts(
    artifacts: &[Artifact],
    client_directory: &Path,
    wallet_directory: &Path,
    source_commit: &str,
) -> Result<()> {
    if !kelryvo_core::build_identity::matches_source(source_commit) {
        return Err(Unavailable);
    }
    if artifacts.is_empty() || artifacts.len() > 256 {
        return Err(Unavailable);
    }
    let binary = fs::canonicalize(std::env::current_exe().map_err(|_| Unavailable)?)
        .map_err(|_| Unavailable)?;
    let mut paths = HashSet::new();
    let mut worker = false;
    let mut client = false;
    let mut wallet = false;
    let mut source_identity = false;
    for a in artifacts {
        if !digest(&a.sha256)
            || !paths.insert(&a.path)
            || !matches!(
                a.kind.as_str(),
                "WORKER" | "OCI_LIBRARY" | "WALLET" | "SOURCE_IDENTITY"
            )
        {
            return Err(Unavailable);
        }
        no_symlinks(&a.path)?;
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&a.path)
            .map_err(|_| Unavailable)?;
        let stat = file.metadata().map_err(|_| Unavailable)?;
        if !stat.is_file()
            || stat.nlink() != 1
            || stat.mode() & 0o022 != 0
            || !trusted_owner(stat.uid(), uid()?)
            || stat.len() == 0
            || stat.len() > 1024 * 1024 * 1024
        {
            return Err(Unavailable);
        }
        let mut hash = Sha256::new();
        let mut buffer = [0_u8; 65536];
        let mut total = 0_u64;
        loop {
            let read = file.read(&mut buffer).map_err(|_| Unavailable)?;
            if read == 0 {
                break;
            }
            total += read as u64;
            if total > 1024 * 1024 * 1024 {
                return Err(Unavailable);
            }
            hash.update(&buffer[..read]);
        }
        if format!("{:x}", hash.finalize()) != a.sha256 {
            return Err(Unavailable);
        }
        match a.kind.as_str() {
            "WORKER" => {
                if worker || a.path != binary {
                    return Err(Unavailable);
                }
                worker = true
            }
            "OCI_LIBRARY" => {
                if !a.path.starts_with(client_directory) {
                    return Err(Unavailable);
                }
                client = true
            }
            "WALLET" => {
                if !a.path.starts_with(wallet_directory) {
                    return Err(Unavailable);
                }
                wallet = true
            }
            "SOURCE_IDENTITY" => {
                if source_identity || stat.len() > 65536 {
                    return Err(Unavailable);
                }
                let raw = fs::read(&a.path).map_err(|_| Unavailable)?;
                let identity: Value = serde_json::from_slice(&raw).map_err(|_| Unavailable)?;
                if identity["sourceSha"] != source_commit {
                    return Err(Unavailable);
                }
                if kelryvo_core::build_identity::SOURCE_SHA != "local-unpublished"
                    && kelryvo_core::build_identity::SOURCE_TREE_DIGEST
                        .is_some_and(|digest| identity["sourceTreeDigest"] != digest)
                {
                    return Err(Unavailable);
                }
                source_identity = true;
            }
            _ => return Err(Unavailable),
        }
    }
    if !worker || !client || !wallet || !source_identity {
        return Err(Unavailable);
    }
    for (directory, kind) in [
        (client_directory, "OCI_LIBRARY"),
        (wallet_directory, "WALLET"),
    ] {
        for entry in fs::read_dir(directory).map_err(|_| Unavailable)? {
            let entry = entry.map_err(|_| Unavailable)?;
            let path = entry.path();
            if !entry.file_type().map_err(|_| Unavailable)?.is_file()
                || !artifacts.iter().any(|a| a.kind == kind && a.path == path)
            {
                return Err(Unavailable);
            }
        }
    }
    Ok(())
}
