//! Public-key-only vault operations. API consumers cannot decrypt credentials;
//! the private-key implementation lives in the privileged runtime crate.
use base64::{Engine, engine::general_purpose::STANDARD};
use kelryvo_core::sha256;
use openssl::{
    encrypt::Encrypter,
    hash::MessageDigest,
    pkey::{Id, PKey, Public},
    rand::rand_bytes,
    rsa::Padding,
    symm::{Cipher, encrypt_aead},
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{fmt, sync::LazyLock};
use zeroize::Zeroizing;

#[derive(Clone, Copy, Debug)]
pub struct VaultUnavailable;
impl fmt::Display for VaultUnavailable {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Oracle credential vault unavailable")
    }
}
impl std::error::Error for VaultUnavailable {}
impl From<openssl::error::ErrorStack> for VaultUnavailable {
    fn from(_: openssl::error::ErrorStack) -> Self {
        Self
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Context {
    pub organization_id: String,
    pub connection_id: String,
    pub credential_id: String,
    pub username: String,
    pub purpose: String,
    pub endpoint_digest: String,
}
impl Context {
    pub fn aad(&self) -> Result<Vec<u8>, VaultUnavailable> {
        static UUID: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(
                r"(?i)\A[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\z",
            )
            .expect("UUID pattern")
        });
        static USER: LazyLock<Regex> = LazyLock::new(|| {
            Regex::new(r"\A[A-Za-z][A-Za-z0-9_$#]{0,127}\z").expect("username pattern")
        });
        if [
            &self.organization_id,
            &self.connection_id,
            &self.credential_id,
        ]
        .iter()
        .any(|id| !UUID.is_match(id))
            || !USER.is_match(&self.username)
            || !["INSTANCE_MASTER", "DEPLOY", "OBSERVER", "LEDGER"].contains(&self.purpose.as_str())
            || !is_digest(&self.endpoint_digest)
        {
            return Err(VaultUnavailable);
        }
        Ok(json!([
            ["organizationId", self.organization_id],
            ["connectionId", self.connection_id],
            ["credentialId", self.credential_id],
            ["username", self.username],
            ["purpose", self.purpose],
            ["endpointDigest", self.endpoint_digest]
        ])
        .to_string()
        .into_bytes())
    }
}

pub fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub fn valid_password(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= 4096
        && value.len() <= 8192
        && !value.chars().any(|c| ['\0', '\r', '\n'].contains(&c))
}

pub fn endpoint_digest(connection: &Value) -> Result<String, VaultUnavailable> {
    let host = connection["host"].as_str().ok_or(VaultUnavailable)?;
    let port = connection["port"]
        .as_i64()
        .filter(|n| n.unsigned_abs() <= 9_007_199_254_740_991)
        .ok_or(VaultUnavailable)?;
    let service = connection["service"].as_str().ok_or(VaultUnavailable)?;
    let transport = connection["transport"]
        .as_str()
        .filter(|v| ["TCP", "TCPS"].contains(v))
        .ok_or(VaultUnavailable)?;
    Ok(sha256(json!([host, port, service, transport]).to_string()))
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Envelope {
    pub format: u8,
    pub key_id: String,
    pub wrapped_key: String,
    pub nonce: String,
    pub tag: String,
    pub ciphertext: String,
}

pub fn decode(value: &str, min: usize, max: usize) -> Result<Vec<u8>, VaultUnavailable> {
    if value.len() > max * 2 {
        return Err(VaultUnavailable);
    }
    let bytes = STANDARD.decode(value).map_err(|_| VaultUnavailable)?;
    if bytes.len() < min || bytes.len() > max || STANDARD.encode(&bytes) != value {
        return Err(VaultUnavailable);
    }
    Ok(bytes)
}

#[derive(Clone)]
pub struct VaultPublicKey {
    key: PKey<Public>,
    key_id: String,
}
impl VaultPublicKey {
    pub fn parse(pem: &[u8]) -> Result<Self, VaultUnavailable> {
        if !pem.starts_with(b"-----BEGIN PUBLIC KEY-----") || pem.len() > 16384 {
            return Err(VaultUnavailable);
        }
        let key = PKey::public_key_from_pem(pem)?;
        if key.id() != Id::RSA || !(3072..=8192).contains(&key.bits()) {
            return Err(VaultUnavailable);
        }
        let key_id = sha256(key.public_key_to_der()?);
        Ok(Self { key, key_id })
    }
    pub fn key_id(&self) -> &str {
        &self.key_id
    }
    pub fn seal(&self, password: &str, context: &Context) -> Result<Envelope, VaultUnavailable> {
        if !valid_password(password) {
            return Err(VaultUnavailable);
        }
        let aad = context.aad()?;
        let mut data_key = Zeroizing::new([0u8; 32]);
        rand_bytes(data_key.as_mut())?;
        let mut nonce = [0u8; 12];
        rand_bytes(&mut nonce)?;
        let plaintext = Zeroizing::new(password.as_bytes().to_vec());
        let mut tag = [0u8; 16];
        let ciphertext = encrypt_aead(
            Cipher::aes_256_gcm(),
            data_key.as_ref(),
            Some(&nonce),
            &aad,
            &plaintext,
            &mut tag,
        )?;
        let mut encrypter = Encrypter::new(&self.key)?;
        encrypter.set_rsa_padding(Padding::PKCS1_OAEP)?;
        encrypter.set_rsa_oaep_md(MessageDigest::sha256())?;
        encrypter.set_rsa_mgf1_md(MessageDigest::sha256())?;
        encrypter.set_rsa_oaep_label(&aad)?;
        let mut wrapped_key = vec![0u8; encrypter.encrypt_len(data_key.as_ref())?];
        let length = encrypter.encrypt(data_key.as_ref(), &mut wrapped_key)?;
        wrapped_key.truncate(length);
        Ok(Envelope {
            format: 1,
            key_id: self.key_id.clone(),
            wrapped_key: STANDARD.encode(wrapped_key),
            nonce: STANDARD.encode(nonce),
            tag: STANDARD.encode(tag),
            ciphertext: STANDARD.encode(ciphertext),
        })
    }
}
