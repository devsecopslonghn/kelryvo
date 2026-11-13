use super::*;
use tokio::sync::mpsc;

struct Echo {
    port: u16,
    messages: mpsc::Receiver<(u16, Vec<u8>)>,
    task: JoinHandle<()>,
}
impl Echo {
    async fn start() -> Self {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let port = listener.local_addr().unwrap().port();
        let (sender, messages) = mpsc::channel(32);
        let task = tokio::spawn(async move {
            let mut tasks = JoinSet::new();
            loop {
                tokio::select! {
                    Some(_)=tasks.join_next(),if !tasks.is_empty()=>{},
                    accepted=listener.accept()=>{let Ok((mut stream,address))=accepted else{return;};let sender=sender.clone();tasks.spawn(async move {
                        let mut bytes=[0;16384];loop {let Ok(count)=stream.read(&mut bytes).await else{return;};if count==0{return;}
                            if sender.send((address.port(),bytes[..count].to_vec())).await.is_err() || stream.write_all(&bytes[..count]).await.is_err(){return;}
                        }
                    });}
                }
            }
        });
        Self {
            port,
            messages,
            task,
        }
    }
    async fn message(&mut self) -> (u16, Vec<u8>) {
        tokio::time::timeout(Duration::from_secs(1), self.messages.recv())
            .await
            .unwrap()
            .unwrap()
    }
}
impl Drop for Echo {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn pending(proxy: &AckProxy, port: u16) {
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            let notified = proxy.pending.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if proxy.snapshot()["connections"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["upstreamPort"] == port && c["pendingBytes"].as_u64().unwrap() > 0)
            {
                return;
            }
            notified.await;
        }
    })
    .await
    .unwrap();
}
async fn client(proxy: &AckProxy) -> TcpStream {
    TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, proxy.port))
        .await
        .unwrap()
}
async fn read(stream: &mut TcpStream, size: usize) -> Vec<u8> {
    let mut bytes = vec![0; size];
    tokio::time::timeout(Duration::from_secs(1), stream.read_exact(&mut bytes))
        .await
        .unwrap()
        .unwrap();
    bytes
}
#[test]
fn wire_clock_stays_exact_above_javascript_integer_limit() {
    let wire = exact_clock_json(
        &json!({"connections":[{"pendingCapturedNs":1_000_000_000_000_000_013_u64,"upstreamPort":2485}],"negativeReadStartNs":1_000_000_000_000_000_007_u64,"oracleCommitProven":false}),
    );
    assert_eq!(
        wire["connections"][0]["pendingCapturedNs"],
        "1000000000000000013"
    );
    assert_eq!(wire["negativeReadStartNs"], "1000000000000000007");
    assert_eq!(wire["connections"][0]["upstreamPort"], 2485);
    assert_eq!(wire["oracleCommitProven"], false);
}
#[tokio::test]
async fn binary_forwarding_preserves_multiple_connections() {
    let echo = Echo::start().await;
    let proxy = AckProxy::start(echo.port, Duration::from_millis(150), 0)
        .await
        .unwrap();
    proxy.pass_responses();
    for payload in [
        b"\x16\x03\x03\x00\x07opaque\x00".as_slice(),
        b"other-stream\xff\x00".as_slice(),
    ] {
        let mut stream = client(&proxy).await;
        stream.write_all(payload).await.unwrap();
        assert_eq!(read(&mut stream, payload.len()).await, payload);
    }
    assert_eq!(proxy.snapshot()["cuts"], 0);
    proxy.close().await.unwrap();
}
#[tokio::test]
async fn pending_response_is_withheld_once_and_later_connections_pass() {
    let mut echo = Echo::start().await;
    let proxy = AckProxy::start(echo.port, Duration::from_millis(150), 0)
        .await
        .unwrap();
    let mut stream = client(&proxy).await;
    let negative = monotonic_ns();
    stream
        .write_all(b"committed-response-canary")
        .await
        .unwrap();
    let (port, _) = echo.message().await;
    pending(&proxy, port).await;
    let proof = proxy.cut(port, negative).unwrap();
    assert_eq!(proof["oracleCommitProven"], false);
    assert!(proof["withheldBytes"].as_u64().unwrap() > 0);
    let mut bytes = [0; 16];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), stream.read(&mut bytes))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    assert!(proxy.cut(port, negative).is_err());
    let mut fresh = client(&proxy).await;
    fresh.write_all(b"fresh-connection").await.unwrap();
    assert_eq!(read(&mut fresh, 16).await, b"fresh-connection");
    assert_eq!(proxy.snapshot()["cuts"], 1);
    proxy.close().await.unwrap();
}
#[tokio::test]
async fn forwarded_response_refuses_fault_and_preserves_connection() {
    let mut echo = Echo::start().await;
    let proxy = AckProxy::start(echo.port, Duration::from_millis(150), 0)
        .await
        .unwrap();
    proxy.pass_responses();
    let mut stream = client(&proxy).await;
    let negative = monotonic_ns();
    stream.write_all(b"forwarded").await.unwrap();
    let (port, _) = echo.message().await;
    assert_eq!(read(&mut stream, 9).await, b"forwarded");
    proxy.arm(port).unwrap();
    stream.write_all(b"pending").await.unwrap();
    echo.message().await;
    pending(&proxy, port).await;
    assert!(proxy.cut(port, negative).is_err());
    assert_eq!(read(&mut stream, 7).await, b"pending");
    assert_eq!(proxy.snapshot()["cuts"], 0);
    proxy.close().await.unwrap();
}
#[tokio::test]
async fn selected_cut_preserves_the_other_connection() {
    let mut echo = Echo::start().await;
    let proxy = AckProxy::start(echo.port, Duration::from_millis(150), 0)
        .await
        .unwrap();
    let mut first = client(&proxy).await;
    let mut other = client(&proxy).await;
    let negative = monotonic_ns();
    first.write_all(b"ledger").await.unwrap();
    let (first_port, payload) = echo.message().await;
    assert_eq!(payload, b"ledger");
    other.write_all(b"observer").await.unwrap();
    let (other_port, _) = echo.message().await;
    assert_ne!(first_port, other_port);
    pending(&proxy, first_port).await;
    pending(&proxy, other_port).await;
    proxy.cut(first_port, negative).unwrap();
    let mut bytes = [0; 16];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(1), first.read(&mut bytes))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    assert_eq!(read(&mut other, 8).await, b"observer");
    proxy.close().await.unwrap();
}
#[tokio::test]
async fn concurrent_connections_are_bounded_before_upstream_connect() {
    let echo = Echo::start().await;
    let proxy = AckProxy::start(echo.port, Duration::from_millis(150), 0)
        .await
        .unwrap();
    proxy.pass_responses();
    let mut clients = Vec::new();
    for _ in 0..9 {
        clients.push(client(&proxy).await);
    }
    let mut tasks = Vec::new();
    for mut stream in clients {
        tasks.push(tokio::spawn(async move {
            if stream.write_all(b"x").await.is_err() {
                return vec![];
            }
            let mut byte = [0; 1];
            match tokio::time::timeout(Duration::from_secs(1), stream.read(&mut byte)).await {
                Ok(Ok(1)) => byte.to_vec(),
                _ => vec![],
            }
        }));
    }
    let mut forwarded = 0;
    let mut rejected = 0;
    for task in tasks {
        match task.await.unwrap().as_slice() {
            b"x" => forwarded += 1,
            [] => rejected += 1,
            _ => panic!("unexpected opaque transport response"),
        }
    }
    assert_eq!((forwarded, rejected), (8, 1));
    assert_eq!(proxy.snapshot()["rejected"], 1);
    proxy.close().await.unwrap();
}
