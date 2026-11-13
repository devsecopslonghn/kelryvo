//! One attempt to acquire a nonce-bound mutex on one dedicated writer session.
use super::{Result, Session, Unavailable, bounded};
use rand::RngCore;
use regex::Regex;
use std::sync::LazyLock;
use uuid::Uuid;
pub(crate) fn owner_valid(s: &str) -> bool {
    static P: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\A[A-Z][A-Z0-9_]{0,29}\z").expect("mutex owner"));
    P.is_match(s)
}
pub(crate) fn target_valid(s: &str) -> bool {
    static P: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\A[A-Za-z0-9._:/-]{1,512}\z").expect("target key"));
    P.is_match(s)
}
#[derive(PartialEq)]
enum State {
    Fresh,
    Active,
    Lost,
    Released,
}
pub struct TargetMutex {
    owner: String,
    session: Uuid,
    state: State,
    lock: String,
    nonce: String,
    release_attempted: bool,
}
impl TargetMutex {
    pub fn new(session: &impl Session, owner: &str) -> Result<Self> {
        if !bounded(session) || !owner_valid(owner) {
            return Err(Unavailable);
        }
        Ok(Self {
            owner: owner.into(),
            session: session.instance(),
            state: State::Fresh,
            lock: String::new(),
            nonce: String::new(),
            release_attempted: false,
        })
    }
    fn matches(&self, s: &impl Session) -> bool {
        self.session == s.instance() && bounded(s)
    }
    pub fn acquire(&mut self, s: &mut impl Session, target: &str) -> bool {
        if self.state != State::Fresh || !self.matches(s) || !target_valid(target) {
            return false;
        }
        self.state = State::Lost;
        self.lock = format!("SF_SCHEMAFORGE_TARGET_{}", kelryvo_core::sha256(target));
        let mut nonce = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        self.nonce = nonce.iter().map(|b| format!("{b:02x}")).collect();
        match s.mutex_call(&self.owner, "ACQUIRE_LOCK", &self.lock, &self.nonce) {
            Ok(0) => {
                self.state = State::Active;
                true
            }
            Ok(1..=5) => {
                self.release_attempted = true;
                false
            }
            _ => {
                self.release_attempted = true;
                let _ = s.mutex_call(&self.owner, "RELEASE_LOCK", &self.lock, &self.nonce);
                false
            }
        }
    }
    pub fn current(&mut self, s: &mut impl Session) -> bool {
        if self.state != State::Active || !self.matches(s) {
            self.state = State::Lost;
            return false;
        }
        match s.mutex_call(&self.owner, "CURRENT_LOCK", &self.lock, &self.nonce) {
            Ok(0) => true,
            _ => {
                self.state = State::Lost;
                false
            }
        }
    }
    pub fn release(&mut self, s: &mut impl Session) -> bool {
        if self.release_attempted
            || self.state == State::Fresh
            || self.state == State::Released
            || !self.matches(s)
        {
            return false;
        }
        self.release_attempted = true;
        self.state = State::Released;
        matches!(
            s.mutex_call(&self.owner, "RELEASE_LOCK", &self.lock, &self.nonce),
            Ok(0)
        )
    }
}
