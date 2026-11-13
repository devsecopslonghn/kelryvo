use super::{CONTEXT, NS, Result, STS, files, tool, unavailable};
use crate::backup::Tool;
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::process::Command;

pub(super) struct Kube {
    program: Tool,
    kubeconfig: PathBuf,
}
impl Kube {
    pub fn read(root: &Path) -> Result<Self> {
        let program: Tool =
            serde_json::from_slice(&files::read(&root.join("kubectl-tool"), 16384)?)
                .map_err(|_| unavailable())?;
        let kubeconfig = root.join("kubeconfig");
        drop(files::read(&kubeconfig, 256 * 1024)?);
        let k = Self {
            program,
            kubeconfig,
        };
        k.command(&[])?;
        Ok(k)
    }
    pub fn command(&self, args: &[String]) -> Result<Command> {
        if tool::snapshot(Path::new(&self.program.path))?.sha256 != self.program.sha256 {
            return Err(unavailable());
        }
        let mut cmd = Command::new(&self.program.path);
        cmd.env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LANG", "C")
            .env("KUBECONFIG", &self.kubeconfig)
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Ok(home) = std::env::var("HOME") {
            cmd.env("HOME", home);
        }
        Ok(cmd)
    }
    pub fn run(
        &self,
        args: Vec<String>,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String>> + Send + '_>> {
        Box::pin(self.run_inner(args))
    }
    async fn run_inner(&self, args: Vec<String>) -> Result<String> {
        let mut child = self.command(&args)?.spawn().map_err(|_| unavailable())?;
        let stdout = child.stdout.take().ok_or_else(unavailable)?;
        let stderr = child.stderr.take().ok_or_else(unavailable)?;
        let operation = async {
            let (out, _, status) = tokio::try_join!(
                tool::bounded(stdout, 4 * 1024 * 1024),
                tool::bounded(stderr, 65536),
                async { child.wait().await.map_err(|_| unavailable()) }
            )?;
            if !status.success() {
                return Err(unavailable());
            }
            String::from_utf8(out).map_err(|_| unavailable())
        };
        match tokio::time::timeout(Duration::from_secs(15), operation).await {
            Ok(Ok(out)) => Ok(out),
            _ => {
                let _ = child.start_kill();
                let _ = tokio::time::timeout(Duration::from_secs(3), child.wait()).await;
                Err(unavailable())
            }
        }
    }
    pub async fn json(&self, kind: &str, name: &str, namespaced: bool) -> Result<Value> {
        let mut args = vec![
            "--context".into(),
            CONTEXT.into(),
            "--request-timeout=10s".into(),
        ];
        if namespaced {
            args.extend(["-n".into(), NS.into()]);
        }
        args.extend([
            "get".into(),
            kind.into(),
            name.into(),
            "-o".into(),
            "json".into(),
        ]);
        serde_json::from_str(&self.run(args).await?).map_err(|_| unavailable())
    }
    pub async fn secret_uid(&self) -> Result<String> {
        self.run(vec![
            "--context".into(),
            CONTEXT.into(),
            "--request-timeout=10s".into(),
            "-n".into(),
            NS.into(),
            "get".into(),
            "secret".into(),
            STS.into(),
            "-o".into(),
            "jsonpath={.metadata.uid}".into(),
        ])
        .await
    }
}
