//! Navigation advice from retained facts. A recommendation carries no mutation,
//! approval, execution capability or claim of Oracle availability.
use super::{Model, Route, array, button, load, load_instance_project, s};
use serde_json::Value;

struct Step<'a> {
    title: &'static str,
    description: &'static str,
    destination: &'static str,
    action: &'static str,
    plan: Option<&'a Value>,
    status: &'static str,
}

fn choose<'a>(data: &'a Value, actor: &Value) -> Step<'a> {
    let plans = array(data, "plans");
    let jobs = array(data, "executionJobs");
    let pending = plans.iter().find(|p| p["status"] == "PENDING_APPROVAL");
    let held = jobs.iter().find(|j| j["state"] == "HOLD");
    let active = jobs.iter().find(|j| {
        ["WAITING_VALIDATION", "ADMITTED"]
            .iter()
            .any(|s| j["state"] == *s)
    });
    let completed = |j: &Value| {
        ["VERIFIED_SUCCESS", "NOOP"]
            .iter()
            .any(|s| j["state"] == *s)
    };
    let approved = plans.iter().find(|p| {
        p["status"] == "APPROVED" && !jobs.iter().any(|j| j["planId"] == p["id"] && completed(j))
    });
    let (title, description, destination, action, plan, status) = if !data["project"]["archivedAt"]
        .is_null()
    {
        (
            "Inspect retained project history",
            "This project is archived. Its releases, decisions and migration history remain readable.",
            "history",
            "Open migration history",
            None,
            "",
        )
    } else if data["projectSession"]["accessMode"] != "ENFORCED" {
        (
            "Finish project access setup",
            "Ask the local operator to activate project membership, then refresh the workspace.",
            "",
            "",
            None,
            "",
        )
    } else if data["projectRecovery"]["state"] != "ACTIVE" {
        (
            "Confirm workspace recovery status",
            "Changes are unavailable until the operator confirms active metadata and completes any required recovery reconciliation.",
            "history",
            "Inspect migration history",
            None,
            "",
        )
    } else if let Some(job) = held {
        (
            "Inspect held execution requests",
            "An execution outcome needs reconciliation. Inspect its retained evidence before preparing further changes.",
            "plans",
            "Inspect plans and execution",
            Some(&job["planId"]),
            "",
        )
    } else if let Some(job) = active {
        (
            "Follow the existing execution request",
            "A deployment request is waiting for validation or is admitted. Inspect its current state before requesting another deployment.",
            "plans",
            "Inspect execution request",
            Some(&job["planId"]),
            "",
        )
    } else if actor["role"] == "approver" {
        if let Some(plan) = pending {
            (
                "Review pending plans",
                "Review retained SQL, target facts and findings. A plan requires an independent approver.",
                "plans",
                "Open pending plans",
                Some(&plan["id"]),
                "PENDING_APPROVAL",
            )
        } else {
            (
                "Check the review inbox",
                "No plans in this project are awaiting approval. The inbox includes pending plans from your accessible projects.",
                "inbox",
                "Open review inbox",
                None,
                "",
            )
        }
    } else if array(data, "targetBindings").is_empty() {
        (
            "Configure a project target",
            "Register or reuse an Oracle instance, discover its schemas, and assign them to this project. A database manager needs operator-provisioned credentials and a configured Oracle runtime.",
            "instances",
            "Connect an Oracle instance",
            None,
            "",
        )
    } else if let Some(plan) = pending {
        (
            "Follow up on independent review",
            "A plan is awaiting approval. Inspect its review record or ask an independent approver to review it.",
            "plans",
            "Open pending plans",
            Some(&plan["id"]),
            "PENDING_APPROVAL",
        )
    } else if let Some(plan) = approved {
        (
            "Inspect approved plan readiness",
            "Approval is recorded. Review current target facts and execution blockers before requesting deployment.",
            "plans",
            "Inspect approved plans",
            Some(&plan["id"]),
            "APPROVED",
        )
    } else if jobs.iter().any(completed) {
        (
            "Inspect the migration outcome",
            "A completed request has retained execution evidence. Inspect migration history before preparing the next change.",
            "history",
            "Open migration history",
            None,
            "",
        )
    } else if array(data, "releases")
        .iter()
        .any(|r| r["validationStatus"] == "VALID")
    {
        (
            "Prepare an immutable plan",
            "A validated release is available. Select its target and prepare a plan for independent review.",
            "releases",
            "Open releases and plans",
            None,
            "",
        )
    } else {
        (
            "Prepare your SQL change",
            "Save a SQL draft, review validation findings and prepare an immutable release before requesting approval.",
            "workspace",
            "Open SQL Workspace",
            None,
            "",
        )
    };
    Step {
        title,
        description,
        destination,
        action,
        plan,
        status,
    }
}

pub(super) fn view(data: &Value, actor: &Value) -> String {
    let step = choose(data, actor);
    let pending = array(data, "plans")
        .iter()
        .filter(|p| p["status"] == "PENDING_APPROVAL")
        .count();
    let action = if step.action.is_empty() {
        String::new()
    } else {
        button("project-next-step", step.action, "")
    };
    format!(
        "<section aria-label=\"Project delivery metrics\"><p>Targets: {}{} · Pending review: {} · Releases: {}</p></section><section class=\"project-next-step\" aria-label=\"Recommended next step\"><h2>{}</h2><p>{}</p>{}</section>",
        array(data, "targetBindings").len(),
        if data["bindingNext"].is_string() {
            "+"
        } else {
            ""
        },
        pending,
        array(data, "releases").len(),
        step.title,
        step.description,
        action
    )
}

pub(super) async fn navigate(model: &Model) -> Result<(), String> {
    let (project, destination, plan, status) = {
        let state = model.borrow();
        let Route::Project(project, tab) = &state.route else {
            return Err("Open a project overview first.".into());
        };
        if tab != "overview" || state.data["project"]["id"] != *project {
            return Err("Open the project overview first.".into());
        }
        let actor = state.session.as_ref().ok_or("Sign in first.")?;
        let step = choose(&state.data, &actor["actor"]);
        (
            project.clone(),
            step.destination,
            step.plan.map(s).unwrap_or_default().to_owned(),
            step.status,
        )
    };
    if destination.is_empty() {
        return Err("Refresh the project after access setup is complete.".into());
    }
    model.borrow_mut().route = match destination {
        "instances" => Route::Instances,
        "inbox" => Route::Review,
        tab => Route::Project(project.clone(), tab.into()),
    };
    load(model).await?;
    if destination == "instances" {
        load_instance_project(model, &project).await?;
    }
    if destination == "plans" {
        let mut state = model.borrow_mut();
        let current = array(&state.data, "plans").iter().find(|p| p["id"] == plan);
        let matches = current.is_some_and(|p| status.is_empty() || p["status"] == status);
        state.data["planStatus"] = if matches && !status.is_empty() {
            status
        } else {
            "ALL"
        }
        .into();
        if matches {
            state.data["historyPlanFocus"] = plan.into();
        } else {
            state.notice = "Project facts changed. Inspect the current plan state.".into();
        }
    }
    Ok(())
}
