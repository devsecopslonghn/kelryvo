//! Private PostgreSQL and file fixtures shared by local-credential tests.
use kelryvo_operator::{ActorSeed, seed};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub fn write(path: &Path, bytes: &[u8]) {
    let mut f = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    f.set_permissions(fs::Permissions::from_mode(0o600))
        .unwrap();
    f.write_all(bytes).unwrap();
    f.sync_all().unwrap();
}

pub struct Fixture {
    pub pool: PgPool,
    pub root: PathBuf,
    pub config: PathBuf,
    pub url: String,
}
impl Fixture {
    pub async fn new() -> Self {
        let base = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL").unwrap();
        assert!(base.starts_with("postgresql:///kelryvo_rust_test?host="));
        let admin = kelryvo_server::connect(&base).await.unwrap();
        let name = format!("sf_product_test_{}", Uuid::new_v4().simple());
        sqlx::query(&format!("CREATE DATABASE {name}"))
            .execute(&admin)
            .await
            .unwrap();
        admin.close().await;
        let url = base.replacen("/kelryvo_rust_test?", &format!("/{name}?"), 1);
        let pool = kelryvo_server::connect(&url).await.unwrap();
        kelryvo_server::initialize(&pool).await.unwrap();
        let actors = ["developer", "approver"]
            .into_iter()
            .zip(['a', 'b'])
            .map(|(role, c)| ActorSeed {
                id: format!("local-{role}"),
                name: format!("Local {role}"),
                role: role.into(),
                token: Zeroizing::new(c.to_string().repeat(64)),
            })
            .collect::<Vec<_>>();
        seed(&pool, &actors).await.unwrap();
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join(".cache")
            .join(format!("local-credential-native-{}", Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        write(&root.join("database-url"), url.as_bytes());
        let config = root.join("config.json");
        // Deliberately retain a noncanonical insertion order from a legacy file.
        let value = json!({"approverToken":"b".repeat(64),"databasePassword":"c".repeat(64),"developerToken":"a".repeat(64)});
        let mut bytes = serde_json::to_vec_pretty(&value).unwrap();
        bytes.push(b'\n');
        write(&config, &bytes);
        Self {
            pool,
            root,
            config,
            url,
        }
    }
    pub async fn snapshot(&self) -> Value {
        sqlx::query_scalar(
            "SELECT jsonb_agg(to_jsonb(c) ORDER BY token_sha256) FROM sf_local_credentials c",
        )
        .fetch_one(&self.pool)
        .await
        .unwrap()
    }
    pub fn value(&self) -> Value {
        serde_json::from_slice(&fs::read(&self.config).unwrap()).unwrap()
    }
    pub fn sidecar(&self, suffix: &str) -> PathBuf {
        format!("{}.{suffix}", self.config.display()).into()
    }
    pub fn clean(&self) {
        assert!(!self.sidecar("lifecycle-staged").exists());
        assert!(!self.sidecar("lifecycle-journal").exists());
    }
}
