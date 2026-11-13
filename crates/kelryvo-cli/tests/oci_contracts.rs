//! Independent tiny OCI archives reproduce captured wire digests; no runnable
//! image, registry, Docker or Oracle qualification is implied.
use kelryvo_core::sha256;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    os::unix::fs::{MetadataExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};
const SOURCE: &str = "https://github.com/devsecopslonghn/kelryvo";
fn digest(bytes: &[u8]) -> String {
    format!("sha256:{}", sha256(bytes))
}
fn native(args: &[&str], success: bool) -> Value {
    let output = Command::new(env!("CARGO_BIN_EXE_kelryvo"))
        .arg("oci")
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LANG", "C")
        .env("TAR_OPTIONS", "--remove-files")
        .env("GZIP", "--invalid")
        .output()
        .unwrap();
    assert_eq!(
        output.status.success(),
        success,
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    if success {
        serde_json::from_slice(&output.stdout).unwrap()
    } else {
        Value::Null
    }
}
fn append(builder: &mut tar::Builder<fs::File>, name: &str, bytes: &[u8]) {
    let mut header = tar::Header::new_gnu();
    header.set_size(bytes.len() as u64);
    header.set_mode(0o644);
    header.set_mtime(0);
    header.set_cksum();
    builder.append_data(&mut header, name, bytes).unwrap();
}
fn fixture(root: &Path, name: &str, fault: Option<&str>, timestamp: &str) -> PathBuf {
    let directory = root.join(name);
    fs::create_dir(&directory).unwrap();
    for arch in ["amd64", "arm64"] {
        let mut blobs = BTreeMap::new();
        fn blob(blobs: &mut BTreeMap<String, Vec<u8>>, bytes: Vec<u8>) -> Value {
            let hash = digest(&bytes);
            let size = bytes.len();
            blobs.insert(hash.clone(), bytes);
            json!({"digest":hash,"size":size})
        }
        let config=blob(&mut blobs,serde_json::to_vec(&json!({"architecture":arch,"os":"linux","config":{"User":if fault==Some("role"){"10001:10001"}else{"0:0"},"Entrypoint":["/opt/kelryvo/bin/kelryvo-runtime"],"Labels":{"org.opencontainers.image.revision":if fault==Some("revision"){"b".repeat(40)}else{"a".repeat(40)},"org.opencontainers.image.source":SOURCE,"dev.kelryvo.implementation":"rust"}}})).unwrap());
        let layer = blob(
            &mut blobs,
            b"fixture layer; never a runnable image".to_vec(),
        );
        if fault == Some("corrupt") {
            blobs.insert(
                layer["digest"].as_str().unwrap().into(),
                b"corrupt fixture layer".to_vec(),
            );
        }
        let mut config_descriptor = json!({"mediaType":"application/vnd.oci.image.config.v1+json"});
        config_descriptor
            .as_object_mut()
            .unwrap()
            .extend(config.as_object().unwrap().clone());
        let mut layer_descriptor = json!({"mediaType":"application/vnd.oci.image.layer.v1.tar"});
        layer_descriptor
            .as_object_mut()
            .unwrap()
            .extend(layer.as_object().unwrap().clone());
        if fault == Some("size") {
            layer_descriptor["size"] = (layer["size"].as_u64().unwrap() + 1).into();
        }
        let manifest=blob(&mut blobs,serde_json::to_vec(&json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":config_descriptor,"layers":[layer_descriptor]})).unwrap());
        let mut descriptor = json!({"mediaType":"application/vnd.oci.image.manifest.v1+json"});
        descriptor
            .as_object_mut()
            .unwrap()
            .extend(manifest.as_object().unwrap().clone());
        if fault == Some("platform") {
            descriptor["platform"] =
                json!({"os":"linux","architecture":if arch=="amd64"{"arm64"}else{"amd64"}});
        }
        descriptor["annotations"] = json!({"org.opencontainers.image.created":timestamp});
        let index =
            serde_json::to_vec(&json!({"schemaVersion":2,"manifests":[descriptor]})).unwrap();
        let archive = directory.join(format!("app-{arch}.tar"));
        let mut builder = tar::Builder::new(fs::File::create(&archive).unwrap());
        append(
            &mut builder,
            "oci-layout",
            br#"{"imageLayoutVersion":"1.0.0"}"#,
        );
        append(&mut builder, "index.json", &index);
        for (hash, bytes) in blobs {
            append(
                &mut builder,
                &format!("blobs/sha256/{}", &hash[7..]),
                &bytes,
            );
        }
        if fault == Some("duplicate") {
            append(&mut builder, "index.json", &index);
        }
        if fault == Some("link") {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Symlink);
            header.set_size(0);
            header.set_mode(0o777);
            header.set_link_name("../outside").unwrap();
            header.set_cksum();
            builder
                .append_data(&mut header, "untrusted-link", &[][..])
                .unwrap();
        }
        builder.finish().unwrap();
        drop(builder);
        if fault == Some("hidden") {
            fs::OpenOptions::new()
                .append(true)
                .open(archive)
                .unwrap()
                .write_all(b"hidden appended content")
                .unwrap();
        }
    }
    directory
}
#[test]
fn local_oci_contracts_assembly_corruption_and_environment_boundaries() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    fs::create_dir_all(root.join(".cache")).unwrap();
    let directory = tempfile::Builder::new()
        .prefix("rust-oci-")
        .tempdir_in(root.join(".cache"))
        .unwrap();
    let captured: Value = serde_json::from_slice(&kelryvo_fixtures::bytes("oci").unwrap()).unwrap();
    let sha = "a".repeat(40);
    let fresh = fixture(directory.path(), "native", None, "one");
    for arch in ["amd64", "arm64"] {
        let archive = fresh.join(format!("app-{arch}.tar"));
        let archive = archive.to_str().unwrap();
        assert_eq!(
            native(&["verify-platform", archive, &sha, arch], true),
            captured["platforms"][arch]
        );
        let inspected = native(&["inspect", archive], true);
        assert_eq!(inspected["blobs"], 3);
        assert_eq!(inspected["qualification"], "NOT_RUN");
        assert_eq!(inspected["sourceAndRoleVerified"], false);
    }
    let expected = &captured["index"];
    assert_eq!(
        &native(&["assemble", fresh.to_str().unwrap(), &sha], true),
        expected
    );
    let output = fresh.join("kelryvo-app.tar");
    let before = fs::read(&output).unwrap();
    assert_eq!(
        &native(&["verify", output.to_str().unwrap(), &sha], true),
        expected
    );
    assert_eq!(output.metadata().unwrap().mode() & 0o777, 0o600);
    native(&["assemble", fresh.to_str().unwrap(), &sha], false);
    assert_eq!(fs::read(&output).unwrap(), before);
    let retry = fixture(
        directory.path(),
        "re-export",
        None,
        "different exporter timestamp",
    );
    assert_eq!(
        &native(&["assemble", retry.to_str().unwrap(), &sha], true),
        expected
    );
    assert_eq!(fs::read(retry.join("kelryvo-app.tar")).unwrap(), before);
    for fault in ["role", "revision", "size", "corrupt", "platform"] {
        let bad = fixture(directory.path(), fault, Some(fault), "one");
        native(
            &[
                "verify-platform",
                bad.join("app-amd64.tar").to_str().unwrap(),
                &sha,
                "amd64",
            ],
            false,
        );
        native(&["assemble", bad.to_str().unwrap(), &sha], false);
    }
    for fault in ["duplicate", "hidden", "link"] {
        let bad = fixture(directory.path(), fault, Some(fault), "one");
        native(
            &["inspect", bad.join("app-amd64.tar").to_str().unwrap()],
            false,
        );
    }
    let linked = directory.path().join("linked.tar");
    symlink(fresh.join("app-amd64.tar"), &linked).unwrap();
    native(
        &["verify-platform", linked.to_str().unwrap(), &sha, "amd64"],
        false,
    );
    native(
        &["verify", output.to_str().unwrap(), "local-unpublished"],
        false,
    );
    assert_eq!(fs::read(&output).unwrap(), before);
    if Command::new("/usr/bin/skopeo")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success())
    {
        let copied = directory.path().join("skopeo-copy");
        assert!(
            Command::new("/usr/bin/skopeo")
                .args([
                    "copy",
                    "--all",
                    "--preserve-digests",
                    &format!("oci-archive:{}", output.display()),
                    &format!("oci:{}:verified", copied.display())
                ])
                .output()
                .unwrap()
                .status
                .success()
        );
        let raw = Command::new("/usr/bin/skopeo")
            .args([
                "inspect",
                "--raw",
                &format!("oci:{}:verified", copied.display()),
            ])
            .output()
            .unwrap();
        assert!(raw.status.success());
        assert_eq!(
            digest(String::from_utf8(raw.stdout).unwrap().trim().as_bytes()),
            expected["digest"]
        );
    }
}
