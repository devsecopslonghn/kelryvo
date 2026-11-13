use super::{Result, unavailable};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Component, Path},
};

pub fn uid() -> Result<u32> {
    Ok(fs::metadata("/proc/self").map_err(|_| unavailable())?.uid())
}
pub fn path(path: &Path) -> Result<()> {
    if !path.is_absolute()
        || path.as_os_str().len() > 4096
        || path.components().any(|c| matches!(c, Component::ParentDir))
    {
        return Err(unavailable());
    }
    let mut cursor = std::path::PathBuf::new();
    for part in path.components() {
        cursor.push(part);
        match fs::symlink_metadata(&cursor) {
            Ok(s) if s.is_symlink() => return Err(unavailable()),
            Ok(s) if s.is_dir() => {
                let sticky_root = s.uid() == 0 && s.mode() & 0o1000 != 0;
                if ![0, uid()?].contains(&s.uid()) || s.mode() & 0o022 != 0 && !sticky_root {
                    return Err(unavailable());
                }
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(unavailable()),
        }
    }
    Ok(())
}
pub fn directory(path: &Path) -> Result<()> {
    self::path(path)?;
    let st = fs::symlink_metadata(path).map_err(|_| unavailable())?;
    if !st.is_dir() || st.uid() != uid()? || st.mode() & 0o777 != 0o700 {
        return Err(unavailable());
    }
    Ok(())
}
pub fn fresh_directory(path: &Path) -> Result<()> {
    self::path(path)?;
    directory(path.parent().ok_or_else(unavailable)?)?;
    fs::DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|_| unavailable())?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|_| unavailable())?;
    directory(path)
}
pub fn open(path: &Path, limit: u64) -> Result<File> {
    self::path(path)?;
    directory(path.parent().ok_or_else(unavailable)?)?;
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| unavailable())?;
    let s = file.metadata().map_err(|_| unavailable())?;
    if !s.is_file()
        || s.uid() != uid()?
        || s.nlink() != 1
        || s.mode() & 0o777 != 0o600
        || s.len() > limit
    {
        return Err(unavailable());
    }
    Ok(file)
}
pub fn read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    open(path, limit)?
        .take(limit + 1)
        .read_to_end(&mut out)
        .map_err(|_| unavailable())?;
    if out.len() as u64 > limit {
        return Err(unavailable());
    }
    Ok(out)
}
pub fn digest(path: &Path, limit: u64) -> Result<(u64, String)> {
    let mut f = open(path, limit)?;
    let mut hash = Sha256::new();
    let mut total = 0;
    let mut buffer = [0; 65536];
    loop {
        let n = f.read(&mut buffer).map_err(|_| unavailable())?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > limit {
            return Err(unavailable());
        }
        hash.update(&buffer[..n]);
    }
    Ok((total, format!("{:x}", hash.finalize())))
}
pub fn create(path: &Path) -> Result<File> {
    self::path(path)?;
    directory(path.parent().ok_or_else(unavailable)?)?;
    let file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| unavailable())?;
    file.set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| unavailable())?;
    Ok(file)
}
pub fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut f = create(path)?;
    f.write_all(bytes).map_err(|_| unavailable())?;
    f.sync_all().map_err(|_| unavailable())?;
    sync(path.parent().ok_or_else(unavailable)?)
}
pub fn sync(path: &Path) -> Result<()> {
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|_| unavailable())
}
pub fn exact_files(path: &Path) -> Result<()> {
    directory(path)?;
    let mut names = fs::read_dir(path)
        .map_err(|_| unavailable())?
        .map(|e| e.map(|e| e.file_name()))
        .collect::<std::io::Result<Vec<_>>>()
        .map_err(|_| unavailable())?;
    names.sort();
    if names != ["manifest.json", "metadata.pgdump"] {
        return Err(unavailable());
    }
    Ok(())
}
