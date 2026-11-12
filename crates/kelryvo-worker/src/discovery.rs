//! Private read-only bridge. Native Oracle collection is installed separately;
//! a disabled adapter returns unavailable and never loads a driver or secret.
use crate::installation;
mod acceptance;
pub(crate) use acceptance::Review as AcceptanceReview;
mod config;
mod process;
pub use config::{Config, DIRECTORY, MANIFEST};
use kelryvo_discovery::{Handler, HandlerResult, Limits, Request, Result, Unavailable};
use std::{
    fs,
    os::unix::fs::{FileTypeExt, MetadataExt, PermissionsExt},
    path::Path,
    sync::Arc,
};
use tokio::sync::watch;
struct Native;
impl Handler for Native {
    fn run(&self, request: Request, stopped: watch::Receiver<bool>) -> HandlerResult {
        Box::pin(async move {
            let config = match Config::load(Path::new(MANIFEST)) {
                Ok(config) => config,
                Err(_) => return Ok(kelryvo_discovery::unavailable()),
            };
            if config.authorize(&request).is_err() {
                return Ok(
                    serde_json::json!({"status":"UNAUTHORIZED","provenance":"UNAVAILABLE","limitations":["ENDPOINT_NOT_AUTHORIZED"]}),
                );
            }
            let deadline = if request.operation == kelryvo_discovery::Operation::Schema {
                30
            } else {
                8
            };
            let program = std::env::current_exe().map_err(|_| Unavailable)?;
            process::run(
                &program,
                &["discovery-child"],
                request,
                stopped,
                std::time::Duration::from_secs(deadline),
            )
            .await
        })
    }
}
struct Disabled;
impl Handler for Disabled {
    fn run(&self, _: Request, _: watch::Receiver<bool>) -> HandlerResult {
        Box::pin(async { Ok(kelryvo_discovery::unavailable()) })
    }
}
pub async fn serve(enabled: bool, stopped: watch::Receiver<bool>) -> Result<()> {
    if installation::uid().map_err(|_| Unavailable)? != 10002 {
        return Err(Unavailable);
    }
    // Initial installation/refresh is asynchronous. Each request revalidates the
    // complete native configuration before opening a child or reading a secret.
    let path = Path::new(kelryvo_discovery::SOCKET);
    let parent = path.parent().ok_or(Unavailable)?;
    installation::no_symlinks(parent).map_err(|_| Unavailable)?;
    let directory = fs::symlink_metadata(parent).map_err(|_| Unavailable)?;
    if !directory.is_dir() || directory.uid() != 10002 || directory.mode() & 0o777 != 0o711 {
        return Err(Unavailable);
    }
    // Never unlink an existing listener or follow a replacement symlink. Only
    // the root startup stage cleans this fixed socket before launching roles.
    let listener = tokio::net::UnixListener::bind(path).map_err(|_| Unavailable)?;
    let socket = fs::symlink_metadata(path).map_err(|_| Unavailable)?;
    if !socket.file_type().is_socket() || socket.uid() != 10002 {
        return Err(Unavailable);
    }
    // SO_PEERCRED restricts admission to API UID 10001; directory write access
    // remains exclusive to the worker. The API cannot replace this socket.
    fs::set_permissions(path, fs::Permissions::from_mode(0o666)).map_err(|_| Unavailable)?;
    kelryvo_discovery::serve(
        listener,
        10001,
        if enabled {
            Arc::new(Native)
        } else {
            Arc::new(Disabled)
        },
        stopped,
        Limits::default(),
    )
    .await
}
/// One credential-free request on stdin. Only this private child loads OCI or
/// reads the fixed observer secret. The parent owns the process deadline.
pub async fn child() -> Result<()> {
    use std::io::{IsTerminal, Read, Write};
    if installation::uid().map_err(|_| Unavailable)? != 10002
        || std::io::stdin().is_terminal()
        || std::io::stdout().is_terminal()
    {
        return Err(Unavailable);
    }
    let mut bytes = Vec::new();
    std::io::stdin()
        .take(kelryvo_discovery::REQUEST_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Unavailable)?;
    if bytes.len() > kelryvo_discovery::REQUEST_BYTES {
        return Err(Unavailable);
    }
    let request: Request = serde_json::from_slice(&bytes).map_err(|_| Unavailable)?;
    request.validate()?;
    let raw = collect(&request)
        .await
        .unwrap_or_else(|_| kelryvo_discovery::unavailable());
    let response = kelryvo_discovery::Response::new(&request, raw);
    let bytes = serde_json::to_vec(&response).map_err(|_| Unavailable)?;
    if bytes.len() > kelryvo_discovery::RESPONSE_BYTES {
        return Err(Unavailable);
    }
    let mut out = std::io::stdout().lock();
    out.write_all(&bytes).map_err(|_| Unavailable)?;
    out.flush().map_err(|_| Unavailable)
}
async fn collect(request: &Request) -> Result<serde_json::Value> {
    use kelryvo_runtime::oracle::{
        Session,
        discovery::{self, Provenance},
        driver::{self, OciSession},
    };
    let config = Config::load(Path::new(MANIFEST))?;
    let target = config.authorize(request)?;
    let address = target.address().await?;
    let password = target.password(&config)?;
    driver::initialize_client(&config.client_directory, &config.wallet_directory)
        .map_err(|_| Unavailable)?;
    let mut session = OciSession::connect_discovery(
        &target.options(&config, address, password)?,
        &target.connection.transport,
    )
    .map_err(|_| Unavailable)?;
    crate::managed::loaded_artifacts_match(&config.artifacts).map_err(|_| Unavailable)?;
    let identity = session
        .query(driver::IDENTITY_SQL, &[], 2)
        .map_err(|_| Unavailable)?;
    if identity.len() != 1
        || identity[0]["session_user"] != target.observer_username
        || !identity[0]["proxy_user"].is_null()
    {
        return Err(Unavailable);
    }
    if config.expires_at <= chrono::Utc::now() {
        return Err(Unavailable);
    }
    let result = discovery::observe(
        &mut session,
        request.operation,
        request.owner.as_deref(),
        target.expected_identity.as_ref(),
        Provenance::OracleReadOnly,
    )
    .map_err(|_| Unavailable)?;
    // Publication, expiry or reviewed artifacts changing during I/O veto the
    // result. Reloading cannot turn the old session into new native evidence.
    let current = Config::load(Path::new(MANIFEST))?;
    if serde_json::to_value(&config).map_err(|_| Unavailable)?
        != serde_json::to_value(&current).map_err(|_| Unavailable)?
    {
        return Err(Unavailable);
    }
    let target = current.authorize(request)?;
    crate::managed::loaded_artifacts_match(&current.artifacts).map_err(|_| Unavailable)?;
    current.project_acceptance(target, request.operation, result)
}

#[cfg(test)]
mod tests;
