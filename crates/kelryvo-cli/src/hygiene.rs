//! Repository hygiene shared by source tools and chart validation.
use std::{
    ffi::OsStr,
    io::Write,
    path::Path,
    process::{Command, Stdio},
};
type Result<T> = std::result::Result<T, String>;
const OUTPUTS: &[&str] = &[
    ".cache",
    "node_modules",
    "coverage",
    "dist",
    "target",
    "evidence",
    "reports",
    "screenshots",
    "test-results",
    "playwright-report",
    "blob-report",
    "__pycache__",
];
const IGNORE_PROBES: &[&str] = &[
    ".cache/reports/result.json",
    "coverage/lcov.info",
    "reports/result.json",
    "screenshots/browser.png",
    "test-results/result.xml",
    "playwright-report/index.html",
    "blob-report/result.zip",
    "evidence/run/result.json",
    "checks.log",
];

pub(crate) fn git(root: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>> {
    let mut child = Command::new("/usr/bin/git")
        .arg("-C")
        .arg(root)
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    if let Some(input) = input {
        child
            .stdin
            .take()
            .ok_or("Missing Git input")?
            .write_all(input)
            .map_err(|e| e.to_string())?;
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success()
        && !(args.first() == Some(&"check-ignore") && output.status.code() == Some(1))
    {
        return Err("Repository hygiene requires a readable Git checkout".into());
    }
    Ok(output.stdout)
}

pub(crate) fn check(root: &Path) -> Result<()> {
    let output = git(
        root,
        &[
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
        ],
        None,
    )?;
    let mut errors = Vec::new();
    for bytes in output.split(|b| *b == 0).filter(|p| !p.is_empty()) {
        let name = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
        if !root.join(name).exists() {
            continue;
        }
        let parts: Vec<_> = name.split('/').collect();
        let path = Path::new(name);
        let base = parts.last().unwrap();
        let extension = path.extension().and_then(OsStr::to_str).unwrap_or("");
        if parts[..parts.len() - 1].iter().any(|p| OUTPUTS.contains(p))
            || [".coverage", "coverage.xml", "junit.xml", "lcov.info"].contains(base)
            || ["log", "lcov", "pyc"].contains(&extension)
        {
            errors.push(format!("Generated output must stay outside Git: {name:?}"));
        }
    }

    let checklist = root.join("CHECKLIST.md").is_file();
    let chart = root.join("Chart.yaml").is_file();
    if checklist && chart {
        errors.push("Helm must link to the app checklist instead of duplicating it".into());
    }
    if !checklist && !chart {
        errors.push("Application checkout must contain CHECKLIST.md".into());
    }
    let input = IGNORE_PROBES.join("\0") + "\0";
    let ignored = git(
        root,
        &["check-ignore", "--no-index", "--stdin", "-z"],
        Some(input.as_bytes()),
    )?;
    for probe in IGNORE_PROBES {
        if !ignored.split(|b| *b == 0).any(|p| p == probe.as_bytes()) {
            errors.push(format!("Missing generated-output ignore rule: {probe}"));
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("\n"));
    }
    println!("PASS: generated outputs ignored and absent from Git");
    Ok(())
}
