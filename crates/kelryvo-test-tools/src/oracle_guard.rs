//! Closed, local-only disposable Oracle namespace contracts. None of these
//! structural checks authorizes connecting to Oracle or injecting a fault.
use crate::Result;
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub fn namespace(root: &std::path::Path) -> Result<()> {
    use std::os::unix::fs::MetadataExt;
    if !nix::unistd::geteuid().is_root()
        || nix::unistd::gethostname()?.to_str() != Some("kelryvo-oracle-fixture")
    {
        return Err("The disposable Oracle fixture OS operator/namespace is required".into());
    }
    let exported = root.file_name().and_then(|s| s.to_str()) == Some("native-oracle-fixture")
        && root
            .parent()
            .and_then(std::path::Path::file_name)
            .and_then(|s| s.to_str())
            == Some(".cache");
    // The installed driver also retains its original fixed namespace bind.
    // No arbitrary root or host/customer directory is accepted by either form.
    if !root.is_absolute()
        || !(exported || root == std::path::Path::new("/opt/kelryvo-fixture"))
        || root.canonicalize()? != root
    {
        return Err("Expected canonical private disposable Oracle fixture path".into());
    }
    let private = std::fs::symlink_metadata(root.join("private"))?;
    if !private.is_dir()
        || private.is_symlink()
        || private.uid() != 0
        || private.mode() & 0o777 != 0o700
    {
        return Err("Oracle fixture private directory ownership/mode changed".into());
    }
    let mut network = Vec::new();
    for args in [
        vec!["-d", "link"],
        vec!["address"],
        vec!["route", "show", "table", "all"],
    ] {
        let output = std::process::Command::new("/usr/sbin/ip")
            .arg("-j")
            .args(args)
            .env_clear()
            .env("PATH", "/usr/sbin:/usr/bin:/sbin:/bin")
            .env("LANG", "C")
            .output()?;
        if !output.status.success() || output.stdout.len() > 1024 * 1024 {
            return Err("Disposable fixture network inventory unavailable".into());
        }
        network.push(serde_json::from_slice::<Value>(&output.stdout)?);
    }
    isolated_network(&network[0], &network[1], &network[2])
}

