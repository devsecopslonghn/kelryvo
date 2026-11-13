//! Opt-in read-only observer for an isolated installed Oracle fixture. There
//! is no migration dispatch, admission, receipt editing or credential argv.
use crate::{
    Result,
    ack_proxy::{self},
    oracle_guard,
};
use oracle::{
    Connection,
    sql_type::{OracleType, ToSql},
};
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
};

fn private(path: &Path, limit: u64) -> Result<zeroize::Zeroizing<Vec<u8>>> {
    use std::io::Read;
    let mut file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || ![0, 10002].contains(&metadata.uid())
        || metadata.mode() & 0o007 != 0
        || metadata.len() > limit
    {
        return Err("Expected bounded private fixture file".into());
    }
    let mut bytes = zeroize::Zeroizing::new(Vec::new());
    std::io::Read::by_ref(&mut file)
        .take(limit + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > limit {
        return Err("Fixture file exceeded its bound".into());
    }
    Ok(bytes)
}
fn read_json(path: &Path) -> Result<Value> {
    Ok(serde_json::from_slice(&private(path, 4 * 1024 * 1024)?)?)
}
fn save(path: &Path, value: &Value) -> Result<()> {
    let mut file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .custom_flags(nix::libc::O_NOFOLLOW)
        .open(path)?;
    file.write_all(value.to_string().as_bytes())?;
    file.sync_all()?;
    Ok(())
}
pub struct Witness {
    root: PathBuf,
    connection: Connection,
    installation: Option<Value>,
}
impl Witness {
    fn open(ledger: bool) -> Result<Self> {
        let root = PathBuf::from(
            std::env::var_os("KELRYVO_ACK_FIXTURE_ROOT")
                .ok_or("Disposable fixture root required")?,
        );
        oracle_guard::namespace(&root)?;
        let app = root.join("app-root");
        let libraries = app.join("opt/kelryvo/oracle/client");
        let wallet = app.join("opt/kelryvo/oracle/wallet");
        if !libraries.is_absolute()
            || !wallet.is_absolute()
            || wallet
                .to_str()
                .is_none_or(|s| s.contains(['"', '(', ')', '\\', '\r', '\n']))
        {
            return Err("Invalid private client/wallet paths".into());
        }
        if oracle::InitParams::is_initialized() {
            return Err("Read-only fixture witness requires a fresh native process".into());
        }
        if !oracle::InitParams::new()
            .oracle_client_lib_dir(&libraries)?
            .oracle_client_config_dir(&wallet)?
            .init()?
        {
            return Err("Private fixture OCI client initialization failed".into());
        }
        let installation = if ledger {
            Some(read_json(
                &app.join("run/kelryvo/runtime/execution/installation.json"),
            )?)
        } else {
            None
        };
        let (user, password) = if let Some(installation) = &installation {
            let observer = installation["principals"]["observer"]
                .as_str()
                .ok_or("Fixture observer")?;
            let ledger = installation["principals"]["ledgerOwner"]
                .as_str()
                .ok_or("Fixture ledger owner")?;
            if installation["route"]["host"] != "127.0.0.1"
                || installation["route"]["port"] != 2484
                || installation["route"]["service"] != "freepdb1"
                || installation["route"]["serverCertificateDN"] != "CN=localhost"
                || !regex::Regex::new(r"^KRV_[A-F0-9]{12}_O$")?.is_match(observer)
                || !regex::Regex::new(r"^KRV_[A-F0-9]{12}_L$")?.is_match(ledger)
            {
                return Err("Installed fixture route/principal scope changed".into());
            }
            (
                observer.to_owned(),
                private(
                    &app.join("run/kelryvo/runtime/execution/observer-password"),
                    4096,
                )?,
            )
        } else {
            (
                "KRV_MASTER".into(),
                private(&root.join("private/master-password"), 4096)?,
            )
        };
        let password = zeroize::Zeroizing::new(String::from_utf8(password.to_vec())?);
        let descriptor = format!(
            "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=127.0.0.1)(PORT=2485))(CONNECT_DATA=(SERVICE_NAME=freepdb1))(SECURITY=(SSL_SERVER_DN_MATCH=YES)(SSL_SERVER_CERT_DN=\"CN=localhost\")(MY_WALLET_DIRECTORY=\"{}\")))",
            wallet.display()
        );
        let mut connection = Connection::connect(user, password.as_str(), descriptor)?;
        connection.set_autocommit(false);
        connection.set_call_timeout(Some(Duration::from_secs(if ledger { 2 } else { 3 })))?;
        connection.set_stmt_cache_size(0)?;
        Ok(Self {
            root,
            connection,
            installation,
        })
    }
    fn query(&self, sql: &str, binds: &[(&str, &dyn ToSql)], limit: usize) -> Result<Vec<Value>> {
        // All callers below use fixed SELECT statements. Never expose this as
        // a CLI query, migration source, bind-controlled object or execution API.
        if !sql.starts_with("SELECT ") || limit == 0 || limit > 65536 {
            return Err("Invalid read-only fixture query".into());
        }
        let rows = self.connection.query_named(sql, binds)?;
        let columns = rows.column_info().to_vec();
        let mut output = Vec::new();
        let mut bytes = 0;
        for row in rows {
            if output.len() >= limit {
                return Err("Read-only fixture query exceeded its row bound".into());
            }
            let row = row?;
            let mut value = json!({});
            for (index, column) in columns.iter().enumerate() {
                let text: Option<String> = row.get(index)?;
                let item = match (column.oracle_type(), text) {
                    (_, None) => Value::Null,
                    (OracleType::Number(_, 0) | OracleType::Number(0, -127), Some(text)) => {
                        let number = text.parse::<i64>()?;
                        if number.unsigned_abs() > 9_007_199_254_740_991 {
                            return Err(
                                "Oracle number cannot preserve the retained wire integer".into()
                            );
                        }
                        number.into()
                    }
                    (
                        OracleType::Varchar2(_)
                        | OracleType::NVarchar2(_)
                        | OracleType::Char(_)
                        | OracleType::NChar(_)
                        | OracleType::Long,
                        Some(text),
                    ) => text.into(),
                    _ => return Err("Unsupported read-only fixture column type".into()),
                };
                value[column.name()] = item;
            }
            bytes += value.to_string().len();
            if bytes > 64 * 1024 * 1024 {
                return Err("Read-only fixture query exceeded its byte bound".into());
            }
            output.push(value);
        }
        Ok(output)
    }
    fn version(&self) -> Result<String> {
        Ok(self.connection.server_version()?.0.to_string())
    }
}
pub fn read(mode: &str) -> Result<Value> {
    if !["identity", "ledger"].contains(&mode) {
        return Err("Usage: --oracle-read identity|ledger".into());
    }
    let witness = Witness::open(mode == "ledger")?;
    if mode == "identity" {
        let d=witness.query("SELECT TO_CHAR(DBID) DBID, DB_UNIQUE_NAME, TO_CHAR(RESETLOGS_CHANGE#) RESETLOGS_CHANGE, CDB FROM SYS.V_$DATABASE",&[],1)?;
        let s=witness.query("SELECT SYS_CONTEXT('USERENV','CON_ID') CONTAINER_ID, SYS_CONTEXT('USERENV','CON_NAME') CONTAINER_NAME, SYS_CONTEXT('USERENV','SERVICE_NAME') SERVICE_NAME FROM SYS.DUAL",&[],1)?;
        let c=witness.query("SELECT TO_CHAR(DBID) CONTAINER_DBID, RAWTOHEX(GUID) CONTAINER_GUID FROM SYS.V_$CONTAINERS WHERE CON_ID=SYS_CONTEXT('USERENV','CON_ID')",&[],1)?;
        let v = witness.query(
            "SELECT BANNER VERSION FROM SYS.V_$VERSION WHERE ROWNUM=1",
            &[],
            1,
        )?;
        let (d, s, c, v) = (
            d.first().ok_or("Missing database identity")?,
            s.first().ok_or("Missing session identity")?,
            c.first().ok_or("Missing container identity")?,
            v.first().ok_or("Missing version")?,
        );
        Ok(
            json!({"identity":{"engine":"oracle","dbid":d["DBID"],"dbUniqueName":d["DB_UNIQUE_NAME"],"resetlogsChange":d["RESETLOGS_CHANGE"],"cdb":d["CDB"]=="YES","containerId":s["CONTAINER_ID"],"containerGuid":c["CONTAINER_GUID"],"containerDbid":c["CONTAINER_DBID"],"containerName":s["CONTAINER_NAME"],"serviceName":s["SERVICE_NAME"],"version":v["VERSION"]},"serverVersion":witness.version()?}),
        )
    } else {
        let ledger = witness.installation.as_ref().unwrap()["principals"]["ledgerOwner"]
            .as_str()
            .ok_or("Fixture ledger owner")?;
        let events = witness.query(
            &format!(
                "SELECT * FROM {ledger}.SF_TARGET_LEDGER_EVENTS ORDER BY TARGET_ID,SEQUENCE_NO"
            ),
            &[],
            65536,
        )?;
        let heads = witness.query(
            &format!("SELECT * FROM {ledger}.SF_TARGET_LEDGER_HEAD ORDER BY TARGET_ID"),
            &[],
            65536,
        )?;
        Ok(
            json!({"events":events.len(),"heads":heads.len(),"sha256":kelryvo_core::sha256(json!({"events":events,"heads":heads}).to_string())}),
        )
    }
}
async fn control(root: &Path, value: &Value) -> Result<Value> {
    tokio::time::timeout(Duration::from_secs(2), async {
        let mut socket = UnixStream::connect(root.join("private/proxy-control.sock")).await?;
        socket.write_all(format!("{value}\n").as_bytes()).await?;
        let mut bytes = Vec::new();
        let mut byte = [0; 1];
        loop {
            if socket.read(&mut byte).await? == 0 {
                return Err("Incomplete private proxy response".into());
            }
            if byte[0] == b'\n' {
                break;
            }
            bytes.push(byte[0]);
            if bytes.len() > 16384 {
                return Err("Oversized private proxy response".into());
            }
        }
        Result::Ok(serde_json::from_slice(&bytes)?)
    })
    .await?
}
pub async fn monitor() -> Result<()> {
    let witness = Witness::open(true)?;
    let root = &witness.root;
    let private = root.join("private");
    let installation = witness.installation.as_ref().unwrap();
    let marker = read_json(&private.join("installed-test-context.json"))?;
    if marker["kind"] != "KELRYVO_DISPOSABLE_NATIVE_ORACLE_V1"
        || marker["connectionId"] != installation["connectionId"]
    {
        return Err("Fixture marker does not match its installation".into());
    }
    let migration =
        std::env::var("KELRYVO_ACK_MIGRATION_PATH").unwrap_or_else(|_| "V2__recovery.sql".into());
    if !regex::Regex::new(r"^V[1-9][0-9]{0,3}__[a-z0-9_]{1,40}\.sql$")?.is_match(&migration) {
        return Err("Invalid private ACK migration path".into());
    }
    let target = std::env::var("KELRYVO_ACK_TARGET_ID")?;
    if !regex::Regex::new(r"^[a-f0-9]{64}$")?.is_match(&target) {
        return Err("Exact independently approved fixture stream required".into());
    }
    let stem = format!("oracle-ack-{}", migration.strip_suffix(".sql").unwrap());
    let ready = private.join(format!("{stem}-ready.json"));
    let report = private.join(format!("{stem}-result.json"));
    if ready.try_exists()? || report.try_exists()? {
        return Err("Never silently repeat a fault attempt".into());
    }
    let result:Result<()>=async {
        let version=witness.version()?;if installation["driverServerVersionString"]!=version{return Err("Fixture Oracle server version changed".into());}
        let ledger=installation["principals"]["ledgerOwner"].as_str().ok_or("Fixture ledger principal")?;
        let sql=format!("SELECT a.target_id,a.sequence_no,a.checksum,s.path FROM {ledger}.SF_TARGET_LEDGER_EVENTS s JOIN {ledger}.SF_TARGET_LEDGER_EVENTS a ON a.target_id=s.target_id AND a.file_ordinal=s.file_ordinal AND a.sequence_no>s.sequence_no WHERE s.event_type='FILE_STARTED' AND s.target_id=:targetId AND s.path=:migrationPath AND a.event_type='FILE_APPLIED'");
        let path=format!("migrations/{migration}");let binds:[(&str,&dyn ToSql);2]=[("targetId",&target),("migrationPath",&path)];
        if !witness.query(&sql,&binds,2)?.is_empty() || control(root,&json!({"op":"snapshot"})).await?["result"]["cuts"]!=0{return Err("Fresh, unfaulted migration required".into());}
        save(&ready,&json!({"status":"READY_READ_ONLY","connectionId":marker["connectionId"],"targetId":target,"migrationPath":migration}))?;
        let deadline=Instant::now()+Duration::from_secs(120);let mut negative=None;let mut selected=None;let mut completed=None;
        let mut terminate=tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        while Instant::now()<deadline {
            let start=ack_proxy::monotonic_ns();let events=witness.query(&sql,&binds,2)?;
            if events.is_empty(){negative=Some(start);}else{
                if events.len()!=1 || events[0]["TARGET_ID"]!=target{return Err("Ambiguous committed target event".into());}
                let negative=negative.ok_or("No independent negative read")?;let port=selected.ok_or("No selected ledger session")?;let mut proof=None;
                for _ in 0..20 {
                    let response=control(root,&json!({"op":"cut","port":port,"afterNs":negative.to_string()})).await?;
                    if response["ok"]==true{proof=Some(response["result"].clone());break;}
                    let snapshot=control(root,&json!({"op":"snapshot"})).await?;
                    let stream=snapshot["result"]["connections"].as_array().ok_or("Proxy connection snapshot")?.iter().find(|s|s["upstreamPort"]==port && s["closed"]==false);
                    let Some(stream)=stream else{break;};
                    if stream["lastForwardedCapturedNs"].as_str().ok_or("Exact monotonic clock serialization required")?.parse::<u64>()?>=negative{break;}
                    tokio::time::sleep(Duration::from_millis(1)).await;
                }
                let proof=proof.ok_or("Fault window missed; do not replay the approved migration")?;
                if proof["oracleCommitProven"]!=false || witness.query(&sql,&binds,2)?.len()!=1{return Err("Committed target event did not survive the cut".into());}
                completed=Some((proof,events[0].clone()));break;
            }
            if selected.is_none(){
                let sessions=witness.query("SELECT PORT FROM SYS.V_$SESSION WHERE USERNAME=:ledger AND TYPE='USER'",&[("ledger",&ledger)],16)?;
                let snapshot=control(root,&json!({"op":"snapshot"})).await?;
                let live:Vec<_>=snapshot["result"]["connections"].as_array().ok_or("Proxy connection snapshot")?.iter().filter(|s|s["closed"]==false && sessions.iter().any(|row|row["PORT"]==s["upstreamPort"])).collect();
                if live.len()>1{return Err("Ambiguous ledger connection; refusing a fault".into());}
                if let Some(stream)=live.first(){let port=stream["upstreamPort"].as_u64().ok_or("Selected ledger port")?;if control(root,&json!({"op":"arm","port":port})).await?["ok"]!=true{return Err("Selected ledger stream could not be armed".into());}selected=Some(port);}
            }
            tokio::select!{_=terminate.recv()=>return Err("Monitor cancelled; no replay is authorized".into()),_=tokio::time::sleep(Duration::from_millis(2))=>{}}
        }
        let (proof,event)=completed.ok_or("No committed fault observed; do not replay the approved migration")?;
        let mut evidence=json!({"status":"PASS","oracleCommitProven":true,"transport":proof,"committedEvent":{"targetId":event["TARGET_ID"],"sequence":event["SEQUENCE_NO"],"checksum":event["CHECKSUM"],"path":event["PATH"]},"connectionId":marker["connectionId"],"sourceTreeDigest":marker["sourceTreeDigest"],"appImageDigest":marker["appImageDigest"],"oracleServerVersion":version,"selectedSessionUsername":ledger,"qualification":"DISPOSABLE_LOCAL_FIXTURE_ONLY"});
        evidence["evidenceDigest"]=kelryvo_core::sha256(evidence.to_string()).into();save(&report,&evidence)?;Ok(())
    }.await;
    if result.is_err() && !report.try_exists()? {
        save(
            &report,
            &json!({"status":"FAIL","error":"Native observer refused an incomplete or unsafe fault window; no replay authorized","oracleCommitProven":false,"migrationPath":migration}),
        )?;
    }
    if result.is_ok() {
        println!(
            "PASS: independent committed FILE_APPLIED read and one withheld ledger response cut"
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_read_modes_and_nonfixture_namespaces_are_rejected_before_oci() {
        assert!(read("execute").is_err());
        assert!(oracle_guard::namespace(Path::new("/tmp/production")).is_err());
        assert!(
            oracle_guard::namespace(Path::new("relative/.cache/native-oracle-fixture")).is_err()
        );
        assert_eq!(
            ack_proxy::exact_clock_json(&json!({"negativeReadStartNs":10_000_000_000_000_013_u64}))
                ["negativeReadStartNs"],
            "10000000000000013"
        );
    }
}
