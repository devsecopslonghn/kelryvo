//! Identity governance compatibility on the private PostgreSQL cluster. Retained
//! handlers are evaluated in rolled-back transactions before native mutations.
#[cfg(test)]
#[macro_use]
mod fixtures {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/support/contracts.rs"
    ));
}
use axum::{
    Router,
    body::{Body, to_bytes},
    http::Request,
};
use kelryvo_server::{AppState, ORG_UUID, connect, identity::runtime::Runtime, initialize, router};
use serde_json::{Value, json};
use sqlx::PgPool;
use std::sync::Arc;
use tower::ServiceExt;
use uuid::Uuid;

struct Fixture {
    pool: PgPool,
    app: Router,
    runtime: Value,
    admin: String,
    other: String,
    token: String,
    other_token: String,
}
async fn snapshot(pool: &PgPool) -> Value {
    sqlx::query_scalar("SELECT jsonb_build_array((SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sf_identity_providers t),(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY provider_id,revision)::text,'')) FROM sf_identity_provider_revisions t),(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sf_external_identities t),(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sf_identity_audit t),(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sf_local_credentials t),(SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'')) FROM sf_local_actors t))")
        .fetch_one(pool).await.unwrap()
}
fn reference(input: Value) -> Value {
    fixtures::read("identity-api", &input)
}
impl Fixture {
    async fn new() -> Self {
        let url = std::env::var("KELRYVO_RUST_TEST_DATABASE_URL")
            .expect("use kelryvo-test --identity-api-only");
        assert!(url.starts_with("postgresql:///kelryvo_rust_test?host="));
        let pool = connect(&url).await.unwrap();
        initialize(&pool).await.unwrap();
        let prefix = format!("rust-identity-{}", Uuid::new_v4());
        let (admin, other) = (format!("{prefix}-admin"), format!("{prefix}-other"));
        let token = kelryvo_core::sha256(Uuid::new_v4().as_bytes());
        let other_token = kelryvo_core::sha256(Uuid::new_v4().as_bytes());
        for (actor, role, token) in [
            (&admin, "developer", &token),
            (&other, "approver", &other_token),
        ] {
            sqlx::query("INSERT INTO sf_local_actors(id,organization_id,display_name,role) VALUES($1,$2,$1,$3)")
                .bind(actor).bind(ORG_UUID).bind(role).execute(&pool).await.unwrap();
            sqlx::query("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at) SELECT $1,$2,ts,ts+interval '24 hours' FROM issued")
                .bind(actor).bind(kelryvo_core::sha256(token)).execute(&pool).await.unwrap();
        }
        let route = json!({"id":"directory","name":"Private directory","kind":"LDAP","host":"directory.kelryvo.test","port":636,"transport":"LDAPS","pinnedIPs":["127.0.0.1"],"baseDNs":["ou=people,dc=kelryvo,dc=test"],"bindDNs":["cn=reader,dc=kelryvo,dc=test"],"secretRefs":["ldap-reader"]});
        let mut alternate = route.clone();
        alternate["id"] = json!("alternate-directory");
        let runtime = json!({"format":1,"publicOrigin":"https://localhost","key":"1".repeat(64),"routes":[route,alternate],"secrets":{"ldap-reader":"private-reference-canary"}});
        let mut state = AppState::new(pool.clone(), true);
        state.identity = Some(Arc::new(
            Runtime::parse(&serde_json::to_vec(&runtime).unwrap()).unwrap(),
        ));
        Self {
            pool,
            app: router(state, ".cache/nonexistent-rust-web".into()),
            runtime,
            admin,
            other,
            token,
            other_token,
        }
    }
    async fn compare(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        other: bool,
        generated: Option<&str>,
    ) -> Value {
        let (actor, token) = if other {
            (&self.other, &self.other_token)
        } else {
            (&self.admin, &self.token)
        };
        let before = snapshot(&self.pool).await;
        let input = json!({"method":method,"path":path,"body":body,"actorId":actor,"token":token,"runtime":self.runtime});
        let mut expected = tokio::task::spawn_blocking(move || reference(input))
            .await
            .unwrap();
        assert_fixture_eq!(
            snapshot(&self.pool).await,
            before,
            "retained reference must roll back all writes"
        );
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header("host", "localhost")
            .header("authorization", format!("Bearer {token}"));
        let payload = if let Some(body) = body {
            builder = builder.header("content-type", "application/json");
            Body::from(body.to_string())
        } else {
            Body::empty()
        };
        let response = self
            .app
            .clone()
            .oneshot(builder.body(payload).unwrap())
            .await
            .unwrap();
        let status = response.status().as_u16();
        let bytes = to_bytes(response.into_body(), 131072).await.unwrap();
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap()
        };
        let mut actual = json!({"status":status,"body":body});
        let original = actual.clone();
        if let Some(object) = generated {
            for result in [&mut actual, &mut expected] {
                let id = result["body"][object]["id"]
                    .as_str()
                    .expect("generated UUID");
                assert!(Uuid::parse_str(id).is_ok());
                result["body"][object]["id"] = json!("generated-uuid");
            }
        }
        assert_fixture_eq!(actual, expected, "{method} {path}");
        original
    }
    async fn call(&self, method: &str, path: &str, body: Option<Value>) -> Value {
        self.compare(method, path, body, false, None).await
    }
    async fn root(&self, provider: Uuid, mapping: Uuid, actor: &str) -> (Uuid, Uuid) {
        let root:Uuid=sqlx::query_scalar("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind) SELECT $1,$2,ts,ts+interval '24 hours','EXTERNAL' FROM issued RETURNING id")
            .bind(actor).bind(kelryvo_core::sha256(Uuid::new_v4().as_bytes())).fetch_one(&self.pool).await.unwrap();
        sqlx::query("INSERT INTO sf_external_session_roots(credential_id,actor_id,provider_id,provider_revision,mapping_id,generation_id) SELECT $1,$2,p.id,p.revision,$4,c.generation_id FROM sf_identity_providers p CROSS JOIN sf_metadata_current c WHERE p.id=$3 AND c.singleton")
            .bind(root).bind(actor).bind(provider).bind(mapping).execute(&self.pool).await.unwrap();
        let child:Uuid=sqlx::query_scalar("WITH issued AS(SELECT clock_timestamp() ts) INSERT INTO sf_local_credentials(actor_id,token_sha256,issued_at,expires_at,credential_kind,parent_credential_id,absolute_expires_at) SELECT $1,$2,ts,ts+interval '1 hour','BROWSER',$3,ts+interval '2 hours' FROM issued RETURNING id")
            .bind(actor).bind(kelryvo_core::sha256(Uuid::new_v4().as_bytes())).bind(root).fetch_one(&self.pool).await.unwrap();
        (root, child)
    }
    async fn revoked(&self, pair: (Uuid, Uuid)) -> bool {
        sqlx::query_scalar("SELECT bool_and(revoked_at IS NOT NULL) FROM sf_local_credentials WHERE id=$1 OR id=$2")
            .bind(pair.0).bind(pair.1).fetch_one(&self.pool).await.unwrap()
    }
}
fn config() -> Value {
    json!({"routeId":"directory","baseDN":"ou=people,dc=kelryvo,dc=test","bindDN":"cn=reader,dc=kelryvo,dc=test","bindSecretRef":"ldap-reader","loginAttribute":"uid","subjectAttribute":"entryUUID"})
}
fn update(provider: &Value) -> Value {
    json!({"name":provider["name"],"expectedRevision":provider["revision"],"enabled":true,"config":provider["config"],"reason":"Native identity compatibility"})
}

