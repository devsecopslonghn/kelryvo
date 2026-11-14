//! User actions for instances.
use super::*;

pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    match action {
        Action::AssignInstanceSchemas => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            api(
                model,
                "POST",
                &format!(
                    "/api/projects/{}/database-connections/{}/assign-schemas",
                    segment(&project),
                    segment(id)
                ),
                Some(fields),
                None,
            )
            .await?;
            let bindings = api(
                model,
                "GET",
                &format!("/api/projects/{}/target-bindings", segment(&project)),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            state.data["bindings"] = bindings["bindings"].clone();
            state.notice =
                "Schemas assigned. Target bindings require identity verification.".into();
        }
        Action::AttachInstance
        | Action::TestInstance
        | Action::DiscoverInstance
        | Action::InstanceObservations => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            let base = format!(
                "/api/projects/{}/database-connections/{}",
                segment(&project),
                segment(id)
            );
            if action == Action::AttachInstance {
                api(
                    model,
                    "POST",
                    &format!(
                        "/api/projects/{}/database-instances/attach",
                        segment(&project)
                    ),
                    Some(json!({"connectionId":id,"reason":fields["reason"]})),
                    None,
                )
                .await?;
                model.borrow_mut().notice = "Instance attached to project.".into();
            } else {
                if action != Action::InstanceObservations {
                    let suffix = if action == Action::TestInstance {
                        "test"
                    } else {
                        "discover"
                    };
                    let result = api(
                        model,
                        "POST",
                        &format!("{base}/{suffix}"),
                        Some(fields),
                        None,
                    )
                    .await?;
                    model.borrow_mut().notice = format!(
                        "Observation recorded: {}.",
                        s(&result["observation"]["status"])
                    );
                }
                let history =
                    api(model, "GET", &format!("{base}/observations"), None, None).await?;
                let mut state = model.borrow_mut();
                if !state.data["observationsByConnection"].is_object() {
                    state.data["observationsByConnection"] = json!({});
                }
                state.data["observationsByConnection"][id] = history["observations"].clone();
            }
        }
        Action::ChooseInstanceProject => {
            load_instance_project(model, s(&fields["projectId"])).await?;
        }
        Action::RegisterInstance => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            api(
                model,
                "POST",
                &format!(
                    "/api/projects/{}/database-instances/master",
                    segment(&project)
                ),
                Some(fields),
                None,
            )
            .await?;
            load_instance_project(model, &project).await?;
            model.borrow_mut().notice =
                "Instance registered. Discover and verify the project schemas before deployment."
                    .into();
        }
        Action::RotateInstance | Action::RevokeInstance => {
            let project = model.borrow().data["projectId"]
                .as_str()
                .ok_or("Choose a project")?
                .to_owned();
            api(
                model,
                "POST",
                &format!(
                    "/api/projects/{}/database-connections/{}/credentials",
                    segment(&project),
                    segment(id)
                ),
                Some(fields),
                None,
            )
            .await?;
            load_instance_project(model, &project).await?;
            model.borrow_mut().notice = if action == Action::RotateInstance {
                "Credential replaced. Refresh target profiles before deployment."
            } else {
                "Credential revoked. The connection is disabled."
            }
            .into();
        }
        _ => return Err("Unknown instances action".into()),
    }
    Ok(())
}

