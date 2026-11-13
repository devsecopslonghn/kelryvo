//! Opaque loopback transport fixture. It knows no Oracle protocol or credentials.
//! A cut proves only that captured bytes were withheld, never Oracle COMMIT.
use crate::Result;
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Notify, Semaphore, watch},
    task::{JoinHandle, JoinSet},
};

pub fn monotonic_ns() -> u64 {
    use nix::sys::time::TimeValLike;
    nix::time::clock_gettime(nix::time::ClockId::CLOCK_MONOTONIC)
        .expect("monotonic clock")
        .num_nanoseconds() as u64
}
pub fn exact_clock_json(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    (
                        key.clone(),
                        if key.ends_with("Ns") {
                            value.to_string().trim_matches('"').into()
                        } else {
                            exact_clock_json(value)
                        },
                    )
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(exact_clock_json).collect()),
        _ => value.clone(),
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    id: u64,
    upstream_port: u16,
    captured_bytes: u64,
    forwarded_bytes: u64,
    dropped_bytes: u64,
    pending_bytes: u64,
    pending_captured_ns: u64,
    last_forwarded_captured_ns: u64,
    closed: bool,
    #[serde(skip)]
    cancel: watch::Sender<bool>,
}
struct State {
    delay_enabled: bool,
    target: Option<u16>,
    used: bool,
    closing: bool,
    sequence: u64,
    cuts: u64,
    rejected: u64,
    sessions: BTreeMap<u64, Record>,
    finished: VecDeque<Record>,
}
type Shared = Arc<Mutex<State>>;
pub struct AckProxy {
    shared: Shared,
    task: JoinHandle<()>,
    stop: watch::Sender<bool>,
    pub pending: Arc<Notify>,
    pub port: u16,
}
fn disconnect(record: &mut Record) {
    if !record.closed {
        record.closed = true;
        record.dropped_bytes += record.pending_bytes;
        record.pending_bytes = 0;
        record.cancel.send_replace(true);
    }
}
async fn copy(
    mut reader: impl AsyncRead + Unpin,
    mut writer: impl AsyncWrite + Unpin,
    id: u64,
    responses: bool,
    shared: Shared,
    pending: Arc<Notify>,
    delay: Duration,
) -> Result<()> {
    let mut buffer = [0; 16384];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            return Ok(());
        }
        if responses {
            let captured = monotonic_ns();
            let wait = {
                let mut state = shared.lock().unwrap();
                let wait = state.delay_enabled;
                let target = state.target;
                let record = state
                    .sessions
                    .get_mut(&id)
                    .ok_or("Closed transport session")?;
                if record.closed {
                    return Ok(());
                }
                record.captured_bytes += count as u64;
                record.pending_bytes = count as u64;
                record.pending_captured_ns = captured;
                wait && target.is_none_or(|port| port == record.upstream_port)
            };
            pending.notify_waiters();
            if wait {
                tokio::time::sleep(delay).await;
            }
            {
                let mut state = shared.lock().unwrap();
                let record = state
                    .sessions
                    .get_mut(&id)
                    .ok_or("Closed transport session")?;
                if record.closed {
                    return Ok(());
                }
                // Queued writes count as forwarded before the await. Refuse
                // an uncertain fault window rather than claim a false proof.
                record.last_forwarded_captured_ns = captured;
                record.forwarded_bytes += count as u64;
                record.pending_bytes = 0;
            }
        }
        writer.write_all(&buffer[..count]).await?;
    }
}
impl AckProxy {
    pub async fn start(upstream: u16, delay: Duration, listen: u16) -> Result<Self> {
        if upstream == 0 || delay.is_zero() || delay > Duration::from_secs(1) {
            return Err("Invalid loopback transport fixture".into());
        }
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, listen)).await?;
        let port = listener.local_addr()?.port();
        let shared = Arc::new(Mutex::new(State {
            delay_enabled: true,
            target: None,
            used: false,
            closing: false,
            sequence: 0,
            cuts: 0,
            rejected: 0,
            sessions: BTreeMap::new(),
            finished: VecDeque::new(),
        }));
        let pending = Arc::new(Notify::new());
        let (stop, mut stopped) = watch::channel(false);
        let slots = Arc::new(Semaphore::new(8));
        let state = shared.clone();
        let notify = pending.clone();
        let task = tokio::spawn(async move {
            let mut tasks = JoinSet::new();
            loop {
                tokio::select! {
                    _=stopped.changed()=>break,
                    Some(_)=tasks.join_next(),if !tasks.is_empty()=>{},
                    accepted=listener.accept()=>{
                        let Ok((client,_))=accepted else{break;};
                        // Reserve before any upstream await: simultaneous accepts
                        // must not exceed eight in-flight handshakes/connections.
                        let Ok(permit)=slots.clone().try_acquire_owned() else{state.lock().unwrap().rejected+=1;drop(client);continue;};
                        let state=state.clone();let notify=notify.clone();
                        tasks.spawn(async move {
                            let _permit=permit;
                            let Ok(Ok(upstream))=tokio::time::timeout(Duration::from_secs(3),TcpStream::connect((std::net::Ipv4Addr::LOCALHOST,upstream))).await else{return;};
                            let Ok(address)=upstream.local_addr() else{return;};let (cancel,mut cancelled)=watch::channel(false);
                            let id={let mut state=state.lock().unwrap();if state.closing{return;}state.sequence+=1;let id=state.sequence;
                                state.sessions.insert(id,Record{id,upstream_port:address.port(),captured_bytes:0,forwarded_bytes:0,dropped_bytes:0,pending_bytes:0,pending_captured_ns:0,last_forwarded_captured_ns:0,closed:false,cancel});id};
                            let (client_read,client_write)=client.into_split();let (upstream_read,upstream_write)=upstream.into_split();
                            tokio::select! {
                                _=copy(client_read,upstream_write,id,false,state.clone(),notify.clone(),delay)=>{},
                                _=copy(upstream_read,client_write,id,true,state.clone(),notify,delay)=>{},
                                _=cancelled.changed()=>{},
                            }
                            let mut state=state.lock().unwrap();if let Some(mut record)=state.sessions.remove(&id) {disconnect(&mut record);if state.finished.len()==16{state.finished.pop_front();}state.finished.push_back(record);}
                        });
                    }
                }
            }
            {
                let mut state = state.lock().unwrap();
                state.closing = true;
                for record in state.sessions.values_mut() {
                    disconnect(record);
                }
            }
            while tasks.join_next().await.is_some() {}
        });
        Ok(Self {
            shared,
            task,
            stop,
            pending,
            port,
        })
    }
    pub fn snapshot(&self) -> Value {
        let state = self.shared.lock().unwrap();
        let records: Vec<_> = state
            .finished
            .iter()
            .chain(state.sessions.values())
            .collect();
        json!({"cuts":state.cuts,"rejected":state.rejected,"used":state.used,"connections":records})
    }
    pub fn pass_responses(&self) {
        self.shared.lock().unwrap().delay_enabled = false;
    }
    pub fn arm(&self, port: u16) -> Result<()> {
        let mut state = self.shared.lock().unwrap();
        if state.used || !state.sessions.values().any(|s| s.upstream_port == port) {
            return Err("No live selected ledger connection".into());
        }
        state.target = Some(port);
        state.delay_enabled = true;
        Ok(())
    }
    pub fn cut(&self, port: u16, after: u64) -> Result<Value> {
        let mut state = self.shared.lock().unwrap();
        let ids: Vec<_> = state
            .sessions
            .iter()
            .filter(|(_, s)| s.upstream_port == port)
            .map(|(id, _)| *id)
            .collect();
        if state.used || ids.len() != 1 || after == 0 || after > monotonic_ns() {
            return Err("Invalid or already consumed fault window".into());
        }
        let record = state.sessions.get_mut(&ids[0]).unwrap();
        if record.closed
            || record.pending_bytes == 0
            || record.last_forwarded_captured_ns >= after
            || record.pending_captured_ns < after
        {
            return Err("A response may already have reached the client".into());
        }
        let proof = json!({"upstreamPort":port,"negativeReadStartNs":after,"pendingCapturedNs":record.pending_captured_ns,"lastForwardedCapturedNs":record.last_forwarded_captured_ns,"withheldBytes":record.pending_bytes,"oracleCommitProven":false});
        disconnect(record);
        state.used = true;
        state.cuts += 1;
        state.delay_enabled = false;
        state.target = None;
        Ok(proof)
    }
    pub async fn close(self) -> Result<()> {
        self.stop.send_replace(true);
        self.task.await?;
        Ok(())
    }
}

