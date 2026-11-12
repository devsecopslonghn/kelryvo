//! Fixed-origin, bounded GitHub clients. API responses and request
//! credentials are never included in diagnostics or followed across redirects.
use super::{LIMIT, REPOSITORY, Reader, Result};
use reqwest::{
    Client,
    header::{ACCEPT, AUTHORIZATION, HeaderMap, HeaderValue, USER_AGENT},
};
use serde_json::Value;
use std::time::Duration;
use zeroize::Zeroizing;
pub(super) struct GitHub {
    client: Client,
    base: String,
}
impl GitHub {
    pub(super) fn new(token: &str) -> Result<Self> {
        Self::build(
            token,
            format!("https://api.github.com/repos/{REPOSITORY}/"),
            true,
        )
    }
    fn build(token: &str, base: String, https: bool) -> Result<Self> {
        if token.is_empty() || token.len() > 16384 {
            return Err("Missing or invalid GitHub credential".into());
        }
        let bearer = Zeroizing::new(format!("Bearer {token}"));
        let mut auth =
            HeaderValue::from_str(&bearer).map_err(|_| "Invalid GitHub credential header")?;
        auth.set_sensitive(true);
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, auth);
        headers.insert(
            ACCEPT,
            HeaderValue::from_static("application/vnd.github+json"),
        );
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static("kelryvo-native-delivery/0.1"),
        );
        headers.insert(
            "x-github-api-version",
            HeaderValue::from_static("2022-11-28"),
        );
        let client = Client::builder()
            .default_headers(headers)
            .no_proxy()
            .https_only(https)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .min_tls_version(reqwest::tls::Version::TLS_1_2)
            .build()
            .map_err(|_| "Cannot initialize GitHub HTTPS client")?;
        Ok(Self { client, base })
    }
    #[cfg(test)]
    pub(super) fn local(token: &str, address: std::net::SocketAddr) -> Result<Self> {
        assert!(address.ip().is_loopback());
        Self::build(
            token,
            format!("http://{address}/repos/{REPOSITORY}/"),
            false,
        )
    }
}
impl GitHub {
    async fn request(
        &self,
        method: reqwest::Method,
        route: &str,
        body: Option<&Value>,
        missing: bool,
    ) -> Result<Option<Value>> {
        if route.is_empty()
            || route.len() > 4096
            || route.starts_with('/')
            || !route
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"/?&=._-".contains(&b))
            || route
                .split('?')
                .next()
                .unwrap_or_default()
                .split('/')
                .any(|s| s == "." || s == "..")
        {
            return Err("Invalid GitHub API route".into());
        }
        let verb = method.as_str().to_owned();
        let mut request = self.client.request(method, format!("{}{route}", self.base));
        if let Some(body) = body {
            let bytes = serde_json::to_vec(body).map_err(|_| "Cannot encode GitHub request")?;
            if bytes.len() as u64 > LIMIT {
                return Err("GitHub request exceeds the input limit".into());
            }
            request = request
                .header("content-type", "application/json")
                .body(bytes);
        }
        let mut response = request.send().await.map_err(|_| {
            format!("GitHub {verb} unavailable; check connectivity and token permissions")
        })?;
        if missing && response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(format!(
                "GitHub {verb} failed (HTTP {}); check token permissions or service availability",
                response.status().as_u16()
            ));
        }
        if response.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(Some(Value::Null));
        }
        if response.content_length().is_some_and(|n| n > LIMIT) {
            return Err("GitHub response exceeds the input limit".into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "Cannot read GitHub response")?
        {
            if bytes.len() as u64 + chunk.len() as u64 > LIMIT {
                return Err("GitHub response exceeds the input limit".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Some(
            serde_json::from_slice(&bytes).map_err(|_| "Invalid GitHub JSON response")?,
        ))
    }
}
impl Reader for GitHub {
    async fn get(&mut self, route: &str) -> Result<Value> {
        self.request(reqwest::Method::GET, route, None, false)
            .await?
            .ok_or_else(|| "Missing GitHub response".into())
    }
}
pub(super) struct Chart {
    http: GitHub,
}
impl Chart {
    pub(super) fn new(token: &str) -> Result<Self> {
        Ok(Self {
            http: GitHub::build(
                token,
                format!("https://api.github.com/repos/{}/", super::helm::REPOSITORY),
                true,
            )?,
        })
    }
    #[cfg(test)]
    pub(super) fn local(token: &str, address: std::net::SocketAddr) -> Result<Self> {
        assert!(address.ip().is_loopback());
        Ok(Self {
            http: GitHub::build(
                token,
                format!("http://{address}/repos/{}/", super::helm::REPOSITORY),
                false,
            )?,
        })
    }
}
impl super::helm::Api for Chart {
    async fn get(&mut self, route: &str, missing: bool) -> Result<Option<Value>> {
        self.http
            .request(reqwest::Method::GET, route, None, missing)
            .await
    }
    async fn write(
        &mut self,
        method: super::helm::Write,
        route: &str,
        body: &Value,
    ) -> Result<Value> {
        self.http
            .request(
                match method {
                    super::helm::Write::Create => reqwest::Method::POST,
                    super::helm::Write::Update => reqwest::Method::PATCH,
                },
                route,
                Some(body),
                false,
            )
            .await?
            .ok_or_else(|| "Missing chart API response".into())
    }
}

#[cfg(test)]
mod chart_tests {
    use super::*;
    use crate::delivery::helm::{Api, Write};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    async fn server(
        reply: Option<(u16, &str)>,
    ) -> (std::net::SocketAddr, tokio::task::JoinHandle<String>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let response = reply.map(|(code, body)| {
            format!(
                "HTTP/1.1 {code} Fixture\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            )
        });
        let handle = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                    let header = String::from_utf8_lossy(&bytes[..end]);
                    let length = header
                        .lines()
                        .filter_map(|l| l.split_once(':'))
                        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                        .map_or(0, |(_, v)| v.trim().parse::<usize>().unwrap());
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
                let mut b = [0; 4096];
                let n = stream.read(&mut b).await.unwrap();
                assert!(n > 0 && bytes.len() + n <= 16384);
                bytes.extend_from_slice(&b[..n]);
            }
            if let Some(response) = response {
                stream.write_all(response.as_bytes()).await.unwrap();
            } else {
                drop(stream);
                assert!(
                    tokio::time::timeout(Duration::from_millis(100), listener.accept())
                        .await
                        .is_err(),
                    "uncertain GitHub write must not reconnect/retry"
                );
            }
            String::from_utf8(bytes).unwrap()
        });
        (addr, handle)
    }
    #[tokio::test]
    async fn chart_requests_bind_repository_method_body_and_never_retry_unknown_writes() {
        let token = "private-chart-fixture";
        let (addr, seen) = server(Some((200, r#"{"status":"ahead"}"#))).await;
        let route = format!("compare/{}...{}", "b".repeat(40), "a".repeat(40));
        assert_eq!(
            GitHub::local(token, addr)
                .unwrap()
                .get(&route)
                .await
                .unwrap()["status"],
            "ahead"
        );
        assert!(
            seen.await
                .unwrap()
                .starts_with(&format!("GET /repos/{REPOSITORY}/{route} HTTP/1.1"))
        );
        let (addr, seen) = server(Some((
            201,
            r#"{"sha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#,
        )))
        .await;
        Chart::local(token, addr)
            .unwrap()
            .write(Write::Create, "git/trees", &serde_json::json!({"tree":[]}))
            .await
            .unwrap();
        let request = seen.await.unwrap();
        assert!(request.starts_with(&format!(
            "POST /repos/{}/git/trees HTTP/1.1",
            crate::delivery::helm::REPOSITORY
        )));
        assert!(request.contains(&format!("authorization: Bearer {token}")));
        assert!(request.ends_with(r#"{"tree":[]}"#));
        let (addr, seen) = server(Some((404, "private response"))).await;
        assert!(
            Chart::local(token, addr)
                .unwrap()
                .get("git/ref/heads/automation/absent", true)
                .await
                .unwrap()
                .is_none()
        );
        seen.await.unwrap();
        let (addr, seen) = server(Some((403, "private response"))).await;
        let error = Chart::local(token, addr)
            .unwrap()
            .get("git/ref/heads/automation/absent", true)
            .await
            .unwrap_err();
        seen.await.unwrap();
        assert!(error.contains("HTTP 403") && !error.contains("private"));
        let (addr, seen) = server(None).await;
        let error = Chart::local(token, addr)
            .unwrap()
            .write(
                Write::Update,
                "git/refs/heads/master",
                &serde_json::json!({"force":false}),
            )
            .await
            .unwrap_err();
        let request = seen.await.unwrap();
        assert!(!error.contains(token));
        assert!(request.starts_with("PATCH "));
        let api = Chart::local(token, addr).unwrap();
        assert!(
            api.http
                .request(reqwest::Method::GET, "../other-repository", None, false)
                .await
                .is_err()
        );
    }
}
