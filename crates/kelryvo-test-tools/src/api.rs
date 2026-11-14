//! Purpose-restricted native HTTPS/API fixture adapters. Private credential
//! values remain in fixture memory/files and never enter argv or diagnostics.
use crate::Result;
use openssl::{
    asn1::Asn1Time,
    bn::{BigNum, MsbOption},
    hash::MessageDigest,
    pkey::PKey,
    rsa::Rsa,
    x509::{
        X509, X509NameBuilder,
        extension::{BasicConstraints, ExtendedKeyUsage, KeyUsage, SubjectAlternativeName},
    },
};
use serde_json::Value;
use std::{collections::BTreeMap, fs, os::unix::fs::OpenOptionsExt, path::Path, time::Duration};

pub struct Response {
    pub status: u16,
    pub headers: reqwest::header::HeaderMap,
    pub bytes: Vec<u8>,
    pub body: Value,
}
pub struct Api {
    pub origin: String,
    client: reqwest::Client,
    pub token: Option<String>,
    pub csrf: Option<String>,
    cookies: BTreeMap<String, String>,
}
impl Api {
    pub fn new(origin: &str, certificate: &[u8], token: Option<&str>) -> Result<Self> {
        let client = reqwest::Client::builder()
            .add_root_certificate(reqwest::Certificate::from_pem(certificate)?)
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        Ok(Self {
            origin: origin.into(),
            client,
            token: token.map(str::to_owned),
            csrf: None,
            cookies: BTreeMap::new(),
        })
    }
    pub async fn request(
        &mut self,
        method: &str,
        path: &str,
        data: Option<&Value>,
    ) -> Result<Response> {
        self.raw(
            method,
            path,
            data.map(serde_json::to_vec).transpose()?.as_deref(),
            data.map(|_| "application/json"),
            &BTreeMap::new(),
        )
        .await
    }
    pub async fn raw(
        &mut self,
        method: &str,
        path: &str,
        data: Option<&[u8]>,
        content_type: Option<&str>,
        headers: &BTreeMap<String, String>,
    ) -> Result<Response> {
        if !path.starts_with('/') || path.starts_with("//") {
            return Err("API fixture routes must stay in their selected origin".into());
        }
        let mut request = self
            .client
            .request(
                reqwest::Method::from_bytes(method.as_bytes())?,
                format!("{}{path}", self.origin),
            )
            .header("origin", &self.origin);
        if let Some(token) = &self.token {
            request = request.bearer_auth(token);
        }
        if let Some(csrf) = &self.csrf {
            request = request.header("x-csrf-token", csrf);
        }
        if !self.cookies.is_empty() {
            request = request.header(
                "cookie",
                self.cookies
                    .iter()
                    .map(|(name, value)| format!("{name}={value}"))
                    .collect::<Vec<_>>()
                    .join("; "),
            );
        }
        if let Some(content_type) = content_type {
            request = request.header("content-type", content_type);
        }
        if let Some(data) = data {
            request = request.body(data.to_vec());
        }
        let mut request = request.build()?;
        // Explicit negative-test headers replace defaults, matching a wire
        // request with one Origin/CSRF field rather than duplicate headers.
        for (name, value) in headers {
            request.headers_mut().insert(
                reqwest::header::HeaderName::from_bytes(name.as_bytes())?,
                reqwest::header::HeaderValue::from_str(value)?,
            );
        }
        let mut response = self.client.execute(request).await?;
        let status = response.status().as_u16();
        let headers = response.headers().clone();
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await? {
            if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
                return Err("API fixture response exceeded its bound".into());
            }
            bytes.extend_from_slice(&chunk);
        }
        for cookie in headers.get_all("set-cookie") {
            if let Some((name, value)) = cookie
                .to_str()?
                .split(';')
                .next()
                .and_then(|pair| pair.split_once('='))
            {
                if value.is_empty() {
                    self.cookies.remove(name);
                } else {
                    self.cookies.insert(name.into(), value.into());
                }
            }
        }
        let body = if headers
            .get("content-type")
            .is_some_and(|value| value.as_bytes().starts_with(b"application/json"))
            && !bytes.is_empty()
        {
            serde_json::from_slice(&bytes)?
        } else {
            Value::Null
        };
        Ok(Response {
            status,
            headers,
            bytes,
            body,
        })
    }
    pub async fn json(
        &mut self,
        method: &str,
        path: &str,
        data: Option<&Value>,
        status: u16,
    ) -> Result<Value> {
        let response = self.request(method, path, data).await?;
        if response.status != status {
            return Err(format!(
                "Native fixture API returned an unexpected status: {} (wanted {status})",
                response.status
            )
            .into());
        }
        Ok(response.body)
    }
}
pub fn private_file(path: &Path, value: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(value)?;
    file.sync_all()?;
    Ok(())
}
pub fn certificate(directory: &Path) -> Result<Vec<u8>> {
    let key = PKey::from_rsa(Rsa::generate(3072)?)?;
    let mut name = X509NameBuilder::new()?;
    name.append_entry_by_text("CN", "localhost")?;
    let name = name.build();
    let mut serial = BigNum::new()?;
    serial.rand(128, MsbOption::MAYBE_ZERO, false)?;
    let serial = serial.to_asn1_integer()?;
    let mut builder = X509::builder()?;
    builder.set_version(2)?;
    builder.set_serial_number(&serial)?;
    builder.set_subject_name(&name)?;
    builder.set_issuer_name(&name)?;
    builder.set_pubkey(&key)?;
    builder.set_not_before(Asn1Time::days_from_now(0)?.as_ref())?;
    builder.set_not_after(Asn1Time::days_from_now(1)?.as_ref())?;
    builder.append_extension(BasicConstraints::new().critical().build()?)?;
    builder.append_extension(
        KeyUsage::new()
            .critical()
            .digital_signature()
            .key_encipherment()
            .build()?,
    )?;
    builder.append_extension(ExtendedKeyUsage::new().server_auth().build()?)?;
    let san = SubjectAlternativeName::new()
        .dns("localhost")
        .ip("127.0.0.1")
        .ip("::1")
        .build(&builder.x509v3_context(None, None))?;
    builder.append_extension(san)?;
    builder.sign(&key, MessageDigest::sha256())?;
    let certificate = builder.build().to_pem()?;
    private_file(&directory.join("tls.key"), &key.private_key_to_pem_pkcs8()?)?;
    private_file(&directory.join("tls.crt"), &certificate)?;
    Ok(certificate)
}
pub fn random_token() -> String {
    use rand::RngCore;
    let mut bytes = [0; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
pub fn check(actual: &Value, expected: &Value, label: &str) -> Result<()> {
    if actual != expected {
        return Err(format!("Native fixture contract mismatch: {label}").into());
    }
    Ok(())
}