pub(super) fn instances_view(data: &Value) -> String {
    let mut html="<header><h1>Instances</h1><p>Register one instance credential, then assign database schemas to a project.</p></header><section>".to_owned();
    html.push_str(&project_picker(data));
    html.push_str("</section>");
    if data["projectId"].is_string() {
        for instance in array(data, "instances") {
            let id = s(&instance["id"]);
            html.push_str(&format!(
                "<article><h2>{}</h2><p>{} · {} · {}</p><p>Credential revision {} · {}</p>",
                e(&instance["name"]),
                e(&instance["host"]),
                e(&instance["service"]),
                e(&instance["username"]),
                e(&instance["revision"]),
                e(&instance["status"])
            ));
            html.push_str(&input(
                &format!("discovery-reason-{id}"),
                "Connection action reason",
                "text",
                true,
            ));
            html.push_str(&button("attach-instance", "Attach to project", id));
            if instance["enabled"] == true {
                html.push_str(&button("test-instance", "Test connection", id));
                html.push_str(&button("discover-instance", "Discover schemas", id));
            }
            html.push_str(&button(
                "open-managed-connection",
                "Connection details",
                &format!("database-connections/{id}"),
            ));
            html.push_str(&button("instance-observations", "Observation history", id));
            if let Some(history) = data["observationsByConnection"][id].as_array() {
                html.push_str("<section><h3>Connection observations</h3><p>Observations do not approve deployment.</p>");
                if history.is_empty() {
                    html.push_str("<p>No observations recorded.</p>");
                }
                for observation in history {
                    html.push_str(&format!("<details><summary>{} · {} · {}</summary><p>Identity: {} · Provenance: {}</p><p>Observed: {} · Expires: {}</p><pre>{}</pre>",e(&observation["operation"]),e(&observation["status"]),e(&observation["currentness"]),e(&observation["identityState"]),e(&observation["provenance"]),e(&observation["observedAt"]),e(&observation["expiresAt"]),escape(&serde_json::to_string_pretty(&observation["limitations"]).unwrap_or_default())));
                    html.push_str(&records(
                        array(observation, "schemas"),
                        &[("owner", "Schema"), ("accessible", "Accessible")],
                    ));
                    html.push_str("</details>");
                }
                html.push_str("</section>");
            }
            if let Some(observation) = assignable_observation(data, id) {
                html.push_str("<section><h3>Assign schemas</h3><p>Select accessible schemas for this project.</p>");
                for (index, schema) in array(observation, "schemas").iter().enumerate() {
                    if schema["accessible"] == true {
                        html.push_str(&format!(
                            "<label><input id=\"assign-owner-{}-{}\" type=\"checkbox\">{}</label>",
                            escape(id),
                            index,
                            e(&schema["owner"])
                        ));
                    }
                }
                html.push_str(&format!("<label for=\"assign-environment-{}\">Target environment</label><select id=\"assign-environment-{}\"><option value=\"\">Choose an environment</option>",escape(id),escape(id)));
                for env in array(data, "environments") {
                    html.push_str(&format!(
                        "<option value=\"{}\">{}</option>",
                        e(&env["id"]),
                        e(&env["name"])
                    ));
                }
                html.push_str("</select>");
                html.push_str(&input(
                    &format!("assign-reason-{id}"),
                    "Schema assignment reason",
                    "text",
                    true,
                ));
                html.push_str(&button(
                    "assign-instance-schemas",
                    "Assign selected schemas",
                    id,
                ));
                html.push_str("</section>");
            }
            for binding in array(data, "bindings")
                .iter()
                .filter(|b| b["policyId"] == instance["id"])
            {
                let bid = s(&binding["bindingId"]);
                html.push_str(&format!(
                    "<section><h3>Target {}</h3><p>Binding revision {} · Identity {}</p>",
                    e(&binding["exactOwner"]),
                    e(&binding["bindingRevision"]),
                    e(&binding["identityState"])
                ));
                html.push_str(&button("inspect-target", "Inspect target", bid));
                let detail = &data["targetDetails"][bid];
                if detail.is_object() {
                    html.push_str(&format!(
                        "<p>Currentness: {}</p><pre>{}</pre>",
                        e(&detail["currentness"]["state"]),
                        escape(
                            &serde_json::to_string_pretty(&detail["currentness"]["reasons"])
                                .unwrap_or_default()
                        )
                    ));
                    if let Some(observation) = assignable_observation(data, id)
                        && array(observation, "schemas").iter().any(|schema| {
                            schema["owner"] == binding["exactOwner"] && schema["accessible"] == true
                        })
                    {
                        html.push_str(&input(
                            &format!("verification-reason-{bid}"),
                            "Identity acceptance reason",
                            "text",
                            true,
                        ));
                        html.push_str(&button("observe-target", "Observe identity", bid));
                        if observation["provenance"] == "ORACLE_READ_ONLY"
                            && observation["verificationAcceptance"].is_object()
                        {
                            html.push_str(&button("verify-target", "Verify identity", bid));
                        }
                    }
                    if binding["observationDigest"].is_string() {
                        html.push_str(&button("target-evidence", "View identity evidence", bid));
                    }
                }
                if let Some(evidence) = data["targetEvidence"][bid].as_object() {
                    html.push_str(&format!(
                        "<details open><summary>Identity evidence</summary><pre>{}</pre></details>",
                        escape(&serde_json::to_string_pretty(evidence).unwrap_or_default())
                    ));
                }
                html.push_str(&schema_panel(data, binding, Some(id)));
                html.push_str("</section>");
            }
            html.push_str(&input(
                &format!("credential-password-{id}"),
                "Replacement password",
                "password",
                false,
            ));
            html.push_str(&input(
                &format!("credential-reason-{id}"),
                "Credential change reason",
                "text",
                true,
            ));
            if data["credentialEntryAvailable"] == true {
                html.push_str(&button("rotate-instance", "Replace credential", id));
            }
            if instance["credentialStorage"] == "ENCRYPTED" {
                html.push_str(&button("revoke-instance", "Revoke credential", id));
            }
            html.push_str("</article>");
        }
        if data["credentialEntryAvailable"] == true {
            let mut fields = input("instance-name", "Instance name", "text", true)
                + &input("instance-container", "Container name", "text", true);
            fields.push_str("<label for=\"instance-kind\">Topology</label><select id=\"instance-kind\"><option value=\"PDB\">PDB</option><option value=\"NON_CDB\">Non-CDB</option></select><label for=\"instance-environment\">Environment</label><select id=\"instance-environment\"><option>DEV</option><option>SIT</option><option>UAT</option><option>PROD</option></select>");
            fields.push_str(&input("instance-host", "Host", "text", true));
            fields.push_str("<label>Port<input id=\"instance-port\" type=\"number\" value=\"1521\" min=\"1\" max=\"65535\" required></label>");
            fields.push_str(&input("instance-service", "Service name", "text", true));
            fields.push_str("<label for=\"instance-transport\">Transport</label><select id=\"instance-transport\"><option value=\"TCPS\">TCPS</option><option value=\"TCP\">TCP</option></select>");
            fields.push_str(&input(
                "instance-username",
                "Database username",
                "text",
                true,
            ));
            fields.push_str(&input(
                "instance-password",
                "Database password",
                "password",
                true,
            ));
            fields.push_str(&input(
                "instance-reason",
                "Registration reason",
                "text",
                true,
            ));
            html.push_str("<section><h2>Register an instance</h2>");
            html.push_str(&form("register-instance", &fields, "Register instance"));
            html.push_str("</section>");
        } else {
            html.push_str("<p class=\"notice\">Credential entry is unavailable. Ask an operator to configure the vault public key.</p>");
        }
    } else {
        html.push_str(&records(
            array(data, "instances"),
            &[
                ("name", "Instance"),
                ("host", "Host"),
                ("service", "Service"),
                ("status", "Status"),
            ],
        ));
    }
    html.push_str(&instance_profiles::view(data));
    html.push_str(&configuration::panel(data));
    html
}