pub async fn control(root: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    crate::oracle_guard::namespace(root)?;
    let path = root.join("private/proxy-control.sock");
    if path.try_exists()? || std::fs::symlink_metadata(&path).is_ok() {
        return Err("Existing proxy control socket must not be replaced".into());
    }
    let server = tokio::net::UnixListener::bind(&path)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))?;
    let metadata = std::fs::symlink_metadata(&path)?;
    let proxy = AckProxy::start(2485, Duration::from_millis(100), 2484).await?;
    proxy.pass_responses();
    let result: Result<()> = async {
        loop {
            let (mut stream, _) = server.accept().await?;
            let request = tokio::time::timeout(Duration::from_secs(2), async {
                let mut bytes = Vec::new();
                let mut byte = [0; 1];
                loop {
                    if stream.read(&mut byte).await? == 0 {
                        return Err("Incomplete proxy control request".into());
                    }
                    if byte[0] == b'\n' {
                        break;
                    }
                    bytes.push(byte[0]);
                    if bytes.len() >= 2048 {
                        return Err("Oversized proxy control request".into());
                    }
                }
                let value: Value = serde_json::from_slice(&bytes)?;
                let port = || -> Result<u16> {
                    Ok(u16::try_from(
                        value["port"].as_u64().ok_or("Private proxy session port")?,
                    )?)
                };
                let (output, stop) = match value["op"].as_str() {
                    Some("snapshot") => (proxy.snapshot(), false),
                    Some("arm") => {
                        proxy.arm(port()?)?;
                        (json!({}), false)
                    }
                    Some("cut") => {
                        let after = if let Some(value) = value["afterNs"].as_str() {
                            value.parse::<u64>()?
                        } else {
                            value["afterNs"]
                                .as_u64()
                                .ok_or("Exact monotonic clock required")?
                        };
                        (proxy.cut(port()?, after)?, false)
                    }
                    Some("pass") => {
                        proxy.pass_responses();
                        (json!({}), false)
                    }
                    Some("stop") => (json!({}), true),
                    _ => return Err("Unsupported fixture operation".into()),
                };
                Result::Ok((exact_clock_json(&output), stop))
            })
            .await;
            let (response, stop) = match request {
                Ok(Ok((output, stop))) => (json!({"ok":true,"result":output}), stop),
                _ => (json!({"ok":false,"error":"FaultWindowMissed"}), false),
            };
            let write = async {
                stream.write_all(format!("{response}\n").as_bytes()).await?;
                stream.shutdown().await
            };
            let _ = tokio::time::timeout(Duration::from_secs(2), write).await;
            if stop {
                break;
            }
        }
        Ok(())
    }
    .await;
    drop(server);
    let closed = proxy.close().await;
    if std::fs::symlink_metadata(&path)
        .is_ok_and(|current| current.dev() == metadata.dev() && current.ino() == metadata.ino())
    {
        std::fs::remove_file(&path)?;
    }
    result?;
    closed
}

#[cfg(test)]
mod tests;
