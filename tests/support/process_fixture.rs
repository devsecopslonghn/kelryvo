// Standalone std-only native child for process-boundary tests. It deliberately
// emits malformed/private/oversized reports and blocks for deadline/reap tests.
use std::{
    env, fs,
    io::{Read, Write},
    path::Path,
    time::Duration,
};
fn quoted(value: &str) -> String {
    let mut output = String::from("\"");
    for c in value.chars() {
        match c {
            '"' => output.push_str("\\\""),
            '\\' => output.push_str("\\\\"),
            '\n' => output.push_str("\\n"),
            '\r' => output.push_str("\\r"),
            '\t' => output.push_str("\\t"),
            c if c < ' ' => output.push_str(&format!("\\u{:04x}", c as u32)),
            c => output.push(c),
        }
    }
    output.push('"');
    output
}
fn pid(path: &str) {
    let temporary = format!("{path}.tmp");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .unwrap();
    write!(file, "{}", std::process::id()).unwrap();
    file.sync_all().unwrap();
    fs::rename(temporary, path).unwrap();
}
fn main() {
    let args = env::args().collect::<Vec<_>>();
    let basename = Path::new(&args[0]).file_name().unwrap().to_str().unwrap();
    let controller = basename.strip_prefix("fixed-installer-fixture-");
    let mode = controller.unwrap_or_else(|| args.get(1).map(String::as_str).unwrap_or("invalid"));
    if mode == "ignore-term" && args.last().map(String::as_str) != Some("--term-ignored") {
        // The system utility only installs a signal disposition then execs the
        // same Rust child. No shell source or interpreter runs; PID is retained.
        use std::os::unix::process::CommandExt;
        let error = std::process::Command::new("/usr/bin/env")
            .arg("--ignore-signal=TERM")
            .args(&args)
            .arg("--term-ignored")
            .exec();
        panic!("Native signal fixture exec failed: {error}");
    }
    match mode {
        "good" if controller.is_some() => {
            assert!(env::vars_os().all(|(name, _)| {
                ["PATH", "LANG", "TZ", "LC_CTYPE"]
                    .iter()
                    .any(|v| name == *v)
            }));
            let mut stdin = String::new();
            std::io::stdin().read_to_string(&mut stdin).unwrap();
            assert!(stdin.is_empty());
            let action = &args[1];
            let status = match action.as_str() {
                "installation-publish" => "PUBLISHED",
                "installation-observer" => "OBSERVER_PUBLISHED",
                _ => "PREPARED",
            };
            println!(
                "{{\"status\":{},\"installationDigest\":{},\"oracleMigrationExecution\":\"NOT_RUN\",\"pid\":{},\"action\":{},\"request\":{}}}",
                quoted(status),
                quoted(&"a".repeat(64)),
                std::process::id(),
                quoted(action),
                quoted(&args[2])
            );
        }
        "oversize" => {
            std::io::stdout()
                .write_all(&vec![
                    b'x';
                    if controller.is_some() {
                        16385
                    } else {
                        2 * 1024 * 1024 + 1
                    }
                ])
                .unwrap();
        }
        "stderr" => {
            std::io::stderr()
                .write_all(b"private-diagnostic private-data")
                .unwrap();
        }
        "invalid" => println!("{{}}"),
        "ignore-term" | "sleep" if controller.is_some() => {
            pid(&args[2]);
            std::thread::sleep(Duration::from_secs(20));
        }
        "discovery-good" => {
            let mut bytes = Vec::new();
            std::io::stdin()
                .take(65537)
                .read_to_end(&mut bytes)
                .unwrap();
            assert!(bytes.len() <= 65536);
            // Only extract the top-level canonical UUID emitted by Request's
            // serializer. This private fixture is not a general JSON parser.
            let input = std::str::from_utf8(&bytes).unwrap();
            let id = input
                .split_once("\"id\":\"")
                .unwrap()
                .1
                .split('"')
                .next()
                .unwrap();
            assert!(id.len() == 36 && id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-'));
            println!(
                "{{\"version\":1,\"id\":{},\"result\":{{\"status\":\"CONNECTED\",\"provenance\":\"FIXTURE\",\"password\":\"never-returned\"}}}}",
                quoted(id)
            );
        }
        "mismatch" => println!(
            "{{\"version\":1,\"id\":\"12345678-1234-4234-8234-123456789abc\",\"result\":{{\"status\":\"CONNECTED\"}}}}"
        ),
        "sleep" | "copy-sleep" => std::thread::sleep(Duration::from_secs(30)),
        "pid-sleep" => {
            pid(&args[2]);
            std::thread::sleep(Duration::from_secs(10));
        }
        "copy-fail" => {
            eprintln!("private-copy-secret");
            std::process::exit(1);
        }
        _ => panic!("Unknown private process fixture mode"),
    }
}