pub(super) async fn load_instance_project(model: &Model, project: &str) -> Result<(), String> {
    let projects = model.borrow().data["projects"].clone();
    let retained = if model.borrow().data["projectId"] == project {
        model.borrow().data["profileFilters"].clone()
    } else {
        json!({"search":"","environment":"","status":""})
    };
    let project_data = api(
        model,
        "GET",
        &format!("/api/projects/{}", segment(project)),
        None,
        None,
    )
    .await?;
    let mut data = json!({"instances":[],"credentialEntryAvailable":false});
    data["project"] = project_data["project"].clone();
    project_lifecycle::load_facts(model, &mut data).await?;
    if project_lifecycle::write(&data) && data["projectSession"]["actor"]["role"] == "developer" {
        let masters = api(
            model,
            "GET",
            &format!(
                "/api/projects/{}/database-instances/master",
                segment(project)
            ),
            None,
            None,
        )
        .await;
        match masters {
            Ok(masters) => {
                data["instances"] = masters["instances"].clone();
                data["credentialEntryAvailable"] = masters["credentialEntryAvailable"].clone();
                data["truncated"] = masters["truncated"].clone();
            }
            Err(error) if error == "DATABASE MANAGEMENT REQUIRED" => {}
            Err(error) => return Err(error),
        }
    }
    data["environments"] = project_data["environments"].clone();
    data["profiles"] = project_data["profiles"].clone();
    data["profileFilters"] = retained;
    data["bindings"] = api(
        model,
        "GET",
        &format!("/api/projects/{}/target-bindings", segment(project)),
        None,
        None,
    )
    .await?["bindings"]
        .clone();
    data["projects"] = projects;
    data["projectId"] = project.into();
    shell::selected(model, &data);
    model.borrow_mut().data = data;
    Ok(())
}
