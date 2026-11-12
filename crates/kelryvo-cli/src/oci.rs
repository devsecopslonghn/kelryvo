//! Local OCI integrity, source/role verification and deterministic assembly.
//! Never extracts archive paths, executes image contents or contacts a registry.
use kelryvo_core::sha256;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Component, Path, PathBuf},
    process::ExitCode,
};
const INDEX: &str = "application/vnd.oci.image.index.v1+json";
const SOURCE: &str = "https://github.com/devsecopslonghn/kelryvo";
const ARCHES: [&str; 2] = ["amd64", "arm64"];
const JSON_LIMIT: u64 = 16 * 1024 * 1024;
const BLOB_LIMIT: u64 = 32 * 1024 * 1024 * 1024;
type Result<T> = std::result::Result<T, &'static str>;
pub(super) fn is_index(s: &str) -> bool {
    [
        INDEX,
        "application/vnd.docker.distribution.manifest.list.v2+json",
    ]
    .contains(&s)
}
pub(super) fn is_manifest(s: &str) -> bool {
    [
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
    ]
    .contains(&s)
}
fn hex(s: &str, length: usize) -> bool {
    s.len() == length
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
pub(super) fn digest(s: &str) -> bool {
    s.strip_prefix("sha256:").is_some_and(|h| hex(h, 64))
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().ok_or("Invalid OCI descriptor text")
}
fn size(v: &Value) -> Result<u64> {
    v["size"]
        .as_u64()
        .filter(|n| *n <= BLOB_LIMIT)
        .ok_or("Invalid OCI descriptor size")
}
fn list(v: &Value) -> Result<&Vec<Value>> {
    v["manifests"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 2)
        .ok_or("Invalid OCI manifest list")
}
fn json(bytes: &[u8]) -> Result<Value> {
    serde_json::from_slice(bytes).map_err(|_| "Invalid OCI JSON")
}
fn encoded(v: &Value) -> Result<Vec<u8>> {
    serde_json::to_vec(v).map_err(|_| "Cannot encode OCI JSON")
}
pub(super) fn verify_config(config: &Value, source: &str, arch: &str) -> Result<()> {
    if !hex(source, 40)
        || !ARCHES.contains(&arch)
        || config["architecture"] != arch
        || config["os"] != "linux"
        || config["config"]["Labels"]["org.opencontainers.image.revision"] != source
        || config["config"]["Labels"]["org.opencontainers.image.source"] != SOURCE
        || config["config"]["User"] != "0:0"
        || config["config"]["Entrypoint"] != json!(["/opt/kelryvo/bin/kelryvo-runtime"])
    {
        return Err("OCI source, platform or process role mismatch");
    }
    Ok(())
}
/// Copy through a held descriptor before verification. Skopeo subsequently
/// reads only these private, frozen bytes, never a mutable caller path.
pub(super) fn snapshot(path: &Path, source: &str) -> Result<(tempfile::NamedTempFile, Value)> {
    let mut input = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot open publication archive")?;
    let st = input
        .metadata()
        .map_err(|_| "Cannot inspect publication archive")?;
    if !st.is_file() || st.nlink() != 1 || st.len() > 2 * BLOB_LIMIT {
        return Err("Expected a bounded regular publication archive");
    }
    let stamp = Stamp::of(&st);
    let mut out = tempfile::Builder::new()
        .prefix("kelryvo-verified-oci-")
        .tempfile()
        .map_err(|_| "Cannot create private publication snapshot")?;
    let copied = std::io::copy(
        &mut Read::by_ref(&mut input).take(2 * BLOB_LIMIT + 1),
        out.as_file_mut(),
    )
    .map_err(|_| "Cannot snapshot publication archive")?;
    if copied != stamp.len
        || Stamp::of(
            &input
                .metadata()
                .map_err(|_| "Cannot recheck publication archive")?,
        ) != stamp
    {
        return Err("Publication archive changed while snapshotting");
    }
    out.as_file()
        .sync_all()
        .map_err(|_| "Cannot sync publication snapshot")?;
    let verified = Layout::open(out.path())?.multi(source)?;
    use std::os::unix::fs::PermissionsExt;
    out.as_file()
        .set_permissions(fs::Permissions::from_mode(0o400))
        .map_err(|_| "Cannot protect publication snapshot")?;
    Ok((out, verified))
}

#[derive(Clone, Copy)]
struct Blob {
    offset: u64,
    size: u64,
}
#[derive(PartialEq)]
struct Stamp {
    dev: u64,
    ino: u64,
    len: u64,
    modified: (i64, i64),
    changed: (i64, i64),
}
impl Stamp {
    fn of(m: &fs::Metadata) -> Self {
        Self {
            dev: m.dev(),
            ino: m.ino(),
            len: m.len(),
            modified: (m.mtime(), m.mtime_nsec()),
            changed: (m.ctime(), m.ctime_nsec()),
        }
    }
}
struct Layout {
    file: File,
    stamp: Stamp,
    blobs: BTreeMap<String, Blob>,
    index: Value,
}
impl Layout {
    fn open(path: &Path) -> Result<Self> {
        let mut file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|_| "Cannot open OCI archive")?;
        let stat = file.metadata().map_err(|_| "Cannot inspect OCI archive")?;
        if !stat.is_file() || stat.nlink() != 1 || stat.len() > 2 * BLOB_LIMIT {
            return Err("Expected a bounded regular OCI archive with one link");
        }
        let stamp = Stamp::of(&stat);
        let mut blobs = BTreeMap::new();
        let mut seen = BTreeSet::new();
        let mut roots = BTreeMap::new();
        {
            let mut archive = tar::Archive::new(&mut file);
            // Raw iteration rejects extended/sparse headers before they can
            // allocate payloads or alter path/offset interpretation.
            for entry in archive
                .entries()
                .map_err(|_| "Cannot read OCI tar headers")?
                .raw(true)
            {
                let mut entry = entry.map_err(|_| "Invalid OCI tar member")?;
                let raw = entry.path_bytes();
                let name = std::str::from_utf8(&raw)
                    .map_err(|_| "Invalid OCI member name")?
                    .to_owned();
                if seen.len() >= 32768 || !seen.insert(name.clone()) {
                    return Err("Duplicate or excessive OCI members");
                }
                if entry.header().entry_type().is_dir()
                    && entry.size() == 0
                    && ["blobs/", "blobs/sha256/"].contains(&name.as_str())
                {
                    continue;
                }
                if !entry.header().entry_type().is_file()
                    || entry.link_name().map_err(|_| "Invalid OCI link")?.is_some()
                {
                    return Err("OCI layout members must be regular files");
                }
                let length = entry.size();
                let offset = entry.raw_file_position();
                if length > BLOB_LIMIT
                    || offset.checked_add(length).is_none_or(|end| end > stamp.len)
                {
                    return Err("Truncated or excessive OCI member");
                }
                if ["oci-layout", "index.json"].contains(&name.as_str()) {
                    if length > JSON_LIMIT {
                        return Err("Excessive OCI metadata");
                    }
                    let mut bytes = Vec::new();
                    entry
                        .read_to_end(&mut bytes)
                        .map_err(|_| "Truncated OCI metadata")?;
                    if bytes.len() as u64 != length {
                        return Err("Truncated OCI metadata");
                    }
                    roots.insert(name, json(&bytes)?);
                } else {
                    let hash = name
                        .strip_prefix("blobs/sha256/")
                        .filter(|s| hex(s, 64))
                        .ok_or("Unsupported OCI layout member")?;
                    let mut actual = Sha256::new();
                    let mut count = 0;
                    let mut buffer = [0; 65536];
                    loop {
                        let n = entry
                            .read(&mut buffer)
                            .map_err(|_| "Cannot read OCI blob")?;
                        if n == 0 {
                            break;
                        }
                        actual.update(&buffer[..n]);
                        count += n as u64;
                    }
                    if count != length || format!("{:x}", actual.finalize()) != hash {
                        return Err("OCI blob digest or size mismatch");
                    }
                    blobs.insert(
                        format!("sha256:{hash}"),
                        Blob {
                            offset,
                            size: length,
                        },
                    );
                }
            }
        }
        let mut padding = [0; 65536];
        loop {
            let n = file
                .read(&mut padding)
                .map_err(|_| "Cannot read OCI trailer")?;
            if n == 0 {
                break;
            }
            if padding[..n].iter().any(|b| *b != 0) {
                return Err("Unexpected content after OCI tar terminator");
            }
        }
        if roots
            .get("oci-layout")
            .is_none_or(|v| v["imageLayoutVersion"] != "1.0.0")
        {
            return Err("Expected OCI layout version 1.0.0");
        }
        let index = roots.remove("index.json").ok_or("Missing OCI root index")?;
        if index["schemaVersion"] != 2 {
            return Err("Invalid OCI root index");
        }
        let out = Self {
            file,
            stamp,
            blobs,
            index,
        };
        out.unchanged()?;
        Ok(out)
    }
    fn unchanged(&self) -> Result<()> {
        if Stamp::of(
            &self
                .file
                .metadata()
                .map_err(|_| "Cannot recheck OCI archive")?,
        ) != self.stamp
        {
            return Err("OCI input changed during verification");
        }
        Ok(())
    }
    fn blob(&self, d: &Value) -> Result<(&str, Blob)> {
        let hash = text(d, "digest")?;
        if !digest(hash) {
            return Err("Invalid OCI digest");
        }
        let (hash, blob) = self
            .blobs
            .get_key_value(hash)
            .ok_or("Missing referenced OCI blob")?;
        if size(d)? != blob.size {
            return Err("OCI descriptor size mismatch");
        }
        Ok((hash, *blob))
    }
    fn value(&mut self, d: &Value) -> Result<Value> {
        let (hash, blob) = self.blob(d)?;
        let hash = hash.to_owned();
        if blob.size > JSON_LIMIT {
            return Err("Excessive OCI JSON blob");
        }
        self.file
            .seek(SeekFrom::Start(blob.offset))
            .map_err(|_| "Cannot seek OCI blob")?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut self.file)
            .take(blob.size)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read OCI JSON blob")?;
        if bytes.len() as u64 != blob.size || format!("sha256:{}", sha256(&bytes)) != hash {
            return Err("OCI JSON blob changed");
        }
        json(&bytes)
    }
    fn platform(&mut self, d: &Value, sha: &str, arch: &str) -> Result<Platform> {
        if !ARCHES.contains(&arch) || !is_manifest(text(d, "mediaType")?) {
            return Err("Unsupported OCI platform manifest");
        }
        if let Some(p) = d.get("platform")
            && (p["os"] != "linux"
                || p["architecture"] != arch
                || p.get("variant")
                    .is_some_and(|v| !v.is_null() && v != "" && !(arch == "arm64" && v == "v8")))
        {
            return Err("OCI platform does not match its architecture");
        }
        let manifest = self.value(d)?;
        if manifest["schemaVersion"] != 2 || !is_manifest(text(&manifest, "mediaType")?) {
            return Err("Invalid OCI platform manifest");
        }
        let config = self.value(&manifest["config"])?;
        verify_config(&config, sha, arch)?;
        let layers = manifest["layers"]
            .as_array()
            .filter(|a| a.len() <= 4096)
            .ok_or("Invalid OCI layers")?;
        let mut blobs = BTreeSet::new();
        blobs.insert(text(d, "digest")?.to_owned());
        blobs.insert(text(&manifest["config"], "digest")?.to_owned());
        for layer in layers {
            let (hash, _) = self.blob(layer)?;
            blobs.insert(hash.to_owned());
        }
        self.unchanged()?;
        Ok(Platform {
            descriptor: d.clone(),
            manifest,
            config,
            blobs,
        })
    }
    fn single(&mut self, sha: &str, arch: &str) -> Result<Platform> {
        let mut index = self.index.clone();
        if !list(&index)?.iter().any(|v| v.get("platform").is_some()) {
            if list(&index)?.len() != 1 {
                return Err("Expected one OCI platform image");
            }
            let nested = self.value(&index["manifests"][0])?;
            if nested["mediaType"].as_str().is_some_and(is_index) {
                index = nested;
            }
        }
        if index["schemaVersion"] != 2 || list(&index)?.len() != 1 {
            return Err("Expected one OCI platform image");
        }
        self.platform(&index["manifests"][0], sha, arch)
    }
    fn multi(&mut self, sha: &str) -> Result<Value> {
        if list(&self.index)?.len() != 1 {
            return Err("Expected one named OCI image");
        }
        let root = self.index["manifests"][0].clone();
        if !is_index(text(&root, "mediaType")?)
            || root["annotations"]["org.opencontainers.image.ref.name"] != "kelryvo-app"
        {
            return Err("Expected one named OCI multi-platform image");
        }
        let index = self.value(&root)?;
        if index["schemaVersion"] != 2
            || !is_index(index["mediaType"].as_str().unwrap_or(INDEX))
            || list(&index)?.len() != 2
        {
            return Err("Expected exactly linux/amd64 and linux/arm64");
        }
        let mut platforms = serde_json::Map::new();
        for d in list(&index)? {
            let arch = text(&d["platform"], "architecture")?;
            if platforms.contains_key(arch) {
                return Err("Duplicate OCI platform");
            }
            let p = self.platform(d, sha, arch)?;
            platforms.insert(arch.into(), p.summary());
        }
        if !ARCHES.iter().all(|a| platforms.contains_key(*a)) {
            return Err("Missing OCI platform");
        }
        self.unchanged()?;
        Ok(json!({"image":"app","digest":root["digest"],"platforms":platforms}))
    }
}
struct Platform {
    descriptor: Value,
    manifest: Value,
    config: Value,
    blobs: BTreeSet<String>,
}
impl Platform {
    fn summary(&self) -> Value {
        json!({"digest":self.descriptor["digest"],"manifestSize":self.descriptor["size"],"configDigest":self.manifest["config"]["digest"]})
    }
    fn report(&self, arch: &str) -> Value {
        json!({"image":"app","architecture":arch,"descriptor":self.descriptor,"manifest":self.manifest,"configDigest":self.manifest["config"]["digest"],"manifestSize":self.descriptor["size"],"config":self.config})
    }
}
fn header(size: u64) -> tar::Header {
    let mut h = tar::Header::new_ustar();
    h.set_size(size);
    h.set_mode(0o644);
    h.set_uid(0);
    h.set_gid(0);
    h.set_mtime(0);
    h.set_entry_type(tar::EntryType::Regular);
    h.set_cksum();
    h
}
fn append(builder: &mut tar::Builder<&mut File>, name: &str, bytes: &[u8]) -> Result<()> {
    builder
        .append_data(&mut header(bytes.len() as u64), name, bytes)
        .map_err(|_| "Cannot write OCI archive")
}
struct Hashed<R> {
    reader: R,
    hash: Sha256,
    count: u64,
}
impl<R: Read> Read for Hashed<R> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let n = self.reader.read(buffer)?;
        self.hash.update(&buffer[..n]);
        self.count += n as u64;
        Ok(n)
    }
}
fn directory(path: &Path) -> Result<PathBuf> {
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|_| "Cannot resolve OCI directory")?
            .join(path)
    };
    let mut cursor = PathBuf::new();
    for c in path.components() {
        match c {
            Component::RootDir => cursor.push("/"),
            Component::Normal(s) => cursor.push(s),
            _ => return Err("OCI directory must use plain path components"),
        };
        let s = fs::symlink_metadata(&cursor).map_err(|_| "OCI output directory must exist")?;
        if !s.is_dir() || s.is_symlink() {
            return Err("OCI output path must contain only regular directories");
        }
    }
    Ok(path)
}
fn assemble(root: &Path, sha: &str) -> Result<Value> {
    let root = directory(root)?;
    let mut layouts = Vec::new();
    let mut descriptors = Vec::new();
    let mut selected = BTreeMap::new();
    for (i, arch) in ARCHES.iter().enumerate() {
        let mut layout = Layout::open(&root.join(format!("app-{arch}.tar")))?;
        let p = layout.single(sha, arch)?;
        for hash in p.blobs {
            selected.entry(hash).or_insert(i);
        }
        descriptors.push(json!({"mediaType":p.descriptor["mediaType"],"digest":p.descriptor["digest"],"size":p.descriptor["size"],"platform":{"os":"linux","architecture":arch}}));
        layouts.push(layout);
    }
    let index = encoded(&json!({"schemaVersion":2,"mediaType":INDEX,"manifests":descriptors}))?;
    let index_hash = format!("sha256:{}", sha256(&index));
    let wrapper = encoded(
        &json!({"schemaVersion":2,"manifests":[{"mediaType":INDEX,"digest":index_hash,"size":index.len(),"annotations":{"org.opencontainers.image.ref.name":"kelryvo-app"}}]}),
    )?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".oci-")
        .tempfile_in(&root)
        .map_err(|_| "Cannot create private OCI output")?;
    {
        let mut builder = tar::Builder::new(temporary.as_file_mut());
        append(
            &mut builder,
            "oci-layout",
            br#"{"imageLayoutVersion":"1.0.0"}"#,
        )?;
        append(&mut builder, "index.json", &wrapper)?;
        for name in ["blobs/", "blobs/sha256/"] {
            let mut h = header(0);
            h.set_entry_type(tar::EntryType::Directory);
            h.set_mode(0o755);
            h.set_cksum();
            builder
                .append_data(&mut h, name, std::io::empty())
                .map_err(|_| "Cannot write OCI blob directories")?;
        }
        append(
            &mut builder,
            &format!("blobs/sha256/{}", &index_hash[7..]),
            &index,
        )?;
        for (hash, i) in selected {
            let layout = &mut layouts[i];
            let blob = *layout.blobs.get(&hash).ok_or("Missing selected OCI blob")?;
            layout.unchanged()?;
            layout
                .file
                .seek(SeekFrom::Start(blob.offset))
                .map_err(|_| "Cannot seek selected OCI blob")?;
            let mut reader = Hashed {
                reader: Read::by_ref(&mut layout.file).take(blob.size),
                hash: Sha256::new(),
                count: 0,
            };
            builder
                .append_data(
                    &mut header(blob.size),
                    format!("blobs/sha256/{}", &hash[7..]),
                    &mut reader,
                )
                .map_err(|_| "Cannot copy selected OCI blob")?;
            if reader.count != blob.size || format!("sha256:{:x}", reader.hash.finalize()) != hash {
                return Err("Selected OCI blob changed during assembly");
            }
            layout.unchanged()?;
        }
        builder.finish().map_err(|_| "Cannot finish OCI archive")?;
    }
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| "Cannot sync OCI archive")?;
    let verified = Layout::open(temporary.path())?.multi(sha)?;
    for layout in &layouts {
        layout.unchanged()?;
    }
    temporary
        .persist_noclobber(root.join("kelryvo-app.tar"))
        .map_err(|_| "OCI output already exists or cannot be installed")?;
    File::open(&root)
        .and_then(|f| f.sync_all())
        .map_err(|_| "Cannot sync OCI output directory")?;
    Ok(verified)
}
fn run(args: &[String]) -> Result<Value> {
    if let [mode, archive] = args
        && mode == "inspect"
    {
        let layout = Layout::open(Path::new(archive))?;
        return Ok(
            json!({"imageLayoutVersion":"1.0.0","index":layout.index,"blobs":layout.blobs.len(),"archiveBytes":layout.stamp.len,"qualification":"NOT_RUN","sourceAndRoleVerified":false}),
        );
    }
    if args.len() < 3 || !hex(&args[2], 40) {
        return Err("Expected a verified 40-character source revision");
    }
    match args {
        [mode, archive, sha] if mode == "verify" => Layout::open(Path::new(archive))?.multi(sha),
        [mode, root, sha] if mode == "assemble" => assemble(Path::new(root), sha),
        [mode, archive, sha, arch]
            if mode == "verify-platform" && ARCHES.contains(&arch.as_str()) =>
        {
            Ok(Layout::open(Path::new(archive))?
                .single(sha, arch)?
                .report(arch))
        }
        _ => Err(
            "Usage: kelryvo oci inspect ARCHIVE | verify ARCHIVE SOURCE_SHA | verify-platform ARCHIVE SOURCE_SHA amd64|arm64 | assemble DIRECTORY SOURCE_SHA",
        ),
    }
}
pub fn command(args: &[String]) -> ExitCode {
    if args == ["--help"] {
        println!(
            "Usage: kelryvo oci inspect ARCHIVE\n       kelryvo oci verify ARCHIVE SOURCE_SHA\n       kelryvo oci verify-platform ARCHIVE SOURCE_SHA amd64|arm64\n       kelryvo oci assemble DIRECTORY SOURCE_SHA\n\nInspect checks archive/blob integrity only. Verify requires one named kelryvo-app index with exactly linux/amd64 and linux/arm64, matching revision, repository and process role. Assemble reads app-amd64.tar and app-arm64.tar, verifies both and exclusively creates kelryvo-app.tar without changing child digests. Existing output is never overwritten. No extraction, image execution, network access, publication or qualification is performed."
        );
        return ExitCode::SUCCESS;
    }
    match run(args) {
        Ok(value) => {
            println!("{value}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod snapshot_tests {
    use super::*;
    #[test]
    fn publication_uses_private_verified_bytes_after_the_original_path_changes() {
        let source = "a".repeat(40);
        let mut blobs = BTreeMap::new();
        let mut descriptors = Vec::new();
        for arch in ARCHES {
            let config=encoded(&json!({"architecture":arch,"os":"linux","config":{"User":"0:0","Entrypoint":["/opt/kelryvo/bin/kelryvo-runtime"],"Labels":{"org.opencontainers.image.revision":source,"org.opencontainers.image.source":SOURCE}}})).unwrap();
            let config_hash = format!("sha256:{}", sha256(&config));
            let manifest=encoded(&json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"digest":config_hash,"size":config.len()},"layers":[]})).unwrap();
            let manifest_hash = format!("sha256:{}", sha256(&manifest));
            descriptors.push(json!({"mediaType":"application/vnd.oci.image.manifest.v1+json","digest":manifest_hash,"size":manifest.len(),"platform":{"architecture":arch,"os":"linux"}}));
            blobs.insert(config_hash, config);
            blobs.insert(manifest_hash, manifest);
        }
        let index =
            encoded(&json!({"schemaVersion":2,"mediaType":INDEX,"manifests":descriptors})).unwrap();
        let index_hash = format!("sha256:{}", sha256(&index));
        let wrapper=encoded(&json!({"schemaVersion":2,"manifests":[{"mediaType":INDEX,"digest":index_hash,"size":index.len(),"annotations":{"org.opencontainers.image.ref.name":"kelryvo-app"}}]})).unwrap();
        blobs.insert(index_hash.clone(), index);
        let mut original = tempfile::NamedTempFile::new().unwrap();
        {
            let mut builder = tar::Builder::new(original.as_file_mut());
            append(
                &mut builder,
                "oci-layout",
                br#"{"imageLayoutVersion":"1.0.0"}"#,
            )
            .unwrap();
            append(&mut builder, "index.json", &wrapper).unwrap();
            for (hash, bytes) in blobs {
                append(
                    &mut builder,
                    &format!("blobs/sha256/{}", &hash[7..]),
                    &bytes,
                )
                .unwrap();
            }
            builder.finish().unwrap();
        }
        original.as_file().sync_all().unwrap();
        let (frozen, verified) = snapshot(original.path(), &source).unwrap();
        assert_eq!(verified["digest"], index_hash);
        assert_eq!(frozen.as_file().metadata().unwrap().mode() & 0o777, 0o400);
        fs::write(original.path(), b"changed after verification").unwrap();
        assert!(Layout::open(original.path()).is_err());
        assert_eq!(
            Layout::open(frozen.path()).unwrap().multi(&source).unwrap(),
            verified
        );
    }
}
