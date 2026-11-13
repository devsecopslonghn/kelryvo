//! Native scoped installation and two independent disposable schema streams.
//! Every provisioning/product mutation is one-shot; readiness reads may wait.
use super::*;
pub(super) struct Live {
    pub runtime: OwnedChild,
    pub proxy: OwnedChild,
    pub result: Value,
}
struct Product<'a> {
    tools: &'a Value,
    identity: &'a Value,
    master: &'a str,
    wallet: &'a Path,
    operator: &'a Path,
    runtime: &'a mut OwnedChild,
    proxy: &'a mut OwnedChild,
}
impl Fixture {
    async fn sys_sql(&self, text: &str) -> Result<Vec<u8>> {
        let script = format!(
            "WHENEVER SQLERROR EXIT SQL.SQLCODE\nSET ECHO OFF FEEDBACK OFF HEADING OFF PAGESIZE 0 LINESIZE 32767\n{text}\nEXIT\n"
        );
        self.run(
            &self.child_args("vendor-sql")?,
            Some(script.as_bytes()),
            &environment(),
            Duration::from_secs(180),
            "sys-fixture-bootstrap",
        )
        .await
    }
    async fn pki(&self, tools: &Value, args: &[OsString]) -> Result<()> {
        let mut argv = vec![
            field(tools, "java")?.into(),
            "-cp".into(),
            self.root.join("pki-tools/oraclepki.jar").into_os_string(),
            "oracle.security.pki.textui.OraclePKITextUI".into(),
        ];
        argv.extend_from_slice(args);
        self.command(&argv, "private-pki").await?;
        Ok(())
    }
    async fn worker(&self, args: &[&str]) -> Result<Value> {
        self.native("kelryvo-worker", args, None, None).await
    }
    pub(super) async fn qualify(&self, tools: &Value, pg_password: &str) -> Result<Live> {
        let wallet = self.app.join("opt/kelryvo/oracle/wallet");
        let server_wallet = self.oracle.join("opt/oracle/oradata/fixture-wallet");
        for path in [&wallet, &server_wallet] {
            fs::create_dir_all(path)?;
            chmod(path, 0o750)?;
            self.pki(
                tools,
                &[
                    words(&["wallet", "create", "-wallet"]),
                    vec![path.as_os_str().into()],
                    words(&["-auto_login_only"]),
                ]
                .concat(),
            )
            .await?;
        }
        let certificate = self.root.join("pki-tools/server.crt");
        self.pki(
            tools,
            &[
                words(&["wallet", "add", "-wallet"]),
                vec![server_wallet.as_os_str().into()],
                words(&[
                    "-dn",
                    "CN=localhost",
                    "-keysize",
                    "2048",
                    "-self_signed",
                    "-validity",
                    "1",
                    "-sign_alg",
                    "sha256",
                    "-auto_login_only",
                ]),
            ]
            .concat(),
        )
        .await?;
        self.pki(
            tools,
            &[
                words(&["wallet", "export", "-wallet"]),
                vec![server_wallet.as_os_str().into()],
                words(&["-dn", "CN=localhost", "-cert"]),
                vec![certificate.clone().into_os_string()],
            ]
            .concat(),
        )
        .await?;
        self.pki(
            tools,
            &[
                words(&["wallet", "add", "-wallet"]),
                vec![wallet.as_os_str().into()],
                words(&["-trusted_cert", "-cert"]),
                vec![certificate.into_os_string()],
                words(&["-auto_login_only"]),
            ]
            .concat(),
        )
        .await?;
        let lock = wallet.join("cwallet.sso.lck");
        if lock.try_exists()? {
            let metadata = fs::symlink_metadata(&lock)?;
            require(
                metadata.is_file() && metadata.len() == 0,
                "unused PKI lock before sealing",
            )?;
            fs::remove_file(lock)?;
        }
        for (directory, gid) in [(&wallet, 10002), (&server_wallet, 54321)] {
            let uid = if gid == 10002 { 0 } else { 54321 };
            chown(directory, uid, gid)?;
            for entry in fs::read_dir(directory)? {
                let path = entry?.path();
                require(
                    fs::symlink_metadata(&path)?.is_file(),
                    "closed regular PKI wallet files",
                )?;
                chmod(&path, 0o440)?;
                chown(&path, uid, gid)?;
            }
        }
        // These are the pinned vendor chroot's known backing files. Never
        // follow its absolute network/admin symlinks into the host namespace.
        let network = self.oracle.join("opt/oracle/oradata/dbconfig/FREE");
        require(
            network.canonicalize()? == network && fs::symlink_metadata(&network)?.is_dir(),
            "private vendor network backing directory",
        )?;
        for (name, bytes) in [
            (
                "listener.ora",
                "LISTENER=(DESCRIPTION_LIST=(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=1521))(ADDRESS=(PROTOCOL=TCPS)(HOST=127.0.0.1)(PORT=2485))))\nWALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/opt/oracle/oradata/fixture-wallet)))\nSSL_CLIENT_AUTHENTICATION=FALSE\nSSL_VERSION=1.2\n",
            ),
            (
                "sqlnet.ora",
                "NAMES.DIRECTORY_PATH=(TNSNAMES,EZCONNECT)\nWALLET_LOCATION=(SOURCE=(METHOD=FILE)(METHOD_DATA=(DIRECTORY=/opt/oracle/oradata/fixture-wallet)))\nSSL_CLIENT_AUTHENTICATION=FALSE\nSSL_VERSION=1.2\n",
            ),
        ] {
            let path = network.join(name);
            require(
                fs::symlink_metadata(&path)?.is_file(),
                "regular vendor network configuration",
            )?;
            fs::write(path, bytes)?;
        }
        for action in ["listener-stop", "listener-start"] {
            self.command(&self.child_args(action)?, "private-listener")
                .await?;
        }
        let master = format!("Krv9{}", &api::random_token()[..48]);
        write(
            &self.private.join("master-password"),
            master.as_bytes(),
            0o600,
        )?;
        let catalog = [
            "DBA_CONSTRAINTS",
            "DBA_CONS_COLUMNS",
            "DBA_INDEXES",
            "DBA_IND_COLUMNS",
            "DBA_OBJECTS",
            "DBA_ROLE_PRIVS",
            "DBA_SCHEMA_PRIVS",
            "DBA_SOURCE",
            "DBA_SYS_PRIVS",
            "DBA_TAB_COLUMNS",
            "DBA_TAB_PRIVS",
            "DBA_TRIGGERS",
            "DBA_USERS",
            "V_$CONTAINERS",
            "V_$DATABASE",
            "V_$LOCK",
            "V_$SESSION",
            "V_$VERSION",
            "GV_$SESSION",
        ];
        let mut grants = format!(
            "ALTER SYSTEM SET local_listener='(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=1521))' SCOPE=BOTH;\nALTER SYSTEM REGISTER;\nALTER SESSION SET CONTAINER=FREEPDB1;\nCREATE USER KRV_MASTER IDENTIFIED BY \"{master}\";\nGRANT CREATE SESSION, CREATE USER, ALTER USER, CREATE TABLE, CREATE PROCEDURE, CREATE TRIGGER, GRANT ANY PRIVILEGE, GRANT ANY OBJECT PRIVILEGE, CREATE ANY TABLE, ALTER ANY TABLE, CREATE ANY INDEX, READ ANY TABLE TO KRV_MASTER WITH ADMIN OPTION;\nGRANT EXECUTE ON SYS.DBMS_LOCK TO KRV_MASTER WITH GRANT OPTION;\n"
        );
        for view in catalog {
            grants.push_str(&format!(
                "GRANT {} ON SYS.{view} TO KRV_MASTER WITH GRANT OPTION;\n",
                if view == "V_$VERSION" {
                    "READ"
                } else {
                    "SELECT"
                }
            ));
        }
        self.sys_sql(&grants).await?;
        let mut driver = Driver::at(self.root.clone(), Some(self.app.clone()), None)?;
        let deadline = Instant::now() + Duration::from_secs(40);
        let oracle_identity = loop {
            match driver.oracle_read("identity").await {
                Ok(value) => break value,
                Err(_) => {
                    require(
                        Instant::now() < deadline,
                        "TCPS read-only readiness before one-shot provisioning",
                    )?;
                    tokio::time::sleep(Duration::from_secs(1)).await;
                }
            }
        };
        stage("pinned TCPS and Oracle identity verified; initialize native API");
        for directory in ["run", "tmp", "var/lib"] {
            self.mount(
                &[
                    words(&[
                        "-t",
                        "tmpfs",
                        "-o",
                        if directory == "tmp" {
                            "mode=1777"
                        } else {
                            "mode=755"
                        },
                        "tmpfs",
                    ]),
                    vec![self.app.join(directory).into_os_string()],
                ]
                .concat(),
            )
            .await?;
        }
        self.mount(
            &[
                words(&["-t", "proc", "proc"]),
                vec![self.app.join("proc").into_os_string()],
            ]
            .concat(),
        )
        .await?;
        for name in ["null", "zero", "random", "urandom"] {
            let target = self.app.join("dev").join(name);
            if !target.try_exists()? {
                write(&target, b"", 0o644)?;
            }
            self.mount(
                &[
                    words(&["--bind", &format!("/dev/{name}")]),
                    vec![target.into_os_string()],
                ]
                .concat(),
            )
            .await?;
        }
        let secret = self.host("/run/kelryvo/secrets");
        fs::create_dir_all(&secret)?;
        chmod(&secret, 0o700)?;
        let operator = self.host(P);
        fs::create_dir_all(&operator)?;
        chmod(operator.parent().ok_or("Operator parent")?, 0o711)?;
        chmod(&operator, 0o700)?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(self.host("/run/kelryvo/installation"))?;
        let database =
            format!("postgresql://fixture:{pg_password}@127.0.0.1:15432/kelryvo_rust_test");
        for (name, value) in [
            ("database-url", database.clone()),
            ("developer-token", api::random_token()),
            ("approver-token", api::random_token()),
        ] {
            write(&secret.join(name), value.as_bytes(), 0o600)?;
        }
        write(&operator.join("database-url"), database.as_bytes(), 0o600)?;
        api::certificate(&secret)?;
        let (private, public) = api::vault_key()?;
        write(
            &operator.join("oracle-vault-private.pem"),
            &private.private_key_to_pem_pkcs8()?,
            0o600,
        )?;
        write(&secret.join("oracle-vault-public.pem"), &public, 0o600)?;
        let customer = self.host("/run/kelryvo/repositories/customer");
        fs::create_dir_all(customer.join("migrations"))?;
        write(
            &customer.join("migrations/V001__fixture.sql"),
            b"CREATE TABLE fixture_source(id NUMBER);\n",
            0o644,
        )?;
        let mut git_env = environment();
        git_env.insert("GIT_CONFIG_NOSYSTEM".into(), "1".into());
        git_env.insert("GIT_CONFIG_GLOBAL".into(), "/dev/null".into());
        for args in [
            words(&["init", "--initial-branch=main"]),
            words(&["add", "--", "."]),
            words(&[
                "-c",
                "user.name=Native Oracle fixture",
                "-c",
                "user.email=fixture@kelryvo.invalid",
                "-c",
                "commit.gpgSign=false",
                "commit",
                "-m",
                "Native disposable Oracle source fixture",
            ]),
        ] {
            self.run(
                &[
                    words(&["/usr/bin/git", "-c", "core.hooksPath=/dev/null", "-C"]),
                    vec![customer.as_os_str().into()],
                    args,
                ]
                .concat(),
                None,
                &git_env,
                Duration::from_secs(180),
                "private-customer-git",
            )
            .await?;
        }
        json_file(
            &secret.join("repositories.json"),
            &json!({"format":1,"paths":["/run/kelryvo/repositories/customer"]}),
            0o600,
        )?;
        fn public_repo(path: &Path) -> Result<()> {
            let metadata = fs::symlink_metadata(path)?;
            require(
                !metadata.is_symlink(),
                "private fixture Git files have no links",
            )?;
            chmod(path, if metadata.is_dir() { 0o755 } else { 0o644 })?;
            if metadata.is_dir() {
                for entry in fs::read_dir(path)? {
                    public_repo(&entry?.path())?;
                }
            }
            Ok(())
        }
        public_repo(&customer)?;
        self.mount(
            &[
                words(&["--bind"]),
                vec![customer.as_os_str().into(), customer.as_os_str().into()],
            ]
            .concat(),
        )
        .await?;
        self.mount(
            &[
                words(&["-o", "remount,bind,ro"]),
                vec![customer.as_os_str().into()],
            ]
            .concat(),
        )
        .await?;
        self.mount(
            &[
                words(&["--rbind"]),
                vec![self.app.as_os_str().into(), self.app.as_os_str().into()],
            ]
            .concat(),
        )
        .await?;
        self.mount(
            &[
                words(&["-o", "remount,bind,ro"]),
                vec![self.app.as_os_str().into()],
            ]
            .concat(),
        )
        .await?;
        for action in ["initialize", "seed-actors", "activate"] {
            self.native("kelryvo-operator", &[action], None, None)
                .await?;
        }
        self.native(
            "kelryvo-operator",
            &["database-grant", "kelryvo-developer"],
            None,
            None,
        )
        .await?;
        let mut runtime_env = environment();
        for (key, value) in [
            ("KELRYVO_BIND_HOST", "127.0.0.1"),
            ("KELRYVO_PORT", "8443"),
            ("KELRYVO_EXECUTION_ENABLED", "true"),
            ("KELRYVO_DISCOVERY_ENABLED", "true"),
        ] {
            runtime_env.insert(key.into(), value.into());
        }
        let argv = [
            words(&[
                "/usr/bin/unshare",
                "--mount",
                "--pid",
                "--fork",
                &format!("--mount-proc={}", self.app.join("proc").display()),
                "--kill-child=SIGKILL",
                "/usr/sbin/chroot",
            ]),
            vec![self.app.as_os_str().into()],
            words(&[
                "/usr/bin/setpriv",
                "--bounding-set=-all,+chown,+kill,+setuid,+setgid",
                "--no-new-privs",
                "/opt/kelryvo/bin/kelryvo-runtime",
            ]),
        ]
        .concat();
        let mut runtime = self.log_child(&argv, &runtime_env, "runtime.log")?;
        let mut proxy = self.log_child(
            &[
                vec![field(tools, "test")?.into()],
                words(&["--ack-proxy-control"]),
                vec![self.root.as_os_str().into()],
            ]
            .concat(),
            &environment(),
            "proxy.log",
        )?;
        let result: Result<Value> = self
            .product(
                &mut driver,
                Product {
                    tools,
                    identity: &oracle_identity,
                    master: &master,
                    wallet: &wallet,
                    operator: &operator,
                    runtime: &mut runtime,
                    proxy: &mut proxy,
                },
            )
            .await;
        match result {
            Ok(result) => Ok(Live {
                runtime,
                proxy,
                result,
            }),
            Err(error) => {
                let _ = self.stop_runtime(&mut runtime).await;
                let _ = proxy.stop(Duration::from_secs(30)).await;
                Err(error)
            }
        }
    }
    async fn product(&self, driver: &mut Driver, input: Product<'_>) -> Result<Value> {
        let Product {
            tools,
            identity: oracle_identity,
            master,
            wallet,
            operator,
            runtime,
            proxy,
        } = input;
        let deadline = Instant::now() + Duration::from_secs(30);
        let mut developer = loop {
            require(
                runtime.child.try_wait()?.is_none() && proxy.child.try_wait()?.is_none(),
                "runtime/proxy alive before native HTTPS readiness",
            )?;
            match driver.login("developer").await {
                Ok(api) => break api,
                Err(_) => {
                    require(Instant::now() < deadline, "native HTTPS startup deadline")?;
                    tokio::time::sleep(Duration::from_millis(200)).await;
                }
            }
        };
        let mut projects = vec![];
        for label in ["Metadata recovery", "Committed ACK loss"] {
            let made = developer
                .json(
                    "POST",
                    "/api/projects",
                    Some(&json!({"name":format!("Native Oracle {label}")})),
                    201,
                )
                .await?;
            let project = installed_oracle::identifier(&made["project"], "id")?;
            for role in ["developer", "approver"] {
                for action in ["grant", "deploy-grant"] {
                    self.native(
                        "kelryvo-operator",
                        &[action, &project.to_string(), &format!("kelryvo-{role}")],
                        None,
                        None,
                    )
                    .await?;
                }
            }
            let environment = developer
                .json(
                    "POST",
                    &format!("/api/projects/{project}/environments"),
                    Some(&json!({"name":"DEV"})),
                    201,
                )
                .await?;
            projects.push((
                project,
                installed_oracle::identifier(&environment["environment"], "id")?,
            ));
        }
        let project = projects[0].0;
        let registered=developer.json("POST",&format!("/api/projects/{project}/database-instances/master"),Some(&json!({"name":"Isolated Oracle Free","containerName":"FREEPDB1","kind":"PDB","environment":"DEV","host":"127.0.0.1","port":2484,"service":"freepdb1","transport":"TCPS","username":"KRV_MASTER","password":master,"reason":"Explicit synthetic local fixture registration"})),201).await?;
        let connection = installed_oracle::identifier(&registered["connection"], "id")?;
        developer.json("POST",&format!("/api/projects/{}/database-instances/attach",projects[1].0),Some(&json!({"connectionId":connection,"reason":"Separate synthetic schema for one-shot ACK fault"})),200).await?;
        let generation = driver
            .sql("SELECT generation_id FROM sf_metadata_current WHERE singleton")
            .await?;
        let raw: Value = serde_json::from_str(
            &driver
                .sql(&format!(
                    "SELECT to_jsonb(c) FROM sf_database_connections c WHERE id='{connection}'"
                ))
                .await?,
        )?;
        let artifact = read(&self.private.join("fixture-artifact.json"))?;
        let source = read(&self.app.join("opt/kelryvo/source-identity.json"))?;
        let reviewed = "1".repeat(40); // Explicit synthetic local review; never a Git nomination.
        let mut reviewed_identity = source.clone();
        reviewed_identity["sourceSha"] = reviewed.clone().into();
        json_file(&self.host(SOURCE), &reviewed_identity, 0o444)?;
        let mut artifacts = vec![];
        for (kind, path) in [
            ("WORKER", "/opt/kelryvo/bin/kelryvo-worker".to_owned()),
            ("SOURCE_IDENTITY", SOURCE.to_owned()),
        ] {
            artifacts.push(json!({"kind":kind,"path":path,"sha256":hash(&self.host(&path))?}));
        }
        for (kind, directory, prefix) in [
            (
                "OCI_LIBRARY",
                self.app.join("opt/kelryvo/oracle/client"),
                "/opt/kelryvo/oracle/client",
            ),
            ("WALLET", wallet.to_path_buf(), "/opt/kelryvo/oracle/wallet"),
        ] {
            let mut paths = fs::read_dir(directory)?
                .map(|entry| entry.map(|e| e.path()))
                .collect::<std::io::Result<Vec<_>>>()?;
            paths.sort();
            for path in paths {
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .ok_or("Fixture artifact basename")?;
                artifacts.push(
                    json!({"kind":kind,"path":format!("{prefix}/{name}"),"sha256":hash(&path)?}),
                );
            }
        }
        let expiry = (chrono::Utc::now() + chrono::Duration::hours(2))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let authorization = "native-two-stream-disposable-fixture";
        let route = json!({"host":"127.0.0.1","port":2484,"service":"freepdb1","pinnedIPs":["127.0.0.1"],"serverCertificateDN":"CN=localhost"});
        let mut policy_route = route.clone();
        policy_route["transport"] = "TCPS".into();
        let policy = json!({"format":1,"route":policy_route,"expectedIdentity":oracle_identity["identity"],"schemaOwners":SCHEMAS,"protectedOwners":["SYS","SYSTEM"],"createSchemaOwners":SCHEMAS,"tablespace":"USERS","quotaMiB":20,"expiresAt":expiry,"authorizationId":authorization});
        let prefix = format!(
            "KRV_{}",
            kelryvo_core::sha256(connection.to_string())[..12].to_uppercase()
        );
        let targets: Value = SCHEMAS
            .iter()
            .map(|s| {
                (
                    (*s).to_owned(),
                    json!({"schemaPrivileges":["ALTER TABLE","CREATE INDEX","CREATE TABLE"]}),
                )
            })
            .collect();
        let mut template = json!({"format":1,"driverProfile":source["driverProfile"],"authorizationId":authorization,"installationDigest":"0".repeat(64),"metadataGenerationId":generation,"workerId":"native-current-fixture","expiresAt":expiry,"leaseSeconds":300,"callTimeoutMs":3000,"routeId":raw["route_id"],"connectionId":connection,"connectionRevision":"1","masterUsername":"KRV_MASTER","masterCredentialRef":raw["credential_ref"],"sourceCommit":reviewed,"appImageDigest":artifact["manifestDigest"],"metadataDatabase":{"host":"127.0.0.1","port":15432,"database":"kelryvo_rust_test","user":"fixture"},"identity":oracle_identity["identity"],"driverServerVersionString":oracle_identity["serverVersion"],"route":route,"principals":{"writer":format!("{prefix}_W"),"ledgerOwner":format!("{prefix}_L"),"observer":format!("{prefix}_O")},"readerSchemas":SCHEMAS,"protectedOwners":["SYS","SYSTEM"],"targetSchemas":targets,"mutexPackageSourceDigest":"3".repeat(64),"ledgerImmutableTriggerSourceDigest":"4".repeat(64),"secretDirectory":P,"witnessDirectory":"/run/kelryvo/witness","clientDirectory":"/opt/kelryvo/oracle/client","walletDirectory":"/opt/kelryvo/oracle/wallet","artifacts":artifacts,"review":{"identity":"uid:0","authorizationId":authorization,"expiresAt":expiry,"digest":"0".repeat(64)}});
        seal(&mut template["review"], "digest")?;
        seal(&mut template, "installationDigest")?;
        json_file(&operator.join("policy.json"), &policy, 0o600)?;
        json_file(&operator.join("template.json"), &template, 0o600)?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(self.host("/run/kelryvo/witness"))?;
        self.worker(&["installation-init-witness", "/run/kelryvo/witness"])
            .await?;
        let client_check = self
            .worker(&["installation-client-check", &format!("{P}/template.json")])
            .await?;
        require(
            client_check["status"] == "CLIENT_READY_NO_DATABASE",
            "reviewed client readiness without database operation",
        )?;
        json_file(
            &operator.join("prepare.json"),
            &json!({"format":1,"policyFile":format!("{P}/policy.json"),"installationTemplate":format!("{P}/template.json"),"vaultKeyFile":format!("{P}/oracle-vault-private.pem"),"outputDirectory":format!("{P}/prepared")}),
            0o600,
        )?;
        stage("native one-shot scoped provisioning, publication and read-only refresh");
        let preparation = self
            .worker(&["installation-prepare", &format!("{P}/prepare.json")])
            .await?;
        let prepared = operator.join("prepared");
        let mut password_hashes = BTreeMap::new();
        for name in ["writer-password", "ledger-password", "observer-password"] {
            password_hashes.insert(name, hash(&prepared.join(name))?);
        }
        let refreshed_template = read(&prepared.join("installation.json"))?;
        json_file(
            &operator.join("refresh-template.json"),
            &refreshed_template,
            0o600,
        )?;
        json_file(
            &operator.join("refresh.json"),
            &json!({"format":1,"previousDirectory":format!("{P}/prepared"),"installationTemplate":format!("{P}/refresh-template.json"),"outputDirectory":format!("{P}/refreshed")}),
            0o600,
        )?;
        let refresh = self
            .worker(&["installation-refresh", &format!("{P}/refresh.json")])
            .await?;
        let refreshed = operator.join("refreshed");
        for (name, expected) in &password_hashes {
            require(
                hash(&refreshed.join(name))? == *expected,
                "refresh preserves every principal password",
            )?;
        }
        json_file(
            &operator.join("publish.json"),
            &json!({"format":1,"sourceDirectory":format!("{P}/refreshed"),"destinationDirectory":"/run/kelryvo/runtime/execution","outputDirectory":format!("{P}/publication")}),
            0o600,
        )?;
        let publication = self
            .worker(&["installation-publish", &format!("{P}/publish.json")])
            .await?;
        let mut scope = self
            .worker(&["installation-observer-scope", &format!("{P}/refreshed")])
            .await?;
        require(
            scope
                .as_object_mut()
                .ok_or("Observer scope")?
                .remove("oracleMigrationExecution")
                .is_some(),
            "observer scope explicit migration-execution claim removed before review",
        )?;
        scope["acceptedAt"] = chrono::Utc::now()
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
            .into();
        scope["evidenceDigest"]=kelryvo_core::sha256(canonical(&json!({"artifact":artifact,"preflightSha256":hash(&refreshed.join("preflight.json"))?,"journalSha256":hash(&refreshed.join("journal.json"))?,"scope":scope,"qualification":"LOCAL_DISPOSABLE_PREFLIGHT_AND_ARTIFACT_REVIEW_ONLY"})).to_string()).into();
        json_file(&operator.join("observer-review.json"), &scope, 0o600)?;
        json_file(
            &operator.join("observer.json"),
            &json!({"format":1,"sourceDirectory":format!("{P}/refreshed"),"acceptanceReviewFile":format!("{P}/observer-review.json")}),
            0o600,
        )?;
        let observer = self
            .worker(&["installation-observer", &format!("{P}/observer.json")])
            .await?;
        for path in [
            "/opt/kelryvo/oracle/wallet/cwallet.sso".to_owned(),
            format!("{P}/oracle-vault-private.pem"),
            "/run/kelryvo/runtime/execution/writer-password".into(),
            "/run/kelryvo/runtime/execution/ledger-password".into(),
            "/run/kelryvo/runtime/execution/observer-password".into(),
        ] {
            let args = [
                words(&["/usr/sbin/chroot"]),
                vec![self.app.as_os_str().into()],
                words(&[
                    "/usr/bin/setpriv",
                    "--bounding-set=-all",
                    "--reuid=10001",
                    "--regid=10001",
                    "--clear-groups",
                    "--no-new-privs",
                    "/usr/bin/test",
                    "-r",
                    &path,
                ]),
            ]
            .concat();
            let output = process::capture(
                &args[0],
                &args[1..],
                &self.repo,
                &environment(),
                None,
                Duration::from_secs(30),
            )
            .await?;
            require(
                output.code == Some(1),
                "API UID cannot read wallet, vault private key or writer credentials",
            )?;
        }
        let mut workers = vec![];
        for entry in fs::read_dir("/proc")? {
            let entry = entry?;
            let Some(pid) = entry
                .file_name()
                .to_str()
                .and_then(|s| s.parse::<u32>().ok())
            else {
                continue;
            };
            let Ok(bytes) = fs::read(entry.path().join("cmdline")) else {
                continue;
            };
            if bytes.split(|b| *b == 0).take(2).collect::<Vec<_>>()
                == [
                    b"/opt/kelryvo/bin/kelryvo-worker".as_slice(),
                    b"runtime-service".as_slice(),
                ]
            {
                require(
                    entry.path().join("root").canonicalize()? == self.app,
                    "runtime worker belongs only to private app chroot",
                )?;
                workers.push(pid);
            }
        }
        require(workers.len() == 1, "one runtime-managed installed worker")?;
        driver.set_worker(workers[0])?;
        require(
            Path::new(&field(tools, "test")?) == std::env::current_exe()?.canonicalize()?,
            "read-only/fault monitor is the exact pinned current harness executable",
        )?;
        stage("independent API approval and fully receipted recovery on KRV_APP");
        let mut results = vec![];
        let mut ledger_checks = vec![];
        let mut first_history = None;
        for (index, owner) in ["KRV_APP", "KRV_ACK"].iter().enumerate() {
            let (project, environment) = projects[index];
            json_file(
                &self.private.join("installed-test-context.json"),
                &json!({"kind":"KELRYVO_DISPOSABLE_NATIVE_ORACLE_V1","projectId":project,"environmentId":environment,"connectionId":connection,"sourceTreeDigest":source["sourceTreeDigest"],"appImageDigest":artifact["manifestDigest"],"schemaOwner":owner,"readerSchemas":SCHEMAS}),
                0o600,
            )?;
            let before = if index == 1 {
                Some(driver.oracle_read("ledger").await?)
            } else {
                None
            };
            let mut result = driver.case(index == 1).await?;
            result["schemaOwner"] = (*owner).into();
            results.push(result);
            let query = format!(
                "SELECT jsonb_agg(to_jsonb(j) ORDER BY id) FROM sf_execution_jobs j WHERE project_id='{}'",
                projects[0].0
            );
            let current = driver.sql(&query).await?;
            if index == 0 {
                first_history = Some(current);
            } else {
                require(
                    Some(current) == first_history,
                    "first stream jobs unchanged after independent ACK stream",
                )?;
            }
            let after = driver.oracle_read("ledger").await?;
            if let Some(before) = before {
                require(
                    before["events"]
                        .as_u64()
                        .zip(after["events"].as_u64())
                        .is_some_and(|(a, b)| a < b)
                        && before["heads"]
                            .as_u64()
                            .zip(after["heads"].as_u64())
                            .is_some_and(|(a, b)| a + 1 == b),
                    "second stream adds its own ledger events/head",
                )?;
            }
            let ledger = read(&self.private.join("installed-test-recovery-ledger.json"))?;
            let mut check = ledger["before"].clone();
            check["case"] = ledger["case"].clone();
            ledger_checks.push(check);
            let history = self.private.join(if index == 0 {
                "metadata-evidence"
            } else {
                "ack-evidence"
            });
            fs::DirBuilder::new().mode(0o700).create(&history)?;
            let files = fs::read_dir(&self.private)?
                .map(|e| e.map(|e| e.path()))
                .collect::<std::io::Result<Vec<_>>>()?;
            for path in files {
                if path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("installed-test-"))
                {
                    fs::rename(&path, history.join(path.file_name().unwrap()))?;
                }
            }
            stage(if index == 0 {
                "positive recovery retained; proceed on independent ACK stream"
            } else {
                "ACK HOLD/no-replay assertions passed"
            });
        }
        for (query, expected) in [
            ("SELECT count(*) FROM sf_execution_jobs", "6"),
            (
                "SELECT count(*) FROM sf_execution_jobs WHERE state='HOLD'",
                "2",
            ),
            (
                "SELECT count(*) FROM sf_audit WHERE action='EXECUTION_RECOVERED_APPLIED'",
                "1",
            ),
        ] {
            require(
                driver.sql(query).await? == expected,
                "exact two-stream installed execution/audit totals",
            )?;
        }
        Ok(
            json!({"status":"PASS","artifact":artifact,"cases":results,"oracleServerVersion":oracle_identity["serverVersion"],"clientArchiveSha256":CLIENT_HASH,"schemaOwners":SCHEMAS,"clientCheck":client_check,"harnessInputs":read(&self.private.join("harness-inputs.json"))?,"preparation":preparation,"refresh":refresh,"publication":publication,"observer":observer,"passwordsPreservedOnRefresh":true,"apiCredentialIsolation":true,"ledger":driver.oracle_read("ledger").await?,"ledgerRetentionChecks":ledger_checks,"firstStreamJobsUnchangedAfterSecondStream":true,"qualification":"DISPOSABLE_LOCAL_FIXTURE_ONLY"}),
        )
    }
}
