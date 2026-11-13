//! TLS verification and operator route/IP confinement for identity I/O.
use super::runtime::{Runtime, s, text};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ldap3::{Ldap, LdapConnAsync, LdapConnSettings, Scope, SearchEntry, SearchOptions, StdStream};
use openidconnect::{
    AccessTokenHash, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EndpointMaybeSet,
    EndpointNotSet, EndpointSet, HttpRequest, HttpResponse, IssuerUrl, Nonce, OAuth2TokenResponse,
    PkceCodeChallenge, PkceCodeVerifier, RedirectUrl, Scope as OidcScope, TokenResponse,
    core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata},
};
use serde_json::{Value, json};
use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use tokio::{
    net::{TcpStream, lookup_host},
    task::JoinHandle,
    time::timeout,
};
use url::Url;
#[derive(Debug)]
pub struct Unavailable;
impl std::fmt::Display for Unavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Identity provider unavailable")
    }
}
impl std::error::Error for Unavailable {}
type Result<T> = std::result::Result<T, Unavailable>;
const TIMEOUT: Duration = Duration::from_secs(5);
fn allowed_url(route: &Value, url: &Url) -> bool {
    url.scheme() == "https"
        && url.origin().ascii_serialization() == s(&route["origin"])
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
}
async fn pins(route: &Value, host: &str, port: u16, resolve: bool) -> Result<Vec<SocketAddr>> {
    let allowed: Vec<IpAddr> = route["pinnedIPs"]
        .as_array()
        .ok_or(Unavailable)?
        .iter()
        .map(|v| s(v).parse().map_err(|_| Unavailable))
        .collect::<Result<_>>()?;
    if allowed.is_empty() {
        return Err(Unavailable);
    }
    if !resolve {
        return Ok(allowed
            .into_iter()
            .map(|ip| SocketAddr::new(ip, port))
            .collect());
    }
    let records: Vec<_> = lookup_host((host, port))
        .await
        .map_err(|_| Unavailable)?
        .collect();
    if records.is_empty() || records.iter().any(|s| !allowed.contains(&s.ip())) {
        return Err(Unavailable);
    }
    Ok(records)
}
async fn request(route: Value, request: HttpRequest) -> Result<HttpResponse> {
    timeout(TIMEOUT, async {
        let url = Url::parse(&request.uri().to_string()).map_err(|_| Unavailable)?;
        if !allowed_url(&route, &url) {
            return Err(Unavailable);
        }
        let host = url.host_str().ok_or(Unavailable)?;
        let records = pins(
            &route,
            host,
            url.port_or_known_default().ok_or(Unavailable)?,
            true,
        )
        .await?;
        let mut builder = reqwest::Client::builder()
            .no_proxy()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(TIMEOUT)
            .connect_timeout(TIMEOUT)
            .resolve_to_addrs(host, &records)
            .min_tls_version(reqwest::tls::Version::TLS_1_2);
        if let Some(ca) = route["ca"].as_str() {
            builder = builder.tls_built_in_root_certs(false);
            for cert in
                reqwest::Certificate::from_pem_bundle(ca.as_bytes()).map_err(|_| Unavailable)?
            {
                builder = builder.add_root_certificate(cert);
            }
        }
        let client = builder.build().map_err(|_| Unavailable)?;
        let mut response = client
            .request(request.method().clone(), url)
            .headers(request.headers().clone())
            .body(request.body().clone())
            .send()
            .await
            .map_err(|_| Unavailable)?;
        if response.status().is_redirection() {
            return Err(Unavailable);
        }
        let status = response.status();
        let headers = response.headers().clone();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Unavailable)? {
            if bytes.len() + chunk.len() > 512 * 1024 {
                return Err(Unavailable);
            }
            bytes.extend_from_slice(&chunk);
        }
        let mut result = HttpResponse::new(bytes);
        *result.status_mut() = status;
        *result.headers_mut() = headers;
        Ok(result)
    })
    .await
    .map_err(|_| Unavailable)?
}
type Client = CoreClient<
    EndpointSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointNotSet,
    EndpointMaybeSet,
    EndpointMaybeSet,
