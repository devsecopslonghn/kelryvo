//! Fixed native polling and one-job children. Oracle capabilities come only
//! from the separately reviewed private installation.
use kelryvo_runtime::{
    jobs::JobStore,
    supervisor::{self, Limits, Scope, Supervisor, Unavailable, WorkerResult},
};
use kelryvo_worker::{
    installation, managed::ManagedHost, oracle_host::RestrictedHost, run::ExecutionWorker,
};
use serde::Deserialize;
use serde_json::json;
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{
    collections::BTreeMap,
    io::IsTerminal,
    path::{Path, PathBuf},
    process::ExitCode,
    time::Duration,
};
use tokio::sync::watch;
use uuid::Uuid;
use zeroize::Zeroizing;
const ORG: Uuid = Uuid::from_u128(0x00000000000040008000000000000001);
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    format: u8,
    mode: String,
    database_secret_directory: PathBuf,
    metadata_generation_id: Uuid,
    worker_id: String,
    expires_at: chrono::DateTime<chrono::Utc>,
    poll_ms: u64,
    page_size: i64,
    #[serde(default)]
    oracle_installation: Option<PathBuf>,
}
fn uid() -> Result<u32, Unavailable> {
    installation::uid().map_err(|_| Unavailable)
}
fn private_file(path: &Path, max: u64) -> Result<Zeroizing<Vec<u8>>, Unavailable> {
    installation::private_file(path, max).map_err(|_| Unavailable)
}
fn config(path: &Path) -> Result<Config, Unavailable> {
    let bytes = private_file(path, 65536)?;
    let c: Config = serde_json::from_slice(&bytes).map_err(|_| Unavailable)?;
    if c.format != 1
        || !["EXPIRE_ONLY", "ORACLE_EXECUTION"].contains(&c.mode.as_str())
        || !c.database_secret_directory.is_absolute()
        || !kelryvo_core::uuid(&json!(c.metadata_generation_id))
        || c.worker_id.is_empty()
        || c.worker_id.len() > 100
        || !c
            .worker_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
        || c.expires_at <= chrono::Utc::now()
        || !(250..=60000).contains(&c.poll_ms)
        || !(1..=100).contains(&c.page_size)
    {
        return Err(Unavailable);
    }
    match (&c.oracle_installation, c.mode.as_str()) {
        (None, "EXPIRE_ONLY") => {}
        (Some(path), "ORACLE_EXECUTION") => {
            let native = installation::Config::load(path).map_err(|_| Unavailable)?;
            if native.worker_id != c.worker_id
                || native.metadata_generation_id != c.metadata_generation_id
                || native.secret_directory != c.database_secret_directory
                || native.expires().map_err(|_| Unavailable)? < c.expires_at
            {
                return Err(Unavailable);
            }
        }
        _ => return Err(Unavailable),
    }
    Ok(c)
}
async fn connect(c: &Config) -> Result<PgPool, Unavailable> {
    let bytes = private_file(&c.database_secret_directory.join("database-url"), 16384)?;
    let url = std::str::from_utf8(&bytes).map_err(|_| Unavailable)?.trim();
    if !(url.starts_with("postgresql://") || url.starts_with("postgres://"))
        || url.chars().any(|c| c <= '\u{20}' || c == '\u{7f}')
    {
        return Err(Unavailable);
    }
    PgPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(5))
        .after_connect(|conn, _| {
            Box::pin(async move {
                sqlx::query("SET statement_timeout='10s'")
                    .execute(&mut *conn)
                    .await?;
                sqlx::query("SET lock_timeout='5s'").execute(conn).await?;
                Ok(())
            })
        })
        .connect(url)
        .await
        .map_err(|_| Unavailable)
}
async fn child(c: Config) -> Result<(), Unavailable> {
    if std::io::stdin().is_terminal() || std::io::stdout().is_terminal() {
        return Err(Unavailable);
    }
    let worker = c.worker_id.clone();
    supervisor::serve_one(Scope::TrustedValidated, &worker, move |job| async move {
        if c.expires_at <= chrono::Utc::now() {
            return Err(Unavailable);
        }
        let pool = connect(&c).await?;
        let store = JobStore::new(pool.clone(), ORG, c.metadata_generation_id, &c.worker_id)
            .map_err(|_| Unavailable)?;
        let recovered = store
            .recover_expired(job, None)
            .await
            .map_err(|_| Unavailable);
        if recovered.as_ref().is_ok_and(|held| *held) {
            pool.close().await;
            return Ok(WorkerResult::Hold);
        }
        if recovered.is_err() {
            pool.close().await;
            return Err(Unavailable);
        }
        let result = if let Some(path) = &c.oracle_installation {
            let native = installation::Config::load(path).map_err(|_| Unavailable)?;
            let worker = ExecutionWorker::new(
                pool.clone(),
                c.metadata_generation_id,
                &c.worker_id,
                native.lease_seconds,
            )
            .map_err(|_| Unavailable)?;
            let managed = ManagedHost::new(native).await.map_err(|_| Unavailable)?;
            let mut host = RestrictedHost::new(managed).map_err(|_| Unavailable)?;
            let result = worker.run(job, &mut host).await;
            host.into_installed().close().await;
            Ok(result)
        } else {
            Ok(WorkerResult::AdmissionDeclined)
        };
        pool.close().await;
        result
    })
    .await
}
async fn retirement(mut stopped: watch::Receiver<bool>) {
    while !*stopped.borrow_and_update() {
        if stopped.changed().await.is_err() {
            break;
        }
    }
}
async fn service(
    c: Config,
    path: &Path,
    external_stop: Option<watch::Receiver<bool>>,
) -> Result<(), Unavailable> {
    let pool = connect(&c).await?;
    let program = std::env::current_exe().map_err(|_| Unavailable)?;
    let env = BTreeMap::from([
        ("PATH".into(), "/usr/bin:/bin".into()),
        ("LANG".into(), "C.UTF-8".into()),
        ("TZ".into(), "UTC".into()),
        (
            "KELRYVO_METADATA_GENERATION_ID".into(),
            c.metadata_generation_id.to_string(),
        ),
    ]);
    let mut supervisor = Supervisor::new(
        program,
        vec![
            if c.mode == "EXPIRE_ONLY" {
                "expiry-child"
            } else {
                "execution-child"
            }
            .into(),
            path.to_str().ok_or(Unavailable)?.into(),
        ],
        env,
        &c.worker_id,
        Scope::TrustedValidated,
        Limits::default(),
    )?;
    let (stop, mut stopped) = watch::channel(false);
    let stop_signal = stop.clone();
    let expires = c.expires_at;
    let signals = tokio::spawn(async move {
        let mut term =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
        let expiry = (expires - chrono::Utc::now()).to_std().unwrap_or_default();
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {},
            _ = tokio::time::sleep(expiry) => {},
            _ = async { if let Some(signal) = term.as_mut() { signal.recv().await; } else { std::future::pending::<()>().await; } } => {},
            _ = async { if let Some(stop) = external_stop { retirement(stop).await; } else { std::future::pending::<()>().await; } } => {},
        }
        let _ = stop_signal.send(true);
    });
    let result=async{
        while !*stopped.borrow(){
            let active:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton AND g.id=$1 AND g.state='ACTIVE')").bind(c.metadata_generation_id).fetch_one(&pool).await.map_err(|_|Unavailable)?;
            if !active{return Err(Unavailable);}
            let mut jobs:Vec<Uuid>=sqlx::query_scalar("SELECT j.id FROM sf_execution_jobs j JOIN sf_execution_attempts a ON a.job_id=j.id WHERE j.organization_id=$1 AND j.state='ADMITTED' AND j.admission_scope='TRUSTED_VALIDATED' AND a.state='CLAIMED' AND a.lease_until<=clock_timestamp() ORDER BY a.lease_until,j.id LIMIT $2").bind(ORG).bind(c.page_size).fetch_all(&pool).await.map_err(|_|Unavailable)?;
            if c.mode=="ORACLE_EXECUTION" {
                let waiting:Vec<Uuid>=sqlx::query_scalar("SELECT id FROM sf_execution_jobs WHERE organization_id=$1 AND state='WAITING_VALIDATION' AND admission_scope='PRODUCT_REQUEST' ORDER BY created_at,id LIMIT $2").bind(ORG).bind(c.page_size).fetch_all(&pool).await.map_err(|_|Unavailable)?;
                jobs.extend(waiting);
            }
            for job in jobs{if *stopped.borrow(){break;}let report=supervisor.run(job,stopped.clone()).await;let unresolved=report.child_termination=="UNCONFIRMED";println!("{}",json!({"jobId":job,"report":report}));if unresolved{return Err(Unavailable);}}
            tokio::select!{_=tokio::time::sleep(Duration::from_millis(c.poll_ms))=>{},_=stopped.changed()=>{}}
        }Ok(())
    }.await;
    let _ = stop.send(true);
    signals.abort();
    let closed = supervisor.close().await;
    pool.close().await;
    if !closed {
        return Err(Unavailable);
    }
    result
}
async fn run() -> Result<(), Unavailable> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    // No stdin, checkpoints, metadata locks or OCI work precedes replacement.
    // Each fresh invocation validates private artifacts before setting a loader
    // path; waiting services/expiry and the public API never receive one.
    let client = if args.len() == 2 && args[0] == "execution-child" {
        if uid()? != 10002 {
            return Err(Unavailable);
        }
        let c = config(Path::new(&args[1]))?;
        if c.mode != "ORACLE_EXECUTION" {
            return Err(Unavailable);
        }
        Some(
            kelryvo_worker::loader::execution(c.oracle_installation.as_deref().ok_or(Unavailable)?)
                .map_err(|_| Unavailable)?,
        )
    } else {
        kelryvo_worker::loader::command(&args).map_err(|_| Unavailable)?
    };
    if let Some(client) = client {
        client.enter().map_err(|_| Unavailable)?;
    }
    if args == ["--build-info"] {
        println!("{}", kelryvo_core::build_identity::info());
        return Ok(());
    }
    if args == ["runtime-service"] {
        return runtime_service().await;
    }
    if args.len() == 2 && args[0] == "installation-client-check" {
        println!(
            "{}",
            kelryvo_worker::operator::client_check(Path::new(&args[1])).map_err(|_| Unavailable)?
        );
        return Ok(());
    }
    if matches!(
        args.first().map(String::as_str),
        Some("held-preview" | "held-confirm")
    ) {
        let confirm = args[0] == "held-confirm";
        if args.len() != if confirm { 3 } else { 2 } {
            return Err(Unavailable);
        }
        let job = Uuid::parse_str(&args[1]).map_err(|_| Unavailable)?;
        let reconciliation = if confirm {
            Some(Uuid::parse_str(&args[2]).map_err(|_| Unavailable)?)
        } else {
            None
        };
        println!(
            "{}",
            kelryvo_worker::recovery::run(job, reconciliation)
                .await
                .map_err(|_| Unavailable)?
        );
        return Ok(());
    }
    if args == ["discovery-child"] {
        return kelryvo_worker::discovery::child()
            .await
            .map_err(|_| Unavailable);
    }
    if args == ["--help"] {
        println!(
            "Usage: kelryvo-worker expiry-service|expiry-child PRIVATE_CONFIG\n       kelryvo-worker execution-service|execution-child PRIVATE_CONFIG\n       kelryvo-worker held-preview JOB_ID\n       kelryvo-worker held-confirm JOB_ID RECONCILIATION_ID\n       kelryvo-worker installation-client-check PRIVATE_INSTALLATION\n       kelryvo-worker installation-preflight|installation-record PRIVATE_INSTALLATION\n       kelryvo-worker installation-prepare PRIVATE_PREPARATION\n       kelryvo-worker installation-publish PRIVATE_PUBLICATION\n       kelryvo-worker installation-refresh PRIVATE_REFRESH\n       kelryvo-worker installation-observer PRIVATE_OBSERVER_REQUEST\n       kelryvo-worker installation-observer-scope PRIVATE_PREPARED_DIRECTORY\n       kelryvo-worker installation-watch PRIVATE_CONTROLLER\n       kelryvo-worker installation-init-witness PRIVATE_DIRECTORY\n       kelryvo-worker installation-init-state STATE_VOLUME_ROOT [NATIVE_ORACLE_ROOT]\nHeld completion requires OS UID 10002 and the fixed installed native configuration; it retains HOLD and never retries SQL. Installation commands require OS uid 0. Client-check validates reviewed artifacts and reports only offline client readiness; it opens no database session and grants no installation or execution authority. Prepare provisions the explicitly scoped principals, grants and ledger in a fresh private output directory; it never resumes partial DDL, drops accounts or activates a runtime. Preflight only reads Oracle catalogs; record appends metadata after fresh preflight. Publish stages fixed private inputs and records their installation under metadata guards, without restarting services. Refresh reuses existing principals/passwords and performs catalog preflight only. Observer requires a separate native qualification review, freshly preflights an already recorded installation and publishes its bound read-only discovery acceptance; it never provisions or registers an installation. Observer-scope prints the native review scope without creating approval or contacting Oracle. Watch observes one policy-bound instance, journals one setup attempt and publishes its writer/observer configuration; incomplete setup requires review and is never replayed. Init-state creates only fresh private state/witness directories or validates retained ones; an optional native Oracle root must have a root-owned client directory and a UID-10002-group private wallet. Lost state beside a retained witness requires review. Init-witness only hands off an empty root-owned private directory. None dispatches migrations. Execution service/child require OS uid 10002 and a reviewed native oracleInstallation; jobs cannot supply paths, credentials or host capabilities."
        );
        return Ok(());
    }
    if args.len() == 2 && args[0] == "installation-prepare" {
        let result = kelryvo_worker::preparation::run(Path::new(&args[1]))
            .await
            .map_err(|_| Unavailable)?;
        println!("{result}");
        return Ok(());
    }
    if args.len() == 2 && args[0] == "installation-watch" {
        return kelryvo_worker::controller::watch(Path::new(&args[1]))
            .await
            .map_err(|_| Unavailable);
    }
    if args.len() == 2 && args[0] == "installation-init-witness" {
        return kelryvo_worker::controller::init_witness(Path::new(&args[1]))
            .map_err(|_| Unavailable);
    }
    if (args.len() == 2 || args.len() == 3) && args[0] == "installation-init-state" {
        return kelryvo_worker::controller::init_state(
            Path::new(&args[1]),
            args.get(2).map(Path::new),
        )
        .map_err(|_| Unavailable);
    }
    if args.len() == 2 && args[0] == "installation-observer-scope" {
        println!(
            "{}",
            kelryvo_worker::publication::observer_review_scope(Path::new(&args[1]))
                .map_err(|_| Unavailable)?
        );
        return Ok(());
    }
    if args.len() == 2
        && [
            "installation-publish",
            "installation-refresh",
            "installation-observer",
        ]
        .contains(&args[0].as_str())
    {
        let result = if args[0] == "installation-publish" {
            kelryvo_worker::publication::publish(Path::new(&args[1])).await
        } else if args[0] == "installation-observer" {
            kelryvo_worker::publication::publish_observer(Path::new(&args[1])).await
        } else {
            kelryvo_worker::publication::refresh(Path::new(&args[1])).await
        }
        .map_err(|_| Unavailable)?;
        println!("{result}");
        return Ok(());
    }
    if args.len() == 2
        && ["installation-preflight", "installation-record"].contains(&args[0].as_str())
    {
        let result =
            kelryvo_worker::operator::run(Path::new(&args[1]), args[0] == "installation-record")
                .await
                .map_err(|_| Unavailable)?;
        println!("{result}");
        return Ok(());
    }
    if args.len() != 2
        || ![
            "expiry-service",
            "expiry-child",
            "execution-service",
            "execution-child",
        ]
        .contains(&args[0].as_str())
        || uid()? == 10001
    {
        return Err(Unavailable);
    }
    if args[0].starts_with("execution-") && uid()? != 10002 {
        return Err(Unavailable);
    }
    let path = PathBuf::from(&args[1]);
    let c = config(&path)?;
    if args[0].starts_with("expiry-") != (c.mode == "EXPIRE_ONLY") {
        return Err(Unavailable);
    }
    if args[0].ends_with("-child") {
        child(c).await
    } else {
        service(c, &path, None).await
    }
}
/// Internal fixed container role. The private stdin gate is released only after
/// API startup; it contains no configuration, SQL, credential or job authority.
async fn runtime_service() -> Result<(), Unavailable> {
    if uid()? != 10002 || std::io::stdin().is_terminal() {
        return Err(Unavailable);
    }
    let flag = |name: &str| match std::env::var(name).as_deref() {
        Ok("true") => Ok(true),
        Ok("false") => Ok(false),
        Err(std::env::VarError::NotPresent) => Ok(false),
        _ => Err(Unavailable),
    };
    let execution = flag("KELRYVO_EXECUTION_ENABLED")?;
    let discovery = flag("KELRYVO_DISCOVERY_ENABLED")?;
    let mut ready = [0];
    std::io::Read::read_exact(&mut std::io::stdin().lock(), &mut ready).map_err(|_| Unavailable)?;
    if ready != [1] {
        return Err(Unavailable);
    }
    let (stop, stopped) = watch::channel(false);
    let mut bridge = Box::pin(kelryvo_worker::discovery::serve(discovery, stopped.clone()));
    let mut control = Box::pin(async {
        if execution {
            let path = Path::new("/run/kelryvo/runtime/execution/worker.json");
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .map_err(|_| Unavailable)?;
            let mut waiting = false;
            let c = loop {
                if let Ok(c) = config(path) {
                    break c;
                }
                if !waiting {
                    eprintln!(
                        "{{\"status\":\"WAITING_FOR_NATIVE_INSTALLATION\",\"executionAuthority\":false}}"
                    );
                    waiting = true;
                }
                tokio::select! {
                    _=tokio::time::sleep(Duration::from_millis(1000))=>{},
                    _=term.recv()=>return Ok(()),
                    _=tokio::signal::ctrl_c()=>return Ok(()),
                    _=retirement(stopped.clone())=>return Ok(()),
                }
            };
            if c.mode != "ORACLE_EXECUTION" {
                return Err(Unavailable);
            }
            service(c, path, Some(stopped.clone())).await
        } else {
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .map_err(|_| Unavailable)?;
            tokio::select! { _ = term.recv() => {}, _ = tokio::signal::ctrl_c() => {}, _ = retirement(stopped.clone()) => {} }
            Ok(())
        }
    });
    tokio::select! {
        result = &mut control => {
            let _ = stop.send(true);
            let closed = bridge.await.map_err(|_| Unavailable);
            result.and(closed)
        },
        result = &mut bridge => {
            let _ = stop.send(true);
            let closed = control.await;
            result.map_err(|_| Unavailable).and(closed)
        },
    }
}
#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => {
            eprintln!("Worker unavailable; inspect retained history and private installation.");
            ExitCode::FAILURE
        }
    }
}
