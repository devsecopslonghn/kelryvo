//! Identity administration and external sign-in, authored entirely in Rust.
use super::{
    Model, api, array, button, document, e, escape, form, input, load, s, segment, value, window,
    workflow_location,
};
use serde_json::{Value, json};
use wasm_bindgen::JsCast;
fn checked(id: &str) -> bool {
    document()
        .get_element_by_id(id)
        .and_then(|e| e.dyn_into::<web_sys::HtmlInputElement>().ok())
        .is_some_and(|e| e.checked())
}
fn field(prefix: &str, key: &str, label: &str, v: &Value, required: bool) -> String {
    format!(
        "<label for=\"{prefix}-{key}\">{label}</label><input id=\"{prefix}-{key}\" value=\"{}\" {}>",
        e(v),
        if required { "required" } else { "" }
    )
}
fn config_fields(prefix: &str, c: &Value, kind: Option<&str>) -> String {
    let mut html = String::new();
    if kind.is_none() || kind == Some("OIDC") {
        html.push_str("<fieldset><legend>OIDC configuration</legend>");
        if kind.is_none() {
            html.push_str(&field(
                prefix,
                "issuer",
                "OIDC issuer URL",
                &c["issuer"],
                false,
            ));
        } else {
            html.push_str(&format!("<p>Issuer: {}</p>", e(&c["issuer"])));
        }
        html.push_str(&field(
            prefix,
            "client-id",
            "OIDC client ID",
            &c["clientId"],
            kind.is_some(),
        ));
        html.push_str(&field(
            prefix,
            "client-secret",
            "OIDC client secret alias",
            &c["clientSecretRef"],
            kind.is_some(),
        ));
        html.push_str("</fieldset>");
    }
    if kind.is_none() || kind == Some("LDAP") {
        html.push_str("<fieldset><legend>LDAP configuration</legend>");
        for (key, label, stored) in [
            ("base-dn", "LDAP search base DN", "baseDN"),
            ("bind-dn", "LDAP service bind DN", "bindDN"),
            ("bind-secret", "LDAP service secret alias", "bindSecretRef"),
        ] {
            html.push_str(&field(prefix, key, label, &c[stored], kind.is_some()));
        }
        html.push_str(&format!("<label for=\"{prefix}-login-attribute\">LDAP login attribute</label><select id=\"{prefix}-login-attribute\">"));
        for attr in ["uid", "sAMAccountName", "userPrincipalName"] {
            html.push_str(&format!(
                "<option {}>{attr}</option>",
                if c["loginAttribute"] == attr {
                    "selected"
                } else {
                    ""
                }
            ));
        }
        html.push_str("</select><p>Identity subject uses entryUUID.</p></fieldset>");
    }
    html
}
fn config(prefix: &str, kind: &str, existing: &Value) -> Value {
    let route = if prefix == "new-identity" {
        value("new-identity-route")
    } else {
        s(&existing["routeId"]).into()
    };
    if kind == "OIDC" {
        json!({"routeId":route,"issuer":if prefix=="new-identity"{value("new-identity-issuer")}else{s(&existing["issuer"]).into()},"clientId":value(&format!("{prefix}-client-id")),"clientSecretRef":value(&format!("{prefix}-client-secret"))})
    } else {
        json!({"routeId":route,"baseDN":value(&format!("{prefix}-base-dn")),"bindDN":value(&format!("{prefix}-bind-dn")),"bindSecretRef":value(&format!("{prefix}-bind-secret")),"loginAttribute":value(&format!("{prefix}-login-attribute")),"subjectAttribute":"entryUUID"})
    }
}
pub(super) fn fields(model: &Model, action: &str) -> Value {
    if action == "create-identity-provider" {
        let route = value("new-identity-route");
        let kind = array(&model.borrow().data, "routes")
            .iter()
            .find(|r| r["id"] == route)
            .map(|r| s(&r["kind"]).to_owned())
            .unwrap_or_default();
        return json!({"name":value("new-identity-name"),"kind":kind,"enabled":false,"config":config("new-identity",&kind,&Value::Null),"reason":value("new-identity-reason")});
    }
    let p = model.borrow().data["selectedIdentityProvider"].clone();
    match action {
        "save-identity-provider" => {
            json!({"expectedRevision":p["revision"],"name":value("edit-identity-name"),"enabled":checked("edit-identity-enabled"),"config":config("edit-identity",s(&p["kind"]),&p["config"]),"reason":value("edit-identity-reason")})
        }
        "link-identity" => {
            json!({"expectedProviderRevision":p["revision"],"subject":value("identity-subject"),"actorId":value("identity-actor"),"reason":value("identity-link-reason")})
        }
        "revoke-identity" => json!({"reason":value("identity-revoke-reason")}),
        "lookup-identity" => {
            json!({"expectedRevision":p["revision"],"username":value("identity-lookup-username")})
        }
        _ => json!({"expectedRevision":p["revision"]}),
    }
}
async fn select(model: &Model, id: &str) -> Result<(), String> {
    let selected = array(&model.borrow().data, "providers")
        .iter()
        .find(|p| p["id"] == id)
        .cloned()
        .ok_or("Refresh identity providers")?;
    let mappings = api(
        model,
        "GET",
        &format!("/api/identity/providers/{}/mappings", segment(id)),
        None,
        None,
    )
    .await?;
    let mut state = model.borrow_mut();
    state.data["selectedIdentityProvider"] = selected;
    state.data["identityMappings"] = mappings["mappings"].clone();
    state.data["identityLookup"] = Value::Null;
    state.data["identityTest"] = Value::Null;
    Ok(())
}
pub(super) async fn action(
    model: &Model,
    action: &str,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    if action == "oidc-login" {
        let result = api(
            model,
            "POST",
            &format!("/api/auth/oidc/{}/start", segment(id)),
            Some(json!({})),
            None,
        )
        .await?;
        let url = web_sys::Url::new(s(&result["authorizationUrl"]))
            .map_err(|_| "Identity provider unavailable")?;
        if url.protocol() != "https:" {
            return Err("Identity provider unavailable".into());
        }
        window()
            .location()
            .set_href(&url.href())
            .map_err(|_| "Identity redirect unavailable")?;
        return Ok(());
    }
    if action == "ldap-login" {
        let session = api(
            model,
            "POST",
            &format!("/api/auth/ldap/{}/session", segment(id)),
            Some(fields),
            None,
        )
        .await?;
        model.borrow_mut().set_session(Some(session));
        model.borrow_mut().data = Value::Null;
        workflow_location::prepare_login(model);
        load(model).await?;
        return Ok(());
    }
    if action == "open-identity-provider" {
        return select(model, id).await;
    }
    if action == "create-identity-provider" {
        let response = api(model, "POST", "/api/identity/providers", Some(fields), None).await?;
        load(model).await?;
        select(model, s(&response["provider"]["id"])).await?;
        model.borrow_mut().notice =
            "Provider created disabled. Link an actor before enabling sign-in.".into();
        return Ok(());
    }
    let p = model.borrow().data["selectedIdentityProvider"].clone();
    let provider = s(&p["id"]);
    let suffix = match action {
        "save-identity-provider" => "".to_owned(),
        "link-identity" => "/mappings".into(),
        "revoke-identity" => format!("/mappings/{}/revoke", segment(id)),
        "lookup-identity" => "/lookup".into(),
        _ => "/test".into(),
    };
    let response = api(
        model,
        if action == "save-identity-provider" {
            "PATCH"
        } else {
            "POST"
        },
        &format!("/api/identity/providers/{}{suffix}", segment(provider)),
        Some(fields),
        None,
    )
    .await?;
    if action == "lookup-identity" {
        model.borrow_mut().data["identityLookup"] = response;
        return Ok(());
    }
    if action == "test-identity-provider" {
        model.borrow_mut().data["identityTest"] = response;
        return Ok(());
    }
    load(model).await?;
    select(model, provider).await?;
    model.borrow_mut().notice =
        "Identity metadata saved. Sign-in uses the current provider revision and active mappings."
            .into();
    Ok(())
}
pub(super) fn login(methods: &Value) -> String {
    let mut html = String::new();
    for p in array(methods, "providers") {
        let id = s(&p["id"]);
        if p["kind"] == "OIDC" {
            html.push_str(&button(
                "oidc-login",
                &format!("Sign in with {}", s(&p["name"])),
                id,
            ));
        } else if p["kind"] == "LDAP" {
            let fields = input(
                &format!("ldap-username-{id}"),
                "Directory username",
                "text",
                true,
            ) + &input(
                &format!("ldap-password-{id}"),
                "Directory password",
                "password",
                true,
            );
            let f = form(
                "ldap-login",
                &fields,
                &format!("Sign in with {}", s(&p["name"])),
            );
            html.push_str(&format!(
                "<details><summary>{}</summary>{}</details>",
                e(&p["name"]),
                f.replacen(
                    "data-submit=\"ldap-login\"",
                    &format!("data-submit=\"ldap-login\" data-id=\"{}\"", escape(id)),
                    1
                )
            ));
        }
    }
    html
}
pub(super) fn view(data: &Value) -> String {
    let mut html="<header><h1>Identity providers</h1></header><section><p>External identities map explicitly to existing actors. Actor roles and project grants govern access.</p>".to_owned();
    for p in array(data, "providers") {
        html.push_str(&format!(
            "<article><h2>{}</h2><p>{} · Revision {} · {}</p>{}</article>",
            e(&p["name"]),
            e(&p["kind"]),
            e(&p["revision"]),
            if p["enabled"] == true {
                "Enabled"
            } else {
                "Disabled"
            },
            button("open-identity-provider", "Manage provider", s(&p["id"]))
        ));
    }
    if !array(data, "routes").is_empty() {
        let mut fields = field("new-identity", "name", "Provider name", &Value::Null, true)
            + "<label for=\"new-identity-route\">Operator identity route</label><select id=\"new-identity-route\" required><option value=\"\">Choose a route</option>";
        for r in array(data, "routes") {
            fields.push_str(&format!(
                "<option value=\"{}\">{} · {}</option>",
                e(&r["id"]),
                e(&r["name"]),
                e(&r["kind"])
            ));
        }
        fields.push_str("</select>");
        fields.push_str(&config_fields("new-identity", &Value::Null, None));
        fields.push_str(&field(
            "new-identity",
            "reason",
            "Provider creation reason",
            &Value::Null,
            true,
        ));
        html.push_str(&format!(
            "<details><summary>Add identity provider</summary>{}</details>",
            form(
                "create-identity-provider",
                &fields,
                "Create disabled provider"
            )
        ));
        html.push_str("<details><summary>Configured identity routes</summary>");
        for r in array(data, "routes") {
            html.push_str(&format!(
                "<p>{} · {} · {}</p><p>Secret aliases: {} · Allowed search bases: {}</p>",
                e(&r["name"]),
                e(&r["kind"]),
                e(r.get("issuerOrigin").unwrap_or(&r["host"])),
                escape(&r["secretRefs"].to_string()),
                escape(&r["baseDNs"].to_string())
            ));
        }
        html.push_str("</details>");
    } else {
        html.push_str(
            "<p>An operator must configure identity routes before providers can be added.</p>",
        );
    }
    let p = &data["selectedIdentityProvider"];
    if p.is_object() {
        html.push_str(&format!("<section aria-label=\"Identity provider configuration\"><h2>{}</h2><p>Revision {} · Route {}</p>",e(&p["name"]),e(&p["revision"]),e(&p["config"]["routeId"])));
        let fields = field("edit-identity", "name", "Provider name", &p["name"], true)
            + &format!(
                "<label><input type=\"checkbox\" id=\"edit-identity-enabled\" {}>Enable provider</label>",
                if p["enabled"] == true { "checked" } else { "" }
            )
            + &config_fields("edit-identity", &p["config"], Some(s(&p["kind"])))
            + &field(
                "edit-identity",
                "reason",
                "Provider update reason",
                &Value::Null,
                true,
            );
        html.push_str(&form(
            "save-identity-provider",
            &fields,
            "Save provider revision",
        ));
        html.push_str(&button(
            "test-identity-provider",
            "Test identity provider",
            "",
        ));
        if data["identityTest"].is_object() {
            html.push_str(&format!(
                "<p>Provider test: {} · {}</p>",
                e(&data["identityTest"]["status"]),
                e(&data["identityTest"]["code"])
            ));
        }
        if p["kind"] == "LDAP" {
            html.push_str(&form(
                "lookup-identity",
                &input(
                    "identity-lookup-username",
                    "Directory login to look up",
                    "text",
                    true,
                ),
                "Look up directory identity",
            ));
        }
        let mut fields = field(
            "identity",
            "subject",
            "External identity subject",
            &data["identityLookup"]["subject"],
            true,
        ) + "<label for=\"identity-actor\">Map to actor</label><select id=\"identity-actor\" required><option value=\"\">Choose an actor</option>";
        for actor in array(data, "actors") {
            fields.push_str(&format!(
                "<option value=\"{}\">{} · {}</option>",
                e(&actor["id"]),
                e(&actor["name"]),
                e(&actor["role"])
            ));
        }
        fields.push_str("</select>");
        fields.push_str(&input(
            "identity-link-reason",
            "Mapping reason",
            "text",
            true,
        ));
        html.push_str(&form("link-identity", &fields, "Link identity to actor"));
        html.push_str(&input(
            "identity-revoke-reason",
            "Mapping revocation reason",
            "text",
            true,
        ));
        for m in array(data, "identityMappings") {
            html.push_str(&format!(
                "<article><p>{} → {} · {}</p>",
                e(&m["subject"]),
                e(&m["actorName"]),
                e(&m["role"])
            ));
            if m["revokedAt"].is_null() {
                html.push_str(&button(
                    "revoke-identity",
                    "Revoke identity mapping",
                    s(&m["id"]),
                ));
            } else {
                html.push_str(&format!("<p>Revoked: {}</p>", e(&m["revokedAt"])));
            }
            html.push_str("</article>");
        }
        html.push_str("</section>");
    }
    html.push_str("</section>");
    html
}
