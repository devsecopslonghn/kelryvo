//! Fixed read-only Git/Helm validation commands. Only the opened values.yaml
//! is written locally; credentials/selectors never enter child environments.
use super::{Checkout, Result};
use crate::delivery::{copy, sha};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
pub(super) struct Native {
    root: PathBuf,
    file: File,
    dev: u64,
    ino: u64,
}
impl Native {
    pub(super) async fn load(path: &Path) -> Result<Self> {
        if !path.is_absolute() {
            return Err("Chart checkout must be absolute".into());
        }
        let root = fs::canonicalize(path).map_err(|_| "Cannot resolve chart checkout")?;
        if root != path {
            return Err("Chart checkout must use a regular canonical path".into());
        }
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(root.join("values.yaml"))
            .map_err(|_| "Cannot open chart values")?;
        let st = file.metadata().map_err(|_| "Cannot inspect chart values")?;
        if !st.is_file() || st.nlink() != 1 || st.mode() & 0o111 != 0 || st.len() > 1024 * 1024 {
            return Err("Chart values must be a bounded regular non-executable file".into());
        }
        let this = Self {
            root,
            file,
            dev: st.dev(),
            ino: st.ino(),
        };
        if this.git(&["rev-parse", "--show-toplevel"]).await?.trim()
            != this.root.to_str().ok_or("Invalid chart checkout path")?
        {
            return Err("Chart checkout must be its exact Git root".into());
        }
        if !this.status().await?.is_empty() {
            return Err("Chart checkout must be clean before promotion".into());
        }
        Ok(this)
    }
    async fn git_bytes(&self, args: &[&str]) -> Result<zeroize::Zeroizing<Vec<u8>>> {
        let mut argv = vec![
            "--no-optional-locks".into(),
            "--no-pager".into(),
            "-c".into(),
            "core.hooksPath=/dev/null".into(),
            "-c".into(),
            "core.fsmonitor=false".into(),
            "-c".into(),
            format!(
                "safe.directory={}",
                self.root.to_str().ok_or("Invalid chart checkout path")?
            )
            .into(),
        ];
        argv.extend(args.iter().map(OsString::from));
        copy::local_command(Path::new("/usr/bin/git"), &argv, &self.root).await
    }
    async fn git(&self, args: &[&str]) -> Result<String> {
        String::from_utf8(self.git_bytes(args).await?.to_vec())
            .map_err(|_| "Invalid chart Git output".into())
    }
    async fn status(&self) -> Result<zeroize::Zeroizing<Vec<u8>>> {
        self.git_bytes(&["status", "--porcelain=v1", "-z", "--untracked-files=all"])
            .await
    }
    fn bound(&self) -> Result<fs::Metadata> {
        let path = fs::symlink_metadata(self.root.join("values.yaml"))
            .map_err(|_| "Chart values disappeared")?;
        let st = self
            .file
            .metadata()
            .map_err(|_| "Cannot recheck chart values")?;
        if !path.is_file()
            || path.is_symlink()
            || path.dev() != self.dev
            || path.ino() != self.ino
            || st.nlink() != 1
            || st.mode() & 0o111 != 0
            || st.len() > 1024 * 1024
        {
            return Err("Chart values file identity changed".into());
        }
        Ok(st)
    }
}
impl Checkout for Native {
    async fn head(&mut self) -> Result<String> {
        let result = self
            .git(&["rev-parse", "--verify", "HEAD"])
            .await?
            .trim()
            .to_owned();
        if !sha(&result) {
            return Err("Invalid chart checkout revision".into());
        }
        Ok(result)
    }
    fn values(&mut self) -> Result<String> {
        let st = self.bound()?;
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|_| "Cannot seek chart values")?;
        let mut bytes = Vec::new();
        Read::by_ref(&mut self.file)
            .take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read chart values")?;
        let after = self.bound()?;
        if bytes.len() > 1024 * 1024
            || st.len() != after.len()
            || (st.mtime(), st.mtime_nsec(), st.ctime(), st.ctime_nsec())
                != (
                    after.mtime(),
                    after.mtime_nsec(),
                    after.ctime(),
                    after.ctime_nsec(),
                )
        {
            return Err("Chart values changed while reading".into());
        }
        String::from_utf8(bytes).map_err(|_| "Chart values must be UTF-8".into())
    }
    fn replace(&mut self, before: &str, after: &str) -> Result<()> {
        if self.values()? != before {
            return Err("Chart values changed before replacement".into());
        }
        self.file
            .seek(SeekFrom::Start(0))
            .and_then(|_| self.file.write_all(after.as_bytes()))
            .and_then(|_| self.file.set_len(after.len() as u64))
            .and_then(|_| self.file.sync_all())
            .map_err(|_| "Cannot sync candidate chart values".into())
    }
    async fn validate(&mut self) -> Result<()> {
        let helm = if Path::new("/usr/local/bin/helm").is_file() {
            Path::new("/usr/local/bin/helm")
        } else {
            Path::new("/usr/bin/helm")
        };
        for (program, args) in [
            (helm, vec!["lint", "--strict", "."]),
            (
                Path::new("/usr/bin/python3"),
                vec!["scripts/check-chart.py"],
            ),
            (
                helm,
                vec!["template", "kelryvo", ".", "--namespace", "kelryvo"],
            ),
        ] {
            copy::local_command(
                program,
                &args.into_iter().map(OsString::from).collect::<Vec<_>>(),
                &self.root,
            )
            .await?;
        }
        Ok(())
    }
    async fn exact_change(&mut self) -> Result<bool> {
        Ok(self.status().await?.as_slice() == b" M values.yaml\0")
    }
}
#[cfg(test)]
mod tests;
