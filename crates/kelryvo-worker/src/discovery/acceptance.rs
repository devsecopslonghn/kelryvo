//! Native-only retained preflight evidence. Format 2 cannot acquire acceptance;
//! legacy liveAcceptance is still an unknown field. None of this admits a job.
use super::config::{Config, Target};
use crate::{installation, operator};
use chrono::{DateTime, Utc};
use kelryvo_core::{evidence, evidence_digest};
use kelryvo_discovery::{Operation, Result, Unavailable};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Acceptance {
    format: u8,
    driver_profile: String,
    source_commit: String,
    scope_digest: String,
    authorized_lab_id: String,
    accepted_at: DateTime<Utc>,
    evidence_digest: String,
    review_digest: String,
}
/// Explicit OS-operator review of native qualification evidence. A legacy lab
/// acceptance cannot authorize a different driver, artifact set or Oracle scope.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Review {
    format: u8,
    driver_profile: String,
    source_commit: String,
    authorization_id: String,
    expires_at: DateTime<Utc>,
    accepted_at: DateTime<Utc>,
    scope_digest: String,
    evidence_digest: String,
}
impl Review {
    pub(crate) fn load(path: &std::path::Path) -> Result<Self> {
        let bytes = kelryvo_launcher::bootstrap::read_operator_input(path, 16384)
            .map_err(|_| Unavailable)?;
        serde_json::from_slice(&bytes).map_err(|_| Unavailable)
    }
    pub(crate) fn scope(c: &installation::Config) -> String {
        evidence_digest(
            &json!({"kind":"KELRYVO_NATIVE_DISCOVERY_REVIEW_V1","driverProfile":c.driver_profile,"sourceCommit":c.source_commit,"appImageDigest":c.app_image_digest,
            "authorizationId":c.authorization_id,"expiresAt":c.expires_at,"artifacts":c.artifacts,"identity":c.identity,"route":c.route,
            "driverServerVersion":c.driver_server_version_string,"schemaOwners":c.reader_schemas,"protectedOwners":c.protected_owners}),
        )
    }
    pub(crate) fn validate_for(&self, c: &installation::Config) -> Result<()> {
        if self.format != 1
            || self.driver_profile != c.driver_profile
            || self.driver_profile != kelryvo_core::NATIVE_ORACLE_DRIVER_PROFILE
            || self.source_commit != c.source_commit
            || self.authorization_id != c.authorization_id
            || self.expires_at != c.expires().map_err(|_| Unavailable)?
            || self.expires_at <= Utc::now()
            || self.accepted_at > Utc::now()
            || self.accepted_at >= self.expires_at
            || self.scope_digest != Self::scope(c)
            || !digest(&self.evidence_digest)
        {
            return Err(Unavailable);
        }
        Ok(())
    }
    pub(crate) fn digest(&self) -> Result<String> {
        Ok(evidence_digest(
            &serde_json::to_value(self).map_err(|_| Unavailable)?,
        ))
    }
}
fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Config {
    fn scope_digest(&self) -> Result<String> {
        let mut value = serde_json::to_value(self).map_err(|_| Unavailable)?;
        for target in value["targets"].as_array_mut().ok_or(Unavailable)? {
            target
                .as_object_mut()
                .ok_or(Unavailable)?
                .remove("nativeAcceptance");
        }
        Ok(evidence_digest(&value))
    }
    pub(super) fn validate_acceptance(&self) -> Result<()> {
        if self.format == 2 {
            if self.native_installation_digest.is_some()
                || self.targets.iter().any(|t| t.native_acceptance.is_some())
            {
                return Err(Unavailable);
            }
            return Ok(());
        }
        if self
            .native_installation_digest
            .as_deref()
            .is_none_or(|s| !digest(s))
            || !self.targets.iter().any(|t| t.native_acceptance.is_some())
        {
            return Err(Unavailable);
        }
        let scope = self.scope_digest()?;
        for target in &self.targets {
            if let Some(a) = &target.native_acceptance
                && (a.format != 1
                    || a.driver_profile != self.driver_profile
                    || a.source_commit != self.source_commit
                    || a.scope_digest != scope
                    || a.authorized_lab_id != self.authorization_id
                    || a.accepted_at > Utc::now()
                    || a.accepted_at >= self.expires_at
                    || !digest(&a.evidence_digest)
                    || !digest(&a.review_digest)
                    || target.expected_identity.is_none()
                    || target.connection.transport != "TCPS"
                    || target.connection.credential_mode.as_deref() != Some("INSTANCE_MASTER"))
            {
                return Err(Unavailable);
            }
        }
        Ok(())
    }
    /// Only a fresh non-deserializable native Inspection can create this proof.
    pub(crate) fn accept_inspection(
        &mut self,
        installation: &installation::Config,
        inspection: &operator::Inspection,
        review: &Review,
    ) -> Result<()> {
        self.validate()?;
        if self.format != 2
            || self.targets.len() != 1
            || self.targets[0].native_acceptance.is_some()
            || self.source_commit != installation.source_commit
            || self.authorization_id != installation.authorization_id
            || self.targets[0].connection.id != installation.connection_id
            || self.targets[0].connection.revision != installation.connection_revision
            || self.targets[0].expected_identity.as_ref() != Some(&installation.identity)
            || self.targets[0].schema_owners != installation.reader_schemas
            || self.expires_at != installation.expires().map_err(|_| Unavailable)?
            || self.client_directory != installation.client_directory
            || self.wallet_directory != installation.wallet_directory
            || serde_json::to_value(&self.artifacts).map_err(|_| Unavailable)?
                != serde_json::to_value(&installation.artifacts).map_err(|_| Unavailable)?
            || self.targets[0].observer_username != installation.principals.observer
            || self.targets[0].certificate_dn.as_ref()
                != Some(&installation.route.server_certificate_dn)
            || self.targets[0].pinned_ips != installation.route.pinned_ips
            || self.targets[0].connection.host != installation.route.host
            || self.targets[0].connection.port != installation.route.port
            || self.targets[0].connection.service != installation.route.service
            || self.targets[0].connection.username != installation.master_username
            || self.targets[0].connection.credential_ref.as_ref()
                != Some(&installation.master_credential_ref)
        {
            return Err(Unavailable);
        }
        review.validate_for(installation)?;
        let preflight = inspection
            .discovery_evidence(installation)
            .map_err(|_| Unavailable)?;
        let review_digest = review.digest()?;
        let evidence = evidence_digest(
            &json!({"kind":"KELRYVO_NATIVE_DISCOVERY_EVIDENCE_V1","reviewDigest":review_digest,"qualificationEvidenceDigest":review.evidence_digest,"nativePreflightDigest":preflight}),
        );
        self.format = 3;
        self.native_installation_digest = Some(installation.installation_digest.clone());
        let scope = self.scope_digest()?;
        self.targets[0].native_acceptance = Some(Acceptance {
            format: 1,
            driver_profile: self.driver_profile.clone(),
            source_commit: self.source_commit.clone(),
            scope_digest: scope,
            authorized_lab_id: self.authorization_id.clone(),
            accepted_at: review.accepted_at,
            evidence_digest: evidence,
            review_digest,
        });
        self.validate()
    }
    pub(crate) fn reviewed_by(&self, digest: &str) -> bool {
        self.targets.iter().all(|t| {
            t.native_acceptance
                .as_ref()
                .is_some_and(|a| a.review_digest == digest)
        })
    }
    pub(crate) fn project_acceptance(
        &self,
        target: &Target,
        operation: Operation,
        mut result: Value,
    ) -> Result<Value> {
        self.validate()?;
        // The OCI child, never IPC input or a fixture collector, calls this path.
        result["verificationAcceptance"] = Value::Null;
        let Some(a) = &target.native_acceptance else {
            return Ok(result);
        };
        if operation != Operation::Discover
            || result["provenance"] != "ORACLE_READ_ONLY"
            || !matches!(result["status"].as_str(), Some("OBSERVED" | "PARTIAL"))
            || target.expected_identity.as_ref() != Some(&result["identity"])
            || evidence::exact_identity(&result["identity"]).as_ref() != Some(&result["identity"])
            || result["limitations"]
                .as_array()
                .is_none_or(|codes| codes.iter().any(|c| c != "SCHEMA_VISIBILITY_LIMITED"))
        {
            return Ok(result);
        }
        let Some(rows) = result["schemas"].as_array_mut() else {
            return Ok(result);
        };
        if rows.len() > 500
            || !rows
                .iter()
                .any(|r| r["owner"] == target.observer_username && r["accessible"] == true)
        {
            return Ok(result);
        }
        for row in rows.iter_mut() {
            if row["owner"]
                .as_str()
                .is_some_and(|owner| target.schema_owners.iter().any(|s| s == owner))
            {
                row["accessible"] = json!(true);
            }
        }
        if rows.iter().all(|r| r["accessible"] == true) {
            result["limitations"] = json!([]);
            result["status"] = json!("OBSERVED");
        }
        let connection = &target.connection;
        let public = json!({"authorizedLabId":a.authorized_lab_id,"acceptedAt":a.accepted_at.to_rfc3339_opts(chrono::SecondsFormat::Millis,true),
            "evidenceDigest":a.evidence_digest,"manifestDigest":evidence_digest(&serde_json::to_value(self).map_err(|_|Unavailable)?),
            "targetConfigDigest":evidence_digest(&json!({"engine":connection.engine,"host":connection.host,"port":connection.port,"service":connection.service,"transport":connection.transport.to_lowercase(),"username":connection.username,"credentialRef":connection.credential_ref})),
            "expectedIdentityDigest":evidence_digest(&result["identity"]),"schemaOwners":target.schema_owners});
        if evidence::accepted_observation(&result["identity"], &public, None, Utc::now()) {
            result["verificationAcceptance"] = public;
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    //! Synthetic private protocol fixtures exercise encoding, never Oracle
    //! qualification or a production Inspection/installation.
    use super::*;
    use crate::installation_test_support::fixture;
    use kelryvo_discovery::{Request, Response};
    fn configured() -> (std::path::PathBuf, Config) {
        let (root, installation) = fixture();
        let mut raw = crate::discovery::tests::manifest(&installation);
        raw["format"] = json!(3);
        raw["nativeInstallationDigest"] = json!("5".repeat(64));
        let mut config: Config = serde_json::from_value(raw).unwrap();
        let scope_digest = config.scope_digest().unwrap();
        config.targets[0].native_acceptance = Some(Acceptance {
            format: 1,
            driver_profile: config.driver_profile.clone(),
            source_commit: config.source_commit.clone(),
            scope_digest,
            authorized_lab_id: config.authorization_id.clone(),
            accepted_at: Utc::now() - chrono::Duration::minutes(1),
            evidence_digest: "6".repeat(64),
            review_digest: "b".repeat(64),
        });
        config.validate().unwrap();
        (root, config)
    }
    fn observed(config: &Config) -> Value {
        json!({"status":"PARTIAL","provenance":"ORACLE_READ_ONLY","identity":config.targets[0].expected_identity,"limitations":["SCHEMA_VISIBILITY_LIMITED"],"schemas":[{"owner":"KRY_OBSERVER","accessible":true},{"owner":"APP","accessible":null},{"owner":"HIDDEN","accessible":null}],"verificationAcceptance":null})
    }
    #[test]
    fn acceptance_is_native_and_binds_complete_manifest_scope() {
        let (_root, config) = configured();
        let raw = serde_json::to_value(&config).unwrap();
        let mut base = raw.clone();
        base["format"] = json!(2);
        base.as_object_mut()
            .unwrap()
            .remove("nativeInstallationDigest");
        base["targets"][0]
            .as_object_mut()
            .unwrap()
            .remove("nativeAcceptance");
        let expected: Config = serde_json::from_value(base).unwrap();
        let installation = config.native_installation_digest.as_deref().unwrap();
        assert!(
            crate::publication::observer_scope_matches(
                &config,
                &expected,
                installation,
                Some(&"b".repeat(64))
            )
            .unwrap()
        );
        assert!(
            !crate::publication::observer_scope_matches(
                &expected,
                &expected,
                installation,
                Some(&"b".repeat(64))
            )
            .unwrap()
        );
        assert!(
            !crate::publication::observer_scope_matches(
                &config,
                &expected,
                &"a".repeat(64),
                Some(&"b".repeat(64))
            )
            .unwrap()
        );
        assert!(
            !crate::publication::observer_scope_matches(&config, &expected, installation, None)
                .unwrap()
        );
        assert!(
            crate::publication::observer_scope_matches(&expected, &expected, installation, None)
                .unwrap()
        );
        assert!(
            !crate::publication::observer_scope_matches(
                &config,
                &expected,
                installation,
                Some(&"c".repeat(64))
            )
            .unwrap()
        );
        let mut old = raw.clone();
        old["format"] = json!(2);
        assert!(
            serde_json::from_value::<Config>(old)
                .unwrap()
                .validate()
                .is_err()
        );
        for (field, value) in [
            ("revision", json!("2")),
            ("credentialRef", json!("vault://kelryvo/replaced")),
            ("service", json!("REPLACED")),
        ] {
            let mut changed = raw.clone();
            changed["targets"][0]["connection"][field] = value;
            assert!(
                serde_json::from_value::<Config>(changed)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
        for field in [
            "driverProfile",
            "sourceCommit",
            "authorizationId",
            "nativeInstallationDigest",
        ] {
            let mut changed = raw.clone();
            changed[field] = json!("0".repeat(if field == "sourceCommit" { 40 } else { 64 }));
            assert!(
                serde_json::from_value::<Config>(changed)
                    .unwrap()
                    .validate()
                    .is_err()
            );
        }
        let mut changed = raw.clone();
        changed["artifacts"][0]["sha256"] = json!("9".repeat(64));
        assert!(
            serde_json::from_value::<Config>(changed)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut changed = raw.clone();
        changed["targets"][0]["schemaOwners"] = json!(["OTHER"]);
        assert!(
            serde_json::from_value::<Config>(changed)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut changed = raw.clone();
        changed["targets"][0]["serverCertificateDN"] = json!("CN=replaced");
        assert!(
            serde_json::from_value::<Config>(changed)
                .unwrap()
                .validate()
                .is_err()
        );
        let mut changed = raw;
        changed["targets"][0]["liveAcceptance"] = json!({"acceptedAt":"2000-01-01"});
        assert!(serde_json::from_value::<Config>(changed).is_err());
    }
    #[test]
    fn scoped_public_evidence_survives_ipc_and_matches_the_retained_verifier() {
        let (_root, config) = configured();
        let target = &config.targets[0];
        let result = config
            .project_acceptance(target, Operation::Discover, observed(&config))
            .unwrap();
        assert_eq!(result["schemas"][1]["accessible"], true);
        assert!(result["schemas"][2]["accessible"].is_null());
        assert_eq!(result["status"], "PARTIAL");
        assert!(evidence::accepted_observation(
            &result["identity"],
            &result["verificationAcceptance"],
            Some("APP"),
            Utc::now()
        ));
        assert!(!evidence::accepted_observation(
            &result["identity"],
            &result["verificationAcceptance"],
            Some("HIDDEN"),
            Utc::now()
        ));
        let request = Request::new(
            serde_json::to_value(&target.connection).unwrap(),
            Operation::Discover,
        )
        .unwrap();
        let wire = serde_json::to_vec(&Response::new(&request, result.clone())).unwrap();
        let public = serde_json::from_slice::<Response>(&wire)
            .unwrap()
            .result(&request)
            .unwrap();
        assert_eq!(
            public["verificationAcceptance"],
            result["verificationAcceptance"]
        );
        assert!(public.get("artifacts").is_none());
        assert!(public.get("nativeInstallationDigest").is_none());
    }
    #[test]
    fn fixtures_identity_gaps_and_incomplete_catalogs_cannot_gain_acceptance() {
        let (_root, config) = configured();
        let target = &config.targets[0];
        let observed = observed(&config);
        for (field, value) in [
            ("provenance", json!("FIXTURE")),
            ("identity", Value::Null),
            ("limitations", json!(["INVENTORY_TRUNCATED"])),
            ("schemas", json!([{"owner":"APP","accessible":true}])),
        ] {
            let mut invalid = observed.clone();
            invalid[field] = value;
            assert!(
                config
                    .project_acceptance(target, Operation::Discover, invalid)
                    .unwrap()["verificationAcceptance"]
                    .is_null()
            );
        }
        assert!(
            config
                .project_acceptance(target, Operation::Test, observed.clone())
                .unwrap()["verificationAcceptance"]
                .is_null()
        );
        assert!(
            config
                .project_acceptance(target, Operation::Schema, observed)
                .unwrap()["verificationAcceptance"]
                .is_null()
        );
    }
}
