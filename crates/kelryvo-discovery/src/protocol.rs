use crate::{Result, Unavailable};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::net::IpAddr;
use uuid::Uuid;
const VERSION: u8 = 1;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Operation {
    Test,
    Discover,
    Schema,
}
impl Operation {
    pub fn name(self) -> &'static str {
        match self {
            Self::Test => "TEST",
            Self::Discover => "DISCOVER",
            Self::Schema => "SCHEMA",
        }
    }
}
fn clean(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && !s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
}
fn uuid(id: Uuid) -> bool {
    id.get_variant() == uuid::Variant::RFC4122 && (1..=8).contains(&id.get_version_num())
}
fn host(s: &str) -> bool {
    clean(s, 253)
        && (s.parse::<IpAddr>().is_ok()
            || s.split('.').all(|p| {
                !p.is_empty()
                    && p.len() <= 63
                    && p.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
                    && p.as_bytes()[0].is_ascii_alphanumeric()
                    && p.as_bytes()[p.len() - 1].is_ascii_alphanumeric()
            }))
}
/// Retained endpoint facts only. Unknown fields (including SQL, passwords,
/// identity claims, paths and acceptance) are rejected during deserialization.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Connection {
    pub id: Uuid,
    pub revision: String,
    pub engine: String,
    pub host: String,
    pub port: u16,
    pub service: String,
    pub transport: String,
    pub username: String,
    pub credential_ref: Option<String>,
    pub credential_mode: Option<String>,
}
impl Connection {
    pub fn validate(&self) -> Result<()> {
        if !uuid(self.id)
            || self.revision.is_empty()
            || self.revision.len() > 19
            || self.revision.starts_with('0')
            || !self.revision.bytes().all(|b| b.is_ascii_digit())
            || self.revision.parse::<i64>().is_err()
            || self.engine != "oracle"
            || !host(&self.host)
            || self.port == 0
            || !clean(&self.service, 128)
            || !self
                .service
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_$#.-".contains(&b))
            || !["TCP", "TCPS"].contains(&self.transport.as_str())
            || !clean(&self.username, 128)
            || self
                .credential_mode
                .as_deref()
                .is_some_and(|s| !["INSTANCE_MASTER", "LEGACY_SEPARATE"].contains(&s))
            || self.credential_ref.as_deref().is_some_and(|s| {
                !clean(s, 512)
                    || !(s.starts_with("vault://") || s.starts_with("secret://"))
                    || !s
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"._~!$&'()*+,;=:@%/-".contains(&b))
            })
        {
            return Err(Unavailable);
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub version: u8,
    pub id: Uuid,
    pub connection: Connection,
    pub operation: Operation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
}
impl Request {
    pub fn new(mut connection: Value, operation: Operation) -> Result<Self> {
        let owner = connection
            .as_object_mut()
            .ok_or(Unavailable)?
            .remove("owner")
            .map(|v| v.as_str().map(str::to_owned).ok_or(Unavailable))
            .transpose()?;
        let request = Self {
            version: VERSION,
            id: Uuid::new_v4(),
            connection: serde_json::from_value(connection).map_err(|_| Unavailable)?,
            operation,
            owner,
        };
        request.validate()?;
        Ok(request)
    }
    pub fn validate(&self) -> Result<()> {
        self.connection.validate()?;
        if self.version != VERSION
            || !uuid(self.id)
            || match (self.operation, &self.owner) {
                (Operation::Schema, Some(owner)) => !clean(owner, 128),
                (Operation::Schema, None) => true,
                (_, Some(_)) => true,
                (_, None) => false,
            }
        {
            return Err(Unavailable);
        }
        Ok(())
    }
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub version: u8,
    pub id: Uuid,
    pub result: Value,
}
impl Response {
    pub fn new(request: &Request, result: Value) -> Self {
        Self {
            version: VERSION,
            id: request.id,
            result: sanitize(result, request),
        }
    }
    pub fn result(self, request: &Request) -> Result<Value> {
        if self.version != VERSION || self.id != request.id || !self.result.is_object() {
            return Err(Unavailable);
        }
        Ok(sanitize(self.result, request))
    }
}
fn sanitize(raw: Value, request: &Request) -> Value {
    let mut result = kelryvo_core::evidence::normalize_observation(
        &raw,
        if request.operation == Operation::Schema {
            "DISCOVER"
        } else {
            request.operation.name()
        },
        chrono::Utc::now(),
    );
    if request.operation == Operation::Schema {
        result["schema"] = kelryvo_core::schema::normalize(&raw["schema"], &json!(request.owner));
    }
    result
}
pub fn unavailable() -> Value {
    json!({"status":"UNAVAILABLE","provenance":"UNAVAILABLE","limitations":["RUNTIME_UNAVAILABLE"]})
}

#[cfg(test)]
mod tests {
    use super::*;
    fn connection() -> Value {
        json!({"id":Uuid::new_v4(),"revision":"1","engine":"oracle","host":"database.example","port":2484,"service":"app.example","transport":"TCPS","username":"APP","credentialRef":"vault://kelryvo/retained","credentialMode":"INSTANCE_MASTER"})
    }
    #[test]
    fn requests_carry_endpoint_facts_and_schema_owner_only() {
        let c = connection();
        assert!(Request::new(c.clone(), Operation::Discover).is_ok());
        for field in [
            "password",
            "sql",
            "manifestPath",
            "identity",
            "verificationAcceptance",
            "program",
        ] {
            let mut invalid = c.clone();
            invalid[field] = json!("untrusted");
            assert!(Request::new(invalid, Operation::Discover).is_err());
        }
        for (field, value) in [
            ("host", json!("host/escape")),
            ("port", json!(0)),
            ("transport", json!("tcps")),
            ("revision", json!(0)),
            ("credentialRef", json!("/private/password")),
        ] {
            let mut invalid = c.clone();
            invalid[field] = value;
            assert!(Request::new(invalid, Operation::Test).is_err());
        }
        let mut schema = c;
        schema["owner"] = json!("APP");
        assert!(Request::new(schema.clone(), Operation::Schema).is_ok());
        assert!(Request::new(schema, Operation::Discover).is_err());
        assert!(Request::new(connection(), Operation::Schema).is_err());
    }
    #[test]
    fn replies_are_correlated_bounded_evidence_without_runtime_secrets() {
        let request = Request::new(connection(), Operation::Test).unwrap();
        let response = Response::new(
            &request,
            json!({"status":"CONNECTED","provenance":"FIXTURE","password":"never returned","program":"never returned"}),
        );
        let result = response.result(&request).unwrap();
        assert_eq!(result["status"], "CONNECTED");
        assert!(result.get("password").is_none());
        assert!(
            result["limitations"]
                .as_array()
                .unwrap()
                .contains(&json!("LIVE_VERIFICATION_UNACCEPTED"))
        );
        let mut response = Response::new(&request, unavailable());
        response.id = Uuid::new_v4();
        assert!(response.result(&request).is_err());
    }
}
