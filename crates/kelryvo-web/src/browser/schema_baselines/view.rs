use super::super::{array, button, e, s};
use super::manage;
use crate::escape;
use serde_json::Value;
use std::collections::BTreeSet;
fn pretty(v: &Value) -> String {
    escape(&serde_json::to_string_pretty(v).unwrap_or_default())
}
fn select(
    id: &str,
    label: &str,
    selected: &Value,
    rows: impl IntoIterator<Item = (String, String)>,
) -> String {
    let mut html = format!(
        "<label for=\"{id}\">{label}</label><select id=\"{id}\"><option value=\"\">Choose a value</option>"
    );
    for (key, label) in rows {
        html.push_str(&format!(
            "<option value=\"{}\"{}>{}</option>",
            escape(&key),
            if selected.as_str() == Some(key.as_str()) {
                " selected"
            } else {
                ""
            },
            escape(&label)
        ));
    }
    html.push_str("</select>");
    html
}
fn input(id: &str, label: &str, value: &Value, max: usize) -> String {
    format!(
        "<label for=\"{id}\">{label}</label><input id=\"{id}\" maxlength=\"{max}\" value=\"{}\">",
        e(value)
    )
}
fn facts(snapshot: &Value) -> String {
    let mut html = "<dl class=\"schema-snapshot-facts\">".to_owned();
    for (label, v) in [
        ("Schema owner", &snapshot["owner"]),
        ("Observed", &snapshot["observedAt"]),
        ("Provenance", &snapshot["provenance"]),
        ("Database", &snapshot["identity"]["dbUniqueName"]),
        ("Container", &snapshot["identity"]["containerName"]),
        ("Observed service", &snapshot["identity"]["serviceName"]),
        ("Observed version", &snapshot["identity"]["version"]),
        ("Content digest", &snapshot["contentDigest"]),
    ] {
        html.push_str(&format!(
            "<dt>{label}</dt><dd>{}</dd>",
            if v.is_string() {
                e(v)
            } else {
                "Unknown".into()
            }
        ));
    }
    html.push_str(&format!("<dt>Live acceptance</dt><dd>{}</dd></dl><details><summary>Coverage and limitations</summary><pre>{}</pre><pre>{}</pre></details>",if snapshot["liveAccepted"]==true{"Accepted at the recorded time"}else{"Not established"},pretty(&snapshot["coverage"]),pretty(&snapshot["limitations"])));
    html
}
pub(super) fn matches(object: &Value, filter: &Value) -> bool {
    let kind = object["type"]
        .as_str()
        .or(object["objectType"].as_str())
        .unwrap_or("Unknown");
    let name = object["name"]
        .as_str()
        .or(object["objectName"].as_str())
        .unwrap_or("Unnamed");
    let q = s(&filter["q"])
        .trim_matches(kelryvo_core::js_whitespace)
        .to_lowercase();
    (filter["type"] == "ALL" || s(&filter["type"]).is_empty() || filter["type"] == kind)
        && format!("{}.{name}", s(&object["owner"]))
            .to_lowercase()
            .contains(&q)
}
fn objects(page: &Value) -> String {
    let rows = array(&page["snapshot"]["schema"], "objects");
    if rows.is_empty() {
        return "<p>No objects were reported in this snapshot. Check coverage before treating this as an empty schema.</p>".into();
    }
    let f = &page["objectFilter"];
    let kinds: BTreeSet<_> = rows
        .iter()
        .map(|o| {
            o["type"]
                .as_str()
                .or(o["objectType"].as_str())
                .unwrap_or("Unknown")
        })
        .collect();
    let mut html = input(
        "schema-object-query",
        "Search retained objects",
        &f["q"],
        256,
    );
    html.push_str("<label for=\"schema-object-type\">Filter retained objects by type</label><select id=\"schema-object-type\">");
    for kind in std::iter::once("ALL").chain(kinds) {
        html.push_str(&format!(
            "<option value=\"{}\"{}>{}</option>",
            escape(kind),
            if f["type"] == kind { " selected" } else { "" },
            if kind == "ALL" {
                "All types".into()
            } else {
                escape(kind)
            }
        ));
    }
    html.push_str("</select>");
    html.push_str(&button(
        "clear-schema-object-filters",
        "Clear object filters",
        "",
    ));
    let count = rows.iter().filter(|o| matches(o, f)).count();
    html.push_str(&format!("<p id=\"schema-object-count\" role=\"status\">Showing {count} of {} retained objects.</p><p id=\"schema-object-empty\" {}>No retained objects match these filters. This filtered view does not establish schema absence.</p><div class=\"table-wrap\"><table><thead><tr><th>Type</th><th>Owner</th><th>Name</th><th>Details</th></tr></thead><tbody>",rows.len(),if count==0{""}else{"hidden"}));
    for (i, o) in rows.iter().enumerate() {
        let kind = o["type"]
            .as_str()
            .or(o["objectType"].as_str())
            .unwrap_or("Unknown");
        let name = o["name"]
            .as_str()
            .or(o["objectName"].as_str())
            .unwrap_or("Unnamed");
        html.push_str(&format!("<tr class=\"retained-schema-object\" id=\"schema-object-{i}\" {}><td>{}</td><td>{}</td><td>{}</td><td><details><summary>Definition and metadata</summary><p>Object SHA-256 {}</p><pre>{}</pre></details></td></tr>",if matches(o,f){""}else{"hidden"},escape(kind),e(&o["owner"]),escape(name),e(&o["checksum"]),pretty(if o["definition"].is_null(){o}else{&o["definition"]})));
    }
    html.push_str("</tbody></table></div>");
    html
}
pub(in crate::browser) fn view(data: &Value) -> String {
    let p = &data["schemaPage"];
    let h = &p["history"];
    let f = &p["form"];
    let mut html="<section aria-label=\"Schema baselines and drift\"><h2>Schema baselines &amp; drift</h2><p>Retain immutable schema snapshots and compare them with a baseline. Incomplete metadata never proves object absence. These records do not authorize execution.</p>".to_owned();
    html.push_str(&select(
        "schema-target",
        "Schema target",
        &p["bindingId"],
        array(data, "targetBindings").iter().map(|b| {
            (
                s(&b["bindingId"]).into(),
                format!(
                    "{} · {} · revision {}",
                    s(&b["exactOwner"]),
                    s(&b["environmentName"]),
                    s(&b["bindingRevision"])
                ),
            )
        }),
    ));
    if data["bindingNext"].is_string() {
        html.push_str(&button(
            "more-schema-targets",
            "Load more schema targets",
            "",
        ));
    }
    html.push_str(&button("refresh-schema", "Refresh schema", ""));
    if !h.is_object() {
        html.push_str("<p>Choose a project target and refresh its schema evidence.</p></section>");
        return html;
    }
    html.push_str(&format!("<p>Target owner: {} · Binding <code>{}</code> · revision {}</p><p>Currentness: {} · {}</p>",e(&h["binding"]["exactOwner"]),e(&h["binding"]["bindingId"]),e(&h["binding"]["bindingRevision"]),e(&h["currentness"]["state"]),pretty(&h["currentness"]["reasons"])));
    if h["drift"].is_object() {
        html.push_str(&format!("<section aria-label=\"Latest schema drift summary\"><h3>Latest schema drift summary</h3><p>{}</p><pre>{}</pre></section>",e(&h["drift"]["comparison"]["state"]),pretty(&h["drift"]["comparison"]["summary"])));
    }
    if manage(data) {
        let fields = select(
            "schema-authorized-connection",
            "Authorized connection",
            &f["connectionId"],
            array(&data["schemaConnections"], "connections")
                .iter()
                .filter(|c| {
                    c["routeId"] == h["binding"]["routeId"]
                        && c["engine"] == "oracle"
                        && c["enabled"] == true
                        && c["retiredAt"].is_null()
                })
                .map(|c| {
                    (
                        s(&c["id"]).into(),
                        format!("{} · {}", s(&c["name"]), s(&c["engine"])),
                    )
                }),
        ) + &input(
            "schema-observation-reason",
            "Observation reason",
            &f["reason"],
            2000,
        );
        html.push_str(&format!(
            "<details><summary>Collect a schema observation</summary>{}</details>",
            super::super::form("observe-schema-evidence", &fields, "Observe schema")
        ));
    } else {
        html.push_str("<p>Schema observations and baseline capture are unavailable with the current access or recovery state. Retained evidence remains readable.</p>");
    }
    if data["schemaConnections"]["nextCursor"].is_string() {
        html.push_str(&button(
            "more-schema-connections",
            "Load more authorized connections",
            "",
        ));
    }
    html.push_str("<section aria-label=\"Retained schema snapshots\"><h3>Schema snapshots</h3>");
    if array(h, "snapshots").is_empty() {
        html.push_str("<p>No schema snapshots are available yet.</p>");
    }
    for snap in array(h, "snapshots") {
        html.push_str(&format!("<article class=\"schema-snapshot-row\" data-snapshot-id=\"{}\"><p>{} · {} · {} objects</p><p>Live acceptance: {}</p><pre>{}</pre>{}</article>",e(&snap["id"]),e(&snap["observedAt"]),e(&snap["provenance"]),snap["objectCount"],if snap["liveAccepted"]==true{"recorded"}else{"not established"},pretty(&snap["coverage"]),button("open-retained-schema",s(&snap["id"]),s(&snap["id"]))));
    }
    if h["nextCursor"].is_string() {
        html.push_str(&button("more-schema-snapshots", "Load more snapshots", ""));
    }
    html.push_str(
        "</section><section aria-label=\"Immutable baseline history\"><h3>Baseline history</h3>",
    );
    if array(h, "baselines").is_empty() {
        html.push_str("<p>No immutable baselines have been captured for this target.</p>");
    }
    for b in array(h, "baselines") {
        html.push_str(&format!("<article class=\"schema-baseline-row\" data-baseline-id=\"{}\"><h4>{}</h4><p>{} · {} · {}</p>{}</article>",e(&b["id"]),e(&b["name"]),e(&b["createdAt"]),e(&b["provenance"]),e(&b["snapshotId"]),button("open-retained-schema","Open baseline snapshot",s(&b["snapshotId"]))));
    }
    if h["baselineNextCursor"].is_string() {
        html.push_str(&button("more-schema-baselines", "Load more baselines", ""));
    }
    html.push_str("</section>");
    if p["snapshot"].is_object() {
        html.push_str("<section aria-label=\"Schema snapshot detail\"><h3>Snapshot detail</h3><p>Definitions reflect retained observations; incomplete visibility leaves objects unknown.</p>");
        html.push_str(&button("close-schema-snapshot", "Close detail", ""));
        html.push_str(&facts(&p["snapshot"]));
        html.push_str(&format!("<details><summary>Snapshot identity and revisions</summary><p>Snapshot {} · Stream {} · Connection revision {} · Binding revision {} · Assignment revision {}</p><pre>{}</pre></details>",e(&p["snapshot"]["id"]),e(&p["snapshot"]["streamId"]),e(&p["snapshot"]["connectionRevision"]),e(&p["snapshot"]["bindingRevision"]),e(&p["snapshot"]["assignmentRevision"]),pretty(&p["snapshot"]["identity"])));
        html.push_str(&objects(p));
        if manage(data) {
            html.push_str(&super::super::form(
                "capture-retained-baseline",
                &(input(
                    "schema-baseline-name",
                    "Baseline name",
                    &f["baselineName"],
                    120,
                ) + &input(
                    "schema-baseline-reason",
                    "Capture reason",
                    &f["baselineReason"],
                    2000,
                )),
                "Capture immutable baseline",
            ));
        }
        html.push_str("</section>");
    }
    let expected = array(h, "baselines")
        .iter()
        .map(|b| {
            (
                s(&b["snapshotId"]).into(),
                format!("Baseline · {} · {}", s(&b["name"]), s(&b["snapshotId"])),
            )
        })
        .chain(array(h, "snapshots").iter().map(|b| {
            (
                s(&b["id"]).into(),
                format!("Snapshot · {} · {}", s(&b["observedAt"]), s(&b["id"])),
            )
        }));
    let observed = array(h, "snapshots").iter().map(|b| {
        (
            s(&b["id"]).into(),
            format!("{} · {}", s(&b["observedAt"]), s(&b["id"])),
        )
    });
    html.push_str("<section aria-label=\"Compare schema snapshots\"><h3>Compare snapshots</h3>");
    html.push_str(&super::super::form(
        "compare-retained-schema",
        &(select(
            "schema-expected",
            "Expected reference",
            &f["expected"],
            expected,
        ) + &select(
            "schema-observed",
            "Observed snapshot",
            &f["observed"],
            observed,
        )),
        "Compare",
    ));
    let c = &p["comparison"];
    if c.is_object() {
        html.push_str(&format!("<section aria-label=\"Schema comparison result\"><h4>{}</h4><p>Expected {} · {}. Observed {} · {}. Fixture comparisons do not verify live drift.</p><pre>{}</pre><h5>Comparison limitations</h5><pre>{}</pre>",e(&c["comparison"]["state"]),e(&c["expected"]["id"]),e(&c["expected"]["provenance"]),e(&c["observed"]["id"]),e(&c["observed"]["provenance"]),pretty(&c["comparison"]["summary"]),pretty(&c["comparison"]["limitations"])));
        for change in array(&c["comparison"], "changes") {
            html.push_str(&format!("<article class=\"schema-comparison-change\"><p>{} · {} · {} · {}</p><details><summary>View retained values</summary><pre>{}</pre><pre>{}</pre><pre>{}</pre></details></article>",e(&change["kind"]),e(&change["type"]),e(&change["owner"]),e(&change["name"]),pretty(&change["before"]),pretty(&change["after"]),pretty(&change["details"])));
        }
        html.push_str("</section>");
    }
    html.push_str("</section>");
    for (action, label) in [
        ("schema-to-workspace", "Open SQL Workspace for target"),
        ("schema-to-plans", "Open migration plans for target"),
        ("schema-to-history", "Open migration history for target"),
    ] {
        html.push_str(&button(action, label, ""));
    }
    html.push_str("</section>");
    html
}
