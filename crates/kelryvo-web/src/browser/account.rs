//! Self-service account facts and session revocation. Operator grants and roles
//! remain read-only; only a different session owned by this actor is revocable.
use super::*;
use super::{Model, api, array, button, e, escape, form, input, s, segment};
use crate::browser::actions::Action;
use serde_json::{Value, json};
pub(super) async fn load(model: &Model) -> Result<Value, String> {
    let sessions = api(model, "GET", "/api/account/sessions", None, None).await?;
    let access = api(model, "GET", "/api/account/access", None, None).await?;
    let login = api(model, "GET", "/api/account/login", None, None).await?;
    Ok(
        json!({"sessions":sessions["sessions"],"sessionNext":sessions["nextCursor"],"access":access,"login":login}),
    )
}
pub(super) async fn existing_action(model: &Model, action: Action, id: &str) -> Result<(), String> {
    let result = async {
        if action == Action::RevokeAccountSession {
            let owned = array(&model.borrow().data, "sessions")
                .iter()
                .any(|r| r["id"] == id && r["current"] == false);
            if !owned {
                return Err("Choose another active session owned by this account.".into());
            }
            api(
                model,
                "POST",
                &format!("/api/account/sessions/{}/revoke", segment(id)),
                None,
                None,
            )
            .await?;
            model.borrow_mut().data = load(model).await?;
            model.borrow_mut().notice =
                "Other browser session revoked. This session remains signed in.".into();
            return Ok(());
        }
        if action == Action::RefreshAccount {
            model.borrow_mut().data = Value::Null;
            model.borrow_mut().data = load(model).await?;
            return Ok(());
        }
        let (path, key, cursor) = if action == Action::MoreAccountAccess {
            (
                "access",
                "projects",
                model.borrow().data["access"]["nextCursor"].clone(),
            )
        } else if action == Action::MoreAccountSessions {
            (
                "sessions",
                "sessions",
                model.borrow().data["sessionNext"].clone(),
            )
        } else {
            return Err("Unknown account action".into());
        };
        let cursor = cursor.as_str().ok_or("No further account page")?;
        let page = api(
            model,
            "GET",
            &format!("/api/account/{path}?after={}", segment(cursor)),
            None,
            None,
        )
        .await?;
        let mut state = model.borrow_mut();
        let current = if path == "access" {
            &state.data["access"]
        } else {
            &state.data
        };
        let mut rows = array(current, key).to_vec();
        for row in array(&page, key) {
            if let Some(previous) = rows.iter_mut().find(|r| r["id"] == row["id"]) {
                *previous = row.clone();
            } else {
                rows.push(row.clone());
            }
        }
        if path == "access" {
            state.data["access"] = page;
            state.data["access"][key] = rows.into();
        } else {
            state.data[key] = rows.into();
            state.data["sessionNext"] = page["nextCursor"].clone();
        }
        Ok(())
    }
    .await;
    if result.is_err() {
        model.borrow_mut().data = Value::Null;
    }
    result
}
pub(super) fn view(data: &Value, session: &Value) -> String {
    let mut html = format!(
        "<header><h1>Account</h1><p>{} · {}</p></header>",
        e(&session["actor"]["name"]),
        e(&session["actor"]["role"])
    );
    html.push_str(&button("refresh-account", "Refresh account", ""));
    if !data["access"].is_object() {
        html.push_str("<p>Account information unavailable. Refresh to retry.</p>");
        return html;
    }
    let access = &data["access"];
    let login = &data["login"];
    html.push_str("<section aria-label=\"Account summary\"><h2>Account summary</h2>");
    html.push_str(&format!(
        "<p>Local sign-in: {}</p>",
        if login["configured"] == true {
            format!(
                "{} · {}",
                e(&login["username"]),
                if login["disabled"] == true {
                    "Disabled; contact your operator"
                } else {
                    "Username and password"
                }
            )
        } else {
            "Not set up. Use your operator-issued setup token to create a password.".into()
        }
    ));
    html.push_str(&format!(
        "<p>{}{} assigned projects · {}{} active browser sessions</p></section>",
        array(access, "projects").len(),
        if access["nextCursor"].is_string() {
            "+"
        } else {
            ""
        },
        array(data, "sessions").len(),
        if data["sessionNext"].is_string() {
            "+"
        } else {
            ""
        }
    ));
    if access["accessMode"] == "BOOTSTRAP_REQUIRED" {
        html.push_str("<p>Access bootstrap required. An operator must activate membership and grant project access.</p>");
    }
    if login["configured"] == true && login["disabled"] == false && session["csrfToken"].is_string()
    {
        html.push_str("<section><h2>Change password</h2><p>Use your current password. Changing it signs out your active browser sessions. Roles and project grants stay the same.</p>");
        html.push_str(&form(
            "change-password",
            &(input("current-password", "Current password", "password", true)
                + &input("new-password", "New password", "password", true)
                + &input("confirm-password", "Confirm new password", "password", true)),
            "Change password",
        ));
        html.push_str("</section>");
    }
    html.push_str("<section aria-label=\"Project access details\"><h2>Project access details</h2>");
    html.push_str(&format!(
        "<p>{} · {} · <code>{}</code></p>",
        e(&access["actor"]["name"]),
        e(&access["actor"]["role"]),
        e(&access["actor"]["id"])
    ));
    html.push_str("<p>Your operator provisions identities and explicitly grants or revokes project and deployment access. Approvers cannot approve their own plans.</p>");
    if array(access, "projects").is_empty() {
        html.push_str("<p>No assigned projects.</p>");
    }
    for p in array(access, "projects") {
        html.push_str(&format!("<article class=\"account-project\" data-project-id=\"{}\"><h3>{}</h3><p><code>{}</code></p><p>{} · Independent review: {} · Deployment requests: {}</p></article>",e(&p["id"]),e(&p["name"]),e(&p["id"]),if p["archivedAt"].is_null(){"Project member"}else{"Archived; read only"},if p["canReview"]==true{"role permits review"}else{"unavailable"},if p["canDeploy"]==true{"granted"}else{"unavailable"}));
    }
    if access["nextCursor"].is_string() {
        html.push_str(&button("more-account-access", "Load more access", ""));
    }
    html.push_str("</section>");
    html.push_str("<section aria-label=\"Active browser sessions\"><h2>Active sessions</h2><p>Revoke another session to sign it out. Use Sign out for this session. Sessions expire after 30 minutes idle or at their absolute deadline.</p>");
    if array(data, "sessions").is_empty() {
        html.push_str("<p>No active browser sessions.</p>");
    }
    for session in array(data, "sessions") {
        let id = s(&session["id"]);
        html.push_str(&format!("<article class=\"account-session\" data-session-id=\"{}\"><h3>{}</h3><p>Signed in {} · Idle deadline {} · Absolute deadline {}</p>",escape(id),if session["current"]==true{"This browser session"}else{"Other browser session"},e(&session["issuedAt"]),e(&session["idleExpiresAt"]),e(&session["absoluteExpiresAt"])));
        if session["current"] == false {
            html.push_str(&button("revoke-account-session", "Revoke session", id));
        }
        html.push_str("</article>");
    }
    if data["sessionNext"].is_string() {
        html.push_str(&button("more-account-sessions", "Load more sessions", ""));
    }
    html.push_str("</section>");
    html
}

pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    match action {
        Action::Login | Action::TokenLogin => {
            let session = api(
                model,
                "POST",
                "/api/session",
                if action == Action::Login {
                    Some(json!({"username":fields["username"],"password":fields["password"]}))
                } else {
                    None
                },
                fields.get("token").and_then(Value::as_str),
            )
            .await?;
            model.borrow_mut().set_session(Some(session));
            model.borrow_mut().data = Value::Null;
            workflow_location::prepare_login(model);
            load(model).await?;
        }
        Action::Setup => {
            api(
                model,
                "POST",
                "/api/auth/setup",
                Some(json!({"username":fields["username"],"password":fields["password"]})),
                fields["token"].as_str(),
            )
            .await?;
            model.borrow_mut().notice = "Password set. You can now sign in.".into();
        }
        Action::ChangePassword => {
            if fields["newPassword"] != fields["confirmation"] {
                return Err("New passwords do not match.".into());
            }
            api(model,"POST","/api/account/password",Some(json!({"currentPassword":fields["currentPassword"],"newPassword":fields["newPassword"]})),None)
                .await.map_err(|e|if e=="PASSWORD NOT ACCEPTED" {"Current password was not accepted.".into()} else {e})?;
            model.borrow_mut().set_session(None);
            model.borrow_mut().data = Value::Null;
            model.borrow_mut().notice = "Password changed. Sign in again.".into();
            workflow_location::signed_out(model);
        }
        Action::Logout => {
            api(model, "POST", "/api/session/logout", None, None).await?;
            model.borrow_mut().set_session(None);
            model.borrow_mut().data = Value::Null;
            workflow_location::signed_out(model);
            if let Ok(methods) = api(model, "GET", "/api/auth/methods", None, None).await {
                model.borrow_mut().methods = methods;
            }
        }
        _ => return existing_action(model, action, id).await,
    }
    Ok(())
}
