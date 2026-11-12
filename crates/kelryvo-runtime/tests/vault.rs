use kelryvo_runtime::vault::VaultPrivateKey;
use kelryvo_vault::{Context, Envelope, VaultPublicKey, endpoint_digest, valid_password};
use openssl::{pkey::PKey, rsa::Rsa};
use serde_json::{Value, json};
use std::sync::LazyLock;

static VECTOR: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("../../../tests/fixtures/contracts/vault.json")).unwrap()
});
static PAIR: LazyLock<(Vec<u8>, Vec<u8>)> = LazyLock::new(|| {
    (
        VECTOR["publicPem"].as_str().unwrap().as_bytes().to_vec(),
        VECTOR["privatePem"].as_str().unwrap().as_bytes().to_vec(),
    )
});
fn context() -> Context {
    Context {
        organization_id: "00000000-0000-4000-8000-000000000001".into(),
        connection_id: "00000000-0000-4000-8000-000000000002".into(),
        credential_id: "00000000-0000-4000-8000-000000000003".into(),
        username: "MIGRATION_MASTER".into(),
        purpose: "INSTANCE_MASTER".into(),
        endpoint_digest: "e".repeat(64),
    }
}

#[test]
fn native_and_reference_vaults_interoperate_without_changing_ciphertext_format() {
    let public = VaultPublicKey::parse(&PAIR.0).expect("public key");
    let private = VaultPrivateKey::parse(&PAIR.1).expect("private key");
    assert_eq!(VECTOR["keyId"], public.key_id());
    for password in [
        "vault-canary-with-spaces & unicode-đ😀",
        "x",
        " ",
        "€",
        &"x".repeat(4096),
    ] {
        let context = context();
        let sealed = public.seal(password, &context).expect("native encryption");
        let opened = private.open(&sealed, &context).expect("native decryption");
        assert_eq!(opened.as_str(), password);
        let vector = VECTOR["cases"]
            .as_array()
            .unwrap()
            .iter()
            .find(|c| c["password"] == password)
            .unwrap();
        let sealed: Envelope = serde_json::from_value(vector["envelope"].clone()).unwrap();
        assert_eq!(
            private
                .open(&sealed, &context)
                .expect("reference ciphertext decryption")
                .as_str(),
            password
        );
    }
}

#[test]
fn every_scope_field_is_authenticated_and_every_envelope_byte_is_checked() {
    let public = VaultPublicKey::parse(&PAIR.0).expect("public key");
    let private = VaultPrivateKey::parse(&PAIR.1).expect("private key");
    let context = context();
    let sealed = public.seal("native vault canary", &context).expect("seal");
    let again = public.seal("native vault canary", &context).expect("seal");
    assert_ne!(sealed.nonce, again.nonce);
    assert_ne!(sealed.wrapped_key, again.wrapped_key);
    for field in [
        "organizationId",
        "connectionId",
        "credentialId",
        "username",
        "purpose",
        "endpointDigest",
    ] {
        let mut changed = serde_json::to_value(&context).expect("context JSON");
        changed[field] = match field {
            "username" => "OTHER".into(),
            "purpose" => "DEPLOY".into(),
            "endpointDigest" => "f".repeat(64).into(),
            _ => "00000000-0000-4000-8000-000000000009".into(),
        };
        assert!(
            private
                .open(
                    &sealed,
                    &serde_json::from_value(changed).expect("changed context")
                )
                .is_err(),
            "{field}"
        );
    }
    for field in ["wrappedKey", "nonce", "tag", "ciphertext"] {
        let mut changed = serde_json::to_value(&sealed).expect("envelope");
        let mut bytes = openssl::base64::decode_block(changed[field].as_str().expect("base64"))
            .expect("canonical base64");
        bytes[0] ^= 1;
        changed[field] = openssl::base64::encode_block(&bytes).into();
        assert!(
            private
                .open(
                    &serde_json::from_value(changed).expect("changed ciphertext"),
                    &context
                )
                .is_err(),
            "{field} bit tampering"
        );
        for change in [
            "not-base64!".to_owned(),
            "".to_owned(),
            "AA==".to_owned(),
            format!(
                "{}=",
                serde_json::to_value(&sealed).expect("envelope")[field]
                    .as_str()
                    .expect("base64")
            ),
        ] {
            let mut changed = serde_json::to_value(&sealed).expect("envelope");
            changed[field] = change.into();
            assert!(
                private
                    .open(
                        &serde_json::from_value(changed).expect("changed envelope"),
                        &context
                    )
                    .is_err(),
                "{field}"
            );
        }
    }
    let mut changed = serde_json::to_value(&sealed).expect("envelope");
    changed["keyId"] = "0".repeat(64).into();
    assert!(
        private
            .open(
                &serde_json::from_value(changed).expect("changed envelope"),
                &context
            )
            .is_err()
    );
    let mut changed = serde_json::to_value(&sealed).expect("envelope");
    changed["extra"] = true.into();
    assert!(serde_json::from_value::<Envelope>(changed).is_err());
    assert!(
        !serde_json::to_value(sealed)
            .expect("ciphertext")
            .to_string()
            .contains("native vault canary")
    );
}

#[test]
fn rejects_private_public_key_confusion_weak_keys_and_invalid_passwords() {
    assert!(VaultPublicKey::parse(&PAIR.1).is_err());
    assert!(VaultPrivateKey::parse(&PAIR.0).is_err());
    let weak = PKey::from_rsa(Rsa::generate(2048).expect("weak test RSA")).expect("weak key");
    assert!(VaultPublicKey::parse(&weak.public_key_to_pem().expect("PEM")).is_err());
    let public = VaultPublicKey::parse(&PAIR.0).expect("public key");
    for value in [
        "",
        "a\nb",
        "a\rb",
        "a\0b",
        &"x".repeat(4097),
        &"😀".repeat(2049),
    ] {
        assert!(!valid_password(value));
        assert!(public.seal(value, &context()).is_err());
    }
    assert_eq!(
        endpoint_digest(&json!({"host":"host","port":1521,"service":"pdb","transport":"TCPS"}))
            .expect("endpoint digest"),
        kelryvo_core::sha256("[\"host\",1521,\"pdb\",\"TCPS\"]")
    );
}
