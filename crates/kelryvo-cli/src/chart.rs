//! Read-only Helm chart policy. All retained rendering cases, storage/security
//! boundaries and native prerequisites are checked without Kubernetes access.
use serde_json::{Value, json};
use std::{collections::BTreeSet, ffi::OsString, fs, path::Path, time::Duration};
use yaml_rust2::{
    Yaml, YamlLoader,
    parser::{Event, MarkedEventReceiver, Parser},
    scanner::{Marker, TScalarStyle},
};
type Result<T> = std::result::Result<T, String>;

fn yaml(value: &Yaml) -> Result<Value> {
    Ok(match value {
        Yaml::Null => Value::Null,
        Yaml::Boolean(v) => json!(v),
        Yaml::Integer(v) => json!(v),
        Yaml::Real(v) => serde_json::from_str(v).map_err(|_| "Invalid YAML number")?,
        Yaml::String(v) => json!(v),
        Yaml::Array(v) => Value::Array(v.iter().map(yaml).collect::<Result<_>>()?),
        Yaml::Hash(v) => {
            let mut map = serde_json::Map::new();
            for (k, v) in v {
                map.insert(
                    k.as_str().ok_or("YAML object keys must be strings")?.into(),
                    yaml(v)?,
                );
            }
            Value::Object(map)
        }
        _ => return Err("Unresolved YAML alias or invalid value".into()),
    })
}
fn documents(text: &str) -> Result<Vec<Value>> {
    if text.len() > 16 * 1024 * 1024 {
        return Err("Unbounded Helm rendering".into());
    }
    // Helm's Kubernetes YAML uses YAML 1.1 permission scalars such as 0400.
    // Validate the original syntax/duplicate keys, then normalize only plain
    // octal scalar events. Quoted values and embedded script text stay strings.
    YamlLoader::load_from_str(text).map_err(|e| format!("Invalid rendered YAML: {e}"))?;
    struct KubernetesYaml(YamlLoader);
    impl MarkedEventReceiver for KubernetesYaml {
        fn on_event(&mut self, event: Event, marker: Marker) {
            let event = match event {
                Event::Scalar(value, TScalarStyle::Plain, anchor, None)
                    if value.len() > 1
                        && value.starts_with('0')
                        && value.bytes().all(|b| matches!(b, b'0'..=b'7')) =>
                {
                    Event::Scalar(
                        format!("0o{}", &value[1..]),
                        TScalarStyle::Plain,
                        anchor,
                        None,
                    )
                }
                value => value,
            };
            self.0.on_event(event, marker);
        }
    }
    let mut loader = KubernetesYaml(YamlLoader::default());
    Parser::new(text.chars())
        .load(&mut loader, true)
        .map_err(|e| format!("Invalid Kubernetes YAML: {e}"))?;
    loader.0.documents().iter().map(yaml).collect()
}
fn require(valid: bool, label: &str) -> Result<()> {
    if valid {
        Ok(())
    } else {
        Err(format!("Chart policy failed: {label}"))
    }
}
fn equal(actual: &Value, expected: Value, label: &str) -> Result<()> {
    require(actual == &expected, label)
}
fn array(value: &Value) -> Result<&Vec<Value>> {
    value
        .as_array()
        .ok_or_else(|| "Chart policy expected an array".into())
}
fn named<'a>(resources: &'a [Value], kind: &str, name: &str) -> Result<&'a Value> {
    let found: Vec<_> = resources
        .iter()
        .filter(|r| r["kind"] == kind && r["metadata"]["name"] == name)
        .collect();
    require(found.len() == 1, "resource name must be unique")?;
    Ok(found[0])
}
fn member<'a>(values: &'a Value, name: &str) -> Result<&'a Value> {
    let found: Vec<_> = array(values)?
        .iter()
        .filter(|v| v["name"] == name)
        .collect();
    require(found.len() == 1, "named member must be unique")?;
    Ok(found[0])
}
fn keys(values: &Value, key: &str) -> Result<BTreeSet<String>> {
    array(values)?
        .iter()
        .map(|v| {
            v[key]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "Missing chart field".into())
        })
        .collect()
}
fn strings(values: &Value) -> Result<BTreeSet<String>> {
    array(values)?
        .iter()
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .ok_or_else(|| "Missing chart string".into())
        })
        .collect()
}
fn env(container: &Value, key: &str) -> Result<Value> {
    Ok(member(&container["env"], key)?["value"].clone())
}
fn has_env(container: &Value, key: &str) -> Result<bool> {
    Ok(array(&container["env"])?.iter().any(|v| v["name"] == key))
}
fn pod(resources: &[Value]) -> Result<&Value> {
    Ok(&named(resources, "Deployment", "kelryvo-app")?["spec"]["template"]["spec"])
}
fn egress(resources: &[Value]) -> Result<&Vec<Value>> {
    array(&named(resources, "NetworkPolicy", "kelryvo-app")?["spec"]["egress"])
}
fn subset(expected: &Value, actual: &Value) -> bool {
    match expected {
        Value::Object(e) => actual.as_object().is_some_and(|a| {
            e.iter()
                .all(|(k, v)| a.get(k).is_some_and(|a| subset(v, a)))
        }),
        Value::Array(e) => actual
            .as_array()
            .is_some_and(|a| e.len() == a.len() && e.iter().zip(a).all(|(e, a)| subset(e, a))),
        _ => expected == actual,
    }
}
struct Chart<'a>(&'a Path);
impl Chart<'_> {
    async fn helm(&self, args: &[&str], success: bool) -> Result<String> {
        let program = if Path::new("/usr/local/bin/helm").is_file() {
            Path::new("/usr/local/bin/helm")
        } else {
            Path::new("/usr/bin/helm")
        };
        let argv: Vec<OsString> = args.iter().map(OsString::from).collect();
        let output = crate::delivery::copy::capture_at(
            program,
            &argv,
            Duration::from_secs(120),
            Some(self.0),
        )
        .await?;
        require(output.success == success, "Helm render/lint result")?;
        String::from_utf8(output.stdout.to_vec()).map_err(|_| "Invalid Helm UTF-8 output".into())
    }
    async fn render(&self, args: &[&str], success: bool) -> Result<Vec<Value>> {
        let mut argv = vec!["template", "kelryvo", ".", "--namespace", "kelryvo"];
        argv.extend(args);
        let text = self.helm(&argv, success).await?;
        if success {
            documents(&text)
        } else {
            Ok(vec![])
        }
    }
}

