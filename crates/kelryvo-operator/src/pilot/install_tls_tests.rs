//! Exercise the actual default pilot certificate with a strict Rust TLS client.
use super::*;
use openssl::ssl::{SslAcceptor, SslMethod};
use std::{
    io::{Read, Write},
    net::{Ipv4Addr, TcpListener},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

struct LocalTls {
    address: std::net::SocketAddr,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<usize>>,
}
impl Drop for LocalTls {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            thread.join().expect("local TLS fixture terminated");
        }
    }
}
impl LocalTls {
    fn start(cert: &[u8], key: &[u8]) -> Self {
        let mut acceptor = SslAcceptor::mozilla_intermediate_v5(SslMethod::tls_server()).unwrap();
        acceptor
            .set_private_key(&PKey::private_key_from_pem(key).unwrap())
            .unwrap();
        acceptor
            .set_certificate(&X509::from_pem(cert).unwrap())
            .unwrap();
        acceptor.check_private_key().unwrap();
        let acceptor = acceptor.build();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let thread = thread::spawn(move || {
            let mut requests = 0;
            let deadline = Instant::now() + Duration::from_secs(20);
            while !stopped.load(Ordering::Acquire) && Instant::now() < deadline {
                let stream = match listener.accept() {
                    Ok((stream, peer)) => {
                        assert!(peer.ip().is_loopback());
                        stream
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                        continue;
                    }
                    Err(error) => panic!("local TLS accept: {error}"),
                };
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                stream
                    .set_write_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let Ok(mut stream) = acceptor.accept(stream) else {
                    continue;
                };
                let mut request = Vec::new();
                let mut byte = [0; 1];
                while request.len() < 4096 && !request.ends_with(b"\r\n\r\n") {
                    if stream.read_exact(&mut byte).is_err() {
                        break;
                    }
                    request.push(byte[0]);
                }
                if request.starts_with(b"GET /api/readyz HTTP/1.1\r\n")
                    && request.ends_with(b"\r\n\r\n")
                {
                    requests += 1;
                    stream
                        .write_all(
                            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nOK",
                        )
                        .unwrap();
                    stream.flush().unwrap();
                }
            }
            requests
        });
        Self {
            address,
            stop,
            thread: Some(thread),
        }
    }
}

#[tokio::test]
async fn default_pilot_certificate_supports_verified_rust_https_and_refuses_wrong_trust_and_names()
{
    let (certificate, key) = certificate().unwrap();
    let mut server = LocalTls::start(&certificate, &key);
    let client = reqwest::Client::builder()
        .no_proxy()
        .tls_built_in_root_certs(false)
        .add_root_certificate(reqwest::Certificate::from_pem(&certificate).unwrap())
        .resolve("localhost", server.address)
        .resolve("wrong-host.invalid", server.address)
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    for host in ["127.0.0.1", "localhost"] {
        let response = client
            .get(format!(
                "https://{host}:{}/api/readyz",
                server.address.port()
            ))
            .send()
            .await;
        assert!(
            response.is_ok(),
            "default pilot certificate must pass strict TLS validation: {response:?}"
        );
        let response = response.unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        assert_eq!(response.text().await.unwrap(), "OK");
    }
    assert!(
        client
            .get(format!(
                "https://wrong-host.invalid:{}/api/readyz",
                server.address.port()
            ))
            .send()
            .await
            .is_err()
    );
    let untrusted = reqwest::Client::builder()
        .no_proxy()
        .tls_built_in_root_certs(false)
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    assert!(
        untrusted
            .get(format!("https://{}/api/readyz", server.address))
            .send()
            .await
            .is_err()
    );
    server.stop.store(true, Ordering::Release);
    assert_eq!(
        server.thread.take().unwrap().join().unwrap(),
        2,
        "invalid TLS peers never send an HTTP request"
    );
}
