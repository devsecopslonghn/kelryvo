//! Create a fresh native chart candidate from exact regular Git blobs. The
//! companion source stays read-only; no publication or cluster command exists.
use crate::runner::Context;
use kelryvo_test_tools::{Result, process};
use std::{
    ffi::OsString,
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    time::Duration,
};
async fn git(directory: &Path, args: &[&str], input: Option<&[u8]>) -> Result<Vec<u8>> {
    let mut argv: Vec<OsString> = [
        "--no-optional-locks",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "core.fsmonitor=false",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    argv.extend(args.iter().map(OsString::from));
    let output = process::capture(
        "/usr/bin/git",
        &argv,
        directory,
        &process::local_environment(),
        input,
        Duration::from_secs(30),
    )
    .await?;
    if !output.success {
        return Err("Pinned chart Git inspection/candidate preparation failed".into());
    }
    Ok(output.stdout)
}
pub async fn run(context: &Context, path: &str) -> Result<()> {
    let path = PathBuf::from(path);
    if !path.is_absolute() {
        return Err("Absolute companion checkout required".into());
    }
    let path = path.canonicalize()?;
    let head = String::from_utf8(git(&path, &["rev-parse", "HEAD"], None).await?)?
        .trim()
        .to_owned();
    if !git(&path, &["status", "--porcelain"], None)
        .await?
        .is_empty()
    {
        return Err("Companion checkout must be clean for an exact candidate".into());
    }
    let patch = fs::read(context.root.join("deploy/native-oracle-helm.patch"))?;
    let source = std::str::from_utf8(&patch)?;
    let base = regex::Regex::new(r"(?m)^Base-commit: ([a-f0-9]{40})$")?
        .captures(source)
        .ok_or("Missing exact chart patch base")?[1]
        .to_owned();
    if head != base {
        return Err("Patch base must match the inspected companion revision".into());
    }
    let tree = git(&path, &["ls-tree", "-rz", "--full-tree", &head], None).await?;
    let entries: Vec<_> = tree.split(|v| *v == 0).filter(|v| !v.is_empty()).collect();
    if entries.is_empty() || entries.len() >= 512 {
        return Err("Chart tree membership must be bounded".into());
    }
    let candidate = kelryvo_test_tools::process::private_directory(
        "native-helm-checked.",
        &context.root.join(".cache"),
    )?
    .keep();
    let object_id = regex::Regex::new(r"^[a-f0-9]{40}$")?;
    for entry in entries {
        let entry = std::str::from_utf8(entry)?;
        let (metadata, name) = entry.split_once('\t').ok_or("Invalid Git tree entry")?;
        let fields: Vec<_> = metadata.split(' ').collect();
        if fields.len() != 3
            || !["100644", "100755"].contains(&fields[0])
            || fields[1] != "blob"
            || !object_id.is_match(fields[2])
            || name.starts_with('/')
            || name
                .split('/')
                .any(|part| ["", ".", "..", ".git"].contains(&part))
        {
            return Err("Chart candidate accepts only safe regular pinned Git blobs".into());
        }
        let bytes = git(&path, &["cat-file", "blob", fields[2]], None).await?;
        let mut framed = format!("blob {}\0", bytes.len()).into_bytes();
        framed.extend_from_slice(&bytes);
        let digest = openssl::sha::sha1(&framed)
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect::<String>();
        if digest != fields[2] {
            return Err("Chart source bytes differ from their exact Git blob".into());
        }
        let destination = candidate.join(name);
        fs::create_dir_all(destination.parent().ok_or("Chart path")?)?;
        kelryvo_test_tools::api::private_file(&destination, &bytes)?;
        fs::set_permissions(
            destination,
            fs::Permissions::from_mode(if fields[0] == "100755" { 0o755 } else { 0o644 }),
        )?;
    }
    git(&candidate, &["init", "--initial-branch=candidate"], None).await?;
    git(&candidate, &["apply", "--check", "-"], Some(&patch)).await?;
    git(&candidate, &["apply", "-"], Some(&patch)).await?;
    git(&candidate, &["add", "--", "."], None).await?;
    let output = process::capture(
        context.root.join("target/debug/kelryvo"),
        &[
            "chart-check".into(),
            candidate.clone().into_os_string(),
            "--native".into(),
        ],
        &context.root,
        &process::local_environment(),
        None,
        Duration::from_secs(120),
    )
    .await?;
    if !output.success {
        kelryvo_test_tools::api::private_file(
            &candidate.join(".cache-chart-failure"),
            &output.stderr,
        )?;
        return Err(format!(
            "Native chart policy failed; private candidate: {}",
            candidate.display()
        )
        .into());
    }
    if String::from_utf8(git(&path, &["rev-parse", "HEAD"], None).await?)?.trim() != head
        || !git(&path, &["status", "--porcelain"], None)
            .await?
            .is_empty()
    {
        return Err("Read-only companion source changed during native validation".into());
    }
    println!("{}", std::str::from_utf8(&output.stdout)?);
    println!(
        "PASS: exact native Helm candidate; companion source unchanged; no cluster access or Oracle qualification. Private candidate: {}",
        candidate.display()
    );
    Ok(())
}