pub(crate) async fn validate(root: &Path, require_native: bool) -> Result<()> {
    require(
        root.is_absolute() && root.canonicalize().map_err(|e| e.to_string())? == root,
        "canonical chart checkout",
    )?;
    crate::hygiene::check(root)?;
    let authored = json!({"containers":[{"name":"postgresql","image":"tested@sha256:fixture","ports":[{"containerPort":5432}]}]});
    let defaulted = json!({"containers":[{"name":"postgresql","image":"tested@sha256:fixture","imagePullPolicy":"IfNotPresent","ports":[{"containerPort":5432,"protocol":"TCP"}]}]});
    require(
        subset(&authored, &defaulted),
        "authored fields allow Kubernetes defaults",
    )?;
    for unsafe_value in [
        json!({"containers":[defaulted["containers"][0],{"name":"extra"}]}),
        json!({"containers":[{"name":"postgresql","image":"changed","ports":[{"containerPort":5432}]}]}),
        json!({"containers":[{"name":"postgresql","image":"tested@sha256:fixture","ports":[{"containerPort":6432}]}]}),
    ] {
        require(
            !subset(&authored, &unsafe_value),
            "authored spec refuses extra containers or changed image/port",
        )?;
    }
    let chart = Chart(root);
    chart.helm(&["lint", "--strict", "."], true).await?;
    let resources = chart.render(&[], true).await?;
    let pvc = named(
        &resources,
        "PersistentVolumeClaim",
        "kelryvo-postgresql-data",
    )?;
    equal(
        &pvc["spec"]["resources"]["requests"]["storage"],
        json!("2Gi"),
        "PostgreSQL storage",
    )?;
    equal(
        &pvc["spec"]["accessModes"],
        json!(["ReadWriteOnce"]),
        "PostgreSQL access mode",
    )?;
    equal(
        &pvc["spec"]["storageClassName"],
        json!("longhorn-workers"),
        "PostgreSQL storage class",
    )?;
    require(
        pvc["spec"].get("volumeName").is_none(),
        "default PVC cannot bind an inferred PV",
    )?;
    equal(
        &pvc["metadata"]["annotations"]["helm.sh/resource-policy"],
        json!("keep"),
        "retained PVC",
    )?;
    let options = pvc["metadata"]["annotations"]["argocd.argoproj.io/sync-options"]
        .as_str()
        .ok_or("PVC sync options")?
        .split(',')
        .collect::<BTreeSet<_>>();
    require(
        options == BTreeSet::from(["Prune=false", "Delete=false"]),
        "PVC prune/delete protection",
    )?;
    let pg = named(&resources, "StatefulSet", "kelryvo-postgresql")?;
    equal(
        &pg["spec"]["persistentVolumeClaimRetentionPolicy"],
        json!({"whenDeleted":"Retain","whenScaled":"Retain"}),
        "PG claim retention",
    )?;
    equal(
        &pg["spec"]["updateStrategy"]["type"],
        json!("OnDelete"),
        "PG update strategy",
    )?;
    equal(
        &pg["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"],
        pvc["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"].clone(),
        "PG/PVC sync wave",
    )?;
    require(
        array(&pg["spec"]["template"]["spec"]["initContainers"][0]["volumeMounts"])?
            .iter()
            .all(|v| v["name"] == "secrets"),
        "PG initializer only mounts secrets",
    )?;
    equal(
        &pg["spec"]["template"]["spec"]["volumes"][0]["persistentVolumeClaim"]["claimName"],
        pvc["metadata"]["name"].clone(),
        "PG stable claim",
    )?;
    let bound = chart
        .render(
            &[
                "--set",
                "postgresql.volumeName=pvc-01234567-89ab-cdef-0123-456789abcdef",
            ],
            true,
        )
        .await?;
    let mut bound =
        named(&bound, "PersistentVolumeClaim", "kelryvo-postgresql-data")?["spec"].clone();
    equal(
        &bound["volumeName"],
        json!("pvc-01234567-89ab-cdef-0123-456789abcdef"),
        "explicit PV binding",
    )?;
    bound
        .as_object_mut()
        .ok_or("Bound PVC spec")?
        .remove("volumeName");
    equal(&bound, pvc["spec"].clone(), "binding preserves PVC")?;
    chart
        .render(&["--set", "postgresql.volumeName=not/a/pv"], false)
        .await?;
    let deployments: Vec<_> = resources
        .iter()
        .filter(|r| r["kind"] == "Deployment")
        .map(|r| r["metadata"]["name"].clone())
        .collect();
    require(
        deployments == vec![json!("kelryvo-app")],
        "single runtime deployment",
    )?;
    let app = named(&resources, "Deployment", "kelryvo-app")?;
    equal(&app["spec"]["replicas"], json!(1), "single replica")?;
    equal(
        &app["spec"]["strategy"],
        json!({"type":"Recreate"}),
        "Recreate runtime",
    )?;
    equal(
        &app["spec"]["selector"]["matchLabels"],
        json!({"app.kubernetes.io/component":"app","app.kubernetes.io/instance":"kelryvo"}),
        "app selector",
    )?;
    let p = pod(&resources)?;
    equal(
        &p["automountServiceAccountToken"],
        json!(false),
        "no service-account token",
    )?;
    equal(
        &p["securityContext"]["runAsUser"],
        json!(0),
        "runtime supervisor UID",
    )?;
    equal(
        &p["securityContext"]["runAsGroup"],
        json!(0),
        "runtime supervisor GID",
    )?;
    require(
        p["securityContext"].get("runAsNonRoot").is_none(),
        "runtime root supervisor",
    )?;
    require(array(&p["containers"])?.len() == 1, "single app container")?;
    let c = &p["containers"][0];
    require(
        c["image"]
            .as_str()
            .is_some_and(|s| s.starts_with("docker.io/longhn0710t/kelryvo-pilot@sha256:")),
        "digest-pinned app image",
    )?;
    equal(&p["imagePullSecrets"], Value::Null, "public image pull")?;
    equal(
        &c["command"],
        json!(["/opt/kelryvo/bin/kelryvo-runtime"]),
        "native runtime command",
    )?;
    let security = &c["securityContext"];
    equal(
        &security["allowPrivilegeEscalation"],
        json!(false),
        "no privilege escalation",
    )?;
    equal(
        &security["readOnlyRootFilesystem"],
        json!(true),
        "read-only root",
    )?;
    equal(
        &security["capabilities"]["drop"],
        json!(["ALL"]),
        "drop capabilities",
    )?;
    require(
        strings(&security["capabilities"]["add"])?
            == BTreeSet::from_iter(["CHOWN", "SETUID", "SETGID", "KILL"].map(String::from)),
        "runtime capabilities",
    )?;
    equal(
        &env(c, "KELRYVO_SECRET_DIR")?,
        json!("/run/kelryvo/secrets/..data"),
        "projected secret source",
    )?;
    for name in ["KELRYVO_EXECUTION_ENABLED", "KELRYVO_DISCOVERY_ENABLED"] {
        equal(&env(c, name)?, json!("false"), "Oracle disabled by default")?;
    }
    require(
        !has_env(c, "KELRYVO_INSTALLATION_DIR")?,
        "default has no installation authority",
    )?;
    let projection = &member(&p["volumes"], "secrets")?["projected"];
    equal(
        &projection["defaultMode"],
        json!(256),
        "private secret mode",
    )?;
    let items: Vec<_> = [
        "database-url",
        "developer-token",
        "approver-token",
        "tls.crt",
        "tls.key",
    ]
    .iter()
    .map(|name| json!({"key":name,"path":name}))
    .collect();
    equal(
        &projection["sources"],
        json!([{"secret":{"name":"kelryvo-app","items":items}}]),
        "exact app secret inputs",
    )?;
    let mounts = &c["volumeMounts"];
    equal(
        &member(mounts, "secrets")?["mountPath"],
        json!("/run/kelryvo/secrets"),
        "secret mount",
    )?;
    equal(
        &member(mounts, "secrets")?["readOnly"],
        json!(true),
        "read-only secret",
    )?;
    equal(
        &member(mounts, "runtime")?["mountPath"],
        json!("/run/kelryvo/runtime"),
        "runtime staging mount",
    )?;
    for name in ["runtime", "tmp"] {
        equal(
            &member(&p["volumes"], name)?["emptyDir"]["medium"],
            json!("Memory"),
            "memory staging",
        )?;
    }
    require(
        !resources.iter().any(|r| {
            r["kind"] == "Secret"
                || (["Deployment", "Service"].contains(&r["kind"].as_str().unwrap_or(""))
                    && r["metadata"]["name"]
                        .as_str()
                        .is_some_and(|v| v.contains("worker")))
        }),
        "no authored Secrets or separate worker service",
    )?;
    equal(
        &named(&resources, "Service", "kelryvo-app")?["spec"]["selector"],
        app["spec"]["selector"]["matchLabels"].clone(),
        "service selector",
    )?;
    let ingress = named(&resources, "Ingress", "kelryvo")?;
    equal(
        &ingress["metadata"]["annotations"]["nginx.ingress.kubernetes.io/backend-protocol"],
        json!("HTTPS"),
        "ingress HTTPS",
    )?;
    equal(
        &ingress["metadata"]["annotations"]["nginx.ingress.kubernetes.io/proxy-ssl-verify"],
        json!("on"),
        "ingress upstream verification",
    )?;
    require(
        ingress["spec"]["tls"][0].get("secretName").is_none(),
        "no inferred ingress TLS Secret",
    )?;
    equal(
        &named(&resources, "NetworkPolicy", "kelryvo-default-deny")?["spec"]["podSelector"],
        json!({}),
        "namespace default deny",
    )?;
    let hp = &named(&resources, "CiliumNetworkPolicy", "kelryvo-host-ingress")?["spec"];
    equal(
        &hp["endpointSelector"]["matchLabels"]["app.kubernetes.io/component"],
        json!("app"),
        "host ingress selector",
    )?;
    equal(
        &hp["ingress"][0]["fromEntities"],
        json!(["host", "remote-node"]),
        "host ingress entities",
    )?;
    equal(
        &hp["ingress"][0]["toPorts"][0]["ports"],
        json!([{"port":"8443","protocol":"TCP"}]),
        "host ingress HTTPS port",
    )?;
    require(hp.get("egress").is_none(), "no default host egress")?;
    require(
        egress(&resources)?
            .iter()
            .all(|r| r["to"][0]["ipBlock"].is_null()),
        "no default IP egress",
    )?;
    chart.render(&["--set", "worker.replicas=0"], true).await?;
    for value in ["1", "-1", "0.5"] {
        chart
            .render(&["--set", &format!("worker.replicas={value}")], false)
            .await?;
    }
    chart
        .render(&["--set", "execution.enabled=true"], false)
        .await?;
    chart
        .render(
            &[
                "--set",
                "execution.enabled=true",
                "--set",
                "execution.secretName=kelryvo-installation",
            ],
            false,
        )
        .await?;
    let execution = [
        "--set",
        "execution.enabled=true",
        "--set",
        "discovery.enabled=true",
        "--set",
        "execution.secretName=kelryvo-installation",
        "--set",
        "networkPolicy.oracleCIDRs[0]=192.0.2.16/32",
    ];
    let enabled = chart.render(&execution, true).await?;
    installation(pod(&enabled)?, true)?;
    require(
        egress(&enabled)?.iter().any(|r| {
            r["to"][0]["ipBlock"]["cidr"] == "192.0.2.16/32"
                && r["ports"] == json!([{"protocol":"TCP","port":1521}])
        }),
        "explicit Oracle TCP egress",
    )?;
    chart
        .render(
            &[
                "--set",
                "execution.enabled=true",
                "--set",
                "execution.secretName=kelryvo-installation",
                "--set",
                "networkPolicy.oracleCIDRs[0]=192.0.2.16/32",
                "--set",
                "networkPolicy.enabled=false",
            ],
            false,
        )
        .await?;
    let retained = chart
        .render(
            &["--set", "execution.secretName=kelryvo-installation"],
            true,
        )
        .await?;
    installation(pod(&retained)?, false)?;
    require(
        !egress(&retained)?
            .iter()
            .any(|r| r["to"][0]["ipBlock"]["cidr"] == "192.0.2.16/32"),
        "retained installation has no Oracle egress",
    )?;
    identity_checks(&chart).await?;
    for (args, wanted) in [
        (vec!["--set", "imagePullSecret="], Value::Null),
        (
            vec!["--set", "imagePullSecret=private-registry"],
            json!([{"name":"private-registry"}]),
        ),
    ] {
        equal(
            &pod(&chart.render(&args, true).await?)?["imagePullSecrets"],
            wanted,
            "explicit image pull secret",
        )?;
    }
    let external = chart
        .render(
            &[
                "--set",
                "postgresql.enabled=false",
                "--set",
                "networkPolicy.enabled=false",
            ],
            true,
        )
        .await?;
    require(
        !external.iter().any(|r| {
            ["StatefulSet", "PersistentVolumeClaim"].contains(&r["kind"].as_str().unwrap_or(""))
        }),
        "external PostgreSQL creates no storage",
    )?;
    overlays(&chart, pvc).await?;
    managed(&chart, pvc, require_native).await?;
    println!(
        "PASS: retained chart rendering, storage, Secret/role/network/Argo boundaries and explicit native prerequisites; no cluster or Oracle access"
    );
    Ok(())
}

