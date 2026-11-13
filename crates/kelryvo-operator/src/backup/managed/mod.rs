//! Managed PostgreSQL target attestation. Only fixed read queries and an owned
//! loopback tunnel are allowed; no Kubernetes mutation or workload execution.
mod kube;
mod tunnel;
use super::{Boundary, Policy, Result, files, tool, unavailable};
use base64::{Engine, engine::general_purpose::STANDARD};
use kube::Kube;
use serde_json::{Value, json};
use std::{future::Future, path::Path, pin::Pin};
use uuid::Uuid;
use zeroize::Zeroizing;

const CONTEXT: &str = "k8s-admin-public";
const NS: &str = "kelryvo";
const STS: &str = "kelryvo-postgresql";
const POD: &str = "kelryvo-postgresql-0";
const PVC: &str = "kelryvo-postgresql-data";
const IMAGE: &str = "postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f";
const VERSION: u32 = 170010;
const CONFIG_KEYS: &[&str] = &[
    "apiServer",
    "clusterCaSha256",
    "clusterContext",
    "format",
    "image",
    "imageId",
    "namespace",
    "pod",
    "podUid",
    "pv",
    "pvUid",
    "pvc",
    "pvcUid",
    "secret",
    "secretUid",
    "serverVersionNum",
    "service",
    "serviceUid",
    "statefulSet",
    "statefulSetUid",
];
const TARGET_KEYS: &[&str] = &[
    "format",
    "context",
    "apiServer",
    "clusterCaSha256",
    "database",
    "namespace",
    "statefulSetUid",
    "serviceUid",
    "podUid",
    "pvcUid",
    "pv",
    "pvUid",
    "secretUid",
    "image",
    "imageId",
    "serverVersionNum",
];
fn exact(v: &Value, keys: &[&str]) -> bool {
    v.as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}