pub fn isolated_network(links: &Value, addresses: &Value, routes: &Value) -> Result<()> {
    let links = links.as_array().ok_or("Network link inventory")?;
    let names: BTreeSet<_> = links.iter().filter_map(|l| l["ifname"].as_str()).collect();
    if names.len() != links.len()
        || !(names == BTreeSet::from(["lo"]) || names == BTreeSet::from(["lo", "oracle0"]))
    {
        return Err("Fixture network has unexpected interfaces".into());
    }
    for link in links {
        if link["ifname"] == "lo" {
            if link["link_type"] != "loopback" {
                return Err("Fixture loopback identity changed".into());
            }
        } else if link["linkinfo"]["info_kind"] != "dummy"
            || link.get("link_index").is_some()
            || link.get("link_netnsid").is_some()
        {
            return Err("Fixture interface has a peer or routable link type".into());
        }
    }
    let addresses = addresses.as_array().ok_or("Network address inventory")?;
    if addresses
        .iter()
        .filter_map(|a| a["ifname"].as_str())
        .collect::<BTreeSet<_>>()
        != names
    {
        return Err("Fixture address interfaces changed".into());
    }
    for entry in addresses {
        let actual: BTreeSet<_> = entry["addr_info"]
            .as_array()
            .ok_or("Address entries")?
            .iter()
            .map(|a| {
                (
                    a["family"].as_str().unwrap_or(""),
                    a["local"].as_str().unwrap_or(""),
                    a["prefixlen"].as_u64().unwrap_or(0),
                )
            })
            .collect();
        let valid = if entry["ifname"] == "lo" {
            actual == BTreeSet::from([("inet", "127.0.0.1", 8)])
                || actual == BTreeSet::from([("inet", "127.0.0.1", 8), ("inet6", "::1", 128)])
        } else {
            actual == BTreeSet::from([("inet", "192.0.2.1", 32)])
        };
        if !valid {
            return Err("Unexpected fixture network address".into());
        }
    }
    for route in routes.as_array().ok_or("Network route inventory")? {
        if ["gateway", "nexthops", "via"]
            .iter()
            .any(|key| route.get(key).is_some())
            || route["table"] != "local"
            || !matches!(route["type"].as_str(), Some("local" | "broadcast"))
        {
            return Err("Fixture network has an external route".into());
        }
        if route["dev"] == "lo" {
            if !matches!(
                route["dst"].as_str(),
                Some("127.0.0.0/8" | "127.0.0.1" | "127.255.255.255" | "::1")
            ) {
                return Err("Unexpected loopback fixture route".into());
            }
        } else if !names.contains("oracle0")
            || route["dev"] != "oracle0"
            || route["type"] != "local"
            || route["dst"] != "192.0.2.1"
        {
            return Err("Unexpected dummy fixture route".into());
        }
    }
    Ok(())
}
pub fn schemas(marker: &Value) -> Result<(String, Vec<String>)> {
    let owner = match marker.get("schemaOwner") {
        None => "KRV_APP",
        Some(value) => value.as_str().ok_or("Invalid fixture schema owner")?,
    };
    let readers = marker
        .get("readerSchemas")
        .cloned()
        .unwrap_or_else(|| json!(["KRV_APP"]));
    if !["KRV_APP", "KRV_ACK"].contains(&owner)
        || !(readers == json!(["KRV_APP"]) || readers == json!(["KRV_ACK", "KRV_APP"]))
        || !readers.as_array().unwrap().iter().any(|r| r == owner)
    {
        return Err("Oracle fixture schema scope changed".into());
    }
    Ok((
        owner.into(),
        readers
            .as_array()
            .unwrap()
            .iter()
            .map(|r| r.as_str().unwrap().to_owned())
            .collect(),
    ))
}
pub fn target_id(stream: &str) -> Result<String> {
    if uuid::Uuid::parse_str(stream)?.to_string() != stream {
        return Err("Noncanonical fixture stream identifier".into());
    }
    Ok(kelryvo_core::sha256(
        json!(["INSTANCE_SCHEMA_STREAM_V2", stream]).to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn network() -> [Value; 3] {
        [
            json!([{"ifname":"lo","link_type":"loopback"},{"ifname":"oracle0","linkinfo":{"info_kind":"dummy"}}]),
            json!([{"ifname":"lo","addr_info":[{"family":"inet","local":"127.0.0.1","prefixlen":8}]},{"ifname":"oracle0","addr_info":[{"family":"inet","local":"192.0.2.1","prefixlen":32}]}]),
            json!([{"type":"local","dst":"192.0.2.1","dev":"oracle0","table":"local"}]),
        ]
    }
    #[test]
    fn fixture_schema_scope_is_closed() {
        assert_eq!(
            schemas(&json!({})).unwrap(),
            ("KRV_APP".into(), vec!["KRV_APP".into()])
        );
        assert_eq!(
            schemas(&json!({"schemaOwner":"KRV_ACK","readerSchemas":["KRV_ACK","KRV_APP"]}))
                .unwrap(),
            ("KRV_ACK".into(), vec!["KRV_ACK".into(), "KRV_APP".into()])
        );
        for marker in [
            json!({"schemaOwner":"SYS"}),
            json!({"readerSchemas":["KRV_APP","SYS"]}),
            json!({"schemaOwner":"KRV_ACK"}),
            json!({"readerSchemas":["KRV_APP","KRV_APP"]}),
        ] {
            assert!(schemas(&marker).is_err());
        }
    }
    #[test]
    fn fault_target_is_stream_specific() {
        let first = target_id("00000000-0000-4000-8000-000000000001").unwrap();
        assert_eq!(first.len(), 64);
        assert_ne!(
            first,
            target_id("00000000-0000-4000-8000-000000000002").unwrap()
        );
        assert!(target_id("not-a-stream-id").is_err());
    }
    #[test]
    fn loopback_and_unconnected_dummy_are_accepted() {
        let [links, addresses, routes] = network();
        isolated_network(&links, &addresses, &routes).unwrap();
        isolated_network(&json!([links[0]]), &json!([addresses[0]]), &json!([])).unwrap();
    }
    #[test]
    fn connected_or_routable_networks_are_refused() {
        for kind in ["veth", "bridge", "tun"] {
            let mut data = network();
            data[0][1]["linkinfo"]["info_kind"] = kind.into();
            assert!(isolated_network(&data[0], &data[1], &data[2]).is_err());
        }
        for change in [
            json!({"table":"main","dst":"default"}),
            json!({"gateway":"192.0.2.2"}),
            json!({"nexthops":[]}),
            json!({"dst":"198.51.100.1"}),
            json!({"dev":"eth0"}),
        ] {
            let mut data = network();
            data[2][0]
                .as_object_mut()
                .unwrap()
                .extend(change.as_object().unwrap().clone());
            assert!(isolated_network(&data[0], &data[1], &data[2]).is_err());
        }
    }
    #[test]
    fn extra_interfaces_addresses_and_peers_are_refused() {
        for change in 0..3 {
            let mut data = network();
            match change {
                0 => data[0]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"ifname":"eth0"})),
                1 => data[1][1]["addr_info"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!({"family":"inet","local":"192.0.2.2","prefixlen":32})),
                _ => data[0][1]["link_index"] = 4.into(),
            };
            assert!(isolated_network(&data[0], &data[1], &data[2]).is_err());
        }
    }
}
