use kelryvo_vault::{Context, Envelope, VaultPublicKey, VaultUnavailable, decode, valid_password};
use openssl::{
    encrypt::Decrypter,
    hash::MessageDigest,
    pkey::{PKey, Private},
    rsa::Padding,
    symm::{Cipher, Crypter, Mode},
};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;
use zeroize::Zeroizing;

pub struct VaultPrivateKey {
    key: PKey<Private>,
    key_id: String,
}
impl VaultPrivateKey {
    pub fn parse(pem: &[u8]) -> Result<Self, VaultUnavailable> {
        if pem.len() > 16384 {
            return Err(VaultUnavailable);
        }
        let key = PKey::private_key_from_pem(pem)?;
        let public = VaultPublicKey::parse(&key.public_key_to_pem()?)?;
        Ok(Self {
            key,
            key_id: public.key_id().to_owned(),
        })
    }
    /// Privileged fixed-runtime use only. Do not register a decrypt HTTP endpoint.
    pub fn open(
        &self,
        envelope: &Envelope,
        context: &Context,
    ) -> Result<Zeroizing<String>, VaultUnavailable> {
        if envelope.format != 1 || envelope.key_id != self.key_id {
            return Err(VaultUnavailable);
        }
        let aad = context.aad()?;
        let mut decrypt = Decrypter::new(&self.key)?;
        decrypt.set_rsa_padding(Padding::PKCS1_OAEP)?;
        decrypt.set_rsa_oaep_md(MessageDigest::sha256())?;
        decrypt.set_rsa_mgf1_md(MessageDigest::sha256())?;
        decrypt.set_rsa_oaep_label(&aad)?;
        let wrapped = decode(&envelope.wrapped_key, 384, 1024)?;
        let mut data_key = Zeroizing::new(vec![0u8; decrypt.decrypt_len(&wrapped)?]);
        let length = decrypt.decrypt(&wrapped, &mut data_key)?;
        if length != 32 {
            return Err(VaultUnavailable);
        }
        data_key.truncate(length);
        let ciphertext = decode(&envelope.ciphertext, 1, 8192)?;
        let cipher = Cipher::aes_256_gcm();
        let mut decrypt = Crypter::new(
            cipher,
            Mode::Decrypt,
            &data_key,
            Some(&decode(&envelope.nonce, 12, 12)?),
        )?;
        decrypt.pad(false);
        decrypt.aad_update(&aad)?;
        decrypt.set_tag(&decode(&envelope.tag, 16, 16)?)?;
        let mut plaintext = Zeroizing::new(vec![0u8; ciphertext.len() + cipher.block_size()]);
        let count = decrypt.update(&ciphertext, &mut plaintext)?;
        let total = count + decrypt.finalize(&mut plaintext[count..])?;
        plaintext.truncate(total);
        let password = std::str::from_utf8(&plaintext).map_err(|_| VaultUnavailable)?;
        if !valid_password(password) {
            return Err(VaultUnavailable);
        }
        Ok(Zeroizing::new(password.to_owned()))
    }
}

/// Resolve against the exact current connection and metadata generation. A
/// request-supplied envelope or stale reference never grants decryption access.
pub async fn resolve(
    pool: &PgPool,
    expected: &Value,
    key: &VaultPrivateKey,
) -> Result<Zeroizing<String>, VaultUnavailable> {
    let reference = expected["credentialRef"].as_str().ok_or(VaultUnavailable)?;
    let credential = reference
        .strip_prefix("vault://kelryvo/")
        .filter(|s| {
            s.len() == 36
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
                && kelryvo_core::uuid(&json!(s))
        })
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(VaultUnavailable)?;
    let connection = expected["id"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(VaultUnavailable)?;
    let org = expected["organizationId"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or(VaultUnavailable)?;
    let port = expected["port"]
        .as_i64()
        .and_then(|p| i32::try_from(p).ok())
        .ok_or(VaultUnavailable)?;
    let row:Value=sqlx::query_scalar("SELECT to_jsonb(v) FROM sf_oracle_credentials v JOIN sf_database_connections c ON c.id=v.connection_id AND c.organization_id=v.organization_id JOIN sf_metadata_current mc ON mc.singleton JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE' WHERE v.id=$1 AND c.id=$2 AND c.organization_id=$3 AND c.credential_ref=$4 AND c.username=$5 AND c.host=$6 AND c.port=$7 AND c.service=$8 AND c.transport=$9 AND c.revision::text=$10 AND c.credential_mode='INSTANCE_MASTER' AND c.service_kind='SERVICE_NAME' AND c.enabled AND c.retired_at IS NULL AND v.purpose='INSTANCE_MASTER' AND v.username=c.username AND NOT EXISTS(SELECT 1 FROM sf_oracle_credential_revocations r WHERE r.credential_id=v.id)")
        .bind(credential).bind(connection).bind(org).bind(reference).bind(expected["username"].as_str()).bind(expected["host"].as_str()).bind(port).bind(expected["service"].as_str()).bind(expected["transport"].as_str()).bind(expected["revision"].as_str()).fetch_optional(pool).await.map_err(|_|VaultUnavailable)?.ok_or(VaultUnavailable)?;
    if row["key_id"] != row["envelope"]["keyId"]
        || row["endpoint_digest"] != kelryvo_vault::endpoint_digest(expected)?
    {
        return Err(VaultUnavailable);
    }
    let envelope: Envelope =
        serde_json::from_value(row["envelope"].clone()).map_err(|_| VaultUnavailable)?;
    let context:Context=serde_json::from_value(json!({"organizationId":row["organization_id"],"connectionId":row["connection_id"],"credentialId":row["id"],"username":row["username"],"purpose":row["purpose"],"endpointDigest":row["endpoint_digest"]})).map_err(|_|VaultUnavailable)?;
    key.open(&envelope, &context)
}