fn uid(v: &Value) -> bool {
    v.as_str()
        .is_some_and(|s| s.len() == 36 && Uuid::parse_str(s).is_ok())
}
fn pv(v: &Value) -> bool {
    v.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 253
            && s.as_bytes()[0].is_ascii_alphanumeric()
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    })
}
fn endpoint(s: &str) -> Result<String> {
    let u = url::Url::parse(s).map_err(|_| unavailable())?;
    if u.scheme() != "https"
        || u.host_str().is_none()
        || !u.username().is_empty()
        || u.password().is_some()
        || u.query().is_some()
        || u.fragment().is_some()
        || !["", "/"].contains(&u.path())
    {
        return Err(unavailable());
    }
    Ok(u.origin().ascii_serialization())
}
fn common(v: &Value) -> bool {
    v["namespace"] == NS
        && v["image"] == IMAGE
        && v["serverVersionNum"] == VERSION
        && pv(&v["pv"])
        && super::digest(&v["clusterCaSha256"])
        && v["apiServer"]
            .as_str()
            .is_some_and(|s| endpoint(s).is_ok_and(|p| p == s))
        && v["imageId"].as_str().is_some_and(|s| {
            s.len() <= 512
                && s.contains(&format!(
                    "@{}",
                    IMAGE.split_once('@').map(|v| v.1).unwrap_or("INVALID")
                ))
        })
        && [
            "statefulSetUid",
            "serviceUid",
            "podUid",
            "pvcUid",
            "pvUid",
            "secretUid",
        ]
        .iter()
        .all(|k| uid(&v[*k]))
}
fn config(v: &Value) -> Result<()> {
    if !exact(v, CONFIG_KEYS)
        || !common(v)
        || v["format"] != "kelryvo-managed-postgresql-operator-v1"
        || v["clusterContext"] != CONTEXT
        || v["statefulSet"] != STS
        || v["service"] != STS
        || v["pod"] != POD
        || v["pvc"] != PVC
        || v["secret"] != STS
    {
        return Err(unavailable());
    }
    Ok(())
}
fn managed_target(v: &Value) -> Result<()> {
    if !exact(v, TARGET_KEYS)
        || !common(v)
        || v["format"] != "kelryvo-managed-postgresql-v1"
        || v["context"] != CONTEXT
        || v["database"] != "kelryvo"
    {
        return Err(unavailable());
    }
    Ok(())
}
pub(super) fn compatible(a: &Value, b: &Value) -> Result<bool> {
    managed_target(a)?;
    managed_target(b)?;
    Ok(TARGET_KEYS
        .iter()
        .filter(|k| !["podUid", "secretUid"].contains(k))
        .all(|k| a[*k] == b[*k]))
}
fn decode(s: &str) -> Result<Vec<u8>> {
    let b = STANDARD.decode(s).map_err(|_| unavailable())?;
    if b.is_empty() || STANDARD.encode(&b) != s {
        return Err(unavailable());
    }
    Ok(b)
}
struct Facts {
    api: String,
    ca: String,
}
fn facts(server: &str, ca: &str, ca_path: &str, insecure: &str) -> Result<Facts> {
    if !ca_path.is_empty() || !["", "false"].contains(&insecure) {
        return Err(unavailable());
    }
    Ok(Facts {
        api: endpoint(server)?,
        ca: kelryvo_core::sha256(decode(ca)?),
    })
}
struct Resources {
    sts: Value,
    svc: Value,
    pod: Value,
    pvc: Value,
    pv: Value,
    endpoints: Value,
    secret_uid: String,
    secret: Option<Value>,
}
struct Secrets {
    app: Zeroizing<String>,
    admin: Zeroizing<String>,
}
struct Live {
    identity: Value,
    secrets: Option<Secrets>,
}
fn find<'a>(values: &'a Value, key: &str, value: &str) -> Result<&'a Value> {
    values
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .find(|v| v[key] == value)
        .ok_or_else(unavailable)
}
fn verify(c: &Value, f: &Facts, r: &Resources, credentials: bool) -> Result<Live> {
    config(c)?;
    if c["apiServer"] != f.api || c["clusterCaSha256"] != f.ca {
        return Err(unavailable());
    }
    let container = find(&r.pod["spec"]["containers"], "name", "postgresql")?;
    let status = find(&r.pod["status"]["containerStatuses"], "name", "postgresql")?;
    let owner = r.pod["metadata"]["ownerReferences"]
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .find(|v| v["kind"] == "StatefulSet" && v["name"] == STS)
        .ok_or_else(unavailable)?;
    let data = find(&r.pod["spec"]["volumes"], "name", "data")?;
    let secret_refs = r.pod["spec"]["volumes"]
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .filter(|v| v["secret"]["secretName"] == STS)
        .count();
    let svc_ports = r.svc["spec"]["ports"].as_array().ok_or_else(unavailable)?;
    if svc_ports.len() != 1 || svc_ports[0]["port"] != 5432 || svc_ports[0]["protocol"] != "TCP" {
        return Err(unavailable());
    }
    if svc_ports[0]["targetPort"] != 5432
        && (svc_ports[0]["targetPort"] != "postgresql"
            || r.pod["spec"]["containers"]
                .as_array()
                .ok_or_else(unavailable)?
                .iter()
                .filter(|v| v["name"] == "postgresql")
                .count()
                != 1
            || container["ports"]
                .as_array()
                .ok_or_else(unavailable)?
                .iter()
                .filter(|p| {
                    p["name"] == "postgresql"
                        && p["containerPort"] == 5432
                        && p["protocol"] == "TCP"
                })
                .count()
                != 1)
    {
        return Err(unavailable());
    }
    let endpoint_rows = r.endpoints["subsets"]
        .as_array()
        .ok_or_else(unavailable)?
        .iter()
        .flat_map(|s| {
            s["addresses"]
                .as_array()
                .into_iter()
                .flatten()
                .map(move |a| (s, a))
        })
        .collect::<Vec<_>>();
    if endpoint_rows.len() != 1 {
        return Err(unavailable());
    }
    let (subset, address) = endpoint_rows[0];
    let ports = subset["ports"].as_array().ok_or_else(unavailable)?;
    if address["targetRef"]["uid"] != c["podUid"]
        || address["ip"] != r.pod["status"]["podIP"]
        || ports.len() != 1
        || ports[0]["port"] != 5432
        || ports[0]["protocol"] != "TCP"
    {
        return Err(unavailable());
    }
    if r.sts["metadata"]["uid"] != c["statefulSetUid"]
        || r.sts["spec"]["replicas"] != 1
        || r.sts["status"]["readyReplicas"] != 1
        || r.sts["spec"]["serviceName"] != STS
        || r.sts["spec"]["selector"]["matchLabels"]["app.kubernetes.io/component"] != "postgresql"
        || r.sts["spec"]["selector"]["matchLabels"]["app.kubernetes.io/instance"] != "kelryvo"
        || find(
            &r.sts["spec"]["template"]["spec"]["containers"],
            "name",
            "postgresql",
        )?["image"]
            != IMAGE
        || r.svc["metadata"]["uid"] != c["serviceUid"]
        || r.svc["spec"]["type"] != "ClusterIP"
        || r.svc["spec"]["selector"]["app.kubernetes.io/component"] != "postgresql"
        || r.svc["spec"]["selector"]["app.kubernetes.io/instance"] != "kelryvo"
        || r.pod["metadata"]["uid"] != c["podUid"]
        || r.pod["metadata"]["namespace"] != NS
        || r.pod["status"]["phase"] != "Running"
        || owner["uid"] != c["statefulSetUid"]
        || container["image"] != IMAGE
        || status["imageID"] != c["imageId"]
        || status["ready"] != true
        || r.pod["status"]["podIP"].as_str().is_none_or(str::is_empty)
        || data["persistentVolumeClaim"]["claimName"] != PVC
        || r.pvc["metadata"]["uid"] != c["pvcUid"]
        || r.pvc["status"]["phase"] != "Bound"
        || r.pvc["spec"]["volumeName"] != c["pv"]
        || r.pv["metadata"]["uid"] != c["pvUid"]
        || r.pv["spec"]["persistentVolumeReclaimPolicy"] != "Retain"
        || json!(r.secret_uid) != c["secretUid"]
        || secret_refs != 1
        || r.pv["spec"]["claimRef"]["namespace"] != NS
        || r.pv["spec"]["claimRef"]["name"] != PVC
        || r.pv["spec"]["claimRef"]["uid"] != c["pvcUid"]
    {
        return Err(unavailable());
    }
    let secrets = if credentials {
        let s = r.secret.as_ref().ok_or_else(unavailable)?;
        if s["metadata"]["uid"] != c["secretUid"]
            || s["type"] != "Opaque"
            || !exact(&s["data"], &["admin-password", "app-password"])
        {
            return Err(unavailable());
        }
        let password = |k: &str| -> Result<Zeroizing<String>> {
            let p = Zeroizing::new(
                String::from_utf8(decode(s["data"][k].as_str().ok_or_else(unavailable)?)?)
                    .map_err(|_| unavailable())?,
            );
            if !super::digest(&json!(p.as_str())) {
                return Err(unavailable());
            }
            Ok(p)
        };
        Some(Secrets {
            app: password("app-password")?,
            admin: password("admin-password")?,
        })
    } else {
        None
    };
    let identity = json!({"format":"kelryvo-managed-postgresql-v1","context":CONTEXT,"apiServer":f.api,"clusterCaSha256":f.ca,"database":"kelryvo","namespace":NS,"statefulSetUid":c["statefulSetUid"],"serviceUid":c["serviceUid"],"podUid":c["podUid"],"pvcUid":c["pvcUid"],"pv":c["pv"],"pvUid":c["pvUid"],"secretUid":c["secretUid"],"image":IMAGE,"imageId":c["imageId"],"serverVersionNum":VERSION});
    managed_target(&identity)?;
    Ok(Live { identity, secrets })
}
async fn context(k: &Kube) -> Result<Facts> {
    if k.run(vec!["config".into(), "current-context".into()])
        .await?
        .trim()
        != CONTEXT
    {
        return Err(unavailable());
    }
    let field = |name: &str| {
        k.run(vec![
            "config".into(),
            "view".into(),
            "--raw".into(),
            "--minify".into(),
            "--context".into(),
            CONTEXT.into(),
            "--request-timeout=10s".into(),
            "-o".into(),
            format!("jsonpath={{.clusters[0].cluster.{name}}}"),
        ])
    };
    let (server, ca, path, insecure) = tokio::try_join!(
        field("server"),
        field("certificate-authority-data"),
        field("certificate-authority"),
        field("insecure-skip-tls-verify")
    )?;
    facts(server.trim(), ca.trim(), path.trim(), insecure.trim())
}
async fn resources(k: &Kube, pv: &str, credentials: bool) -> Result<Resources> {
    let (sts, svc, pod, pvc, pv, secret_uid, endpoints) = tokio::try_join!(
        k.json("statefulset", STS, true),
        k.json("service", STS, true),
        k.json("pod", POD, true),
        k.json("pvc", PVC, true),
        k.json("pv", pv, false),
        k.secret_uid(),
        k.json("endpoints", STS, true)
    )?;
    let secret = if credentials {
        Some(k.json("secret", STS, true).await?)
    } else {
        None
    };
    Ok(Resources {
        sts,
        svc,
        pod,
        pvc,
        pv,
        endpoints,
        secret_uid: secret_uid.trim().into(),
        secret,
    })
}
async fn live(k: &Kube, c: &Value, credentials: bool) -> Result<Live> {
    config(c)?;
    let f = context(k).await?;
    if c["apiServer"] != f.api || c["clusterCaSha256"] != f.ca {
        return Err(unavailable());
    }
    verify(
        c,
        &f,
        &resources(k, c["pv"].as_str().ok_or_else(unavailable)?, credentials).await?,
        credentials,
    )
}
struct Verified<'a> {
    kube: &'a Kube,
    config: &'a Value,
    identity: Value,
}
impl Boundary for Verified<'_> {
    fn verify(&self) -> Pin<Box<dyn Future<Output = Result<()>> + Send + '_>> {
        Box::pin(async {
            if live(self.kube, self.config, false).await?.identity != self.identity {
                return Err(unavailable());
            }
            Ok(())
        })
    }
    fn identity(&self) -> Option<&Value> {
        Some(&self.identity)
    }
    fn policy(&self, p: &Policy) -> Result<()> {
        if p.database != "kelryvo" || p.role != "kelryvo" || p.server_version_num != VERSION {
            return Err(unavailable());
        }
        Ok(())
    }
}
pub async fn attest(root: &Path, output: &Path) -> Result<Value> {
    super::operator()?;
    let k = Kube::read(root)?;
    let f = context(&k).await?;
    let pvc = k.json("pvc", PVC, true).await?;
    if !pv(&pvc["spec"]["volumeName"]) {
        return Err(unavailable());
    }
    let r = resources(
        &k,
        pvc["spec"]["volumeName"].as_str().ok_or_else(unavailable)?,
        false,
    )
    .await?;
    let image =
        find(&r.pod["status"]["containerStatuses"], "name", "postgresql")?["imageID"].clone();
    let c = json!({"format":"kelryvo-managed-postgresql-operator-v1","clusterContext":CONTEXT,"apiServer":f.api,"clusterCaSha256":f.ca,"namespace":NS,"statefulSet":STS,"statefulSetUid":r.sts["metadata"]["uid"],"service":STS,"serviceUid":r.svc["metadata"]["uid"],"pod":POD,"podUid":r.pod["metadata"]["uid"],"pvc":PVC,"pvcUid":r.pvc["metadata"]["uid"],"pv":pvc["spec"]["volumeName"],"pvUid":r.pv["metadata"]["uid"],"secret":STS,"secretUid":r.secret_uid,"image":IMAGE,"imageId":image,"serverVersionNum":VERSION});
    live(&k, &c, false).await?;
    files::write(output, &super::encoded(&c)?)?;
    Ok(json!({"output":output,"executionAuthority":false,"releaseApproved":false}))
}
pub async fn run(
    root: &Path,
    action: &str,
    attestation: &Path,
    arguments: &[String],
) -> Result<Value> {
    super::operator()?;
    if !["managed-policy", "managed-backup", "managed-restore"].contains(&action)
        || arguments.len() != if action == "managed-policy" { 3 } else { 2 }
    {
        return Err(unavailable());
    }
    let c: Value =
        serde_json::from_slice(&files::read(attestation, 16384)?).map_err(|_| unavailable())?;
    config(&c)?;
    let k = Kube::read(root)?;
    let captured = live(&k, &c, true).await?;
    let boundary = Verified {
        kube: &k,
        config: &c,
        identity: captured.identity,
    };
    let secrets = captured.secrets.ok_or_else(unavailable)?;
    let mut forward = tunnel::Tunnel::start(&k).await?;
    let source = Zeroizing::new(format!(
        "postgresql://kelryvo:{}@127.0.0.1:{}/kelryvo",
        secrets.app.as_str(),
        forward.port
    ));
    let admin = Zeroizing::new(format!(
        "postgresql://postgres:{}@127.0.0.1:{}/kelryvo",
        secrets.admin.as_str(),
        forward.port
    ));
    let result = async {
        boundary.verify().await?;
        if action == "managed-policy" {
            return super::attest_in_context(
                &source,
                Path::new(&arguments[0]),
                Path::new(&arguments[1]),
                Path::new(&arguments[2]),
                &boundary,
            )
            .await;
        }
        let raw = Zeroizing::new(files::read(&root.join("postgresql-backup-policy"), 16384)?);
        let policy = Policy::parse(std::str::from_utf8(&raw).map_err(|_| unavailable())?)?;
        if action == "managed-backup" {
            super::create_in_context(
                &source,
                &policy,
                Path::new(&arguments[0]),
                Path::new(&arguments[1]),
                &boundary,
            )
            .await
        } else {
            super::restore::restore(
                &source,
                &admin,
                &policy,
                Path::new(&arguments[0]),
                Path::new(&arguments[1]),
                &boundary,
            )
            .await
        }
    }
    .await;
    forward.stop().await?;
    result
}

#[cfg(test)]
mod tests;
