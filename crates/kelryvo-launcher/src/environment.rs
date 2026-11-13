use crate::{API_UID, RUNTIME, Result, Unavailable};
use std::{collections::BTreeMap, ffi::OsString, os::unix::ffi::OsStrExt, process::Command};

const KEYS: &[&str] = &[
    "KELRYVO_SECRET_DIR",
    "KELRYVO_INSTALLATION_DIR",
    "KELRYVO_BIND_HOST",
    "KELRYVO_PORT",
    "KELRYVO_EXECUTION_ENABLED",
    "KELRYVO_DISCOVERY_ENABLED",
];

pub struct Environment(BTreeMap<String, OsString>);
impl Environment {
    pub fn capture() -> Result<Self> {
        Self::from_lookup(|key| std::env::var_os(key))
    }
    pub(crate) fn from_lookup(mut lookup: impl FnMut(&str) -> Option<OsString>) -> Result<Self> {
        let mut values = BTreeMap::new();
        for key in KEYS {
            if let Some(value) = lookup(key) {
                if value.as_bytes().len() > 4096 {
                    return Err(Unavailable);
                }
                values.insert((*key).into(), value);
            }
        }
        values.insert("PATH".into(), "/usr/bin:/bin".into());
        values.insert("LANG".into(), "C".into());
        values.insert("TZ".into(), "UTC".into());
        let result = Self(values);
        result.flag("KELRYVO_EXECUTION_ENABLED")?;
        result.flag("KELRYVO_DISCOVERY_ENABLED")?;
        Ok(result)
    }
    pub fn flag(&self, name: &str) -> Result<bool> {
        match self.0.get(name).map(|s| s.as_bytes()) {
            None | Some(b"false") => Ok(false),
            Some(b"true") => Ok(true),
            _ => Err(Unavailable),
        }
    }
    pub fn source(&self, key: &str, default: &str) -> std::path::PathBuf {
        self.0.get(key).map_or_else(|| default.into(), Into::into)
    }
    pub fn apply(&self, command: &mut Command) {
        command.env_clear().envs(&self.0);
    }
    /// Source mounts are needed only by the bounded bootstrap child. Replace
    /// PID 1's environment by exec before launching unprivileged processes.
    pub fn without_sources(&self, command: &mut Command) {
        self.apply(command);
        command.env_remove("KELRYVO_SECRET_DIR");
        command.env_remove("KELRYVO_INSTALLATION_DIR");
    }
    pub fn role(&self, command: &mut Command, uid: u32) {
        self.without_sources(command);
        if uid == API_UID {
            command.env_remove("KELRYVO_EXECUTION_ENABLED");
            command.env_remove("KELRYVO_DISCOVERY_ENABLED");
            command.env("KELRYVO_SECRET_DIR", format!("{RUNTIME}/api/secrets"));
            command.env("KELRYVO_WEB_DIRECTORY", "/opt/kelryvo/dist/rust-web");
            if !self.0.contains_key("KELRYVO_BIND_HOST") {
                command.env("KELRYVO_BIND_HOST", "0.0.0.0");
            }
            if !self.0.contains_key("KELRYVO_PORT") {
                command.env("KELRYVO_PORT", "8443");
            }
        } else {
            command.env_remove("KELRYVO_BIND_HOST");
            command.env_remove("KELRYVO_PORT");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn roles_receive_only_fixed_environment_and_strict_flags() {
        let env = Environment::from_lookup(|key| match key {
            "KELRYVO_EXECUTION_ENABLED" => Some("true".into()),
            "KELRYVO_SECRET_DIR" => Some("/private/source".into()),
            "LD_PRELOAD" => Some("/untrusted.so".into()),
            _ => None,
        })
        .unwrap();
        assert!(env.flag("KELRYVO_EXECUTION_ENABLED").unwrap());
        let mut api = Command::new("fixed-api");
        env.role(&mut api, API_UID);
        let api: BTreeMap<_, _> = api.get_envs().collect();
        assert!(
            api.get(std::ffi::OsStr::new("KELRYVO_EXECUTION_ENABLED"))
                .copied()
                .flatten()
                .is_none()
        );
        assert!(!api.contains_key(std::ffi::OsStr::new("LD_PRELOAD")));
        assert_eq!(
            api[std::ffi::OsStr::new("KELRYVO_BIND_HOST")],
            Some("0.0.0.0".as_ref())
        );
        let mut worker = Command::new("fixed-worker");
        env.role(&mut worker, crate::WORKER_UID);
        assert!(
            worker
                .get_envs()
                .all(|(k, v)| k != "KELRYVO_SECRET_DIR" || v.is_none())
        );
        assert!(Environment::from_lookup(|_| Some("TRUE".into())).is_err());
        assert!(Environment::from_lookup(|_| Some("x".repeat(4097).into())).is_err());
    }
}
