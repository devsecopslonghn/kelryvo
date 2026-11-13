//! Reviewed bootstrap archives must agree with the declarative Docker stages.
//! BuildKit verifies each remote checksum before the vendor installer runs;
//! this Rust checker requires no Python or authored shell installer.
use serde_json::Value;
use std::{collections::BTreeSet, fs, path::Path};
type Result<T> = std::result::Result<T, String>;
fn validate(pins: &Value, docker: &str) -> Result<Vec<(String, String, String)>> {
    if pins["format"] != 1
        || pins["version"] != "1.99.1"
        || pins["wasmBindgenCli"] != "0.2.130"
        || pins["date"] != "2026-10-15"
    {
        return Err("Native build must retain the reviewed Rust/WASM bootstrap profile".into());
    }
    let mut rows = Vec::new();
    for (architecture, triple) in [
        ("amd64", "x86_64-unknown-linux-gnu"),
        ("arm64", "aarch64-unknown-linux-gnu"),
    ] {
        let platform = &pins["platforms"][architecture];
        if platform["triple"] != triple {
            return Err("Wrong toolchain architecture triple".into());
        }
        let archives = platform["archives"]
            .as_array()
            .filter(|v| v.len() == 4)
            .ok_or("Expected four reviewed native/WASM toolchain components")?;
        let stage = format!("FROM build-prerequisites AS rust-toolchain-{architecture}\n");
        let section = docker
            .split_once(&stage)
            .ok_or("Missing architecture-specific toolchain stage")?
            .1
            .split("\nFROM ")
            .next()
            .ok_or("Missing bootstrap stage body")?;
        let mut seen = BTreeSet::new();
        for archive in archives {
            let component = archive["component"].as_str().ok_or("Toolchain component")?;
            let target = archive["target"].as_str().ok_or("Toolchain target")?;
            let expected = BTreeSet::from([
                ("rustc", triple),
                ("cargo", triple),
                ("rust-std", triple),
                ("rust-std", "wasm32-unknown-unknown"),
            ]);
            if !expected.contains(&(component, target)) || !seen.insert((component, target)) {
                return Err("Missing, duplicate or unreviewed toolchain component".into());
            }
            let url = format!(
                "https://static.rust-lang.org/dist/2026-10-15/{component}-1.99.1-{target}.tar.xz"
            );
            let digest = archive["sha256"].as_str().ok_or("Toolchain checksum")?;
            if archive["url"] != url
                || digest.len() != 64
                || !digest
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("Invalid reviewed toolchain URL/checksum".into());
            }
            let instruction =
                format!("ADD --checksum=sha256:{digest} {url} /tmp/kelryvo-toolchain/");
            if section.lines().filter(|line| *line == instruction).count() != 1 {
                return Err(
                    "Docker bootstrap archive differs from its reviewed checksum/URL".into(),
                );
            }
            rows.push((architecture.to_owned(), digest.to_owned(), url));
        }
        let wasm = &platform["wasmBindgenArchive"];
        let wasm_target = if architecture == "amd64" {
            "x86_64-unknown-linux-musl"
        } else {
            "aarch64-unknown-linux-musl"
        };
        let url = format!(
            "https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.130/wasm-bindgen-0.2.130-{wasm_target}.tar.gz"
        );
        let digest = wasm["sha256"].as_str().ok_or("WASM bundler checksum")?;
        if wasm["target"] != wasm_target
            || wasm["url"] != url
            || digest.len() != 64
            || !digest
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            || section
                .lines()
                .filter(|line| {
                    *line == format!("ADD --checksum=sha256:{digest} {url} /tmp/kelryvo-toolchain/")
                })
                .count()
                != 1
        {
            return Err(
                "Native WASM bundler differs from its reviewed architecture/checksum/URL".into(),
            );
        }
        rows.push((architecture.to_owned(), digest.to_owned(), url));
        if section
            .lines()
            .filter(|line| line.starts_with("ADD "))
            .count()
            != 5
        {
            return Err("Unexpected bootstrap download".into());
        }
    }
    if !docker.contains("FROM rust-toolchain-${TARGETARCH} AS native-build")
        || docker.contains("python3")
        || docker.contains("rust-install-toolchain.sh")
    {
        return Err("Native Docker bootstrap must select its verified architecture without a test interpreter".into());
    }
    Ok(rows)
}
pub(super) fn check(root: &Path, list: Option<&str>) -> Result<()> {
    let pins: Value = serde_json::from_slice(
        &fs::read(root.join("docs/dependencies/rust-toolchain.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let docker = fs::read_to_string(root.join("Dockerfile")).map_err(|e| e.to_string())?;
    let rows = validate(&pins, &docker)?;
    let action = root.join(".github/actions/native-rust/action.yml");
    if action.is_file() {
        let action = fs::read_to_string(action).map_err(|e| e.to_string())?;
        for architecture in ["amd64", "arm64"] {
            let wasm = &pins["platforms"][architecture]["wasmBindgenArchive"];
            if !action.contains(wasm["sha256"].as_str().ok_or("WASM bundler checksum")?)
                || !action.contains(wasm["target"].as_str().ok_or("WASM bundler target")?)
            {
                return Err(
                    "Host CI WASM bundler differs from its reviewed checksum/target".into(),
                );
            }
        }
    }
    match list {
        Some(architecture @ ("amd64" | "arm64")) => {
            for (_, hash, url) in rows.into_iter().filter(|(a, _, _)| a == architecture) {
                println!("{hash}\t{url}");
            }
        }
        Some(_) => return Err("Expected amd64 or arm64 toolchain listing".into()),
        None => println!(
            "PASS: both bootstrap architectures retain the reviewed Rust/WASM components and native WASM bundler archives with exact checksums"
        ),
    }
    Ok(())
}
pub(super) fn installed(root: &Path) -> Result<()> {
    check(root, None)?;
    let output = |program: &str, args: &[&str]| -> Result<String> {
        let output = std::process::Command::new(program)
            .args(args)
            .output()
            .map_err(|_| "Pinned native toolchain is unavailable")?;
        if !output.status.success() || output.stdout.len() > 65536 {
            return Err("Pinned native toolchain probe failed".into());
        }
        String::from_utf8(output.stdout).map_err(|_| "Invalid native toolchain probe".into())
    };
    for program in ["rustc", "cargo"] {
        if output(program, &["--version"])?.split_whitespace().nth(1) != Some("1.99.1") {
            return Err("Installed compiler/Cargo differs from the reviewed version".into());
        }
    }
    if output("wasm-bindgen", &["--version"])?.trim() != "wasm-bindgen 0.2.130" {
        return Err("Installed WASM bundler differs from the reviewed version".into());
    }
    let sysroot = output("rustc", &["--print", "sysroot"])?;
    if !Path::new(sysroot.trim())
        .join("lib/rustlib/wasm32-unknown-unknown/lib")
        .is_dir()
    {
        return Err("Pinned WASM standard library is unavailable".into());
    }
    println!("PASS: installed Rust/Cargo 1.99.1, WASM standard library and wasm-bindgen 0.2.130");
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bootstrap_refuses_checksum_drift_extra_downloads_and_duplicate_components() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut pins: Value = serde_json::from_slice(
            &fs::read(root.join("docs/dependencies/rust-toolchain.json")).unwrap(),
        )
        .unwrap();
        let docker = fs::read_to_string(root.join("Dockerfile")).unwrap();
        let rows = validate(&pins, &docker).unwrap();
        assert_eq!(rows.len(), 10);
        assert!(validate(&pins, &docker.replace(&rows[0].1, &"0".repeat(64))).is_err());
        assert!(
            validate(
                &pins,
                &docker.replace(
                    "AS rust-toolchain-amd64\n",
                    "AS rust-toolchain-amd64\nADD https://unreviewed.invalid/tool /tmp/\n"
                )
            )
            .is_err()
        );
        pins["platforms"]["amd64"]["archives"][1] =
            pins["platforms"]["amd64"]["archives"][0].clone();
        assert!(validate(&pins, &docker).is_err());
    }
}
