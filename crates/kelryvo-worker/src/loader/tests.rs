use super::*;
use std::{
    io::{Read, Write},
    process::Stdio,
};

#[test]
fn loader_paths_cannot_add_search_entries_or_expand_tokens() {
    for path in [
        "relative",
        "/",
        "/reviewed:other",
        "/reviewed;other",
        "/reviewed/$ORIGIN",
        "/reviewed\nother",
    ] {
        assert!(environment(Path::new(path)).is_err(), "{path:?}");
    }
    let env = environment(Path::new("/reviewed/client files")).unwrap();
    assert_eq!(
        env.get(&OsString::from("LD_LIBRARY_PATH")),
        Some(&OsString::from("/reviewed/client files"))
    );
}

#[test]
fn non_oracle_commands_need_no_installation_or_loader() {
    for args in [
        vec!["--build-info"],
        vec!["runtime-service"],
        vec!["expiry-child", "/absent"],
        vec!["installation-watch", "/absent"],
        vec!["installation-observer-scope", "/absent"],
    ] {
        let args = args.into_iter().map(String::from).collect::<Vec<_>>();
        assert!(command(&args).unwrap().is_none());
    }
}

#[test]
fn replacement_preserves_pid_stdio_and_removes_untrusted_environment() {
    // This test runs itself in a fresh process. The private constructor selects
    // an empty test-only path; no Oracle library, credential or socket is used.
    let path = std::env::current_dir()
        .unwrap()
        .join(format!(".cache/loader-probe-{}", std::process::id()));
    if std::env::var_os("KELRYVO_ORACLE_CLIENT_BOOTSTRAP").is_some() {
        ClientDirectory(path.clone()).enter().unwrap();
        assert_eq!(
            std::env::vars_os().collect::<BTreeMap<_, _>>(),
            environment(&path).unwrap()
        );
        let mut input = String::new();
        std::io::stdin().read_to_string(&mut input).unwrap();
        assert_eq!(input, "fixed invocation survives replacement");
        println!("LOADER_PID={}", std::process::id());
        return;
    }
    if std::env::var_os("KELRYVO_LOADER_PROBE").is_some() {
        ClientDirectory(path).enter().unwrap();
        panic!("The original process must be replaced");
    }
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "loader::tests::replacement_preserves_pid_stdio_and_removes_untrusted_environment",
            "--nocapture",
        ])
        .env_clear()
        .env("KELRYVO_LOADER_PROBE", "1")
        .env("DPI_DEBUG_LEVEL", "64")
        .env("KELRYVO_SECRET_DIR", "/untrusted-caller-selector")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let pid = child.id();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"fixed invocation survives replacement")
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains(&format!("LOADER_PID={pid}")));

    // A changed private selection after replacement must fail, never perform
    // another replacement or consume the invocation under a different path.
    let stale = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "loader::tests::replacement_preserves_pid_stdio_and_removes_untrusted_environment",
            "--nocapture",
        ])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C.UTF-8")
        .env("TZ", "UTC")
        .env("KELRYVO_ORACLE_CLIENT_BOOTSTRAP", "1")
        .env("LD_LIBRARY_PATH", path.join("superseded-client"))
        .output()
        .unwrap();
    assert!(!stale.status.success());
    assert!(!String::from_utf8_lossy(&stale.stdout).contains("LOADER_PID="));
}
