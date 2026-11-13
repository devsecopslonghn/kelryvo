use super::*;
use crate::delivery::tests::{Fake, responses};
const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
struct Store {
    remote: Option<Value>,
    expected: Value,
    reads: usize,
}
impl Registry for Store {
    async fn read(&mut self, _: &str, missing: bool) -> Result<Option<Value>> {
        self.reads += 1;
        if !missing && self.remote.is_none() {
            self.remote = Some(self.expected.clone());
        }
        Ok(self.remote.clone())
    }
}
struct Copy {
    calls: usize,
    fail: bool,
}
impl Copier for Copy {
    async fn push(&mut self, _: &Path, _: &str) -> Result<()> {
        self.calls += 1;
        if self.fail {
            Err("synthetic copy failed".into())
        } else {
            Ok(())
        }
    }
}
pub(in crate::delivery) fn remote() -> Value {
    let mut platforms = serde_json::Map::new();
    for (arch, n) in [("amd64", "1"), ("arm64", "2")] {
        platforms.insert(arch.into(),json!({"digest":format!("sha256:{}",n.repeat(64)),"configDigest":format!("sha256:{}","3".repeat(64)),"config":{"architecture":arch,"os":"linux","config":{"User":"0:0","Entrypoint":["/opt/kelryvo/bin/kelryvo-runtime"],"Labels":{"org.opencontainers.image.revision":SHA,"org.opencontainers.image.source":"https://github.com/devsecopslonghn/kelryvo"}}}}));
    }
    json!({"digest":format!("sha256:{}","4".repeat(64)),"platforms":platforms})
}
#[tokio::test]
async fn ghcr_publication_rechecks_all_gates_preserves_matching_tags_and_never_overwrites_replaced_tags()
 {
    let id = Identity::new(SHA.into(), "4".into(), "2".into()).unwrap();
    let expected = remote();
    let archive = Path::new("private-verified-fixture");
    let mut registry = Store {
        remote: None,
        expected: expected.clone(),
        reads: 0,
    };
    let mut copy = Copy {
        calls: 0,
        fail: false,
    };
    let mut get = Fake::new(&responses());
    let result = publish(&mut get, &mut registry, &mut copy, &id, archive, &expected)
        .await
        .unwrap();
    assert_eq!(result["app"], expected["digest"]);
    assert_eq!(copy.calls, 1);
    assert_eq!(registry.reads, 2);
    assert_eq!(
        get.seen
            .iter()
            .filter(|r| *r == "git/ref/heads/master")
            .count(),
        6,
        "three independent gate snapshots"
    );
    publish(
        &mut Fake::new(&responses()),
        &mut registry,
        &mut copy,
        &id,
        archive,
        &expected,
    )
    .await
    .unwrap();
    assert_eq!(copy.calls, 1, "existing immutable tag is reused");
    registry.remote.as_mut().unwrap()["digest"] = format!("sha256:{}", "5".repeat(64)).into();
    assert!(
        publish(
            &mut Fake::new(&responses()),
            &mut registry,
            &mut copy,
            &id,
            archive,
            &expected
        )
        .await
        .is_err()
    );
    assert_eq!(copy.calls, 1);
    let wrong = Identity::new(SHA.into(), "9".into(), "1".into()).unwrap();
    registry.remote = None;
    assert!(
        publish(
            &mut Fake::new(&responses()),
            &mut registry,
            &mut copy,
            &wrong,
            archive,
            &expected
        )
        .await
        .is_err()
    );
    assert_eq!(copy.calls, 1);
    let mut stale = responses();
    stale["git/ref/heads/master"] = json!([{"object":{"sha":"b".repeat(40)}}]);
    assert!(
        publish(
            &mut Fake::new(&stale),
            &mut registry,
            &mut copy,
            &id,
            archive,
            &expected
        )
        .await
        .is_err()
    );
    assert_eq!(copy.calls, 1);
    copy.fail = true;
    assert!(
        publish(
            &mut Fake::new(&responses()),
            &mut registry,
            &mut copy,
            &id,
            archive,
            &expected
        )
        .await
        .is_err()
    );
    assert_eq!(copy.calls, 2);
    assert!(
        registry.remote.is_none(),
        "uncertain copy cannot report a verified publication"
    );
}
