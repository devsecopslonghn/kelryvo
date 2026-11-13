use super::Result;
use regex::Regex;
use serde_json::{Value, json};
use std::collections::HashSet;

pub(super) fn report(source: &str, command: &str) -> Result<Value> {
    let pattern = Regex::new(r"^- \[([ x])\] \*\*([A-Z][A-Z0-9]*) — (.+?):\*\*\s*(.*)$").unwrap();
    let mut ids = HashSet::new();
    let mut entries: Vec<Value> = Vec::new();
    let mut current = None;
    for line in source.split('\n') {
        if line.starts_with("- [") {
            let found = pattern
                .captures(line)
                .ok_or("Invalid or duplicate checklist entry")?;
            if !ids.insert(found[2].to_owned()) {
                return Err("Invalid or duplicate checklist entry".into());
            }
            entries.push(json!({"id":&found[2],"completed":&found[1]=="x","title":&found[3],"detail":&found[4]}));
            current = Some(entries.len() - 1);
        } else if let Some(index) = current
            && line.starts_with("  ")
            && line.chars().nth(2).is_some_and(|c| !c.is_whitespace())
        {
            entries[index]["detail"] = format!(
                "{} {}",
                entries[index]["detail"].as_str().unwrap(),
                line.trim()
            )
            .into();
        } else {
            current = None;
        }
    }
    if entries.is_empty()
        || entries
            .iter()
            .any(|e| e["detail"].as_str().unwrap().trim().is_empty())
    {
        return Err("Checklist entries must describe their outcome".into());
    }
    if command == "validate" {
        return Ok(json!({"checklist":"CHECKLIST.md","valid":true}));
    }
    let (completed, pending): (Vec<_>, Vec<_>) =
        entries.into_iter().partition(|e| e["completed"] == true);
    let authority = "Checklist status does not authorize Oracle access, execution or deployment.";
    Ok(if command == "next" {
        json!({"checklist":"CHECKLIST.md","next":pending.first(),"authority":authority})
    } else {
        json!({"checklist":"CHECKLIST.md","completed":completed,"pending":pending,"authority":authority})
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn status_preserves_ids_continuations_and_authority_boundaries() {
        let source = "- [x] **DONE — Complete: ** invalid\n";
        assert!(report(source, "status").is_err());
        let source = "- [x] **DONE — Complete:** Completed outcome.\n\n- [ ] **RUST3 — Native parser:** Preserve exact bytes.\n  Keep independent approval.\n";
        let status = report(source, "status").unwrap();
        assert_eq!(status["completed"][0]["id"], "DONE");
        assert_eq!(
            status["pending"][0]["detail"],
            "Preserve exact bytes. Keep independent approval."
        );
        assert_eq!(
            report(source, "next").unwrap()["next"],
            status["pending"][0]
        );
        assert!(report(&format!("{source}\n{source}"), "status").is_err());
        assert!(report("- [ ] **EMPTY — Empty:** ", "status").is_err());
        assert!(report("No entries", "validate").is_err());
    }
}
