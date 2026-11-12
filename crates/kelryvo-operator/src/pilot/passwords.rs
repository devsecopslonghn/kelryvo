use super::*;
use nix::sys::termios::{self, LocalFlags, SetArg, Termios};
use serde::Deserialize;
use std::io::{self, BufRead, IsTerminal, Read, Write};
use zeroize::Zeroize;

#[derive(Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Account {
    username: String,
    password: String,
}
impl Drop for Account {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}
impl Account {
    fn valid(&self) -> bool {
        kelryvo_server::auth::valid_login_name(&self.username)
            && kelryvo_server::auth::valid_password(&self.password)
    }
    pub(super) fn encode(&self) -> Result<Zeroizing<Vec<u8>>> {
        Ok(Zeroizing::new(
            serde_json::to_vec(self).map_err(|_| fail())?,
        ))
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Accounts {
    pub developer: Account,
    pub approver: Account,
}
impl Accounts {
    fn valid(&self) -> bool {
        self.developer.valid()
            && self.approver.valid()
            && self.developer.username != self.approver.username
    }
}
struct Echo {
    stdin: io::Stdin,
    original: Termios,
}
impl Echo {
    fn disable() -> Result<Self> {
        let stdin = io::stdin();
        let original = termios::tcgetattr(&stdin).map_err(|_| fail())?;
        let mut hidden = original.clone();
        hidden.local_flags.remove(LocalFlags::ECHO);
        termios::tcsetattr(&stdin, SetArg::TCSANOW, &hidden).map_err(|_| fail())?;
        Ok(Self { stdin, original })
    }
}
impl Drop for Echo {
    fn drop(&mut self) {
        let _ = termios::tcsetattr(&self.stdin, SetArg::TCSANOW, &self.original);
    }
}
fn prompt(label: &str, hidden: bool) -> Result<Zeroizing<String>> {
    let echo = if hidden { Some(Echo::disable()?) } else { None };
    let mut stderr = io::stderr().lock();
    write!(stderr, "{label}").map_err(|_| fail())?;
    stderr.flush().map_err(|_| fail())?;
    let mut line = Zeroizing::new(String::new());
    io::stdin()
        .lock()
        .take(2049)
        .read_line(&mut line)
        .map_err(|_| fail())?;
    drop(echo);
    if hidden {
        writeln!(stderr).map_err(|_| fail())?;
    }
    if line.len() > 2048 {
        return Err(fail());
    }
    if line.ends_with('\n') {
        line.pop();
        if line.ends_with('\r') {
            line.pop();
        }
    }
    Ok(line)
}
fn interactive(role: &str) -> Result<Account> {
    let username = prompt(&format!("{role} username: "), false)?;
    let password = prompt(&format!("{role} password: "), true)?;
    let confirmation = prompt("Confirm password: ", true)?;
    if password.as_str() != confirmation.as_str() {
        return Err(fail());
    }
    let a = Account {
        username: username.trim().into(),
        password: password.to_string(),
    };
    if !a.valid() {
        return Err(fail());
    }
    Ok(a)
}
pub(super) fn read() -> Result<Accounts> {
    let a = if io::stdin().is_terminal() {
        Accounts {
            developer: interactive("developer")?,
            approver: interactive("approver")?,
        }
    } else {
        let mut bytes = Zeroizing::new(Vec::new());
        io::stdin()
            .lock()
            .take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| fail())?;
        if bytes.len() > 4096 {
            return Err(fail());
        }
        serde_json::from_slice(&bytes).map_err(|_| fail())?
    };
    if !a.valid() {
        return Err(fail());
    }
    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn both_accounts_are_distinct_and_valid_before_any_operator_mutation() {
        let valid = json!({"developer":{"username":"pilot.developer","password":"Private fixture password 1!"},"approver":{"username":"pilot.approver","password":"Private fixture password 2!"}});
        let accounts: Accounts = serde_json::from_value(valid.clone()).unwrap();
        assert!(accounts.valid());
        let mut duplicate = valid.clone();
        duplicate["approver"]["username"] = duplicate["developer"]["username"].clone();
        assert!(
            !serde_json::from_value::<Accounts>(duplicate)
                .unwrap()
                .valid()
        );
        let mut invalid = valid.clone();
        invalid["approver"]["password"] = json!("short");
        assert!(!serde_json::from_value::<Accounts>(invalid).unwrap().valid());
        let mut extra = valid;
        extra["developer"]["token"] = json!("unexpected");
        assert!(serde_json::from_value::<Accounts>(extra).is_err());
    }
}