fn installation(p: &Value, enabled: bool) -> Result<()> {
    let c = &p["containers"][0];
    for name in ["KELRYVO_EXECUTION_ENABLED", "KELRYVO_DISCOVERY_ENABLED"] {
        equal(
            &env(c, name)?,
            json!(enabled.to_string()),
            "explicit Oracle enablement",
        )?;
    }
    equal(
        &env(c, "KELRYVO_INSTALLATION_DIR")?,
        json!("/run/kelryvo/installation/..data"),
        "private installation location",
    )?;
    let volume = member(&p["volumes"], "installation")?;
    equal(
        &volume["secret"]["secretName"],
        json!("kelryvo-installation"),
        "installation Secret name",
    )?;
    equal(
        &volume["secret"]["defaultMode"],
        json!(256),
        "installation Secret mode",
    )?;
    require(
        array(&c["volumeMounts"])?.contains(
            &json!({"name":"installation","mountPath":"/run/kelryvo/installation","readOnly":true}),
        ),
        "read-only installation mount",
    )
}
async fn identity_checks(chart: &Chart<'_>) -> Result<()> {
    chart
        .render(&["--set", "identity.enabled=true"], false)
        .await?;
    chart
        .render(
            &[
                "--set",
                "identity.enabled=true",
                "--set",
                "identity.egressCIDRs[0]=192.0.2.16/32",
                "--set",
                "networkPolicy.enabled=false",
            ],
            false,
        )
        .await?;
    let r = chart
        .render(
            &[
                "--set",
                "identity.enabled=true",
                "--set",
                "identity.secretName=kelryvo-identity-runtime",
                "--set",
                "identity.egressCIDRs[0]=192.0.2.16/32",
                "--set",
                "identity.podEgressPeers[0].namespace=kelryvo-identity-lab",
                "--set",
                r"identity.podEgressPeers[0].podSelector.app\.kubernetes\.io/name=kelryvo-ldap",
                "--set",
                "identity.podEgressPeers[0].port=6360",
                "--set",
                "identity.ciliumHostNetworkEgress=true",
            ],
            true,
        )
        .await?;
    let projection = &member(&pod(&r)?["volumes"], "secrets")?["projected"];
    equal(
        &projection["sources"][0]["secret"]["name"],
        json!("kelryvo-app"),
        "identity retains app secret",
    )?;
    equal(
        &projection["sources"][1]["secret"],
        json!({"name":"kelryvo-identity-runtime","items":[{"key":"identity-runtime.json","path":"identity-runtime.json"}]}),
        "identity private projection",
    )?;
    equal(
        &projection["defaultMode"],
        json!(256),
        "identity private mode",
    )?;
    require(
        egress(&r)?.iter().any(|r| {
            r["to"][0]["ipBlock"]["cidr"] == "192.0.2.16/32"
                && r["ports"]
                    == json!([{"protocol":"TCP","port":443},{"protocol":"TCP","port":636}])
        }),
        "identity TLS egress",
    )?;
    require(
        egress(&r)?.iter().any(|r| {
            r["to"][0]["namespaceSelector"]["matchLabels"]["kubernetes.io/metadata.name"]
                == "kelryvo-identity-lab"
                && r["to"][0]["podSelector"]["matchLabels"]
                    == json!({"app.kubernetes.io/name":"kelryvo-ldap"})
                && r["ports"] == json!([{"protocol":"TCP","port":6360}])
        }),
        "scoped identity pod egress",
    )?;
    let hp = &named(&r, "CiliumNetworkPolicy", "kelryvo-host-ingress")?["spec"];
    equal(
        &hp["egress"][0]["toEntities"],
        json!(["kube-apiserver"]),
        "identity host entities",
    )?;
    equal(
        &hp["egress"][0]["toPorts"][0]["ports"],
        json!([{"port":"443","protocol":"TCP"}]),
        "identity host TLS port",
    )
}

