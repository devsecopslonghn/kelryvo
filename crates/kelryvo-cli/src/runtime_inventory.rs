//! Inventory of the actual Debian image, separate from the application bundle.
//! Fixed dpkg query; no package installation, mutation or runtime qualification.
use crate::distribution::{bytes, json_file, put};
use kelryvo_core::sha256;
use serde_json::{Value, json};
use std::{
    collections::HashSet,
    fs,
    os::unix::fs::{DirBuilderExt, PermissionsExt},
    path::Path,
    process::{Command, ExitCode},
};
fn package(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 200
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"+.-:".contains(&b))
}
fn version(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 256
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".+:~_-".contains(&b))
}
fn segment(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
fn collect(rows: &str, documentation: &Path, output: &Path) -> Result<Value, ()> {
    let documentation = documentation.canonicalize().map_err(|_| ())?;
    let mut packages = Vec::new();
    let mut seen = HashSet::new();
    for row in rows.lines() {
        let parts = row.split('\t').collect::<Vec<_>>();
        if parts.len() != 4
            || !package(parts[0])
            || !version(parts[1])
            || !package(parts[2])
            || !version(parts[3])
            || !seen.insert(parts[0])
            || seen.len() > 4096
        {
            return Err(());
        }
        let path = documentation
            .join(parts[0].split(':').next().ok_or(())?)
            .join("copyright");
        let resolved = path.canonicalize().map_err(|_| ())?;
        if !resolved.starts_with(&documentation) {
            return Err(());
        }
        let notice = bytes(&resolved, 4 * 1024 * 1024)?;
        if notice.is_empty() {
            return Err(());
        }
        let copied = format!("notices/{}-copyright", parts[0]);
        put(output, Path::new(&copied), &notice, 0o444)?;
        packages.push(json!({"name":parts[0],"version":parts[1],"source":parts[2],"sourceVersion":parts[3],"notice":copied,"noticeSha256":sha256(&notice),
            "sourceAccess":format!("https://snapshot.debian.org/package/{}/{}/",segment(parts[2]),segment(parts[3]))}));
    }
    if packages.is_empty() {
        return Err(());
    }
    packages.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(
        json!({"format":1,"scope":"ACTUAL_DEBIAN_RUNTIME_PACKAGES","packages":packages,
        "limitations":["This records installed package versions and full copyright notices, not per-binary linkage or license compatibility approval.","Debian source access references are recorded; release-specific source availability and Oracle client licensing require separate qualification.","No Oracle client or wallet is bundled by this command."]}),
    )
}
fn run(directory: &str) -> Result<(), ()> {
    let output = Path::new(directory);
    if !output.is_absolute() || fs::symlink_metadata(output).is_ok() {
        return Err(());
    }
    let rows = Command::new("/usr/bin/dpkg-query")
        .args([
            "-W",
            "-f=${binary:Package}\t${Version}\t${source:Package}\t${source:Version}\n",
        ])
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C")
        .output()
        .map_err(|_| ())?;
    if !rows.status.success() || rows.stdout.len() > 8 * 1024 * 1024 {
        return Err(());
    }
    let rows = std::str::from_utf8(&rows.stdout).map_err(|_| ())?;
    fs::DirBuilder::new()
        .mode(0o755)
        .create(output)
        .map_err(|_| ())?;
    fs::set_permissions(output, fs::Permissions::from_mode(0o755)).map_err(|_| ())?;
    let result = collect(rows, Path::new("/usr/share/doc"), output)?;
    json_file(output, "runtime-inventory.json", &result)?;
    println!(
        "Native Debian runtime inventory created for {} packages.",
        result["packages"].as_array().ok_or(())?.len()
    );
    Ok(())
}
pub fn inventory(directory: &str) -> ExitCode {
    match run(directory) {
        Ok(()) => ExitCode::SUCCESS,
        Err(()) => {
            eprintln!(
                "Debian runtime inventory unavailable; require a fresh absolute output directory, dpkg-query and complete protected package notices."
            );
            ExitCode::FAILURE
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inventory_retains_exact_notices_versions_and_refuses_escapes_missing_or_duplicate_rows() {
        let root = std::env::temp_dir().join(format!(
            "kelryvo-os-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir(&root).unwrap();
        let docs = root.join("docs");
        fs::create_dir(&docs).unwrap();
        fs::create_dir(docs.join("fixture")).unwrap();
        fs::write(
            docs.join("fixture/copyright"),
            b"full third-party copyright and license text",
        )
        .unwrap();
        let output = root.join("output");
        fs::create_dir(&output).unwrap();
        let result = collect(
            "fixture:amd64\t1:2.3+deb12u1\tfixture-source\t1:2.3+deb12u1\n",
            &docs,
            &output,
        )
        .unwrap();
        let package = &result["packages"][0];
        assert_eq!(package["name"], "fixture:amd64");
        assert_eq!(package["version"], "1:2.3+deb12u1");
        assert!(
            package["sourceAccess"]
                .as_str()
                .unwrap()
                .contains("1%3A2.3%2Bdeb12u1")
        );
        assert_eq!(
            fs::read(output.join(package["notice"].as_str().unwrap())).unwrap(),
            b"full third-party copyright and license text"
        );
        for (i, rows) in [
            "fixture\t1\tfixture\t1\nfixture\t1\tfixture\t1\n",
            "missing\t1\tmissing\t1\n",
            "../escape\t1\tfixture\t1\n",
            "fixture\tbad version\tfixture\t1\n",
        ]
        .iter()
        .enumerate()
        {
            let p = root.join(format!("bad-{i}"));
            fs::create_dir(&p).unwrap();
            assert!(collect(rows, &docs, &p).is_err());
        }
        fs::write(root.join("outside"), b"outside root").unwrap();
        fs::remove_file(docs.join("fixture/copyright")).unwrap();
        std::os::unix::fs::symlink(root.join("outside"), docs.join("fixture/copyright")).unwrap();
        let p = root.join("escape");
        fs::create_dir(&p).unwrap();
        assert!(collect("fixture\t1\tfixture\t1\n", &docs, &p).is_err());
    }
}
