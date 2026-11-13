//! Independently captured contract inputs. Decode on demand and verify the
//! original byte hashes; expected results never come from the implementation.
use flate2::read::GzDecoder;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::Path,
    sync::{Arc, LazyLock, Mutex},
};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;

pub fn directory() -> &'static Path {
    Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/contracts"
    ))
}

pub fn bytes_in(directory: &Path, name: &str) -> Result<Vec<u8>> {
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    {
        return Err("Invalid contract input name".into());
    }
    let provenance: Value = serde_json::from_slice(&fs::read(directory.join("provenance.json"))?)?;
    let hash = provenance["sha256"][format!("{name}.json")]
        .as_str()
        .ok_or("Unknown frozen contract")?;
    let file = fs::File::open(directory.join(format!("{name}.json.gz")))?;
    let mut bytes = Vec::new();
    GzDecoder::new(file)
        .take(32 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 32 * 1024 * 1024 || kelryvo_core::sha256(&bytes) != hash {
        return Err("Frozen contract bytes changed".into());
    }
    Ok(bytes)
}

pub fn bytes(name: &str) -> Result<Arc<[u8]>> {
    static CACHE: LazyLock<Mutex<HashMap<String, Arc<[u8]>>>> = LazyLock::new(Mutex::default);
    let mut cache = CACHE.lock().map_err(|_| "Contract input cache poisoned")?;
    if let Some(bytes) = cache.get(name) {
        return Ok(bytes.clone());
    }
    let bytes: Arc<[u8]> = bytes_in(directory(), name)?.into();
    cache.insert(name.to_owned(), bytes.clone());
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captured_inputs_preserve_every_original_hash_and_contract_count() {
        let provenance: Value =
            serde_json::from_slice(&fs::read(directory().join("provenance.json")).unwrap())
                .unwrap();
        for filename in provenance["sha256"].as_object().unwrap().keys() {
            let name = filename.strip_suffix(".json").unwrap();
            let decoded = bytes(name).unwrap();
            let value: Value = serde_json::from_slice(&decoded).unwrap();
            if name == "core" {
                assert_eq!(value.as_array().unwrap().len(), 1228);
            }
            if name == "routes" {
                assert_eq!(value.as_array().unwrap().len(), 169);
            }
        }
        assert!(bytes("../core").is_err());
        assert!(bytes("unknown").is_err());
    }
}
