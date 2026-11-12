use super::{CONTEXT, NS, POD, Result, kube::Kube, unavailable};
use nix::{
    sys::signal::{Signal, kill},
    unistd::Pid,
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::AsyncReadExt,
    process::Child,
    task::JoinHandle,
    time::{Instant, sleep, timeout},
};

pub(super) struct Tunnel {
    child: Child,
    readers: Vec<JoinHandle<()>>,
    pub port: u16,
}
fn reader<R: tokio::io::AsyncRead + Unpin + Send + 'static>(
    mut input: R,
    captured: Arc<Mutex<Vec<u8>>>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut bytes = [0; 4096];
        loop {
            let Ok(n) = input.read(&mut bytes).await else {
                return;
            };
            if n == 0 {
                return;
            }
            let Ok(mut c) = captured.lock() else {
                return;
            };
            c.extend_from_slice(&bytes[..n]);
            if c.len() > 8192 {
                let extra = c.len() - 8192;
                c.drain(..extra);
            }
        }
    })
}
fn port(bytes: &[u8]) -> Option<u16> {
    let text = std::str::from_utf8(bytes).ok()?;
    let (_, rest) = text.rsplit_once("Forwarding from 127.0.0.1:")?;
    let (number, _) = rest.split_once(" -> 5432")?;
    if number.is_empty() || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    number.parse::<u16>().ok().filter(|p| *p != 0)
}
impl Tunnel {
    pub async fn start(k: &Kube) -> Result<Self> {
        let mut child = k
            .command(&[
                "--context".into(),
                CONTEXT.into(),
                "--request-timeout=0".into(),
                "-n".into(),
                NS.into(),
                "port-forward".into(),
                "--address".into(),
                "127.0.0.1".into(),
                format!("pod/{POD}"),
                ":5432".into(),
            ])?
            .spawn()
            .map_err(|_| unavailable())?;
        let captured = Arc::new(Mutex::new(Vec::new()));
        let readers = vec![
            reader(
                child.stdout.take().ok_or_else(unavailable)?,
                captured.clone(),
            ),
            reader(
                child.stderr.take().ok_or_else(unavailable)?,
                captured.clone(),
            ),
        ];
        let mut forward = Self {
            child,
            readers,
            port: 0,
        };
        let start = Instant::now();
        let result = async {
            while start.elapsed() < Duration::from_secs(20) {
                if forward
                    .child
                    .try_wait()
                    .map_err(|_| unavailable())?
                    .is_some()
                {
                    return Err(unavailable());
                }
                if let Some(p) = captured
                    .lock()
                    .map_err(|_| unavailable())
                    .ok()
                    .and_then(|c| port(&c))
                {
                    forward.port = p;
                    return Ok(());
                }
                sleep(Duration::from_millis(25)).await;
            }
            Err(unavailable())
        }
        .await;
        if result.is_err() {
            forward.stop().await?;
            return Err(unavailable());
        }
        Ok(forward)
    }
    pub async fn stop(&mut self) -> Result<()> {
        let result = async {
            if self.child.try_wait().map_err(|_| unavailable())?.is_some() {
                return Ok(());
            }
            let pid = self
                .child
                .id()
                .and_then(|id| i32::try_from(id).ok())
                .ok_or_else(unavailable)?;
            kill(Pid::from_raw(pid), Signal::SIGTERM).map_err(|_| unavailable())?;
            if timeout(Duration::from_secs(3), self.child.wait())
                .await
                .is_ok_and(|v| v.is_ok())
            {
                return Ok(());
            }
            self.child.start_kill().map_err(|_| unavailable())?;
            timeout(Duration::from_secs(3), self.child.wait())
                .await
                .map_err(|_| unavailable())?
                .map_err(|_| unavailable())?;
            Ok(())
        }
        .await;
        for task in self.readers.drain(..) {
            task.abort();
            let _ = task.await;
        }
        if result.is_err() {
            eprintln!("Managed PostgreSQL tunnel cleanup unconfirmed.");
        }
        result
    }
}
impl Drop for Tunnel {
    fn drop(&mut self) {
        for t in &self.readers {
            t.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::port;
    #[test]
    fn only_loopback_postgresql_announcements_supply_ports() {
        assert_eq!(
            port(b"Forwarding from 127.0.0.1:41731 -> 5432\n"),
            Some(41731)
        );
        for input in [
            b"Forwarding from 0.0.0.0:41731 -> 5432".as_slice(),
            b"Forwarding from 127.0.0.1:65536 -> 5432",
            b"Forwarding from 127.0.0.1:0 -> 5432",
            b"Forwarding from 127.0.0.1:41731 -> 443",
        ] {
            assert_eq!(port(input), None);
        }
    }
}
