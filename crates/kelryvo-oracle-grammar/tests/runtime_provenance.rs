//! The prepared runtime must retain the exact published source and license.
#[path = "../../../tools/dependency_source.rs"]
mod dependency_source;
use flate2::read::GzDecoder;
use kelryvo_core::sha256;
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    path::{Path, PathBuf},
};

fn inventory(root: &Path, relative: &Path, files: &mut BTreeSet<PathBuf>) {
    for entry in fs::read_dir(root.join(relative)).unwrap() {
        let entry = entry.unwrap();
        let path = relative.join(entry.file_name());
        let kind = entry.file_type().unwrap();
        assert!(!kind.is_symlink(), "vendored source symlink");
        if kind.is_dir() {
            inventory(root, &path, files);
        } else {
            files.insert(path);
        }
    }
}

#[test]
fn runtime_repair_preserves_all_upstream_bytes_outside_context_merge() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    dependency_source::verify(&root, |bytes| kelryvo_core::sha256(bytes)).unwrap();
    let archive = fs::read(root.join(".deps/antlr-rust-runtime-0.34.0.crate")).unwrap();
    assert_eq!(
        sha256(&archive),
        "11b6fb4f9634cc5620c38a6951c0898d5bbbd03f43e384e64292570dafa48182"
    );
    let vendor = root.join(".deps/antlr-rust-runtime");
    let mut expected = BTreeSet::new();
    for entry in tar::Archive::new(GzDecoder::new(archive.as_slice()))
        .entries()
        .unwrap()
    {
        let mut entry = entry.unwrap();
        assert!(entry.header().entry_type().is_file());
        let path = entry
            .path()
            .unwrap()
            .strip_prefix("antlr-rust-runtime-0.34.0")
            .unwrap()
            .to_path_buf();
        let mut original = Vec::new();
        entry.read_to_end(&mut original).unwrap();
        let patched = fs::read(vendor.join(&path)).unwrap();
        if path == Path::new("src/prediction.rs") {
            let original = std::str::from_utf8(&original).unwrap();
            let patched = std::str::from_utf8(&patched).unwrap();
            let start = "    pub(crate) fn merge(\n";
            let end = "    fn merge_uncached(\n";
            assert_eq!(
                original.split_once(start).unwrap().0,
                patched.split_once(start).unwrap().0
            );
            assert_eq!(
                original.split_once(end).unwrap().1,
                patched.split_once(end).unwrap().1
            );
            assert_eq!(
                sha256(patched),
                "73436aa50e50eef9e7838592ff0de38d6ec189663c3e4787689a5d5b08e67e24"
            );
        } else {
            assert_eq!(
                original,
                patched,
                "upstream bytes changed: {}",
                path.display()
            );
        }
        assert!(expected.insert(path));
    }
    let mut actual = BTreeSet::new();
    inventory(&vendor, Path::new(""), &mut actual);
    assert_eq!(actual, expected, "unexpected or missing vendored files");
}
