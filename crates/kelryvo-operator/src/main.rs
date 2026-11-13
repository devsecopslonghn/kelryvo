use kelryvo_operator::{ActorSeed, OperatorUnavailable, ProjectAction};
use kelryvo_server::config::read_secret;
use std::{
    env, fs,
    io::{IsTerminal, Read},
    os::unix::fs::MetadataExt,
    path::PathBuf,
    process::ExitCode,
};
use zeroize::{Zeroize, Zeroizing};

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordInput {
    username: String,
    password: String,
}
impl Drop for PasswordInput {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}

fn private_secret(
    root: &std::path::Path,
    name: &str,
) -> Result<Zeroizing<String>, OperatorUnavailable> {
    let path = fs::canonicalize(root.join(name)).map_err(|_| OperatorUnavailable)?;
    let metadata = fs::metadata(&path).map_err(|_| OperatorUnavailable)?;
    let own = fs::metadata("/proc/self")
        .map_err(|_| OperatorUnavailable)?
        .uid();
    if metadata.mode() & 0o077 != 0 || (own != 0 && metadata.uid() != own) {
        return Err(OperatorUnavailable);
    }
    let bytes = Zeroizing::new(read_secret(root, name, 16384).map_err(|_| OperatorUnavailable)?);
    Ok(Zeroizing::new(
        std::str::from_utf8(&bytes)
            .map_err(|_| OperatorUnavailable)?
            .trim()
            .to_owned(),
    ))
}

