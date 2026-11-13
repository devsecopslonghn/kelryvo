//! Prepare only disposable native runtime roots. No interpreter, Docker daemon,
//! Oracle connection, installed/customer state or publication is selected.
use crate::runner::Context;
use kelryvo_test_tools::{Result, api, process};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::{OsStr, OsString},
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt, symlink},
    path::{Component, Path, PathBuf},
    time::Duration,
};
use uuid::Uuid;
fn require(valid: bool, label: &str) -> Result<()> {
    api::check(&json!(valid), &json!(true), label)
}
fn chmod(path: &Path, mode: u32) -> Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}
async fn command(
    program: impl AsRef<OsStr>,
    args: &[OsString],
    directory: &Path,
) -> Result<Vec<u8>> {
    let output = process::capture(
        program,
        args,
        directory,
        &process::local_environment(),
        None,
        Duration::from_secs(120),
    )
    .await?;
    require(output.success, "runtime preparation command")?;
    Ok(output.stdout)
}
fn hash(path: &Path) -> Result<String> {
    let metadata = fs::symlink_metadata(path)?;
    require(
        metadata.is_file() && metadata.len() <= 1024 * 1024 * 1024,
        "bounded regular runtime artifact",
    )?;
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    let opened = file.metadata()?;
    require(
        opened.is_file()
            && (opened.dev(), opened.ino(), opened.len())
                == (metadata.dev(), metadata.ino(), metadata.len()),
        "runtime artifact identity unchanged before hashing",
    )?;
    let mut sha = Sha256::new();
    let mut buffer = [0; 65536];
    let mut size = 0u64;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size += count as u64;
        require(
            size <= metadata.len(),
            "runtime artifact remains bounded while hashing",
        )?;
        sha.update(&buffer[..count]);
    }
    require(size == metadata.len(), "complete runtime artifact hash")?;
    Ok(format!("{:x}", sha.finalize()))
}
struct Tree {
    root: PathBuf,
    image: bool,
    copied: BTreeSet<PathBuf>,
}
impl Tree {
    fn directory(&self, relative: &Path, mode: u32) -> Result<PathBuf> {
        let parts: Vec<_> = relative.components().collect();
        require(
            parts.iter().all(|c| matches!(c, Component::Normal(_))),
            "runtime relative fixture directory",
        )?;
        let mut path = self.root.clone();
        for (index, part) in parts.iter().enumerate() {
            path.push(part.as_os_str());
            match fs::DirBuilder::new().mode(0o755).create(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.into()),
            }
            require(
                fs::symlink_metadata(&path)?.is_dir() && path.canonicalize()? == path,
                "runtime directory never follows a symlink",
            )?;
            chmod(
                &path,
                if index + 1 == parts.len() {
                    mode
                } else {
                    0o755
                },
            )?;
        }
        Ok(path)
    }
    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
    fn write(&self, name: &str, bytes: &[u8], mode: u32) -> Result<()> {
        let relative = Path::new(name);
        self.directory(relative.parent().ok_or("Runtime file parent")?, 0o755)?;
        let path = self.root.join(relative);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            require(
                metadata.is_file() && metadata.nlink() == 1,
                "runtime file cannot replace a link/device",
            )?;
        }
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .custom_flags(nix::libc::O_NOFOLLOW)
            .open(&path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        file.set_permissions(fs::Permissions::from_mode(mode))?;
        Ok(())
    }
    fn copy(&self, source: &Path, relative: &Path, mode: u32) -> Result<()> {
        self.directory(relative.parent().ok_or("Runtime copy parent")?, 0o755)?;
        require(
            fs::metadata(source)?.is_file(),
            "runtime copy source is a file",
        )?;
        let destination = self.root.join(relative);
        if let Ok(metadata) = fs::symlink_metadata(&destination) {
            require(
                metadata.is_file() && metadata.nlink() == 1,
                "runtime copy destination is a regular file",
            )?;
        }
        fs::copy(source, &destination)?;
        chmod(&destination, mode)
    }
    async fn executable(&mut self, source: &Path, relative: &Path) -> Result<()> {
        self.copy(source, relative, 0o555)?;
        if self.image || !self.copied.insert(source.to_path_buf()) {
            return Ok(());
        }
        let bytes = command(
            "/usr/bin/ldd",
            &[source.as_os_str().into()],
            &kelryvo_test_tools::root(),
        )
        .await?;
        let text = std::str::from_utf8(&bytes)?;
        require(
            !text.contains("not found"),
            "all native fixture shared libraries are present",
        )?;
        let pattern = regex::Regex::new(r"(?:=>\s*)?(/[^\s]+)\s+\(")?;
        for line in text.lines() {
            if let Some(found) = pattern.captures(line) {
                let path = PathBuf::from(&found[1]);
                if self.copied.insert(path.clone()) {
                    self.copy(&path, path.strip_prefix("/")?, 0o555)?;
                }
            }
        }
        Ok(())
    }
    fn copy_tree(&self, source: &Path, relative: &Path) -> Result<()> {
        self.directory(relative, 0o755)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            require(
                !kind.is_symlink(),
                "runtime source tree never follows symlinks",
            )?;
            let target = relative.join(entry.file_name());
            if kind.is_dir() {
                self.copy_tree(&entry.path(), &target)?;
            } else {
                require(kind.is_file(), "regular native web/repository source file")?;
                self.copy(&entry.path(), &target, 0o444)?;
            }
        }
        Ok(())
    }
}
async fn git(directory: &Path, args: &[&str]) -> Result<String> {
    let mut argv: Vec<OsString> = ["-c", "core.hooksPath=/dev/null"]
        .iter()
        .map(OsString::from)
        .collect();
    argv.extend(args.iter().map(OsString::from));
    Ok(
        String::from_utf8(command("/usr/bin/git", &argv, directory).await?)?
            .trim()
            .to_owned(),
    )
}
async fn repository(directory: &Path) -> Result<(PathBuf, String)> {
    let root = directory.join("customer-source");
    fs::DirBuilder::new().mode(0o700).create(&root)?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(root.join("migrations"))?;
    for (name, sql) in [
        ("V001__customer.sql", "CREATE TABLE customer(id NUMBER);\n"),
        (
            "migrations/V001__create_widget.sql",
            "CREATE TABLE widget (id NUMBER, name VARCHAR2(100 BYTE));\n",
        ),
        (
            "migrations/V002__add_description.sql",
            "ALTER TABLE widget ADD (description VARCHAR2(200));\n",
        ),
    ] {
        api::private_file(&root.join(name), sql.as_bytes())?;
    }
    git(&root, &["init", "--initial-branch=main"]).await?;
    git(&root, &["add", "--", "."]).await?;
    git(
        &root,
        &[
            "-c",
            "user.name=Native runtime fixture",
            "-c",
            "user.email=fixture@kelryvo.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "Native mounted repository fixture",
        ],
    )
    .await?;
    let head = git(&root, &["rev-parse", "HEAD"]).await?;
    Ok((root, head))
}
pub(crate) fn freeze_client(source: &Path, directory: &Path) -> Result<File> {
    require(source.is_absolute(), "absolute official client ZIP")?;
    let metadata = fs::symlink_metadata(source)?;
    require(
        metadata.is_file() && metadata.len() == 137184838,
        "regular official client ZIP source",
    )?;
    let mut input = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(source)?;
    require(
        input.metadata()?.is_file() && input.metadata()?.len() == 137184838,
        "exact official client ZIP byte count",
    )?;
    let mut output = fs::OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .open(directory.join("official-client.zip"))?;
    let mut sha = Sha256::new();
    let mut size = 0;
    let mut buffer = [0; 65536];
    loop {
        let count = input.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        size += count;
        require(size <= 137184838, "bounded official client ZIP copy")?;
        sha.update(&buffer[..count]);
        output.write_all(&buffer[..count])?;
    }
    require(
        size == 137184838
            && format!("{:x}", sha.finalize())
                == "cab59aa3b411b3b50898e456fa9aabfe48d67e25cbc1bb23303800390ce7de26",
        "reviewed official client ZIP checksum",
    )?;
    output.sync_all()?;
    output.set_permissions(fs::Permissions::from_mode(0o400))?;
    output.seek(SeekFrom::Start(0))?;
    Ok(output)
}
pub(crate) fn extract_client<R: Read + Seek>(input: R, destination: &Path) -> Result<()> {
    let mut archive = zip::ZipArchive::new(input)?;
    require(archive.len() <= 512, "bounded official client ZIP members")?;
    let mut files = BTreeMap::new();
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let member = file.name()?.into_owned();
        let parts: Vec<_> = member.split('/').collect();
        if file.is_dir() || parts.len() != 2 {
            continue;
        }
        require(
            !parts.iter().any(|v| ["", ".", ".."].contains(v)) && !member.contains('\\'),
            "safe official client ZIP member",
        )?;
        let name = parts[1].to_owned();
        require(
            file.size() <= 256 * 1024 * 1024
                && files
                    .insert(
                        name,
                        (
                            i,
                            file.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000),
                        ),
                    )
                    .is_none(),
            "bounded unique client ZIP basename",
        )?;
    }
    let mut selected = Vec::new();
    let mut total = 0u64;
    for (name, (index, link)) in &files {
        let mut index = *index;
        if *link {
            if name != "libclntsh.so" {
                continue;
            }
            let mut file = archive.by_index(index)?;
            require(file.size() <= 4096, "bounded client library alias")?;
            let mut target = String::new();
            file.read_to_string(&mut target)?;
            drop(file);
            require(
                !target.contains('/')
                    && !target.contains('\\')
                    && ![".", ".."].contains(&target.as_str()),
                "client library link stays in its archive directory",
            )?;
            let (target, link) = files
                .get(&target)
                .ok_or("Client library link target is absent")?;
            require(!*link, "client library cannot chain symlinks")?;
            index = *target;
        }
        total += archive.by_index(index)?.size();
        require(
            total <= 1024 * 1024 * 1024,
            "bounded extracted client bytes",
        )?;
        selected.push((name.clone(), index));
    }
    for (name, index) in selected {
        let mut file = archive.by_index(index)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(destination.join(name))?;
        let expected = file.size();
        let copied = std::io::copy(&mut file, &mut output)?;
        require(copied == expected, "complete client archive member and CRC")?;
        output.sync_all()?;
        output.set_permissions(fs::Permissions::from_mode(0o444))?;
    }
    require(
        destination.join("libclntsh.so").is_file(),
        "official client entrypoint materialized as a regular file",
    )
}