#[tokio::test]
#[ignore = "requires kelryvo-test private PostgreSQL"]
async fn native_identity_governance_matches_retained_handlers_and_revocation_boundaries() {
    let f = Fixture::new().await;
    let base = "/api/identity/providers";
    assert_eq!(
        f.call("GET", "/api/identity/access", None).await["body"],
        json!({"canManage":false})
    );
    assert_eq!(f.call("GET", base, None).await["status"], 403);
    sqlx::query("INSERT INTO sf_identity_admin_grants(actor_id,grant_os_uid) VALUES($1,1000)")
        .bind(&f.admin)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        f.call("GET", "/api/identity/access", None).await["body"],
        json!({"canManage":true})
    );
    let listing = f.call("GET", base, None).await;
    assert!(!listing.to_string().contains("private-reference-canary"));
    assert!(!listing.to_string().contains("127.0.0.1"));
    assert_eq!(
        f.compare("GET", base, None, true, None).await["status"],
        403
    );
    let create = json!({"name":"  Native identity 😀  ","kind":"LDAP","enabled":false,"config":config(),"reason":"Create explicit identity source"});
    for (key, value) in [
        ("enabled", json!(true)),
        ("name", json!("invalid\nname")),
        ("reason", json!("")),
    ] {
        let mut bad = create.clone();
        bad[key] = value;
        let before = snapshot(&f.pool).await;
        assert_eq!(f.call("POST", base, Some(bad)).await["status"], 400);
        assert_eq!(snapshot(&f.pool).await, before);
    }
    let created = f
        .compare("POST", base, Some(create), false, Some("provider"))
        .await;
    assert_eq!(created["status"], 201);
    let mut provider = created["body"]["provider"].clone();
    let id = Uuid::parse_str(provider["id"].as_str().unwrap()).unwrap();
    let path = format!("{base}/{id}");
    assert_eq!(provider["name"], "Native identity 😀");
    assert_eq!(
        f.call("PATCH", &path, Some(update(&provider))).await["body"]["error"],
        "IDENTITY_MAPPING_REQUIRED"
    );
    let mappings = format!("{path}/mappings");
    let mapping_body = json!({"expectedProviderRevision":"1","subject":"immutable-native-subject","actorId":f.admin,"reason":"Explicit identity linkage"});
    let mut unavailable = mapping_body.clone();
    unavailable["actorId"] = json!("missing-actor");
    assert_eq!(
        f.call("POST", &mappings, Some(unavailable)).await["body"]["error"],
        "IDENTITY_ACTOR_UNAVAILABLE"
    );
    let mapping = f
        .compare(
            "POST",
            &mappings,
            Some(mapping_body.clone()),
            false,
            Some("mapping"),
        )
        .await;
    let mapping_id = Uuid::parse_str(mapping["body"]["mapping"]["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        f.call("POST", &mappings, Some(mapping_body)).await["status"],
        409
    );
    f.call("GET", &mappings, None).await;
    provider = f.call("PATCH", &path, Some(update(&provider))).await["body"]["provider"].clone();
    assert_eq!(provider["revision"], "2");
    let methods = f.call("GET", "/api/auth/methods", None).await;
    assert!(
        methods["body"]["providers"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == json!(id))
    );
    let mut stale = update(&provider);
    stale["expectedRevision"] = json!("1");
    assert_eq!(
        f.call("PATCH", &path, Some(stale)).await["body"]["error"],
        "IDENTITY_REVISION_CONFLICT"
    );
    let mut moved = update(&provider);
    moved["config"]["routeId"] = json!("alternate-directory");
    assert_eq!(
        f.call("PATCH", &path, Some(moved)).await["body"]["error"],
        "IDENTITY_SOURCE_IMMUTABLE"
    );
    let second=f.compare("POST",&mappings,Some(json!({"expectedProviderRevision":"2","subject":"other-native-subject","actorId":f.other,"reason":"Separate approved identity"})),false,Some("mapping")).await;
    let second_id = Uuid::parse_str(second["body"]["mapping"]["id"].as_str().unwrap()).unwrap();
    let first_root = f.root(id, mapping_id, &f.admin).await;
    let second_root = f.root(id, second_id, &f.other).await;
    assert!(!f.revoked(first_root).await);
    provider = f.call("PATCH", &path, Some(update(&provider))).await["body"]["provider"].clone();
    assert_eq!(provider["revision"], "3");
    assert!(
        f.revoked(first_root).await && f.revoked(second_root).await,
        "provider revision revokes every external root and browser child"
    );
    let first_root = f.root(id, mapping_id, &f.admin).await;
    let second_root = f.root(id, second_id, &f.other).await;
    let revoke = format!("{mappings}/{mapping_id}/revoke");
    assert_eq!(
        f.call(
            "POST",
            &revoke,
            Some(json!({"reason":"Revoke one identity"}))
        )
        .await["status"],
        204
    );
    assert!(f.revoked(first_root).await);
    assert!(
        !f.revoked(second_root).await,
        "mapping revocation does not revoke another identity"
    );
    f.call("GET", &mappings, None).await;
    f.call("GET", base, None).await;
    let active: Uuid =
        sqlx::query_scalar("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .fetch_one(&f.pool)
            .await
            .unwrap();
    let hold = Uuid::new_v4();
    sqlx::query("INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES($1,'RESTORE_HOLD',$2,1000)").bind(hold).bind("a".repeat(64)).execute(&f.pool).await.unwrap();
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(hold)
        .execute(&f.pool)
        .await
        .unwrap();
    assert_eq!(
        f.call("GET", "/api/auth/methods", None).await["body"]["providers"],
        json!([])
    );
    f.call("GET", base, None).await;
    let before = snapshot(&f.pool).await;
    assert_eq!(
        f.call("PATCH", &path, Some(update(&provider))).await["body"]["error"],
        "METADATA_RESTORE_HOLD"
    );
    assert_eq!(snapshot(&f.pool).await, before);
    sqlx::query("UPDATE sf_metadata_current SET generation_id=$1 WHERE singleton")
        .bind(active)
        .execute(&f.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE sf_identity_admin_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE actor_id=$1 AND revoked_at IS NULL").bind(&f.admin).execute(&f.pool).await.unwrap();
    assert_eq!(f.call("GET", base, None).await["status"], 403);
    assert_eq!(
        f.call("GET", "/api/identity/access", None).await["body"],
        json!({"canManage":false})
    );
    let effects:i64=sqlx::query_scalar("SELECT (SELECT count(*) FROM sf_project_grants WHERE actor_id=$1 OR actor_id=$2)+(SELECT count(*) FROM sf_execution_jobs WHERE requester_id=$1 OR requester_id=$2)").bind(&f.admin).bind(&f.other).fetch_one(&f.pool).await.unwrap();
    assert_eq!(
        effects, 0,
        "identity governance grants no project membership and creates no execution jobs"
    );
    f.pool.close().await;
}