>;
async fn oidc(runtime: &Runtime, c: &Value) -> Result<(Client, Value)> {
    if !runtime.valid_provider("OIDC", c) {
        return Err(Unavailable);
    }
    let route = runtime
        .route(s(&c["routeId"]), "OIDC")
        .ok_or(Unavailable)?
        .clone();
    let http = |req| request(route.clone(), req);
    let metadata = CoreProviderMetadata::discover_async(
        IssuerUrl::new(s(&c["issuer"]).into()).map_err(|_| Unavailable)?,
        &http,
    )
    .await
    .map_err(|_| Unavailable)?;
    let raw = serde_json::to_value(&metadata).map_err(|_| Unavailable)?;
    for key in [
        "authorization_endpoint",
        "token_endpoint",
        "jwks_uri",
        "userinfo_endpoint",
        "end_session_endpoint",
    ] {
        if let Some(endpoint) = raw.get(key)
            && !allowed_url(&route, &Url::parse(s(endpoint)).map_err(|_| Unavailable)?)
        {
            return Err(Unavailable);
        }
    }
    if raw["token_endpoint"].is_null() || raw["jwks_uri"].is_null() {
        return Err(Unavailable);
    }
    let secret = runtime
        .secret(&route, s(&c["clientSecretRef"]))
        .ok_or(Unavailable)?;
    let client = CoreClient::from_provider_metadata(
        metadata,
        ClientId::new(s(&c["clientId"]).into()),
        Some(ClientSecret::new(secret.into())),
    )
    .set_redirect_uri(
        RedirectUrl::new(format!("{}/api/auth/oidc/callback", runtime.origin))
            .map_err(|_| Unavailable)?,
    );
    Ok((client, route))
}
pub async fn authorization(runtime: &Runtime, c: &Value, flow: &Value) -> Result<String> {
    let (client, route) = oidc(runtime, c).await?;
    let state = s(&flow["state"]).to_owned();
    let nonce = s(&flow["nonce"]).to_owned();
    let (url, _, _) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            move || CsrfToken::new(state.clone()),
            move || Nonce::new(nonce.clone()),
        )
        .add_scope(OidcScope::new("profile".into()))
        .add_scope(OidcScope::new("email".into()))
        .set_pkce_challenge(PkceCodeChallenge::from_code_verifier_sha256(
            &PkceCodeVerifier::new(s(&flow["verifier"]).into()),
        ))
        .url();
    if !allowed_url(&route, &url) {
        return Err(Unavailable);
    }
    Ok(url.into())
}
pub async fn callback(runtime: &Runtime, c: &Value, code: &str, flow: &Value) -> Result<String> {
    let (client, route) = oidc(runtime, c).await?;
    let http = |req| request(route.clone(), req);
    let token = client
        .exchange_code(AuthorizationCode::new(code.into()))
        .map_err(|_| Unavailable)?
        .set_pkce_verifier(PkceCodeVerifier::new(s(&flow["verifier"]).into()))
        .request_async(&http)
        .await
        .map_err(|_| Unavailable)?;
    let id = token.id_token().ok_or(Unavailable)?;
    use openidconnect::core::CoreJwsSigningAlgorithm::{HmacSha256, HmacSha384, HmacSha512, None};
    if matches!(
        id.signing_alg().map_err(|_| Unavailable)?,
        HmacSha256 | HmacSha384 | HmacSha512 | None
    ) {
        return Err(Unavailable);
    }

    let verifier = client.id_token_verifier();
    let nonce = Nonce::new(s(&flow["nonce"]).into());
    let claims = id.claims(&verifier, &nonce).map_err(|_| Unavailable)?;
    if let Some(expected) = claims.access_token_hash() {
        let actual = AccessTokenHash::from_token(
            token.access_token(),
            id.signing_alg().map_err(|_| Unavailable)?,
            id.signing_key(&verifier).map_err(|_| Unavailable)?,
        )
        .map_err(|_| Unavailable)?;
        if actual != *expected {
            return Err(Unavailable);
        }
    }
    let subject = claims.subject().as_str();
    if !text(&json!(subject), 512) || claims.issuer().as_str() != s(&c["issuer"]) {
        return Err(Unavailable);
    }
    Ok(subject.into())
}
struct LdapSession {
    ldap: Ldap,
    task: JoinHandle<()>,
}
impl Drop for LdapSession {
    fn drop(&mut self) {
        self.task.abort();
    }
}
async fn ldap_session(route: &Value, port: u16) -> Result<LdapSession> {
    let host = s(&route["host"]);
    let addresses = pins(route, host, port, false).await?;
    let stream = timeout(TIMEOUT, TcpStream::connect(addresses[0]))
        .await
        .map_err(|_| Unavailable)?
        .map_err(|_| Unavailable)?;
    let stream = stream.into_std().map_err(|_| Unavailable)?;
    let mut connector = native_tls::TlsConnector::builder();
    connector.min_protocol_version(Some(native_tls::Protocol::Tlsv12));
    if let Some(ca) = route["ca"].as_str() {
        connector.disable_built_in_roots(true);
        for cert in openssl::x509::X509::stack_from_pem(ca.as_bytes()).map_err(|_| Unavailable)? {
            connector.add_root_certificate(
                native_tls::Certificate::from_der(&cert.to_der().map_err(|_| Unavailable)?)
                    .map_err(|_| Unavailable)?,
            );
        }
    }
    let settings = LdapConnSettings::new()
        .set_conn_timeout(TIMEOUT)
        .set_connector(connector.build().map_err(|_| Unavailable)?)
        .set_std_stream(StdStream::Tcp(stream));
    let (connection, mut ldap) =
        LdapConnAsync::with_settings(settings, &format!("ldaps://{host}:636"))
            .await
            .map_err(|_| Unavailable)?;
    let task = tokio::spawn(async move {
        let _ = connection.drive().await;
    });
    ldap.with_timeout(TIMEOUT);
    Ok(LdapSession { ldap, task })
}
fn attribute(entry: &SearchEntry, name: &str) -> Option<String> {
    if let Some(values) = entry
        .attrs
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, v)| v)
    {
        let v = values.first()?;
        return (!v.is_empty() && v.encode_utf16().count() <= 1024).then(|| v.clone());
    }
    let v = entry
        .bin_attrs
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))?
        .1
        .first()?;
    (!v.is_empty() && v.len() <= 1024).then(|| URL_SAFE_NO_PAD.encode(v))
}
fn dn(v: &str) -> bool {
    static P: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(r"\A(?:[A-Za-z][A-Za-z0-9-]*=(?:\\.|[^,\\])+)(?:,(?:[A-Za-z][A-Za-z0-9-]*=(?:\\.|[^,\\])+))*\z").expect("LDAP DN")
    });
    v.len() <= 2048 && P.is_match(v)
}
pub async fn ldap(
    runtime: Arc<Runtime>,
    c: &Value,
    username: Option<&str>,
    password: Option<&str>,
) -> Result<Option<Value>> {
    // Public identity configuration cannot choose a port. The private exchange
    // also accepts an endpoint port so wire tests need no privileged listener.
    ldap_exchange(runtime, c, username, password, 636).await
}
async fn ldap_exchange(
    runtime: Arc<Runtime>,
    c: &Value,
    username: Option<&str>,
    password: Option<&str>,
    port: u16,
) -> Result<Option<Value>> {
    timeout(Duration::from_secs(15), async {
        if !runtime.valid_provider("LDAP", c) || !dn(s(&c["baseDN"])) || !dn(s(&c["bindDN"])) {
            return Err(Unavailable);
        }
        let route = runtime.route(s(&c["routeId"]), "LDAP").ok_or(Unavailable)?;
        let mut session = ldap_session(route, port).await?;
        let secret = runtime
            .secret(route, s(&c["bindSecretRef"]))
            .ok_or(Unavailable)?;
        session
            .ldap
            .simple_bind(s(&c["bindDN"]), secret)
            .await
            .map_err(|_| Unavailable)?
            .success()
            .map_err(|_| Unavailable)?;
        let Some(username) = username else {
            let (entries, _) = session
                .ldap
                .with_search_options(SearchOptions::new().sizelimit(1).timelimit(5))
                .search(s(&c["baseDN"]), Scope::Base, "(objectClass=*)", vec!["1.1"])
                .await
                .map_err(|_| Unavailable)?
                .success()
                .map_err(|_| Unavailable)?;
            return Ok((entries.len() == 1).then(|| json!({"subject":"","displayName":""})));
        };
        if username.is_empty()
            || username.len() > 512
            || username.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        {
            return Ok(None);
        }
        let filter = format!(
            "({}={})",
            s(&c["loginAttribute"]),
            ldap3::ldap_escape(username)
        );
        let (entries, _) = session
            .ldap
            .with_search_options(SearchOptions::new().sizelimit(2).timelimit(5))
            .search(
                s(&c["baseDN"]),
                Scope::Subtree,
                &filter,
                vec![s(&c["subjectAttribute"]), "displayName"],
            )
            .await
            .map_err(|_| Unavailable)?
            .success()
            .map_err(|_| Unavailable)?;
        if entries.len() != 1 {
            return Ok(None);
        }
        let entry = SearchEntry::construct(entries.into_iter().next().ok_or(Unavailable)?);
        let Some(subject) = attribute(&entry, s(&c["subjectAttribute"])) else {
            return Ok(None);
        };
        if let Some(password) = password {
            if password.is_empty()
                || password.len() > 4096
                || password.contains('\0')
                || !text(&json!(entry.dn), 2048)
            {
                return Ok(None);
            }
            let mut user = ldap_session(route, port).await?;
            let result = user
                .ldap
                .simple_bind(&entry.dn, password)
                .await
                .map_err(|_| Unavailable)?;
            if result.rc == 49 {
                return Ok(None);
            }
            result.success().map_err(|_| Unavailable)?;
        }
        Ok(Some(
            json!({"subject":subject,"displayName":attribute(&entry,"displayName")}),
        ))
    })
    .await
    .map_err(|_| Unavailable)?
}

#[cfg(test)]
#[path = "network/tests.rs"]
mod tests;
pub async fn test(runtime: Arc<Runtime>, kind: &str, c: &Value) -> bool {
    if kind == "LDAP" {
        ldap(runtime, c, None, None)
            .await
            .is_ok_and(|r| r.is_some())
    } else {
        oidc(&runtime, c).await.is_ok()
    }
}
