//! Native test companion. It never contacts Kubernetes or executes database tools.
use serde_json::Value;
use std::{io::Write, net::TcpListener};
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let f: Value = serde_json::from_str(include_str!("../tests/fixtures/managed.json")).unwrap();
    let out = if args.iter().any(|a| a == "port-forward") {
        assert!(args.windows(2).any(|a| a == ["--address", "127.0.0.1"]));
        assert!(args.iter().any(|a| a == "pod/kelryvo-postgresql-0"));
        assert!(args.iter().any(|a| a == "--request-timeout=0"));
        assert!(args.iter().any(|a| a == ":5432"));
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        eprintln!(
            "Forwarding from 127.0.0.1:{} -> 5432",
            listener.local_addr().unwrap().port()
        );
        std::io::stderr().flush().unwrap();
        loop {
            std::thread::park();
        }
    } else if args.iter().any(|a| a == "current-context") {
        String::from("k8s-admin-public")
    } else if args.iter().any(|a| a == "view") {
        let format = args.iter().find(|a| a.starts_with("jsonpath=")).unwrap();
        let key = format
            .strip_prefix("jsonpath={.clusters[0].cluster.")
            .unwrap()
            .strip_suffix('}')
            .unwrap();
        let key = match key {
            "server" => "server",
            "certificate-authority-data" => "caData",
            "certificate-authority" => "caPath",
            "insecure-skip-tls-verify" => "insecure",
            _ => panic!("unknown field"),
        };
        f["clusterConfig"][key].as_str().unwrap().into()
    } else {
        let at = args.iter().position(|a| a == "get").unwrap();
        let r = &f["resources"][format!("{}/{}", args[at + 1], args[at + 2])];
        assert!(r.is_object());
        if args.last().unwrap() == "jsonpath={.metadata.uid}" {
            r["metadata"]["uid"].as_str().unwrap().into()
        } else {
            r.to_string()
        }
    };
    print!("{out}");
}
