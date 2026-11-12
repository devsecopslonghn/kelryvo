//! One invocation per child. Only a scoped receipt plus a reaped, clean exit is terminal.
use nix::{
    sys::signal::{Signal, kill},
    unistd::Pid,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, path::PathBuf, process::Stdio, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    sync::{mpsc, watch},
    time::{Instant, sleep, timeout},
};
use uuid::Uuid;
pub const PROTOCOL: &str = "schemaforge.execution-worker.v1";
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Scope {
    TrustedValidated,
    UnitSynthetic,
}
#[derive(Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkerResult {
    AdmissionDeclined,
    VerifiedSuccess,
    Noop,
    Hold,
    HoldPersistencePending,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    #[serde(rename = "type")]
    kind: String,
    protocol: String,
    job_id: Uuid,
    invocation_id: Uuid,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Receipt {
    #[serde(rename = "type")]
    kind: String,
    protocol: String,
    job_id: Uuid,
    invocation_id: Uuid,
    scope: Scope,
    worker_id: String,
    result: WorkerResult,
}
#[derive(Clone, Copy)]
pub struct Limits {
    pub operation_ms: u64,
    pub term_grace_ms: u64,
    pub reap_ms: u64,
    pub output_bytes: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            operation_ms: 300000,
            term_grace_ms: 500,
            reap_ms: 5000,
            output_bytes: 16384,
        }
    }
}
impl Limits {
    fn valid(self) -> bool {
        (250..=900000).contains(&self.operation_ms)
            && (10..=5000).contains(&self.term_grace_ms)
            && (100..=30000).contains(&self.reap_ms)
            && (256..=65536).contains(&self.output_bytes)
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub status: String,
    pub reason: String,
    pub worker_result: String,
    pub child_termination: &'static str,
    pub terminal_receipt: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_scope: Option<Scope>,
}
impl Report {
    fn hold(reason: &str, termination: &'static str) -> Self {
        Self {
            status: "HOLD".into(),
            reason: reason.into(),
            worker_result: "HOLD_PERSISTENCE_PENDING".into(),
            child_termination: termination,
            terminal_receipt: false,
            evidence_scope: None,
        }
    }
    fn receipt(scope: Scope, result: WorkerResult) -> Self {
        let name = match result {
            WorkerResult::AdmissionDeclined => "ADMISSION_DECLINED",
            WorkerResult::VerifiedSuccess => "VERIFIED_SUCCESS",
            WorkerResult::Noop => "NOOP",
            WorkerResult::Hold => "HOLD",
            WorkerResult::HoldPersistencePending => "HOLD_PERSISTENCE_PENDING",
        };
        Self {
            status: if matches!(result, WorkerResult::AdmissionDeclined) {
                "DECLINED".into()
            } else {
                name.into()
            },
            reason: name.into(),
            worker_result: name.into(),
            child_termination: "REAPED",
            terminal_receipt: true,
            evidence_scope: Some(scope),
        }
    }
}
#[derive(Debug)]
pub struct Unavailable;
impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Worker supervisor unavailable")
    }
}
impl std::error::Error for Unavailable {}
pub struct Supervisor {
    program: PathBuf,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    worker: String,
    scope: Scope,
    limits: Limits,
    unreaped: Option<Child>,
    poisoned: bool,
}
struct Chunk {
    stdout: bool,
    bytes: Vec<u8>,
    eof: bool,
    failed: bool,
}
fn reader(
    stream: impl AsyncRead + Unpin + Send + 'static,
    stdout: bool,
    sender: mpsc::Sender<Chunk>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut stream = stream;
        let mut buffer = [0u8; 1024];
        loop {
            match stream.read(&mut buffer).await {
                Ok(0) => {
                    let _ = sender
                        .send(Chunk {
                            stdout,
                            bytes: Vec::new(),
                            eof: true,
                            failed: false,
                        })
                        .await;
                    break;
                }
                Ok(n) => {
                    if sender
                        .send(Chunk {
                            stdout,
                            bytes: buffer[..n].to_vec(),
                            eof: false,
                            failed: false,
                        })
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => {
                    let _ = sender
                        .send(Chunk {
                            stdout,
                            bytes: Vec::new(),
                            eof: true,
                            failed: true,
                        })
                        .await;
                    break;
                }
            }
        }
    })
}
impl Supervisor {
    /// Arguments and environment come from the installed service, never a job or IPC payload.
    pub fn new(
        program: PathBuf,
        args: Vec<String>,
        env: BTreeMap<String, String>,
        worker: &str,
        scope: Scope,
        limits: Limits,
    ) -> Result<Self, Unavailable> {
        if !program.is_absolute()
            || !limits.valid()
            || worker.is_empty()
            || worker.len() > 100
            || !worker
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
            || env.iter().any(|(k, v)| {
                ![
                    "PATH",
                    "LANG",
                    "TZ",
                    "KELRYVO_SECRET_DIR",
                    "KELRYVO_METADATA_GENERATION_ID",
                    "ORACLE_HOME",
                    "TNS_ADMIN",
                    "LD_LIBRARY_PATH",
                    "NLS_LANG",
                ]
                .contains(&k.as_str())
                    || v.len() > 4096
                    || v.contains('\0')
            })
        {
            return Err(Unavailable);
        }
        Ok(Self {
            program,
            args,
            env,
            worker: worker.into(),
            scope,
            limits,
            unreaped: None,
            poisoned: false,
        })
    }
    pub async fn run(&mut self, job: Uuid, mut retired: watch::Receiver<bool>) -> Report {
        if self.poisoned || self.unreaped.is_some() {
            return Report::hold("WORKER_DISPOSAL_PENDING", "UNCONFIRMED");
        }
        if *retired.borrow() {
            return Report::hold("WORKER_AUTHORITY_RETIRED", "NOT_STARTED");
        }
        let request = Request {
            kind: "REQUEST".into(),
            protocol: PROTOCOL.into(),
            job_id: job,
            invocation_id: Uuid::new_v4(),
        };
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .env_clear()
            .envs(&self.env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = match command.spawn() {
            Ok(c) => c,
            Err(_) => return Report::hold("WORKER_CHANNEL_FAILED", "NOT_STARTED"),
        };
        let (sender, mut receiver) = mpsc::channel(16);
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        let out_task = reader(stdout, true, sender.clone());
        let err_task = reader(stderr, false, sender);
        let mut stdin = child.stdin.take();
        let mut buffer = Vec::new();
        let mut total = 0;
        let mut ready = false;
        let mut receipt = None;
        let mut exited = None;
        let mut eof = 0;
        let deadline = Instant::now() + Duration::from_millis(self.limits.operation_ms);
        let fault = loop {
            if exited.is_some() && eof == 2 {
                if !buffer.is_empty() {
                    break "WORKER_PROTOCOL_REJECTED";
                }
                if exited.is_some_and(|s: std::process::ExitStatus| s.success())
                    && receipt.is_some()
                {
                    break "";
                }
                break "WORKER_EXIT_REJECTED";
            }
            tokio::select! {
                _=sleep(deadline.saturating_duration_since(Instant::now()))=>break "WORKER_TIMEOUT",
                changed=retired.changed()=>{if changed.is_err()||*retired.borrow(){break "WORKER_AUTHORITY_RETIRED";}},
                result=child.wait(),if exited.is_none()=>{match result{Ok(status)=>exited=Some(status),Err(_)=>break "WORKER_CHANNEL_FAILED"}},
                chunk=receiver.recv(),if eof<2=>{
                    let Some(chunk)=chunk else{break "WORKER_CHANNEL_FAILED";};if chunk.failed{break "WORKER_CHANNEL_FAILED";}
                    if chunk.eof{eof+=1;continue;}
                    total+=chunk.bytes.len();if total>self.limits.output_bytes{break "WORKER_OUTPUT_REJECTED";}
                    if !chunk.stdout{continue;}buffer.extend_from_slice(&chunk.bytes);
                    while let Some(end)=buffer.iter().position(|b|*b==b'\n'){
                        let line:Vec<_>=buffer.drain(..=end).collect();let value:Value=match serde_json::from_slice(&line){Ok(v)=>v,Err(_)=>{buffer=vec![0];break;}};
                        if !ready&&value==json!({"type":"READY","protocol":PROTOCOL}){
                            ready=true;let mut bytes=serde_json::to_vec(&request).expect("request JSON");bytes.push(b'\n');let Some(mut pipe)=stdin.take()else{buffer=vec![0];break;};
                            if pipe.write_all(&bytes).await.is_err()||pipe.shutdown().await.is_err(){buffer=vec![0];break;}
                        }else{
                            let result=serde_json::from_value::<Receipt>(value);
                            match result{Ok(r) if ready&&receipt.is_none()&&r.kind=="RESULT"&&r.protocol==PROTOCOL&&r.job_id==request.job_id&&r.invocation_id==request.invocation_id&&r.scope==self.scope&&r.worker_id==self.worker=>receipt=Some(r.result),_=>{buffer=vec![0];break;}}
                        }
                    }
                    if buffer==[0]{break "WORKER_PROTOCOL_REJECTED";}
                }
            }
        };
        out_task.abort();
        err_task.abort();
        if fault.is_empty() {
            return Report::receipt(self.scope, receipt.expect("verified receipt"));
        }
        if exited.is_some() {
            return Report::hold(fault, "REAPED");
        }
        if let Some(pid) = child.id() {
            let _ = kill(Pid::from_raw(pid as i32), Signal::SIGTERM);
        }
        if timeout(
            Duration::from_millis(self.limits.term_grace_ms),
            child.wait(),
        )
        .await
        .is_ok_and(|r| r.is_ok())
        {
            return Report::hold(fault, "REAPED");
        }
        let _ = child.start_kill();
        if timeout(Duration::from_millis(self.limits.reap_ms), child.wait())
            .await
            .is_ok_and(|r| r.is_ok())
        {
            return Report::hold(fault, "REAPED");
        }
        self.poisoned = true;
        self.unreaped = Some(child);
        Report::hold(fault, "UNCONFIRMED")
    }
    pub async fn close(&mut self) -> bool {
        let Some(mut child) = self.unreaped.take() else {
            return true;
        };
        let _ = child.start_kill();
        if timeout(Duration::from_millis(self.limits.reap_ms), child.wait())
            .await
            .is_ok_and(|r| r.is_ok())
        {
            true
        } else {
            self.unreaped = Some(child);
            false
        }
    }
}
/// The binary supplies its installed runner. IPC can select only one job UUID.
pub async fn serve_one<F, Fut>(scope: Scope, worker: &str, run: F) -> Result<(), Unavailable>
where
    F: FnOnce(Uuid) -> Fut,
    Fut: std::future::Future<Output = Result<WorkerResult, Unavailable>>,
{
    let mut stdout = tokio::io::stdout();
    let mut ready = serde_json::to_vec(&json!({"type":"READY","protocol":PROTOCOL}))
        .map_err(|_| Unavailable)?;
    ready.push(b'\n');
    stdout.write_all(&ready).await.map_err(|_| Unavailable)?;
    stdout.flush().await.map_err(|_| Unavailable)?;
    let mut input = Vec::new();
    tokio::io::stdin()
        .take(1025)
        .read_to_end(&mut input)
        .await
        .map_err(|_| Unavailable)?;
    if input.len() > 1024 {
        return Err(Unavailable);
    }
    let request: Request = serde_json::from_slice(&input).map_err(|_| Unavailable)?;
    if request.kind != "REQUEST"
        || request.protocol != PROTOCOL
        || !kelryvo_core::uuid(&json!(request.job_id))
        || !kelryvo_core::uuid(&json!(request.invocation_id))
    {
        return Err(Unavailable);
    }
    let result = run(request.job_id).await?;
    let mut bytes = serde_json::to_vec(&Receipt {
        kind: "RESULT".into(),
        protocol: PROTOCOL.into(),
        job_id: request.job_id,
        invocation_id: request.invocation_id,
        scope,
        worker_id: worker.into(),
        result,
    })
    .map_err(|_| Unavailable)?;
    bytes.push(b'\n');
    stdout.write_all(&bytes).await.map_err(|_| Unavailable)?;
    stdout.flush().await.map_err(|_| Unavailable)?;
    Ok(())
}
