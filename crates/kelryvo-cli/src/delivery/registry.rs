//! Read-only GHCR proof. A blob redirect is fetched without Authorization;
//! token/manifest requests never redirect. Only documented GitHub package hosts
//! are accepted, with TLS verification retained.
use super::{LIMIT, Result};
use crate::oci;
use base64::{Engine, engine::general_purpose::STANDARD};
use kelryvo_core::sha256;
use reqwest::{
    Client, Response, Url,
    header::{AUTHORIZATION, HeaderValue},
};
use serde_json::{Value, json};
use std::time::Duration;
use zeroize::Zeroizing;
const REPOSITORY: &str = "devsecopslonghn/kelryvo-app";
const ACCEPT: &str = "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";
pub(super) trait Registry {
    async fn read(&mut self, reference: &str, missing: bool) -> Result<Option<Value>>;
}
pub(super) struct Ghcr {
    client: Client,
    actor: Zeroizing<String>,
    credential: Zeroizing<String>,
    token: Option<HeaderValue>,
    base: String,
    #[cfg(test)]
    redirects: Vec<String>,
}
fn client(https: bool) -> Result<Client> {
    Client::builder()
        .no_proxy()
        .https_only(https)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .user_agent("kelryvo-native-delivery/0.1")
        .build()
        .map_err(|_| "Cannot initialize registry HTTPS client".into())
}
fn auth(value: &str) -> Result<HeaderValue> {
    let mut h = HeaderValue::from_str(value).map_err(|_| "Invalid registry credential header")?;
    h.set_sensitive(true);
    Ok(h)
}
async fn bytes(mut response: Response) -> Result<Vec<u8>> {
    if !response.status().is_success() {
        return Err(format!(
            "Registry read failed (HTTP {}); check package access",
            response.status().as_u16()
        ));
    }
    if response.content_length().is_some_and(|s| s > LIMIT) {
        return Err("Registry response exceeds the input limit".into());
    }
    let mut out = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Cannot read registry response")?
    {
        if out.len() as u64 + chunk.len() as u64 > LIMIT {
            return Err("Registry response exceeds the input limit".into());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}
fn parse(bytes: &[u8]) -> Result<Value> {
    serde_json::from_slice(bytes).map_err(|_| "Invalid registry JSON".into())
}
fn reference(s: &str) -> bool {
    oci::digest(s)
        || !s.is_empty()
            && s.len() <= 128
            && !s.starts_with(['.', '-'])
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
}
fn descriptor(v: &Value) -> Result<(&str, u64)> {
    let d = v["digest"]
        .as_str()
        .filter(|d| oci::digest(d))
        .ok_or("Invalid registry descriptor digest")?;
    let s = v["size"]
        .as_u64()
        .filter(|s| *s <= 32 * 1024 * 1024 * 1024)
        .ok_or("Invalid registry descriptor size")?;
    Ok((d, s))
}
impl Ghcr {
    pub(super) fn new(actor: String, credential: String) -> Result<Self> {
        if actor.is_empty()
            || actor.len() > 128
            || actor.chars().any(|c| c.is_control() || c == ':')
            || credential.is_empty()
            || credential.len() > 16384
        {
            return Err("Missing or invalid GHCR credentials".into());
        }
        Ok(Self {
            client: client(true)?,
            actor: Zeroizing::new(actor),
            credential: Zeroizing::new(credential),
            token: None,
            base: "https://ghcr.io".into(),
            #[cfg(test)]
            redirects: Vec::new(),
        })
    }
    async fn token(&mut self) -> Result<HeaderValue> {
        if let Some(h) = &self.token {
            return Ok(h.clone());
        }
        let pair = Zeroizing::new(format!(
            "{}:{}",
            self.actor.as_str(),
            self.credential.as_str()
        ));
        let encoded = Zeroizing::new(STANDARD.encode(pair.as_bytes()));
        let basic = Zeroizing::new(format!("Basic {}", encoded.as_str()));
        let response = self
            .client
            .get(format!(
                "{}/token?service=ghcr.io&scope=repository:{REPOSITORY}:pull",
                self.base
            ))
            .header(AUTHORIZATION, auth(&basic)?)
            .send()
            .await
            .map_err(|_| "Registry authentication unavailable")?;
        let body = Zeroizing::new(bytes(response).await?);
        let mut value = parse(&body)?;
        let Value::String(token) = value["token"].take() else {
            return Err("Registry authentication returned no token".into());
        };
        let token = Zeroizing::new(token);
        if token.is_empty() || token.len() > 16384 {
            return Err("Invalid registry session token".into());
        }
        let bearer = Zeroizing::new(format!("Bearer {}", token.as_str()));
        let h = auth(&bearer)?;
        self.token = Some(h.clone());
        Ok(h)
    }
    async fn manifest(&mut self, r: &str, missing: bool) -> Result<Option<(Vec<u8>, String)>> {
        if !reference(r) {
            return Err("Invalid registry reference".into());
        }
        let token = self.token().await?;
        let response = self
            .client
            .get(format!("{}/v2/{REPOSITORY}/manifests/{r}", self.base))
            .header(AUTHORIZATION, token)
            .header("accept", ACCEPT)
            .send()
            .await
            .map_err(|_| "Registry manifest lookup unavailable")?;
        if missing && response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let stated = response
            .headers()
            .get("docker-content-digest")
            .and_then(|h| h.to_str().ok())
            .map(str::to_owned);
        let bytes = bytes(response).await?;
        let hash = format!("sha256:{}", sha256(&bytes));
        if stated.as_deref() != Some(hash.as_str()) || oci::digest(r) && r != hash {
            return Err("Registry manifest digest mismatch".into());
        }
        Ok(Some((bytes, hash)))
    }
    fn redirect(&self, url: &Url) -> bool {
        #[cfg(test)]
        if self.redirects.iter().any(|s| url.as_str().starts_with(s)) {
            return true;
        }
        // https://docs.github.com/en/actions/reference/runners/self-hosted-runners
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
            && url.fragment().is_none()
            && url.host_str().is_some_and(|h| {
                h == "ghcr.io"
                    || h == "pkg-containers.githubusercontent.com"
                    || h == "github-registry-files.githubusercontent.com"
                    || h.ends_with(".pkg.github.com")
            })
    }
    async fn config(&mut self, d: &Value) -> Result<Value> {
        let (hash, size) = descriptor(d)?;
        if size > LIMIT {
            return Err("Registry config exceeds the input limit".into());
        }
        let token = self.token().await?;
        let mut response = self
            .client
            .get(format!("{}/v2/{REPOSITORY}/blobs/{hash}", self.base))
            .header(AUTHORIZATION, token)
            .send()
            .await
            .map_err(|_| "Registry config lookup unavailable")?;
        for _ in 0..4 {
            if !response.status().is_redirection() {
                break;
            }
            let location = response
                .headers()
                .get("location")
                .and_then(|h| h.to_str().ok())
                .ok_or("Registry blob redirect has no location")?;
            let url = response
                .url()
                .join(location)
                .map_err(|_| "Invalid registry blob redirect")?;
            if !self.redirect(&url) {
                return Err("Registry blob redirect is not an authorized package host".into());
            }
            // The client has no default credentials. Never forward the registry
            // bearer token to a CDN URL, including later redirect hops.
            response = self
                .client
                .get(url)
                .send()
                .await
                .map_err(|_| "Registry redirected config unavailable")?;
        }
        let bytes = bytes(response).await?;
        if bytes.len() as u64 != size || format!("sha256:{}", sha256(&bytes)) != hash {
            return Err("Registry config digest or size mismatch".into());
        }
        parse(&bytes)
    }
}
impl Registry for Ghcr {
    async fn read(&mut self, r: &str, missing: bool) -> Result<Option<Value>> {
        let Some((raw, hash)) = self.manifest(r, missing).await? else {
            return Ok(None);
        };
        let index = parse(&raw)?;
        if index["schemaVersion"] != 2 || !index["mediaType"].as_str().is_some_and(oci::is_index) {
            return Err("Expected a two-platform registry image index".into());
        }
        let list = index["manifests"]
            .as_array()
            .filter(|a| a.len() == 2)
            .ok_or("Registry index must contain exactly linux/amd64 and linux/arm64")?;
        let mut platforms = serde_json::Map::new();
        for d in list {
            let arch = d["platform"]["architecture"]
                .as_str()
                .filter(|a| ["amd64", "arm64"].contains(a))
                .ok_or("Unsupported registry architecture")?;
            if d["platform"]["os"] != "linux"
                || platforms.contains_key(arch)
                || d["platform"]
                    .get("variant")
                    .is_some_and(|v| !v.is_null() && v != "" && !(arch == "arm64" && v == "v8"))
                || !d["mediaType"].as_str().is_some_and(oci::is_manifest)
            {
                return Err("Duplicate or unsupported registry platform".into());
            }
            let (child, size) = descriptor(d)?;
            let (raw, child_hash) = self
                .manifest(child, false)
                .await?
                .ok_or("Missing registry child")?;
            let manifest = parse(&raw)?;
            if raw.len() as u64 != size
                || manifest["schemaVersion"] != 2
                || !manifest["mediaType"].as_str().is_some_and(oci::is_manifest)
                || !manifest["layers"].is_array()
            {
                return Err("Invalid registry platform manifest".into());
            }
            descriptor(&manifest["config"])?;
            for layer in manifest["layers"]
                .as_array()
                .ok_or("Invalid registry layers")?
            {
                descriptor(layer)?;
            }
            let config = self.config(&manifest["config"]).await?;
            platforms.insert(arch.into(),json!({"digest":child_hash,"configDigest":manifest["config"]["digest"],"config":config}));
        }
        Ok(Some(json!({"digest":hash,"platforms":platforms})))
    }
}
#[cfg(test)]
mod tests;
pub(super) fn verify(remote: &Value, source: &str, expected: Option<&Value>) -> Result<String> {
    let hash = remote["digest"]
        .as_str()
        .filter(|s| oci::digest(s))
        .ok_or("Invalid registry image digest")?;
    let platforms = remote["platforms"]
        .as_object()
        .filter(|p| p.len() == 2)
        .ok_or("Registry image must contain both platforms")?;
    for arch in ["amd64", "arm64"] {
        let p = platforms.get(arch).ok_or("Missing registry platform")?;
        if !p["digest"].as_str().is_some_and(oci::digest)
            || !p["configDigest"].as_str().is_some_and(oci::digest)
        {
            return Err("Invalid registry platform digest".into());
        }
        oci::verify_config(&p["config"], source, arch).map_err(str::to_owned)?;
        if let Some(e) = expected
            && (remote["digest"] != e["digest"]
                || p["digest"] != e["platforms"][arch]["digest"]
                || p["configDigest"] != e["platforms"][arch]["configDigest"])
        {
            return Err("Registry image does not match the verified source/image".into());
        }
    }
    Ok(hash.into())
}