pub async fn run(context: &Context) -> Result<()> {
    let cli = std::env::var_os("KELRYVO_RUST_CLI")
        .map(PathBuf::from)
        .unwrap_or_else(|| context.root.join("target/debug/kelryvo"));
    let probe = std::env::var_os("KELRYVO_RUST_RUNTIME_PROBE")
        .map(PathBuf::from)
        .unwrap_or_else(|| context.root.join("target/debug/examples/runtime-probe"));
    let distribution = context
        .environment
        .get(OsStr::new("KELRYVO_RUST_DISTRIBUTION"))
        .cloned()
        .or_else(|| std::env::var_os("KELRYVO_RUST_DISTRIBUTION"))
        .map(PathBuf::from)
        .ok_or("Prepared native distribution required")?;
    require(
        cli.is_absolute() && probe.is_absolute() && distribution.is_absolute(),
        "absolute native runtime tools/distribution",
    )?;
    let verify = [
        OsString::from("verify-dist"),
        distribution.as_os_str().into(),
    ];
    command(&cli, &verify, &context.root).await?;
    let identity: Value =
        serde_json::from_slice(&fs::read(distribution.join("source-identity.json"))?)?;
    require(
        identity["implementation"] == "RUST"
            && regex::Regex::new(r"^[a-f0-9]{64}$")?
                .is_match(identity["sourceTreeDigest"].as_str().unwrap_or("")),
        "native runtime source identity",
    )?;
    let reviewed = identity["sourceSha"]
        .as_str()
        .filter(|v| v.len() == 40 && v.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(str::to_owned)
        .unwrap_or_else(|| "1".repeat(40));
    let database = context.database_url()?;
    let url = url::Url::parse(&database)?;
    require(
        database.starts_with("postgresql:///kelryvo_rust_test?host="),
        "private runtime metadata fixture",
    )?;
    let socket = PathBuf::from(
        url.query_pairs()
            .find(|(k, _)| k == "host")
            .ok_or("Runtime PostgreSQL socket")?
            .1
            .as_ref(),
    );
    require(
        socket.parent().and_then(Path::parent) == Some(context.root.join(".cache").as_path())
            && socket
                .parent()
                .and_then(Path::file_name)
                .and_then(|v| v.to_str())
                .is_some_and(|v| v.starts_with("rust-tests."))
            && fs::metadata(socket.parent().ok_or("Private socket parent")?)?.mode() & 0o777
                == 0o700,
        "protected private runtime PostgreSQL fixture directory",
    )?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(&database)
        .await?;
    let user: String = sqlx::query_scalar("SELECT current_user")
        .fetch_one(&pool)
        .await?;
    require(
        regex::Regex::new(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")?.is_match(&user),
        "private metadata role name",
    )?;
    let tables: i64 =
        sqlx::query_scalar("SELECT count(*) FROM pg_tables WHERE schemaname='public'")
            .fetch_one(&pool)
            .await?;
    require(
        tables == 0,
        "runtime smoke starts with fresh empty metadata",
    )?;
    let directory =
        process::private_directory("rust-runtime-", &context.root.join(".cache"))?.keep();
    let root = directory.join("root");
    fs::DirBuilder::new().mode(0o755).create(&root)?;
    let image = std::env::var_os("KELRYVO_RUST_IMAGE_ROOT").map(PathBuf::from);
    if let Some(image) = &image {
        require(
            image.is_absolute()
                && image.canonicalize()? == *image
                && image.parent().and_then(Path::parent)
                    == Some(context.root.join(".cache").as_path())
                && image
                    .parent()
                    .and_then(Path::file_name)
                    .and_then(|v| v.to_str())
                    .is_some_and(|v| v.starts_with("buildkit-overlay."))
                && distribution == image.join("opt/kelryvo"),
            "exact private exported native image root",
        )?;
        command(
            "/usr/bin/cp",
            &[
                "-a".into(),
                "--reflink=auto".into(),
                image.join(".").into_os_string(),
                root.as_os_str().into(),
            ],
            &context.root,
        )
        .await?;
    }
    chmod(&root, 0o755)?;
    let mut tree = Tree {
        root: root.clone(),
        image: image.is_some(),
        copied: BTreeSet::new(),
    };
    if image.is_none() {
        for name in [
            "kelryvo-runtime",
            "kelryvo-server",
            "kelryvo-worker",
            "kelryvo-operator",
        ] {
            tree.executable(
                &distribution.join("bin").join(name),
                &Path::new("opt/kelryvo/bin").join(name),
            )
            .await?;
        }
        tree.copy(
            &distribution.join("source-identity.json"),
            Path::new("opt/kelryvo/source-identity.json"),
            0o444,
        )?;
    }
    tree.executable(&probe, Path::new("opt/kelryvo/test/runtime-probe"))
        .await?;
    if image.is_none() {
        for name in ["setpriv", "test", "git"] {
            tree.executable(
                &Path::new("/usr/bin").join(name),
                &Path::new("usr/bin").join(name),
            )
            .await?;
        }
        tree.copy_tree(
            &distribution.join("dist/rust-web"),
            Path::new("opt/kelryvo/dist/rust-web"),
        )?;
    }
    for path in ["proc", "dev", "run/kelryvo/postgres"] {
        tree.directory(Path::new(path), 0o755)?;
    }
    tree.write("dev/null", &[], 0o600)?;
    tree.write("run/kelryvo/postgres/.s.PGSQL.5432", &[], 0o600)?;
    tree.directory(Path::new("tmp"), 0o1777)?;
    let secrets = tree.directory(Path::new("run/kelryvo/secrets"), 0o700)?;
    for (name, value) in [
        (
            "database-url",
            format!("postgresql://{user}@localhost/kelryvo_rust_test?host=/run/kelryvo/postgres"),
        ),
        ("developer-token", api::random_token()),
        ("approver-token", api::random_token()),
    ] {
        api::private_file(&secrets.join(name), value.as_bytes())?;
    }
    let (customer, head) = repository(&directory).await?;
    tree.copy_tree(&customer, Path::new("run/kelryvo/repositories/customer"))?;
    api::private_file(
        &secrets.join("repositories.json"),
        &serde_json::to_vec(&json!({"format":1,"paths":["/run/kelryvo/repositories/customer"]}))?,
    )?;
    api::certificate(&secrets)?;
    let projected = tree.directory(Path::new("run/kelryvo/projected-secrets"), 0o755)?;
    let generation = tree.directory(Path::new("run/kelryvo/projected-secrets/..2026"), 0o755)?;
    for entry in fs::read_dir(&secrets)? {
        let entry = entry?;
        fs::copy(entry.path(), generation.join(entry.file_name()))?;
        chmod(&generation.join(entry.file_name()), 0o600)?;
    }
    symlink("..2026", projected.join("..data"))?;
    let client = tree.directory(Path::new("opt/kelryvo/oracle/client"), 0o755)?;
    tree.directory(Path::new("opt/kelryvo/oracle/wallet"), 0o755)?;
    let zip = std::env::var_os("KELRYVO_RUST_ORACLE_CLIENT_ZIP").map(PathBuf::from);
    if let Some(zip) = &zip {
        require(
            image.is_some() && identity["architecture"] == "x86_64",
            "real client initialization requires the selected AMD64 image libraries",
        )?;
        extract_client(freeze_client(zip, &directory)?, &client)?;
        tree.write(
            "opt/kelryvo/test/real-client-fixture",
            b"23.26.4.0.0",
            0o444,
        )?;
    } else {
        tree.write(
            "opt/kelryvo/oracle/client/libclntsh.so",
            b"dummy OCI fixture; never a usable library",
            0o444,
        )?;
    }
    tree.write(
        "opt/kelryvo/oracle/wallet/cwallet.sso",
        b"dummy private wallet",
        0o444,
    )?;
    let mut source = identity.clone();
    source["sourceSha"] = json!(reviewed);
    tree.write(
        "opt/kelryvo/test/source-identity.json",
        &serde_json::to_vec(&source)?,
        0o444,
    )?;
    let mut artifacts = vec![(
        "WORKER".to_owned(),
        "/opt/kelryvo/bin/kelryvo-worker".to_owned(),
    )];
    let mut names = fs::read_dir(&client)?
        .map(|e| e.map(|v| v.file_name()))
        .collect::<std::io::Result<Vec<_>>>()?;
    names.sort();
    for name in names {
        artifacts.push((
            "OCI_LIBRARY".into(),
            format!(
                "/opt/kelryvo/oracle/client/{}",
                name.to_str().ok_or("Client artifact name")?
            ),
        ));
    }
    artifacts.extend([
        (
            "WALLET".into(),
            "/opt/kelryvo/oracle/wallet/cwallet.sso".into(),
        ),
        (
            "SOURCE_IDENTITY".into(),
            "/opt/kelryvo/test/source-identity.json".into(),
        ),
    ]);
    let artifacts:Vec<Value>=artifacts.into_iter().map(|(kind,path)|Ok(json!({"kind":kind,"sha256":hash(&tree.path(path.trim_start_matches('/')))?,"path":path}))).collect::<Result<_>>()?;
    configuration(&tree, &user, &reviewed, &artifacts, zip.is_some())?;
    let mut args: Vec<OsString> = [
        "-n",
        "/usr/bin/unshare",
        "--mount",
        "--pid",
        "--fork",
        "--net",
        "--mount-proc",
        "--kill-child=SIGKILL",
    ]
    .iter()
    .map(OsString::from)
    .collect();
    args.extend([
        std::env::current_exe()?.into_os_string(),
        "--runtime-namespace".into(),
        root.into_os_string(),
        socket.join(".s.PGSQL.5432").into_os_string(),
    ]);
    let output = process::capture(
        "/usr/bin/sudo",
        &args,
        &context.root,
        &process::local_environment(),
        None,
        Duration::from_secs(120),
    )
    .await?;
    let mut log = output.stdout;
    log.extend(output.stderr);
    api::private_file(&directory.join("namespace.log"), &log)?;
    if !output.success {
        return Err(format!(
            "Native runtime namespace failed; private log: {}",
            directory.join("namespace.log").display()
        )
        .into());
    }
    let log = std::str::from_utf8(&log)?;
    require(
        log.contains("NATIVE_RUNTIME_PASS")
            && (zip.is_none() || log.contains("NATIVE_ORACLE_CLIENT_READY_NO_DATABASE")),
        "all selected runtime namespace contracts completed",
    )?;
    require(
        git(&customer, &["rev-parse", "HEAD"]).await? == head
            && git(&customer, &["status", "--porcelain"]).await?.is_empty(),
        "customer repository remains unchanged",
    )?;
    let jobs:Value=sqlx::query_scalar("SELECT jsonb_build_object('jobs',count(*),'cancelled',count(*) FILTER(WHERE state='CANCELLED')) FROM sf_execution_jobs").fetch_one(&pool).await?;
    api::check(
        &jobs,
        &json!({"jobs":1,"cancelled":1}),
        "one retained cancelled runtime job",
    )?;
    let attempts: i64 = sqlx::query_scalar("SELECT count(*) FROM sf_execution_attempts")
        .fetch_one(&pool)
        .await?;
    require(attempts == 0, "runtime smoke has zero execution attempts")?;
    pool.close().await;
    command(&cli, &verify, &context.root).await?;
    println!(
        "PASS: native runtime PID1, root controller wait/lock, projected Secrets, private wallet/state/witness, distinct role UIDs/capabilities, socket peers, HTTPS/WASM/governance/rotation and graceful restart; one cancelled job, zero attempts and no Oracle session"
    );
    Ok(())
}
fn configuration(
    tree: &Tree,
    user: &str,
    reviewed: &str,
    artifacts: &[Value],
    real_client: bool,
) -> Result<()> {
    let expires = (chrono::Utc::now() + chrono::Duration::hours(1))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let discovery = json!({"format":2,"driverProfile":"kelryvo-oracle-rust-oci-0.6.3","readOnly":true,"disposable":true,"authorizationId":"native-namespace-fixture","expiresAt":expires,"sourceCommit":reviewed,"clientDirectory":"/opt/kelryvo/oracle/client","walletDirectory":"/opt/kelryvo/oracle/wallet","secretDirectory":"/run/kelryvo/runtime/discovery","artifacts":artifacts,"targets":[{"connection":{"id":"12345678-1234-4234-8234-123456789abc","revision":"1","engine":"oracle","host":"127.0.0.1","port":2484,"service":"FIXTURE_ONLY","transport":"TCPS","username":"FIXTURE_ONLY","credentialRef":null,"credentialMode":"LEGACY_SEPARATE"},"observerUsername":"FIXTURE_OBSERVER","secretFile":"observer-fixture","pinnedIps":["127.0.0.1"],"serverCertificateDN":"CN=fixture","expectedIdentity":null,"schemaOwners":["FIXTURE_ONLY"]}]});
    let installation = tree.directory(Path::new("run/kelryvo/installation"), 0o700)?;
    api::private_file(
        &installation.join("discovery.json"),
        &serde_json::to_vec(&discovery)?,
    )?;
    api::private_file(
        &installation.join("observer-fixture"),
        api::random_token().as_bytes(),
    )?;
    let controller = tree.directory(Path::new("run/kelryvo/operator"), 0o700)?;
    tree.directory(Path::new("var/lib/kelryvo/operator"), 0o755)?;
    let identity = json!({"engine":"oracle","dbid":"123456","dbUniqueName":"native","resetlogsChange":"1","cdb":true,"containerId":"3","containerGuid":"A".repeat(32),"containerDbid":"123457","containerName":"PDB","serviceName":"native","version":"Oracle Database 26ai Enterprise Edition"});
    let route = json!({"host":"native-controller.invalid","port":2484,"service":"native","pinnedIPs":["192.0.2.1"],"serverCertificateDN":"CN=native.invalid"});
    let mut policy_route = route.clone();
    policy_route["transport"] = json!("TCPS");
    let policy = json!({"format":1,"route":policy_route,"expectedIdentity":identity,"schemaOwners":["APP"],"protectedOwners":["SYS","SYSTEM"],"createSchemaOwners":["APP"],"tablespace":"DATA","quotaMiB":20,"expiresAt":expires,"authorizationId":"native-controller-fixture"});
    let review = format!(
        r#"{{"authorizationId":"native-controller-fixture","expiresAt":{},"identity":"uid:0"}}"#,
        serde_json::to_string(&expires)?
    );
    let template = json!({"format":1,"driverProfile":discovery["driverProfile"],"authorizationId":policy["authorizationId"],"installationDigest":"0".repeat(64),"metadataGenerationId":Uuid::new_v4(),"workerId":"native-controller-fixture","expiresAt":expires,"leaseSeconds":300,"callTimeoutMs":3000,"routeId":Uuid::new_v4(),"connectionId":Uuid::new_v4(),"connectionRevision":"1","masterUsername":"MASTER","masterCredentialRef":format!("vault://kelryvo/{}",Uuid::new_v4()),"sourceCommit":reviewed,"appImageDigest":format!("sha256:{}","2".repeat(64)),"metadataDatabase":{"host":"127.0.0.1","port":15432,"database":"kelryvo_rust_test","user":user},"identity":identity,"driverServerVersionString":"23.26.1.0.0","route":route,"principals":{"writer":"KRY_WRITER","ledgerOwner":"KRY_LEDGER","observer":"KRY_OBSERVER"},"readerSchemas":["APP"],"protectedOwners":["SYS","SYSTEM"],"targetSchemas":{"APP":{"schemaPrivileges":["ALTER TABLE","CREATE INDEX","CREATE TABLE"]}},"mutexPackageSourceDigest":"3".repeat(64),"ledgerImmutableTriggerSourceDigest":"4".repeat(64),"secretDirectory":"/run/kelryvo/operator","witnessDirectory":"/run/kelryvo/witness","clientDirectory":discovery["clientDirectory"],"walletDirectory":discovery["walletDirectory"],"artifacts":artifacts,"review":{"identity":"uid:0","authorizationId":policy["authorizationId"],"expiresAt":expires,"digest":kelryvo_core::sha256(review)}});
    if real_client {
        let mut offline = template.clone();
        offline
            .as_object_mut()
            .ok_or("Client check template")?
            .remove("installationDigest");
        offline["installationDigest"] = json!(kelryvo_core::sha256(serde_json::to_vec(
            &canonical(&offline)
        )?));
        let directory = tree.directory(
            Path::new("run/kelryvo/operator/client-check-private"),
            0o700,
        )?;
        api::private_file(
            &directory.join("installation.json"),
            &serde_json::to_vec(&offline)?,
        )?;
    }
    let settings = json!({"format":1,"stateDirectory":"/var/lib/kelryvo/operator/state","databaseUrlFile":"/run/kelryvo/operator/metadata/..data/database-url","policyFile":"/run/kelryvo/operator/input/..data/policy.json","installationTemplate":"/run/kelryvo/operator/input/..data/installation-template.json","vaultKeyFile":"/run/kelryvo/operator/input/..data/oracle-vault-private.pem"});
    for (name, bytes) in [
        ("policy.json", serde_json::to_vec(&policy)?),
        ("template.json", serde_json::to_vec(&template)?),
        (
            "database-url",
            format!("postgresql://{user}@127.0.0.1:15432/kelryvo_rust_test").into_bytes(),
        ),
        ("controller.json", serde_json::to_vec(&settings)?),
    ] {
        api::private_file(&controller.join(name), &bytes)?;
    }
    let (key, _) = api::vault_key()?;
    api::private_file(
        &controller.join("vault-key.pem"),
        &key.private_key_to_pem_pkcs8()?,
    )?;
    for (volume, names) in [
        (
            "input",
            vec![
                ("policy.json", "policy.json"),
                ("installation-template.json", "template.json"),
                ("oracle-vault-private.pem", "vault-key.pem"),
                ("controller.json", "controller.json"),
            ],
        ),
        ("metadata", vec![("database-url", "database-url")]),
    ] {
        let base = tree.directory(Path::new(&format!("run/kelryvo/operator/{volume}")), 0o755)?;
        let generation = tree.directory(
            Path::new(&format!("run/kelryvo/operator/{volume}/..2026")),
            0o755,
        )?;
        for (destination, source) in names {
            fs::copy(controller.join(source), generation.join(destination))?;
            chmod(&generation.join(destination), 0o400)?;
        }
        symlink("..2026", base.join("..data"))?;
    }
    Ok(())
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.iter().map(canonical).collect()),
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(k, v)| (k.clone(), canonical(v)))
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .collect(),
        ),
        value => value.clone(),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    #[test]
    fn offline_installation_digest_preserves_retained_recursive_key_ordering() {
        assert_eq!(
            canonical(&json!({"z":{"z":3,"a":2},"a":1})).to_string(),
            r#"{"a":1,"z":{"a":2,"z":3}}"#
        );
    }
    fn archive(target: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        zip.start_file("instantclient/libclntsh.so.23.1", options)
            .unwrap();
        zip.write_all(b"opaque official-library fixture").unwrap();
        zip.add_symlink("instantclient/libclntsh.so", target, options)
            .unwrap();
        zip.add_symlink("instantclient/ignored-link", "libclntsh.so.23.1", options)
            .unwrap();
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn client_zip_materializes_only_the_declared_library_alias_and_refuses_escape() {
        let root =
            process::private_directory("runtime-zip-", &kelryvo_test_tools::root().join(".cache"))
                .unwrap();
        extract_client(Cursor::new(archive("libclntsh.so.23.1")), root.path()).unwrap();
        assert_eq!(
            fs::read(root.path().join("libclntsh.so")).unwrap(),
            b"opaque official-library fixture"
        );
        assert!(
            !fs::symlink_metadata(root.path().join("libclntsh.so"))
                .unwrap()
                .is_symlink()
        );
        assert!(!root.path().join("ignored-link").exists());
        let bad =
            process::private_directory("runtime-zip-", &kelryvo_test_tools::root().join(".cache"))
                .unwrap();
        assert!(extract_client(Cursor::new(archive("../outside")), bad.path()).is_err());
        assert_eq!(fs::read_dir(bad.path()).unwrap().count(), 0);
    }
}
