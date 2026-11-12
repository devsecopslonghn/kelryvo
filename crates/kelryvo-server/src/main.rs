use kelryvo_server::{
    AppState,
    config::Config,
    connect, initialize,
    lifecycle::{self, Event, StartupCode},
    router,
};
use std::{
    future::Future,
    io::{IsTerminal, Write},
    net::SocketAddr,
    process::ExitCode,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{sync::watch, task::JoinHandle};

fn failed(code: StartupCode) -> Event {
    Event::StartupFailed(code)
}
fn notify_runtime(enabled: bool) -> Result<(), Event> {
    if enabled {
        let mut out = std::io::stdout().lock();
        out.write_all(kelryvo_core::RUNTIME_API_READY)
            .map_err(|_| failed(StartupCode::StartupUnavailable))?;
        out.flush()
            .map_err(|_| failed(StartupCode::StartupUnavailable))?;
    }
    Ok(())
}
/// Register both signals before startup I/O. The watchdog bounds API shutdown;
/// it never restarts a role, retries SQL or supplies worker execution authority.
struct Shutdown {
    stopped: watch::Receiver<bool>,
    transition: Arc<Mutex<bool>>,
    task: JoinHandle<()>,
}
impl Shutdown {
    fn new() -> Result<Self, Event> {
        use tokio::signal::unix::{SignalKind, signal};
        let mut terminate =
            signal(SignalKind::terminate()).map_err(|_| failed(StartupCode::StartupUnavailable))?;
        let mut interrupt =
            signal(SignalKind::interrupt()).map_err(|_| failed(StartupCode::StartupUnavailable))?;
        let (sender, stopped) = watch::channel(false);
        let transition = Arc::new(Mutex::new(false));
        let stopping = transition.clone();
        Event::StartupStarted.write();
        let task = tokio::spawn(async move {
            tokio::select! { _=terminate.recv()=>{}, _=interrupt.recv()=>{} }
            {
                let mut stopped = stopping.lock().unwrap_or_else(|e| e.into_inner());
                *stopped = true;
                Event::ShutdownStarted.write();
                sender.send_replace(true);
            }
            tokio::time::sleep(Duration::from_secs(25)).await;
            Event::ShutdownTimeout.write();
            std::process::exit(1);
        });
        Ok(Self {
            stopped,
            transition,
            task,
        })
    }
    fn announce(&self, runtime: bool) -> Result<bool, Event> {
        // Serialize announcement with signal handling: ready and the private
        // worker gate must never follow a recorded shutdown transition.
        let stopped = self
            .transition
            .lock()
            .map_err(|_| failed(StartupCode::StartupUnavailable))?;
        if *stopped {
            return Ok(false);
        }
        notify_runtime(runtime)?;
        Event::StartupReady.write();
        Ok(true)
    }
    fn is_stopped(&self) -> bool {
        *self.stopped.borrow()
    }
    fn wait(&self) -> impl Future<Output = ()> + Send + 'static {
        let mut stopped = self.stopped.clone();
        async move {
            while !*stopped.borrow_and_update() {
                if stopped.changed().await.is_err() {
                    return;
                }
            }
        }
    }
    fn failure(&self) -> Event {
        if self.is_stopped() {
            Event::ShutdownFailed
        } else {
            failed(StartupCode::ListenUnavailable)
        }
    }
}
impl Drop for Shutdown {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn run() -> Result<(), Event> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args == ["--build-info"] {
        println!("{}", kelryvo_core::build_identity::info());
        return Ok(());
    }
    if args.iter().any(|a| a == "--help") {
        println!(
            "Usage: kelryvo-server [--initialize]\n\nConfiguration: KELRYVO_SECRET_DIR, KELRYVO_BIND_HOST, KELRYVO_PORT, KELRYVO_WEB_DIRECTORY.\n--initialize applies the compatible metadata schema and exits; it never runs on server startup."
        );
        return Ok(());
    }
    let runtime = args == ["--runtime-api"];
    if !(args.is_empty() || args == ["--initialize"] || runtime) {
        return Err(failed(StartupCode::ConfigurationUnavailable));
    }
    if runtime
        && (kelryvo_server::config::process_uid()
            .map_err(|_| failed(StartupCode::ConfigurationUnavailable))?
            != 10001
            || std::io::stdout().is_terminal())
    {
        return Err(failed(StartupCode::ConfigurationUnavailable));
    }
    if args == ["--initialize"] {
        if [10001, 10002].contains(
            &kelryvo_server::config::process_uid()
                .map_err(|_| failed(StartupCode::ConfigurationUnavailable))?,
        ) {
            return Err(failed(StartupCode::ConfigurationUnavailable));
        }
        let config = Config::load()
            .await
            .map_err(|_| failed(StartupCode::ConfigurationUnavailable))?;
        let pool = connect(&config.database_url)
            .await
            .map_err(|_| failed(StartupCode::MetadataUnavailable))?;
        initialize(&pool)
            .await
            .map_err(|_| failed(StartupCode::MetadataUnavailable))?;
        pool.close().await;
        return Ok(());
    }
    let shutdown = Shutdown::new()?;
    let config = tokio::select! {
        result=Config::load()=>result.map_err(|_|failed(StartupCode::ConfigurationUnavailable))?,
        _=shutdown.wait()=>return Ok(()),
    };
    let pool = tokio::select! {
        result=connect(&config.database_url)=>result.map_err(|_|failed(StartupCode::MetadataUnavailable))?,
        _=shutdown.wait()=>return Ok(()),
    };
    let assets = tokio::select! {
        result=lifecycle::web_assets(&config.web_root)=>Some(result),
        _=shutdown.wait()=>None,
    };
    let Some(assets) = assets else {
        pool.close().await;
        Event::ShutdownComplete.write();
        return Ok(());
    };
    assets?;
    let tls = config.tls.is_some();
    let mut state = AppState::new(pool.clone(), tls);
    state.identity = config.identity.map(std::sync::Arc::new);
    state.repositories = std::sync::Arc::new(config.repositories);
    state.vault_public_key = config.vault_public_key.map(std::sync::Arc::new);
    if runtime {
        state.discovery = kelryvo_server::discovery::installed();
    }
    let app = router(state, config.web_root);
    if let Some((cert, key)) = config.tls {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem(cert, key)
            .await
            .map_err(|_| failed(StartupCode::ConfigurationUnavailable))?;
        let handle = axum_server::Handle::new();
        let listener = std::net::TcpListener::bind(config.address)
            .map_err(|_| failed(StartupCode::ListenUnavailable))?;
        listener
            .set_nonblocking(true)
            .map_err(|_| failed(StartupCode::ListenUnavailable))?;
        let server = axum_server::from_tcp_rustls(listener, tls_config)
            .map_err(|_| failed(StartupCode::ListenUnavailable))?
            .handle(handle.clone());
        if !shutdown.announce(runtime)? {
            pool.close().await;
            Event::ShutdownComplete.write();
            return Ok(());
        }
        let serving = server.serve(app.into_make_service_with_connect_info::<SocketAddr>());
        tokio::pin!(serving);
        let result = tokio::select! {
            result=&mut serving=>result,
            _=shutdown.wait()=>{handle.graceful_shutdown(Some(Duration::from_secs(10)));serving.await},
        };
        result.map_err(|_| shutdown.failure())?;
    } else {
        let listener = tokio::net::TcpListener::bind(config.address)
            .await
            .map_err(|_| failed(StartupCode::ListenUnavailable))?;
        if !shutdown.announce(runtime)? {
            pool.close().await;
            Event::ShutdownComplete.write();
            return Ok(());
        }
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(shutdown.wait())
        .await
        .map_err(|_| shutdown.failure())?;
    }
    pool.close().await;
    Event::ShutdownComplete.write();
    Ok(())
}
#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(event) => {
            event.write();
            ExitCode::FAILURE
        }
    }
}
