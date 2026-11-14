//! Operator-owned identity routes and secrets; provider metadata cannot expand them.
use crate::config::ConfigurationUnavailable;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use openssl::symm::{Cipher, decrypt_aead, encrypt_aead};
use rand::RngCore;
use regex::Regex;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    net::IpAddr,
    sync::LazyLock,
};
use url::Url;
use zeroize::Zeroizing;
pub struct Runtime {
    pub origin: String,
    pub routes: Vec<Value>,
    secrets: HashMap<String, Zeroizing<String>>,
    key: Zeroizing<Vec<u8>>,
}
pub fn s(v: &Value) -> &str {
    v.as_str().unwrap_or_default()
}
pub fn text(v: &Value, max: usize) -> bool {
    v.as_str().is_some_and(|s| {
        !s.trim_matches(kelryvo_core::js_whitespace).is_empty()
            && s.encode_utf16().count() <= max
            && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    })
}
fn exact_keys(v: &Value, keys: &[&str]) -> bool {
    kelryvo_core::plan::keys(v, keys) && v.as_object().is_some_and(|v| v.len() == keys.len())
}
fn origin(value: &str) -> Option<Url> {
    let u = Url::parse(value).ok()?;
    (u.scheme() == "https"
        && u.origin().ascii_serialization() == value
        && u.username().is_empty()
        && u.password().is_none())
    .then_some(u)
}
fn values(v: &Value) -> Option<&Vec<Value>> {
    v.as_array().filter(|a| !a.is_empty())
}
fn alias(v: &Value) -> bool {
    static P: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\A[a-z][a-z0-9-]{0,63}\z").expect("identity alias"));
    v.as_str().is_some_and(|s| P.is_match(s))
}
fn issuer_prefix(v: &Value) -> bool {
    let p = s(v);
    if p == "/" {
        return true;
    }
    p.starts_with('/')
        && p.len() <= 1024
        && p.strip_suffix('/')
            .unwrap_or(p)
            .strip_prefix('/')
            .is_some_and(|p| {
                !p.is_empty()
                    && p.split('/').all(|part| {
                        !part.is_empty()
                            && part != "."
                            && part != ".."
                            && part
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b"-._~".contains(&b))
                    })
            })
}
impl Runtime {
    pub fn parse(bytes: &[u8]) -> Result<Self, ConfigurationUnavailable> {
        let bad = ConfigurationUnavailable;
        if bytes.len() > 131072 {
            return Err(bad);
        }
        let mut v: Value = serde_json::from_slice(bytes).map_err(|_| bad)?;
        if v["format"] != 1 {
            return Err(bad);
        }
        let key = v["key"].take();
        let key = match key {
            Value::String(key) => Zeroizing::new(key),
            _ => return Err(bad),
        };
        if key.len() != 64
            || !key
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(bad);
        }
        let key = Zeroizing::new(
            (0..64)
                .step_by(2)
                .map(|i| u8::from_str_radix(&key[i..i + 2], 16).map_err(|_| bad))
                .collect::<Result<Vec<_>, _>>()?,
        );
        let public_origin = s(&v["publicOrigin"]).to_owned();
        origin(&public_origin).ok_or(bad)?;
        let mut secrets = HashMap::new();
        let secret_values = v["secrets"].take();
        let Value::Object(secret_values) = secret_values else {
            return Err(bad);
        };
        for (alias, value) in secret_values {
            let Value::String(secret) = value else {
                return Err(bad);
            };
            secrets.insert(alias, Zeroizing::new(secret));
        }
        let routes = v["routes"].as_array().ok_or(bad)?.clone();
        if routes.len() > 20 {
            return Err(bad);
        }
        let mut ids = HashSet::new();
        for r in &routes {
            if !alias(&r["id"])
                || !ids.insert(s(&r["id"]))
                || !["OIDC", "LDAP"].contains(&s(&r["kind"]))
                || !values(&r["pinnedIPs"]).is_some_and(|ips| {
                    ips.len() <= 8 && ips.iter().all(|ip| s(ip).parse::<IpAddr>().is_ok())
                })
                || !values(&r["secretRefs"]).is_some_and(|refs| {
                    refs.iter().all(|name| {
                        alias(name)
                            && secrets.get(s(name)).is_some_and(|s| {
                                !s.is_empty()
                                    && s.encode_utf16().count() <= 4096
                                    && !s.contains(['\0', '\r', '\n'])
                            })
                    })
                })
                || r.get("ca")
                    .is_some_and(|v| !v.is_string() || s(v).encode_utf16().count() > 32768)
            {
                return Err(bad);
            }
            if r["kind"] == "OIDC" {
                if origin(s(&r["origin"])).is_none() || !issuer_prefix(&r["issuerPrefix"]) {
                    return Err(bad);
                }
            } else {
                let host = s(&r["host"]);
                if host.is_empty()
                    || host.len() > 253
                    || host.parse::<IpAddr>().is_ok()
                    || !host.split('.').all(|part| {
                        !part.is_empty()
                            && part.len() <= 63
                            && part
                                .as_bytes()
                                .first()
                                .is_some_and(u8::is_ascii_alphanumeric)
                            && part
                                .as_bytes()
                                .last()
                                .is_some_and(u8::is_ascii_alphanumeric)
                            && part.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    })
                    || r["transport"] != "LDAPS"
                    || r["port"] != 636
                    || !["baseDNs", "bindDNs"].iter().all(|key| {
                        values(&r[*key]).is_some_and(|v| {
                            v.iter().all(|v| {
                                v.is_string()
                                    && !s(v).is_empty()
                                    && s(v).encode_utf16().count() <= 512
                            })
                        })
                    })
                {
                    return Err(bad);
                }
            }
        }
        Ok(Self {
            origin: public_origin,
            routes,
            secrets,
            key,
        })
    }
    pub fn route(&self, id: &str, kind: &str) -> Option<&Value> {
        self.routes
            .iter()
            .find(|r| r["id"] == id && r["kind"] == kind)
    }
    pub fn valid_provider(&self, kind: &str, c: &Value) -> bool {
        let Some(r) = self.route(s(&c["routeId"]), kind) else {
            return false;
        };
        let secret_ok =
            |alias: &Value| values(&r["secretRefs"]).is_some_and(|refs| refs.contains(alias));
        if kind == "OIDC" {
            if !exact_keys(c, &["clientId", "clientSecretRef", "issuer", "routeId"])
                || !text(&c["clientId"], 200)
                || !c["issuer"].is_string()
                || s(&c["issuer"]).encode_utf16().count() > 2048
                || !secret_ok(&c["clientSecretRef"])
            {
                return false;
            }
            let Ok(u) = Url::parse(s(&c["issuer"])) else {
                return false;
            };
            let prefix = s(&r["issuerPrefix"]).trim_end_matches('/');
            u.scheme() == "https"
                && u.origin().ascii_serialization() == s(&r["origin"])
                && u.query().is_none()
                && u.fragment().is_none()
                && u.username().is_empty()
                && u.password().is_none()
                && (u.path() == prefix || u.path().starts_with(&format!("{prefix}/")))
                && u.as_str().trim_end_matches('/') == s(&c["issuer"]).trim_end_matches('/')
        } else {
            kind == "LDAP"
                && exact_keys(
                    c,
                    &[
                        "baseDN",
                        "bindDN",
                        "bindSecretRef",
                        "loginAttribute",
                        "routeId",
                        "subjectAttribute",
                    ],
                )
                && values(&r["baseDNs"]).is_some_and(|v| v.contains(&c["baseDN"]))
                && values(&r["bindDNs"]).is_some_and(|v| v.contains(&c["bindDN"]))
                && secret_ok(&c["bindSecretRef"])
                && ["uid", "sAMAccountName", "userPrincipalName"].contains(&s(&c["loginAttribute"]))
                && c["subjectAttribute"] == "entryUUID"
        }
    }
    pub fn public_routes(&self) -> Vec<Value> {
        self.routes
            .iter()
            .map(|r| {
                let mut result =
                    json!({"id":r["id"],"kind":r["kind"],"name":r.get("name").unwrap_or(&r["id"])});
                for key in [
                    "origin",
                    "issuerPrefix",
                    "host",
                    "port",
                    "transport",
                    "secretRefs",
                    "baseDNs",
                    "bindDNs",
                ] {
                    if let Some(v) = r.get(key) {
                        result[if key == "origin" { "issuerOrigin" } else { key }] = v.clone();
                    }
                }
                result
            })
            .collect()
    }
    pub fn secret(&self, route: &Value, alias: &str) -> Option<&str> {
        values(&route["secretRefs"]).filter(|v| v.iter().any(|v| v == alias))?;
        self.secrets.get(alias).map(|s| s.as_str())
    }
    pub fn seal(&self, flow: &Value) -> Option<String> {
        let mut iv = [0; 12];
        rand::rngs::OsRng.fill_bytes(&mut iv);
        let mut tag = [0; 16];
        let encrypted = encrypt_aead(
            Cipher::aes_256_gcm(),
            &self.key,
            Some(&iv),
            b"",
            flow.to_string().as_bytes(),
            &mut tag,
        )
        .ok()?;
        Some(URL_SAFE_NO_PAD.encode([iv.as_slice(), encrypted.as_slice(), tag.as_slice()].concat()))
    }
    pub fn unseal(&self, cookie: &str) -> Option<Value> {
        if !(60..=2048).contains(&cookie.len()) {
            return None;
        }
        let raw = URL_SAFE_NO_PAD.decode(cookie).ok()?;
        if raw.len() < 28 {
            return None;
        }
        let bytes = Zeroizing::new(
            decrypt_aead(
                Cipher::aes_256_gcm(),
                &self.key,
                Some(&raw[..12]),
                b"",
                &raw[12..raw.len() - 16],
                &raw[raw.len() - 16..],
            )
            .ok()?,
        );
        serde_json::from_slice(&bytes).ok()
    }
}
