//! Private loopback TLS OIDC fixture with independently checked code grants.
//! Keys, client secrets, codes and tokens remain in memory. Nothing is published.
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use kelryvo_test_tools::{Result, api};
use openssl::{
    asn1::Asn1Time,
    bn::BigNum,
    hash::MessageDigest,
    pkey::{PKey, Private},
    rsa::Rsa,
    sign::Signer,
    ssl::{SslAcceptor, SslMethod, SslVersion},
    x509::{
        X509, X509NameBuilder,
        extension::{BasicConstraints, ExtendedKeyUsage, KeyUsage, SubjectAlternativeName},
    },
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const CLIENT: &str = "kelryvo-native";
struct Flow {
    nonce: String,
    challenge: String,
}
pub struct State {
    pub origin: String,
    pub paths: Vec<String>,
    pub errors: usize,
    pub grants: usize,
    codes: BTreeMap<String, Flow>,
    signing: PKey<Private>,
    pub subject: String,
    pub secret: String,
    jwk: Value,
}
pub struct Provider {
    pub issuer: String,
    pub ca: String,
    pub state: Arc<Mutex<State>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}
fn require(valid: bool) -> Result<()> {
    if valid {
        Ok(())
    } else {
        Err("Local OIDC wire rejected request".into())
    }
}
fn certificates() -> Result<(PKey<Private>, X509, X509)> {
    let ca_key = PKey::from_rsa(Rsa::generate(2048)?)?;
    let key = PKey::from_rsa(Rsa::generate(2048)?)?;
    let mut name = X509NameBuilder::new()?;
    name.append_entry_by_text("CN", "Native identity fixture CA")?;
    let name = name.build();
    let mut ca = X509::builder()?;
    ca.set_version(2)?;
    ca.set_serial_number(BigNum::from_u32(1)?.to_asn1_integer()?.as_ref())?;
    ca.set_subject_name(&name)?;
    ca.set_issuer_name(&name)?;
    ca.set_pubkey(&ca_key)?;
    ca.set_not_before(Asn1Time::days_from_now(0)?.as_ref())?;
    ca.set_not_after(Asn1Time::days_from_now(1)?.as_ref())?;
    ca.append_extension(BasicConstraints::new().critical().ca().build()?)?;
    ca.append_extension(
        KeyUsage::new()
            .critical()
            .key_cert_sign()
            .crl_sign()
            .build()?,
    )?;
    ca.sign(&ca_key, MessageDigest::sha256())?;
    let ca = ca.build();
    let mut name = X509NameBuilder::new()?;
    name.append_entry_by_text("CN", "localhost")?;
    let mut leaf = X509::builder()?;
    leaf.set_version(2)?;
    leaf.set_serial_number(BigNum::from_u32(2)?.to_asn1_integer()?.as_ref())?;
    leaf.set_subject_name(&name.build())?;
    leaf.set_issuer_name(ca.subject_name())?;
    leaf.set_pubkey(&key)?;
    leaf.set_not_before(Asn1Time::days_from_now(0)?.as_ref())?;
    leaf.set_not_after(Asn1Time::days_from_now(1)?.as_ref())?;
    leaf.append_extension(BasicConstraints::new().critical().build()?)?;
    leaf.append_extension(
        KeyUsage::new()
            .critical()
            .digital_signature()
            .key_encipherment()
            .build()?,
    )?;
    leaf.append_extension(ExtendedKeyUsage::new().server_auth().build()?)?;
    leaf.append_extension(
        SubjectAlternativeName::new()
            .dns("localhost")
            .ip("127.0.0.1")
            .build(&leaf.x509v3_context(Some(&ca), None))?,
    )?;
    leaf.sign(&ca_key, MessageDigest::sha256())?;
    Ok((key, leaf.build(), ca))
}
impl Provider {
    pub fn start() -> Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        listener.set_nonblocking(true)?;
        let issuer = format!("https://localhost:{}/oidc", listener.local_addr()?.port());
        let (key, certificate, ca) = certificates()?;
        let ca_pem = String::from_utf8(ca.to_pem()?)?;
        let mut acceptor = SslAcceptor::mozilla_intermediate_v5(SslMethod::tls_server())?;
        acceptor.set_min_proto_version(Some(SslVersion::TLS1_2))?;
        acceptor.set_private_key(&key)?;
        acceptor.set_certificate(&certificate)?;
        acceptor.add_extra_chain_cert(ca)?;
        acceptor.check_private_key()?;
        let acceptor = acceptor.build();
        let signing = PKey::from_rsa(Rsa::generate(2048)?)?;
        let rsa = signing.rsa()?;
        let state = Arc::new(Mutex::new(State {
            origin: String::new(),
            paths: vec![],
            errors: 0,
            grants: 0,
            codes: BTreeMap::new(),
            jwk: json!({"kty":"RSA","n":URL_SAFE_NO_PAD.encode(rsa.n().to_vec()),"e":URL_SAFE_NO_PAD.encode(rsa.e().to_vec()),"kid":"native-smoke","use":"sig","alg":"RS256"}),
            signing,
            subject: Uuid::new_v4().to_string(),
            secret: api::random_token(),
        }));
        let stop = Arc::new(AtomicBool::new(false));
        let child_state = state.clone();
        let child_stop = stop.clone();
        let child_issuer = issuer.clone();
        let thread = thread::spawn(move || {
            while !child_stop.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, peer)) if peer.ip().is_loopback() => {
                        let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                        let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                        // Chrome can open a speculative connection and drop it
                        // before TLS. Only parsed HTTP requests count as grants.
                        if let Ok(mut stream) = acceptor.accept(stream) {
                            let result = exchange(&mut stream, &child_state, &child_issuer);
                            if result.is_err() {
                                child_state.lock().unwrap().errors += 1;
                            }
                        }
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(10))
                    }
                    _ => break,
                }
            }
        });
        Ok(Self {
            issuer,
            ca: ca_pem,
            state,
            stop,
            thread: Some(thread),
        })
    }
}
impl Drop for Provider {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
struct Request {
    method: String,
    target: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
}
fn read(stream: &mut impl Read) -> Result<Request> {
    let mut bytes = Vec::new();
    let boundary = loop {
        let mut buffer = [0; 1024];
        let n = stream.read(&mut buffer)?;
        require(n != 0 && bytes.len() + n <= 16_384)?;
        bytes.extend_from_slice(&buffer[..n]);
        if let Some(index) = bytes.windows(4).position(|b| b == b"\r\n\r\n") {
            break index;
        }
    };
    let head = std::str::from_utf8(&bytes[..boundary])?;
    let mut lines = head.split("\r\n");
    let first = lines
        .next()
        .ok_or("OIDC request line")?
        .split(' ')
        .collect::<Vec<_>>();
    require(
        first.len() == 3
            && first[2] == "HTTP/1.1"
            && first[1].starts_with('/')
            && !first[1].starts_with("//"),
    )?;
    let mut headers = BTreeMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or("OIDC request header")?;
        require(
            headers
                .insert(name.to_ascii_lowercase(), value.trim().to_owned())
                .is_none(),
        )?;
    }
    require(!headers.contains_key("transfer-encoding"))?;
    let length: usize = headers
        .get("content-length")
        .map(|v| v.parse())
        .transpose()?
        .unwrap_or(0);
    require(length <= 8192)?;
    let method = first[0].to_owned();
    let target = first[1].to_owned();
    let mut body = bytes[boundary + 4..].to_vec();
    require(body.len() <= length)?;
    while body.len() < length {
        let mut buffer = [0; 1024];
        let n = stream.read(&mut buffer[..(length - body.len()).min(1024)])?;
        require(n != 0)?;
        body.extend_from_slice(&buffer[..n]);
    }
    Ok(Request {
        method,
        target,
        headers,
        body,
    })
}
fn exchange(
    stream: &mut openssl::ssl::SslStream<TcpStream>,
    state: &Mutex<State>,
    issuer: &str,
) -> Result<()> {
    let request = read(stream)?;
    let url = url::Url::parse(&format!("https://fixture.invalid{}", request.target))?;
    let mut state = state.lock().map_err(|_| "OIDC fixture state unavailable")?;
    state.paths.push(url.path().to_owned());
    require(state.paths.len() <= 100)?;
    let result = response(&request, &url, &mut state, issuer);
    let (status, location, value) = match result {
        Ok(value) => value,
        Err(_) => {
            state.errors += 1;
            (400, None, json!({}))
        }
    };
    let bytes = serde_json::to_vec(&value)?;
    write!(
        stream,
        "HTTP/1.1 {status} Fixture\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
        bytes.len()
    )?;
    if let Some(location) = location {
        write!(stream, "Location: {location}\r\n")?;
    }
    stream.write_all(b"\r\n")?;
    stream.write_all(&bytes)?;
    stream.flush()?;
    Ok(())
}
fn response(
    request: &Request,
    url: &url::Url,
    state: &mut State,
    issuer: &str,
) -> Result<(u16, Option<String>, Value)> {
    match (request.method.as_str(), url.path()) {
        ("GET", "/oidc/.well-known/openid-configuration") => Ok((
            200,
            None,
            json!({"issuer":issuer,"authorization_endpoint":format!("{issuer}/authorize"),"token_endpoint":format!("{issuer}/token"),"jwks_uri":format!("{issuer}/jwks"),"response_types_supported":["code"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256"],"token_endpoint_auth_methods_supported":["client_secret_basic"],"code_challenge_methods_supported":["S256"]}),
        )),
        ("GET", "/oidc/jwks") => Ok((200, None, json!({"keys":[state.jwk]}))),
        ("GET", "/oidc/authorize") => {
            let params: BTreeMap<_, _> = url.query_pairs().into_owned().collect();
            require(
                params.get("client_id").map(String::as_str) == Some(CLIENT)
                    && params.get("redirect_uri")
                        == Some(&format!("{}/api/auth/oidc/callback", state.origin))
                    && params.get("code_challenge_method").map(String::as_str) == Some("S256"),
            )?;
            let nonce = params
                .get("nonce")
                .filter(|s| !s.is_empty())
                .ok_or("OIDC nonce")?
                .clone();
            let challenge = params
                .get("code_challenge")
                .filter(|s| !s.is_empty())
                .ok_or("OIDC challenge")?
                .clone();
            let code = api::random_token();
            require(state.codes.len() < 10)?;
            state.codes.insert(code.clone(), Flow { nonce, challenge });
            let mut redirect =
                url::Url::parse(&format!("{}/api/auth/oidc/callback", state.origin))?;
            redirect
                .query_pairs_mut()
                .append_pair("code", &code)
                .append_pair("state", params.get("state").ok_or("OIDC state")?);
            Ok((302, Some(redirect.into()), json!({})))
        }
        ("POST", "/oidc/token") => {
            require(
                request.headers.get("authorization")
                    == Some(&format!(
                        "Basic {}",
                        STANDARD.encode(format!("{CLIENT}:{}", state.secret))
                    )),
            )?;
            let params: BTreeMap<_, _> = url::form_urlencoded::parse(&request.body)
                .into_owned()
                .collect();
            let flow = state
                .codes
                .remove(params.get("code").ok_or("OIDC code")?)
                .ok_or("OIDC code consumed or missing")?;
            require(
                params.get("grant_type").map(String::as_str) == Some("authorization_code")
                    && params.get("redirect_uri")
                        == Some(&format!("{}/api/auth/oidc/callback", state.origin))
                    && URL_SAFE_NO_PAD.encode(Sha256::digest(
                        params
                            .get("code_verifier")
                            .ok_or("OIDC verifier")?
                            .as_bytes(),
                    )) == flow.challenge,
            )?;
            let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
            let head = URL_SAFE_NO_PAD.encode(serde_json::to_vec(
                &json!({"alg":"RS256","kid":"native-smoke","typ":"JWT"}),
            )?);
            let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&json!({"iss":issuer,"aud":CLIENT,"sub":state.subject,"iat":now,"exp":now+60,"nonce":flow.nonce}))?);
            let unsigned = format!("{head}.{body}");
            let mut signer = Signer::new(MessageDigest::sha256(), &state.signing)?;
            signer.update(unsigned.as_bytes())?;
            let token = format!(
                "{unsigned}.{}",
                URL_SAFE_NO_PAD.encode(signer.sign_to_vec()?)
            );
            state.grants += 1;
            Ok((
                200,
                None,
                json!({"access_token":"native-access-token","token_type":"Bearer","expires_in":60,"id_token":token}),
            ))
        }
        _ => Ok((404, None, json!({}))),
    }
}
