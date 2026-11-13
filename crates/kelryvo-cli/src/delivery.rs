//! Delivery eligibility and immutable GHCR publication. Publication rechecks
//! all gates before writing and after registry proof; no chart/cluster mutation.
pub(crate) mod copy;
mod dockerhub;
mod github;
mod helm;
mod publication;
mod registry;
use github::GitHub;
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::OpenOptions,
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::Path,
    process::ExitCode,
};
use zeroize::Zeroizing;
const REPOSITORY: &str = "devsecopslonghn/kelryvo";
const WORKFLOWS: [&str; 2] = ["check.yml", "containers.yml"];
// Require the repository-owned security workflow, successful exact-source
// language jobs and refusal of open code-scanning findings.
const CODEQL_WORKFLOW: &str = ".github/workflows/codeql.yml";
const CODEQL: [&str; 2] = ["Analyze (rust)", "Analyze (actions)"];
const LIMIT: u64 = 8 * 1024 * 1024;
type Result<T> = std::result::Result<T, String>;
fn sha(s: &str) -> bool {
    s.len() == 40
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn id(v: &Value) -> Result<u64> {
    v.as_u64()
        .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
        .ok_or_else(|| "Invalid GitHub workflow identity".into())
}
fn values<'a>(v: &'a Value, key: &str) -> Result<&'a [Value]> {
    v[key]
        .as_array()
        .filter(|a| a.len() <= 100)
        .map(Vec::as_slice)
        .ok_or_else(|| "Invalid GitHub workflow response".into())
}
fn source_revision(env: &BTreeMap<String, String>, event: &Value) -> Result<String> {
    let get = |key: &str| env.get(key).map(String::as_str).unwrap_or_default();
    if get("GITHUB_REPOSITORY") != REPOSITORY {
        return Err("Unexpected source repository".into());
    }
    if get("GITHUB_EVENT_NAME") == "workflow_dispatch"
        && get("GITHUB_REF") == "refs/heads/master"
        && sha(get("GITHUB_SHA"))
    {
        return Ok(get("GITHUB_SHA").into());
    }
    let run = &event["workflow_run"];
    if get("GITHUB_EVENT_NAME") != "workflow_run"
        || event["action"] != "completed"
        || !run["event"]
            .as_str()
            .is_some_and(|s| ["push", "dynamic"].contains(&s))
        || run["head_branch"] != "master"
        || run["head_repository"]["full_name"] != REPOSITORY
        || !run["head_sha"].as_str().is_some_and(sha)
    {
        return Err("Delivery requires a completed source master workflow event".into());
    }
    Ok(run["head_sha"]
        .as_str()
        .ok_or("Invalid source revision")?
        .into())
}
trait Reader {
    async fn get(&mut self, route: &str) -> Result<Value>;
}
fn deferred(reason: &str) -> Value {
    json!({"ready":false,"reason":reason})
}
fn successful(run: &Value, source: &str) -> bool {
    run["head_sha"] == source
        && run["head_branch"] == "master"
        && run["status"] == "completed"
        && run["conclusion"] == "success"
}
fn latest<'a>(runs: impl Iterator<Item = &'a Value>) -> Result<Option<&'a Value>> {
    let mut result = None;
    let mut last = 0;
    for run in runs {
        let n = id(&run["id"])?;
        if n > last {
            last = n;
            result = Some(run);
        }
    }
    Ok(result)
}
async fn gate(get: &mut impl Reader, source: &str) -> Result<Value> {
    if !sha(source) {
        return Err("Invalid source revision".into());
    }
    if get.get("git/ref/heads/master").await?["object"]["sha"] != source {
        return Ok(deferred("Source is superseded"));
    }
    let mut oci = None;
    for workflow in WORKFLOWS {
        let response=get.get(&format!("actions/workflows/{workflow}/runs?head_sha={source}&event=push&branch=master&per_page=100")).await?;
        let run = latest(values(&response, "workflow_runs")?.iter())?;
        let Some(run) = run.filter(|r| successful(r, source) && r["event"] == "push") else {
            return Ok(deferred(&format!("{workflow} is not successful")));
        };
        if workflow == "containers.yml" {
            oci = Some((id(&run["id"])?, id(&run["run_attempt"])?));
        }
    }
    let response = get.get("actions/workflows?per_page=100").await?;
    let codeql = values(&response, "workflows")?
        .iter()
        .find(|w| w["path"] == CODEQL_WORKFLOW && w["state"] == "active")
        .ok_or("Required Rust CodeQL workflow is unavailable")?;
    let codeql = id(&codeql["id"])?;
    let response = get
        .get(&format!(
            "actions/workflows/{codeql}/runs?head_sha={source}&branch=master&per_page=100"
        ))
        .await?;
    let run = latest(values(&response, "workflow_runs")?.iter().filter(|r| {
        r["event"]
            .as_str()
            .is_some_and(|e| ["push", "dynamic"].contains(&e))
    }))?;
    let Some(run) = run.filter(|r| successful(r, source)) else {
        return Ok(deferred("CodeQL is not successful"));
    };
    let response = get
        .get(&format!(
            "actions/runs/{}/attempts/{}/jobs?per_page=100",
            id(&run["id"])?,
            id(&run["run_attempt"])?
        ))
        .await?;
    let jobs = values(&response, "jobs")?;
    if CODEQL.iter().any(|name| {
        !jobs.iter().any(|j| {
            j["name"] == *name
                && j["head_sha"] == source
                && j["status"] == "completed"
                && j["conclusion"] == "success"
        })
    }) {
        return Ok(deferred("Required CodeQL language is not successful"));
    }
    let alerts = get
        .get("code-scanning/alerts?state=open&per_page=100")
        .await?;
    if !alerts
        .as_array()
        .ok_or("Invalid code-scanning alert response")?
        .is_empty()
    {
        return Err("Open code-scanning findings require review".into());
    }
    if get.get("git/ref/heads/master").await?["object"]["sha"] != source {
        return Ok(deferred("Source is superseded"));
    }
    let (run, attempt) = oci.ok_or("Missing verified OCI workflow")?;
    Ok(json!({"ready":true,"sha":source,"ociRun":run.to_string(),"ociAttempt":attempt.to_string()}))
}
fn required(result: &Value) -> Result<()> {
    if result["ready"] == true {
        Ok(())
    } else {
        Err(format!(
            "Publication blocked: {}",
            result["reason"].as_str().unwrap_or("Invalid gate result")
        ))
    }
}
fn event_file(path: &Path) -> Result<Value> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot read GitHub event file")?;
    let st = file
        .metadata()
        .map_err(|_| "Cannot inspect GitHub event file")?;
    if !st.is_file() || st.len() > LIMIT {
        return Err("Expected a bounded regular GitHub event file".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "Cannot read GitHub event file")?;
    if bytes.len() as u64 > LIMIT {
        return Err("GitHub event exceeds the input limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Invalid GitHub event JSON".into())
}
fn output(path: &Path, source: &str, result: &Value) -> Result<()> {
    if !sha(source) {
        return Err("Invalid gate output revision".into());
    }
    let mut file = OpenOptions::new()
        .append(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)
        .map_err(|_| "Cannot open GitHub output file")?;
    let st = file
        .metadata()
        .map_err(|_| "Cannot inspect GitHub output file")?;
    if !st.is_file() || st.nlink() != 1 {
        return Err("Expected a regular GitHub output file with one link".into());
    }
    let ready = result["ready"] == true;
    let run = if ready {
        result["ociRun"].as_str().ok_or("Missing OCI run")?
    } else {
        ""
    };
    let attempt = if ready {
        result["ociAttempt"].as_str().ok_or("Missing OCI attempt")?
    } else {
        ""
    };
    if ready
        && [run, attempt].iter().any(|s| {
            s.starts_with('0')
                || s.parse::<u64>()
                    .ok()
                    .is_none_or(|n| n == 0 || n > 9_007_199_254_740_991)
        })
    {
        return Err("Invalid gate output workflow identity".into());
    }
    // All interpolated values are closed booleans, a checked source SHA and
    // decimal IDs from the verified result, never remote free text.
    file.write_all(
        format!("ready={ready}\nsha={source}\noci_run={run}\noci_attempt={attempt}\n").as_bytes(),
    )
    .map_err(|_| "Cannot append GitHub gate outputs")?;
    file.sync_all()
        .map_err(|_| "Cannot sync GitHub gate outputs".into())
}
async fn run(require: bool) -> Result<Value> {
    let mut env = BTreeMap::new();
    for key in [
        "GITHUB_REPOSITORY",
        "GITHUB_EVENT_NAME",
        "GITHUB_REF",
        "GITHUB_SHA",
    ] {
        if let Ok(value) = std::env::var(key) {
            env.insert(key.into(), value);
        }
    }
    let path = std::env::var_os("GITHUB_EVENT_PATH").ok_or("Missing GitHub event file")?;
    let source = source_revision(&env, &event_file(Path::new(&path))?)?;
    if std::env::var("SOURCE_SHA").is_ok_and(|s| !s.is_empty() && s != source) {
        return Err("Delivery revision changed".into());
    }
    let token =
        Zeroizing::new(std::env::var("GITHUB_TOKEN").map_err(|_| "Missing GitHub credential")?);
    let mut github = GitHub::new(&token)?;
    let result = gate(&mut github, &source).await?;
    if require {
        required(&result)?;
    }
    if let Some(path) = std::env::var_os("GITHUB_OUTPUT") {
        output(Path::new(&path), &source, &result)?;
    }
    Ok(result)
}
pub fn command(args: &[String]) -> ExitCode {
    if args == ["--help"] {
        println!(
            "Usage: kelryvo delivery gate [--require]\n       kelryvo delivery publish\n       kelryvo delivery promote\n       kelryvo delivery dockerhub --source-sha SHA --oci-run RUN --oci-attempt ATTEMPT --archive FILE --repository docker.io/NAMESPACE/REPOSITORY --authfile FILE --report NEW_FILE\n\ngate: read-only eligibility using the fixed source repository and GitHub HTTPS API. Reads the Actions event/environment and GITHUB_TOKEN; appends checked values to an existing GITHUB_OUTPUT file. Pending/failed/superseded runs do not wait or grant publication; --require rejects them.\npublish: verifies a private snapshot of dist/oci/kelryvo-app.tar, rechecks source/image/security gates and exact OCI run/attempt, reuses an existing matching immutable tag or publishes both platforms through /usr/bin/skopeo, then verifies GHCR bytes/roles and all gates again. Requires SOURCE_SHA, OCI_RUN, OCI_ATTEMPT, GITHUB_ACTOR and GITHUB_TOKEN. Destination is fixed to ghcr.io/devsecopslonghn/kelryvo-app. This command performs a registry write only when the tag is absent and every gate passes. It performs no chart or cluster mutation.\ndockerhub: explicitly selected Docker Hub destination with the same source/OCI gates, a private verified archive snapshot, projected private push auth and independent anonymous checks of both platforms. Existing mismatched tags are never overwritten. Requires a new report file and a private Docker Hub auth file; it can publish the absent tag. No chart, Argo CD or cluster mutation is performed.\npromote: verifies the published GHCR digest/tag and current source gates, validates the clean helm-chart checkout with the existing Helm/security/template checks, and changes only image.digest. Protected master uses a draft PR; unprotected master uses a non-forced update from the inspected base. Requires SOURCE_SHA, OCI_RUN, OCI_ATTEMPT, APP_DIGEST, GITHUB_ACTOR, GITHUB_TOKEN and a separate HELM_TOKEN scoped to the chart repository. It may create chart Git objects/refs/PRs; it never merges, forces refs or changes a cluster."
        );
        return ExitCode::SUCCESS;
    }
    enum Mode {
        Gate(bool),
        Publish,
        DockerHub(Vec<String>),
        Promote,
    }
    let mode = match args {
        [mode] if mode == "publish" => Mode::Publish,
        [mode] if mode == "promote" => Mode::Promote,
        [mode, rest @ ..] if mode == "dockerhub" => Mode::DockerHub(rest.to_vec()),
        [mode] if mode == "gate" => Mode::Gate(false),
        [mode, flag] if mode == "gate" && flag == "--require" => Mode::Gate(true),
        _ => {
            eprintln!("Invalid delivery command. Use kelryvo delivery --help.");
            return ExitCode::FAILURE;
        }
    };
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|_| "Cannot start native delivery runtime".into())
        .and_then(|rt| {
            rt.block_on(async {
                match mode {
                    Mode::Publish => publication::run().await,
                    Mode::DockerHub(args) => dockerhub::run(&args).await,
                    Mode::Promote => helm::run().await,
                    Mode::Gate(require) => run(require).await,
                }
            })
        });
    match result {
        Ok(result) => {
            println!("{result}");
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("{error}");
            ExitCode::FAILURE
        }
    }
}
#[cfg(test)]
mod tests;
