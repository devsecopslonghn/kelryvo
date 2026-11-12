//! Stage root-owned projected inputs for a root-only CLI fixture. Production
//! secret ownership checks stay unchanged; no caller-owned file is trusted.
use serde_json::Value;
use std::{
    io::Write,
    path::Path,
    process::{Command, Output, Stdio},
};
pub fn invoke(binary: &str, root: &Path, args: &[&str], input: Option<Value>) -> Output {
    let staged = root.join("root-secrets");
    let result = Command::new("sudo")
        .args([
            "-n",
            "/usr/bin/install",
            "-d",
            "-o",
            "0",
            "-g",
            "0",
            "-m",
            "0700",
            staged.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(result.status.success(), "private root fixture staging");
    for name in ["database-url", "developer-token", "approver-token"] {
        let source = root.join(name);
        if !source.exists() {
            continue;
        }
        let result = Command::new("sudo")
            .args([
                "-n",
                "/usr/bin/install",
                "-o",
                "0",
                "-g",
                "0",
                "-m",
                "0600",
                source.to_str().unwrap(),
                staged.join(name).to_str().unwrap(),
            ])
            .output()
            .unwrap();
        assert!(result.status.success(), "root-owned fixture input");
    }
    let mut child = Command::new("sudo")
        .args([
            "-n",
            "/usr/bin/env",
            "-i",
            "PATH=/usr/bin:/bin",
            &format!("KELRYVO_SECRET_DIR={}", staged.display()),
            binary,
        ])
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(input) = input {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.to_string().as_bytes())
            .unwrap();
    } else {
        drop(child.stdin.take());
    }
    child.wait_with_output().unwrap()
}