async fn overlays(chart: &Chart<'_>, pvc: &Value) -> Result<()> {
    let text =
        fs::read_to_string(chart.0.join("argocd/kelryvo.yaml")).map_err(|e| e.to_string())?;
    let docs = documents(&text)?;
    require(docs.len() == 2, "Argo project/application documents")?;
    let project = &docs[0];
    let application = &docs[1];
    equal(
        &project["spec"]["clusterResourceWhitelist"],
        json!([]),
        "no cluster resources",
    )?;
    equal(
        &project["spec"]["destinations"],
        json!([{"namespace":"kelryvo","server":"https://kubernetes.default.svc"}]),
        "Argo namespace boundary",
    )?;
    equal(
        &application["spec"]["syncPolicy"]["automated"],
        json!({"prune":false,"selfHeal":true,"allowEmpty":false}),
        "non-pruning Argo ownership",
    )?;
    require(
        application["metadata"]["finalizers"].is_null()
            || application["metadata"]["finalizers"] == json!([]),
        "no Argo deletion finalizer",
    )?;
    equal(
        &application["spec"]["ignoreDifferences"][0]["jsonPointers"],
        json!(["/spec/template/metadata/annotations/kubectl.kubernetes.io~1restartedAt"]),
        "safe restart timestamp",
    )?;
    let r = chart
        .render(&["-f", "values.development.yaml"], true)
        .await?;
    let p = pod(&r)?;
    let c = &p["containers"][0];
    require(
        r.iter().filter(|r| r["kind"] == "Deployment").count() == 1
            && array(&p["containers"])?.len() == 1,
        "single development runtime",
    )?;
    equal(
        &p["nodeSelector"],
        json!({"kubernetes.io/arch":"amd64"}),
        "AMD64 development runtime",
    )?;
    equal(
        &c["image"],
        json!(
            "docker.io/longhn0710t/kelryvo-pilot@sha256:afe222f97fddcf69e91ce0f2127afb55eaadd6a09b85ac8f3098c285f57775ec"
        ),
        "retained development image",
    )?;
    equal(
        &p["imagePullSecrets"],
        Value::Null,
        "development public pull",
    )?;
    for name in ["KELRYVO_EXECUTION_ENABLED", "KELRYVO_DISCOVERY_ENABLED"] {
        equal(
            &env(c, name)?,
            json!("false"),
            "development Oracle disabled",
        )?;
    }
    equal(
        &c["command"],
        json!(["/opt/kelryvo/bin/kelryvo-runtime"]),
        "development native command",
    )?;
    equal(
        named(&r, "PersistentVolumeClaim", "kelryvo-postgresql-data")?,
        pvc.clone(),
        "development retained PVC",
    )?;
    equal(
        &application["spec"]["source"]["helm"]["valueFiles"],
        json!(["values.customer-oracle26.yaml"]),
        "customer Argo overlay",
    )
}

