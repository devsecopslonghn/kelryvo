//! Actual local Unix sockets and credentials; no database, Oracle or root role.
use kelryvo_discovery::{
    Client, Handler, HandlerResult, Limits, Operation, REQUEST_BYTES, Request, serve,
};
use serde_json::json;
use std::{
    fs,
    os::unix::fs::{DirBuilderExt, MetadataExt},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    sync::watch,
};
use uuid::Uuid;
fn fixture() -> (PathBuf, u32) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.cache")
        .canonicalize()
        .unwrap()
        .join(format!("discovery-ipc-{}", Uuid::new_v4()));
    fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
    (
        root.join("socket"),
        fs::metadata("/proc/self").unwrap().uid(),
    )
}
fn request(operation: Operation) -> Request {
    let mut c = json!({"id":Uuid::new_v4(),"revision":"7","engine":"oracle","host":"127.0.0.1","port":2484,"service":"APP","transport":"TCPS","username":"APP","credentialRef":"vault://kelryvo/retained","credentialMode":"INSTANCE_MASTER"});
    if operation == Operation::Schema {
        c["owner"] = json!("APP");
    }
    Request::new(c, operation).unwrap()
}
struct Echo {
    seen: Arc<Mutex<Vec<Request>>>,
}
impl Handler for Echo {
    fn run(&self, request: Request, _: watch::Receiver<bool>) -> HandlerResult {
        self.seen.lock().unwrap().push(request.clone());
        Box::pin(async move {
            Ok(
                json!({"status":if request.operation == Operation::Test {"CONNECTED"} else {"PARTIAL"},"provenance":"FIXTURE","password":"must not cross IPC","schema":{"owner":request.owner,"objects":[],"coverage":{},"limitations":[]}}),
            )
        })
    }
}
#[tokio::test]
async fn real_socket_checks_both_peer_uids_and_transports_only_bounded_evidence() {
    let (path, uid) = fixture();
    let listener = UnixListener::bind(&path).unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let (stop, stopped) = watch::channel(false);
    let server = tokio::spawn(serve(
        listener,
        uid,
        Arc::new(Echo { seen: seen.clone() }),
        stopped,
        Limits {
            io: Duration::from_millis(200),
        },
    ));
    let client = Client::new(path.clone(), uid, Duration::from_secs(1)).unwrap();
    let test = client.run(request(Operation::Test)).await.unwrap();
    assert_eq!(test["status"], "CONNECTED");
    assert_eq!(test["provenance"], "FIXTURE");
    assert!(test.get("password").is_none());
    assert!(test["verificationAcceptance"].is_null());
    let schema = client.run(request(Operation::Schema)).await.unwrap();
    assert_eq!(schema["schema"]["owner"], "APP");
    assert_eq!(seen.lock().unwrap()[1].owner.as_deref(), Some("APP"));
    let impostor = Client::new(path.clone(), uid + 1, Duration::from_secs(1)).unwrap();
    assert!(impostor.run(request(Operation::Test)).await.is_err());
    for raw in [json!({"version":1,"id":Uuid::new_v4(),"connection":{},"operation":"EXECUTE","sql":"DROP USER APP"}).to_string().into_bytes(), vec![b'x'; REQUEST_BYTES + 1]] {
        let mut peer = UnixStream::connect(&path).await.unwrap();
        let _ = peer.write_all(&raw).await; let _ = peer.shutdown().await;
        let mut reply = Vec::new(); let _ = peer.read_to_end(&mut reply).await;
        assert!(reply.is_empty());
    }
    assert_eq!(seen.lock().unwrap().len(), 2);
    stop.send(true).unwrap();
    server.await.unwrap().unwrap();

    let (path, uid) = fixture();
    let listener = UnixListener::bind(&path).unwrap();
    let (stop, stopped) = watch::channel(false);
    let server = tokio::spawn(serve(
        listener,
        uid + 1,
        Arc::new(Echo { seen: seen.clone() }),
        stopped,
        Limits::default(),
    ));
    assert!(
        Client::new(path, uid, Duration::from_secs(1))
            .unwrap()
            .run(request(Operation::Test))
            .await
            .is_err()
    );
    assert_eq!(seen.lock().unwrap().len(), 2);
    stop.send(true).unwrap();
    server.await.unwrap().unwrap();
}
struct Blocked {
    active: Arc<AtomicUsize>,
    settled: Arc<AtomicUsize>,
}
impl Handler for Blocked {
    fn run(&self, _: Request, mut stopped: watch::Receiver<bool>) -> HandlerResult {
        self.active.fetch_add(1, Ordering::SeqCst);
        let settled = self.settled.clone();
        Box::pin(async move {
            while !*stopped.borrow_and_update() {
                if stopped.changed().await.is_err() {
                    break;
                }
            }
            settled.fetch_add(1, Ordering::SeqCst);
            Ok(kelryvo_discovery::unavailable())
        })
    }
}
#[tokio::test]
async fn client_timeouts_keep_both_worker_slots_until_handlers_settle_on_shutdown() {
    let (path, uid) = fixture();
    let listener = UnixListener::bind(&path).unwrap();
    let active = Arc::new(AtomicUsize::new(0));
    let settled = Arc::new(AtomicUsize::new(0));
    let (stop, stopped) = watch::channel(false);
    let server = tokio::spawn(serve(
        listener,
        uid,
        Arc::new(Blocked {
            active: active.clone(),
            settled: settled.clone(),
        }),
        stopped,
        Limits {
            io: Duration::from_millis(100),
        },
    ));
    let client = Client::new(path, uid, Duration::from_millis(100)).unwrap();
    let first = tokio::spawn({
        let c = client.clone();
        async move { c.run(request(Operation::Discover)).await }
    });
    let second = tokio::spawn({
        let c = client.clone();
        async move { c.run(request(Operation::Discover)).await }
    });
    tokio::time::timeout(Duration::from_secs(1), async {
        while active.load(Ordering::SeqCst) != 2 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(first.await.unwrap().is_err());
    assert!(second.await.unwrap().is_err());
    assert_eq!(settled.load(Ordering::SeqCst), 0);
    assert!(client.run(request(Operation::Test)).await.is_err());
    assert_eq!(active.load(Ordering::SeqCst), 2);
    stop.send(true).unwrap();
    tokio::time::timeout(Duration::from_secs(1), server)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(settled.load(Ordering::SeqCst), 2);
}
