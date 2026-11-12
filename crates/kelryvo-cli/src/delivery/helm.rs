//! One-field chart promotion. Protected master uses a draft PR; unprotected
//! master uses a non-forced update with the inspected base as its sole parent.
mod checkout;
use super::{
    GitHub, Reader, Result,
    github::Chart,
    publication::{IMAGE, Identity, check},
    registry::{self, Ghcr, Registry},
    sha,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};
use std::{
    fs::OpenOptions,
    io::Write as IoWrite,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
};
use zeroize::Zeroizing;
pub(super) const REPOSITORY: &str = "devsecopslonghn/kelryvo-helm-chart";
#[derive(Clone, Copy)]
pub(super) enum Write {
    Create,
    Update,
}
pub(super) trait Api {
    async fn get(&mut self, route: &str, missing: bool) -> Result<Option<Value>>;
    async fn write(&mut self, method: Write, route: &str, body: &Value) -> Result<Value>;
}
trait Checkout {
    async fn head(&mut self) -> Result<String>;
    fn values(&mut self) -> Result<String>;
    fn replace(&mut self, before: &str, after: &str) -> Result<()>;
    async fn validate(&mut self) -> Result<()>;
    async fn exact_change(&mut self) -> Result<bool>;
}
async fn get(api: &mut impl Api, route: &str) -> Result<Value> {
    api.get(route, false)
        .await?
        .ok_or_else(|| "Missing chart API response".into())
}
fn source_marker(message: &str) -> Result<Option<&str>> {
    let lines = message
        .split('\n')
        .filter(|l| l.starts_with("Kelryvo-Source-SHA:"))
        .collect::<Vec<_>>();
    if lines.is_empty() {
        return Ok(None);
    }
    if lines.len() != 1 {
        return Err("Invalid Helm source provenance".into());
    }
    let source = lines[0]
        .strip_prefix("Kelryvo-Source-SHA: ")
        .filter(|s| sha(s))
        .ok_or("Invalid Helm source provenance")?;
    Ok(Some(source))
}
fn update_values(source: &str, digest: &str) -> Result<String> {
    if !crate::oci::digest(digest) {
        return Err("A verified SHA-256 app image digest is required".into());
    }
    let mut in_image = false;
    let mut seen = false;
    let mut output = Vec::new();
    for line in source.split('\n') {
        if line.chars().next().is_some_and(|c| !c.is_whitespace()) && !line.starts_with('#') {
            in_image = line
                .strip_prefix("image:")
                .is_some_and(|r| r.chars().all(char::is_whitespace));
        }
        if in_image && line.starts_with("  digest:") {
            if seen
                || !line
                    .strip_prefix("  digest: ")
                    .is_some_and(crate::oci::digest)
            {
                return Err("Unsupported chart digest layout".into());
            }
            seen = true;
            output.push(format!("  digest: {digest}"));
        } else {
            output.push(line.into());
        }
    }
    if !seen {
        return Err("Chart must contain exactly image.digest".into());
    }
    Ok(output.join("\n"))
}
fn contents(v: &Value) -> Result<String> {
    if v["encoding"] != "base64" {
        return Err("Unsupported chart contents encoding".into());
    }
    let raw = v["content"]
        .as_str()
        .filter(|s| s.len() <= 2 * 1024 * 1024)
        .ok_or("Invalid chart contents")?;
    let encoded = raw
        .bytes()
        .filter(|b| !b.is_ascii_whitespace())
        .collect::<Vec<_>>();
    String::from_utf8(
        STANDARD
            .decode(encoded)
            .map_err(|_| "Invalid chart contents base64")?,
    )
    .map_err(|_| "Chart values must be UTF-8".into())
}
async fn previous(api: &mut impl Api, base: &str) -> Result<Option<String>> {
    let rows = get(
        api,
        &format!("commits?sha={base}&path=values.yaml&per_page=100"),
    )
    .await?;
    let list = rows
        .as_array()
        .filter(|a| a.len() <= 100)
        .ok_or("Invalid chart commit history")?;
    for c in list {
        if let Some(s) = source_marker(
            c["commit"]["message"]
                .as_str()
                .ok_or("Invalid chart commit message")?,
        )? {
            return Ok(Some(s.into()));
        }
    }
    if list.len() == 100 {
        return Err("Helm promotion provenance is outside the inspected history".into());
    }
    Ok(None)
}
async fn verify_branch(
    api: &mut impl Api,
    candidate: &str,
    base: &str,
    source: &str,
    after: &str,
) -> Result<()> {
    if !sha(candidate) {
        return Err("Invalid promotion branch revision".into());
    }
    let commit = get(api, &format!("git/commits/{candidate}")).await?;
    let proposed = get(api, &format!("contents/values.yaml?ref={candidate}")).await?;
    let diff = get(api, &format!("compare/{base}...{candidate}")).await?;
    if commit["parents"]
        .as_array()
        .is_none_or(|a| a.len() != 1 || a[0]["sha"] != base)
        || source_marker(
            commit["message"]
                .as_str()
                .ok_or("Invalid promotion commit message")?,
        )? != Some(source)
        || contents(&proposed)? != after
        || diff["files"]
            .as_array()
            .is_none_or(|a| a.len() != 1 || a[0]["filename"] != "values.yaml")
    {
        return Err("Existing promotion branch differs from the validated promotion".into());
    }
    Ok(())
}
async fn write(
    source: &mut impl Reader,
    api: &mut impl Api,
    id: &Identity,
    method: Write,
    route: &str,
    body: &Value,
) -> Result<Value> {
    check(source, id).await?;
    api.write(method, route, body).await
}
fn pr_url(value: &Value) -> Result<&str> {
    let url = value["html_url"]
        .as_str()
        .ok_or("Missing chart pull request URL")?;
    let number = url
        .strip_prefix(&format!("https://github.com/{REPOSITORY}/pull/"))
        .ok_or("Unexpected chart pull request URL")?;
    if number.is_empty() || number.starts_with('0') || !number.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid chart pull request URL".into());
    }
    Ok(url)
}
async fn promote(
    source: &mut impl Reader,
    api: &mut impl Api,
    checkout: &mut impl Checkout,
    id: &Identity,
    digest: &str,
) -> Result<Value> {
    if !crate::oci::digest(digest) {
        return Err("Invalid promotion source or missing image digest".into());
    }
    check(source, id).await?;
    let branch = get(api, "branches/master").await?;
    let base = branch["commit"]["sha"]
        .as_str()
        .filter(|s| sha(s))
        .ok_or("Invalid Helm master revision")?;
    let protected = branch["protected"]
        .as_bool()
        .ok_or("Missing chart branch protection state")?;
    if checkout.head().await? != base {
        return Err("Helm checkout is no longer current; rerun delivery".into());
    }
    let before = checkout.values()?;
    let file = get(api, &format!("contents/values.yaml?ref={base}")).await?;
    if contents(&file)? != before {
        return Err("Helm values checkout mismatch".into());
    }
    let previous = previous(api, base).await?;
    if let Some(previous) = &previous
        && previous != &id.source
        && source
            .get(&format!("compare/{previous}...{}", id.source))
            .await?["status"]
            != "ahead"
    {
        return Err("Helm promotion would roll back or diverge from the promoted source".into());
    }
    let after = update_values(&before, digest)?;
    if previous.as_deref() == Some(id.source.as_str()) && after != before {
        return Err(
            "Source already promoted with different digests; preserve the existing promotion"
                .into(),
        );
    }
    if after == before {
        return Ok(json!({"status":"unchanged","sha":base}));
    }
    checkout.replace(&before, &after)?;
    checkout.validate().await?;
    if checkout.values()? != after
        || checkout.head().await? != base
        || !checkout.exact_change().await?
    {
        return Err("Chart validation changed unrelated files".into());
    }
    check(source, id).await?;
    if get(api, "git/ref/heads/master").await?["object"]["sha"] != base {
        return Err("Helm master changed during validation; rerun delivery".into());
    }
    let head = format!("automation/kelryvo-images-{}", id.source);
    let mut reusable = None;
    if protected {
        let value = get(api, "pulls?state=open&base=master&per_page=100").await?;
        let prs = value
            .as_array()
            .filter(|a| a.len() < 100)
            .ok_or("Too many open chart PRs to safely supersede promotions")?;
        for pr in prs {
            if pr["head"]["repo"]["full_name"] == REPOSITORY
                && pr["head"]["ref"].as_str().is_some_and(|r| {
                    r.strip_prefix("automation/kelryvo-images-")
                        .is_some_and(sha)
                })
                && pr["head"]["ref"] != head
            {
                let number = super::id(&pr["number"])?;
                write(
                    source,
                    api,
                    id,
                    Write::Update,
                    &format!("pulls/{number}"),
                    &json!({"state":"closed"}),
                )
                .await?;
            }
        }
        if let Some(pr) = prs
            .iter()
            .find(|p| p["head"]["ref"] == head && p["head"]["repo"]["full_name"] == REPOSITORY)
        {
            verify_branch(
                api,
                pr["head"]["sha"]
                    .as_str()
                    .ok_or("Missing promotion branch revision")?,
                base,
                &id.source,
                &after,
            )
            .await?;
            check(source, id).await?;
            return Ok(json!({"status":"pull-request","url":pr_url(pr)?}));
        }
        if let Some(reference) = api.get(&format!("git/ref/heads/{head}"), true).await? {
            let candidate = reference["object"]["sha"]
                .as_str()
                .ok_or("Missing retained promotion revision")?;
            verify_branch(api, candidate, base, &id.source, &after).await?;
            reusable = Some(candidate.to_owned());
        }
    }
    let was_reusable = reusable.is_some();
    let created = if let Some(reusable) = reusable {
        reusable
    } else {
        let commit = get(api, &format!("git/commits/{base}")).await?;
        let base_tree = commit["tree"]["sha"]
            .as_str()
            .filter(|s| sha(s))
            .ok_or("Invalid chart base tree")?;
        let tree=write(source,api,id,Write::Create,"git/trees",&json!({"base_tree":base_tree,"tree":[{"path":"values.yaml","mode":"100644","type":"blob","content":after}]})).await?;
        let tree = tree["sha"]
            .as_str()
            .filter(|s| sha(s))
            .ok_or("Invalid created chart tree")?;
        let created=write(source,api,id,Write::Create,"git/commits",&json!({"tree":tree,"parents":[base],"message":format!("Promote verified Kelryvo app image {}\n\nKelryvo-Source-SHA: {}\nKelryvo-App-Digest: {digest}",&id.source[..12],id.source)})).await?;
        created["sha"]
            .as_str()
            .filter(|s| sha(s))
            .ok_or("Invalid created chart commit")?
            .to_owned()
    };
    if protected {
        if !was_reusable {
            write(
                source,
                api,
                id,
                Write::Create,
                "git/refs",
                &json!({"ref":format!("refs/heads/{head}"),"sha":created}),
            )
            .await?;
        }
        let reference = get(api, &format!("git/ref/heads/{head}")).await?;
        if reference["object"]["sha"] != created {
            return Err("Promotion branch changed before PR creation".into());
        }
        verify_branch(api, &created, base, &id.source, &after).await?;
        let pr=write(source,api,id,Write::Create,"pulls",&json!({"head":head,"base":"master","draft":true,"title":format!("Promote verified Kelryvo images {}",&id.source[..12]),"body":format!("The immutable application image digest belongs to verified source {}. Only image.digest changes. Strict Helm lint, chart security checks and template validation passed.\n\nApp: {digest}\n\nRecheck that this source is current before merging; repository review and CI policies apply.",id.source)})).await?;
        Ok(json!({"status":"pull-request","url":pr_url(&pr)?}))
    } else {
        write(
            source,
            api,
            id,
            Write::Update,
            "git/refs/heads/master",
            &json!({"sha":created,"force":false}),
        )
        .await?;
        Ok(json!({"status":"promoted","sha":created}))
    }
}
pub(super) async fn run() -> Result<Value> {
    let env =
        |name| std::env::var(name).map_err(|_| format!("Missing Helm promotion setting {name}"));
    let id = Identity::new(env("SOURCE_SHA")?, env("OCI_RUN")?, env("OCI_ATTEMPT")?)?;
    let digest = env("APP_DIGEST")?;
    if !crate::oci::digest(&digest) {
        return Err("Invalid promotion source or missing image digest".into());
    }
    let token = Zeroizing::new(env("GITHUB_TOKEN")?);
    let helm = Zeroizing::new(env("HELM_TOKEN")?);
    let mut source = GitHub::new(&token)?;
    let mut api = Chart::new(&helm)?;
    let mut checkout = checkout::Native::load(
        &std::env::current_dir()
            .map_err(|_| "Cannot resolve chart checkout")?
            .join("helm-chart"),
    )
    .await?;
    check(&mut source, &id).await?;
    let mut registry = Ghcr::new(env("GITHUB_ACTOR")?, token.to_string())?;
    let image = registry
        .read(&digest, false)
        .await?
        .ok_or("Missing verified registry image")?;
    registry::verify(&image, &id.source, None)?;
    let tagged = registry
        .read(&id.tag, false)
        .await?
        .ok_or("Missing verified publication tag")?;
    if registry::verify(&tagged, &id.source, None)? != digest {
        return Err("Promotion digest does not match the verified publication tag".into());
    }
    let result = promote(&mut source, &mut api, &mut checkout, &id, &digest).await?;
    if let Some(path) = std::env::var_os("GITHUB_STEP_SUMMARY") {
        let mut file = OpenOptions::new()
            .append(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(Path::new(&path))
            .map_err(|_| "Cannot open Helm summary file")?;
        let st = file
            .metadata()
            .map_err(|_| "Cannot inspect Helm summary file")?;
        if !st.is_file() || st.nlink() != 1 {
            return Err("Helm summary must be a regular file with one link".into());
        }
        file.write_all(
            format!(
                "Helm {}: {}\n\nSource {}\n{IMAGE}@{digest}\n",
                result["status"]
                    .as_str()
                    .ok_or("Missing promotion status")?,
                result["url"]
                    .as_str()
                    .or_else(|| result["sha"].as_str())
                    .ok_or("Missing promotion reference")?,
                id.source
            )
            .as_bytes(),
        )
        .and_then(|_| file.sync_all())
        .map_err(|_| "Cannot sync Helm promotion summary")?;
    }
    Ok(result)
}
#[cfg(test)]
mod tests;
