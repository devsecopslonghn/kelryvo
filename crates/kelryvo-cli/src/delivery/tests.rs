use super::*;
use std::{collections::VecDeque, fs};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
const SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OLD: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
pub(super) struct Fake {
    responses: BTreeMap<String, VecDeque<Value>>,
    pub(super) seen: Vec<String>,
}
impl Fake {
    pub(super) fn new(v: &Value) -> Self {
        Self {
            responses: v
                .as_object()
                .unwrap()
                .iter()
                .map(|(k, v)| (k.clone(), v.as_array().unwrap().iter().cloned().collect()))
                .collect(),
            seen: Vec::new(),
        }
    }
}
impl Reader for Fake {
    async fn get(&mut self, route: &str) -> Result<Value> {
        self.seen.push(route.into());
        let values = self
            .responses
            .get_mut(route)
            .ok_or("Unexpected fixture API route")?;
        if values.len() > 1 {
            Ok(values.pop_front().unwrap())
        } else {
            values
                .front()
                .cloned()
                .ok_or_else(|| "Empty API fixture".into())
        }
    }
}
fn environment() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("GITHUB_REPOSITORY".into(), REPOSITORY.into()),
        ("GITHUB_EVENT_NAME".into(), "workflow_dispatch".into()),
        ("GITHUB_REF".into(), "refs/heads/master".into()),
        ("GITHUB_SHA".into(), SHA.into()),
    ])
}
fn run(id: u64) -> Value {
    json!({"id":id,"head_sha":SHA,"head_branch":"master","event":"push","run_attempt":2,"status":"completed","conclusion":"success"})
}
pub(super) fn responses() -> Value {
    let mut map = serde_json::Map::new();
    map.insert(
        "git/ref/heads/master".into(),
        json!([{"object":{"sha":SHA}},{"object":{"sha":SHA}}]),
    );
    for name in WORKFLOWS {
        map.insert(
            format!(
                "actions/workflows/{name}/runs?head_sha={SHA}&event=push&branch=master&per_page=100"
            ),
            json!([{"workflow_runs":[run(4)]}]),
        );
    }
    map.insert("actions/workflows?per_page=100".into(),json!([{"workflows":[{"id":5,"path":"dynamic/github-code-scanning/codeql","state":"active"}]}]));
    map.insert(
        format!("actions/workflows/5/runs?head_sha={SHA}&branch=master&per_page=100"),
        json!([{"workflow_runs":[run(5)]}]),
    );
    map.insert("actions/runs/5/attempts/2/jobs?per_page=100".into(),json!([{"jobs":CODEQL.map(|name|json!({"name":name,"head_sha":SHA,"status":"completed","conclusion":"success"}))}]));
    map.insert(
        "code-scanning/alerts?state=open&per_page=100".into(),
        json!([[]]),
    );
    Value::Object(map)
}
fn cases() -> Vec<Value> {
    let mut out = Vec::new();
    let mut add = |name: &str, mut responses: Value, change: fn(&mut Value)| {
        change(&mut responses);
        out.push(json!({"name":name,"environment":environment(),"event":{},"responses":responses}));
    };
    add("ready", responses(), |_| {});
    add("superseded", responses(), |r| {
        r["git/ref/heads/master"][0]["object"]["sha"] = OLD.into()
    });
    add("master changed during checks", responses(), |r| {
        r["git/ref/heads/master"][1]["object"]["sha"] = OLD.into()
    });
    add("pending image", responses(), |r| {
        r[format!(
            "actions/workflows/containers.yml/runs?head_sha={SHA}&event=push&branch=master&per_page=100"
        )][0]["workflow_runs"][0]["status"] = "in_progress".into()
    });
    add("newer failed check", responses(), |r| {
        let list = r[format!(
            "actions/workflows/check.yml/runs?head_sha={SHA}&event=push&branch=master&per_page=100"
        )][0]["workflow_runs"]
            .as_array_mut()
            .unwrap();
        let mut failed = run(9);
        failed["conclusion"] = "failure".into();
        list.push(failed);
    });
    add("newer codeql fails", responses(), |r| {
        let list = r[format!("actions/workflows/5/runs?head_sha={SHA}&branch=master&per_page=100")]
            [0]["workflow_runs"]
            .as_array_mut()
            .unwrap();
        let mut failed = run(9);
        failed["conclusion"] = "failure".into();
        list.push(failed);
    });
    add("codeql dynamic event", responses(), |r| {
        r[format!("actions/workflows/5/runs?head_sha={SHA}&branch=master&per_page=100")][0]["workflow_runs"]
            [0]["event"] = "dynamic".into()
    });
    add("missing language", responses(), |r| {
        r["actions/runs/5/attempts/2/jobs?per_page=100"][0]["jobs"]
            .as_array_mut()
            .unwrap()
            .pop();
    });
    add("open finding", responses(), |r| {
        r["code-scanning/alerts?state=open&per_page=100"][0] = json!([{"number":1}])
    });
    add("missing CodeQL", responses(), |r| {
        r["actions/workflows?per_page=100"][0]["workflows"] = json!([])
    });
    add("optional workflow failure", responses(), |r| {
        r["actions/workflows/product.yml/runs"] = json!([{"conclusion":"failure"}])
    });
    let mut completion = out[0].clone();
    completion["name"] = "workflow completion".into();
    completion["environment"]["GITHUB_EVENT_NAME"] = "workflow_run".into();
    completion["event"] = json!({"action":"completed","workflow_run":{"head_sha":SHA,"head_branch":"master","event":"push","head_repository":{"full_name":REPOSITORY}}});
    out.push(completion.clone());
    completion["name"] = "fork completion".into();
    completion["event"]["workflow_run"]["head_repository"]["full_name"] = "fork/repo".into();
    out.push(completion);
    out
}
async fn evaluate(case: &Value) -> Value {
    let env = serde_json::from_value(case["environment"].clone()).unwrap();
    let result = async {
        let source = source_revision(&env, &case["event"])?;
        let mut reader = Fake::new(&case["responses"]);
        let gate = gate(&mut reader, &source).await?;
        Ok::<_, String>(json!({"source":source,"gate":gate}))
    }
    .await;
    match result {
        Ok(value) => value,
        Err(error) => json!({"error":error}),
    }
}
#[tokio::test]
async fn latest_runs_independent_security_and_both_master_reads_are_required() {
    let all = cases();
    for case in &all {
        let actual = evaluate(case).await;
        let expected = match case["name"].as_str().unwrap() {
            "ready"
            | "codeql dynamic event"
            | "optional workflow failure"
            | "workflow completion" => {
                json!({"source":SHA,"gate":{"ready":true,"sha":SHA,"ociRun":"4","ociAttempt":"2"}})
            }
            "superseded" | "master changed during checks" => {
                json!({"source":SHA,"gate":{"ready":false,"reason":"Source is superseded"}})
            }
            "pending image" => {
                json!({"source":SHA,"gate":{"ready":false,"reason":"containers.yml is not successful"}})
            }
            "newer failed check" => {
                json!({"source":SHA,"gate":{"ready":false,"reason":"check.yml is not successful"}})
            }
            "newer codeql fails" => {
                json!({"source":SHA,"gate":{"ready":false,"reason":"CodeQL is not successful"}})
            }
            "missing language" => {
                json!({"source":SHA,"gate":{"ready":false,"reason":"Required CodeQL language is not successful"}})
            }
            "open finding" => json!({"error":"Open code-scanning findings require review"}),
            "missing CodeQL" => json!({"error":"Required default CodeQL workflow is unavailable"}),
            "fork completion" => {
                json!({"error":"Delivery requires a completed source master workflow event"})
            }
            _ => unreachable!(),
        };
        assert_eq!(actual, expected, "{}", case["name"]);
    }
    let mut reader = Fake::new(&responses());
    let verified = gate(&mut reader, SHA).await.unwrap();
    required(&verified).unwrap();
    assert_eq!(
        reader
            .seen
            .iter()
            .filter(|r| *r == "git/ref/heads/master")
            .count(),
        2
    );
    assert!(!reader.seen.iter().any(|r| r.contains("product.yml")));
    assert!(required(&deferred("Source is superseded")).is_err());
    let mut bad = responses();
    bad[format!(
        "actions/workflows/containers.yml/runs?head_sha={SHA}&event=push&branch=master&per_page=100"
    )][0]["workflow_runs"][0]["run_attempt"] = json!("1\nready=true");
    assert!(
        gate(&mut Fake::new(&bad), SHA).await.is_err(),
        "malformed IDs cannot inject Actions outputs"
    );
}
#[tokio::test]
async fn historical_language_results_cannot_qualify_the_rust_replacement() {
    // Preserve the independently captured historical records byte for byte.
    // Their successful Node/JVM/Python results cannot confer Rust authority.
    let records: Value = serde_json::from_slice(
        &fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/contracts/delivery.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let cases = records[0]["input"].as_array().unwrap();
    let expected = records[0]["output"].as_array().unwrap();
    assert_eq!(cases.len(), expected.len());
    let mut historical_successes = 0;
    for (case, expected) in cases.iter().zip(expected) {
        let actual = evaluate(case).await;
        assert_ne!(actual["gate"]["ready"], true, "{}", case["name"]);
        if expected["gate"]["ready"] == true {
            historical_successes += 1;
            assert_eq!(
                actual["gate"]["reason"],
                "Required CodeQL language is not successful"
            );
        }
    }
    assert_eq!(historical_successes, 4);
    for language in CODEQL {
        for status in ["failure", "cancelled", "skipped", "in_progress"] {
            let mut native = responses();
            for job in native["actions/runs/5/attempts/2/jobs?per_page=100"][0]["jobs"]
                .as_array_mut()
                .unwrap()
            {
                if job["name"] == language {
                    job["conclusion"] = status.into();
                }
            }
            assert_ne!(
                gate(&mut Fake::new(&native), SHA).await.unwrap()["ready"],
                true
            );
        }
    }
}
#[test]
fn event_and_actions_output_paths_do_not_follow_links_or_echo_private_payloads() {
    let root = tempfile::tempdir().unwrap();
    let event = root.path().join("event.json");
    fs::write(&event, b"{\"secret\":\"private-fixture\"}").unwrap();
    assert!(event_file(&event).is_ok());
    let linked = root.path().join("linked.json");
    std::os::unix::fs::symlink(&event, &linked).unwrap();
    assert!(event_file(&linked).is_err());
    let output_file = root.path().join("output");
    fs::write(&output_file, "").unwrap();
    let verified = json!({"ready":true,"ociRun":"4","ociAttempt":"2"});
    output(&output_file, SHA, &verified).unwrap();
    assert_eq!(
        fs::read_to_string(&output_file).unwrap(),
        format!("ready=true\nsha={SHA}\noci_run=4\noci_attempt=2\n")
    );
    assert!(output(&linked, SHA, &verified).is_err());
    assert_eq!(
        fs::read(&event).unwrap(),
        b"{\"secret\":\"private-fixture\"}"
    );
    let mut env = environment();
    env.insert("GITHUB_REF".into(), "refs/pull/1/merge".into());
    assert!(source_revision(&env, &json!({})).is_err());
}
async fn server(
    status: &str,
    extra: &str,
    body: &str,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<String>) {
    server_size(status, extra, body, body.len() as u64).await
}
async fn server_size(
    status: &str,
    extra: &str,
    body: &str,
    length: u64,
) -> (std::net::SocketAddr, tokio::task::JoinHandle<String>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n{extra}\r\n{body}",
        length
    );
    let handle = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut buffer = Vec::new();
        while !buffer.ends_with(b"\r\n\r\n") {
            let mut b = [0; 1024];
            let n = stream.read(&mut b).await.unwrap();
            assert!(n > 0 && buffer.len() + n <= 16384);
            buffer.extend_from_slice(&b[..n]);
        }
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(buffer).unwrap()
    });
    (address, handle)
}
#[tokio::test]
async fn http_adapter_is_read_only_bounded_and_never_follows_credential_redirects() {
    let token = "private-unit-token";
    let (address, seen) = server("200 OK", "", r#"{"object":{"sha":"fixture"}}"#).await;
    let mut api = GitHub::local(token, address).unwrap();
    assert_eq!(
        api.get("git/ref/heads/master").await.unwrap()["object"]["sha"],
        "fixture"
    );
    let request = seen.await.unwrap();
    assert!(request.starts_with(&format!(
        "GET /repos/{REPOSITORY}/git/ref/heads/master HTTP/1.1"
    )));
    assert!(request.contains(&format!("authorization: Bearer {token}\r\n")));
    let destination = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let (address, seen) = server(
        "302 Found",
        &format!(
            "Location: http://{}/private-unit-token\r\n",
            destination.local_addr().unwrap()
        ),
        "private response body",
    )
    .await;
    let error = GitHub::local(token, address)
        .unwrap()
        .get("git/ref/heads/master")
        .await
        .unwrap_err();
    seen.await.unwrap();
    assert!(
        error.contains("HTTP 302")
            && !error.contains(token)
            && !error.contains("private response body")
    );
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(50), destination.accept())
            .await
            .is_err()
    );
    let (address, seen) = server("403 Forbidden", "", "private response body").await;
    let error = GitHub::local(token, address)
        .unwrap()
        .get("git/ref/heads/master")
        .await
        .unwrap_err();
    seen.await.unwrap();
    assert!(error.contains("HTTP 403") && !error.contains("private"));
    let (address, seen) = server("200 OK", "", "not JSON private response body").await;
    let error = GitHub::local(token, address)
        .unwrap()
        .get("git/ref/heads/master")
        .await
        .unwrap_err();
    seen.await.unwrap();
    assert_eq!(error, "Invalid GitHub JSON response");
    let (address, seen) = server_size("200 OK", "", "{}", LIMIT + 1).await;
    let error = GitHub::local(token, address)
        .unwrap()
        .get("git/ref/heads/master")
        .await
        .unwrap_err();
    seen.await.unwrap();
    assert_eq!(error, "GitHub response exceeds the input limit");
    assert!(GitHub::new("private\r\nheader-injection").is_err());
}