async fn managed(chart: &Chart<'_>, pvc: &Value, require_native: bool) -> Result<()> {
    let args = [
        "--set",
        "execution.enabled=true",
        "--set",
        "discovery.enabled=true",
        "--set",
        "execution.secretName=kelryvo-managed-bootstrap",
        "--set",
        "networkPolicy.oracleCIDRs[0]=192.0.2.16/32",
        "--set",
        "oracleRuntime.enabled=true",
        "--set",
        "oracleRuntime.secretName=kelryvo-oracle-private",
    ];
    chart.render(&args, false).await?;
    let args = [
        args.as_slice(),
        &["--set", r"app.nodeSelector.kubernetes\.io/arch=amd64"],
    ]
    .concat();
    let r = chart.render(&args, true).await?;
    let p = pod(&r)?;
    equal(
        &json!(
            array(&p["containers"])?
                .iter()
                .map(|c| c["name"].clone())
                .collect::<Vec<_>>()
        ),
        json!(["app", "oracle-operator"]),
        "managed role containers",
    )?;
    equal(
        &p["automountServiceAccountToken"],
        json!(false),
        "managed no service-account token",
    )?;
    let operator = &p["containers"][1];
    equal(
        &operator["securityContext"]["capabilities"],
        json!({"drop":["ALL"],"add":["CHOWN","DAC_OVERRIDE"]}),
        "managed operator capabilities",
    )?;
    equal(
        &operator["securityContext"]["readOnlyRootFilesystem"],
        json!(true),
        "managed operator read-only root",
    )?;
    require(
        operator.get("ports").is_none(),
        "operator has no listening port",
    )?;
    private_mounts(&p["containers"][0])?;
    equal(
        &member(&p["containers"][0]["volumeMounts"], "oracle-state")?["subPath"],
        json!("witness"),
        "API witness-only state",
    )?;
    let secret = &member(&p["volumes"], "oracle-private")?["secret"];
    equal(
        &secret["defaultMode"],
        json!(256),
        "operator private secret mode",
    )?;
    require(
        keys(&secret["items"], "key")?
            == BTreeSet::from_iter(["policy.json", "oracle-vault-private.pem"].map(String::from)),
        "managed private key boundary",
    )?;
    equal(
        &member(&p["volumes"], "secrets")?["projected"]["sources"][1]["secret"]["items"],
        json!([{"key":"oracle-vault-public.pem","path":"oracle-vault-public.pem"}]),
        "API public key only",
    )?;
    let state = named(&r, "PersistentVolumeClaim", "kelryvo-oracle-state")?;
    equal(
        &state["metadata"]["annotations"]["helm.sh/resource-policy"],
        json!("keep"),
        "retained Oracle witness",
    )?;
    require(
        array(&p["initContainers"])?.len() == 1,
        "single managed init container",
    )?;
    equal(&state["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"],named(&r,"Deployment","kelryvo-app")?["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"].clone(),"state/app sync wave")?;
    let customer = chart
        .render(&["-f", "values.customer-oracle26.yaml"], true)
        .await?;
    let cp = pod(&customer)?;
    equal(
        &cp["nodeSelector"],
        json!({"kubernetes.io/arch":"amd64"}),
        "customer AMD64",
    )?;
    equal(
        &json!(
            array(&cp["containers"])?
                .iter()
                .map(|c| c["name"].clone())
                .collect::<Vec<_>>()
        ),
        json!(["app", "oracle-operator"]),
        "customer roles",
    )?;
    equal(
        named(
            &customer,
            "PersistentVolumeClaim",
            "kelryvo-postgresql-data",
        )?,
        pvc.clone(),
        "customer retained PG PVC",
    )?;
    // An older chart can be validated for legacy promotion. Once the native
    // schema key exists, every explicit prerequisite/failure case is mandatory.
    let values =
        documents(&fs::read_to_string(chart.0.join("values.yaml")).map_err(|e| e.to_string())?)?;
    if require_native
        || values
            .first()
            .is_some_and(|v| v["oracleRuntime"].get("native").is_some())
    {
        native(chart, &args, p, operator, pvc, state).await?;
    }
    Ok(())
}
fn private_mounts(container: &Value) -> Result<()> {
    require(
        array(&container["volumeMounts"])?
            .iter()
            .all(|m| m["name"] != "oracle-private" && m["name"] != "oracle-metadata"),
        "API cannot mount private operator inputs",
    )
}
async fn native(
    chart: &Chart<'_>,
    args: &[&str],
    managed: &Value,
    operator: &Value,
    pvc: &Value,
    state: &Value,
) -> Result<()> {
    let args = [args, &["--set", "oracleRuntime.native=true"]].concat();
    chart.render(&args, false).await?;
    let prerequisites = [
        "--set",
        "oracleRuntime.nativeRuntimeClaimName=kelryvo-native-prerequisites",
    ];
    let state_args = [
        "--set",
        "oracleRuntime.nativeStateClaimName=kelryvo-native-state",
    ];
    chart
        .render(&[args.as_slice(), &prerequisites].concat(), false)
        .await?;
    chart
        .render(&[args.as_slice(), &state_args].concat(), false)
        .await?;
    let ready = [args.as_slice(), &prerequisites, &state_args].concat();
    let r = chart.render(&ready, true).await?;
    let p = pod(&r)?;
    let init = &p["initContainers"][0];
    let controller = &p["containers"][1];
    equal(
        &init["command"],
        json!(["/opt/kelryvo/bin/kelryvo-worker", "installation-init-state"]),
        "native installation init",
    )?;
    equal(
        &init["args"],
        json!(["/var/lib/kelryvo/operator", "/opt/kelryvo/oracle"]),
        "native init paths",
    )?;
    equal(
        &init["securityContext"]["capabilities"],
        json!({"drop":["ALL"],"add":["CHOWN"]}),
        "native init capability",
    )?;
    equal(
        &controller["command"],
        json!(["/opt/kelryvo/bin/kelryvo-worker", "installation-watch"]),
        "native controller command",
    )?;
    equal(
        &controller["args"],
        json!(["/run/kelryvo/operator/input/..data/controller.json"]),
        "native controller input",
    )?;
    equal(
        &controller["securityContext"],
        operator["securityContext"].clone(),
        "controller security retained",
    )?;
    equal(
        &p["containers"][0]["securityContext"],
        managed["containers"][0]["securityContext"].clone(),
        "app security retained",
    )?;
    equal(
        &p["automountServiceAccountToken"],
        json!(false),
        "native no service-account token",
    )?;
    equal(
        &member(&p["volumes"], "oracle-state")?["persistentVolumeClaim"],
        json!({"claimName":"kelryvo-native-state"}),
        "explicit native state claim",
    )?;
    equal(
        &member(&p["volumes"], "oracle-native-runtime")?["persistentVolumeClaim"],
        json!({"claimName":"kelryvo-native-prerequisites","readOnly":true}),
        "read-only native prerequisite claim",
    )?;
    for role in [init, &p["containers"][0], controller] {
        require(
            [
                "/opt/kelryvo/bin/kelryvo-worker",
                "/opt/kelryvo/bin/kelryvo-runtime",
            ]
            .contains(&role["command"][0].as_str().unwrap_or("")),
            "native role executable",
        )?;
        require(array(&role["volumeMounts"] )?.contains(&json!({"name":"oracle-native-runtime","mountPath":"/opt/kelryvo/oracle","readOnly":true})),"native prerequisites mounted read-only")?;
    }
    let private = &member(&p["volumes"], "oracle-private")?["secret"];
    equal(
        &private["defaultMode"],
        json!(256),
        "native private secret mode",
    )?;
    let expected = BTreeSet::from_iter(
        [
            "policy.json",
            "oracle-vault-private.pem",
            "controller.json",
            "installation-template.json",
        ]
        .map(String::from),
    );
    require(
        keys(&private["items"], "key")? == expected,
        "native exact private inputs",
    )?;
    private_mounts(&p["containers"][0])?;
    equal(
        named(&r, "PersistentVolumeClaim", "kelryvo-postgresql-data")?,
        pvc.clone(),
        "native retained PG PVC",
    )?;
    equal(
        named(&r, "PersistentVolumeClaim", "kelryvo-oracle-state")?,
        state.clone(),
        "native retained operator PVC",
    )?;
    let reviewed = chart
        .render(
            &[
                ready.as_slice(),
                &["--set", "oracleRuntime.nativeDiscoveryReview=true"],
            ]
            .concat(),
            true,
        )
        .await?;
    let rp = pod(&reviewed)?;
    let review = &member(&rp["volumes"], "oracle-private")?["secret"];
    equal(&review["defaultMode"], json!(256), "review secret mode")?;
    let mut expected = expected;
    expected.insert("discovery-review.json".into());
    require(
        keys(&review["items"], "key")? == expected,
        "reviewed discovery exact private inputs",
    )?;
    equal(
        &rp["containers"][0]["securityContext"],
        p["containers"][0]["securityContext"].clone(),
        "review keeps app security",
    )?;
    private_mounts(&rp["containers"][0])
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn authored_specs_allow_defaults_but_preserve_container_cardinality_and_values() {
        let authored = json!({"containers":[{"image":"pinned","ports":[{"containerPort":5432}]}]});
        let mut actual = json!({"containers":[{"name":"postgresql","image":"pinned","ports":[{"containerPort":5432,"protocol":"TCP"}]}],"otherDefault":true});
        assert!(subset(&authored, &actual));
        actual["containers"][0]["ports"][0]["containerPort"] = json!(6432);
        assert!(!subset(&authored, &actual));
        actual["containers"][0]["ports"][0]["containerPort"] = json!(5432);
        actual["containers"]
            .as_array_mut()
            .unwrap()
            .push(json!({"image":"pinned"}));
        assert!(!subset(&authored, &actual));
        assert!(
            documents("kind: Deployment\n---\nkind: Service")
                .unwrap()
                .len()
                == 2
        );
        assert_eq!(
            documents("mode: 0400\nquoted: '0400'\nscript: |\n  mode: 0400\n").unwrap(),
            vec![json!({"mode":256,"quoted":"0400","script":"mode: 0400\n"})]
        );
        assert!(documents("mode: 0400\nmode: 0444\n").is_err());
    }
}
