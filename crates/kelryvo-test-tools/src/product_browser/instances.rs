//! Private instance onboarding, synthetic identity evidence and encrypted
//! credential lifecycle. No Oracle driver or live verification is invoked.
use super::*;
use openssl::pkey::{PKey, Private};
pub(super) const PASSWORD: &str = "native-browser-vault-canary-đ😀";
pub(super) const REPLACEMENT: &str = "native-browser-rotated-canary";
pub(super) async fn insert(
    pool: &PgPool,
    connection: Uuid,
    actor: &str,
    observation: &Value,
) -> Result<()> {
    sqlx::query("INSERT INTO sf_database_observations(organization_id,connection_id,operation,status,identity,identity_digest,schemas,limitations,provenance,verification_acceptance,actor_id,connection_revision) VALUES('00000000-0000-4000-8000-000000000001',$1,'DISCOVER',$2,$3,$4,$5,$6,$7,$8,$9,1)").bind(connection).bind(field(observation,"status")?).bind(observation["identity"].clone()).bind(observation["identityDigest"].as_str()).bind(observation["schemas"].clone()).bind(observation["limitations"].clone()).bind(field(observation,"provenance")?).bind(observation.get("verificationAcceptance").cloned()).bind(actor).execute(pool).await?;
    Ok(())
}
pub(super) async fn run(flow: &mut Flow, private_key: &PKey<Private>) -> Result<()> {
    let project = flow.project;
    let pool = &flow.pool;
    let api = &mut flow.api;
    let mut ui = Ui {
        browser: &mut flow.browser,
        page: &flow.page,
    };
    ui.click("Instances")?;
    ui.select("Project", &project.to_string())?;
    ui.click("Manage instances")?;
    ui.heading("Register an instance")?;
    let card =
        Locator::role("article", None).having(&role("heading", "Native browser operator instance"));
    ui.click_at(&button("Observation history").within(&card))?;
    ui.wait(&role("heading", "Assign schemas").within(&card))?;
    ui.checked(&label("NATIVE_BROWSER_APP").within(&card))?;
    let environment: Uuid = sqlx::query_scalar(
        "SELECT id FROM sf_environments WHERE project_id=$1 AND name='Development'",
    )
    .bind(project)
    .fetch_one(pool)
    .await?;
    ui.browser.select(
        ui.page,
        &label("Target environment").within(&card),
        Some(&environment.to_string()),
        None,
    )?;
    ui.browser.fill(
        ui.page,
        &label("Schema assignment reason").within(&card),
        "Native browser exact-owner assignment",
    )?;
    ui.click_at(&button("Assign selected schemas").within(&card))?;
    ui.text("Schemas assigned. Target bindings require identity verification.")?;
    let connection = Uuid::parse_str(&field(&flow.operator_connection, "id")?)?;
    let binding:Value = sqlx::query_scalar("SELECT to_jsonb(r) FROM sf_target_bindings b JOIN sf_target_binding_revisions r ON r.binding_id=b.id AND r.revision=b.current_revision JOIN sf_instance_profile_sources s ON s.profile_id=r.profile_id WHERE b.project_id=$1 AND s.connection_id=$2").bind(project).bind(connection).fetch_one(pool).await?;
    check(
        &binding["exact_owner"],
        &json!("NATIVE_BROWSER_APP"),
        "instance assignment preserves exact owner",
    )?;
    check(
        &binding["identity_state"],
        &json!("PROVISIONAL"),
        "assignment alone remains provisional",
    )?;
    check(
        &binding["observation_digest"],
        &Value::Null,
        "provisional assignment has no accepted digest",
    )?;
    check(
        &binding["actor_id"],
        &json!(flow.actor),
        "assignment actor attributed",
    )?;
    check(
        &binding["revision"],
        &json!(1),
        "first target binding revision",
    )?;
    ui.click_at(&button("Inspect target").within(&card))?;
    ui.wait(&Locator::text(Text::exact("Currentness: CURRENT")).within(&card))?;
    ui.count(&button("Verify identity").within(&card), 0)?;
    ui.browser.fill(
        ui.page,
        &label("Identity acceptance reason").within(&card),
        "Native browser explicit fixture observation",
    )?;
    ui.click_at(&button("Observe identity").within(&card))?;
    ui.text("Identity observed. Deployment approval is still required.")?;
    ui.contains(&card, "Binding revision 2 · Identity OBSERVED")?;
    ui.click_at(&button("View identity evidence").within(&card))?;
    ui.wait(&Locator::text(Text::exact("Identity evidence")).within(&card))?;
    ui.contains(&card, "\"liveVerificationAccepted\": false")?;
    // This is only a private retained-row rendering fixture. Bind its complete
    // normalized identity; the retired adapter incorrectly used a physical
    // identity subset, which cannot satisfy the acceptance contract.
    let acceptance = json!({"authorizedLabId":"private-browser-fixture","acceptedAt":(chrono::Utc::now()-chrono::Duration::seconds(1)).to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"evidenceDigest":"a".repeat(64),"manifestDigest":"b".repeat(64),"targetConfigDigest":"c".repeat(64),"expectedIdentityDigest":kelryvo_core::evidence_digest(&flow.observation["identity"]),"schemaOwners":["NATIVE_BROWSER_APP","OTHER_SCOPE"]});
    let mut raw = flow.observation.clone();
    raw["provenance"] = "ORACLE_READ_ONLY".into();
    raw["limitations"] = json!([]);
    raw["verificationAcceptance"] = acceptance;
    let accepted =
        kelryvo_core::evidence::normalize_observation(&raw, "DISCOVER", chrono::Utc::now());
    require(
        accepted["verificationAcceptance"].is_object(),
        "synthetic fixture acceptance binds complete normalized identity",
    )?;
    insert(pool, connection, &flow.actor, &accepted).await?;
    ui.click_at(&button("Observation history").within(&card))?;
    ui.wait(&button("Verify identity").within(&card))?;
    ui.click_at(&button("Inspect target").within(&card))?;
    ui.wait(&Locator::text(Text::exact("Currentness: STALE")).within(&card))?;
    ui.browser.fill(
        ui.page,
        &label("Identity acceptance reason").within(&card),
        "Native browser explicit accepted verification fixture",
    )?;
    ui.click_at(&button("Verify identity").within(&card))?;
    ui.text("Identity verified. Deployment approval is still required.")?;
    ui.contains(&card, "Binding revision 3 · Identity VERIFIED")?;
    ui.wait(&Locator::text(Text::exact("Currentness: CURRENT")).within(&card))?;
    ui.click_at(&button("View identity evidence").within(&card))?;
    ui.wait(&Locator::text(Text::exact("Identity evidence")).within(&card))?;
    ui.contains(&card, "\"liveVerificationAccepted\": true")?;
    require(
        !ui.browser.text(ui.page, &card)?.contains("OTHER_SCOPE"),
        "synthetic attestation owners remain scoped to this target",
    )?;
    let bindings = api
        .json(
            "GET",
            &format!("/api/projects/{project}/target-bindings"),
            None,
            200,
        )
        .await?;
    require(
        bindings["bindings"]
            .as_array()
            .is_some_and(|a| a.iter().any(|b| b["bindingId"] == binding["binding_id"])),
        "assigned native target visible through API",
    )?;
    let id = field(&binding, "binding_id")?;
    let detail = api
        .json(
            "GET",
            &format!("/api/projects/{project}/target-bindings/{id}"),
            None,
            200,
        )
        .await?;
    check(
        &detail["binding"]["bindingId"],
        &binding["binding_id"],
        "target detail identity",
    )?;
    check(
        &detail["currentness"]["state"],
        &json!("CURRENT"),
        "target detail currentness",
    )?;
    ui.click_at(&button("Schema history").within(&card))?;
    ui.wait(&role("heading", "Schema observations and baselines").within(&card))?;
    ui.browser.fill(
        ui.page,
        &label("Schema observation reason").within(&card),
        "Observe native schema coverage without an Oracle adapter",
    )?;
    ui.click_at(&button("Observe schema").within(&card))?;
    ui.text("Schema observation retained with its coverage and limitations.")?;
    let history = Locator::css(".schema-history").within(&card);
    ui.contains(&history, "UNAVAILABLE")?;
    ui.click_at(&button("Open schema snapshot").within(&card))?;
    ui.wait(&Locator::text(Text::exact("Retained object snapshot")).within(&card))?;
    ui.contains(&history, "IDENTITY_INCOMPLETE")?;
    ui.browser.fill(
        ui.page,
        &label("Baseline name").within(&card),
        "Browser baseline <b>review</b>",
    )?;
    ui.browser.fill(
        ui.page,
        &label("Baseline reason").within(&card),
        "Retain unknown coverage without inferring object absence",
    )?;
    ui.click_at(&button("Capture baseline").within(&card))?;
    ui.text("Schema baseline retained. Execution authority is unchanged.")?;
    ui.contains(&history, "Browser baseline <b>review</b>")?;
    ui.count(&Locator::css("b").within(&history), 0)?;
    ui.click_at(&button("Compare schema snapshots").within(&card))?;
    ui.wait(&Locator::text(Text::exact("Schema comparison")).within(&card))?;
    ui.contains(&history, "INCOMPARABLE")?;
    let form = Locator::css("form[data-submit=\"register-instance\"]");
    for (name, value) in [
        ("Instance name", "Native browser instance"),
        ("Container name", "Browser PDB"),
        ("Host", "native-browser-instance.example.invalid"),
        ("Service name", "BROWSERPDB"),
        ("Database username", "MIGRATION_MASTER"),
        ("Database password", PASSWORD),
        ("Registration reason", "Native browser onboarding fixture"),
    ] {
        ui.browser
            .fill(ui.page, &label(name).within(&form), value)?;
    }
    ui.click("Register instance")?;
    ui.text("Instance registered. Discover and verify the project schemas before deployment.")?;
    let registered:Value = sqlx::query_scalar("SELECT to_jsonb(c)||jsonb_build_object('credential_id',v.id,'envelope',v.envelope) FROM sf_database_connections c JOIN sf_oracle_credentials v ON v.connection_id=c.id AND c.credential_ref='vault://kelryvo/'||v.id::text WHERE c.name='Native browser instance' AND c.actor_id=$1 ORDER BY c.created_at DESC LIMIT 1").bind(&flow.actor).fetch_one(pool).await?;
    open_credential(&registered, private_key)?;
    let instance =
        Locator::role("article", None).having(&role("heading", "Native browser instance"));
    ui.browser.fill(
        ui.page,
        &label("Connection action reason").within(&instance),
        "Browser discovery fixture without runtime",
    )?;
    ui.click_at(&button("Discover schemas").within(&instance))?;
    ui.text("Observation recorded: UNAVAILABLE.")?;
    ui.wait(&role("heading", "Connection observations").within(&instance))?;
    ui.contains(&instance, "DISCOVER · UNAVAILABLE · UNKNOWN")?;
    ui.click_at(&Locator::css("summary").within(&instance))?;
    ui.contains(
        &Locator::css("pre").within(&instance),
        "RUNTIME_UNAVAILABLE",
    )?;
    let registered_id = Uuid::parse_str(&field(&registered, "id")?)?;
    let n:i64 = sqlx::query_scalar("SELECT count(*) FROM sf_database_observations WHERE connection_id=$1 AND operation='DISCOVER' AND provenance='UNAVAILABLE'").bind(registered_id).fetch_one(pool).await?;
    check(
        &json!(n),
        &json!(1),
        "exactly one unavailable discovery observation",
    )?;
    ui.browser.fill(
        ui.page,
        &label("Replacement password").within(&instance),
        REPLACEMENT,
    )?;
    ui.browser.fill(
        ui.page,
        &label("Credential change reason").within(&instance),
        "Rotate browser credential fixture",
    )?;
    ui.click_at(&button("Replace credential").within(&instance))?;
    ui.text("Credential replaced. Refresh target profiles before deployment.")?;
    ui.contains(&instance, "Credential revision 2")?;
    ui.browser.fill(
        ui.page,
        &label("Credential change reason").within(&instance),
        "Revoke browser credential fixture",
    )?;
    ui.click_at(&button("Revoke credential").within(&instance))?;
    ui.text("Credential revoked. The connection is disabled.")?;
    ui.contains(&instance, "Credential revision 3 · DISABLED")?;
    ui.click_at(&button("Observation history").within(&instance))?;
    ui.wait(&role("heading", "Connection observations").within(&instance))?;
    ui.contains(&instance, "DISCOVER · UNAVAILABLE · STALE")?;
    let body = ui.browser.text(ui.page, &Locator::css("body"))?;
    require(
        !body.contains("native-browser-vault-canary") && !body.contains(REPLACEMENT),
        "instance credential plaintext never appears in rendered output",
    )?;
    Ok(())
}
fn open_credential(connection: &Value, private_key: &PKey<Private>) -> Result<()> {
    use base64::Engine;
    use openssl::{
        encrypt::Decrypter,
        hash::MessageDigest,
        rsa::Padding,
        symm::{Cipher, decrypt_aead},
    };
    use zeroize::Zeroizing;
    let endpoint = kelryvo_core::sha256(
        json!([
            connection["host"],
            connection["port"],
            connection["service"],
            connection["transport"]
        ])
        .to_string(),
    );
    let context = json!({"organizationId":ORG,"connectionId":connection["id"],"credentialId":connection["credential_id"],"username":connection["username"],"purpose":"INSTANCE_MASTER","endpointDigest":endpoint});
    let aad = serde_json::to_vec(
        &[
            "organizationId",
            "connectionId",
            "credentialId",
            "username",
            "purpose",
            "endpointDigest",
        ]
        .map(|key| json!([key, context[key]])),
    )?;
    let envelope = &connection["envelope"];
    let bytes = |key: &str| -> Result<Vec<u8>> {
        Ok(base64::engine::general_purpose::STANDARD.decode(field(envelope, key)?)?)
    };
    let mut decrypter = Decrypter::new(private_key)?;
    decrypter.set_rsa_padding(Padding::PKCS1_OAEP)?;
    decrypter.set_rsa_oaep_md(MessageDigest::sha256())?;
    decrypter.set_rsa_mgf1_md(MessageDigest::sha256())?;
    decrypter.set_rsa_oaep_label(&aad)?;
    let wrapped = bytes("wrappedKey")?;
    let mut key = Zeroizing::new(vec![0; decrypter.decrypt_len(&wrapped)?]);
    let n = decrypter.decrypt(&wrapped, &mut key)?;
    key.truncate(n);
    let plaintext = Zeroizing::new(decrypt_aead(
        Cipher::aes_256_gcm(),
        &key,
        Some(&bytes("nonce")?),
        &aad,
        &bytes("ciphertext")?,
        &bytes("tag")?,
    )?);
    require(
        std::str::from_utf8(&plaintext)? == PASSWORD,
        "independent RSA-OAEP/AES-GCM wire check opens browser-generated credential with exact endpoint/context AAD",
    )
}
