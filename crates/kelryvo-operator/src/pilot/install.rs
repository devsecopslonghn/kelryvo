use super::*;
use openssl::{
    asn1::Asn1Time,
    bn::{BigNum, MsbOption},
    hash::MessageDigest,
    pkey::{PKey, Private},
    rsa::Rsa,
    x509::{
        X509, X509NameBuilder,
        extension::{BasicConstraints, ExtendedKeyUsage, KeyUsage, SubjectAlternativeName},
    },
};
use rand::RngCore;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt, chown, lchown},
};

fn token() -> Zeroizing<String> {
    let mut bytes = Zeroizing::new([0; 32]);
    rand::rngs::OsRng.fill_bytes(bytes.as_mut());
    Zeroizing::new(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn hex(bytes: &[u8]) -> bool {
    bytes.len() == 64
        && bytes
            .iter()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
}
fn mkdir(path: &Path, mode: u32, gid: u32) -> Result<()> {
    fs::DirBuilder::new()
        .mode(mode)
        .create(path)
        .map_err(|_| fail())?;
    chown(path, Some(0), Some(gid)).map_err(|_| fail())?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).map_err(|_| fail())
}
fn write(path: &Path, bytes: &[u8], mode: u32, gid: u32) -> Result<()> {
    files::path(path)?;
    let mut f = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(mode)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| fail())?;
    nix::unistd::fchown(
        &f,
        Some(nix::unistd::Uid::from_raw(0)),
        Some(nix::unistd::Gid::from_raw(gid)),
    )
    .map_err(|_| fail())?;
    f.set_permissions(fs::Permissions::from_mode(mode))
        .map_err(|_| fail())?;
    f.write_all(bytes).map_err(|_| fail())?;
    f.sync_all().map_err(|_| fail())?;
    files::sync(path.parent().ok_or_else(fail)?)
}
fn read_file(path: &Path, limit: u64) -> Result<(File, Zeroizing<Vec<u8>>)> {
    if !path.is_absolute() {
        return Err(fail());
    }
    let mut cursor = PathBuf::new();
    for part in path.components() {
        if matches!(part, std::path::Component::ParentDir) {
            return Err(fail());
        }
        cursor.push(part);
        if fs::symlink_metadata(&cursor)
            .map_err(|_| fail())?
            .is_symlink()
        {
            return Err(fail());
        }
    }
    let f = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| fail())?;
    let s = f.metadata().map_err(|_| fail())?;
    if !s.is_file() || s.nlink() != 1 || s.len() == 0 || s.len() > limit {
        return Err(fail());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    (&f).take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| fail())?;
    if bytes.len() as u64 > limit {
        return Err(fail());
    }
    Ok((f, bytes))
}
fn read(path: &Path, limit: u64, mode: u32, gid: u32) -> Result<Zeroizing<Vec<u8>>> {
    files::path(path)?;
    let (f, bytes) = read_file(path, limit)?;
    let s = f.metadata().map_err(|_| fail())?;
    if s.uid() != 0 || s.gid() != gid || s.mode() & 0o777 != mode {
        return Err(fail());
    }
    Ok(bytes)
}
fn sql(password: &str) -> Zeroizing<String> {
    Zeroizing::new(format!(
        "CREATE ROLE kelryvo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '{password}';\nALTER DATABASE kelryvo OWNER TO kelryvo;\nALTER SCHEMA public OWNER TO kelryvo;\nREVOKE ALL ON DATABASE kelryvo FROM PUBLIC;\nREVOKE CREATE ON SCHEMA public FROM PUBLIC;\n"
    ))
}
const LEGACY_INIT: &str = r##"#!/bin/bash
set -euo pipefail
app_password=$(cat /run/kelryvo/postgresql/app-password)
[[ "$app_password" =~ ^[a-f0-9]{64}$ ]] || exit 1
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE kelryvo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$app_password';
ALTER DATABASE kelryvo OWNER TO kelryvo;
ALTER SCHEMA public OWNER TO kelryvo;
REVOKE ALL ON DATABASE kelryvo FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
unset app_password
"##;
fn tls(cert: &[u8], key: &[u8]) -> Result<()> {
    let cert = X509::from_pem(cert).map_err(|_| fail())?;
    let key = PKey::private_key_from_pem(key).map_err(|_| fail())?;
    if !cert.public_key().map_err(|_| fail())?.public_eq(&key) {
        return Err(fail());
    }
    Ok(())
}
fn certificate() -> Result<(Vec<u8>, Zeroizing<Vec<u8>>)> {
    let key = PKey::from_rsa(Rsa::generate(2048).map_err(|_| fail())?).map_err(|_| fail())?;
    let mut name = X509NameBuilder::new().map_err(|_| fail())?;
    name.append_entry_by_text("CN", "localhost")
        .map_err(|_| fail())?;
    let name = name.build();
    let mut cert = X509::builder().map_err(|_| fail())?;
    cert.set_version(2).map_err(|_| fail())?;
    let mut serial = BigNum::new().map_err(|_| fail())?;
    serial
        .rand(128, MsbOption::MAYBE_ZERO, false)
        .map_err(|_| fail())?;
    let serial = serial.to_asn1_integer().map_err(|_| fail())?;
    cert.set_serial_number(&serial).map_err(|_| fail())?;
    cert.set_subject_name(&name).map_err(|_| fail())?;
    cert.set_issuer_name(&name).map_err(|_| fail())?;
    cert.set_pubkey(&key).map_err(|_| fail())?;
    let before = Asn1Time::days_from_now(0).map_err(|_| fail())?;
    let after = Asn1Time::days_from_now(90).map_err(|_| fail())?;
    cert.set_not_before(&before).map_err(|_| fail())?;
    cert.set_not_after(&after).map_err(|_| fail())?;
    cert.append_extension(
        BasicConstraints::new()
            .critical()
            .ca()
            .build()
            .map_err(|_| fail())?,
    )
    .map_err(|_| fail())?;
    cert.append_extension(
        KeyUsage::new()
            .digital_signature()
            .key_encipherment()
            .key_cert_sign()
            .build()
            .map_err(|_| fail())?,
    )
    .map_err(|_| fail())?;
    cert.append_extension(
        ExtendedKeyUsage::new()
            .server_auth()
            .build()
            .map_err(|_| fail())?,
    )
    .map_err(|_| fail())?;
    let alt = SubjectAlternativeName::new()
        .dns("localhost")
        .ip("127.0.0.1")
        .build(&cert.x509v3_context(None, None))
        .map_err(|_| fail())?;
    cert.append_extension(alt).map_err(|_| fail())?;
    cert.sign(&key, MessageDigest::sha256())
        .map_err(|_| fail())?;
    Ok((
        cert.build().to_pem().map_err(|_| fail())?,
        Zeroizing::new(key.private_key_to_pem_pkcs8().map_err(|_| fail())?),
    ))
}
fn repository_modes(path: &Path, count: &mut usize, depth: usize) -> Result<()> {
    *count += 1;
    if *count > 200000 || depth > 128 {
        return Err(fail());
    }
    let s = fs::symlink_metadata(path).map_err(|_| fail())?;
    lchown(path, Some(10001), Some(10001)).map_err(|_| fail())?;
    if s.is_symlink() {
        return Ok(());
    }
    if s.is_dir() {
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).map_err(|_| fail())?;
        for entry in fs::read_dir(path).map_err(|_| fail())? {
            repository_modes(&entry.map_err(|_| fail())?.path(), count, depth + 1)?;
        }
    } else if s.is_file() {
        fs::set_permissions(path, fs::Permissions::from_mode(0o644)).map_err(|_| fail())?;
    } else {
        return Err(fail());
    }
    Ok(())
}
pub(super) async fn prepare(o: &Options) -> Result<()> {
    files::path(&o.directory)?;
    let parent = o.directory.parent().ok_or_else(fail)?;
    if fs::canonicalize(parent).map_err(|_| fail())? != parent
        || o.directory.try_exists().map_err(|_| fail())?
    {
        return Err(fail());
    }
    let repository = if let Some(p) = &o.repository {
        Some(crate::local::repository(p.to_str().ok_or_else(fail)?).await?)
    } else {
        None
    };
    let (cert, key) = if let (Some(cert), Some(key)) = (&o.cert, &o.key) {
        let cert = fs::canonicalize(cert).map_err(|_| fail())?;
        let key = fs::canonicalize(key).map_err(|_| fail())?;
        let (_, cert) = read_file(&cert, 131072)?;
        let (_, key) = read_file(&key, 131072)?;
        tls(&cert, &key)?;
        (cert.to_vec(), key)
    } else {
        certificate()?
    };
    // All input validation precedes the exclusive installation directory create.
    mkdir(&o.directory, 0o700, 0)?;
    for (name, mode, gid) in [
        ("secrets", 0o700, 0),
        ("vault", 0o700, 0),
        ("postgresql", 0o750, 999),
        ("init", 0o755, 0),
        ("repositories", 0o755, 0),
    ] {
        mkdir(&o.directory.join(name), mode, gid)?;
    }
    let app = token();
    let admin = token();
    for (name, value) in [
        ("admin-password", admin.as_bytes()),
        ("app-password", app.as_bytes()),
    ] {
        write(
            &o.directory.join("postgresql").join(name),
            value,
            0o440,
            999,
        )?;
    }
    let url = Zeroizing::new(format!(
        "postgres://kelryvo:{}@postgresql:5432/kelryvo",
        app.as_str()
    ));
    for (name, value) in [
        ("database-url", url.as_bytes()),
        ("developer-token", token().as_bytes()),
        ("approver-token", token().as_bytes()),
    ] {
        write(&o.directory.join("secrets").join(name), value, 0o400, 0)?;
    }
    write(
        &o.directory.join("init/10-app.sql"),
        sql(&app).as_bytes(),
        0o440,
        999,
    )?;
    write(&o.directory.join("secrets/tls.crt"), &cert, 0o400, 0)?;
    write(&o.directory.join("secrets/tls.key"), &key, 0o400, 0)?;
    if let Some(repository) = repository {
        let mut c = Command::new("/usr/bin/git");
        c.env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("LANG", "C.UTF-8")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_NO_REPLACE_OBJECTS", "1")
            .args([
                "-c",
                "core.hooksPath=/dev/null",
                "-c",
                "core.fsmonitor=false",
                "clone",
                "--no-local",
                "--",
            ])
            .arg(&repository)
            .arg(o.directory.join("repositories/customer"));
        run_command(c, None).await?;
        repository_modes(&o.directory.join("repositories/customer"), &mut 0, 0)?;
        write(
            &o.directory.join("secrets/repositories.json"),
            b"{\"format\":1,\"paths\":[\"/run/kelryvo/repositories/customer\"]}\n",
            0o400,
            0,
        )?;
    }
    let vault: PKey<Private> =
        PKey::from_rsa(Rsa::generate(3072).map_err(|_| fail())?).map_err(|_| fail())?;
    let private = Zeroizing::new(vault.private_key_to_pem_pkcs8().map_err(|_| fail())?);
    write(
        &o.directory.join("vault/oracle-vault-private.pem"),
        &private,
        0o400,
        0,
    )?;
    write(
        &o.directory.join("secrets/oracle-vault-public.pem"),
        &vault.public_key_to_pem().map_err(|_| fail())?,
        0o400,
        0,
    )?;
    write(
        &o.directory.join("compose.yaml"),
        compose().as_bytes(),
        0o600,
        0,
    )?;
    write(
        &o.directory.join("pilot.env"),
        format!(
            "KELRYVO_HOME={}\nKELRYVO_IMAGE={}\nKELRYVO_HOST_PORT={}\n",
            o.directory.display(),
            o.image.as_deref().ok_or_else(fail)?,
            o.port
        )
        .as_bytes(),
        0o600,
        0,
    )?;
    files::sync(&o.directory)?;
    files::sync(parent)?;
    verify(&o.directory)?;
    Ok(())
}
pub(super) fn verify(directory: &Path) -> Result<Value> {
    files::directory(directory)?;
    let template = read(&directory.join("compose.yaml"), 65536, 0o600, 0)?;
    if template.as_slice() != COMPOSE.as_bytes()
        && template.as_slice() != include_bytes!("legacy-compose.yaml")
    {
        return Err(fail());
    }
    let env = read(&directory.join("pilot.env"), 8192, 0o600, 0)?;
    let env = std::str::from_utf8(&env).map_err(|_| fail())?;
    let lines = env.lines().collect::<Vec<_>>();
    if lines.len() != 3 || lines[0] != format!("KELRYVO_HOME={}", directory.display()) {
        return Err(fail());
    }
    let image_name = lines[1]
        .strip_prefix("KELRYVO_IMAGE=")
        .filter(|s| image(s))
        .ok_or_else(fail)?;
    let port: u16 = lines[2]
        .strip_prefix("KELRYVO_HOST_PORT=")
        .ok_or_else(fail)?
        .parse()
        .map_err(|_| fail())?;
    if port < 1024 {
        return Err(fail());
    }
    for (name, mode, gid) in [
        ("secrets", 0o700, 0),
        ("vault", 0o700, 0),
        ("postgresql", 0o750, 999),
        ("init", 0o755, 0),
        ("repositories", 0o755, 0),
    ] {
        let p = directory.join(name);
        files::path(&p)?;
        let s = fs::symlink_metadata(p).map_err(|_| fail())?;
        if !s.is_dir() || s.uid() != 0 || s.gid() != gid || s.mode() & 0o777 != mode {
            return Err(fail());
        }
    }
    let admin = read(&directory.join("postgresql/admin-password"), 64, 0o440, 999)?;
    let app = read(&directory.join("postgresql/app-password"), 64, 0o440, 999)?;
    if !hex(&admin) || !hex(&app) || admin.as_slice() == app.as_slice() {
        return Err(fail());
    }
    let url = read(&directory.join("secrets/database-url"), 16384, 0o400, 0)?;
    let expected = Zeroizing::new(format!(
        "postgres://kelryvo:{}@postgresql:5432/kelryvo",
        std::str::from_utf8(&app).map_err(|_| fail())?
    ));
    if url.as_slice() != expected.as_bytes() {
        return Err(fail());
    }
    let developer = read(&directory.join("secrets/developer-token"), 64, 0o400, 0)?;
    let approver = read(&directory.join("secrets/approver-token"), 64, 0o400, 0)?;
    if !hex(&developer) || !hex(&approver) || developer.as_slice() == approver.as_slice() {
        return Err(fail());
    }
    let sql_path = directory.join("init/10-app.sql");
    let mut init_files = fs::read_dir(directory.join("init"))
        .map_err(|_| fail())?
        .map(|e| e.map(|e| e.file_name()))
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| fail())?;
    init_files.sort();
    if init_files.len() != 1
        || !["10-app.sql", "10-app.sh"]
            .iter()
            .any(|name| init_files[0] == *name)
    {
        return Err(fail());
    }
    if sql_path.try_exists().map_err(|_| fail())? {
        if read(&sql_path, 4096, 0o440, 999)?.as_slice()
            != sql(std::str::from_utf8(&app).map_err(|_| fail())?).as_bytes()
        {
            return Err(fail());
        }
        if directory
            .join("init/10-app.sh")
            .try_exists()
            .map_err(|_| fail())?
        {
            return Err(fail());
        }
    } else if read(&directory.join("init/10-app.sh"), 4096, 0o555, 0)?.as_slice()
        != LEGACY_INIT.as_bytes()
    {
        return Err(fail());
    }
    tls(
        &read(&directory.join("secrets/tls.crt"), 131072, 0o400, 0)?,
        &read(&directory.join("secrets/tls.key"), 131072, 0o400, 0)?,
    )?;
    let public = read(
        &directory.join("secrets/oracle-vault-public.pem"),
        16384,
        0o400,
        0,
    )?;
    kelryvo_vault_key(&public)?;
    let private = read(
        &directory.join("vault/oracle-vault-private.pem"),
        16384,
        0o400,
        0,
    )?;
    let private_key = PKey::private_key_from_pem(&private).map_err(|_| fail())?;
    if !PKey::public_key_from_pem(&public)
        .map_err(|_| fail())?
        .public_eq(&private_key)
    {
        return Err(fail());
    }
    let repositories = directory.join("secrets/repositories.json");
    files::path(&repositories)?;
    if repositories.try_exists().map_err(|_| fail())? {
        let manifest: Value =
            serde_json::from_slice(&read(&repositories, 65536, 0o400, 0)?).map_err(|_| fail())?;
        if manifest != json!({"format":1,"paths":["/run/kelryvo/repositories/customer"]}) {
            return Err(fail());
        }
        let s =
            fs::symlink_metadata(directory.join("repositories/customer")).map_err(|_| fail())?;
        if !s.is_dir() || s.uid() != 10001 || s.gid() != 10001 || s.mode() & 0o777 != 0o755 {
            return Err(fail());
        }
    }
    Ok(
        json!({"status":"VERIFIED_CONFIGURATION","directory":directory,"image":image_name,"port":port,"servicesStarted":false,"imageQualified":false,"oracleQualified":false}),
    )
}
fn kelryvo_vault_key(bytes: &[u8]) -> Result<()> {
    kelryvo_vault::VaultPublicKey::parse(bytes).map_err(|_| fail())?;
    Ok(())
}
