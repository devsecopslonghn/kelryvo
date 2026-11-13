use std::{
    env,
    fs::{self, OpenOptions},
    io::Read,
    net::{IpAddr, SocketAddr},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

#[derive(Clone, Copy, Debug)]
pub struct ConfigurationUnavailable;

pub struct Config {
    pub address: SocketAddr,
    pub database_url: String,
    pub web_root: PathBuf,
    pub repositories: Vec<crate::repositories::Repository>,
    pub identity: Option<crate::identity::runtime::Runtime>,
    pub tls: Option<(Vec<u8>, Vec<u8>)>,
    pub vault_public_key: Option<kelryvo_vault::VaultPublicKey>,
}

pub fn process_uid() -> Result<i32, ConfigurationUnavailable> {
    i32::try_from(
        fs::metadata("/proc/self")
            .map_err(|_| ConfigurationUnavailable)?
            .uid(),
    )
    .map_err(|_| ConfigurationUnavailable)
}

fn read_config_file(
    root: &Path,
    name: &str,
    limit: u64,
    private: bool,
) -> Result<Vec<u8>, ConfigurationUnavailable> {
    if !root.is_absolute()
        || name.is_empty()
        || !name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    {
        return Err(ConfigurationUnavailable);
    }
    let directory = fs::canonicalize(root).map_err(|_| ConfigurationUnavailable)?;
    let metadata = fs::symlink_metadata(&directory).map_err(|_| ConfigurationUnavailable)?;
    if !metadata.is_dir() || metadata.mode() & 0o022 != 0 {
        return Err(ConfigurationUnavailable);
    }
    let file = if private {
        directory.join(name)
    } else {
        fs::canonicalize(directory.join(name)).map_err(|_| ConfigurationUnavailable)?
    };
    if !file.starts_with(&directory) || file == directory {
        return Err(ConfigurationUnavailable);
    }
    // The final open refuses a replaced symlink. Check the opened descriptor.
    let handle = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(file)
        .map_err(|_| ConfigurationUnavailable)?;
    let metadata = handle.metadata().map_err(|_| ConfigurationUnavailable)?;
    let own_uid = fs::metadata("/proc/self")
        .map_err(|_| ConfigurationUnavailable)?
        .uid();
    if !metadata.is_file()
        || ![0, own_uid].contains(&metadata.uid())
        || metadata.mode() & (if private { 0o077 } else { 0o022 }) != 0
        || metadata.nlink() != 1
        || metadata.len() == 0
        || metadata.len() > limit
    {
        return Err(ConfigurationUnavailable);
    }
    let mut bytes = Vec::new();
    handle
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ConfigurationUnavailable)?;
    if bytes.len() as u64 > limit {
        return Err(ConfigurationUnavailable);
    }
    Ok(bytes)
}

pub fn read_secret(
    root: &Path,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>, ConfigurationUnavailable> {
    read_config_file(root, name, limit, false)
}
pub fn read_private_secret(
    root: &Path,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>, ConfigurationUnavailable> {
    read_config_file(root, name, limit, true)
}

impl Config {
    pub async fn load() -> Result<Self, ConfigurationUnavailable> {
        let secret_root = PathBuf::from(
            env::var("KELRYVO_SECRET_DIR").unwrap_or_else(|_| "/run/kelryvo/secrets".into()),
        );
        let database_url = String::from_utf8(read_secret(&secret_root, "database-url", 16384)?)
            .map_err(|_| ConfigurationUnavailable)?
            .trim()
            .to_owned();
        if database_url.bytes().any(|b| b <= 0x20 || b == 0x7f)
            || !(database_url.starts_with("postgres://")
                || database_url.starts_with("postgresql://"))
        {
            return Err(ConfigurationUnavailable);
        }
        let host: IpAddr = env::var("KELRYVO_BIND_HOST")
            .unwrap_or_else(|_| "127.0.0.1".into())
            .parse()
            .map_err(|_| ConfigurationUnavailable)?;
        let port: u16 = env::var("KELRYVO_PORT")
            .unwrap_or_else(|_| "4317".into())
            .parse()
            .map_err(|_| ConfigurationUnavailable)?;
        if port == 0 {
            return Err(ConfigurationUnavailable);
        }
        let cert_exists = secret_root
            .join("tls.crt")
            .try_exists()
            .map_err(|_| ConfigurationUnavailable)?;
        let key_exists = secret_root
            .join("tls.key")
            .try_exists()
            .map_err(|_| ConfigurationUnavailable)?;
        if cert_exists != key_exists {
            return Err(ConfigurationUnavailable);
        }
        let tls = if cert_exists {
            Some((
                read_secret(&secret_root, "tls.crt", 131072)?,
                read_secret(&secret_root, "tls.key", 131072)?,
            ))
        } else {
            None
        };
        if !host.is_loopback() && tls.is_none() {
            return Err(ConfigurationUnavailable);
        }
        let vault_public_key = if secret_root
            .join("oracle-vault-public.pem")
            .try_exists()
            .map_err(|_| ConfigurationUnavailable)?
        {
            Some(
                kelryvo_vault::VaultPublicKey::parse(&read_secret(
                    &secret_root,
                    "oracle-vault-public.pem",
                    16384,
                )?)
                .map_err(|_| ConfigurationUnavailable)?,
            )
        } else {
            None
        };
        let repositories = if secret_root
            .join("repositories.json")
            .try_exists()
            .map_err(|_| ConfigurationUnavailable)?
        {
            let bytes = read_secret(&secret_root, "repositories.json", 65536)?;
            let v: serde_json::Value =
                serde_json::from_slice(&bytes).map_err(|_| ConfigurationUnavailable)?;
            if process_uid()? == 10001 || v.is_object() {
                crate::repositories::container(&bytes, Path::new("/run/kelryvo/repositories"))
                    .await?
            } else {
                crate::repositories::parse(&bytes)?
            }
        } else {
            Vec::new()
        };
        let identity = if secret_root
            .join("identity-runtime.json")
            .try_exists()
            .map_err(|_| ConfigurationUnavailable)?
        {
            Some(crate::identity::runtime::Runtime::parse(
                &zeroize::Zeroizing::new(read_private_secret(
                    &secret_root,
                    "identity-runtime.json",
                    131072,
                )?),
            )?)
        } else {
            None
        };
        Ok(Self {
            address: SocketAddr::new(host, port),
            database_url,
            web_root: env::var_os("KELRYVO_WEB_DIRECTORY")
                .map(PathBuf::from)
                .unwrap_or_else(|| "dist/rust-web".into()),
            tls,
            vault_public_key,
            repositories,
            identity,
        })
    }
}
