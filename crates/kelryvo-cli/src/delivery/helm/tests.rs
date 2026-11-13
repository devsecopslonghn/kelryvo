//! Closed synthetic GitHub and checkout ports. No remote mutation occurs.
use super::*;
use crate::delivery::tests::{Fake, responses};
const SOURCE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const BASE: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
pub(in crate::delivery::helm) fn digest() -> String {
    format!("sha256:{}", "1".repeat(64))
}
pub(in crate::delivery::helm) fn before() -> String {
    format!(
        "image:\n  repository: ghcr.io/devsecopslonghn/kelryvo-app\n  digest: sha256:{}\npostgresql:\n  secretName: retained-private\n",
        "2".repeat(64)
    )
}
struct Files {
    value: String,
    fail: bool,
    unrelated: bool,
    moved: bool,
    validated: bool,
}
impl Checkout for Files {
    async fn head(&mut self) -> Result<String> {
        Ok(if self.moved && self.validated {
            SOURCE
        } else {
            BASE
        }
        .into())
    }
    fn values(&mut self) -> Result<String> {
        Ok(self.value.clone())
    }
    fn replace(&mut self, before: &str, after: &str) -> Result<()> {
        assert_eq!(self.value, before);
        self.value = after.into();
        Ok(())
    }
    async fn validate(&mut self) -> Result<()> {
        self.validated = true;
        if self.fail {
            Err("synthetic validation failure".into())
        } else {
            Ok(())
        }
    }
    async fn exact_change(&mut self) -> Result<bool> {
        Ok(!self.unrelated)
    }
}
pub(in crate::delivery::helm) struct ChartFixture {
    base: String,
    before: String,
    protected: bool,
    previous: Option<String>,
    existing: bool,
    orphan: bool,
    old_pr: bool,
    unrelated: bool,
    master_changed: bool,
    race: bool,
    created_ref: bool,
    writes: Vec<(String, Value)>,
}
impl Default for ChartFixture {
    fn default() -> Self {
        Self {
            before: before(),
            base: BASE.into(),
            protected: false,
            previous: None,
            existing: false,
            orphan: false,
            old_pr: false,
            unrelated: false,
            master_changed: false,
            race: false,
            created_ref: false,
            writes: Vec::new(),
        }
    }
}
impl ChartFixture {
    pub(in crate::delivery::helm) fn with_base(base: String) -> Self {
        Self {
            base,
            ..Default::default()
        }
    }
    pub(in crate::delivery::helm) fn writes(&self) -> &[(String, Value)] {
        &self.writes
    }
}
impl Api for ChartFixture {
    async fn get(&mut self, route: &str, missing: bool) -> Result<Option<Value>> {
        let after = update_values(&self.before, &digest())?;
        let result = if route == "branches/master" {
            json!({"commit":{"sha":self.base},"protected":self.protected})
        } else if route.starts_with("contents/") {
            json!({"encoding":"base64","content":STANDARD.encode(if route.ends_with(SOURCE){&after}else{&self.before})})
        } else if route.starts_with("commits?") {
            self.previous.as_ref().map_or(
                json!([]),
                |s| json!([{"commit":{"message":format!("Promotion\n\nKelryvo-Source-SHA: {s}")}}]),
            )
        } else if route == "git/ref/heads/master" {
            json!({"object":{"sha":if self.master_changed{SOURCE}else{self.base.as_str()}}})
        } else if route == format!("git/commits/{}", self.base) {
            json!({"tree":{"sha":"c".repeat(40)}})
        } else if route == format!("git/commits/{SOURCE}") {
            json!({"parents":[{"sha":self.base}],"message":format!("Promotion\n\nKelryvo-Source-SHA: {SOURCE}")})
        } else if route.starts_with("compare/") {
            json!({"files":if self.unrelated{json!([{"filename":"values.yaml"},{"filename":"templates/other.yaml"}])}else{json!([{"filename":"values.yaml"}])}})
        } else if route.starts_with("pulls?") {
            let mut list = Vec::new();
            if self.old_pr {
                list.push(json!({"number":7,"head":{"ref":format!("automation/kelryvo-images-{BASE}"),"repo":{"full_name":REPOSITORY}}}));
            }
            if self.existing {
                list.push(json!({"number":8,"html_url":format!("https://github.com/{REPOSITORY}/pull/8"),"head":{"ref":format!("automation/kelryvo-images-{SOURCE}"),"sha":SOURCE,"repo":{"full_name":REPOSITORY}}}));
            }
            json!(list)
        } else if route.starts_with("git/ref/heads/automation/") {
            if self.orphan || self.created_ref {
                json!({"object":{"sha":SOURCE}})
            } else {
                assert!(missing);
                return Ok(None);
            }
        } else {
            return Err(format!("Unexpected synthetic chart route {route}"));
        };
        Ok(Some(result))
    }
    async fn write(&mut self, _: Write, route: &str, body: &Value) -> Result<Value> {
        self.writes.push((route.into(), body.clone()));
        if route == "git/refs/heads/master" && self.race {
            return Err("synthetic concurrent update".into());
        }
        if route == "git/refs" {
            self.created_ref = true;
        }
        Ok(json!({"sha":SOURCE,"html_url":format!("https://github.com/{REPOSITORY}/pull/8")}))
    }
}
fn identity() -> Identity {
    Identity::new(SOURCE.into(), "4".into(), "2".into()).unwrap()
}
fn files() -> Files {
    Files {
        value: before(),
        fail: false,
        unrelated: false,
        moved: false,
        validated: false,
    }
}
#[test]
fn exact_digest_scalar_and_unambiguous_source_provenance_are_required() {
    let original = before();
    let after = update_values(&original, &digest()).unwrap();
    assert_eq!(after, original.replace(&"2".repeat(64), &"1".repeat(64)));
    assert_eq!(update_values(&after, &digest()).unwrap(), after);
    for bad in [
        original.replace("image:", "containerImage:"),
        original.replace("  digest:", "  digest: bad\n  digest:"),
        original.replace("sha256:", "sha512:"),
    ] {
        assert!(update_values(&bad, &digest()).is_err());
    }
    assert!(
        source_marker(&format!(
            "Kelryvo-Source-SHA: {SOURCE}\nKelryvo-Source-SHA: {BASE}"
        ))
        .is_err()
    );
    assert!(source_marker("Kelryvo-Source-SHA: invalid").is_err());
    assert_eq!(source_marker("normal commit").unwrap(), None);
}
#[tokio::test]
async fn validated_promotion_retains_scope_protection_reuse_and_nonforced_parent_binding() {
    let mut api = ChartFixture::default();
    let result = promote(
        &mut Fake::new(&responses()),
        &mut api,
        &mut files(),
        &identity(),
        &digest(),
    )
    .await
    .unwrap();
    assert_eq!(result, json!({"status":"promoted","sha":SOURCE}));
    assert_eq!(api.writes.len(), 3);
    assert_eq!(api.writes[0].0, "git/trees");
    assert_eq!(api.writes[0].1["tree"].as_array().unwrap().len(), 1);
    assert_eq!(api.writes[0].1["tree"][0]["path"], "values.yaml");
    assert_eq!(api.writes[1].1["parents"], json!([BASE]));
    assert_eq!(api.writes[2].1, json!({"sha":SOURCE,"force":false}));
    let mut response = responses();
    response[format!("compare/{BASE}...{SOURCE}")] = json!([{"status":"ahead"}]);
    let mut advanced = ChartFixture {
        previous: Some(BASE.into()),
        ..Default::default()
    };
    assert_eq!(
        promote(
            &mut Fake::new(&response),
            &mut advanced,
            &mut files(),
            &identity(),
            &digest()
        )
        .await
        .unwrap()["status"],
        "promoted"
    );
    for orphan in [false, true] {
        let mut api = ChartFixture {
            protected: true,
            orphan,
            old_pr: true,
            ..Default::default()
        };
        let result = promote(
            &mut Fake::new(&responses()),
            &mut api,
            &mut files(),
            &identity(),
            &digest(),
        )
        .await
        .unwrap();
        assert_eq!(result["status"], "pull-request");
        assert!(!api.writes.iter().any(|(r, _)| r == "git/refs/heads/master"));
        assert_eq!(api.writes[0], ("pulls/7".into(), json!({"state":"closed"})));
        assert_eq!(api.writes.last().unwrap().1["draft"], true);
        if orphan {
            assert!(
                !api.writes
                    .iter()
                    .any(|(r, _)| ["git/refs", "git/trees", "git/commits"].contains(&r.as_str())),
                "validated orphan reuse creates no redundant Git objects"
            );
        }
    }
    let mut api = ChartFixture {
        protected: true,
        existing: true,
        ..Default::default()
    };
    promote(
        &mut Fake::new(&responses()),
        &mut api,
        &mut files(),
        &identity(),
        &digest(),
    )
    .await
    .unwrap();
    assert!(api.writes.is_empty());
    let changed = update_values(&before(), &digest()).unwrap();
    let mut api = ChartFixture {
        before: changed.clone(),
        previous: Some(SOURCE.into()),
        ..Default::default()
    };
    let mut f = files();
    f.value = changed;
    assert_eq!(
        promote(
            &mut Fake::new(&responses()),
            &mut api,
            &mut f,
            &identity(),
            &digest()
        )
        .await
        .unwrap()["status"],
        "unchanged"
    );
    assert!(api.writes.is_empty());
}
#[tokio::test]
async fn stale_validation_rollback_scope_expansion_and_concurrent_writes_never_bypass_review() {
    for kind in [
        "validation",
        "unrelated-local",
        "checkout-moved",
        "stale",
        "behind",
        "diverged",
        "different-digest",
        "master-changed",
        "unrelated-pr",
    ] {
        let mut api = ChartFixture::default();
        let mut f = files();
        let mut response = responses();
        match kind {
            "validation" => f.fail = true,
            "unrelated-local" => f.unrelated = true,
            "checkout-moved" => f.moved = true,
            "stale" => response["git/ref/heads/master"] = json!([{"object":{"sha":BASE}}]),
            "behind" | "diverged" => {
                api.previous = Some(BASE.into());
                response[format!("compare/{BASE}...{SOURCE}")] = json!([{"status":kind}]);
            }
            "different-digest" => api.previous = Some(SOURCE.into()),
            "master-changed" => api.master_changed = true,
            "unrelated-pr" => {
                api.protected = true;
                api.existing = true;
                api.unrelated = true;
            }
            _ => unreachable!(),
        }
        assert!(
            promote(
                &mut Fake::new(&response),
                &mut api,
                &mut f,
                &identity(),
                &digest()
            )
            .await
            .is_err(),
            "{kind}"
        );
        assert!(api.writes.is_empty(), "{kind}");
    }
    let mut api = ChartFixture {
        race: true,
        ..Default::default()
    };
    assert!(
        promote(
            &mut Fake::new(&responses()),
            &mut api,
            &mut files(),
            &identity(),
            &digest()
        )
        .await
        .is_err()
    );
    assert_eq!(
        api.writes
            .iter()
            .filter(|(r, _)| r == "git/refs/heads/master")
            .count(),
        1,
        "unknown/concurrent update is never retried"
    );
}
