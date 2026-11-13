//! A private loopback HTTP registry, never a production endpoint override.
use super::*;
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
type Replies = Arc<Mutex<BTreeMap<String, (u16, Vec<u8>, Vec<(String, String)>)>>>;
type Requests = Arc<Mutex<Vec<String>>>;
fn body(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
fn hash(bytes: &[u8]) -> String {
    format!("sha256:{}", sha256(bytes))
}
fn reply(bytes: Vec<u8>) -> (u16, Vec<u8>, Vec<(String, String)>) {
    let digest = hash(&bytes);
    (200, bytes, vec![("docker-content-digest".into(), digest)])
}
fn fixture() -> (Replies, Value) {
    let mut routes = BTreeMap::new();
    routes.insert(
        "/token".into(),
        reply(body(&json!({"token":"private-session-fixture"}))),
    );
    let mut descriptors = Vec::new();
    for arch in ["amd64", "arm64"] {
        let config = body(
            &json!({"architecture":arch,"os":"linux","config":{"User":"0:0","Entrypoint":["/opt/kelryvo/bin/kelryvo-runtime"],"Labels":{"org.opencontainers.image.revision":SHA,"org.opencontainers.image.source":"https://github.com/devsecopslonghn/kelryvo"}}}),
        );
        let config_hash = hash(&config);
        let manifest = body(
            &json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"digest":config_hash,"size":config.len()},"layers":[]}),
        );
        descriptors.push(json!({"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":hash(&manifest),"size":manifest.len(),"platform":{"os":"linux","architecture":arch}}));
        routes.insert(
            format!("/v2/{REPOSITORY}/blobs/{config_hash}"),
            reply(config),
        );
        routes.insert(
            format!("/v2/{REPOSITORY}/manifests/{}", hash(&manifest)),
            reply(manifest),
        );
    }
    let index = json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":descriptors});
    routes.insert(
        format!("/v2/{REPOSITORY}/manifests/test-tag"),
        reply(body(&index)),
    );
    (Arc::new(Mutex::new(routes)), index)
}
async fn server(routes: Replies) -> (std::net::SocketAddr, Requests, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let observed = seen.clone();
    let handle = tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let mut b = [0; 1024];
                let n = stream.read(&mut b).await.unwrap();
                assert!(n > 0 && request.len() + n <= 16384);
                request.extend_from_slice(&b[..n]);
            }
            let request = String::from_utf8(request).unwrap();
            let route = request
                .split_whitespace()
                .nth(1)
                .unwrap()
                .split('?')
                .next()
                .unwrap();
            let (status, body, headers) = routes.lock().unwrap().get(route).cloned().unwrap_or((
                404,
                b"private missing body".to_vec(),
                Vec::new(),
            ));
            observed.lock().unwrap().push(request);
            let mut response = format!(
                "HTTP/1.1 {status} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n",
                body.len()
            );
            for (name, value) in headers {
                response.push_str(&format!("{name}: {value}\r\n"));
            }
            response.push_str("\r\n");
            stream.write_all(response.as_bytes()).await.unwrap();
            stream.write_all(&body).await.unwrap();
        }
    });
    (addr, seen, handle)
}
fn local(addr: std::net::SocketAddr) -> Ghcr {
    let base = format!("http://{addr}");
    Ghcr {
        client: client(false).unwrap(),
        actor: Zeroizing::new("native-fixture".into()),
        credential: Zeroizing::new("private-unit-token".into()),
        token: None,
        base: base.clone(),
        redirects: vec![format!("{base}/")],
    }
}
#[tokio::test]
async fn registry_reads_bind_bytes_roles_and_platforms_and_strip_auth_from_blob_redirects() {
    let (routes, index) = fixture();
    let config_path = routes
        .lock()
        .unwrap()
        .keys()
        .find(|p| p.contains("/blobs/"))
        .unwrap()
        .clone();
    let original = routes.lock().unwrap()[&config_path].clone();
    routes
        .lock()
        .unwrap()
        .insert("/cdn-config".into(), original);
    routes.lock().unwrap().insert(
        config_path,
        (
            302,
            Vec::new(),
            vec![("location".into(), "/cdn-config".into())],
        ),
    );
    let (addr, seen, handle) = server(routes.clone()).await;
    let mut registry = local(addr);
    let remote = registry.read("test-tag", false).await.unwrap().unwrap();
    assert_eq!(verify(&remote, SHA, None).unwrap(), hash(&body(&index)));
    let observed = seen.lock().unwrap().clone();
    assert!(observed.iter().all(|r| r.starts_with("GET ")));
    assert!(
        observed
            .iter()
            .find(|r| r.starts_with("GET /token?"))
            .unwrap()
            .contains("authorization: Basic ")
    );
    assert!(
        observed
            .iter()
            .filter(|r| r.contains("GET /v2/"))
            .all(|r| r.contains("authorization: Bearer private-session-fixture"))
    );
    assert!(
        !observed
            .iter()
            .find(|r| r.starts_with("GET /cdn-config "))
            .unwrap()
            .to_ascii_lowercase()
            .contains("authorization:")
    );
    assert!(registry.read("missing-tag", true).await.unwrap().is_none());
    let root = format!("/v2/{REPOSITORY}/manifests/test-tag");
    routes.lock().unwrap().insert(
        root.clone(),
        (403, b"private-unit-token response".to_vec(), Vec::new()),
    );
    let error = registry.read("test-tag", true).await.unwrap_err();
    assert!(error.contains("HTTP 403") && !error.contains("private"));
    let mut bad = reply(body(&index));
    bad.2[0].1 = format!("sha256:{}", "0".repeat(64));
    routes.lock().unwrap().insert(root, bad);
    assert!(
        registry
            .read("test-tag", false)
            .await
            .unwrap_err()
            .contains("digest mismatch")
    );
    let mut changed = remote.clone();
    changed["platforms"]["arm64"]["config"]["config"]["Labels"]["org.opencontainers.image.revision"] =
        "b".repeat(40).into();
    assert!(verify(&changed, SHA, None).is_err());
    assert!(!registry.redirect(
        &Url::parse("https://pkg-containers.githubusercontent.com.evil.invalid/blob").unwrap()
    ));
    assert!(!registry.redirect(
        &Url::parse("https://user:private@pkg-containers.githubusercontent.com/blob").unwrap()
    ));
    handle.abort();
}
