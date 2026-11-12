//! Synthetic OCI bytes and a closed fake transport. No Docker Hub, registry
//! write, credentials or live artifact qualification are involved.
use super::*;
use crate::delivery::tests::{Fake, responses};
use std::os::unix::fs::PermissionsExt;
const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REPO: &str = "docker.io/test-owner/kelryvo-app";
fn bytes(v: &Value) -> Vec<u8> {
    serde_json::to_vec(v).unwrap()
}
fn digest(b: &[u8]) -> String {
    format!("sha256:{}", sha256(b))
}
struct Synthetic {
    pushed: bool,
    copies: usize,
    denied: bool,
    wrong_tag: bool,
    wrong_config: bool,
    failed_copy: bool,
    expected: Value,
    index: Vec<u8>,
    manifests: BTreeMap<String, Vec<u8>>,
    configs: BTreeMap<String, Vec<u8>>,
    push_auth: PathBuf,
}
impl Synthetic {
    fn new(session: &Session) -> Self {
        let mut manifests = BTreeMap::new();
        let mut configs = BTreeMap::new();
        let mut entries = Vec::new();
        let mut platforms = serde_json::Map::new();
        for arch in ["amd64", "arm64"] {
            let config = bytes(
                &json!({"architecture":arch,"os":"linux","config":{"User":"0:0","Entrypoint":["/opt/kelryvo/bin/kelryvo-runtime"],"Labels":{"org.opencontainers.image.revision":SHA,"org.opencontainers.image.source":"https://github.com/devsecopslonghn/kelryvo"}}}),
            );
            let manifest = bytes(
                &json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"digest":digest(&config),"size":config.len()},"layers":[]}),
            );
            let hash = digest(&manifest);
            platforms.insert(
                arch.into(),
                json!({"digest":hash,"manifestSize":manifest.len(),"configDigest":digest(&config)}),
            );
            entries.push(json!({"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":hash,"size":manifest.len(),"platform":{"os":"linux","architecture":arch}}));
            manifests.insert(hash.clone(), manifest);
            configs.insert(hash, config);
        }
        let index = bytes(
            &json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":entries}),
        );
        Self {
            pushed: false,
            copies: 0,
            denied: false,
            wrong_tag: false,
            wrong_config: false,
            failed_copy: false,
            expected: json!({"digest":digest(&index),"platforms":platforms}),
            index,
            manifests,
            configs,
            push_auth: session.auth.path().into(),
        }
    }
}
fn captured(success: bool, stdout: Vec<u8>, stderr: &str) -> Captured {
    Captured {
        success,
        stdout: Zeroizing::new(stdout),
        stderr: Zeroizing::new(stderr.as_bytes().to_vec()),
    }
}
impl Transport for Synthetic {
    async fn execute(&mut self, args: &[OsString], _: Duration) -> Result<Captured> {
        let args = args.iter().map(|s| s.to_str().unwrap()).collect::<Vec<_>>();
        if args.contains(&"copy") {
            self.copies += 1;
            assert!(
                args.contains(&"--all")
                    && args.contains(&"--preserve-digests")
                    && args.contains(&"--dest-tls-verify=true")
            );
            assert_eq!(
                Path::new(args[args.iter().position(|s| *s == "--dest-authfile").unwrap() + 1]),
                self.push_auth
            );
            if self.failed_copy {
                return Ok(captured(false, Vec::new(), "private diagnostic"));
            }
            self.pushed = true;
            return Ok(captured(true, Vec::new(), ""));
        }
        assert!(
            args.contains(&"inspect")
                && args.contains(&"--no-creds")
                && args.contains(&"--tls-verify=true")
        );
        let auth = Path::new(args[args.iter().position(|s| *s == "--authfile").unwrap() + 1]);
        assert_ne!(auth, self.push_auth);
        assert_eq!(
            fs::read(auth).unwrap(),
            br#"{"auths":{}}"#,
            "all reads have an independent empty session"
        );
        if self.denied {
            return Ok(captured(
                false,
                Vec::new(),
                "unauthorized: manifest unknown; private diagnostic",
            ));
        }
        if !self.pushed {
            return Ok(captured(false, Vec::new(), "manifest unknown"));
        }
        let target = args.last().unwrap();
        assert!(target.starts_with(&format!("docker://{REPO}")));
        let hash = target.split_once('@').map(|(_, hash)| hash);
        let mut output = if args.contains(&"--config") {
            if self.wrong_config {
                b"{}".to_vec()
            } else {
                self.configs[hash.unwrap()].clone()
            }
        } else if let Some(hash) = hash {
            self.manifests
                .get(hash)
                .cloned()
                .unwrap_or_else(|| self.index.clone())
        } else if self.wrong_tag {
            b"{}".to_vec()
        } else {
            self.index.clone()
        };
        output.push(b'\n');
        Ok(captured(true, output, ""))
    }
}
fn session() -> (tempfile::TempDir, PathBuf, Session) {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("auth.json");
    fs::write(&path,br#"{"auths":{"docker.io":{"auth":"private-fixture-value"},"ghcr.io":{"auth":"never forwarded"}},"credHelpers":{"docker.io":"never-run"}}"#).unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let session = Session::new(REPO.into(), &path).unwrap();
    (root, path, session)
}
#[test]
fn explicit_repository_and_private_credential_projection_reject_unsafe_inputs() {
    repository(REPO).unwrap();
    for bad in [
        "ghcr.io/team/app",
        "docker.io/team/app:latest",
        "docker.io/team/app@sha256:x",
        "https://user:private@docker.io/team/app",
        "docker.io/../app",
        "docker.io/x/app",
        "docker.io/team/app..suffix",
    ] {
        assert!(repository(bad).is_err(), "{bad}");
    }
    let (root, path, s) = session();
    let projected: Value = serde_json::from_slice(&fs::read(s.auth.path()).unwrap()).unwrap();
    assert_eq!(
        projected,
        json!({"auths":{"docker.io":{"auth":"private-fixture-value"}}})
    );
    let retained = fs::read(s.auth.path()).unwrap();
    fs::write(&path, b"changed after snapshot").unwrap();
    assert_eq!(fs::read(s.auth.path()).unwrap(), retained);
    let linked = root.path().join("linked");
    std::os::unix::fs::symlink(&path, &linked).unwrap();
    assert!(auth_snapshot(&linked).is_err());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(auth_snapshot(&path).is_err());
    assert_eq!(s.auth.as_file().metadata().unwrap().mode() & 0o777, 0o600);
    assert!(arguments(&vec!["--report".into(); 14]).is_err());
}
#[tokio::test]
async fn dockerhub_publication_preserves_anonymous_proof_gates_and_immutable_tag_reuse() {
    let (_root, _path, s) = session();
    let mut transport = Synthetic::new(&s);
    let expected = transport.expected.clone();
    let id = Identity::new(SHA.into(), "4".into(), "2".into()).unwrap();
    let archive = Path::new("private-fixture-archive");
    let result = publish(
        &mut Fake::new(&responses()),
        &mut transport,
        &id,
        &s,
        archive,
        &expected,
    )
    .await
    .unwrap();
    assert_eq!(transport.copies, 1);
    assert_eq!(
        result,
        json!({"format":"kelryvo-verified-dockerhub-publication-v1","sourceSha":SHA,"ociRun":"4","ociAttempt":"2","repository":REPO,"tag":format!("{SHA}-4-2"),"digest":expected["digest"],"image":format!("{REPO}@{}",expected["digest"].as_str().unwrap()),"platforms":["linux/amd64","linux/arm64"],"anonymousPull":true,"reused":false,"chartPromotion":false,"argoCdRequired":false})
    );
    let result = publish(
        &mut Fake::new(&responses()),
        &mut transport,
        &id,
        &s,
        archive,
        &expected,
    )
    .await
    .unwrap();
    assert_eq!(result["reused"], true);
    assert_eq!(transport.copies, 1);
    for kind in [
        "denied",
        "replaced",
        "stale",
        "wrong-run",
        "copy-failed",
        "config-changed",
    ] {
        let mut t = Synthetic::new(&s);
        let mut response = responses();
        let mut identity = Identity::new(SHA.into(), "4".into(), "2".into()).unwrap();
        match kind {
            "denied" => t.denied = true,
            "replaced" => {
                t.pushed = true;
                t.wrong_tag = true;
            }
            "stale" => {
                response["git/ref/heads/master"] = json!([{"object":{"sha":"b".repeat(40)}}])
            }
            "wrong-run" => identity.run = "9".into(),
            "copy-failed" => t.failed_copy = true,
            "config-changed" => t.wrong_config = true,
            _ => unreachable!(),
        }
        assert!(
            publish(
                &mut Fake::new(&response),
                &mut t,
                &identity,
                &s,
                archive,
                &expected
            )
            .await
            .is_err(),
            "{kind}"
        );
        assert_eq!(
            t.copies,
            usize::from(["copy-failed", "config-changed"].contains(&kind)),
            "{kind}"
        );
    }
}