async fn run() -> Result<(), OperatorUnavailable> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args == ["--build-info"] {
        println!("{}", kelryvo_core::build_identity::info());
        return Ok(());
    }
    if args == ["--help"] || args.is_empty() {
        println!(
            "Usage: kelryvo-operator initialize|seed-actors|status|activate\n       kelryvo-operator pilot ACTION [PILOT_OPTIONS]\n       kelryvo-operator local-prepare|local-dev [LOCAL_STARTUP_OPTIONS]\n       kelryvo-operator inventory declare|assign|release|target-option|status\n       kelryvo-operator local-inventory declare|assign|release|target-option|status PRIVATE_CONFIG\n       kelryvo-operator grant|revoke|deploy-grant|deploy-revoke PROJECT_ID ACTOR_ID\n       kelryvo-operator database-grant|database-revoke|identity-grant|identity-revoke ACTOR_ID\n       kelryvo-operator local-credential-rotate|local-credential-revoke developer|approver PRIVATE_CONFIG\n       kelryvo-operator local-credential-recover PRIVATE_CONFIG\n       kelryvo-operator local-password-reset|local-password-disable developer|approver PRIVATE_CONFIG\n       kelryvo-operator credential-rotate|credential-recover developer|approver\n       kelryvo-operator password-reset|password-disable developer|approver\n       kelryvo-operator recover-expired JOB_ID METADATA_GENERATION_ID\n       kelryvo-operator managed-attest NEW_ATTESTATION\n       kelryvo-operator managed-policy ATTESTATION PG_DUMP PG_RESTORE NEW_PRIVATE_POLICY\n       kelryvo-operator managed-backup ATTESTATION NEW_DIRECTORY EXTERNAL_WITNESS\n       kelryvo-operator managed-restore ATTESTATION BACKUP_DIRECTORY EXTERNAL_WITNESS\n       kelryvo-operator metadata-attest PG_DUMP_ABSOLUTE PG_RESTORE_ABSOLUTE NEW_PRIVATE_POLICY\n       kelryvo-operator metadata-backup NEW_ABSOLUTE_DIRECTORY EXTERNAL_WITNESS\n       kelryvo-operator metadata-restore BACKUP_DIRECTORY EXTERNAL_WITNESS\n\nManaged commands read private kubectl-tool and kubeconfig from KELRYVO_SECRET_DIR; all cluster identities remain pinned. Other commands read its private database-url. seed-actors also reads developer-token and approver-token. Backup/restore require private postgresql-backup-policy; restore additionally requires database-admin-url and creates only a new quarantined database in RESTORE_HOLD. Password reset reads only private JSON {{username,password}} from stdin. Container credential-recover and password commands require UID 0. Local password commands require a loopback metadata URL matching the private local config. Inventory mutations read a bounded JSON object from stdin and retain ACTIVE metadata guards; local-inventory also requires a matching loopback metadata URL and private configuration. Inventory status is read-only. No credentials are accepted in command arguments. Recovery never dispatches SQL, creates a fresh claim or activates restored metadata."
        );
        return Ok(());
    }
    let uid = i32::try_from(
        fs::metadata("/proc/self")
            .map_err(|_| OperatorUnavailable)?
            .uid(),
    )
    .map_err(|_| OperatorUnavailable)?;
    // Dedicated application/worker UIDs cannot invoke the OS-operator plane.
    if [10001, 10002].contains(&uid) {
        return Err(OperatorUnavailable);
    }
    let action = args[0].as_str();
    if action == "pilot" {
        return kelryvo_operator::pilot::run(&args[1..]).await;
    }
    if ["local-prepare", "local-dev"].contains(&action) {
        let prepared = kelryvo_operator::local::prepare(&args[1..]).await?;
        if action == "local-dev" {
            return prepared.serve();
        }
        println!("{}", prepared.summary());
        return Ok(());
    }
    let expected = match action {
        "local-credential-rotate"
        | "local-credential-revoke"
        | "local-password-reset"
        | "local-password-disable" => 3,
        "local-credential-recover" => 2,
        "credential-rotate" | "credential-recover" | "password-reset" | "password-disable" => 2,
        "inventory" => 2,
        "local-inventory" => 3,
        "managed-attest" => 2,
        "managed-policy" => 5,
        "managed-backup" | "managed-restore" => 4,
        "metadata-attest" => 4,
        "initialize" | "seed-actors" | "status" | "activate" => 1,
        "database-grant" | "database-revoke" | "identity-grant" | "identity-revoke" => 2,
        "grant" | "revoke" | "deploy-grant" | "deploy-revoke" | "recover-expired"
        | "metadata-backup" | "metadata-restore" => 3,
        _ => return Err(OperatorUnavailable),
    };
    if args.len() != expected
        || args.iter().any(|s| {
            s.is_empty()
                || s.encode_utf16().count()
                    > if action.starts_with("metadata-")
                        || action.starts_with("managed-")
                        || action.starts_with("local-")
                    {
                        4096
                    } else {
                        200
                    }
                || s.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        })
    {
        return Err(OperatorUnavailable);
    }
    if [
        "credential-rotate",
        "credential-recover",
        "password-reset",
        "password-disable",
    ]
    .contains(&action)
        && (!["developer", "approver"].contains(&args[1].as_str())
            || action != "credential-rotate" && uid != 0)
    {
        return Err(OperatorUnavailable);
    }
    let root = PathBuf::from(
        env::var("KELRYVO_SECRET_DIR").unwrap_or_else(|_| "/run/kelryvo/secrets".into()),
    );
    if action == "managed-attest" {
        println!(
            "{}",
            kelryvo_operator::backup::managed::attest(&root, std::path::Path::new(&args[1]))
                .await?
        );
        return Ok(());
    }
    if ["managed-policy", "managed-backup", "managed-restore"].contains(&action) {
        println!(
            "{}",
            kelryvo_operator::backup::managed::run(
                &root,
                action,
                std::path::Path::new(&args[1]),
                &args[2..]
            )
            .await?
        );
        return Ok(());
    }
    let database_url = private_secret(&root, "database-url")?;
    if database_url.chars().any(|c| c <= '\u{20}' || c == '\u{7f}')
        || !(database_url.starts_with("postgres://") || database_url.starts_with("postgresql://"))
    {
        return Err(OperatorUnavailable);
    }
    if action == "local-inventory" {
        kelryvo_operator::local_credentials::authorize_metadata_url(
            std::path::Path::new(&args[2]),
            &database_url,
        )?;
    }
    if ["local-password-reset", "local-password-disable"].contains(&action) {
        if !["developer", "approver"].contains(&args[1].as_str()) {
            return Err(OperatorUnavailable);
        }
        kelryvo_operator::local_credentials::authorize_metadata_url(
            std::path::Path::new(&args[2]),
            &database_url,
        )?;
    }
    if action == "metadata-attest" {
        println!(
            "{}",
            kelryvo_operator::backup::attest(
                &database_url,
                std::path::Path::new(&args[1]),
                std::path::Path::new(&args[2]),
                std::path::Path::new(&args[3])
            )
            .await?
        );
        return Ok(());
    }
    if ["metadata-backup", "metadata-restore"].contains(&action) {
        let policy = kelryvo_operator::backup::Policy::parse(&private_secret(
            &root,
            "postgresql-backup-policy",
        )?)?;
        let directory = std::path::Path::new(&args[1]);
        let witness = std::path::Path::new(&args[2]);
        let result = if action == "metadata-backup" {
            kelryvo_operator::backup::create(&database_url, &policy, directory, witness).await?
        } else {
            let admin = private_secret(&root, "database-admin-url")?;
            kelryvo_operator::backup::restore(&database_url, &admin, &policy, directory, witness)
                .await?
        };
        println!("{result}");
        return Ok(());
    }
    let pool = kelryvo_server::connect(&database_url)
        .await
        .map_err(|_| OperatorUnavailable)?;
    if ["inventory", "local-inventory"].contains(&action) {
        let input = if args[1] == "status" {
            serde_json::json!({})
        } else {
            let stdin = std::io::stdin();
            if stdin.is_terminal() {
                return Err(OperatorUnavailable);
            }
            let mut bytes = Zeroizing::new(Vec::new());
            stdin
                .lock()
                .take(32769)
                .read_to_end(&mut bytes)
                .map_err(|_| OperatorUnavailable)?;
            if bytes.len() > 32768 {
                return Err(OperatorUnavailable);
            }
            serde_json::from_slice(&bytes).map_err(|_| OperatorUnavailable)?
        };
        let result = kelryvo_operator::inventory::operate(&pool, &args[1], &input).await?;
        pool.close().await;
        println!("{result}");
        return Ok(());
    }
    if action == "local-credential-recover" {
        kelryvo_operator::local_credentials::recover(&pool, std::path::Path::new(&args[1])).await?;
        pool.close().await;
        println!(
            "Local credential journal reconciled; credential expiry and execution state unchanged."
        );
        return Ok(());
    }
    if ["local-credential-rotate", "local-credential-revoke"].contains(&action) {
        kelryvo_operator::local_credentials::operate(
            &pool,
            std::path::Path::new(&args[2]),
            &args[1],
            if action == "local-credential-rotate" {
                "rotate"
            } else {
                "revoke"
            },
        )
        .await?;
        pool.close().await;
        println!("Local credential and private configuration updated.");
        return Ok(());
    }
    if ["credential-rotate", "credential-recover"].contains(&action) {
        let token = private_secret(&root, &format!("{}-token", args[1]))?;
        let status = kelryvo_operator::accounts::credential(
            &pool,
            &args[1],
            &token,
            uid,
            action == "credential-recover",
        )
        .await?;
        pool.close().await;
        println!(
            "{}",
            serde_json::json!({"status":status,"executionAuthority":false,"expiryExtended":false})
        );
        return Ok(());
    }
    if [
        "password-reset",
        "password-disable",
        "local-password-reset",
        "local-password-disable",
    ]
    .contains(&action)
    {
        let stdin = std::io::stdin();
        let mut bytes = Zeroizing::new(Vec::new());
        if stdin.is_terminal() {
            if action.ends_with("password-reset") {
                return Err(OperatorUnavailable);
            }
        } else {
            stdin
                .lock()
                .take(2049)
                .read_to_end(&mut bytes)
                .map_err(|_| OperatorUnavailable)?;
        }
        if bytes.len() > 2048 {
            return Err(OperatorUnavailable);
        }
        let input = if action.ends_with("password-reset") {
            Some(serde_json::from_slice::<PasswordInput>(&bytes).map_err(|_| OperatorUnavailable)?)
        } else {
            if !bytes.iter().all(u8::is_ascii_whitespace) {
                return Err(OperatorUnavailable);
            }
            None
        };
        let input = input
            .as_ref()
            .map(|p| (p.username.as_str(), p.password.as_str()));
        if action.starts_with("local-") {
            kelryvo_operator::accounts::local_password(&pool, &args[1], input, uid).await?;
        } else {
            kelryvo_operator::accounts::password(&pool, &args[1], input, uid).await?;
        }
        pool.close().await;
        println!(
            "Password account updated; prior password/browser sessions revoked. Roles and project grants preserved."
        );
        return Ok(());
    }
    match action {
        "initialize" => kelryvo_server::initialize(&pool)
            .await
            .map_err(|_| OperatorUnavailable)?,
        "seed-actors" => {
            let mut actors = Vec::new();
            for role in ["developer", "approver"] {
                actors.push(ActorSeed {
                    id: format!("kelryvo-{role}"),
                    name: format!("Kelryvo {role}"),
                    role: role.into(),
                    token: private_secret(&root, &format!("{role}-token"))?,
                });
            }
            kelryvo_operator::seed(&pool, &actors).await?;
        }
        "activate" => kelryvo_operator::activate(&pool, uid).await?,
        "status" => {
            println!("{}", kelryvo_operator::status(&pool).await?);
            pool.close().await;
            return Ok(());
        }
        "database-grant" | "database-revoke" => {
            kelryvo_operator::database_access(&pool, &args[1], action == "database-grant", uid)
                .await?
        }
        "identity-grant" | "identity-revoke" => {
            kelryvo_operator::identity_access(&pool, &args[1], action == "identity-grant", uid)
                .await?
        }
        "recover-expired" => {
            if !args[1..]
                .iter()
                .all(|s| kelryvo_core::uuid(&serde_json::json!(s)))
            {
                return Err(OperatorUnavailable);
            }
            let job = uuid::Uuid::parse_str(&args[1]).map_err(|_| OperatorUnavailable)?;
            let generation = uuid::Uuid::parse_str(&args[2]).map_err(|_| OperatorUnavailable)?;
            let store = kelryvo_runtime::jobs::JobStore::new(
                pool.clone(),
                kelryvo_server::ORG_UUID,
                generation,
                "kelryvo-rust-expiry-recovery",
            )
            .map_err(|_| OperatorUnavailable)?;
            let held = store
                .recover_expired(job, Some(uid))
                .await
                .map_err(|_| OperatorUnavailable)?;
            println!(
                "{}",
                serde_json::json!({"jobId":job,"state":if held{"HOLD"}else{"NOT_RECOVERED"},"executionAuthority":false})
            );
            pool.close().await;
            return Ok(());
        }
        _ => {
            if !kelryvo_core::uuid(&serde_json::json!(args[1])) {
                return Err(OperatorUnavailable);
            }
            let project = uuid::Uuid::parse_str(&args[1]).map_err(|_| OperatorUnavailable)?;
            let action = match action {
                "grant" => ProjectAction::Grant,
                "revoke" => ProjectAction::Revoke,
                "deploy-grant" => ProjectAction::DeployGrant,
                "deploy-revoke" => ProjectAction::DeployRevoke,
                _ => return Err(OperatorUnavailable),
            };
            kelryvo_operator::project_action(&pool, project, &args[2], action, uid).await?;
        }
    }
    pool.close().await;
    println!("Operator action complete.");
    Ok(())
}

#[tokio::main]
async fn main() -> ExitCode {
    kelryvo_core::initialize_build_identity!();
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(_) => {
            eprintln!(
                "Operator action unavailable. Check private configuration and current metadata authority."
            );
            ExitCode::FAILURE
        }
    }
}
