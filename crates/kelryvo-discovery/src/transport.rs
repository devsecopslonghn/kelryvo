use crate::{REQUEST_BYTES, RESPONSE_BYTES, Request, Response, Result, SOCKET, Unavailable};
use serde_json::Value;
use std::{future::Future, path::PathBuf, pin::Pin, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    sync::watch,
    task::JoinSet,
};

pub type HandlerResult = Pin<Box<dyn Future<Output = Result<Value>> + Send>>;
/// The trusted handler must keep its future alive until any spawned child is
/// reaped. Shutdown requests disposal; dropping an HTTP request grants no slot.
pub trait Handler: Send + Sync {
    fn run(&self, request: Request, stopped: watch::Receiver<bool>) -> HandlerResult;
}
#[derive(Clone, Copy)]
pub struct Limits {
    pub io: Duration,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            io: Duration::from_secs(2),
        }
    }
}
async fn read<R: AsyncRead + Unpin>(reader: &mut R, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::with_capacity(1024);
    reader
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| Unavailable)?;
    if bytes.is_empty() || bytes.len() > limit {
        return Err(Unavailable);
    }
    Ok(bytes)
}
#[derive(Clone)]
pub struct Client {
    socket: PathBuf,
    peer_uid: u32,
    deadline: Duration,
}
impl Client {
    pub fn installed() -> Self {
        Self {
            socket: SOCKET.into(),
            peer_uid: 10002,
            deadline: Duration::from_secs(40),
        }
    }
    /// Trusted programmatic wiring, used by private fixtures. HTTP input never
    /// supplies this path, peer identity or deadline.
    pub fn new(socket: PathBuf, peer_uid: u32, deadline: Duration) -> Result<Self> {
        if !socket.is_absolute() || deadline.is_zero() || deadline > Duration::from_secs(120) {
            return Err(Unavailable);
        }
        Ok(Self {
            socket,
            peer_uid,
            deadline,
        })
    }
    pub async fn run(&self, request: Request) -> Result<Value> {
        request.validate()?;
        tokio::time::timeout(self.deadline, async {
            let bytes = serde_json::to_vec(&request).map_err(|_| Unavailable)?;
            if bytes.len() > REQUEST_BYTES {
                return Err(Unavailable);
            }
            let mut socket = UnixStream::connect(&self.socket)
                .await
                .map_err(|_| Unavailable)?;
            if socket.peer_cred().map_err(|_| Unavailable)?.uid() != self.peer_uid {
                return Err(Unavailable);
            }
            socket.write_all(&bytes).await.map_err(|_| Unavailable)?;
            socket.shutdown().await.map_err(|_| Unavailable)?;
            let bytes = read(&mut socket, RESPONSE_BYTES).await?;
            serde_json::from_slice::<Response>(&bytes)
                .map_err(|_| Unavailable)?
                .result(&request)
        })
        .await
        .map_err(|_| Unavailable)?
    }
}
enum Completion {
    Handled,
    Rejected,
    Fatal,
}
async fn connection(
    mut stream: UnixStream,
    handler: Arc<dyn Handler>,
    mut stop: watch::Receiver<bool>,
    limits: Limits,
) -> Completion {
    let bytes = tokio::select! {
        _ = stop.changed() => return Completion::Rejected,
        r = tokio::time::timeout(limits.io, read(&mut stream, REQUEST_BYTES)) => match r { Ok(Ok(bytes)) => bytes, _ => return Completion::Rejected },
    };
    let request = match serde_json::from_slice::<Request>(&bytes) {
        Ok(request) if request.validate().is_ok() => request,
        _ => return Completion::Rejected,
    };
    let raw = match handler.run(request.clone(), stop).await {
        Ok(raw) => raw,
        Err(_) => return Completion::Fatal,
    };
    let response = Response::new(&request, raw);
    let bytes = match serde_json::to_vec(&response) {
        Ok(bytes) if bytes.len() <= RESPONSE_BYTES => bytes,
        _ => return Completion::Rejected,
    };
    let _ = tokio::time::timeout(limits.io, async {
        stream.write_all(&bytes).await?;
        stream.shutdown().await
    })
    .await;
    Completion::Handled
}
/// At most two accepted requests, including slow readers/writers and a handler
/// whose client timed out. Peer credentials are checked before parsing input.
/// All active handlers receive shutdown and settle before this function returns.
pub async fn serve(
    listener: UnixListener,
    peer_uid: u32,
    handler: Arc<dyn Handler>,
    mut stop: watch::Receiver<bool>,
    limits: Limits,
) -> Result<()> {
    if limits.io.is_zero() || limits.io > Duration::from_secs(10) {
        return Err(Unavailable);
    }
    let (retire, retired) = watch::channel(false);
    let mut tasks = JoinSet::new();
    let mut failed = false;
    while !*stop.borrow() {
        tokio::select! {
            _ = stop.changed() => break,
            result = tasks.join_next(), if !tasks.is_empty() => {
                if matches!(result, Some(Ok(Completion::Fatal)) | Some(Err(_))) { failed = true; break; }
            },
            accepted = listener.accept() => {
                let (stream, _) = match accepted { Ok(stream) => stream, Err(_) => { failed = true; break; } };
                if tasks.len() >= 2 || stream.peer_cred().map_or(true, |c| c.uid() != peer_uid) { continue; }
                tasks.spawn(connection(stream, handler.clone(), retired.clone(), limits));
            },
        }
    }
    drop(listener);
    let _ = retire.send(true);
    while let Some(result) = tasks.join_next().await {
        if matches!(result, Ok(Completion::Fatal) | Err(_)) {
            failed = true;
        }
    }
    if failed { Err(Unavailable) } else { Ok(()) }
}
