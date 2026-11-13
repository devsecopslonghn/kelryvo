//! Fixed, secret-free lifecycle records shared with the retained runtime.
use serde_json::{Value, json};
use std::path::Path;
use tokio::io::AsyncReadExt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StartupCode {
    ConfigurationUnavailable,
    MetadataUnavailable,
    WebAssetsUnavailable,
    ListenUnavailable,
    StartupUnavailable,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    StartupStarted,
    StartupReady,
    StartupFailed(StartupCode),
    ShutdownStarted,
    ShutdownComplete,
    ShutdownFailed,
    ShutdownTimeout,
}
impl Event {
    pub fn record(self) -> Value {
        let (event, state, code) = match self {
            Self::StartupStarted => ("startup", "started", None),
            Self::StartupReady => ("startup", "ready", None),
            Self::StartupFailed(code) => (
                "startup",
                "failed",
                Some(match code {
                    StartupCode::ConfigurationUnavailable => "configuration_unavailable",
                    StartupCode::MetadataUnavailable => "metadata_unavailable",
                    StartupCode::WebAssetsUnavailable => "web_assets_unavailable",
                    StartupCode::ListenUnavailable => "listen_unavailable",
                    StartupCode::StartupUnavailable => "startup_unavailable",
                }),
            ),
            Self::ShutdownStarted => ("shutdown", "started", None),
            Self::ShutdownComplete => ("shutdown", "complete", None),
            Self::ShutdownFailed => ("shutdown", "failed", Some("shutdown_unavailable")),
            Self::ShutdownTimeout => ("shutdown", "timeout", Some("shutdown_unavailable")),
        };
        let mut record = json!({"event":event,"state":state});
        if let Some(code) = code {
            record["code"] = code.into();
        }
        record
    }
    pub fn write(self) {
        eprintln!("{}", self.record());
    }
}
/// As in the retained server, bind only after all browser assets are readable.
/// No file contents or filesystem error details enter a lifecycle record.
pub async fn web_assets(root: &Path) -> Result<(), Event> {
    for name in [
        "index.html",
        "styles.css",
        "bootstrap.js",
        "app.js",
        "app_bg.wasm",
    ] {
        let mut file = tokio::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(root.join(name))
            .await
            .map_err(|_| Event::StartupFailed(StartupCode::WebAssetsUnavailable))?;
        if !file
            .metadata()
            .await
            .map_err(|_| Event::StartupFailed(StartupCode::WebAssetsUnavailable))?
            .is_file()
        {
            return Err(Event::StartupFailed(StartupCode::WebAssetsUnavailable));
        }
        let mut byte = [0];
        if file
            .read(&mut byte)
            .await
            .map_err(|_| Event::StartupFailed(StartupCode::WebAssetsUnavailable))?
            != 1
        {
            return Err(Event::StartupFailed(StartupCode::WebAssetsUnavailable));
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lifecycle_records_match_the_fixed_retained_contract() {
        assert_eq!(
            Event::StartupStarted.record(),
            json!({"event":"startup","state":"started"})
        );
        assert_eq!(
            Event::StartupReady.record(),
            json!({"event":"startup","state":"ready"})
        );
        assert_eq!(
            Event::ShutdownStarted.record(),
            json!({"event":"shutdown","state":"started"})
        );
        assert_eq!(
            Event::ShutdownComplete.record(),
            json!({"event":"shutdown","state":"complete"})
        );
        for (code, name) in [
            (
                StartupCode::ConfigurationUnavailable,
                "configuration_unavailable",
            ),
            (StartupCode::MetadataUnavailable, "metadata_unavailable"),
            (StartupCode::WebAssetsUnavailable, "web_assets_unavailable"),
            (StartupCode::ListenUnavailable, "listen_unavailable"),
            (StartupCode::StartupUnavailable, "startup_unavailable"),
        ] {
            assert_eq!(
                Event::StartupFailed(code).record(),
                json!({"event":"startup","state":"failed","code":name})
            );
        }
        for (event, state) in [
            (Event::ShutdownFailed, "failed"),
            (Event::ShutdownTimeout, "timeout"),
        ] {
            assert_eq!(
                event.record(),
                json!({"event":"shutdown","state":state,"code":"shutdown_unavailable"})
            );
        }
    }
    #[tokio::test]
    async fn incomplete_unreadable_or_empty_assets_refuse_startup_without_echoing_paths() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../.cache")
            .join(format!("lifecycle-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let expected = Err(Event::StartupFailed(StartupCode::WebAssetsUnavailable));
        for name in [
            "index.html",
            "styles.css",
            "bootstrap.js",
            "app.js",
            "app_bg.wasm",
        ] {
            assert_eq!(web_assets(&root).await, expected);
            std::fs::write(root.join(name), b"fixture asset").unwrap();
        }
        assert_eq!(web_assets(&root).await, Ok(()));
        std::fs::write(root.join("app.js"), b"").unwrap();
        assert_eq!(web_assets(&root).await, expected);
        std::fs::remove_file(root.join("app.js")).unwrap();
        std::os::unix::fs::symlink(root.join("index.html"), root.join("app.js")).unwrap();
        assert_eq!(web_assets(&root).await, expected);
        std::fs::remove_file(root.join("app.js")).unwrap();
        assert!(
            std::process::Command::new("mkfifo")
                .arg(root.join("app.js"))
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(
            tokio::time::timeout(std::time::Duration::from_secs(1), web_assets(&root))
                .await
                .unwrap(),
            expected
        );
        std::fs::remove_file(root.join("app.js")).unwrap();
        std::fs::create_dir(root.join("app.js")).unwrap();
        assert_eq!(web_assets(&root).await, expected);
        std::fs::remove_dir_all(root).unwrap();
    }
}
