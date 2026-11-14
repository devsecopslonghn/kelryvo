//! Local presentation state never holds credentials or unsaved form contents.
//! Theme and menu changes patch the DOM without replacing active form controls.
use super::{Action, Model, Route, api, array, document, e, escape, load, value, window};
use serde_json::Value;
use wasm_bindgen::JsCast;

#[derive(Default)]
pub(super) struct Appearance {
    dark: bool,
    navigation: bool,
    pub(super) projects: Vec<Value>,
    selected: String,
    rendered_route: Option<Route>,
}
impl Appearance {
    pub(super) fn clear_access(&mut self) {
        self.projects.clear();
        self.selected.clear();
        self.navigation = false;
    }
    pub(super) fn missing(&mut self, project: &str) {
        self.projects.retain(|p| p["id"] != project);
        if self.selected == project {
            self.selected.clear();
        }
    }
}
pub(super) fn nav_button(action: &str, label: &str, id: &str, current: bool) -> String {
    format!(
        "<button type=\"button\" data-action=\"{}\" data-id=\"{}\"{}>{}</button>",
        escape(action),
        escape(id),
        if current {
            " aria-current=\"page\""
        } else {
            ""
        },
        escape(label)
    )
}
fn theme_button(dark: bool) -> String {
    format!(
        "<button type=\"button\" class=\"theme-toggle\" data-action=\"toggle-theme\" aria-label=\"Toggle color theme\" aria-pressed=\"{dark}\">{}</button>",
        if dark { "☀ Light" } else { "☾ Dark" }
    )
}
pub(super) fn login_header(state: &super::State) -> String {
    format!(
        "<div class=\"login-toolbar\">{}</div>",
        theme_button(state.appearance.dark)
    )
}
pub(super) fn start(state: &super::State) -> String {
    let appearance = &state.appearance;
    let mut html = format!(
        "<div class=\"app-shell{}\"><aside id=\"workspace-sidebar\"><a class=\"brand\" href=\"/\">Kelryvo</a><label class=\"project-switcher\" for=\"active-project\">Active project</label><select id=\"active-project\"><option value=\"\">Choose a project</option>",
        if appearance.navigation {
            " navigation-open"
        } else {
            ""
        }
    );
    for project in &appearance.projects {
        html.push_str(&format!(
            "<option value=\"{}\"{}>{}{}</option>",
            e(&project["id"]),
            if project["id"] == appearance.selected {
                " selected"
            } else {
                ""
            },
            e(&project["name"]),
            if project["archivedAt"].is_null() {
                ""
            } else {
                " · Archived"
            }
        ));
    }
    html.push_str("</select><nav id=\"workspace-navigation\" aria-label=\"Workspace navigation\">");
    for (action, label, selected) in [
        (
            "projects",
            "Projects",
            matches!(state.route, Route::Projects | Route::Project(_, _)),
        ),
        (
            "instances",
            "Instances",
            matches!(state.route, Route::Instances),
        ),
        (
            "connections",
            "Connections",
            matches!(state.route, Route::Connections),
        ),
        (
            "review",
            "Review inbox",
            matches!(state.route, Route::Review),
        ),
        ("account", "Account", matches!(state.route, Route::Account)),
        (
            "identity",
            "Identity providers",
            matches!(state.route, Route::Identity),
        ),
    ] {
        html.push_str(&nav_button(action, label, "", selected));
    }
    let actor = &state.session.as_ref().unwrap_or(&Value::Null)["actor"];
    html.push_str(&format!("</nav><div class=\"sidebar-account\"><p>{}</p><p>{}</p>{}</div></aside><main id=\"workspace-main\"><header class=\"workspace-topbar\"><button type=\"button\" class=\"navigation-toggle\" data-action=\"toggle-navigation\" aria-label=\"Open navigation\" aria-controls=\"workspace-sidebar\" aria-expanded=\"{}\"><svg aria-hidden=\"true\" width=\"18\" height=\"18\" viewBox=\"0 0 24 24\"><path d=\"M4 6h16M4 12h16M4 18h16\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/></svg></button><strong>{}</strong><div class=\"workspace-toolbar\">{}<button type=\"button\" data-action=\"refresh-workspace\" aria-label=\"Refresh workspace\">↻ Refresh</button></div></header><button type=\"button\" class=\"navigation-backdrop\" data-action=\"close-navigation\" aria-label=\"Close navigation\"></button>",e(&actor["name"]),e(&actor["role"]),nav_button("logout","Sign out","",false),appearance.navigation,title(&state.route),theme_button(appearance.dark)));
    html
}
fn title(route: &Route) -> &str {
    match route {
        Route::Projects => "Projects",
        Route::Account => "Account & access",
        Route::Instances => "Instances",
        Route::Connections => "Connections",
        Route::Review => "Review inbox",
        Route::Identity => "Identity providers",
        Route::Project(_, tab) => match tab.as_str() {
            "workspace" => "SQL Workspace",
            "plans" => "Plans",
            "releases" => "Releases",
            "targets" => "Project targets",
            "references" => "Schema references",
            "schema" => "Schema baselines",
            "connections" => "Project connections",
            "executions" => "Executions",
            "history" => "Migration history",
            "audit" => "Audit",
            "configuration" => "Configuration",
            _ => "Project overview",
        },
    }
}
pub(super) fn close(model: &Model, focus: bool) {
    let was_open = model.borrow().appearance.navigation;
    model.borrow_mut().appearance.navigation = false;
    patch(model);
    if focus
        && was_open
        && let Ok(Some(button)) = document().query_selector("[data-action='toggle-navigation']")
        && let Some(button) = button.dyn_ref::<web_sys::HtmlElement>()
    {
        let _ = button.focus();
    }
}
fn patch(model: &Model) {
    let state = model.borrow();
    let appearance = &state.appearance;
    if let Some(root) = document().document_element() {
        let _ = root.set_attribute("data-theme", if appearance.dark { "dark" } else { "light" });
    }
    if let Ok(Some(shell)) = document().query_selector(".app-shell") {
        if appearance.navigation {
            let _ = shell.class_list().add_1("navigation-open");
        } else {
            let _ = shell.class_list().remove_1("navigation-open");
        }
    }
    if let Ok(Some(button)) = document().query_selector("[data-action='toggle-navigation']") {
        let _ = button.set_attribute(
            "aria-expanded",
            if appearance.navigation {
                "true"
            } else {
                "false"
            },
        );
    }
    if let Ok(Some(meta)) = document().query_selector("meta[name='theme-color']") {
        let _ = meta.set_attribute(
            "content",
            if appearance.dark {
                "#0b1120"
            } else {
                "#f6f7fa"
            },
        );
    }
    if let Ok(buttons) = document().query_selector_all("[data-action='toggle-theme']") {
        for i in 0..buttons.length() {
            if let Some(button) = buttons
                .item(i)
                .and_then(|node| node.dyn_into::<web_sys::Element>().ok())
            {
                button.set_text_content(Some(if appearance.dark {
                    "☀ Light"
                } else {
                    "☾ Dark"
                }));
                let _ = button.set_attribute(
                    "aria-pressed",
                    if appearance.dark { "true" } else { "false" },
                );
            }
        }
    }
}
pub(super) fn after_render(model: &Model) {
    let changed = {
        let mut state = model.borrow_mut();
        let route = state.session.as_ref().map(|_| state.route.clone());
        let changed = state.appearance.rendered_route != route;
        state.appearance.rendered_route = route;
        changed
    };
    patch(model);
    if changed {
        window().scroll_to_with_x_and_y(0.0, 0.0);
    }
}
pub(super) fn local_action(model: &Model, action: &str) -> bool {
    match action {
        "toggle-theme" => {
            let mut state = model.borrow_mut();
            state.appearance.dark = !state.appearance.dark;
        }
        "toggle-navigation" => {
            let mut state = model.borrow_mut();
            state.appearance.navigation = !state.appearance.navigation;
        }
        "close-navigation" => {
            close(model, true);
            return true;
        }
        _ => return false,
    }
    patch(model);
    true
}
pub(super) fn selected(model: &Model, data: &Value) {
    let mut state = model.borrow_mut();
    if let Route::Project(project, _) = &state.route {
        let project = project.clone();
        if data["project"]["id"] == project {
            state.appearance.selected = project;
        }
    } else if matches!(state.route, Route::Instances)
        && let Some(project) = data["projectId"].as_str()
    {
        state.appearance.selected = project.to_owned();
    }
}
pub(super) async fn inventory(model: &Model, data: &Value) -> Result<(), String> {
    let route = model.borrow().route.clone();
    if matches!(
        route,
        Route::Projects | Route::Instances | Route::Connections
    ) {
        model.borrow_mut().appearance.projects = array(data, "projects").to_vec();
    } else if model.borrow().appearance.projects.is_empty() {
        let response = api(model, "GET", "/api/projects", None, None).await?;
        model.borrow_mut().appearance.projects = array(&response, "projects").to_vec();
    }
    let mut state = model.borrow_mut();
    if !state
        .appearance
        .projects
        .iter()
        .any(|p| p["id"] == state.appearance.selected)
    {
        state.appearance.selected.clear();
    }
    Ok(())
}
pub(super) async fn switch(model: &Model, project: &str) -> Result<(), String> {
    if !project.is_empty()
        && !model
            .borrow()
            .appearance
            .projects
            .iter()
            .any(|p| p["id"] == project)
    {
        return Err("Choose a project from the current assigned inventory.".into());
    }
    let route = if project.is_empty() {
        Route::Projects
    } else {
        let tab = match &model.borrow().route {
            Route::Project(_, tab) => tab.clone(),
            _ => "overview".into(),
        };
        Route::Project(project.into(), tab)
    };
    {
        let mut state = model.borrow_mut();
        state.route = route;
        state.data = Value::Null;
        state.appearance.selected = project.into();
    }
    load(model).await
}
pub(super) fn change(model: &Model, event: &web_sys::Event) -> bool {
    if event
        .target()
        .and_then(|e| e.dyn_into::<web_sys::Element>().ok())
        .is_some_and(|e| e.id() == "active-project")
    {
        super::run_action(
            model.clone(),
            Action::SwitchProject,
            value("active-project"),
            Value::Null,
        );
        true
    } else {
        false
    }
}
