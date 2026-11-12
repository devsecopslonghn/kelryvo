//! A reviewed client directory must reach glibc before OCI dependencies load.
//! Selection is read-only and precedes stdin, checkpoints, locks and metadata I/O.
use crate::{
    admission::{Result, Unavailable},
    discovery, installation, operator, preparation, publication,
};
use std::{
    collections::BTreeMap,
    ffi::OsString,
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::Command,
};

/// Not deserializable or caller-constructible: only validated private inputs
/// select this path. No job, IPC request or inherited loader variable can do so.
pub struct ClientDirectory(PathBuf);

fn environment(directory: &Path) -> Result<BTreeMap<OsString, OsString>> {
    let value = directory.to_str().ok_or(Unavailable)?;
    if !directory.is_absolute()
        || directory.parent().is_none()
        || value.len() > 4096
        || value
            .chars()
            .any(|c| c <= '\u{1f}' || c == '\u{7f}' || ":;$".contains(c))
    {
        return Err(Unavailable);
    }
    Ok(BTreeMap::from([
        ("PATH".into(), "/usr/bin:/bin".into()),
        ("LANG".into(), "C.UTF-8".into()),
        ("TZ".into(), "UTC".into()),
        ("LD_LIBRARY_PATH".into(), value.into()),
        ("KELRYVO_ORACLE_CLIENT_BOOTSTRAP".into(), "1".into()),
    ]))
}

impl ClientDirectory {
    /// Replace this still-unused command in place, retaining its PID and stdio.
    /// The fresh process reloads and revalidates all inputs before doing work.
    /// Equality with the entire environment bounds replacement to one pass and
    /// also removes inherited debug/preload variables and credential selectors.
    pub fn enter(self) -> Result<()> {
        let expected = environment(&self.0)?;
        let actual = std::env::vars_os().collect::<Vec<_>>();
        if std::env::var_os("KELRYVO_ORACLE_CLIENT_BOOTSTRAP").is_some() {
            return if actual.len() == expected.len()
                && actual.into_iter().collect::<BTreeMap<_, _>>() == expected
            {
                Ok(())
            } else {
                Err(Unavailable)
            };
        }
        let program = std::env::current_exe().map_err(|_| Unavailable)?;
        let _error = Command::new(program)
            .args(std::env::args_os().skip(1))
            .env_clear()
            .envs(expected)
            .exec();
        Err(Unavailable)
    }
}

/// The binary additionally checks worker/generation/secret scope in worker.json
/// before calling this selector. The private installation rechecks every artifact.
pub fn execution(path: &Path) -> Result<ClientDirectory> {
    if installation::uid()? != 10002 {
        return Err(Unavailable);
    }
    Ok(ClientDirectory(
        installation::Config::load(path)?.client_directory,
    ))
}

/// Commands that do not load OCI, including waiting services and expiry recovery,
/// deliberately require no client and never enter a loader environment.
pub fn command(args: &[String]) -> Result<Option<ClientDirectory>> {
    let Some(action) = args.first().map(String::as_str) else {
        return Ok(None);
    };
    if action == "discovery-child" && args.len() == 1 {
        if installation::uid()? != 10002 {
            return Err(Unavailable);
        }
        let c = discovery::Config::load(Path::new(discovery::MANIFEST)).map_err(|_| Unavailable)?;
        return Ok(Some(ClientDirectory(c.client_directory)));
    }
    if (action == "held-preview" && args.len() == 2)
        || (action == "held-confirm" && args.len() == 3)
    {
        for id in &args[1..] {
            uuid::Uuid::parse_str(id).map_err(|_| Unavailable)?;
        }
        return execution(Path::new(
            "/run/kelryvo/runtime/execution/installation.json",
        ))
        .map(Some);
    }
    if args.len() != 2 {
        return Ok(None);
    }
    let path = Path::new(&args[1]);
    let c = match action {
        "installation-client-check" | "installation-preflight" | "installation-record" => {
            operator::loader_config(path)?
        }
        "installation-prepare" => preparation::loader_config(path)?,
        "installation-publish" | "installation-refresh" | "installation-observer" => {
            publication::loader_config(action, path)?
        }
        _ => return Ok(None),
    };
    Ok(Some(ClientDirectory(c.client_directory)))
}

#[cfg(test)]
mod tests;
