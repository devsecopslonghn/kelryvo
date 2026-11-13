// Compile the std-only process fixture once per Rust test binary, using the
// selected native compiler. This helper never needs a test interpreter or OCI.
use std::{
    path::{Path, PathBuf},
    sync::OnceLock,
};
pub(crate) fn binary() -> &'static Path {
    static BINARY: OnceLock<PathBuf> = OnceLock::new();
    BINARY
        .get_or_init(|| {
            use std::os::unix::fs::DirBuilderExt;
            let root = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../..")
                .canonicalize()
                .unwrap();
            let directory = root.join(".cache").join(format!(
                "native-process-fixture-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(directory.parent().unwrap()).unwrap();
            std::fs::DirBuilder::new()
                .mode(0o700)
                .create(&directory)
                .unwrap();
            let binary = directory.join("process-fixture");
            let result = std::process::Command::new("rustc")
                .args(["--edition=2024", "--forbid=unsafe_code"])
                .arg(root.join("tests/support/process_fixture.rs"))
                .arg("-o")
                .arg(&binary)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "Native process fixture must compile: {}",
                String::from_utf8_lossy(&result.stderr)
            );
            binary
        })
        .as_path()
}
